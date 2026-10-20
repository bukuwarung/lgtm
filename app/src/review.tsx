import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addedLines, anchor, parsePatch, removedRuns, type Hunk, type Removed } from './diff.ts';
import { isGenerated, parseGeneratedRules } from './gitattributes.ts';
import {
  getChecks, getConversation, getEmails, getFiles, getPR, getRaw, getThreads, getViewer, reply, submitReview,
  type Check, type ConversationItem, type Draft, type PR, type ReviewEvent, type Thread,
} from './github.ts';
import { highlightHunks } from './highlight.ts';
import { isMarkdown, md, renderChunks } from './markdown.ts';
import { notifySlack, slackConfigured, storage, useStoredFlag } from './platform.ts';
import { Resizer } from './resizer.tsx';
import { ShortcutIndex, type File } from './shortcuts.tsx';

type Side = 'LEFT' | 'RIGHT';
// Where the (single) open comment form is. No line = file-level; quote pre-fills the body;
// near = head line to show a file-level form at (rich view blocks outside the diff).
type Target = { path: string; side: Side; line?: number; startLine?: number; quote?: string; near?: number };
type Ctx = {
  pr: PR;
  headRepo: string;
  target: Target | null;
  setTarget: (t: Target | null) => void;
  addDraft: (d: Omit<Draft, 'id'>) => void;
  removeDraft: (id: string) => void;
  reply: (t: Thread, body: string) => Promise<void>;
};
type Saved = { sha: string; drafts: Draft[] };

const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function slackText(pr: PR, ref: string, event: ReviewEvent, body: string, comments: number) {
  const verb = { APPROVE: '✅ Approved', REQUEST_CHANGES: '🔴 Requested changes on', COMMENT: '💬 Reviewed' }[event];
  const extra = comments ? ` · ${comments} comment${comments > 1 ? 's' : ''}` : '';
  const quote = body.trim() ? '\n' + slackEscape(body.trim().slice(0, 1000)).replace(/^/gm, '>') : '';
  return `${verb} <${pr.html_url}|${slackEscape(`${ref} ${pr.title}`)}>${extra}${quote}`;
}

const isFileLevel = (t: Thread) => t.subjectType === 'FILE' || t.line == null;

