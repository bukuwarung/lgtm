import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addedLines, anchor, gaps, parsePatch, removedRuns, type Gap, type Hunk, type Removed } from './diff.ts';
import { isGenerated, parseGeneratedRules } from './gitattributes.ts';
import {
  getChecks, getCompare, getConversation, getEmails, getFiles, getMyLastReviewCommit, getPR, getRaw, getStack, getThreads, getViewed, getViewer,
  reply, resolveThread, setViewed, submitReview,
  type Check, type PRFile, type StackLayer, type ConversationItem, type Draft, type PR, type ReviewEvent, type Thread,
} from './github.ts';
import { highlightCode, highlightHunks, languageFor, splitLines } from './highlight.ts';
import { isMarkdown, md, renderChunks } from './markdown.ts';
import { notifySlack, slackConfigured, storage, useStoredFlag } from './platform.ts';
import { Resizer } from './resizer.tsx';
import { jumpTo, ShortcutIndex, threadOrder, type File } from './shortcuts.tsx';

type Side = 'LEFT' | 'RIGHT';
// Where the (single) open comment form is. No line = file-level; quote pre-fills the body;
// near = head line to show a file-level form at (rich view blocks outside the diff); editId = the draft being edited.
type Target = { path: string; side: Side; line?: number; startLine?: number; quote?: string; near?: number; editId?: string; body?: string };
type Ctx = {
  pr: PR;
  headRepo: string;
  target: Target | null;
  setTarget: (t: Target | null) => void;
  addDraft: (d: Omit<Draft, 'id'>) => void;
  updateDraft: (id: string, d: Omit<Draft, 'id'>) => void;
  removeDraft: (id: string) => void;
  reply: (t: Thread, body: string) => Promise<void>;
  resolve: (t: Thread, resolve: boolean) => Promise<void>;
  renderAll: boolean; // set by ⌘F so the browser's find can see every file
  since: boolean; // showing only changes since my last review: old-side lines aren't the PR's base, so no LEFT comments
};
type Saved = { sha: string; drafts: Draft[] };

const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function slackText(pr: PR, ref: string, event: ReviewEvent, body: string, comments: number) {
  const verb = { APPROVE: '✅ Approved', REQUEST_CHANGES: '🔴 Requested changes on', COMMENT: '💬 Reviewed' }[event];
  const extra = comments ? ` · ${comments} comment${comments > 1 ? 's' : ''}` : '';
  const quote = body.trim() ? '\n' + slackEscape(body.trim().slice(0, 1000)).replace(/^/gm, '>') : '';
  return `${verb} <${pr.html_url}|${slackEscape(`${ref} ${pr.title}`)}>${extra}${quote}`;
}

// Mark generated files and put markdown first (stable sort keeps GitHub's order within each group).
const prepare = (files: PRFile[], rules: ReturnType<typeof parseGeneratedRules>): File[] =>
  files
    .map((f) => ({ ...f, generated: isGenerated(rules, f.filename) }))
    .sort((a, b) => +isMarkdown(b.filename) - +isMarkdown(a.filename));

const isFileLevel = (t: Thread) => t.subjectType === 'FILE' || t.line == null;

