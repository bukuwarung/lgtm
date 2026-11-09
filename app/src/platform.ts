import { useEffect, useState } from 'preact/hooks';

// Each account's own data lives under its name (a GitHub login, or a GitLab one as login@host), so switching accounts
// (the avatar) never mixes them: unsent drafts, what you'd seen of a PR, Claude session links, the PR list's team and
// its cached copy, the bell, PRs opened lately, files marked viewed on GitLab, and the saved PR copies. Settings are
// shared. Set once signed in (main.tsx); anything stored without an account moves to it: data from before this
// existed, and a Claude link taken from the address before sign-in (so it's the newer one).
const OWN = /^(drafts:|visit:|claudeFrom:|team$|repliesDone$|notices$|qaSeen:|recent$|queueCache$|glViewed:|agentRuns$)/;
let account = '';
// The account of last time, per site (GitHub's, or a GitLab host's): the next launch starts as it.
const lastKey = () => (viewAs() ? `lastLogin:${viewAs()}` : 'lastLogin');
export const lastLogin = () => {
  try {
    return localStorage.getItem(lastKey()) ?? '';
  } catch {
    return '';
  }
};
export const own = (key: string) => (account && OWN.test(key) ? `@${account}/${key}` : key);
export function setAccount(login: string) {
  account = login;
  if (!login) return;
  try {
    localStorage.setItem(lastKey(), login); // the next launch starts as it, before GitHub (or GitLab) confirms (main.tsx)
    for (const k of Object.keys(localStorage)) if (k.startsWith('queueCache:')) localStorage.removeItem(k); // per site, before accounts kept it
    for (const k of Object.keys(localStorage)) {
      if (!OWN.test(k)) continue;
      localStorage.setItem(own(k), localStorage.getItem(k)!);
      localStorage.removeItem(k);
    }
  } catch {
    // stays where it was
  }
}

// The page is served by bin/lgtm.mjs on a fixed 127.0.0.1 port, so localStorage persists drafts across runs.
// "owner/repo" as lgtm shows it: just the repo's name, unless two owners in sight (the PR list, PRs opened lately) have a
// repo of that name. ponytail: a clash learned after something drew keeps its short name until it draws again.
const owners = new Map<string, Set<string>>();
export function knowRepos(full: string[]) {
  for (const f of full) {
    const i = f.lastIndexOf('/');
    owners.set(f.slice(i + 1), (owners.get(f.slice(i + 1)) ?? new Set()).add(f.slice(0, i)));
  }
}
// GitLab's repos are "host/group/…/project": the name is the last part.
export const repoLabel = (full: string) => ((owners.get(full.slice(full.lastIndexOf('/') + 1))?.size ?? 0) > 1 ? full : full.slice(full.lastIndexOf('/') + 1) || full);

// PRs opened lately, newest first, kept across launches (the clock by Back, the start page, ⌘K): the last 30.
export type RecentPR = { repo: string; n: number; title: string; author: string; state?: 'merged' | 'closed' | 'draft'; at: number };
export function recentPRs(): RecentPR[] {
  try {
    const list: RecentPR[] = JSON.parse(localStorage.getItem(own('recent')) ?? '[]');
    knowRepos(list.map((r) => r.repo));
    return list;
  } catch {
    return [];
  }
}
export function rememberPR(p: Omit<RecentPR, 'at'>) {
  try {
    const list = [{ ...p, at: Date.now() }, ...recentPRs().filter((r) => r.repo !== p.repo || r.n !== p.n)].slice(0, 30);
    localStorage.setItem(own('recent'), JSON.stringify(list));
    dispatchEvent(new Event('lgtm:recent'));
  } catch {
    // not kept
  }
}
export function useRecentPRs() {
  const [list, setList] = useState(recentPRs);
  useEffect(() => {
    const h = () => setList(recentPRs());
    addEventListener('lgtm:recent', h);
    return () => removeEventListener('lgtm:recent', h);
  }, []);
  return list;
}

export const storage = {
  get: async <T>(key: string): Promise<T | undefined> => {
    const v = localStorage.getItem(own(key));
    return v == null ? undefined : JSON.parse(v);
  },
  set: async (key: string, value: unknown) => {
    localStorage.setItem(own(key), JSON.stringify(value));
    dispatchEvent(new Event('lgtm:storage')); // the PR list shows unsent comments
  },
  remove: async (key: string) => {
    localStorage.removeItem(own(key));
    dispatchEvent(new Event('lgtm:storage'));
  },
};

// The last-loaded copy of recently opened PRs (IndexedDB: diffs can outgrow localStorage), so a PR shows at once
// and refreshes behind. Keeps the 30 most recent; any failure just means no copy.
const PR_CACHE_SIZE = 30;
let cacheDb: Promise<IDBDatabase> | undefined;
const openCache = () =>
  (cacheDb ??= new Promise((ok, no) => {
    const r = indexedDB.open('lgtm', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('prs');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  }));
const done = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => no(r.error))));
export const prCache = {
  async get<T>(key: string): Promise<{ v: T; at: number } | undefined> {
    try {
      return await done((await openCache()).transaction('prs').objectStore('prs').get(`@${account}/${key}`));
    } catch {
      return undefined;
    }
  },
  async set(key: string, v: unknown) {
    try {
      const store = (await openCache()).transaction('prs', 'readwrite').objectStore('prs');
      store.put({ v, at: Date.now() }, `@${account}/${key}`);
      const [keys, rows] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
      const old = keys.map((k, i) => [k, rows[i].at] as const).sort((a, b) => b[1] - a[1]).slice(PR_CACHE_SIZE);
      for (const [k] of old) store.delete(k);
    } catch {}
  },
};

// Inside the macOS app (desktop/, Tauri) the page reaches the CLIs through app commands instead of the local server.
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
if (isDesktop) document.documentElement.classList.add('desktop'); // styles for the app's own window (top bar)

// No autocorrect or auto-capitals in any text field (macOS rewrites code, logins and paths otherwise); one-line fields
// skip spell-check too, comment boxes keep its underlines. Set on focus, so fields added later are covered.
if (typeof window !== 'undefined')
  addEventListener('focusin', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    if (el instanceof HTMLInputElement) el.spellcheck = false;
  });
