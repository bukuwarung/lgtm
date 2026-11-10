import { useEffect, useMemo, useState } from 'preact/hooks';
import { notifyAgentDone, reportError, useFoldBots, usePresence, useStoredFlag, faceOf, pageTerm } from './platform.ts';
import { isAway, statusText } from './slackmsg.ts';
import { codeWithoutTests, inTests, moduleLabel, moduleName, stepIcon, type PlanStep, fileLabel } from './files.ts';
import { AgentMark, CheckMark, Octicon, Tg, Who, Lines, Retry, Fold } from './tags.tsx';
import { AGENTS, runAgent, useAgents, type AgentId } from './agents.ts';
import { ciPrompt } from './claude.ts';
import { fileIcon, folderIcon, iconOf } from './fileicons.ts';
import type { ComponentChildren } from 'preact';
import { awaitsMe, earlierVerdicts, jobLog, renderGfm, playJob, rerunFailedJobs, rerunJob, runOf, threadTiers, type Check, type ConversationItem, type Draft, type PR, type PRFile, type Thread } from './github.ts';

// noDiff: renamed/copied/mode-changed with no content change, or an empty file added or deleted: nothing to review.
export type File = PRFile & { generated: boolean; noDiff: boolean; untested?: boolean; lfs?: boolean }; // lfs: .gitattributes puts it in Git LFS

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

// Each jump is a step in the history (the title bar's back and forward, ⌘[ ⌘]): this entry keeps where you were, and a
// new one (same address) where you land. main.tsx scrolls back to it on the way back.
export function noteJump() {
  const from = [...document.querySelectorAll('main > section.file')].find((s) => s.getBoundingClientRect().bottom > 120)?.id.slice(2).split('/').pop();
  history.replaceState({ ...history.state, y: scrollY }, '');
  history.pushState({ y: null, from: from ?? 'the top' }, '');
  dispatchEvent(new CustomEvent('lgtm:jumped', { detail: from ?? 'the top' }));
}

