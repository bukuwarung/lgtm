import { useMemo, useState } from 'preact/hooks';
import { fetchJobLog, useFoldBots, useStoredFlag } from './platform.ts';
import { codeWithoutTests, moduleName } from './files.ts';
import type { ComponentChildren } from 'preact';
import { awaitsMe, threadTiers, type Check, type ConversationItem, type Draft, type PR, type PRFile, type Thread } from './github.ts';

// noDiff: renamed/copied/mode-changed with no content change, so there's nothing to review.
export type File = PRFile & { generated: boolean; noDiff: boolean };

// Scroll to an element by id, opening any collapsed <details> around it and flashing it. `near` is scrolled to
// first when the target isn't in the DOM yet (file bodies render lazily), then we wait for it to appear.
export function jumpTo(id: string, near?: string) {
  if (near && !document.getElementById(id)) document.getElementById(near)?.scrollIntoView();
  let tries = 0;
  const go = () => {
    const el = document.getElementById(id);
    if (!el) {
      if (tries++ < 40) setTimeout(go, 50);
      return;
    }
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
    el.scrollIntoView({ block: 'center' });
    // Files above may finish rendering and push it down; settle once more.
    setTimeout(() => el.scrollIntoView({ block: 'center' }), 400);
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
  };
  go();
}

// Drafts first, then threads in diff order: the order the index lists them and n/p walks them.
export function threadOrder(threads: Thread[], drafts: Draft[], files: File[]) {
  const order = new Map(files.map((f, i) => [f.filename, i]));
  const sorted = [...threads].sort((a, b) => (order.get(a.path) ?? 1e9) - (order.get(b.path) ?? 1e9) || (a.line ?? 0) - (b.line ?? 0));
  type Item = { id: string; path: string; t?: Thread };
  return [...drafts.map((d): Item => ({ id: 'd-' + d.id, path: d.path })), ...sorted.map((t): Item => ({ id: 't-' + t.id, path: t.path, t }))];
}

const textOf = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 90);
const base = (path: string) => path.split('/').pop()!;

const VERDICT: Record<string, string> = { APPROVED: '✓ approved', CHANGES_REQUESTED: '✕ changes requested', COMMENTED: 'reviewed', DISMISSED: 'dismissed' };
const CHECK_ICON: Record<Check['state'], string> = { failure: '✕', pending: '●', success: '✓', neutral: '–' };

function Section({ title, count, extra, children }: { title: string; count: number; extra?: ComponentChildren; children: ComponentChildren }) {
  return (
    <details open class="ix-sec">
      <summary>
        {title} <span class="count">{count}</span>
        {extra}
      </summary>
      {children}
    </details>
  );
}

function Entry({ label, meta, sub, dim, onClick }: { label: string; meta?: string; sub?: string; dim?: boolean; onClick: () => void }) {
  return (
    <button class={dim ? 'ix-item dim' : 'ix-item'} onClick={onClick} title={sub || label}>
      <span class="ix-label">
        {label} {meta && <span class="ix-meta">{meta}</span>}
      </span>
      {sub && <span class="ix-sub">{sub}</span>}
    </button>
  );
}

function CheckEntry({ c, repo }: { c: Check; repo: string }) {
  const [log, setLog] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = () => {
    setOpen(!open);
    if (log === null) fetchJobLog(repo, c.jobId!).then(setLog, (e) => setLog(`Couldn't load the log: ${e.message}`));
  };
  return (
    <>
      <div class="ix-check">
        <a class="ix-item" href={c.url ?? undefined} target="_blank" rel="noopener" title={`${c.name}: ${c.summary}`}>
          <span class="ix-label">
            <span class={'ck ck-' + c.state}>{CHECK_ICON[c.state]}</span> {c.name}
          </span>
          {c.summary && <span class="ix-sub">{c.summary}</span>}
        </a>
        {c.state === 'failure' && c.jobId && (
          <button class="ix-log-btn" title="Show the end of the job log" onClick={toggle}>
            {open ? 'hide log' : 'log'}
          </button>
        )}
      </div>
      {open && <pre class="ix-log">{log ?? 'Loading…'}</pre>}
    </>
  );
}

type IndexProps = {
  repo: string;
  pr: PR;
  conversation: ConversationItem[];
  threads: Thread[];
  drafts: Draft[];
  checks: Check[] | null;
  onRefreshChecks: () => void;
  files: File[];
  viewed: Set<string>;
  counts: Counts;
  me: string;
  ask?: ComponentChildren; // on my own PR: who to ask for a review (review.tsx AskReviewer)
  modules?: Map<string, string>; // each file's Gradle module (files.ts gradleModules), when grouping by them
  onViewed: OnViewed;
};

