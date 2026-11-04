// A smoke test of the built app (dist/), run before a release and in CI: the PR list, a PR, a line comment, Finish
// review and Submit; the inbox (its keys, Done, a reply) and the bell (a closed PR's entry dropped, a new review request
// listed and dismissed); in headless Chrome, with every GitHub request answered here from made-up data (nothing reaches GitHub; writes
// are only recorded). It fails on an uncaught error, on confirm()/alert()/prompt() (the Mac app's web view answers
// them without asking: submit once stopped silently that way), and when the review's mutations don't go out.
// Needs Google Chrome; like scripts/demos.mjs it talks to it over the DevTools protocol, nothing to install.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.SMOKE_PORT ?? 4599);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- The made-up PR: acme/shop#1 by rina, asking me (tester) for a review; one Kotlin file. ---
const now = new Date().toISOString();
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40);
const PATCH = '@@ -10,3 +10,5 @@\n fun charge(o: Order) {\n-    api.charge(o)\n+    retry(times = 3) {\n+        api.charge(o)\n+    }\n }';
const node = {
  id: 'PR_1', number: 1, title: 'Retry failed payments', updatedAt: now, isDraft: false, reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'CLEAN',
  autoMergeRequest: null, viewerCanEnableAutoMerge: false, mergeQueueEntry: null, author: { __typename: 'User', login: 'rina' }, assignees: { nodes: [] },
  additions: 3, deletions: 1, changedFiles: 1, commits: { nodes: [{ commit: { committedDate: now, statusCheckRollup: { state: 'SUCCESS' } } }] },
  recent: { nodes: [{ commit: { authoredDate: now, parents: { totalCount: 1 } } }] }, repository: { nameWithOwner: 'acme/shop' }, headRefName: 'retry',
  baseRefName: 'main', headRepository: { nameWithOwner: 'acme/shop' }, createdAt: now, reviewRequests: { nodes: [{ requestedReviewer: { login: 'tester' } }] },
  timelineItems: { nodes: [{ createdAt: now }] }, latestReviews: { nodes: [] }, latestOpinionatedReviews: { nodes: [] },
};
const pr = {
  number: 1, node_id: 'PR_1', title: node.title, body: 'Retries a failed charge.', body_html: '<p>Retries a failed charge.</p>', html_url: 'https://github.com/acme/shop/pull/1',
  state: 'open', draft: false, merged: false, user: { login: 'rina', type: 'User' }, assignees: [], requested_reviewers: [{ login: 'tester' }], requested_teams: [],
  head: { sha: HEAD, ref: 'retry', repo: { full_name: 'acme/shop', owner: { login: 'acme' } } }, base: { ref: 'main', sha: BASE, repo: { full_name: 'acme/shop' } },
  additions: 3, deletions: 1, changed_files: 1, created_at: now, updated_at: now,
};
const files = [{ filename: 'src/Pay.kt', status: 'modified', additions: 3, deletions: 1, changes: 4, sha: 'f1', blob_url: 'https://github.com/acme/shop/blob/x/src/Pay.kt', patch: PATCH }];
const empty = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] };
// acme/shop#2, mine, with two threads waiting on my reply; #4, a review request that arrives at the second refresh.
const mineNode = { ...node, id: 'PR_2', number: 2, title: 'Faster checkout', author: { __typename: 'User', login: 'tester' }, reviewRequests: { nodes: [] } };
const laterNode = { ...node, id: 'PR_4', number: 4, title: 'Log declined cards' };
let later = false;
const comment = (databaseId, login, body) => ({ id: `C${databaseId}`, databaseId, url: '', body, bodyHTML: `<p>${body}</p>`, bodyText: body, createdAt: now, state: 'SUBMITTED', author: { __typename: 'User', login, avatarUrl: '', databaseId: 7 }, originalCommit: { oid: HEAD } });
const threads2 = [
  { id: 'T21', path: 'src/Cart.kt', line: 5, startLine: null, originalLine: 5, originalStartLine: null, diffSide: 'RIGHT', subjectType: 'LINE', isResolved: false, isOutdated: false, viewerCanResolve: true, viewerCanUnresolve: false, comments: { nodes: [comment(21, 'rina', 'Why not cache the cart?')] } },
  { id: 'T31', path: 'src/Cart.kt', line: 9, startLine: null, originalLine: 9, originalStartLine: null, diffSide: 'RIGHT', subjectType: 'LINE', isResolved: false, isOutdated: false, viewerCanResolve: true, viewerCanUnresolve: false, comments: { nodes: [comment(31, 'eko', 'Nit: rename to total')] } },
];

