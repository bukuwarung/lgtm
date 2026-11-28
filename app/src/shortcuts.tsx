import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { hint, readBindings } from './keys.ts';
import { ask, askText, composing, reportError, useFoldBots, usePresence, useStoredFlag, faceOf, pageTerm, shortLogin } from './platform.ts';
import { isAway, lateFor, statusText } from './slackmsg.ts';
import { StatusMark } from './emojibox.tsx';
import { codeWithoutTests, inTests, moduleLabel, moduleName, stepIcon, type PlanStep, fileLabel } from './files.ts';
import { AgentMark, BotMark, CheckMark, Octicon, Tg, Who, Lines, Retry, Fold, Time } from './tags.tsx';
import { AGENTS, useAgents, type AgentId } from './agents.ts';
import { fileIcon, folderIcon, iconOf } from './fileicons.ts';
import type { ComponentChildren } from 'preact';
import { jiraKeys, withKey, withoutKey } from './jira.ts';
import { prProjects, addToProject, setProjectStatus, removeFromProject, type ProjectInfo, linkedIssues, parseLinkRef, forgetLinked, closesIn, withoutCloses, updatePR, type LinkedIssue, repoLabels, setLabel, type Label, getPrMeta, getAssignable, getMilestones, setAssignees, setMilestone, setSubscribed, setLocked, type PrMeta, type Milestone, type PushPoint, agentSays, awaitsMe, earlierVerdicts, repeatedFindings, jobLog, playJob, rerunFailedJobs, rerunJob, runOf, rerunRun, cancelRun, waitingRuns, approveRun, reviewDeployment, isLab, type WaitingRun, threadTiers, type Check, type ConversationItem, type Draft, type PR, type PRFile, type Thread } from './github.ts';

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
// The first of these elements (in page order, so top to bottom) whose box passes the test: a binary search, a dozen
// looks on a 675-file PR rather than one per file, on every scroll. The test must hold from some element on (a box's
// bottom below a line, say). -1: none does.
export function firstBox<T extends Element>(els: ArrayLike<T>, test: (r: DOMRect) => boolean) {
  let lo = 0, hi = els.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (test(els[mid].getBoundingClientRect())) hi = mid;
    else lo = mid + 1;
  }
  return lo < els.length ? lo : -1;
}

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
  const sorted = threads.toSorted((a, b) => (order.get(a.path) ?? 1e9) - (order.get(b.path) ?? 1e9) || (a.line ?? 0) - (b.line ?? 0));
  type Item = { id: string; path: string; t?: Thread };
  return [...drafts.map((d): Item => ({ id: 'd-' + d.id, path: d.path })), ...sorted.map((t): Item => ({ id: 't-' + t.id, path: t.path, t }))];
}

const textOf = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 90);
const base = fileLabel; // a file's name as shown: unique among the PR's (files.ts)

// A review's verdict: its tag icon (tags.tsx) and words.
const VERDICT: Record<string, [string, string]> = { APPROVED: ['approved', 'approved'], CHANGES_REQUESTED: ['changes', 'changes requested'], COMMENTED: ['reply', 'reviewed'], DISMISSED: ['', 'dismissed'] };

// A button in a section's header (+ to add, the bell, the lock): it acts without folding the section.
function HeadBtn({ icon, label, on, run }: { icon: string; label: string; on?: boolean; run: (sec: HTMLDetailsElement | null) => void }) {
  return (
    <button class={on ? 'ix-head-btn on' : 'ix-head-btn'} title={label} aria-label={label} aria-pressed={on} onClick={(e) => (e.preventDefault(), e.stopPropagation(), run(e.currentTarget.closest('details')))}>
      <Octicon name={icon} />
    </button>
  );
}
// The list a header's + opens: typing narrows it (each list says how), ↵ picks the first, Esc closes.
type PickItem = { key: string; label: ComponentChildren; title?: string };
function Picker({ placeholder, load, onPick, onClose, empty }: { placeholder: string; load: (q: string) => Promise<PickItem[]>; onPick: (key: string) => void; onClose: () => void; empty: string }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PickItem[] | null>(null);
  const [err, setErr] = useState('');
  const box = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => void box.current?.focus({ preventScroll: true }), []); // not sideways: the index only scrolls down
  // A click anywhere outside its section closes it (and an empty section hides again).
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const sec = root.current?.closest('details');
      if (sec && !sec.contains(e.target as Node)) onClose();
    };
    addEventListener('pointerdown', away);
    return () => removeEventListener('pointerdown', away);
  }, []);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => load(q.trim()).then((l) => live && setItems(l), (e) => live && setErr(e.message)), q ? 200 : 0);
    return () => ((live = false), clearTimeout(t));
  }, [q]);
  return (
    <div class="ix-pick" ref={root}>
      <input
        ref={box}
        class="label-find"
        type="search"
        placeholder={placeholder}
        aria-label={placeholder}
        value={q}
        onInput={(e) => setQ(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (composing(e)) return;
          if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onClose());
          else if (e.key === 'Enter' && items?.[0]) (e.preventDefault(), onPick(items[0].key));
        }}
      />
      {err ? <p class="warn ix-pad">{err}</p> : items == null ? <p class="note ix-pad">Loading…</p> : !items.length ? <p class="note ix-pad">{empty}</p> : items.slice(0, 30).map((i) => (
        <button class="ix-item" title={i.title} onClick={() => onPick(i.key)}>
          <span class="ix-label">{i.label}</span>
        </button>
      ))}
    </div>
  );
}
const has = (q: string, ...s: (string | undefined)[]) => !q || s.some((x) => x?.toLowerCase().includes(q.toLowerCase()));
// Opens a section (folded or not) and its picker.
const openSec = (sec: HTMLDetailsElement | null) => sec && (sec.open = true);
// A shortcut to a section's picker: open, in view, its search box focused (it may be open already).
const toPick = (id: string) => {
  openSec(document.querySelector<HTMLDetailsElement>('#' + id));
  setTimeout(() => {
    const box = document.querySelector<HTMLInputElement>(`#${id} .ix-pick input`);
    box?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    box?.focus({ preventScroll: true });
  }, 50);
};

// The PR's assignees, milestone, my subscription and its lock (github.ts getPrMeta), shared by the sections that show
// them; a change shows at once and goes back if it fails.
const metas = new Map<string, PrMeta>();
function usePrMeta(repo: string, n: number) {
  const k = `${repo}#${n}`;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = () => tick((x) => x + 1);
    addEventListener('lgtm:prmeta', t);
    if (!metas.has(k)) getPrMeta(repo, n).then((m) => (metas.set(k, m), t()), () => {});
    return () => removeEventListener('lgtm:prmeta', t);
  }, [k]);
  const meta = metas.get(k) ?? null;
  const change = (next: PrMeta, run: () => Promise<unknown>, said?: string) => {
    if (!meta) return;
    const was = meta;
    metas.set(k, next), dispatchEvent(new Event('lgtm:prmeta'));
    run().then(
      () => said && dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: said, ms: 2500 } })),
      (e) => (metas.set(k, was), dispatchEvent(new Event('lgtm:prmeta')), dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `Couldn't change it: ${e.message}`, ms: 5000 } }))),
    );
  };
  return [meta, change] as const;
}
// The index's shortcuts for these (review.tsx: G, M, S, O), each to its section.
function useDetailsKey(what: string, run: () => void) {
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === what && run();
    addEventListener('lgtm:details', on);
    return () => removeEventListener('lgtm:details', on);
  });
}

