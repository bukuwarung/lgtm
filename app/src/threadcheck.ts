// "Did they address my comments?": when a PR I reviewed comes back with new commits, a coding agent (the automatic
// review's, Settings → Reviewing) reads each of my open threads against the code now and the changes since my review,
// and says whether the author dealt with it. On my own PR, the same for the reviewers who asked for changes, before I
// ask them to look again. Kept per PR and head commit (per account), so it runs once a push.
import { getCompare, getRaw, type PRFile, type Thread } from './github.ts';
import { own } from './platform.ts';
import { AGENTS, runAgent, type AgentId } from './agents.ts';

export type Verdict = { addressed: boolean; why: string };
export type ThreadCheck = { sha: string; by: AgentId; state: 'running' | 'done' | 'failed'; verdicts: Record<string, Verdict>; error?: string };

const key = (repo: string, n: number) => own(`threadCheck:${repo}#${n}`);
export function savedCheck(repo: string, n: number, sha: string): ThreadCheck | null {
  try {
    const c = JSON.parse(localStorage.getItem(key(repo, n)) ?? 'null') as ThreadCheck | null;
    return c?.sha === sha && c.state === 'done' ? c : null;
  } catch {
    return null;
  }
}
const keep = (repo: string, n: number, c: ThreadCheck) => {
  try {
    localStorage.setItem(key(repo, n), JSON.stringify(c));
  } catch {}
};

// The prompt for the threads: each one's conversation, the code around its line now, and the file's changes since.
export function threadCheckPrompt(threads: { id: string; path: string; line: number | null; comments: string; code: string | null }[], diffs: Record<string, string>): string {
  return [
    "These comment threads were left on an earlier version of a pull request; its author has pushed commits since. For each thread, decide whether the author addressed it: the code now does what the comment asked, or a reply settles it. Judge from the code and the replies, not from promises.",
    'Answer with JSON only, no prose around it: {"threads": [{"id": "the thread id", "addressed": true, "why": "one short sentence: what changed, or what is still missing"}]}',
    ...threads.map((t) => [`=== Thread ${t.id} on ${t.path}${t.line ? `:${t.line}` : ''}`, t.comments, t.code ? `The code there now:\n${t.code}` : "(its line isn't in the file any more, or the thread is on the whole file)"].join('\n\n')),
    ...Object.entries(diffs).map(([path, patch]) => `--- Changes to ${path} since the review:\n${patch}`),
  ].join('\n\n');
}

export async function checkThreads(p: { repo: string; n: number; headRepo: string; head: string; since: string; threads: Thread[]; agent: AgentId }): Promise<ThreadCheck> {
  const base = { sha: p.head, by: p.agent };
  try {
    const cmp = await getCompare(p.repo, p.since, p.head).catch(() => ({ files: [] as PRFile[] }));
    const paths = [...new Set(p.threads.map((t) => t.path))];
    const texts = new Map(await Promise.all(paths.map(async (f) => [f, await getRaw(p.headRepo, f, p.head).catch(() => null)] as const)));
    const window = (path: string, line: number | null) => {
      const lines = texts.get(path)?.split('\n');
      if (!lines || !line) return null;
      return lines.slice(Math.max(0, line - 13), line + 12).map((l, i) => `${Math.max(1, line - 12) + i}: ${l}`).join('\n');
    };
    const diffs = Object.fromEntries(cmp.files.filter((f) => paths.includes(f.filename) && f.patch).map((f) => [f.filename, f.patch!.slice(0, 40_000)]));
    const prompt = threadCheckPrompt(
      p.threads.map((t) => ({
        id: t.id,
        path: t.path,
        line: t.line,
        comments: t.comments.nodes.map((c) => `${c.author?.login ?? 'ghost'}: ${c.bodyText}`).join('\n\n').slice(0, 8000),
        code: window(t.path, t.line),
      })),
      diffs,
    );
    const answer = await runAgent(prompt.slice(0, 300_000), p.agent);
    let parsed: { threads?: { id?: string; addressed?: boolean; why?: string }[] };
    try {
      parsed = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1));
    } catch {
      throw new Error(`${AGENTS[p.agent].name}'s answer wasn't the JSON asked for`);
    }
    const ids = new Set(p.threads.map((t) => t.id));
    const verdicts = Object.fromEntries((parsed.threads ?? []).filter((v) => v.id && ids.has(v.id) && typeof v.addressed === 'boolean').map((v) => [v.id!, { addressed: v.addressed!, why: String(v.why ?? '').slice(0, 300) }]));
    const c: ThreadCheck = { ...base, state: 'done', verdicts };
    keep(p.repo, p.n, c);
    return c;
  } catch (e: any) {
    return { ...base, state: 'failed', verdicts: {}, error: e.message };
  }
}