// The PR Shortcut Index: jump to the description, any comment or review, CI checks, review threads, or a file.
export function ShortcutIndex({ repo, pr, conversation, threads, drafts, checks, onRefreshChecks, files, viewed, counts, me, ask, modules, onViewed }: IndexProps) {
  const foldBots = useFoldBots(!!me && pr.user.login === me);
  const excerpts = useMemo(() => conversation.map((c) => oneLine(textOf(c.html))), [conversation]);
  const sortedThreads = threadOrder(threads, [], files).map((x) => x.t!);
  const viewedCount = files.filter((f) => viewed.has(f.filename)).length;
  const failing = checks?.filter((c) => c.state === 'failure').length ?? 0;
  const bots = conversation.filter((c) => c.bot);
  const convEntry = (c: ConversationItem, i: number) => (
    <Entry key={c.id} label={c.author} meta={c.state ? VERDICT[c.state] : 'commented'} sub={excerpts[i]} onClick={() => jumpTo('cv-' + c.id)} />
  );
  const tiers = threadTiers(sortedThreads, me);
  const threadEntry = (t: Thread) => {
    const first = t.comments.nodes[0];
    const waiting = !!me && awaitsMe(t, me, pr.user.login === me);
    return (
      <Entry
        key={t.id}
        label={`${waiting ? '💬 ' : ''}${base(t.path)}${t.line ? ':' + t.line : ''}`}
        meta={[first?.author?.login, waiting && 'awaiting your reply', t.isResolved && 'resolved', t.isOutdated && 'outdated'].filter(Boolean).join(' · ')}
        sub={oneLine(first?.bodyText ?? '')}
        dim={t.isResolved || t.isOutdated}
        onClick={() => jumpTo('t-' + t.id, 'f-' + t.path)}
      />
    );
  };
  const pending = checks?.filter((c) => c.state === 'pending').length ?? 0;
  // Who's reviewing: each person's latest verdict, "waiting" for ones asked who haven't answered (again).
  const reviewers = new Map<string, { meta: string; tone: string; id?: string }>();
  for (const c of conversation) if (c.state && !c.bot && c.author !== pr.user.login) reviewers.set(c.author, { meta: VERDICT[c.state], tone: c.state, id: c.id });
  for (const r of pr.requested_reviewers ?? [])
    if (r.type !== 'Bot') reviewers.set(r.login, { meta: reviewers.has(r.login) ? 'asked again' : 'waiting', tone: 'WAITING', id: reviewers.get(r.login)?.id });
  for (const t of pr.requested_teams ?? []) reviewers.set(`team ${t.slug}`, { meta: 'waiting', tone: 'WAITING' });

  return (
    <div class="index">
      <Section title="Conversation" count={conversation.length + 1}>
        <Entry label="Description" meta={pr.user.login} onClick={() => jumpTo('pr-description')} />
        {conversation.map((c, i) => !c.bot && convEntry(c, i))}
        {bots.length > 0 && (
          <details class="ix-ckgroup" open={!foldBots}>
            <summary>🤖 {bots.length} from bots</summary>
            {conversation.map((c, i) => c.bot && convEntry(c, i))}
          </details>
        )}
      </Section>

      <Section title="Reviewers" count={reviewers.size}>
        {[...reviewers].map(([who, r]) => (
          <button class={r.id ? 'ix-item ix-person' : 'ix-item ix-person dim-click'} onClick={() => r.id && jumpTo('cv-' + r.id)} title={r.id ? `Go to @${who}'s review` : `@${who}: ${r.meta}`}>
            <span class="ix-label">
              {!who.startsWith('team ') && <img src={`https://github.com/${encodeURIComponent(who)}.png?size=40`} alt="" />}
              {who.startsWith('team ') ? who : '@' + who} <span class={`ix-meta v-${r.tone}`}>{r.meta}</span>
            </span>
          </button>
        ))}
        {ask &&
          (reviewers.size ? (
            <details class="ix-ckgroup">
              <summary>+ Ask someone else</summary>
              {ask}
            </details>
          ) : (
            <>
              <p class="note ix-pad">Nobody's been asked yet. Least busy first:</p>
              {ask}
            </>
          ))}
        {!ask && !reviewers.size && <p class="note ix-pad">Nobody yet.</p>}
      </Section>

      <Section
        title="Checks"
        count={checks?.length ?? 0}
        extra={
          <>
            {failing > 0 && <span class="ck-sum ck-failure">{failing} failing</span>}
            {pending > 0 && <span class="ck-sum ck-pending">{pending} running</span>}
            <span
              class="ix-refresh"
              role="button"
              tabIndex={0}
              title="Refresh checks"
              onClick={(e) => {
                e.preventDefault();
                onRefreshChecks();
              }}
            >
              ↻
            </span>
          </>
        }
      >
        {!checks ? (
          <p class="note ix-pad">Loading…</p>
        ) : !checks.length ? (
          <p class="note ix-pad">No checks.</p>
        ) : (
          <>
            {checks.filter((c) => c.state === 'failure' || c.state === 'pending').map((c) => <CheckEntry key={c.name} c={c} repo={repo} />)}
            {([['success', 'passed'], ['neutral', 'skipped or cancelled']] as const).map(([state, label]) => {
              const group = checks.filter((c) => c.state === state);
              return group.length > 0 && (
                <details class="ix-ckgroup">
                  <summary><span class={'ck ck-' + state}>{CHECK_ICON[state]}</span> {group.length} {label}</summary>
                  {group.map((c) => <CheckEntry key={c.name} c={c} repo={repo} />)}
                </details>
              );
            })}
          </>
        )}
      </Section>

      <Section title="Review threads" count={threads.length + drafts.length}>
        {drafts.map((d) => (
          <Entry
            key={d.id}
            label={`${base(d.path)}${d.line ? ':' + d.line : ''}`}
            meta="pending"
            sub={oneLine(d.body)}
            onClick={() => jumpTo('d-' + d.id, 'f-' + d.path)}
          />
        ))}
        {[...tiers.mine, ...tiers.human].map(threadEntry)}
        {tiers.bot.length > 0 && (
          <details class="ix-ckgroup" open>
            <summary>🤖 {tiers.bot.length} from bots</summary>
            {tiers.bot.map(threadEntry)}
          </details>
        )}
        {tiers.resolved.length > 0 && (
          <details class="ix-ckgroup">
            <summary>✓ {tiers.resolved.length} resolved</summary>
            {tiers.resolved.map(threadEntry)}
          </details>
        )}
        {!threads.length && !drafts.length && <p class="note ix-pad">No review threads.</p>}
      </Section>

      <Section title="Files" count={files.length} extra={<span class="ck-sum">{viewedCount}/{files.length} viewed</span>}>
        {modules?.size ? (
          <ModuleTrees files={files} modules={modules} counts={counts} viewed={viewed} onViewed={onViewed} />
        ) : (
          <FileTree files={files} counts={counts} viewed={viewed} onViewed={onViewed} />
        )}
      </Section>
    </div>
  );
}

