import { setEmojiMap } from './emoji.ts';
import { fetchToken, recordError } from './platform.ts';
import { estimate, type Estimate } from './files.ts';

export type PR = {
  number: number;
  title: string;
  updated_at?: string;
  body: string | null;
  body_html?: string; // GitHub-rendered and sanitized (full+json media type)
  html_url: string;
  node_id: string;
  user: { login: string; type: string };
  assignees: { login: string; type: string }[];
  requested_reviewers?: { login: string; type?: string }[];
  requested_teams?: { slug: string }[];
  head: { sha: string; ref: string; repo: { full_name: string; owner: { login: string } } | null };
  base: { ref: string; sha: string };
  draft?: boolean;
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
export type Comment = { databaseId: number; url: string; body?: string; bodyHTML: string; bodyText: string; createdAt: string; author: { login: string; __typename?: string; databaseId?: number } | null; originalCommit?: { oid: string } | null };
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
  requested: boolean; // my review is currently requested (including re-requests)
  myState: ReviewState | null; // my latest submitted review
  reviewedBefore: boolean; // I've reviewed it (a re-request drops my review from latestReviews, but not from this)
  reviewing: boolean; // in my review queue: requested, or I've reviewed it
  mine: boolean; // I opened it, or it's assigned to me and not in my review queue
  assigned: boolean; // assigned to me
  authored: boolean; // I opened it
  thread?: ThreadStatus; // filled in after the list loads (getThreadStatus)
  waitingSince: string; // when it last asked for review: opened, marked ready, or a review requested
  pendingReviewers: string[]; // people (not teams) whose review is requested
  noReviewers: boolean; // nobody asked (people or teams) and no person has reviewed: bots don't count
  lastCommitAt: string; // the head commit's time
  estimate?: Estimate; // rough time to review (files.ts), filled in after the list loads (getEstimates)
};
export type ConversationItem = { id: string; author: string; html: string; at: string; url: string; state?: ReviewState; bot: boolean; commit?: string }; // commit: the head a review was of

// --- auth ---

let token: string | undefined;
export async function loadToken() {
  token = await fetchToken();
}

// --- API ---

async function gh(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json') {
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
  });
  if (res.status === 401) throw new Error('GitHub rejected the gh token. Run `gh auth login`, then reload.');
  return res;
}

async function ok(res: Response) {
  if (res.ok) return res;
  const msg = (await res.json().catch(() => null))?.message;
  recordError(`GitHub ${res.status} ${new URL(res.url).pathname}: ${msg ?? res.statusText}`);
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
  if (r.errors?.length) recordError(`GitHub GraphQL: ${r.errors[0].message}`);
  if (r.errors?.length && !(partial && r.data)) throw new Error(r.errors[0].message);
  return r.data;
}

// Review queue: GitHub drops a PR from review-requested:@me once you review it, so reviewed-by:@me covers the rest.
// Plus my own PRs and the ones assigned to me.
const QUEUE = `query{viewer{login}
  requested:search(query:"is:open is:pr archived:false review-requested:@me",type:ISSUE,first:100){nodes{...F}}
  reviewed:search(query:"is:open is:pr archived:false reviewed-by:@me -author:@me",type:ISSUE,first:100){nodes{...F}}
  authored:search(query:"is:open is:pr archived:false author:@me",type:ISSUE,first:100){nodes{...F}}
  assigned:search(query:"is:open is:pr archived:false assignee:@me",type:ISSUE,first:100){nodes{...F}}}
fragment F on PullRequest{id number title updatedAt isDraft reviewDecision mergeStateStatus autoMergeRequest{enabledAt} author{__typename login} assignees(first:1){nodes{login}}
  additions deletions changedFiles commits(last:1){nodes{commit{committedDate statusCheckRollup{state}}}} repository{nameWithOwner}
  headRefName baseRefName headRepository{nameWithOwner} createdAt
  reviewRequests(first:20){nodes{requestedReviewer{... on User{login}}}}
  timelineItems(last:1,itemTypes:[REVIEW_REQUESTED_EVENT,READY_FOR_REVIEW_EVENT]){nodes{... on ReviewRequestedEvent{createdAt} ... on ReadyForReviewEvent{createdAt}}}
  latestReviews(first:100){nodes{state author{__typename login}}} latestOpinionatedReviews(first:100){nodes{state author{login}}}}`;