// My Slack thread with someone about this PR (review.tsx slackThreads), by their name in People: Slack's mark.
const SlackLink = ({ url, who }: { url?: string; who: string }) =>
  url ? (
    <a class="ix-slack" href={url} target="_blank" rel="noopener" title={`Your Slack thread with @${who} about this ${pageTerm().PR}`} aria-label={`Slack thread with @${who}`} onClick={(e) => e.stopPropagation()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#E01E5A" d="M5 15a2 2 0 1 1-2-2h2v2zm1 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5z" /><path fill="#36C5F0" d="M9 5a2 2 0 1 1 2-2v2H9zm0 1a2 2 0 1 1 0 4H4a2 2 0 1 1 0-4h5z" /><path fill="#2EB67D" d="M19 9a2 2 0 1 1 2 2h-2V9zm-1 0a2 2 0 1 1-4 0V4a2 2 0 1 1 4 0v5z" /><path fill="#ECB22E" d="M15 19a2 2 0 1 1-2 2v-2h2zm0-1a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5z" /></svg>
    </a>
  ) : null;

// The PR's assignees, as People's rows: each with × to unassign (when you may); adding, the picker of who may be.
// skip: ones shown as reviewers (their row says assigned too).
function AssigneeRows({ repo, n, canEdit, adding, onDone, skip, slack }: { repo: string; n: number; canEdit: boolean; adding: boolean; onDone: () => void; skip: Set<string>; slack?: Map<string, string> }) {
  const [meta, change] = usePrMeta(repo, n);
  if (!meta) return null;
  const set = (list: string[]) => change({ ...meta, assignees: list }, () => setAssignees(repo, n, meta.assignees, list));
  return (
    <>
      {adding && canEdit && (
        <Picker
          placeholder="Find someone to assign…"
          empty="Nobody matches."
          load={async (q) => (await getAssignable(repo, q)).filter((u) => !meta.assignees.includes(u.login)).map((u) => ({ key: u.login, label: <><img class="ix-face" src={faceOf(u.login)} alt="" /> {u.login}{u.name && <small> {u.name}</small>}</> }))}
          onPick={(login) => set([...(metas.get(`${repo}#${n}`)?.assignees ?? meta.assignees), login])}
          onClose={onDone}
        />
      )}
      {meta.assignees.filter((l) => !skip.has(l)).map((l) => (
        <div class="ix-check">
          <span class="ix-item ix-person dim-click" title={`@${l}: assigned`}>
            <span class="ix-label"><img src={faceOf(l)} alt="" /> {shortLogin(l)} <span class="ix-meta"><Tg i="assigned" t="assigned" /></span><SlackLink url={slack?.get(l)} who={l} /></span>
          </span>
          {canEdit && <button class="ix-icon-btn ix-withdraw" title={`Unassign @${l}`} aria-label={`Unassign @${l}`} onClick={() => set(meta.assignees.filter((x) => x !== l))}><Icon name="x" /></button>}
        </div>
      ))}
    </>
  );
}

// What the PR is and where it's tracked, in one section: its labels, its milestone, its GitHub Projects (each with its
// Status) and the Jira tickets and issues it's linked to. The header's icons add each (their keys: l, M, P, L); a chip's
// × takes it off (a ticket from the title, an issue's "Closes #12" from the description; one linked otherwise stays).
type Adding = 'label' | 'milestone' | 'project' | 'link' | null;
function DetailsSec({ repo, pr, canEdit }: { repo: string; pr: PR; canEdit: boolean }) {
  const n = pr.number, lab = isLab(repo);
  const [meta, change] = usePrMeta(repo, n);
  const [labels, setLabels] = useState<Label[]>(pr.labels ?? []);
  useEffect(() => setLabels(pr.labels ?? []), [(pr.labels ?? []).map((l) => l.name).join('\n')]);
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [projErr, setProjErr] = useState('');
  const [issues, setIssues] = useState<LinkedIssue[]>([]);
  const [adding, setAdding] = useState<Adding>(null);
  const [statusOf, setStatusOf] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const keys = readBindings(localStorage.getItem('shortcuts') ?? '{}');
  const loadProjects = () => prProjects(repo, n).then((l) => (setProjects(l), setProjErr('')), (e) => setProjErr(e.message));
  useEffect(() => void (setProjects(null), setProjErr(''), !lab && loadProjects()), [repo, n]);
  useEffect(() => void linkedIssues(repo, n).then((d) => setIssues(d.issues), () => setIssues([])), [repo, n, pr.body]);
  const open = (k: Adding) => canEdit && (k !== 'project' || !lab) && (setAdding(k), toPick('ix-details'));
  useDetailsKey('label', () => open('label'));
  useDetailsKey('milestone', () => open('milestone'));
  useDetailsKey('projects', () => open('project'));
  useDetailsKey('linkIssue', () => open('link'));
  const tickets = jiraKeys(pr.title, pr.head.ref);
  const onProjects = projects?.filter((p) => p.item) ?? [];
  const count = labels.length + (meta?.milestone ? 1 : 0) + onProjects.length + tickets.length + issues.length;
  if (!count && !canEdit) return null;
  const fail = (e: Error) => setErr(e.message);
  const chip = (l: Label) => ({ '--lc': l.color ? '#' + l.color : 'var(--muted)' }) as preact.JSX.CSSProperties;
  const flipLabel = (l: Label, add: boolean) => {
    setErr('');
    setLabels((x) => (add ? [...x, l] : x.filter((y) => y.name !== l.name)));
    setLabel(repo, n, l.name, add).then(() => dispatchEvent(new Event('lgtm:refresh')), (e) => (fail(e), setLabels((x) => (add ? x.filter((y) => y.name !== l.name) : [...x, l]))));
  };
  const setMs = (m: Milestone | null) => meta && change({ ...meta, milestone: m }, () => setMilestone(repo, n, m?.id ?? null));
  const project = (job: Promise<unknown>) => (setErr(''), job.then(loadProjects, fail));
  // Linking and unlinking rewrite the PR's title or description, then it reloads.
  const edit = (f: { title: string; body: string }, said: string) => (setErr(''), updatePR(repo, n, f).then(() => (forgetLinked(repo, n), dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: said, ms: 2500 } })), dispatchEvent(new Event('lgtm:refresh'))), fail));
  const link = (q: string) => {
    const r = parseLinkRef(repo, q);
    if (!r) return;
    setAdding(null);
    void ('jira' in r ? edit({ title: withKey(pr.title, r.jira), body: pr.body ?? '' }, `Linked ${r.jira}.`) : edit({ title: pr.title, body: `${(pr.body ?? '').trimEnd()}\n\nCloses ${r.issue}`.trimStart() }, `Linked ${r.issue}.`));
  };
  const refOf = (i: LinkedIssue) => (i.repo === repo ? `#${i.number}` : `${lab ? i.repo.slice(i.repo.indexOf('/') + 1) : i.repo}#${i.number}`);
  let milestones: Milestone[] = [];
  const btn = (k: Exclude<Adding, null>, icon: string, label: string) => <HeadBtn icon={icon} label={label} on={adding === k} run={(sec) => (openSec(sec), setAdding((a) => (a === k ? null : k)))} />;
  const close = () => setAdding(null);
  return (
    <Section
      id="ix-details"
      title="Details"
      count={count}
      extra={canEdit && (
        <span class="ix-head-acts">
          {btn('label', 'tag', `Add a label${hint(keys.label)}`)}
          {btn('milestone', 'milestone', `${meta?.milestone ? 'Change the' : 'Set a'} milestone${hint(keys.milestone)}`)}
          {!lab && btn('project', 'tasklist', `Add it to a GitHub Project${hint(keys.projects)}`)}
          {btn('link', 'link', `Link an issue or Jira ticket${hint(keys.linkIssue)}`)}
        </span>
      )}
    >
      {adding === 'label' && (
        <Picker
          placeholder="Find a label…"
          empty="No label to add."
          load={async (q) => (await repoLabels(repo)).filter((l) => !labels.some((x) => x.name === l.name) && has(q, l.name)).map((l) => ({ key: l.name, title: l.description || undefined, label: <><span class="label-dot" style={chip(l)} /> {l.name}</> }))}
          onPick={async (name) => ((l) => l && flipLabel(l, true))((await repoLabels(repo)).find((x) => x.name === name))}
          onClose={close}
        />
      )}
      {adding === 'milestone' && meta && (
        <Picker
          placeholder="Find a milestone…"
          empty="No open milestones."
          load={async (q) => ((milestones = await getMilestones(repo)), milestones.filter((m) => m.id !== meta.milestone?.id && has(q, m.title)).map((m) => ({ key: String(m.id), label: <><Octicon name="milestone" /> {m.title}{m.due && <small> · due {new Date(m.due).toLocaleDateString()}</small>}</> })))}
          onPick={(id) => (setMs(milestones.find((m) => String(m.id) === id) ?? null), close())}
          onClose={close}
        />
      )}
      {adding === 'project' && (projErr ? <p class="warn ix-pad">{projErr}</p> : (
        <Picker
          placeholder="Find a Project…"
          empty="No other open Projects."
          load={async (q) => (projects ?? []).filter((p) => !p.item && has(q, p.title)).map((p) => ({ key: p.id, label: <><Octicon name="tasklist" /> {p.title}</> }))}
          onPick={(id) => (close(), void project(addToProject(id, pr.node_id)))}
          onClose={close}
        />
      ))}
      {adding === 'link' && (
        <Picker
          placeholder="#12, an issue link, or SHOP-12"
          empty="An issue number (#12), an issue link, or a Jira key (SHOP-12)"
          load={async (q) => ((r) => (!r || ('jira' in r && tickets.includes(r.jira)) ? [] : [{ key: q, label: 'jira' in r ? <>Link Jira ticket {r.jira} <small>(into the title)</small></> : <><Octicon name="issue-opened" /> Link issue {r.issue} <small>(closes when this merges)</small></> }]))(parseLinkRef(repo, q))}
          onPick={link}
          onClose={close}
        />
      )}
      {statusOf && ((p) => p?.status && (
        <Picker
          placeholder={`Status on ${p.title}…`}
          empty="No such status."
          load={async (q) => p.status!.options.filter((o) => has(q, o.name)).map((o) => ({ key: o.id, label: <>{o.name}{o.name === p.item?.status && <small> · now</small>}</> }))}
          onPick={(o) => (setStatusOf(null), void project(setProjectStatus(p.id, p.item!.id, p.status!.field, o)))}
          onClose={() => setStatusOf(null)}
        />
      ))(onProjects.find((p) => p.id === statusOf))}
      {labels.length > 0 && (
        <div class="ix-labels">
          {labels.map((l) => (
            <span class="label-chip" style={chip(l)} title={l.description || l.name}>
              {l.name}
              {canEdit && <button class="label-x" aria-label={`Remove ${l.name}`} title={`Remove ${l.name}`} onClick={() => flipLabel(l, false)}>×</button>}
            </span>
          ))}
        </div>
      )}
      {meta?.milestone && (
        <div class="ix-labels">
          <span class="label-chip" title={meta.milestone.due ? `Due ${new Date(meta.milestone.due).toLocaleDateString()}` : meta.milestone.title}>
            <Octicon name="milestone" /> {meta.milestone.title}
            {canEdit && <button class="label-x" aria-label="Remove the milestone" title="Remove the milestone" onClick={() => setMs(null)}>×</button>}
          </span>
        </div>
      )}
      {onProjects.length > 0 && (
        <div class="ix-labels">
          {onProjects.map((p) => (
            <span class="label-chip" title={p.status ? `${p.title}: ${p.item!.status ?? 'no status'}${canEdit ? '. Click to change it' : ''}` : p.title}>
              <button class="chip-btn" disabled={!canEdit || !p.status} onClick={() => setStatusOf(p.id)}><Octicon name="tasklist" /> {p.title}{p.item!.status && <small> · {p.item!.status}</small>}</button>
              {canEdit && <button class="label-x" aria-label={`Take it off ${p.title}`} title={`Take it off ${p.title}`} onClick={() => void project(removeFromProject(p.id, p.item!.id))}>×</button>}
            </span>
          ))}
        </div>
      )}
      {tickets.length + issues.length > 0 && (
        <div class="ix-labels">
          {tickets.map((k) => (
            <span class="label-chip">
              <button class="chip-btn" title={`${k}: its card above the conversation`} onClick={() => jumpTo(`ticket-${k}`)}><Octicon name="link" /> {k}</button>
              {canEdit && pr.title.includes(k) && <button class="label-x" aria-label={`Unlink ${k}`} title={`Unlink ${k}: out of the title`} onClick={() => void edit({ title: withoutKey(pr.title, k), body: pr.body ?? '' }, `Unlinked ${k}.`)}>×</button>}
            </span>
          ))}
          {issues.map((i) => (
            <span class="label-chip">
              <button class="chip-btn" title={`${i.title} (${i.open ? 'open' : 'closed'}): its card above the conversation`} onClick={() => jumpTo(`issue-${i.repo}#${i.number}`)}><Octicon name={i.open ? 'issue-opened' : 'issue-closed'} /> {refOf(i)}</button>
              {canEdit && closesIn(pr.body ?? '', refOf(i)) && <button class="label-x" aria-label={`Unlink ${refOf(i)}`} title={`Unlink ${refOf(i)}: its "Closes" out of the description`} onClick={() => void edit({ title: pr.title, body: withoutCloses(pr.body ?? '', refOf(i)) }, `Unlinked ${refOf(i)}.`)}>×</button>}
            </span>
          ))}
        </div>
      )}
      {err && <p class="warn ix-pad">{err}</p>}
    </Section>
  );
}