export function Review({ repo, n, onSubmitted }: { repo: string; n: number; onSubmitted: () => void }) {
  const [data, setData] = useState<{ pr: PR; headRepo: string; files: File[] } | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [saved, setSaved] = useState<Saved>({ sha: '', drafts: [] });
  const [target, setTarget] = useState<Target | null>(null);
  const [showGenerated, setShowGenerated] = useState(false);
  const [showIndex, toggleIndex] = useStoredFlag('showIndex', true);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState('');
  // Who gets a Slack DM after submitting (author + assignees, minus me and bots); null = Slack not set up.
  const [slackTo, setSlackTo] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const key = `drafts:${repo}#${n}`;

  // Checks are secondary: a failure here shouldn't block the review.
  const loadChecks = () => {
    setChecks(null);
    getChecks(repo, n).then(setChecks, () => setChecks([]));
  };

  useEffect(() => {
    loadChecks();
    (async () => {
      const pr = await getPR(repo, n);
      const headRepo = pr.head.repo?.full_name ?? repo;
      const [files, threads, conversation, attrs, stored] = await Promise.all([
        getFiles(repo, n),
        getThreads(repo, n),
        getConversation(repo, n),
        getRaw(headRepo, '.gitattributes', pr.head.sha),
        storage.get<Saved>(key),
      ]);
      Promise.all([slackConfigured(), getViewer()]).then(([ready, me]) => {
        const people = [pr.user, ...pr.assignees].filter((u) => u.type !== 'Bot' && u.login !== me).map((u) => u.login);
        setSlackTo(ready ? [...new Set(people)] : null);
      }, () => setSlackTo(null));
      const rules = parseGeneratedRules(attrs ?? '');
      const sorted = files
        .map((f) => ({ ...f, generated: isGenerated(rules, f.filename) }))
        .sort((a, b) => +isMarkdown(b.filename) - +isMarkdown(a.filename)); // stable: keeps GitHub order within groups
      setThreads(threads);
      setConversation(conversation);
      setSaved(stored ?? { sha: pr.head.sha, drafts: [] });
      setData({ pr, headRepo, files: sorted });
    })().catch((e) => setError(e.message));
  }, []);

  const byPath = useMemo(() => Map.groupBy(threads, (t) => t.path), [threads]);

  if (error) return <p class="error page">{error}</p>;
  if (!data) return <p class="note page">Loading pull request…</p>;
  const { pr, headRepo, files } = data;
  const { drafts } = saved;

  // Drafts remember the commit they were written on, so a push mid-review doesn't orphan them.
  function saveDrafts(next: Draft[]) {
    const s = { sha: drafts.length ? saved.sha : pr.head.sha, drafts: next };
    setSaved(s);
    (next.length ? storage.set(key, s) : storage.remove(key)).catch((e) => setError(e.message));
  }

  async function submit(event: ReviewEvent, body: string, notify: boolean) {
    const head = (await getPR(repo, n)).head.sha;
    const sha = drafts.length ? saved.sha : head;
    if (sha !== head && !confirm('New commits were pushed after you started this review. Submit your comments against the older commit?')) return false;
    await submitReview(pr.node_id, sha, event, body, drafts);
    saveDrafts([]);
    onSubmitted();
    setNotice(null);
    if (notify && slackTo?.length) {
      // The review is in; a Slack failure is reported, not thrown.
      try {
        const emails = await getEmails(repo.split('/')[0], slackTo);
        const results = await notifySlack(slackTo.map((login) => ({ login, emails: emails[login] })), slackText(pr, `${repo}#${n}`, event, body, drafts.length));
        const failed = results.filter((r) => !r.ok);
        const sent = results.filter((r) => r.ok).map((r) => '@' + r.login);
        setNotice({
          ok: !failed.length,
          text: [sent.length && `Messaged ${sent.join(', ')} on Slack.`, ...failed.map((r) => `Couldn't message @${r.login}: ${r.error}`)].filter(Boolean).join(' '),
        });
      } catch (e: any) {
        setNotice({ ok: false, text: `Review submitted, but Slack failed: ${e.message}` });
      }
    }
    const [t, c] = await Promise.all([getThreads(repo, n), getConversation(repo, n)]);
    setThreads(t);
    setConversation(c);
    return true;
  }

  const ctx: Ctx = {
    pr,
    headRepo,
    target,
    setTarget,
    addDraft: (d) => saveDrafts([...drafts, { ...d, id: crypto.randomUUID() }]),
    removeDraft: (id) => saveDrafts(drafts.filter((d) => d.id !== id)),
    reply: async (t, body) => {
      await reply(repo, n, t.comments.nodes[0].databaseId, body);
      setThreads(await getThreads(repo, n));
    },
  };

  const visible = files.filter((f) => !f.generated);
  const generated = files.filter((f) => f.generated);
  const shown = showGenerated ? [...visible, ...generated] : visible;
  const section = (f: File) => (
    <FileSection key={f.filename} file={f} ctx={ctx} threads={byPath.get(f.filename) ?? []} drafts={drafts.filter((d) => d.path === f.filename)} />
  );

  return (
    <div class={showIndex ? 'review' : 'review no-index'}>
      {showIndex && (
        <aside class="side tree">
          <div class="side-scroll">
            <ShortcutIndex
              pr={pr}
              conversation={conversation}
              threads={threads}
              drafts={drafts}
              checks={checks}
              onRefreshChecks={loadChecks}
              files={shown}
              counts={(path) => (byPath.get(path)?.length ?? 0) + drafts.filter((d) => d.path === path).length}
            />
          </div>
          <Resizer name="index" label="PR index" />
        </aside>
      )}
      <div>
        <div class="bar">
          <button title={showIndex ? 'Hide the PR index' : 'Show the PR index'} onClick={toggleIndex}>
            {showIndex ? '⇤' : '⇥'} Index
          </button>
          <h1>
            {pr.title} <a href={pr.html_url} target="_blank" rel="noopener">{repo}#{n}</a>
          </h1>
          <SubmitPanel count={drafts.length} slackTo={slackTo} onSubmit={submit} />
        </div>
        <main>
          {notice && <p class={notice.ok ? 'notice' : 'warn'}>{notice.text}</p>}
          {drafts.length > 0 && saved.sha !== pr.head.sha && (
            <p class="warn">New commits were pushed since you started this review. Your pending comments refer to the older commit.</p>
          )}
          <Conversation pr={pr} items={conversation} />
          {visible.map(section)}
          {generated.length > 0 &&
            (showGenerated ? generated.map(section) : (
              <button class="gen-row" onClick={() => setShowGenerated(true)}>
                {generated.length} generated file{generated.length > 1 ? 's' : ''} hidden. Show
              </button>
            ))}
        </main>
      </div>
    </div>
  );
}