// The files by Gradle module: a group per module (its folder; the root project; then files in none), each with its own
// tree below the module's folder.
function ModuleTrees({ files, modules, counts, viewed, onViewed }: { files: File[]; modules: Map<string, string>; counts: Counts; viewed: Set<string>; onViewed: OnViewed }) {
  const [flagTests] = useStoredFlag('flagUntested', true); // as the files' own "no test change" (Settings → Diff)
  const groups = useMemo(() => {
    const g = new Map<string, File[]>();
    for (const f of files) {
      const m = modules.get(f.filename) ?? '';
      g.set(m, [...(g.get(m) ?? []), f]);
    }
    return [...g].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : byName(a, b)));
  }, [files, modules]);
  return (
    <>
      {groups.map(([m, fs]) => (
        <details open class="tree-dir mod-group" key={m}>
          <summary title={m === '.' ? 'The root project' : m ? `Module ${moduleName(m)}, in ${m}/` : 'Not in a module'}>
            {m === '' ? 'Other files' : <><ModuleIcon /> {m === '.' ? ': (root)' : moduleName(m)}</>} <span class="count">{fs.length}</span>
            {flagTests && m !== '' && codeWithoutTests(fs) && (
              <span class="badge no-test" title="This module's code changes, but none of its tests">no test changes</span>
            )}
            <ViewedMark paths={fs.map((f) => f.filename)} viewed={viewed} onViewed={onViewed} what={m === '' ? 'these files' : 'this module'} />
          </summary>
          <FileTree files={fs} counts={counts} viewed={viewed} onViewed={onViewed} base={m === '' ? undefined : m === '.' ? '' : m} />
        </details>
      ))}
    </>
  );
}

// A Gradle module's mark: GitHub's "package" icon (Octicons, MIT), in the text's colour.
export function ModuleIcon() {
  return (
    <svg class="mod-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path fill="currentColor" d="M8.878.392a1.75 1.75 0 0 0-1.756 0l-5.25 3.045A1.75 1.75 0 0 0 1 4.951v6.098c0 .624 .332 1.2 .872 1.514l5.25 3.045a1.75 1.75 0 0 0 1.756 0l5.25-3.045c.54-.313 .872-.89 .872-1.514V4.951c0-.624-.332-1.2-.872-1.514L8.878.392ZM7.875 1.69a.25.25 0 0 1 .25 0l4.63 2.685L8 7.133 3.245 4.375l4.63-2.685ZM2.5 5.677v5.372c0 .09 .047 .171 .125 .216l4.625 2.683V8.432Zm6.25 8.271 4.625-2.683a.25.25 0 0 0 .125-.216V5.677L8.75 8.432Z" />
    </svg>
  );
}

