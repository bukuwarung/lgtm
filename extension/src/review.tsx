import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addedLines, anchor, parsePatch, removedRuns, type Hunk, type Removed } from './diff.ts';
import { isGenerated, parseGeneratedRules } from './gitattributes.ts';
import {
  getConversation, getFiles, getPR, getRaw, getThreads, reply, submitReview,
  type ConversationItem, type Draft, type PR, type PRFile, type ReviewEvent, type Thread,
} from './github.ts';
import { highlightHunks } from './highlight.ts';
import { isMarkdown, md, renderChunks } from './markdown.ts';
import { storage } from './platform.ts';

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
type File = PRFile & { generated: boolean };
type Saved = { sha: string; drafts: Draft[] };

const isFileLevel = (t: Thread) => t.subjectType === 'FILE' || t.line == null;

export function Review({ repo, n, onSubmitted }: { repo: string; n: number; onSubmitted: () => void }) {
  const [data, setData] = useState<{ pr: PR; headRepo: string; files: File[] } | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [saved, setSaved] = useState<Saved>({ sha: '', drafts: [] });
  const [target, setTarget] = useState<Target | null>(null);
  const [showGenerated, setShowGenerated] = useState(false);
  const [error, setError] = useState('');
  const key = `drafts:${repo}#${n}`;

  useEffect(() => {
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

  async function submit(event: ReviewEvent, body: string) {
    const head = (await getPR(repo, n)).head.sha;
    const sha = drafts.length ? saved.sha : head;
    if (sha !== head && !confirm('New commits were pushed after you started this review. Submit your comments against the older commit?')) return false;
    await submitReview(pr.node_id, sha, event, body, drafts);
    saveDrafts([]);
    onSubmitted();
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
    <div class="review">
      <aside class="tree">
        <FileTree files={shown} counts={(path) => (byPath.get(path)?.length ?? 0) + drafts.filter((d) => d.path === path).length} />
      </aside>
      <div>
        <div class="bar">
          <h1>
            {pr.title} <a href={pr.html_url} target="_blank" rel="noopener">{repo}#{n}</a>
          </h1>
          <SubmitPanel count={drafts.length} onSubmit={submit} />
        </div>
        <main>
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

function SubmitPanel({ count, onSubmit }: { count: number; onSubmit: (e: ReviewEvent, body: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const labels: Record<ReviewEvent, string> = { COMMENT: 'Comment', APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes' };

  async function go() {
    setBusy(true);
    setErr('');
    try {
      if (await onSubmit(event, body)) {
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
        <div class="draft" key={d.id}>
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
    <details class="thread" open={!t.isResolved && !t.isOutdated}>
      <summary>
        <b>{first?.author?.login ?? 'ghost'}</b> {first?.body.split('\n')[0].replace(/[*_`#>]/g, '').slice(0, 80)}
        {t.isResolved && <span class="badge"> · resolved</span>}
        {t.isOutdated && <span class="badge"> · outdated</span>}
      </summary>
      {t.comments.nodes.map((c) => (
        <div class="comment" key={c.databaseId}>
          <b>{c.author?.login ?? 'ghost'}</b> <time>{new Date(c.createdAt).toLocaleString()}</time>
          <div class="md" dangerouslySetInnerHTML={{ __html: md.render(c.body) }} />
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

type TreeNode = { name: string; dirs: Map<string, TreeNode>; files: File[] };

function buildTree(files: File[]): TreeNode {
  const root: TreeNode = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    let node = root;
    for (const part of f.filename.split('/').slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      node = node.dirs.get(part)!;
    }
    node.files.push(f);
  }
  return root;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

type Counts = (path: string) => number;

function FileTree({ files, counts }: { files: File[]; counts: Counts }) {
  const root = useMemo(() => buildTree(files), [files]);
  return <TreeChildren node={root} depth={0} counts={counts} />;
}

function TreeChildren({ node, depth, counts }: { node: TreeNode; depth: number; counts: Counts }) {
  return (
    <>
      {[...node.dirs.values()].sort((a, b) => byName(a.name, b.name)).map((d) => (
        <TreeDir key={d.name} node={d} depth={depth} counts={counts} />
      ))}
      {[...node.files].sort((a, b) => byName(a.filename, b.filename)).map((f) => {
        const c = counts(f.filename);
        return (
          <button
            key={f.filename}
            class="tree-file"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            title={f.filename}
            onClick={() => document.getElementById('f-' + f.filename)?.scrollIntoView()}
          >
            <span class={'fdot s-' + f.status} title={f.status} />
            <span class="tree-name">{f.filename.split('/').pop()}</span>
            {c > 0 && <span class="badge">💬{c}</span>}
          </button>
        );
      })}
    </>
  );
}

function TreeDir({ node, depth, counts }: { node: TreeNode; depth: number; counts: Counts }) {
  // Collapse single-child folder chains into one row ("src/core/utils"), as GitHub does.
  let n = node, name = node.name;
  while (!n.files.length && n.dirs.size === 1) {
    n = [...n.dirs.values()][0];
    name += '/' + n.name;
  }
  return (
    <details open class="tree-dir">
      <summary style={{ paddingLeft: `${8 + depth * 14}px` }} title={name}>{name}</summary>
      <TreeChildren node={n} depth={depth + 1} counts={counts} />
    </details>
  );
}

const STATE_LABEL: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'reviewed', DISMISSED: 'review dismissed' };

function Conversation({ pr, items }: { pr: PR; items: ConversationItem[] }) {
  return (
    <details class="conversation" open>
      <summary>
        Conversation <span class="badge">· {items.length} comment{items.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="comment">
        <b>{pr.user.login}</b> <span class="badge">opened this pull request</span>
        {pr.body ? <div class="md" dangerouslySetInnerHTML={{ __html: md.render(pr.body) }} /> : <p class="note">No description.</p>}
      </div>
      {items.map((c) => (
        <div class="comment" key={c.id}>
          <b>{c.author}</b> {c.state && <span class={'rstate r-' + c.state}>{STATE_LABEL[c.state] ?? c.state}</span>}{' '}
          <a href={c.url} target="_blank" rel="noopener"><time>{new Date(c.at).toLocaleString()}</time></a>
          {c.body && <div class="md" dangerouslySetInnerHTML={{ __html: md.render(c.body) }} />}
        </div>
      ))}
    </details>
  );
}
