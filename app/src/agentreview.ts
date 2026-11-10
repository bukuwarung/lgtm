// Agents review first (Settings → Reviewing): each PR that comes to "Needs your review" goes to the coding agent
// Settings → Reviewing names (Claude Code or Codex, among those on in Settings → Coding agents) for an
// adversarial review before you look, and its findings go on the PR under your account, each opening with 🤖 (lgtm
// and readers tell them from yours; with "🤖 comments are a bot's" on, lgtm folds them with bot comments). As a pending
// review you finish yourself, or as comments posted straight away (agentReviewPost).
//
// The agent gets the description, the diff with its line numbers, and the changed files' text: no tools, no checkout
// (agents.ts runAgent). Its findings are checked against the diff: a line it names that the diff doesn't have goes on the
// file instead. One run per PR and head commit, two at a time; the list shows the PRs being reviewed above "Needs your
// review" (main.tsx), and each run is remembered per account (platform.ts own).
import { postAgentFindings, getCompare, getRaw, loadPR, type Draft, type PRFile, type QueueItem } from './github.ts';
import { notifyAgentDone, own, term } from './platform.ts';
import { AGENTS, agentIdOf, autoAgent, detectAgents, runAgent, type AgentId } from './agents.ts';
import { parsePatch } from './diff.ts';
import { fillPrompt, prFields, promptTemplate, reindent } from './prompts.ts';

export type AgentRun = {
  version: string; // the PR's head commit when it ran: a new push runs it again
  state: 'queued' | 'running' | 'done' | 'failed' | 'limited'; // limited: over today's limit, it waits for tomorrow
  at: number;
  day?: string; // the day an automatic run was queued, for the daily limit
  manual?: boolean; // asked for from the PR (its Agents menu): not counted against the limit
  by?: string; // the agent that did it (Claude Code, Codex)
  asked?: string; // the review request it answered (QueueItem.waitingSince): only a new one runs it again
  since?: string; // a re-review: the commit it read the changes from (the last run's)
  findings?: number;
  posted?: 'pending' | 'comment';
  error?: string;
};
const KEY = 'agentRuns';
const read = (): Record<string, AgentRun> => {
  try {
    return JSON.parse(localStorage.getItem(own(KEY)) ?? '{}');
  } catch {
    return {};
  }
};
let runs = read();
const save = () => {
  try {
    // ponytail: the latest 200 runs kept; an older PR that comes back is simply reviewed again.
    const keep = Object.entries(runs).sort((a, b) => b[1].at - a[1].at).slice(0, 200);
    localStorage.setItem(own(KEY), JSON.stringify(Object.fromEntries(keep)));
  } catch {}
  dispatchEvent(new Event('lgtm:agents'));
};
const set = (id: string, r: AgentRun) => ((runs = { ...runs, [id]: r }), save());

export const agentReviewOn = () => {
  try {
    return localStorage.getItem(own('agentReview')) === '1';
  } catch {
    return false;
  }
};
const postMode = (): 'pending' | 'comment' => {
  try {
    return localStorage.getItem(own('agentReviewPost')) === 'comment' ? 'comment' : 'pending';
  } catch {
    return 'pending';
  }
};
type Target = Pick<QueueItem, 'id' | 'repo' | 'number'> & { headSha?: string; waitingSince?: string };
// Its latest run, on whichever commit: new pushes alone don't run it again.
export const agentRunOf = (i: Pick<QueueItem, 'id'> & { headSha?: string }) => runs[i.id];
// Whether a PR sits in "Agents reviewing" rather than "Needs your review".
export const agentBusy = (i: Pick<QueueItem, 'id'> & { headSha?: string }) => {
  const r = agentRunOf(i);
  return !!r && (r.state === 'queued' || r.state === 'running');
};

