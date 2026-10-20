import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getReviewQueue, loadToken, type QueueItem } from './github.ts';
import { Review } from './review.tsx';

// Accepts "#https://github.com/o/r/pull/1", "#/o/r/pull/1" or a pasted PR URL.
export function parseRoute(s: string) {
  const m = s.match(/([^/\s#]+\/[^/\s]+)\/pull\/(\d+)/);
  return m ? { repo: m[1], n: +m[2] } : null;
}

function App() {
  const [state, setState] = useState<'loading' | 'in' | { error: string }>('loading');
  const [route, setRoute] = useState(location.hash);
  const [queueVersion, setQueueVersion] = useState(0);
  const [showPRs, setShowPRs] = useState(() => {
    try {
      return localStorage.getItem('hidePRs') !== '1';
    } catch {
      return true;
    }
  });
  const togglePRs = () => {
    setShowPRs(!showPRs);
    try {
      localStorage.setItem('hidePRs', showPRs ? '1' : '0');
    } catch {
      // per-viewer convenience only
    }
  };

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
        <h1>lgtm</h1>
        <p class="error">{state.error}</p>
        <p class="note">lgtm signs in with the GitHub CLI. Start it with the <code>lgtm</code> command, not by opening the file directly.</p>
      </div>
    );

  const r = parseRoute(route);
  return (
    <>
      <nav class="top">
        <button title="Toggle pull request list" onClick={togglePRs}>☰</button>
        <a href="#">lgtm</a>
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
const groupOf = (i: QueueItem): Group =>
  i.requested ? 'needs' : i.myState === 'APPROVED' ? 'approved' : i.myState === 'CHANGES_REQUESTED' ? 'changes' : 'commented';

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
  const load = () => {
    setErr('');
    getReviewQueue().then(setItems, (e) => setErr(e.message));
  };
  useEffect(load, [version]);
  const groups = items && Map.groupBy(items, groupOf);

  return (
    <aside class="prs">
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
        <button type="button" title="Refresh" onClick={load}>↻</button>
      </form>
      {err && <p class="error">{err}</p>}
      {!groups ? (
        !err && <p class="note">Loading…</p>
      ) : (
        GROUPS.map(([g, label]) => {
          const list = groups.get(g) ?? [];
          return (
            <details key={g} open={g !== 'approved' || list.length < 10} class={'pr-group g-' + g}>
              <summary>
                <span class="gdot" /> {label} <span class="count">{list.length}</span>
              </summary>
              {list.map((i) => (
                <a
                  key={i.id}
                  class={current?.repo === i.repo && current.n === i.number ? 'pr-item cur' : 'pr-item'}
                  href={`#/${i.repo}/pull/${i.number}`}
                >
                  <span class="pr-title">{i.title}</span>
                  <span class="meta">
                    {i.repo}#{i.number} · {i.author} · {ago(i.updatedAt)}
                  </span>
                  <span class="pills">
                    {i.isDraft && <span class="pill">draft</span>}
                    {i.requested && i.myState && <span class="pill">re-requested</span>}
                    {i.reviewDecision === 'APPROVED' && <span class="pill p-ok">PR approved</span>}
                    {i.reviewDecision === 'CHANGES_REQUESTED' && <span class="pill p-bad">PR changes requested</span>}
                  </span>
                </a>
              ))}
            </details>
          );
        })
      )}
    </aside>
  );
}

render(<App />, document.getElementById('app')!);