// The Conversation section's header: my threads on their own (when I have some), my notifications (the bell) and the
// lock, each a click.
function ConvToggles({ repo, n, prNode, canEdit, threads }: { repo: string; n: number; prNode: string; canEdit: boolean; threads: boolean }) {
  const [meta, change] = usePrMeta(repo, n);
  const keys = readBindings(localStorage.getItem('shortcuts') ?? '{}');
  const T = pageTerm();
  const subscribe = () => meta && meta.subscribed != null && change({ ...meta, subscribed: !meta.subscribed }, () => setSubscribed(repo, n, prNode, !meta.subscribed), meta.subscribed ? `Unsubscribed: no notifications about this ${T.PR} unless you're mentioned` : `Subscribed to this ${T.PR}'s notifications`);
  const lock = async () => {
    if (!meta || !canEdit) return;
    if (!meta.locked && !(await ask(`Lock the conversation? Only people with write access can comment.`, 'Lock'))) return;
    change({ ...meta, locked: !meta.locked }, () => setLocked(repo, n, !meta.locked), meta.locked ? 'Conversation unlocked' : 'Conversation locked');
  };
  useDetailsKey('subscribe', subscribe);
  useDetailsKey('lock', () => void lock());
  if (!meta) return null;
  return (
    <span class="ix-head-acts">
      {threads && <HeadBtn icon="comment-discussion" label={`Your threads on their own, each with its code and what changed since${hint(keys.myThreads)}`} run={() => dispatchEvent(new CustomEvent('lgtm:act', { detail: 'myThreads' }))} />}
      {meta.locked && !canEdit && <span class="ix-head-btn" title="Locked: only people with write access can comment"><Octicon name="lock" /></span>}
      {canEdit && <HeadBtn icon={meta.locked ? 'lock' : 'unlock'} on={meta.locked} label={`${meta.locked ? 'Locked: only people with write access can comment. Unlock' : 'Lock the conversation'}${hint(keys.lock)}`} run={() => void lock()} />}
      {meta.subscribed != null && <HeadBtn icon={meta.subscribed ? 'bell' : 'bell-slash'} on={meta.subscribed} label={`${meta.subscribed ? 'Subscribed to its notifications. Unsubscribe' : 'Not subscribed. Subscribe to its notifications'}${hint(keys.subscribe)}`} run={subscribe} />}
    </span>
  );
}

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
      <Icon name={state === 'sent' ? 'clock' : 'comment'} />
    </button>
  );
}

