// GitLab, through glab's sign-in: merge requests in the shapes github.ts gives the rest of lgtm (PR, PRFile, Thread,
// Check, QueueItem, MergeState…), so the review page, the list and the merge box work on them unchanged. github.ts
// hands every call for a GitLab repo here (isLab).
//
// A GitLab repo is "host/group/…/project" (gitlab.com/gitlab-org/cli): GitHub owners have no dots, so a dot in the
// first part says GitLab. An MR is that repo and its iid. GitLab's global IDs travel as "gl:host|gid://…", an MR's as
// "gl:host|path!iid", so the calls that only get an ID (resolve a thread, mark ready, merge…) know where to go.
import { collapseReviews, setOffline } from './github.ts';
import { fetchGlabToken, glabAccounts, knowFace, own, readBots, recordError, agentsAsBots, type GlabAccount } from './platform.ts';
import type { MergedPR, Person, Check, Comment, ConversationItem, Draft, MergeMethod, MergeState, PR, PRFile, PushPoint, QueueItem, ReviewEvent, ReviewState, StackLayer, Thread, LayerStatus, TicketPR, StaleBranch, MyReview } from './github.ts';

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
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const text = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

// --- requests ---

let practice = false;
export const setLabPractice = (on: boolean) => void (practice = on);
const tokens = new Map<string, Promise<string>>();
const tokenOf = (host: string, refresh = false) => {
  if (refresh || !tokens.has(host)) tokens.set(host, fetchGlabToken(host, refresh).catch((e) => (tokens.delete(host), Promise.reject(e))));
  return tokens.get(host)!;
};
const apiOf = async (host: string) => (await glabAccounts()).find((a) => a.host === host)?.api ?? `https://${host}`;
const writes = (path: string, init: RequestInit) =>
  !!init.method && init.method !== 'GET' && init.method !== 'HEAD' && !path.endsWith('/markdown') && (path !== '/graphql' || /^\s*mutation/.test(JSON.parse(String(init.body)).query));

// GitLab's limits are tight (gitlab.com's free plan: about 100 API requests a minute each) and it doesn't let a page read
// what's left of them: at most 4 requests at a time per host, and once it says "too many", none for a minute.
const slow = new Map<string, number>();
const running = new Map<string, number>();
const queued = new Map<string, (() => void)[]>();
const slowError = (host: string) =>
  new Error(`${host} asked lgtm to slow down (its limit on requests a minute): lgtm asks again at ${new Date(slow.get(host)!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`);