const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args);
// Tauri rejects with the command's error string; make it an Error like the web path's.
const command = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  invoke<T>(cmd, args).catch((e) => {
    throw e instanceof Error ? e : new Error(String(e));
  });

// The gh account lgtm uses (Settings → Accounts), when gh is signed in to more than one; '' is gh's active one.
export const ghAccount = () => {
  try {
    return localStorage.getItem('ghAccount') ?? '';
  } catch {
    return '';
  }
};

// The local server (or, in the app, its command) answers with `gh auth token`. An account gh has since signed out
// of falls back to its active one.
export async function fetchToken(): Promise<string> {
  const user = ghAccount();
  try {
    if (isDesktop) return await command<string>('gh_token', { user });
    const res = await fetch('/token?user=' + encodeURIComponent(user));
    if (!res.ok) throw new Error((await res.text()) || 'Could not get a token from the lgtm server.');
    return await res.text();
  } catch (e) {
    if (!user) throw e;
    localStorage.removeItem('ghAccount');
    return fetchToken();
  }
}

// Faces of GitLab people met (their account pictures), by username, kept across launches (the latest 500): GitHub's
// are found by login, GitLab has no such address. ponytail: one name on both GitHub and GitLab shows the GitLab face
// once it's been seen.
const faces = new Map<string, string>(((): [string, string][] => {
  try {
    return JSON.parse(localStorage.getItem('glFaces') ?? '[]');
  } catch {
    return [];
  }
})());
let facesSaving = 0;
export const knowFace = (login: string, url: string) => {
  if (faces.get(login) === url) return;
  faces.delete(login);
  faces.set(login, url);
  clearTimeout(facesSaving);
  facesSaving = setTimeout(() => {
    try {
      localStorage.setItem('glFaces', JSON.stringify([...faces].slice(-500)));
    } catch {}
  }, 1000) as unknown as number;
};
// GitHub's by name from its avatars host (github.com/<login>.png redirects there, and can stall in the app's webview).
export const faceOf = (login: string, size = 40) => faces.get(login) ?? `https://avatars.githubusercontent.com/${encodeURIComponent(login.replace(/\[bot\]$/, ''))}?s=${size}`;

// The words of a site, for what lgtm says: GitHub's pull requests (PRs) and teams, GitLab's merge requests (MRs) and
// groups. For a repo, its site's; without one, the account on show's (the avatar's menu); or true for GitLab's.
export const term = (where?: string | boolean) => {
  const lab = typeof where === 'boolean' ? where : where ? where.slice(0, where.indexOf('/')).includes('.') : !!viewAs();
  return lab
    ? { PR: 'MR', PRs: 'MRs', PRs_: "MR's", pr: 'merge request', prs: 'merge requests', Pr: 'Merge request', Prs: 'Merge requests', Team: 'Group', Teams: 'Groups', team: 'group', teams: 'groups', site: 'GitLab' }
    : { PR: 'PR', PRs: 'PRs', PRs_: "PR's", pr: 'pull request', prs: 'pull requests', Pr: 'Pull request', Prs: 'Pull requests', Team: 'Team', Teams: 'Teams', team: 'team', teams: 'teams', site: 'GitHub' };
};

// A fixed text in the site's words (PR → MR, pull request → merge request, team → group), for labels written once.
export const words = (text: string, where?: string | boolean) => {
  const t = term(where);
  return text
    .replace(/\bpull request(s?)\b/g, (_, s) => (s ? t.prs : t.pr))
    .replace(/\bPR('s|s)?\b/g, (_, s) => (s === 's' ? t.PRs : s ? t.PRs_ : t.PR))
    .replace(/\bTeam(s?)\b/g, (_, s) => (s ? t.Teams : t.Team))
    .replace(/\bteam(s?)\b/g, (_, s) => (s ? t.teams : t.team));
};

// A team as lgtm shows it: GitHub's "org/slug"; a GitLab group by its path alone (the account on show names the host).
export const teamLabel = (team: string) => (team.slice(0, team.indexOf('/')).includes('.') ? team.slice(team.indexOf('/') + 1) : team);

// The words of the PR on show (the page's address names it: a GitLab MR's starts with its host), else the account's.
export const pageTerm = () => {
  const m = decodeURIComponent(location.hash).match(/^#\/?(?:https?:\/\/)?([^/]+)\/.*\/(?:pull|-\/merge_requests)\/\d+/);
  return m ? term(m[1].includes('.') && !/^(www\.)?github\.com$/.test(m[1])) : term();
};

// GitLab through glab: the hosts it's signed in to (each with the account and where its API is), and a host's token,
// asked of the local server (or, in the app, its command) like gh's.
export type GlabAccount = { host: string; login: string; api: string };
// Who someone is to lgtm's Slack people (the mapping, DMs, statuses): a GitHub login, or a GitLab one as login@host, so
// a GitLab name never reaches the GitHub person who happens to have it.
export const personKey = (repo: string, login: string) => (repo.slice(0, repo.indexOf('/')).includes('.') ? `${login}@${repo.slice(0, repo.indexOf('/'))}` : login);
// Whose PRs lgtm shows (the avatar's menu): GitHub's account (''), or a GitLab host's, by its host.
export const viewAs = () => {
  try {
    return localStorage.getItem('viewAs') ?? '';
  } catch {
    return '';
  }
};
let glabList: Promise<GlabAccount[]> | undefined;
export const glabAccounts = (fresh = false): Promise<GlabAccount[]> =>
  (fresh || !glabList ? (glabList = (isDesktop ? command<GlabAccount[]>('glab_accounts') : fetch('/glab-accounts').then((r) => (r.ok ? r.json() : []))).then((a) => (Array.isArray(a) ? a : []), () => [])) : glabList);
// `refresh`: have glab renew an expired (OAuth) token first.
export async function fetchGlabToken(host: string, refresh = false): Promise<string> {
  if (isDesktop) return command<string>('glab_token', { host, refresh });
  const res = await fetch('/glab-token?host=' + encodeURIComponent(host) + (refresh ? '&refresh=1' : ''));
  if (!res.ok) throw new Error((await res.text()) || `Could not get a GitLab token for ${host}.`);
  return res.text();
}

// The Slack workspace's custom emoji (name → image, or ":name:" for an alias), loaded once; {} without Slack.
let slackEmojiList: Promise<Record<string, string>> | undefined;
export const getSlackEmoji = () =>
  (slackEmojiList ??= (isDesktop ? command<Record<string, string>>('slack_emoji') : fetch('/slack-emoji').then((r) => (r.ok ? r.json() : {}))).catch(() => ({})));

// People met on PRs you open (authors, reviewers, commenters), so Settings → Slack → People lists them to map, not just
// your team; the 200 most recent.
export function rememberPeople(logins: string[]) {
  try {
    const was: string[] = JSON.parse(localStorage.getItem('peopleSeen') ?? '[]');
    const now = [...new Set([...logins.filter((l) => l && !l.endsWith('[bot]') && l !== 'ghost'), ...was])].slice(0, 200);
    localStorage.setItem('peopleSeen', JSON.stringify(now));
  } catch {
    // not remembered
  }
}
export const peopleSeen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('peopleSeen') ?? '[]');
  } catch {
    return [];
  }
};
// Open Settings → Slack → People at someone, to map them (it looks them up on Slack there).
export function mapOnSlack(login: string) {
  rememberPeople([login]);
  try {
    localStorage.setItem('slackPeopleFocus', login);
  } catch {}
  location.hash = '/settings';
}

