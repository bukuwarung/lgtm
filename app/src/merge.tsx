import { useEffect, useState } from 'preact/hooks';
import { Select } from './select.tsx';
import { jumpTo, showReviewers } from './shortcuts.tsx';
import { Octicon, Who, Retry, Updating } from './tags.tsx';
import { hint, readBindings } from './keys.ts';
import { type QaThread, reportError, archiveLinked, fetchJira, moveJira, useJiraStatuses, useStoredFlag, useStoredValue, type JiraIssue, type JiraStatus, useDismiss, ask, pageTerm, markDoneOnSlack, ticketsToReview } from './platform.ts';
import { isStalePush, afterApproval, CANT_MERGE_YET, getChecks, deleteBranch, rerunFailedJobs, runOf, updateBranchAndWait, disableAutoMerge, getMergeState, getPushPoints, prCommits, mergePR, neverRan, requiredChecks, requestReview, site, type Check, type MergeMethod, type MergeState } from './github.ts';

const VERB: Record<MergeMethod, string> = { MERGE: 'Merge', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge' };

// Why a PR can't merge yet, from GitHub's merge state plus the checks the index already loaded. A GitLab MR's are
// GitLab's own (its failed merge checks).
export function blockers(s: MergeState, checks: Check[] | null): string[] {
  const failing = checks?.filter((c) => c.state === 'failure').length ?? 0;
  const pending = checks?.filter((c) => c.state === 'pending').length ?? 0;
  const runs = [failing > 0 && `${failing} failing check${failing > 1 ? 's' : ''}`, pending > 0 && `${pending} check${pending > 1 ? 's' : ''} running`];
  if (s.reasons) {
    const out = [...s.reasons.map((r) => r.text), ...runs].filter((x): x is string => !!x);
    return s.mergeStateStatus === 'BLOCKED' && !out.length ? ['Blocked by project rules'] : out;
  }
  const out = [
    s.isDraft && 'This is a draft',
    (s.mergeable === 'CONFLICTING' || s.mergeStateStatus === 'DIRTY') && 'Conflicts with the base branch',
    s.mergeStateStatus === 'BEHIND' && 'Behind the base branch',
    s.reviewDecision === 'CHANGES_REQUESTED' && 'Changes requested',
    s.reviewDecision === 'REVIEW_REQUIRED' && 'Review required',
    failing > 0 && `${failing} failing check${failing > 1 ? 's' : ''}`,
    pending > 0 && `${pending} check${pending > 1 ? 's' : ''} running`,
  ].filter((x): x is string => !!x);
  if (s.mergeStateStatus !== 'BLOCKED' || out.length) return out;
  return s.ruleNotes?.length ? s.ruleNotes.map((x) => x[0].toUpperCase() + x.slice(1)) : ['Blocked by branch rules'];
}

// Approve and merge (the Finish review panel): once my approval is in, merge it the repo's usual way if nothing else is
// in the way; while it waits on what auto-merge waits for (checks, another or a code owner's approval, conversations to
// resolve), auto-merge, saying what's left. Failing checks, a
// "do not merge" sign or another review still needed: not merged, and says why (held: nothing failed, it's waiting). GitHub takes a moment to count a new
// approval, so it looks again a few times.
export async function mergeOnceApproved(repo: string, n: number, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<{ ok: boolean; held?: boolean; text: string }> {
  let s = await getMergeState(repo, n);
  for (let i = 0; i < 5 && afterApproval(s) === 'wait'; i++) await wait(1500), (s = await getMergeState(repo, n));
  let next = afterApproval(s, true);
  // Blocked for no reason GitHub names (checks still to pass where auto-merge isn't allowed, say): the checks' word.
  if (next === CANT_MERGE_YET) {
    const why = blockers(s, await getChecks(repo, n).catch(() => null)).filter((b) => b !== 'Blocked by branch rules').join(', ').toLowerCase();
    next = !why ? `${site(repo)} doesn't say what's blocking it`
      : s.mergeStateStatus === 'BLOCKED' && !s.viewerCanEnableAutoMerge ? `${why}, and auto-merge isn't turned on for this repo` : why;
  }
  const m = s.methods[0];
  if (next === 'merge' || next === 'auto') await mergePR(s, m, s.message[m].title, s.message[m].body, next === 'auto');
  const left = next === 'auto' ? blockers(s, await getChecks(repo, n).catch(() => null)).filter((b) => b !== 'Blocked by branch rules').join(', ').toLowerCase() : '';
  return next === 'merge' ? { ok: true, text: `Approved and merged (${VERB[m].toLowerCase()}).` }
    : next === 'auto' ? { ok: true, text: `Approved. Auto-merges once ${left ? `nothing's in the way (now: ${left})` : 'checks pass'}.` }
    : { ok: false, held: true, text: `Approved, not merged: ${next !== 'wait' ? next : s.reviewDecision === 'REVIEW_REQUIRED' ? 'it needs another approval' : `${site(repo)} is still checking whether it can merge`}.` };
}
export const canMerge = (s: Pick<MergeState, 'isDraft' | 'mergeStateStatus'>) => !s.isDraft && ['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(s.mergeStateStatus);

// Merge status and controls, on my own PRs: a button in the PR's bar (named for the merge, green when it can go) opening
// GitHub's merge box: ready for review, update branch, merge (or auto-merge), the commit message editable before
// confirming. Once merged, the branch and the Jira ticket.
// open: the PR's unresolved review threads, the ones waiting on my reply first.
export type OpenThread = { id: string; path: string; awaiting: boolean; bot: boolean };
// qa: the PR's QA request (Ask QA) — its link, and its replies once read — when it has one.
// hidden: no button in the bar until it's opened (m, or the ⋯ menu's Merge…): someone else's PR.
export function MergeBox({ hidden, repo, n, revert, asked = [], url, checks, onChange, tickets = [], openThreads = [], qa }: { hidden?: boolean; repo: string; n: number; revert?: boolean; asked?: string[]; url: string; checks: Check[] | null; onChange: () => void; tickets?: string[]; openThreads?: OpenThread[]; qa?: { url: string; thread: QaThread | null } }) {
  const [s, setS] = useState<MergeState | null>(null);
  const [err, setErr] = useState('');
  const fail = (text: string) => (setErr(text), reportError(text)); // in the box, and in the bar at the top
  const [busy, setBusy] = useState('');
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [confirm, setConfirm] = useState<'merge' | 'auto' | null>(null);
  const [msg, setMsg] = useState({ title: '', body: '' });
  const [dropBranch, toggleDropBranch] = useStoredFlag('deleteBranch', true);
  // Its Jira tickets that aren't done, moved as it merges when ticked (Settings → Reviewing ticks it to start with).
  const [moveOnMerge] = useStoredFlag('jiraOnMerge', true);
  const [jiraTo] = useStoredValue('jiraAfterMerge', 'Done');
  // A revert's tickets (the reverted PR's, in its title and branch) go back to in progress, done ones too.
  const [to, setTo] = useState(revert ? 'In Progress' : jiraTo); // this merge's, from the usual one
  const [moveTickets, setMoveTickets] = useState(moveOnMerge);
  const [openTickets, setOpenTickets] = useState<string[]>([]);
  useEffect(() => {
    Promise.all(tickets.map((k) => fetchJira(k).then((i) => (i.statusCategory === 'done' && !revert ? null : k), () => null))).then((l) => setOpenTickets(l.filter((k): k is string => !!k)));
  }, [tickets.join()]);
  const statuses = useJiraStatuses(tickets.map(project)); // listed as the PR opens: ready by the time you merge
  useEffect(() => {
    const working = statuses?.find((x) => x.category === 'indeterminate');
    if (revert && working && to === 'In Progress' && !statuses!.some((x) => x.name === to)) setTo(working.name); // the project's own name for it
  }, [statuses]);
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
  useDismiss(shown, () => setShown(false), '.merge-bar');
  useEffect(() => {
    const toggle = () => setShown((x) => !x);
    addEventListener('lgtm:merge', toggle); // the m shortcut
    return () => removeEventListener('lgtm:merge', toggle);
  }, []);
  // The bar's button and its panel.
  const bar = (label: preact.ComponentChildren, cls: string, title: string, body: preact.ComponentChildren, onOpen?: () => void) => hidden && !shown ? null : (
    <div class="submit merge-bar">
      <button class={cls} title={`${title}${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').merge)}`} aria-expanded={shown} onClick={() => (!shown && onOpen?.(), setShown(!shown))}>{label} <span class="caret" aria-hidden="true" /></button>
      {shown && body}
    </div>
  );

  const [loading, setLoading] = useState(false); // fetching again, the last answer still shown
  const load = (tries = 0) => (
    setLoading(true),
    getMergeState(repo, n).then((x) => {
      setS(x);
      setLoading(false);
      // GitHub computes mergeability in the background after a push; ask again shortly.
      if (x.state === 'OPEN' && x.mergeStateStatus === 'UNKNOWN' && tries < 5) setTimeout(() => load(tries + 1), 3000);
    }, (e) => (setErr(e.message), setLoading(false)))
  );
  const wanted = !hidden || shown; // someone else's: asked for only once it's opened
  useEffect(() => void (wanted && load()), [repo, n, checks, wanted]); // checks reloaded: the merge state may have moved too
  const [required, setRequired] = useState<string[]>([]);
  useEffect(() => void (s?.baseRefName && requiredChecks(repo, s.baseRefName).then(setRequired)), [repo, s?.baseRefName]);

  if (!s) return err ? bar(<><Octicon name="git-merge" /> Merge</>, '', `Couldn't load the merge status: ${err}`, <div class="panel merge m-bad"><p class="error">Couldn't load the merge status: {err} <Retry onClick={() => (setErr(''), load())} /></p></div>) : null;
  if (s.state !== 'OPEN')
    return bar(
      s.state === 'MERGED' ? <><Octicon name="git-merge" /> Merged</> : <><Octicon name="git-pull-request-closed" /> Closed</>,
      `merge-state m-${s.state.toLowerCase()}`,
      s.state === 'MERGED' ? 'Merged: the branch and the Jira ticket' : 'Closed without merging',
      <div class={`panel merge m-${s.state.toLowerCase()}`}>
        <b>{s.state === 'MERGED' ? <>Merged{s.mergedBy && <> by <Who login={s.mergedBy.login} /></>}</> : 'Closed'}</b>
        {s.state === 'MERGED' && s.headRef && s.viewerCanDeleteHeadRef && !s.isCrossRepository && (
          <button disabled={!!busy} onClick={async () => (await ask(`Delete ${s.headRefName} on ${site(repo)}? Its ${pageTerm().PR} is merged.`, 'Delete', true)) && (setBusy('delete'), setErr(''), deleteBranch(repo, s).catch((e) => setErr(e.message)).finally(() => (setBusy(''), load())))}>
            {busy === 'delete' ? 'Deleting…' : `Delete ${s.headRefName}`}
          </button>
        )}
        {moved && <p class="ok">{moved}</p>}
        {s.state === 'MERGED' && tickets.map((k) => <TicketMove key={k} id={k} />)}
        {err && <p class="error">{err}{isStalePush(err) && <> <StaleActions /></>}</p>}
      </div>,
    );

  const m = method && s.methods.includes(method) ? method : s.methods[0];
  const ready = canMerge(s);
  const missing = neverRan(required, checks);
  const why = [...blockers(s, checks).filter((w) => !missing.length || w !== 'Blocked by branch rules'), ...(missing.length ? [`required ${missing.length > 1 ? 'checks' : 'check'} never ran`] : [])];
  const conflict = s.mergeable === 'CONFLICTING' || s.mergeStateStatus === 'DIRTY';
  const admin = !ready && !s.isDraft && !conflict && s.viewerCanMergeAsAdmin; // can merge past the branch rules
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
      onChange();
    } catch (e: any) {
      setErr(e.message);
      if (isStalePush(e.message)) setConfirm(null); // its button could only fail again until a reload
      reportError(`${label === 'merge' ? "Couldn't merge" : "Couldn't do that"}: ${e.message}`);
    }
    setBusy('');
    load();
  }
  // What's in the way, each with what does something about it: bring the base in, ask for a review, run the failed
  // GitHub Actions jobs again (checks still running, conflicts and the like: nothing here does).
  const reruns = [...new Set((checks ?? []).filter((c) => c.state === 'failure' && c.jobId).map(runOf).filter(Boolean))] as string[];
  const reasonIcon = (w: string) =>
    /^Behind/.test(w) ? 'git-branch' : /^Review required|approval|review/i.test(w) ? 'person' : /failing/.test(w) ? 'x-circle' : /running/.test(w) ? 'dot-fill'
    : /^required/.test(w) ? 'skip' : /^Conflicts/.test(w) ? 'alert' : /^Changes requested/.test(w) ? 'comment-discussion' : /conversation/i.test(w) ? 'comment-discussion' : 'alert';
  const fixFor = (w: string) => {
    const go = (label: string, f: () => unknown, title: string) => <button class="link" disabled={!!busy} title={title} onClick={f}>{label}</button>;
    if (w === 'Behind the base branch' && s.viewerCanUpdateBranch)
      return go(busy === 'update' ? (s.reasons ? 'Rebasing…' : 'Updating…') : s.reasons ? 'Rebase' : 'Update branch', () => run('update', () => updateBranchAndWait(repo, n, s).then(() => dispatchEvent(new Event('lgtm:refresh')))), `Bring ${s.baseRefName} in`);
    if (w === 'Review required') return go('Ask reviewers', () => (setShown(false), showReviewers(location.hash.slice(1))), "Who's free to review, in the index");
    if (/failing check/.test(w) && reruns.length)
      return go(busy === 'rerun' ? 'Re-running…' : 'Re-run failed', () => run('rerun', () => Promise.all(reruns.map((r) => rerunFailedJobs(repo, r))).then(() => setTimeout(() => dispatchEvent(new Event('lgtm:checks')), 3000))), 'Run the failed GitHub Actions jobs again');
    return null;
  };
  // Deleting the branch with the merge: when GitHub won't (the repo doesn't, or the branch is a fork's), and not for
  // auto-merge, which merges later.
  const offerDelete = confirm === 'merge' && !s.deleteBranchOnMerge && !s.isCrossRepository && !!s.headRef;
  const deleting = offerDelete && dropBranch;
  // The squash commit's message from the PR's commits: their headlines as a list (after what's there).
  const fromCommits = async () => {
    const list = prCommits(await getPushPoints(repo, n).catch(() => [])).map((c) => `* ${c.label}`).join('\n');
    if (list) setMsg((x) => ({ ...x, body: x.body.trim() ? `${x.body.trimEnd()}\n\n${list}` : list }));
  };
  const open = (kind: 'merge' | 'auto') => {
    setMsg(s.message[m]);
    setConfirm(kind);
  };

  return bar(
    s.isDraft ? <><Octicon name="git-pull-request-draft" /> Draft</> : s.autoMergeRequest ? <><Octicon name="git-merge-queue" /> Auto-merge on</> : <><Octicon name="git-merge" /> Merge</>,
    ready && !s.holds.length ? 'primary' : `merge-state m-${ready ? 'wait' : tone}`,
    [headline, ...(ready ? [] : why), ...(s.holds.length ? [`marked not to merge (${s.holds.join(', ')})`] : [])].join(' · '),
    <div class={`panel merge m-${tone}`}>
      <div class="merge-head">
        <b>{headline}</b>
        {loading && <Updating />}
      </div>
      {/* What's in the way, a row each: its icon, what it is, and on the right what does something about it. */}
      {!ready && why.map((w) => (
        <div class="merge-row merge-reason">
          <Octicon name={reasonIcon(w)} />
          {w.startsWith('required') ? (
            <span class="merge-reason-t" title={missing.join('\n')}>
              {missing.length} required check{missing.length > 1 ? 's' : ''} never ran <span class="merge-why">· skipped by a path or branch filter, so {site(repo)} waits for ever</span>
            </span>
          ) : (
            <span class="merge-reason-t">{w}</span>
          )}
          {fixFor(w)}
        </div>
      ))}
      {s.holds.length > 0 && (
        <div class="merge-row merge-hold">
          <Octicon name="alert" /> <b>Marked not to merge:</b> {s.holds.join(', ')}
        </div>
      )}
      {openThreads.length > 0 && (() => {
        const waiting = openThreads.filter((t) => t.awaiting).length, bots = openThreads.filter((t) => t.bot).length;
        return (
          <div class="merge-row merge-open">
            <Octicon name="comment-discussion" /> {openThreads.length} review thread{openThreads.length === 1 ? '' : 's'} still open
            {waiting > 0 && <b> · {waiting} waiting on your reply</b>}
            {bots > 0 && <span class="merge-why"> · {bots} from bots</span>}
            <button class="link" onClick={() => jumpTo(openThreads[0].id, 'f-' + openThreads[0].path)}>Go to {waiting ? 'the first waiting on you' : 'the first'}</button>
          </div>
        );
      })()}
      {s.rules?.map((r) => (
        <div class="merge-row merge-open">
          <Octicon name="person" /> <b>{r.name}</b>: {r.approvedBy.length} of {r.required} approval{r.required === 1 ? '' : 's'}
          {r.eligible.length > 0 && (
            <span class="merge-why">
              {' · can approve: '}
              {r.eligible.slice(0, 6).map((l, k) => (
                <>
                  {k > 0 && ', '}
                  <Who login={l} /> <button class="link" disabled={!!busy} title={`Ask @${l} to review`} onClick={() => run('ask', () => requestReview(repo, n, l).then(() => void ticketsToReview(tickets)))}>ask</button>
                </>
              ))}
              {r.eligible.length > 6 && ` and ${r.eligible.length - 6} more`}
            </span>
          )}
        </div>
      ))}
      {qa && (
        <div class={`merge-row merge-qa${qa.thread?.status ? ' qa-' + qa.thread.status : ''}`}>
          <Octicon name="beaker" />{' '}
          {qa.thread?.status === 'signed' ? 'QA signed off'
            : qa.thread?.status === 'issue' ? <b>QA raised an issue</b>
            : qa.thread?.replies.length ? `QA replied, no sign-off yet (${qa.thread.replies.length} repl${qa.thread.replies.length === 1 ? 'y' : 'ies'})`
            : 'QA asked, no reply yet'}
          <a href={qa.url} target="_blank" rel="noopener">Open on Slack</a>
        </div>
      )}
      {s.autoMergeRequest && (
        <div class="merge-row merge-reason">
          <Octicon name="git-merge-queue" />
          <span class="merge-reason-t" title={s.autoMergeRequest.enabledBy ? `Turned on by @${s.autoMergeRequest.enabledBy.login}` : undefined}>
            Auto-merge ({VERB[s.autoMergeRequest.mergeMethod].toLowerCase()}) is on{missing.length ? <span class="merge-why"> · it can't fire while those checks never run</span> : ''}
          </span>
          {s.viewerCanDisableAutoMerge && <button class="link" disabled={!!busy} onClick={() => run('disable', () => disableAutoMerge(s.id))}>{busy === 'disable' ? 'Turning off…' : 'Turn off'}</button>}
        </div>
      )}
      {!confirm && <div class="merge-row">
        {s.methods.length > 1 && (
          <Select value={m} onChange={(e) => setMethod(e.currentTarget.value as MergeMethod)} title="Merge method">
            {s.methods.map((x) => <option value={x}>{VERB[x]}</option>)}
          </Select>
        )}
        {/* Not ready, but I'm an admin here: one button merges past what's in the way (after the confirm). */}
        <button class={ready ? 'primary' : undefined} disabled={!!busy || !(ready || admin)} title={admin ? "You're an admin here: merge even though requirements aren't met" : undefined} onClick={() => open('merge')}>{admin ? `${VERB[m]} as admin` : VERB[m]}</button>
        {!ready && !s.autoMergeRequest && s.viewerCanEnableAutoMerge && !missing.length && !conflict && ( // never-run checks or conflicts: auto-merge would wait for ever
          <button disabled={!!busy} onClick={() => open('auto')}>Enable auto-merge</button>
        )}
      </div>}
      {confirm && (
        <div class="merge-confirm">
          {s.holds.length > 0 && <p class="warn">Marked not to merge. Merge anyway?</p>}
          {m !== 'REBASE' && (
            <>
              <input value={msg.title} onInput={(e) => setMsg({ ...msg, title: e.currentTarget.value })} aria-label="Commit title" />
              <textarea rows={5} value={msg.body} onInput={(e) => setMsg({ ...msg, body: e.currentTarget.value })} onKeyDown={(e) => m === 'SQUASH' && e.altKey && e.code === 'KeyC' && (e.preventDefault(), void fromCommits())} aria-label="Commit message" />
              {m === 'SQUASH' && <button class="link" style="justify-self: start" onClick={fromCommits} title="Each commit's headline, as a list, in the message (⌥C)">From the commits</button>}
            </>
          )}
          {openTickets.length > 0 && (
            <div class="merge-opt">
              <label title={confirm === 'auto' ? `Auto-merge merges later: the ticket moves the next time you open this ${pageTerm().PR} here after it merged` : 'Settings → Jira: whether this starts ticked, and the status'}>
                <input type="checkbox" checked={moveTickets} onChange={() => setMoveTickets(!moveTickets)} /> {confirm === 'auto' ? 'Once merged, move' : 'Move'} {openTickets.join(', ')} {revert ? 'back to' : 'to'}
              </label>
              <StatusSelect value={to} onChange={setTo} statuses={statuses} />
            </div>
          )}
          {offerDelete && (
            <label class="merge-opt" title="GitHub doesn't delete this repo's merged branches by itself">
              <input type="checkbox" checked={dropBranch} onChange={toggleDropBranch} /> Delete {s.headRefName}
            </label>
          )}
          <div class="acts">
            <button disabled={!!busy} onClick={() => setConfirm(null)}>Cancel</button>
            <button
              class="primary"
              disabled={!!busy}
              onClick={() =>
                run('merge', async () => {
                  await mergePR(s, m, msg.title, msg.body, confirm === 'auto');
                  if (confirm === 'merge') void markDoneOnSlack(`${repo}#${n}`); // your PR: your posts
                  if (confirm === 'merge') archiveLinked(repo, n);
                  if (deleting) await deleteBranch(repo, s).catch((e) => fail(`Merged, but ${e.message}`));
                  if (confirm === 'merge' && moveTickets)
                    for (const k of openTickets) await moveJira(k, to).catch((e) => fail(`Merged, but ${k} didn't move to ${to}: ${e.message}`));
                  if (confirm === 'auto') moveTickets && openTickets.length ? localStorage.setItem(pendingKey, JSON.stringify({ to, tickets: openTickets })) : localStorage.removeItem(pendingKey);
                })
              }
            >
              {busy === 'merge' ? 'Working…' : confirm === 'auto' ? `Enable auto-merge (${VERB[m].toLowerCase()})` : `Confirm ${VERB[m].toLowerCase()}${admin ? ' as admin' : ''}`}
            </button>
          </div>
        </div>
      )}
      {err && <p class="error">{err}{isStalePush(err) && <> <StaleActions /></>}</p>}
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
    <Select value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-label="Jira status" title={statuses ? undefined : "Listing the project's statuses…"}>
      {!statuses?.some((s) => s.name === value) && <option value={value}>{statuses ? `${value} (not in this project)` : value}</option>}
      {statuses && groups.map(([c, label]) => statuses.some((s) => s.category === c) && (
        <optgroup label={label}>
          {statuses.filter((s) => s.category === c).map((s) => <option value={s.name}>{s.name}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

// Once merged: its Jira ticket moved on (unless it's done already), to the status you pick (Settings → Reviewing sets
// the usual one). Jira's own names; one it doesn't allow from where the ticket is comes back as its error.
// My merged or closed PR's own actions, in its title-bar tag's menu (review.tsx): delete the branch and move its
// tickets once merged, and the ticket move auto-merge left waiting.
export function MergedActions({ repo, n, tickets }: { repo: string; n: number; tickets: string[] }) {
  const [s, setS] = useState<MergeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => getMergeState(repo, n).then(setS, (e) => setErr(e.message));
  useEffect(() => void load(), [repo, n]);
  useEffect(() => void (s?.state === 'MERGED' && archiveLinked(repo, n)), [s?.state]); // merged (auto-merge, or elsewhere): its Codex conversation is done with
  useEffect(() => {
    const key = `jiraOnMerge:${repo}#${n}`;
    const p = s?.state === 'MERGED' && pendingMove(key);
    if (!p) return;
    localStorage.removeItem(key);
    movePendingTickets(p).then((failed) =>
      failed.length ? reportError(`Merged, but ${failed.join('; ')}`) : dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `Moved ${p.tickets.join(', ')} to ${p.to}` } })),
    );
  }, [s?.state]);
  if (s?.state !== 'MERGED') return null;
  return (
    <>
      {s.headRef && s.viewerCanDeleteHeadRef && !s.isCrossRepository && (
        <button disabled={busy} onClick={async () => (await ask(`Delete ${s.headRefName}?`, 'Delete', true)) && (setBusy(true), setErr(''), deleteBranch(repo, s).catch((e) => setErr(e.message)).finally(() => (setBusy(false), load())))}>
          {busy ? 'Deleting…' : `Delete ${s.headRefName}`}
        </button>
      )}
      {tickets.map((k) => <TicketMove key={k} id={k} />)}
      {err && <p class="error">{err}</p>}
    </>
  );
}

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

// Commits pushed since the page loaded stopped a merge or a review: what changed (only the new commits), or the PR again.
export function StaleActions() {
  return (
    <>
      <button class="link" onClick={() => dispatchEvent(new Event('lgtm:see-new'))}>See what changed</button>
      {' · '}
      <button class="link" onClick={() => dispatchEvent(new Event('lgtm:refresh'))}>Reload</button>
    </>
  );
}