// On someone else's PR I'm not reviewing yet: request my own review, so it's on GitHub and in my queue.
// teams: the PR asks teams (maybe mine): taking it asks me by name and drops the ones I'm in.
function AddMe({ add, teams = [] }: { add: () => Promise<unknown>; teams?: string[] }) {
  const [state, setState] = useState<'' | 'adding' | string>('');
  return (
    <button
      class="ix-item ix-add-me"
      disabled={state === 'adding'}
      title={state && state !== 'adding' ? state : teams.length ? `Ask yourself to review it by name, and take it off ${teams.map((t) => '@' + t).join(', ')} where you're in it, so the rest of the team stops waiting on it` : `Request your own review on this ${pageTerm().PR}`}
      onClick={() => (setState('adding'), add().then(() => setState(''), (e) => setState(`Couldn't add you: ${e.message}`)))}
    >
      <span class="ix-label">
        <Icon name="person" /> {state === 'adding' ? (teams.length ? 'Taking it…' : 'Adding you…') : state ? "Couldn't add you · retry" : teams.length ? `Take it from ${teams.map((t) => '@' + t).join(', ')}` : 'Add me as a reviewer'}
      </span>
    </button>
  );
}

// Ask a reviewer who's reviewed to look again (after you've pushed fixes): a re-request on GitHub, and on Slack your
// "look again" message in your thread with them. ✓ once asked.
// A reviewer waited on who's away: ask the next free person instead (they're taken off the PR).
function Replace({ login, replace }: { login: string; replace: (login: string) => Promise<{ login: string; said: string }> }) {
  const [state, setState] = useState('');
  const [said, setSaid] = useState('');
  return (
    <button
      class="link ix-pad ix-replace"
      disabled={!!state && state !== 'failed'}
      title={said || `@${login} is away: take them off and ask the next free reviewer (on Slack too, when it's set up)`}
      onClick={() => (setState('asking'), replace(login).then((r) => (setState(`asked @${r.login}`), setSaid(r.said)), (e) => (setState('failed'), reportError(e.message))))}
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
      <Icon name={state === 'done' ? 'clock' : 'sync'} />
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
      class={`ix-rerun bad${state === 'asking' ? ' busy' : state === 'queued' ? ' done' : state ? ' failed' : ''}`}
      disabled={state === 'asking' || state === 'queued'}
      title={state === 'queued' ? 'Queued to run again' : state.startsWith('couldn') ? `${state}; click to try again` : `Run the ${checks.length} failed GitHub Actions job${checks.length > 1 ? 's' : ''} again`}
      onClick={go}
    >
      {state === 'asking' ? 'Re-running…' : state === 'queued' ? 'Queued' : 'Re-run failed'}
    </button>
  );
}

// Every job of every GitHub Actions run on it again (the header's, when none failed: a flaky pass to confirm, say).
function RerunAll({ repo, runs, onRefresh }: { repo: string; runs: string[]; onRefresh: () => void }) {
  const [state, setState] = useState<'' | 'asking' | 'queued' | string>('');
  const go = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    setState('asking');
    Promise.all(runs.map((r) => rerunRun(repo, r))).then(() => (setState('queued'), setTimeout(onRefresh, 3000)), (err) => setState(`couldn't: ${err.message}`));
  };
  return (
    <button class={`ix-rerun${state === 'asking' ? ' busy' : state === 'queued' ? ' done' : state ? ' failed' : ''}`} disabled={state === 'asking' || state === 'queued'} title={state === 'queued' ? 'Queued to run again' : state.startsWith('couldn') ? `${state}; click to try again` : `Run all ${runs.length > 1 ? `${runs.length} runs'` : "the run's"} jobs again`} onClick={go}>
      {state === 'asking' ? 'Re-running…' : state === 'queued' ? 'Queued' : 'Re-run all'}
    </button>
  );
}