// noted: the caller already made it a history step (it scrolled on the way).
export function jumpTo(id: string, near?: string, noted = false) {
  if (!noted) noteJump();
  if (near && !document.getElementById(id)) document.getElementById(near)?.scrollIntoView();
  let tries = 0;
  const go = () => {
    const el = document.getElementById(id);
    if (!el) {
      if (tries++ < 40) setTimeout(go, 50);
      return;
    }
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
    // Centred, unless it's taller than about the window (a whole file): then its top, below the bars (scroll-margin).
    const block = el.offsetHeight > innerHeight * 0.7 ? 'start' : 'center';
    el.scrollIntoView({ block });
    // Files above may finish rendering and push it down; settle once more.
    setTimeout(() => (el.scrollIntoView({ block }), history.replaceState({ ...history.state, y: scrollY }, '')), 400);
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
const base = fileLabel; // a file's name as shown: unique among the PR's (files.ts)

// A review's verdict: its tag icon (tags.tsx) and words.
const VERDICT: Record<string, [string, string]> = { APPROVED: ['approved', 'approved'], CHANGES_REQUESTED: ['changes', 'changes requested'], COMMENTED: ['reply', 'reviewed'], DISMISSED: ['', 'dismissed'] };

function Section({ id, title, count, extra, children }: { id?: string; title: string; count: number; extra?: ComponentChildren; children: ComponentChildren }) {
  return (
    <Fold k={`ix:${title}`} class="ix-sec" id={id}>
      <summary>
        {title} <span class="count">{count}</span>
        {extra}
      </summary>
      {children}
    </Fold>
  );
}

// `inline`: the excerpt on the same line, after the label (review threads), not a line of its own.
function Entry({ label, meta, sub, dim, inline, onClick }: { label: ComponentChildren; meta?: ComponentChildren; sub?: string; dim?: boolean; inline?: boolean; onClick: () => void }) {
  return (
    <button class={dim ? 'ix-item dim' : 'ix-item'} onClick={onClick} title={sub || (typeof label === 'string' ? label : undefined)}>
      <span class="ix-label">
        {label} {meta && <span class="ix-meta">{meta}</span>}
        {inline && sub && <span class="ix-sub ix-inline"> {sub}</span>}
      </span>
      {!inline && sub && <span class="ix-sub">{sub}</span>}
    </button>
  );
}

// Small line icons for the checks' buttons, drawn in the text's colour.
const Icon = Octicon; // the index's small buttons and marks

// A test file: a flask (with "test" in the diff's file header).
// In the diff's file header it's a tag like the file's status (style.css .st).
// A file's icon by type, with a dot in the corner for added, removed or renamed, and a flask for a test (unless the
// icon is a test one already, as the theme draws JS and TS tests), or a struck-out one for code whose tests the PR
// doesn't touch.
export const FileIcon = ({ path, status, big, untested }: { path: string; status?: string; big?: boolean; untested?: boolean }) => (
  <span class={big ? 'ficon big' : 'ficon'} title={status}>
    <img src={fileIcon(path)} alt="" />
    {status && status !== 'modified' && <i class={'fdot s-' + status} />}
    {inTests(path) && !iconOf(path).startsWith('test-') && (
      <i class="ftest" role="img" title="A test (in a test folder, or named as one)" aria-label="Test">
        <Icon name="beaker" />
      </i>
    )}
    {untested && (
      <i class="ftest no" role="img" title={`No test change: the ${pageTerm().PR} changes this code but no test with its name`} aria-label="No test change">
        <Icon name="beaker" slash />
      </i>
    )}
  </span>
);

// Code changed without its tests: an amber struck-out flask, explained on hover.
export const NoTestMark = ({ title }: { title: string }) => (
  <span class="badge no-test" role="img" title={title} aria-label="No test changes">
    <Icon name="beaker" slash />
  </span>
);

// Ask a reviewer on Slack (your "Asking someone to review" message, Settings → Slack → Messages): a speech bubble
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

// On someone else's PR I'm not reviewing yet: request my own review, so it's on GitHub and in my queue.
function AddMe({ add }: { add: () => Promise<unknown> }) {
  const [state, setState] = useState<'' | 'adding' | string>('');
  return (
    <button
      class="ix-item ix-add-me"
      disabled={state === 'adding'}
      title={state && state !== 'adding' ? state : `Request your own review on this ${pageTerm().PR}`}
      onClick={() => (setState('adding'), add().then(() => setState(''), (e) => setState(`Couldn't add you: ${e.message}`)))}
    >
      <span class="ix-label">
        <Icon name="person" /> {state === 'adding' ? 'Adding you…' : state ? "Couldn't add you · retry" : 'Add me as a reviewer'}
      </span>
    </button>
  );
}

// Ask a reviewer who's reviewed to look again (after you've pushed fixes): a re-request on GitHub, and on Slack your
// "look again" message in your thread with them. ✓ once asked.
// A reviewer waited on who's away: ask the next free person instead (they're taken off the PR).
function Replace({ login, replace }: { login: string; replace: (login: string) => Promise<string> }) {
  const [state, setState] = useState('');
  return (
    <button
      class="link ix-pad ix-replace"
      disabled={!!state && state !== 'failed'}
      title={`@${login} is away: take them off and ask the next free reviewer on GitHub`}
      onClick={() => (setState('asking'), replace(login).then((who) => setState(`asked @${who}`), (e) => (setState('failed'), reportError(e.message))))}
    >
      {state === 'asking' ? 'Asking…' : state && state !== 'failed' ? state : 'Ask someone else instead'}
    </button>
  );
}

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

// A failing check, on the base branch's latest commit: failing there too (likely not this PR's doing), passing (so
// it's likely this PR's), or still running. Nothing when the base doesn't run it (a PR-only check).
export const OnBase = ({ c, branch: full }: { c: Check; branch: string }) => {
  const branch = full.length > 20 ? 'the base branch' : full; // a feature branch's long name: said on hover
  return c.onBase === 'failure' ? (
    <span class="on-base same" title={`The same check fails on ${full}'s latest commit: likely not this ${pageTerm().PRs_} doing (matched by name, not by which test failed)`}>also failing on {branch}</span>
  ) : c.onBase === 'success' ? (
    <span class="on-base diff" title={`It passes on ${full}'s latest commit: likely this ${pageTerm().PRs_}`}>passes on {branch}</span>
  ) : c.onBase === 'pending' ? (
    <span class="on-base">{branch}: still running</span>
  ) : null;
};

function CheckEntry({ c, repo, onRefresh, base, pr, files }: { c: Check; repo: string; onRefresh: () => void; base: string; pr: PR; files: PRFile[] }) {
  const { on: agents } = useAgents();
  // Why did it fail? An agent reads the log's end and the diff (claude.ts ciPrompt); its answer shows below.
  const [why, setWhy] = useState<{ by: AgentId; html?: string; error?: string } | null>(null);
  const explain = async (by: AgentId) => {
    setWhy({ by });
    try {
      const text = log ?? (await jobLog(repo, c.jobId!));
      if (log === null) setLog(text);
      const answer = await runAgent(ciPrompt(pr, c.name, c.onBase ?? null, text, files), by);
      setWhy({ by, html: await renderGfm(answer, repo) }); // GitHub sanitizes the HTML
      notifyAgentDone(`${AGENTS[by].name}: why ${c.name} failed`, answer.replace(/[`*_>#]/g, '').split('\n').find((l) => l.trim())?.slice(0, 160) ?? '', `/${repo}/pull/${pr.number}`);
    } catch (e: any) {
      setWhy({ by, error: e.message });
    }
  };
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
  // Start a GitLab manual job (deploy to staging, say); the checks reload once it's started.
  const [played, setPlayed] = useState<'' | 'asking' | 'started' | string>('');
  const play = () => {
    setPlayed('asking');
    playJob(repo, c.jobId!).then(
      () => (setPlayed('started'), setTimeout(onRefresh, 3000)),
      (e) => setPlayed(`couldn't: ${e.message}`),
    );
  };
  const [logErr, setLogErr] = useState('');
  const loadLog = () => (setLogErr(''), jobLog(repo, c.jobId!).then(setLog, (e) => setLogErr(e.message)));
  const toggle = () => {
    setOpen(!open);
    if (log === null) loadLog();
  };
  return (
    <>
      <div class="ix-check">
        <a class="ix-item" href={c.url ?? undefined} target="_blank" rel="noopener" title={`${c.name}: ${c.summary}`}>
          <span class="ix-label">
            <CheckMark state={c.state} /> {c.name}
          </span>
          {c.summary && <span class="ix-sub">{c.summary}</span>}
          {c.onBase && c.onBase !== 'neutral' && <span class="ix-sub"><OnBase c={c} branch={base} /></span>}
        </a>
        {c.manual && c.jobId && (
          <button
            class={`ix-icon-btn${played === 'asking' ? ' busy' : played === 'started' ? ' done' : played ? ' failed' : ''}`}
            title={played === 'started' ? 'Started' : played.startsWith('couldn') ? `${played}; click to try again` : 'Run this manual job'}
            aria-label="Run this manual job"
            disabled={played === 'asking' || played === 'started'}
            onClick={play}
          >
            <Icon name={played === 'started' ? 'check' : 'play'} />
          </button>
        )}
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
            {agents.map((a) => (
              <button key={a} class={`ix-icon-btn${why?.by === a && !why.html && !why.error ? ' busy' : ''}`} title={`Why did it fail? ${AGENTS[a].name} reads the log and the diff`} aria-label={`Ask ${AGENTS[a].name} why it failed`} disabled={!!why && !why.html && !why.error} onClick={() => explain(a)}>
                <AgentMark id={a} />
              </button>
            ))}
          </>
        )}
      </div>
      {why && (
        <div class="ix-why">
          {why.error ? <p class="error">{AGENTS[why.by].name} couldn't tell: {why.error}</p> : why.html ? <div class="md" dangerouslySetInnerHTML={{ __html: why.html }} /> : <p class="note"><AgentMark id={why.by} /> {AGENTS[why.by].short} is reading the log…</p>}
          {(why.html || why.error) && <button class="link" onClick={() => setWhy(null)}>Close</button>}
        </div>
      )}
      {open && (logErr ? <p class="note ix-pad">Couldn't load the log: {logErr} <Retry onClick={loadLog} /></p> : log == null ? <Lines n={4} /> : <pre class="ix-log">{log}</pre>)}
    </>
  );
}

type IndexProps = {
  repo: string;
  hidden?: { label: string; show: () => void }[]; // files waiting behind a row in the diff (generated, archived…)
  checksErr?: string; // the checks didn't load
  pr: PR;
  conversation: ConversationItem[];
  threads: Thread[];
  settled?: number; // resolved or outdated ones, left out unless settledShown
  settledShown?: boolean;
  onToggleSettled?: () => void;
  drafts: Draft[];
  checks: Check[] | null;
  onRefreshChecks: () => void;
  files: File[];
  viewed: Set<string>;
  counts: Counts;
  me: string;
  ask?: ComponentChildren; // on my own PR: who to ask for a review (review.tsx AskReviewer)
  modules?: Map<string, string>; // each file's Gradle module (files.ts gradleModules), when grouping by them
  steps?: PlanStep[]; // the reading order's steps (files.ts reviewPlan), when the files are in it
  // On my own PR, with Slack: ask a reviewer there (one I have no Slack thread with about it yet); false if it failed.
  slackAsk?: (login: string) => Promise<boolean>;
  slackWith?: Set<string>; // reviewers I already have a Slack thread with about this PR
  reRequest?: (login: string) => Promise<boolean>; // on my own PR: ask a reviewer who's reviewed to look again
  addMe?: () => Promise<unknown>; // on someone else's PR: ask myself for a review (it joins my queue)
  replace?: (login: string) => Promise<string>; // on my own PR: ask someone free instead of a reviewer who's away; says who
  onViewed: OnViewed;
};

// The PR Shortcut Index: who reviews; the conversation (the description, comments and reviews, and review threads, by
// how much they concern me); CI checks; the files.
export function ShortcutIndex({ checksErr, hidden = [], repo, pr, conversation, threads, settled = 0, settledShown, onToggleSettled, drafts, checks, onRefreshChecks, files, viewed, counts, me, ask, modules, steps, onViewed, slackAsk, slackWith, reRequest, addMe, replace }: IndexProps) {
  const [byStep, toggleByStep] = useStoredFlag('ixByStep', true); // the files by reading step, else as folders
  const foldBots = useFoldBots(!!me && pr.user.login === me);
  const excerpts = useMemo(() => conversation.map((c) => oneLine(textOf(c.html))), [conversation]);
  const sortedThreads = threadOrder(threads, [], files).map((x) => x.t!);
  const viewedCount = files.filter((f) => viewed.has(f.filename)).length;
  const failing = checks?.filter((c) => c.state === 'failure').length ?? 0;
  const rerunnable = checks?.filter((c) => c.state === 'failure' && c.jobId && runOf(c)) ?? [];
  const bots = conversation.filter((c) => c.bot);
  // Mine first, grouped; on someone else's PR the rest of the people fold away (on mine, they're what I'm reading).
  const minePR = !!me && pr.user.login === me;
  const replaced = new Set([...earlierVerdicts(conversation).values()].flat()); // folded under the same person's later verdict
  const myConv = conversation.filter((c) => !c.bot && !!me && c.author === me && !replaced.has(c.id)).length;
  const othersConv = conversation.filter((c) => !c.bot && c.author !== me && !replaced.has(c.id)).length;
  const convEntry = (c: ConversationItem, i: number) => (
    // Under "yours", a plain comment of mine reads "comment", without my name again; a verdict keeps it, as everyone's.
    c.author === me && !c.state ? (
      <Entry key={c.id} label="comment" sub={excerpts[i]} onClick={() => jumpTo('cv-' + c.id)} />
    ) : (
      <Entry key={c.id} label={<Who login={c.author} src={c.avatar} />} meta={c.state ? <Tg i={VERDICT[c.state][0]} t={VERDICT[c.state][1]} /> : undefined} sub={excerpts[i]} onClick={() => jumpTo('cv-' + c.id)} />
    )
  );
  const tiers = threadTiers(sortedThreads, me);
  const waitsOnMe = (t: Thread) => !!me && awaitsMe(t, me, pr.user.login === me); // listed first in its group
  // In the bots' and the resolved group, their author and "resolved" go without saying.
  const threadEntry = (t: Thread, inGroup?: 'bot' | 'resolved') => {
    const first = t.comments.nodes[0];
    const waiting = !!me && awaitsMe(t, me, pr.user.login === me);
    return (
      <Entry
        key={t.id}
        label={<><Octicon name={waiting ? 'comment' : 'file'} /> <FileName path={t.path} />{t.line ? ':' + t.line : ''}</>}
        meta={(() => {
          const rest = [waiting && 'awaiting your reply', inGroup !== 'resolved' && t.isResolved && 'resolved', t.isOutdated && 'outdated'].filter(Boolean).join(' · ');
          const who = inGroup !== 'bot' && first?.author?.login !== me && first?.author; // a thread I started: no name
          return who ? <><Who login={who.login} src={who.avatarUrl} />{rest && ` · ${rest}`}</> : rest;
        })()}
        sub={oneLine(first?.bodyText ?? '')}
        inline
        dim={t.isResolved || t.isOutdated}
        onClick={() => jumpTo('t-' + t.id, 'f-' + t.path)}
      />
    );
  };
  useEffect(() => void reviewersShown(), []);
  // The file you're reading, marked in the files' list and kept in sight in the index as you scroll.
  useEffect(() => {
    let raf = 0;
    const mark = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const at = [...document.querySelectorAll<HTMLElement>('main section.file[id^="f-"]')].find((s) => s.getBoundingClientRect().bottom > 120)?.id.slice(2);
        const row = at ? document.querySelector<HTMLElement>(`.index .tree-file[title="${CSS.escape(at)}"]`)?.closest<HTMLElement>('.tree-row') : null;
        const was = document.querySelector('.index .tree-row.cur');
        if (row === was) return;
        was?.classList.remove('cur');
        if (!row) return;
        row.classList.add('cur');
        let box = row.parentElement;
        while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
        if (!box) return;
        const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
        if (r.top < b.top + 40 || r.bottom > b.bottom - 8) box.scrollTop += r.top - b.top - b.height / 3;
      });
    };
    addEventListener('scroll', mark, { passive: true });
    mark();
    return () => (removeEventListener('scroll', mark), cancelAnimationFrame(raf));
  }, [files]);
  const pending = checks?.filter((c) => c.state === 'pending').length ?? 0;
  // Who's reviewing: each person's latest verdict, "waiting" for ones asked who haven't answered (again).
  const reviewers = new Map<string, { meta: string; icon: string; tone: string; id?: string }>();
  for (const c of conversation) if (c.state && !c.bot && c.author !== pr.user.login) reviewers.set(c.author, { meta: VERDICT[c.state][1], icon: VERDICT[c.state][0], tone: c.state, id: c.id });
  for (const r of pr.requested_reviewers ?? [])
    if (r.type !== 'Bot') reviewers.set(r.login, { meta: reviewers.has(r.login) ? 'asked again' : 'waiting', icon: 'waiting', tone: 'WAITING', id: reviewers.get(r.login)?.id });
  for (const t of pr.requested_teams ?? []) reviewers.set(`team ${t.slug}`, { meta: 'waiting', icon: 'waiting', tone: 'WAITING' });
  // Their Slack statuses: one waited on who's away (sick, vacation, leave) says so, and on my PR can be swapped.
  const presence = usePresence([...reviewers.keys()].filter((w) => !w.startsWith('team ')), repo);

  return (
    <div class="index">
      <Section id="ix-reviewers" title="Reviewers" count={reviewers.size}>
        {[...reviewers].map(([who, r]) => (
          <div class="ix-check">
            <button class={r.id ? 'ix-item ix-person' : 'ix-item ix-person dim-click'} onClick={() => r.id && jumpTo('cv-' + r.id)} title={r.id ? `Go to @${who}'s review` : `@${who}: ${r.meta}`}>
              <span class="ix-label">
                {!who.startsWith('team ') && <img src={faceOf(who)} alt="" />}
                {who} <span class={`ix-meta v-${r.tone}`}><Tg i={r.icon} t={r.meta} /></span>
              </span>
              {presence[who] && <span class={isAway(presence[who]) ? 'ix-status away' : 'ix-status'}>{isAway(presence[who]) && '🌴 '}{statusText(presence[who])}</span>}
            </button>
            {replace && r.tone === 'WAITING' && isAway(presence[who]) && <Replace login={who} replace={replace} />}
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
        {addMe && !reviewers.has(me) && <AddMe add={addMe} />}
      </Section>

      <Section title="Conversation" count={conversation.length - replaced.size + 1 + threads.length + drafts.length}>
        <Entry label="Description" onClick={() => jumpTo('pr-description')} />
        {myConv + drafts.length + tiers.mine.length > 0 && (
          <Fold k="ix-yours" class="ix-ckgroup">
            <summary><Octicon name="person" /> {myConv + drafts.length + tiers.mine.length} yours</summary>
            {tiers.mine.filter(waitsOnMe).map((t) => threadEntry(t))}
            {conversation.map((c, i) => !c.bot && c.author === me && !replaced.has(c.id) && convEntry(c, i))}
            {drafts.map((d) => (
              <Entry
                key={d.id}
                label={<><Octicon name="file" /> <FileName path={d.path} />{d.line ? ':' + d.line : ''}</>}
                meta="pending"
                sub={oneLine(d.body)}
                inline
                onClick={() => jumpTo('d-' + d.id, 'f-' + d.path)}
              />
            ))}
            {tiers.mine.filter((t) => !waitsOnMe(t)).map((t) => threadEntry(t))}
          </Fold>
        )}
        {othersConv + tiers.human.length > 0 && (
          <Fold k={`ix-others:${minePR ? 'mine' : 'theirs'}`} initial={minePR} class="ix-ckgroup">
            <summary><Octicon name="comment-discussion" /> {othersConv + tiers.human.length} from others</summary>
            {tiers.human.filter(waitsOnMe).map((t) => threadEntry(t))}
            {conversation.map((c, i) => !c.bot && c.author !== me && !replaced.has(c.id) && convEntry(c, i))}
            {tiers.human.filter((t) => !waitsOnMe(t)).map((t) => threadEntry(t))}
          </Fold>
        )}
        {bots.length + tiers.bot.length > 0 && (
          <Fold k={`ix-bots:${minePR ? 'mine' : 'theirs'}`} initial={!foldBots} class="ix-ckgroup">
            <summary><Octicon name="dependabot" /> {bots.length + tiers.bot.length} from bots</summary>
            {conversation.map((c, i) => c.bot && convEntry(c, i))}
            {tiers.bot.map((t) => threadEntry(t, 'bot'))}
          </Fold>
        )}
        {tiers.resolved.length > 0 && (
          <Fold k="ix-resolved" initial={false} class="ix-ckgroup">
            <summary><Octicon name="check" /> {tiers.resolved.length} resolved</summary>
            {tiers.resolved.map((t) => threadEntry(t, 'resolved'))}
          </Fold>
        )}
        {settled > 0 && (
          <button class="link ix-pad ix-hidden" onClick={onToggleSettled}>
            {settledShown ? `Hide ${settled} resolved or outdated` : `${settled} resolved or outdated hidden · show`}
          </button>
        )}
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
          <div class="ix-pad"><Lines /></div>
        ) : checksErr ? (
          <p class="note ix-pad">Couldn't load the checks: {checksErr} <Retry onClick={onRefreshChecks} /></p>
        ) : !checks.length ? (
          <p class="note ix-pad">No checks.</p>
        ) : (
          <>
            {checks.filter((c) => c.state === 'failure' || c.state === 'pending').map((c) => <CheckEntry key={c.name} c={c} repo={repo} onRefresh={onRefreshChecks} base={pr.base.ref} pr={pr} files={files} />)}
            {([['success', 'passed'], ['neutral', 'skipped or cancelled']] as const).map(([state, label]) => {
              const group = checks.filter((c) => c.state === state);
              return group.length > 0 && (
                <Fold k={`ix-checks:${state}`} initial={false} class="ix-ckgroup">
                  <summary><CheckMark state={state} /> {group.length} {label}</summary>
                  {group.map((c) => <CheckEntry key={c.name} c={c} repo={repo} onRefresh={onRefreshChecks} base={pr.base.ref} pr={pr} files={files} />)}
                </Fold>
              );
            })}
          </>
        )}
      </Section>

      <Section
        title="Files"
        count={files.length}
        extra={
          <>
            {viewedCount > 0 && <span class="ck-sum">{viewedCount}/{files.length} viewed</span>}
            {steps && (
              <button
                class="link ix-files-view"
                title={byStep ? 'Show the files as folders' : 'Show the files by reading step, in the diff’s order'}
                onClick={(e) => (e.preventDefault(), e.stopPropagation(), toggleByStep())}
              >
                <Octicon name={byStep ? 'file-directory' : 'list-ordered'} /> {byStep ? 'Folders' : 'Steps'}
              </button>
            )}
          </>
        }
      >
        {steps && byStep ? (
          <StepGroups files={files} steps={steps} counts={counts} viewed={viewed} onViewed={onViewed} />
        ) : modules?.size ? (
          <ModuleTrees files={files} modules={modules} counts={counts} viewed={viewed} onViewed={onViewed} />
        ) : (
          <FileTree files={files} counts={counts} viewed={viewed} onViewed={onViewed} />
        )}
        {hidden.map((h) => (
          <button class="ix-item dim ix-hidden-row" onClick={() => h.show()} title="Shown in the diff when you open them">
            {h.label} hidden · show
          </button>
        ))}
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
            <span class="tree-dir-name">{m === '' ? 'Other files' : <><ModuleIcon /> {moduleLabel(m)}</>}</span> <span class="count">{fs.length}</span>
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

// The files by reading step, in the diff's order (Settings → Files in reading order), each step with its icon; files
// outside the steps (generated, renamed only… once shown) after them, as a tree.
function StepGroups({ files, steps, counts, viewed, onViewed }: { files: File[]; steps: PlanStep[]; counts: Counts; viewed: Set<string>; onViewed: OnViewed }) {
  const byPath = new Map(files.map((f) => [f.filename, f]));
  const inSteps = new Set(steps.flatMap((s) => s.paths));
  const rest = files.filter((f) => !inSteps.has(f.filename));
  return (
    <>
      {steps.map((s) => {
        const fs = s.paths.map((p) => byPath.get(p)).filter((f): f is File => !!f);
        return (
          fs.length > 0 && (
            <Fold k={`ix-step:${s.key}`} class="tree-dir mod-group" key={s.key}>
              <summary title={s.why}>
                <span class="tree-dir-name"><Octicon name={stepIcon(s.key)} /> {s.title}</span> <span class="count">{fs.length}</span>
                <ViewedMark paths={fs.map((f) => f.filename)} viewed={viewed} onViewed={onViewed} what="this step" />
              </summary>
              {fs.map((f) => <FileRow f={f} depth={1} counts={counts} viewed={viewed} onViewed={onViewed} folder />)}
            </Fold>
          )
        );
      })}
      {rest.length > 0 && (
        <details open class="tree-dir mod-group">
          <summary>
            <span class="tree-dir-name">Other files</span> <span class="count">{rest.length}</span>
            <ViewedMark paths={rest.map((f) => f.filename)} viewed={viewed} onViewed={onViewed} what="these files" />
          </summary>
          <FileTree files={rest} counts={counts} viewed={viewed} onViewed={onViewed} />
        </details>
      )}
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
      {all ? <Octicon name="check" size={10} /> : n ? <Octicon name="dash" size={10} /> : ''}
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
      {[...node.files].sort((a, b) => byName(a.filename, b.filename)).map((f) => (
        <FileRow f={f} depth={depth} counts={counts} viewed={viewed} onViewed={onViewed} />
      ))}
    </>
  );
}

// A file's name as shown (files.ts fileLabel), cut in the middle when too long: the first folder and the folder and name
// at its end stay, what's between gives way first ("2026-09-22-buku-…/payment-out-idempotency/spec.md"). Its path on hover.
export function FileName({ path }: { path: string }) {
  const segs = fileLabel(path).split('/');
  const leaf = segs.pop()!;
  if (!segs.length) return <span class="fname" title={path}>{leaf}</span>;
  const head = segs[0] + '/', mid = segs.slice(1, -1).map((s) => s + '/').join(''), tail = (segs.length > 1 ? segs.at(-1) + '/' : '') + leaf;
  return (
    <span class="fname" title={path}>
      <span class="fn-head">{head}</span>
      {mid && <span class="fn-mid">{mid}</span>}
      <span class="fn-tail">{tail}</span>
    </span>
  );
}

// A file's row: a click goes to it. `folder`: its folder after the name, faint (a list by step has no tree to show it).
function FileRow({ f, depth, counts, viewed, onViewed, folder }: { f: File; depth: number; counts: Counts; viewed: Set<string>; onViewed: OnViewed; folder?: boolean }) {
  const c = counts(f.filename);
  const dir = f.filename.split('/').slice(0, -1);
  return (
    <div key={f.filename} class={viewed.has(f.filename) ? 'tree-row dim' : 'tree-row'}>
      <button class="tree-file" style={{ paddingLeft: `${8 + depth * 14}px` }} title={f.filename} onClick={() => document.getElementById('f-' + f.filename)?.scrollIntoView()}>
        <FileIcon path={f.filename} status={f.status} untested={f.untested} />
        <span class="tree-name">
          {folder ? <FileName path={f.filename} /> : f.filename.slice(f.filename.lastIndexOf('/') + 1)}
          {folder && dir.length > 0 && <small class="tree-folder"> {dir.length > 2 ? '…/' + dir.slice(-2).join('/') : dir.join('/')}</small>}
        </span>
        {c > 0 && <span class="badge"><Octicon name="comment" /> {c}</span>}
      </button>
      <ViewedMark paths={[f.filename]} viewed={viewed} onViewed={onViewed} what="this file" />
    </div>
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
        <img class="dicon" src={folderIcon(name, false)} alt="" />
        <img class="dicon open" src={folderIcon(name, true)} alt="" />
        {/* A long chain shows its last two folders (the whole of it on hover). */}
        <span class="tree-dir-name">{name.split('/').length > 2 ? '…/' + name.split('/').slice(-2).join('/') : name}</span>
        <ViewedMark paths={allFiles(n)} viewed={viewed} onViewed={onViewed} what="this folder" />
      </summary>
      <TreeChildren node={n} depth={depth + 1} counts={counts} viewed={viewed} onViewed={onViewed} />
    </details>
  );
}

