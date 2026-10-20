import { fetchToken } from './platform.ts';

export type PR = {
  number: number;
  title: string;
  body: string | null;
  body_html?: string; // GitHub-rendered and sanitized (full+json media type)
  html_url: string;
  node_id: string;
  user: { login: string; type: string };
  assignees: { login: string; type: string }[];
  head: { sha: string; ref: string; repo: { full_name: string; owner: { login: string } } | null };
  base: { ref: string };
};
export type PRFile = {
  filename: string;
  previous_filename?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  patch?: string;
  blob_url: string;
};
// bodyHTML is GitHub's own rendering: sanitized, hidden <!-- --> markers dropped, <details>/<sub> etc. kept.
export type Comment = { databaseId: number; bodyHTML: string; bodyText: string; createdAt: string; author: { login: string } | null };
export type Thread = {
  id: string;
  path: string;
  line: number | null;
  diffSide: 'LEFT' | 'RIGHT';
  subjectType: 'LINE' | 'FILE';
  isResolved: boolean;
  isOutdated: boolean;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  comments: { nodes: Comment[] };
};
export type Draft = { id: string; path: string; body: string; side: 'LEFT' | 'RIGHT'; line?: number; startLine?: number };
export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
export type QueueItem = {
  id: string;
  number: number;
  title: string;
  updatedAt: string;
  isDraft: boolean;
  repo: string;
  headRepo: string;
  head: string; // branch names, for stack detection
  base: string;
  author: string;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  requested: boolean; // my review is currently requested (including re-requests)
  myState: ReviewState | null; // my latest submitted review
  reviewing: boolean; // in my review queue: requested, or I've reviewed it
  mine: boolean; // I opened it, or it's assigned to me and not in my review queue
  assigned: boolean; // assigned to me
  authored: boolean; // I opened it
};
export type ConversationItem = { id: string; author: string; html: string; at: string; url: string; state?: ReviewState };

// --- auth ---

let token: string | undefined;
export async function loadToken() {
  token = await fetchToken();
}

// --- API ---