export type GhAccount = { login: string; active: boolean };
export async function getGhAccounts(): Promise<GhAccount[]> {
  if (isDesktop) return command<GhAccount[]>('gh_accounts');
  const res = await fetch('/gh-accounts');
  return res.ok ? res.json() : [];
}

// A remembered on/off UI preference (sidebar visibility etc.). Storage failures just mean it isn't remembered.
// Every user of a key sees a change at once (the settings page and the views it configures are on screen together).
export function useStoredValue(key: string, initial: string) {
  const read = () => {
    try {
      return localStorage.getItem(own(key)) ?? initial;
    } catch {
      return initial;
    }
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    const sync = (e: Event) => (e as CustomEvent).detail === key && setValue(read());
    addEventListener('lgtm:pref', sync);
    return () => removeEventListener('lgtm:pref', sync);
  }, [key]);
  const set = (v: string) => {
    setValue(v);
    try {
      localStorage.setItem(own(key), v);
    } catch {
      // not remembered
    }
    dispatchEvent(new CustomEvent('lgtm:pref', { detail: key }));
  };
  return [value, set] as const;
}

// GitHub accounts you've marked as bots (automation users GitHub sees as people): treated like GitHub's own bots.
// Settings → "Comments that open with 🤖 are a bot's": agents posting from people's accounts say so that way.
export const agentsAsBots = () => {
  try {
    return localStorage.getItem('agentsAsBots') === '1';
  } catch {
    return false;
  }
};
export const readBots = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem('bots') ?? '[]'));
  } catch {
    return new Set();
  }
};
export function useBots() {
  const [raw, set] = useStoredValue('bots', '[]');
  const bots = new Set<string>(JSON.parse(raw || '[]'));
  const toggleBot = (login: string) => {
    bots.has(login) ? bots.delete(login) : bots.add(login);
    set(JSON.stringify([...bots].sort()));
  };
  return { bots, toggleBot };
}

// A pop-up's way out, the same everywhere: Esc, or a press outside it (`inside`: a selector for what counts as part of it,
// its own button included).
export function useDismiss(open: boolean, close: () => void, inside: string) {
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !(e.target as Element).closest?.(inside) && close();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('pointerdown', away);
    addEventListener('keydown', esc);
    return () => (removeEventListener('pointerdown', away), removeEventListener('keydown', esc));
  }, [open]);
}

// Whether a media query holds (the window's width, say), kept current as it changes.
export function useMedia(query: string) {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const q = matchMedia(query);
    const change = () => setOn(q.matches);
    q.addEventListener('change', change);
    addEventListener('resize', change); // some web views don't report the query's change on a resize
    change();
    return () => (q.removeEventListener('change', change), removeEventListener('resize', change));
  }, [query]);
  return on;
}

export function useStoredFlag(key: string, initial: boolean) {
  const [v, set] = useStoredValue(key, initial ? '1' : '0');
  return [v === '1', () => set(v === '1' ? '0' : '1')] as const;
}

// Saved replies (Settings): offered in every comment box after "/" at the start of a line, or from its toolbar.
export type SavedReply = { title: string; body: string };
const REPLIES: SavedReply[] = [
  { title: 'test', body: 'Could we add a test for this?' },
  { title: 'why', body: "Could you add a comment on why this is needed? It isn't obvious from the code." },
  { title: 'nit', body: 'nit: ' },
  { title: 'lgtm', body: 'Looks good to me 👍' },
];
export function useSavedReplies() {
  const [raw, setRaw] = useStoredValue('savedReplies', JSON.stringify(REPLIES));
  let list: SavedReply[] = REPLIES;
  try {
    list = JSON.parse(raw);
  } catch {}
  return [list, (next: SavedReply[]) => setRaw(JSON.stringify(next))] as const;
}

// Whether bot comments and bot-only threads start folded (Settings): on your own PRs they stay open unless asked,
// since there they're usually yours to act on (failed checks, AI review findings).
export function useFoldBots(myPR: boolean) {
  const [fold] = useStoredFlag('foldBots', true);
  const [openOnMine] = useStoredFlag('unfoldBotsOnMine', true);
  return fold && !(myPR && openOnMine);
}