export async function getReviewQueue(): Promise<QueueItem[]> {
  const d = await graphql(QUEUE, {});
  const me = d.viewer.login;
  const ids = (k: string) => new Set<string>(d[k].nodes.map((p: any) => p.id));
  const [requested, reviewed, authored, assigned] = ['requested', 'reviewed', 'authored', 'assigned'].map(ids);
  const all = new Map<string, any>(['authored', 'assigned', 'reviewed', 'requested'].flatMap((k) => d[k].nodes.map((p: any) => [p.id, p])));
  return [...all.values()]
    .map((p) => ({
      ...toItem(p),
      requested: requested.has(p.id),
      // A comment-only review (a reply, say) after an approval doesn't undo it on GitHub, so my approval or change
      // request wins over a later plain comment.
      myState:
        p.latestOpinionatedReviews.nodes.find((r: any) => r.author?.login === me)?.state ??
        p.latestReviews.nodes.find((r: any) => r.author?.login === me && r.state !== 'PENDING')?.state ??
        null,
      // An assigned PR that's waiting on my review belongs in the review queue, not twice.
      reviewedBefore: reviewed.has(p.id),
      reviewing: !authored.has(p.id) && (requested.has(p.id) || reviewed.has(p.id)),
      mine: authored.has(p.id) || (assigned.has(p.id) && !requested.has(p.id) && !reviewed.has(p.id)),
      assigned: assigned.has(p.id),
      authored: authored.has(p.id),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// The PR fields every list shows (fragment F); the my-relation flags default to "none".
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
      additions: p.additions,
      deletions: p.deletions,
      files: p.changedFiles,
      autoMerge: !!p.autoMergeRequest,
      waitingSince: [p.createdAt, p.timelineItems?.nodes[0]?.createdAt].filter(Boolean).sort().at(-1),
      pendingReviewers: (p.reviewRequests?.nodes ?? []).map((r: any) => r.requestedReviewer?.login).filter(Boolean),
      noReviewers: !p.reviewRequests?.nodes.length && !p.latestReviews.nodes.some((r: any) => r.author?.__typename === 'User' && r.author.login !== p.author?.login),
      requested: false,
      myState: null,
      reviewedBefore: false,
      reviewing: false,
      mine: false,
      assigned: false,
      authored: false,
});

// Teams in my organizations, as "org/slug", for the Team tab.
export async function getTeams(): Promise<string[]> {
  const d = await graphql(`{viewer{organizations(first:20){nodes{login teams(first:100){nodes{slug}}}}}}`, {});
  return d.viewer.organizations.nodes.flatMap((o: any) => o.teams.nodes.map((t: any) => `${o.login}/${t.slug}`));
}

// A team's members and their open PRs in the team's organization. Search ORs repeated author: filters; members go
// in chunks so each query stays under GitHub's search length limit.
export async function getTeamMembers(team: string): Promise<string[]> {
  const [org, slug] = team.split('/');
  const t = (await graphql(`query($org:String!,$slug:String!){organization(login:$org){team(slug:$slug){members(first:100){nodes{login}}}}}`, { org, slug }))
    .organization?.team;
  if (!t) throw new Error(`No team ${team}, or you can't see it.`);
  return t.members.nodes.map((m: any) => m.login).sort((a: string, b: string) => a.localeCompare(b));
}

// Plus each member's review load: open PRs that ask them, by name, for a review.
export async function getTeamPRs(team: string): Promise<{ members: string[]; items: QueueItem[]; load: Record<string, number> }> {
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
      .map((r) => ({ id: 'r' + r.id, author: r.user?.login ?? 'ghost', html: r.body_html ?? '', at: r.submitted_at, url: r.html_url, state: r.state, bot: r.user?.type === 'Bot', commit: r.commit_id })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

// People to ask for a review of my PR, least busy first: whoever reviewed this repo's recent PRs (they know the code),
// else the PR list's team. Busy: open PRs in the org that already ask them, by name, for a review.
export type ReviewerPick = { login: string; load: number; why: string };
export async function suggestReviewers(repo: string, skip: Set<string>, team: string): Promise<ReviewerPick[]> {
  const [owner, name] = repo.split('/');
  const d = await graphql(
    `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(last:40,states:[OPEN,MERGED]){nodes{reviews(first:30){nodes{author{__typename login}}}}}}}`,
    { owner, name },
  );
  const count = new Map<string, number>();
  for (const p of d.repository.pullRequests.nodes)
    for (const login of new Set<string>(p.reviews.nodes.filter((r: any) => r.author?.__typename === 'User').map((r: any) => r.author.login)))
      count.set(login, (count.get(login) ?? 0) + 1);
  const fit = (p: { login: string }) => !skip.has(p.login) && !p.login.endsWith('[bot]');
  let people = [...count].sort((a, b) => b[1] - a[1]).map(([login, k]) => ({ login, why: `reviewed ${k} of the last 40 PRs here` })).filter(fit);
  if (!people.length && team) people = (await getTeamMembers(team)).map((login) => ({ login, why: `in ${team.split('/')[1]}` })).filter(fit);
  people = people.slice(0, 30);
  if (!people.length) return [];
  const vars = Object.fromEntries(people.map((p, k) => [`r${k}`, `is:open is:pr archived:false org:${owner} user-review-requested:${p.login}`]));
  const l = await graphql(`query(${people.map((_, k) => `$r${k}:String!`).join(',')}){${people.map((_, k) => `r${k}:search(query:$r${k},type:ISSUE,first:0){issueCount}`).join(' ')}}`, vars);
  return people.map((p, k) => ({ ...p, load: l[`r${k}`].issueCount as number })).sort((a, b) => a.load - b.load || a.login.localeCompare(b.login));
}

export const requestReview = (repo: string, n: number, login: string) =>
  json(`/repos/${repo}/pulls/${n}/requested_reviewers`, { method: 'POST', body: JSON.stringify({ reviewers: [login] }) });

let viewer: Promise<string> | undefined;
export const getViewer = () => (viewer ??= json('/user').then((u) => u.login as string));

// Emails to find someone on Slack: their verified company addresses for the org, then their public email.
export async function getEmails(org: string, logins: string[]): Promise<Record<string, string[]>> {
  const people = await getPeople(org, logins);
  return Object.fromEntries(logins.map((l) => [l, people[l].emails]));
}

// GitHub name and emails per login (verified company emails first), to find people on Slack.
export async function getPeople(org: string, logins: string[]): Promise<Record<string, { name: string | null; emails: string[] }>> {
  if (!logins.length) return {};
  const query = (ls: string[], withOrg: boolean) => {
    const vars = Object.fromEntries(ls.map((l, i) => [`l${i}`, l]));
    const fields = ls.map((_, i) => `u${i}:user(login:$l${i}){name email${withOrg ? ' organizationVerifiedDomainEmails(login:$org)' : ''}}`).join(' ');
    const decl = [...ls.map((_, i) => `$l${i}:String!`), ...(withOrg ? ['$org:String!'] : [])].join(',');
    return graphql(`query(${decl}){${fields}}`, withOrg ? { ...vars, org } : vars, true).then((d) => ls.map((_, i) => d[`u${i}`] ?? null));
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
  const [owner, name] = repo.split('/');
  return (await graphql(`query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviewDecision mergeStateStatus}}}`, { owner, name, n }))
    .repository.pullRequest;
}

export const getPR = (repo: string, n: number): Promise<PR> => json(`/repos/${repo}/pulls/${n}`, undefined, FULL);

export const getFiles = (repo: string, n: number) => paginate<PRFile>(`/repos/${repo}/pulls/${n}/files?per_page=100`);

// Everything a PR page shows first, as one bundle (also cached, and loaded ahead for the list's top PRs).
export type LoadedPR = { pr: PR; files: PRFile[]; threads: Thread[]; conversation: ConversationItem[]; attrs: string | null };
export async function loadPR(repo: string, n: number): Promise<LoadedPR> {
  const pr = await getPR(repo, n);
  const [files, threads, conversation, attrs] = await Promise.all([
    getFiles(repo, n),
    getThreads(repo, n),
    getConversation(repo, n),
    getRaw(pr.head.repo?.full_name ?? repo, '.gitattributes', pr.head.sha),
  ]);
  return { pr, files, threads, conversation, attrs };
}

export async function getRaw(repo: string, path: string, ref: string): Promise<string | null> {
  const res = await gh(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`, {}, 'application/vnd.github.raw');
  if (res.status === 404) return null;
  return (await ok(res)).text();
}

// A reviewer's suggested change: the ```suggestion block in a comment, to replace lines start..end of the head file.
export type Suggestion = { id: number; thread: string; path: string; start: number; end: number; text: string; author: Comment['author'] };
export function suggestionOf(t: Thread, c: Comment): Suggestion | null {
  const m = (c.body ?? '').replace(/\r\n/g, '\n').match(/^```suggestion[^\n]*\n([\s\S]*?)^ *```/m);
  if (!m || !t.line || t.diffSide !== 'RIGHT') return null;
  return { id: c.databaseId, thread: t.id, path: t.path, start: t.startLine ?? t.line, end: t.line, text: m[1], author: c.author };
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
  const additions = [];
  for (const path of new Set(list.map((x) => x.path))) {
    const src = await getRaw(headRepo, path, head);
    if (src == null) throw new Error(`${path} isn't on the branch`);
    const bytes = new TextEncoder().encode(applySuggestions(src, list.filter((x) => x.path === path)));
    additions.push({ path, contents: btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')) });
  }
  const credit = new Map(list.filter((x) => x.author && x.author.login !== me && x.author.databaseId).map((x) => [x.author!.login, x.author!.databaseId]));
  await graphql(
    `mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}`,
    {
      input: {
        branch: { repositoryNameWithOwner: headRepo, branchName: branch },
        expectedHeadOid: head,
        fileChanges: { additions },
        message: {
          headline: list.length > 1 ? 'Apply suggestions from code review' : 'Apply suggestion from code review',
          body: [...credit].map(([login, id]) => `Co-authored-by: ${login} <${id}+${login}@users.noreply.github.com>`).join('\n'),
        },
      },
    },
  );
}

// A short-lived, signed link to a file at a commit, for <img>: unlike the raw bytes it resolves Git LFS files to the
// stored image rather than the LFS pointer. Null if the file isn't there.
export async function getDownloadUrl(repo: string, path: string, ref: string): Promise<string | null> {
  // no-store: the same URL fetched raw (getRaw) may sit in the browser cache, and that cached body isn't JSON.
  const res = await gh(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  return (await (await ok(res)).json()).download_url ?? null;
}

// Images a description or comment shows from a repo (github.com/<repo>/blob/<ref>/<path>?raw=true, or …/raw/…): from a
// private repo they only load signed in to github.com in the same browser, which lgtm isn't (it has the gh token), so
// each is swapped for the API's signed link to that file. Once per image a session.
const signedImages = new Map<string, Promise<string | null>>();
const REPO_IMAGE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/([^/]+)\/([^?#]+)/;
export function signRepoImages(root: ParentNode | null) {
  for (const img of root?.querySelectorAll<HTMLImageElement>('img[src^="https://github.com/"]:not([data-signed])') ?? []) {
    const m = img.src.match(REPO_IMAGE);
    if (!m) continue;
    img.dataset.signed = '';
    let url = signedImages.get(img.src);
    if (!url) signedImages.set(img.src, (url = getDownloadUrl(m[1], decodeURIComponent(m[3]), m[2]).catch(() => null)));
    void url.then((u) => u && (img.src = u));
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
    nodes{id path line startLine originalLine originalStartLine diffSide subjectType isResolved isOutdated viewerCanResolve viewerCanUnresolve
      comments(first:100){nodes{databaseId url body bodyHTML bodyText createdAt author{__typename login ...on User{databaseId}} originalCommit{oid}}}}}}}}`;

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

// Running failed GitHub Actions jobs again: one job (and the jobs that wait on it), or every failed job of a run.
export const rerunJob = async (repo: string, jobId: number) => void (await ok(await gh(`/repos/${repo}/actions/jobs/${jobId}/rerun`, { method: 'POST' })));
export const rerunFailedJobs = async (repo: string, runId: string) =>
  void (await ok(await gh(`/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`, { method: 'POST' })));
// A job's run, from its link (…/actions/runs/<run>/job/<job>).
export const runOf = (c: Check) => c.url?.match(/\/actions\/runs\/(\d+)/)?.[1];

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

// Files marked (or unmarked) as viewed on GitHub: one request for up to 50 (a folder or module at once, from the index).
export async function setViewed(prId: string, paths: string[], viewed: boolean) {
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
  graphql(
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
  const [me, reviews] = await Promise.all([getViewer(), paginate<any>(`/repos/${repo}/pulls/${n}/reviews?per_page=100`)]);
  const r = reviews.filter((r) => r.user?.login === me && r.state !== 'PENDING').at(-1);
  return r ? { sha: r.commit_id, at: r.submitted_at } : null;
}

// Files changed between two commits. status 'diverged' means `base` isn't an ancestor (the PR was rebased).
// commits: how many head has that base doesn't.
export async function getCompare(repo: string, base: string, head: string): Promise<{ status: string; files: PRFile[]; commits: number }> {
  const d = await json(`/repos/${repo}/compare/${base}...${head}`);
  return { status: d.status, files: d.files ?? [], commits: d.ahead_by ?? 0 };
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
  viewerCanDeleteHeadRef: boolean; // only once merged or closed
  isCrossRepository: boolean; // from a fork: its branch isn't ours to delete
  headRefName: string;
  baseRefName: string;
  headRef: { id: string } | null; // null once the branch is gone
  deleteBranchOnMerge: boolean; // the repo deletes merged branches itself
  methods: MergeMethod[]; // allowed in this repo, the viewer's usual one first
  message: Record<MergeMethod, { title: string; body: string }>; // GitHub's default commit message per method
};

const MERGE_STATE = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){
  mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed viewerDefaultMergeMethod deleteBranchOnMerge
  pullRequest(number:$n){id state isDraft mergeable mergeStateStatus reviewDecision headRefOid mergedBy{login}
    isCrossRepository viewerCanDeleteHeadRef headRefName baseRefName headRef{id}
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
    deleteBranchOnMerge: r.deleteBranchOnMerge,
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
// The bottom layer of a stack merged from the stack overview: GitHub's usual method and message, then the next layer
// pointed at what it merged into, then its branch deleted (unless the repo does that, or another PR builds on it).
export async function mergeLayer(repo: string, n: number, next?: number) {
  const s = await getMergeState(repo, n);
  const m = s.methods[0];
  await mergePR(s, m, s.message[m].title, s.message[m].body, false);
  if (next) await json(`/repos/${repo}/pulls/${next}`, { method: 'PATCH', body: JSON.stringify({ base: s.baseRefName }) });
  if (!s.deleteBranchOnMerge && !s.isCrossRepository) await deleteBranch(repo, s);
}

// A merged PR's branch, unless another open PR builds on it (deleting it would close that one).
export async function deleteBranch(repo: string, s: Pick<MergeState, 'headRef' | 'headRefName'>) {
  if (!s.headRef) return;
  const [above] = (await json(`/repos/${repo}/pulls?state=open&per_page=1&base=${encodeURIComponent(s.headRefName)}`)) as PR[];
  if (above) throw new Error(`kept ${s.headRefName}: #${above.number} builds on it`);
  await graphql(`mutation($id:ID!){deleteRef(input:{refId:$id}){clientMutationId}}`, { id: s.headRef.id });
}
export const disableAutoMerge = (id: string) =>
  graphql(`mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){clientMutationId}}`, { id });
export const updateBranch = (s: MergeState) =>
  graphql(`mutation($id:ID!,$oid:GitObjectID){updatePullRequestBranch(input:{pullRequestId:$id,expectedHeadOid:$oid}){clientMutationId}}`, { id: s.id, oid: s.headRefOid });
export const markReady = (id: string) =>
  graphql(`mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){clientMutationId}}`, { id });

// Comments by accounts marked as bots count as bot comments (folded, never awaiting a reply, bot threads).
export function markBots<T extends { comments: { nodes: Pick<Comment, 'author'>[] } }>(threads: T[], bots: Set<string>): T[] {
  if (!bots.size) return threads;
  return threads.map((t) => ({
    ...t,
    comments: { ...t.comments, nodes: t.comments.nodes.map((c) => (c.author && bots.has(c.author.login) ? { ...c, author: { ...c.author, __typename: 'Bot' } } : c)) },
  }));
}

// Does this review thread wait on me? Open and current, last word from a person other than me, and it's my PR or I'm
// in the thread. Outdated threads don't count: the code moved on, and a reply there is nearly always "done".
export function awaitsMe(t: Pick<Thread, 'isResolved' | 'isOutdated'> & { comments: { nodes: Pick<Comment, 'author'>[] } }, me: string, myPR: boolean) {
  const last = t.comments.nodes.at(-1)?.author;
  if (t.isResolved || t.isOutdated || !last || last.login === me || last.__typename === 'Bot') return false;
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
    return { ...i, requested: false, myState: state, reviewedBefore: true };
  });
}

export type ThreadStatus = { awaiting: number; allMineResolved: boolean };

// What changed on a listed PR between two refreshes, worth a notification: new replies waiting on me; on my PR, a
// verdict or its checks finishing.
export function queueNews(was: QueueItem, now: QueueItem, on: { replies: boolean; verdicts: boolean; ci: boolean }): string[] {
  const running = (ci: QueueItem['ci']) => ci === 'PENDING' || ci === 'EXPECTED';
  return [
    on.replies && was.thread && now.thread && now.thread.awaiting > was.thread.awaiting && 'New reply for you',
    on.verdicts && now.authored && now.reviewDecision !== was.reviewDecision && ({ APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested' } as Record<string, string>)[now.reviewDecision ?? ''],
    on.ci && now.authored && running(was.ci) && now.ci && !running(now.ci) && (now.ci === 'SUCCESS' ? 'Checks passed' : 'Checks failed'),
  ].filter((x): x is string => !!x);
}
// Each PR's rough time to review, asked after the list shows (its description and per-file line counts would slow the
// list down).
export async function getEstimates(ids: string[]): Promise<Map<string, Estimate>> {
  const out = new Map<string, Estimate>();
  for (let k = 0; k < ids.length; k += 100) {
    const d = await graphql(`query($ids:[ID!]!){nodes(ids:$ids){... on PullRequest{id body files(first:100){nodes{path additions deletions}}}}}`, { ids: ids.slice(k, k + 100) });
    for (const p of d.nodes) if (p?.id) out.set(p.id, estimate(p.files?.nodes ?? [], p.body));
  }
  return out;
}

export async function getThreadStatus(items: QueueItem[], bots: Set<string> = new Set()): Promise<Map<string, ThreadStatus>> {
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
      const threads = markBots(d[`p${k}`].reviewThreads.nodes as any[], bots);
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