type SubmitProps = { count: number; slackTo: string[] | null; onSubmit: (e: ReviewEvent, body: string, notify: boolean) => Promise<boolean> };

function SubmitPanel({ count, slackTo, onSubmit }: SubmitProps) {
  const [open, setOpen] = useState(false);
  const [notify, toggleNotify] = useStoredFlag('slackNotify', true);
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const labels: Record<ReviewEvent, string> = { COMMENT: 'Comment', APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes' };

  async function go() {
    setBusy(true);
    setErr('');
    try {
      if (await onSubmit(event, body, notify)) {
        setOpen(false);
        setBody('');
      }
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <div class="submit">
      <button class="primary" onClick={() => setOpen(!open)}>
        Finish review{count ? ` (${count})` : ''}
      </button>
      {open && (
        <div class="panel">
          <textarea rows={4} placeholder="Leave a comment" value={body} onInput={(e) => setBody(e.currentTarget.value)} />
          {(Object.keys(labels) as ReviewEvent[]).map((v) => (
            <label>
              <input type="radio" name="event" checked={event === v} onChange={() => setEvent(v)} /> {labels[v]}
            </label>
          ))}
          {slackTo && slackTo.length > 0 && (
            <label>
              <input type="checkbox" checked={notify} onChange={toggleNotify} /> Message {slackTo.map((l) => '@' + l).join(', ')} on Slack
            </label>
          )}
          <button class="primary" disabled={busy} onClick={go}>
            {busy ? 'Submitting…' : 'Submit review'}
          </button>
          {err && <p class="error">{err}</p>}
        </div>
      )}
    </div>
  );
}

// Render a file's body only once it scrolls near the viewport.
function useNear<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '2000px 0px' },
    );
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);
  return [ref, near] as const;
}

type BodyProps = { file: File; hunks: Hunk[]; ctx: Ctx; threads: Thread[]; drafts: Draft[] };