export function Review({ repo, n, onSubmitted }: { repo: string; n: number; onSubmitted: () => void }) {
  const [data, setData] = useState<{ pr: PR; headRepo: string; files: File[]; rules: ReturnType<typeof parseGeneratedRules> } | null>(null);
  const [stack, setStack] = useState<StackLayer[]>([]);
  // "Changes since my last review": the commit I last reviewed, and that comparison once loaded.
  const [lastReviewed, setLastReviewed] = useState<string | null>(null);
  const [since, setSince] = useState(false);
  const [sinceData, setSinceData] = useState<{ status: string; files: File[] } | null>(null);
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
  const [viewed, setViewedPaths] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // viewed files opened anyway
  const [renderAll, setRenderAll] = useState(false);
  const [help, setHelp] = useState(false);
  const threadCursor = useRef(-1);
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const key = `drafts:${repo}#${n}`;

  // Checks are secondary: a failure here shouldn't block the review.
  const loadChecks = () => {
    setChecks(null);
    getChecks(repo, n).then(setChecks, () => setChecks([]));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    loadChecks();
    getViewed(repo, n).then(setViewedPaths, () => {});
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
      getStack(repo, pr).then(setStack, () => {});
      getMyLastReviewCommit(repo, n).then((sha) => {
        if (sha && sha !== pr.head.sha) {
          setLastReviewed(sha);
          setSince(true); // re-review: start with just what changed
        }
      }, () => {});
      setThreads(threads);
      setConversation(conversation);
      setSaved(stored ?? { sha: pr.head.sha, drafts: [] });
      setData({ pr, headRepo, files: prepare(files, rules), rules });
    })().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!since || !lastReviewed || !data || sinceData) return;
    getCompare(repo, lastReviewed, data.pr.head.sha).then(
      // After a rebase the comparison also carries the base branch's changes; keep only files this PR touches.
      (d) => {
        const inPR = new Set(data.files.map((f) => f.filename));
        setSinceData({ status: d.status, files: prepare(d.files.filter((f) => inPR.has(f.filename)), data.rules) });
      },
      (e) => {
        setSince(false);
        setNotice({ ok: false, text: `Couldn't load changes since your last review: ${e.message}` });
      },
    );
  }, [since, lastReviewed, data]);

  // In "since" mode old-side line numbers refer to my last reviewed commit, so old-side threads would sit on the wrong lines.
  const shownThreads = since && sinceData ? threads.filter((t) => t.diffSide === 'RIGHT' || t.line == null) : threads;
  const byPath = useMemo(() => Map.groupBy(shownThreads, (t) => t.path), [shownThreads]);

  if (error) return <p class="error page">{error}</p>;
  if (!data) return <p class="note page">Loading pull request…</p>;
  const { pr, headRepo } = data;
  const files = since && sinceData ? sinceData.files : data.files;
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
    updateDraft: (id, d) => saveDrafts(drafts.map((x) => (x.id === id ? { ...d, id } : x))),
    removeDraft: (id) => saveDrafts(drafts.filter((d) => d.id !== id)),
    reply: async (t, body) => {
      await reply(repo, n, t.comments.nodes[0].databaseId, body);
      setThreads(await getThreads(repo, n));
    },
    resolve: async (t, resolve) => {
      await resolveThread(t.id, resolve);
      setThreads(await getThreads(repo, n));
    },
    renderAll,
    since: since && !!sinceData,
  };

  // Optimistic; GitHub's state is the source of truth, so a failure puts it back.
  function toggleViewed(path: string) {
    const on = !viewed.has(path);
    const flip = (v: boolean) => setViewedPaths((s) => { const x = new Set(s); v ? x.add(path) : x.delete(path); return x; });
    flip(on);
    setExpanded((s) => { const x = new Set(s); x.delete(path); return x; });
    setViewed(pr.node_id, path, on).catch((e) => {
      flip(!on);
      setNotice({ ok: false, text: `Couldn't update "Viewed" on GitHub: ${e.message}` });
    });
  }

  const visible = files.filter((f) => !f.generated);
  const generated = files.filter((f) => f.generated);
  const shown = showGenerated ? [...visible, ...generated] : visible;
  const section = (f: File) => (
    <FileSection
      key={f.filename}
      file={f}
      ctx={ctx}
      threads={byPath.get(f.filename) ?? []}
      drafts={drafts.filter((d) => d.path === f.filename)}
      viewed={viewed.has(f.filename)}
      collapsed={viewed.has(f.filename) && !expanded.has(f.filename)}
      onToggleViewed={() => toggleViewed(f.filename)}
      onExpand={() => setExpanded((s) => new Set(s).add(f.filename))}
    />
  );

  const layer = stack.findIndex((l) => l.number === n);
  const stackAt = (d: number) => (layer < 0 ? undefined : stack[layer + d]);

  // Keyboard shortcuts (see the ⌨ help). Reassigned every render so it sees current state.
  keys.current = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') return setRenderAll(true); // then the browser's find opens
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if ((e.target as Element).closest('textarea, input')) return; // forms handle their own ⌘↵
      e.preventDefault();
      return dispatchEvent(new Event('lgtm:finish'));
    }
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest('input, textarea, select, [contenteditable]')) return;
    const sections = [...document.querySelectorAll<HTMLElement>('main > .file')];
    const top = 44 + 60;
    const cur = sections.reduce((c, s, i) => (s.getBoundingClientRect().top <= top ? i : c), -1);
    const path = sections[Math.max(cur, 0)]?.id.slice(2);
    const ordered = threadOrder(shownThreads, drafts, shown);
    const act: Record<string, () => void> = {
      j: () => sections[Math.min(cur + 1, sections.length - 1)]?.scrollIntoView(),
      k: () => sections[Math.max(cur - 1, 0)]?.scrollIntoView(),
      n: () => ordered.length && go(Math.min(threadCursor.current + 1, ordered.length - 1)),
      p: () => ordered.length && go(Math.max(threadCursor.current - 1, 0)),
      v: () => path && toggleViewed(path),
      c: () => path && ctx.setTarget({ path, side: 'RIGHT' }),
      i: toggleIndex,
      '[': () => stackAt(-1) && (location.hash = `/${repo}/pull/${stackAt(-1)!.number}`),
      ']': () => stackAt(1) && (location.hash = `/${repo}/pull/${stackAt(1)!.number}`),
      '?': () => setHelp(!help),
      Escape: () => setHelp(false),
    };
    function go(i: number) {
      threadCursor.current = i;
      jumpTo(ordered[i].id, 'f-' + ordered[i].path);
    }
    const k = e.key === '/' && e.shiftKey ? '?' : e.key;
    if (act[k]) {
      e.preventDefault();
      act[k]();
    }
  };

  return (
    <div class={showIndex ? 'review' : 'review no-index'}>
      {showIndex && (
        <aside class="side tree">
          <div class="side-scroll">
            <ShortcutIndex
              repo={repo}
              pr={pr}
              conversation={conversation}
              threads={shownThreads}
              drafts={drafts}
              checks={checks}
              onRefreshChecks={loadChecks}
              files={shown}
              viewed={viewed}
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
          {layer >= 0 && (
            <span class="stack-nav" title="This PR's stack ([ and ] to move)">
              {stackAt(-1) ? <a href={`#/${repo}/pull/${stackAt(-1)!.number}`} title={`#${stackAt(-1)!.number} ${stackAt(-1)!.title}`}>‹</a> : <span class="off">‹</span>}
              <span>Layer {layer + 1}/{stack.length}</span>
              {stackAt(1) ? <a href={`#/${repo}/pull/${stackAt(1)!.number}`} title={`#${stackAt(1)!.number} ${stackAt(1)!.title}`}>›</a> : <span class="off">›</span>}
            </span>
          )}
          <button title="Keyboard shortcuts (?)" onClick={() => setHelp(!help)}>⌨</button>
          <SubmitPanel count={drafts.length} slackTo={slackTo} onSubmit={submit} />
        </div>
        {help && <Help onClose={() => setHelp(false)} />}
        <main>
          {notice && <p class={notice.ok ? 'notice' : 'warn'}>{notice.text}</p>}
          {lastReviewed && (
            <div class={since ? 'since on' : 'since'}>
              {since ? (
                <>
                  Showing changes since your last review (<code>{lastReviewed.slice(0, 7)}</code> → <code>{pr.head.sha.slice(0, 7)}</code>)
                  {sinceData ? ` · ${sinceData.files.length} file${sinceData.files.length === 1 ? '' : 's'}` : ' · loading…'}
                  {sinceData?.status === 'diverged' && <b> · rebased since then, so these files may also show changes from the base branch</b>}
                  <button onClick={() => setSince(false)}>Show all changes</button>
                </>
              ) : (
                <>
                  New commits since your last review. <button onClick={() => setSince(true)}>Show only those changes</button>
                </>
              )}
            </div>
          )}
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
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const show = () => {
      setOpen(true);
      setTimeout(() => area.current?.focus());
    };
    addEventListener('lgtm:finish', show);
    return () => removeEventListener('lgtm:finish', show);
  }, []);

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
          <textarea
            ref={area}
            rows={4}
            placeholder="Leave a comment (⌘↵ to submit)"
            value={body}
            onInput={(e) => setBody(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) go();
              if (e.key === 'Escape') setOpen(false);
            }}
          />
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

