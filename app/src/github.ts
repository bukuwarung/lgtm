import { setEmojiMap } from './emoji.ts';
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
  requested_reviewers?: { login: string }[];
  head: { sha: string; ref: string; repo: { full_name: string; owner: { login: string } } | null };
  base: { ref: string };
};
export type PRFile = {
  filename: string;
  sha: string; // blob at the PR head: changes when the file does
  previous_filename?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  patch?: string;
  blob_url: string;
};
// bodyHTML is GitHub's own rendering: sanitized, hidden <!-- --> markers dropped, <details>/<sub> etc. kept.
export type Comment = { databaseId: number; url: string; bodyHTML: string; bodyText: string; createdAt: string; author: { login: string; __typename?: string } | null };
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
  mergeState: MergeState['mergeStateStatus'];
  ci: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null; // all checks on the head commit, rolled up
  additions: number;
  deletions: number;
  files: number;
  autoMerge: boolean;
  requested: boolean; // my review is currently requested (including re-requests)
  myState: ReviewState | null; // my latest submitted review
  reviewedBefore: boolean; // I've reviewed it (a re-request drops my review from latestReviews, but not from this)
  reviewing: boolean; // in my review queue: requested, or I've reviewed it
  mine: boolean; // I opened it, or it's assigned to me and not in my review queue
  assigned: boolean; // assigned to me
  authored: boolean; // I opened it
  thread?: ThreadStatus; // filled in after the list loads (getThreadStatus)
};
export type ConversationItem = { id: string; author: string; html: string; at: string; url: string; state?: ReviewState; bot: boolean };

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
fragment F on PullRequest{id number title updatedAt isDraft reviewDecision mergeStateStatus autoMergeRequest{enabledAt} author{login}
  additions deletions changedFiles commits(last:1){nodes{commit{statusCheckRollup{state}}}} repository{nameWithOwner}
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
      mergeState: p.mergeStateStatus,
      ci: p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
      additions: p.additions,
      deletions: p.deletions,
      files: p.changedFiles,
      autoMerge: !!p.autoMergeRequest,
      requested: requested.has(p.id),
      myState: p.latestReviews.nodes.find((r: any) => r.author?.login === me && r.state !== 'PENDING')?.state ?? null,
      // An assigned PR that's waiting on my review belongs in the review queue, not twice.
      reviewedBefore: reviewed.has(p.id),
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
    ...comments.map((c) => ({ id: 'c' + c.id, author: c.user?.login ?? 'ghost', html: c.body_html ?? '', at: c.created_at, url: c.html_url, bot: c.user?.type === 'Bot' })),
    ...reviews
      .filter((r) => r.state !== 'PENDING' && (r.body || r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED'))
      .map((r) => ({ id: 'r' + r.id, author: r.user?.login ?? 'ghost', html: r.body_html ?? '', at: r.submitted_at, url: r.html_url, state: r.state, bot: r.user?.type === 'Bot' })),
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
    nodes{id path line diffSide subjectType isResolved isOutdated viewerCanResolve viewerCanUnresolve comments(first:100){nodes{databaseId url bodyHTML bodyText createdAt author{__typename login}}}}}}}}`;

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
    ... on CheckRun{databaseId name status conclusion startedAt detailsUrl title checkSuite{app{slug} workflowRun{workflow{name}}}}
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
  // A workflow can run several times on one commit (each PR edit or label change re-triggers it): latest run first, so
  // each check keeps only its newest result below.
  nodes.sort((a: any, b: any) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
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
  // One entry per check: its latest real result, since re-runs also leave cancelled/skipped copies behind.
  const latest = new Map<string, Check>();
  for (const c of checks) if (!latest.has(c.name) || (latest.get(c.name)!.state === 'neutral' && c.state !== 'neutral')) latest.set(c.name, c);
  return [...latest.values()]
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

// GitHub's emoji shortcodes (name → image URL), cached for the session.
let emojis: Promise<Record<string, string>> | undefined;
export const getEmojis = () =>
  (emojis ??= json('/emojis').then((m: Record<string, string>) => {
    setEmojiMap(m);
    return m;
  }));

// Markdown rendered by GitHub itself (emoji, @mentions, #refs, mermaid…), exactly as the comment will look there.
export async function renderGfm(text: string, repo: string): Promise<string> {
  const res = await ok(await gh('/markdown', { method: 'POST', body: JSON.stringify({ text, mode: 'gfm', context: repo }) }, 'text/html'));
  return res.text();
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

// --- merging (my own PRs) ---

export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';
export type MergeState = {
  id: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  // GitHub's verdict: CLEAN/HAS_HOOKS/UNSTABLE can merge; BEHIND, BLOCKED, DIRTY, DRAFT can't; UNKNOWN is still computing.
  mergeStateStatus: 'BEHIND' | 'BLOCKED' | 'CLEAN' | 'DIRTY' | 'DRAFT' | 'HAS_HOOKS' | 'UNKNOWN' | 'UNSTABLE';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  headRefOid: string;
  mergedBy: { login: string } | null;
  autoMergeRequest: { mergeMethod: MergeMethod; enabledBy: { login: string } | null } | null;
  viewerCanMergeAsAdmin: boolean;
  viewerCanEnableAutoMerge: boolean;
  viewerCanDisableAutoMerge: boolean;
  viewerCanUpdateBranch: boolean;
  methods: MergeMethod[]; // allowed in this repo, the viewer's usual one first
  message: Record<MergeMethod, { title: string; body: string }>; // GitHub's default commit message per method
};

const MERGE_STATE = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){
  mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed viewerDefaultMergeMethod
  pullRequest(number:$n){id state isDraft mergeable mergeStateStatus reviewDecision headRefOid mergedBy{login}
    autoMergeRequest{mergeMethod enabledBy{login}}
    viewerCanMergeAsAdmin viewerCanEnableAutoMerge viewerCanDisableAutoMerge viewerCanUpdateBranch
    mt:viewerMergeHeadlineText(mergeType:MERGE) mb:viewerMergeBodyText(mergeType:MERGE)
    st:viewerMergeHeadlineText(mergeType:SQUASH) sb:viewerMergeBodyText(mergeType:SQUASH)}}}`;