function FileSection({ file, ctx, threads, drafts }: { file: File; ctx: Ctx; threads: Thread[]; drafts: Draft[] }) {
  const canRich = isMarkdown(file.filename) && file.status !== 'removed' && !!file.patch;
  const [rich, setRich] = useState(canRich);
  const [ref, near] = useNear<HTMLElement>();
  const hunks = useMemo(() => parsePatch(file.patch ?? ''), [file.patch]);
  const path = file.filename;
  const t = ctx.target;
  const body: BodyProps = { file, hunks, ctx, threads: threads.filter((x) => !isFileLevel(x)), drafts: drafts.filter((d) => d.line) };

  return (
    <section class="file" id={'f-' + path} ref={ref}>
      <header class="file-h">
        <span class="st">{file.status}</span>
        <a href={file.blob_url} target="_blank" rel="noopener">
          {file.previous_filename ? `${file.previous_filename} → ` : ''}
          {path}
        </a>
        <span class="counts">
          <b class="a">+{file.additions}</b> <b class="d">−{file.deletions}</b>
        </span>
        {threads.length > 0 && <span class="badge" title="Review threads">💬 {threads.length}</span>}
        {canRich && <button onClick={() => setRich(!rich)}>{rich ? 'Source' : 'Rich'}</button>}
        <button onClick={() => ctx.setTarget({ path, side: 'RIGHT' })}>Comment</button>
      </header>
      <Notes
        ctx={ctx}
        threads={threads.filter(isFileLevel)}
        drafts={drafts.filter((d) => !d.line)}
        form={t?.path === path && t.line == null && t.near == null}
      />
      {!file.patch ? (
        <p class="note pad">
          No diff to show (binary, too large, or renamed without changes).{' '}
          <a href={file.blob_url} target="_blank" rel="noopener">View on GitHub</a>
        </p>
      ) : !near ? (
        <div style={{ height: `${hunks.reduce((s, h) => s + h.lines.length + 1, 0) * 20}px` }} />
      ) : rich ? (
        <RichView {...body} />
      ) : (
        <DiffView {...body} />
      )}
    </section>
  );
}

function DiffView({ file, hunks, ctx, threads, drafts }: BodyProps) {
  const path = file.filename;
  const hl = useMemo(() => highlightHunks(hunks, path), [hunks]);
  const t = ctx.target?.path === path ? ctx.target : null;

  const pick = (e: MouseEvent, side: Side, line: number) => {
    if (e.shiftKey && t?.side === side && t.line) {
      const start = Math.min(t.startLine ?? t.line, line), end = Math.max(t.line, line);
      ctx.setTarget({ path, side, line: end, startLine: start === end ? undefined : start });
    } else ctx.setTarget({ path, side, line });
  };

  const notes = (side: Side, line: number) => {
    const th = threads.filter((x) => x.diffSide === side && x.line === line);
    const dr = drafts.filter((x) => x.side === side && x.line === line);
    const form = t?.side === side && t.line === line;
    if (!th.length && !dr.length && !form) return null;
    return (
      <tr>
        <td colSpan={3} class="notes-cell">
          <Notes ctx={ctx} threads={th} drafts={dr} form={form} />
        </td>
      </tr>
    );
  };

  return (
    <table class="diff">
      <tbody>
        {hunks.map((h, hi) => (
          <>
            <tr class="hunk">
              <td colSpan={3}>{h.header}</td>
            </tr>
            {h.lines.map((l, li) => {
              const side: Side = l.kind === '-' ? 'LEFT' : 'RIGHT';
              const num = side === 'LEFT' ? l.old! : l.new!;
              return (
                <>
                  <tr class={l.kind === '+' ? 'a' : l.kind === '-' ? 'd' : ''}>
                    <td class="num" title="Comment (shift-click to extend)" onClick={(e) => pick(e, side, num)}>{l.old ?? ''}</td>
                    <td class="num" title="Comment (shift-click to extend)" onClick={(e) => pick(e, side, num)}>{l.new ?? ''}</td>
                    {hl ? <td class="code" dangerouslySetInnerHTML={{ __html: hl[hi][li] }} /> : <td class="code">{l.text}</td>}
                  </tr>
                  {notes(side, num)}
                  {l.kind === ' ' && notes('LEFT', l.old!)}
                </>
              );
            })}
          </>
        ))}
      </tbody>
    </table>
  );
}

