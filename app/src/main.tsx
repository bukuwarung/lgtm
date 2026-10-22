import '@fontsource-variable/jetbrains-mono';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getReviewQueue, getThreadStatus, loadToken, type QueueItem } from './github.ts';
import { Review } from './review.tsx';
import { findStacks } from './stacks.ts';
import { useStoredFlag } from './platform.ts';
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

  useEffect(() => {
    const onHash = () => setRoute(location.hash);
    addEventListener('hashchange', onHash);
    loadToken().then(() => setState('in'), (e) => setState({ error: e.message }));
    return () => removeEventListener('hashchange', onHash);
  }, []);

  if (state === 'loading') return null;
  if (typeof state === 'object')
    return (
      <div class="signin">
        <h1 class="brand">
          <img src="/favicon.png" alt="" width="32" height="32" /> lgtm
        </h1>
        <p class="error">{state.error}</p>
        <p class="note">lgtm signs in with the GitHub CLI. Start it with the <code>lgtm</code> command, not by opening the file directly.</p>
      </div>
    );

  const r = parseRoute(route);
  return (
    <>
      <nav class="top">
        <button title="Toggle pull request list" onClick={togglePRs}>☰</button>
        <a href="#" class="brand">
          <img src="/favicon.png" alt="" width="22" height="22" /> lgtm
        </a>
        <span class="spacer" />
        <ThemeToggle />
      </nav>
      <div class={showPRs ? 'shell' : 'shell no-prs'}>
        {showPRs && <PRList current={r} version={queueVersion} />}
        {r ? (
          <Review key={route} repo={r.repo} n={r.n} onSubmitted={() => setQueueVersion((v) => v + 1)} />
        ) : (
          <p class="note page empty">Pick a pull request from the list, or paste a PR URL above it.</p>
        )}
      </div>
    </>
  );
}

const THEMES = [['', '◐ Auto'], ['light', '☀ Light'], ['dark', '☾ Dark']] as const;

// Cycles auto → light → dark; index.html applies the saved choice before first paint.
function ThemeToggle() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? '');
  const i = THEMES.findIndex(([t]) => t === theme);
  const next = THEMES[(i + 1) % THEMES.length][0];
  return (
    <button
      title={`Theme: ${THEMES[i][1].slice(2)} (click for ${THEMES[(i + 1) % THEMES.length][1].slice(2)})`}
      onClick={() => {
        if (next) document.documentElement.dataset.theme = next;
        else delete document.documentElement.dataset.theme;
        try {
          if (next) localStorage.setItem('theme', next);
          else localStorage.removeItem('theme');
        } catch {
          // per-viewer convenience only
        }
        setTheme(next);
      }}
    >
      {THEMES[i][1]}
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
const groupOf = (i: QueueItem): Group =>
  i.requested || backToMe(i) ? 'needs'
  : i.myState === 'APPROVED' ? 'approved' : i.myState === 'CHANGES_REQUESTED' ? 'changes' : 'commented';

// A sidebar section: its groups in priority order, and which group a PR falls in.
type Kind = { name: string; groups: [string, string][]; groupOf: (i: QueueItem) => string };
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

// On my PRs: where merging stands (BLOCKED is already told by the group: waiting for review / changes requested).
const MERGE_PILL: Partial<Record<QueueItem['mergeState'], [string, string]>> = {
  CLEAN: ['ready to merge', 'p-ok'],
  HAS_HOOKS: ['ready to merge', 'p-ok'],
  UNSTABLE: ['mergeable', 'p-ok'], // with the "CI failing" pill beside it
  BEHIND: ['behind base', ''],
  DIRTY: ['conflicts', 'p-bad'],
};

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]] as const;
function ago(iso: string) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const u = UNITS.find(([, n]) => Math.abs(s) >= n);
  return u ? rtf.format(Math.round(s / u[1]), u[0]) : 'just now';
}

