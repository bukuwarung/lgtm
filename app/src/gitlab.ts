// GitLab, through glab's sign-in: merge requests in the shapes github.ts gives the rest of lgtm (PR, PRFile, Thread,
// Check, QueueItem, MergeState…), so the review page, the list and the merge box work on them unchanged. github.ts
// hands every call for a GitLab repo here (isLab).
//
// A GitLab repo is "host/group/…/project" (gitlab.com/gitlab-org/cli): GitHub owners have no dots, so a dot in the
// first part says GitLab. An MR is that repo and its iid. GitLab's global IDs travel as "gl:host|gid://…", an MR's as
// "gl:host|path!iid", so the calls that only get an ID (resolve a thread, mark ready, merge…) know where to go.
import { fetchGlabToken, glabAccounts, knowFace, readBots, recordError, agentsAsBots, type GlabAccount } from './platform.ts';
import type { Check, Comment, ConversationItem, Draft, MergeMethod, MergeState, PR, PRFile, PushPoint, QueueItem, ReviewEvent, ReviewState, StackLayer, Thread, LayerStatus, TicketPR, StaleBranch, MyReview } from './github.ts';

export const isLab = (repo: string) => repo.slice(0, repo.indexOf('/')).includes('.');
export const isLabId = (id: string) => id.startsWith('gl:');
const split = (repo: string) => ({ host: repo.slice(0, repo.indexOf('/')), path: repo.slice(repo.indexOf('/') + 1) });
const pid = (repo: string) => encodeURIComponent(split(repo).path);
const mrId = (repo: string, n: number) => `gl:${split(repo).host}|${split(repo).path}!${n}`;
const gid = (host: string, id: string) => `gl:${host}|${id}`;
const unId = (id: string) => ({ host: id.slice(3, id.indexOf('|')), rest: id.slice(id.indexOf('|') + 1) });
const mrOf = (id: string) => {
  const { host, rest } = unId(id);
  const i = rest.lastIndexOf('!');
  return { repo: `${host}/${rest.slice(0, i)}`, n: Number(rest.slice(i + 1)) };
};
const num = (g: string) => Number(g.slice(g.lastIndexOf('/') + 1));