function RichView({ file, hunks, ctx, threads, drafts }: BodyProps) {
  const path = file.filename;
  const [src, setSrc] = useState<string | null>();
  useEffect(() => {
    getRaw(ctx.headRepo, path, ctx.pr.head.sha).then(setSrc, () => setSrc(null));
  }, []);
  const chunks = useMemo(() => (src ? renderChunks(src, file.status === 'added' ? new Set() : addedLines(hunks)) : []), [src, hunks]);
  const removed = useMemo(() => removedRuns(hunks), [hunks]);

  if (src === undefined) return <p class="note pad">Loading…</p>;
  if (src === null) return <p class="note pad">Couldn't load this file. Switch to Source.</p>;

  const t = ctx.target?.path === path ? ctx.target : null;
  // Threads, drafts and removals attach to the first top-level block ending at or after their line.
  const chunkOf = (line: number) => {
    const i = chunks.findIndex((c) => c.end >= line);
    return i < 0 ? chunks.length - 1 : i;
  };
  const markerSlot = (r: Removed) => {
    const i = chunks.findIndex((c) => c.end >= r.at);
    return i < 0 ? chunks.length : i;
  };
  const inRun = (r: Removed, line?: number | null) => line != null && line >= r.oldStart && line < r.oldStart + r.lines.length;

  const rightT = threads.filter((x) => x.diffSide === 'RIGHT');
  const rightD = drafts.filter((x) => x.side === 'RIGHT');
  const leftT = threads.filter((x) => x.diffSide === 'LEFT');
  const leftD = drafts.filter((x) => x.side === 'LEFT');
  const orphanT = leftT.filter((x) => !removed.some((r) => inRun(r, x.line)));
  const orphanD = leftD.filter((x) => !removed.some((r) => inRun(r, x.line)));

  function onChunkClick(e: MouseEvent) {
    const el = (e.target as Element).closest('[data-src]');
    // Only the "+" gutter (drawn left of the block) starts a comment, so text stays selectable.
    if (!el || e.clientX >= el.getBoundingClientRect().left) return;
    const [s, end] = el.getAttribute('data-src')!.split('-').map(Number);
    const a = anchor(hunks, s, end);
    ctx.setTarget(a ? { path, side: 'RIGHT', ...a } : { path, side: 'RIGHT', quote: src!.split('\n')[s - 1], near: s });
  }

  const marker = (r: Removed) => {
    const last = r.oldStart + r.lines.length - 1;
    return (
      <div class="removed">
        <button
          class="removed-c"
          title="Comment on removed lines"
          onClick={() => ctx.setTarget({ path, side: 'LEFT', line: last, startLine: last > r.oldStart ? r.oldStart : undefined })}
        >
          +
        </button>
        <pre>{r.lines.join('\n')}</pre>
        <Notes
          ctx={ctx}
          threads={leftT.filter((x) => inRun(r, x.line))}
          drafts={leftD.filter((x) => inRun(r, x.line))}
          form={t?.side === 'LEFT' && inRun(r, t.line)}
        />
      </div>
    );
  };

  return (
    <div class="rich">
      <Notes ctx={ctx} threads={orphanT} drafts={orphanD} form={t?.side === 'LEFT' && !removed.some((r) => inRun(r, t.line))} />
      {chunks.map((c, i) => (
        <>
          {removed.filter((r) => markerSlot(r) === i).map(marker)}
          <div class="md chunk" onClick={onChunkClick} dangerouslySetInnerHTML={{ __html: c.html }} />
          <Notes
            ctx={ctx}
            threads={rightT.filter((x) => chunkOf(x.line!) === i)}
            drafts={rightD.filter((x) => chunkOf(x.line!) === i)}
            form={t?.side === 'RIGHT' && (t.line ?? t.near) != null && chunkOf((t.line ?? t.near)!) === i}
          />
        </>
      ))}
      {removed.filter((r) => markerSlot(r) === chunks.length).map(marker)}
    </div>
  );
}

const where = (d: { side: Side; line?: number; startLine?: number }) =>
  d.line == null ? 'File' : `${d.side === 'LEFT' ? 'Old line' : 'Line'}${d.startLine ? `s ${d.startLine}–${d.line}` : ` ${d.line}`}`;

