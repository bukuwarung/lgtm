// lgtm's GitLab code against a real GitLab, with real writes: `npm run test:gitlab`. On demand, never in CI.
//
// It opens a fresh MR in a sandbox project you own (LGTM_GITLAB_SANDBOX, default andikapratama/lgtm-write-test on
// gitlab.com, through glab's sign-in), runs what lgtm does to MRs through its own code (src/github.ts → gitlab.ts),
// checks each result on GitLab itself, then merges the MR and deletes its branch. The project needs an app.ts with
// at least 12 lines on main. gitlab.com's free plan allows about 100 requests a minute: a step GitLab slows down waits
// a minute and runs again.
import { execFileSync } from 'node:child_process';

const SANDBOX = process.env.LGTM_GITLAB_SANDBOX ?? 'andikapratama/lgtm-write-test';
const HOST = process.env.LGTM_GITLAB_HOST ?? 'gitlab.com';
const repo = `${HOST}/${SANDBOX}`, P = encodeURIComponent(SANDBOX);
const glab = (args: string[], input?: unknown) =>
  execFileSync('glab', [...args, '--hostname', HOST, ...(input ? ['--input', '-', '-H', 'Content-Type: application/json'] : [])], { encoding: 'utf8', input: input ? JSON.stringify(input) : undefined, stdio: ['pipe', 'pipe', 'pipe'] });
const api = (path: string, method = 'GET', body?: unknown) => JSON.parse(glab(['api', '-X', method, path], body) || 'null');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The browser lgtm runs in, as far as its GitLab code needs one: storage, an HTML reader, events, and glab's sign-in
// (in the page, the local server's /glab-token and /glab-accounts).
const store = new Map<string, string>([['viewAs', HOST]]);
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } },
  DOMParser: class { parseFromString(h: string) { return { body: { textContent: h.replace(/<[^>]+>/g, '') } }; } },
  dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {}, location: { hash: '' },
});
const real = fetch;
globalThis.fetch = (async (u: any, init?: any) => {
  const url = String(u);
  if (url.startsWith('/glab-token')) {
    if (url.includes('refresh=1')) try { glab(['api', 'user']); } catch {}
    return new Response(execFileSync('glab', ['config', 'get', 'token', '--host', HOST], { encoding: 'utf8' }).trim());
  }
  if (url.startsWith('/glab-accounts')) return Response.json([{ host: HOST, login: execFileSync('glab', ['config', 'get', 'user', '--host', HOST], { encoding: 'utf8' }).trim(), api: `https://${HOST}` }]);
  return real(u, init);
}) as typeof fetch;

const gh = await import('../src/github.ts');
let failed = 0;
async function step<T>(name: string, f: () => Promise<T>, ok: (r: T) => boolean | string = () => true): Promise<T | undefined> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await f();
      const verdict = ok(r);
      if (verdict === true) console.log(`  ✓ ${name}`);
      else (failed++, console.log(`  ✗ ${name}: ${verdict || JSON.stringify(r)?.slice(0, 200)}`));
      return r;
    } catch (e) {
      const msg = (e as Error).message;
      if (/slow down/.test(msg) && !attempt) { console.log(`  … ${name}: GitLab asked to slow down, waiting a minute`); await sleep(61_000); continue; }
      failed++;
      console.log(`  ✗ ${name}: ${msg}`);
      return undefined;
    }
  }
}

console.log(`lgtm against ${repo}`);
const me = await gh.getViewer(repo);
const branch = `live-${Date.now()}`;
const app = String(glab(['api', `projects/${P}/repository/files/app.ts/raw?ref=main`])).split('\n');
const changed = [...app];
changed[2] = `${changed[2]} // changed`; // line 3 changed
changed.splice(5, 1); // old line 6 removed
changed.splice(9, 0, 'export const added1 = 1;', 'export const added2 = 2;'); // new lines 10–11
api(`projects/${P}/repository/commits`, 'POST', { branch, start_branch: 'main', commit_message: 'Live test', actions: [{ action: 'update', file_path: 'app.ts', content: changed.join('\n') }, { action: 'create', file_path: `${branch}.md`, content: '# Live\n\nA file.\n' }] });
const n: number = api(`projects/${P}/merge_requests`, 'POST', { source_branch: branch, target_branch: 'main', title: `Live test ${branch}`, description: 'From npm run test:gitlab', remove_source_branch: true }).iid;
console.log(`!${n} (${branch})`);
await sleep(4000);