async function gh(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json') {
  const res = await fetch(path.startsWith('https://') ? path : `https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) throw new Error('GitHub rejected the gh token. Run `gh auth login`, then reload.');
  return res;
}

async function ok(res: Response) {
  if (res.ok) return res;
  const msg = (await res.json().catch(() => null))?.message;
  throw new Error(`GitHub ${res.status}: ${msg ?? res.statusText}`);
}

// Adds body_html: GitHub-rendered, sanitized comment HTML.
const FULL = 'application/vnd.github.full+json';

const json = async (path: string, init?: RequestInit, accept?: string) => (await ok(await gh(path, init, accept))).json();

async function paginate<T>(path: string, accept?: string): Promise<T[]> {
  const out: T[] = [];
  for (let url: string | undefined = path; url; ) {
    const res = await ok(await gh(url, {}, accept));
    out.push(...(await res.json()));
    url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  return out;
}

async function graphql<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await json('/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) });
  if (r.errors?.length) throw new Error(r.errors[0].message);
  return r.data;
}

// Review queue: GitHub drops a PR from review-requested:@me once you review it, so reviewed-by:@me covers the rest.
// Plus my own PRs and the ones assigned to me.
const QUEUE = `query{viewer{login}
  requested:search(query:"is:open is:pr archived:false review-requested:@me",type:ISSUE,first:100){nodes{...F}}
  reviewed:search(query:"is:open is:pr archived:false reviewed-by:@me -author:@me",type:ISSUE,first:100){nodes{...F}}
  authored:search(query:"is:open is:pr archived:false author:@me",type:ISSUE,first:100){nodes{...F}}
  assigned:search(query:"is:open is:pr archived:false assignee:@me",type:ISSUE,first:100){nodes{...F}}}
fragment F on PullRequest{id number title updatedAt isDraft reviewDecision author{login} repository{nameWithOwner}
  headRefName baseRefName headRepository{nameWithOwner}
  latestReviews(first:100){nodes{state author{login}}}}`;

export async function getReviewQueue(): Promise<QueueItem[]> {
  const d = await graphql(QUEUE, {});
  const me = d.viewer.login;
  const ids = (k: string) => new Set<string>(d[k].nodes.map((p: any) => p.id));
  const [requested, reviewed, authored, assigned] = ['requested', 'reviewed', 'authored', 'assigned'].map(ids);
  const all = new Map<string, any>(['authored', 'assigned', 'reviewed', 'requested'].flatMap((k) => d[k].nodes.map((p: any) => [p.id, p])));
  return [...all.values()]
    .map((p) => ({
      id: p.id,
      number: p.number,
      title: p.title,
      updatedAt: p.updatedAt,
      isDraft: p.isDraft,
      repo: p.repository.nameWithOwner,
      headRepo: p.headRepository?.nameWithOwner ?? '',
      head: p.headRefName,
      base: p.baseRefName,
      author: p.author?.login ?? 'ghost',
      reviewDecision: p.reviewDecision,
      requested: requested.has(p.id),
      myState: p.latestReviews.nodes.find((r: any) => r.author?.login === me && r.state !== 'PENDING')?.state ?? null,
      // An assigned PR that's waiting on my review belongs in the review queue, not twice.
      reviewing: !authored.has(p.id) && (requested.has(p.id) || reviewed.has(p.id)),
      mine: authored.has(p.id) || (assigned.has(p.id) && !requested.has(p.id) && !reviewed.has(p.id)),
      assigned: assigned.has(p.id),
      authored: authored.has(p.id),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Top-level PR comments plus submitted reviews that carry a verdict or a summary.
export async function getConversation(repo: string, n: number): Promise<ConversationItem[]> {
  const [comments, reviews] = await Promise.all([
    paginate<any>(`/repos/${repo}/issues/${n}/comments?per_page=100`, FULL),
    paginate<any>(`/repos/${repo}/pulls/${n}/reviews?per_page=100`, FULL),
  ]);
  return [
    ...comments.map((c) => ({ id: 'c' + c.id, author: c.user?.login ?? 'ghost', html: c.body_html ?? '', at: c.created_at, url: c.html_url })),
    ...reviews
      .filter((r) => r.state !== 'PENDING' && (r.body || r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED'))
      .map((r) => ({ id: 'r' + r.id, author: r.user?.login ?? 'ghost', html: r.body_html ?? '', at: r.submitted_at, url: r.html_url, state: r.state })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

let viewer: Promise<string> | undefined;
export const getViewer = () => (viewer ??= json('/user').then((u) => u.login as string));

// Emails to find someone on Slack: their verified company addresses for the org, then their public email.
export async function getEmails(org: string, logins: string[]): Promise<Record<string, string[]>> {
  const vars = Object.fromEntries(logins.map((l, i) => [`l${i}`, l]));
  const fields = (withOrg: boolean) =>
    logins.map((_, i) => `u${i}:user(login:$l${i}){email${withOrg ? ' organizationVerifiedDomainEmails(login:$org)' : ''}}`).join(' ');
  const decl = (withOrg: boolean) => [...logins.map((_, i) => `$l${i}:String!`), ...(withOrg ? ['$org:String!'] : [])].join(',');
  // The org field needs org membership; fall back to public emails only if it errors.
  const d = await graphql(`query(${decl(true)}){${fields(true)}}`, { ...vars, org }).catch(() => graphql(`query(${decl(false)}){${fields(false)}}`, vars));
  return Object.fromEntries(
    logins.map((l, i) => [l, [...(d[`u${i}`]?.organizationVerifiedDomainEmails ?? []), d[`u${i}`]?.email].filter(Boolean)]),
  );
}

export const getPR = (repo: string, n: number): Promise<PR> => json(`/repos/${repo}/pulls/${n}`, undefined, FULL);

export const getFiles = (repo: string, n: number) => paginate<PRFile>(`/repos/${repo}/pulls/${n}/files?per_page=100`);

export async function getRaw(repo: string, path: string, ref: string): Promise<string | null> {
  const res = await gh(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`, {}, 'application/vnd.github.raw');
  if (res.status === 404) return null;
  return (await ok(res)).text();
}

const THREADS = `query($owner:String!,$name:String!,$n:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$n){
  reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}
    nodes{id path line diffSide subjectType isResolved isOutdated viewerCanResolve viewerCanUnresolve comments(first:100){nodes{databaseId bodyHTML bodyText createdAt author{login}}}}}}}}`;

