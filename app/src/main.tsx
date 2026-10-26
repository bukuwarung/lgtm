import '@fontsource-variable/jetbrains-mono';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getEmails, getEstimates, getReviewQueue, getTeamPRs, getTeams, getThreadStatus, loadToken, type QueueItem } from './github.ts';
import { Review } from './review.tsx';
import { findStacks } from './stacks.ts';
import { estimateLabel } from './files.ts';
import { ago, askNotifications, availableUpdate, clipboardPR, copyDiagnostics, initDesktop, isDesktop, notify as notifyNative, notifySlack, openExternal, readBots, setBadge, slackEscape, useStoredFlag, useStoredValue } from './platform.ts';
import { CommandBar } from './palette.tsx';
import { FindBar } from './find.tsx';
import { Settings, THEMES, useTheme } from './settings.tsx';
import { DemoPage } from './demos.tsx';
import { useCodeLook } from './look.ts';
import { Resizer } from './resizer.tsx';

// Accepts "#https://github.com/o/r/pull/1", "#/o/r/pull/1" or a pasted PR URL.
export function parseRoute(s: string) {
  const m = s.match(/([^/\s#]+\/[^/\s]+)\/pull\/(\d+)/);
  return m ? { repo: m[1], n: +m[2] } : null;
}

function App() {
  const [state, setState] = useState<'loading' | 'in' | { error: string }>('loading');
  const [route, setRoute] = useState(location.hash);
  const [queueVersion, setQueueVersion] = useState(0);
  const [showPRs, togglePRs] = useStoredFlag('showPRs', true);
  useCodeLook(); // code colours and font from Settings
  useEffect(() => void initDesktop((r) => (location.hash = r)), []); // the app: links to the browser, lgtm:// links
  // The PR list's latest items (to pick the next PR to review), and a message to show on the page we move to.
  const queue = useRef<QueueItem[]>([]);
  const [flash, setFlash] = useState<{ route: string; text: string; ok: boolean } | null>(null);
  const goNext = async (from: { repo: string; n: number }, notice: { text: string; ok: boolean } | null) => {
    // With the PR list hidden nothing has loaded it; fetch it now (without thread status, so no "comments resolved").
    const items = queue.current.length ? queue.current : await getReviewQueue().catch(() => []);
    const next = items.find((i) => i.reviewing && groupOf(i) === 'needs' && !i.isDraft && !(i.repo === from.repo && i.number === from.n));
    const to = next ? `#/${next.repo}/pull/${next.number}` : '#/done';
    setFlash(notice && { route: to, ...notice });
    setQueueVersion((v) => v + 1);
    location.hash = to.slice(1);
  };

  const signIn = () => loadToken().then(() => setState('in'), (e) => setState({ error: e.message }));
  useEffect(() => {
    const onHash = () => setRoute(location.hash);
    addEventListener('hashchange', onHash);
    void signIn();
    return () => removeEventListener('hashchange', onHash);
  }, []);

  // A short message at the bottom (copied diagnostics, a PR link on the clipboard), with an optional action.
  const [toast, setToast] = useState<{ text: string; action?: [string, () => void] } | null>(null);
  const toastTimer = useRef(0);
  const say = (t: typeof toast, ms = 6000) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms) as unknown as number;
  };

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
    else if (id === 'back') history.back();
    else if (id === 'forward') history.forward();
    else if (id === 'toggle-prs') togglePRs();
    else if (id === 'help') void openExternal('https://github.com/bukuwarung/lgtm#readme');
    else if (id === 'diagnostics')
      void copyDiagnostics().then(() => say({ text: 'Diagnostics copied: paste them into your bug report' }), () => say({ text: "Couldn't copy the diagnostics" }));
  };
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

  if (route.startsWith('#/demo/')) return <DemoPage k={route.slice(7)} />; // README pictures; no sign-in needed
  if (state === 'loading') return null;
  if (typeof state === 'object') return <Setup error={state.error} retry={signIn} />;

  const r = parseRoute(route);
  return (
    <>
      {/* In the app the window has no title bar: this bar holds the traffic lights (left) and drags the window. */}
      <nav class="top" data-tauri-drag-region>
        <button title="Toggle pull request list" onClick={togglePRs}>☰</button>
        <TopActions onRefresh={() => setQueueVersion((v) => v + 1)} />
        <CommandBar queue={() => queue.current} parse={parseRoute} />
        <span class="spacer" />
        {update && (
          <a href="#/settings" class="nav-btn nav-update" title={`lgtm ${update} is out: see Settings`}>
            ⬆ {update}
          </a>
        )}
        <a href="#/settings" class={route === '#/settings' ? 'nav-btn on' : 'nav-btn'} title="Settings">⚙ Settings</a>
        <ThemeToggle />
      </nav>
      {isDesktop && <FindBar />}
      {toast && (
        <div class="toast" role="status">
          {toast.text}
          {toast.action && (
            <button class="primary" onClick={() => (toast.action![1](), setToast(null))}>
              {toast.action[0]}
            </button>
          )}
          <button title="Dismiss" onClick={() => setToast(null)}>✕</button>
        </div>
      )}
      <div class={showPRs ? 'shell' : 'shell no-prs'}>
        {/* Hidden, not unmounted: reopening shows the list as it was, without loading it again. */}
        <PRList hidden={!showPRs} current={r} version={queueVersion} onItems={(items) => (queue.current = items)} />
        {r ? (
          <Review
            key={route}
            repo={r.repo}
            n={r.n}
            onSubmitted={() => setQueueVersion((v) => v + 1)}
            onReviewed={(notice) => goNext(r, notice)}
            flash={flash?.route === route ? flash : null}
          />
        ) : route === '#/settings' ? (
          <Settings />
        ) : route === '#/done' ? (
          <div class="page done">
            <img src="/favicon.png" alt="" width="96" height="96" />
            <h2>All caught up!</h2>
            <p>No pull requests need your review right now.</p>
            {flash?.route === route && <p class={flash.ok ? 'notice' : 'warn'}>{flash.text}</p>}
          </div>
        ) : (
          <p class="note page empty">Pick a pull request from the list, or paste a PR link in the box at the top (⌘K).</p>
        )}
      </div>
    </>
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
          <p>lgtm signs in with the GitHub CLI, so it never asks for a password or token. {error}</p>
          <p>In Terminal, run:</p>
          <pre>{missing ? 'brew install gh\ngh auth login' : 'gh auth login'}</pre>
          <p class="note">If your organization enforces SSO, authorize the token for it when GitHub asks.</p>
        </>
      ) : (
        <>
          <p class="error">{error}</p>
          <p class="note">The browser version needs the <code>lgtm</code> command running: start it in Terminal.</p>
        </>
      )}
      <button class="primary" disabled={busy} onClick={() => (setBusy(true), retry().finally(() => setBusy(false)))}>
        {busy ? 'Checking…' : 'Check again'}
      </button>
      <p class="note">Slack messages and Jira tickets are optional: set them up later in ⚙ Settings.</p>
    </div>
  );
}

