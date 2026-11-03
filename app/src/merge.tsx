import { useEffect, useState } from 'preact/hooks';
import { jumpTo } from './shortcuts.tsx';
import { Octicon } from './tags.tsx';
import { reportError, fetchJira, moveJira, useJiraStatuses, useStoredFlag, useStoredValue, type JiraIssue, type JiraStatus } from './platform.ts';
import { deleteBranch, disableAutoMerge, getMergeState, markReady, mergePR, updateBranch, type Check, type MergeMethod, type MergeState } from './github.ts';

const VERB: Record<MergeMethod, string> = { MERGE: 'Merge', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge' };

// Why a PR can't merge yet, from GitHub's merge state plus the checks the index already loaded.
export function blockers(s: MergeState, checks: Check[] | null): string[] {
  const failing = checks?.filter((c) => c.state === 'failure').length ?? 0;
  const pending = checks?.filter((c) => c.state === 'pending').length ?? 0;
  const out = [
    s.isDraft && 'This is a draft',
    (s.mergeable === 'CONFLICTING' || s.mergeStateStatus === 'DIRTY') && 'Conflicts with the base branch',
    s.mergeStateStatus === 'BEHIND' && 'Behind the base branch',
    s.reviewDecision === 'CHANGES_REQUESTED' && 'Changes requested',
    s.reviewDecision === 'REVIEW_REQUIRED' && 'Review required',
    failing > 0 && `${failing} failing check${failing > 1 ? 's' : ''}`,
    pending > 0 && `${pending} check${pending > 1 ? 's' : ''} running`,
  ].filter((x): x is string => !!x);
  return s.mergeStateStatus === 'BLOCKED' && !out.length ? ['Blocked by branch rules'] : out;
}

export const canMerge = (s: Pick<MergeState, 'isDraft' | 'mergeStateStatus'>) => !s.isDraft && ['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(s.mergeStateStatus);

// Merge status and controls, on my own PRs: a button in the PR's bar (named for the merge, green when it can go) opening
// GitHub's merge box: ready for review, update branch, merge (or auto-merge), the commit message editable before
// confirming. Once merged, the branch and the Jira ticket.
export function MergeBox({ repo, n, url, checks, onChange, tickets = [] }: { repo: string; n: number; url: string; checks: Check[] | null; onChange: () => void; tickets?: string[] }) {
  const [s, setS] = useState<MergeState | null>(null);
  const [err, setErr] = useState('');
  const fail = (text: string) => (setErr(text), reportError(text)); // in the box, and in the bar at the top
  const [busy, setBusy] = useState('');
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [confirm, setConfirm] = useState<'merge' | 'auto' | null>(null);
  const [msg, setMsg] = useState({ title: '', body: '' });
  const [bypass, setBypass] = useState(false);
  const [dropBranch, toggleDropBranch] = useStoredFlag('deleteBranch', true);
  // Its Jira tickets that aren't done, moved as it merges when ticked (Settings → Reviewing ticks it to start with).
  const [moveOnMerge] = useStoredFlag('jiraOnMerge', false);
  const [jiraTo] = useStoredValue('jiraAfterMerge', 'Done');
  const [to, setTo] = useState(jiraTo); // this merge's, from the usual one
  const [moveTickets, setMoveTickets] = useState(moveOnMerge);
  const [openTickets, setOpenTickets] = useState<string[]>([]);
  useEffect(() => {
    Promise.all(tickets.map((k) => fetchJira(k).then((i) => (i.statusCategory === 'done' ? null : k), () => null))).then((l) => setOpenTickets(l.filter((k): k is string => !!k)));
  }, [tickets.join()]);
  const statuses = useJiraStatuses(tickets.map(project)); // listed as the PR opens: ready by the time you merge
  // Auto-merge merges later: the move waits (saved per PR) for the next time the PR is open here after it merged.
  const pendingKey = `jiraOnMerge:${repo}#${n}`;
  const [moved, setMoved] = useState('');
  useEffect(() => {
    if (s?.state === 'CLOSED') localStorage.removeItem(pendingKey);
    const p = s?.state === 'MERGED' && pendingMove(pendingKey);
    if (!p) return;
    localStorage.removeItem(pendingKey);
    movePendingTickets(p).then((failed) => {
      failed.length ? fail(`Merged, but ${failed.join('; ')}`) : setMoved(`Merged: moved ${p.tickets.join(', ')} to ${p.to}`);
      setShown(true);
    });
  }, [s?.state]);
  // A "ready to merge" notification (main.tsx) brought you here: the box opens.
  const [shown, setShown] = useState(() => sessionStorage.getItem('openMerge') === `${repo}#${n}` && (sessionStorage.removeItem('openMerge'), true));
  useEffect(() => {
    const toggle = () => setShown((x) => !x);
    addEventListener('lgtm:merge', toggle); // the m shortcut
    return () => removeEventListener('lgtm:merge', toggle);
  }, []);
  // The bar's button and its panel.
  const bar = (label: preact.ComponentChildren, cls: string, title: string, body: preact.ComponentChildren, onOpen?: () => void) => (
    <div class="submit merge-bar">
      <button class={cls} title={title} aria-expanded={shown} onClick={() => (!shown && onOpen?.(), setShown(!shown))}>{label} <span class="caret" aria-hidden="true" /></button>
      {shown && body}
    </div>
  );

  const load = (tries = 0) =>
    getMergeState(repo, n).then((x) => {
      setS(x);
      // GitHub computes mergeability in the background after a push; ask again shortly.
      if (x.state === 'OPEN' && x.mergeStateStatus === 'UNKNOWN' && tries < 5) setTimeout(() => load(tries + 1), 3000);
    }, (e) => setErr(e.message));
  useEffect(() => void load(), [repo, n, checks]); // checks reloaded: the merge state may have moved too

  if (!s) return err ? bar('Merge', '', `Couldn't load the merge status: ${err}`, <div class="panel merge m-bad"><p class="error">Couldn't load the merge status: {err}</p></div>) : null;
  if (s.state !== 'OPEN')
    return bar(
      s.state === 'MERGED' ? <><Octicon name="git-merge" /> Merged</> : <><Octicon name="git-pull-request-closed" /> Closed</>,
      `merge-state m-${s.state.toLowerCase()}`,
      s.state === 'MERGED' ? 'Merged: the branch and the Jira ticket' : 'Closed without merging',
      <div class={`panel merge m-${s.state.toLowerCase()}`}>
        <b>{s.state === 'MERGED' ? `Merged${s.mergedBy ? ` by ${s.mergedBy.login}` : ''}` : 'Closed'}</b>
        {s.state === 'MERGED' && s.headRef && s.viewerCanDeleteHeadRef && !s.isCrossRepository && (
          <button disabled={!!busy} onClick={() => (setBusy('delete'), setErr(''), deleteBranch(repo, s).catch((e) => setErr(e.message)).finally(() => (setBusy(''), load())))}>
            {busy === 'delete' ? 'Deleting…' : `Delete ${s.headRefName}`}
          </button>
        )}
        {moved && <p class="ok">{moved}</p>}
        {s.state === 'MERGED' && tickets.map((k) => <TicketMove key={k} id={k} />)}
        {err && <p class="error">{err}</p>}
      </div>,
    );

  const m = method && s.methods.includes(method) ? method : s.methods[0];
  const ready = canMerge(s);
  const why = blockers(s, checks);
  const conflict = s.mergeable === 'CONFLICTING' || s.mergeStateStatus === 'DIRTY';
  const tone = conflict ? 'bad' : ready ? 'ok' : 'wait';
  const headline =
    s.mergeStateStatus === 'UNKNOWN' ? 'Checking mergeability…'
    : ready ? (s.mergeStateStatus === 'UNSTABLE' ? 'Can merge, but some checks are failing' : 'Ready to merge')
    : 'Not ready to merge';

  async function run(label: string, f: () => Promise<unknown>) {
    setBusy(label);
    setErr('');
    try {
      await f();
      setConfirm(null);
      setBypass(false);
      onChange();
    } catch (e: any) {
      setErr(e.message);
      reportError(`${label === 'merge' ? "Couldn't merge" : "Couldn't do that"}: ${e.message}`);
    }
    setBusy('');
    load();
  }
  // Deleting the branch with the merge: when GitHub won't (the repo doesn't, or the branch is a fork's), and not for
  // auto-merge, which merges later.
  const offerDelete = confirm === 'merge' && !s.deleteBranchOnMerge && !s.isCrossRepository && !!s.headRef;
  const deleting = offerDelete && dropBranch;
  const open = (kind: 'merge' | 'auto') => {
    setMsg(s.message[m]);
    setConfirm(kind);
  };

  return bar(
    s.isDraft ? 'Draft' : s.autoMergeRequest ? 'Auto-merge on' : 'Merge',
    ready ? 'primary' : `merge-state m-${tone}`,
    [headline, ...(ready ? [] : why)].join(' · '),
    <div class={`panel merge m-${tone}`}>
      <div class="merge-head">
        <b>{headline}</b>
        {!ready && why.length > 0 && <span class="merge-why">{why.join(' · ')}</span>}
        {conflict && <a href={`${url}/conflicts`} target="_blank" rel="noopener">Resolve conflicts on GitHub</a>}
      </div>
      {s.autoMergeRequest && (
        <div class="merge-row">
          Auto-merge ({VERB[s.autoMergeRequest.mergeMethod].toLowerCase()}) is on{s.autoMergeRequest.enabledBy ? `, enabled by ${s.autoMergeRequest.enabledBy.login}` : ''}: it merges once requirements are met.
          {s.viewerCanDisableAutoMerge && <button disabled={!!busy} onClick={() => run('disable', () => disableAutoMerge(s.id))}>Disable auto-merge</button>}
        </div>
      )}
      <div class="merge-row">
        {s.isDraft && <button disabled={!!busy} onClick={() => run('ready', () => markReady(s.id).then(() => (setShown(false), jumpTo('ix-reviewers'))))}>{busy === 'ready' ? 'Marking…' : 'Ready for review'}</button>}
        {s.mergeStateStatus === 'BEHIND' && s.viewerCanUpdateBranch && (
          <button disabled={!!busy} onClick={() => run('update', () => updateBranch(s))}>{busy === 'update' ? 'Updating…' : 'Update branch'}</button>
        )}
        {s.methods.length > 1 && (
          <select value={m} onChange={(e) => setMethod(e.currentTarget.value as MergeMethod)} title="Merge method">
            {s.methods.map((x) => <option value={x}>{VERB[x]}</option>)}
          </select>
        )}
        <button class="primary" disabled={!!busy || !(ready || bypass)} onClick={() => open('merge')}>{VERB[m]}</button>
        {!ready && !s.autoMergeRequest && s.viewerCanEnableAutoMerge && (
          <button disabled={!!busy} onClick={() => open('auto')}>Enable auto-merge</button>
        )}
        {!ready && !s.isDraft && !conflict && s.viewerCanMergeAsAdmin && (
          <label title="You're an admin here: merge even though requirements aren't met">
            <input type="checkbox" checked={bypass} onChange={() => setBypass(!bypass)} /> Merge without waiting for requirements
          </label>
        )}
      </div>
      {confirm && (
        <div class="merge-confirm">
          {m !== 'REBASE' && (
            <>
              <input value={msg.title} onInput={(e) => setMsg({ ...msg, title: e.currentTarget.value })} aria-label="Commit title" />
              <textarea rows={5} value={msg.body} onInput={(e) => setMsg({ ...msg, body: e.currentTarget.value })} aria-label="Commit message" />
            </>
          )}
          <div class="merge-row">
            <button
              class="primary"
              disabled={!!busy}
              onClick={() =>
                run('merge', async () => {
                  await mergePR(s, m, msg.title, msg.body, confirm === 'auto');
                  if (deleting) await deleteBranch(repo, s).catch((e) => fail(`Merged, but ${e.message}`));
                  if (confirm === 'merge' && moveTickets)
                    for (const k of openTickets) await moveJira(k, to).catch((e) => fail(`Merged, but ${k} didn't move to ${to}: ${e.message}`));
                  if (confirm === 'auto') moveTickets && openTickets.length ? localStorage.setItem(pendingKey, JSON.stringify({ to, tickets: openTickets })) : localStorage.removeItem(pendingKey);
                })
              }
            >
              {busy === 'merge' ? 'Working…' : confirm === 'auto' ? `Enable auto-merge (${VERB[m].toLowerCase()})` : `Confirm ${VERB[m].toLowerCase()}`}
            </button>
            <button disabled={!!busy} onClick={() => setConfirm(null)}>Cancel</button>
          </div>
          {openTickets.length > 0 && (
            <div class="merge-opt">
              <label title={confirm === 'auto' ? 'Auto-merge merges later: the ticket moves the next time you open this PR here after it merged' : 'Settings → Reviewing: whether this starts ticked, and the status'}>
                <input type="checkbox" checked={moveTickets} onChange={() => setMoveTickets(!moveTickets)} /> {confirm === 'auto' ? 'Once merged, move' : 'Move'} {openTickets.join(', ')} to
              </label>
              <StatusSelect value={to} onChange={setTo} statuses={statuses} />
            </div>
          )}
          {offerDelete && (
            <label class="merge-opt" title="GitHub doesn't delete this repo's merged branches by itself">
              <input type="checkbox" checked={dropBranch} onChange={toggleDropBranch} /> Delete {s.headRefName}
            </label>
          )}
        </div>
      )}
      {err && <p class="error">{err}</p>}
    </div>,
    () => ready && !s.autoMergeRequest && open('merge'), // ready: straight to the commit message
  );
}

const project = (key: string) => key.split('-')[0];

// Auto-merge's ticket moves, saved per PR (jiraOnMerge:<repo>#<n>) until it merged: done by the merge box when the PR
// is open, or by the PR list (main.tsx) once the PR has left it. Gives the ones that failed.
type Pending = { to: string; tickets: string[] };
const pendingMove = (key: string): Pending | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};
const movePendingTickets = (p: Pending) => Promise.all(p.tickets.map((k) => moveJira(k, p.to).then(() => '', (e) => `${k} didn't move to ${p.to}: ${e.message}`))).then((l) => l.filter(Boolean));
export async function movePending(open: Set<string>): Promise<{ pr: string; text: string; ok: boolean }[]> {
  const out = [];
  for (const key of Object.keys(localStorage).filter((k) => k.startsWith('jiraOnMerge:'))) {
    const pr = key.slice('jiraOnMerge:'.length);
    if (open.has(pr)) continue;
    const [repo, n] = pr.split('#');
    const s = await getMergeState(repo, Number(n)).catch(() => null);
    if (!s || s.state === 'OPEN') continue;
    const p = pendingMove(key);
    localStorage.removeItem(key);
    if (s.state !== 'MERGED' || !p) continue;
    const failed = await movePendingTickets(p);
    out.push({ pr, ok: !failed.length, text: failed.length ? `${pr} merged, but ${failed.join('; ')}` : `${pr} merged: moved ${p.tickets.join(', ')} to ${p.to}` });
  }
  return out;
}

// A Jira status to move to: the project's own (listed once a day, which takes a while: meanwhile the one picked), by
// category. One that isn't among them (a name from before) stays, marked.
export function StatusSelect({ value, onChange, statuses }: { value: string; onChange: (s: string) => void; statuses: JiraStatus[] | null }) {
  const groups = [['new', 'To do'], ['indeterminate', 'In progress'], ['done', 'Done']] as const;
  return (
    <select value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-label="Jira status" title={statuses ? undefined : "Listing the project's statuses…"}>
      {!statuses?.some((s) => s.name === value) && <option value={value}>{statuses ? `${value} (not in this project)` : value}</option>}
      {statuses && groups.map(([c, label]) => statuses.some((s) => s.category === c) && (
        <optgroup label={label}>
          {statuses.filter((s) => s.category === c).map((s) => <option value={s.name}>{s.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

// Once merged: its Jira ticket moved on (unless it's done already), to the status you pick (Settings → Reviewing sets
// the usual one). Jira's own names; one it doesn't allow from where the ticket is comes back as its error.
function TicketMove({ id }: { id: string }) {
  const [issue, setIssue] = useState<JiraIssue | null>(null);
  const [usual] = useStoredValue('jiraAfterMerge', 'Done');
  const [status, setStatus] = useState(usual);
  const [state, setState] = useState<'' | 'moving' | 'moved' | string>('');
  const statuses = useJiraStatuses([project(id)]);
  useEffect(() => void fetchJira(id).then(setIssue, () => {}), [id]);
  const move = () => {
    setState('moving');
    moveJira(id, status).then(
      () => {
        setState('moved');
        fetchJira(id).then(setIssue, () => {});
      },
      (e) => setState(e.message),
    );
  };
  if (!issue) return null;
  return (
    <form class="ticket-move" onSubmit={(e) => (e.preventDefault(), move())}>
      <span>
        <a href={issue.url} target="_blank" rel="noopener">{id}</a> is <b>{issue.status ?? '?'}</b>
      </span>
      {state === 'moved' ? (
        <span class="ok"><Octicon name="check" /> moved</span>
      ) : issue.statusCategory === 'done' ? null : (
        <>
          <span>→</span>
          <StatusSelect value={status} onChange={setStatus} statuses={statuses} />
          <button disabled={state === 'moving' || status === issue.status}>{state === 'moving' ? 'Moving…' : 'Move'}</button>
          {state && state !== 'moving' && <span class="warn-text">{state}</span>}
        </>
      )}
    </form>
  );
}