// GitHub login → Slack user ID, kept in your lgtm config; finding goes through slackcli.
export type SlackPeople = { mine: Record<string, string> };
export type SlackMatch = { login: string; id?: string; label?: string; display?: string; via?: 'email' | 'name' | 'username' | 'search'; candidates?: Omit<SlackMatch, 'login' | 'candidates'>[] };
async function call<T>(method: string, body?: any): Promise<T> {
  if (isDesktop)
    return method === 'GET' ? command<T>('slack_people_get') : method === 'POST' ? command<T>('slack_people_find', body) : command<T>('slack_people_save', { map: body });
  const res = await fetch('/slack-people', { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const d = await res.json().catch(() => ({ error: 'the running lgtm is older than this page. Restart it (Ctrl-C, then lgtm) and reload.' }));
  if (!res.ok) throw new Error(d.error);
  return d;
}
export const getSlackPeople = () => call<SlackPeople>('GET');
// People's Slack statuses (by GitHub login, the ones mapped to Slack), for picking a reviewer (slackmsg.ts isAway).
export type SlackPresence = { text: string; emoji: string; until: number };
// The same, for any part of lgtm: kept 10 minutes per person, asked once for everyone missing; every user of it
// redraws when new statuses arrive.
const presenceSeen = new Map<string, { at: number; v: SlackPresence | null }>();
// `repo`: whose site the logins are on (a GitLab repo's people are asked as login@host, and come back by login).
export function usePresence(names: string[], repo = ''): Record<string, SlackPresence> {
  const logins = repo ? names.filter(Boolean).map((l) => personKey(repo, l)) : names;
  const key = [...new Set(logins.filter(Boolean))].sort().join();
  const [, tick] = useState(0);
  useEffect(() => {
    const redraw = () => tick((t) => t + 1);
    addEventListener('lgtm:presence', redraw);
    const stale = key ? key.split(',').filter((l) => (presenceSeen.get(l)?.at ?? 0) < Date.now() - 10 * 60_000) : [];
    if (stale.length) {
      for (const l of stale) presenceSeen.set(l, { at: Date.now(), v: presenceSeen.get(l)?.v ?? null }); // asking: no one else asks
      slackPresence(stale).then((r) => {
        for (const l of stale) presenceSeen.set(l, { at: Date.now(), v: r[l] ?? null });
        dispatchEvent(new Event('lgtm:presence'));
      }, () => {});
    }
    return () => removeEventListener('lgtm:presence', redraw);
  }, [key]);
  const back = (k: string) => (repo && k.includes('@') ? k.slice(0, k.lastIndexOf('@')) : k);
  return Object.fromEntries((key ? key.split(',') : []).flatMap((l) => (presenceSeen.get(l)?.v ? [[back(l), presenceSeen.get(l)!.v!]] : [])));
}
export async function slackPresence(logins: string[]): Promise<Record<string, SlackPresence>> {
  if (!logins.length) return {};
  if (isDesktop) return command<Record<string, SlackPresence>>('slack_presence', { logins });
  const res = await fetch(`/slack-presence?logins=${encodeURIComponent(logins.join(','))}`);
  return res.ok ? res.json() : {};
}
export const findSlackPeople = (people: { login: string; name: string | null; emails: string[]; query?: string }[]) => call<SlackMatch[]>('POST', { people });
export const saveSlackPeople = (map: Record<string, string>) => call<SlackPeople>('PUT', map);

// GitHub is the gh login (in the page); this asks the server about the CLIs it drives: slackcli and acli.
export type Integrations = { slack: { ok: boolean; error?: string; who?: string }; jira: { ok: boolean; error?: string; site?: string } };
export async function fetchIntegrations(): Promise<Integrations> {
  if (isDesktop) return command<Integrations>('integrations');
  const res = await fetch('/integrations').catch(() => {
    throw new Error("lgtm isn't running. Start it with the lgtm-web command, then reload.");
  });
  // An lgtm started before this page existed doesn't know the route: the page is newer than the running server.
  if (!res.ok) throw new Error('the running lgtm is older than this page. Restart it (Ctrl-C, then lgtm) and reload.');
  return res.json();
}

// Slack DMs go through the local server, which runs slackcli (it holds the Slack sign-in).
// Whether slackcli is signed in, and if not, why (shown in the submit panel instead of the Slack option).
// `pr` ("owner/repo#12") also returns links to that PR's Slack threads.
export type SlackThread = { login: string; url: string; name?: string; image?: string }; // name, image: their Slack profile
export const slackStatus = (pr: string): Promise<{ configured: boolean; error?: string; threads: SlackThread[] }> =>
  isDesktop ? command<{ configured: boolean; error?: string; threads: SlackThread[] }>('slack_status', { pr }).then((d) => ({ ...d, error: d.error ?? undefined })) :
  fetch(`/slack?pr=${encodeURIComponent(pr)}`)
    .then((r) => r.json())
    .then((d) => ({ configured: !!d.configured, error: d.error, threads: d.threads ?? [] }), (e) => ({ configured: false, error: e.message, threads: [] }));

export type SlackResult = { login: string; ok: boolean; threaded?: boolean; error?: string };
// `thread` ("owner/repo#12") keeps one Slack thread per PR and person; later reviews reply in it.
export async function notifySlack(recipients: { login: string; emails: string[] }[], text: string, thread: string): Promise<SlackResult[]> {
  if (isDesktop) return command<SlackResult[]>('slack_notify', { recipients, text, thread });
  const res = await fetch('/slack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients, text, thread }) });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error ?? 'Slack request failed');
  return d;
}

// A message in a Slack channel (an ID, #name or channel link): the QA request. Its link back, when Slack gives one.
// Kept with the PR's Slack threads (pr: "owner/repo#n"), as login "#qa".
export async function postSlack(channel: string, text: string, pr: string): Promise<{ url: string | null }> {
  if (isDesktop) return command<{ url: string | null }>('slack_post', { channel, text, pr });
  const res = await fetch('/slack-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, text, pr }) });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error ?? 'Slack request failed');
  return d;
}
// Does a channel exist (nothing is sent)? Its name when Slack gives one.
export type ChannelCheck = { ok: boolean; name?: string; id?: string; error?: string };
export async function checkSlackChannel(channel: string): Promise<ChannelCheck> {
  if (isDesktop) return command<ChannelCheck>('slack_channel', { channel });
  const res = await fetch(`/slack-channel?c=${encodeURIComponent(channel)}`);
  const d = await res.json();
  if (!res.ok) throw new Error(d.error ?? 'Slack request failed');
  return d;
}
// The QA request's replies on Slack, per PR ("owner/repo#n") that has one: when others replied, and what the latest
// telling reply says (signed off, or an issue raised).
export type QaThread = { replies: string[]; status: 'signed' | 'issue' | null };
export async function qaThreads(prs: string[]): Promise<Record<string, QaThread>> {
  if (!prs.length) return {};
  if (isDesktop) return command<Record<string, QaThread>>('slack_qa', { prs });
  const res = await fetch(`/slack-qa?prs=${encodeURIComponent(prs.join(','))}`);
  const d = await res.json();
  if (!res.ok) throw new Error(d.error ?? 'Slack request failed');
  return d;
}
// Replies to it seen here (the newest one's time), per PR: the rest count as new.
export const qaSeen = (pr: string) => {
  try {
    return localStorage.getItem(own(`qaSeen:${pr}`)) ?? '';
  } catch {
    return '';
  }
};
export const seeQa = (pr: string, ts: string) => {
  try {
    localStorage.setItem(own(`qaSeen:${pr}`), ts);
  } catch {}
};
export const SLACK_CHANNEL = /^([CG][A-Z0-9]+|#[\w.-]+|https:\/\/[\w-]+\.slack\.com\/archives\/[CG][A-Z0-9]+\/?)$/;

// Last lines of a failed GitHub Actions job's log, fetched by the local server with gh.
export async function fetchJobLog(repo: string, job: number): Promise<string> {
  if (isDesktop) return command<string>('job_log', { repo, job, user: ghAccount() });
  const res = await fetch(`/job-log?repo=${encodeURIComponent(repo)}&job=${job}&user=${encodeURIComponent(ghAccount())}`);
  const text = await res.text();
  if (!res.ok) throw new Error(text || 'Could not load the log');
  return text;
}

export type JiraIssue = { key: string; url: string; summary: string; status?: string; statusCategory?: string; type?: string; description: any };
// A Jira ticket through the local server's acli.
export async function fetchJira(key: string): Promise<JiraIssue> {
  if (isDesktop) return command<JiraIssue>('jira_issue', { key });
  const res = await fetch(`/jira?key=${encodeURIComponent(key)}`);
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(body.error || 'Could not load the ticket');
  return body;
}

// A ticket moved to another status (by its name, as Jira shows it), through acli.
export async function moveJira(key: string, status: string): Promise<void> {
  if (isDesktop) return command<void>('jira_move', { key, status });
  const res = await fetch('/jira-move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, status }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not move the ticket');
}

// A Jira project's statuses (through acli, slowly: half a minute or so), kept a day per project; the hook gives the
// ones of all the projects named, saved ones at once, newly listed ones when they come.
export type JiraStatus = { name: string; category: 'new' | 'indeterminate' | 'done' };
async function jiraStatuses(project: string): Promise<JiraStatus[]> {
  if (isDesktop) return command<JiraStatus[]>('jira_statuses', { project });
  const res = await fetch(`/jira-statuses?project=${encodeURIComponent(project)}`);
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(body.error || 'Could not list the statuses');
  return body;
}
const savedStatuses = (p: string): { at: number; list: JiraStatus[] } | null => {
  try {
    return JSON.parse(localStorage.getItem(`jiraStatusList:${p}`) ?? 'null');
  } catch {
    return null;
  }
};
const listing = new Map<string, Promise<void>>(); // one listing per project at a time
export function useJiraStatuses(projects: string[]): JiraStatus[] | null {
  const [, setTick] = useState(0);
  const key = [...new Set(projects)].sort().join();
  useEffect(() => {
    for (const p of key ? key.split(',') : []) {
      if ((savedStatuses(p)?.at ?? 0) > Date.now() - 86_400_000) continue;
      if (!listing.has(p))
        listing.set(p, jiraStatuses(p).then((list) => {
          try {
            if (list.length) localStorage.setItem(`jiraStatusList:${p}`, JSON.stringify({ at: Date.now(), list }));
          } catch {}
        }, () => {}).finally(() => listing.delete(p)));
      listing.get(p)!.then(() => setTick((t) => t + 1));
    }
  }, [key]);
  const lists = key ? key.split(',').map((p) => savedStatuses(p)?.list) : [];
  if (!lists.length || lists.some((l) => !l)) return lists.find((l) => l) ?? null;
  return [...new Map(lists.flat().map((s) => [s!.name, s!])).values()];
}

// --- Native side: the app uses macOS through Tauri plugins; the browser version falls back to web APIs ---

// Notifications: macOS notifications in the app, the Web Notification API in the browser.
export async function askNotifications(): Promise<boolean> {
  if (!isDesktop) return (await Notification.requestPermission()) === 'granted';
  const n = await import('@tauri-apps/plugin-notification');
  return (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted';
}
// `route`: the PR a click opens ("/owner/repo/pull/n"); empty, just lgtm.
export async function notify(title: string, body: string, route: string) {
  let sound = true; // Settings → Desktop notifications: Play a sound
  try {
    sound = localStorage.getItem(own('notifySound')) !== '0';
  } catch {}
  if (!isDesktop) {
    if (Notification.permission !== 'granted') return;
    const note = new Notification(title, { body, silent: !sound }); // the browser's own sound, if it has one
    note.onclick = () => {
      focus();
      if (route) location.hash = route;
    };
    return;
  }
  const n = await import('@tauri-apps/plugin-notification');
  // Sent by lgtm's own command (desktop/src-tauri/src/commands.rs), which hears the click; macOS plays no sound unless asked.
  if (await n.isPermissionGranted()) await command('notify', { title, body, sound, route });
}

// The Dock icon's badge (the app); the browser version shows the count in the tab title instead.
export async function setBadge(count: number) {
  if (!isDesktop) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setBadgeCount(count || undefined);
}

// The app's menu bar item: the PRs waiting on me (null: none, it's turned off).
export const setTray = (items: { title: string; route: string; section: 'needs' | 'mine'; note: string | null }[] | null) => isDesktop && command('set_tray', { items }).catch(() => {});

// Launch at login (the app only).
export async function launchAtLogin(): Promise<boolean> {
  return isDesktop && (await import('@tauri-apps/plugin-autostart')).isEnabled();
}
export async function setLaunchAtLogin(on: boolean) {
  const a = await import('@tauri-apps/plugin-autostart');
  await (on ? a.enable() : a.disable());
}

// In the app: web links open in the default browser (not inside lgtm), and lgtm://<owner>/<repo>/pull/<n> links
// open that PR. `go` receives the PR's route ("/owner/repo/pull/n").
export async function initDesktop(go: (route: string) => void) {
  if (!isDesktop) return;
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !/^(https?|mailto):/i.test(a.href) || e.defaultPrevented) return;
      e.preventDefault();
      void openUrl(a.href);
    },
    true,
  );
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const open = (urls: string[] | null) => {
    // lgtm://owner/repo/pull/n, or a GitLab MR's lgtm://host/group/…/project/pull/n (or …/-/merge_requests/n).
    const m = urls?.[0]?.replace(/^lgtm:\/\//, '').split(/[?#]/)[0].replace('/-/merge_requests/', '/pull/').match(/^([\w.:-]+(?:\/[\w.-]+)+)\/pull\/(\d+)\/?$/);
    const from = urls?.[0]?.match(/[?&]claude=([\w-]{1,80})/)?.[1]; // the Claude Code session that sent it (its skill)
    if (m) go(`/${m[1]}/pull/${m[2]}${from ? `?claude=${from}` : ''}`);
  };
  open(await getCurrent()); // the link that launched the app
  await onOpenUrl(open);
  // The menu bar's own items (desktop/src-tauri/src/lib.rs), passed on as "lgtm:menu" with the item's id.
  const { listen } = await import('@tauri-apps/api/event');
  await listen<string>('menu', (e) => dispatchEvent(new CustomEvent('lgtm:menu', { detail: e.payload })));
  await listen<string>('open-route', (e) => go(e.payload)); // a notification clicked
}

// The app: the GitHub PR link on the clipboard, if there is one (only the link ever leaves the app's side).
export async function clipboardPR(): Promise<string | null> {
  return isDesktop ? command<string | null>('clipboard_pr').catch(() => null) : null;
}

// --- Updates: the newest release on GitHub, checked at most once a day ---
const RELEASES = 'https://api.github.com/repos/bukuwarung/lgtm/releases/latest';
// "0.10.0" > "0.9.1": compares numerically, part by part.
export const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.replace(/^v/, '').split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};
// The newer version's number, or null when this one is the newest (or GitHub can't be reached).
export async function availableUpdate(): Promise<string | null> {
  let saved: { at: number; latest: string } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem('updateCheck') ?? 'null');
  } catch {}
  if (!saved || Date.now() - saved.at > 24 * 3600 * 1000) {
    const latest = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => r?.tag_name as string | undefined, () => undefined);
    if (!latest) return null;
    saved = { at: Date.now(), latest };
    try {
      localStorage.setItem('updateCheck', JSON.stringify(saved));
    } catch {}
  }
  return newer(saved.latest, __APP_VERSION__) ? saved.latest.replace(/^v/, '') : null;
}
// Claude Code's answer (the claude CLI) to a prompt the page builds (claude.ts: Ask Claude).
export async function askClaudeCli(input: string): Promise<string> {
  if (isDesktop) return command<string>('claude_text', { input });
  const res = await fetch('/claude-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }) });
  const d = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(d.error ?? 'Claude failed');
  return d.text;
}

// The Claude Code session that sent a PR here (its lgtm-review skill opens lgtm://owner/repo/pull/n?claude=<id>): the
// Claude app's id (local_…) or the CLI's (a UUID), kept per PR.
const SESSION_ID = /^(local_[A-Za-z0-9-]{1,64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export function linkClaude(repo: string, n: number, id: string) {
  if (!SESSION_ID.test(id)) return;
  try {
    localStorage.setItem(own(`claudeFrom:${repo}#${n}`), JSON.stringify({ id, at: Date.now() }));
  } catch {}
  dispatchEvent(new Event('lgtm:claude-link')); // ✳ Claude buttons show it
}
export function unlinkClaude(repo: string, n: number) {
  try {
    localStorage.removeItem(own(`claudeFrom:${repo}#${n}`));
  } catch {}
  dispatchEvent(new Event('lgtm:claude-link'));
}
// A session ✳ Claude just started for this PR: once the Claude app records it (its first message names the PR), link
// it. Checks every 3 seconds for 10 minutes (the new session may wait for the user to send it).
const watching = new Set<string>();
export function linkNewClaude(repo: string, n: number, prUrl: string) {
  const key = `${repo}#${n}`;
  if (watching.has(key)) return;
  watching.add(key);
  const since = Date.now() - 5000;
  let tries = 0;
  const look = async () => {
    const s = (await getClaudeSessions().catch(() => [])).find((s) => s.prs.includes(prUrl) && s.lastActivityAt >= since);
    if (s) linkClaude(repo, n, s.id);
    if (s || ++tries >= 200 || linkedClaude(repo, n)) return void watching.delete(key);
    setTimeout(look, 3000);
  };
  setTimeout(look, 3000);
}
export function linkedClaude(repo: string, n: number): { id: string; at: number; seen?: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(own(`claudeFrom:${repo}#${n}`)) ?? 'null');
    return v && SESSION_ID.test(v.id) ? v : null;
  } catch {
    return null;
  }
}
// The time the PR was last opened here, kept with its link: "✳ updated" in the list means commits since.
export function seenClaudePR(repo: string, n: number) {
  const l = linkedClaude(repo, n);
  if (!l) return;
  try {
    localStorage.setItem(own(`claudeFrom:${repo}#${n}`), JSON.stringify({ ...l, seen: Date.now() }));
  } catch {}
}

// A message for a session, left where its lgtm-review skill reads it when the user says "check lgtm" there.
export async function leaveForClaude(id: string, text: string): Promise<void> {
  if (isDesktop) return void (await command('claude_outbox', { id, text }));
  const res = await fetch('/claude-outbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, text }) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Could not leave the message');
}

// A session's title and what it's doing (from the Claude app's record): null when there's no record (a Terminal
// session) or it's archived.
export type SessionState = { id: string; title: string; state: 'working' | 'waiting' | 'idle' } | null;
export async function claudeSessionState(id: string): Promise<SessionState> {
  if (isDesktop) return command<SessionState>('claude_session', { id });
  const res = await fetch(`/claude-session?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Could not read the session');
  return res.json();
}

// Back to a session, with a message if there is one: the message is left for it (the user says "check lgtm" there;
// copied to paste if that fails), then the Claude app's session opens, or a Terminal session's `claude --resume` is
// copied. Says what it did.
export async function backToClaude(id: string, message = ''): Promise<string> {
  let note = '';
  if (message)
    note = await leaveForClaude(id, message).then(
      () => 'Left for the session: say “check lgtm” there',
      async () => (await copyText(message).catch(() => {}), 'Copied: paste it in the session (⌘V)'),
    );
  const local = id.startsWith('local_') ? id : (await claudeSessionState(id).catch(() => null))?.id;
  if (local) {
    await openClaude(`claude://code/continue?session=${encodeURIComponent(local)}`);
    return note;
  }
  await copyText(`claude --resume ${id}${message ? " 'check lgtm'" : ''}`).catch(() => {});
  return 'A Terminal session: the command to resume it is copied; paste it in Terminal';
}

// The installed skill, kept the same as this lgtm's (after an update), without asking: only if it's installed.
export async function keepSkillCurrent() {
  const s = await claudeSkill().catch(() => null);
  if (s?.installed && !s.current) await claudeSkill(true).catch(() => {});
}

// The Claude Code skill (app/claude-skill.md) in ~/.claude/skills: whether it's there and current; install writes it.
export type SkillStatus = { installed: boolean; current: boolean; path: string };
export async function claudeSkill(install = false): Promise<SkillStatus> {
  if (isDesktop) return command<SkillStatus>('claude_skill', { install });
  const res = await fetch('/claude-skill', { method: install ? 'POST' : 'GET' });
  const d = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(d.error ?? 'Could not reach the skill');
  return d;
}

// The lgtm-links mod for Claude Code (in lgtm's repo): whether it's installed, and the line that installs it. lgtm
// only suggests it: installing changes the person's Claude Code setup.
export const MOD_INSTALL = 'claude plugin install lgtm-links --marketplace bukuwarung/lgtm';
export async function claudeMod(): Promise<{ installed: boolean }> {
  if (isDesktop) return command<{ installed: boolean }>('claude_mod');
  const res = await fetch('/claude-mod');
  const d = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(d.error ?? 'Could not check for the mod');
  return d;
}

// The app: upgrade through Homebrew and restart (resolves only on failure: success restarts the app).
export const selfUpdate = () => command<void>('self_update');
export const UPGRADE = isDesktop ? 'brew upgrade --cask lgtm' : 'git pull && npm run build'; // the browser version: development only, from source

// --- Diagnostics (Help → Copy Diagnostics, Settings): what a bug report needs, with no tokens or PR text ---
const errors: string[] = [];
// Something the user did failed (a review, a merge, a Slack message): main.tsx shows it in a red bar under the title
// bar until dismissed, review mode too.
export const reportError = (text: string) => dispatchEvent(new CustomEvent('lgtm:error', { detail: text }));

// confirm() in the Mac app's web view says no without asking (wry doesn't show it), so lgtm asks in its own dialog.
export function ask(text: string, yes = 'OK'): Promise<boolean> {
  const d = document.createElement('dialog');
  d.className = 'ask';
  d.innerHTML = '<p></p><form method="dialog"><button value="">Cancel</button><button class="primary" value="y"></button></form>';
  d.querySelector('p')!.textContent = text;
  d.querySelector('.primary')!.textContent = yes;
  document.body.append(d);
  d.showModal();
  (d.querySelector('.primary') as HTMLButtonElement).focus();
  return new Promise((done) => d.addEventListener('close', () => (done(d.returnValue === 'y'), d.remove())));
}

export function recordError(text: string) {
  errors.push(`${new Date().toISOString().slice(0, 19)} ${text.slice(0, 300)}`);
  if (errors.length > 20) errors.shift();
}
if (typeof window !== 'undefined') {
  addEventListener('error', (e) => recordError(`error: ${e.message}`));
  addEventListener('unhandledrejection', (e) => recordError(`unhandled: ${e.reason?.message ?? e.reason}`));
}

// Copies text. The app's web view refuses clipboard writes made after an await (the click's permission is gone), so the
// app copies it itself.
export const copyText = (text: string): Promise<void> => (isDesktop ? command('copy_text', { text }) : navigator.clipboard.writeText(text));

// Copies diagnostics. In a browser the clipboard write starts during the click and waits for the text (the sign-in
// checks take a few seconds, longer than a click's permission lasts).
export async function copyDiagnostics(): Promise<void> {
  if (isDesktop) return command('copy_text', { text: await diagnostics() });
  const blob = diagnostics().then((t) => new Blob([t], { type: 'text/plain' }));
  await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
}

export async function diagnostics(): Promise<string> {
  const i = await fetchIntegrations().catch((e) => e.message as string);
  const line = (name: string, s: { ok: boolean; error?: string }) => `${name}: ${s.ok ? 'ok' : `not working (${s.error ?? 'unknown'})`}`;
  return [
    `lgtm ${__APP_VERSION__}${__DEV_BUILD__ ? ` dev ${__COMMIT__}` : ''} (${isDesktop ? 'macOS app' : 'browser version'})`,
    navigator.userAgent,
    ...(typeof i === 'string' ? [`Integrations: ${i}`] : [line('Slack', i.slack), line('Jira', i.jira)]),
    `Recent errors:${errors.length ? '' : ' none'}`,
    ...errors.map((e) => `  ${e}`),
  ].join('\n');
}

// --- Export / import: everything lgtm keeps in this browser (or app) — preferences and pending drafts — as one
// JSON file, to move to the app or another machine. ---
// slack: the Slack people mapping and the PRs' Slack threads (QA requests too), kept in ~/.config/lgtm, not here.
export type Backup = { lgtm: 1; version: string; exportedAt: string; storage: Record<string, string>; slack?: { people: Record<string, string>; threads: Record<string, unknown> } };
type Threads = Record<string, unknown>;
const slackThreadsFile = (merge?: Threads): Promise<Threads> =>
  isDesktop ? command<Threads>('slack_threads', { merge: merge ?? null })
  : fetch('/slack-threads', merge ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threads: merge }) } : {}).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => null))?.error ?? 'Slack threads failed'))));

