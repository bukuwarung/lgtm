// A smoke test of the built app (dist/), run before a release and in CI: the PR list, a PR, a line comment, Finish
// review and Submit; the inbox (a thread's code, its keys, Done, a reply, a mention) and the bell (a closed PR's entry dropped, a new review request
// listed and dismissed); then layout the way the Mac app draws it (icon buttons centred, checkboxes lgtm's own, previews'
// pills in place). In WebKit, the Mac app's engine (Playwright's build: npx playwright-core install webkit), with every
// GitHub request answered here from made-up data (nothing reaches GitHub; writes are only recorded). It fails on an
// uncaught error, on confirm()/alert()/prompt() (the Mac app's web view answers them without asking: submit once
// stopped silently that way), and when the review's mutations don't go out.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT ?? 4599);
const ORIGIN = `http://127.0.0.1:${PORT}`;
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
  additions: 4, deletions: 1, changed_files: 2, created_at: now, updated_at: now,
};
// A doc GitHub lists after the code (by path): the reading order puts it first.
const files = [
  { filename: 'src/Pay.kt', status: 'modified', additions: 3, deletions: 1, changes: 4, sha: 'f1', blob_url: 'https://github.com/acme/shop/blob/x/src/Pay.kt', patch: PATCH },
  { filename: 'web/docs/retry.md', status: 'added', additions: 1, deletions: 0, changes: 1, sha: 'f2', blob_url: 'https://github.com/acme/shop/blob/x/web/docs/retry.md', patch: '@@ -0,0 +1 @@\n+Retries a failed charge three times.' },
];
const empty = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] };
// acme/shop#2, mine, with two threads waiting on my reply; #4, a review request that arrives at the second refresh.
const mineNode = { ...node, id: 'PR_2', number: 2, title: 'Faster checkout', author: { __typename: 'User', login: 'tester' }, reviewRequests: { nodes: [{ requestedReviewer: { login: 'bayu' } }] } }; // bayu: busy on GitHub
const laterNode = { ...node, id: 'PR_4', number: 4, title: 'Log declined cards' };
let later = false;
const comment = (databaseId, login, body) => ({ id: `C${databaseId}`, databaseId, url: '', body, bodyHTML: `<p>${body}</p>`, bodyText: body, createdAt: now, state: 'SUBMITTED', author: { __typename: 'User', login, avatarUrl: '', databaseId: 7 }, originalCommit: { oid: HEAD } });
const mention = { ...comment(41, 'wawan', 'Can you check the tax?'), bodyHTML: '<p><a class="user-mention notranslate" data-hovercard-type="user" href="https://github.com/tester">@tester</a> can you check the tax?</p>' };
// Automation's, from a person's account (its hidden marker): not a mention for the inbox.
const automated = { ...mention, ...comment(42, 'wawan', '<!-- review-check -->\n@tester commits came after your approval'), bodyHTML: '<p><a class="user-mention notranslate" data-hovercard-type="user" href="https://github.com/tester">@tester</a> commits came after your approval</p>' };
const threads2 = [
  { id: 'T21', path: 'src/Cart.kt', line: 5, startLine: null, originalLine: 5, originalStartLine: null, diffSide: 'RIGHT', subjectType: 'LINE', isResolved: false, isOutdated: false, viewerCanResolve: true, viewerCanUnresolve: false, comments: { nodes: [comment(21, 'rina', 'Why not cache the cart?')] }, hunk: { nodes: [{ diffHunk: '@@ -1,3 +1,5 @@\n fun total(c: Cart) =\n-    c.items.sum()\n+    cache.getOrPut(c.id) {\n+        c.items.sum()\n+    }' }] } },
  { id: 'T31', path: 'src/Cart.kt', line: 9, startLine: null, originalLine: 9, originalStartLine: null, diffSide: 'RIGHT', subjectType: 'LINE', isResolved: false, isOutdated: false, viewerCanResolve: true, viewerCanUnresolve: false, comments: { nodes: [comment(31, 'eko', 'Nit: rename to total')] } },
];

