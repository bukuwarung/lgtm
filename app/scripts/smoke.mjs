// A smoke test of the built app (dist/), run before a release: the PR list, a PR, a line comment, Finish review and
// Submit, in headless Chrome, with every GitHub request answered here from made-up data (nothing reaches GitHub; writes
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
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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

const sent = []; // the mutations, by name
function graphql(body) {
  const { query = '', variables = {} } = JSON.parse(body || '{}');
  const m = query.match(/mutation[^{]*\{\s*(\w+)/);
  if (m) {
    sent.push(m[1]);
    return { data: { addPullRequestReview: { pullRequestReview: { id: 'R1' } }, addPullRequestReviewThread: { thread: { id: 'T1' } }, submitPullRequestReview: { clientMutationId: null } } };
  }
  if (query.includes('review-requested:@me')) return { data: { viewer: { login: 'tester' }, requested: { nodes: [node] }, reviewed: { nodes: [] }, authored: { nodes: [] }, assigned: { nodes: [] }, mentioned: { nodes: [] } } };
  if (/p0:node/.test(query)) return { data: Object.fromEntries(Object.keys(variables).map((k) => [k.replace('i', 'p'), { reviewThreads: { nodes: [] } }])) };
  if (query.includes('nodes(ids:')) return { data: { nodes: [] } };
  const pullRequest = { reviewThreads: empty, reviews: { nodes: [] }, files: empty, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, timelineItems: empty };
  if (query.includes('pullRequest(number')) return { data: { repository: { pullRequest } } };
  return { data: null, errors: [{ message: 'smoke: no fixture' }] };
}
function rest(path) {
  if (path === '/user') return [200, { login: 'tester' }];
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
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
      localStorage.setItem('seenVersion', '999.0.0'); localStorage.setItem('setupSeen', '1');`, // no first-run dialogs
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