const loaded = await step('open the MR: files and diff', () => gh.loadPR(repo, n), (d) => d.files.some((f) => f.filename === 'app.ts' && f.patch) || 'no app.ts diff');
const pr = loaded!.pr;
const mine = (body: string) => api(`projects/${P}/merge_requests/${n}/discussions?per_page=100`).find((d: any) => d.notes[0].body === body)?.notes[0].position;

console.log('Reviewing');
await step('send a review with five kinds of comment', () => gh.submitReview(pr.node_id, pr.head.sha, 'COMMENT', 'Live summary', [
  { id: 'a', path: 'app.ts', side: 'RIGHT', line: 10, body: 'added line' },
  { id: 'b', path: 'app.ts', side: 'LEFT', line: 6, body: 'removed line' },
  { id: 'c', path: 'app.ts', side: 'RIGHT', line: 1, body: 'unchanged line' },
  { id: 'd', path: 'app.ts', side: 'RIGHT', line: 11, startLine: 10, body: 'line range' },
  { id: 'e', path: `${branch}.md`, side: 'RIGHT', body: 'whole file' },
] as any));
await step('added line: on new line 10', async () => mine('added line'), (p) => (p?.new_line === 10 && p.old_line == null) || JSON.stringify(p));
await step('removed line: on old line 6', async () => mine('removed line'), (p) => (p?.old_line === 6 && p.new_line == null) || JSON.stringify(p));
await step('unchanged line: both lines', async () => mine('unchanged line'), (p) => (p?.old_line === 1 && p.new_line === 1) || JSON.stringify(p));
await step('line range: kept as one', async () => mine('line range'), (p) => (p?.new_line === 11 && /_10$/.test(p.line_range?.start?.line_code ?? '')) || JSON.stringify(p));
await step('whole file: a file comment', async () => mine('whole file'), (p) => p?.position_type === 'file' || JSON.stringify(p));
await step('the summary in the conversation', () => gh.getConversation(repo, n), (c) => c.some((x) => x.html.includes('Live summary')) || 'missing');

console.log('Threads');
let threads = (await gh.getThreads(repo, n)) ?? [];
const t = threads.find((x) => x.comments.nodes[0].body === 'added line')!;
await step('read back on their lines', async () => threads, (ts) => ts.length >= 5 || `${ts.length} threads`);
await step('reply', () => gh.reply(repo, n, t.comments.nodes[0].databaseId, 'Live reply'));
await step('resolve', () => gh.resolveThread(t.id, true));
await step('resolved on GitLab', async () => (await gh.getThreads(repo, n)).find((x) => x.id === t.id), (x) => (!!x?.isResolved && x.comments.nodes.length === 2) || 'not resolved');
await step('reopen', () => gh.resolveThread(t.id, false));
await step('comment on the MR', () => gh.commentOnPR(repo, n, 'Live conversation comment'));

