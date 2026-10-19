import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  CLIENT_ID, getReviewQueue, loadToken, pollDeviceFlow, saveToken, setUnauthorizedHandler, signOut, startDeviceFlow,
  type DeviceCode, type QueueItem,
} from './github.ts';
import { hasHostAccess, requestHostAccess } from './platform.ts';
import { Review } from './review.tsx';

// Accepts "#https://github.com/o/r/pull/1", "#/o/r/pull/1" or a pasted PR URL.
export function parseRoute(s: string) {
  const m = s.match(/([^/\s#]+\/[^/\s]+)\/pull\/(\d+)/);
  return m ? { repo: m[1], n: +m[2] } : null;
}

function App() {
  const [state, setState] = useState<'loading' | 'noaccess' | 'signedout' | 'in'>('loading');
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

  const check = async () => setState(!(await hasHostAccess()) ? 'noaccess' : (await loadToken()) ? 'in' : 'signedout');
  useEffect(() => {
    setUnauthorizedHandler(() => setState('signedout'));
    const onHash = () => setRoute(location.hash);
    addEventListener('hashchange', onHash);
    check();
    return () => removeEventListener('hashchange', onHash);
  }, []);

  if (state === 'loading') return null;
  if (state === 'noaccess')
    return (
      <div class="signin">
        <h1>lgtm</h1>
        <p>lgtm needs access to github.com and api.github.com to load pull requests.</p>
        <button class="primary" onClick={() => requestHostAccess().then((ok) => { if (ok) check(); })}>
          Grant GitHub access
        </button>
      </div>
    );
  if (state === 'signedout') return <SignIn onDone={() => setState('in')} />;

  const r = parseRoute(route);
  return (
    <>
      <nav class="top">
        <button title="Toggle pull request list" onClick={togglePRs}>☰</button>
        <a href="#">lgtm</a>
        <span class="spacer" />
        <button onClick={() => signOut().then(() => setState('signedout'))}>Sign out</button>
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

function SignIn({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [err, setErr] = useState('');
  const [pat, setPat] = useState('');
  const abort = useRef<AbortController>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function start() {
    setErr('');
    try {
      const d = await startDeviceFlow();
      setCode(d);
      abort.current = new AbortController();
      await saveToken(await pollDeviceFlow(d, abort.current.signal));
      onDone();
    } catch (e: any) {
      setCode(null);
      setErr(e.message);
    }
  }

  return (
    <div class="signin">
      <h1>lgtm</h1>
      {!CLIENT_ID ? (
        <p class="note">This build has no GitHub OAuth client ID (VITE_GITHUB_CLIENT_ID). Use a token below.</p>
      ) : code ? (
        <div>
          <p>Enter this code on GitHub:</p>
          <p class="device-code">{code.user_code}</p>
          <a href={code.verification_uri} target="_blank" rel="noopener">{code.verification_uri}</a>
          <p class="note">Waiting for authorization…</p>
        </div>
      ) : (
        <button class="primary" onClick={start}>Sign in with GitHub</button>
      )}
      {err && <p class="error">{err}</p>}
      <details open={!CLIENT_ID}>
        <summary>Use a personal access token</summary>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            saveToken(pat.trim()).then(onDone);
          }}
        >
          <input type="password" autocomplete="off" placeholder="ghp_… or github_pat_…" value={pat} onInput={(e) => setPat(e.currentTarget.value)} />
          <button disabled={!pat.trim()}>Save</button>
        </form>
        <p class="note">
          Classic token with <code>repo</code> scope, or fine-grained with Pull requests (read &amp; write) and Contents (read).
        </p>
      </details>
    </div>
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