export async function makeBackup(): Promise<Backup> {
  const storage: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    storage[k] = localStorage.getItem(k) ?? '';
  }
  const [people, threads] = await Promise.all([getSlackPeople().then((p) => p.mine, () => null), slackThreadsFile().catch(() => null)]);
  return { lgtm: 1, version: __APP_VERSION__, exportedAt: new Date().toISOString(), storage, ...(people && threads ? { slack: { people, threads } } : {}) };
}

// Browser: a download. App: saved to ~/Downloads by the app (the page never names a path). Returns where it went.
export async function saveBackup(): Promise<string> {
  const text = JSON.stringify(await makeBackup(), null, 2);
  const date = new Date().toISOString().slice(0, 10);
  if (isDesktop) return command<string>('export_settings', { json: text, date });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `lgtm-settings-${date}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return `your downloads (${a.download})`;
}

// Adds the file's settings and drafts, replacing ones with the same name, and its Slack people and threads the same
// way (in ~/.config/lgtm); returns how many of each.
export async function restoreBackup(text: string): Promise<{ entries: number; people: number; threads: number }> {
  const b = JSON.parse(text) as Partial<Backup>;
  if (b?.lgtm !== 1 || typeof b.storage !== 'object' || !b.storage) throw new Error("This isn't an lgtm settings file.");
  const entries = Object.entries(b.storage).filter(([k, v]) => typeof k === 'string' && typeof v === 'string');
  for (const [k, v] of entries) localStorage.setItem(k, v);
  const people = Object.entries(b.slack?.people ?? {}).filter(([, id]) => typeof id === 'string' && id);
  for (let i = 0; i < people.length; i += 100) await saveSlackPeople(Object.fromEntries(people.slice(i, i + 100))); // 100 a request
  const threads = b.slack?.threads && typeof b.slack.threads === 'object' ? b.slack.threads : {};
  if (Object.keys(threads).length) await slackThreadsFile(threads);
  return { entries: entries.length, people: people.length, threads: Object.keys(threads).length };
}

export const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A web page in the default browser (the app) or a new tab.
export async function openExternal(url: string) {
  if (isDesktop) return (await import('@tauri-apps/plugin-opener')).openUrl(url);
  open(url, '_blank', 'noopener');
}

// Opens a claude:// link in the Claude desktop app (the app: through the opener plugin; the browser asks first).
export async function openClaude(url: string) {
  if (isDesktop) return (await import('@tauri-apps/plugin-opener')).openUrl(url);
  location.href = url;
}

// Claude Code sessions whose first prompt links a PR, newest first (Settings → Claude Code; read from the Claude app's
// local records).
export type ClaudeSession = { id: string; cli: string; title: string; lastActivityAt: number; prs: string[] };
export async function getClaudeSessions(): Promise<ClaudeSession[]> {
  if (isDesktop) return command<ClaudeSession[]>('claude_sessions');
  const res = await fetch('/claude-sessions');
  if (!res.ok) throw new Error('Could not read Claude sessions');
  return res.json();
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]] as const;
// How long since, as a duration: "3 days", "2 years".
export function since(when: string | number) {
  const s = (Date.now() - new Date(when).getTime()) / 1000;
  const [unit, size] = UNITS.find(([, n]) => s >= n) ?? ['minute', 60];
  const n = Math.max(1, Math.floor(s / size));
  return `${n} ${unit}${n > 1 ? 's' : ''}`;
}
export function ago(when: string | number) {
  const s = (new Date(when).getTime() - Date.now()) / 1000;
  const u = UNITS.find(([, n]) => Math.abs(s) >= n);
  return u ? rtf.format(Math.round(s / u[1]), u[0]) : 'just now';
}

// Per repo, the local checkout Claude Code should work in (Settings → Claude Code): { "owner/repo": "/path" }.
export function claudeFolder(repo: string): string | undefined {
  try {
    return JSON.parse(localStorage.getItem('claudeFolders') ?? '{}')[repo] || undefined;
  } catch {
    return undefined;
  }
}

// Threads I marked done without replying (the inbox's Done): not waiting on me until someone writes again. Each is
// kept as its last comment then; on this machine only, per account (GitHub has no such state).
export const repliesDone = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(own('repliesDone')) ?? '{}');
  } catch {
    return {};
  }
};
export function unmarkReplyDone(thread: string) {
  const d = repliesDone();
  delete d[thread];
  localStorage.setItem(own('repliesDone'), JSON.stringify(d));
}

// Something just left the screen and can come back: a toast with Undo for a few seconds (main.tsx shows "lgtm:toast").
export const offerUndo = (text: string, undo: () => unknown) =>
  dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text, action: ['Undo', undo], ms: 6000 } }));

export function markReplyDone(thread: string, lastComment: number) {
  const d = repliesDone();
  d[thread] = lastComment;
  const keys = Object.keys(d);
  for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete d[k]; // the oldest go first
  localStorage.setItem(own('repliesDone'), JSON.stringify(d));
}

// What lgtm would notify me about, kept until I act on it (open its PR) or dismiss it: the bell's list. Kept whether
// or not desktop notifications are on; per account, on this machine; the newest 50.
export type Notice = { id: string; what: string; title: string; pr: string; at: number }; // pr: "owner/repo#n"
export const notices = (): Notice[] => {
  try {
    return JSON.parse(localStorage.getItem(own('notices')) ?? '[]');
  } catch {
    return [];
  }
};
const saveNotices = (list: Notice[]) => (localStorage.setItem(own('notices'), JSON.stringify(list.slice(0, 50))), dispatchEvent(new Event('lgtm:notices')));
export const addNotice = (what: string, title: string, pr: string) =>
  saveNotices([{ id: `${pr}:${what}:${Date.now()}`, what, title, pr, at: Date.now() }, ...notices().filter((n) => !(n.pr === pr && n.what === what))]);
export const dropNotices = (pick: (n: Notice) => boolean): Notice[] => {
  const all = notices();
  if (all.some(pick)) saveNotices(all.filter((n) => !pick(n)));
  return all.filter(pick);
};
// Dismissed ones back (Undo), newest first.
export const putBackNotices = (back: Notice[]) => saveNotices([...back, ...notices().filter((n) => !back.some((b) => b.id === n.id))].sort((a, b) => b.at - a.at));