console.log('Suggestions and drafts');
const stamp = Date.now(); // a different line each run, so committing it always changes something
await step('suggest a change', () => gh.submitReview(pr.node_id, pr.head.sha, 'COMMENT', '', [{ id: 's', path: 'app.ts', side: 'RIGHT', line: 1, body: `\`\`\`suggestion:-0+0\nexport const v1 = ${stamp};\n\`\`\`` }] as any));
threads = await gh.getThreads(repo, n);
const st = threads.find((x) => x.comments.nodes[0].body?.includes('suggestion'))!;
await step('commit the suggestion', () => gh.commitSuggestions(pr.head.repo!.full_name, pr.head.ref, pr.head.sha, [gh.suggestionOf(st, st.comments.nodes[0])!], me));
await step('the branch has it', async () => glab(['api', `projects/${P}/repository/files/app.ts/raw?ref=${branch}`]).split('\n')[0], (l) => l === `export const v1 = ${stamp};` || l);
await sleep(3000);
const head = await gh.getHead(repo, n);
const refs = api(`projects/${P}/merge_requests/${n}`).diff_refs;
api(`projects/${P}/merge_requests/${n}/draft_notes`, 'POST', { note: 'Draft from GitLab', position: { base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha, position_type: 'text', old_path: 'app.ts', new_path: 'app.ts', new_line: 11 } });
const pend = (await gh.getThreads(repo, n)).flatMap((x) => x.comments.nodes).find((c) => c.state === 'PENDING');
await step('a draft started on GitLab shows as pending', async () => pend, (c) => c?.body === 'Draft from GitLab' || 'not shown');
await step('edit it', () => gh.editReviewComment(pend!.id!, 'Draft edited'));
await step('delete it', () => gh.deleteReviewComment(pend!.id!));
await step('no drafts left', async () => api(`projects/${P}/merge_requests/${n}/draft_notes`), (d) => d.length === 0 || `${d.length} left`);

console.log('Reviewers and verdicts');
await step('ask me to review', () => gh.requestReview(repo, n, me));
await step('approve', () => gh.submitReview(pr.node_id, head, 'APPROVE', '', []));
await step('approved', () => gh.getStatus(repo, n), (s) => s.reviewDecision === 'APPROVED' || s.reviewDecision!);
await step('request changes', () => gh.submitReview(pr.node_id, head, 'REQUEST_CHANGES', 'Live change request', []));
await step('changes requested', () => gh.getStatus(repo, n), (s) => s.reviewDecision === 'CHANGES_REQUESTED' || s.reviewDecision!);
await step('ask again: a fresh review', async () => (await gh.requestReview(repo, n, me), (await gh.getPR(repo, n)).requested_reviewers?.map((u) => u.login)), (l) => !!l?.includes(me) || JSON.stringify(l));
await step('take me off', () => gh.unrequestReview(repo, n, me));

console.log('The MR itself');
api(`projects/${P}/merge_requests/${n}`, 'PUT', { title: `Draft: Live test ${branch}` });
await step('mark ready', () => gh.markReady(pr.node_id));
await step('not a draft', () => gh.getPR(repo, n), (p) => p.draft === false || 'still a draft');
await step('edit title and description', () => gh.updatePR(repo, n, { title: `Live test ${branch} (edited)`, body: 'Edited. LIVE-1' }));
await step('in my list', () => gh.getReviewQueue(), (q) => q.some((i) => i.number === n && i.authored) || 'missing');
await step('checks', () => gh.getChecks(repo, n), (c) => c.length > 0 || 'no pipeline');
const job = (await gh.getChecks(repo, n))[0];
if (job?.jobId) await step('a job log', () => gh.jobLog(repo, job.jobId!), (l) => typeof l === 'string' || 'none');

console.log('Merging');
const s = await step('merge state', () => gh.getMergeState(repo, n), (x) => (x.state === 'OPEN' && x.mergeable !== 'CONFLICTING') || `${x.state} ${x.mergeable} ${x.reasons?.map((r) => r.text)}`);
if (s) await step('squash merge', () => gh.mergePR({ ...s, deleteBranchOnMerge: true }, 'SQUASH', `Live test ${branch}`, '', false));
await sleep(4000);
await step('merged', () => gh.getPR(repo, n), (p) => p.merged === true || 'not merged');
await step('branch deleted', () => gh.getMergeState(repo, n), (x) => !x.headRef || 'branch still there');

console.log(failed ? `${failed} failed` : 'All passed');
process.exit(failed ? 1 : 0);
