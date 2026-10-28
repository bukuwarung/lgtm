import { useEffect, useMemo, useState } from 'preact/hooks';
import { fetchJobLog, useFoldBots, useStoredFlag } from './platform.ts';
import { codeWithoutTests, inTests, moduleName } from './files.ts';
import { Octicon, Tg } from './tags.tsx';
import type { ComponentChildren } from 'preact';
import { awaitsMe, rerunFailedJobs, rerunJob, runOf, threadTiers, type Check, type ConversationItem, type Draft, type PR, type PRFile, type Thread } from './github.ts';

// noDiff: renamed/copied/mode-changed with no content change, so there's nothing to review.
export type File = PRFile & { generated: boolean; noDiff: boolean };

// Scroll to an element by id, opening any collapsed <details> around it and flashing it. `near` is scrolled to
// first when the target isn't in the DOM yet (file bodies render lazily), then we wait for it to appear.
// The PR list's "no reviewers" pill: open the PR at its index's Reviewers (once the index is there).
let wantReviewers = false;
export function showReviewers(route: string) {
  wantReviewers = true;
  if (location.hash === '#' + route && document.getElementById('ix-reviewers')) return reviewersShown();
  location.hash = route;
}
export function reviewersShown() {
  if (!wantReviewers) return false;
  wantReviewers = false;
  dispatchEvent(new Event('lgtm:show-index')); // if it's hidden
  jumpTo('ix-reviewers');
  return true;
}

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

function Section({ id, title, count, extra, children }: { id?: string; title: string; count: number; extra?: ComponentChildren; children: ComponentChildren }) {
  return (
    <details open class="ix-sec" id={id}>
      <summary>
        {title} <span class="count">{count}</span>
        {extra}
      </summary>
      {children}
    </details>
  );
}

function Entry({ label, meta, sub, dim, onClick }: { label: ComponentChildren; meta?: string; sub?: string; dim?: boolean; onClick: () => void }) {
  return (
    <button class={dim ? 'ix-item dim' : 'ix-item'} onClick={onClick} title={sub || (typeof label === 'string' ? label : undefined)}>
      <span class="ix-label">
        {label} {meta && <span class="ix-meta">{meta}</span>}
      </span>
      {sub && <span class="ix-sub">{sub}</span>}
    </button>
  );
}

// Small line icons for the checks' buttons, drawn in the text's colour.
const Icon = Octicon; // the index's small buttons and marks

// A test file: a flask (with "test" in the diff's file header).
export const TestMark = ({ label }: { label?: boolean }) => (
  <span class="test-mark" role="img" title="A test (in a test folder, or named as one)" aria-label="Test">
    {label ? <Tg i="test" t="test" /> : <Icon name="beaker" />}
  </span>
);

// Code changed without its tests: an amber struck-out flask, explained on hover.
export const NoTestMark = ({ title, label }: { title: string; label?: string }) => (
  <span class="badge no-test" role="img" title={title} aria-label="No test changes">
    {label ? <Tg i="notest" t={label} /> : <Icon name="beaker" slash />}
  </span>
);

// Ask a reviewer on Slack (your "Asking someone to review" message, Settings → Slack messages): a speech bubble
// beside them, ✓ once sent, red if it wasn't.
function SlackAsk({ login, ask }: { login: string; ask: (login: string) => Promise<boolean> }) {
  const [state, setState] = useState<'' | 'asking' | 'sent' | 'failed'>('');
  return (
    <button
      class={`ix-icon-btn${state === 'asking' ? ' busy' : state === 'sent' ? ' done' : state === 'failed' ? ' failed' : ''}`}
      title={state === 'sent' ? `Asked @${login} on Slack` : state === 'failed' ? "Couldn't reach them on Slack: click to try again" : `Ask @${login} for a review on Slack`}
      aria-label={`Ask @${login} on Slack`}
      disabled={state === 'asking' || state === 'sent'}
      onClick={() => (setState('asking'), ask(login).then((ok) => setState(ok ? 'sent' : 'failed')))}
    >
      <Icon name={state === 'sent' ? 'check' : 'comment'} />
    </button>
  );
}