type TreeNode = { name: string; dirs: Map<string, TreeNode>; files: File[] };

// `base`: a module's folder, left out of the tree along with its src/ (so its source sets, main, test…, come first).
export const below = (path: string, base: string) => {
  const rel = base ? path.slice(base.length + 1) : path;
  return rel.startsWith('src/') ? rel.slice(4) : rel;
};
function buildTree(files: File[], base?: string): TreeNode {
  const root: TreeNode = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    let node = root;
    for (const part of (base == null ? f.filename : below(f.filename, base)).split('/').slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      node = node.dirs.get(part)!;
    }
    node.files.push(f);
  }
  return root;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

type Counts = (path: string) => number;

export function FileTree({ files, counts, viewed, onViewed, base }: { files: File[]; counts: Counts; viewed: Set<string>; onViewed: OnViewed; base?: string }) {
  const root = useMemo(() => buildTree(files, base), [files, base]);
  return <TreeChildren node={root} depth={0} counts={counts} viewed={viewed} onViewed={onViewed} />;
}

type OnViewed = (paths: string[], on: boolean) => void;
type TreeProps = { node: TreeNode; depth: number; counts: Counts; viewed: Set<string>; onViewed: OnViewed };

// Viewed, as on GitHub, for a file or everything below a folder or module: ✓ all, – some; a click marks them all (or,
// when all are, unmarks them).
function ViewedMark({ paths, viewed, onViewed, what }: { paths: string[]; viewed: Set<string>; onViewed: OnViewed; what: string }) {
  const n = paths.filter((p) => viewed.has(p)).length;
  const all = n === paths.length;
  const click = (e: Event) => {
    e.preventDefault();
    e.stopPropagation(); // not the row's own click (open the file, fold the folder)
    onViewed(paths, !all);
  };
  return (
    <span
      class={`vmark${all ? ' on' : n ? ' some' : ''}`}
      role="checkbox"
      aria-checked={all ? true : n ? 'mixed' : false}
      tabIndex={0}
      title={all ? `Viewed: click to unmark ${what}` : `Mark ${what} as viewed${n ? ` (${n} of ${paths.length} are)` : ''}`}
      onClick={click}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && click(e)}
    >
      {all ? '✓' : n ? '–' : ''}
    </span>
  );
}
const allFiles = (n: TreeNode): string[] => [...n.files.map((f) => f.filename), ...[...n.dirs.values()].flatMap(allFiles)];

function TreeChildren({ node, depth, counts, viewed, onViewed }: TreeProps) {
  return (
    <>
      {[...node.dirs.values()].sort((a, b) => byName(a.name, b.name)).map((d) => (
        <TreeDir key={d.name} node={d} depth={depth} counts={counts} viewed={viewed} onViewed={onViewed} />
      ))}
      {[...node.files].sort((a, b) => byName(a.filename, b.filename)).map((f) => {
        const c = counts(f.filename);
        return (
          <div key={f.filename} class={viewed.has(f.filename) ? 'tree-row dim' : 'tree-row'}>
            <button
              class="tree-file"
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              title={f.filename}
              onClick={() => document.getElementById('f-' + f.filename)?.scrollIntoView()}
            >
              <span class={'fdot s-' + f.status} title={f.status} />
              <span class="tree-name">{f.filename.split('/').pop()}</span>
              {c > 0 && <span class="badge">💬{c}</span>}
            </button>
            <ViewedMark paths={[f.filename]} viewed={viewed} onViewed={onViewed} what="this file" />
          </div>
        );
      })}
    </>
  );
}

function TreeDir({ node, depth, counts, viewed, onViewed }: TreeProps) {
  // Collapse single-child folder chains into one row ("src/core/utils"), as GitHub does.
  let n = node, name = node.name;
  while (!n.files.length && n.dirs.size === 1) {
    n = [...n.dirs.values()][0];
    name += '/' + n.name;
  }
  return (
    <details open class="tree-dir">
      <summary style={{ paddingLeft: `${8 + depth * 14}px` }} title={name}>
        <span class="tree-dir-name">{name}</span>
        <ViewedMark paths={allFiles(n)} viewed={viewed} onViewed={onViewed} what="this folder" />
      </summary>
      <TreeChildren node={n} depth={depth + 1} counts={counts} viewed={viewed} onViewed={onViewed} />
    </details>
  );
}