export async function getMergeState(repo: string, n: number): Promise<MergeState> {
  const [owner, name] = repo.split('/');
  const r = (await graphql(MERGE_STATE, { owner, name, n })).repository;
  const { mt, mb, st, sb, ...pr } = r.pullRequest;
  const allowed = (['MERGE', 'SQUASH', 'REBASE'] as const).filter((m) => r[`${m.toLowerCase()}${m === 'MERGE' ? 'Commit' : 'Merge'}Allowed`]);
  return {
    ...pr,
    methods: allowed.sort((a, b) => +(b === r.viewerDefaultMergeMethod) - +(a === r.viewerDefaultMergeMethod)),
    message: { MERGE: { title: mt, body: mb }, SQUASH: { title: st, body: sb }, REBASE: { title: '', body: '' } },
  };
}

// expectedHeadOid: refuse if commits were pushed after the state I looked at.
export const mergePR = (s: MergeState, method: MergeMethod, title: string, body: string, auto: boolean) =>
  graphql(
    auto
      ? `mutation($id:ID!,$m:PullRequestMergeMethod,$t:String,$b:String,$oid:GitObjectID){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$m,commitHeadline:$t,commitBody:$b,expectedHeadOid:$oid}){clientMutationId}}`
      : `mutation($id:ID!,$m:PullRequestMergeMethod,$t:String,$b:String,$oid:GitObjectID){mergePullRequest(input:{pullRequestId:$id,mergeMethod:$m,commitHeadline:$t,commitBody:$b,expectedHeadOid:$oid}){clientMutationId}}`,
    { id: s.id, m: method, t: method === 'REBASE' ? null : title, b: method === 'REBASE' ? null : body, oid: s.headRefOid },
  );
export const disableAutoMerge = (id: string) =>
  graphql(`mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){clientMutationId}}`, { id });
export const updateBranch = (s: MergeState) =>
  graphql(`mutation($id:ID!,$oid:GitObjectID){updatePullRequestBranch(input:{pullRequestId:$id,expectedHeadOid:$oid}){clientMutationId}}`, { id: s.id, oid: s.headRefOid });
export const markReady = (id: string) =>
  graphql(`mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){clientMutationId}}`, { id });

// Does this review thread wait on me? Open and current, last word from a person other than me, and it's my PR or I'm
// in the thread. Outdated threads don't count: the code moved on, and a reply there is nearly always "done".
export function awaitsMe(t: Pick<Thread, 'isResolved' | 'isOutdated'> & { comments: { nodes: Pick<Comment, 'author'>[] } }, me: string, myPR: boolean) {
  const last = t.comments.nodes.at(-1)?.author;
  if (t.isResolved || t.isOutdated || !last || last.login === me || last.__typename === 'Bot') return false;
  return myPR || t.comments.nodes.some((c) => c.author?.login === me);
}

// Per PR in the list: how many review threads wait on my reply (see awaitsMe), and whether every thread I'm in is
// resolved (then a PR I reviewed is ready for another look). One query for all of them.
export type ThreadStatus = { awaiting: number; allMineResolved: boolean };
export async function getThreadStatus(items: QueueItem[]): Promise<Map<string, ThreadStatus>> {
  const me = await getViewer();
  const ask = items.filter((i) => i.mine || i.myState);
  if (!ask.length) return new Map();
  const vars = Object.fromEntries(ask.map((i, k) => [`i${k}`, i.id]));
  const d = await graphql(
    `query(${ask.map((_, k) => `$i${k}:ID!`).join(',')}){${ask
      .map((_, k) => `p${k}:node(id:$i${k}){...on PullRequest{reviewThreads(last:100){nodes{isResolved isOutdated starter:comments(first:1){nodes{author{login}}} comments(last:20){nodes{author{__typename login}}}}}}}`)
      .join(' ')}}`,
    vars,
  );
  return new Map(
    ask.map((i, k) => {
      const threads = d[`p${k}`].reviewThreads.nodes;
      const mine = threads.filter((t: any) => [...t.starter.nodes, ...t.comments.nodes].some((c: any) => c.author?.login === me));
      return [i.id, { awaiting: threads.filter((t: any) => awaitsMe(t, me, i.authored)).length, allMineResolved: mine.length > 0 && mine.every((t: any) => t.isResolved) }];
    }),
  );
}

// Review threads by how much they concern me, each tier keeping the given order: threads I'm in (open, then resolved),
// then open threads from people, then open bot-only threads; resolved threads I'm not in go last, out of the way.
export function threadTiers<T extends Pick<Thread, 'isResolved'> & { comments: { nodes: Pick<Comment, 'author'>[] } }>(threads: T[], me: string) {
  const mine = (t: T) => t.comments.nodes.some((c) => c.author?.login === me);
  const bot = (t: T) => t.comments.nodes.every((c) => c.author?.__typename === 'Bot');
  return {
    mine: threads.filter(mine).sort((a, b) => +a.isResolved - +b.isResolved), // my open ones first
    human: threads.filter((t) => !mine(t) && !t.isResolved && !bot(t)),
    bot: threads.filter((t) => !mine(t) && !t.isResolved && bot(t)),
    resolved: threads.filter((t) => !mine(t) && t.isResolved),
  };
}
