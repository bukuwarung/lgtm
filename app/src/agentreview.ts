// Agents review first (Settings → Reviewing): each PR that comes to "Needs your review" goes to Claude Code for an
// adversarial review before you look, and its findings go on the PR under your account, each opening with 🤖 (lgtm
// and readers tell them from yours; with "🤖 comments are a bot's" on, lgtm folds them with bot comments). As a pending
// review you finish yourself, or as comments posted straight away (agentReviewPost).
//
// Claude gets the description, the diff with its line numbers, and the changed files' text: no tools, no checkout
// (askClaudeCli). Its findings are checked against the diff: a line it names that the diff doesn't have goes on the
// file instead. One run per PR and head commit, two at a time; the list shows the PRs being reviewed above "Needs your
// review" (main.tsx), and each run is remembered per account (platform.ts own).
import { postAgentFindings, getRaw, loadPR, type Draft, type PRFile, type QueueItem } from './github.ts';
import { askClaudeCli, own, term } from './platform.ts';
import { parsePatch } from './diff.ts';
import { fillPrompt, prFields, promptTemplate } from './claude.ts';

export type AgentRun = {
  version: string; // the PR's head commit when it ran: a new push runs it again
  state: 'queued' | 'running' | 'done' | 'failed' | 'limited'; // limited: over today's limit, it waits for tomorrow
  at: number;
  day?: string; // the day an automatic run was queued, for the daily limit
  manual?: boolean; // asked for from the PR (Review with Claude Code): not counted against the limit
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
type Target = Pick<QueueItem, 'id' | 'repo' | 'number'> & { headSha?: string };
export const agentRunOf = (i: Pick<QueueItem, 'id'> & { headSha?: string }) => {
  const r = runs[i.id];
  return r && r.version === (i.headSha ?? '') ? r : undefined;
};
// Whether a PR sits in "Agents reviewing" rather than "Needs your review".
export const agentBusy = (i: Pick<QueueItem, 'id'> & { headSha?: string }) => {
  const r = agentRunOf(i);
  return !!r && (r.state === 'queued' || r.state === 'running');
};

// The PRs waiting for my review that haven't had this commit reviewed: queued, two run at a time. A run left
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
const queue: (Target & { manual?: boolean })[] = [];
const inflight = new Set<string>(); // queued or running in this window
export function reviewWithAgents(waiting: QueueItem[]) {
  if (!agentReviewOn()) return;
  const today = new Date().toDateString();
  let used = Object.values(runs).filter((r) => !r.manual && r.state !== 'limited' && r.day === today).length;
  for (const i of waiting) {
    const r = agentRunOf(i);
    if (!i.headSha || inflight.has(i.id) || (r && (r.state === 'done' || r.state === 'failed'))) continue;
    if (agentLimit() && used >= agentLimit()) {
      if (r?.state !== 'limited') set(i.id, { version: i.headSha, state: 'limited', at: Date.now() });
      continue;
    }
    used++;
    inflight.add(i.id);
    set(i.id, { version: i.headSha, state: 'queued', at: Date.now(), day: today });
    queue.push(i);
  }
  pump();
}
// Again, after it failed (the pill's retry): asked for, so not against the limit.
export function retryAgent(i: QueueItem) {
  delete runs[i.id];
  reviewNow(i);
}
// A review asked for from the PR (its ✳ Claude menu): next in line, the automatic setting on or off, your own PRs too.
// What it found is said when it's done, and the PR reloads to show it.
export function reviewNow(i: Target) {
  if (!i.headSha || inflight.has(i.id)) return false;
  inflight.add(i.id);
  set(i.id, { version: i.headSha, state: 'queued', at: Date.now(), manual: true });
  queue.unshift({ ...i, manual: true });
  pump();
  return true;
}
function pump() {
  while (active < 2 && queue.length) {
    const i = queue.shift()!;
    const v = i.headSha ?? '', manual = i.manual;
    const day = runs[i.id]?.day;
    active++;
    set(i.id, { version: v, state: 'running', at: Date.now(), day, manual });
    review(i)
      .then((r) => {
        set(i.id, { version: v, state: 'done', at: Date.now(), day, manual, ...r });
        if (manual) say(`Claude Code reviewed ${i.repo.split('/').pop()}${term(i.repo).PR === 'MR' ? '!' : '#'}${i.number}: ${r.findings ? `${r.findings} finding${r.findings > 1 ? 's' : ''}, ${r.posted === 'pending' ? 'in your pending review' : 'posted as comments'}` : 'nothing to point out'}`);
      })
      .catch((e: Error) => {
        set(i.id, { version: v, state: 'failed', at: Date.now(), day, manual, error: e.message });
        if (manual) say(`Claude Code couldn't review it: ${e.message}`);
      })
      .finally(() => (active--, inflight.delete(i.id), pump()));
  }
}
const say = (text: string) => (dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text } })), dispatchEvent(new Event('lgtm:refresh')));