// Ask a reviewer who's reviewed to look again (after you've pushed fixes): a re-request on GitHub, and on Slack your
// "look again" message in your thread with them. ✓ once asked.
function ReRequest({ login, again }: { login: string; again: (login: string) => Promise<boolean> }) {
  const [state, setState] = useState<'' | 'asking' | 'done' | 'failed'>('');
  return (
    <button
      class={`ix-icon-btn${state === 'asking' ? ' busy' : state === 'done' ? ' done' : state === 'failed' ? ' failed' : ''}`}
      title={state === 'done' ? `Asked @${login} to look again` : state === 'failed' ? "Couldn't ask: click to try again" : `Ask @${login} to review again`}
      aria-label={`Ask @${login} to review again`}
      disabled={state === 'asking' || state === 'done'}
      onClick={() => (setState('asking'), again(login).then((ok) => setState(ok ? 'done' : 'failed')))}
    >
      <Icon name={state === 'done' ? 'check' : 'sync'} />
    </button>
  );
}

// Every failed GitHub Actions job run again, a run at a time (Jenkins and other CI aren't GitHub's to rerun).
function RerunFailed({ repo, checks, onRefresh }: { repo: string; checks: Check[]; onRefresh: () => void }) {
  const [state, setState] = useState<'' | 'asking' | 'queued' | string>('');
  const runs = [...new Set(checks.map(runOf))] as string[];
  const go = (e: Event) => {
    e.preventDefault(); // not the section's own click (fold it)
    e.stopPropagation();
    setState('asking');
    Promise.all(runs.map((r) => rerunFailedJobs(repo, r))).then(
      () => (setState('queued'), setTimeout(onRefresh, 3000)),
      (err) => setState(`couldn't: ${err.message}`),
    );
  };
  return (
    <button
      class={`ix-icon-btn ix-rerun${state === 'asking' ? ' busy' : state === 'queued' ? ' done' : state ? ' failed' : ''}`}
      disabled={state === 'asking' || state === 'queued'}
      title={state === 'queued' ? 'Queued to run again' : state.startsWith('couldn') ? `${state}; click to try again` : `Run the ${checks.length} failed GitHub Actions job${checks.length > 1 ? 's' : ''} again`}
      aria-label="Run the failed jobs again"
      onClick={go}
    >
      <Icon name={state === 'queued' ? 'check' : 'sync'} />
    </button>
  );
}

function CheckEntry({ c, repo, onRefresh }: { c: Check; repo: string; onRefresh: () => void }) {
  const [log, setLog] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [rerun, setRerun] = useState<'' | 'asking' | 'queued' | string>('');
  // Run this job again (GitHub Actions only); the checks reload once it's queued.
  const again = () => {
    setRerun('asking');
    rerunJob(repo, c.jobId!).then(
      () => (setRerun('queued'), setTimeout(onRefresh, 3000)),
      (e) => setRerun(`couldn't: ${e.message}`),
    );
  };
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
          <>
            <button
              class={`ix-icon-btn${rerun === 'asking' ? ' busy' : rerun === 'queued' ? ' done' : rerun ? ' failed' : ''}`}
              title={rerun === 'queued' ? 'Queued to run again' : rerun.startsWith('couldn') ? `${rerun}; click to try again` : 'Run this job again (and the jobs that wait on it)'}
              aria-label="Run this job again"
              disabled={rerun === 'asking' || rerun === 'queued'}
              onClick={again}
            >
              <Icon name={rerun === 'queued' ? 'check' : 'sync'} />
            </button>
            <button class={open ? 'ix-icon-btn on' : 'ix-icon-btn'} title={open ? 'Hide the job log' : 'Show the end of the job log'} aria-label="Job log" aria-pressed={open} onClick={toggle}>
              <Icon name="list-unordered" />
            </button>
          </>
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
  // On my own PR, with Slack: ask a reviewer there (one I have no Slack thread with about it yet); false if it failed.
  slackAsk?: (login: string) => Promise<boolean>;
  slackWith?: Set<string>; // reviewers I already have a Slack thread with about this PR
  reRequest?: (login: string) => Promise<boolean>; // on my own PR: ask a reviewer who's reviewed to look again
  onViewed: OnViewed;
};