async function turn(host: string) {
  if ((running.get(host) ?? 0) >= 4) await new Promise<void>((go) => queued.set(host, [...(queued.get(host) ?? []), go]));
  running.set(host, (running.get(host) ?? 0) + 1);
}
function done(host: string) {
  running.set(host, (running.get(host) ?? 1) - 1);
  queued.get(host)?.shift()?.();
}
async function lab(host: string, path: string, init: RequestInit = {}): Promise<Response> {
  if (practice && writes(path, init)) throw new Error('Practice run: nothing is sent to GitLab');
  if ((slow.get(host) ?? 0) > Date.now()) throw slowError(host);
  await turn(host);
  try {
    return await ask(host, path, init);
  } finally {
    done(host);
  }
}
async function ask(host: string, path: string, init: RequestInit, renewed = false): Promise<Response> {
  const url = `${await apiOf(host)}${path === '/graphql' ? '/api/graphql' : `/api/v4${path}`}`;
  const res = await fetch(url, {
    cache: 'no-cache',
    signal: AbortSignal.timeout(60_000), // a GitLab that stops answering fails the request, not everything after it
    ...init,
    headers: { Authorization: `Bearer ${await tokenOf(host)}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  }).catch((e) => {
    setOffline(true, host);
    throw new Error(`Couldn't reach ${host} (${e.message})`);
  });
  setOffline(false, host);
  if (res.status === 429) {
    slow.set(host, Date.now() + 60_000);
    recordError(`GitLab 429 ${path.split('?')[0]}: too many requests`);
    throw slowError(host);
  }
  if (res.status === 401 && !renewed) {
    // An OAuth token glab signed in with lasts 2 hours, and glab renews it only on its own requests: once, have it renew.
    await tokenOf(host, true).catch(() => {});
    return ask(host, path, init, true);
  }
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

// Whether a GitLab answers again (the offline bar).
export const pingLab = (host: string) => lab(host, '/version').then(() => true, () => false);

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

// GitLab people by Slack-people key (login@host): their name and public email (what GitLab shows anyone).
export async function labPeople(keys: string[]): Promise<Record<string, { name: string | null; emails: string[] }>> {
  const byHost = Map.groupBy(keys, (k) => k.slice(k.lastIndexOf('@') + 1));
  const out: Record<string, { name: string | null; emails: string[] }> = {};
  await Promise.all([...byHost].map(async ([host, ks]) => {
    const d = await gql(host, `query($u:[String!]){users(usernames:$u,first:100){nodes{username name publicEmail}}}`, { u: ks.map((k) => k.slice(0, k.lastIndexOf('@'))) }).catch(() => null);
    for (const u of d?.users?.nodes ?? []) out[`${u.username}@${host}`] = { name: u.name ?? null, emails: u.publicEmail ? [u.publicEmail] : [] };
  }));
  for (const k of keys) out[k] ??= { name: null, emails: [] };
  return out;
}

// --- one MR ---

// detailedMergeStatus first: asked after diffStatsSummary, GitLab answers CONFLICT for a mergeable MR (as of 2026-11).
const MR = `detailedMergeStatus id iid title description descriptionHtml webUrl updatedAt createdAt draft state mergedAt closedAt mergeUser{username}
  author{username avatarUrl bot} assignees{nodes{username bot}} reviewers{nodes{username avatarUrl bot mergeRequestInteraction{reviewState}}}
  sourceBranch targetBranch sourceProject{fullPath} targetProject{fullPath} diffHeadSha diffRefs{baseSha headSha startSha}
  diffStatsSummary{additions deletions fileCount} labels{nodes{title}} approved`;
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
const mrQuery = (fields: string) => `query($p:ID!,$i:String!){project(fullPath:$p){mergeRequest(iid:$i){${fields}}}}${fields === '...F' ? ` ${ITEM}` : ''}`;
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
  nodes{id resolved resolvable userPermissions{resolveNote} truncatedDiffLines{text} notes{nodes{id body bodyHtml system url createdAt author{username avatarUrl bot}
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
  const [{ head, nodes }, drafts, me] = await Promise.all([discussions(repo, n), draftNotes(repo, n).catch(() => []), labMe(host).catch(() => null)]);
  const threads = nodes
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
        // The code it was written on, up to its line (the inbox shows it).
        hunk: d.truncatedDiffLines?.length ? { nodes: [{ diffHunk: ['@@', ...d.truncatedDiffLines.map((l: any) => l.text)].join('\n') }] } : undefined,
      };
    });
  // My draft notes (a review started on GitLab, not yet published): pending, in their thread or a new one of their own.
  for (const dn of drafts) {
    const c: Comment = {
      id: gid(host, `draft:${split(repo).path}!${n}:${dn.id}`), databaseId: -dn.id, url: mrUrl(repo, n), body: dn.note,
      bodyHTML: `<p>${esc(dn.note ?? '').replace(/\n/g, '<br>')}</p>`, bodyText: dn.note ?? '', createdAt: dn.created_at ?? new Date().toISOString(), state: 'PENDING',
      author: me ? { login: me.login, __typename: 'User', avatarUrl: me.avatar } : null,
    };
    const into = dn.discussion_id && threads.find((t) => t.id.endsWith(`/${dn.discussion_id}`));
    const p = dn.position;
    if (into) into.comments.nodes.push(c);
    else if (p?.new_path || p?.old_path) {
      const left = p.new_line == null && p.old_line != null;
      const line = p.position_type === 'text' ? (left ? p.old_line : p.new_line) : null;
      threads.push({ id: c.id!, path: left ? p.old_path : p.new_path, line, originalLine: line, diffSide: left ? 'LEFT' : 'RIGHT', subjectType: line ? 'LINE' : 'FILE', isResolved: false, isOutdated: false, viewerCanResolve: false, viewerCanUnresolve: false, comments: { nodes: [c] } });
    }
  }
  return threads;
}
const VERDICT: [RegExp, ReviewState][] = [[/^approved this merge request/, 'APPROVED'], [/^requested changes/, 'CHANGES_REQUESTED']];
// An overview thread's replies come as comments of their own, in time order (lgtm's conversation is flat), each
// opening with whom it answers and a link to the comment it follows.
export async function getLabConversation(repo: string, n: number): Promise<ConversationItem[]> {
  const { host } = split(repo);
  const { nodes } = await discussions(repo, n);
  const agents = agentsAsBots();
  return nodes
    .filter((d) => !d.notes.nodes[0]?.position)
    .flatMap((d) => d.notes.nodes.map((x: any, k: number) => (k && !x.system ? { ...x, replyTo: d.notes.nodes[0] } : x)))
    .flatMap((x: any): ConversationItem[] => {
      const who = { author: x.author?.username ?? 'ghost', avatar: abs(host, x.author?.avatarUrl) };
      if (x.system) {
        const v = VERDICT.find(([re]) => re.test(x.body))?.[1];
        return v ? [{ id: 'r' + num(x.id), ...who, html: '', at: x.createdAt, url: x.url, state: v, bot: isBot(x.author) }] : [];
      }
      const to = x.replyTo ? `<p class="note">↪ In reply to <a href="${esc(x.replyTo.url)}">@${esc(x.replyTo.author?.username ?? 'ghost')}</a></p>` : '';
      return [{ id: 'c' + num(x.id), ...who, html: to + absHtml(host, x.bodyHtml), at: x.createdAt, url: x.url, bot: isBot(x.author) || (agents && agentSays(x.body)) }];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

// Each diff line's place as GitLab names it, old and new (an added line's old place is where it would be, a removed
// line's new one likewise): what a comment's old_line/new_line and line codes are made of.
type Row = { kind: '+' | '-' | ' '; old: number; new: number };
export function diffRows(patch = ''): Row[] {
  const rows: Row[] = [];
  let o = 0, n = 0;
  for (const raw of patch.split('\n')) {
    const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) [o, n] = [+m[1], +m[2]];
    else if (o && raw && !raw.startsWith('\\')) {
      const kind = raw[0] as Row['kind'];
      rows.push({ kind, old: o, new: n });
      if (kind !== '+') o++;
      if (kind !== '-') n++;
    }
  }
  return rows;
}
const sha1 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
// A line comment's position: an unchanged line names both its old and new line (GitLab wants both), an added one its
// new, a removed one its old; a range of lines adds its two ends as line codes (line_range).
export async function linePosition(x: Pick<Draft, 'path' | 'side' | 'line' | 'startLine'>, patch?: string) {
  const rows = diffRows(patch);
  const find = (line: number) => rows.find((r) => (x.side === 'LEFT' ? r.kind !== '+' && r.old === line : r.kind !== '-' && r.new === line));
  const at = (r: Row | undefined, line: number) =>
    !r ? (x.side === 'LEFT' ? { old_line: line } : { new_line: line }) : r.kind === ' ' ? { old_line: r.old, new_line: r.new } : r.kind === '+' ? { new_line: r.new } : { old_line: r.old };
  const end = find(x.line!);
  const start = x.startLine && x.startLine !== x.line ? find(x.startLine) : undefined;
  if (!start || !end) return at(end, x.line!);
  const code = await sha1(x.path);
  const end_ = (r: Row) => ({ line_code: `${code}_${r.old}_${r.new}`, type: r.kind === '+' ? 'new' : 'old', ...at(r, 0) });
  return { ...at(end, x.line!), line_range: { start: end_(start), end: end_(end) } };
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
// A note changed or taken out; a draft note (gl:host|draft:path!n:id) through the draft notes API.
const draftOf = (id: string) => {
  const m = unId(id).rest.match(/^draft:(.+)!(\d+):(\d+)$/);
  return m && `/projects/${encodeURIComponent(m[1])}/merge_requests/${m[2]}/draft_notes/${m[3]}`;
};
export const editLabNote = (id: string, body: string) =>
  draftOf(id) ? send(unId(id).host, draftOf(id)!, 'PUT', { note: body }) : mutate(unId(id).host, `mutation($id:NoteID!,$b:String!){updateNote(input:{id:$id,body:$b}){errors}}`, { id: unId(id).rest, b: body });
export const deleteLabNote = (id: string) =>
  draftOf(id) ? send(unId(id).host, draftOf(id)!, 'DELETE') : mutate(unId(id).host, `mutation($id:NoteID!){destroyNote(input:{id:$id}){errors}}`, { id: unId(id).rest });

// A review: lgtm's drafts as GitLab draft notes, published together (with any I started on GitLab), then the summary
// and the verdict.
export async function submitLabReview(prId: string, commitOID: string, event: ReviewEvent, body: string, drafts: Draft[]) {
  const { repo, n } = mrOf(prId);
  const { host } = split(repo);
  const base = `/projects/${pid(repo)}/merge_requests/${n}`;
  const refs = (await getMR(repo, n, 'diffRefs{baseSha headSha startSha}')).diffRefs;
  if (refs.headSha !== commitOID) throw new Error('New commits were pushed while you reviewed: reload to see them, then send again');
  const files = drafts.some((x) => x.line) ? await getLabFiles(repo, n) : [];
  for (const x of drafts) {
    const f = files.find((f) => f.filename === x.path);
    const where = { base_sha: refs.baseSha, start_sha: refs.startSha, head_sha: refs.headSha, old_path: f?.previous_filename ?? x.path, new_path: x.path };
    const position = x.line ? { ...where, position_type: 'text', ...(await linePosition(x, f?.patch)) } : { ...where, position_type: 'file' };
    await send(host, `${base}/draft_notes`, 'POST', { note: x.body, position });
  }
  if (drafts.length || (await getLabPending(repo, n))) await send(host, `${base}/draft_notes/bulk_publish`, 'POST');
  if (body) await send(host, `${base}/notes`, 'POST', { body });
  if (event === 'APPROVE') await send(host, `${base}/approve`, 'POST', { sha: commitOID });
  if (event === 'REQUEST_CHANGES') await mutate(host, `mutation($p:ID!,$i:String!){mergeRequestRequestChanges(input:{projectPath:$p,iid:$i}){errors}}`, { p: split(repo).path, i: String(n) });
  forget(repo, n);
}
// An agent's findings (agentreview.ts): as draft notes of mine, not published (pending), or as discussions posted now
// (comment: not as drafts, which publishing would send with any of mine), the summary with them.
export async function postLabAgentFindings(repo: string, n: number, drafts: Draft[], summary: string, mode: 'pending' | 'comment') {
  const { host } = split(repo);
  const base = `/projects/${pid(repo)}/merge_requests/${n}`;
  const refs = (await getMR(repo, n, 'diffRefs{baseSha headSha startSha}')).diffRefs;
  const files = drafts.some((x) => x.line) ? await getLabFiles(repo, n) : [];
  const positionOf = async (x: Draft) => {
    const f = files.find((f) => f.filename === x.path);
    const where = { base_sha: refs.baseSha, start_sha: refs.startSha, head_sha: refs.headSha, old_path: f?.previous_filename ?? x.path, new_path: x.path };
    return x.line ? { ...where, position_type: 'text', ...(await linePosition(x, f?.patch)) } : { ...where, position_type: 'file' };
  };
  if (mode === 'pending') {
    await send(host, `${base}/draft_notes`, 'POST', { note: summary });
    for (const x of drafts) await send(host, `${base}/draft_notes`, 'POST', { note: x.body, position: await positionOf(x) });
  } else {
    await send(host, `${base}/notes`, 'POST', { body: summary });
    for (const x of drafts) await send(host, `${base}/discussions`, 'POST', { body: x.body, position: await positionOf(x) });
  }
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
// A reviewer asked, or no longer: GitLab sets the whole list, so it's read first. One already on it is asked again
// (GitLab's re-request: their review state starts over), as adding them again would change nothing.
export async function setLabReviewer(repo: string, n: number, login: string, on: boolean) {
  const { host, path } = split(repo);
  const now = new Set<string>((await getMR(repo, n, 'reviewers{nodes{username}}')).reviewers.nodes.map((r: any) => r.username));
  if (on && now.has(login)) {
    const u = (await gql(host, `query($u:[String!]){users(usernames:$u,first:1){nodes{id}}}`, { u: [login] })).users?.nodes[0];
    if (!u) throw new Error(`No one called @${login} on ${host}`);
    return mutate(host, `mutation($p:ID!,$i:String!,$u:UserID!){mergeRequestReviewerRereview(input:{projectPath:$p,iid:$i,userId:$u}){errors}}`, { p: path, i: String(n), u: u.id });
  }
  if (on) now.add(login);
  else now.delete(login);
  return mutate(split(repo).host, `mutation($p:ID!,$i:String!,$u:[String!]!){mergeRequestSetReviewers(input:{projectPath:$p,iid:$i,reviewerUsernames:$u,operationMode:REPLACE}){errors}}`, { p: split(repo).path, i: String(n), u: [...now] });
}

// Files I've marked viewed: GitLab keeps that in its own page's browser storage only, so lgtm keeps its own, per MR.
const viewedKey = (repo: string, n: number) => own(`glViewed:${repo}!${n}`);
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
// A file in Git LFS is, in Git, a small pointer naming its real size: that size, lfs set.
export async function getLabBlobInfo(repo: string, path: string, ref: string): Promise<{ size: number; lfs: boolean } | null> {
  const r = await lab(split(repo).host, `${filePath(repo, path)}?ref=${encodeURIComponent(ref)}`, { method: 'HEAD' });
  if (r.status === 404) return null;
  const size = Number(r.headers.get('x-gitlab-size') ?? 0);
  const text = size < 400 ? (await getLabRaw(repo, path, ref)) ?? '' : '';
  const lfs = text.startsWith('version https://git-lfs');
  return { size: lfs ? Number(text.match(/\nsize (\d+)/)?.[1] ?? size) : size, lfs };
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
// Every file at a commit (for where build files sit): null past 1,000 (ten requests; GitLab's limits are tight), as
// GitHub cuts a huge tree short.
export async function labTree(repo: string, sha: string): Promise<{ path: string; type: string }[] | null> {
  const { host } = split(repo);
  const at = `/projects/${pid(repo)}/repository/tree?recursive=true&per_page=100&ref=${sha}`;
  const first = await lab(host, at);
  const total = Number(first.headers.get('x-total-pages'));
  if (!total || total > 10) return null;
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
// The suggestions' authors (other than me) credited as co-authors, by GitLab's no-reply address for them.
export async function commitLabSuggestions(repo: string, branch: string, head: string, files: { path: string; content: string }[], message: string, authors: string[] = []) {
  const { host } = split(repo);
  if (authors.length) {
    const d = await gql(host, `query($u:[String!]){users(usernames:$u,first:100){nodes{id username name}}}`, { u: authors }).catch(() => null);
    const credit = (d?.users?.nodes ?? []).map((u: any) => `Co-authored-by: ${u.name || u.username} <${num(u.id)}-${u.username}@users.noreply.${host}>`);
    if (credit.length) message += `\n\n${credit.join('\n')}`;
  }
  if ((await json(host, `/projects/${pid(repo)}/repository/branches/${encodeURIComponent(branch)}`)).commit.id !== head) throw new Error('The branch moved on since: reload, then commit again');
  return send(host, `/projects/${pid(repo)}/repository/commits`, 'POST', { branch, commit_message: message, actions: files.map((f) => ({ action: 'update', file_path: f.path, content: f.content })) });
}

// --- pipelines as checks ---

const JOB_STATE: Record<string, Check['state']> = { SUCCESS: 'success', FAILED: 'failure', CANCELED: 'neutral', CANCELING: 'neutral', SKIPPED: 'neutral', MANUAL: 'neutral', SCHEDULED: 'neutral' };
const ORDER = ['failure', 'pending', 'success', 'neutral'];
// The head pipeline's jobs (latest try of each), failures first; "stage / job" as GitHub's are "workflow / job".
export async function getLabChecks(repo: string, n: number): Promise<Check[]> {
  const { host } = split(repo);
  const p = (await getMR(repo, n, 'headPipeline{id jobs(first:100){nodes{id name status allowFailure webPath retried canPlayJob stage{name} detailedStatus{label}}}}')).headPipeline;
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
        summary: allowed ? 'failed (allowed to fail)' : j.status === 'MANUAL' ? 'manual: waits to be started' : String(j.detailedStatus?.label ?? j.status).toLowerCase(),
        jobId: num(j.id),
        run: String(num(p.id)),
        // A job waiting for someone to start it (deploy to staging, say), that I may start.
        manual: j.status === 'MANUAL' && !!j.canPlayJob,
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
export const playLabJob = async (repo: string, job: number) => void (await send(split(repo).host, `/projects/${pid(repo)}/jobs/${job}/play`, 'POST'));
export const retryLabJob = async (repo: string, job: number) => void (await send(split(repo).host, `/projects/${pid(repo)}/jobs/${job}/retry`, 'POST'));
export const retryLabPipeline = async (repo: string, pipeline: string) => void (await send(split(repo).host, `/projects/${pid(repo)}/pipelines/${pipeline}/retry`, 'POST'));
// The end of a job's log as GitLab writes it, colours and its collapsible-section markers taken out.
export async function labJobLog(repo: string, job: number): Promise<string> {
  const r = await lab(split(repo).host, `/projects/${pid(repo)}/jobs/${job}/trace`);
  return (await r.text())
    .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z [0-9a-f]{2}[OE]\+? ?/gim, '') // a timestamped log's line prefix (time, stream)
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
// What GitLab says blocks the merge, each in lgtm's words (its merge checks that failed).
const CHECK_TEXT: Record<string, string> = {
  NOT_OPEN: "It isn't open", DRAFT_STATUS: 'This is a draft', CONFLICT: 'Conflicts with the base branch', NEED_REBASE: 'Needs a rebase onto the base branch',
  CI_MUST_PASS: 'Its pipeline must pass', DISCUSSIONS_NOT_RESOLVED: 'Every thread must be resolved', NOT_APPROVED: 'Not approved yet',
  REQUESTED_CHANGES: 'Changes requested', TITLE_REGEX: "Its title doesn't match the project's rule", JIRA_ASSOCIATION_MISSING: 'Needs a Jira issue key in its title or description',
  STATUS_CHECKS_MUST_PASS: 'External status checks must pass', MERGE_TIME: 'Not before its scheduled merge time', MERGE_REQUEST_BLOCKED: 'Blocked by an MR it depends on',
  LOCKED_PATHS: 'Changes paths someone has locked', LOCKED_LFS_FILES: 'Changes LFS files someone has locked', COMMITS_STATUS: 'Its source branch is missing or has no commits',
  SECURITY_POLICY_VIOLATIONS: 'Security policies are violated', SECURITY_POLICY_PIPELINE_CHECK: 'A security policy pipeline must pass',
};
// mergeabilityChecks before the rest: like detailedMergeStatus, it reads wrong after diffStatsSummary.
const MERGE_FIELDS = `mergeabilityChecks{identifier status} approvalState{rules{name approved approvalsRequired approvedBy{nodes{username}} eligibleApprovers{username}}} ${MR} autoMergeEnabled availableAutoMergeStrategies shouldRemoveSourceBranch forceRemoveSourceBranch sourceBranchExists
  defaultMergeCommitMessage defaultSquashCommitMessage commits(first:1){nodes{title}} userPermissions{canMerge pushToSourceBranch removeSourceBranch}`;
export async function getLabMergeState(repo: string, n: number, holdSigns: Holds): Promise<MergeState> {
  const { host } = split(repo);
  const [m, proj] = await Promise.all([getMR(repo, n, MERGE_FIELDS), json(host, `/projects/${pid(repo)}`)]);
  const squash = proj.squash_option as string;
  // The project's merge method decides how it lands: a fast-forward one ("ff") makes no merge commit, so it's offered as
  // rebase (lgtm's name for that), next to squashing as the project allows.
  const plain: MergeMethod = proj.merge_method === 'ff' ? 'REBASE' : 'MERGE';
  const methods: MergeMethod[] = squash === 'always' ? ['SQUASH'] : squash === 'never' ? [plain] : squash === 'default_on' ? ['SQUASH', plain] : [plain, 'SQUASH'];
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
    reasons: state === 'OPEN' ? (m.mergeabilityChecks ?? []).filter((c: any) => c.status === 'FAILED').map((c: any) => ({ id: c.identifier, text: CHECK_TEXT[c.identifier] ?? c.identifier.toLowerCase().replace(/_/g, ' ') })) : [],
    rules: (m.approvalState?.rules ?? [])
      .filter((r: any) => !r.approved && r.approvalsRequired > 0)
      .map((r: any) => ({ name: r.name, required: r.approvalsRequired, approvedBy: r.approvedBy.nodes.map((u: any) => u.username), eligible: (r.eligibleApprovers ?? []).map((u: any) => u.username) })),
  };
}
// Merged now, or once the pipeline passes (auto); refused if commits were pushed since (sha).
// GitLab's refusals as what they mean: 405, it can't merge now (or set auto-merge: its pipeline failed, say); 406, the
// branch can't merge (conflicts, a rule); 409, commits arrived since.
export async function mergeLab(s: MergeState, method: MergeMethod, title: string, body: string, auto: boolean) {
  const { repo, n } = mrOf(s.id);
  const message = [title, body].filter(Boolean).join('\n\n');
  const why: Record<string, string> = {
    '405': auto ? "GitLab won't set auto-merge now: its pipeline has likely failed or finished; reload to see where it stands" : "GitLab won't merge it now: reload to see what's in the way",
    '406': "GitLab can't merge this branch: it may have conflicts, or a project rule blocks it",
    '409': 'New commits were pushed since: reload, then merge again',
  };
  return mergeRequest().catch((e: Error) => Promise.reject(new Error(why[e.message.match(/^GitLab (\d+)/)?.[1] ?? ''] ?? e.message)));
  function mergeRequest() { return send(split(repo).host, `/projects/${pid(repo)}/merge_requests/${n}/merge`, 'PUT', {
    sha: s.headRefOid,
    squash: method === 'SQUASH',
    ...(message && method !== 'REBASE' ? (method === 'SQUASH' ? { squash_commit_message: message } : { merge_commit_message: message }) : {}),
    should_remove_source_branch: s.deleteBranchOnMerge,
    ...(auto ? { auto_merge: true, merge_when_pipeline_succeeds: true } : {}),
  }); }
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

// --- who to ask ---

// Who wrote these lines at the base commit (GitLab's blame names the account), per file: as GitHub's blame ranges.
export async function labBlame(repo: string, base: string, files: { path: string; lines: number[] }[]) {
  const { host, path } = split(repo);
  return Promise.all(files.map(async (f) => {
    const d = await gql(host, `query($p:ID!,$r:String!,$f:String!,$a:Int!,$b:Int!){project(fullPath:$p){repository{blobs(paths:[$f],ref:$r){nodes{blame(fromLine:$a,toLine:$b){groups{lineno span commit{author{username}}}}}}}}}`,
      { p: path, r: base, f: f.path, a: Math.min(...f.lines), b: Math.max(...f.lines) }).catch(() => null);
    const groups: any[] = d?.project?.repository?.blobs?.nodes[0]?.blame?.groups ?? [];
    return groups.map((g) => ({ startingLine: g.lineno, endingLine: g.lineno + g.span - 1, login: g.commit?.author?.username ?? null }));
  }));
}
// Who reviewed the project's last 40 MRs (asked, or approved), and how many each: they know the code.
export async function labRecentReviewers(repo: string): Promise<Map<string, number>> {
  const { host, path } = split(repo);
  const d = await gql(host, `query($p:ID!){project(fullPath:$p){mergeRequests(first:40,sort:UPDATED_DESC){nodes{author{username} reviewers{nodes{username bot}} approvedBy{nodes{username bot}}}}}}`, { p: path });
  const count = new Map<string, number>();
  for (const m of d.project?.mergeRequests?.nodes ?? [])
    for (const login of new Set<string>([...m.reviewers.nodes, ...m.approvedBy.nodes].filter((u: any) => !u.bot && u.username !== m.author?.username).map((u: any) => u.username)))
      count.set(login, (count.get(login) ?? 0) + 1);
  return count;
}
// How many open MRs in the top-level group ask each of them for a review: how busy they are.
export async function labReviewLoad(repo: string, logins: string[]): Promise<Map<string, number>> {
  const { host, path } = split(repo);
  const group = encodeURIComponent(path.split('/')[0]);
  const n = await Promise.all(logins.map((l) => lab(host, `/groups/${group}/merge_requests?state=opened&per_page=1&reviewer_username=${encodeURIComponent(l)}`).then((r) => Number(r.headers.get('x-total') ?? 0), () => 0)));
  return new Map(logins.map((l, k) => [l, n[k]]));
}

// --- teams: GitLab groups ---

// A team is a group of mine, as "host/group/…/subgroup".
export async function getLabTeams(host: string): Promise<string[]> {
  return (await pages<any>(host, '/groups?min_access_level=10&per_page=100')).map((g) => `${host}/${g.full_path}`).sort();
}
export async function getLabTeamMembers(team: string): Promise<string[]> {
  const { host, path } = split(team);
  const all = await pages<any>(host, `/groups/${encodeURIComponent(path)}/members/all?per_page=100`);
  return [...new Set(all.filter((m) => m.state === 'active' && !m.bot && !/^(project|group)_\d+_bot/.test(m.username)).map((m) => m.username as string))].sort((a, b) => a.localeCompare(b));
}
// The group's open MRs by its members, and how many open MRs in the group ask each member for a review.
export async function getLabTeamPRs(team: string): Promise<{ members: string[]; items: QueueItem[]; load: Record<string, number> }> {
  const { host, path } = split(team);
  const [members, me] = await Promise.all([getLabTeamMembers(team), labMe(host)]);
  // The group's open MRs (up to 500, a page of 100 a query): the members' are the team's, and each member's load is how
  // many of them wait on their review.
  const all: any[] = [];
  for (let after: string | null = null, k = 0; k < 5; k++) {
    const d: any = await gql(host, `query($g:ID!,$a:String){group(fullPath:$g){mergeRequests(state:opened,first:100,after:$a,includeSubgroups:true){pageInfo{hasNextPage endCursor} nodes{...F}}}} ${ITEM}`, { g: path, a: after });
    all.push(...(d.group?.mergeRequests?.nodes ?? []));
    if (!d.group?.mergeRequests?.pageInfo.hasNextPage) break;
    after = d.group.mergeRequests.pageInfo.endCursor;
  }
  const team_ = new Set(members);
  const load = Object.fromEntries(members.map((u) => [u, all.filter((m) => m.reviewers.nodes.some((r: any) => r.username === u && WAITING.includes(r.mergeRequestInteraction?.reviewState))).length]));
  return {
    members,
    items: all.filter((m) => team_.has(m.author?.username)).map((m) => itemOf(host, m, me.login)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    load,
  };
}
// The open MRs on a GitLab asking someone for a review and still waiting on them, the longest-waiting first.
export async function getLabAskedPRs(host: string, login: string): Promise<QueueItem[]> {
  const me = (await labMe(host)).login;
  const d = await gql(host, `query($u:String!){user(username:$u){reviewRequestedMergeRequests(state:opened,first:50){nodes{...F}}}} ${ITEM}`, { u: login });
  return ((d.user?.reviewRequestedMergeRequests?.nodes ?? []) as any[])
    .filter((m) => WAITING.includes(m.reviewers.nodes.find((r: any) => r.username === login)?.mergeRequestInteraction?.reviewState))
    .map((m) => itemOf(host, m, me))
    .sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
}

// Draft MRs in these repos changing files I own (CODEOWNERS, by name or through a group of mine): GitLab asks code
// owners only once an MR is ready. `owners`: github.ts codeOwners (GitLab's file reads the same, its [Sections] aside).
const owned = new Map<string, { at: number; text: Promise<string> }>(); // each repo's CODEOWNERS, kept a day
// GitLab's CODEOWNERS as GitHub's reads: a [Section] line's default owners given to its patterns that name none, the
// section lines themselves taken out.
export function sectionOwners(text: string): string {
  let defaults = '';
  return text
    .split('\n')
    .map((line) => {
      const head = line.match(/^\s*\^?\[[^\]]*\](?:\[\d+\])?\s*(.*)$/);
      if (head) return (defaults = head[1].replace(/#.*/, '').trim()), '';
      const bare = line.replace(/#.*/, '').trim();
      return bare && !/\s/.test(bare) && defaults ? `${bare} ${defaults}` : line;
    })
    .join('\n');
}
export async function getLabOwnedDrafts(repos: string[], skip: Set<string>, owners: (text: string, path: string) => string[]): Promise<QueueItem[]> {
  const out: QueueItem[] = [];
  for (const [host, rs] of Map.groupBy(repos, (r) => split(r).host)) {
    const me = (await labMe(host)).login;
    const groups = (await getLabTeams(host).catch(() => [])).map((t) => `@${split(t).path}`.toLowerCase());
    const mine = new Set([`@${me}`.toLowerCase(), ...groups]);
    for (const repo of rs) {
      if (!(owned.get(repo)?.at! > Date.now() - 86_400_000))
        owned.set(repo, { at: Date.now(), text: (async () => {
          for (const at of ['CODEOWNERS', '.gitlab/CODEOWNERS', 'docs/CODEOWNERS']) {
            const t = await getLabRaw(repo, at, 'HEAD').catch(() => null);
            if (t) return sectionOwners(t);
          }
          return '';
        })() });
      const text = await owned.get(repo)!.text;
      if (!text.split(/\s+/).some((w) => mine.has(w.toLowerCase()))) continue;
      const d = await gql(host, `query($p:ID!){project(fullPath:$p){mergeRequests(state:opened,draft:true,first:50){nodes{...F diffStats{path}}}}} ${ITEM}`, { p: split(repo).path }).catch(() => null);
      for (const m of d?.project?.mergeRequests?.nodes ?? []) {
        const item = itemOf(host, m, me);
        if (skip.has(item.id) || item.authored || !(m.diffStats ?? []).some((f: any) => owners(text, f.path).some((o) => mine.has(o.toLowerCase())))) continue;
        out.push({ ...item, requested: true, reviewing: true, codeOwner: true });
      }
    }
  }
  return out;
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
  // The top-level group's MRs; a project under a person (no group) searches its own.
  const where = (await lab(host, `/groups/${encodeURIComponent(path.split('/')[0])}`).catch(() => null))?.ok ? `/groups/${encodeURIComponent(path.split('/')[0])}` : `/projects/${pid(repo)}`;
  for (const k of keys)
    for (const m of await json(host, `${where}/merge_requests?state=all&per_page=30&search=${encodeURIComponent(k)}`).catch(() => []))
      found.set(m.id, m);
  return [...found.values()]
    .map((m): TicketPR => ({
      repo: `${host}/${m.references.full.split('!')[0]}`, number: m.iid, title: m.title, state: m.state === 'opened' ? 'OPEN' : m.state === 'merged' ? 'MERGED' : 'CLOSED',
      isDraft: m.draft, author: m.author?.username ?? 'ghost', keys: keys.filter((k) => new RegExp(`\\b${k}\\b`).test(`${m.title} ${m.source_branch} ${m.description}`)),
    }))
    .filter((p) => p.keys.length && !(p.repo === repo && p.number === n));
}

// --- the PR list ---

// A mention's GitLab to-do marked done (from the inbox's Done), or back to pending (its Undo).
export async function syncLabTodo(c: Comment, done: boolean) {
  const host = unId(c.id!).host, todo = todoOfNote.get(c.databaseId);
  if (!todo) return;
  todoSeen.delete(host);
  if (done) await send(host, `/todos/${todo}/mark_as_done`, 'POST');
  else await mutate(host, `mutation($id:TodoID!){todoRestore(input:{id:$id}){errors}}`, { id: `gid://gitlab/Todo/${todo}` });
}

// MRs merged in the last 14 days that I opened or review, where a thread may wait on my reply (`waits`, github.ts
// awaitsMe): a reply after the merge would otherwise go unseen. 20 of each, newest first.
export async function getLabMergedAwaiting(host: string, me: string, waits: (t: Thread, mine: boolean) => boolean): Promise<MergedPR[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const lists = await Promise.all([`scope=created_by_me`, `scope=all&reviewer_username=${encodeURIComponent(me)}`].map((q) =>
    json(host, `/merge_requests?${q}&state=merged&updated_after=${since}&order_by=updated_at&per_page=20`).catch(() => []) as Promise<any[]>));
  const mrs = [...new Map(lists.flat().map((m) => [m.id, m])).values()];
  const found = await Promise.all(mrs.map(async (m): Promise<MergedPR | null> => {
    const repo = `${host}/${m.references.full.split('!')[0]}`;
    const authored = m.author?.username === me;
    const threads = await getLabThreads(repo, m.iid).catch(() => []);
    if (!threads.some((t) => waits(t, authored))) return null;
    return { id: gid(host, `${m.references.full.split('!')[0]}!${m.iid}`), repo, number: m.iid, title: m.title, authored, mergedAt: m.merged_at, updatedAt: m.updated_at, myState: null };
  }));
  return found.filter((m): m is MergedPR => !!m);
}

// My pending GitLab to-dos where someone @-mentions me on an MR (not a bot's, not one marked done here), the latest
// per MR, as the comment it came with: the inbox's mentions, and the list's "Mentioned you". Kept a minute per host.
const todoSeen = new Map<string, { at: number; v: Promise<Map<string, Comment>> }>();
const todoOfNote = new Map<number, number>(); // a mention's note → its to-do, for marking it done
export function labMentions(host: string): Promise<Map<string, Comment>> {
  const c = todoSeen.get(host);
  if (c && Date.now() - c.at < 60_000) return c.v;
  const v = pages<any>(host, '/todos?state=pending&type=MergeRequest&per_page=100').then(async (todos) => {
    const out = new Map<string, Comment>();
    for (const t of todos.filter((t) => ['mentioned', 'directly_addressed'].includes(t.action_name)).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const note = Number(String(t.target_url).match(/#note_(\d+)$/)?.[1]);
      if (!note || !t.target?.iid || t.target.state !== 'opened' || isBot({ username: t.author?.username, bot: t.author?.bot })) continue;
      if (t.author?.avatar_url) knowFace(t.author.username, abs(host, t.author.avatar_url)!);
      todoOfNote.set(note, t.id);
      out.set(gid(host, `${t.project.path_with_namespace}!${t.target.iid}`), {
        id: gid(host, `gid://gitlab/Note/${note}`),
        databaseId: note,
        url: t.target_url,
        body: t.body,
        bodyHTML: `<p>${esc(t.body ?? '').replace(/\n/g, '<br>')}</p>`,
        bodyText: t.body ?? '',
        createdAt: t.created_at,
        author: { login: t.author?.username ?? 'ghost', __typename: 'User', avatarUrl: abs(host, t.author?.avatar_url) },
      });
    }
    // Each as GitLab renders it; one on a line of code is its thread's (the inbox lists that), not a mention.
    const list = [...out];
    for (let k = 0; k < list.length; k += 20) {
      const part = list.slice(k, k + 20);
      const d = await gql(host, `{${part.map(([, c], j) => `n${j}:note(id:"gid://gitlab/Note/${c.databaseId}"){bodyHtml position{filePath}}`).join(' ')}}`).catch(() => null);
      part.forEach(([id, c], j) => {
        const x = d?.[`n${j}`];
        if (x?.position) out.delete(id);
        else if (x?.bodyHtml) out.set(id, { ...c, bodyHTML: absHtml(host, x.bodyHtml), bodyText: text(absHtml(host, x.bodyHtml)) });
      });
    }
    return out;
  });
  todoSeen.set(host, { at: Date.now(), v });
  v.catch(() => todoSeen.delete(host));
  return v;
}

// Each MR's changed files (path and size) and description, for its rough time to review (files.ts estimate).
export async function labEstimateInputs(items: { id: string }[]): Promise<Map<string, { files: { path: string; additions: number; deletions: number }[]; body: string }>> {
  const out = new Map<string, { files: { path: string; additions: number; deletions: number }[]; body: string }>();
  await Promise.all(items.map(async ({ id }) => {
    const { repo, n } = mrOf(id);
    const m = await getMR(repo, n, 'description diffStats{path additions deletions}').catch(() => null);
    if (m) out.set(id, { files: m.diffStats ?? [], body: m.description ?? '' });
  }));
  return out;
}

const ITEM = `fragment F on MergeRequest{detailedMergeStatus id iid title updatedAt createdAt draft diffHeadSha approved autoMergeEnabled availableAutoMergeStrategies
  project{fullPath} sourceProject{fullPath} sourceBranch targetBranch author{username bot avatarUrl} assignees{nodes{username}}
  reviewers{nodes{username bot mergeRequestInteraction{reviewState}}} headPipeline{status} diffStatsSummary{additions deletions fileCount}
  userPermissions{canMerge} commits(first:1){nodes{committedDate}} mergeTrainIndex}`;
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
    headSha: m.diffHeadSha,
    additions: m.diffStatsSummary?.additions ?? 0,
    deletions: m.diffStatsSummary?.deletions ?? 0,
    files: m.diffStatsSummary?.fileCount ?? 0,
    autoMerge: !!m.autoMergeEnabled,
    canAutoMerge: !!m.userPermissions?.canMerge && !!m.availableAutoMergeStrategies?.length,
    // Its place in the merge train (GitLab's merge queue), when it's on one.
    queue: m.mergeTrainIndex != null ? { position: m.mergeTrainIndex + 1, state: 'QUEUED' } : null,
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
// What GitLab's list lacks, from an MR's notes and commits: since when it waits on me (the last time I was asked, or
// it was marked ready), and on one I approved, the commits written since (not merges in of the base). Kept per MR
// until it changes.
const refined = new Map<string, { at: string; v: Pick<QueueItem, 'waitingSince' | 'newSinceApproval'> }>();
async function refine(i: QueueItem, me: string): Promise<QueueItem> {
  const c = refined.get(i.id);
  if (c?.at === i.updatedAt) return { ...i, ...c.v };
  const { host } = split(i.repo);
  const base = `/projects/${pid(i.repo)}/merge_requests/${i.number}`;
  const [notes, commits] = await Promise.all([
    json(host, `${base}/notes?sort=desc&order_by=created_at&per_page=100`).catch(() => []) as Promise<any[]>,
    i.myState === 'APPROVED' ? (json(host, `${base}/commits?per_page=20`).catch(() => []) as Promise<any[]>) : Promise.resolve([]),
  ]);
  const ready = notes.filter((x) => x.system && /^marked this merge request as \*\*ready\*\*/.test(x.body)).map((x) => x.created_at as string);
  const approved = notes.find((x) => x.system && x.author?.username === me && VERDICT[0][0].test(x.body))?.created_at as string | undefined;
  const v = {
    waitingSince: [i.waitingSince, ...askedAt(notes, me), ...ready].sort().at(-1)!,
    newSinceApproval: approved ? commits.filter((c) => c.parent_ids?.length === 1 && c.authored_date > approved).length : 0,
  };
  refined.set(i.id, { at: i.updatedAt, v });
  return { ...i, ...v };
}

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
        const items = [...all.values()].map((m) => itemOf(host, m, login));
        // MRs where someone mentions me (my to-dos): marked, and the ones not already listed added.
        const mentions = await labMentions(host).catch(() => new Map<string, Comment>());
        const extra = await Promise.all([...mentions.keys()].filter((id) => !items.some((i) => i.id === id)).slice(0, 20).map((id) => {
          const { repo, n } = mrOf(id);
          return getMR(repo, n, '...F').then((m) => itemOf(host, m, login), () => null);
        }));
        const all2 = [...items, ...extra.filter((i): i is QueueItem => !!i)].map((i) => (mentions.has(i.id) && !i.authored ? { ...i, mentioned: true } : i));
        return Promise.all(all2.map((i) => (i.requested || i.myState === 'APPROVED' ? refine(i, login) : i)));
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

// When someone was asked to review it, from GitLab's notes ("requested review from @a and @b").
const askedAt = (notes: any[], login: string) =>
  notes.filter((x) => x.system && /^requested review from /.test(x.body) && new RegExp(`@${login.replace(/[.]/g, '\\.')}\\b`).test(x.body)).map((x) => x.created_at as string).sort();
// Someone's reviews lately (`who`, else mine) on `only`, for History and their page: their approvals, change requests
// and comments on MRs they review, those within 10 minutes of each other as one (collapseReviews), each with how long
// after they were last asked.
export async function getLabMyReviews(days: number, only: string, who?: string): Promise<MyReview[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const out: MyReview[] = [];
  for (const { host, login } of (await glabAccounts()).filter((a) => a.host === only).map((a) => ({ ...a, login: who ?? a.login }))) {
    // Up to 100 MRs, their notes asked 5 MRs a query (GitLab's limits are tight).
    const mrs: any[] = (await json(host, `/merge_requests?scope=all&reviewer_username=${encodeURIComponent(login)}&updated_after=${since}&order_by=updated_at&per_page=100`).catch(() => [])).filter((m: any) => m.author?.username !== login);
    const notesOf = new Map<number, any[]>();
    await Promise.all(Array.from({ length: Math.ceil(mrs.length / 5) }, async (_, c) => {
      const part = mrs.slice(c * 5, c * 5 + 5);
      const d = await gql(host, `{${part.map((m, j) => `m${j}:project(fullPath:${JSON.stringify(m.references.full.split('!')[0])}){mergeRequest(iid:"${m.iid}"){notes(first:100){nodes{system body createdAt author{username}}}}}`).join(' ')}}`).catch(() => null);
      part.forEach((m, j) => notesOf.set(m.id, (d?.[`m${j}`]?.mergeRequest?.notes?.nodes ?? []).map((x: any) => ({ system: x.system, body: x.body, created_at: x.createdAt, author: x.author }))));
    }));
    await Promise.all(mrs.map(async (m) => {
      const notes = (notesOf.get(m.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const reviews = notes
        .filter((x) => x.author?.username === login)
        .map((x) => ({ state: x.system ? VERDICT.find(([re]) => re.test(x.body))?.[1] : 'COMMENTED', submittedAt: x.created_at as string }))
        .filter((r): r is { state: ReviewState; submittedAt: string } => !!r.state);
      for (const r of collapseReviews(reviews, askedAt(notes, login), since))
        out.push({ repo: `${host}/${m.references.full.split('!')[0]}`, number: m.iid, title: m.title, url: m.web_url, author: m.author?.username ?? 'ghost', ...r });
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

// Someone on a GitLab (#/person/login@host): who they are, their open MRs, the open MRs waiting on their review
// (longest first), and their reviews of the last 30 days. Anywhere on that GitLab (it has no "orgs in my list").
export async function getLabPerson(key: string, days = 30): Promise<Person> {
  const host = key.slice(key.lastIndexOf('@') + 1), login = key.slice(0, key.lastIndexOf('@'));
  const me = (await labMe(host)).login;
  const list = (k: string) => gql(host, `query($u:String!){user(username:$u){${k}(state:opened,first:30){nodes{...F}}}} ${ITEM}`, { u: login }).then((d) => (d.user?.[k]?.nodes ?? []) as any[]);
  const [u, mine, asked, reviews] = await Promise.all([
    gql(host, `query($u:String!){user(username:$u){username name avatarUrl bio}}`, { u: login }).then((d) => d.user),
    list('authoredMergeRequests'),
    list('reviewRequestedMergeRequests'),
    getLabMyReviews(days, host, login).catch(() => []),
  ]);
  if (!u) throw new Error(`No one called @${login} on ${host}, or you can't see them`);
  const waitingOn = (m: any) => WAITING.includes(m.reviewers.nodes.find((r: any) => r.username === login)?.mergeRequestInteraction?.reviewState);
  return {
    login: key,
    name: u.name ?? null,
    avatar: abs(host, u.avatarUrl) ?? '',
    bio: u.bio || null,
    mine: mine.map((m) => itemOf(host, m, me)),
    asked: asked.filter(waitingOn).map((m) => itemOf(host, m, me)).sort((a, b) => a.waitingSince.localeCompare(b.waitingSince)),
    reviews: reviews.sort((a, b) => b.at.localeCompare(a.at)),
  };
}