function PRList({ current, version }: { current: { repo: string; n: number } | null; version: number }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [err, setErr] = useState('');
  const [url, setUrl] = useState('');
  const [showDrafts, toggleDrafts] = useStoredFlag('showDrafts', false);
  const [mineTab, toggleTab] = useStoredFlag('mineTab', false); // which tab: Reviewing or Your PRs
  // The list shows as soon as it loads; thread status (replies awaiting me, my comments resolved) follows. `settled`
  // marks the second step done, so notifications compare complete lists.
  const [settled, setSettled] = useState(false);
  const load = () => {
    setErr('');
    getReviewQueue().then(async (items) => {
      setSettled(false);
      setItems(items);
      const st = await getThreadStatus(items).catch(() => null); // secondary: the list works without it
      if (st) setItems(items.map((i) => ({ ...i, thread: st.get(i.id) })));
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
    const t = setInterval(load, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const [notify, toggleNotify] = useStoredFlag('notifyRequests', false);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!items || !settled) return;
    const waiting = items.filter((i) => i.reviewing && groupOf(i) === 'needs' && !i.isDraft);
    document.title = waiting.length ? `(${waiting.length}) lgtm` : 'lgtm';
    // Notify about review requests that appeared since the last refresh (not the ones already there on open).
    if (seen.current && notify && Notification.permission === 'granted')
      for (const i of waiting.filter((i) => !seen.current!.has(i.id))) {
        const note = new Notification(`${i.requested ? 'Review requested' : 'Your comments were resolved'}: ${i.title}`, { body: `${i.repo}#${i.number} by ${i.author}`, tag: i.id });
        note.onclick = () => {
          focus();
          location.hash = `/${i.repo}/pull/${i.number}`;
        };
      }
    seen.current = new Set(waiting.map((i) => i.id));
  }, [items, settled]);
  // Other people's draft PRs are hidden unless asked for; mine, and the one you're viewing, always show.
  const isCurrent = (i: QueueItem) => current?.repo === i.repo && current.n === i.number;
  const draftCount = items?.filter((i) => i.reviewing && i.isDraft && !isCurrent(i)).length ?? 0;
  const shown = items?.filter((i) => i.mine || showDrafts || !i.isDraft || isCurrent(i));

  const item = (kind: Kind, i: QueueItem, layer?: string) => (
    <a key={i.id} class={`pr-item g-${kind.groupOf(i)}${isCurrent(i) ? ' cur' : ''}`} href={`#/${i.repo}/pull/${i.number}`}>
      <span class="pr-title">{i.title}</span>
      <span class="meta">
        {layer && <b class="layer">{layer} </b>}
        {i.repo}#{i.number} · {i.author} · {ago(i.updatedAt)}
      </span>
      <span class="pills">
        {unsent(i) > 0 && <span class="pill p-warn">{unsent(i)} unsent comment{unsent(i) > 1 ? 's' : ''}</span>}
        {(i.thread?.awaiting ?? 0) > 0 && <span class="pill p-reply">💬 {i.thread!.awaiting} awaiting your reply</span>}
        {kind === REVIEWING && backToMe(i) && <span class="pill p-ok">your comments resolved</span>}
        {(i.ci === 'FAILURE' || i.ci === 'ERROR') && <span class="pill p-bad">CI failing</span>}
        {kind === REVIEWING && i.mergeState === 'DIRTY' && <span class="pill p-bad">conflicts</span>}
        {i.isDraft && kind === REVIEWING && <span class="pill">draft</span>}
        {i.assigned && !i.authored && <span class="pill">assigned to you</span>}
        {i.requested && i.myState && <span class="pill">re-requested</span>}
        {kind === REVIEWING && i.reviewDecision === 'APPROVED' && <span class="pill p-ok">PR approved</span>}
        {kind === REVIEWING && i.reviewDecision === 'CHANGES_REQUESTED' && <span class="pill p-bad">PR changes requested</span>}
        {kind === MINE && !i.isDraft && MERGE_PILL[i.mergeState] && <span class={'pill ' + MERGE_PILL[i.mergeState]![1]}>{MERGE_PILL[i.mergeState]![0]}</span>}
        {kind === MINE && i.autoMerge && <span class="pill">auto-merge on</span>}
        <span class="pill p-size" title={`${i.files} changed files`}>
          <b class="a">+{i.additions}</b> <b class="d">−{i.deletions}</b> · {i.files} file{i.files === 1 ? '' : 's'}
        </span>
      </span>
    </a>
  );

  // One section: PRs grouped by status. A stack sits in the group of its most urgent layer; each layer keeps its own color.
  const section = (kind: Kind, list: QueueItem[]) => {
    const stackOf = new Map(findStacks(list).flatMap((st) => st.map((i) => [i.id, st] as const)));
    const rank = (i: QueueItem) => kind.groups.findIndex(([g]) => g === kind.groupOf(i));
    const entries = list.filter((i) => !stackOf.has(i.id) || stackOf.get(i.id)!.at(-1) === i).map((i) => stackOf.get(i.id) ?? i);
    const groups = Map.groupBy(entries, (e) => (Array.isArray(e) ? kind.groups[Math.min(...e.map(rank))][0] : kind.groupOf(e)));
    return (
      <>
        {kind.groups.map(([g, label]) => {
          const inGroup = groups.get(g) ?? [];
          const count = inGroup.reduce((n, e) => n + (Array.isArray(e) ? e.length : 1), 0);
          return (
            <details key={g} open={!g.endsWith('approved') || count < 10} class={'pr-group g-' + g}>
              <summary>
                <span class="gdot" /> {label} <span class="count">{count}</span>
              </summary>
              {inGroup.map((e) =>
                Array.isArray(e) ? (
                  <div class="stack" key={e[0].id}>
                    <div class="stack-h">⧉ Stack of {e.length} · bottom first</div>
                    {e.map((i, k) => item(kind, i, `${k + 1}/${e.length}`))}
                  </div>
                ) : (
                  item(kind, e)
                ),
              )}
            </details>
          );
        })}
      </>
    );
  };

  return (
    <aside class="side prs">
      <div class="side-scroll">
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          const r = parseRoute(url);
          if (r) {
            location.hash = `/${r.repo}/pull/${r.n}`;
            setUrl('');
          } else setErr('That is not a GitHub pull request URL.');
        }}
      >
        <input placeholder="Open PR URL…" value={url} onInput={(e) => setUrl(e.currentTarget.value)} />
        <button type="button" title="Refresh (also refreshes every 3 minutes)" onClick={load}>↻</button>
        <button
          type="button"
          title={notify ? 'Desktop notifications for new review requests: on' : 'Notify me about new review requests'}
          aria-pressed={notify}
          class={notify ? 'on' : ''}
          onClick={async () => {
            if (!notify && (await Notification.requestPermission()) !== 'granted') return setErr('Notifications are blocked for this page in your browser settings.');
            toggleNotify();
          }}
        >
          {notify ? '🔔' : '🔕'}
        </button>
      </form>
      {err && <p class="error">{err}</p>}
      {shown && (
        <div class="pr-tabs" role="tablist">
          {[REVIEWING, MINE].map((k) => (
            <button role="tab" aria-selected={(k === MINE) === mineTab} onClick={() => (k === MINE) !== mineTab && toggleTab()}>
              {k.name} <span class="count">{shown.filter((i) => (k === MINE ? i.mine : i.reviewing)).length}</span>
            </button>
          ))}
        </div>
      )}
      {!mineTab && draftCount > 0 && (
        <button class="drafts-toggle" onClick={toggleDrafts}>
          {showDrafts ? `Hide ${draftCount} draft PR${draftCount > 1 ? 's' : ''}` : `${draftCount} draft PR${draftCount > 1 ? 's' : ''} hidden · show`}
        </button>
      )}
      {!shown ? (
        !err && <p class="note">Loading…</p>
      ) : (
        <>
          {mineTab ? section(MINE, shown.filter((i) => i.mine)) : section(REVIEWING, shown.filter((i) => i.reviewing))}
        </>
      )}
      </div>
      <Resizer name="prs" label="pull request list" />
    </aside>
  );
}

render(<App />, document.getElementById('app')!);