// The PR Shortcut Index: jump to the description, any comment or review, CI checks, review threads, or a file.
export function ShortcutIndex({ repo, pr, conversation, threads, drafts, checks, onRefreshChecks, files, viewed, counts, me, ask, modules, onViewed, slackAsk, slackWith, reRequest }: IndexProps) {
  const foldBots = useFoldBots(!!me && pr.user.login === me);
  const excerpts = useMemo(() => conversation.map((c) => oneLine(textOf(c.html))), [conversation]);
  const sortedThreads = threadOrder(threads, [], files).map((x) => x.t!);
  const viewedCount = files.filter((f) => viewed.has(f.filename)).length;
  const failing = checks?.filter((c) => c.state === 'failure').length ?? 0;
  const rerunnable = checks?.filter((c) => c.state === 'failure' && c.jobId && runOf(c)) ?? [];
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
        label={<>{waiting && <Octicon name="comment" />} {`${base(t.path)}${t.line ? ':' + t.line : ''}`}</>}
        meta={[first?.author?.login, waiting && 'awaiting your reply', t.isResolved && 'resolved', t.isOutdated && 'outdated'].filter(Boolean).join(' · ')}
        sub={oneLine(first?.bodyText ?? '')}
        dim={t.isResolved || t.isOutdated}
        onClick={() => jumpTo('t-' + t.id, 'f-' + t.path)}
      />
    );
  };
  useEffect(() => void reviewersShown(), []);
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
            <summary><Octicon name="dependabot" /> {bots.length} from bots</summary>
            {conversation.map((c, i) => c.bot && convEntry(c, i))}
          </details>
        )}
      </Section>

      <Section id="ix-reviewers" title="Reviewers" count={reviewers.size}>
        {[...reviewers].map(([who, r]) => (
          <div class="ix-check">
            <button class={r.id ? 'ix-item ix-person' : 'ix-item ix-person dim-click'} onClick={() => r.id && jumpTo('cv-' + r.id)} title={r.id ? `Go to @${who}'s review` : `@${who}: ${r.meta}`}>
              <span class="ix-label">
                {!who.startsWith('team ') && <img src={`https://github.com/${encodeURIComponent(who)}.png?size=40`} alt="" />}
                {who.startsWith('team ') ? who : '@' + who} <span class={`ix-meta v-${r.tone}`}>{r.meta}</span>
              </span>
            </button>
            {reRequest && r.id && r.tone !== 'WAITING' && <ReRequest login={who} again={reRequest} />}
            {slackAsk && !who.startsWith('team ') && !slackWith?.has(who) && <SlackAsk login={who} ask={slackAsk} />}
          </div>
        ))}
        {ask &&
          (reviewers.size ? (
            <details class="ix-ckgroup">
              <summary>+ Ask someone else</summary>
              {ask}
            </details>
          ) : (
            <>
              <p class="note ix-pad">Nobody's been asked yet{pr.draft ? ' (asking someone marks it ready for review)' : ''}. Least busy first:</p>
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
            {rerunnable.length > 0 && <RerunFailed repo={repo} checks={rerunnable} onRefresh={onRefreshChecks} />}
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
              <Octicon name="sync" />
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
            {checks.filter((c) => c.state === 'failure' || c.state === 'pending').map((c) => <CheckEntry key={c.name} c={c} repo={repo} onRefresh={onRefreshChecks} />)}
            {([['success', 'passed'], ['neutral', 'skipped or cancelled']] as const).map(([state, label]) => {
              const group = checks.filter((c) => c.state === state);
              return group.length > 0 && (
                <details class="ix-ckgroup">
                  <summary><span class={'ck ck-' + state}>{CHECK_ICON[state]}</span> {group.length} {label}</summary>
                  {group.map((c) => <CheckEntry key={c.name} c={c} repo={repo} onRefresh={onRefreshChecks} />)}
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
            <summary><Octicon name="dependabot" /> {tiers.bot.length} from bots</summary>
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
            <span class="tree-dir-name">{m === '' ? 'Other files' : <><ModuleIcon /> {m === '.' ? ': (root)' : moduleName(m)}</>}</span> <span class="count">{fs.length}</span>
            {flagTests && m !== '' && codeWithoutTests(fs) && (
              <NoTestMark title="No test changes: this module's code changes, but none of its tests" />
            )}
            <ViewedMark paths={fs.map((f) => f.filename)} viewed={viewed} onViewed={onViewed} what={m === '' ? 'these files' : 'this module'} />
          </summary>
          <FileTree files={fs} counts={counts} viewed={viewed} onViewed={onViewed} base={m === '' ? undefined : m === '.' ? '' : m} />
        </details>
      ))}
    </>
  );
}

// A Gradle module's mark: GitHub's "package" Octicon.
export const ModuleIcon = () => <Octicon name="package" class="mod-icon" />;

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
              {inTests(f.filename) && <TestMark />}
              {c > 0 && <span class="badge"><Octicon name="comment" /> {c}</span>}
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

