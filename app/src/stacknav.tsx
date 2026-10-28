import { useEffect, useState } from 'preact/hooks';
import { getStackStatus, mergeLayer, type LayerStatus, type StackLayer } from './github.ts';
import { canMerge } from './merge.tsx';
import { Tg } from './tags.tsx';

// Where a layer stands, most pressing first.
function standing(s: LayerStatus): [string, string, string] {
  if (s.state === 'MERGED') return ['merged', 'p-ok', 'merge'];
  if (s.state === 'CLOSED') return ['closed', '', 'fail'];
  if (s.isDraft) return ['draft', '', 'draft'];
  if (s.mergeStateStatus === 'DIRTY') return ['conflicts', 'p-bad', 'conflict'];
  if (s.reviewDecision === 'CHANGES_REQUESTED') return ['changes requested', 'p-bad', 'changes'];
  if (['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(s.mergeStateStatus)) return ['can merge', 'p-ok', 'merge'];
  if (s.reviewDecision === 'APPROVED') return ['approved', 'p-ok', 'approved'];
  if (!s.reviewers.length) return ['no reviewers', 'p-warn', 'nobody'];
  return ['awaiting review', '', 'waiting'];
}
const CI: Record<string, [string, string, string]> = {
  SUCCESS: ['✓', 'ck-success', 'Checks passed'],
  FAILURE: ['✕', 'ck-failure', 'Checks failing'],
  ERROR: ['✕', 'ck-failure', 'Checks failing'],
  PENDING: ['●', 'ck-pending', 'Checks running'],
  EXPECTED: ['●', 'ck-pending', 'Checks waiting to run'],
};
const VERDICT: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'commented', DISMISSED: 'dismissed', WAITING: 'asked' };

// A PR's stack: ‹ k/n › to step through it, the k/n opening every layer at a glance (checks, reviewers and their
// verdicts, where it stands), loaded when opened.
export function StackNav({ repo, n, stack }: { repo: string; n: number; stack: StackLayer[] }) {
  const k = stack.findIndex((l) => l.number === n);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Map<number, LayerStatus> | null>(null);
  const [err, setErr] = useState('');
  const [merging, setMerging] = useState<'' | 'confirm' | 'busy'>('');
  const load = () => getStackStatus(repo, stack.map((l) => l.number)).then(setStatus, (e) => setErr(e.message));
  useEffect(() => void (open && load()), [open, repo, stack.map((l) => l.number).join()]);
  // Only the lowest open layer can merge (the ones above build on it).
  const bottom = status && stack.find((l) => status.get(l.number)?.state === 'OPEN');
  const above = bottom && stack[stack.indexOf(bottom) + 1];
  const mergeable = !!bottom && canMerge(status!.get(bottom.number)!);
  const merge = () => {
    setMerging('busy');
    setErr('');
    mergeLayer(repo, bottom!.number, above?.number)
      .catch((e) => setErr(`Couldn't merge #${bottom!.number}: ${e.message}`))
      .finally(() => (setMerging(''), load(), dispatchEvent(new Event('lgtm:refresh'))));
  };
  useEffect(() => setOpen(false), [n]);
  const at = (d: number) => stack[k + d];
  const step = (d: number) =>
    at(d) ? <a href={`#/${repo}/pull/${at(d)!.number}`} title={`#${at(d)!.number} ${at(d)!.title}`}>{d < 0 ? '‹' : '›'}</a> : <span class="off">{d < 0 ? '‹' : '›'}</span>;
  return (
    <span class="stack-nav submit" title="This PR's stack ([ and ] to move)">
      {step(-1)}
      <button class="stack-k" onClick={() => setOpen(!open)} aria-expanded={open} title="Every layer of the stack">
        {k + 1}/{stack.length} ▾
      </button>
      {step(1)}
      {open && (
        <div class="panel stack-panel">
          {err && <p class="error">{err}</p>}
          {merging === 'confirm' && bottom && (
            <p class="note stack-note">
              Merges #{bottom.number} the repo's usual way{above ? `, points #${above.number} at its base instead,` : ''} and deletes its branch.{' '}
              <button class="link" onClick={() => setMerging('')}>Cancel</button>
            </p>
          )}
          {stack.map((l, i) => {
            const s = status?.get(l.number);
            const [label, tone, icon] = s ? standing(s) : ['…', '', ''];
            const ci = s?.ci ? CI[s.ci] : null;
            return (
              <a class={l.number === n ? 'stack-row cur' : 'stack-row'} href={`#/${repo}/pull/${l.number}`}>
                <span class="stack-i">{i + 1}</span>
                <span class="stack-title" title={l.title}>
                  <b>#{l.number}</b> {l.title}
                </span>
                <span class={`ck ${ci?.[1] ?? 'ck-neutral'}`} title={ci?.[2] ?? 'No checks'}>{ci?.[0] ?? '–'}</span>
                <span class="stack-who">
                  {s?.reviewers.map((r) =>
                    r.login.startsWith('team ') ? (
                      <span class="stack-team" title={`${r.login}: asked`}>{r.login.slice(5)}</span>
                    ) : (
                      <img class={`v-${r.verdict}`} src={`https://github.com/${encodeURIComponent(r.login)}.png?size=40`} alt={r.login} title={`@${r.login}: ${VERDICT[r.verdict]}`} />
                    ),
                  )}
                </span>
                <span class={`pill ${tone}`}><Tg i={icon} t={label} /></span>
                {mergeable && l === bottom && (
                  <button class="primary stack-merge" disabled={merging === 'busy'} onClick={(e) => (e.preventDefault(), merging ? merging === 'confirm' && merge() : setMerging('confirm'))}>
                    {merging === 'busy' ? 'Merging…' : merging === 'confirm' ? 'Confirm' : 'Merge'}
                  </button>
                )}
              </a>
            );
          })}
        </div>
      )}
    </span>
  );
}