type SectionProps = {
  file: File;
  ctx: Ctx;
  threads: Thread[];
  drafts: Draft[];
  viewed: boolean;
  collapsed: boolean;
  onToggleViewed: () => void;
  onExpand: () => void;
};

function FileSection({ file, ctx, threads, drafts, viewed, collapsed, onToggleViewed, onExpand }: SectionProps) {
  const canRich = isMarkdown(file.filename) && file.status !== 'removed' && !!file.patch;
  const [rich, setRich] = useState(canRich);
  const [ref, near] = useNear<HTMLElement>();
  const hunks = useMemo(() => parsePatch(file.patch ?? ''), [file.patch]);
  const path = file.filename;
  const t = ctx.target;
  const body: BodyProps = { file, hunks, ctx, threads: threads.filter((x) => !isFileLevel(x)), drafts: drafts.filter((d) => d.line) };

  return (
    <section class={viewed ? 'file viewed' : 'file'} id={'f-' + path} ref={ref}>
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
        <label class="viewed-box" title="Mark as viewed on GitHub (v)">
          <input type="checkbox" checked={viewed} onChange={onToggleViewed} /> Viewed
        </label>
      </header>
      {collapsed ? (
        <button class="collapsed-row" onClick={onExpand}>
          Viewed. Show {file.additions + file.deletions} changed line{file.additions + file.deletions === 1 ? '' : 's'}
        </button>
      ) : (
        <>
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
      ) : !near && !ctx.renderAll ? (
        <div style={{ height: `${hunks.reduce((s, h) => s + h.lines.length + 1, 0) * 20}px` }} />
      ) : rich ? (
        <RichView {...body} />
      ) : (
        <DiffView {...body} />
      )}
        </>
      )}
    </section>
  );
}