type Finding = { path: string; line?: number; side?: 'RIGHT' | 'LEFT'; severity?: string; title: string; body: string };
const SKIP = /(^|\/)([\w.-]+\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.(min\.js|map|svg|png|jpe?g|gif|webp|pdf|zip|jar)$/i;

async function review(i: Target): Promise<Pick<AgentRun, 'findings' | 'posted'>> {
  const { pr, files } = await loadPR(i.repo, i.number);
  const shown = files.filter((f) => f.patch && !SKIP.test(f.filename)).slice(0, 60);
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
    fillPrompt(promptTemplate('agent'), prFields(pr, i.repo)), // yours to change (Settings → Claude Code → Prompts)
    'Answer with JSON only, no prose around it: {"summary": "one or two sentences", "findings": [{"path": "file path as in the diff", "line": 12, "side": "RIGHT", "severity": "high|medium|low", "title": "short", "body": "what is wrong and why, and what to do (Markdown)"}]}',
    'Line numbers: use the R numbers in the diff below (the new file); use side "LEFT" with an L number only for a removed line. Leave "line" out for a finding about a whole file.',
    `${T.PR}: ${pr.title}\n${pr.body ?? ''}`.slice(0, 8000),
    `The diff, each line numbered (R: the new file, L: the old):\n${shown.map((f) => numbered(f)).join('\n\n')}`.slice(0, 200_000),
    texts.join('\n\n'),
  ].join('\n\n');
  const answer = await askClaudeCli(prompt);
  const json = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
  let parsed: { summary?: string; findings?: Finding[] };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Claude's answer wasn't the JSON asked for");
  }
  const findings = (parsed.findings ?? []).filter((f) => f && typeof f.path === 'string' && f.title && f.body).slice(0, 10);
  const drafts: Draft[] = findings.flatMap((f, k) => {
    const file = files.find((x) => x.filename === f.path);
    if (!file) return [];
    const ok = f.line != null && commentable(file, f.side === 'LEFT' ? 'LEFT' : 'RIGHT', f.line);
    const sev = f.severity ? `${f.severity[0].toUpperCase()}${f.severity.slice(1)}: ` : '';
    const where = !ok && f.line ? ` (line ${f.line})` : '';
    return [{ id: `agent-${k}`, path: f.path, side: f.side === 'LEFT' ? 'LEFT' : 'RIGHT', ...(ok ? { line: f.line } : {}), body: `🤖 **${sev}${f.title}**${where}\n\n${f.body}` }];
  });
  const mode = postMode();
  const summary = `🤖 Adversarial review by Claude Code (from lgtm): ${drafts.length ? `${drafts.length} finding${drafts.length > 1 ? 's' : ''}` : 'nothing found'}.${parsed.summary ? `\n\n${parsed.summary}` : ''}`;
  if (drafts.length || mode === 'pending') await postAgentFindings(i.repo, i.number, pr, drafts, summary, mode);
  return { findings: drafts.length, posted: mode };
}

// The diff with every line numbered, as Claude is asked to cite it.
function numbered(f: PRFile) {
  const out = [`=== ${f.filename}${f.previous_filename ? ` (was ${f.previous_filename})` : ''}`];
  for (const h of parsePatch(f.patch ?? '')) {
    out.push(h.header);
    for (const l of h.lines) out.push(l.kind === '+' ? `R${l.new} +${l.text}` : l.kind === '-' ? `L${l.old} -${l.text}` : `R${l.new} ${l.text}`);
  }
  return out.join('\n');
}
// A line a comment can go on: in the diff, on that side.
function commentable(f: PRFile, side: 'LEFT' | 'RIGHT', line: number) {
  return parsePatch(f.patch ?? '').some((h) => h.lines.some((l) => (side === 'LEFT' ? l.kind === '-' && l.old === line : l.kind !== '-' && l.new === line)));
}
