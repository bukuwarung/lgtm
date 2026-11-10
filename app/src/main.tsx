import '@fontsource-variable/jetbrains-mono';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { agentBusy, agentLimit, agentReviewOn, agentRunOf, retryAgent, reviewWithAgents } from './agentreview.ts';
import { labMe } from './gitlab.ts';
import { isOffline, offlineWhere, pingGitHub, closedPRs, forgetAllThreadStatus, getMentionStatus, getStaleBranches, deleteBranch, type StaleBranch, readyToMerge, setPractice, disableAutoMerge, getChecks, slackRecipients, getMergeState, markReady, mergePR, requestReview, getEstimates, rerunFailedJobs, runOf, updateBranch, renderGfm, getReviewQueue, getOwnedDrafts, getTeamPRs, getAskedPRs, getTeams, getThreadStatus, getViewer, getGitHubViewer, site, isLab, loadPR, queueNews, withAnswered, type Answered, type ReviewEvent, loadToken, type LoadedPR, type QueueItem, prWebUrl, parsePrUrl, numRef } from './github.ts';
import { NoticeText, Review } from './review.tsx';
import { jumpTo, showReviewers } from './shortcuts.tsx';
import { isAway, statusText } from './slackmsg.ts';
import { AgentMark, CheckMark, DECISION, Octicon, Tg, Who, Time, Lines, num, CopyCode, Fold, Retry } from './tags.tsx';
import { setRainbow } from './highlight.ts';
import { findStacks } from './stacks.ts';
import { estimateLabel } from './files.ts';
import { addNotice, dropNotices, useRecentPRs, type RecentPR, qaSeen, qaThreads, notices, type Notice, copyText, lastLogin, usePresence, ago, since, askNotifications, slackStatus, availableUpdate, getGhAccounts, own, setAccount, type GhAccount, claudeSessionState, agentSkill, fetchIntegrations, keepSkillCurrent, linkSession, linkedSession, newer, type Integrations, type SkillStatus, clipboardPR, copyDiagnostics, initDesktop, isDesktop, notify as notifyNative, notifySlack, openExternal, prCache, readBots, setBadge, setTray, slackEscape, useStoredFlag, useStoredValue, useDismiss, repoLabel, knowRepos, offerUndo, putBackNotices, useMedia, faceOf, glabAccounts, viewAs, personKey, type GlabAccount, term, teamLabel } from './platform.ts';
import { AGENTS, AGENT_IDS, agentIdOf, detectAgents, type AgentId } from './agents.ts';
import { CommandBar } from './palette.tsx';
import { knowJiraKeys, linkJiraKeys } from './jira.ts';
import { FindBar } from './find.tsx';
import { Settings, THEMES, useTheme } from './settings.tsx';
import { History } from './history.tsx';
import { PersonPage, toPerson } from './person.tsx';
import { Inbox } from './inbox.tsx';
import { DemoPage } from './demos.tsx';
import { CODE_DEFAULT, TEXT_DEFAULT, saveTheme, setTrial, useCodeLook, useTrial } from './look.ts';
import { fillSlack, prValues, slackTemplate } from './slackmsg.ts';
import { Resizer } from './resizer.tsx';
import { hint, keyLabel, readBindings, useBindings, type Action } from './keys.ts';
import { movePending } from './merge.tsx';

// The words of the site on show: GitHub's PRs and teams, or GitLab's MRs and groups (the avatar's menu; switching reloads).
const T = term();

// A link to a GitHub PR in what people wrote (descriptions, comments, threads, Jira tickets, Slack previews) opens it
// here; one into the open PR (a comment, a thread, a file of it) goes there in place (review.tsx, "lgtm:link"). ⌘- or
// Ctrl-click still goes to GitHub. Registered before the app's "web links open in the browser" (initDesktop).
addEventListener(
  'click',
  (e) => {
    const a = (e.target as Element | null)?.closest?.('.md a[href], .slack-preview a[href]') as HTMLAnchorElement | null;
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
    if (!dispatchEvent(new CustomEvent('lgtm:link', { detail: a.href, cancelable: true }))) return e.preventDefault();
    const m = a.href.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/);
    if (!m) return;
    e.preventDefault();
    location.hash = `/${m[1]}/pull/${m[2]}`;
  },
  true,
);

// Jira keys in anything rendered (descriptions, comments, threads, the inbox) link to the ticket, once Jira is set up
// (jira.ts linkJiraKeys): what's there now, and what's drawn later.
try {
  knowJiraKeys(Object.keys(JSON.parse(localStorage.getItem('jiraSeen') ?? '{}'))); // tickets shown before
} catch {}
fetchIntegrations().then(({ jira }) => {
  if (!jira.site) return;
  const link = (el: Element | null) => el && linkJiraKeys(el, jira.site!);
  document.querySelectorAll('.md').forEach(link);
  new MutationObserver((ms) => {
    for (const m of ms) {
      link((m.target as Element).closest?.('.md') ?? null);
      for (const n of m.addedNodes) if (n instanceof Element) (n.matches('.md') ? [n] : [...n.querySelectorAll('.md')]).forEach(link);
    }
  }).observe(document.body, { childList: true, subtree: true });
}, () => {});

// Text cut off with "…" (titles, paths, branches, excerpts) shows in full on hover: an element cut short and without a
// tooltip of its own gets its text as one, when the pointer reaches it.
addEventListener('mouseover', (e) => {
  for (let el = e.target as HTMLElement | null, i = 0; el && i < 3; el = el.parentElement, i++) {
    if (el.title || el.scrollWidth <= el.clientWidth || getComputedStyle(el).textOverflow !== 'ellipsis') continue;
    el.title = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    return;
  }
});

// Menus from the keyboard: Enter or Space on a menu's button opens it (they're buttons); ↓ / ↑ (Home, End) go into it and
// through its items; Esc closes it (each menu's own handler) and puts the focus back on its button.
const MENU_WRAP = '.bell, .recent-menu, .account, .agents-menu, .pill-menu, .pill-drop';
const MENU_POP = '.account-menu, .pill-pop, .quick-menu';
addEventListener(
  'keydown',
  (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(e.key)) return;
    const at = document.activeElement as HTMLElement | null;
    const wrap = at?.closest<HTMLElement>(MENU_WRAP);
    const pop = wrap?.querySelector<HTMLElement>(MENU_POP);
    const toggle = wrap?.querySelector<HTMLElement>(':scope > summary, [aria-expanded]');
    if (!wrap || !pop?.getClientRects().length) return; // no menu here, or it's closed
    if (e.key === 'Escape') return void (pop.contains(at) && setTimeout(() => toggle?.focus()));
    const items = (pop.matches('a, button') ? [pop] : [...pop.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select')]).filter((x) => x.getClientRects().length);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(at!);
    const down = e.key === 'ArrowDown';
    items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i < 0 ? (down ? 0 : items.length - 1) : (i + (down ? 1 : -1) + items.length) % items.length].focus();
  },
  true,
);

// Accepts "#https://github.com/o/r/pull/1", "#/o/r/pull/1", a pasted PR URL, or a GitLab MR's.
export const parseRoute = parsePrUrl; // also a GitLab MR's address

// GitHub out of reach (github.ts says so from any request): one bar for the whole app instead of a failure per part.
// What was loaded stays on show; buttons that need GitHub rest (style.css html.offline). It tries again every 20
// seconds (and when macOS says the network is back), and once GitHub answers, everything on show loads again.
function OfflineBar() {
  const [off, setOff] = useState(isOffline);
  useEffect(() => {
    const down = () => setOff(true);
    const up = () => (setOff(false), dispatchEvent(new Event('lgtm:refresh')), dispatchEvent(new Event('lgtm:list-refresh')));
    const back = () => void pingGitHub();
    addEventListener('lgtm:offline', down);
    addEventListener('lgtm:online', up);
    addEventListener('online', back);
    return () => (removeEventListener('lgtm:offline', down), removeEventListener('lgtm:online', up), removeEventListener('online', back));
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('offline', off);
    if (!off) return;
    const t = setInterval(() => void pingGitHub(), 20_000);
    return () => clearInterval(t);
  }, [off]);
  if (!off) return null;
  return (
    <div class="offline-bar" role="status">
      <Octicon name="alert" /> <span><b>Offline:</b> {offlineWhere()} can't be reached. This is what was loaded; lgtm tries again by itself.</span>
      <Retry onClick={() => void pingGitHub()} />
    </div>
  );
}

// A theme being tried on the whole app (from Settings' theme gallery): keep it, or go back to yours. On every page, so
// a PR can be read in it first.
function TrialBar({ look }: { look: ReturnType<typeof useCodeLook> }) {
  const tried = useTrial();
  if (!tried) return null;
  return (
    <div class="toast trial" role="status">
      Trying <b>{tried.t.name}</b>
      <button class="primary" onClick={() => (saveTheme(look, tried.key, tried.t), setTrial(null))}>Keep it</button>
      <button onClick={() => setTrial(null)}>Back to yours</button>
    </div>
  );
}