const sent = []; // the mutations, by name
function graphql(body) {
  const { query = '', variables = {} } = JSON.parse(body || '{}');
  const m = query.match(/mutation[^{]*\{\s*(\w+)/);
  if (m) {
    sent.push(m[1]);
    return { data: { addPullRequestReview: { pullRequestReview: { id: 'R1' } }, addPullRequestReviewThread: { thread: { id: 'T1' } }, submitPullRequestReview: { clientMutationId: null } } };
  }
  if (query.includes('review-requested:@me')) return { data: { viewer: { login: 'tester' }, requested: { nodes: later ? [node, laterNode] : [node] }, reviewed: { nodes: [] }, authored: { nodes: [mineNode] }, assigned: { nodes: [] }, mentioned: { nodes: [] } } };
  if (/p0:node/.test(query)) return { data: Object.fromEntries(Object.entries(variables).map(([k, id]) => [k.replace('i', 'p'), { reviewThreads: { nodes: id === 'PR_2' ? threads2.map((t) => ({ ...t, starter: { nodes: t.comments.nodes } })) : [] } }])) };
  // The bell's PRs that left the list (closedPRs): #3 closed, any other open.
  if (/p0:repository/.test(query)) return { data: Object.fromEntries(Object.keys(variables).filter((k) => k[0] === 'n').map((k) => ['p' + k.slice(1), { pullRequest: { state: variables[k] === 3 ? 'CLOSED' : 'OPEN' } }])) };
  if (query.includes('is:merged')) return { data: { a: { nodes: [] }, r: { nodes: [] } } };
  if (query.includes('reviewThreads(first:100') && variables.n === 2) return { data: { repository: { pullRequest: { reviewThreads: { ...empty, nodes: threads2 } } } } };
  if (query.includes('nodes(ids:')) return { data: { nodes: [] } };
  const pullRequest = { reviewThreads: empty, reviews: { nodes: [] }, files: empty, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, timelineItems: empty };
  if (query.includes('pullRequest(number')) return { data: { repository: { pullRequest } } };
  return { data: null, errors: [{ message: 'smoke: no fixture' }] };
}
function rest(path) {
  if (path === '/user') return [200, { login: 'tester' }];
  if (path === '/repos/acme/shop/pulls/2/comments/21/replies') return sent.push('reply'), [201, { id: 99 }];
  if (path === '/repos/acme/shop/pulls/1') return [200, pr];
  if (path.startsWith('/repos/acme/shop/pulls/1/files')) return [200, files];
  if (/\/(issues\/1\/comments|pulls\/1\/reviews|pulls\/1\/comments|pulls\/1\/commits)/.test(path)) return [200, []];
  if (path === '/rate_limit') return [200, { resources: { core: { limit: 5000, remaining: 5000, used: 0, reset: 9e9 }, graphql: { limit: 5000, remaining: 5000, used: 0, reset: 9e9 } } }];
  if (path === '/emojis') return [200, {}];
  return [404, { message: 'Not Found' }];
}
// lgtm's own server: the token and the integrations, made up; its other endpoints, empty.
function local(path) {
  if (path === '/token') return [200, 'smoke-token'];
  if (path === '/integrations') return [200, { slack: { ok: false, error: 'smoke' }, jira: { ok: false, error: 'smoke' } }];
  if (path === '/gh-accounts') return [200, []];
  return [200, {}];
}

// --- Chrome ---
const server = spawn(process.execPath, ['bin/lgtm.mjs'], { cwd: APP, env: { ...process.env, LGTM_PORT: String(PORT), LGTM_NO_OPEN: '1' }, stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'lgtm-smoke-'));
// CI runners (GitHub's Linux machines) run Chrome without its sandbox.
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`, '--window-size=1400,900', ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
const problems = [];
const asked = []; // the requests answered here, for a failure's report
let failed = false;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch('http://127.0.0.1:9334/json/list').then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
  }
  if (!target) throw new Error("Chrome didn't start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
  ws.addEventListener('message', async (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) return pending.get(m.id)(m.result), pending.delete(m.id);
    if (m.method === 'Runtime.exceptionThrown') problems.push(`Uncaught: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      const u = new URL(request.url);
      let answer = null;
      // CORS preflight for GitHub's API: allowed, with the headers the page sends.
      if (request.method === 'OPTIONS' && u.hostname === 'api.github.com')
        return send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE' }, { name: 'Access-Control-Allow-Headers', value: 'Authorization, Content-Type, Accept, X-GitHub-Api-Version, If-None-Match' }] });
      if (u.hostname === 'api.github.com') answer = u.pathname === '/graphql' ? [200, graphql(request.postData)] : rest(u.pathname);
      else if (u.hostname.endsWith('github.com') || u.hostname.endsWith('githubusercontent.com')) answer = [404, ''];
      else if (u.origin === ORIGIN && !/\.\w+$/.test(u.pathname) && u.pathname !== '/') answer = local(u.pathname);
      if (!answer) return send('Fetch.continueRequest', { requestId });
      asked.push(`${answer[0]} ${request.method} ${u.pathname}${u.pathname === '/graphql' ? ' ' + (JSON.parse(request.postData || '{}').query ?? '').replace(/\s+/g, ' ').slice(0, 60) : ''}`);
      const [status, body] = answer;
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: typeof body === 'string' ? 'text/plain' : 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(text).toString('base64') });
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // The Mac app's web view answers these without asking: none may be used.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `for (const f of ['confirm', 'alert', 'prompt']) window[f] = () => { throw new Error(f + '() used: the Mac app answers it without asking') };
      localStorage.setItem('seenVersion', '999.0.0'); localStorage.setItem('setupSeen', '1'); // no first-run dialogs
      // On the bell from before: acme/shop#3, closed since (closedPRs drops it).
      if (!sessionStorage.getItem('seeded')) sessionStorage.setItem('seeded', '1'), localStorage.setItem('lastLogin', 'tester'), localStorage.setItem('@tester/notices', JSON.stringify([{ id: 'n3', what: 'Approved', title: 'Old change', pr: 'acme/shop#3', at: Date.now() - 86400000 }]));`,
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (what, expression, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await evaluate(expression)) return;
    throw new Error(`Timed out: ${what}`);
  };
  const step = async (what, run) => {
    try {
      await run();
      console.log(`  ✓ ${what}`);
    } catch (e) {
      failed = true;
      console.log(`  ✗ ${what}: ${e.message}`);
      console.log(`    The page: ${(await evaluate('document.body.innerText').catch(() => '')).replace(/\s+/g, ' ').slice(0, 400)}`);
      console.log(`    Its last requests:\n${asked.slice(-12).map((a) => '      ' + a).join('\n')}`);
      throw e;
    }
  };

  for (let i = 0; i < 50 && !(await fetch(ORIGIN + '/lgtm').then((r) => r.ok).catch(() => false)); i++) await sleep(200);
  console.log(`Smoke test of the built app (${ORIGIN}), GitHub made up:`);
  await send('Page.navigate', { url: ORIGIN + '/#/' });
  await step('the PR list shows the PR', () => until('the list', `[...document.querySelectorAll('.pr-item')].some((a) => a.textContent.includes('Retry failed payments'))`));
  await step("the bell drops a closed PR's entry", () => until('the entry gone', `localStorage.getItem('@tester/notices') === '[]'`));
  await step('a PR opens with its diff', async () => {
    await evaluate(`location.hash = '/acme/shop/pull/1'`);
    await until('the diff', `!!document.querySelector('[id="f-src/Pay.kt"] tr.ln.a')`);
  });
  await step('a line comment goes into the review', async () => {
    await evaluate(`document.querySelector('[id="f-src/Pay.kt"] tr.ln.a td.num:nth-child(2)').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await until('the comment box', `!!document.querySelector('[id="f-src/Pay.kt"] textarea')`);
    await evaluate(`(() => {
      const t = document.querySelector('[id="f-src/Pay.kt"] textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Only network errors should be retried?');
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300); // the button comes alive once the text is in
    await evaluate(`[...document.querySelectorAll('[id="f-src/Pay.kt"] button')].find((b) => b.textContent.trim() === 'Add to review').click()`);
    await until('the draft', `[...document.querySelectorAll('button')].some((b) => /^Finish review \\(1\\)/.test(b.textContent.trim()))`);
  });
  await step('Finish review sends it', async () => {
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Finish review')).click()`);
    await until('the submit panel', `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Submit review')`);
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit review').click()`);
    for (let i = 0; i < 50 && !sent.includes('submitPullRequestReview'); i++) await sleep(200);
    for (const m of ['addPullRequestReview', 'addPullRequestReviewThread', 'submitPullRequestReview']) if (!sent.includes(m)) throw new Error(`${m} wasn't sent (sent: ${sent.join(', ') || 'nothing'})`);
    const bar = await evaluate(`document.querySelector('.fail-bar')?.innerText ?? ''`);
    if (bar) throw new Error(`error bar: ${bar}`);
  });
  const key = (k, opts = {}) => evaluate(`(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, ...${JSON.stringify(opts)} }))`);
  await step('the inbox lists the threads waiting on me, and j moves', async () => {
    await evaluate(`location.hash = '/inbox'`);
    await until('two threads', `document.querySelectorAll('.inbox-thread').length === 2`);
    await key('j');
    await until('the second current', `document.querySelectorAll('.inbox-thread')[1].classList.contains('cur')`, 2000);
  });
  await step('e marks a thread done', async () => {
    await key('e');
    await until('one thread left', `document.querySelectorAll('.inbox-thread').length === 1`, 3000);
    if (!(await evaluate(`localStorage.getItem('@tester/repliesDone') ?? ''`)).includes('T31')) throw new Error("Done wasn't kept");
  });
  await step('r and ⌘↵ reply', async () => {
    await key('r');
    await until('the reply box focused', `document.activeElement?.matches('.inbox-thread.cur textarea')`, 2000);
    await evaluate(`(() => {
      const t = document.activeElement;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Cached in the next commit.');
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(100);
    await key('Enter', { metaKey: true });
    await until('the reply sent', `document.querySelector('.inbox .note')?.textContent.includes('Nothing waits on your reply')`, 5000);
    if (!sent.includes('reply')) throw new Error("the reply didn't go out");
  });
  await step('the bell lists a new review request, and dismisses it', async () => {
    later = true;
    await evaluate(`dispatchEvent(new Event('lgtm:list-refresh'))`);
    await until('its count', `document.querySelector('.bell .nav-count')?.textContent === '1'`);
    await evaluate(`document.querySelector('.bell > button').click()`);
    await until('the entry', `[...document.querySelectorAll('.bell-row')].some((r) => r.textContent.includes('Review requested') && r.textContent.includes('Log declined cards'))`, 2000);
    await evaluate(`document.querySelector('.bell-row .bell-x').click()`);
    await until('the count gone', `!document.querySelector('.bell .nav-count')`, 2000);
  });
} catch (e) {
  failed = true;
  if (!/^Timed out|wasn't sent|error bar/.test(e.message)) console.log(`  ✗ ${e.message}`);
} finally {
  chrome.kill();
  server.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
for (const p of problems) console.log(`  ✗ ${p}`);
if (failed || problems.length) {
  console.log('Smoke test failed.');
  process.exit(1);
}
console.log('Smoke test passed.');
