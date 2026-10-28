import '@fontsource-variable/jetbrains-mono';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getEmails, getEstimates, renderGfm, getReviewQueue, getTeamPRs, getTeams, getThreadStatus, getViewer, loadPR, queueNews, withAnswered, type Answered, type ReviewEvent, loadToken, type LoadedPR, type QueueItem } from './github.ts';
import { NoticeText, Review } from './review.tsx';
import { findStacks } from './stacks.ts';
import { estimateLabel } from './files.ts';
import { ago, askNotifications, availableUpdate, getGhAccounts, own, setAccount, type GhAccount, claudeSessionState, claudeSkill, fetchIntegrations, keepSkillCurrent, linkClaude, linkedClaude, newer, type Integrations, type SkillStatus, clipboardPR, copyDiagnostics, initDesktop, isDesktop, notify as notifyNative, notifySlack, openExternal, prCache, readBots, setBadge, slackEscape, useStoredFlag, useStoredValue } from './platform.ts';
import { CommandBar } from './palette.tsx';
import { FindBar } from './find.tsx';
import { Settings, THEMES, useTheme } from './settings.tsx';
import { DemoPage } from './demos.tsx';
import { CODE_SIZE, TEXT_SIZE, useCodeLook } from './look.ts';
import { fillSlack, prValues, slackTemplate } from './slackmsg.ts';
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
  const [answeredTick, setAnsweredTick] = useState(0); // a review sent: lay it over the list
  const [refreshing, setRefreshing] = useState(false); // ↻: until the list's next load lands
  const [showPRs, togglePRs] = useStoredFlag('showPRs', true);
  const look = useCodeLook(); // code colours and font, and text sizes, from Settings
  // Glass (Settings → Appearance), unless macOS asks for less transparency.
  const [glass] = useStoredFlag('glass', true);
  useEffect(() => void document.documentElement.classList.toggle('glass', glass && !matchMedia('(prefers-reduced-transparency: reduce)').matches), [glass]);
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
    location.hash = to.slice(1);
  };

  const signIn = () =>
    loadToken()
      .then(() => getViewer().then(setAccount, () => {})) // this account's drafts and the like (platform.ts own)
      .then(() => setState('in'), (e) => setState({ error: e.message }));
  useEffect(() => {
    const onHash = () => (takeClaudeLink(), setRoute(location.hash));
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
  // ⌘+ / ⌘− / ⌘0, as in a browser: the text sizes (Settings → Appearance) a step up, down, or back; code keeps pace.
  // The app's View menu has them (its keys never reach the page); in a browser, the keys here.
  const textStep = (step: number) => {
    const text = step ? Math.min(20, Math.max(11, look.textSize + step)) : TEXT_SIZE;
    const code = step ? Math.min(18, Math.max(10, look.codeSize + step)) : CODE_SIZE;
    look.setTextSize(String(text));
    look.setCodeSize(String(code));
    say({ text: `Text ${text}px · code ${code}px` }, 1500);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const id = e.key === '=' || e.key === '+' ? 'text-bigger' : e.key === '-' ? 'text-smaller' : e.key === '0' ? 'text-reset' : '';
      if (!id) return;
      e.preventDefault();
      onMenu.current(id);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

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
        <button title="Toggle pull request list" onClick={togglePRs}>☰</button>
        <a href="#/settings" class={route === '#/settings' ? 'nav-btn on' : 'nav-btn'} title="Settings">⚙ Settings</a>
        <TopActions
          refreshing={refreshing}
          onRefresh={() => {
            // The PR list, and the PR that's open (it shows "updating…" meanwhile).
            setRefreshing(true);
            setTimeout(() => setRefreshing(false), 15_000); // a failed load still stops the spinning
            setQueueVersion((v) => v + 1);
            dispatchEvent(new Event('lgtm:refresh'));
          }}
        />
        <span class="spacer" />
        <CommandBar queue={() => queue.current} parse={parseRoute} />
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
        <ThemeToggle />
        <AccountMenu />
      </nav>
      {isDesktop && <FindBar />}
      <WhatsNew />
      <SetupCheck />
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
        <PRList hidden={!showPRs} current={r} version={queueVersion} answeredTick={answeredTick} onItems={(items) => ((queue.current = items), setRefreshing(false))} />
        {r ? (
          <Review
            key={route}
            repo={r.repo}
            n={r.n}
            onSubmitted={(event?: ReviewEvent) => {
              if (!event) return setQueueVersion((v) => v + 1); // the merge box changed something: reload now
              // A review: shown in the list at once, reloaded once GitHub's search has caught up with it.
              answered.set(`${r.repo}#${r.n}`, { event, at: Date.now() });
              setAnsweredTick((t) => t + 1);
              setTimeout(() => setQueueVersion((v) => v + 1), 60_000);
            }}
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
            {flash?.route === route && (
              <p class={flash.ok ? 'notice' : 'warn'}>
                <NoticeText text={flash.text} />
              </p>
            )}
          </div>
        ) : (
          <p class="note page empty">Pick a pull request from the list, or paste a PR link in the box at the top (⌘K).</p>
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
  const [skill, setSkill] = useState<SkillStatus | null>(null);
  const check = () => {
    setInts(null);
    fetchIntegrations().then(setInts, () => setInts({ slack: { ok: false, error: "couldn't check" }, jira: { ok: false, error: "couldn't check" } }));
    claudeSkill().then(setSkill, () => setSkill(null));
  };
  useEffect(() => void (open && check()), []);
  if (!open) return null;
  const done = () => {
    try {
      localStorage.setItem('setupSeen', '1');
    } catch {}
    setOpen(false);
  };
  const row = (ok: boolean | null, name: string, what: string, fix: preact.ComponentChildren) => (
    <div class="set-int">
      <span class={ok == null ? 'ck ck-pending' : ok ? 'ck ck-success' : 'ck ck-neutral'}>{ok == null ? '●' : ok ? '✓' : '–'}</span>
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
        <p class="note">lgtm borrows the sign-ins of these tools and stores no tokens. Only GitHub is required; the rest you can set up now or later in ⚙ Settings.</p>
        {row(true, 'GitHub', 'PRs, reviews and comments, through the GitHub CLI.', null)}
        {row(ints ? ints.slack.ok : null, 'Slack', '(optional) DM the author when you finish a review.', <pre>brew install shaharia-lab/tap/slackcli && slackcli auth login-auto</pre>)}
        {row(ints ? ints.jira.ok : null, 'Jira', "(optional) The PR's ticket above its files.", <pre>brew install atlassian/homebrew-acli/acli && acli jira auth login --web</pre>)}
        {row(skill ? skill.current : null, 'Claude Code skill', '(optional) Claude opens PRs ready for review here, linked to its session.', (
          <button onClick={() => claudeSkill(true).then(setSkill, () => {})}>{skill?.installed ? 'Update the skill' : 'Install the skill'}</button>
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
  if (!notes) return null;
  const close = () => (seen(), setNotes(null));
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

// The top bar's actions: refresh the PR list and the open PR, desktop notifications on/off.
function TopActions({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const [err, setErr] = useState('');
  const [notify, toggleNotify] = useStoredFlag('notifyRequests', false);
  return (
    <div class="top-actions">
      <button type="button" class={refreshing ? 'refreshing' : ''} title="Refresh the PR list and the open PR (the list also every 3 minutes)" onClick={onRefresh}>
        <span>↻</span>
      </button>
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
// The GitHub account lgtm uses, as its avatar. A click lists the accounts gh is signed in to; picking another
// switches (the page loads again as that account). Settings → Accounts has the same choice.
const avatarOf = (login: string) => `https://github.com/${encodeURIComponent(login)}.png?size=64`;
function AccountMenu() {
  const [me, setMe] = useState('');
  const [accounts, setAccounts] = useState<GhAccount[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => void getViewer().then(setMe, () => {}), []);
  useEffect(() => {
    if (!open) return;
    getGhAccounts().then(setAccounts, () => setAccounts([]));
    const away = (e: Event) => !(e.target as Element).closest?.('.account') && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', away);
    addEventListener('keydown', esc);
    return () => (removeEventListener('pointerdown', away), removeEventListener('keydown', esc));
  }, [open]);
  if (!me) return null;
  const use = (a: GhAccount) => {
    if (a.login === me) return setOpen(false);
    if (a.active) localStorage.removeItem('ghAccount'); // gh's active one: follow gh
    else localStorage.setItem('ghAccount', a.login);
    location.reload(); // everything loaded so far was as the other account
  };
  return (
    <span class="account">
      <button class="account-btn" title={`GitHub: @${me}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <img src={avatarOf(me)} alt={`@${me}`} />
      </button>
      {open && (
        <div class="account-menu" role="menu">
          <div class="account-head">GitHub accounts in gh</div>
          {accounts == null ? (
            <p class="note">Loading…</p>
          ) : (
            accounts.map((a) => (
              <button role="menuitemradio" aria-checked={a.login === me} class={a.login === me ? 'on' : ''} onClick={() => use(a)}>
                <img src={avatarOf(a.login)} alt="" />
                <span>{a.login}</span>
                {a.active && <small>gh's active</small>}
                {a.login === me && <span class="account-check">✓</span>}
              </button>
            ))
          )}
          <p class="note">
            Add one with <code>gh auth login</code>, then open this again.
          </p>
        </div>
      )}
    </span>
  );
}

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
// A PR linked to a Claude Code session with commits since it was last opened here (or linked).
const clauded = (i: QueueItem) => {
  const l = linkedClaude(i.repo, i.number);
  return !!l && !!i.lastCommitAt && Date.parse(i.lastCommitAt) > (l.seen ?? l.at);
};
const idleDays = (i: QueueItem) => (Date.now() - Date.parse(i.updatedAt)) / DAY;
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
      const text = fillSlack(slackTemplate('nudge'), { ...prValues({ repo: i.repo, number: i.number, title: i.title, url, author: i.author }), days: `${days} day${days > 1 ? 's' : ''}` });
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

const answered: Answered = new Map(); // reviews sent from here, until the list catches up

function PRList({ hidden, current, version, answeredTick, onItems }: { hidden: boolean; current: { repo: string; n: number } | null; version: number; answeredTick: number; onItems: (items: QueueItem[]) => void }) {
  const [loaded, setItems] = useState<QueueItem[] | null>(null);
  const items = useMemo(() => loaded && withAnswered(loaded, answered), [loaded, answeredTick]);
  const [err, setErr] = useState('');
  const [showDrafts, toggleDrafts] = useStoredFlag('showDrafts', false);
  const [paceRaw] = useStoredValue('reviewPace', '100'); // Settings → Time to review: estimates ÷ your pace
  const pace = (Number(paceRaw) || 100) / 100;
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
      return JSON.parse(localStorage.getItem(own(`drafts:${i.repo}#${i.number}`)) ?? 'null')?.drafts.length ?? 0;
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
  const [notifyReplies] = useStoredFlag('notifyReplies', true);
  const [notifyVerdicts] = useStoredFlag('notifyVerdicts', true);
  const [notifyCI] = useStoredFlag('notifyCI', true);
  const seen = useRef<Set<string> | null>(null);
  const before = useRef<Map<string, QueueItem>>(new Map()); // the list at the last refresh, to notice what changed
  // The Claude Code sessions linked to listed PRs, and what each is doing, every 15 seconds.
  const [claude, setClaude] = useState<Map<string, 'working' | 'waiting' | 'idle'>>(new Map());
  const linkedIds = [...new Set((items ?? []).map((i) => linkedClaude(i.repo, i.number)?.id).filter((x): x is string => !!x))].sort().join(' ');
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
  const claudeWaiting = (i: QueueItem) => claude.get(linkedClaude(i.repo, i.number)?.id ?? '') === 'waiting';
  useEffect(() => void (items && onItems(items)), [items]);
  useEffect(() => {
    if (!items || !settled) return;
    const waiting = items.filter((i) => i.reviewing && groupOf(i) === 'needs' && !i.isDraft);
    // The badge also counts PRs whose Claude Code session is waiting for you.
    const count = waiting.length + items.filter((i) => !waiting.includes(i) && claudeWaiting(i)).length;
    document.title = count ? `(${count}) lgtm` : 'lgtm';
    void setBadge(count); // the app's Dock icon
    // Notify about review requests that appeared since the last refresh (not the ones already there on open).
    // Then, per switch (Settings → Pull request list): new replies waiting on me, a verdict on my PR, my PR's checks done.
    if (seen.current && notify) {
      const tell = (what: string, i: QueueItem) =>
        void notifyNative(`${what}: ${i.title}`, `${i.repo}#${i.number} by ${i.author}`, () => {
          location.hash = `/${i.repo}/pull/${i.number}`;
        });
      for (const i of waiting.filter((i) => !seen.current!.has(i.id))) tell(i.requested ? 'Review requested' : 'Your comments were resolved', i);
      for (const i of items) {
        const was = before.current.get(i.id);
        if (was) for (const n of queueNews(was, i, { replies: notifyReplies, verdicts: notifyVerdicts, ci: notifyCI })) tell(n, i);
      }
    }
    seen.current = new Set(waiting.map((i) => i.id));
    before.current = new Map(items.map((i) => [i.id, i]));
  }, [items, settled, claude]);
  // Other people's draft PRs are hidden unless asked for; mine, and the one you're viewing, always show.
  const isCurrent = (i: QueueItem) => current?.repo === i.repo && current.n === i.number;
  const draftCount = items?.filter((i) => i.reviewing && i.isDraft && !isCurrent(i)).length ?? 0;
  const shown = items?.filter((i) => i.mine || showDrafts || !i.isDraft || isCurrent(i));
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

  const item = (kind: Kind, i: QueueItem, layer?: string) => (
    <a key={i.id} class={`pr-item g-${(kind.colorOf ?? kind.groupOf)(i)}${isCurrent(i) ? ' cur' : ''}`} href={`#/${i.repo}/pull/${i.number}`}>
      <span class="pr-title">{i.title}</span>
      <span class="meta">
        {layer && <b class="layer">{layer} </b>}
        {i.repo}#{i.number} · {i.author} ·{' '}
        <span class={idleDays(i) >= 7 ? 'idle old' : 'idle'} title={`Last activity (commits, comments, reviews): ${new Date(i.updatedAt).toLocaleString()}`}>
          active {ago(i.updatedAt)}
        </span>
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
        {claudeWaiting(i) && <span class="pill p-claude-wait" title="Its Claude Code session is waiting for your answer">✳ waiting for you</span>}
        {clauded(i) && <span class="pill p-claude" title="Its Claude Code session pushed commits since you last opened it here">✳ updated</span>}
        {kind === MINE && MINE.groupOf(i) === 'm-waiting' && <Waiting i={i} />}
        {i.estimate && <span
          class="pill p-time"
          title={`Rough time to review: the description (${i.estimate.words} words), then ${Math.round(i.estimate.code)} lines of code, ${Math.round(i.estimate.tests)} of tests and ${Math.round(i.estimate.docs)} of docs (deleted lines count a third; generated files and lockfiles are skipped)${pace !== 1 ? `, at your ${Math.round(pace * 100)}% pace` : ''}${i.files > 100 ? '. Only the first 100 files are counted' : ''}. See Settings → Time to review`}
        >
          ⏱ {estimateLabel(i.estimate.minutes / pace)}
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

// A PR opened with ?claude=<session> (the lgtm-review skill): remember the session for that PR, and drop it from the route.
function takeClaudeLink() {
  const from = location.hash.match(/[?&]claude=([\w-]{1,80})/)?.[1];
  const r = from && parseRoute(location.hash);
  if (!r) return;
  linkClaude(r.repo, r.n, from!);
  history.replaceState(null, '', `#/${r.repo}/pull/${r.n}`);
}
takeClaudeLink();

render(<App />, document.getElementById('app')!);