// Review mode's end: what became of each PR, with a copy to paste (on Slack, say).
const VERB: Record<ReviewEvent | 'skipped', [string, string]> = { APPROVE: ['approved', 'Approved'], REQUEST_CHANGES: ['changes', 'Requested changes'], COMMENT: ['reply', 'Commented'], skipped: ['skipped', 'Skipped'] };
function ReviewLog({ log }: { log: { repo: string; n: number; title: string; how: ReviewEvent | 'skipped' }[] }) {
  const [copied, setCopied] = useState(false);
  const url = (l: (typeof log)[number]) => prWebUrl(l.repo, l.n);
  const copy = () =>
    copyText(log.map((l) => `${VERB[l.how][1]}: ${l.title || `${l.repo}#${l.n}`} ${url(l)}`).join('\n')).then(() => setCopied(true), () => {});
  return (
    <div class="review-log">
      {log.map((l) => (
        <a href={`#/${l.repo}/pull/${l.n}`} class={`rl-${l.how.toLowerCase()}`}>
          <Tg i={VERB[l.how][0]} t={VERB[l.how][1]} /> <b>{l.title}</b> <small>{repoLabel(l.repo)}{numRef(l.repo, l.n)}</small>
        </a>
      ))}
      <button class="link" onClick={copy}>{copied ? 'Copied' : 'Copy as text'}</button>
    </div>
  );
}

// Branches of my merged PRs still on GitHub: one click lists them, a second deletes them (github.ts deleteBranch keeps
// one another open PR builds on).
function StaleBranches() {
  const [list, setList] = useState<StaleBranch[] | null>(null);
  const [step, setStep] = useState<'' | 'confirm' | 'deleting' | string>('');
  useEffect(() => void getStaleBranches().then(setList, () => setList([])), []);
  if (!list?.length) return step && step !== 'confirm' && step !== 'deleting' ? <p class="note">{step}</p> : null;
  const go = async () => {
    setStep('deleting');
    const kept: string[] = [];
    for (const b of list) await deleteBranch(b.repo, b).catch((e) => kept.push(`${b.headRefName} (${e.message})`));
    setStep(kept.length ? `Deleted ${list.length - kept.length}; kept ${kept.join(', ')}` : `Deleted ${list.length} merged branch${list.length > 1 ? 'es' : ''}`);
    setList([]);
  };
  return (
    <div class="stale">
      {step === 'confirm' ? (
        <>
          <p>Delete these branches on {viewAs() ? 'GitLab' : 'GitHub'}? Their {T.PRs} are merged.</p>
          <ul>{list.map((b) => <li><CopyCode>{b.headRefName}</CopyCode> <small>{repoLabel(b.repo)}#{b.number}</small></li>)}</ul>
          <button class="primary" onClick={go}>Delete {list.length} branch{list.length > 1 ? 'es' : ''}</button> <button onClick={() => setStep('')}>Cancel</button>
        </>
      ) : (
        <button class="link" disabled={step === 'deleting'} onClick={() => setStep('confirm')}>
          {step === 'deleting' ? 'Deleting…' : `${list.length} branch${list.length > 1 ? 'es' : ''} of your merged ${T.PRs} still exist${list.length > 1 ? '' : 's'} · clean up`}
        </button>
      )}
    </div>
  );
}

// Where a PR of mine stands, in a few words (the menu bar's menu, the bell's).
const standing = (i: QueueItem) =>
  i.isDraft ? 'draft' : readyToMerge(i) ? 'ready to merge' : i.ci === 'FAILURE' || i.ci === 'ERROR' ? 'CI failing' : i.reviewDecision === 'CHANGES_REQUESTED' ? 'changes requested' : i.reviewDecision === 'APPROVED' ? 'approved' : 'waiting for review';

// The bell: what lgtm would have notified me about and I haven't acted on yet (opened its PR, or dismissed), newest
// first, its count on the bell; and the switch for desktop notifications.
function BellMenu() {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [notify, toggleNotify] = useStoredFlag('notifyRequests', true);
  const [list, setList] = useState(notices);
  useEffect(() => {
    const h = () => setList(notices());
    addEventListener('lgtm:notices', h);
    addEventListener('storage', h);
    return () => (removeEventListener('lgtm:notices', h), removeEventListener('storage', h));
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !(e.target as Element).closest?.('.bell') && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', away);
    addEventListener('keydown', esc);
    return () => (removeEventListener('pointerdown', away), removeEventListener('keydown', esc));
  }, [open]);
  const go = (n: Notice) => {
    const [repo, num] = n.pr.split('#');
    location.hash = `/${repo}/pull/${num}`; // opening it clears what it said (the route effect)
    setOpen(false);
  };
  return (
    <span class="bell">
      <button type="button" title={list.length ? `${list.length} new` : 'Notifications'} aria-haspopup="menu" aria-expanded={open} class={open ? 'on' : ''} onClick={() => setOpen(!open)}>
        <Octicon name={notify ? 'bell' : 'bell-slash'} />
        {list.length > 0 && <span class="nav-count">{list.length}</span>}
      </button>
      {open && (
        <div class="account-menu bell-menu" role="menu">
          <div class="bell-notify">
            <Octicon name={notify ? 'bell' : 'bell-slash'} />
            <span>
              Desktop notifications
              <small>New review requests, and what you pick in Settings</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={notify}
              aria-label="Desktop notifications"
              class="switch"
              onClick={async () => {
                setErr('');
                if (!notify && !(await askNotifications())) return setErr(isDesktop ? 'Notifications are off for lgtm in System Settings → Notifications' : 'Notifications are blocked for this page in your browser settings');
                toggleNotify();
              }}
            />
          </div>
          {err && <p class="note">{err}</p>}
          <hr />
          {list.length ? (
            <>
              {list.map((n) => (
                <div class="bell-row">
                  <button role="menuitem" onClick={() => go(n)} title={`Open ${n.pr}`}>
                    <span class="bell-title">
                      <b>{n.what}</b> · {n.title}
                    </span>
                    <small>{repoLabel(n.pr.split('#')[0])}#{n.pr.split('#')[1]} · <Time at={n.at} /></small>
                  </button>
                  <button class="bell-x" title="Dismiss" aria-label="Dismiss" onClick={() => { const gone = dropNotices((x) => x.id === n.id); offerUndo('Dismissed', () => putBackNotices(gone)); }}>
                    <Octicon name="x" />
                  </button>
                </div>
              ))}
              <button role="menuitem" class="bell-act bell-clear" onClick={() => { const gone = dropNotices(() => true); offerUndo(`Cleared ${gone.length}`, () => putBackNotices(gone)); }}>
                Clear all
              </button>
            </>
          ) : (
            <p class="note bell-empty">Nothing new. What lgtm would notify you about stays here until you open its {T.PR}.</p>
          )}
        </div>
      )}
    </span>
  );
}

// No PR open: the queue at a glance; each number opens its tab of the list.
function StartPage({ items, onTab }: { items: QueueItem[] | null; onTab: (tab: string) => void }) {
  const [showDrafts] = useStoredFlag('showDrafts', false);
  if (!items) return <p class="note page empty">Pick a {T.PR} from the list, or paste a {T.PR} link in the box at the top (⌘K).</p>;
  const needs = toReview(items, showDrafts);
  const mine = items.filter((i) => i.authored && !i.isDraft);
  const oldest = needs.map((i) => i.waitingSince).sort()[0];
  const replies = repliesWaiting(items);
  const cards: [string, number | string, string, string][] = [
    ['reviewing', needs.length, 'need your review', needs.length ? 'Open the Reviewing tab' : ''],
    ['reviewing', oldest ? ago(oldest).replace(/ ago$/, '') : '–', 'oldest wait', oldest ? `Since ${new Date(oldest).toLocaleString()}` : ''],
    ['inbox', replies, `thread${replies === 1 ? '' : 's'} waiting on your reply`, 'Open them, to reply or resolve'],
    ['mine', mine.filter((i) => i.reviewDecision !== 'APPROVED' && i.reviewDecision !== 'CHANGES_REQUESTED').length, 'of yours waiting for review', `Open Your ${T.PRs}`],
    ['mine', mine.filter(readyToMerge).length, 'of yours ready to merge', `Open Your ${T.PRs}`],
    ['mine', mine.filter((i) => i.reviewDecision === 'CHANGES_REQUESTED').length, 'of yours with changes requested', `Open Your ${T.PRs}`],
  ];
  return (
    <div class="page start">
      <div class="start-grid">
        {cards.map(([tab, n, label, title]) => (
          <button class="start-card" title={title} onClick={() => (tab === 'inbox' ? (location.hash = '/inbox') : onTab(tab))}>
            <b>{n}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <p class="note">
        Pick a PR from the list, or paste a PR link in the box at the top (⌘K). <a href="#/history">Your reviews this month →</a>
      </p>
      <RecentList max={8} />
      <StaleBranches />
    </div>
  );
}

// The PRs you opened lately (platform.ts recentPRs), newest first: on the start page, and in the clock's menu.
const STATE_ICON = { merged: 'git-merge', closed: 'git-pull-request-closed', draft: 'git-pull-request-draft' } as const;
function RecentList({ max, onGo }: { max: number; onGo?: () => void }) {
  const here = location.hash.slice(1);
  const list = useRecentPRs().filter((r) => `/${r.repo}/pull/${r.n}` !== here).slice(0, max);
  if (!list.length) return onGo ? <p class="note bell-empty">{T.PRs} you open show here, and stay after a relaunch.</p> : null;
  const row = (r: RecentPR) => (
    <a class="recent-row" href={`#/${r.repo}/pull/${r.n}`} onClick={onGo}>
      <Octicon name={r.state ? STATE_ICON[r.state] : 'git-pull-request'} class={`recent-${r.state ?? 'open'}`} />
      <span class="recent-title">{r.title}</span>
      <small>
        {repoLabel(r.repo)}{numRef(r.repo, r.n)} · <Who login={r.author} /> · <Time at={r.at} />
      </small>
    </a>
  );
  return onGo ? <>{list.map(row)}</> : (
    <section class="recent">
      <h3>Recently viewed</h3>
      {list.map(row)}
    </section>
  );
}
// Back, forward, and the recently viewed PRs (the clock; holding or right-clicking back opens them too, as a
// browser's back holds its history).
function HistoryNav({ backTo }: { backTo: string }) {
  const [open, setOpen] = useState(false);
  const hold = useRef(0);
  const held = useRef(false);
  useEffect(() => {
    const show = () => setOpen(true); // View → Recently Viewed
    addEventListener('lgtm:recent', show);
    return () => removeEventListener('lgtm:recent', show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !(e.target as Element).closest?.('.recent-menu') && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', away);
    addEventListener('keydown', esc);
    return () => (removeEventListener('pointerdown', away), removeEventListener('keydown', esc));
  }, [open]);
  const holds = (go: () => void) => ({
    'aria-haspopup': 'menu' as const,
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      held.current = false;
      hold.current = window.setTimeout(() => ((held.current = true), setOpen(true)), 450);
    },
    onPointerUp: () => clearTimeout(hold.current),
    onPointerLeave: () => clearTimeout(hold.current),
    onContextMenu: (e: MouseEvent) => (e.preventDefault(), setOpen(true)),
    onClick: () => (held.current ? (held.current = false) : (setOpen(false), go())),
  });
  const more = `; hold for recently viewed ${T.PRs}`;
  return (
    <span class="recent-menu">
      <button class="nav-hist" title={`Back${backTo ? ` to ${backTo}` : ''} (⌘[)${more}`} aria-label="Back" {...holds(() => history.back())}>
        <Octicon name="arrow-left" />
        {backTo && <span class="back-hint">{backTo}</span>}
      </button>
      <button class="nav-hist" title="Forward (⌘])" aria-label="Forward" onClick={() => history.forward()}>
        <Octicon name="arrow-right" />
      </button>
      <button class={'nav-hist' + (open ? ' on' : '')} title={`Recently viewed ${T.PRs} (⌘Y)`} aria-label={`Recently viewed ${T.PRs}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Octicon name="history" />
      </button>
      {open && (
        <div class="account-menu recent-pop" role="menu">
          <RecentList max={30} onGo={() => setOpen(false)} />
        </div>
      )}
    </span>
  );
}

function App() {
  const [bindings] = useBindings();
  const keyFor = (a: Action) => keyLabel(bindings[a]);
  const [state, setState] = useState<'loading' | 'in' | { error: string }>('loading');
  const [route, setRoute] = useState(location.hash);
  // Opening a PR acts on what the bell said about it.
  useEffect(() => {
    const cur = parseRoute(route);
    if (cur) dropNotices((x) => x.pr === `${cur.repo}#${cur.n}`);
  }, [route]);
  const [queueVersion, setQueueVersion] = useState(0);
  const [answeredTick, setAnsweredTick] = useState(0); // a review sent: lay it over the list
  const [refreshing, setRefreshing] = useState(false); // ↻: until the list's next load lands
  const [showPRs, toggleStoredPRs] = useStoredFlag('showPRs', true);
  // A narrow window keeps the diff readable: the PR list tucks away, and its button lays it over the page until you
  // pick a PR, click elsewhere or press Esc (your choice for wide windows stays as it is).
  const narrowPRs = useMedia('(max-width: 1000px)');
  const [prsOver, setPrsOver] = useState(false);
  const togglePRs = () => (narrowPRs ? setPrsOver((o) => !o) : toggleStoredPRs());
  useEffect(() => {
    const close = () => setPrsOver(false);
    addEventListener('hashchange', close);
    return () => removeEventListener('hashchange', close);
  }, []);
  useDismiss(narrowPRs && prsOver, () => setPrsOver(false), '.side.prs, .prs-btn');
  const look = useCodeLook(); // code colours and font, and text sizes, from Settings
  // Glass (Settings → Appearance), unless macOS asks for less transparency.
  const [glass] = useStoredFlag('glass', true);
  useEffect(() => void document.documentElement.classList.toggle('glass', glass && !matchMedia('(prefers-reduced-transparency: reduce)').matches), [glass]);
  const [rainbowOn] = useStoredFlag('rainbowBrackets', true); // Settings → Diff
  setRainbow(rainbowOn); // before the page below highlights anything
  const [tagStyle] = useStoredValue('tagStyle', 'icons'); // Settings → Appearance: tags as text, icons or both
  useEffect(() => {
    document.documentElement.classList.toggle('tags-text', tagStyle === 'text');
    document.documentElement.classList.toggle('tags-icons', tagStyle === 'icons');
  }, [tagStyle]);
  const [strike] = useStoredFlag('strikeRemoved', false); // Settings → Diff: removed markdown struck through
  useEffect(() => void document.documentElement.classList.toggle('strike-removed', strike), [strike]);
  const [footer] = useStoredFlag('fileFooter', false); // Settings → Diff: each file's closing bar
  useEffect(() => void document.documentElement.classList.toggle('no-file-footer', !footer), [footer]);
  const [signs] = useStoredFlag('diffSigns', false); // Settings → Diff: + and − before changed lines
  useEffect(() => void document.documentElement.classList.toggle('no-signs', !signs), [signs]);
  const [centered] = useStoredFlag('centerDiff', true); // Settings → Diff, or the PR header: the page at a reading width
  useEffect(() => void document.documentElement.classList.toggle('center-diff', centered), [centered]);
  const [cols] = useStoredValue('centerCols', '120'); // its width, in columns of code
  useEffect(() => document.documentElement.style.setProperty('--cols', cols), [cols]);
  const [lineStyle] = useStoredValue('lineStyle', 'subtle'); // Settings → Diff: changed lines filled, tinted or barred
  useEffect(() => {
    document.documentElement.classList.toggle('ln-subtle', lineStyle === 'subtle');
    document.documentElement.classList.toggle('ln-bar', lineStyle === 'bar');
  }, [lineStyle]);
  const [wordStyle] = useStoredValue('wordStyle', 'squiggle'); // Settings → Diff: changed words filled, boxed or squiggled
  useEffect(() => {
    document.documentElement.classList.toggle('wd-box', wordStyle === 'box');
    document.documentElement.classList.toggle('wd-squiggle', wordStyle === 'squiggle');
  }, [wordStyle]);
  useEffect(() => void initDesktop((r) => (location.hash = r)), []); // the app: links to the browser, lgtm:// links
  // The PR list's latest items (to pick the next PR to review), and a message to show on the page we move to.
  const queue = useRef<QueueItem[]>([]);
  const [flash, setFlash] = useState<{ route: string; text: string; ok: boolean } | null>(null);
  // Review mode: the PRs that need my review one after another, with nothing else on screen. seen: the ones reviewed
  // or skipped since it started (GitHub's search can list a reviewed one for a while).
  const [rm, setRm] = useState<{ practice?: boolean; seen: string[]; done: number; skipped: number; log: { repo: string; n: number; title: string; how: ReviewEvent | 'skipped' }[] } | null>(null);
  const lastEvent = useRef<ReviewEvent>('COMMENT'); // the review just submitted, for review mode's summary
  useEffect(() => (document.documentElement.classList.toggle('review-mode', !!rm), setPractice(!!rm?.practice)), [rm]);
  // The PRs to review: the ones that need my review, or (a practice run) my own. Drafts only while the list shows them,
  // after the ready ones.
  const [showDrafts] = useStoredFlag('showDrafts', false);
  const needs = (items: QueueItem[], skip: string[], practice = rm?.practice) => {
    const l = (practice ? items.filter((i) => i.mine && !i.isDraft) : toReview(items, showDrafts)).filter((i) => !skip.includes(`${i.repo}#${i.number}`));
    return rm || practice ? l.sort((a, b) => +a.isDraft - +b.isDraft || a.waitingSince.localeCompare(b.waitingSince)) : l; // review mode: longest-waiting first
  };
  const goNext = async (from: { repo: string; n: number } | null, notice: { text: string; ok: boolean } | null, skip = rm?.seen ?? [], practice = rm?.practice) => {
    // With the PR list hidden nothing has loaded it; fetch it now (without thread status, so no "comments resolved").
    const items = queue.current.length ? queue.current : await getReviewQueue().catch(() => []);
    const next = needs(items, from ? [...skip, `${from.repo}#${from.n}`] : skip, practice)[0];
    const to = next ? `#/${next.repo}/pull/${next.number}` : '#/done';
    setFlash(notice && { route: to, ...notice });
    location.hash = to.slice(1);
  };
  // Leaving one in review mode: reviewed (done) or skipped, then the next.
  const moveOn = (from: { repo: string; n: number }, how: 'done' | 'skipped', notice: { text: string; ok: boolean } | null = null) => {
    if (!rm) return goNext(from, notice);
    const seen = [...rm.seen, `${from.repo}#${from.n}`];
    const title = queue.current.find((i) => i.repo === from.repo && i.number === from.n)?.title ?? '';
    setRm({ ...rm, seen, [how]: rm[how] + 1, log: [...rm.log, { ...from, title, how: how === 'done' ? lastEvent.current : 'skipped' }] });
    return goNext(null, notice, seen);
  };
  // Auto-merge's ticket moves (merge.tsx), once the PR has merged and left the list: a notification says how it went.
  const moveMerged = (items: QueueItem[]) =>
    movePending(new Set(items.map((i) => `${i.repo}#${i.number}`))).then((done) =>
      done.forEach((d) => (say({ text: d.text }), void notifyNative(d.ok ? 'Jira ticket moved' : "Jira ticket didn't move", d.text, `/${d.pr.replace('#', '/pull/')}`))),
    );
  const startReview = (practice = false) => (setRm({ practice, seen: [], done: 0, skipped: 0, log: [] }), goNext(null, null, [], practice));
  useEffect(() => {
    if (!rm) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as Element).closest('input, textarea, [contenteditable]') || document.querySelector('.help, .panel, dialog[open]')) return;
      setRm(null);
    };
    const skip = () => r && moveOn(r, 'skipped'); // the skip key (keys.ts), from the PR page
    addEventListener('keydown', esc);
    addEventListener('lgtm:skip', skip);
    return () => (removeEventListener('keydown', esc), removeEventListener('lgtm:skip', skip));
  }, [rm, route]);

  // Signed in as the account of last time at once (its saved list and drafts show without waiting for GitHub); GitHub's
  // answer confirms it, or (gh switched accounts) everything draws again as the right one.
  const [accountKey, setAccountKey] = useState(0);
  // GitLab alone works too: without gh's sign-in but with glab's, lgtm starts on the GitLab account.
  const signIn = () =>
    loadToken()
      .catch(async (e) => {
        const labs = await glabAccounts(true);
        if (!labs.length) throw e;
        if (!labs.some((a) => a.host === viewAs())) localStorage.setItem('viewAs', labs[0].host);
      })
      .then(async () => {
        const last = lastLogin();
        // A GitLab account (the avatar's menu) keeps its data as login@host, apart from GitHub's.
        const check = getViewer().then((login) => {
          const me = viewAs() ? `${login}@${viewAs()}` : login;
          if (me === last) return;
          setAccount(me); // this account's drafts and the like (platform.ts own)
          setAccountKey((k) => k + 1);
        }, () => {});
        if (last) setAccount(last);
        else await check;
      })
      .then(() => setState('in'), (e) => setState({ error: e.message }));
  useEffect(() => {
    const onHash = () => (takeClaudeLink(), setRoute(location.hash));
    addEventListener('hashchange', onHash);
    void signIn();
    return () => removeEventListener('hashchange', onHash);
  }, []);

  // Back and forward (the title bar, ⌘[ ⌘]) go through PRs and the jumps within one (shortcuts.tsx noteJump): a step
  // within the same page scrolls back to where it was. After a jump, Back says for a moment where it goes.
  const routeRef = useRef(route);
  routeRef.current = route;
  const [backTo, setBackTo] = useState('');
  const [failure, setFailure] = useState(''); // platform.ts reportError
  const [queueItems, setQueueItems] = useState<QueueItem[] | null>(null); // the list's, for the start page
  const replies = repliesWaiting(queueItems ?? []); // threads and mentions waiting on my reply, for the inbox button
  const [, setPrTab] = useStoredValue('prTab', 'reviewing');
  useEffect(() => {
    const show = (e: Event) => setFailure((e as CustomEvent<string>).detail);
    addEventListener('lgtm:error', show);
    return () => removeEventListener('lgtm:error', show);
  }, []);
  useEffect(() => {
    let t = 0;
    const jumped = (e: Event) => (setBackTo((e as CustomEvent<string>).detail), clearTimeout(t), (t = window.setTimeout(() => setBackTo(''), 6000)));
    const pop = (e: PopStateEvent) => {
      setBackTo('');
      const y = e.state?.y;
      if (y != null && location.hash === routeRef.current) scrollTo({ top: y });
    };
    addEventListener('lgtm:jumped', jumped);
    addEventListener('popstate', pop);
    return () => (removeEventListener('lgtm:jumped', jumped), removeEventListener('popstate', pop));
  }, []);

  // A short message at the bottom (copied diagnostics, a PR link on the clipboard), with an optional action.
  const [toast, setToast] = useState<{ text: string; action?: [string, () => void] } | null>(null);
  const toastTimer = useRef(0);
  const say = (t: typeof toast, ms = 6000) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms) as unknown as number;
  };
  // ⌘+ / ⌘− / ⌘0, as in a browser: the text sizes (Settings → Appearance) a step up, down, or back; code keeps pace.
  // The app's View menu has them (its keys never reach the page); in a browser, the keys here.
  const textStep = (step: number) => {
    const text = step ? Math.min(20, Math.max(11, look.textSize + step)) : TEXT_DEFAULT;
    const code = step ? Math.min(18, Math.max(10, look.codeSize + step)) : CODE_DEFAULT;
    look.setTextSize(String(text));
    look.setCodeSize(String(code));
    say({ text: `Text ${text}px · code ${code}px` }, 1500);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const id = e.key === '=' || e.key === '+' ? 'text-bigger' : e.key === '-' ? 'text-smaller' : e.key === '0' ? 'text-reset' : isDesktop && e.key === 'l' ? 'open-url' : '';
      if (!id) return;
      e.preventDefault();
      onMenu.current(id);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // The PR list, and the PR that's open (it shows "updating…" meanwhile): the ↻ button and View → Refresh.
  const refresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 15_000); // a failed load still stops the spinning
    setQueueVersion((v) => v + 1);
    dispatchEvent(new Event('lgtm:refresh'));
  };
  // The keyboard shortcuts: a PR's own help, or Settings' list elsewhere (the ? button and Help → Keyboard Shortcuts).
  const shortcuts = () => (parseRoute(location.hash) ? dispatchEvent(new Event('lgtm:help')) : ((location.hash = '/settings'), jumpTo('set-keyboard-shortcuts')));
  // The app's menu bar (desktop/src-tauri/src/lib.rs). A ref, so the handler sees this render's state.
  const onMenu = useRef((_: string) => {});
  onMenu.current = (id) => {
    if (id === 'settings') location.hash = '/settings';
    else if (id === 'open-url') dispatchEvent(new Event('lgtm:palette'));
    else if (id === 'palette') {
      // The menu takes ⌘K before the page sees it: in a comment box, hand it back (there it makes a link).
      const box = document.activeElement?.closest('.editor') && document.activeElement;
      if (box) box.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
      else dispatchEvent(new Event('lgtm:palette'));
    }
    else if (id === 'find') dispatchEvent(new Event('lgtm:find'));
    else if (id === 'reload') location.reload();
    else if (id === 'refresh') refresh();
    else if (id === 'recent') dispatchEvent(new Event('lgtm:recent'));
    else if (id === 'inbox') location.hash = '/inbox';
    else if (id === 'shortcuts') shortcuts();
    else if (id === 'back') history.back();
    else if (id === 'forward') history.forward();
    else if (id === 'toggle-prs') togglePRs();
    else if (id === 'review-mode') needs(queue.current, [], false).length ? startReview() : say({ text: `No ${T.PRs} need your review right now.`, action: ['Practice run', () => startReview(true)] });
    else if (id === 'text-bigger') textStep(1);
    else if (id === 'text-smaller') textStep(-1);
    else if (id === 'text-reset') textStep(0);
    else if (id === 'help') void openExternal('https://github.com/bukuwarung/lgtm#readme');
    else if (id === 'diagnostics')
      void copyDiagnostics().then(() => say({ text: 'Diagnostics copied: paste them into your bug report' }), () => say({ text: "Couldn't copy the diagnostics" }));
  };
  useEffect(() => {
    // Other parts of the page show a message here too (the review page, after a review a Claude session sent).
    const t = (e: Event) => say((e as CustomEvent).detail, (e as CustomEvent).detail.ms ?? 20000);
    addEventListener('lgtm:toast', t);
    return () => removeEventListener('lgtm:toast', t);
  }, []);
  useEffect(() => {
    const h = (e: Event) => onMenu.current((e as CustomEvent<string>).detail);
    addEventListener('lgtm:menu', h);
    return () => removeEventListener('lgtm:menu', h);
  }, []);

  // The app, coming to the front with a PR link on the clipboard (copied from Slack, say): offer to open it, once.
  const offered = useRef('');
  useEffect(() => {
    if (!isDesktop || state !== 'in') return;
    const check = async () => {
      const url = await clipboardPR();
      const pr = url && parseRoute(url);
      if (!pr || url === offered.current) return;
      offered.current = url;
      const cur = parseRoute(location.hash);
      if (cur?.repo === pr.repo && cur.n === pr.n) return;
      say({ text: `Open ${pr.repo}#${pr.n} from the clipboard?`, action: ['Open', () => (location.hash = `/${pr.repo}/pull/${pr.n}`)] }, 12000);
    };
    addEventListener('focus', check);
    return () => removeEventListener('focus', check);
  }, [state]);

  const [update, setUpdate] = useState<string | null>(null);
  useEffect(() => void availableUpdate().then(setUpdate), []);
  useEffect(() => void keepSkillCurrent(), []); // a newer lgtm's skill replaces the installed one

  if (route.startsWith('#/demo/')) return <DemoPage k={route.slice(7)} />; // README pictures; no sign-in needed
  if (state === 'loading') return null;
  if (typeof state === 'object') return <Setup error={state.error} retry={signIn} />;

  const r = parseRoute(route);
  return (
    <>
      {/* In the app the window has no title bar: this bar holds the traffic lights (left) and drags the window. */}
      <nav class="top" data-tauri-drag-region>
        {rm ? (
          <>
            <b class="rm-title">Review mode</b>
            {rm.practice && <span class="pill p-warn" title={`Your own ${T.PRs}; finishing a review only moves on, and nothing is sent to ${T.site}`}>practice</span>}
            {r && (() => {
              const left = needs(queue.current, rm.seen).length || 1; // this one, and what's after it
              return <span class="rm-count">{rm.seen.length + 1} of {rm.seen.length + left}</span>;
            })()}
            <span class="spacer" />
            {r && <button onClick={() => moveOn(r, 'skipped')} title={`On to the next ${T.PR} without reviewing this one (${keyFor('skip')})`}>Skip <kbd>{keyFor('skip')}</kbd></button>}
            <button onClick={() => setRm(null)} title="Back to everything (Esc)">Exit <kbd>Esc</kbd></button>
          </>
        ) : (<>
        <button class="prs-btn" title={`Show / hide the ${T.PR} list`} onClick={togglePRs}><Octicon name="three-bars" /></button>
        {/* The inbox: threads and mentions waiting on my reply (the count is the list's open PRs; it also covers merged ones). */}
        <a
          href="#/inbox"
          class={`nav-btn nav-inbox${route === '#/inbox' ? ' on' : ''}`}
          title={`Threads and mentions waiting on your reply (in open ${T.PRs}, and ones merged lately)`}
          aria-label={`Inbox${replies ? `: ${replies} waiting on your reply` : ''}`}
        >
          <Octicon name="inbox" />
          {replies > 0 && <span class="nav-count">{replies}</span>}
        </a>
        <a href="#/settings" class={route === '#/settings' ? 'nav-btn on' : 'nav-btn'} title="Settings (⌘,)" aria-label="Settings"><Octicon name="gear" /></a>
        <div class="top-actions">
          <button
            class={`nav-refresh${refreshing ? ' refreshing' : ''}`}
            title={`Refresh the ${T.PR} list and the open ${T.PR} (⌘R; the list also every 3 minutes)`}
            aria-label="Refresh"
            onClick={refresh}
          >
            <span><Octicon name="sync" /></span>
          </button>
          <BellMenu />
        </div>
        <span class="spacer" />
        {/* Back and forward beside the search box, as a browser has them by its address bar. */}
        <span class="nav-go">
          <HistoryNav backTo={backTo} />
          <CommandBar queue={() => queue.current} parse={parseRoute} />
        </span>
        <span class="spacer" />
        {__DEV_BUILD__ && (
          <span class="nav-dev" title={`A development build, not a release${__COMMIT__ ? ` (commit ${__COMMIT__})` : ''}`}>
            DEV{__COMMIT__ && ` · ${__COMMIT__}`}
          </span>
        )}
        {update && (
          <a href="#/settings" class="nav-btn nav-update" title={`lgtm ${update} is out: see Settings`}>
            ⬆ {update}
          </a>
        )}
        <button
          class="help-btn"
          title={`Keyboard shortcuts${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').help)}`}
          aria-label="Keyboard shortcuts"
          onClick={shortcuts}
        >
          ?
        </button>
        <ThemeToggle />
        <AccountMenu />
        </>)}
      </nav>
      {failure && (
        <div class="fail-bar" role="alert">
          <Octicon name="alert" /> <span>{failure}</span>
          <button class="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={() => setFailure('')}><Octicon name="x" /></button>
        </div>
      )}
      <OfflineBar />
      {isDesktop && <FindBar />}
      {!rm && (
        <>
          <WhatsNew />
          <SetupCheck />
          <TrialBar look={look} />
        </>
      )}
      {toast && !rm && (
        <div class="toast" role="status">
          {toast.text}
          {toast.action && (
            <button class="primary" onClick={() => (toast.action![1](), setToast(null))}>
              {toast.action[0]}
            </button>
          )}
          <button title="Dismiss" onClick={() => setToast(null)}><Octicon name="x" /></button>
        </div>
      )}
      <div class={showPRs && !rm && !narrowPRs ? 'shell' : 'shell no-prs'} key={accountKey}>{/* another account: everything again, as it */}
        {/* Hidden, not unmounted: reopening shows the list as it was, without loading it again. */}
        <PRList hidden={(narrowPRs ? !prsOver : !showPRs) || !!rm} over={narrowPRs && prsOver} onReview={startReview} current={r} version={queueVersion} answeredTick={answeredTick} onItems={(items) => (reviewWithAgents(items.filter((i) => i.reviewing && (i.requested || backToMe(i)) && !i.isDraft && !i.authored)), (queue.current = items), setQueueItems(items), setRefreshing(false), void moveMerged(items))} />
        {r ? (
          <Review
            key={route}
            repo={r.repo}
            n={r.n}
            toReview={queueItems ? queueItems.some((i) => i.repo === r.repo && i.number === r.n && needsMyReview(i)) : undefined}
            onOpened={() => noteOpened(r.repo, r.n)}
            onSubmitted={(event?: ReviewEvent) => {
              if (!event) return setQueueVersion((v) => v + 1); // the merge box changed something: reload now
              lastEvent.current = event;
              if (rm?.practice) return; // nothing was sent
              // A review: shown in the list at once, reloaded once GitHub's search has caught up with it.
              answered.set(`${r.repo}#${r.n}`, { event, at: Date.now() });
              setAnsweredTick((t) => t + 1);
              setTimeout(() => setQueueVersion((v) => v + 1), 60_000);
            }}
            onReviewed={(notice) => moveOn(r, 'done', notice)}
            focus={!!rm}
            practice={rm?.practice}
            flash={flash?.route === route ? flash : null}
          />
        ) : route === '#/history' ? (
          <History />
        ) : route === '#/inbox' ? (
          <Inbox items={queueItems} />
        ) : route.startsWith('#/person/') ? (
          <PersonPage login={decodeURIComponent(route.slice('#/person/'.length))} orgs={[...new Set((queueItems ?? []).map((i) => i.repo.split('/')[0]))]} />
        ) : route === '#/settings' ? (
          <Settings />
        ) : route === '#/done' ? (
          <div class="page done">
            <img src="/favicon.png" alt="" width="96" height="96" />
            <h2>{rm?.practice ? 'Practice run done' : rm?.skipped ? 'End of the queue' : 'All caught up!'}</h2>
            <p>
              {rm?.practice ? `Nothing was sent to ${T.site}. When ${T.PRs} need your review, it's the button at the top of the Reviewing tab.`
                : rm?.skipped ? `Reviewed ${rm.done}, skipped ${rm.skipped}: those still need your review.`
                : rm ? `Reviewed ${rm.done}. No ${T.PRs} need your review right now.`
                : `No ${T.PRs} need your review right now.`}
            </p>
            {rm && rm.log.length > 0 && <ReviewLog log={rm.log} />}
            {rm && <button class="primary" onClick={() => setRm(null)}>Back to the list</button>}
            {flash?.route === route && (
              <p class={flash.ok ? 'notice' : 'warn'}>
                <NoticeText text={flash.text} />
              </p>
            )}
          </div>
        ) : (
          <StartPage items={queueItems} onTab={(t) => (setPrTab(t), narrowPRs ? setPrsOver(true) : !showPRs && toggleStoredPRs())} />
        )}
      </div>
    </>
  );
}

// First run: what lgtm can use and how to set up what's missing, once (Settings has all of it later). GitHub is signed
// in by the time this shows; Slack, Jira and the Claude Code skill are optional.
function SetupCheck() {
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem('setupSeen');
    } catch {
      return false;
    }
  });
  const [ints, setInts] = useState<Integrations | null>(null);
  const [found, setFound] = useState<AgentId[] | null>(null); // the coding agents' CLIs installed
  const [skills, setSkills] = useState<Partial<Record<AgentId, SkillStatus>>>({});
  const [hub, setHub] = useState<boolean | null>(null);
  const [labs, setLabs] = useState<GlabAccount[] | null>(null);
  const check = () => {
    setInts(null);
    getGitHubViewer().then(() => setHub(true), () => setHub(false));
    glabAccounts(true).then(setLabs);
    fetchIntegrations().then(setInts, () => setInts({ slack: { ok: false, error: "couldn't check" }, jira: { ok: false, error: "couldn't check" } }));
    detectAgents(true).then((d) => setFound(d.filter((a) => a.version).map((a) => a.id)));
    for (const a of AGENT_IDS) agentSkill(false, a).then((x) => setSkills((s) => ({ ...s, [a]: x })), () => {});
  };
  useEffect(() => void (open && check()), []);
  const done = () => {
    try {
      localStorage.setItem('setupSeen', '1');
    } catch {}
    setOpen(false);
  };
  useDismiss(open, done, '.whats-new');
  if (!open) return null;
  const row = (ok: boolean | null, name: string, what: string, fix: preact.ComponentChildren) => (
    <div class="set-int">
      <CheckMark state={ok == null ? 'pending' : ok ? 'success' : 'neutral'} />
      <div>
        <b>{name}</b> <span class="note">{what}</span>
        {ok === false && <div class="setup-fix">{fix}</div>}
      </div>
    </div>
  );
  return (
    <div class="whats-new-back" onMouseDown={(e) => e.target === e.currentTarget && done()}>
      <div class="whats-new" role="dialog" aria-label="Set up lgtm">
        <div class="row">
          <b>Welcome to lgtm</b>
          <span class="spacer" />
          <button onClick={check}>Check again</button>
          <button class="primary" onClick={done}>Done</button>
        </div>
        <p class="note">lgtm borrows the sign-ins of these tools and stores no tokens. It needs GitHub or GitLab (or both); the rest you can set up now or later in Settings.</p>
        {row(hub, 'GitHub', 'PRs, reviews and comments, through the GitHub CLI.', <pre>brew install gh && gh auth login</pre>)}
        {row(labs == null ? null : labs.length > 0, 'GitLab', labs?.length ? `MRs, reviews and comments, through the GitLab CLI (${labs.map((a) => a.host).join(', ')}).` : 'MRs, reviews and comments, through the GitLab CLI, on gitlab.com or your own GitLab.', <pre>brew install glab && glab auth login</pre>)}
        {row(ints ? ints.slack.ok : null, 'Slack', '(optional) DM the author when you finish a review.', <pre>brew install shaharia-lab/tap/slackcli && slackcli auth login-auto</pre>)}
        {row(ints ? ints.jira.ok : null, 'Jira', `(optional) The ${T.PRs_} ticket above its files.`, <pre>brew install atlassian/homebrew-acli/acli && acli jira auth login --web</pre>)}
        {row(
          found && found.length > 0,
          'Coding agents',
          found?.length
            ? `(optional) ${found.map((a) => AGENTS[a].name).join(' and ')}: agent reviews, questions and fixes, through ${found.length > 1 ? 'their CLIs' : 'its CLI'}.`
            : '(optional) Claude Code or Codex: agent reviews, questions and fixes, through their CLIs.',
          <pre>{AGENT_IDS.map((a) => `${AGENTS[a].install}   # ${AGENTS[a].name}`).join('\n')}</pre>,
        )}
        {found?.filter((a) => skills[a] && !skills[a]!.current).map((a) => (
          <div class="setup-fix setup-skill">
            <AgentMark id={a} /> {AGENTS[a].short} can send {T.PRs} ready for review here, linked to its {a === 'codex' ? 'conversation' : 'session'}.{' '}
            <button onClick={() => agentSkill(true, a).then((x) => setSkills((s) => ({ ...s, [a]: x })), () => {})}>{skills[a]!.installed ? 'Update its skill' : 'Install its skill'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// After an update: this version's release notes, once. A first install just remembers the version.
function WhatsNew() {
  const [notes, setNotes] = useState<string | null>(null);
  const seen = () => {
    try {
      localStorage.setItem('seenVersion', __APP_VERSION__);
    } catch {}
  };
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem('seenVersion');
    } catch {}
    if (!last) return seen();
    if (!newer(__APP_VERSION__, last)) return;
    fetch(`https://api.github.com/repos/bukuwarung/lgtm/releases/tags/v${__APP_VERSION__}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((r) => renderGfm(r.body ?? '', 'bukuwarung/lgtm')) // GitHub sanitizes the HTML
      .then(setNotes, seen); // no notes to show: don't ask again
  }, []);
  const close = () => (seen(), setNotes(null));
  useDismiss(!!notes, close, '.whats-new');
  if (!notes) return null;
  return (
    <div class="whats-new-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="whats-new" role="dialog" aria-label={`What's new in lgtm ${__APP_VERSION__}`}>
        <div class="row">
          <b>What's new in lgtm {__APP_VERSION__}</b>
          <span class="spacer" />
          <button class="primary" onClick={close}>Got it</button>
        </div>
        <div class="md" dangerouslySetInnerHTML={{ __html: notes }} />
        <a href="https://github.com/bukuwarung/lgtm/releases" target="_blank" rel="noopener">All releases</a>
      </div>
    </div>
  );
}

// Before the first sign-in works: what to run, and a button to try again (nothing to restart).
function Setup({ error, retry }: { error: string; retry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const missing = /isn't installed/.test(error);
  return (
    <div class="signin">
      <h1 class="brand">
        <img src="/favicon.png" alt="" width="32" height="32" /> lgtm
      </h1>
      {isDesktop || /signed in|gh token|gh auth/i.test(error) ? (
        <>
          <p>lgtm signs in with the GitHub CLI (gh) or the GitLab CLI (glab), so it never asks for a password or token. {error}</p>
          <p>In Terminal, run one, or both:</p>
          <pre>{missing ? 'brew install gh\ngh auth login' : 'gh auth login'}</pre>
          <pre>{'brew install glab\nglab auth login'}</pre>
          <p class="note">For GitHub: if your organization enforces SSO, authorize the token for it when GitHub asks. For your own GitLab: <code>glab auth login --hostname gitlab.example.com</code>.</p>
        </>
      ) : (
        <>
          <p class="error">{error}</p>
          <p class="note">The browser version needs the <code>lgtm-web</code> command running: start it in Terminal.</p>
        </>
      )}
      <button class="primary" disabled={busy} onClick={() => (setBusy(true), retry().finally(() => setBusy(false)))}>
        {busy ? 'Checking…' : 'Check again'}
      </button>
      <p class="note">Slack messages and Jira tickets are optional: set them up later in Settings.</p>
    </div>
  );
}

// The account lgtm shows, as its avatar. A click lists the accounts gh is signed in to and, under them, glab's on each
// GitLab host: picking one switches to it (the page loads again as that account; a GitLab one lists its MRs). Settings
// → Accounts picks among GitHub's too.
const avatarOf = (login: string) => faceOf(login, 64);
// The site's mark, small, on the avatar's corner when you're signed in to both GitHub and GitLab: which one is on show.
// GitHub's is Octicons' mark-github (MIT); GitLab's a plain tanuki.
const HOST_MARK = {
  GitHub: 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z',
  GitLab: 'M8 15.2 10.9 6.3H5.1L8 15.2Zm0 0L5.1 6.3H1L8 15.2ZM1 6.3l-.9 2.8c-.1.3 0 .5.2.7L8 15.2 1 6.3Zm0 0h4.1L3.3.8c-.1-.3-.5-.3-.6 0L1 6.3Zm7 8.9 2.9-8.9H15L8 15.2Zm7-8.9.9 2.8c.1.3 0 .5-.2.7L8 15.2l7-8.9Zm0 0h-4.1L12.7.8c.1-.3.5-.3.6 0L15 6.3Z',
};
function AccountMenu() {
  const [me, setMe] = useState<{ login: string; avatar: string; site: string } | null>(null);
  const [accounts, setAccounts] = useState<GhAccount[] | null>(null);
  const [labs, setLabs] = useState<GlabAccount[] | null>(null);
  const [labFaces, setLabFaces] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const host = viewAs();
  const [both, setBoth] = useState(false); // signed in to GitHub and to a GitLab
  useEffect(() => void Promise.all([glabAccounts(), getGitHubViewer().then(() => true, () => false)]).then(([l, gh]) => setBoth(l.length > 0 && gh)), []);
  useEffect(() => {
    const shown = host ? labMe(host).then((u) => ({ ...u, site: host })) : getGitHubViewer().then((login) => ({ login, avatar: avatarOf(login), site: 'GitHub' }));
    void shown.then(setMe, () => setMe(host ? { login: '?', avatar: '', site: host } : { login: '', avatar: '', site: '' }));
  }, [host]);
  useEffect(() => {
    if (!open) return;
    getGhAccounts().then(setAccounts, () => setAccounts([]));
    glabAccounts(true).then((l) => {
      setLabs(l);
      for (const a of l) void labMe(a.host).then((u) => setLabFaces((f) => ({ ...f, [a.host]: u.avatar })), () => {});
    });
    const away = (e: Event) => !(e.target as Element).closest?.('.account') && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', away);
    addEventListener('keydown', esc);
    return () => (removeEventListener('pointerdown', away), removeEventListener('keydown', esc));
  }, [open]);
  if (me && !me.login) return null; // not signed in to GitHub
  // Its place kept while it loads, so nothing beside it moves under the pointer.
  if (!me) return <span class="account"><button class="account-btn" disabled aria-label="Account"><Octicon name="person" /></button></span>;
  // Everything loaded so far was as the other account: the page loads again.
  const switchTo = (view: string, gh?: GhAccount) => {
    if (view === host && (view || !gh || gh.login === me.login)) return setOpen(false);
    if (view) localStorage.setItem('viewAs', view);
    else localStorage.removeItem('viewAs');
    if (gh) gh.active ? localStorage.removeItem('ghAccount') : localStorage.setItem('ghAccount', gh.login); // gh's active one: follow gh
    location.hash = '';
    location.reload();
  };
  return (
    <span class="account">
      <button class="account-btn" title={`${me.site === 'GitHub' ? 'GitHub' : `GitLab (${me.site})`}: @${me.login}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {me.avatar ? <img src={me.avatar} alt={`@${me.login}`} /> : <Octicon name="person" />}
        {both && (
          <span class={`acct-host ${host ? 'gitlab' : 'github'}`} aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d={HOST_MARK[host ? 'GitLab' : 'GitHub']} /></svg>
          </span>
        )}
      </button>
      {open && (
        <div class="account-menu" role="menu">
          <div class="account-head">GitHub accounts in gh</div>
          {accounts == null ? (
            <Lines n={2} />
          ) : (
            accounts.map((a) => {
              const on = !host && a.login === me.login;
              return (
                <button role="menuitemradio" aria-checked={on} class={on ? 'on' : ''} onClick={() => switchTo('', a)}>
                  <img src={avatarOf(a.login)} alt="" />
                  <span>{a.login}</span>
                  {a.active && <small>gh's active</small>}
                  {on && <span class="account-check"><Octicon name="check" /></span>}
                </button>
              );
            })
          )}
          <div class="account-head">GitLab accounts in glab</div>
          {labs == null ? (
            <Lines n={1} />
          ) : (
            labs.map((a) => {
              const on = host === a.host;
              return (
                <button role="menuitemradio" aria-checked={on} class={on ? 'on' : ''} onClick={() => switchTo(a.host)}>
                  {labFaces[a.host] ? <img src={labFaces[a.host]} alt="" /> : <Octicon name="person" />}
                  <span>{a.login}</span>
                  <small>{a.host}</small>
                  {on && <span class="account-check"><Octicon name="check" /></span>}
                </button>
              );
            })
          )}
          <p class="note">
            Add one with <code>gh auth login</code> or <code>glab auth login</code>, then open this again.
          </p>
        </div>
      )}
    </span>
  );
}

// Cycles auto → light → dark; index.html applies the saved choice before first paint.
function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const i = THEMES.findIndex(([t]) => t === theme);
  const next = THEMES[(i + 1) % THEMES.length];
  return (
    <button class="theme-btn" title={`Theme: ${THEMES[i][1]} (click for ${next[1]})`} aria-label={`Theme: ${THEMES[i][1]}`} onClick={() => setTheme(next[0])}>
      {THEMES[i][2]}
    </button>
  );
}

type Group = 'agents' | 'needs' | 'mentioned' | 'changes' | 'commented' | 'approved';
const GROUPS: [Group, string][] = [
  ['agents', 'Agents reviewing'], // Settings → Reviewing: Claude Code reviews it first (agentreview.ts)
  ['needs', 'Needs your review'],
  ['mentioned', 'Mentioned you'],
  ['changes', 'You requested changes'],
  ['commented', 'You commented'],
  ['approved', 'You approved'],
];
// A PR I commented on or requested changes on comes back to "Needs your review" once every thread I'm in is resolved.
const backToMe = (i: QueueItem) => !i.requested && !!i.myState && i.myState !== 'APPROVED' && !!i.thread?.allMineResolved;
// Back on my plate after I reviewed it: re-requested, or my threads all resolved. Shown as one pill, and the PR-wide
// verdict is hidden then, since it's usually my own earlier one.
const reReview = (i: QueueItem) => (i.requested && (!!i.myState || i.reviewedBefore)) || backToMe(i);
// Waiting for my review: the list's "Needs your review" (the badge counts these).
const needsMyReview = (i: QueueItem) => i.reviewing && groupOf(i) === 'needs' && !i.isDraft;
// What every count of "waiting for you" reads, so the list, the start page, Review Mode, the Dock badge, the window title
// and the menu bar agree: the PRs in "Needs your review" (drafts too while the list shows them), and the threads and
// mentions waiting on your reply (the inbox).
const toReview = (items: QueueItem[], showDrafts: boolean) => items.filter((i) => i.reviewing && groupOf(i) === 'needs' && (!i.isDraft || showDrafts));
const repliesWaiting = (items: QueueItem[]) => items.reduce((n, i) => n + (i.thread?.awaiting ?? 0) + +!!i.mentionWaiting, 0);
const groupOf = (i: QueueItem): Group =>
  !i.reviewing && i.mentioned ? 'mentioned'
  : i.requested || backToMe(i) ? (agentBusy(i) ? 'agents' : 'needs')
  : i.myState === 'APPROVED' ? 'approved' : i.myState === 'CHANGES_REQUESTED' ? 'changes' : 'commented';

// PRs that only @-mention me show until I open them after their latest activity (opening one records when).
const openedKey = (repo: string, n: number) => own(`opened:${repo}#${n}`);
export const noteOpened = (repo: string, n: number) => {
  try {
    localStorage.setItem(openedKey(repo, n), String(Date.now()));
  } catch {}
};
const mentionNew = (i: QueueItem) => !i.reviewing && !i.authored && !!i.mentioned && Number(localStorage.getItem(openedKey(i.repo, i.number)) ?? 0) < Date.parse(i.updatedAt);
const inReviewing = (i: QueueItem) => i.reviewing || mentionNew(i);

// A group of the PR list: its open or folded kept (Fold), except a person's in the Team tab (they start folded).
const ListGroup = ({ k, initial, class: cls, children }: { k: string; initial: boolean; class: string; children: preact.ComponentChildren }) =>
  k ? <Fold k={`list:${k}`} initial={initial} class={cls}>{children}</Fold> : <details open={initial} class={cls}>{children}</details>;

// A sidebar section: its groups in priority order, which group a PR falls in, and (if not the group's) its colour.
// people: groups are people (the Team tab), shown with their picture and starting folded.
// asked: (Team tab) how many PRs ask a member for a review; listed in its own tab under their name.
type Kind = { name: string; groups: [string, string][]; groupOf: (i: QueueItem) => string; colorOf?: (i: QueueItem) => string; note?: (g: string) => string; people?: boolean; asked?: (g: string) => number };
const REVIEWING: Kind = { name: 'Reviewing', groups: GROUPS, groupOf };
// My own PRs (and ones assigned to me), by where they stand.
const MINE: Kind = {
  name: `Your ${T.PRs}`,
  groups: [
    ['m-changes', 'Changes requested'],
    ['m-approved', 'Approved'],
    ['m-waiting', 'Waiting for review'],
    ['m-draft', 'Draft'],
  ],
  groupOf: (i) =>
    i.isDraft ? 'm-draft' : i.reviewDecision === 'CHANGES_REQUESTED' ? 'm-changes' : i.reviewDecision === 'APPROVED' ? 'm-approved' : 'm-waiting',
};
// A team's open PRs, one group per member, coloured by where each PR stands (as in "Your PRs").
// Each member's label also says how many reviews they're asked for, to help pick a reviewer who isn't swamped.
// Ordered by whose PR has waited longest for review (ready, not yet approved), by who's least busy, or by name.
type TeamSort = 'waiting' | 'free' | 'name';
const teamKind = (members: string[], load: Record<string, number>, items: QueueItem[], sort: TeamSort): Kind => {
  const waiting: Record<string, string> = {};
  for (const i of items) if (!i.isDraft && i.reviewDecision !== 'APPROVED' && (!waiting[i.author] || i.waitingSince < waiting[i.author])) waiting[i.author] = i.waitingSince;
  const order = [...members].sort(
    sort === 'waiting' ? (a, b) => (waiting[a] ?? '~').localeCompare(waiting[b] ?? '~') || a.localeCompare(b)
    : sort === 'free' ? (a, b) => (load[a] ?? 0) - (load[b] ?? 0) || a.localeCompare(b)
    : (a, b) => a.localeCompare(b),
  );
  return {
    name: `${T.Team}`,
    groups: order.map((m) => [m, m]),
    groupOf: (i) => i.author,
    colorOf: MINE.groupOf,
    note: (m) =>
      [load[m] && `${load[m]} review${load[m] > 1 ? 's' : ''} requested`, waiting[m] && `a ${T.PR} waiting ${since(waiting[m])}`].filter(Boolean).join(' · '),
    people: true,
    asked: (m) => load[m] ?? 0,
  };
};
const avatar = (login: string) => faceOf(login);
type Tab = 'reviewing' | 'mine' | 'team';

// On my PRs: where merging stands (BLOCKED is already told by the group: waiting for review / changes requested).
// Where a PR stands in its repo's merge queue (GitHub's merge train), in words for the pill's tooltip.
const QUEUE_STATE: Record<NonNullable<QueueItem['queue']>['state'], string> = {
  QUEUED: 'In the merge queue, waiting its turn',
  AWAITING_CHECKS: 'In the merge queue: its checks are running',
  MERGEABLE: 'In the merge queue: checks passed, merging soon',
  UNMERGEABLE: "In the merge queue, but it can't merge (failed checks or conflicts); it will be removed",
  LOCKED: 'In the merge queue: being merged',
};

const MERGE_PILL: Partial<Record<QueueItem['mergeState'], [string, string, string]>> = {
  CLEAN: ['ready to merge', 'p-ok', 'merge'],
  HAS_HOOKS: ['ready to merge', 'p-ok', 'merge'],
  UNSTABLE: ['mergeable', 'p-ok', 'merge'], // with the "CI failing" pill beside it
  DIRTY: ['conflicts', 'p-bad', 'conflict'],
};

// A pill on your PR with its fix in a little menu (so a stray click on the list does nothing): idle, working, done, or
// failed (open the menu again to retry).
function QuickPill({ icon, tone, idle, action, busy, done, title, run }: { icon: string; tone: string; idle: string; action: string; busy: string; done: string; title: string; run: () => Promise<unknown> }) {
  const [step, setStep] = useState<'idle' | 'busy' | 'done' | string>('idle');
  const [said, setSaid] = useState(''); // what the action reported, as the done pill's tooltip
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const failed = !['idle', 'busy', 'done'].includes(step);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => (e.type === 'keydown' ? (e as KeyboardEvent).key === 'Escape' : !box.current?.contains(e.target as Node)) && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', away);
    return () => (document.removeEventListener('pointerdown', away), document.removeEventListener('keydown', away));
  }, [open]);
  const stop = (e: Event) => (e.preventDefault(), e.stopPropagation());
  const go = (e: Event) => {
    stop(e);
    setOpen(false);
    setStep('busy');
    run().then(
      (r) => {
        setSaid(typeof r === 'string' ? r : '');
        setStep('done');
        // The list again, so the PR moves to where it now stands (GitHub's search takes a moment to catch up).
        setTimeout(() => dispatchEvent(new Event('lgtm:list-refresh')), 2000);
      },
      (err) => setStep(`failed: ${err.message}`),
    );
  };
  return (
    <span class="pill-drop" ref={box}>
      <button class={step === 'done' ? 'pill p-ok' : failed ? 'pill p-bad' : `pill ${tone}`} title={failed ? step : (step === 'done' && said) || title} aria-expanded={open} onClick={(e) => (stop(e), (step === 'idle' || failed) && setOpen(!open))}>
        {step === 'done' ? <Tg i="approved" t={done} /> : <Tg i={icon} t={step === 'busy' ? busy : step === 'idle' ? idle : "couldn't"} />}
        {step !== 'done' && step !== 'busy' && <span class="caret" aria-hidden="true" />}
      </button>
      {open && <button class="quick-menu" onClick={go}>{failed ? `${action} again` : action}</button>}
    </span>
  );
}
// "behind base": GitHub's Update branch (a merge commit). "CI failing": every failed GitHub Actions job runs again.
const UpdateBase = ({ i }: { i: QueueItem }) => (
  <QuickPill icon="behind" tone="p-warn" idle="behind base" action="Update branch" busy="updating…" done="branch updated" title="Behind its base branch: Update branch merges the base in" run={() => updateBranch({ id: i.id })} />
);
// My PR's QA request (Ask QA): signed off, an issue raised, or how many replies are new since I last looked.
function QaPill({ i }: { i: QueueItem }) {
  const fresh = i.qa!.replies.filter((ts) => ts > qaSeen(`${i.repo}#${i.number}`)).length;
  if (i.qa!.status === 'signed') return <span class="pill p-ok" title="A reply to your QA request signs it off"><Tg i="qa" t="QA signed off" /></span>;
  if (i.qa!.status === 'issue') return <span class="pill p-warn" title="A reply to your QA request mentions a bug, an error or a crash"><Tg i="qa" t="QA: issue raised" /></span>;
  return fresh ? <span class="pill p-reply" title="New replies to your QA request on Slack"><Tg i="qa" n={fresh} t={fresh === 1 ? 'QA reply' : 'QA replies'} /></span> : <span class="pill" title="Your QA request on Slack, no new replies"><Tg i="qa" t="QA asked" /></span>;
}

// Auto-merge with the repo's usual method and GitHub's default message, as the merge box would.
async function autoMerge(i: QueueItem) {
  const s = await getMergeState(i.repo, i.number);
  const m = s.methods[0];
  await mergePR(s, m, s.message[m].title, s.message[m].body, true);
}
// Whoever requested changes, asked to review again on GitHub, then sent the "again" message on Slack (as the PR
// view's re-request does; none if that message is emptied or Slack isn't set up).
async function askAgain(i: QueueItem): Promise<string> {
  await Promise.all(i.changesBy.map((l) => requestReview(i.repo, i.number, l)));
  const text = fillSlack(slackTemplate('again'), prValues({ repo: i.repo, number: i.number, title: i.title, url: prWebUrl(i.repo, i.number), author: i.author }));
  if (!text || !(await slackStatus(`${i.repo}#${i.number}`).catch(() => null))?.configured) return `Asked again on ${site(i.repo)}`;
  try {
    const missed = (await notifySlack(await slackRecipients(i.repo, i.changesBy), text, `${i.repo}#${i.number}`)).filter((r) => !r.ok);
    return missed.length ? `Asked again on ${site(i.repo)}; Slack didn't reach ${missed.map((r) => '@' + r.login).join(', ')}` : `Asked again on ${site(i.repo)} and Slack`;
  } catch (e: any) {
    return `Asked again on ${site(i.repo)}; Slack failed (${e.message})`;
  }
}
async function rerunFailed(i: QueueItem) {
  const runs = [...new Set((await getChecks(i.repo, i.number)).filter((c) => c.state === 'failure' && c.jobId).map(runOf).filter(Boolean))] as string[];
  if (!runs.length) throw new Error("the failed checks aren't GitHub Actions, so they can't be run again from here");
  await Promise.all(runs.map((r) => rerunFailedJobs(i.repo, r)));
}

const DAY = 24 * 3600 * 1000;
// A PR linked to a Claude Code session with commits since it was last opened here (or linked).
const clauded = (i: QueueItem) => {
  const l = linkedSession(i.repo, i.number);
  return !!l && !!i.lastCommitAt && Date.parse(i.lastCommitAt) > (l.seen ?? l.at);
};
const idleDays = (i: QueueItem) => (Date.now() - Date.parse(i.updatedAt)) / DAY;
// On my PRs waiting for review: how long, and (after a day) a Slack nudge to the requested reviewers. Two clicks:
// the first says who gets it, the second sends.
// How long a ready PR has waited for review (asked for, opened or marked ready), amber after 2 days and red after 2
// weeks; on my own, a nudge to its reviewers.
function Waiting({ i, nudge, presence }: { i: QueueItem; nudge: boolean; presence: Record<string, { text: string; emoji: string; until: number }> }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'sending' | string>('idle');
  const days = Math.floor((Date.now() - Date.parse(i.waitingSince)) / DAY);
  if (!(days >= 1) || i.isDraft || i.reviewDecision === 'APPROVED') return null;
  const bots = readBots();
  // Reviewers away (Slack: sick, vacation, leave) aren't nudged.
  const away = i.pendingReviewers.filter((r) => isAway(presence[personKey(i.repo, r)]));
  const to = i.pendingReviewers.filter((r) => !bots.has(r) && !away.includes(r));
  const stop = (e: Event) => (e.preventDefault(), e.stopPropagation());
  const send = async () => {
    setStep('sending');
    try {
      const url = prWebUrl(i.repo, i.number);
      const text = fillSlack(slackTemplate('nudge'), { ...prValues({ repo: i.repo, number: i.number, title: i.title, url, author: i.author }), days: `${days} day${days > 1 ? 's' : ''}` });
      const results = await notifySlack(await slackRecipients(i.repo, to), text, `${i.repo}#${i.number}`);
      const failed = results.filter((r) => !r.ok);
      setStep(failed.length ? `Couldn't nudge ${failed.map((r) => '@' + r.login).join(', ')}` : `Nudged ${results.map((r) => '@' + r.login).join(', ')}`);
    } catch (e: any) {
      setStep(`Slack failed: ${e.message}`);
    }
  };
  return (
    <>
      <span class={days >= 14 ? 'pill p-bad' : days >= 2 ? 'pill p-warn' : 'pill'} title={`Waiting for review since ${new Date(i.waitingSince).toLocaleString()}`}>
        <Tg i="aging" t={`waiting ${since(i.waitingSince)}`} />
      </span>
      {nudge && to.length > 0 &&
        (step === 'idle' ? (
          <button class="pill pill-btn" title="Remind the requested reviewers on Slack" onClick={(e) => (stop(e), setStep('confirm'))}>
            <Tg i="🔔" t="nudge" />
          </button>
        ) : step === 'confirm' ? (
          <button class="pill pill-btn p-strong" onClick={(e) => (stop(e), void send())}>
            Send to {to.map((r) => '@' + r).join(', ')}?{away.length > 0 && ` (not ${away.map((r) => '@' + r).join(', ')}: away)`}
          </button>
        ) : (
          <span class="pill" onClick={stop}>{step === 'sending' ? 'Sending…' : step}</span>
        ))}
    </>
  );
}

const answered: Answered = new Map(); // reviews sent from here, until the list catches up

// While the list loads: its shape, shimmering (style.css .sk), the tabs too unless `rows` is a list's part.
const SK_TITLES = [86, 64, 92, 72, 58, 80];
function ListSkeleton({ rows = 5, tabs = false }: { rows?: number; tabs?: boolean }) {
  return (
    <div class="list-skel" aria-busy="true" aria-label={`Loading the ${T.PRs}`}>
      {tabs && (
        <div class="list-skel-tabs">
          {[0, 1, 2].map(() => <span class="sk" />)}
        </div>
      )}
      {tabs && <span class="sk list-skel-group" />}
      {Array.from({ length: rows }, (_, k) => (
        <div class="list-skel-item">
          <span class="sk" style={{ width: `${SK_TITLES[k % SK_TITLES.length]}%` }} />
          {k % 2 === 0 && <span class="sk" style={{ width: `${SK_TITLES[(k + 3) % SK_TITLES.length] - 30}%` }} />}
          <span class="sk list-skel-meta" />
          <div class="skel-pills">
            <span class="sk sk-pill" style={{ width: '56px' }} />
            <span class="sk sk-pill" style={{ width: `${40 + ((k * 17) % 30)}px` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const closedAsked = new Map<string, number>(); // the bell's PRs asked about, when ("owner/repo#n")

// A coding agent's review of a PR waiting for mine (Settings → Reviewing, agentreview.ts), with its mark: under way,
// what it found and where it put it, or why it couldn't (a click tries again).
function AgentPill({ i }: { i: QueueItem }) {
  const r = agentRunOf(i);
  if (!r) return null;
  const mark = agentIdOf(r.by) ?? '🤖';
  if (r.state === 'queued' || r.state === 'running')
    return <span class="pill p-agent" title={r.state === 'queued' ? 'Waiting for its turn: two at a time' : `${r.by ?? 'The agent'} is reviewing it; you'll find its findings on it`}><Tg i={mark} t={r.state === 'queued' ? 'queued' : 'reviewing…'} /></span>;
  if (r.state === 'limited')
    return <span class="pill p-warn" title={`Today's ${agentLimit()} agent reviews are used up: this one waits for tomorrow (Settings → Reviewing), or ask for it from the ${T.PR}'s Agents menu`}><Tg i={mark} t="limit reached" /></span>;
  if (r.state === 'failed')
    return (
      <span class="pill p-warn" role="button" title={`${r.by ?? 'The agent'} couldn't review it: ${r.error}. Click to try again.`} onClick={(e) => (e.preventDefault(), e.stopPropagation(), retryAgent(i))}>
        <Tg i={mark} t="couldn't review" />
      </span>
    );
  const where = r.posted === 'pending' ? 'in your pending review (Finish review sends them)' : 'as comments';
  return (
    <span class={r.findings ? 'pill p-agent' : 'pill p-ok'} title={r.findings ? `${r.by ?? 'The agent'}'s adversarial review: ${r.findings} finding${r.findings > 1 ? 's' : ''}, ${where}` : `${r.by ?? 'The agent'} found nothing to point out`}>
      {r.findings ? <Tg i={mark} n={r.findings} t={`finding${r.findings > 1 ? 's' : ''}`} /> : <Tg i={mark} t="nothing found" />}
    </span>
  );
}

function PRList({ hidden, over, onReview, current, version, answeredTick, onItems }: { hidden: boolean; over?: boolean; onReview: () => void; current: { repo: string; n: number } | null; version: number; answeredTick: number; onItems: (items: QueueItem[]) => void }) {
  // Claude Code's reviews (agentreview.ts) move PRs between "Agents reviewing" and "Needs your review".
  const [, agentTick] = useState(0);
  useEffect(() => {
    const t = () => agentTick((x) => x + 1);
    addEventListener('lgtm:agents', t);
    return () => removeEventListener('lgtm:agents', t);
  }, []);
  // The last list (per account) shows at once on launch, "updating…" until GitHub's answer replaces it.
  const [loaded, setItems] = useState<QueueItem[] | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(own('queueCache')) ?? 'null');
    } catch {
      return null;
    }
  });
  const [fresh, setFresh] = useState(false);
  // Settings → "Mute replies and mentions on PRs you've approved": their threads wait on no one here (no pill, count,
  // bell entry or inbox thread), until my latest verdict is something else.
  const [muteApproved] = useStoredFlag('muteApproved', true);
  const [badgeInbox] = useStoredFlag('badgeInbox', false); // Settings → App: the inbox counts on the Dock badge too
  const [agents] = useStoredFlag('agentsAsBots', true); // 🤖 comments as a bot's: thread counts asked again
  const rules = `${muteApproved}${agents}`;
  const rulesWas = useRef(rules); // as the last notifications saw them
  const agentsWas = useRef(agents);
  useEffect(() => {
    if (agentsWas.current === agents) return;
    agentsWas.current = agents;
    forgetAllThreadStatus();
    dispatchEvent(new Event('lgtm:list-refresh'));
  }, [agents]);
  const items = useMemo(
    () => loaded && withAnswered(loaded, answered).map((i) => (muteApproved && i.myState === 'APPROVED' && (i.thread?.awaiting || i.mentionWaiting) ? { ...i, thread: i.thread && { ...i.thread, awaiting: 0 }, mentionWaiting: false } : i)),
    [loaded, answeredTick, muteApproved],
  );
  const [err, setErr] = useState('');
  const [showDrafts, toggleDrafts] = useStoredFlag('showDrafts', false);
  const showDraftsRef = useRef(showDrafts); // the refresh timer closes over the first render
  showDraftsRef.current = showDrafts;
  const [paceRaw] = useStoredValue('reviewPace', '150'); // Settings → Time to review: estimates ÷ your pace
  const pace = (Number(paceRaw) || 100) / 100;
  const [tabValue, setTab] = useStoredValue('prTab', 'reviewing'); // which tab, remembered
  const tab = tabValue as Tab;
  const tabRef = useRef(tab); // the refresh timer closes over the first render
  tabRef.current = tab;
  // Team tab: a GitHub team ("org/slug") and its members' open PRs. Settings can change it too.
  const [team, setTeam] = useStoredValue('team', '');
  const [teams, setTeams] = useState<string[] | null>(null);
  const [teamSort, setTeamSort] = useStoredValue('teamSort', 'waiting');
  const [teamData, setTeamData] = useState<{ team: string; members: string[]; items: QueueItem[]; load: Record<string, number> } | null>(null);
  // A member's "Asked to review" list, fetched each time its tab is picked (the last one shows meanwhile).
  const [asked, setAsked] = useState<Record<string, QueueItem[] | string>>({});
  const [askedTab, setAskedTab] = useState<Record<string, boolean>>({});
  const loadAsked = (login: string) =>
    getAskedPRs(team.split('/')[0], login).then((l) => setAsked((a) => ({ ...a, [login]: l })), (e) => setAsked((a) => ({ ...a, [login]: a[login] ?? e.message })));
  const [teamErr, setTeamErr] = useState('');
  const teamRef = useRef(team); // the 3-minute refresh closes over the first render; read the current team here
  teamRef.current = team;
  const requested = useRef(''); // the team last fetched, so a team change (here or in Settings) fetches once
  const loadTeam = (t = teamRef.current) => {
    requested.current = t;
    if (!t) return;
    setTeamErr('');
    getTeamPRs(t).then((d) => {
      setTeamData({ team: t, ...d });
      getEstimates(d.items).then(
        (est) => setTeamData((cur) => (cur?.team === t ? { ...cur, items: cur.items.map((i) => ({ ...i, estimate: est.get(i.id) })) } : cur)),
        () => {},
      );
    }, (e) => setTeamErr(e.message));
  };
  useEffect(() => {
    if (tab === 'team' && !teams) getTeams().then(setTeams, (e) => setTeamErr(e.message));
  }, [tab]);
  // The list shows as soon as it loads; thread status (replies awaiting me, my comments resolved) follows. `settled`
  // marks the second step done, so notifications compare complete lists.
  const [settled, setSettled] = useState(false);
  // GitHub's hourly allowance is shared by every lgtm you have open: the team's PRs only while their tab is open, and
  // in the background the list refreshes every 10 minutes instead of 3 (notifications come a little later).
  const lastLoad = useRef(0);
  const load = () => {
    lastLoad.current = Date.now();
    setErr('');
    if (tabRef.current === 'team') loadTeam();
    getReviewQueue().then(async (queue) => {
      setSettled(false);
      // Drafts showing: also the ones changing files I own, before GitHub asks me (it does once they're ready).
      const owned = showDraftsRef.current ? await getOwnedDrafts([...new Set(queue.map((i) => i.repo))], new Set(queue.map((i) => i.id))).catch(() => []) : [];
      const items = [...queue, ...owned];
      knowRepos(items.map((i) => i.repo));
      knowJiraKeys(items.map((i) => i.title));
      setItems(items);
      // Secondary: the list works without them.
      const [st, est, ms, qa] = await Promise.all([
        getThreadStatus(items, readBots()).catch(() => null),
        getEstimates(items).catch(() => null),
        getMentionStatus(items).catch(() => null),
        qaThreads(items.filter((i) => i.authored).map((i) => `${i.repo}#${i.number}`)).catch(() => null), // only PRs with a QA request are read
      ]);
      const full = items.map((i) => ({ ...i, thread: st?.get(i.id), estimate: est?.get(i.id), mentionWaiting: ms?.get(i.id), qa: qa?.[`${i.repo}#${i.number}`] }));
      setItems(full);
      setSettled(true);
      setFresh(true);
      try {
        localStorage.setItem(own('queueCache'), JSON.stringify(full));
      } catch {}
    }, (e) => setErr(e instanceof TypeError && /fetch|load failed|network/i.test(e.message) ? "Couldn't reach GitHub" : e.message));
  };
  // Unsent comments live in localStorage; re-read them whenever a review page saves drafts.
  const [, setStorageTick] = useState(0);
  useEffect(() => {
    const bump = () => setStorageTick((t) => t + 1);
    addEventListener('lgtm:storage', bump);
    return () => removeEventListener('lgtm:storage', bump);
  }, []);
  const unsent = (i: QueueItem) => {
    try {
      return JSON.parse(localStorage.getItem(own(`drafts:${i.repo}#${i.number}`)) ?? 'null')?.drafts.length ?? 0;
    } catch {
      return 0;
    }
  };
  const [again, setAgain] = useState(0); // a pill's action asks for the list again
  useEffect(() => void (showDrafts && setAgain((n) => n + 1)), [showDrafts]); // drafts on: the ones I own come in now
  useEffect(load, [version, again]);
  useEffect(() => {
    const more = () => setAgain((n) => n + 1);
    addEventListener('lgtm:list-refresh', more);
    addEventListener('online', more); // back from offline or sleep
    return () => (removeEventListener('lgtm:list-refresh', more), removeEventListener('online', more));
  }, []);
  useEffect(() => {
    if (tab === 'team' && (requested.current !== team || !teamData)) loadTeam(team);
  }, [team, tab]);
  useEffect(() => {
    const t = setInterval(() => (!document.hidden || Date.now() - lastLoad.current > 9.5 * 60_000) && load(), 3 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const [notify] = useStoredFlag('notifyRequests', true);
  const [menuBar] = useStoredFlag('menuBar', true);
  const [notifyReplies] = useStoredFlag('notifyReplies', true);
  const [notifyVerdicts] = useStoredFlag('notifyVerdicts', true);
  const [notifyCI] = useStoredFlag('notifyCI', true);
  const [notifyMentions] = useStoredFlag('notifyMentions', true);
  const [notifyQueue] = useStoredFlag('notifyQueue', true);
  const [notifyReady] = useStoredFlag('notifyReady', true);
  const seen = useRef<Set<string> | null>(null);
  const before = useRef<Map<string, QueueItem>>(new Map()); // the list at the last refresh, to notice what changed
  // The Claude Code sessions linked to listed PRs, and what each is doing, every 15 seconds.
  const [claude, setClaude] = useState<Map<string, 'working' | 'waiting' | 'idle'>>(new Map());
  const linkedIds = [...new Set((items ?? []).map((i) => linkedSession(i.repo, i.number)).filter((l) => l && l.agent !== 'codex').map((l) => l!.id))].sort().join(' ');
  useEffect(() => {
    if (!linkedIds) return setClaude(new Map());
    let stop = false;
    const look = () =>
      Promise.all(linkedIds.split(' ').map(async (id) => [id, (await claudeSessionState(id).catch(() => null))?.state ?? 'idle'] as const)).then(
        (r) => !stop && setClaude(new Map(r)),
      );
    look();
    const t = setInterval(look, 15_000);
    return () => ((stop = true), clearInterval(t));
  }, [linkedIds]);
  const claudeWaiting = (i: QueueItem) => claude.get(linkedSession(i.repo, i.number)?.id ?? '') === 'waiting';
  useEffect(() => void (items && onItems(items)), [items]);
  // The bell's entries for a PR that's been merged or closed go: nothing's left to act on. Only the PRs that left the
  // list are asked about, each at most every 30 minutes.
  useEffect(() => {
    if (!items) return;
    const listed = new Set(items.map((i) => `${i.repo}#${i.number}`));
    const ask = [...new Set(notices().map((n) => n.pr))].filter((p) => !listed.has(p) && Date.now() - (closedAsked.get(p) ?? 0) > 30 * 60_000);
    if (!ask.length) return;
    ask.forEach((p) => closedAsked.set(p, Date.now()));
    closedPRs(ask).then((gone) => gone.length && dropNotices((n) => gone.includes(n.pr)), () => {});
  }, [items]);
  useEffect(() => {
    if (!items || !settled) return;
    const waiting = toReview(items, showDrafts);
    // The badge also counts PRs whose Claude Code session is waiting for you, and (Settings) the inbox: threads and
    // mentions waiting on your reply, as the inbox button counts them.
    const inbox = badgeInbox ? repliesWaiting(items) : 0;
    const count = waiting.length + items.filter((i) => !waiting.includes(i) && claudeWaiting(i)).length + inbox;
    document.title = count ? `(${count}) lgtm` : 'lgtm';
    void setBadge(count); // the app's Dock icon
    const forMe = [...waiting, ...items.filter((i) => !waiting.includes(i) && claudeWaiting(i))];
    // The menu bar: what waits on my review, then my own PRs and where each stands.
    const row = (i: QueueItem, section: 'needs' | 'mine') => ({ title: `${i.title} · ${repoLabel(i.repo)}#${i.number}`, route: `/${i.repo}/pull/${i.number}`, section, note: section === 'mine' ? standing(i) : null });
    void setTray(menuBar ? [...forMe.map((i) => row(i, 'needs')), ...items.filter((i) => i.authored).map((i) => row(i, 'mine'))] : null);
    // Notify about review requests that appeared since the last refresh (not the ones already there on open).
    // Then, per switch (Settings → PR list): new replies waiting on me, a verdict on my PR, my PR's checks done.
    // Everything goes on the bell's list (kept until acted on); a desktop notification only per its switch.
    if (seen.current) {
      const tell = (what: string, i: QueueItem, desktop: boolean) => {
        addNotice(what, i.title, `${i.repo}#${i.number}`);
        if (!notify || !desktop) return;
        if (what === 'Ready to merge') sessionStorage.setItem('openMerge', `${i.repo}#${i.number}`); // its merge box opens (merge.tsx)
        void notifyNative(`${what}: ${i.title}`, `${repoLabel(i.repo)}#${i.number} by ${i.author}`, `/${i.repo}/pull/${i.number}`);
      };
      // The mute or what counts as a bot just switched: replies hidden or shown again by it aren't new.
      const flipped = rulesWas.current !== rules;
      const all = { replies: !flipped, verdicts: true, ci: true, queue: true, ready: true };
      const mine = { replies: notifyReplies && !flipped, verdicts: notifyVerdicts, ci: notifyCI, queue: notifyQueue, ready: notifyReady };
      for (const i of waiting.filter((i) => !seen.current!.has(i.id))) tell(i.requested ? 'Review requested' : 'Your comments were resolved', i, true);
      for (const i of items) {
        const was = before.current.get(i.id);
        if (was) {
          const wanted = new Set(queueNews(was, i, mine));
          for (const n of queueNews(was, i, all)) tell(n, i, wanted.has(n));
        } else if (mentionNew(i)) tell('Mentioned you', i, notifyMentions);
        // QA's reply to my request: what it says, else that they replied.
        if (was?.qa && i.qa && i.qa.replies.length > was.qa.replies.length)
          tell(i.qa.status !== was.qa.status && i.qa.status ? (i.qa.status === 'signed' ? 'QA signed off' : 'QA raised an issue') : 'QA replied', i, notifyReplies);
      }
    }
    seen.current = new Set(waiting.map((i) => i.id));
    rulesWas.current = rules;
    before.current = new Map(items.map((i) => [i.id, i]));
  }, [items, settled, claude, menuBar, badgeInbox, showDrafts]);
  // Other people's draft PRs are hidden unless asked for; mine, and the one you're viewing, always show.
  const isCurrent = (i: QueueItem) => current?.repo === i.repo && current.n === i.number;
  const draftCount = items?.filter((i) => i.reviewing && i.isDraft && !isCurrent(i)).length ?? 0;
  const shown = items?.filter((i) => i.mine || showDrafts || !i.isDraft || isCurrent(i));
  const teamDrafts = teamData?.items.filter((i) => i.isDraft && !isCurrent(i)).length ?? 0;
  const teamItems = teamData?.items.filter((i) => showDrafts || !i.isDraft || isCurrent(i)) ?? [];
  // Slack statuses (slackmsg.ts isAway) of the reviewers my PRs wait on, and of the team's members on its tab.
  // A GitLab MR's reviewers by their Slack-people key (login@host): see who().
  const presence = usePresence([...(items ?? []).filter((i) => i.authored).flatMap((i) => i.pendingReviewers.map((r) => personKey(i.repo, r))), ...(tab === 'team' ? (teamData?.members ?? []).map((m) => (isLab(teamData!.team) ? `${m}@${viewAs()}` : m)) : [])]);
  const listed = (i: QueueItem) => inReviewing(i) || (!!i.mentioned && !i.reviewing && !i.authored && isCurrent(i)); // the one you're on stays
  // The top PRs waiting on me load ahead, a few at a time, so opening one is instant; only ones that changed since
  // their cached copy, and not while lgtm is in the background.
  useEffect(() => {
    if (!items || !settled || document.hidden) return;
    const next = items.filter((i) => !isCurrent(i) && ((i.reviewing && groupOf(i) === 'needs' && !i.isDraft) || (i.authored && (i.thread?.awaiting ?? 0) > 0))).slice(0, 5);
    let stop = false;
    (async () => {
      for (const i of next) {
        if (stop) return;
        const key = `${i.repo}#${i.number}`;
        if ((await prCache.get<LoadedPR>(key))?.v.pr.updated_at === i.updatedAt) continue;
        await loadPR(i.repo, i.number).then((d) => prCache.set(key, d), () => {});
      }
    })();
    return () => void (stop = true);
  }, [items, settled]);

  // who: the person the list is already about (you on "Your PRs", the member on their PRs tab); their face is left out.
  // Resting the pointer on a PR loads it ahead (once it changed since its saved copy), so opening it is instant.
  const hoverTimer = useRef(0);
  const preload = (i: QueueItem) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(async () => {
      const key = `${i.repo}#${i.number}`;
      if (isCurrent(i) || (await prCache.get<LoadedPR>(key))?.v.pr.updated_at === i.updatedAt) return;
      loadPR(i.repo, i.number).then((d) => prCache.set(key, d), () => {});
    }, 350);
  };
  const item = (kind: Kind, i: QueueItem, layer?: string, who?: string) => (
    <a key={i.id} class={`pr-item g-${(kind.colorOf ?? kind.groupOf)(i)}${isCurrent(i) ? ' cur' : ''}`} href={`#/${i.repo}/pull/${i.number}`} onMouseEnter={() => preload(i)} onMouseLeave={() => clearTimeout(hoverTimer.current)}>
      <span class="pr-title">{i.title}</span>
      <span class="meta">
        {i.face !== who && <><span class="person-link" onClick={toPerson(i.face, i.repo)}><img class="pr-face" src={avatar(i.face)} alt="" title={`${i.face === i.author ? `@${i.author}` : `@${i.face}, assigned (opened by ${i.author})`}: their page`} /> {i.face}</span> ·{' '}</>}
        {layer && <b class="layer">{layer} </b>}
        {repoLabel(i.repo)}{numRef(i.repo, i.number)} ·{' '}
        <span class={idleDays(i) >= 7 ? 'idle old' : 'idle'} title={`Last activity (commits, comments, reviews): ${new Date(i.updatedAt).toLocaleString()}`}>
          active <Time at={i.updatedAt} />
        </span>
      </span>
      <span class="pills">
        {unsent(i) > 0 && <span class="pill p-warn"><Tg i="unsent" n={unsent(i)} t={`unsent comment${unsent(i) > 1 ? 's' : ''}`} /></span>}
        {(i.thread?.awaiting ?? 0) > 0 && <span class="pill p-reply"><Tg i="reply" n={i.thread!.awaiting} t="awaiting your reply" /></span>}
        {kind === REVIEWING && reReview(i) && (
          <span class="pill p-strong" title={i.requested ? 'The author asked for your review again' : 'Every thread you commented in is resolved'}><Tg i="again" t="re-review" /></span>
        )}
        {!i.reviewing && i.mentioned && <span class="pill p-reply" title="Someone @-mentions you in it"><Tg i="mention" t="mentioned you" /></span>}
        {kind === MINE && i.pendingReviewers.filter((r) => isAway(presence[personKey(i.repo, r)])).map((r) => (
          <span class="pill p-warn" title={`Waiting on @${r}, away on Slack: ${statusText(presence[personKey(i.repo, r)])}`}>🌴 @{r} away</span>
        ))}
        {i.codeOwner && <span class="pill" title="It changes files you own (CODEOWNERS). GitHub asks code owners once it's marked ready for review"><Tg i="assigned" t="code owner" /></span>}
        {(i.ci === 'FAILURE' || i.ci === 'ERROR') &&
          (kind === MINE ? (
            <QuickPill icon="ci" tone="p-bad" idle="CI failing" action="Re-run failed jobs" busy="re-running…" done="re-running failed jobs" title="Its checks failed: Re-run failed jobs runs the failed GitHub Actions jobs again" run={() => rerunFailed(i)} />
          ) : (
            <span class="pill p-bad"><Tg i="ci" t="CI failing" /></span>
          ))}
        {!i.isDraft && i.noReviewers && (
          <button
            class="pill p-warn"
            title={i.authored ? 'Nobody has been asked to review it yet: pick reviewers' : 'Nobody has been asked to review it yet'}
            onClick={(e) => (e.preventDefault(), e.stopPropagation(), showReviewers(`/${i.repo}/pull/${i.number}`))}
          >
            <Tg i="nobody" t="no reviewers" />
          </button>
        )}
        {kind !== MINE && i.mergeState === 'DIRTY' && <span class="pill p-bad"><Tg i="conflict" t="conflicts" /></span>}
        {i.isDraft && kind !== MINE && <span class="pill"><Tg i="draft" t="draft" /></span>}
        {i.isDraft && kind === MINE && <QuickPill icon="draft" tone="" idle="draft" action="Ready for review" busy="marking…" done="ready for review" title="A draft: Ready for review lets its reviewers know" run={() => markReady(i.id)} />}
        {kind.colorOf && !i.isDraft && (
          <span class={'pill ' + { APPROVED: 'p-ok', CHANGES_REQUESTED: 'p-bad', REVIEW_REQUIRED: '' }[i.reviewDecision ?? 'REVIEW_REQUIRED']}>
            <Tg i={DECISION[i.reviewDecision ?? 'REVIEW_REQUIRED'][0]} t={DECISION[i.reviewDecision ?? 'REVIEW_REQUIRED'][1]} />
          </span>
        )}
        {i.assigned && !i.authored && <span class="pill"><Tg i="assigned" t="assigned to you" /></span>}
        {kind === REVIEWING && !reReview(i) && i.newSinceApproval > 0 && (
          <span class="pill p-warn" title="Commits written since you approved it (not rebases or merges of the base): worth another look before it merges">
            <Tg i="pushed" n={i.newSinceApproval} t={`commit${i.newSinceApproval > 1 ? 's' : ''} since your approval`} />
          </span>
        )}
        {kind === REVIEWING && !reReview(i) && i.reviewDecision === 'APPROVED' && i.myState !== 'APPROVED' && <span class="pill p-ok"><Tg i="approved" t={`${T.PR} approved`} /></span>}
        {kind === REVIEWING && !reReview(i) && i.reviewDecision === 'CHANGES_REQUESTED' && i.myState !== 'CHANGES_REQUESTED' && <span class="pill p-bad"><Tg i="changes" t={`${T.PR} changes requested`} /></span>}
        {kind === MINE && !i.isDraft && i.mergeState === 'BEHIND' && <UpdateBase i={i} />}
        {kind === MINE && !i.isDraft && i.reviewDecision === 'CHANGES_REQUESTED' && i.changesBy.length > 0 && (
          <QuickPill icon="changes" tone="p-bad" idle="changes requested" action={`Ask ${i.changesBy.map((l) => '@' + l).join(', ')} again`} busy="asking…" done="asked again" title="Once you've made the changes: ask whoever requested them to review again" run={() => askAgain(i)} />
        )}
        {kind === MINE && !i.isDraft && i.reviewDecision === 'APPROVED' && i.mergeState === 'BLOCKED' && i.canAutoMerge && !i.autoMerge && !i.queue && (
          <QuickPill icon="auto" tone="" idle={i.ci === 'PENDING' || i.ci === 'EXPECTED' ? 'checks running' : 'blocked'} action="Enable auto-merge" busy="enabling…" done="auto-merge on" title="Approved, but can't merge yet: Enable auto-merge merges it once it can (the repo's usual method)" run={() => autoMerge(i)} />
        )}
        {kind === MINE && i.qa && <QaPill i={i} />}
        {kind === MINE && !i.isDraft && MERGE_PILL[i.mergeState] && <span class={'pill ' + MERGE_PILL[i.mergeState]![1]}><Tg i={MERGE_PILL[i.mergeState]![2]} t={MERGE_PILL[i.mergeState]![0]} /></span>}
        {i.queue ? (
          <span class={i.queue.state === 'UNMERGEABLE' ? 'pill p-bad' : 'pill p-ok'} title={QUEUE_STATE[i.queue.state]}>
            {i.queue.state === 'UNMERGEABLE' ? <Tg i="queue" t="queue: can't merge" /> : <Tg i="queue" n={`#${i.queue.position}`} t="in merge queue" />}
          </span>
        ) : (
          i.autoMerge &&
          (kind === MINE ? (
            <QuickPill icon="auto" tone="p-ok" idle="auto-merge on" action="Disable auto-merge" busy="disabling…" done="auto-merge off" title="It merges by itself once its checks and reviews pass" run={() => disableAutoMerge(i.id)} />
          ) : (
            <span class="pill p-ok" title="It merges by itself once its checks and reviews pass"><Tg i="auto" t="auto-merge on" /></span>
          ))
        )}
        {kind === REVIEWING && <AgentPill i={i} />}
        {claudeWaiting(i) && <span class="pill p-session-wait" title="Its Claude Code session is waiting for your answer"><Tg i="✳" t="waiting for you" /></span>}
        {clauded(i) && (linkedSession(i.repo, i.number)?.agent === 'codex'
          ? <span class="pill p-agent" title="Its Codex conversation pushed commits since you last opened it here"><Tg i="codex" t="updated" /></span>
          : <span class="pill p-agent" title="Its Claude Code session pushed commits since you last opened it here"><Tg i="✳" t="updated" /></span>)}
        {(kind.colorOf ?? kind.groupOf)(i) === 'm-waiting' || (kind === REVIEWING && groupOf(i) === 'needs') ? <Waiting i={i} nudge={kind === MINE} presence={presence} /> : null}
        {i.estimate && <span
          class="pill p-time"
          title={`Rough time to review: the description (${i.estimate.words} words), then ${Math.round(i.estimate.code)} lines of code, ${Math.round(i.estimate.tests)} of tests and ${Math.round(i.estimate.docs)} of docs (deleted lines count a third; generated files and lockfiles are skipped)${pace !== 1 ? `, at your ${Math.round(pace * 100)}% pace` : ''}${i.files > 100 ? '. Only the first 100 files are counted' : ''}. See Settings → Time to review`}
        >
          <Tg i="⏱" n={estimateLabel(i.estimate.minutes / pace)} />
        </span>}
        <span class="pill p-size" title={`${i.files} changed files`}>
          <b class="a">+{num(i.additions)}</b> <b class="d">−{num(i.deletions)}</b> · {num(i.files)} file{i.files === 1 ? '' : 's'}
        </span>
      </span>
    </a>
  );

  // One section: PRs grouped by status. Each layer of a stack sits in its own group; layers that share a group stay
  // together as a (partial) stack box, and every layer keeps its position in the whole stack ("2/4").
  const section = (kind: Kind, list: QueueItem[]) => {
    const layerOf = new Map(findStacks(list).flatMap((st) => st.map((i, k) => [i.id, `${k + 1}/${st.length}`] as const)));
    return (
      <>
        {kind.groups.map(([g, label]) => {
          const inGroup = list.filter((i) => kind.groupOf(i) === g);
          if (g === 'agents' && !inGroup.length && !agentReviewOn()) return null;
          const own = (i: QueueItem) => (kind.people ? g : kind === MINE && i.authored ? i.author : undefined);
          const stackOf = new Map(findStacks(inGroup).flatMap((st) => st.map((i) => [i.id, st] as const)));
          const entries = inGroup.filter((i) => !stackOf.has(i.id) || stackOf.get(i.id)!.at(-1) === i).map((i) => stackOf.get(i.id) ?? i);
          return (
            <ListGroup key={g} k={kind.people ? '' : `${kind.name}:${g}`} initial={!kind.people && (!g.endsWith('approved') || inGroup.length < 10)} class={'pr-group g-' + g}>
              <summary>
                {kind.people ? <img class="g-face person-link" src={avatar(g)} alt="" title={`@${g}: their page`} onClick={toPerson(g)} /> : <span class="gdot" />} {label} <span class="count">{inGroup.length}</span>
                {kind.people && isAway(presence[viewAs() ? `${g}@${viewAs()}` : g]) && <span class="g-away" title={`Away on Slack: ${statusText(presence[viewAs() ? `${g}@${viewAs()}` : g])}`}>🌴 away</span>}
                {kind.note?.(g) && <span class="g-note" title={`Open ${T.PRs} asking this person, by name, for a review; how long their oldest ${T.PR} has waited for one`}>{kind.note(g)}</span>}
              </summary>
              {!!kind.asked?.(g) && (
                <div class="member-tabs" role="tablist">
                  <button role="tab" aria-selected={!askedTab[g]} onClick={() => setAskedTab((a) => ({ ...a, [g]: false }))}>
                    PRs <span class="count">{inGroup.length}</span>
                  </button>
                  <button role="tab" aria-selected={!!askedTab[g]} onClick={() => (setAskedTab((a) => ({ ...a, [g]: true })), loadAsked(g))}>
                    Asked to review <span class="count">{kind.asked(g)}</span>
                  </button>
                </div>
              )}
              {askedTab[g] && kind.asked?.(g)
                ? typeof asked[g] === 'string' ? <p class="error">{asked[g] as string}</p> : asked[g] ? (asked[g] as QueueItem[]).map((i) => item(kind, i)) : <ListSkeleton rows={2} />
                : entries.map((e) =>
                    Array.isArray(e) ? (
                      <div class="stack" key={e[0].id}>
                        <div class="stack-h"><Octicon name="stack" /> Stack · bottom first</div>
                        {e.map((i) => item(kind, i, layerOf.get(i.id), own(i)))}
                      </div>
                    ) : (
                      item(kind, e, layerOf.get(e.id), own(e))
                    ),
                  )}
            </ListGroup>
          );
        })}
      </>
    );
  };

  return (
    <aside class={`side prs${hidden ? ' collapsed' : ''}${over ? ' over' : ''}`} aria-hidden={hidden}>
      <div class="side-scroll">
      {err && (
        <p class="error">
          {err}
          <button class="link" onClick={() => setAgain((n) => n + 1)}>Retry</button>
        </p>
      )}
      {shown && !fresh && !err && <p class="list-updating"><span class="sk-dot" /> Updating…</p>}
      {shown && (
        <div class="pr-tabs" role="tablist">
          {([['reviewing', 'Reviewing', shown.filter(listed).length], ['mine', `Your ${T.PRs}`, shown.filter((i) => i.mine).length], ['team', `${T.Team}`, teamData && teamItems.length]] as const).map(([t, name, n]) => (
            <button role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {name} {n != null && <span class="count">{n}</span>}
            </button>
          ))}
        </div>
      )}
      {tab === 'reviewing' && shown && ((c) => c > 0 && (
        <button class="primary review-all" onClick={() => onReview()} title={`The ${T.PRs} that need your review, longest-waiting first, with nothing else on screen (⇧⌘R in the app)`}>
          <Octicon name="play" /> Review {c} {T.PR}{c > 1 ? 's' : ''}
        </button>
      ))(toReview(shown, showDrafts).length)}
      {(tab === 'reviewing' || tab === 'team') && ((c) => c > 0 && (
        <button class="drafts-toggle" onClick={toggleDrafts}>
          {showDrafts ? `Hide ${c} draft ${T.PR}${c > 1 ? 's' : ''}` : `${c} draft ${T.PR}${c > 1 ? 's' : ''} hidden · show`}
        </button>
      ))(tab === 'team' ? teamDrafts : draftCount)}
      {!shown ? (
        !err && <ListSkeleton tabs />
      ) : (
        <>
          {tab === 'mine' && section(MINE, shown.filter((i) => i.mine))}
          {tab === 'reviewing' && section(REVIEWING, shown.filter(listed))}
          {tab === 'team' && (
            <>
              <div class="team-head">
                <select class="team-pick" value={team} onChange={(e) => setTeam(e.currentTarget.value)} aria-label="GitHub team">
                  <option value="">Pick a {T.site} {T.team}…</option>
                  {[...new Set([...(team ? [team] : []), ...(teams ?? [])])].map((t) => <option value={t}>{teamLabel(t)}</option>)}
                </select>
                <select value={teamSort} onChange={(e) => setTeamSort(e.currentTarget.value)} aria-label="Order members by">
                  <option value="waiting">Waiting longest</option>
                  <option value="free">Least busy</option>
                  <option value="name">Name</option>
                </select>
              </div>
              {teamErr && <p class="error">{teamErr}</p>}
              {team && !teamData && !teamErr && <ListSkeleton rows={4} />}
              {teamData?.team === team && section(teamKind(teamData.members, teamData.load, teamData.items, teamSort as TeamSort), teamItems)}
            </>
          )}
        </>
      )}
      </div>
      <Resizer name="prs" label={`${T.PR} list`} />
    </aside>
  );
}

// A PR opened with ?claude=<session> or ?codex=<conversation> (the lgtm-review skill): remember it for that PR, and drop
// it from the route.
function takeClaudeLink() {
  const from = location.hash.match(/[?&](claude|codex)=([\w-]{1,80})/);
  const r = from && parseRoute(location.hash);
  if (!r) return;
  linkSession(r.repo, r.n, from![2], from![1] === 'codex' ? 'codex' : undefined);
  history.replaceState(null, '', `#/${r.repo}/pull/${r.n}`);
}
takeClaudeLink();

render(<App />, document.getElementById('app')!);