// The PRs waiting for my review: each reviewed once, then again only when I'm asked to review it again (a new review
// request, with new commits): that time only the changes since its last run. Queued, two run at a time. A run left
// "running" by a closed window starts again.
// At most this many automatic runs a day (Settings → Reviewing); 0, no limit.
export const agentLimit = () => {
  try {
    return Math.max(0, Number(localStorage.getItem(own('agentReviewLimit')) ?? 20) || 0);
  } catch {
    return 20;
  }
};
let active = 0;
const queue: (Target & { manual?: boolean; agent: AgentId; since?: string })[] = [];
const inflight = new Set<string>(); // queued or running in this window
export async function reviewWithAgents(waiting: QueueItem[]) {
  if (!agentReviewOn()) return;
  await detectAgents();
  const agent = autoAgent();
  if (!agent) return; // none installed and on
  const today = new Date().toDateString();
  let used = Object.values(runs).filter((r) => !r.manual && r.state !== 'limited' && r.day === today).length;
  for (const i of waiting) {
    const r = runs[i.id];
    if (!i.headSha || inflight.has(i.id)) continue;
    let since = r?.since;
    if (r && (r.state === 'done' || r.state === 'failed')) {
      // Runs from before `asked` was kept count as answering the request there is now.
      const again = i.requested && !!i.waitingSince && (r.asked ?? i.waitingSince) !== i.waitingSince && r.version !== i.headSha;
      if (!again) {
        if (!r.asked && i.waitingSince) set(i.id, { ...r, asked: i.waitingSince });
        continue;
      }
      if (r.state === 'done') since = r.version; // else from where the failed one started
    }
    if (agentLimit() && used >= agentLimit()) {
      if (r?.state !== 'limited') set(i.id, { version: i.headSha, state: 'limited', at: Date.now(), since });
      continue;
    }
    used++;
    inflight.add(i.id);
    set(i.id, { version: i.headSha, state: 'queued', at: Date.now(), day: today, asked: i.waitingSince, since });
    queue.push({ ...i, agent, since });
  }
  pump();
}
// Again, after it failed (the pill's retry): asked for, so not against the limit.
export function retryAgent(i: QueueItem) {
  const agent = agentIdOf(runs[i.id]?.by) ?? autoAgent();
  if (!agent) return;
  delete runs[i.id];
  reviewNow(i, agent);
}
// A review asked for from the PR (its Agents menu), by the agent picked there: next in line, the automatic setting on or off, your own PRs too.
// What it found is said when it's done, and the PR reloads to show it.
export function reviewNow(i: Target, agent: AgentId) {
  if (!i.headSha || inflight.has(i.id)) return false;
  inflight.add(i.id);
  set(i.id, { version: i.headSha, state: 'queued', at: Date.now(), manual: true, by: AGENTS[agent].name, asked: runs[i.id]?.asked ?? i.waitingSince });
  queue.unshift({ ...i, manual: true, agent });
  pump();
  return true;
}
function pump() {
  while (active < 2 && queue.length) {
    const i = queue.shift()!;
    const v = i.headSha ?? '', manual = i.manual, by = AGENTS[i.agent].name;
    const { day, asked, since } = runs[i.id] ?? {};
    const base = { version: v, day, manual, by, asked, since };
    active++;
    set(i.id, { ...base, state: 'running', at: Date.now() });
    review(i)
      .then((r) => {
        set(i.id, { ...base, state: 'done', at: Date.now(), ...r });
        notifyAgentDone(`${by} reviewed it`, `${ref(i)}: ${r.findings ? `${r.findings} finding${r.findings > 1 ? 's' : ''}` : 'nothing found'}`, `/${i.repo}/pull/${i.number}`);
        if (manual) say(`${by} reviewed ${ref(i)}: ${r.findings ? `${r.findings} finding${r.findings > 1 ? 's' : ''}, ${r.posted === 'pending' ? 'in your pending review' : 'posted as comments'}` : 'nothing to point out'}`);
      })
      .catch((e: Error) => {
        set(i.id, { ...base, state: 'failed', at: Date.now(), error: e.message });
        notifyAgentDone(`${by} couldn't review it`, `${ref(i)}: ${e.message}`, `/${i.repo}/pull/${i.number}`);
        if (manual) say(`${by} couldn't review it: ${e.message}`);
      })
      .finally(() => (active--, inflight.delete(i.id), pump()));
  }
}
const ref = (i: Target) => `${i.repo.split('/').pop()}${term(i.repo).PR === 'MR' ? '!' : '#'}${i.number}`;
const say = (text: string) => (dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text } })), dispatchEvent(new Event('lgtm:refresh')));