// Web addresses, as github.com's are built elsewhere.
export const webOf = (repo: string) => `https://${repo}`;
export const mrUrl = (repo: string, n: number) => `${webOf(repo)}/-/merge_requests/${n}`;
export const blobUrl = (repo: string, ref: string, path: string, line?: number) => `${webOf(repo)}/-/blob/${ref}/${path}${line ? `#L${line}` : ''}`;
const abs = (host: string, url?: string | null) => (url ? (url.startsWith('/') ? `https://${host}${url}` : url) : undefined);
// GitLab renders links to its own pages ("/user", "/uploads/…") without the host.
const absHtml = (host: string, html?: string | null) => (html ?? '').replace(/(\s(?:href|src|data-src)=")\/(?!\/)/g, `$1https://${host}/`);
const text = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

// --- requests ---

let practice = false;
export const setLabPractice = (on: boolean) => void (practice = on);
const tokens = new Map<string, Promise<string>>();
const tokenOf = (host: string) => {
  if (!tokens.has(host)) tokens.set(host, fetchGlabToken(host).catch((e) => (tokens.delete(host), Promise.reject(e))));
  return tokens.get(host)!;
};
const apiOf = async (host: string) => (await glabAccounts()).find((a) => a.host === host)?.api ?? `https://${host}`;
const writes = (path: string, init: RequestInit) =>
  !!init.method && init.method !== 'GET' && init.method !== 'HEAD' && !path.endsWith('/markdown') && (path !== '/graphql' || /^\s*mutation/.test(JSON.parse(String(init.body)).query));

async function lab(host: string, path: string, init: RequestInit = {}): Promise<Response> {
  if (practice && writes(path, init)) throw new Error('Practice run: nothing is sent to GitLab');
  const url = `${await apiOf(host)}${path === '/graphql' ? '/api/graphql' : `/api/v4${path}`}`;
  const res = await fetch(url, {
    cache: 'no-cache',
    ...init,
    headers: { Authorization: `Bearer ${await tokenOf(host)}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  }).catch((e) => {
    throw new Error(`Couldn't reach ${host} (${e.message})`);
  });
  if (res.status === 401) {
    tokens.delete(host);
    throw new Error(`${host} rejected glab's token. Run \`glab auth login --hostname ${host}\`, then reload.`);
  }
  if (!res.ok && res.status !== 404) {
    const body = await res.clone().json().catch(() => null);
    const raw = body?.message ?? body?.error ?? res.statusText;
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    recordError(`GitLab ${res.status} ${path.split('?')[0]}: ${msg}`);
    throw new Error(`GitLab ${res.status}: ${msg}`);
  }
  return res;
}
const json = async (host: string, path: string, init?: RequestInit) => {
  const r = await lab(host, path, init);
  if (r.status === 404) throw new Error(`GitLab 404: ${path.split('?')[0]}`);
  return r.status === 204 ? null : r.json();
};
const send = (host: string, path: string, method: string, body?: unknown) => json(host, path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
// Every page: GitLab names the count of pages (X-Total-Pages; not past 10,000 items), so the rest are fetched at once.
async function pages<T>(host: string, path: string): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?';
  const first = await lab(host, path);
  if (first.status === 404) throw new Error(`GitLab 404: ${path.split('?')[0]}`);
  const out: T[] = await first.json();
  const total = Number(first.headers.get('x-total-pages'));
  if (total > 1) {
    const rest = await Promise.all(Array.from({ length: Math.min(total, 50) - 1 }, (_, k) => lab(host, `${path}${sep}page=${k + 2}`).then((r) => r.json())));
    return out.concat(...rest);
  }
  for (let next = first.headers.get('x-next-page'), k = 0; next && k < 50; k++) {
    const r = await lab(host, `${path}${sep}page=${next}`);
    out.push(...(await r.json()));
    next = r.headers.get('x-next-page');
  }
  return out;
}
async function gql<T = any>(host: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await json(host, '/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) });
  if (r.errors?.length) {
    recordError(`GitLab GraphQL: ${r.errors[0].message}`);
    if (!r.data) throw new Error(r.errors[0].message);
  }
  return r.data;
}
const mutate = async (host: string, query: string, variables: Record<string, unknown>) => {
  const d = await gql(host, query, variables);
  const errs = Object.values(d ?? {}).flatMap((x: any) => x?.errors ?? []);
  if (errs.length) throw new Error(String(errs[0]));
  return d;
};

const viewers = new Map<string, Promise<{ login: string; avatar: string }>>();
// Me on a GitLab host: my username and picture.
export const labMe = (host: string) => {
  if (!viewers.has(host))
    viewers.set(host, json(host, '/user').then((u) => (knowFace(u.username, abs(host, u.avatar_url)!), { login: u.username as string, avatar: abs(host, u.avatar_url)! })).catch((e) => (viewers.delete(host), Promise.reject(e))));
  return viewers.get(host)!;
};
export const getLabViewer = async (repo: string) => (await labMe(split(repo).host)).login;

// --- people ---

type User = { username: string; avatarUrl?: string | null; bot?: boolean } | null;
const person = (host: string, u: User) => {
  if (u?.avatarUrl) knowFace(u.username, abs(host, u.avatarUrl)!);
  return { login: u?.username ?? 'ghost', type: u?.bot ? 'Bot' : 'User', avatar_url: abs(host, u?.avatarUrl) };
};
const isBot = (u: User) => !!u?.bot || readBots().has(u?.username ?? '');
const agentSays = (body?: string | null) => /^\s*(<!--[\s\S]*?-->\s*)*\u{1F916}/u.test(body ?? '');

// --- one MR ---

const MR = `id iid title description descriptionHtml webUrl updatedAt createdAt draft state mergedAt closedAt mergeUser{username}
  author{username avatarUrl bot} assignees{nodes{username bot}} reviewers{nodes{username avatarUrl bot mergeRequestInteraction{reviewState}}}
  sourceBranch targetBranch sourceProject{fullPath} targetProject{fullPath} diffHeadSha diffRefs{baseSha headSha startSha}
  diffStatsSummary{additions deletions fileCount} labels{nodes{title}} approved detailedMergeStatus`;
const WAITING = ['UNREVIEWED', 'REVIEW_STARTED', 'UNAPPROVED'];
const prOf = (host: string, m: any): PR => ({
  number: Number(m.iid),
  title: m.title,
  updated_at: m.updatedAt,
  body: m.description ?? null,
  body_html: absHtml(host, m.descriptionHtml),
  html_url: m.webUrl,
  node_id: gid(host, `${m.targetProject.fullPath}!${m.iid}`),
  user: person(host, m.author),
  assignees: m.assignees.nodes.map((u: User) => person(host, u)),
  requested_reviewers: m.reviewers.nodes.filter((r: any) => WAITING.includes(r.mergeRequestInteraction?.reviewState ?? 'UNREVIEWED')).map((u: User) => person(host, u)),
  requested_teams: [],
  head: { sha: m.diffHeadSha ?? m.diffRefs?.headSha, ref: m.sourceBranch, repo: m.sourceProject ? { full_name: `${host}/${m.sourceProject.fullPath}`, owner: { login: m.sourceProject.fullPath.split('/')[0] } } : null },
  base: { ref: m.targetBranch, sha: m.diffRefs?.baseSha ?? '' },
  draft: m.draft,
  state: m.state === 'opened' ? 'open' : 'closed',
  merged: m.state === 'merged',
  merged_at: m.mergedAt,
  closed_at: m.closedAt ?? m.mergedAt,
  merged_by: m.mergeUser ? { login: m.mergeUser.username } : null,
  additions: m.diffStatsSummary?.additions,
  deletions: m.diffStatsSummary?.deletions,
  changed_files: m.diffStatsSummary?.fileCount,
});
const mrQuery = (fields: string) => `query($p:ID!,$i:String!){project(fullPath:$p){mergeRequest(iid:$i){${fields}}}}`;
const getMR = async (repo: string, n: number, fields = MR) => {
  const { host, path } = split(repo);
  const m = (await gql(host, mrQuery(fields), { p: path, i: String(n) })).project?.mergeRequest;
  if (!m) throw new Error(`GitLab 404: no merge request !${n} in ${path}, or you can't see it`);
  return m;
};
export const getLabPR = async (repo: string, n: number) => prOf(split(repo).host, await getMR(repo, n));

// A short stable mark of a file's diff: what PRFile.sha is for (it changes when the file does).
const mark = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
};
const fileOf = (repo: string, head: string, d: any): PRFile => {
  const lines: string[] = (d.diff ?? '').split('\n');
  return {
    filename: d.new_path,
    previous_filename: d.renamed_file ? d.old_path : undefined,
    status: d.new_file ? 'added' : d.deleted_file ? 'removed' : d.renamed_file ? 'renamed' : 'modified',
    additions: lines.filter((l) => l.startsWith('+')).length,
    deletions: lines.filter((l) => l.startsWith('-')).length,
    // A diff too big to show (or binary) comes without one, as on GitHub.
    patch: d.too_large || d.collapsed || !d.diff ? undefined : d.diff.replace(/\n$/, ''),
    sha: mark(`${d.new_path}\n${d.diff ?? ''}${d.too_large ? 'big' : ''}`),
    blob_url: blobUrl(repo, head, d.new_path),
  };
};
export async function getLabFiles(repo: string, n: number): Promise<PRFile[]> {
  const [diffs, head] = await Promise.all([pages<any>(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/diffs?per_page=100`), getLabHead(repo, n)]);
  return diffs.map((d) => fileOf(repo, head, d));
}

// The MR's discussions, once per load: threads on the code, and the conversation (comments, and verdicts from
// GitLab's own notes: "approved this merge request", "requested changes").
const DISCUSSIONS = `query($p:ID!,$i:String!,$after:String){project(fullPath:$p){mergeRequest(iid:$i){diffHeadSha discussions(first:100,after:$after){pageInfo{hasNextPage endCursor}
  nodes{id resolved resolvable userPermissions{resolveNote} notes{nodes{id body bodyHtml system url createdAt author{username avatarUrl bot}
    position{filePath oldPath newPath oldLine newLine positionType diffRefs{headSha}}}}}}}}}`;
const noteDiscussion = new Map<number, string>(); // note id → its discussion's id, for replies
const seen = new Map<string, { at: number; p: Promise<{ head: string; nodes: any[] }> }>();
const forget = (repo: string, n: number) => seen.delete(`${repo}!${n}`);
function discussions(repo: string, n: number) {
  const k = `${repo}!${n}`;
  const c = seen.get(k);
  if (c && Date.now() - c.at < 3000) return c.p; // one load asks for threads and the conversation at once
  const { host, path } = split(repo);
  const p = (async () => {
    const nodes: any[] = [];
    let head = '';
    for (let after: string | null = null; ; ) {
      const m: any = (await gql(host, DISCUSSIONS, { p: path, i: String(n), after })).project?.mergeRequest;
      if (!m) throw new Error(`GitLab 404: no merge request !${n} in ${path}`);
      head = m.diffHeadSha;
      nodes.push(...m.discussions.nodes);
      if (!m.discussions.pageInfo.hasNextPage) break;
      after = m.discussions.pageInfo.endCursor;
    }
    for (const d of nodes) for (const x of d.notes.nodes) noteDiscussion.set(num(x.id), d.id.slice(d.id.lastIndexOf('/') + 1));
    return { head, nodes };
  })();
  seen.set(k, { at: Date.now(), p });
  p.catch(() => seen.delete(k));
  return p;
}
const commentOf = (host: string, x: any): Comment => {
  if (x.author?.avatarUrl) knowFace(x.author.username, abs(host, x.author.avatarUrl)!);
  const html = absHtml(host, x.bodyHtml);
  return {
    id: gid(host, x.id),
    databaseId: num(x.id),
    url: x.url,
    body: x.body,
    bodyHTML: html,
    bodyText: text(html),
    createdAt: x.createdAt,
    author: x.author ? { login: x.author.username, __typename: isBot(x.author) ? 'Bot' : 'User', avatarUrl: abs(host, x.author.avatarUrl) } : null,
    originalCommit: x.position?.diffRefs?.headSha ? { oid: x.position.diffRefs.headSha } : null,
  };
};
export async function getLabThreads(repo: string, n: number): Promise<Thread[]> {
  const { host } = split(repo);
  const { head, nodes } = await discussions(repo, n);
  return nodes
    .filter((d) => d.notes.nodes[0]?.position && !d.notes.nodes[0].system)
    .map((d): Thread => {
      const p = d.notes.nodes[0].position;
      const left = p.newLine == null && p.oldLine != null;
      const line = p.positionType === 'text' ? (left ? p.oldLine : p.newLine) : null;
      const can = d.resolvable && !!d.userPermissions?.resolveNote;
      return {
        id: gid(host, d.id),
        path: (left ? p.oldPath : p.newPath) ?? p.filePath,
        line,
        originalLine: line,
        diffSide: left ? 'LEFT' : 'RIGHT',
        subjectType: line ? 'LINE' : 'FILE',
        isResolved: !!d.resolved,
        // GitLab moves a note along with its line on each push; one it couldn't keep stays on the old version.
        isOutdated: !!p.diffRefs?.headSha && p.diffRefs.headSha !== head,
        viewerCanResolve: can && !d.resolved,
        viewerCanUnresolve: can && !!d.resolved,
        comments: { nodes: d.notes.nodes.filter((x: any) => !x.system).map((x: any) => commentOf(host, x)) },
      };
    });
}
const VERDICT: [RegExp, ReviewState][] = [[/^approved this merge request/, 'APPROVED'], [/^requested changes/, 'CHANGES_REQUESTED']];
// ponytail: an overview thread's replies come as comments of their own, in time order (lgtm's conversation is flat).
export async function getLabConversation(repo: string, n: number): Promise<ConversationItem[]> {
  const { host } = split(repo);
  const { nodes } = await discussions(repo, n);
  const agents = agentsAsBots();
  return nodes
    .filter((d) => !d.notes.nodes[0]?.position)
    .flatMap((d) => d.notes.nodes)
    .flatMap((x: any): ConversationItem[] => {
      const who = { author: x.author?.username ?? 'ghost', avatar: abs(host, x.author?.avatarUrl) };
      if (x.system) {
        const v = VERDICT.find(([re]) => re.test(x.body))?.[1];
        return v ? [{ id: 'r' + num(x.id), ...who, html: '', at: x.createdAt, url: x.url, state: v, bot: isBot(x.author) }] : [];
      }
      return [{ id: 'c' + num(x.id), ...who, html: absHtml(host, x.bodyHtml), at: x.createdAt, url: x.url, bot: isBot(x.author) || (agents && agentSays(x.body)) }];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

// Draft notes (GitLab's pending review): mine, not yet published.
const draftNotes = (repo: string, n: number) => pages<any>(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/draft_notes?per_page=100`);
export async function getLabPending(repo: string, n: number): Promise<{ id: string; count: number } | null> {
  const drafts = await draftNotes(repo, n);
  return drafts.length ? { id: mrId(repo, n), count: drafts.length } : null;
}
export async function discardLabReview(id: string) {
  const { repo, n } = mrOf(id);
  for (const d of await draftNotes(repo, n)) await send(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/draft_notes/${d.id}`, 'DELETE');
}
export const editLabNote = (id: string, body: string) => mutate(unId(id).host, `mutation($id:NoteID!,$b:String!){updateNote(input:{id:$id,body:$b}){errors}}`, { id: unId(id).rest, b: body });
export const deleteLabNote = (id: string) => mutate(unId(id).host, `mutation($id:NoteID!){destroyNote(input:{id:$id}){errors}}`, { id: unId(id).rest });

// A review: lgtm's drafts as GitLab draft notes, published together (with any I started on GitLab), then the summary
// and the verdict.
export async function submitLabReview(prId: string, commitOID: string, event: ReviewEvent, body: string, drafts: Draft[]) {
  const { repo, n } = mrOf(prId);
  const { host } = split(repo);
  const base = `/projects/${pid(repo)}/merge_requests/${n}`;
  const refs = (await getMR(repo, n, 'diffRefs{baseSha headSha startSha}')).diffRefs;
  if (refs.headSha !== commitOID) throw new Error('New commits were pushed while you reviewed: reload to see them, then send again');
  for (const x of drafts) {
    const position = {
      base_sha: refs.baseSha, start_sha: refs.startSha, head_sha: refs.headSha, old_path: x.path, new_path: x.path,
      ...(x.line ? { position_type: 'text', ...(x.side === 'LEFT' ? { old_line: x.line } : { new_line: x.line }) } : { position_type: 'file' }),
    };
    // ponytail: a comment on lines a–b sits on b (GitLab's line_range wants each end's line code); the range is said.
    const note = x.startLine && x.startLine !== x.line ? `${x.body}\n\n<sub>On lines ${x.startLine}–${x.line}</sub>` : x.body;
    await send(host, `${base}/draft_notes`, 'POST', { note, position });
  }
  if (drafts.length || (await getLabPending(repo, n))) await send(host, `${base}/draft_notes/bulk_publish`, 'POST');
  if (body) await send(host, `${base}/notes`, 'POST', { body });
  if (event === 'APPROVE') await send(host, `${base}/approve`, 'POST', { sha: commitOID });
  if (event === 'REQUEST_CHANGES') await mutate(host, `mutation($p:ID!,$i:String!){mergeRequestRequestChanges(input:{projectPath:$p,iid:$i}){errors}}`, { p: split(repo).path, i: String(n) });
  forget(repo, n);
}
export const replyLab = async (repo: string, n: number, commentId: number, body: string) => {
  if (!noteDiscussion.has(commentId)) await discussions(repo, n);
  const d = noteDiscussion.get(commentId);
  if (!d) throw new Error("Couldn't find that comment's thread: reload, then reply again");
  forget(repo, n);
  return send(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/discussions/${d}/notes`, 'POST', { body });
};
export const commentOnLab = (repo: string, n: number, body: string) => (forget(repo, n), send(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/notes`, 'POST', { body }));
export const resolveLab = (id: string, resolve: boolean) =>
  mutate(unId(id).host, `mutation($id:DiscussionID!,$r:Boolean!){discussionToggleResolve(input:{id:$id,resolve:$r}){errors}}`, { id: unId(id).rest, r: resolve });
export const updateLab = (repo: string, n: number, f: { title: string; body: string }) => send(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}`, 'PUT', { title: f.title, description: f.body });
export const getLabHead = async (repo: string, n: number) => (await getMR(repo, n, 'diffHeadSha')).diffHeadSha as string;
export const markLabReady = (id: string) => {
  const { repo, n } = mrOf(id);
  return mutate(split(repo).host, `mutation($p:ID!,$i:String!){mergeRequestSetDraft(input:{projectPath:$p,iid:$i,draft:false}){errors}}`, { p: split(repo).path, i: String(n) });
};
// A reviewer asked, or no longer: GitLab sets the whole list, so it's read first.
export async function setLabReviewer(repo: string, n: number, login: string, on: boolean) {
  const now = new Set<string>((await getMR(repo, n, 'reviewers{nodes{username}}')).reviewers.nodes.map((r: any) => r.username));
  if (on) now.add(login);
  else now.delete(login);
  return mutate(split(repo).host, `mutation($p:ID!,$i:String!,$u:[String!]!){mergeRequestSetReviewers(input:{projectPath:$p,iid:$i,reviewerUsernames:$u,operationMode:REPLACE}){errors}}`, { p: split(repo).path, i: String(n), u: [...now] });
}

// Files I've marked viewed: GitLab keeps that in its own page's browser storage only, so lgtm keeps its own, per MR.
const viewedKey = (repo: string, n: number) => `glViewed:${repo}!${n}`;
export function getLabViewed(repo: string, n: number): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(viewedKey(repo, n)) ?? '[]'));
  } catch {
    return new Set();
  }
}
export function setLabViewed(prId: string, paths: string[], viewed: boolean) {
  const { repo, n } = mrOf(prId);
  const s = getLabViewed(repo, n);
  for (const p of paths) viewed ? s.add(p) : s.delete(p);
  try {
    localStorage.setItem(viewedKey(repo, n), JSON.stringify([...s]));
  } catch {}
}

// --- the repository ---

const filePath = (repo: string, path: string) => `/projects/${pid(repo)}/repository/files/${encodeURIComponent(path)}`;
export async function getLabRaw(repo: string, path: string, ref: string): Promise<string | null> {
  const r = await lab(split(repo).host, `${filePath(repo, path)}/raw?ref=${encodeURIComponent(ref)}`);
  return r.status === 404 ? null : r.text();
}
export async function getLabBlobInfo(repo: string, path: string, ref: string): Promise<{ size: number; lfs: boolean } | null> {
  const r = await lab(split(repo).host, `${filePath(repo, path)}?ref=${encodeURIComponent(ref)}`, { method: 'HEAD' });
  return r.status === 404 ? null : { size: Number(r.headers.get('x-gitlab-size') ?? 0), lfs: false };
}
// A file for an <img>: its bytes (Git LFS resolved) at a blob: address, since GitLab wants the token on the request.
export async function getLabDownloadUrl(repo: string, path: string, ref: string): Promise<string | null> {
  const r = await lab(split(repo).host, `${filePath(repo, path)}/raw?ref=${encodeURIComponent(ref)}&lfs=true`);
  return r.status === 404 ? null : URL.createObjectURL(await r.blob());
}
export const listLabDir = async (repo: string, path: string, ref?: string) =>
  (await pages<any>(split(repo).host, `/projects/${pid(repo)}/repository/tree?per_page=100&path=${encodeURIComponent(path)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`)).map((e) => ({
    name: e.name as string, path: e.path as string, type: e.type === 'tree' ? 'dir' : 'file',
  }));
// Every file at a commit (for where build files sit): null past 5,000, as GitHub cuts a huge tree short.
export async function labTree(repo: string, sha: string): Promise<{ path: string; type: string }[] | null> {
  const { host } = split(repo);
  const at = `/projects/${pid(repo)}/repository/tree?recursive=true&per_page=100&ref=${sha}`;
  const first = await lab(host, at);
  const total = Number(first.headers.get('x-total-pages'));
  if (!total || total > 50) return null;
  const rest = await Promise.all(Array.from({ length: total - 1 }, (_, k) => lab(host, `${at}&page=${k + 2}`).then((r) => r.json())));
  return [await first.json(), ...rest].flat().map((e: any) => ({ path: e.path, type: e.type === 'blob' ? 'blob' : 'tree' }));
}
// Files changed between two commits; "diverged" when base isn't an ancestor of head (the MR was rebased).
export async function getLabCompare(repo: string, base: string, head: string): Promise<{ status: string; files: PRFile[]; commits: number }> {
  const { host } = split(repo);
  const [d, mb] = await Promise.all([
    json(host, `/projects/${pid(repo)}/repository/compare?from=${base}&to=${head}&straight=false`),
    json(host, `/projects/${pid(repo)}/repository/merge_base?refs[]=${base}&refs[]=${head}`).catch(() => null),
  ]);
  return { status: mb?.id === base ? 'ahead' : 'diverged', files: (d.diffs ?? []).map((x: any) => fileOf(repo, head, x)), commits: d.commits?.length ?? 0 };
}
// The MR's history to show changes after: each commit, and what each push replaced when it rewrote them (a rebase or
// force-push: a version whose head isn't among the commits now), newest first.
const versions = (repo: string, n: number) => pages<any>(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/versions?per_page=100`);
export async function getLabPushPoints(repo: string, n: number): Promise<PushPoint[]> {
  const [commits, vs] = await Promise.all([pages<any>(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/commits?per_page=100`), versions(repo, n)]);
  const ids = new Set(commits.map((c) => c.id));
  return [
    ...commits.map((c): PushPoint => ({ sha: c.id, label: c.title, at: c.committed_date })),
    ...vs.filter((v) => !ids.has(v.head_commit_sha)).map((v): PushPoint => ({ sha: v.head_commit_sha, label: 'Before the force-push', at: v.created_at, force: true })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}
// My latest review (a comment, an approval or a change request): when, and the version (push) it was of.
export async function getLabMyLastReview(repo: string, n: number): Promise<{ sha: string; at: string } | null> {
  const [me, { nodes }, vs] = await Promise.all([getLabViewer(repo), discussions(repo, n), versions(repo, n)]);
  const at = nodes.flatMap((d) => d.notes.nodes).filter((x: any) => x.author?.username === me && (!x.system || VERDICT.some(([re]) => re.test(x.body)))).map((x: any) => x.createdAt as string).sort().at(-1);
  const v = at && vs.filter((v) => v.created_at <= at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return at && v ? { sha: v.head_commit_sha, at } : null;
}
export async function renderLabMarkdown(text: string, repo: string): Promise<string> {
  const { host, path } = split(repo);
  return absHtml(host, (await send(host, '/markdown', 'POST', { text, gfm: true, project: path })).html);
}
// Suggestions committed to the MR's branch as one commit (each file read at head, its suggestions applied); refused
// if the branch moved on.
export async function commitLabSuggestions(repo: string, branch: string, head: string, files: { path: string; content: string }[], message: string) {
  const { host } = split(repo);
  if ((await json(host, `/projects/${pid(repo)}/repository/branches/${encodeURIComponent(branch)}`)).commit.id !== head) throw new Error('The branch moved on since: reload, then commit again');
  return send(host, `/projects/${pid(repo)}/repository/commits`, 'POST', { branch, commit_message: message, actions: files.map((f) => ({ action: 'update', file_path: f.path, content: f.content })) });
}

// --- pipelines as checks ---

const JOB_STATE: Record<string, Check['state']> = { SUCCESS: 'success', FAILED: 'failure', CANCELED: 'neutral', CANCELING: 'neutral', SKIPPED: 'neutral', MANUAL: 'neutral' };
const ORDER = ['failure', 'pending', 'success', 'neutral'];
// The head pipeline's jobs (latest try of each), failures first; "stage / job" as GitHub's are "workflow / job".
export async function getLabChecks(repo: string, n: number): Promise<Check[]> {
  const { host } = split(repo);
  const p = (await getMR(repo, n, 'headPipeline{id jobs(first:100){nodes{id name status allowFailure webPath retried stage{name} detailedStatus{label}}}}')).headPipeline;
  if (!p) return [];
  return (p.jobs.nodes as any[])
    .filter((j) => !j.retried)
    .map((j): Check => {
      const raw = JOB_STATE[j.status] ?? 'pending';
      const allowed = raw === 'failure' && j.allowFailure;
      return {
        name: `${j.stage?.name ? `${j.stage.name} / ` : ''}${j.name}`,
        state: allowed ? 'neutral' : raw,
        url: abs(host, j.webPath) ?? null,
        summary: allowed ? 'failed (allowed to fail)' : String(j.detailedStatus?.label ?? j.status).toLowerCase(),
        jobId: num(j.id),
        run: String(num(p.id)),
      };
    })
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
}
// The base branch's latest pipeline: its jobs' results by name, kept 5 minutes per branch.
const baseSeen = new Map<string, { at: number; v: Promise<Map<string, Check['state']>> }>();
export function labBaseChecks(repo: string, ref: string): Promise<Map<string, Check['state']>> {
  const k = `${repo}@${ref}`;
  if (baseSeen.has(k) && Date.now() - baseSeen.get(k)!.at < 300_000) return baseSeen.get(k)!.v;
  const { host } = split(repo);
  const v = (async () => {
    const out = new Map<string, Check['state']>();
    const [p] = await json(host, `/projects/${pid(repo)}/pipelines?ref=${encodeURIComponent(ref)}&per_page=1`);
    if (p) for (const j of await json(host, `/projects/${pid(repo)}/pipelines/${p.id}/jobs?per_page=100`)) out.set(`${j.stage} / ${j.name}`, JOB_STATE[String(j.status).toUpperCase()] ?? 'pending');
    return out;
  })();
  baseSeen.set(k, { at: Date.now(), v });
  v.catch(() => baseSeen.delete(k));
  return v;
}
export const retryLabJob = async (repo: string, job: number) => void (await send(split(repo).host, `/projects/${pid(repo)}/jobs/${job}/retry`, 'POST'));
export const retryLabPipeline = async (repo: string, pipeline: string) => void (await send(split(repo).host, `/projects/${pid(repo)}/pipelines/${pipeline}/retry`, 'POST'));
// The end of a job's log as GitLab writes it, colours and its collapsible-section markers taken out.
export async function labJobLog(repo: string, job: number): Promise<string> {
  const r = await lab(split(repo).host, `/projects/${pid(repo)}/jobs/${job}/trace`);
  return (await r.text())
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/section_(start|end):\d+:[\w.-]+(\[[^\]]*\])?\r?/g, '')
    .split('\n')
    .map((l) => l.replace(/^.*\r(?!$)/, ''))
    .slice(-60)
    .join('\n')
    .trimEnd();
}

// --- status and merging ---

const decision = (m: any): QueueItem['reviewDecision'] =>
  m.reviewers?.nodes.some((r: any) => r.mergeRequestInteraction?.reviewState === 'REQUESTED_CHANGES') ? 'CHANGES_REQUESTED' : m.approved ? 'APPROVED' : 'REVIEW_REQUIRED';
const MERGE_STATUS: Record<string, MergeState['mergeStateStatus']> = {
  MERGEABLE: 'CLEAN', CONFLICT: 'DIRTY', NEED_REBASE: 'BEHIND', DRAFT_STATUS: 'DRAFT', CHECKING: 'UNKNOWN', UNCHECKED: 'UNKNOWN', PREPARING: 'UNKNOWN', APPROVALS_SYNCING: 'UNKNOWN',
};
const mergeStatus = (s: string) => MERGE_STATUS[s] ?? 'BLOCKED';
export async function getLabStatus(repo: string, n: number) {
  const m = await getMR(repo, n, 'approved detailedMergeStatus reviewers{nodes{mergeRequestInteraction{reviewState}}}');
  return { reviewDecision: decision(m), mergeStateStatus: mergeStatus(m.detailedMergeStatus) };
}

type Holds = (title: string, labels: string[], headCommit: string) => string[];
const MERGE_FIELDS = `${MR} autoMergeEnabled availableAutoMergeStrategies shouldRemoveSourceBranch forceRemoveSourceBranch sourceBranchExists
  defaultMergeCommitMessage defaultSquashCommitMessage commits(first:1){nodes{title}} userPermissions{canMerge pushToSourceBranch removeSourceBranch}`;
export async function getLabMergeState(repo: string, n: number, holdSigns: Holds): Promise<MergeState> {
  const { host } = split(repo);
  const [m, proj] = await Promise.all([getMR(repo, n, MERGE_FIELDS), json(host, `/projects/${pid(repo)}`)]);
  const squash = proj.squash_option as string;
  const methods: MergeMethod[] = squash === 'always' ? ['SQUASH'] : squash === 'never' ? ['MERGE'] : squash === 'default_on' ? ['SQUASH', 'MERGE'] : ['MERGE', 'SQUASH'];
  const msg = (s?: string | null) => ({ title: (s ?? '').split('\n')[0], body: (s ?? '').split('\n').slice(1).join('\n').trim() });
  const state = m.state === 'opened' ? 'OPEN' : m.state === 'merged' ? 'MERGED' : 'CLOSED';
  const canMerge = !!m.userPermissions?.canMerge;
  return {
    id: gid(host, `${m.targetProject.fullPath}!${m.iid}`),
    state,
    isDraft: m.draft,
    mergeable: m.detailedMergeStatus === 'CONFLICT' ? 'CONFLICTING' : ['CHECKING', 'UNCHECKED', 'PREPARING'].includes(m.detailedMergeStatus) ? 'UNKNOWN' : 'MERGEABLE',
    mergeStateStatus: state === 'OPEN' ? mergeStatus(m.detailedMergeStatus) : 'UNKNOWN',
    reviewDecision: decision(m),
    headRefOid: m.diffHeadSha,
    mergedBy: m.mergeUser ? { login: m.mergeUser.username } : null,
    autoMergeRequest: m.autoMergeEnabled ? { mergeMethod: methods[0], enabledBy: null } : null,
    viewerCanMergeAsAdmin: false,
    viewerCanEnableAutoMerge: canMerge && !!m.availableAutoMergeStrategies?.length,
    viewerCanDisableAutoMerge: canMerge && !!m.autoMergeEnabled,
    viewerCanUpdateBranch: !!m.userPermissions?.pushToSourceBranch && m.detailedMergeStatus === 'NEED_REBASE',
    viewerCanDeleteHeadRef: !!m.userPermissions?.removeSourceBranch && m.sourceBranchExists && state !== 'OPEN',
    isCrossRepository: m.sourceProject?.fullPath !== m.targetProject.fullPath,
    headRefName: m.sourceBranch,
    baseRefName: m.targetBranch,
    headRef: m.sourceBranchExists ? { id: gid(host, `branch:${m.sourceBranch}`) } : null,
    deleteBranchOnMerge: !!(m.forceRemoveSourceBranch || m.shouldRemoveSourceBranch || proj.remove_source_branch_after_merge),
    methods,
    message: { MERGE: msg(m.defaultMergeCommitMessage), SQUASH: msg(m.defaultSquashCommitMessage ?? m.title), REBASE: { title: '', body: '' } },
    holds: holdSigns(m.title, m.labels.nodes.map((l: any) => l.title), m.commits?.nodes[0]?.title ?? ''),
  };
}
// Merged now, or once the pipeline passes (auto); refused if commits were pushed since (sha).
export function mergeLab(s: MergeState, method: MergeMethod, title: string, body: string, auto: boolean) {
  const { repo, n } = mrOf(s.id);
  const message = [title, body].filter(Boolean).join('\n\n');
  return send(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/merge`, 'PUT', {
    sha: s.headRefOid,
    squash: method === 'SQUASH',
    ...(message ? (method === 'SQUASH' ? { squash_commit_message: message } : { merge_commit_message: message }) : {}),
    should_remove_source_branch: s.deleteBranchOnMerge,
    ...(auto ? { auto_merge: true, merge_when_pipeline_succeeds: true } : {}),
  });
}
export const cancelLabAutoMerge = (id: string) => {
  const { repo, n } = mrOf(id);
  return send(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/cancel_merge_when_pipeline_succeeds`, 'POST');
};
export const rebaseLab = (id: string) => {
  const { repo, n } = mrOf(id);
  return send(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/rebase`, 'PUT');
};
// A merged MR's branch, unless another open MR builds on it.
export async function deleteLabBranch(repo: string, branch: string) {
  const [above] = await json(split(repo).host, `/projects/${pid(repo)}/merge_requests?state=opened&per_page=1&target_branch=${encodeURIComponent(branch)}`);
  if (above) throw new Error(`kept ${branch}: !${above.iid} builds on it`);
  await send(split(repo).host, `/projects/${pid(repo)}/repository/branches/${encodeURIComponent(branch)}`, 'DELETE');
}

// --- stacks and tickets ---

export async function getLabStack(repo: string, pr: PR): Promise<StackLayer[]> {
  if (pr.head.repo?.full_name !== repo) return [];
  const open = (q: string) => json(split(repo).host, `/projects/${pid(repo)}/merge_requests?state=opened&per_page=10&${q}`) as Promise<any[]>;
  const stack: StackLayer[] = [{ number: pr.number, title: pr.title }];
  for (let base = pr.base.ref; stack.length < 10; ) {
    const [below] = await open(`source_branch=${encodeURIComponent(base)}`);
    if (!below || stack.some((l) => l.number === below.iid)) break;
    stack.unshift({ number: below.iid, title: below.title });
    base = below.target_branch;
  }
  for (let head = pr.head.ref; stack.length < 10; ) {
    const above = await open(`target_branch=${encodeURIComponent(head)}`);
    if (above.length !== 1 || stack.some((l) => l.number === above[0].iid)) break;
    stack.push({ number: above[0].iid, title: above[0].title });
    head = above[0].source_branch;
  }
  return stack.length > 1 ? stack : [];
}
const CI: Record<string, QueueItem['ci']> = { SUCCESS: 'SUCCESS', FAILED: 'FAILURE', CANCELED: 'ERROR', RUNNING: 'PENDING', PENDING: 'PENDING', CREATED: 'PENDING', PREPARING: 'PENDING', WAITING_FOR_RESOURCE: 'PENDING', WAITING_FOR_CALLBACK: 'PENDING', SCHEDULED: 'PENDING', MANUAL: 'PENDING' };
const REVIEW_STATE: Record<string, ReviewState> = { APPROVED: 'APPROVED', REQUESTED_CHANGES: 'CHANGES_REQUESTED', REVIEWED: 'COMMENTED' };
export async function getLabStackStatus(repo: string, numbers: number[]): Promise<Map<number, LayerStatus>> {
  const layers = await Promise.all(numbers.map(async (n): Promise<[number, LayerStatus]> => {
    const m = await getMR(repo, n, 'state draft approved detailedMergeStatus headPipeline{status} author{username} reviewers{nodes{username mergeRequestInteraction{reviewState}}}');
    return [n, {
      number: n,
      state: m.state === 'opened' ? 'OPEN' : m.state === 'merged' ? 'MERGED' : 'CLOSED',
      isDraft: m.draft,
      reviewDecision: decision(m),
      mergeStateStatus: mergeStatus(m.detailedMergeStatus),
      ci: CI[m.headPipeline?.status] ?? null,
      reviewers: m.reviewers.nodes.filter((r: any) => r.username !== m.author?.username).map((r: any) => ({ login: r.username, verdict: REVIEW_STATE[r.mergeRequestInteraction?.reviewState] ?? 'WAITING' })),
    }];
  }));
  return new Map(layers);
}
// The bottom layer merged from the stack overview, the next one pointed at what it merged into. GitLab deletes the
// branch as the merge says (deleteBranchOnMerge).
export async function mergeLabLayer(repo: string, n: number, next: number | undefined, holdSigns: Holds) {
  const s = await getLabMergeState(repo, n, holdSigns);
  const m = s.methods[0];
  await mergeLab(s, m, s.message[m].title, s.message[m].body, false);
  if (next) await send(split(repo).host, `/projects/${pid(repo)}/merge_requests/${next}`, 'PUT', { target_branch: s.baseRefName });
}
// Other MRs naming the same Jira tickets (title, description or branch), across the top-level group's projects.
export async function labTicketPRs(repo: string, n: number, keys: string[]): Promise<TicketPR[]> {
  if (!keys.length) return [];
  const { host, path } = split(repo);
  const found = new Map<number, any>();
  for (const k of keys)
    for (const m of await json(host, `/groups/${encodeURIComponent(path.split('/')[0])}/merge_requests?state=all&per_page=30&search=${encodeURIComponent(k)}`).catch(() => []))
      found.set(m.id, m);
  return [...found.values()]
    .map((m): TicketPR => ({
      repo: `${host}/${m.references.full.split('!')[0]}`, number: m.iid, title: m.title, state: m.state === 'opened' ? 'OPEN' : m.state === 'merged' ? 'MERGED' : 'CLOSED',
      isDraft: m.draft, author: m.author?.username ?? 'ghost', keys: keys.filter((k) => new RegExp(`\\b${k}\\b`).test(`${m.title} ${m.source_branch} ${m.description}`)),
    }))
    .filter((p) => p.keys.length && !(p.repo === repo && p.number === n));
}

// --- the PR list ---

const ITEM = `fragment F on MergeRequest{id iid title updatedAt createdAt draft detailedMergeStatus approved autoMergeEnabled availableAutoMergeStrategies
  project{fullPath} sourceProject{fullPath} sourceBranch targetBranch author{username bot avatarUrl} assignees{nodes{username}}
  reviewers{nodes{username bot mergeRequestInteraction{reviewState}}} headPipeline{status} diffStatsSummary{additions deletions fileCount}
  userPermissions{canMerge} commits(first:1){nodes{committedDate}}}`;
const itemOf = (host: string, m: any, me: string): QueueItem => {
  const mine = m.reviewers.nodes.find((r: any) => r.username === me)?.mergeRequestInteraction?.reviewState;
  const authored = m.author?.username === me;
  const assigned = m.assignees.nodes.some((a: any) => a.username === me);
  const reviewer = !!mine && !authored;
  if (m.author?.avatarUrl) knowFace(m.author.username, abs(host, m.author.avatarUrl)!);
  return {
    id: gid(host, `${m.project.fullPath}!${m.iid}`),
    number: Number(m.iid),
    title: m.title,
    updatedAt: m.updatedAt,
    isDraft: m.draft,
    repo: `${host}/${m.project.fullPath}`,
    headRepo: m.sourceProject ? `${host}/${m.sourceProject.fullPath}` : '',
    head: m.sourceBranch,
    base: m.targetBranch,
    author: m.author?.username ?? 'ghost',
    face: m.author?.username ?? 'ghost',
    reviewDecision: decision(m),
    mergeState: mergeStatus(m.detailedMergeStatus),
    ci: CI[m.headPipeline?.status] ?? null,
    lastCommitAt: m.commits?.nodes[0]?.committedDate ?? '',
    additions: m.diffStatsSummary?.additions ?? 0,
    deletions: m.diffStatsSummary?.deletions ?? 0,
    files: m.diffStatsSummary?.fileCount ?? 0,
    autoMerge: !!m.autoMergeEnabled,
    canAutoMerge: !!m.userPermissions?.canMerge && !!m.availableAutoMergeStrategies?.length,
    queue: null,
    waitingSince: m.createdAt,
    pendingReviewers: m.reviewers.nodes.filter((r: any) => WAITING.includes(r.mergeRequestInteraction?.reviewState)).map((r: any) => r.username),
    changesBy: m.reviewers.nodes.filter((r: any) => r.mergeRequestInteraction?.reviewState === 'REQUESTED_CHANGES').map((r: any) => r.username),
    noReviewers: !m.reviewers.nodes.some((r: any) => !r.bot && r.username !== m.author?.username),
    requested: reviewer && WAITING.includes(mine),
    myState: reviewer ? REVIEW_STATE[mine] ?? null : null,
    newSinceApproval: 0,
    reviewedBefore: reviewer && !!REVIEW_STATE[mine],
    reviewing: reviewer,
    mine: authored || (assigned && !reviewer),
    assigned,
    authored,
    mentioned: false,
  };
};
// My open MRs on every GitLab host glab is signed in to: ones I review, opened, or am assigned. A host that fails is
// noted (Settings → Accounts) and leaves the others, and GitHub's, on the list.
export async function getLabQueue(only?: string): Promise<QueueItem[]> {
  const accounts = (await glabAccounts()).filter((a) => !only || a.host === only);
  if (only && !accounts.length) throw new Error(`glab isn't signed in to ${only}. Run \`glab auth login --hostname ${only}\`, or pick another account from the avatar.`);
  const lists = await Promise.all(
    accounts.map(async ({ host, login }: GlabAccount) => {
      try {
        // One list a query: together they pass GitLab's complexity limit (250).
        const lists = await Promise.all(['reviewRequestedMergeRequests', 'authoredMergeRequests', 'assignedMergeRequests'].map((k) =>
          gql(host, `{currentUser{${k}(state:opened,first:100){nodes{...F}}}} ${ITEM}`).then((d) => d.currentUser?.[k]?.nodes ?? [])));
        const all = new Map<string, any>(lists.flat().map((m: any) => [m.id, m]));
        return [...all.values()].map((m) => itemOf(host, m, login));
      } catch (e) {
        if (only) throw e; // the list is this host's: say why it's empty
        recordError(`GitLab ${host}: ${(e as Error).message}`);
        return [];
      }
    }),
  );
  return lists.flat();
}
// Which of these MRs ("host/path#n") are merged or closed; one that can't be read isn't counted.
export async function labClosed(prs: string[]): Promise<string[]> {
  const states = await Promise.all(prs.map((p) => getMR(p.slice(0, p.lastIndexOf('#')), Number(p.slice(p.lastIndexOf('#') + 1)), 'state').then((m) => m.state, () => 'opened')));
  return prs.filter((_, k) => states[k] !== 'opened');
}

// My reviews lately (the approvals and change requests GitLab noted), for History.
export async function getLabMyReviews(days: number, only: string): Promise<MyReview[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const out: MyReview[] = [];
  for (const { host, login } of (await glabAccounts()).filter((a) => a.host === only)) {
    const mrs: any[] = await json(host, `/merge_requests?scope=all&reviewer_username=${encodeURIComponent(login)}&updated_after=${since}&per_page=50`).catch(() => []);
    await Promise.all(mrs.map(async (m) => {
      const notes = await pages<any>(host, `/projects/${m.project_id}/merge_requests/${m.iid}/notes?per_page=100&sort=asc`).catch(() => []);
      for (const x of notes) {
        const state = x.system && x.author?.username === login && x.created_at >= since && VERDICT.find(([re]) => re.test(x.body))?.[1];
        if (state) out.push({ repo: `${host}/${m.references.full.split('!')[0]}`, number: m.iid, title: m.title, url: m.web_url, author: m.author?.username ?? 'ghost', state, at: x.created_at });
      }
    }));
  }
  return out;
}
// My MRs merged in the last 90 days whose branch is still there (never main, release/…), in the same project.
export async function getLabStaleBranches(only: string): Promise<StaleBranch[]> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const out: StaleBranch[] = [];
  for (const { host } of (await glabAccounts()).filter((a) => a.host === only)) {
    const mrs: any[] = await json(host, `/merge_requests?scope=created_by_me&state=merged&updated_after=${since}&per_page=100`).catch(() => []);
    await Promise.all(mrs.filter((m) => m.source_project_id === m.project_id && !/^(main|master|develop|dev|staging|production|release\/|hotfix\/)/.test(m.source_branch)).map(async (m) => {
      const r = await lab(host, `/projects/${m.project_id}/repository/branches/${encodeURIComponent(m.source_branch)}`).catch(() => null);
      if (r?.ok) out.push({ repo: `${host}/${m.references.full.split('!')[0]}`, number: m.iid, title: m.title, headRefName: m.source_branch, headRef: { id: gid(host, `branch:${m.source_branch}`) } });
    }));
  }
  return out;
}