function Notes({ ctx, threads, drafts, form }: { ctx: Ctx; threads: Thread[]; drafts: Draft[]; form: boolean }) {
  if (!threads.length && !drafts.length && !form) return null;
  return (
    <div class="notes">
      {threads.map((t) => (
        <ThreadView key={t.id} t={t} ctx={ctx} />
      ))}
      {drafts.map((d) => (
        <div class="draft" key={d.id} id={'d-' + d.id}>
          <div class="badge">Pending · {where(d)}</div>
          <div class="md" dangerouslySetInnerHTML={{ __html: md.render(d.body) }} />
          <button onClick={() => ctx.removeDraft(d.id)}>Delete</button>
        </div>
      ))}
      {form && <DraftForm key={JSON.stringify(ctx.target)} ctx={ctx} />}
    </div>
  );
}

function ThreadView({ t, ctx }: { t: Thread; ctx: Ctx }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const first = t.comments.nodes[0];

  async function send() {
    setBusy(true);
    setErr('');
    try {
      await ctx.reply(t, body);
      setBody('');
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <details class="thread" id={'t-' + t.id} open={!t.isResolved && !t.isOutdated}>
      <summary>
        <b>{first?.author?.login ?? 'ghost'}</b> {first?.bodyText.split('\n')[0].slice(0, 80)}
        {t.isResolved && <span class="badge"> · resolved</span>}
        {t.isOutdated && <span class="badge"> · outdated</span>}
      </summary>
      {t.comments.nodes.map((c) => (
        <div class="comment" key={c.databaseId}>
          <b>{c.author?.login ?? 'ghost'}</b> <time>{new Date(c.createdAt).toLocaleString()}</time>
          <div class="md" dangerouslySetInnerHTML={{ __html: c.bodyHTML }} />
        </div>
      ))}
      <textarea rows={2} placeholder="Reply…" value={body} onInput={(e) => setBody(e.currentTarget.value)} />
      {body.trim() && (
        <button disabled={busy} onClick={send}>
          Reply
        </button>
      )}
      {err && <p class="error">{err}</p>}
    </details>
  );
}

function DraftForm({ ctx }: { ctx: Ctx }) {
  const target = ctx.target!;
  const [body, setBody] = useState(target.quote != null ? `> ${target.quote}\n\n` : '');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);

  function save() {
    if (!body.trim()) return;
    const { quote: _q, near: _n, ...rest } = target;
    ctx.addDraft({ ...rest, body });
    ctx.setTarget(null);
  }

  return (
    <div class="draft-form">
      <div class="badge">{where(target)}</div>
      <textarea
        ref={ref}
        rows={4}
        value={body}
        onInput={(e) => setBody(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          if (e.key === 'Escape') ctx.setTarget(null);
        }}
      />
      <div class="row">
        <button class="primary" disabled={!body.trim()} onClick={save}>
          Add to review
        </button>
        <button onClick={() => ctx.setTarget(null)}>Cancel</button>
      </div>
    </div>
  );
}

const STATE_LABEL: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'reviewed', DISMISSED: 'review dismissed' };

function Conversation({ pr, items }: { pr: PR; items: ConversationItem[] }) {
  return (
    <details class="conversation" id="conversation" open>
      <summary>
        Conversation <span class="badge">· {items.length} comment{items.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="comment" id="pr-description">
        <b>{pr.user.login}</b> <span class="badge">opened this pull request</span>
        {pr.body_html ? <div class="md" dangerouslySetInnerHTML={{ __html: pr.body_html }} /> : <p class="note">No description.</p>}
      </div>
      {items.map((c) => (
        <div class="comment" key={c.id} id={'cv-' + c.id}>
          <b>{c.author}</b> {c.state && <span class={'rstate r-' + c.state}>{STATE_LABEL[c.state] ?? c.state}</span>}{' '}
          <a href={c.url} target="_blank" rel="noopener"><time>{new Date(c.at).toLocaleString()}</time></a>
          {c.html && <div class="md" dangerouslySetInnerHTML={{ __html: c.html }} />}
        </div>
      ))}
    </details>
  );
}
