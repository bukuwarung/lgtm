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
  // A library moved a major version, its name long: the dependencies pill's menu keeps it inside (… and in full on hover).
  { filename: 'gradle/libs.versions.toml', status: 'modified', additions: 1, deletions: 1, changes: 2, sha: 'f3', blob_url: 'https://github.com/acme/shop/blob/x/gradle/libs.versions.toml', patch: '@@ -4,1 +4,1 @@\n-firebase-crashlytics-buildtools = { module = "com.google.firebase.crashlytics:firebase-crashlytics-buildtools-gradle-plugin-extended", version = "2.9.9" }\n+firebase-crashlytics-buildtools = { module = "com.google.firebase.crashlytics:firebase-crashlytics-buildtools-gradle-plugin-extended", version = "3.0.2" }' },
  // A deleted file: collapsed (Settings → Diff), so marked viewed at once.
  { filename: 'src/OldPay.kt', status: 'removed', additions: 0, deletions: 2, changes: 2, sha: 'f4', blob_url: 'https://github.com/acme/shop/blob/x/src/OldPay.kt', patch: '@@ -1,2 +0,0 @@\n-class OldPay\n-// gone' },
];
const empty = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] };
// acme/shop#9, big: 300 Kotlin files of 50 new lines each (15,000 lines), for the speed check.
const bigLine = (f, k) => `    val total${k} = items${f}.filter { it.qty != ${k} }.sumOf { it.price * it.qty } + fee // line ${k}`;
const bigFiles = Array.from({ length: 300 }, (_, f) => {
  const path = `src/big/m${String(f).padStart(3, '0')}/Total${f}.kt`;
  return { filename: path, status: 'added', additions: 50, deletions: 0, changes: 50, sha: `b${f}`, blob_url: `https://github.com/acme/shop/blob/x/${path}`, patch: '@@ -0,0 +1,50 @@\n' + Array.from({ length: 50 }, (_, k) => '+' + bigLine(f, k)).join('\n') };
});
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
  const m = query.match(/mutation[^{]*\{\s*(?:\w+:)?(\w+)/); // m0:markFileAsViewed(…): the mutation's name, not its alias
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
  if (path === '/repos/acme/shop/pulls/9') return [200, { ...pr, number: 9, node_id: 'PR_9', title: 'A big change', html_url: 'https://github.com/acme/shop/pull/9', additions: 15000, deletions: 0, changed_files: 300 }];
  if (path.startsWith('/repos/acme/shop/pulls/9/files')) return [200, bigFiles];
  if (/\/(issues\/9\/comments|pulls\/9\/reviews|pulls\/9\/comments|pulls\/9\/commits)/.test(path)) return [200, []];
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
  // A ResizeObserver loop is a notice (platform.ts); a request cut off by the run's own reload isn't the app's failure.
  let reloading = false;
  page.on('pageerror', (e) => /^ResizeObserver loop/.test(e.message) || (reloading && /access control checks|Load failed|cancelled/i.test(e.message)) || problems.push(`Uncaught: ${e.message}`));
  const reload = async () => {
    reloading = true;
    await page.reload();
    await until('the app again', `!!document.querySelector('.top')`);
    await sleep(300);
    reloading = false;
  };
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
  // SMOKE_ONLY=<part of a step's name>: only the steps it names (timing one, say); the rest are skipped.
  const step = async (what, run) => {
    if (process.env.SMOKE_ONLY && !what.includes(process.env.SMOKE_ONLY)) return;
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
  await step('a file lgtm collapses (deleted) is marked viewed at once', async () => {
    for (let i = 0; i < 25 && !sent.includes('markFileAsViewed'); i++) await sleep(200);
    if (!sent.includes('markFileAsViewed')) throw new Error(`not marked (sent: ${sent.join(', ') || 'nothing'})`);
  });
  await step('viewed marks hidden on a small PR (Settings → Reviewing): no eye, no index ticks', async () => {
    await evaluate(`localStorage.setItem('viewedMarks', 'small')`);
    await reload();
    await until('the diff', `!!document.querySelector('[id="f-src/Pay.kt"] tr.ln.a')`);
    const marks = await evaluate(`document.querySelector('.review')?.classList.contains('no-marks') && [...document.querySelectorAll('.viewed-box, .vmark')].filter((e) => e.getClientRects().length).length`);
    if (marks !== 0) throw new Error(`marks on show: ${marks}`);
    await evaluate(`localStorage.removeItem('viewedMarks')`);
    await reload();
    await until('the diff', `!!document.querySelector('[id="f-src/Pay.kt"] tr.ln.a')`);
  });
  await step('waiting for my review, it opens without the index (the switch on); i shows it', async () => {
    await until('no index', `document.querySelector('.review:not(.skel)')?.classList.contains('no-index')`, 3000);
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }))`);
    await until('the index', `!document.querySelector('.review:not(.skel)').classList.contains('no-index')`, 2000);
    await evaluate(`localStorage.removeItem('hideIndexToReview')`);
  });
  // Rows of buttons (two or more side by side in one box): the main (green) one last, as macOS has it, and the gaps
  // between them. Collected as each panel and menu opens, and on each page of the tour.
  const rowsSeen = new Map();
  const rowsIn = async (where) => {
    const rows = await evaluate(`(() => {
      const vis = (b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden' && !b.closest('.demo-side, [inert], [aria-hidden=true], .top, .bar, .pr-list, .side, .pr-status, .file-h, .tree-row');
      const out = [];
      for (const box of document.querySelectorAll('*')) {
        const bs = [...box.children].filter((c) => c.matches('button:not(.link), a.button') && vis(c));
        if (bs.length < 2) continue;
        const name = (e) => (e.getAttribute('aria-label') || e.textContent.trim() || e.title || '').replace(/\\s+/g, ' ').slice(0, 30);
        const p = bs.findIndex((b) => b.classList.contains('primary'));
        const gaps = [];
        for (let i = 1; i < bs.length; i++) { const a = bs[i - 1].getBoundingClientRect(), b = bs[i].getBoundingClientRect(); if (Math.abs(a.top - b.top) < 4) gaps.push(Math.round(b.left - a.right)); }
        out.push({ primary: p >= 0, box: (box.className && typeof box.className === 'string' ? '.' + box.className.split(' ').join('.') : box.tagName.toLowerCase()), names: bs.map(name), late: p >= 0 && p < bs.length - 1 ? name(bs[p]) : null, gaps });
      }
      return out;
    })()`);
    for (const r of rows) rowsSeen.set(r.box + ' ' + r.names.join('|'), { ...r, where });
    return [];
  };
  // A form's row (a main button or a Cancel in it, not a toast's): the main one last, 8px apart.
  const rowFaults = () => [...rowsSeen.values()]
    .filter((r) => !/toast/.test(r.box) && (r.primary || r.names.includes('Cancel')))
    .flatMap((r) => [r.late && `${r.where}: "${r.late}" before ${r.names.slice(r.names.indexOf(r.late) + 1).map((x) => `"${x}"`).join(', ')}`, r.gaps.some((g) => g !== 8) && `${r.where}: ${r.names.join(' · ')} ${r.gaps.join('/')}px apart`])
    .filter(Boolean);
  await step('a line comment goes into the review', async () => {
    await evaluate(`document.querySelector('[id="f-src/Pay.kt"] tr.ln.a td.num:nth-child(2)').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await until('the comment box', `!!document.querySelector('[id="f-src/Pay.kt"] textarea')`);
    await evaluate(`(() => {
      const t = document.querySelector('[id="f-src/Pay.kt"] textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Only network errors should be retried?');
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300); // the button comes alive once the text is in
    await rowsIn('a comment form');
    await evaluate(`[...document.querySelectorAll('[id="f-src/Pay.kt"] button')].find((b) => b.textContent.trim() === 'Add to review').click()`);
    await until('the draft', `[...document.querySelectorAll('button')].some((b) => /^Finish review \\(1\\)/.test(b.textContent.trim()))`);
    await until('Finish review green, with a comment unsent', `[...document.querySelectorAll('.review-submit > button')].some((b) => b.classList.contains('primary'))`);
  });
  await step('Finish review sends it', async () => {
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Finish review')).click()`);
    await until('the submit panel', `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Submit review')`);
    await until('Discard review beside it, for the unsent review on GitHub', `!!document.querySelector('.review-submit .discard-review')`);
    const strip = await evaluate(`[...document.querySelectorAll('p.warn')].map((p) => p.innerText).find((t) => /unsent review/i.test(t)) ?? ''`);
    if (strip) throw new Error(`a strip about the unsent review: ${strip}`);
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
    await until('nothing left', `document.querySelector('.inbox .empty')?.textContent.includes('Nothing waits on your reply')`, 3000);
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
  const icons = (where) => evaluate(`[...document.querySelectorAll('button, summary, a')].filter((b) => b.querySelector('svg') && !b.textContent.trim() && b.offsetParent && !b.classList.contains('account-btn')).flatMap((b) => {
    const r = b.getBoundingClientRect(), i = b.querySelector('svg').getBoundingClientRect();
    const d = Math.max(Math.abs(i.top + i.height / 2 - r.top - r.height / 2), Math.abs(i.left + i.width / 2 - r.left - r.width / 2));
    return r.width && i.width && d > 1 ? [${JSON.stringify(where)} + ': ' + (b.getAttribute('aria-label') || b.title || b.className) + ' ' + d.toFixed(1) + 'px off'] : [];
  })`);
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
  // Text cut off without its "…" (which shows it in full on hover): a box narrower or shorter than its words that hides
  // the rest, or scrolls sideways to show it. Code, which scrolls on purpose, aside; so are previews (miniatures).
  const clipped = (where) => evaluate(`[...document.querySelectorAll('body *')].flatMap((e) => {
    if (!e.getClientRects().length || e.closest('.demo-side, pre, table.diff, .code, svg, [aria-hidden=true]')) return [];
    const st = getComputedStyle(e), r = e.getBoundingClientRect();
    if (r.width < 3 || r.height < 3 || !e.textContent.trim() || st.visibility === 'hidden') return [];
    const x = e.scrollWidth > e.clientWidth + 1 && st.overflowX !== 'visible' && st.textOverflow !== 'ellipsis';
    const y = e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1 && ['hidden', 'clip'].includes(st.overflowY) && st.webkitLineClamp === 'none';
    if (!x && !y) return [];
    const name = (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : e.tagName.toLowerCase());
    return [${JSON.stringify(where)} + ': ' + name + ' "' + e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30) + '" ' + (x ? (e.scrollWidth - e.clientWidth) + 'px wide' : '') + (y ? (e.scrollHeight - e.clientHeight) + 'px tall' : '') + ' (' + (x ? st.overflowX : st.overflowY) + ')'];
  })`);
  // An icon button with no name: no tooltip on hover, and "button" to a screen reader.
  const unnamed = (where) => evaluate(`[...document.querySelectorAll('button, summary, a, [role=button]')].filter((b) => b.getClientRects().length && !b.closest('.demo-side') && b.querySelector('svg') && !b.textContent.trim() && !(b.getAttribute('aria-label') || b.title || b.getAttribute('aria-labelledby') || b.closest('[title]'))).map((b) => ${JSON.stringify(where)} + ': ' + (b.className || b.tagName.toLowerCase()) + ' in ' + (b.parentElement.className || b.parentElement.tagName.toLowerCase()))`);
  // Text too faint to read on what's behind it: under 4.5:1 (3:1 from 24px, or 18.7px bold), WCAG's minimum. Colours
  // read through a canvas (any CSS colour to sRGB), the background the boxes behind it laid one over another. Previews,
  // code (its theme's colours), what's disabled or greyed out (opacity: a switch's sub-switches while it's off) aside.
  const faint = (where) => evaluate(`(() => {
    const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top, under) => top.slice(0, 3).map((v, k) => v * top[3] + under[k] * (1 - top[3])).concat(1);
    const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const out = new Map();
    for (const e of document.querySelectorAll('body *')) {
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || !e.getClientRects().length) continue;
      if (e.closest('.demo-side, pre, table.diff, .code, svg, [disabled], [aria-disabled=true], [aria-hidden=true], option, .slack-preview, mark.wd-add, mark.wd-del')) continue; // word highlights: code
      if (!/[\\p{L}\\p{N}]/u.test(e.textContent)) continue; // an emoji or a mark: its colour isn't what's read
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden') continue;
      const layers = [];
      let unknown = false;
      for (let a = e; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (parseFloat(s.opacity) < 1) { unknown = true; break; }
        if (s.backgroundImage !== 'none') { unknown = true; break; }
        const bg = rgba(s.backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      if (unknown) continue;
      let bg = [255, 255, 255, 1];
      if (!layers.length || layers.at(-1)[3] < 1) bg = rgba(getComputedStyle(document.documentElement).backgroundColor)[3] ? rgba(getComputedStyle(document.documentElement).backgroundColor) : bg;
      for (const l of layers.reverse()) bg = over(l, bg);
      const fg = over(rgba(st.color), bg);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a), ratio = (hi + 0.05) / (lo + 0.05);
      const px = parseFloat(st.fontSize), big = px >= 24 || (px >= 18.66 && parseInt(st.fontWeight) >= 700);
      if (ratio >= (big ? 3 : 4.5)) continue;
      const name = (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : e.tagName.toLowerCase());
      const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
      const key = hex(fg) + ' on ' + hex(bg);
      if (!out.has(key)) out.set(key, ${JSON.stringify(where)} + ': ' + key + ' ' + ratio.toFixed(2) + ':1, ' + name + ' "' + e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 24) + '"');
    }
    return [...out.values()];
  })()`);
  // Every stop Tab reaches shows it's there: how it and its box look focused, against how they look once Tab has moved
  // on (an outline, a ring, a border, a background, or what only shows on focus), or the box it's in, up to three levels
  // out (an editor's border). Up to 600 stops a page.
  const unringed = async (where) => {
    await evaluate(`(() => {
      document.activeElement?.blur();
      // Focus rings that ease in (selects: .12s) would read as unfocused when sampled at once.
      if (!document.getElementById('smoke-still')) document.head.append(Object.assign(document.createElement('style'), { id: 'smoke-still', textContent: '*, *::before, *::after { transition: none !important; }' }));
      window.__look = (e) => e ? [e, e.parentElement, e.parentElement?.parentElement, e.parentElement?.parentElement?.parentElement].filter(Boolean).map((x) => { const s = getComputedStyle(x); return [s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? s.outlineColor + s.outlineWidth : '', s.boxShadow, s.borderColor, s.backgroundColor, s.color, s.opacity, s.visibility, s.textDecorationLine].join('|'); }).join('/') : '';
      window.__stops = [];
    })()`);
    const out = [];
    for (let k = 0; k < 600; k++) {
      await page.keyboard.press('Alt+Tab'); // ⌥⇥, as in Safari: plain Tab skips buttons and links there
      const r = await evaluate(`(() => {
        const e = document.activeElement, last = window.__stops.at(-1);
        let miss = null;
        if (last && last.e !== e && last.e.isConnected && window.__look(last.e) === last.look) {
          const x = last.e;
          miss = (x.getAttribute('aria-label') || x.title || x.textContent.trim().replace(/\\s+/g, ' ').slice(0, 24) || x.placeholder || '') + ' (' + x.tagName.toLowerCase() + (typeof x.className === 'string' && x.className ? '.' + x.className.split(' ')[0] : '') + ')';
        }
        if (!e || e === document.body || window.__stops.some((s) => s.e === e)) return { miss, done: true };
        window.__stops.push({ e, look: window.__look(e) });
        return { miss, done: false };
      })()`);
      if (r.miss && !r.miss.includes('demo')) out.push(`${where}: ${r.miss}`);
      if (r.done) break;
    }
    await evaluate(`document.getElementById('smoke-still')?.remove()`);
    return out;
  };
  // Escape closes what it opened, and gives focus back to what opened it: each opener on the page (a dropdown's summary,
  // a button with a menu or a panel) opened from the keyboard; what floats up from it (a menu, a panel, a dialog) has to
  // go with one Escape, the page stay where it was, and the opener hold focus again.
  // Two buttons saying the same thing at once: in what just opened, or between it and the bar and banners around it
  // (two "Enable auto-merge" in the merge box; "Ready for review" in a banner and a panel).
  const twins = [];
  const twinsIn = (where) => evaluate(`(() => {
    const vis = (b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden' && !b.closest('.demo-side, [inert], [aria-hidden=true]');
    const label = (b) => b.textContent.trim().replace(/\\s+/g, ' ');
    const fl = [...document.querySelectorAll('body *')].filter((e) => window.__float(e) && !window.__was.has(e) && ![...window.__was].some((w) => w.contains(e)));
    const inFloat = [...new Set(fl.flatMap((f) => [...f.querySelectorAll('button, a[href]')]))].filter(vis);
    const around = [...document.querySelectorAll('.bar button, .bar a[href], .pr-state button')].filter(vis).filter((b) => !inFloat.includes(b) && !fl.some((f) => f.contains(b)));
    const seen = new Map();
    for (const b of [...inFloat, ...around]) if (/[a-z]{3}/i.test(label(b))) seen.set(label(b), [...(seen.get(label(b)) ?? []), inFloat.includes(b)]);
    return [...seen].filter(([, l]) => l.length > 1 && l.includes(true)).map(([t]) => ${JSON.stringify(where)} + ': "' + t + '"');
  })()`);
  // Sizes and corners from lgtm's scale: text 11, 12, 13, 14px (16, 20, 28 for titles and big numbers), at the text
  // size set; corners 4px (small things), 6px (controls), 10px (surfaces), a capsule or a circle. Not inside what lgtm
  // renders for others (descriptions, comments, code) or Settings' miniatures.
  const offScale = (where) => evaluate(`(() => {
    const ts = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ts')) || 1;
    const sizes = [11, 12, 13, 14, 16, 20, 28].map((x) => x * ts);
    const corners = new Set(['0px', '4px', '6px', '10px', '999px', '50%']);
    const out = new Set();
    for (const e of document.querySelectorAll('body *')) {
      if (!e.getClientRects().length || e.closest('.md, .rich, .diff, pre, code, kbd, svg, .demo-side, .demo-window, [class*=scene], .md-thumb, .thm, .tg-preview, .doc-render, .emoji, img')) continue;
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden') continue;
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const fs = parseFloat(s.fontSize);
      if (own && !sizes.some((x) => Math.abs(x - fs) < 0.6)) out.add('text ' + fs.toFixed(1) + 'px: ' + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : e.tagName.toLowerCase()));
      // A flat button (no border: an index row, a link) has no shadow either: one showed as a faint line under a row.
      if (e.tagName === 'BUTTON' && s.borderTopWidth === '0px' && parseFloat((s.boxShadow.replace(/inset[^,]*,?/g, '').match(/(-?[\\d.]+)px (-?[\\d.]+)px/) ?? [])[2] ?? '0') !== 0 && document.activeElement !== e && !e.matches(':hover')) out.add('shadow under a flat button: ' + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : 'button'));
      for (const c of [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius]) {
        const v = c.split(' ')[0];
        if (!corners.has(v) && !(parseFloat(v) >= e.getBoundingClientRect().height / 2 - 0.5)) out.add('corner ' + v + ': ' + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : e.tagName.toLowerCase()));
      }
    }
    return [...out].map((x) => ${JSON.stringify(where)} + ', ' + x);
  })()`);
  const escapes = async (where) => {
    const n = await evaluate(`(() => {
      window.__float = (e) => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return (['absolute', 'fixed'].includes(s.position) || e.matches('dialog[open]')) && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 40 && r.height > 20 && !e.closest('.demo-side'); };
      const os = [...document.querySelectorAll('summary, [aria-haspopup]:not([aria-haspopup=false]), [aria-expanded]')].filter((o) => o.getClientRects().length && getComputedStyle(o).visibility !== 'hidden' && !o.closest('.demo-side, [inert]'));
      os.forEach((o, k) => (o.dataset.esc = k));
      return os.length;
    })()`);
    const out = [];
    for (let k = 0; k < n; k++) {
      const name = await evaluate(`(() => {
        const o = document.querySelector('[data-esc="${k}"]');
        if (!o || !o.getClientRects().length) return null;
        window.__was = new Set([...document.querySelectorAll('body *')].filter(window.__float));
        window.__hash = location.hash;
        o.focus();
        return (o.getAttribute('aria-label') || o.title || o.textContent.trim().replace(/\\s+/g, ' ')).slice(0, 30) || o.className;
      })()`);
      if (!name) continue;
      await page.keyboard.press('Enter');
      await sleep(200);
      if (await evaluate(`location.hash !== window.__hash`)) {
        // It went somewhere (Back): not an opener. Back to the page, its openers marked again.
        await evaluate(`location.hash = window.__hash`);
        await sleep(600);
        await evaluate(`[...document.querySelectorAll('summary, [aria-haspopup]:not([aria-haspopup=false]), [aria-expanded]')].filter((o) => o.getClientRects().length && getComputedStyle(o).visibility !== 'hidden' && !o.closest('.demo-side, [inert]')).forEach((o, k) => (o.dataset.esc = k))`);
        continue;
      }
      const opened = await evaluate(`[...document.querySelectorAll('body *')].some((e) => window.__float(e) && !window.__was.has(e) && ![...window.__was].some((w) => w.contains(e)))`);
      if (!opened) {
        // A disclosure (a section that folds), or nothing: put it back as it was.
        if (await evaluate(`(() => { const o = document.querySelector('[data-esc="${k}"]'); return !!o && (o.closest('details')?.open && o.tagName === 'SUMMARY' || o.getAttribute('aria-expanded') === 'true'); })()`)) await page.keyboard.press('Enter');
        continue;
      }
      twins.push(...(await twinsIn(`${where}, ${name}`)));
      await rowsIn(`${where}, ${name}`);
      await page.keyboard.press('Escape');
      await sleep(200);
      const r = await evaluate(`(() => {
        const o = document.querySelector('[data-esc="${k}"]'), a = document.activeElement;
        const left = [...document.querySelectorAll('body *')].filter((e) => window.__float(e) && !window.__was.has(e) && ![...window.__was].some((w) => w.contains(e)));
        return { left: left.map((e) => e.className || e.tagName).slice(0, 2).join(', '), moved: location.hash !== window.__hash, focus: !o || o === a || o.contains(a) ? '' : (a === document.body ? 'nothing' : (a.getAttribute('aria-label') || a.className || a.tagName)) };
      })()`);
      if (r.moved) {
        out.push(`${where}: "${name}": Escape left the page`);
        await evaluate(`location.hash = window.__hash`);
        await sleep(500);
      }
      if (r.left) out.push(`${where}: "${name}": ${r.left} still open after Escape`);
      else if (r.focus) out.push(`${where}: "${name}": focus on ${r.focus} after Escape, not back on it`);
      if (r.left) await evaluate(`(() => { const o = document.querySelector('[data-esc="${k}"]'); const d = o?.closest('details'); if (d) d.open = false; else o?.click(); })()`), await sleep(150);
    }
    await evaluate(`document.querySelectorAll('[data-esc]').forEach((o) => delete o.dataset.esc)`);
    return out;
  };
  // A value straight from GitHub's or GitLab's API on screen, not put into words: in_progress, REVIEW_REQUIRED, MERGEABLE…
  // In lgtm's own text only: code, comments and descriptions (people's words), file and check names aside.
  const RAW = /\b(?:[A-Z]{2,}(?:_[A-Z]+)+|in_progress|timed_out|action_required|startup_failure|waiting_for_resource|APPROVED|COMMENTED|DISMISSED|PENDING|MERGED|CLOSED|OPEN|CLEAN|BLOCKED|BEHIND|DIRTY|UNSTABLE|CONFLICTING|MERGEABLE|UNKNOWN|SUCCESS|FAILURE|NEUTRAL|SKIPPED|CANCELLED|COMPLETED|QUEUED|EXPECTED)\b/;
  const raw = (where) => evaluate(`(() => {
    const out = new Set(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t; (t = w.nextNode()); ) {
      const e = t.parentElement;
      if (!e?.getClientRects().length || e.closest('pre, code, .md, .rich, table.diff, .code, svg, input, textarea, .file-h, .tree, .ix-check .ix-label, .branch')) continue;
      const m = t.textContent.match(${RAW});
      if (m) out.add(${JSON.stringify(where)} + ': "' + m[0] + '" in "' + t.textContent.trim().slice(0, 40) + '" (' + (e.className || e.tagName.toLowerCase()) + ')');
    }
    return [...out];
  })()`);
  // The PR (each pill's menu open in turn), Settings and the list, each through these checks.
  const tour = async (label, checks) => {
    const found = [];
    const at = async (where) => { for (const c of checks) found.push(...(await c(`${label}, ${where}`))); await rowsIn(`${label}, ${where}`); };
    await evaluate(`location.hash = '/acme/shop/pull/1'`);
    await until('the diff', `!!document.querySelector('[id="f-src/Pay.kt"] tr.ln.a')`);
    await at('the PR');
    for (let k = 0; k < (await evaluate(`document.querySelectorAll('.pr-status details.pill-menu').length`)); k++) {
      await evaluate(`(() => { const d = document.querySelectorAll('.pr-status details.pill-menu')[${k}]; d.open = true; d.dispatchEvent(new Event('toggle')); })()`);
      await sleep(150);
      await at("a pill's menu");
      await evaluate(`document.querySelectorAll('.pr-status details.pill-menu')[${k}].open = false`);
    }
    await evaluate(`location.hash = '/settings'`);
    await until('Settings', `document.querySelectorAll('.page.settings input[type=checkbox]').length > 10`);
    await at('Settings');
    await evaluate(`location.hash = '/'`);
    await until('the PR list', `!!document.querySelector('.pr-item')`);
    await at('the list');
    return [...new Set(found)];
  };
  // What only WebKit shows: an icon on the text baseline sits low there; macOS's own checkboxes are tiny and grey out
  // with the window; a preview's pills pinned like the PR page's bar slid over its code.
  await step('layout in WebKit: icon buttons centred, checkboxes lgtm\'s own and on their words, nothing sideways, no text cut off without its …, previews\' pills in place', async () => {
    await evaluate(`location.hash = '/acme/shop/pull/1'`);
    await until('the diff', `!!document.querySelector('[id="f-src/Pay.kt"] tr.ln.a')`);
    const off = await icons('the PR');
    const misaligned = await rows('the PR');
    const unboxed = [...(await offWords('the PR')), ...(await offWords('the end of the PR'))];
    const wide = await sideways('the PR');
    const cut = await clipped('the PR');
    // Each dropdown pill, open: its rows and heading inside it.
    for (let k = 0; k < (await evaluate(`document.querySelectorAll('.pr-status details.pill-menu').length`)); k++) {
      await evaluate(`(() => { const d = document.querySelectorAll('.pr-status details.pill-menu')[${k}]; d.open = true; d.dispatchEvent(new Event('toggle')); })()`);
      await new Promise((r) => setTimeout(r, 150));
      cut.push(...(await clipped('a pill\'s menu')));
      await evaluate(`document.querySelectorAll('.pr-status details.pill-menu')[${k}].open = false`);
    }
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
      cut.push(...(await clipped(`the ${which} picker`)));
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
    cut.push(...(await clipped('Finish review')));
    await evaluate(`[...document.querySelectorAll('.bar button')].find((b) => b.textContent.trim().startsWith('Finish review')).click()`);
    await evaluate(`location.hash = '/settings'`);
    await until('Settings', `document.querySelectorAll('.page.settings input[type=checkbox]').length > 10`);
    off.push(...(await icons('Settings')));
    unboxed.push(...(await offWords('Settings')));
    // Checkboxes the run doesn't open (the merge box's admin bypass and options, New PR, the Close dialog, the ask
    // list's Slack box, the keyboard help, a comment's task list), drawn here as the app draws them, then removed.
    await evaluate(`(() => {
      const d = document.createElement('div');
      d.id = 'smoke-boxes';
      d.innerHTML = \`
        <dialog class="ask new-pr" open><div class="row"><label><input type="checkbox"> Draft</label><span class="spacer"></span><button>Cancel</button></div></dialog>
        <div class="submit merge-bar"><div class="panel merge" style="position:static"><div class="merge-row"><button class="primary">Merge</button><button class="link merge-close">Close</button><label><input type="checkbox"> Merge without waiting for requirements</label></div>
          <div class="merge-confirm"><div class="merge-opt"><label><input type="checkbox"> Move BUKU-1 to</label><select><option>Done</option></select></div><label class="merge-opt"><input type="checkbox"> Delete retry</label></div></div></div>
        <aside class="side tree"><div class="side-scroll"><div class="index"><div class="ix-ask"><label class="ix-ask-slack"><span><input type="checkbox"> Also message them on Slack</span></label></div></div></div></aside>
        <div class="help"><div class="row"><b>Keyboard shortcuts</b><span class="spacer"></span><label><input type="checkbox"> Ignore whitespace</label><button>Close</button></div></div>
        <dialog class="ask" open><p>Close it?</p><form method="dialog"><input maxlength="500"><label><input type="checkbox"> Tell them on Slack</label><button>Cancel</button></form></dialog>
        <div class="rich md"><ul class="contains-task-list"><li class="task-list-item"><label><input type="checkbox" disabled> Write the tests</label></li></ul></div>\`;
      document.body.append(d);
    })()`);
    unboxed.push(...(await offWords('elsewhere')));
    await evaluate(`document.getElementById('smoke-boxes').remove()`);
    wide.push(...(await sideways('Settings')));
    cut.push(...(await clipped('Settings')));
    await evaluate(`location.hash = '/'`);
    await until('the PR list', `!!document.querySelector('.pr-item')`);
    misaligned.push(...(await rows('the list')));
    wide.push(...(await sideways('the list')));
    cut.push(...(await clipped('the list')));
    if (misaligned.length) throw new Error(`not lined up: ${misaligned.join('; ')}`);
    if (unboxed.length) throw new Error(`checkboxes off their words: ${unboxed.slice(0, 8).join('; ')}`);
    if (wide.length) throw new Error(`pushed sideways: ${wide.join('; ')}`);
    if (off.length) throw new Error(`icons off centre: ${off.join('; ')}`);
    if (cut.length) throw new Error(`text cut off without its …: ${[...new Set(cut)].join('; ')}`);
    // Previews are miniatures: only their look is checked. Under 13px: WebKit's small control font, not the page's.
    const boxes = await evaluate(`[...document.querySelectorAll('.page.settings input[type=checkbox]')].filter((c) => c.offsetParent && (getComputedStyle(c).appearance !== 'none' || (!c.closest('.demo-side') && c.getBoundingClientRect().width < 13))).map((c) => getComputedStyle(c).appearance + ' ' + c.getBoundingClientRect().width.toFixed(1) + 'px in ' + c.closest('[class]')?.className)`);
    if (boxes.length) throw new Error(`${boxes.length} checkboxes drawn by macOS or under 13px (${[...new Set(boxes)].slice(0, 6).join(', ')})`);
    const pinned = await evaluate(`[...document.querySelectorAll('.demo-side .pr-status')].filter((p) => getComputedStyle(p).position !== 'static').length`);
    if (pinned) throw new Error(`${pinned} previews' pills pinned over their code`);
  });
  await step('at the narrowest window (900px): lined up, nothing sideways, no text cut off, checkboxes on their words, icon buttons named', async () => {
    await page.setViewportSize({ width: 900, height: 700 });
    const found = await tour('900px', [rows, sideways, clipped, offWords, unnamed]);
    await page.setViewportSize({ width: 1400, height: 900 });
    if (found.length) throw new Error(`at 900px: ${found.slice(0, 15).join('; ')}`);
  });
  await step('at the largest text size (20px), wide and narrow: lined up, nothing sideways, no text cut off, checkboxes on their words', async () => {
    await evaluate(`localStorage.setItem('textSize', '20')`); // Settings → Appearance's largest
    await reload();
    const found = await tour('20px text', [rows, sideways, clipped, offWords]);
    await page.setViewportSize({ width: 900, height: 700 });
    found.push(...(await tour('20px text, 900px', [rows, sideways, clipped, offWords])));
    await page.setViewportSize({ width: 1400, height: 900 });
    await evaluate(`localStorage.removeItem('textSize')`);
    await reload();
    if (found.length) throw new Error(`at 20px text: ${[...new Set(found)].slice(0, 20).join('; ')}`);
  });
  await step('Tab shows where it is: every stop on the PR, Settings and the list looks focused', async () => {
    const found = await tour('Tab', [unringed]);
    if (found.length) throw new Error(`${found.length} stops with no sign of focus: ${found.join('; ')}`);
  });
  await step("no raw API values on screen (in_progress, REVIEW_REQUIRED…) on the PR, its pills' menus, Settings and the list", async () => {
    const found = await tour('raw', [raw]);
    if (found.length) throw new Error(`shown as the API gives them: ${found.join('; ')}`);
  });
  await step('Escape closes each menu, panel and dialog on the PR, the list and Settings, and gives focus back to its opener', async () => {
    const found = [];
    for (const [where, hash, ready] of [['the PR', '/acme/shop/pull/1', `!!document.querySelector('[id="f-src/Pay.kt"] tr.ln.a')`], ['the list', '/', `!!document.querySelector('.pr-item')`], ['Settings', '/settings', `document.querySelectorAll('.page.settings input[type=checkbox]').length > 10`]]) {
      await evaluate(`location.hash = ${JSON.stringify(hash)}`);
      await until(where, ready);
      found.push(...(await escapes(where)));
    }
    if (found.length) throw new Error(`${found.length} not closed by Escape as they should be: ${found.join('; ')}`);
  });
  // The controls in the top bar and the review bar look alike: one edge, one depth, one height (an icon button and a
  // labelled one alike), glass or not. The search bar once had a shadow three times the buttons'.
  const barLook = (where) => evaluate(`(() => {
    const out = [];
    for (const bar of document.querySelectorAll('.top, .bar')) {
      const cs = [...bar.querySelectorAll('button, input, select')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.panel, [role=menu], .account-menu, .pill-pop, details[open] > :not(summary)') && !(e.tagName === 'BUTTON' && e.closest('.cmd')) && !e.matches('.link, .account-btn, [type=checkbox], [type=radio]'));
      const look = (e) => { const s = getComputedStyle(e); return { edge: s.borderTopWidth + ' ' + (s.borderTopStyle === 'none' ? 'none' : 'solid'), depth: s.boxShadow.replace(/rgba?\\([^)]*\\)|color\\([^)]*\\)|oklch\\([^)]*\\)/g, 'c').replace(/inset [^,]*,?\\s*/g, '').trim(), h: Math.round(e.getBoundingClientRect().height) }; };
      for (const k of ['edge', 'depth', 'h']) {
        const by = new Map();
        for (const e of cs) { const v = String(look(e)[k]); by.set(v, [...(by.get(v) ?? []), e]); }
        if (by.size < 2) continue;
        const common = [...by].sort((a, b) => b[1].length - a[1].length)[0][0];
        for (const [v, es] of by) if (v !== common && !(k === 'h' && Math.abs(Number(v) - Number(common)) <= 1)) out.push(${JSON.stringify(where)} + ', ' + (bar.classList.contains('top') ? 'top bar' : 'review bar') + ': ' + k + ' ' + v + ' (others ' + common + '): ' + es.map((e) => (e.getAttribute('aria-label') || e.title || e.textContent.trim() || e.placeholder || e.tagName).replace(/\\s+/g, ' ').slice(0, 24)).join(', '));
      }
    }
    return out;
  })()`);
  await step("the top bar's and the review bar's controls look alike: one edge, one depth, one height", async () => {
    const found = [];
    for (const glass of ['1', '0']) {
      await evaluate(`localStorage.setItem('glass', '${glass}')`);
      await reload();
      await evaluate(`location.hash = '/acme/shop/pull/1'`);
      await until('the diff', `!!document.querySelector('[id="f-src/Pay.kt"] tr.ln.a')`);
      found.push(...(await barLook(glass === '1' ? 'glass' : 'no glass')));
    }
    await evaluate(`localStorage.removeItem('glass')`);
    await reload();
    if (found.length) throw new Error(found.join('; '));
  });
  await step("sizes and corners from lgtm's scale: text 11–14px (16, 20, 28 for titles), corners 4, 6 or 10px", async () => {
    const found = [...new Set(await tour('scale', [offScale]))];
    if (found.length) throw new Error(`${found.length} off the scale: ${found.join('; ')}`);
  });
  await step("a form's buttons as macOS has them: Cancel, then the main one last, 8px apart", async () => {
    const found = rowFaults();
    if (found.length) throw new Error(found.join('; '));
  });
  await step('no two buttons say the same thing at once, in each menu and panel as it opens', async () => {
    if (twins.length) throw new Error(`said twice: ${[...new Set(twins)].join('; ')}`);
  });
  // A big PR (15,000 lines in 300 files): open in 3s, j to the next file and each screenful of scrolling within 100ms
  // (a keypress or scroll to the frame drawn after it).
  await step('a 15,000-line PR: opens in 3s, j and scrolling answer within 100ms', async () => {
    const frame = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`;
    const t0 = Date.now();
    await evaluate(`location.hash = '/acme/shop/pull/9'`);
    await until('the big diff', `!!document.querySelector('[id="f-src/big/m000/Total0.kt"] tr.ln.a') && document.querySelectorAll('.file').length >= 300`, 20000);
    await evaluate(frame);
    const open = Date.now() - t0;
    const keys = [], scrolls = [];
    for (let k = 0; k < 10; k++) keys.push(await evaluate(`(async () => { const t = performance.now(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })); await ${frame}; return performance.now() - t; })()`));
    for (let k = 0; k < 15; k++) scrolls.push(await evaluate(`(async () => { const t = performance.now(); scrollBy(0, innerHeight * 3); await ${frame}; return performance.now() - t; })()`));
    const worst = (xs) => Math.round(Math.max(...xs));
    console.log(`    (opened in ${open}ms; j at worst ${worst(keys)}ms; a scroll at worst ${worst(scrolls)}ms)`);
    // On CI's shared machines (CI set) four times the budget: they run 2-3x slower than a Mac and vary with load, so a
    // tight budget there failed on their noise; a real slowdown still shows, and the times are in the log either way.
    const x = process.env.CI ? 4 : 1;
    const slow = [open > 3000 * x && `opened in ${open}ms`, worst(keys) > 100 * x && `j took ${worst(keys)}ms`, worst(scrolls) > 100 * x && `a scroll took ${worst(scrolls)}ms`].filter(Boolean);
    if (slow.length) throw new Error(`the big PR is slow: ${slow.join('; ')}`);
  });
  await step("text readable on its background, light and dark, in lgtm's look and each theme", async () => {
    const found = [];
    for (const app of ['lgtm', 'one', 'ayu', 'gruvbox']) // themes.ts: lgtm's own, then BUILTIN_THEMES
      for (const mode of ['light', 'dark']) {
        await evaluate(`localStorage.setItem('appTheme', ${JSON.stringify(app)}); localStorage.setItem('theme', ${JSON.stringify(mode)})`);
        await reload();
        found.push(...(await tour(`${app} ${mode}`, [faint])));
      }
    await evaluate(`localStorage.removeItem('appTheme'); localStorage.removeItem('theme')`);
    const pairs = new Map(found.map((f) => [f.replace(/, [^:]+: /, ': ').replace(/, \S+ ".*$/, ''), f]));
    if (pairs.size) throw new Error(`${pairs.size} colours too faint on their background:\n    ${[...pairs.values()].join('\n    ')}`);
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