const sent = []; // the mutations, by name
let pendingCount = -1; // my pending review's comments (-1: none): a line comment goes into it as it's written
function graphql(body) {
  const { query = '', variables = {} } = JSON.parse(body || '{}');
  const m = query.match(/mutation[^{]*\{\s*(\w+)/);
  if (m) {
    sent.push(m[1]);
    if (m[1] === 'addPullRequestReview') pendingCount = 0;
    if (m[1] === 'addPullRequestReviewThread' && pendingCount >= 0) pendingCount++;
    if (m[1] === 'submitPullRequestReview') pendingCount = -1;
    return { data: { addPullRequestReview: { pullRequestReview: { id: 'R1' } }, addPullRequestReviewThread: { thread: { id: 'T1' } }, submitPullRequestReview: { clientMutationId: null } } };
  }
  if (query.includes('review-requested:@me')) return { data: { viewer: { login: 'tester' }, requested: { nodes: later ? [node, laterNode] : [node] }, reviewed: { nodes: [] }, authored: { nodes: [mineNode] }, assigned: { nodes: [] }, mentioned: { nodes: [] } } };
  if (/p0:node/.test(query)) return { data: Object.fromEntries(Object.entries(variables).map(([k, id]) => [k.replace('i', 'p'), { reviewThreads: { nodes: id === 'PR_2' ? threads2.map((t) => ({ ...t, starter: { nodes: t.comments.nodes } })) : [] } }])) };
  const prOf = (n) => ({ reviewThreads: n === 2 ? { ...empty, nodes: threads2 } : empty, reviews: { nodes: [] }, pending: { nodes: pendingCount >= 0 ? [{ id: 'R1', comments: { totalCount: pendingCount } }] : [] }, files: empty, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, timelineItems: empty });
  // PRs asked together (a PR's parts, the inbox's threads; the bell's PRs that left the list: #3 closed, any other open).
  if (/p0:repository/.test(query)) return { data: Object.fromEntries(Object.keys(variables).filter((k) => k[0] === 'n').map((k) => ['p' + k.slice(1), { pullRequest: { ...prOf(variables[k]), state: variables[k] === 3 ? 'CLOSED' : 'OPEN' } }])) };
  if (query.includes('is:merged')) return { data: { a: { nodes: [] }, r: { nodes: [] } } };
  if (query.includes('nodes(ids:') && query.includes('comments(last:30)')) return { data: { nodes: [{ id: 'PR_2', comments: { nodes: [mention, automated] }, reviews: { nodes: [] } }] } };
  if (query.includes('nodes(ids:') && query.includes('fragment F')) return { data: { nodes: variables.ids.map((id) => [node, laterNode, mineNode].find((n) => n.id === id) ?? null) } };
  // Who reviews here, how many reviews each is asked for, and who's busy on GitHub (bayu, dewi).
  if (query.includes('pullRequests(last:40')) return { data: { repository: { pullRequests: { nodes: [{ reviews: { nodes: ['bayu', 'dewi', 'eko'].map((login) => ({ author: { __typename: 'User', login } })) } }] } } } };
  if (/u0:user\(login/.test(query))
    return { data: Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, k[0] === 'r' ? { issueCount: 0 } : { status: ['bayu', 'dewi'].includes(v) ? { indicatesLimitedAvailability: true, message: 'On leave' } : null }])) };
  if (query.includes('nodes(ids:')) return { data: { nodes: [] } };
  // bayu was asked as a code owner of src/ (CODEOWNERS: dewi, busy, and fajar).
  if (query.includes('asCodeOwner')) return { data: { repository: { pullRequest: { reviewRequests: { nodes: [{ asCodeOwner: true, requestedReviewer: { login: 'bayu' } }] }, files: { nodes: [{ path: 'src/Cart.kt' }] } } } } };
  // What I may do on the PR (write access: labels, assignees, milestone), and its labels, assignees and milestone (none).
  if (query.includes('viewerPermission')) return { data: { repository: { viewerPermission: 'WRITE', pullRequest: { viewerCanClose: true, viewerCanReopen: false, viewerCanUpdate: true, viewerCanUpdateBranch: false, isCrossRepository: false, headRefName: 'retry', headRefOid: HEAD, headRef: { id: 'REF_1' } } } } };
  if (query.includes('viewerSubscription')) return { data: { repository: { pullRequest: { locked: false, viewerCanSubscribe: true, viewerSubscription: 'SUBSCRIBED', labels: { nodes: [] }, assignees: { nodes: [] }, milestone: null } } } };
  if (query.includes('pullRequest(number')) return { data: { repository: { pullRequest: prOf(variables.n) } } };
  return { data: null, errors: [{ message: 'smoke: no fixture' }] };
}
function rest(path, request) {
  if (path === '/repos/acme/shop/pulls/2/requested_reviewers') return sent.push(`${request.method()} ${JSON.parse(request.postData()).reviewers}`), [200, {}];
  if (path === '/user') return [200, { login: 'tester' }];
  if (path === '/repos/acme/shop/contents/.github/CODEOWNERS') return [200, '*  @rina\nsrc/  @bayu @dewi @fajar\n'];
  if (path === '/repos/acme/shop/pulls/2/comments/21/replies') return sent.push('reply'), [201, { id: 99 }];
  if (path === '/repos/acme/shop/pulls/1') return [200, pr];
  if (path.startsWith('/repos/acme/shop/pulls/1/files')) return [200, files];
  if (/\/(issues\/1\/comments|pulls\/1\/reviews|pulls\/1\/comments|pulls\/1\/commits)/.test(path)) return [200, []];
  if (path === '/rate_limit') return [200, { resources: { core: { limit: 5000, remaining: 5000, used: 0, reset: 9e9 }, graphql: { limit: 5000, remaining: 5000, used: 0, reset: 9e9 } } }];
  if (path === '/emojis') return [200, {}];
  // The index's pickers: long names, to show they wrap inside it rather than push it sideways.
  if (path.startsWith('/repos/acme/shop/labels')) return [200, [{ name: 'bug', color: 'd73a4a', description: 'Something is broken' }, { name: 'needs-product-decision-before-merging', color: 'fbca04', description: 'A long label, as some repos have them, that should wrap rather than widen the index' }]];
  if (path.startsWith('/repos/acme/shop/assignees')) return [200, [{ login: 'rina' }, { login: 'bayu' }, { login: 'a-very-long-github-login-for-wrapping' }]];
  if (path.startsWith('/repos/acme/shop/milestones')) return [200, [{ number: 1, title: 'Q4 checkout reliability and payment retries, phase two', due_on: null }]];
  return [404, { message: 'Not Found' }];
}
// lgtm's own server: the token and the integrations, made up; its other endpoints, empty.
function local(path) {
  if (path === '/token') return [200, 'smoke-token'];
  if (path === '/integrations') return [200, { slack: { ok: false, error: 'smoke' }, jira: { ok: false, error: 'smoke' } }];
  if (path === '/gh-accounts') return [200, []];
  return [200, {}];
}