// The top bar's PR list actions: refresh it, desktop notifications on/off.
function TopActions({ onRefresh }: { onRefresh: () => void }) {
  const [err, setErr] = useState('');
  const [notify, toggleNotify] = useStoredFlag('notifyRequests', false);
  return (
    <div class="top-actions">
      <button type="button" title="Refresh the PR list (also every 3 minutes)" onClick={onRefresh}>↻</button>
      <button
        type="button"
        title={notify ? 'Desktop notifications for new review requests: on' : 'Notify me about new review requests'}
        aria-pressed={notify}
        class={notify ? 'on' : ''}
        onClick={async () => {
          if (!notify && !(await askNotifications())) return setErr(isDesktop ? 'Notifications are off for lgtm in System Settings → Notifications' : 'Notifications are blocked for this page in your browser settings');
          toggleNotify();
        }}
      >
        {notify ? '🔔' : '🔕'}
      </button>
      {err && <span class="top-err">{err}</span>}
    </div>
  );
}

// Cycles auto → light → dark; index.html applies the saved choice before first paint.
function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const i = THEMES.findIndex(([t]) => t === theme);
  const next = THEMES[(i + 1) % THEMES.length];
  return (
    <button title={`Theme: ${THEMES[i][1]} (click for ${next[1]})`} onClick={() => setTheme(next[0])}>
      {THEMES[i][2]} {THEMES[i][1]}
    </button>
  );
}

type Group = 'needs' | 'changes' | 'commented' | 'approved';
const GROUPS: [Group, string][] = [
  ['needs', 'Needs your review'],
  ['changes', 'You requested changes'],
  ['commented', 'You commented'],
  ['approved', 'You approved'],
];
// A PR I commented on or requested changes on comes back to "Needs your review" once every thread I'm in is resolved.
const backToMe = (i: QueueItem) => !i.requested && !!i.myState && i.myState !== 'APPROVED' && !!i.thread?.allMineResolved;
// Back on my plate after I reviewed it: re-requested, or my threads all resolved. Shown as one pill, and the PR-wide
// verdict is hidden then, since it's usually my own earlier one.
const reReview = (i: QueueItem) => (i.requested && (!!i.myState || i.reviewedBefore)) || backToMe(i);
const groupOf = (i: QueueItem): Group =>
  i.requested || backToMe(i) ? 'needs'
  : i.myState === 'APPROVED' ? 'approved' : i.myState === 'CHANGES_REQUESTED' ? 'changes' : 'commented';