// Runs waiting on a person (GitHub): a first-time or fork contributor's workflows, to approve before they run (their
// code runs with the repo's runners), and deployments to an environment I review, to approve or reject.
function WaitingRuns({ repo, sha, onRefresh }: { repo: string; sha: string; onRefresh: () => void }) {
  const [list, setList] = useState<WaitingRun[]>([]);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState('');
  const load = () => waitingRuns(repo, sha).then(setList, () => setList([]));
  useEffect(() => void load(), [repo, sha]);
  const act = async (r: WaitingRun, run: () => Promise<void>) => {
    setBusy(r.id), setErr('');
    await run().then(() => (load(), setTimeout(onRefresh, 3000)), (e) => setErr(e.message));
    setBusy(0);
  };
  if (!list.length) return null;
  return (
    <div class="ix-waiting">
      {list.map((r) => (
        <div class="ix-wait-row">
          <span><Icon name="clock" /> {r.kind === 'approve' ? <>{r.name} waits for approval to run <small>(a first-time or outside contributor's)</small></> : <>{r.name} waits to deploy to {r.envs.map((e) => e.name).join(', ')}</>}</span>
          {r.kind === 'approve' ? (
            <button disabled={busy === r.id} title="Its code runs on the repo's runners: look at what it changes first" onClick={async () => (await ask(`Approve and run ${r.name}? It runs this ${pageTerm().PR}'s code on the repo's runners.`, 'Approve and run')) && act(r, () => approveRun(repo, r.id))}>Approve and run</button>
          ) : (
            <>
              <button disabled={busy === r.id} onClick={async () => { const s = await askText(`Approve deploying to ${r.envs.map((e) => e.name).join(', ')}?`, 'Approve', 'A comment (optional)'); if (s) await act(r, () => reviewDeployment(repo, r.id, r.envs.map((e) => e.id), true, s.text)); }}>Approve</button>
              <button disabled={busy === r.id} onClick={async () => { const s = await askText(`Reject deploying to ${r.envs.map((e) => e.name).join(', ')}?`, 'Reject', 'Why (optional)', undefined, true); if (s) await act(r, () => reviewDeployment(repo, r.id, r.envs.map((e) => e.id), false, s.text)); }}>Reject</button>
            </>
          )}
        </div>
      ))}
      {err && <p class="error">{err}</p>}
    </div>
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

function CheckEntry({ c, repo, onRefresh, base }: { c: Check; repo: string; onRefresh: () => void; base: string }) {
  const { on: agents } = useAgents();
  // Why did it fail? The Ask panel (review.tsx) asks the agent picked, with the end of the job's log and the diff,
  // and takes follow-up questions; here only the log is fetched (the button busy meanwhile).
  const [running, setRunning] = useState(false);
  const explain = async (by: AgentId) => {
    setRunning(true);
    try {
      const text = log ?? (await jobLog(repo, c.jobId!));
      if (log === null) setLog(text);
      dispatchEvent(new CustomEvent('lgtm:ask-ci', { detail: { check: c.name, onBase: c.onBase ?? null, log: text, agent: by } }));
    } catch (e: any) {
      setLogErr(e.message), setOpen(true);
    }
    setRunning(false);
  };
  const [pick, setPick] = useState(false); // the agent menu, with more than one on
  useEffect(() => {
    if (!pick) return;
    const away = (e: Event) => !(e.target as Element).closest?.('.agents-menu') && setPick(false);
    addEventListener('pointerdown', away);
    return () => removeEventListener('pointerdown', away);
  }, [pick]);
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
  // Cancel the run this running job is part of; the checks reload once GitHub has it.
  const [stopped, setStopped] = useState<'' | 'asking' | 'done' | string>('');
  const stop = () => {
    setStopped('asking');
    cancelRun(repo, runOf(c)!).then(
      () => (setStopped('done'), setTimeout(onRefresh, 3000)),
      (e) => setStopped(`couldn't: ${e.message}`),
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
        <a class="ix-item" href={c.url ?? undefined} target="_blank" rel="noopener" title={c.summary ? `${c.name}: ${c.summary}` : c.name}>
          <span class="ix-label">
            <CheckMark state={c.state} /> {c.name}
          </span>
          {/* Its own words ("being built", its name again…) on hover only. */}
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
            <Icon name={played === 'started' ? 'dot-fill' : 'play'} />
          </button>
        )}
        {/* Any finished job runs again, as on GitHub (a passed one too: a flaky deploy, say); a running one's run stops. */}
        {c.state !== 'pending' && !c.manual && c.jobId && (
          <button
            class={`ix-icon-btn${rerun === 'asking' ? ' busy' : rerun === 'queued' ? ' done' : rerun ? ' failed' : ''}`}
            title={rerun === 'queued' ? 'Queued to run again' : rerun.startsWith('couldn') ? `${rerun}; click to try again` : 'Run this job again (and the jobs that wait on it)'}
            aria-label="Run this job again"
            disabled={rerun === 'asking' || rerun === 'queued'}
            onClick={again}
          >
            <Icon name={rerun === 'queued' ? 'dot-fill' : 'sync'} />
          </button>
        )}
        {c.state === 'pending' && !c.manual && runOf(c) && (c.jobId || isLab(repo)) && (
          <button
            class={`ix-icon-btn${stopped === 'asking' ? ' busy' : stopped === 'done' ? ' done' : stopped ? ' failed' : ''}`}
            title={stopped === 'done' ? 'Cancelled' : stopped.startsWith('couldn') ? `${stopped}; click to try again` : "Cancel this job's run"}
            aria-label="Cancel this run"
            disabled={stopped === 'asking' || stopped === 'done'}
            onClick={stop}
          >
            <Icon name="x" />
          </button>
        )}
        {c.state === 'failure' && c.jobId && (
          <>
            <button class={open ? 'ix-icon-btn on' : 'ix-icon-btn'} title={open ? 'Hide the job log' : 'Show the end of the job log'} aria-label="Job log" aria-pressed={open} onClick={toggle}>
              <Icon name="list-unordered" />
            </button>
            {agents.length > 0 && (
              // As the PR bar's Agents: the one agent on, straight away; with more, a menu to pick one.
              <span class="agents-menu">
                <button
                  class={`ix-icon-btn${running ? ' busy' : pick ? ' on' : ''}`}
                  title={agents.length === 1 ? `Why did it fail? ${AGENTS[agents[0]].name} reads the log and the diff` : 'Why did it fail? A coding agent reads the log and the diff'}
                  aria-label="Why did it fail?"
                  aria-haspopup={agents.length > 1 ? 'menu' : undefined}
                  aria-expanded={agents.length > 1 ? pick : undefined}
                  disabled={running}
                  onClick={() => (agents.length === 1 ? explain(agents[0]) : setPick(!pick))}
                >
                  {agents.length === 1 ? <AgentMark id={agents[0]} /> : <Icon name="dependabot" />}
                </button>
                {pick && (
                  <div class="account-menu agents-pop" role="menu">
                    {agents.map((a) => (
                      <button key={a} role="menuitem" onClick={() => (setPick(false), explain(a))}>
                        <AgentMark id={a} /> Ask {AGENTS[a].name} why it failed
                      </button>
                    ))}
                  </div>
                )}
              </span>
            )}
          </>
        )}
      </div>
      {open && (logErr ? <p class="error ix-pad">Couldn't load the log: {logErr} <Retry onClick={loadLog} /></p> : log == null ? <Lines n={4} /> : <pre class="ix-log">{log}</pre>)}
    </>
  );
}

type IndexProps = {
  repo: string;
  canLabel?: boolean; // may add and remove its labels (github.ts prRights)
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
  commits?: PushPoint[]; // the PR's commits, oldest first: the Files section's picker of which changes it shows
  atCommit?: string | null; // the last one on show on its own (review.tsx toSha), if any
  fromCommit?: string | null; // the first one on show (a run of them, shift-clicked), else atCommit
  readCommits?: Set<string>; // the ones I've opened
  newFrom?: number; // the first commit pushed since my last review (-1: none)
  onNew?: () => void; // show those together
  onCommit?: (sha: string | null, shift?: boolean) => void; // show one on its own (shift: from fromCommit to it), or (null) all changes
  ask?: ComponentChildren; // on my own PR: who to ask for a review (review.tsx AskReviewer)
  modules?: Map<string, string>; // each file's Gradle module (files.ts gradleModules), when grouping by them
  steps?: PlanStep[]; // the reading order's steps (files.ts reviewPlan), when the files are in it
  // On my own PR, with Slack: ask a reviewer there (one I have no Slack thread with about it yet); false if it failed.
  slackAsk?: (login: string) => Promise<boolean>;
  slackWith?: Set<string>; // reviewers I already have a Slack thread with about this PR
  slackLinks?: Map<string, string>; // my Slack thread with each person about it: a Slack mark by their name (People)
  reRequest?: (login: string) => Promise<boolean>; // on my own PR: ask a reviewer who's reviewed to look again
  withdraw?: (login: string) => Promise<boolean>; // take back a review request not answered yet (asks first)
  addMe?: () => Promise<unknown>; // on someone else's PR: ask myself for a review (it joins my queue)
  replace?: (login: string) => Promise<{ login: string; said: string }>; // on my own PR: ask someone free instead of a reviewer who's away; says who
  onViewed: OnViewed;
};

// The PR Shortcut Index: who reviews; the conversation (the description, comments and reviews, and review threads, by
// how much they concern me); CI checks; the files.
export function ShortcutIndex({ commits = [], atCommit, fromCommit, readCommits, newFrom = -1, onNew, onCommit, canLabel = false, checksErr, hidden = [], repo, pr, conversation, threads, settled = 0, settledShown, onToggleSettled, drafts, checks, onRefreshChecks, files, viewed, counts, me, ask, modules, steps, onViewed, slackAsk, slackWith, slackLinks, reRequest, withdraw, addMe, replace }: IndexProps) {
  const [byStep, toggleByStep] = useStoredFlag('ixByStep', true); // the files by reading step, else as folders
  const foldBots = useFoldBots(!!me && pr.user.login === me);
  const excerpts = useMemo(() => conversation.map((c) => oneLine(textOf(c.html))), [conversation]);
  const repeats = repeatedFindings(threads); // 🤖 findings posted again: listed once, by their first
  const sortedThreads = threadOrder(threads.filter((t) => !repeats.has(t.id)), [], files).map((x) => x.t!);
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
  // Someone else's words with @me in them (GitHub's mentions: search counts those).
  const atMeRe = me ? new RegExp(`@${me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i') : null;
  const atMe = {
    conv: atMeRe ? conversation.flatMap((c, i) => (c.author !== me && atMeRe.test(textOf(c.html)) ? [{ c, i }] : [])) : [],
    threads: atMeRe ? sortedThreads.filter((t) => t.comments.nodes.some((c) => c.author?.login !== me && atMeRe.test(c.bodyText ?? c.body ?? ''))) : [],
  };
  const waitsOnMe = (t: Thread) => !!me && awaitsMe(t, me, pr.user.login === me); // listed first in its group
  // Threads an agent opened from a person's account (its comment starts with 🤖) fold together in their group, under
  // "yours" (from my account) and "from others", unless one waits on me.
  const byAgent = (t: Thread) => !waitsOnMe(t) && t.comments.nodes[0]?.state !== 'PENDING' && agentSays(t.comments.nodes[0]?.body); // not one in my review still to send
  const agentMine = tiers.mine.filter((t) => byAgent(t) && t.comments.nodes[0]?.author?.login === me);
  const agentOthers = tiers.human.filter(byAgent);
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
  // The file you're reading, marked in the files' list and kept in sight in the index as you scroll. Not while you're
  // using the index (the pointer over it, or a jump from it moments ago): going through its threads, you keep your place.
  useEffect(() => {
    let raf = 0, used = 0;
    const use = (e: Event) => (e.target as Element).closest?.('.index') && (used = Date.now());
    const mark = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const all = document.querySelectorAll<HTMLElement>('main section.file[id^="f-"]');
        const at = all[firstBox(all, (r) => r.bottom > 120)]?.id.slice(2);
        const row = at ? document.querySelector<HTMLElement>(`.index .tree-file[title="${CSS.escape(at)}"]`)?.closest<HTMLElement>('.tree-row') : null;
        const was = document.querySelector('.index .tree-row.cur');
        if (row === was) return;
        was?.classList.remove('cur');
        if (!row) return;
        row.classList.add('cur');
        let box = row.parentElement;
        while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
        if (!box || box.matches(':hover') || Date.now() - used < 2000) return;
        const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
        if (r.top < b.top + 40 || r.bottom > b.bottom - 8) box.scrollTop += r.top - b.top - b.height / 3;
      });
    };
    addEventListener('scroll', mark, { passive: true });
    addEventListener('pointerdown', use, true);
    addEventListener('keydown', use, true);
    mark();
    return () => (removeEventListener('scroll', mark), removeEventListener('pointerdown', use, true), removeEventListener('keydown', use, true), cancelAnimationFrame(raf));
  }, [files]);
  const pending = checks?.filter((c) => c.state === 'pending').length ?? 0;
  // Who's reviewing: each person's latest verdict, "waiting" for ones asked who haven't answered (again).
  const reviewers = new Map<string, { meta: string; icon: string; tone: string; id?: string }>();
  // A bot's approval or change request counts where the repo's rules count it (its comments alone don't make it one).
  for (const c of conversation) if (c.state && (!c.bot || c.state === 'APPROVED' || c.state === 'CHANGES_REQUESTED') && c.author !== pr.user.login) reviewers.set(c.author, { meta: VERDICT[c.state][1], icon: VERDICT[c.state][0], tone: c.state, id: c.id });
  for (const r of pr.requested_reviewers ?? [])
    if (r.type !== 'Bot') reviewers.set(r.login, { meta: reviewers.has(r.login) ? 'asked again' : 'waiting', icon: 'waiting', tone: 'WAITING', id: reviewers.get(r.login)?.id });
  for (const t of pr.requested_teams ?? []) reviewers.set(`team ${t.slug}`, { meta: 'waiting', icon: 'waiting', tone: 'WAITING' });
  // Their Slack statuses: one waited on who's away (sick, vacation, leave) says so, and on my PR can be swapped.
  const presence = usePresence([...reviewers.keys()].filter((w) => !w.startsWith('team ')), repo);
  // People: who it waits on now, in a line on top; its header's icons assign someone (G) and ask for a review.
  const [peopleAdd, setPeopleAdd] = useState<'assign' | 'ask' | null>(null);
  useEffect(() => setPeopleAdd(null), [repo, pr.number]);
  useDetailsKey('assign', () => canLabel && (setPeopleAdd('assign'), toPick('ix-reviewers')));
  const named = (l: string[]) => ((x) => (x.length > 1 ? `${x.slice(0, -1).join(', ')} and ${x.at(-1)}` : x[0]))(l.map((w) => (w.startsWith('team ') ? w.slice(5) : shortLogin(w))));
  const by = (tone: string) => [...reviewers].filter(([, r]) => r.tone === tone).map(([w]) => w);
  const waitingOn =
    pr.state !== 'open' ? null
    : pr.draft ? 'A draft: not asking for review yet'
    : by('WAITING').length ? `Waiting on ${named(by('WAITING'))}`
    : by('CHANGES_REQUESTED').length ? `Waiting on ${shortLogin(pr.user.login)} for ${named(by('CHANGES_REQUESTED'))}'s changes`
    : by('APPROVED').length ? `Approved by ${named(by('APPROVED'))}`
    : 'No reviewer yet';

  // Settings → Reviewing: sections with nothing in them left out (labels, assignees, milestone, checks, reviewers with
  // no one to ask), with one row to add a label, an assignee or a milestone (shortcuts.tsx useDetailsKey opens it).
  const [hideEmpty] = useStoredFlag('hideEmptyIndex', true);
  const [meta, changeMeta] = usePrMeta(repo, pr.number);
  const keys = readBindings(localStorage.getItem('shortcuts') ?? '{}');
  // The Files section's commit picker (with more than one): open or not.
  const [pickOpen, setPickOpen] = useState(false);
  const many = commits.length > 1;
  const onShow = [commits.findIndex((c) => c.sha === (fromCommit ?? atCommit)), commits.findIndex((c) => c.sha === atCommit)];
  const unread = commits.filter((c) => !readCommits?.has(c.sha)).length;
  return (
    <div class="index">
      <Section
        id="ix-reviewers"
        title="People"
        count={1 + (meta?.assignees.filter((a) => a !== pr.user.login && !reviewers.has(a)).length ?? 0) + reviewers.size}
        extra={(canLabel || ask) && (
          <span class="ix-head-acts">
            {canLabel && <HeadBtn icon="person" label={`Assign someone${hint(keys.assign)}`} on={peopleAdd === 'assign'} run={(sec) => (openSec(sec), setPeopleAdd((a) => (a === 'assign' ? null : 'assign')))} />}
            {ask && <HeadBtn icon="code-review" label="Ask someone to review" on={peopleAdd === 'ask'} run={(sec) => (openSec(sec), setPeopleAdd((a) => (a === 'ask' ? null : 'ask')))} />}
          </span>
        )}
      >
        {waitingOn && <p class="ix-waiting-on">{waitingOn}</p>}
        <div class="ix-check">
          <span class="ix-item ix-person dim-click" title={`@${pr.user.login} opened it`}>
            <span class="ix-label"><img src={faceOf(pr.user.login)} alt="" /> {shortLogin(pr.user.login)}<BotMark login={pr.user.login} /> <span class="ix-meta"><Tg i="opened" t="opened it" /></span>{meta?.assignees.includes(pr.user.login) && <span class="ix-meta"> <Tg i="assigned" t="assigned" /></span>}<SlackLink url={slackLinks?.get(pr.user.login)} who={pr.user.login} /></span>
          </span>
          {canLabel && meta?.assignees.includes(pr.user.login) && (
            <button class="ix-icon-btn ix-withdraw" title={`Unassign @${pr.user.login}`} aria-label={`Unassign @${pr.user.login}`} onClick={() => changeMeta({ ...meta, assignees: meta.assignees.filter((x) => x !== pr.user.login) }, () => setAssignees(repo, pr.number, meta.assignees, meta.assignees.filter((x) => x !== pr.user.login)))}>
              <Icon name="person" />
            </button>
          )}
        </div>
        <AssigneeRows repo={repo} n={pr.number} canEdit={canLabel} adding={peopleAdd === 'assign'} onDone={() => setPeopleAdd(null)} skip={new Set([pr.user.login, ...reviewers.keys()])} slack={slackLinks} />
        {[...reviewers].map(([who, r]) => (
          <div class="ix-check">
            <button class={r.id ? 'ix-item ix-person' : 'ix-item ix-person dim-click'} onClick={() => r.id && jumpTo('cv-' + r.id)} title={r.id ? `Go to @${who}'s review` : `@${who}: ${r.meta}`}>
              <span class="ix-label">
                {!who.startsWith('team ') && <img src={faceOf(who)} alt="" />}
                {who.startsWith('team ') ? who : shortLogin(who)}<BotMark login={who} /> <span class={`ix-meta v-${r.tone}`}><Tg i={r.icon} t={r.meta} /></span>
                {meta?.assignees.includes(who) && <span class="ix-meta"> <Tg i="assigned" t="assigned" /></span>}
                <StatusMark s={presence[who]} late={r.tone === 'WAITING' ? lateFor(presence[who]) : null} />
              </span>
            </button>
            <SlackLink url={slackLinks?.get(who)} who={who} />
            {canLabel && meta?.assignees.includes(who) && (
              <button class="ix-icon-btn ix-withdraw" title={`Unassign @${who}`} aria-label={`Unassign @${who}`} onClick={() => changeMeta({ ...meta, assignees: meta.assignees.filter((x) => x !== who) }, () => setAssignees(repo, pr.number, meta.assignees, meta.assignees.filter((x) => x !== who)))}>
                <Icon name="person" />
              </button>
            )}
            {replace && r.tone === 'WAITING' && isAway(presence[who]) && <Replace login={who} replace={replace} />}
            {reRequest && r.id && r.tone !== 'WAITING' && !who.endsWith('[bot]') && <ReRequest login={who} again={reRequest} />}
            {withdraw && r.tone === 'WAITING' && !who.startsWith('team ') && (
              <button class="ix-icon-btn ix-withdraw" title={`Take back the review request for @${who}`} aria-label={`Take back the review request for @${who}`} onClick={() => void withdraw(who)}>
                <Icon name="x" />
              </button>
            )}
            {slackAsk && !who.startsWith('team ') && !slackWith?.has(who) && <SlackAsk login={who} ask={slackAsk} />}
          </div>
        ))}
        {/* Asking someone: after the people it's with (its header's icon, or by itself while no one reviews). */}
        {(peopleAdd === 'ask' || !reviewers.size) && ask && (
          <>
            {pr.draft && <p class="note ix-pad">Asking someone marks it ready for review.</p>}
            {ask}
          </>
        )}
        {addMe && !reviewers.has(me) && <AddMe add={addMe} teams={(pr.requested_teams ?? []).map((t) => t.slug)} />}
      </Section>

      <DetailsSec repo={repo} pr={pr} canEdit={canLabel} />
      <Section title="Conversation" count={conversation.length - replaced.size + 1 + sortedThreads.length + drafts.length} extra={<ConvToggles repo={repo} n={pr.number} prNode={pr.node_id} canEdit={canLabel} threads={tiers.mine.length > 0} />}>
        <Entry label="Description" onClick={() => jumpTo('pr-description')} />
        {/* Where someone @-mentions me (why it's under "Mentioned you" in the list): their comments, and threads. */}
        {(atMe.conv.length > 0 || atMe.threads.length > 0) && (
          <Fold k="ix-at-me" class="ix-ckgroup">
            <summary><Octicon name="mention" /> {atMe.conv.length + atMe.threads.length} mention{atMe.conv.length + atMe.threads.length === 1 ? 's' : ''} you</summary>
            {atMe.threads.map((t) => threadEntry(t))}
            {atMe.conv.map(({ c, i }) => convEntry(c, i))}
          </Fold>
        )}
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
            {tiers.mine.filter((t) => !waitsOnMe(t) && !agentMine.includes(t)).map((t) => threadEntry(t))}
            {agentMine.length > 0 && (
              <Fold k="ix-yours-agent" initial={false} class="ix-ckgroup">
                <summary>🤖 {agentMine.length} by your agent</summary>
                {agentMine.map((t) => threadEntry(t))}
              </Fold>
            )}
          </Fold>
        )}
        {othersConv + tiers.human.length > 0 && (
          <Fold k={`ix-others:${minePR ? 'mine' : 'theirs'}`} initial={minePR} class="ix-ckgroup">
            <summary><Octicon name="comment-discussion" /> {othersConv + tiers.human.length} from others</summary>
            {tiers.human.filter(waitsOnMe).map((t) => threadEntry(t))}
            {conversation.map((c, i) => !c.bot && c.author !== me && !replaced.has(c.id) && convEntry(c, i))}
            {tiers.human.filter((t) => !waitsOnMe(t) && !agentOthers.includes(t)).map((t) => threadEntry(t))}
            {agentOthers.length > 0 && (
              <Fold k="ix-others-agent" initial={false} class="ix-ckgroup">
                <summary>🤖 {agentOthers.length} by their agents</summary>
                {agentOthers.map((t) => threadEntry(t))}
              </Fold>
            )}
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

      {!(hideEmpty && checks?.length === 0 && !checksErr) && (
      <Section
        title="Checks"
        count={checks?.length ?? 0}
        extra={
          <>
            {failing > 0 && <span class="ck-sum ck-failure">{failing} failing</span>}
            {rerunnable.length > 0 && <RerunFailed repo={repo} checks={rerunnable} onRefresh={onRefreshChecks} />}
            {!failing && !pending && ((runs) => runs.length > 0 && <RerunAll repo={repo} runs={runs} onRefresh={onRefreshChecks} />)([...new Set((checks ?? []).filter((c) => c.jobId).map(runOf).filter((r): r is string => !!r))])}
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
        <WaitingRuns repo={repo} sha={pr.head.sha} onRefresh={onRefreshChecks} />
        {!checks ? (
          <div class="ix-pad"><Lines /></div>
        ) : checksErr ? (
          <p class="error ix-pad">Couldn't load the checks: {checksErr} <Retry onClick={onRefreshChecks} /></p>
        ) : !checks.length ? null : (
          <>
            {checks.filter((c) => c.state === 'failure' || c.state === 'pending').map((c) => <CheckEntry key={c.name} c={c} repo={repo} onRefresh={onRefreshChecks} base={pr.base.ref} />)}
            {([['success', 'passed'], ['neutral', 'skipped or cancelled']] as const).map(([state, label]) => {
              const group = checks.filter((c) => c.state === state);
              return group.length > 0 && (
                <Fold k={`ix-checks:${state}`} initial={false} class="ix-ckgroup">
                  <summary><CheckMark state={state} /> {group.length} {label}</summary>
                  {group.map((c) => <CheckEntry key={c.name} c={c} repo={repo} onRefresh={onRefreshChecks} base={pr.base.ref} />)}
                </Fold>
              );
            })}
          </>
        )}
      </Section>
      )}

      {/* The PR's changes: its files, or (with more than one) its commits, the header's icons switching between them. */}
      <Section
        id="ix-changes"
        title="Files"
        count={files.length}
        extra={
          <>
            {viewedCount > 0 && <span class="ck-sum">{viewedCount}/{files.length} viewed</span>}
            {steps && (
              <button
                class="link ix-files-view"
                title={byStep ? 'Show the files as folders' : "Show the files by reading step, in the diff's order"}
                onClick={(e) => (e.preventDefault(), e.stopPropagation(), toggleByStep())}
              >
                <Octicon name={byStep ? 'file-directory' : 'list-ordered'} /> {byStep ? 'Folders' : 'Steps'}
              </button>
            )}
          </>
        }
      >
        {/* Which changes the files are of, as GitHub's "Changes from all commits ▾": all, one commit or a run (shift-click);
            the list opens here, the files staying in sight under it. */}
        {many && (
          <details class="ix-commit-pick" open={pickOpen} onToggle={(e) => setPickOpen(e.currentTarget.open)}>
            <summary class="ix-item" title={`Show the changes of one commit, or a run of them (shift-click)${hint(keys.prevCommit)}${hint(keys.nextCommit)}`}>
              <span class="ix-label">
                <Octicon name="git-commit" />{' '}
                {!atCommit ? <>All changes <span class="ix-meta">{commits.length} commits{unread && unread < commits.length ? `, ${unread} not opened` : ''}</span></>
                  : onShow[0] !== onShow[1] ? <>{onShow[1] - onShow[0] + 1} commits <span class="ix-meta">{commits[onShow[0]]?.sha.slice(0, 7)}…{commits[onShow[1]]?.sha.slice(0, 7)}</span></>
                  : <><code>{atCommit.slice(0, 7)}</code> {commits[onShow[1]]?.label}</>}
              </span>
            </summary>
            <div class="ix-commit-list" onClick={(e) => (e.target as Element).closest('button') && !(e as MouseEvent).shiftKey && setPickOpen(false)}>
          {newFrom >= 0 && <Entry label={<><Octicon name="history" /> {commits.length - newFrom} new since your last review, together{hint(keys.newCommits)}</>} onClick={() => onNew?.()} />}
          {unread > 0 && unread < commits.length && <p class="note ix-pad">{unread} not opened yet: Next{hint(keys.nextCommit)} goes to them.</p>}
          {atCommit && <Entry label="All changes" onClick={() => onCommit?.(null)} />}
          {commits.map((c, i) => (
            <button class={`ix-item ix-commit${readCommits?.has(c.sha) ? ' read' : ''}${newFrom >= 0 && i >= newFrom ? ' new' : ''}`} aria-current={(i >= onShow[0] && i <= onShow[1]) || undefined} onClick={(e) => onCommit?.(c.sha, e.shiftKey)} title={`${c.sha}\n${c.label}${readCommits?.has(c.sha) ? '\nOpened' : ''}\nShift-click: from the commit on show to this one`}>
              <span class="ix-label"><Octicon name="git-commit" /> <code>{c.sha.slice(0, 7)}</code> {c.label} <span class="ix-meta"><Time at={c.at} /></span></span>
            </button>
          ))}
            </div>
          </details>
        )}
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