type Finding = { path: string; line?: number; start_line?: number; side?: 'RIGHT' | 'LEFT'; severity?: string; title: string; body: string; fix?: string };
const SKIP = /(^|\/)([\w.-]+\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.(min\.js|map|svg|png|jpe?g|gif|webp|pdf|zip|jar)$/i;

async function review(i: Target & { agent: AgentId; since?: string }): Promise<Pick<AgentRun, 'findings' | 'posted'>> {
  const { pr, files } = await loadPR(i.repo, i.number);
  // A re-review reads the changes since the last run, in the PR's files; after a rebase (no shared history), all of it.
  // ponytail: a merge of the base branch in those commits shows its changes to the PR's files too.
  const cmp = i.since ? await getCompare(i.repo, i.since, pr.head.sha).catch(() => null) : null;
  const since = cmp && cmp.status !== 'diverged' ? i.since : undefined;
  const changed = since ? cmp!.files.filter((f) => files.some((p) => p.filename === f.filename)) : files;
  const shown = changed.filter((f) => f.patch && !SKIP.test(f.filename)).slice(0, 60);
  // The changed files as they are now, while the prompt has room (about 300 KB in all, 60 KB a file).
  let room = 300_000;
  const texts: string[] = [];
  for (const f of shown.filter((f) => f.status !== 'removed')) {
    if (room <= 0) break;
    const t = await getRaw(pr.head.repo?.full_name ?? i.repo, f.filename, pr.head.sha).catch(() => null);
    if (!t || t.length > 60_000) continue;
    texts.push(`--- ${f.filename} (whole file, at the PR's head)\n${t}`);
    room -= t.length;
  }
  const T = term(i.repo);
  const prompt = [
    fillPrompt(promptTemplate('agent'), prFields(pr, i.repo)), // yours to change (Settings → Coding agents → Prompts)
    'Answer with JSON only, no prose around it: {"summary": "one or two sentences", "findings": [{"path": "file path as in the diff", "line": 12, "side": "RIGHT", "severity": "high|medium|low", "title": "short", "body": "what is wrong and why, and what to do (Markdown)"}]}',
    'Line numbers: use the R numbers in the diff below (the new file); use side "LEFT" with an L number only for a removed line. Leave "line" out for a finding about a whole file.',
    'A simple fix: when a finding\'s fix is small and certain (a few lines, nothing to decide), add "fix": the replacement for its R lines, from "start_line" (add it when it is more than one line) to "line", whole lines with their indentation, no code fences. They must all be lines of the diff. Otherwise leave "fix" out.',
    since ? `This is a re-review: you reviewed this ${T.PR} before, and its author asked again. The diff below is only what changed since then (from commit ${since.slice(0, 7)}): review those changes, including whether they break anything around them.` : '',
    `${T.PR}: ${pr.title}\n${pr.body ?? ''}`.slice(0, 8000),
    `The diff, each line numbered (R: the new file, L: the old):\n${shown.map((f) => numbered(f)).join('\n\n')}`.slice(0, 200_000),
    texts.join('\n\n'),
  ].filter(Boolean).join('\n\n');
  const answer = await runAgent(prompt, i.agent);
  const json = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
  let parsed: { summary?: string; findings?: Finding[] };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`${AGENTS[i.agent].name}'s answer wasn't the JSON asked for`);
  }
  const findings = (parsed.findings ?? []).filter((f) => f && typeof f.path === 'string' && f.title && f.body).slice(0, 10);
  const drafts: Draft[] = findings.flatMap((f, k) => {
    const file = files.find((x) => x.filename === f.path);
    if (!file) return [];
    // A re-review's removed lines are numbered as the last run's commit had them, not as the PR's diff: on the file.
    const ok = f.line != null && !(since && f.side === 'LEFT') && commentable(file, f.side === 'LEFT' ? 'LEFT' : 'RIGHT', f.line);
    const sev = f.severity ? `${f.severity[0].toUpperCase()}${f.severity.slice(1)}: ` : '';
    const where = !ok && f.line ? ` (line ${f.line})` : '';
    const start = f.start_line && f.start_line < f.line! ? f.start_line : f.line!;
    const fix = ok && f.side !== 'LEFT' && typeof f.fix === 'string' ? suggestedFix(file.patch ?? '', start, f.line!, f.fix) : null;
    const range = fix && start < f.line! ? { startLine: start } : {};
    return [{ id: `agent-${k}`, path: f.path, side: f.side === 'LEFT' ? 'LEFT' : 'RIGHT', ...(ok ? { line: f.line } : {}), ...range, body: `🤖 **${sev}${f.title}**${where}\n\n${f.body}${fix ? `\n\n${fix}` : ''}` }];
  });
  const mode = postMode();
  const summary = `🤖 ${since ? `Re-review of the changes since ${since.slice(0, 7)}` : 'Adversarial review'} by ${AGENTS[i.agent].name} (from lgtm): ${drafts.length ? `${drafts.length} finding${drafts.length > 1 ? 's' : ''}` : 'nothing found'}.${parsed.summary ? `\n\n${parsed.summary}` : ''}`;
  if (drafts.length || mode === 'pending') await postAgentFindings(i.repo, i.number, pr, drafts, summary, mode);
  return { findings: drafts.length, posted: mode };
}