export async function getThreads(repo: string, n: number): Promise<Thread[]> {
  const [owner, name] = repo.split('/');
  const out: Thread[] = [];
  for (let after: string | null = null; ; ) {
    const d: any = await graphql(THREADS, { owner, name, n, after });
    const page = d.repository.pullRequest.reviewThreads;
    out.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return out;
    after = page.pageInfo.endCursor;
  }
}

// jobId: the GitHub Actions job, whose log the local server can fetch.
export type Check = { name: string; state: 'failure' | 'pending' | 'success' | 'neutral'; url: string | null; summary: string; jobId?: number };

const CHECKS = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){
  commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{__typename
    ... on CheckRun{databaseId name status conclusion detailsUrl title checkSuite{app{slug} workflowRun{workflow{name}}}}
    ... on StatusContext{context state targetUrl description}}}}}}}}}}`;

const RUN_STATE: Record<string, Check['state']> = {
  SUCCESS: 'success', FAILURE: 'failure', TIMED_OUT: 'failure', ACTION_REQUIRED: 'failure', STARTUP_FAILURE: 'failure',
  CANCELLED: 'neutral', NEUTRAL: 'neutral', SKIPPED: 'neutral', STALE: 'neutral',
};
const STATUS_STATE: Record<string, Check['state']> = { SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending' };
const CHECK_ORDER = ['failure', 'pending', 'success', 'neutral'];

// CI checks (GitHub Actions runs and commit statuses) on the PR's head commit, failures first.
export async function getChecks(repo: string, n: number): Promise<Check[]> {
  const [owner, name] = repo.split('/');
  const d: any = await graphql(CHECKS, { owner, name, n });
  const nodes = d.repository.pullRequest.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  const checks: Check[] = nodes.map((c: any): Check =>
      c.__typename === 'CheckRun'
        ? {
            name: [c.checkSuite?.workflowRun?.workflow?.name, c.name].filter(Boolean).join(' / '),
            state: c.status === 'COMPLETED' ? RUN_STATE[c.conclusion] ?? 'neutral' : 'pending',
            url: c.detailsUrl,
            jobId: c.checkSuite?.app?.slug === 'github-actions' ? c.databaseId : undefined,
            summary: c.title || (c.status === 'COMPLETED' ? c.conclusion : c.status).toLowerCase(),
          }
        : { name: c.context, state: STATUS_STATE[c.state] ?? 'neutral', url: c.targetUrl, summary: c.description ?? '' },
  );
  // Re-runs leave a cancelled/skipped copy next to the real result; hide the copy.
  const decided = new Set(checks.filter((c) => c.state !== 'neutral').map((c) => c.name));
  return checks
    .filter((c) => c.state !== 'neutral' || !decided.has(c.name))
    .sort((a: Check, b: Check) => CHECK_ORDER.indexOf(a.state) - CHECK_ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
}

// Files I've marked "Viewed" on GitHub (GitHub's own per-user state, so it carries over to github.com).
export async function getViewed(repo: string, n: number): Promise<Set<string>> {
  const [owner, name] = repo.split('/');
  const viewed = new Set<string>();
  for (let after: string | null = null; ; ) {
    const d: any = await graphql(
      `query($owner:String!,$name:String!,$n:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$n){
        files(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{path viewerViewedState}}}}}`,
      { owner, name, n, after },
    );
    const page = d.repository.pullRequest.files;
    for (const f of page.nodes) if (f.viewerViewedState === 'VIEWED') viewed.add(f.path);
    if (!page.pageInfo.hasNextPage) return viewed;
    after = page.pageInfo.endCursor;
  }
}

export const setViewed = (prId: string, path: string, viewed: boolean) =>
  graphql(
    viewed
      ? `mutation($pr:ID!,$path:String!){markFileAsViewed(input:{pullRequestId:$pr,path:$path}){clientMutationId}}`
      : `mutation($pr:ID!,$path:String!){unmarkFileAsViewed(input:{pullRequestId:$pr,path:$path}){clientMutationId}}`,
    { pr: prId, path },
  );

export const resolveThread = (threadId: string, resolve: boolean) =>
  graphql(
    resolve
      ? `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){clientMutationId}}`
      : `mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){clientMutationId}}`,
    { id: threadId },
  );

export type StackLayer = { number: number; title: string };

// The whole stack around a PR, bottom → top: follow base branches down to PRs whose head is our base, and
// head branches up to the single PR based on our head. Stops at forks, branching stacks, or 10 layers.
export async function getStack(repo: string, pr: PR): Promise<StackLayer[]> {
  const owner = repo.split('/')[0];
  if (pr.head.repo?.full_name !== repo) return [];
  const open = (q: string) => json(`/repos/${repo}/pulls?state=open&per_page=10&${q}`) as Promise<PR[]>;
  const layer = (p: PR) => ({ number: p.number, title: p.title });
  const stack = [layer(pr)];
  for (let cur = pr; stack.length < 10; ) {
    const [below] = await open(`head=${owner}:${encodeURIComponent(cur.base.ref)}`);
    if (!below || stack.some((l) => l.number === below.number)) break;
    stack.unshift(layer(below));
    cur = below;
  }
  for (let cur = pr; stack.length < 10; ) {
    const above = await open(`base=${encodeURIComponent(cur.head.ref)}`);
    if (above.length !== 1 || stack.some((l) => l.number === above[0].number)) break;
    stack.push(layer(above[0]));
    cur = above[0];
  }
  return stack.length > 1 ? stack : [];
}

// The commit my latest submitted review was on, if any.
export async function getMyLastReviewCommit(repo: string, n: number): Promise<string | null> {
  const [me, reviews] = await Promise.all([getViewer(), paginate<any>(`/repos/${repo}/pulls/${n}/reviews?per_page=100`)]);
  return reviews.filter((r) => r.user?.login === me && r.state !== 'PENDING').at(-1)?.commit_id ?? null;
}

// Files changed between two commits. status 'diverged' means `base` isn't an ancestor (the PR was rebased).
export async function getCompare(repo: string, base: string, head: string): Promise<{ status: string; files: PRFile[] }> {
  const d = await json(`/repos/${repo}/compare/${base}...${head}`);
  return { status: d.status, files: d.files ?? [] };
}

export const reply = (repo: string, n: number, commentId: number, body: string) =>
  json(`/repos/${repo}/pulls/${n}/comments/${commentId}/replies`, { method: 'POST', body: JSON.stringify({ body }) });

// GraphQL rather than REST: only addPullRequestReviewThread supports file-level comments inside a review.
export async function submitReview(prId: string, commitOID: string, event: ReviewEvent, body: string, drafts: Draft[]) {
  const d = await graphql(
    `mutation($pr:ID!,$c:GitObjectID!){addPullRequestReview(input:{pullRequestId:$pr,commitOID:$c}){pullRequestReview{id}}}`,
    { pr: prId, c: commitOID },
  );
  const reviewId = d.addPullRequestReview.pullRequestReview.id;
  try {
    for (const x of drafts) {
      await graphql(
        `mutation($r:ID!,$path:String!,$body:String!,$line:Int,$start:Int,$side:DiffSide,$startSide:DiffSide,$subject:PullRequestReviewThreadSubjectType){
          addPullRequestReviewThread(input:{pullRequestReviewId:$r,path:$path,body:$body,line:$line,startLine:$start,side:$side,startSide:$startSide,subjectType:$subject}){thread{id}}}`,
        {
          r: reviewId,
          path: x.path,
          body: x.body,
          line: x.line ?? null,
          start: x.startLine ?? null,
          side: x.line ? x.side : null,
          startSide: x.startLine ? x.side : null,
          subject: x.line ? 'LINE' : 'FILE',
        },
      );
    }
    await graphql(
      `mutation($r:ID!,$e:PullRequestReviewEvent!,$b:String){submitPullRequestReview(input:{pullRequestReviewId:$r,event:$e,body:$b}){clientMutationId}}`,
      { r: reviewId, e: event, b: body || null },
    );
  } catch (e) {
    // Don't leave a half-built pending review behind; it would block the retry.
    await graphql(`mutation($r:ID!){deletePullRequestReview(input:{pullRequestReviewId:$r}){clientMutationId}}`, { r: reviewId }).catch(() => {});
    throw e;
  }
}
