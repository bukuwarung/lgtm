import { setEmojiMap } from './emoji.ts';
import { agentsAsBots, fetchJobLog, fetchToken, personKey, readBots, recordError, repliesDone, viewAs } from './platform.ts';
import { tally, touchedLines, whoKnows, type Knows } from './expertise.ts';
import { estimate, type BuildRoot, type Estimate } from './files.ts';
import * as lab from './gitlab.ts';
import { isLab, isLabId } from './gitlab.ts';
export { isLab } from './gitlab.ts';

export type PR = {
  number: number;
  title: string;
  updated_at?: string;
  body: string | null;
  body_html?: string; // GitHub-rendered and sanitized (full+json media type)
  html_url: string;
  node_id: string;
  user: { login: string; type: string; avatar_url?: string };
  assignees: { login: string; type: string }[];
  requested_reviewers?: { login: string; type?: string }[];
  requested_teams?: { slug: string }[];
  head: { sha: string; ref: string; repo: { full_name: string; owner: { login: string } } | null };
  base: { ref: string; sha: string };
  draft?: boolean;
  state?: 'open' | 'closed';
  merged?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
  merged_by?: { login: string } | null;
  additions?: number;
  deletions?: number;
  changed_files?: number;
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
export type Comment = { id?: string; databaseId: number; url: string; body?: string; bodyHTML: string; bodyText: string; createdAt: string; author: { login: string; __typename?: string; databaseId?: number; avatarUrl?: string } | null; originalCommit?: { oid: string } | null; state?: string; pullRequestReview?: { databaseId: number } | null }; // state PENDING: in my review not yet sent; pullRequestReview: the review it came with
export type Thread = {
  id: string;
  path: string;
  line: number | null;
  startLine?: number | null;
  originalLine?: number | null; // where it was written: lines of the first comment's originalCommit
  originalStartLine?: number | null;
  diffSide: 'LEFT' | 'RIGHT';
  subjectType: 'LINE' | 'FILE';
  isResolved: boolean;
  isOutdated: boolean;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  comments: { nodes: Comment[] };
  hunk?: { nodes: { diffHunk: string }[] }; // the diff the first comment was written on, up to its line
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
  face: string; // whose picture the list shows: the author, or for a bot's PR its assignee
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  mergeState: MergeState['mergeStateStatus'];
  ci: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null; // all checks on the head commit, rolled up
  additions: number;
  deletions: number;
  files: number;
  autoMerge: boolean;
  canAutoMerge: boolean;
  changesBy: string[]; // who asked for changes and hasn't been asked to look again // the repo allows auto-merge and I may turn it on
  queue: { position: number; state: 'QUEUED' | 'AWAITING_CHECKS' | 'MERGEABLE' | 'UNMERGEABLE' | 'LOCKED' } | null; // its place in the repo's merge queue
  requested: boolean; // my review is currently requested (including re-requests)
  myState: ReviewState | null; // my latest submitted review
  newSinceApproval: number; // my latest verdict is an approval: commits written since (of the last 20)
  reviewedBefore: boolean; // I've reviewed it (a re-request drops my review from latestReviews, but not from this)
  reviewing: boolean; // in my review queue: requested, or I've reviewed it
  mine: boolean; // I opened it, or it's assigned to me and not in my review queue
  assigned: boolean; // assigned to me
  authored: boolean; // I opened it
  codeOwner?: boolean; // a draft changing files I (or a team of mine) own: GitHub asks code owners only once it's ready
  thread?: ThreadStatus; // filled in after the list loads (getThreadStatus)
  mentionWaiting?: boolean; // a conversation comment mentioning me waits on me (getMentionStatus; the inbox lists it)
  qa?: { replies: string[]; status: 'signed' | 'issue' | null }; // my PR's QA request on Slack (platform.ts qaThreads)
  waitingSince: string; // when it last asked for review: opened, marked ready, or a review requested
  pendingReviewers: string[]; // people (not teams) whose review is requested
  noReviewers: boolean;
  mentioned?: boolean; // someone @-mentions me in it (shown, when that's all, until I open it after its latest activity) // nobody asked (people or teams) and no person has reviewed: bots don't count
  lastCommitAt: string; // the head commit's time
  headSha?: string; // the head commit
  estimate?: Estimate; // rough time to review (files.ts), filled in after the list loads (getEstimates)
};
export type ConversationItem = { id: string; author: string; avatar?: string; html: string; at: string; url: string; state?: ReviewState; bot: boolean; commit?: string }; // commit: the head a review was of

// A PR's and a file's web addresses, and the site's name: github.com, or the GitLab the repo is on.
export const site = (repo: string) => (isLab(repo) ? 'GitLab' : 'GitHub');
// A PR's number as its site writes it: #12 on GitHub, !12 for a GitLab MR.
export const numRef = (repo: string, n: number) => `${isLab(repo) ? '!' : '#'}${n}`;
export const prWebUrl = (repo: string, n: number) => (isLab(repo) ? lab.mrUrl(repo, n) : `https://github.com/${repo}/pull/${n}`);
export const blobWebUrl = (repo: string, ref: string, path: string, line?: number) =>
  isLab(repo) ? lab.blobUrl(repo, ref, path, line) : `https://github.com/${repo}/blob/${ref}/${path}${line ? `#L${line}` : ''}`;
// A PR from its address: a github.com PR ("o/r/pull/1", with or without the site), or a GitLab MR
// ("gitlab.example.com/group/sub/project/-/merge_requests/1"; lgtm's own route for it is "host/group/…/project/pull/1").
export function parsePrUrl(s: string): { repo: string; n: number } | null {
  const gl = s.match(/([a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/[\w.-]+){2,}?)\/(?:-\/merge_requests|pull)\/(\d+)/i);
  if (gl && !/^(www\.)?github\.com\//i.test(gl[1])) return { repo: gl[1], n: +gl[2] };
  const m = s.match(/([^/\s#]+\/[^/\s]+)\/pull\/(\d+)/);
  return m ? { repo: m[1], n: +m[2] } : null;
}

// --- auth ---

let token: string | undefined;
export async function loadToken() {
  token = await fetchToken();
}

// --- API ---

// Review mode's practice run (main.tsx): nothing is written to GitHub, every change refused here, reads go through.
let practice = false;
export const setPractice = (on: boolean) => void ((practice = on), lab.setLabPractice(on));
const writes = (path: string, init: RequestInit) =>
  !!init.method && init.method !== 'GET' && path !== '/markdown' && (path !== '/graphql' || /"query":"(?:\\[nt]|\s)*mutation/.test(String(init.body)));

// GitHub's limits, each on its own: REST ("core", 5,000 an hour), GraphQL (5,000 points an hour), search (30 a
// minute)… One used up stops only the requests that draw on it, until it resets (asking anyway only fails, and slows
// the reset); a "slow down" (GitHub's secondary limit, on bursts) for the seconds GitHub asks.
const limited = new Map<string, { until: number; slow: boolean }>();
const bucketOf = (path: string) => (path === '/graphql' ? 'graphql' : path.startsWith('/search/code') ? 'code_search' : path.startsWith('/search/') ? 'search' : 'core');
const LIMIT_NAME: Record<string, string> = { core: "GitHub's hourly API limit", graphql: "GitHub's hourly GraphQL limit", search: "GitHub's search limit (30 a minute)", code_search: "GitHub's code search limit (10 a minute)" };
const limitError = (bucket: string) => {
  const l = limited.get(bucket)!;
  const at = new Date(l.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(l.until - Date.now() < 120_000 ? { second: '2-digit' } : {}) });
  return new Error(l.slow ? `GitHub asked lgtm to slow down: it asks again at ${at}` : `${LIMIT_NAME[bucket] ?? `GitHub's ${bucket} limit`} is used up until ${at}: lgtm waits until then`);
};
export const isLimited = (bucket: string) => (limited.get(bucket)?.until ?? 0) > Date.now();

// What's left of each limit, from GitHub's own figures on each answer (or /rate_limit, which costs nothing), and what
// spent it this hour, roughly: requests by what they were for. A word, once per hour, when one is down to 10%.
export type Budget = { remaining: number; limit: number; reset: number };
export const budgets = new Map<string, Budget>();
const spent = new Map<string, Map<string, number>>(); // bucket → what for → requests, this hour (GitHub's own "used" count
// jumps about between answers, so a GraphQL query's points can't be told from it)
const warned = new Set<string>();
function areaOf(path: string, body?: string): string {
  if (path === '/graphql') {
    const q = body ?? '';
    if (/review-requested:@me|reviewed-by:@me -author|\$i0:ID!|nodes\(ids:/.test(q)) return 'the PR list';
    if (/reviewThreads|states:PENDING|pullRequest\(number/.test(q)) return 'opening PRs';
    if (/reviewed-by:|contributionsCollection|involves:/.test(q)) return 'people and history';
    if (/team|members/.test(q)) return 'the Team tab';
    return 'other';
  }
  if (/\/(check-runs|check-suites|status|actions)\b/.test(path)) return 'checks';
  if (/\/(pulls|issues)\/\d+|\/contents\/|\/compare\/|\/git\//.test(path)) return 'opening PRs';
  if (/^\/users\/|^\/orgs\//.test(path)) return 'people and teams';
  return 'other';
}
function noteBudget(res: Response, bucket: string, path: string, body?: string) {
  const remaining = Number(res.headers.get('x-ratelimit-remaining')), limit = Number(res.headers.get('x-ratelimit-limit')), reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
  if (!limit || Number.isNaN(remaining)) return;
  const prev = budgets.get(bucket);
  if (!prev || Math.abs(prev.reset - reset) > 60_000) spent.set(bucket, new Map()); // a new hour
  budgets.set(bucket, { remaining, limit, reset });
  const by = spent.get(bucket)!;
  by.set(areaOf(path, body), (by.get(areaOf(path, body)) ?? 0) + 1);
  if (limit >= 1000 && remaining <= limit / 10 && !warned.has(bucket + reset)) {
    warned.add(bucket + reset);
    const at = new Date(reset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `${LIMIT_NAME[bucket] ?? `GitHub's ${bucket} limit`}: ${remaining} of ${limit} left until ${at}. lgtm keeps going; Settings → Accounts shows what used it.` } }));
  }
}
export const spentThisHour = (bucket: string) => [...(spent.get(bucket) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]);
export async function getBudgets(): Promise<void> {
  const r = await (await ok(await fetch('https://api.github.com/rate_limit', { cache: 'no-cache', headers: { Authorization: `Bearer ${token}` } }))).json();
  for (const b of ['core', 'graphql', 'search']) {
    const x = r.resources?.[b];
    if (!x) continue;
    if (!spent.has(b)) spent.set(b, new Map());
    budgets.set(b, { remaining: x.remaining, limit: x.limit, reset: x.reset * 1000 });
  }
}
function noteLimit(res: Response, path: string, body?: string) {
  const bucket = res.headers.get('x-ratelimit-resource') ?? bucketOf(path);
  noteBudget(res, bucket, path, body);
  const retry = Number(res.headers.get('retry-after'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if ((res.status === 403 || res.status === 429) && retry) limited.set(bucket, { until: Date.now() + retry * 1000, slow: true });
  else if (res.headers.get('x-ratelimit-remaining') === '0' && reset) limited.set(bucket, { until: reset * 1000, slow: false });
  else return;
  recordError(`GitHub ${res.status} ${path}: the ${bucket} limit (${res.headers.get('x-ratelimit-used') ?? '?'}/${res.headers.get('x-ratelimit-limit') ?? '?'} used${retry ? `, retry after ${retry}s` : ''})`);
}

// Whether GitHub can be reached: a request that can't get through says offline, the next that does says online again
// (main.tsx shows it once, for the whole app, and refreshes when it's back).
// A GitLab out of reach counts too (gitlab.ts), named in the bar.
let offline = false;
let offlineSite = 'GitHub';
export const isOffline = () => offline;
export const offlineWhere = () => offlineSite;
export const setOffline = (v: boolean, where = 'GitHub') => {
  if (v) offlineSite = where;
  else if (where !== offlineSite) return; // one site answering says nothing of the other
  if (offline !== v) (offline = v), dispatchEvent(new Event(v ? 'lgtm:offline' : 'lgtm:online'));
};
// A cheap look (it doesn't count against the limits) to see whether GitHub, or the GitLab out of reach, answers again.
export const pingGitHub = () => (offlineSite !== 'GitHub' ? lab.pingLab(offlineSite) : gh('/rate_limit').then(() => true, () => false));

async function gh(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json') {
  if (practice && writes(path, init)) throw new Error('Practice run: nothing is sent to GitHub');
  const bucket = bucketOf(path.replace(/^https:\/\/api\.github\.com/, ''));
  if (Date.now() < (limited.get(bucket)?.until ?? 0)) throw limitError(bucket);
  const res = await fetch(path.startsWith('https://') ? path : `https://api.github.com${path}`, {
    // GitHub lets the browser keep a response for 60 seconds: always check it's current (an unchanged one is a cheap
    // 304), or a refresh, or the page after asking a reviewer, shows the copy from before.
    cache: 'no-cache',
    ...init,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  }).catch((e) => {
    setOffline(true);
    throw new Error(`Couldn't reach GitHub (${e.message})`);
  });
  setOffline(false);
  if (res.status === 401) throw new Error('GitHub rejected the gh token. Run `gh auth login`, then reload.');
  noteLimit(res, path.replace(/^https:\/\/api\.github\.com/, '').split('?')[0], typeof init.body === 'string' ? init.body : undefined);
  return res;
}

async function ok(res: Response) {
  if (res.ok) return res;
  const msg = (await res.json().catch(() => null))?.message;
  const path = new URL(res.url).pathname;
  // A secondary limit without a time to retry: GitHub's advice is a minute.
  if ((res.status === 403 || res.status === 429) && /secondary rate limit/i.test(msg ?? '') && !((limited.get(bucketOf(path))?.until ?? 0) > Date.now()))
    limited.set(bucketOf(path), { until: Date.now() + 60_000, slow: true });
  recordError(`GitHub ${res.status} ${path}: ${msg ?? res.statusText}`);
  throw new Error(`GitHub ${res.status}: ${msg ?? res.statusText}`);
}

// Adds body_html: GitHub-rendered, sanitized comment HTML.
const FULL = 'application/vnd.github.full+json';

const json = async (path: string, init?: RequestInit, accept?: string) => (await ok(await gh(path, init, accept))).json();

// Every page of a list. The first page's Link header names the last one, so the rest are fetched at once (a 1,400-file
// PR is 15 pages); without it, page by page.
async function paginate<T>(path: string, accept?: string): Promise<T[]> {
  const first = await ok(await gh(path, {}, accept));
  const out: T[] = await first.json();
  const link = first.headers.get('link') ?? '';
  const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  const last = Number(link.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/)?.[1]);
  if (next && last && /[?&]page=\d+/.test(next)) {
    const urls = Array.from({ length: last - 1 }, (_, k) => next.replace(/([?&]page=)\d+/, `$1${k + 2}`));
    const pages = await Promise.all(urls.map(async (u) => (await ok(await gh(u, {}, accept))).json()));
    return out.concat(...pages);
  }
  for (let url = next; url; ) {
    const res = await ok(await gh(url, {}, accept));
    out.push(...(await res.json()));
    url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  return out;
}

// partial: return what resolved even if some fields errored (they come back null).
async function graphql<T = any>(query: string, variables: Record<string, unknown>, partial = false): Promise<T> {
  const r = await json('/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) });
  if (r.errors?.some((e: { type?: string }) => e.type === 'RATE_LIMITED') && (limited.get('graphql')?.until ?? 0) > Date.now()) throw limitError('graphql');
  if (r.errors?.length) recordError(`GitHub GraphQL: ${r.errors[0].message}`);
  if (r.errors?.length && !(partial && r.data)) throw new Error(r.errors[0].message);
  return r.data;
}

// Which of these PRs ("owner/repo#n") GitHub says are merged or closed, in one query. One it can't find (gone, or no
// access) isn't counted: only a closed one is certain.
export async function closedPRs(prs: string[]): Promise<string[]> {
  if (prs.some((p) => isLab(p))) return Promise.all([closedPRs(prs.filter((p) => !isLab(p))), lab.labClosed(prs.filter((p) => isLab(p)))]).then(([a, b]) => [...a, ...b]);
  const parts = prs.map((p) => p.match(/^([^/]+)\/([^#]+)#(\d+)$/));
  const ks = parts.flatMap((m, k) => (m ? [k] : []));
  if (!ks.length) return [];
  const d = await graphql(
    `query(${ks.map((k) => `$o${k}:String!,$r${k}:String!,$n${k}:Int!`).join(',')}){${ks.map((k) => `p${k}:repository(owner:$o${k},name:$r${k}){pullRequest(number:$n${k}){state}}`).join(' ')}}`,
    Object.fromEntries(ks.flatMap((k) => [[`o${k}`, parts[k]![1]], [`r${k}`, parts[k]![2]], [`n${k}`, Number(parts[k]![3])]])),
    true,
  );
  return ks.filter((k) => ['MERGED', 'CLOSED'].includes(d?.[`p${k}`]?.pullRequest?.state)).map((k) => prs[k]);
}

// Review queue: GitHub drops a PR from review-requested:@me once you review it, so reviewed-by:@me covers the rest.
// Plus my own PRs and the ones assigned to me.
const QUEUE = `query{viewer{login}
  requested:search(query:"is:open is:pr archived:false review-requested:@me",type:ISSUE,first:100){nodes{...F}}
  reviewed:search(query:"is:open is:pr archived:false reviewed-by:@me -author:@me",type:ISSUE,first:100){nodes{...F}}
  authored:search(query:"is:open is:pr archived:false author:@me",type:ISSUE,first:100){nodes{...F}}
  assigned:search(query:"is:open is:pr archived:false assignee:@me",type:ISSUE,first:100){nodes{...F}}
  mentioned:search(query:"is:open is:pr archived:false mentions:@me -author:@me",type:ISSUE,first:50){nodes{...F}}}
fragment F on PullRequest{id number title updatedAt isDraft reviewDecision mergeStateStatus autoMergeRequest{enabledAt} viewerCanEnableAutoMerge mergeQueueEntry{position state} author{__typename login} assignees(first:1){nodes{login}}
  additions deletions changedFiles commits(last:1){nodes{commit{committedDate statusCheckRollup{state}}}} recent:commits(last:20){nodes{commit{authoredDate parents{totalCount}}}} repository{nameWithOwner}
  headRefName headRefOid baseRefName headRepository{nameWithOwner} createdAt
  reviewRequests(first:20){nodes{requestedReviewer{... on User{login}}}}
  timelineItems(last:1,itemTypes:[REVIEW_REQUESTED_EVENT,READY_FOR_REVIEW_EVENT]){nodes{... on ReviewRequestedEvent{createdAt} ... on ReadyForReviewEvent{createdAt}}}
  latestReviews(first:100){nodes{state author{__typename login}}} latestOpinionatedReviews(first:100){nodes{state submittedAt author{login}}}}`;

// Viewing a GitLab account (the avatar's menu): its MRs instead.
export async function getReviewQueue(): Promise<QueueItem[]> {
  if (viewAs()) return (await lab.getLabQueue(viewAs())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const d = await graphql(QUEUE, {});
  const me = d.viewer.login;
  const ids = (k: string) => new Set<string>(d[k].nodes.map((p: any) => p.id));
  const [requested, reviewed, authored, assigned, mentioned] = ['requested', 'reviewed', 'authored', 'assigned', 'mentioned'].map(ids);
  const all = new Map<string, any>(['mentioned', 'authored', 'assigned', 'reviewed', 'requested'].flatMap((k) => d[k].nodes.map((p: any) => [p.id, p])));
  return [...all.values()]
    .map((p): QueueItem => ({
      ...toItem(p),
      requested: requested.has(p.id),
      // A comment-only review (a reply, say) after an approval doesn't undo it on GitHub, so my approval or change
      // request wins over a later plain comment.
      myState:
        p.latestOpinionatedReviews.nodes.find((r: any) => r.author?.login === me)?.state ??
        p.latestReviews.nodes.find((r: any) => r.author?.login === me && r.state !== 'PENDING')?.state ??
        null,
      // I approved, then new work landed: worth a second look before it merges. Written after (a rebase only re-dates
      // its commits' committer date), and not a merge of the base in.
      newSinceApproval: ((r) =>
        r?.state === 'APPROVED' ? p.recent.nodes.filter(({ commit: c }: any) => c.parents.totalCount === 1 && c.authoredDate > r.submittedAt).length : 0)(
        p.latestOpinionatedReviews.nodes.find((r: any) => r.author?.login === me),
      ),
      // An assigned PR that's waiting on my review belongs in the review queue, not twice.
      reviewedBefore: reviewed.has(p.id),
      reviewing: !authored.has(p.id) && (requested.has(p.id) || reviewed.has(p.id)),
      mine: authored.has(p.id) || (assigned.has(p.id) && !requested.has(p.id) && !reviewed.has(p.id)),
      assigned: assigned.has(p.id),
      authored: authored.has(p.id),
      mentioned: mentioned.has(p.id),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// The PR fields every list shows (fragment F); the my-relation flags default to "none".
// CODEOWNERS, as GitHub reads it: gitignore-style patterns, the last line that matches a path decides its owners.
export function codeOwners(text: string, path: string): string[] {
  let owners: string[] = [];
  for (const line of text.split('\n')) {
    const [pattern, ...who] = line.replace(/#.*/, '').trim().split(/\s+/);
    if (pattern && ownsPath(pattern, path)) owners = who;
  }
  return owners;
}
function ownsPath(pattern: string, path: string) {
  const dir = pattern.endsWith('/');
  const p = pattern.replace(/^\//, '').replace(/\/$/, '');
  const anchored = pattern.startsWith('/') || p.includes('/'); // a slash before the end ties it to the repo's root
  const glob = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*');
  const end = dir ? '/' : '(?:/|$)'; // a folder: everything in it; else the file, or a folder of that name
  return new RegExp((anchored ? '^' : '(?:^|/)') + (p === '*' ? '[^/]+' : glob) + end).test(path);
}

const toItem = (p: any): QueueItem => ({
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
      face: (p.author?.__typename === 'Bot' && p.assignees?.nodes[0]?.login) || (p.author?.login ?? 'ghost'),
      reviewDecision: p.reviewDecision,
      mergeState: p.mergeStateStatus,
      ci: p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
      lastCommitAt: p.commits.nodes[0]?.commit.committedDate ?? '',
      headSha: p.headRefOid,
      additions: p.additions,
      deletions: p.deletions,
      files: p.changedFiles,
      autoMerge: !!p.autoMergeRequest,
      canAutoMerge: !!p.viewerCanEnableAutoMerge,
      queue: p.mergeQueueEntry ?? null,
      waitingSince: [p.createdAt, p.timelineItems?.nodes[0]?.createdAt].filter(Boolean).sort().at(-1),
      pendingReviewers: (p.reviewRequests?.nodes ?? []).map((r: any) => r.requestedReviewer?.login).filter(Boolean),
      changesBy: (p.latestOpinionatedReviews?.nodes ?? [])
        .filter((r: any) => r.state === 'CHANGES_REQUESTED' && r.author && !p.reviewRequests?.nodes.some((q: any) => q.requestedReviewer?.login === r.author.login))
        .map((r: any) => r.author.login),
      noReviewers: !p.reviewRequests?.nodes.length && !p.latestReviews.nodes.some((r: any) => r.author?.__typename === 'User' && r.author.login !== p.author?.login),
      requested: false,
      myState: null,
      newSinceApproval: 0,
      reviewedBefore: false,
      reviewing: false,
      mine: false,
      assigned: false,
      authored: false,
});

// Teams in my organizations, as "org/slug", for the Team tab.
// While a GitLab account is on show, its groups.
export async function getTeams(): Promise<string[]> {
  if (viewAs()) return lab.getLabTeams(viewAs());
  const d = await graphql(`{viewer{organizations(first:20){nodes{login teams(first:100){nodes{slug}}}}}}`, {});
  return d.viewer.organizations.nodes.flatMap((o: any) => o.teams.nodes.map((t: any) => `${o.login}/${t.slug}`));
}

// A team's members and their open PRs in the team's organization. Search ORs repeated author: filters; members go
// in chunks so each query stays under GitHub's search length limit.
export async function getTeamMembers(team: string): Promise<string[]> {
  if (isLab(team)) return lab.getLabTeamMembers(team);
  const [org, slug] = team.split('/');
  const t = (await graphql(`query($org:String!,$slug:String!){organization(login:$org){team(slug:$slug){members(first:100){nodes{login}}}}}`, { org, slug }))
    .organization?.team;
  if (!t) throw new Error(`No team ${team}, or you can't see it.`);
  return t.members.nodes.map((m: any) => m.login).sort((a: string, b: string) => a.localeCompare(b));
}

// Plus each member's review load: open PRs that ask them, by name, for a review.
// A team's open PRs by its members, and how many open PRs in the org ask each member, by name, for a review.
export async function getTeamPRs(team: string): Promise<{ members: string[]; items: QueueItem[]; load: Record<string, number> }> {
  if (isLab(team)) return lab.getLabTeamPRs(team);
  const org = team.split('/')[0];
  const members = await getTeamMembers(team);
  const chunks = Array.from({ length: Math.ceil(members.length / 8) }, (_, k) => members.slice(k * 8, k * 8 + 8));
  if (!chunks.length) return { members, items: [], load: {} };
  const vars = {
    ...Object.fromEntries(chunks.map((c, k) => [`q${k}`, `is:open is:pr archived:false org:${org} ${c.map((m) => 'author:' + m).join(' ')}`])),
    ...Object.fromEntries(members.map((m, k) => [`r${k}`, `is:open is:pr archived:false org:${org} user-review-requested:${m}`])),
  };
  const d = await graphql(
    `query(${Object.keys(vars).map((v) => `$${v}:String!`).join(',')}){${chunks.map((_, k) => `s${k}:search(query:$q${k},type:ISSUE,first:100){nodes{...F}}`).join(' ')}
    ${members.map((_, k) => `r${k}:search(query:$r${k},type:ISSUE,first:0){issueCount}`).join(' ')}}
    ${QUEUE.slice(QUEUE.indexOf('fragment F'))}`,
    vars,
  );
  const items = chunks.flatMap((_, k) => d[`s${k}`].nodes.map(toItem)) as QueueItem[];
  const load = Object.fromEntries(members.map((m, k) => [m, d[`r${k}`].issueCount as number]));
  return { members, items: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), load };
}
// Drafts in these repos changing files I own (CODEOWNERS, by name or through a team), for the review list while drafts
// show: GitHub asks code owners only once a PR is ready. Each repo's CODEOWNERS and my teams are kept a day.
const dayCache = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
  try {
    const c = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (c && Date.now() - c.at < 86_400_000) return c.v;
  } catch {}
  const v = await load();
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), v }));
  } catch {}
  return v;
};
export async function getOwnedDrafts(repos: string[], skip: Set<string>): Promise<QueueItem[]> {
  const labRepos = repos.filter((r) => isLab(r));
  repos = repos.filter((r) => !isLab(r));
  if (labRepos.length) return [...(await lab.getLabOwnedDrafts(labRepos, skip, codeOwners)), ...(repos.length ? await getOwnedDrafts(repos, skip) : [])];
  if (!repos.length) return [];
  const me = await getGitHubViewer();
  const teams = await dayCache('myTeams', async () =>
    ((await graphql(`query($me:[String!]){viewer{organizations(first:20){nodes{login teams(first:100,userLogins:$me){nodes{slug}}}}}}`, { me: [me] })).viewer.organizations.nodes as any[]).flatMap(
      (o) => o.teams.nodes.map((t: any) => `@${o.login}/${t.slug}`.toLowerCase()),
    ),
  );
  const mine = new Set([`@${me}`.toLowerCase(), ...teams]);
  const owners = new Map<string, string>();
  for (const repo of repos) {
    const text = await dayCache(`codeowners:${repo}`, async () => {
      for (const at of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
        const r = await gh(`/repos/${repo}/contents/${at}`, {}, 'application/vnd.github.raw+json');
        if (r.ok) return r.text();
      }
      return '';
    });
    if (text.split(/\s+/).some((w) => mine.has(w.toLowerCase()))) owners.set(repo, text);
  }
  if (!owners.size) return [];
  const d = await graphql(
    `query($q:String!){s:search(query:$q,type:ISSUE,first:50){nodes{...F ...on PullRequest{files(first:100){nodes{path}}}}}} ${QUEUE.slice(QUEUE.indexOf('fragment F'))}`,
    { q: `is:open is:pr is:draft archived:false -author:@me ${[...owners.keys()].map((r) => 'repo:' + r).join(' ')}` },
  );
  return (d.s.nodes as any[])
    .filter((p) => !skip.has(p.id) && p.files.nodes.some((f: any) => codeOwners(owners.get(p.repository.nameWithOwner)!, f.path).some((o) => mine.has(o.toLowerCase()))))
    .map((p) => ({ ...toItem(p), requested: true, reviewing: true, codeOwner: true, myState: null, newSinceApproval: 0, reviewedBefore: false, mine: false, assigned: false, authored: false, mentioned: false }));
}

// My reviews of the last `days` days, newest first: each PR's verdict, when, and how long it had waited for me (from the
// last time I was asked, if I was). Comments posted one by one within 10 minutes count as one review, its strongest
// verdict kept.
export type MyReview = { repo: string; number: number; title: string; url: string; author: string; state: ReviewState; at: string; waited?: number };
export async function getMyReviews(days = 30): Promise<MyReview[]> {
  if (viewAs()) return (await lab.getLabMyReviews(days, viewAs())).sort((a, b) => b.at.localeCompare(a.at));
  const me = await getGitHubViewer();
  return reviewsBy(me, `reviewed-by:@me -author:@me`, days);
}
// Someone's reviews of the last `days` days, newest first: the PRs they reviewed (not their own), up to 300, a page of
// 100 at a time; each PR's reviews collapsed (collapseReviews).
async function reviewsBy(login: string, query: string, days: number): Promise<MyReview[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const nodes: any[] = [];
  let after: string | null = null;
  for (let page = 0; page < 3; page++) {
    const d: any = await graphql(
      `query($q:String!,$login:String!,$after:String){s:search(query:$q,type:ISSUE,first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{...on PullRequest{number title url repository{nameWithOwner} author{login}
        reviews(author:$login,last:30){nodes{state submittedAt}}
        timelineItems(itemTypes:[REVIEW_REQUESTED_EVENT],last:20){nodes{...on ReviewRequestedEvent{createdAt requestedReviewer{...on User{login}}}}}}}}}`,
      { q: `is:pr ${query} updated:>=${since.slice(0, 10)}`, login, after },
    );
    nodes.push(...d.s.nodes);
    if (!d.s.pageInfo.hasNextPage) break;
    after = d.s.pageInfo.endCursor;
  }
  return nodes
    .filter((p) => p?.reviews)
    .flatMap((p) =>
      collapseReviews(p.reviews.nodes, (p.timelineItems.nodes as any[]).filter((e) => e.requestedReviewer?.login === login).map((e) => e.createdAt), since).map((r) => ({
        repo: p.repository.nameWithOwner, number: p.number, title: p.title, url: p.url, author: p.author?.login ?? 'ghost', ...r,
      })),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
}
// Someone at a glance (the person page): who they are, their open PRs, the open PRs waiting on their review (longest
// first), and their reviews of the last 30 days. In the given orgs (the ones in my list).
export type Person = { login: string; name: string | null; avatar: string; bio: string | null; mine: QueueItem[]; asked: QueueItem[]; reviews: (MyReview & {})[] };
export async function getPerson(login: string, orgs: string[], days = 30): Promise<Person> {
  if (login.includes('@')) return lab.getLabPerson(login, days); // a GitLab person (personKey)
  const where = orgs.map((o) => 'org:' + o).join(' ');
  const [d, reviews] = await Promise.all([
    graphql(
      `query($login:String!,$mine:String!,$asked:String!){u:user(login:$login){login name avatarUrl(size:96) bio}
        mine:search(query:$mine,type:ISSUE,first:30){nodes{...F}}
        asked:search(query:$asked,type:ISSUE,first:30){nodes{...F}}}
      ${QUEUE.slice(QUEUE.indexOf('fragment F'))}`,
      {
        login,
        mine: `is:open is:pr archived:false author:${login} ${where}`,
        asked: `is:open is:pr archived:false user-review-requested:${login} ${where}`,
      },
    ),
    reviewsBy(login, `reviewed-by:${login} -author:${login} ${where}`, days),
  ]);
  return {
    login: d.u?.login ?? login,
    name: d.u?.name ?? null,
    avatar: d.u?.avatarUrl ?? `https://github.com/${encodeURIComponent(login)}.png?size=96`,
    bio: d.u?.bio ?? null,
    mine: (d.mine.nodes as any[]).map(toItem),
    asked: (d.asked.nodes as any[]).map(toItem).sort((a, b) => a.waitingSince.localeCompare(b.waitingSince)),
    reviews,
  };
}

// One PR's reviews of mine since `since` as the reviews I meant: ones within 10 minutes of the last count as it (its
// strongest verdict kept), and each says how long it came after I was last asked (`asks`, oldest first).
export function collapseReviews(reviews: { state: string; submittedAt: string | null }[], asks: string[], since: string) {
  const rank: Record<string, number> = { COMMENTED: 0, DISMISSED: 0, APPROVED: 1, CHANGES_REQUESTED: 2 };
  const out: { state: ReviewState; at: string; waited?: number }[] = [];
  for (const r of reviews) {
    if (!r.submittedAt || r.state === 'PENDING' || r.submittedAt < since) continue;
    const last = out.at(-1);
    if (last && Date.parse(r.submittedAt) - Date.parse(last.at) < 10 * 60_000) {
      if (rank[r.state] > rank[last.state]) last.state = r.state as ReviewState;
      last.at = r.submittedAt;
      continue;
    }
    const asked = asks.filter((a) => a <= r.submittedAt!).at(-1);
    out.push({ state: r.state as ReviewState, at: r.submittedAt, waited: asked ? Date.parse(r.submittedAt) - Date.parse(asked) : undefined });
  }
  return out;
}

// The open PRs in an org asking someone, by name, for a review (up to 50), the longest-waiting first.
export async function getAskedPRs(org: string, login: string): Promise<QueueItem[]> {
  if (org.includes('.')) return lab.getLabAskedPRs(org, login); // a GitLab host
  const d = await graphql(
    `query($q:String!){s:search(query:$q,type:ISSUE,first:50){nodes{...F}}} ${QUEUE.slice(QUEUE.indexOf('fragment F'))}`,
    { q: `is:open is:pr archived:false org:${org} user-review-requested:${login}` },
  );
  return (d.s.nodes.map(toItem) as QueueItem[]).sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
}

// A person's verdicts (approved, changes requested) that a later one of theirs replaced, by the latest one's id: the
// conversation folds them under it, and the index lists only the latest.
export function earlierVerdicts(items: Pick<ConversationItem, 'id' | 'author' | 'state' | 'at' | 'bot'>[]): Map<string, string[]> {
  const verdicts = items.filter((c) => !c.bot && (c.state === 'APPROVED' || c.state === 'CHANGES_REQUESTED')).sort((a, b) => a.at.localeCompare(b.at));
  const latest = new Map(verdicts.map((c) => [c.author, c.id]));
  const out = new Map<string, string[]>();
  for (const c of verdicts) if (latest.get(c.author) !== c.id) out.set(latest.get(c.author)!, [...(out.get(latest.get(c.author)!) ?? []), c.id]);
  return out;
}

// Top-level PR comments plus submitted reviews that carry a verdict or a summary.
export async function getConversation(repo: string, n: number): Promise<ConversationItem[]> {
  if (isLab(repo)) return lab.getLabConversation(repo, n);
  const [comments, reviews] = await Promise.all([
    paginate<any>(`/repos/${repo}/issues/${n}/comments?per_page=100`, FULL),
    paginate<any>(`/repos/${repo}/pulls/${n}/reviews?per_page=100`, FULL),
  ]);
  return [
    ...comments.map((c) => ({ id: 'c' + c.id, author: c.user?.login ?? 'ghost', avatar: c.user?.avatar_url, html: c.body_html ?? '', at: c.created_at, url: c.html_url, bot: c.user?.type === 'Bot' || (agentsAsBots() && agentSays(c.body)) })),
    ...reviews
      .filter((r) => r.state !== 'PENDING' && (r.body || r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED'))
      .map((r) => ({ id: 'r' + r.id, author: r.user?.login ?? 'ghost', avatar: r.user?.avatar_url, html: r.body_html ?? '', at: r.submitted_at, url: r.html_url, state: r.state, bot: r.user?.type === 'Bot', commit: r.commit_id })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

// People to ask for a review of my PR, least busy first: whoever reviewed this repo's recent PRs (they know the code),
// else the PR list's team. Busy: open PRs in the org that already ask them, by name, for a review.
export type ReviewerPick = { login: string; load: number; why: string; knows?: number }; // knows: share of the changed code they wrote
// Who wrote the code a PR changes (expertise.ts): git blame at the base commit for its 5 most-changed files, one query.
export async function whoWrote(repo: string, base: string, files: { filename: string; status: string; patch?: string; additions: number; deletions: number }[]): Promise<Knows[]> {
  const [owner, name] = repo.split('/');
  const pick = files
    .filter((f) => f.status === 'modified' && f.patch && !/(^|\/)(lint-baseline[^/]*\.xml|[\w.-]+\.lock|package-lock\.json|pnpm-lock\.yaml)$|(^|\/)(generated|build)\//.test(f.filename)) // tests count: their authors know the code too
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    .slice(0, 5)
    .map((f) => ({ path: f.filename, lines: touchedLines(f.patch!) }))
    .filter((f) => f.lines.length);
  if (!pick.length) return [];
  if (isLab(repo)) {
    const ranges = await lab.labBlame(repo, base, pick);
    return whoKnows(pick.map((f, k) => ({ path: f.path, lines: f.lines.length, by: tally(ranges[k], f.lines) })));
  }
  const vars = Object.fromEntries([['owner', owner], ['name', name], ['exp', base], ...pick.map((f, k) => [`p${k}`, f.path])]);
  const d = await graphql(
    `query($owner:String!,$name:String!,$exp:String!,${pick.map((_, k) => `$p${k}:String!`).join(',')}){repository(owner:$owner,name:$name){object(expression:$exp){...on Commit{${pick
      .map((_, k) => `f${k}:blame(path:$p${k}){ranges{startingLine endingLine commit{author{user{login}}}}}`)
      .join(' ')}}}}}`,
    vars,
    true,
  );
  const c = d?.repository?.object ?? {};
  return whoKnows(
    pick.map((f, k) => ({
      path: f.path,
      lines: f.lines.length,
      by: tally((c[`f${k}`]?.ranges ?? []).map((r: any) => ({ startingLine: r.startingLine, endingLine: r.endingLine, login: r.commit?.author?.user?.login ?? null })), f.lines),
    })),
  );
}

export async function suggestReviewers(repo: string, skip: Set<string>, team: string, knows: Knows[] = []): Promise<ReviewerPick[]> {
  const [owner, name] = repo.split('/');
  const count = isLab(repo) ? await lab.labRecentReviewers(repo) : new Map<string, number>();
  if (!isLab(repo)) {
    const d = await graphql(
      `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(last:40,states:[OPEN,MERGED]){nodes{reviews(first:30){nodes{author{__typename login}}}}}}}`,
      { owner, name },
    );
    for (const p of d.repository.pullRequests.nodes)
      for (const login of new Set<string>(p.reviews.nodes.filter((r: any) => r.author?.__typename === 'User').map((r: any) => r.author.login)))
        count.set(login, (count.get(login) ?? 0) + 1);
  }
  const fit = (p: { login: string }) => !skip.has(p.login) && !p.login.endsWith('[bot]');
  let people: { login: string; why: string; knows?: number }[] = [...count].sort((a, b) => b[1] - a[1]).map(([login, k]) => ({ login, why: `reviewed ${k} of the last 40 PRs here` })).filter(fit);
  if (!people.length && team && isLab(team) === isLab(repo)) people = (await getTeamMembers(team)).map((login) => ({ login, why: `in ${isLab(team) ? team.slice(team.lastIndexOf('/') + 1) : team.split('/')[1]}` })).filter(fit);
  // Whoever wrote a real share (10%+) of the code being changed: named for it, and in the list even if they don't review here.
  for (const k of knows.filter((k) => k.share >= 0.1 && fit(k))) {
    const said = `wrote ${Math.round(k.share * 100)}% of the code this PR changes, most in ${k.file.split('/').pop()}`;
    const p = people.find((p) => p.login === k.login);
    if (p) (p.knows = k.share), (p.why = `${said}; ${p.why}`);
    else people.push({ login: k.login, why: said, knows: k.share });
  }
  people = people.sort((a, b) => (b.knows ?? 0) - (a.knows ?? 0)).slice(0, 30);
  if (!people.length) return [];
  const labLoad = isLab(repo) ? await lab.labReviewLoad(repo, people.map((p) => p.login)) : null;
  const vars = Object.fromEntries(people.map((p, k) => [`r${k}`, `is:open is:pr archived:false org:${owner} user-review-requested:${p.login}`]));
  const l = labLoad
    ? Object.fromEntries(people.map((p, k) => [`r${k}`, { issueCount: labLoad.get(p.login) ?? 0 }]))
    : await graphql(`query(${people.map((_, k) => `$r${k}:String!`).join(',')}){${people.map((_, k) => `r${k}:search(query:$r${k},type:ISSUE,first:0){issueCount}`).join(' ')}}`, vars);
  // Who knows the code first, then the least busy; someone who wrote little of it counts as not knowing it.
  return people
    .map((p, k) => ({ ...p, load: l[`r${k}`].issueCount as number }))
    .sort((a, b) => +((b.knows ?? 0) >= 0.1) - +((a.knows ?? 0) >= 0.1) || a.load - b.load || a.login.localeCompare(b.login));
}

export const requestReview = (repo: string, n: number, login: string) =>
  isLab(repo) ? lab.setLabReviewer(repo, n, login, true) : json(`/repos/${repo}/pulls/${n}/requested_reviewers`, { method: 'POST', body: JSON.stringify({ reviewers: [login] }) });
export const unrequestReview = (repo: string, n: number, login: string) =>
  isLab(repo) ? lab.setLabReviewer(repo, n, login, false) : json(`/repos/${repo}/pulls/${n}/requested_reviewers`, { method: 'DELETE', body: JSON.stringify({ reviewers: [login] }) });

let viewer: Promise<string> | undefined;
// Me: on a repo's site (GitHub, or the GitLab it's on); without one, as the account on show (the avatar's menu).
export const getGitHubViewer = () => (viewer ??= json('/user').then((u) => u.login as string));
export const getViewer = (repo?: string): Promise<string> =>
  repo ? (isLab(repo) ? lab.getLabViewer(repo) : getGitHubViewer()) : viewAs() ? lab.labMe(viewAs()).then((u) => u.login) : getGitHubViewer();

// Emails to find someone on Slack: their verified company addresses for the org, then their public email.
export async function getEmails(org: string, logins: string[]): Promise<Record<string, string[]>> {
  const people = await getPeople(org, logins);
  return Object.fromEntries(logins.map((l) => [l, people[l].emails]));
}

// Someone's emails to reach on Slack, by Slack-people key (personKey): a GitHub login's from GitHub, a GitLab
// person's (login@host) from that GitLab, never one looked up on the other site.
export async function slackRecipients(repo: string, logins: string[]): Promise<{ login: string; emails: string[] }[]> {
  const keys = logins.map((l) => personKey(repo, l));
  const people = await getPeople(repo.split('/')[0], keys);
  return keys.map((login) => ({ login, emails: people[login]?.emails ?? [] }));
}

let noEmailScope = false;
// GitHub name and emails per login (verified company emails first), to find people on Slack. A GitLab person's key
// (login@host) is asked of that GitLab: their name and public email.
export async function getPeople(org: string, logins: string[]): Promise<Record<string, { name: string | null; emails: string[] }>> {
  const labKeys = logins.filter((l) => l.includes('@'));
  if (labKeys.length) {
    const [hub, labs] = await Promise.all([getPeople(org, logins.filter((l) => !l.includes('@'))), lab.labPeople(labKeys)]);
    return { ...hub, ...labs };
  }
  if (!logins.length) return {};
  const query = async (ls: string[], withOrg: boolean): Promise<any[]> => {
    const vars = Object.fromEntries(ls.map((l, i) => [`l${i}`, l]));
    const fields = ls.map((_, i) => `u${i}:user(login:$l${i}){name${noEmailScope ? '' : ' email'}${withOrg ? ' organizationVerifiedDomainEmails(login:$org)' : ''}}`).join(' ');
    const decl = [...ls.map((_, i) => `$l${i}:String!`), ...(withOrg ? ['$org:String!'] : [])].join(',');
    try {
      const d = await graphql(`query(${decl}){${fields}}`, withOrg ? { ...vars, org } : vars, true);
      return ls.map((_, i) => d[`u${i}`] ?? null);
    } catch (e) {
      // A public email needs the read:user or user:email scope, which gh's own login doesn't ask for: without it, the
      // org's verified emails and names still find people.
      if (noEmailScope || !/'email' field requires/.test(String(e))) throw e;
      noEmailScope = true;
      return query(ls, withOrg);
    }
  };
  // Apps and bots aren't users (null). The org's verified emails need org membership: whoever came back empty is
  // asked again for public details only.
  const first = await query(logins, true);
  const missing = logins.filter((_, i) => !first[i]);
  const second = missing.length ? await query(missing, false) : [];
  const user = (l: string, i: number) => first[i] ?? second[missing.indexOf(l)] ?? null;
  return Object.fromEntries(
    logins.map((l, i) => {
      const u = user(l, i);
      return [l, { name: u?.name ?? null, emails: [...(u?.organizationVerifiedDomainEmails ?? []), u?.email].filter(Boolean) }];
    }),
  );
}

// The PR-wide review verdict and merge state, which only GraphQL has.
export async function getStatus(repo: string, n: number): Promise<{ reviewDecision: QueueItem['reviewDecision']; mergeStateStatus: QueueItem['mergeState'] }> {
  if (isLab(repo)) return lab.getLabStatus(repo, n);
  const [owner, name] = repo.split('/');
  return (await graphql(`query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviewDecision mergeStateStatus}}}`, { owner, name, n }))
    .repository.pullRequest;
}

// Points in a PR's history to show changes after: each of its commits, and each force-push (from what was there
// before it), newest first.
export type PushPoint = { sha: string; label: string; at: string; force?: boolean };
export async function getPushPoints(repo: string, n: number): Promise<PushPoint[]> {
  if (isLab(repo)) return lab.getLabPushPoints(repo, n);
  const [owner, name] = repo.split('/');
  const d = await graphql(
    `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){
      timelineItems(last:100,itemTypes:[PULL_REQUEST_COMMIT,HEAD_REF_FORCE_PUSHED_EVENT]){nodes{__typename
        ... on PullRequestCommit{commit{oid messageHeadline committedDate}}
        ... on HeadRefForcePushedEvent{createdAt beforeCommit{oid}}}}}}}`,
    { owner, name, n },
  );
  return d.repository.pullRequest.timelineItems.nodes
    .map((x: any): PushPoint | null =>
      x.commit ? { sha: x.commit.oid, label: x.commit.messageHeadline, at: x.commit.committedDate }
      : x.beforeCommit ? { sha: x.beforeCommit.oid, label: 'Before the force-push', at: x.createdAt, force: true }
      : null,
    )
    .filter((x: PushPoint | null): x is PushPoint => !!x)
    .reverse();
}

// Where a repo's build files sit at a commit, from its file list (one request, kept per commit): the folders that are
// modules (Gradle, npm/TypeScript, Go, Rust, Python). Not ones under src/, node_modules or fixtures. Null if GitHub cuts
// the list short (a huge repo).
const BUILD_FILE = /(^|\/)(build\.gradle(\.kts)?|package\.json|go\.mod|Cargo\.toml|pyproject\.toml)$/;
const rootsSeen = new Map<string, Promise<BuildRoot[] | null>>();
export function getBuildRoots(repo: string, sha: string): Promise<BuildRoot[] | null> {
  const key = `${repo}@${sha}`;
  if (!rootsSeen.has(key))
    rootsSeen.set(
      key,
      (isLab(repo) ? lab.labTree(repo, sha).then((tree) => ({ truncated: !tree, tree: tree ?? [] })) : json(`/repos/${repo}/git/trees/${sha}?recursive=1`)).then((d: any) => {
        if (d.truncated) return null;
        const roots = new Map<string, boolean>();
        for (const e of d.tree as { path: string; type: string }[]) {
          if (e.type !== 'blob' || !BUILD_FILE.test(e.path) || /(^|\/)(src|node_modules|fixtures)\//.test(e.path)) continue;
          const dir = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '.';
          roots.set(dir, (roots.get(dir) ?? false) || /build\.gradle/.test(e.path));
        }
        return [...roots].map(([dir, gradle]) => ({ dir, gradle }));
      }),
    );
  return rootsSeen.get(key)!;
}

// The PR's head commit now, cheaply: to notice a push while it's open.
export const getHead = async (repo: string, n: number): Promise<string> => {
  if (isLab(repo)) return lab.getLabHead(repo, n);
  const [owner, name] = repo.split('/');
  return (await graphql(`query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){headRefOid}}}`, { owner, name, n })).repository.pullRequest.headRefOid;
};
// My PR's title and description, rewritten.
export const updatePR = (repo: string, n: number, f: { title: string; body: string }) =>
  isLab(repo) ? lab.updateLab(repo, n, f) : json(`/repos/${repo}/pulls/${n}`, { method: 'PATCH', body: JSON.stringify(f) });
export const getPR = (repo: string, n: number): Promise<PR> => isLab(repo) ? lab.getLabPR(repo, n) : json(`/repos/${repo}/pulls/${n}`, undefined, FULL);

export const getFiles = (repo: string, n: number) => isLab(repo) ? lab.getLabFiles(repo, n) : paginate<PRFile>(`/repos/${repo}/pulls/${n}/files?per_page=100`);

// Everything a PR page shows first, as one bundle (also cached, and loaded ahead for the list's top PRs).
export type LoadedPR = { pr: PR; files: PRFile[]; threads: Thread[]; conversation: ConversationItem[]; attrs: string | null; pending?: PendingReview | null; paused?: string }; // paused: why the threads are missing
// Everything asked at once; only .gitattributes (at the head commit) waits for the PR. `onPR`: the PR as soon as it's
// here, for what can start or show before the rest (the page's header, its stack).
export async function loadPR(repo: string, n: number, onPR?: (pr: PR) => void): Promise<LoadedPR> {
  const prP = getPR(repo, n);
  const attrsP = prP.then((pr) => {
    try {
      onPR?.(pr);
    } catch {}
    return getRaw(pr.head.repo?.full_name ?? repo, '.gitattributes', pr.head.sha);
  });
  // The review threads and a pending review come from GraphQL, the rest from REST: with GraphQL's limit used up, the PR
  // still opens, without them.
  let paused: string | undefined;
  const gq = <T,>(p: Promise<T>, none: T) => p.catch((e) => (isLimited('graphql') ? ((paused = e.message), none) : Promise.reject(e)));
  const [pr, files, threads, conversation, attrs, pending] = await Promise.all([prP, getFiles(repo, n), gq(getThreads(repo, n), []), getConversation(repo, n), attrsP, gq(getPendingReview(repo, n), null)]);
  return { pr, files, threads, conversation, attrs, pending, paused };
}

// A review I started on github.com and haven't sent (GitHub shows each person only their own): Finish review sends it,
// with lgtm's drafts added; meanwhile nothing can post on its own (one review at a time, GitHub's rule).
export type PendingReview = { id: string; count: number };
export async function getPendingReview(repo: string, n: number): Promise<PendingReview | null> {
  if (isLab(repo)) return lab.getLabPending(repo, n);
  const [owner, name] = repo.split('/');
  const d = await graphql(
    `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviews(states:PENDING,first:1){nodes{id comments{totalCount}}}}}}`,
    { owner, name, n },
  );
  const r = d.repository.pullRequest.reviews.nodes[0];
  return r ? { id: r.id, count: r.comments.totalCount } : null;
}
// A comment in my pending review, changed or taken out (GitHub allows both until the review is sent).
export const editReviewComment = (id: string, body: string) =>
  isLabId(id) ? lab.editLabNote(id, body) : graphql(`mutation($id:ID!,$b:String!){updatePullRequestReviewComment(input:{pullRequestReviewCommentId:$id,body:$b}){clientMutationId}}`, { id, b: body });
export const deleteReviewComment = (id: string) =>
  isLabId(id) ? lab.deleteLabNote(id) : graphql(`mutation($id:ID!){deletePullRequestReviewComment(input:{id:$id}){clientMutationId}}`, { id });
export const discardReview = (id: string) =>
  isLabId(id) ? lab.discardLabReview(id) : graphql(`mutation($r:ID!){deletePullRequestReview(input:{pullRequestReviewId:$r}){clientMutationId}}`, { r: id });

// A folder's entries in a repo (its default branch, or at `ref`).
export const listDir = (repo: string, path: string, ref?: string): Promise<{ name: string; path: string; type: string }[]> =>
  isLab(repo) ? lab.listLabDir(repo, path, ref) : json(`/repos/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`);

// A file's size at a commit. A file in Git LFS is, in Git, a small pointer naming its real size: that size, lfs set.
export async function getBlobInfo(repo: string, path: string, ref: string): Promise<{ size: number; lfs: boolean } | null> {
  if (isLab(repo)) return lab.getLabBlobInfo(repo, path, ref);
  const res = await gh(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`);
  if (res.status === 404) return null;
  const j = (await (await ok(res)).json()) as { size: number; encoding?: string; content?: string };
  const text = j.size < 400 && j.encoding === 'base64' ? atob((j.content ?? '').replace(/\n/g, '')) : '';
  const lfs = text.startsWith('version https://git-lfs');
  return { size: lfs ? Number(text.match(/\nsize (\d+)/)?.[1] ?? j.size) : j.size, lfs };
}

export async function getRaw(repo: string, path: string, ref: string): Promise<string | null> {
  if (isLab(repo)) return lab.getLabRaw(repo, path, ref);
  const res = await gh(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`, {}, 'application/vnd.github.raw');
  if (res.status === 404) return null;
  return (await ok(res)).text();
}

// A reviewer's suggested change: the ```suggestion block in a comment, to replace lines start..end of the head file.
export type Suggestion = { id: number; thread: string; path: string; start: number; end: number; text: string; author: Comment['author'] };
export function suggestionOf(t: Thread, c: Comment): Suggestion | null {
  const m = (c.body ?? '').replace(/\r\n/g, '\n').match(/^```suggestion(?::-(\d+)\+(\d+))?[^\n]*\n([\s\S]*?)^ *```/m);
  if (!m || !t.line || t.diffSide !== 'RIGHT') return null;
  // GitLab's ```suggestion:-a+b reaches a lines above the comment's line and b below.
  if (m[1]) return { id: c.databaseId, thread: t.id, path: t.path, start: t.line - Number(m[1]), end: t.line + Number(m[2]), text: m[3], author: c.author };
  return { id: c.databaseId, thread: t.id, path: t.path, start: t.startLine ?? t.line, end: t.line, text: m[3], author: c.author };
}

// A file with suggestions applied, bottom up so earlier line numbers hold; its line endings kept. An empty block
// deletes the lines.
export function applySuggestions(src: string, list: Pick<Suggestion, 'path' | 'start' | 'end' | 'text'>[]): string {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const sorted = [...list].sort((a, b) => b.start - a.start);
  sorted.forEach((x, k) => {
    if (k && x.end >= sorted[k - 1].start) throw new Error(`Two suggestions on ${x.path} overlap; commit them one at a time`);
    lines.splice(x.start - 1, x.end - x.start + 1, ...(x.text ? x.text.replace(/\n$/, '').split('\n') : []));
  });
  return lines.join(eol);
}

// Suggestions committed to the PR's branch as one commit, like GitHub's "Commit suggestions": each file read at the
// head, its suggestions applied bottom up, the authors credited. Refused if the branch moved (expectedHeadOid).
export async function commitSuggestions(headRepo: string, branch: string, head: string, list: Suggestion[], me: string) {
  const files = [];
  for (const path of new Set(list.map((x) => x.path))) {
    const src = await getRaw(headRepo, path, head);
    if (src == null) throw new Error(`${path} isn't on the branch`);
    files.push({ path, content: applySuggestions(src, list.filter((x) => x.path === path)) });
  }
  const headline = list.length > 1 ? 'Apply suggestions from code review' : 'Apply suggestion from code review';
  if (isLab(headRepo)) return void (await lab.commitLabSuggestions(headRepo, branch, head, files, headline, [...new Set(list.map((x) => x.author?.login).filter((l): l is string => !!l && l !== me))]));
  const additions = files.map(({ path, content }) => ({ path, contents: btoa(Array.from(new TextEncoder().encode(content), (b) => String.fromCharCode(b)).join('')) }));
  const credit = new Map(list.filter((x) => x.author && x.author.login !== me && x.author.databaseId).map((x) => [x.author!.login, x.author!.databaseId]));
  await graphql(
    `mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}`,
    {
      input: {
        branch: { repositoryNameWithOwner: headRepo, branchName: branch },
        expectedHeadOid: head,
        fileChanges: { additions },
        message: {
          headline,
          body: [...credit].map(([login, id]) => `Co-authored-by: ${login} <${id}+${login}@users.noreply.github.com>`).join('\n'),
        },
      },
    },
  );
}

// A short-lived, signed link to a file at a commit, for <img>: unlike the raw bytes it resolves Git LFS files to the
// stored image rather than the LFS pointer. Null if the file isn't there.
export async function getDownloadUrl(repo: string, path: string, ref: string): Promise<string | null> {
  if (isLab(repo)) return lab.getLabDownloadUrl(repo, path, ref);
  // no-store: the same URL fetched raw (getRaw) may sit in the browser cache, and that cached body isn't JSON.
  const res = await gh(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  return (await (await ok(res)).json()).download_url ?? null;
}

// Images a description or comment shows from a repo (github.com/<repo>/blob/<ref>/<path>?raw=true, or …/raw/…): from a
// private repo they only load signed in to github.com in the same browser, which lgtm isn't (it has the gh token), so
// each is swapped for the API's signed link to that file. Once per image a session.
const signedImages = new Map<string, Promise<string | null>>();
const REPO_IMAGE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/([^?#]+)/;
// A branch may have slashes (vorflux/artifacts), so the address can't tell ref from path: shortest ref first, the
// next split when GitHub has no such file.
async function repoImageUrl(repo: string, rest: string): Promise<string | null> {
  const parts = rest.split('/').map(decodeURIComponent);
  for (let k = 1; k < Math.min(parts.length, 5); k++) {
    const url = await getDownloadUrl(repo, parts.slice(k).join('/'), parts.slice(0, k).join('/')).catch(() => null);
    if (url) return url;
  }
  return null;
}
// An <img src> or a <picture>'s <source srcset> (dark mode, narrow windows), which the browser picks over the img.
export function signRepoImages(root: ParentNode | null) {
  for (const el of root?.querySelectorAll<HTMLImageElement | HTMLSourceElement>('img[src^="https://github.com/"]:not([data-signed]), source[srcset^="https://github.com/"]:not([data-signed])') ?? []) {
    const attr = el instanceof HTMLSourceElement ? 'srcset' : 'src';
    const src = el.getAttribute(attr)!;
    const m = src.match(REPO_IMAGE);
    if (!m) continue;
    el.dataset.signed = '';
    let url = signedImages.get(src);
    if (!url) signedImages.set(src, (url = repoImageUrl(m[1], m[2])));
    void url.then((u) => u && el.setAttribute(attr, u));
  }
}

// Images a rendered markdown file shows by a path relative to it (images/flow.png, ../x.png, or /docs/x.png from the
// repo's root): the file at the PR's commit, by the API's signed link (the page's own address isn't the repo).
// A markdown file's image link as a path in the repo; null for a full address (https:, data:) or a #fragment.
export function repoPath(src: string, fileDir: string): string | null {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) return null;
  const path: string[] = [];
  for (const p of (src.startsWith('/') ? src.slice(1) : `${fileDir ? fileDir + '/' : ''}${src}`).split(/[?#]/)[0].split('/'))
    if (p === '..') path.pop();
    else if (p && p !== '.') path.push(decodeURIComponent(p));
  return path.join('/');
}
export function signRelativeImages(root: ParentNode | null, repo: string, ref: string, fileDir: string) {
  for (const img of root?.querySelectorAll<HTMLImageElement>('img[src]:not([data-signed]):not(.emoji)') ?? []) {
    const path = repoPath(img.getAttribute('src')!, fileDir);
    if (!path) continue;
    img.dataset.signed = '';
    const key = `${repo}@${ref}:${path}`;
    let url = signedImages.get(key);
    if (!url) signedImages.set(key, (url = getDownloadUrl(repo, path, ref).catch(() => null)));
    void url.then((u) => u && (img.src = u));
  }
}


const THREADS = `query($owner:String!,$name:String!,$n:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$n){
  reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}
    nodes{id path line startLine originalLine originalStartLine diffSide subjectType isResolved isOutdated viewerCanResolve viewerCanUnresolve hunk:comments(first:1){nodes{diffHunk}}
      comments(first:100){nodes{id databaseId url body bodyHTML bodyText createdAt state author{__typename login avatarUrl(size:40) ...on User{databaseId}} originalCommit{oid} pullRequestReview{databaseId}}}}}}}}`;

// A comment on the PR's conversation (not on a line), as my own: answers someone there.
export const commentOnPR = (repo: string, n: number, body: string) => isLab(repo) ? lab.commentOnLab(repo, n, body) : json(`/repos/${repo}/issues/${n}/comments`, { method: 'POST', body: JSON.stringify({ body }) });

// Per PR (by id), the latest conversation comment that @-mentions me, from someone (not a bot), unless I've commented
// or reviewed there since or marked it done (the inbox). GitHub's own mention link in the rendered comment decides:
// not a team's mention, not "@me" in code. A comment that starts with a hidden <!-- marker --> is automation's (the
// marker is how it finds its comment to update), even posted from a person's account: left out.
export async function getMentions(ids: string[], me: string, bots: Set<string> = new Set()): Promise<Map<string, Comment>> {
  const out = new Map<string, Comment>();
  const labIds = ids.filter((id) => isLabId(id));
  ids = ids.filter((id) => !isLabId(id));
  if (labIds.length) {
    const hosts = [...new Set(labIds.map((id) => id.slice(3, id.indexOf('|'))))];
    for (const m of await Promise.all(hosts.map((h) => lab.labMentions(h).catch(() => new Map<string, Comment>()))))
      for (const [id, c] of m) if (labIds.includes(id) && repliesDone()[c.id!] !== c.databaseId) out.set(id, c);
    if (!ids.length) return out;
  }
  if (!ids.length || !me) return out;
  const d = await graphql(
    `query($ids:[ID!]!){nodes(ids:$ids){...on PullRequest{id comments(last:30){nodes{id databaseId url body bodyHTML bodyText createdAt author{__typename login avatarUrl(size:40)}}} reviews(last:30){nodes{author{login} submittedAt}}}}}`,
    { ids: ids.slice(0, 100) },
  );
  const link = new RegExp(`class="user-mention[^"]*"[^>]*>@${me}<`, 'i');
  for (const p of d.nodes ?? []) {
    if (!p?.id) continue;
    const cs: Comment[] = p.comments.nodes;
    const since = [...cs.filter((c) => c.author?.login === me).map((c) => c.createdAt), ...p.reviews.nodes.filter((r: any) => r.author?.login === me && r.submittedAt).map((r: any) => r.submittedAt as string)].sort().at(-1) ?? '';
    const c = cs.filter((c) => c.author && c.author.login !== me && c.author.__typename !== 'Bot' && !bots.has(c.author.login) && !/^\s*<!--/.test(c.body ?? '') && !(agentsAsBots() && agentSays(c.body)) && c.createdAt > since && link.test(c.bodyHTML)).at(-1);
    if (c && repliesDone()[c.id!] !== c.databaseId) out.set(p.id, c);
  }
  return out;
}

export async function getThreads(repo: string, n: number): Promise<Thread[]> {
  if (isLab(repo)) return lab.getLabThreads(repo, n);
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
export type Check = { name: string; state: 'failure' | 'pending' | 'success' | 'neutral'; url: string | null; summary: string; jobId?: number; run?: string; manual?: boolean; onBase?: Check['state'] | null }; // run: a GitLab job's pipeline; manual: a GitLab job waiting to be started, that I may start // onBase: the same check on the base branch's latest commit (a failing one only)

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
  if (isLab(repo)) return lab.getLabChecks(repo, n);
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

// The base branch's latest commit: its checks by name, from REST (check runs, and statuses such as Jenkins'), not
// GraphQL; kept 5 minutes per branch, as every PR into it asks the same. A PR's check is named "Workflow / job", a
// branch's run only "job": both are kept by their last part too.
const baseSeen = new Map<string, { at: number; states: Promise<Map<string, Check['state']>> }>();
export function baseChecks(repo: string, ref: string): Promise<Map<string, Check['state']>> {
  if (isLab(repo)) return lab.labBaseChecks(repo, ref);
  const k = `${repo}@${ref}`;
  const c = baseSeen.get(k);
  if (c && Date.now() - c.at < 5 * 60_000) return c.states;
  const r = encodeURIComponent(ref);
  const states = Promise.all([
    json(`/repos/${repo}/commits/${r}/check-runs?per_page=100&filter=latest`).catch(() => ({ check_runs: [] })),
    json(`/repos/${repo}/commits/${r}/status?per_page=100`).catch(() => ({ statuses: [] })),
  ]).then(([runs, status]) => {
    const out = new Map<string, Check['state']>();
    for (const x of runs.check_runs ?? []) out.set(x.name, x.status === 'completed' ? RUN_STATE[String(x.conclusion).toUpperCase()] ?? 'neutral' : 'pending');
    for (const x of status.statuses ?? []) if (!out.has(x.context)) out.set(x.context, STATUS_STATE[String(x.state).toUpperCase()] ?? 'neutral');
    return out;
  });
  baseSeen.set(k, { at: Date.now(), states });
  states.catch(() => baseSeen.delete(k));
  return states;
}
export const onBaseOf = (base: Map<string, Check['state']>, c: Check) => base.get(c.name) ?? base.get(c.name.split(' / ').pop()!) ?? null;

// Running failed GitHub Actions jobs again: one job (and the jobs that wait on it), or every failed job of a run.
// A GitLab manual job started.
export const playJob = (repo: string, jobId: number) => lab.playLabJob(repo, jobId);
export const rerunJob = async (repo: string, jobId: number) => isLab(repo) ? lab.retryLabJob(repo, jobId) : void (await ok(await gh(`/repos/${repo}/actions/jobs/${jobId}/rerun`, { method: 'POST' })));
export const rerunFailedJobs = async (repo: string, runId: string) =>
  isLab(repo) ? lab.retryLabPipeline(repo, runId) : void (await ok(await gh(`/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`, { method: 'POST' })));
// A job's run, from its link (…/actions/runs/<run>/job/<job>).
// The end of a failed job's log: a GitHub Actions job through the local server (gh), a GitLab job from GitLab.
export const jobLog = (repo: string, job: number) => (isLab(repo) ? lab.labJobLog(repo, job) : fetchJobLog(repo, job));
export const runOf = (c: Check) => c.run ?? c.url?.match(/\/actions\/runs\/(\d+)/)?.[1];

// Files I've marked "Viewed" on GitHub (GitHub's own per-user state, so it carries over to github.com).
export async function getViewed(repo: string, n: number): Promise<Set<string>> {
  if (isLab(repo)) return lab.getLabViewed(repo, n);
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

// Files marked (or unmarked) as viewed on GitHub: one request for up to 50 (a folder or module at once, from the index).
export async function setViewed(prId: string, paths: string[], viewed: boolean) {
  if (isLabId(prId)) return lab.setLabViewed(prId, paths, viewed);
  const op = viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed';
  for (let i = 0; i < paths.length; i += 50) {
    const chunk = paths.slice(i, i + 50);
    await graphql(
      `mutation($pr:ID!,${chunk.map((_, k) => `$p${k}:String!`).join(',')}){${chunk.map((_, k) => `m${k}:${op}(input:{pullRequestId:$pr,path:$p${k}}){clientMutationId}`).join(' ')}}`,
      { pr: prId, ...Object.fromEntries(chunk.map((p, k) => [`p${k}`, p])) },
    );
  }
}

export const resolveThread = (threadId: string, resolve: boolean) =>
  isLabId(threadId) ? lab.resolveLab(threadId, resolve) : graphql(
    resolve
      ? `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){clientMutationId}}`
      : `mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){clientMutationId}}`,
    { id: threadId },
  );

export type StackLayer = { number: number; title: string };

// Each layer of a stack at a glance: its checks, who's reviewing (with their verdict) and where it stands. One query.
export type LayerStatus = {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  reviewDecision: QueueItem['reviewDecision'];
  mergeStateStatus: MergeState['mergeStateStatus'];
  ci: QueueItem['ci'];
  reviewers: { login: string; verdict: ReviewState | 'WAITING' }[];
};
export async function getStackStatus(repo: string, numbers: number[]): Promise<Map<number, LayerStatus>> {
  if (isLab(repo)) return lab.getLabStackStatus(repo, numbers);
  const [owner, name] = repo.split('/');
  const d = await graphql(
    `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${numbers
      .map(
        (n) => `p${n}:pullRequest(number:${n}){number state isDraft reviewDecision mergeStateStatus author{login}
          commits(last:1){nodes{commit{statusCheckRollup{state}}}}
          reviewRequests(first:20){nodes{requestedReviewer{... on User{login} ... on Team{slug}}}}
          latestReviews(first:50){nodes{state author{__typename login}}}}`,
      )
      .join(' ')}}}`,
    { owner, name },
  );
  return new Map(
    numbers.map((n) => {
      const p = d.repository[`p${n}`];
      const reviewers = new Map<string, ReviewState | 'WAITING'>();
      for (const r of p.latestReviews.nodes) if (r.author?.__typename === 'User' && r.author.login !== p.author?.login) reviewers.set(r.author.login, r.state);
      for (const r of p.reviewRequests.nodes) {
        const who = r.requestedReviewer?.login ?? (r.requestedReviewer?.slug && `team ${r.requestedReviewer.slug}`);
        if (who) reviewers.set(who, 'WAITING');
      }
      return [
        n,
        {
          number: n,
          state: p.state,
          isDraft: p.isDraft,
          reviewDecision: p.reviewDecision,
          mergeStateStatus: p.mergeStateStatus,
          ci: p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
          reviewers: [...reviewers].map(([login, verdict]) => ({ login, verdict })),
        },
      ];
    }),
  );
}

// The whole stack around a PR, bottom → top: follow base branches down to PRs whose head is our base, and
// head branches up to the single PR based on our head. Stops at forks, branching stacks, or 10 layers.
export async function getStack(repo: string, pr: PR): Promise<StackLayer[]> {
  if (isLab(repo)) return lab.getLabStack(repo, pr);
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
// My latest submitted review: the commit it was on, and when.
export async function getMyLastReview(repo: string, n: number): Promise<{ sha: string; at: string } | null> {
  if (isLab(repo)) return lab.getLabMyLastReview(repo, n);
  const [me, reviews] = await Promise.all([getGitHubViewer(), paginate<any>(`/repos/${repo}/pulls/${n}/reviews?per_page=100`)]);
  const r = reviews.filter((r) => r.user?.login === me && r.state !== 'PENDING').at(-1);
  return r ? { sha: r.commit_id, at: r.submitted_at } : null;
}

// Files changed between two commits. status 'diverged' means `base` isn't an ancestor (the PR was rebased).
// commits: how many head has that base doesn't.
export async function getCompare(repo: string, base: string, head: string): Promise<{ status: string; files: PRFile[]; commits: number }> {
  if (isLab(repo)) return lab.getLabCompare(repo, base, head);
  const d = await json(`/repos/${repo}/compare/${base}...${head}`);
  return { status: d.status, files: d.files ?? [], commits: d.ahead_by ?? 0 };
}

// GitHub's emoji shortcodes (name → image URL), cached for the session; without gh's sign-in, asked anonymously (the
// list is public). For a GitLab repo (or the GitLab account on show), only the standard (Unicode) ones: GitLab draws
// those from the same names, but not GitHub's own images (:octocat:, :shipit:…), which would stay text there.
let emojis: Promise<Record<string, string>> | undefined;
const allEmojis = () =>
  (emojis ??= json('/emojis')
    .catch(() => fetch('https://api.github.com/emojis').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GitHub ${r.status}`)))))
    .then((m: Record<string, string>) => {
      setEmojiMap(m);
      return m;
    }));
export const getEmojis = (repo?: string) =>
  (repo ? isLab(repo) : !!viewAs()) ? allEmojis().then((m) => Object.fromEntries(Object.entries(m).filter(([, url]) => url.includes('/unicode/')))) : allEmojis();

// Markdown rendered by GitHub itself (emoji, @mentions, #refs, mermaid…), exactly as the comment will look there.
export async function renderGfm(text: string, repo: string): Promise<string> {
  if (isLab(repo)) return lab.renderLabMarkdown(text, repo);
  const res = await ok(await gh('/markdown', { method: 'POST', body: JSON.stringify({ text, mode: 'gfm', context: repo }) }, 'text/html'));
  return res.text();
}

export const reply = (repo: string, n: number, commentId: number, body: string) =>
  isLab(repo) ? lab.replyLab(repo, n, commentId, body) : json(`/repos/${repo}/pulls/${n}/comments/${commentId}/replies`, { method: 'POST', body: JSON.stringify({ body }) });

// A comment (a line, lines, or the whole file) added to a pending review.
const addReviewThread = (reviewId: string, x: Draft) =>
  graphql(
    `mutation($r:ID!,$path:String!,$body:String!,$line:Int,$start:Int,$side:DiffSide,$startSide:DiffSide,$subject:PullRequestReviewThreadSubjectType){
      addPullRequestReviewThread(input:{pullRequestReviewId:$r,path:$path,body:$body,line:$line,startLine:$start,side:$side,startSide:$startSide,subjectType:$subject}){thread{id}}}`,
    { r: reviewId, path: x.path, body: x.body, line: x.line ?? null, start: x.startLine ?? null, side: x.line ? x.side : null, startSide: x.startLine ? x.side : null, subject: x.line ? 'LINE' : 'FILE' },
  );

// An agent's findings (agentreview.ts) on a PR, under my account: in my pending review, not sent (added to one I've
// started, else a new one with the summary), or as comments posted now. GitHub keeps one pending review per person, so
// with one of mine open they go into it either way.
export async function postAgentFindings(repo: string, n: number, pr: PR, drafts: Draft[], summary: string, mode: 'pending' | 'comment') {
  if (isLab(repo)) return lab.postLabAgentFindings(repo, n, drafts, summary, mode);
  const pending = await getPendingReview(repo, n);
  if (mode === 'comment' && !pending) return submitReview(pr.node_id, pr.head.sha, 'COMMENT', summary, drafts);
  const reviewId =
    pending?.id ??
    (await graphql(`mutation($pr:ID!,$c:GitObjectID!,$b:String){addPullRequestReview(input:{pullRequestId:$pr,commitOID:$c,body:$b}){pullRequestReview{id}}}`, { pr: pr.node_id, c: pr.head.sha, b: summary }))
      .addPullRequestReview.pullRequestReview.id;
  for (const x of drafts) await addReviewThread(reviewId, x);
}

// GraphQL rather than REST: only addPullRequestReviewThread supports file-level comments inside a review.
// `pending`: my review already open on GitHub, to add to and send (never deleted here if something fails).
export async function submitReview(prId: string, commitOID: string, event: ReviewEvent, body: string, drafts: Draft[], pending?: string) {
  if (isLabId(prId)) return lab.submitLabReview(prId, commitOID, event, body, drafts);
  const reviewId =
    pending ??
    (
      await graphql(
        `mutation($pr:ID!,$c:GitObjectID!){addPullRequestReview(input:{pullRequestId:$pr,commitOID:$c}){pullRequestReview{id}}}`,
        { pr: prId, c: commitOID },
      )
    ).addPullRequestReview.pullRequestReview.id;
  const sent: string[] = []; // on a review already on GitHub, these stay there if a later step fails
  try {
    for (const x of drafts) {
      await addReviewThread(reviewId, x);
      sent.push(x.id);
    }
    await graphql(
      `mutation($r:ID!,$e:PullRequestReviewEvent!,$b:String){submitPullRequestReview(input:{pullRequestReviewId:$r,event:$e,body:$b}){clientMutationId}}`,
      { r: reviewId, e: event, b: body || null },
    );
  } catch (e) {
    // Don't leave a half-built pending review behind; it would block the retry. One started on GitHub stays.
    if (!pending) await discardReview(reviewId).catch(() => {});
    else (e as { sent?: string[] }).sent = sent;
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
  viewerCanDeleteHeadRef: boolean; // only once merged or closed
  isCrossRepository: boolean; // from a fork: its branch isn't ours to delete
  headRefName: string;
  baseRefName: string;
  headRef: { id: string } | null; // null once the branch is gone
  deleteBranchOnMerge: boolean; // the repo deletes merged branches itself
  methods: MergeMethod[]; // allowed in this repo, the viewer's usual one first
  message: Record<MergeMethod, { title: string; body: string }>; // GitHub's default commit message per method
  holds: string[]; // what says not to merge it yet (holdSigns)
  reasons?: { id: string; text: string }[]; // GitLab's own word on what blocks it (its failed merge checks)
  rules?: { name: string; required: number; approvedBy: string[]; eligible: string[] }[]; // GitLab's approval rules still unmet
};

// "Do not merge" signs: a label (do-not-merge, DNM, WIP, hold), the title ([WIP], DO NOT MERGE, DNM), or a WIP commit on
// top. Each as the merge box names it.
const HOLD_LABEL = /^(do[ -]?not[ -]?merge|don'?t[ -]?merge|dnm|wip|work[ -]in[ -]progress|(on[ -]?)?hold)$/i;
const HOLD_TEXT = /\[\s*wip\s*\]|^\s*wip\b|\bdo not merge\b|\bdon'?t merge\b|\bDNM\b/i;
export const holdSigns = (title: string, labels: string[], headCommit: string) => [
  ...labels.filter((l) => HOLD_LABEL.test(l.trim())).map((l) => `the “${l}” label`),
  ...(HOLD_TEXT.test(title) ? ['its title'] : []),
  ...(HOLD_TEXT.test(headCommit) ? [`the last commit (“${headCommit}”)`] : []),
];

// The checks the base branch requires (branch protection, and rulesets), by name; once per repo and branch.
const requiredSeen = new Map<string, Promise<string[]>>();
export function requiredChecks(repo: string, branch: string): Promise<string[]> {
  if (isLab(repo)) return Promise.resolve([]); // GitLab asks for the whole pipeline to pass, not named checks
  const key = `${repo}@${branch}`;
  const b = encodeURIComponent(branch);
  if (!requiredSeen.has(key))
    requiredSeen.set(key, Promise.all([
      json(`/repos/${repo}/branches/${b}`).then((x) => (x.protection?.required_status_checks?.contexts ?? []) as string[], () => []),
      json(`/repos/${repo}/rules/branches/${b}`).then((rules: any[]) => rules.filter((r) => r.type === 'required_status_checks').flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c: { context: string }) => c.context)) as string[], () => []),
    ]).then(([a, c]) => [...new Set([...a, ...c])]));
  return requiredSeen.get(key)!;
}
// Required checks with no run at all on the head commit, once nothing is still running (a path filter skipped its
// workflow, say): GitHub waits for them for ever. Our names are "Workflow / job"; required ones are the job's.
export const neverRan = (required: string[], checks: Pick<Check, 'name' | 'state'>[] | null) =>
  !checks || checks.some((c) => c.state === 'pending') ? [] : required.filter((r) => !checks.some((c) => c.name === r || c.name.endsWith(` / ${r}`)));

// Other PRs naming the same Jira tickets (in the title, description or branch) across the owner's repos: the backend
// PR for this app PR's ticket, say.
export type TicketPR = { repo: string; number: number; title: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; isDraft: boolean; author: string; keys: string[] };
export async function ticketPRs(repo: string, n: number, keys: string[]): Promise<TicketPR[]> {
  if (isLab(repo)) return lab.labTicketPRs(repo, n, keys);
  if (!keys.length) return [];
  const q = `${keys.map((k) => `"${k}"`).join(' OR ')} user:${repo.split('/')[0]} is:pr`;
  const d = await graphql(`query($q:String!){search(query:$q,type:ISSUE,first:30){nodes{...on PullRequest{number title state isDraft headRefName body repository{nameWithOwner} author{login}}}}}`, { q });
  return (d.search.nodes as any[])
    .filter((p) => p.number && !(p.repository.nameWithOwner === repo && p.number === n))
    .map((p) => ({ repo: p.repository.nameWithOwner, number: p.number, title: p.title, state: p.state, isDraft: p.isDraft, author: p.author?.login ?? 'ghost', keys: keys.filter((k) => new RegExp(`\\b${k}\\b`).test(`${p.title} ${p.headRefName} ${p.body}`)) }))
    .filter((p) => p.keys.length);
}

const MERGE_STATE = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){
  mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed viewerDefaultMergeMethod deleteBranchOnMerge
  pullRequest(number:$n){id state isDraft mergeable mergeStateStatus reviewDecision headRefOid mergedBy{login}
    title labels(first:20){nodes{name}} commits(last:1){nodes{commit{messageHeadline}}}
    isCrossRepository viewerCanDeleteHeadRef headRefName baseRefName headRef{id}
    autoMergeRequest{mergeMethod enabledBy{login}}
    viewerCanMergeAsAdmin viewerCanEnableAutoMerge viewerCanDisableAutoMerge viewerCanUpdateBranch
    mt:viewerMergeHeadlineText(mergeType:MERGE) mb:viewerMergeBodyText(mergeType:MERGE)
    st:viewerMergeHeadlineText(mergeType:SQUASH) sb:viewerMergeBodyText(mergeType:SQUASH)}}}`;

export async function getMergeState(repo: string, n: number): Promise<MergeState> {
  if (isLab(repo)) return lab.getLabMergeState(repo, n, holdSigns);
  const [owner, name] = repo.split('/');
  const r = (await graphql(MERGE_STATE, { owner, name, n })).repository;
  const { mt, mb, st, sb, title, labels, commits, ...pr } = r.pullRequest;
  const allowed = (['MERGE', 'SQUASH', 'REBASE'] as const).filter((m) => r[`${m.toLowerCase()}${m === 'MERGE' ? 'Commit' : 'Merge'}Allowed`]);
  return {
    ...pr,
    deleteBranchOnMerge: r.deleteBranchOnMerge,
    holds: holdSigns(title, labels.nodes.map((l: { name: string }) => l.name), commits.nodes[0]?.commit.messageHeadline ?? ''),
    methods: allowed.sort((a, b) => +(b === r.viewerDefaultMergeMethod) - +(a === r.viewerDefaultMergeMethod)),
    message: { MERGE: { title: mt, body: mb }, SQUASH: { title: st, body: sb }, REBASE: { title: '', body: '' } },
  };
}

// expectedHeadOid: refuse if commits were pushed after the state I looked at.
export const mergePR = (s: MergeState, method: MergeMethod, title: string, body: string, auto: boolean) =>
  isLabId(s.id) ? lab.mergeLab(s, method, title, body, auto) : graphql(
    auto
      ? `mutation($id:ID!,$m:PullRequestMergeMethod,$t:String,$b:String,$oid:GitObjectID){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$m,commitHeadline:$t,commitBody:$b,expectedHeadOid:$oid}){clientMutationId}}`
      : `mutation($id:ID!,$m:PullRequestMergeMethod,$t:String,$b:String,$oid:GitObjectID){mergePullRequest(input:{pullRequestId:$id,mergeMethod:$m,commitHeadline:$t,commitBody:$b,expectedHeadOid:$oid}){clientMutationId}}`,
    { id: s.id, m: method, t: method === 'REBASE' ? null : title, b: method === 'REBASE' ? null : body, oid: s.headRefOid },
  );
// The bottom layer of a stack merged from the stack overview: GitHub's usual method and message, then the next layer
// pointed at what it merged into, then its branch deleted (unless the repo does that, or another PR builds on it).
export async function mergeLayer(repo: string, n: number, next?: number) {
  if (isLab(repo)) return lab.mergeLabLayer(repo, n, next, holdSigns);
  const s = await getMergeState(repo, n);
  const m = s.methods[0];
  await mergePR(s, m, s.message[m].title, s.message[m].body, false);
  if (next) await json(`/repos/${repo}/pulls/${next}`, { method: 'PATCH', body: JSON.stringify({ base: s.baseRefName }) });
  if (!s.deleteBranchOnMerge && !s.isCrossRepository) await deleteBranch(repo, s);
}

// A merged PR's branch, unless another open PR builds on it (deleting it would close that one).
export async function deleteBranch(repo: string, s: Pick<MergeState, 'headRef' | 'headRefName'>) {
  if (isLab(repo)) return s.headRef ? lab.deleteLabBranch(repo, s.headRefName) : undefined;
  if (!s.headRef) return;
  const [above] = (await json(`/repos/${repo}/pulls?state=open&per_page=1&base=${encodeURIComponent(s.headRefName)}`)) as PR[];
  if (above) throw new Error(`kept ${s.headRefName}: #${above.number} builds on it`);
  await graphql(`mutation($id:ID!){deleteRef(input:{refId:$id}){clientMutationId}}`, { id: s.headRef.id });
}
// My merged PRs of the last 90 days whose branch is still there and GitHub would let me delete (not protected, nothing
// open built on it, not a fork's); never main, master, develop, release/… or hotfix/….
export type StaleBranch = { repo: string; number: number; title: string; headRefName: string; headRef: { id: string } };
const KEEP = /^(main|master|develop|dev|staging|production|release\/|hotfix\/)/;
export async function getStaleBranches(): Promise<StaleBranch[]> {
  if (viewAs()) return lab.getLabStaleBranches(viewAs());
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const d = await graphql(
    `query($q:String!){s:search(query:$q,type:ISSUE,first:100){nodes{...on PullRequest{number title repository{nameWithOwner} isCrossRepository viewerCanDeleteHeadRef headRefName headRef{id}}}}}`,
    { q: `is:pr is:merged author:@me merged:>=${since}` },
  );
  return (d.s.nodes as any[])
    .filter((p) => p?.headRef && p.viewerCanDeleteHeadRef && !p.isCrossRepository && !KEEP.test(p.headRefName))
    .map((p) => ({ repo: p.repository.nameWithOwner, number: p.number, title: p.title, headRefName: p.headRefName, headRef: p.headRef }));
}

export const disableAutoMerge = (id: string) =>
  isLabId(id) ? lab.cancelLabAutoMerge(id) : graphql(`mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){clientMutationId}}`, { id });
export const updateBranch = (s: { id: string; headRefOid?: string }) =>
  isLabId(s.id) ? lab.rebaseLab(s.id) : graphql(`mutation($id:ID!,$oid:GitObjectID){updatePullRequestBranch(input:{pullRequestId:$id,expectedHeadOid:$oid}){clientMutationId}}`, { id: s.id, oid: s.headRefOid });
export const markReady = (id: string) =>
  isLabId(id) ? lab.markLabReady(id) : graphql(`mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){clientMutationId}}`, { id });

// Comments by accounts marked as bots count as bot comments (folded, never awaiting a reply, bot threads).
// A comment that opens with 🤖 (after any hidden <!-- markers -->): an agent's, by its own say, posted from a person's
// account. A bot's when Settings says so (agentsAsBots).
export const agentSays = (body?: string | null) => /^\s*(<!--[\s\S]*?-->\s*)*\u{1F916}/u.test(body ?? '');
export function markBots<T extends { comments: { nodes: (Pick<Comment, 'author'> & { body?: string })[] } }>(threads: T[], bots: Set<string>): T[] {
  const agents = agentsAsBots();
  if (!bots.size && !agents) return threads;
  return threads.map((t) => ({
    ...t,
    comments: { ...t.comments, nodes: t.comments.nodes.map((c) => (c.author && (bots.has(c.author.login) || (agents && agentSays(c.body))) ? { ...c, author: { ...c.author, __typename: 'Bot' } } : c)) },
  }));
}

// Does this review thread wait on me? Open and current, last word from a person other than me, and it's my PR or I'm
// in the thread. Outdated threads don't count: the code moved on, and a reply there is nearly always "done".
// PRs merged in the last 14 days that I opened or reviewed, where a review thread may wait on my reply: a reply after
// the merge would otherwise go unseen (the PR has left the list). A light look at each PR's threads (the last few
// comments) picks the candidates; the inbox then reads their threads in full and applies awaitsMe. Kept 10 minutes.
export type MergedPR = { id: string; repo: string; number: number; title: string; authored: boolean; mergedAt: string; updatedAt: string; myState: ReviewState | null };
let mergedSeen: { at: number; list: Promise<MergedPR[]> } | null = null;
export function getMergedAwaiting(me: string): Promise<MergedPR[]> {
  if (viewAs()) return lab.getLabMergedAwaiting(viewAs(), me, (t, mine) => awaitsMe(t, me, mine));
  if (mergedSeen && Date.now() - mergedSeen.at < 10 * 60_000) return mergedSeen.list;
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const F = `nodes{...on PullRequest{id number title mergedAt updatedAt repository{nameWithOwner} author{login} latestOpinionatedReviews(first:30){nodes{state author{login}}}
    reviewThreads(last:30){nodes{isResolved isOutdated starter:comments(first:1){nodes{author{login}}} comments(last:5){nodes{author{__typename login}}}}}}}`;
  const list = graphql(
    `query($a:String!,$r:String!){a:search(query:$a,type:ISSUE,first:20){${F}} r:search(query:$r,type:ISSUE,first:20){${F}}}`,
    { a: `is:pr is:merged merged:>=${since} author:@me sort:updated-desc`, r: `is:pr is:merged merged:>=${since} reviewed-by:@me -author:@me sort:updated-desc` },
  ).then((d) =>
    [...d.a.nodes, ...d.r.nodes]
      .filter((p: any) => p?.id)
      .filter((p: any) => {
        const mine = p.author?.login === me;
        return p.reviewThreads.nodes.some((t: any) => {
          const cs = t.comments.nodes;
          const last = cs.at(-1)?.author;
          if (t.isResolved || t.isOutdated || !last || last.login === me || last.__typename === 'Bot') return false;
          return mine || t.starter.nodes[0]?.author?.login === me || cs.some((c: any) => c.author?.login === me);
        });
      })
      .map((p: any) => ({ id: p.id, repo: p.repository.nameWithOwner, number: p.number, title: p.title, authored: p.author?.login === me, mergedAt: p.mergedAt, updatedAt: p.updatedAt, myState: p.latestOpinionatedReviews.nodes.find((r: any) => r.author?.login === me)?.state ?? null })),
  );
  mergedSeen = { at: Date.now(), list };
  list.catch(() => (mergedSeen = null));
  return list;
}

export function awaitsMe(t: Pick<Thread, 'isResolved' | 'isOutdated'> & { id?: string; comments: { nodes: (Pick<Comment, 'author'> & { databaseId?: number })[] } }, me: string, myPR: boolean) {
  const lastComment = t.comments.nodes.at(-1);
  const last = lastComment?.author;
  if (t.isResolved || t.isOutdated || !last || last.login === me || last.__typename === 'Bot') return false;
  if (t.id && lastComment?.databaseId && repliesDone()[t.id] === lastComment.databaseId) return false; // marked done, nothing new since
  return myPR || t.comments.nodes.some((c) => c.author?.login === me);
}

// Per PR in the list: how many review threads wait on my reply (see awaitsMe), and whether every thread I'm in is
// resolved (then a PR I reviewed is ready for another look). One query for all of them.
// Reviews I've just sent from lgtm, laid over the list until GitHub's search catches up (it keeps a reviewed PR under
// review-requested:@me for a while): answered, unless asked again since; for a few minutes.
export type Answered = Map<string, { event: ReviewEvent; at: number }>; // by "owner/repo#n"
export function withAnswered(items: QueueItem[], answered: Answered, now = Date.now()): QueueItem[] {
  return items.map((i) => {
    const a = answered.get(`${i.repo}#${i.number}`);
    if (!a || now - a.at > 5 * 60_000 || Date.parse(i.waitingSince) > a.at) return i;
    const state = a.event === 'APPROVE' ? 'APPROVED' : a.event === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : (i.myState ?? 'COMMENTED');
    return { ...i, requested: false, myState: state, newSinceApproval: 0, reviewedBefore: true };
  });
}

export type ThreadStatus = { awaiting: number; allMineResolved: boolean };

// What changed on a listed PR between two refreshes, worth a notification: new replies waiting on me; on my PR, a
// verdict or its checks finishing.
// My PR approved, its checks passed and GitHub willing to merge it, with nothing (auto-merge, the queue) merging it for me.
export const readyToMerge = (i: QueueItem) =>
  i.authored && !i.isDraft && i.reviewDecision === 'APPROVED' && i.ci === 'SUCCESS' && ['CLEAN', 'HAS_HOOKS'].includes(i.mergeState) && !i.autoMerge && !i.queue;
export function queueNews(was: QueueItem, now: QueueItem, on: { replies: boolean; verdicts: boolean; ci: boolean; queue: boolean; ready?: boolean }): string[] {
  const running = (ci: QueueItem['ci']) => ci === 'PENDING' || ci === 'EXPECTED';
  // Ready to merge says it all: no separate "Approved" or "Checks passed" with it.
  if (on.ready && readyToMerge(now) && !readyToMerge(was)) return ['Ready to merge', ...queueNews(was, now, { ...on, ready: false, verdicts: false, ci: false })];
  return [
    on.replies && was.thread && now.thread && now.thread.awaiting > was.thread.awaiting && 'New reply for you',
    on.verdicts && now.authored && now.reviewDecision !== was.reviewDecision && ({ APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested' } as Record<string, string>)[now.reviewDecision ?? ''],
    on.ci && now.authored && running(was.ci) && now.ci && !running(now.ci) && (now.ci === 'SUCCESS' ? 'Checks passed' : 'Checks failed'),
    // Auto-merge that hands over to the merge queue isn't news; dropping out of either is (a merged PR leaves the list).
    on.queue && now.authored && !now.queue && (was.queue ? 'Left the merge queue' : was.autoMerge && !now.autoMerge && 'Auto-merge turned off'),
  ].filter((x): x is string => !!x);
}
// The list's extras, kept per PR until it changes (its updatedAt): a refresh asks GitHub only about the PRs that did,
// which keeps the list's every-3-minutes refresh from spending GraphQL points on the ones that didn't.
type Extras = { estimate?: Estimate; thread?: ThreadStatus; mention?: boolean };
const extrasSeen = new Map<string, { at: string } & Extras>();
const changed = <T extends { id: string; updatedAt: string }>(items: T[], k: keyof Extras) => items.filter((i) => { const c = extrasSeen.get(i.id); return !c || c.at !== i.updatedAt || c[k] === undefined; });
const keep = (i: { id: string; updatedAt: string }, part: Extras) => {
  const c = extrasSeen.get(i.id);
  extrasSeen.set(i.id, { ...(c && c.at === i.updatedAt ? c : {}), at: i.updatedAt, ...part });
};

// Every PR's thread status asked again at the next refresh (what counts as a bot changed).
export const forgetAllThreadStatus = () => extrasSeen.forEach((v, k) => extrasSeen.set(k, { ...v, thread: undefined, mention: undefined }));
// A PR's thread status (and mention) asked again at the next refresh (one marked done changes it; the PR didn't change).
export const forgetThreadStatus = (id: string) => void extrasSeen.set(id, { ...(extrasSeen.get(id) ?? { at: '' }), thread: undefined, mention: undefined });

// Per PR (mine, or one the list has as mentioning me): does a conversation comment mentioning me wait on me
// (getMentions)? For the inbox button's count; only the PRs that changed are asked.
export async function getMentionStatus(items: QueueItem[]): Promise<Map<string, boolean>> {
  const me = await getGitHubViewer();
  const all = items.filter((i) => i.mentioned || i.authored);
  const ask = changed(all, 'mention');
  if (ask.length) {
    const found = await getMentions(ask.map((i) => i.id), me, readBots());
    ask.forEach((i) => keep(i, { mention: found.has(i.id) }));
  }
  return new Map(all.flatMap((i) => { const m = extrasSeen.get(i.id)?.mention; return m === undefined ? [] : [[i.id, m] as const]; }));
}

// Each PR's rough time to review, asked after the list shows (its description and per-file line counts would slow the
// list down).
export async function getEstimates(items: { id: string; updatedAt: string }[]): Promise<Map<string, Estimate>> {
  const ask = changed(items.filter((i) => !isLabId(i.id)), 'estimate');
  const labAsk = changed(items.filter((i) => isLabId(i.id)), 'estimate');
  if (labAsk.length) for (const [id, x] of await lab.labEstimateInputs(labAsk)) keep(labAsk.find((i) => i.id === id)!, { estimate: estimate(x.files, x.body) });
  for (let k = 0; k < ask.length; k += 100) {
    const part = ask.slice(k, k + 100);
    const d = await graphql(`query($ids:[ID!]!){nodes(ids:$ids){... on PullRequest{id body files(first:100){nodes{path additions deletions}}}}}`, { ids: part.map((i) => i.id) });
    for (const p of d.nodes) if (p?.id) keep(part.find((i) => i.id === p.id)!, { estimate: estimate(p.files?.nodes ?? [], p.body) });
  }
  return new Map(items.flatMap((i) => { const e = extrasSeen.get(i.id)?.estimate; return e ? [[i.id, e] as const] : []; }));
}

export async function getThreadStatus(items: QueueItem[], bots: Set<string> = new Set()): Promise<Map<string, ThreadStatus>> {
  const hub = items.some((i) => !isLab(i.repo));
  const me = hub ? await getGitHubViewer() : '';
  const all = items.filter((i) => i.mine || i.myState);
  const ask = changed(all, 'thread');
  const have = () => new Map(all.flatMap((i) => { const t = extrasSeen.get(i.id)?.thread; return t ? [[i.id, t] as const] : []; }));
  // GitLab's: each MR's discussions, read for the ones that changed.
  await Promise.all(ask.filter((i) => isLab(i.repo)).map(async (i) => {
    const me = await getViewer(i.repo);
    const threads = markBots(await lab.getLabThreads(i.repo, i.number), bots);
    const mine = threads.filter((t) => t.comments.nodes.some((c) => c.author?.login === me));
    keep(i, { thread: { awaiting: threads.filter((t) => awaitsMe(t, me, i.authored)).length, allMineResolved: mine.length > 0 && mine.every((t) => t.isResolved) } });
  }).map((p) => p.catch(() => {})));
  ask.splice(0, ask.length, ...ask.filter((i) => !isLab(i.repo)));
  if (!ask.length) return have();
  const vars = Object.fromEntries(ask.map((i, k) => [`i${k}`, i.id]));
  const d = await graphql(
    `query(${ask.map((_, k) => `$i${k}:ID!`).join(',')}){${ask
      .map((_, k) => `p${k}:node(id:$i${k}){...on PullRequest{reviewThreads(last:100){nodes{id isResolved isOutdated starter:comments(first:1){nodes{author{login}}} comments(last:20){nodes{databaseId ${agentsAsBots() ? 'body ' : ''}author{__typename login}}}}}}}`)
      .join(' ')}}`,
    vars,
  );
  ask.forEach((i, k) => {
    const threads = markBots(d[`p${k}`].reviewThreads.nodes as any[], bots);
    const mine = threads.filter((t: any) => [...t.starter.nodes, ...t.comments.nodes].some((c: any) => c.author?.login === me));
    keep(i, { thread: { awaiting: threads.filter((t: any) => awaitsMe(t, me, i.authored)).length, allMineResolved: mine.length > 0 && mine.every((t: any) => t.isResolved) } });
  });
  return have();
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