// --- WebKit ---
const server = spawn(process.execPath, ['bin/lgtm.mjs'], { cwd: APP, env: { ...process.env, LGTM_PORT: String(PORT), LGTM_NO_OPEN: '1' }, stdio: 'ignore' });
const problems = [];
const asked = []; // the requests answered here, for a failure's report
let failed = false;
const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => problems.push(`Uncaught: ${e.message}`));
  await page.route('**/*', (route) => {
    const request = route.request();
    const u = new URL(request.url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version, If-None-Match' };
    if (request.method() === 'OPTIONS' && u.hostname === 'api.github.com') return route.fulfill({ status: 204, headers: cors });
    let answer = null;
    if (u.hostname === 'api.github.com') answer = u.pathname === '/graphql' ? [200, graphql(request.postData())] : rest(u.pathname, request);
    else if (u.hostname.endsWith('github.com') || u.hostname.endsWith('githubusercontent.com')) answer = [404, ''];
    else if (u.origin === ORIGIN && !/\.\w+$/.test(u.pathname) && u.pathname !== '/') answer = local(u.pathname);
    else if (u.origin !== ORIGIN) answer = [404, '']; // fonts and pictures from elsewhere: nothing leaves this machine
    if (!answer) return route.continue();
    asked.push(`${answer[0]} ${request.method()} ${u.pathname}${u.pathname === '/graphql' ? ' ' + (JSON.parse(request.postData() || '{}').query ?? '').replace(/\s+/g, ' ').slice(0, 60) : ''}`);
    const [status, body] = answer;
    return route.fulfill({ status, headers: { ...cors, 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  });
  // The Mac app's web view answers these without asking: none may be used.
  await page.addInitScript(`for (const f of ['confirm', 'alert', 'prompt']) window[f] = () => { throw new Error(f + '() used: the Mac app answers it without asking') };
      localStorage.setItem('seenVersion', '999.0.0'); localStorage.setItem('setupSeen', '1'); // no first-run dialogs
      // On the bell from before: acme/shop#3, closed since (closedPRs drops it).
      if (!sessionStorage.getItem('seeded')) sessionStorage.setItem('seeded', '1'), localStorage.setItem('lastLogin', 'tester'), localStorage.setItem('@tester/notices', JSON.stringify([{ id: 'n3', what: 'Approved', title: 'Old change', pr: 'acme/shop#3', at: Date.now() - 86400000 }]));`);
  const evaluate = (expression) => page.evaluate(expression);
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
  await page.goto(ORIGIN + '/#/');
  await step('the PR list shows the PR', () => until('the list', `[...document.querySelectorAll('.pr-item')].some((a) => a.textContent.includes('Retry failed payments'))`));
  await step("the bell drops a closed PR's entry", () => until('the entry gone', `localStorage.getItem('@tester/notices') === '[]'`));
  await step('a PR opens with its diff, docs first', async () => {
    await evaluate(`localStorage.setItem('hideIndexToReview', '1'); location.hash = '/acme/shop/pull/1'`);
    await until('the diff', `!!document.querySelector('[id="f-src/Pay.kt"] tr.ln.a')`);
    const first = await evaluate(`document.querySelector('[id^="f-"]')?.id`);
    if (first !== 'f-web/docs/retry.md') throw new Error(`files not in reading order: ${first} first`);
  });
  await step('waiting for my review, it opens without the index (the switch on); i shows it', async () => {
    await until('no index', `document.querySelector('.review:not(.skel)')?.classList.contains('no-index')`, 3000);
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }))`);
    await until('the index', `!document.querySelector('.review:not(.skel)').classList.contains('no-index')`, 2000);
    await evaluate(`localStorage.removeItem('hideIndexToReview')`);
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
    await until('its lines kept out of sight noted, for the start page', `'acme/shop#1' in JSON.parse(localStorage.getItem('@tester/readSaved') ?? '{}')`);
  });
  const key = (k, opts = {}) => evaluate(`(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, ...${JSON.stringify(opts)} }))`);
  await step('the inbox lists a mention and the threads waiting on me, with their code, and j moves', async () => {
    await evaluate(`location.hash = '/inbox'`);
    await until('the inbox button counting both threads and the mention', `document.querySelector('.nav-inbox .nav-count')?.textContent === '3'`);
    await until('a mention and two threads', `document.querySelectorAll('.inbox-thread').length === 3 && document.querySelector('.inbox .note').textContent.startsWith('2 threads and 1 mention')`);
    if (!(await evaluate(`!!document.querySelector('.snippet tr.a')`))) throw new Error("the thread's code isn't shown");
    if (await evaluate(`document.querySelector('.inbox').innerText.includes('commits came after')`)) throw new Error("automation's comment (its marker) is listed as a mention");
    await key('j');
    await key('j');
    await until('the third current', `document.querySelectorAll('.inbox-thread')[2].classList.contains('cur')`, 2000);
  });
  await step('e marks a thread done', async () => {
    await key('e');
    await until('one thread left', `document.querySelectorAll('.inbox-thread').length === 2`, 3000);
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
    await until('the reply sent', `document.querySelector('.inbox .note')?.textContent.startsWith('1 mention')`, 5000);
    for (let i = 0; i < 25 && !sent.includes('reply'); i++) await sleep(200); // it leaves the list at once, then goes
    if (!sent.includes('reply')) throw new Error("the reply didn't go out");
  });
  await step('e marks the mention done', async () => {
    await key('e');
    await until('nothing left', `document.querySelector('.inbox .note')?.textContent.includes('Nothing waits on your reply')`, 3000);
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
  await step("my PR's away code owner, swapped from its pill for the first free owner", async () => {
    await evaluate(`location.hash = '#/'`);
    await until('the Your tab', `((b) => !!b && (b.click(), true))([...document.querySelectorAll('[role=tab]')].find((b) => /^Your/.test(b.textContent.trim())))`, 5000);
    await until('the away pill', `[...document.querySelectorAll('.pill-drop button')].some((b) => b.textContent.includes('@bayu away'))`);
    await evaluate(`[...document.querySelectorAll('.pill-drop button')].find((b) => b.textContent.includes('@bayu away')).click()`);
    await until('its menu', `!!document.querySelector('.quick-menu')`, 2000);
    await evaluate(`document.querySelector('.quick-menu').click()`);
    for (const end = Date.now() + 5000; !(sent.includes('POST fajar') && sent.includes('DELETE bayu')); await sleep(200)) if (Date.now() > end) throw new Error(`Timed out: fajar asked, bayu taken off (sent: ${sent.join(', ')})`);
    await until('the pill says so', `[...document.querySelectorAll('.pill-drop .p-ok')].some((b) => b.textContent.includes('asked someone else') && b.title === 'Asked @fajar instead of @bayu.')`, 2000);
  });
  // What only WebKit shows: an icon on the text baseline sits low there; macOS's own checkboxes are tiny and grey out
  // with the window; a preview's pills pinned like the PR page's bar slid over its code.
  await step('layout in WebKit: icon buttons centred, checkboxes lgtm\'s own and on their words, nothing sideways, previews\' pills in place', async () => {
    await evaluate(`location.hash = '/acme/shop/pull/1'`);
    await until('the diff', `!!document.querySelector('[id="f-src/Pay.kt"] tr.ln.a')`);
    const icons = (where) => evaluate(`[...document.querySelectorAll('button, summary, a')].filter((b) => b.querySelector('svg') && !b.textContent.trim() && b.offsetParent && !b.classList.contains('account-btn')).flatMap((b) => {
      const r = b.getBoundingClientRect(), i = b.querySelector('svg').getBoundingClientRect();
      const d = Math.max(Math.abs(i.top + i.height / 2 - r.top - r.height / 2), Math.abs(i.left + i.width / 2 - r.left - r.width / 2));
      return r.width && i.width && d > 1 ? [${JSON.stringify(where)} + ': ' + (b.getAttribute('aria-label') || b.title || b.className) + ' ' + d.toFixed(1) + 'px off'] : [];
    })`);
    const off = await icons('the PR');
    // Every row that lines things up (the top bar, the title bar, the pill bar, file headers, the PR list's pills): the
    // items on each line of it centred on one another, within a pixel. Lines found by where items sit (the pill bar wraps).
    const rows = (where) => evaluate(`(() => {
      const out = [];
      for (const row of document.querySelectorAll('.top, .bar, .pr-status, .file-h, .pr-item .pills, .pr-item .pr-meta')) {
        if (!row.offsetParent && getComputedStyle(row).position !== 'fixed') continue;
        const items = [...row.children].filter((c) => { const st = getComputedStyle(c), r = c.getBoundingClientRect(); return r.width > 1 && r.height > 1 && !['absolute', 'fixed'].includes(st.position) && st.visibility !== 'hidden'; })
          .map((c) => { const b = c.getBoundingClientRect(), st = getComputedStyle(c); return { c, r: { top: b.top + parseFloat(st.paddingTop), bottom: b.bottom - parseFloat(st.paddingBottom), get height() { return this.bottom - this.top; } } }; }); // content, not padding: room left for a badge isn't misalignment
        const lines = [];
        for (const it of items.sort((a, b) => a.r.top - b.r.top)) {
          const line = lines.find((l) => it.r.top < l.bottom - 2 && it.r.bottom > l.top + 2);
          line ? (line.items.push(it), (line.top = Math.min(line.top, it.r.top)), (line.bottom = Math.max(line.bottom, it.r.bottom))) : lines.push({ top: it.r.top, bottom: it.r.bottom, items: [it] });
        }
        for (const l of lines) {
          if (l.items.length < 2) continue;
          const mids = l.items.map((it) => it.r.top + it.r.height / 2), lo = Math.min(...mids), hi = Math.max(...mids);
          if (hi - lo > 1) {
            const name = (e) => (e.getAttribute('aria-label') || e.title || e.textContent.trim() || e.className || e.tagName).toString().replace(/\\s+/g, ' ').slice(0, 24);
            const odd = l.items[mids.indexOf(Math.abs(hi - mids.reduce((a, b) => a + b) / mids.length) > Math.abs(lo - mids.reduce((a, b) => a + b) / mids.length) ? hi : lo)];
            out.push(${JSON.stringify(where)} + ' ' + (row.className.split(' ')[0]) + ': ' + name(odd.c) + ' ' + (hi - lo).toFixed(1) + 'px off');
          }
        }
      }
      return out;
    })()`);
    const misaligned = await rows('the PR');
    // A checkbox or radio centred on the first line of its words, within 1.5px (previews aside: they're miniatures).
    const offWords = (where) => evaluate(`[...document.querySelectorAll('label input[type=checkbox], label input[type=radio]')].flatMap((i) => {
      if (!i.offsetParent || i.closest('.demo-side')) return [];
      // The first line of its words: its first text (an icon-only box, like a file's Viewed eye, has none).
      const w = document.createTreeWalker(i.closest('label'), NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.textContent.trim() ? 1 : 3) });
      const t = w.nextNode();
      if (!t) return [];
      const r = document.createRange();
      r.selectNodeContents(t);
      const line = [...r.getClientRects()].find((x) => x.width > 1 && x.height > 1);
      if (!line) return [];
      const b = i.getBoundingClientRect(), d = Math.abs(b.top + b.height / 2 - (line.top + line.height / 2));
      return d > 1.5 ? [${JSON.stringify(where)} + ': "' + i.closest('label').textContent.trim().replace(/\\s+/g, ' ').slice(0, 30) + '" ' + d.toFixed(1) + 'px off'] : [];
    })`);
    // Nothing pushes the page, or the index, sideways (it scrolls only down).
    const sideways = (where) => evaluate(`[document.scrollingElement, ...document.querySelectorAll('.side-scroll')].filter((e) => e && e.scrollWidth > e.clientWidth + 1).map((e) => ${JSON.stringify(where)} + ': ' + (e.className || 'the page') + ' ' + (e.scrollWidth - e.clientWidth) + 'px wider than it shows')`);
    const unboxed = [...(await offWords('the PR')), ...(await offWords('the end of the PR'))];
    const wide = await sideways('the PR');
    // Each picker the index's top row opens (a label, an assignee, a milestone): open, it stays inside the index.
    await evaluate(`document.querySelector('.side.collapsed') && document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }))`);
    await until('the index\'s add buttons', `document.querySelectorAll('.ix-top .ix-head-btn').length >= 3`, 5000);
    for (const which of ['label', 'assign', 'milestone']) {
      await evaluate(`[...document.querySelectorAll('.ix-top .ix-head-btn')].find((b) => /${which}/i.test(b.title)).click()`);
      await until(`the ${which} picker`, `!!document.querySelector('.index input.label-find') && document.querySelectorAll('.ix-pick button, .ix-pick .ix-item').length > 0`, 4000);
      const out = await evaluate(`(() => {
        const ix = document.querySelector('.index').closest('.side-scroll').getBoundingClientRect();
        return [...document.querySelectorAll('.index input.label-find, .ix-pick button, .ix-pick .ix-item')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < ix.left - 1 || r.right > ix.right + 1); }).map((e) => (e.textContent.trim() || e.placeholder || e.tagName).slice(0, 24));
      })()`);
      if (out.length) wide.push(`the ${which} picker: ${out.join(', ')} outside the index `);
      wide.push(...(await sideways(`the ${which} picker`)));
      await evaluate(`document.querySelector('.index input.label-find').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await until(`the ${which} picker closed`, `!document.querySelector('.index input.label-find')`, 2000);
    }
    // A dropdown pill (its <details>) as tall as its pill, not sitting low on a text line.
    const low = await evaluate(`[...document.querySelectorAll('details.pill-menu')].filter((d) => d.offsetParent && Math.abs(d.getBoundingClientRect().height - d.querySelector('summary').getBoundingClientRect().height) > 1).length`);
    if (low) throw new Error(`${low} dropdown pills sit low in their row`);
    // What drops from the title bar (Finish review here; the merge box, Agents, ⋯) draws over the pinned pill bar.
    await evaluate(`[...document.querySelectorAll('.bar button')].find((b) => b.textContent.trim().startsWith('Finish review')).click()`);
    await until('the Finish review panel', `!!document.querySelector('.bar .panel')`, 3000);
    const under = await evaluate(`(() => {
      const p = document.querySelector('.bar .panel').getBoundingClientRect(), s = document.querySelector('.pr-status').getBoundingClientRect();
      const y = (Math.max(p.top, s.top) + Math.min(p.bottom, s.bottom)) / 2;
      return p.top < s.bottom && p.bottom > s.top && [p.left + 12, (p.left + p.right) / 2, p.right - 12].some((x) => !document.elementFromPoint(x, y)?.closest('.bar .panel'));
    })()`);
    if (under) throw new Error('the Finish review panel is under the pinned pill bar');
    unboxed.push(...(await offWords('Finish review')));
    wide.push(...(await sideways('Finish review')));
    await evaluate(`[...document.querySelectorAll('.bar button')].find((b) => b.textContent.trim().startsWith('Finish review')).click()`);
    await evaluate(`location.hash = '/settings'`);
    await until('Settings', `document.querySelectorAll('.page.settings input[type=checkbox]').length > 10`);
    off.push(...(await icons('Settings')));
    unboxed.push(...(await offWords('Settings')));
    wide.push(...(await sideways('Settings')));
    await evaluate(`location.hash = '/'`);
    await until('the PR list', `!!document.querySelector('.pr-item')`);
    misaligned.push(...(await rows('the list')));
    wide.push(...(await sideways('the list')));
    if (misaligned.length) throw new Error(`not lined up: ${misaligned.join('; ')}`);
    if (unboxed.length) throw new Error(`checkboxes off their words: ${unboxed.slice(0, 8).join('; ')}`);
    if (wide.length) throw new Error(`pushed sideways: ${wide.join('; ')}`);
    if (off.length) throw new Error(`icons off centre: ${off.join('; ')}`);
    // Previews are miniatures: only their look is checked. Under 13px: WebKit's small control font, not the page's.
    const boxes = await evaluate(`[...document.querySelectorAll('.page.settings input[type=checkbox]')].filter((c) => c.offsetParent && (getComputedStyle(c).appearance !== 'none' || (!c.closest('.demo-side') && c.getBoundingClientRect().width < 13))).map((c) => getComputedStyle(c).appearance + ' ' + c.getBoundingClientRect().width.toFixed(1) + 'px in ' + c.closest('[class]')?.className)`);
    if (boxes.length) throw new Error(`${boxes.length} checkboxes drawn by macOS or under 13px (${[...new Set(boxes)].slice(0, 6).join(', ')})`);
    const pinned = await evaluate(`[...document.querySelectorAll('.demo-side .pr-status')].filter((p) => getComputedStyle(p).position !== 'static').length`);
    if (pinned) throw new Error(`${pinned} previews' pills pinned over their code`);
  });
} catch (e) {
  failed = true;
  if (!/^Timed out|wasn't sent|error bar/.test(e.message)) console.log(`  ✗ ${e.message}`);
} finally {
  await browser.close();
  server.kill();
  await sleep(300);
}
for (const p of problems) console.log(`  ✗ ${p}`);
if (failed || problems.length) {
  console.log('Smoke test failed.');
  process.exit(1);
}
console.log('Smoke test passed.');