function DiffView({ file, hunks, ctx, threads, drafts }: BodyProps) {
  const path = file.filename;
  const hl = useMemo(() => highlightHunks(hunks, path), [hunks]);
  // "Show more lines": unchanged stretches come from the head version of the file, fetched on first use.
  const gapList = useMemo(() => (file.status === 'added' || file.status === 'removed' ? [] : gaps(hunks)), [hunks]);
  const [head, setHead] = useState<string[] | null>(null);
  const [openGaps, setOpenGaps] = useState<Set<number>>(new Set());
  const [gapErr, setGapErr] = useState('');
  const expand = async (g: Gap) => {
    setGapErr('');
    try {
      if (!head) {
        const src = await getRaw(ctx.headRepo, path, ctx.pr.head.sha);
        if (src == null) throw new Error('file not found at the head commit');
        setHead(src.replace(/\n$/, '').split('\n'));
      }
      setOpenGaps((s) => new Set(s).add(g.before));
    } catch (e: any) {
      setGapErr(e.message);
    }
  };
  const gapRows = (g: Gap) => {
    if (!openGaps.has(g.before) || !head) {
      if (g.to === null && head && g.from > head.length) return null; // nothing after the last hunk
      const count = g.to === null ? null : g.to - g.from + 1;
      return (
        <tr class="gap">
          <td colSpan={3}>
            <button onClick={() => expand(g)}>
              {count === null ? '↓ Show the rest of the file' : `↕ Show ${count} unchanged line${count === 1 ? '' : 's'}`}
            </button>
            {gapErr && <span class="error"> {gapErr}</span>}
          </td>
        </tr>
      );
    }
    const lines = head.slice(g.from - 1, g.to ?? head.length);
    const lang = languageFor(path);
    const html = lang ? splitLines(highlightCode(lines.join('\n'), lang)) : null;
    return lines.map((text, i) => (
      <tr class="x">
        <td class="num">{g.from + i + g.offset}</td>
        <td class="num">{g.from + i}</td>
        {html ? <td class="code" dangerouslySetInnerHTML={{ __html: html[i] }} /> : <td class="code">{text}</td>}
      </tr>
    ));
  };
  const gapBefore = (i: number) => gapList.find((g) => g.before === i);
  const t = ctx.target?.path === path ? ctx.target : null;

  const pick = (e: MouseEvent, side: Side, line: number) => {
    if (side === 'LEFT' && ctx.since) return;
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
            {gapBefore(hi) && gapRows(gapBefore(hi)!)}
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
        {gapBefore(hunks.length) && gapRows(gapBefore(hunks.length)!)}
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
        {!ctx.since && <button
          class="removed-c"
          title="Comment on removed lines"
          onClick={() => ctx.setTarget({ path, side: 'LEFT', line: last, startLine: last > r.oldStart ? r.oldStart : undefined })}
        >
          +
        </button>}
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
      {drafts
        .filter((d) => d.id !== ctx.target?.editId)
        .map((d) => (
          <div class="draft" key={d.id} id={'d-' + d.id}>
            <div class="badge">Pending · {where(d)}</div>
            <div class="md" dangerouslySetInnerHTML={{ __html: md.render(d.body) }} />
            <div class="row">
              <button onClick={() => ctx.setTarget({ path: d.path, side: d.side, line: d.line, startLine: d.startLine, editId: d.id, body: d.body })}>Edit</button>
              <button onClick={() => ctx.removeDraft(d.id)}>Delete</button>
            </div>
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

  async function act(f: () => Promise<void>) {
    setBusy(true);
    setErr('');
    try {
      await f();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }
  const send = () => act(async () => {
    await ctx.reply(t, body);
    setBody('');
  });

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
      <div class="row">
        {body.trim() && (
          <button disabled={busy} onClick={send}>
            Reply
          </button>
        )}
        {(t.isResolved ? t.viewerCanUnresolve : t.viewerCanResolve) && (
          <button disabled={busy} onClick={() => act(() => ctx.resolve(t, !t.isResolved))}>
            {t.isResolved ? 'Unresolve' : 'Resolve conversation'}
          </button>
        )}
      </div>
      {err && <p class="error">{err}</p>}
    </details>
  );
}

function DraftForm({ ctx }: { ctx: Ctx }) {
  const target = ctx.target!;
  const [body, setBody] = useState(target.body ?? (target.quote != null ? `> ${target.quote}\n\n` : ''));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);

  function save() {
    if (!body.trim()) return;
    const { quote: _q, near: _n, editId, body: _b, ...rest } = target;
    if (editId) ctx.updateDraft(editId, { ...rest, body });
    else ctx.addDraft({ ...rest, body });
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
          {target.editId ? 'Update comment' : 'Add to review'}
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

const SHORTCUTS: [string, string][] = [
  ['j / k', 'Next / previous file'],
  ['n / p', 'Next / previous review thread'],
  ['v', 'Mark the current file viewed'],
  ['c', 'Comment on the current file'],
  ['[ / ]', 'Previous / next PR in the stack'],
  ['i', 'Show / hide the index'],
  ['⌘↵', 'Finish review (submit inside the panel)'],
  ['⌘F', 'Find, in every file'],
  ['?', 'This help'],
];

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div class="help" role="dialog" aria-label="Keyboard shortcuts">
      <div class="row">
        <b>Keyboard shortcuts</b>
        <span class="spacer" />
        <button onClick={onClose}>Close</button>
      </div>
      <table>
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