// A sidebar section: its groups in priority order, which group a PR falls in, and (if not the group's) its colour.
type Kind = { name: string; groups: [string, string][]; groupOf: (i: QueueItem) => string; colorOf?: (i: QueueItem) => string; note?: (g: string) => string };
const REVIEWING: Kind = { name: 'Reviewing', groups: GROUPS, groupOf };
// My own PRs (and ones assigned to me), by where they stand.
const MINE: Kind = {
  name: 'Your PRs',
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
const teamKind = (members: string[], load: Record<string, number>): Kind => ({
  name: 'Team',
  groups: members.map((m) => [m, m]),
  groupOf: (i) => i.author,
  colorOf: MINE.groupOf,
  note: (m) => (load[m] ? `${load[m]} review${load[m] > 1 ? 's' : ''} requested` : ''),
});
type Tab = 'reviewing' | 'mine' | 'team';

// On my PRs: where merging stands (BLOCKED is already told by the group: waiting for review / changes requested).
const MERGE_PILL: Partial<Record<QueueItem['mergeState'], [string, string]>> = {
  CLEAN: ['ready to merge', 'p-ok'],
  HAS_HOOKS: ['ready to merge', 'p-ok'],
  UNSTABLE: ['mergeable', 'p-ok'], // with the "CI failing" pill beside it
  BEHIND: ['behind base', ''],
  DIRTY: ['conflicts', 'p-bad'],
};

const DAY = 24 * 3600 * 1000;
// On my PRs waiting for review: how long, and (after a day) a Slack nudge to the requested reviewers. Two clicks:
// the first says who gets it, the second sends.
function Waiting({ i }: { i: QueueItem }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'sending' | string>('idle');
  const days = Math.floor((Date.now() - Date.parse(i.waitingSince)) / DAY);
  if (!(days >= 1)) return null;
  const bots = readBots();
  const to = i.pendingReviewers.filter((r) => !bots.has(r));
  const stop = (e: Event) => (e.preventDefault(), e.stopPropagation());
  const send = async () => {
    setStep('sending');
    try {
      const emails = await getEmails(i.repo.split('/')[0], to);
      const url = `https://github.com/${i.repo}/pull/${i.number}`;
      const text = `👋 Could you take a look at <${url}|${slackEscape(`${i.repo}#${i.number} ${i.title}`)}>? It's been waiting for review for ${days} day${days > 1 ? 's' : ''}.`;
      const results = await notifySlack(to.map((login) => ({ login, emails: emails[login] ?? [] })), text, `${i.repo}#${i.number}`);
      const failed = results.filter((r) => !r.ok);
      setStep(failed.length ? `Couldn't nudge ${failed.map((r) => '@' + r.login).join(', ')}` : `Nudged ${results.map((r) => '@' + r.login).join(', ')}`);
    } catch (e: any) {
      setStep(`Slack failed: ${e.message}`);
    }
  };
  return (
    <>
      <span class={days >= 2 ? 'pill p-warn' : 'pill'} title={`Waiting for review since ${new Date(i.waitingSince).toLocaleString()}`}>
        waiting {days} day{days > 1 ? 's' : ''}
      </span>
      {to.length > 0 &&
        (step === 'idle' ? (
          <button class="pill pill-btn" title="Remind the requested reviewers on Slack" onClick={(e) => (stop(e), setStep('confirm'))}>🔔 nudge</button>
        ) : step === 'confirm' ? (
          <button class="pill pill-btn p-strong" onClick={(e) => (stop(e), void send())}>Send to {to.map((r) => '@' + r).join(', ')}?</button>
        ) : (
          <span class="pill" onClick={stop}>{step === 'sending' ? 'Sending…' : step}</span>
        ))}
    </>
  );
}

function PRList({ hidden, current, version, onItems }: { hidden: boolean; current: { repo: string; n: number } | null; version: number; onItems: (items: QueueItem[]) => void }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [err, setErr] = useState('');
  const [showDrafts, toggleDrafts] = useStoredFlag('showDrafts', false);
  const [tabValue, setTab] = useStoredValue('prTab', 'reviewing'); // which tab, remembered
  const tab = tabValue as Tab;
  // Team tab: a GitHub team ("org/slug") and its members' open PRs. Settings can change it too.
  const [team, setTeam] = useStoredValue('team', '');
  const [teams, setTeams] = useState<string[] | null>(null);
  const [teamData, setTeamData] = useState<{ team: string; members: string[]; items: QueueItem[]; load: Record<string, number> } | null>(null);
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
      getEstimates(d.items.map((i) => i.id)).then(
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
  const load = () => {
    setErr('');
    loadTeam();
    getReviewQueue().then(async (items) => {
      setSettled(false);
      setItems(items);
      // Secondary: the list works without them.
      const [st, est] = await Promise.all([getThreadStatus(items, readBots()).catch(() => null), getEstimates(items.map((i) => i.id)).catch(() => null)]);
      setItems(items.map((i) => ({ ...i, thread: st?.get(i.id), estimate: est?.get(i.id) })));
      setSettled(true);
    }, (e) => setErr(e.message));
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
      return JSON.parse(localStorage.getItem(`drafts:${i.repo}#${i.number}`) ?? 'null')?.drafts.length ?? 0;
    } catch {
      return 0;
    }
  };
  useEffect(load, [version]);
  useEffect(() => {
    if (requested.current !== team) loadTeam(team);
  }, [team]);
  useEffect(() => {
    const t = setInterval(load, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const [notify] = useStoredFlag('notifyRequests', false);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => void (items && onItems(items)), [items]);
  useEffect(() => {
    if (!items || !settled) return;
    const waiting = items.filter((i) => i.reviewing && groupOf(i) === 'needs' && !i.isDraft);
    document.title = waiting.length ? `(${waiting.length}) lgtm` : 'lgtm';
    void setBadge(waiting.length); // the app's Dock icon
    // Notify about review requests that appeared since the last refresh (not the ones already there on open).
    if (seen.current && notify)
      for (const i of waiting.filter((i) => !seen.current!.has(i.id)))
        void notifyNative(`${i.requested ? 'Review requested' : 'Your comments were resolved'}: ${i.title}`, `${i.repo}#${i.number} by ${i.author}`, () => {
          location.hash = `/${i.repo}/pull/${i.number}`;
        });
    seen.current = new Set(waiting.map((i) => i.id));
  }, [items, settled]);
  // Other people's draft PRs are hidden unless asked for; mine, and the one you're viewing, always show.
  const isCurrent = (i: QueueItem) => current?.repo === i.repo && current.n === i.number;
  const draftCount = items?.filter((i) => i.reviewing && i.isDraft && !isCurrent(i)).length ?? 0;
  const shown = items?.filter((i) => i.mine || showDrafts || !i.isDraft || isCurrent(i));

  const item = (kind: Kind, i: QueueItem, layer?: string) => (
    <a key={i.id} class={`pr-item g-${(kind.colorOf ?? kind.groupOf)(i)}${isCurrent(i) ? ' cur' : ''}`} href={`#/${i.repo}/pull/${i.number}`}>
      <span class="pr-title">{i.title}</span>
      <span class="meta">
        {layer && <b class="layer">{layer} </b>}
        {i.repo}#{i.number} · {i.author} · {ago(i.updatedAt)}
      </span>
      <span class="pills">
        {unsent(i) > 0 && <span class="pill p-warn">{unsent(i)} unsent comment{unsent(i) > 1 ? 's' : ''}</span>}
        {(i.thread?.awaiting ?? 0) > 0 && <span class="pill p-reply">💬 {i.thread!.awaiting} awaiting your reply</span>}
        {kind === REVIEWING && reReview(i) && (
          <span class="pill p-strong" title={i.requested ? 'The author asked for your review again' : 'Every thread you commented in is resolved'}>↻ re-review</span>
        )}
        {(i.ci === 'FAILURE' || i.ci === 'ERROR') && <span class="pill p-bad">CI failing</span>}
        {kind !== MINE && i.mergeState === 'DIRTY' && <span class="pill p-bad">conflicts</span>}
        {i.isDraft && kind !== MINE && <span class="pill">draft</span>}
        {kind.colorOf && !i.isDraft && (
          <span class={'pill ' + { APPROVED: 'p-ok', CHANGES_REQUESTED: 'p-bad', REVIEW_REQUIRED: '' }[i.reviewDecision ?? 'REVIEW_REQUIRED']}>
            {{ APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'awaiting review' }[i.reviewDecision ?? 'REVIEW_REQUIRED']}
          </span>
        )}
        {i.assigned && !i.authored && <span class="pill">assigned to you</span>}
        {kind === REVIEWING && !reReview(i) && i.reviewDecision === 'APPROVED' && i.myState !== 'APPROVED' && <span class="pill p-ok">PR approved</span>}
        {kind === REVIEWING && !reReview(i) && i.reviewDecision === 'CHANGES_REQUESTED' && i.myState !== 'CHANGES_REQUESTED' && <span class="pill p-bad">PR changes requested</span>}
        {kind === MINE && !i.isDraft && MERGE_PILL[i.mergeState] && <span class={'pill ' + MERGE_PILL[i.mergeState]![1]}>{MERGE_PILL[i.mergeState]![0]}</span>}
        {kind === MINE && i.autoMerge && <span class="pill">auto-merge on</span>}
        {kind === MINE && MINE.groupOf(i) === 'm-waiting' && <Waiting i={i} />}
        {i.estimate && <span
          class="pill p-time"
          title={`Rough time to review: the description (${i.estimate.words} words), then ${Math.round(i.estimate.code)} lines of code, ${Math.round(i.estimate.tests)} of tests and ${Math.round(i.estimate.docs)} of docs (deleted lines count a third; generated files and lockfiles are skipped)${i.files > 100 ? '. Only the first 100 files are counted' : ''}`}
        >
          ⏱ {estimateLabel(i.estimate.minutes)}
        </span>}
        <span class="pill p-size" title={`${i.files} changed files`}>
          <b class="a">+{i.additions}</b> <b class="d">−{i.deletions}</b> · {i.files} file{i.files === 1 ? '' : 's'}
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
          const stackOf = new Map(findStacks(inGroup).flatMap((st) => st.map((i) => [i.id, st] as const)));
          const entries = inGroup.filter((i) => !stackOf.has(i.id) || stackOf.get(i.id)!.at(-1) === i).map((i) => stackOf.get(i.id) ?? i);
          return (
            <details key={g} open={!g.endsWith('approved') || inGroup.length < 10} class={'pr-group g-' + g}>
              <summary>
                <span class="gdot" /> {label} <span class="count">{inGroup.length}</span>
                {kind.note?.(g) && <span class="g-note" title="Open PRs asking this person, by name, for a review">{kind.note(g)}</span>}
              </summary>
              {entries.map((e) =>
                Array.isArray(e) ? (
                  <div class="stack" key={e[0].id}>
                    <div class="stack-h">⧉ Stack · bottom first</div>
                    {e.map((i) => item(kind, i, layerOf.get(i.id)))}
                  </div>
                ) : (
                  item(kind, e, layerOf.get(e.id))
                ),
              )}
            </details>
          );
        })}
      </>
    );
  };

  return (
    <aside class={hidden ? 'side prs collapsed' : 'side prs'} aria-hidden={hidden}>
      <div class="side-scroll">
      {err && <p class="error">{err}</p>}
      {shown && (
        <div class="pr-tabs" role="tablist">
          {([['reviewing', 'Reviewing', shown.filter((i) => i.reviewing).length], ['mine', 'Your PRs', shown.filter((i) => i.mine).length], ['team', 'Team', teamData?.items.length]] as const).map(([t, name, n]) => (
            <button role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {name} {n != null && <span class="count">{n}</span>}
            </button>
          ))}
        </div>
      )}
      {tab === 'reviewing' && draftCount > 0 && (
        <button class="drafts-toggle" onClick={toggleDrafts}>
          {showDrafts ? `Hide ${draftCount} draft PR${draftCount > 1 ? 's' : ''}` : `${draftCount} draft PR${draftCount > 1 ? 's' : ''} hidden · show`}
        </button>
      )}
      {!shown ? (
        !err && <p class="note">Loading…</p>
      ) : (
        <>
          {tab === 'mine' && section(MINE, shown.filter((i) => i.mine))}
          {tab === 'reviewing' && section(REVIEWING, shown.filter((i) => i.reviewing))}
          {tab === 'team' && (
            <>
              <select class="team-pick" value={team} onChange={(e) => setTeam(e.currentTarget.value)} aria-label="GitHub team">
                <option value="">Pick a GitHub team…</option>
                {[...new Set([...(team ? [team] : []), ...(teams ?? [])])].map((t) => <option value={t}>{t}</option>)}
              </select>
              {teamErr && <p class="error">{teamErr}</p>}
              {team && !teamData && !teamErr && <p class="note">Loading…</p>}
              {teamData?.team === team && section(teamKind(teamData.members, teamData.load), teamData.items)}
            </>
          )}
        </>
      )}
      </div>
      <Resizer name="prs" label="pull request list" />
    </aside>
  );
}

render(<App />, document.getElementById('app')!);