// The diff with every line numbered, as the agent is asked to cite it.
function numbered(f: PRFile) {
  const out = [`=== ${f.filename}${f.previous_filename ? ` (was ${f.previous_filename})` : ''}`];
  for (const h of parsePatch(f.patch ?? '')) {
    out.push(h.header);
    for (const l of h.lines) out.push(l.kind === '+' ? `R${l.new} +${l.text}` : l.kind === '-' ? `L${l.old} -${l.text}` : `R${l.new} ${l.text}`);
  }
  return out.join('\n');
}
// A line a comment can go on: in the diff, on that side.
// A finding's fix as a suggested change: the new-side lines it replaces must all be in the diff (else none); its
// indentation put back where the agent dropped it (GitLab's range: gitlab.ts noteBody).
export function suggestedFix(patch: string, start: number, end: number, fix: string): string | null {
  const text = new Map(parsePatch(patch).flatMap((h) => h.lines.flatMap((l) => (l.kind !== '-' && l.new ? [[l.new, l.text] as const] : []))));
  const old: string[] = [];
  for (let n = start; n <= end; n++) {
    if (!text.has(n)) return null;
    old.push(text.get(n)!);
  }
  const lines = fix.replace(/^\s*```[\w-]*\n?|\n?```\s*$/g, '').replace(/^\n+|\s+$/g, '');
  if (lines === old.join('\n').trimEnd()) return null; // no change
  return `\`\`\`suggestion\n${reindent(lines, old.join('\n'))}\n\`\`\``;
}

function commentable(f: PRFile, side: 'LEFT' | 'RIGHT', line: number) {
  return parsePatch(f.patch ?? '').some((h) => h.lines.some((l) => (side === 'LEFT' ? l.kind === '-' && l.old === line : l.kind !== '-' && l.new === line)));
}
