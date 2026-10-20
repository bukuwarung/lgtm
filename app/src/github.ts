import { fetchToken } from './platform.ts';

export type PR = {
  number: number;
  title: string;
  body: string | null;
  body_html?: string; // GitHub-rendered and sanitized (full+json media type)
  html_url: string;
  node_id: string;
  user: { login: string };
  head: { sha: string; repo: { full_name: string } | null };
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
  author: string;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  requested: boolean; // my review is currently requested (including re-requests)
  myState: ReviewState | null; // my latest submitted review
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

// Two searches: GitHub drops a PR from review-requested:@me once you review it, so reviewed-by:@me covers the rest.
const QUEUE = `query{viewer{login}
  requested:search(query:"is:open is:pr archived:false review-requested:@me",type:ISSUE,first:100){nodes{...F}}
  reviewed:search(query:"is:open is:pr archived:false reviewed-by:@me -author:@me",type:ISSUE,first:100){nodes{...F}}}
fragment F on PullRequest{id number title updatedAt isDraft reviewDecision author{login} repository{nameWithOwner}
  latestReviews(first:100){nodes{state author{login}}}}`;

export async function getReviewQueue(): Promise<QueueItem[]> {
  const d = await graphql(QUEUE, {});
  const me = d.viewer.login;
  const requested = new Set(d.requested.nodes.map((p: any) => p.id));
  const all = new Map<string, any>([...d.reviewed.nodes, ...d.requested.nodes].map((p: any) => [p.id, p]));
  return [...all.values()]
    .map((p) => ({
      id: p.id,
      number: p.number,
      title: p.title,
      updatedAt: p.updatedAt,
      isDraft: p.isDraft,
      repo: p.repository.nameWithOwner,
      author: p.author?.login ?? 'ghost',
      reviewDecision: p.reviewDecision,
      requested: requested.has(p.id),
      myState: p.latestReviews.nodes.find((r: any) => r.author?.login === me && r.state !== 'PENDING')?.state ?? null,
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

export const getPR = (repo: string, n: number): Promise<PR> => json(`/repos/${repo}/pulls/${n}`, undefined, FULL);

export const getFiles = (repo: string, n: number) => paginate<PRFile>(`/repos/${repo}/pulls/${n}/files?per_page=100`);

export async function getRaw(repo: string, path: string, ref: string): Promise<string | null> {
  const res = await gh(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`, {}, 'application/vnd.github.raw');
  if (res.status === 404) return null;
  return (await ok(res)).text();
}

const THREADS = `query($owner:String!,$name:String!,$n:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$n){
  reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}
    nodes{id path line diffSide subjectType isResolved isOutdated comments(first:100){nodes{databaseId bodyHTML bodyText createdAt author{login}}}}}}}}`;

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
