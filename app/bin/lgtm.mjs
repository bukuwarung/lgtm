#!/usr/bin/env node
// lgtm: serve the review UI on 127.0.0.1 and hand it the GitHub CLI's token.
// Usage: lgtm [https://github.com/owner/repo/pull/123]
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, open as openFile, readdir, readFile, rename, stat, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// This server's version (a hash of its own code): a newer `lgtm` replaces an older one still running.
const VERSION = createHash('sha1').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 12);
// Fixed port: drafts live in localStorage, which is per origin.
const PORT = Number(process.env.LGTM_PORT ?? 4517);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
// Your settings, including GitHub login → Slack user (ID, @handle or email): { "slackUsers": { "github-login": "U…" } }.
// Settings → Slack → People fills it in.
const CONFIG = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'lgtm', 'config.json');
// Slack DM thread per PR and person, so later reviews of a PR reply in the same thread: { "o/r#12:login": { channel, ts } }
const THREADS = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'lgtm', 'slack-threads.json');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

// Read per request so `gh auth login` / `gh auth switch` take effect on reload. `user`: one of the accounts gh is
// signed in to (Settings → Accounts picks it); none, gh's active one.
const GH_LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const ghToken = (user = '') => {
  if (user && !GH_LOGIN.test(user)) throw new Error('Bad account');
  return execFileSync('gh', ['auth', 'token', ...(user ? ['--user', user] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
};
// The accounts gh is signed in to on github.com, and which is its active one. (gh exits non-zero when any account
// has a problem, but still prints them all.)
const ghAccounts = () =>
  new Promise((resolve) =>
    execFile('gh', ['auth', 'status', '--json', 'hosts'], { timeout: 30000 }, (_err, stdout) => {
      try {
        const all = JSON.parse(stdout).hosts?.['github.com'] ?? [];
        resolve(all.filter((a) => a.state === 'success').map((a) => ({ login: a.login, active: !!a.active })));
      } catch {
        resolve([]);
      }
    }),
  );

// GitLab through glab (https://gitlab.com/gitlab-org/cli), which owns the sign-in like gh does: the hosts it's signed in
// to, each with its account and where its API is, and a host's token, read per request so `glab auth login` applies on reload.
const GL_HOST = /^[a-z0-9.-]+(:\d+)?$/i;
const glab = (args) => execFileSync('glab', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }).trim();
// glab's token for a host. `refresh`: first a request through glab, which renews an OAuth token that has expired (glab
// renews only when it makes a request itself; lgtm reads the stored one).
const glabToken = (host, refresh = false) => {
  if (!GL_HOST.test(host)) throw new Error('Bad host');
  if (refresh) {
    try {
      glab(['api', 'user', '--hostname', host]);
    } catch {}
  }
  return glab(['config', 'get', 'token', '--host', host]);
};
// The hosts glab is signed in to, from its config file: each with its user and where its API is. Read directly, as
// `glab auth status` checks every token online (seconds); a bad token shows on the first request instead.
const GLAB_CONFIGS = [process.env.GLAB_CONFIG_DIR, process.env.XDG_CONFIG_HOME && join(process.env.XDG_CONFIG_HOME, 'glab-cli'), join(homedir(), 'Library', 'Application Support', 'glab-cli'), join(homedir(), '.config', 'glab-cli')]
  .filter(Boolean)
  .map((d) => join(d, 'config.yml'));
export function glabHosts(text) {
  const out = [];
  let inHosts = false, hostIndent = -1, cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (!indent) {
      inHosts = /^hosts:\s*$/.test(line);
      continue;
    }
    if (!inHosts) continue;
    if (hostIndent < 0) hostIndent = indent;
    const kv = line.trim().match(/^("[^"]+"|'[^']+'|[^:]+):\s*(.*)$/);
    if (!kv) continue;
    const [k, v] = [kv[1].replace(/^["']|["']$/g, ''), kv[2].replace(/^["']|["']$/g, '').trim()];
    if (indent === hostIndent) out.push((cur = { host: k, user: '', api_host: '', api_protocol: '' }));
    else if (cur && k in cur && k !== 'host') cur[k] = v;
  }
  return out.filter((a) => a.user && GL_HOST.test(a.host)).map((a) => ({ host: a.host, login: a.user, api: `${a.api_protocol || 'https'}://${a.api_host || a.host}` }));
}
const glabAccounts = async () => {
  for (const f of GLAB_CONFIGS) {
    const text = await readFile(f, 'utf8').catch(() => null);
    if (text != null) return glabHosts(text);
  }
  return [];
};

async function readConfig() {
  try {
    return JSON.parse(await readFile(CONFIG, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`Can't read ${CONFIG}: ${e.message}`);
  }
}

// Slack goes through slackcli (https://github.com/shaharia-lab/slackcli), which owns the sign-in:
// `slackcli auth login-auto`. LGTM_SLACK_DRY_RUN=1 resolves recipients without sending.
const DRY_RUN = process.env.LGTM_SLACK_DRY_RUN === '1';

function slackcli(args, input) {
  return new Promise((resolve) => {
    const child = execFile('slackcli', args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, stdout });
      if (err.code === 'ENOENT') return resolve({ ok: false, error: 'slackcli is not installed (brew install shaharia-lab/tap/slackcli)' });
      // With --json, slackcli puts one JSON error object on the last stderr line.
      const last = stderr.trim().split('\n').pop() ?? '';
      let error = last || err.message;
      try {
        const e = JSON.parse(last).error;
        error = e.hint ? `${e.message} (${e.hint})` : e.message;
      } catch {
        // not JSON; keep the raw line
      }
      resolve({ ok: false, error });
    });
    child.stdin.end(input ?? '');
  });
}

// User ID, @handle or email: the forms slackcli resolves to a person. Also keeps flags out of the argument.
const SLACK_TARGET = /^(U[A-Z0-9]+|@[\w.-]+|[^\s@-][^\s@]*@[^\s@]+)$/;

async function readThreads() {
  try {
    return JSON.parse(await readFile(THREADS, 'utf8'));
  } catch {
    return {};
  }
}

async function saveThreads(threads) {
  await mkdir(dirname(THREADS), { recursive: true });
  await writeFile(THREADS + '.tmp', JSON.stringify(threads, null, 2));
  await rename(THREADS + '.tmp', THREADS); // atomic: a crash mid-write can't leave half a file
}

// DM each recipient: the team/personal mapping first, then their GitHub emails. Each PR gets one thread per person;
// later reviews reply in it (a fresh DM starts a new thread if the old one is gone).
// Links to this PR's Slack threads (one per person messaged), as message permalinks on the workspace's own URL.
let slackUrl; // https://<workspace>.slack.com/
async function prThreads(pr) {
  if (!PR_REF.test(pr)) return [];
  const found = await dmThreads(pr);
  const mine = Object.entries({ ...found, ...(await readThreads()) }).filter(([k]) => k.startsWith(pr + ':'));
  if (!mine.length) return [];
  slackUrl ??= slackcli(['team', 'info', '--json']).then((r) => (r.ok ? parseJson(r.stdout)?.url ?? null : null));
  const base = await slackUrl;
  if (!base) return [];
  const users = (await readConfig()).slackUsers ?? {};
  return Promise.all(
    mine.map(async ([k, t]) => {
      const login = k.slice(pr.length + 1);
      // Who it's with: as saved with the thread, else the Slack people mapping (threads from before it was saved).
      // "#qa": the QA request, in a channel: its name, no one's picture.
      const who = login.startsWith('#') ? null : await slackProfile(t.user ?? users[login]);
      return { login, url: `${base}archives/${t.channel}/p${t.ts.replace('.', '')}`, name: who?.name ?? t.name, image: who?.image, ...(t.last ? { last: true } : {}) }; // last: a message lgtm can take back
    }),
  );
}

// DMs you've already had about this PR (its link in a direct message, newest first): each becomes your thread with that
// person for it, when Slack people knows who they are on GitHub, so lgtm's messages to them reply there. Searched
// once a run per PR (slackcli search messages); saved with the threads lgtm starts itself.
const dmSearch = new Map();
// A message's own links: its text, and the URLs its previews unfurl (not their text: a stacked PR's preview lists the
// other layers).
const ownLinks = (m) => [m.text ?? '', ...(m.attachments ?? []).flatMap((a) => [a.from_url, a.original_url, a.app_unfurl_url, a.title_link])].join(' ');
function dmThreads(pr) {
  if (!dmSearch.has(pr))
    dmSearch.set(
      pr,
      (async () => {
        const [repo, n] = pr.split('#');
        const page = prPage(repo, n);
        const link = new RegExp(`${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`);
        const r = await slackcli(['search', 'messages', page, '--json', '--limit', '40']);
        const users = (await readConfig()).slackUsers ?? {};
        const loginOf = Object.fromEntries(Object.entries(users).filter(([, v]) => /^U[A-Z0-9]+$/.test(v)).map(([l, v]) => [v, l]));
        const threads = await readThreads();
        const found = {};
        for (const m of (r.ok && parseJson(r.stdout)?.matches) || []) {
          if (!m.channel?.is_im || !link.test(ownLinks(m))) continue;
          const login = loginOf[m.channel.name]; // a DM's name is the other person's user ID
          const key = `${pr}:${login}`;
          if (!login || threads[key] || found[key]) continue;
          found[key] = { channel: m.channel.id, ts: m.permalink?.match(/thread_ts=([\d.]+)/)?.[1] ?? m.ts, user: m.channel.name };
        }
        if (Object.keys(found).length && !DRY_RUN) await saveThreads({ ...found, ...(await readThreads()) });
        return found;
      })().catch(() => ({})),
    );
  return dmSearch.get(pr);
}

// The workspace's custom emoji, name → image (an alias → ":its-name:", for the page to look up), once a run.
let emojiList;
const slackEmoji = () =>
  (emojiList ??= slackcli(['emoji', 'list', '--json']).then((r) => {
    const all = (r.ok && parseJson(r.stdout)?.emoji) || [];
    return Object.fromEntries(all.map((e) => [e.name, e.is_alias ? `:${e.alias_for}:` : e.url]));
  }));

// A Slack user's name and picture (a user ID, @handle or email), looked up once a run.
const profiles = new Map();
function slackProfile(user) {
  if (typeof user !== 'string' || !SLACK_TARGET.test(user)) return null;
  if (!profiles.has(user))
    profiles.set(
      user,
      slackcli(['users', 'info', user, '--json']).then((r) => {
        const d = r.ok ? parseJson(r.stdout) : null;
        const u = d?.user ?? d;
        if (!u) return null;
        const p = u.profile ?? {};
        return { id: u.id, name: [p.display_name, p.real_name, u.real_name, u.name].find(Boolean), image: p.image_72 ?? p.image_48 };
      }),
    );
  return profiles.get(user);
}

// Slack statuses ("🌴 Vacation", "Out sick") of GitHub people, through their Slack mapping, for picking a reviewer.
// Asked fresh each time: statuses change during the day.
async function slackPresence(logins) {
  const users = (await readConfig()).slackUsers ?? {};
  const pairs = await Promise.all(
    (logins ?? []).filter((l) => LOGIN.test(l) && SLACK_ID.test(users[l] ?? '')).slice(0, 20).map(async (l) => {
      const r = await slackcli(['users', 'info', users[l], '--json']);
      const d = r.ok ? parseJson(r.stdout) : null;
      const p = (d?.user ?? d)?.profile;
      // Their name, picture (only one they set: Slack's default face says nothing) and time zone too.
      return p ? [l, { text: p.status_text ?? '', emoji: p.status_emoji ?? '', until: p.status_expiration ?? 0, name: p.real_name || p.display_name || '', face: p.is_custom_image ? p.image_72 ?? '' : '', tz: (d?.user ?? d)?.tz ?? '' }] : null;
    }),
  );
  return Object.fromEntries(pairs.filter(Boolean));
}

// --- GitHub ↔ Slack people (Settings) ---

// A GitHub login, or a GitLab person as login@host (so a GitLab name never reaches a GitHub person's Slack).
const LOGIN = /^(?:[\w-]{1,39}|[\w.-]{1,255}@[\w.:-]{1,253})$/;
// A PR: owner/repo#12, or a GitLab MR as host/group/…/project#12.
const PR_REF = /^[\w.:-]+(?:\/[\w.-]+)+#\d+$/;
// Where a PR's own page is, for finding it in Slack messages.
const prPage = (repo, n) => (repo.split('/')[0].includes('.') ? `${repo}/-/merge_requests/${n}` : `github.com/${repo}/pull/${n}`);
const SLACK_ID = /^U[A-Z0-9]{6,}$/;
// slackcli may print a spinner line first, and prints nothing at all for an empty search.
// The JSON object in a CLI's output: some print a spinner line before it, and some (slackcli) an update notice after.
const parseJson = (out = '') => {
  try {
    return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
};

// The current GitHub → Slack mapping (yours, in the config).
async function slackPeople() {
  return { mine: (await readConfig()).slackUsers ?? {} };
}

// Best guesses for people without a mapping: an exact email match first (their verified company email on GitHub),
// then their GitHub name, then their login's first word, each only when Slack finds exactly one live person.
// The Slack user a link or ID points to: a profile (…/team/U…), a user ID (U…, <@U…>), or a DM (…/archives/D…), whose
// other member it is (the one that isn't you).
let slackMe;
async function slackUserIn(q) {
  const user = q.match(/(?:\/team\/|^<?@?)(U[A-Z0-9]{6,})>?$/)?.[1];
  if (user) return user;
  const dm = q.match(/(?:\/archives\/|^)(D[A-Z0-9]{6,})\b/)?.[1];
  if (!dm) return null;
  slackMe ??= slackcli(['auth', 'whoami', '--json']).then((r) => parseJson(r.stdout)?.user_id);
  const [me, r] = await Promise.all([slackMe, slackcli(['conversations', 'members', 'list', dm, '--json'])]);
  return (parseJson(r.stdout)?.members ?? []).find((m) => m !== me) ?? null;
}

async function findSlack(people) {
  if (!Array.isArray(people) || people.length > 50) throw new Error('Bad request');
  const one = (u, via) => ({ id: u.id, label: u.real_name || u.profile?.real_name || u.name, display: u.profile?.display_name || '', via });
  const out = [];
  for (let p of people) {
    if (!LOGIN.test(p?.login ?? '')) continue;
    let found = null;
    for (const email of (Array.isArray(p.emails) ? p.emails : []).slice(0, 5)) {
      if (typeof email !== 'string' || !/^[^\s@-][^\s@]*@[^\s@]+$/.test(email)) continue;
      const r = await slackcli(['users', 'info', email, '--json']);
      let u = r.ok && parseJson(r.stdout);
      // Slack looks people up by email for app tokens only: with a person's sign-in, a people search for it, and the
      // one whose email it is.
      if (!u?.id) {
        const s = await slackcli(['search', 'people', email, '--json', '--limit', '5']);
        u = (s.ok ? parseJson(s.stdout)?.people ?? [] : []).find((x) => x.profile?.email?.toLowerCase() === email.toLowerCase());
      }
      if (u?.id && !u.deleted) {
        found = one(u, 'email');
        break;
      }
    }
    // Who else it could be, when there's no single match, to pick from (and a search typed by hand, first).
    const candidates = [];
    // A Slack link or ID typed in: that person, a DM's other member, or a profile.
    const id = typeof p.query === 'string' ? await slackUserIn(p.query.trim()) : null;
    if (id) {
      const r = await slackcli(['users', 'info', id, '--json']);
      const u = r.ok && parseJson(r.stdout);
      if (u?.id && !u.deleted) candidates.push(one(u, 'search'));
      p = { ...p, query: undefined };
    }
    // emailOnly: lgtm matching people by itself, which saves only what's certain.
    for (const [query, via] of [[p.query, 'search'], [p.name, 'name'], [p.login.split('@')[0].split(/[-_.]/)[0], 'username']]) {
      if (found || p.emailOnly === true || typeof query !== 'string' || query.trim().length < 2 || query.startsWith('-')) continue;
      const r = await slackcli(['search', 'people', query.slice(0, 100), '--json', '--limit', '5']);
      const live = r.ok ? (parseJson(r.stdout)?.people ?? []).filter((u) => !u.deleted && !u.is_bot) : [];
      if (live.length === 1 && via !== 'search') found = one(live[0], via);
      for (const u of live) if (candidates.length < 6 && !candidates.some((c) => c.id === u.id)) candidates.push(one(u, via));
    }
    out.push({ login: p.login, ...(found ?? (candidates.length ? { candidates } : {})) });
  }
  return out;
}

// Saves to your config (~/.config/lgtm/config.json); an empty id removes the entry.
async function saveSlackPeople(map) {
  const entries = Object.entries(map ?? {});
  if (!entries.length || entries.length > 100 || entries.some(([l, id]) => !LOGIN.test(l) || (id !== '' && !SLACK_ID.test(id)))) throw new Error('Bad request');
  const config = await readConfig();
  const mine = { ...(config.slackUsers ?? {}) };
  for (const [l, id] of entries) id ? (mine[l] = id) : delete mine[l];
  await mkdir(dirname(CONFIG), { recursive: true });
  await writeFile(CONFIG + '.tmp', JSON.stringify({ ...config, slackUsers: mine }, null, 2));
  await rename(CONFIG + '.tmp', CONFIG);
  return slackPeople();
}

// The message's GitHub mentions as Slack ones: <@gh:login> (and <@gh:*>, the one it's for) becomes <@U…> for whoever
// that is on Slack (the Slack people mapping, or for the recipient their email), else stays @login.
const MENTION = /<@gh:([\w.-]{1,255}@[\w.:-]{1,253}|[A-Za-z0-9-]{1,39}|\*)>/g;
async function mentions(text, recipient, users) {
  if (!text.includes('<@gh:')) return text;
  const found = new Map();
  for (const [, who] of text.matchAll(MENTION)) {
    if (found.has(who)) continue;
    const login = who === '*' ? recipient.login : who;
    const target = users[login] ?? (login === recipient.login ? recipient.emails[0] : undefined);
    const id = /^U[A-Z0-9]+$/.test(target ?? '') ? target : (await slackProfile(target))?.id;
    found.set(who, id ? `<@${id}>` : `@${login}`);
  }
  return text.replace(MENTION, (_, who) => found.get(who));
}

// The PRs' Slack threads (slack-threads.json), for Settings → Backup: all of them, or a backup's merged in (its
// entries replace ones with the same key).
const THREAD_KEY = /^[\w.:-]+(?:\/[\w.-]+)+#\d+:(#qa|[\w-]{1,39}|[\w.-]{1,255}@[\w.:-]{1,253})$/;
async function backupThreads(incoming) {
  const threads = await readThreads();
  if (incoming === undefined) return threads;
  const ok = (v) => v && /^[CDG][A-Z0-9]+$/.test(v.channel) && /^\d+\.\d+$/.test(v.ts) && ['user', 'name'].every((k) => v[k] == null || (typeof v[k] === 'string' && v[k].length <= 200));
  const entries = Object.entries(incoming ?? {});
  if (entries.length > 5000 || !entries.every(([k, v]) => THREAD_KEY.test(k) && ok(v))) throw new Error('Bad request');
  for (const [k, v] of entries) threads[k] = { channel: v.channel, ts: v.ts, ...(v.user ? { user: v.user } : {}), ...(v.name ? { name: v.name } : {}) };
  await saveThreads(threads);
  return threads;
}

// A #name as its channel (Slack's channel search, exact name): slackcli's own lookup by name pages through every channel,
// slower than its time limit. An ID or link as it is.
async function channelId(channel) {
  if (!channel.startsWith('#')) return { id: channel };
  const r = await slackcli(['search', 'channels', channel.slice(1), '--json', '--limit', '20']);
  if (!r.ok) return { error: r.error };
  const all = parseJson(r.stdout)?.channels ?? [];
  const c = all.find((x) => x.name === channel.slice(1));
  // Not that name: the one it most likely meant (one starting with it, else one containing it), to offer.
  const near = all.find((x) => x.name.startsWith(channel.slice(1))) ?? all.find((x) => x.name.includes(channel.slice(1)));
  return c ? { id: c.id, name: '#' + c.name } : { error: `no channel named ${channel}${near ? ` (did you mean #${near.name}?)` : ''}` };
}

// A message in a channel (the QA request, Settings → Slack): its ID, #name or link. Back: its permalink.
const SLACK_CHANNEL = /^([CG][A-Z0-9]+|#[\w.-]+|https:\/\/[\w-]+\.slack\.com\/archives\/[CG][A-Z0-9]+\/?)$/;
// ✅ on the posts outside DMs where the PR's author linked it (their review request), once it's approved or merged
// (Settings → Slack). author: a GitHub login matched on Slack; none: you. Not your QA request. Searched fresh each time;
// back: where they were.
async function requestPosts({ pr, author }) {
  if (typeof pr !== 'string' || !PR_REF.test(pr) || (author != null && (typeof author !== 'string' || author.length > 100))) throw new Error('Bad Slack request');
  slackMe ??= slackcli(['auth', 'whoami', '--json']).then((r) => parseJson(r.stdout)?.user_id);
  const by = author ? (await readConfig()).slackUsers?.[author] : await slackMe;
  if (!/^U[A-Z0-9]+$/.test(by ?? '')) return [];
  const [repo, n] = pr.split('#');
  const page = prPage(repo, n);
  const link = new RegExp(`${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`);
  const qa = (await readThreads())[`${pr}:#qa`]?.ts;
  const r = await slackcli(['search', 'messages', page, '--json', '--limit', '40']);
  return ((r.ok && parseJson(r.stdout)?.matches) || []).filter((m) => m.channel && !m.channel.is_im && m.user === by && m.ts !== qa && link.test(ownLinks(m))).slice(0, 3);
}
const postedIn = (m) => (m.channel.is_mpim ? 'a group message' : `#${m.channel.name}`);
async function markDone(b) {
  const done = new Set();
  for (const m of await requestPosts(b)) {
    const x = await slackcli(['messages', 'react', `--channel-id=${m.channel.id}`, `--timestamp=${m.ts}`, '--emoji', 'white_check_mark', '--json', ...(DRY_RUN ? ['--dry-run'] : [])]);
    if (x.ok || /already_reacted/.test(x.error)) done.add(postedIn(m));
  }
  return { done: [...done] };
}
// The PR's review request (the latest of those markDone finds): where it is, with replies its link and the times of
// replies from others, or with text, a reply in its thread (a revert, said where the PR was asked about).
async function requestReply({ pr, author, text, replies }) {
  if (text != null && (typeof text !== 'string' || !text.trim() || text.length > 4000)) throw new Error('Bad Slack request');
  const [m] = await requestPosts({ pr, author });
  if (!m) return { where: null };
  // The thread it's in: its own, or, when the request is itself a reply (in a channel's daily review thread, say), that one.
  const root = m.thread_ts ?? m.permalink?.match(/thread_ts=(\d+\.\d+)/)?.[1] ?? m.ts;
  if (text != null) {
    const body = await mentions(text, { login: '', emails: [] }, (await readConfig()).slackUsers ?? {}); // <@gh:login> tags them
    const r = await slackcli(['messages', 'send', `--recipient-id=${m.channel.id}`, `--thread-ts=${root}`, '--message-file', '-', '--json', ...(DRY_RUN ? ['--dry-run'] : [])], body);
    if (!r.ok) throw new Error(r.error);
    if (DRY_RUN) return { where: postedIn(m), dryRun: r.stdout.trim() };
  }
  if (replies !== true) return { where: postedIn(m) };
  const r = await slackcli(['conversations', 'read', m.channel.id, '--thread-ts', root, '--json', '--limit', '200']);
  const said = (r.ok && parseJson(r.stdout)?.messages) || [];
  return { where: postedIn(m), url: m.permalink ?? null, replies: said.filter((x) => Number(x.ts) > Number(m.ts) && x.user !== m.user).map((x) => x.ts) };
}

// PRs someone asked you about on Slack in the last 7 days: a PR link in a DM to you, or beside a tag of you, from
// someone else. GitHub PRs; with lab, GitLab MRs (any host: the page keeps its own). One per PR, newest first: who
// (their GitHub login when Slack people knows them, else their Slack name and ID), the message, and its thread (to
// answer there). The page keeps the open ones not yet asked of you (github.ts slackAskedPRs).
const PR_LINK = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?!\d)/g;
const MR_LINK = /https:\/\/([\w.-]+)\/([\w./-]+?)\/-\/merge_requests\/(\d+)(?!\d)/g;
async function slackAsked(lab) {
  slackMe ??= slackcli(['auth', 'whoami', '--json']).then((r) => parseJson(r.stdout)?.user_id);
  const me = await slackMe;
  if (!/^U[A-Z0-9]+$/.test(me ?? '')) return [];
  const since = Date.now() / 1000 - 7 * 86_400;
  const words = lab ? 'merge_requests' : 'github.com pull';
  const [dms, tags] = await Promise.all([`${words} to:me`, `${words} <@${me}>`].map((q) => slackcli(['search', 'messages', q, '--json', '--limit', '50'])));
  const loginOf = Object.fromEntries(Object.entries((await readConfig()).slackUsers ?? {}).filter(([, v]) => /^U[A-Z0-9]+$/.test(v)).map(([l, v]) => [v, l]));
  const out = new Map();
  for (const [r, dm] of [[dms, true], [tags, false]])
    for (const m of (r.ok && parseJson(r.stdout)?.matches) || []) {
      if (!m.user || m.user === me || Number(m.ts) < since || (dm ? !m.channel?.is_im : !(m.text ?? '').includes(`<@${me}>`))) continue;
      const links = lab ? [...ownLinks(m).matchAll(MR_LINK)].map(([, h, path, n]) => `${h}/${path}#${n}`) : [...ownLinks(m).matchAll(PR_LINK)].map(([, o, name, n]) => `${o}/${name}#${n}`);
      const thread = m.thread_ts ?? m.permalink?.match(/thread_ts=(\d+\.\d+)/)?.[1] ?? m.ts;
      for (const pr of links)
        if (!out.has(pr) || out.get(pr).ts < m.ts) out.set(pr, { pr, login: loginOf[m.user] ?? null, user: m.user, url: m.permalink ?? null, ts: m.ts, channel: m.channel.id, thread });
    }
  const list = [...out.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 20);
  return Promise.all(list.map(async (a) => ({ ...a, name: a.login ? null : (await slackProfile(a.user))?.name ?? null })));
}
// Who I sent this PR's link to in a DM (Settings → Slack, slackSent): their GitHub logins (Slack people), newest first,
// with the message. The page keeps those GitHub or GitLab doesn't ask.
async function slackSentTo(pr) {
  if (typeof pr !== 'string' || !PR_REF.test(pr)) throw new Error('Bad Slack request');
  slackMe ??= slackcli(['auth', 'whoami', '--json']).then((r) => parseJson(r.stdout)?.user_id);
  const me = await slackMe;
  if (!/^U[A-Z0-9]+$/.test(me ?? '')) return [];
  const [repo, n] = pr.split('#');
  const page = prPage(repo, n);
  const link = new RegExp(`${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`);
  const r = await slackcli(['search', 'messages', page, '--json', '--limit', '40']);
  const loginOf = Object.fromEntries(Object.entries((await readConfig()).slackUsers ?? {}).filter(([, v]) => /^U[A-Z0-9]+$/.test(v)).map(([l, v]) => [v, l]));
  const out = [];
  for (const m of (r.ok && parseJson(r.stdout)?.matches) || []) {
    if (!m.channel?.is_im || m.user !== me || !link.test(ownLinks(m))) continue;
    const login = loginOf[m.channel.name]; // a DM's name is the other person's user ID
    if (login && !out.some((o) => o.login === login)) out.push({ login, url: m.permalink ?? null });
  }
  return out;
}
// A reply in a thread (where you were asked: Settings → Slack). <@gh:login> tags them.
async function slackReply({ channel, thread, text }) {
  if (typeof channel !== 'string' || !/^[CDG][A-Z0-9]+$/.test(channel) || typeof thread !== 'string' || !/^\d+\.\d+$/.test(thread) || typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Bad Slack request');
  const body = await mentions(text, { login: '', emails: [] }, (await readConfig()).slackUsers ?? {});
  const r = await slackcli(['messages', 'send', `--recipient-id=${channel}`, `--thread-ts=${thread}`, '--message-file', '-', '--json', ...(DRY_RUN ? ['--dry-run'] : [])], body);
  if (!r.ok) throw new Error(r.error);
  return DRY_RUN ? { ok: true, dryRun: r.stdout.trim() } : { ok: true };
}

// kind 'review': a review request (Settings → Slack), found again by its link rather than kept.
async function postToChannel({ channel, text, pr, kind }) {
  if (typeof channel !== 'string' || !SLACK_CHANNEL.test(channel) || typeof text !== 'string' || !text.trim() || text.length > 4000 || typeof pr !== 'string' || !PR_REF.test(pr)) throw new Error('Bad Slack request');
  const to = await channelId(channel);
  if (to.error) throw new Error(to.error);
  const body = await mentions(text, { login: '', emails: [] }, (await readConfig()).slackUsers ?? {});
  const r = await slackcli(['messages', 'send', `--recipient-id=${to.id}`, '--message-file', '-', '--json', ...(DRY_RUN ? ['--dry-run'] : [])], body);
  if (!r.ok) throw new Error(r.error);
  if (DRY_RUN) return { url: null, dryRun: r.stdout.trim() };
  const sent = parseJson(r.stdout);
  // Kept with the PR's DM threads (slack-threads.json, as "<pr>:#qa": no GitHub login has a #), shown beside its title.
  if (sent?.channel_id && sent?.ts && kind !== 'review') {
    const threads = await readThreads();
    threads[`${pr}:#qa`] = { channel: sent.channel_id, ts: sent.ts, name: to.name ?? channel };
    await saveThreads(threads);
  }
  slackUrl ??= slackcli(['team', 'info', '--json']).then((x) => (x.ok ? parseJson(x.stdout)?.url ?? null : null));
  const base = await slackUrl;
  return { url: base && sent?.channel_id && sent?.ts ? `${base}archives/${sent.channel_id}/p${String(sent.ts).replace('.', '')}` : null };
}

// The QA requests' replies, per PR asked ("owner/repo#n", ones with a request): the times of replies from others, and
// the latest that signs it off ("signed off", "sign-off", "signoff"…) or raises an issue ("bug", "error", "crash"),
// which says so; a reply's forwarded message counts as its text. Read from Slack each time.
const SIGNED = /\bsign(?:ed)?[\s-]?off\b/i;
const ISSUE = /\b(bugs?|errors?|crash(?:es|ed|ing)?)\b/i;
async function qaThreads(prs) {
  const threads = await readThreads();
  slackMe ??= slackcli(['auth', 'whoami', '--json']).then((r) => parseJson(r.stdout)?.user_id);
  const me = await slackMe;
  const out = {};
  await Promise.all(
    prs.filter((pr) => PR_REF.test(pr) && threads[`${pr}:#qa`]).map(async (pr) => {
      const t = threads[`${pr}:#qa`];
      if (!/^[CG][A-Z0-9]+$/.test(t.channel) || !/^\d+\.\d+$/.test(t.ts)) return;
      const r = await slackcli(['conversations', 'read', t.channel, '--thread-ts', t.ts, '--json', '--limit', '200']);
      if (!r.ok) return;
      const replies = (parseJson(r.stdout)?.messages ?? []).filter((m) => m.ts !== t.ts && m.user !== me);
      const said = (m) => [m.text ?? '', ...(m.attachments ?? []).map((a) => a.fallback ?? a.text ?? '')].join('\n');
      const last = [...replies].reverse().find((m) => SIGNED.test(said(m)) || ISSUE.test(said(m)));
      out[pr] = { replies: replies.map((m) => m.ts), status: last ? (SIGNED.test(said(last)) ? 'signed' : 'issue') : null };
    }),
  );
  return out;
}

// Does the channel exist (Settings → Slack → QA channel)? A dry run of a message names it; an ID it can't name is read
// (one message) to tell. Nothing is sent.
async function checkChannel(channel) {
  if (typeof channel !== 'string' || !SLACK_CHANNEL.test(channel)) return { ok: false, error: "not a channel ID, #name or link" };
  const to = await channelId(channel);
  if (to.error) return { ok: false, error: to.error };
  if (to.name) return { ok: true, name: to.name, id: to.id };
  const r = await slackcli(['messages', 'send', `--recipient-id=${to.id}`, '--message-file', '-', '--json', '--dry-run'], '.');
  if (!r.ok) return { ok: false, error: r.error };
  const target = parseJson(r.stdout)?.target;
  if (target?.name) return { ok: true, name: target.name, id: target.id };
  const read = await slackcli(['conversations', 'read', target?.id ?? channel, '--limit', '1', '--json', '--fields', 'ts']);
  return read.ok ? { ok: true, id: target?.id ?? channel } : { ok: false, error: read.error };
}

// check: a dry run that sends nothing (the submit panel asks before you submit whether each recipient can be reached).
async function notify({ recipients, text, thread, check }) {
  const DRY = DRY_RUN || check === true;
  const valid = Array.isArray(recipients) && recipients.length <= 10 && typeof text === 'string' && text.length <= 4000 &&
    typeof thread === 'string' && PR_REF.test(thread) &&
    recipients.every((r) => typeof r?.login === 'string' && Array.isArray(r.emails) && r.emails.every((e) => typeof e === 'string') && (r.at === undefined || (Number.isInteger(r.at) && r.at > Date.now() / 1000 && r.at < Date.now() / 1000 + 120 * 86400)));
  if (!valid) throw new Error('Bad Slack request');
  const users = (await readConfig()).slackUsers ?? {};
  const threads = await readThreads();
  const results = await Promise.all(
    recipients.map(async ({ login, emails, at }) => {
      const body = await mentions(text, { login, emails }, users);
      // at: Slack posts it then (Unix seconds), lgtm needn't be running; its thread is known once it's posted.
      const send = (args) => slackcli(['messages', at ? 'schedule' : 'send', ...args, ...(at ? ['--at', String(at)] : []), '--message-file', '-', '--json', ...(DRY ? ['--dry-run'] : [])], body);
      const key = `${thread}:${login}`;
      const prev = threads[key];
      if (prev && /^[CDG][A-Z0-9]+$/.test(prev.channel) && /^\d+\.\d+$/.test(prev.ts)) {
        const r = await send([`--recipient-id=${prev.channel}`, `--thread-ts=${prev.ts}`]);
        if (r.ok) {
          const sent = DRY ? null : sentOf(r.stdout, at);
          if (sent?.ts) threads[key] = { ...threads[key], last: { channel: sent.channel, ts: sent.ts } }; // to take back (slackDelete)
          return { login, ok: true, threaded: true, ...(at ? { at } : {}), ...(sent ? { sent } : {}), ...(DRY ? { dryRun: r.stdout.trim() } : {}) };
        }
      }
      const targets = [users[login], ...emails].filter((t) => typeof t === 'string' && SLACK_TARGET.test(t));
      if (!targets.length) return { login, ok: false, error: `no Slack user known: map @${login} in Settings → Slack → People` };
      let error = '';
      for (const target of targets) {
        const r = await send([`--recipient-id=${target}`]);
        if (r.ok) {
          const sent = DRY ? null : sentOf(r.stdout, at);
          if (sent?.ts) threads[key] = { channel: sent.channel, ts: sent.ts, user: target, last: { channel: sent.channel, ts: sent.ts } }; // who it's with, for their name and picture
          return { login, ok: true, threaded: false, ...(at ? { at } : {}), ...(sent ? { sent } : {}), ...(DRY ? { dryRun: r.stdout.trim() } : {}) };
        }
        error = r.error;
      }
      return { login, ok: false, error };
    }),
  );
  if (!DRY) await saveThreads(threads);
  return results;
}

// What a send put in Slack, from slackcli's --json: a message (channel, ts) or, scheduled, its id until it's posted.
function sentOf(stdout, at) {
  const d = parseJson(stdout);
  if (!d?.channel_id) return null;
  return at ? (d.scheduled_message_id ? { channel: d.channel_id, scheduled: d.scheduled_message_id } : null) : d.ts ? { channel: d.channel_id, ts: d.ts } : null;
}

// Take back the message lgtm last sent someone about a PR (a review ask undone or withdrawn): `sent` as notify gave
// it, else the last one kept with their thread. A message that started the thread takes the thread with it.
async function slackDelete({ pr, login, sent }) {
  if (!PR_REF.test(pr ?? '') || typeof login !== 'string' || !/^[\w.-]{1,100}$/.test(login)) throw new Error('Bad Slack request');
  const threads = await readThreads();
  const key = `${pr}:${login}`;
  const msg = sent ?? threads[key]?.last;
  if (!msg) return { ok: false, error: 'no message from LGTM to take back' };
  if (!/^[CDG][A-Z0-9]+$/.test(msg.channel ?? '')) throw new Error('Bad Slack request');
  const dry = DRY_RUN ? ['--dry-run'] : [];
  let r;
  if (msg.scheduled) {
    if (!/^Q[A-Z0-9]+$/.test(msg.scheduled)) throw new Error('Bad Slack request');
    r = await slackcli(['messages', 'delete-scheduled', msg.scheduled, '--yes', '--json', ...dry]);
  } else {
    if (!/^\d+\.\d+$/.test(msg.ts ?? '')) throw new Error('Bad Slack request');
    const at = [`--channel-id=${msg.channel}`, `--timestamp=${msg.ts}`];
    r = await slackcli(['messages', 'delete', ...at, '--yes', '--json', ...dry]);
    // Some workspaces don't let people delete their messages; while it can still be edited, it's emptied to "-".
    if (!r.ok) {
      const e = await slackcli(['messages', 'edit', ...at, '--message', '-', '--json', ...dry]);
      if (!e.ok) {
        // Neither: a reply under it (in its thread) saying the ask is off.
        const root = threads[key]?.ts && /^\d+\.\d+$/.test(threads[key].ts) && threads[key].channel === msg.channel ? threads[key].ts : msg.ts;
        const f = await slackcli(['messages', 'send', `--recipient-id=${msg.channel}`, `--thread-ts=${root}`, '--message-file', '-', '--json', ...dry], 'No need to review this anymore, sorry for the noise.');
        if (!f.ok) return { ok: false, error: `Couldn't delete, edit or reply to it on Slack (${r.error}): delete it there yourself` };
        if (!DRY_RUN && threads[key]?.last?.ts === msg.ts) (delete threads[key].last, await saveThreads(threads));
        return { ok: true, followedUp: true };
      }
      if (!DRY_RUN && threads[key]?.last?.ts === msg.ts) (delete threads[key].last, await saveThreads(threads));
      return { ok: true, edited: true };
    }
  }
  if (!r.ok) return { ok: false, error: r.error };
  if (!DRY_RUN && threads[key] && !msg.scheduled) {
    if (threads[key].ts === msg.ts) delete threads[key];
    else if (threads[key].last?.ts === msg.ts) delete threads[key].last;
    await saveThreads(threads);
  }
  return { ok: true };
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65536) throw new Error('Request too large');
  }
  return JSON.parse(body);
}

// Tail of a GitHub Actions job log, via gh (the logs API redirects to storage the page can't read cross-origin).
function jobLog(repo, job, user) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(job)) return Promise.reject(new Error('Bad job'));
  let env;
  try {
    env = user ? { ...process.env, GH_TOKEN: ghToken(user) } : undefined; // gh api as the account lgtm uses
  } catch (e) {
    return Promise.reject(e);
  }
  // Newer gh refuses to print escape sequences without --allow-escape-sequences; older gh doesn't know the flag.
  const run = (extra) =>
    new Promise((resolve, reject) =>
      execFile('gh', ['api', ...extra, `repos/${repo}/actions/jobs/${job}/logs`], { maxBuffer: 1 << 27, timeout: 30000, env }, (err, stdout, stderr) =>
        err ? reject(new Error(stderr.trim().split('\n').pop() || err.message)) : resolve(stdout),
      ),
    );
  return run(['--allow-escape-sequences'])
    .catch((e) => (/unknown flag/.test(e.message) ? run([]) : Promise.reject(e)))
    .then((stdout) => {
      // Drop terminal colour/control sequences (CSI and OSC) that CI tools print.
      const plain = stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\r/g, '');
      const lines = plain.trimEnd().split('\n').map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ''));
      // End at the last error GitHub marked, not at the post-job cleanup that follows it.
      const end = lines.findLastIndex((l) => l.startsWith('##[error]')) + 1 || lines.length;
      return lines.slice(Math.max(0, end - 60), end).join('\n');
    });
}

// Ask Claude: the page's prompt (instructions, the file and the question) through Claude Code's CLI, signed in like the
// others. No tools and no saved session: Claude only reads what it's given and writes text back.
// `model` (an alias such as opus, or a full name) and `effort` (low … max): Settings → Claude Code → Prompts; none,
// Claude Code's own.
const CLAUDE_MODEL = /^[\w.[\]-]{1,80}$/, EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'], CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
// `agent`: Claude Code (claude), or Codex (codex). `onDelta`: each piece of Claude's answer as it's written (Codex's
// comes whole, at the end).
// `cwd`: a read-only checkout of the repo (reviewWorktree) to read it from, as in a terminal: its CLAUDE.md or AGENTS.md,
// its skills, what they point to. Restricted (no shell, none of the repo's settings or hooks), reading only.
// `read`: filled with the repo files it opened there (relative to it; a skill as "skill: name"), to show which rules it
// went by.
// `keep`: its session kept to open later (Settings → Coding agents), its id put in keep.id.
function agentText(input, model, effort, agent, onDelta, cwd, read = [], keep = null) {
  if (typeof input !== 'string' || !input || input.length > 800_000) return Promise.reject(new Error('Bad request for Claude'));
  if (agent === 'codex') return codexText(input, model, effort, cwd, read, keep);
  if ((model && !CLAUDE_MODEL.test(model)) || (effort && !EFFORTS.includes(effort))) return Promise.reject(new Error('Bad request for Claude'));
  return new Promise((resolve, reject) => {
    const tools = cwd ? ['--restricted', '--tools', 'Read,Grep,Glob,Skill', '--allowedTools', 'Read,Grep,Glob,Skill', '--strict-mcp-config'] : ['--tools', ''];
    if (keep) keep.id = randomUUID();
    const args = ['-p', ...tools, ...(keep ? ['--session-id', keep.id] : ['--no-session-persistence']), '--output-format', 'stream-json', '--verbose', '--include-partial-messages', ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])];
    const child = spawn('claude', args, { cwd: cwd ?? homedir() });
    let text = '', result = null, err = '', buf = '', late = false;
    const timer = setTimeout(() => ((late = true), child.kill()), cwd ? 600000 : 300000); // reading the repo takes longer
    child.stdout.setEncoding('utf8').on('data', (d) => {
      buf += d;
      for (let n; (n = buf.indexOf('\n')) >= 0; buf = buf.slice(n + 1)) {
        let e;
        try {
          e = JSON.parse(buf.slice(0, n));
        } catch {
          continue;
        }
        if (e.type === 'stream_event' && e.event?.delta?.type === 'text_delta') (text += e.event.delta.text), onDelta?.(e.event.delta.text);
        else if (e.type === 'result') result = e;
        else if (cwd && e.type === 'assistant')
          for (const c of e.message?.content ?? []) {
            const f = c?.type === 'tool_use' && (c.name === 'Read' ? relTo(cwd, c.input?.file_path) : c.name === 'Skill' && c.input?.skill ? `skill: ${c.input.skill}` : null);
            if (f && !read.includes(f)) read.push(f);
          }
      }
    });
    child.stderr.setEncoding('utf8').on('data', (d) => (err = (err + d).slice(-8000)));
    child.stdin.on('error', () => {}); // it quit before reading it all: its exit says why
    child.on('error', (e) => (clearTimeout(timer), reject(e.code === 'ENOENT' ? new Error("Claude Code isn't installed (see claude.com/code), or not on the PATH") : e)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (late) return reject(new Error('Claude Code took too long and was stopped'));
      if (code || result?.is_error) {
        const last = err.trim().split('\n').pop() || String(result?.result ?? '').trim().split('\n').pop() || `Claude Code stopped (${code})`;
        if (/authenticat|log ?in|oauth|unauthori[sz]ed/i.test(last)) return reject(new Error("Claude Code isn't signed in: run `claude` in Terminal, then /login"));
        return reject(new Error(last));
      }
      resolve(String(result?.result ?? text).trim());
    });
    child.stdin.end(input);
  });
}

// The coding agents' CLIs installed (Settings → Coding agents): each one's --version, or null.
const agentVersion = (bin) =>
  new Promise((resolve) => execFile(bin, ['--version'], { timeout: 15000 }, (err, stdout) => resolve(err ? null : stdout.trim().split('\n')[0].replace(/^codex-cli\s+/, '').replace(/\s*\(Claude Code\)$/, '') || null)));
// Codex's models as its CLI last fetched them (~/.codex/models_cache.json): the ones it lists, each with the efforts it
// takes. None (no cache yet): the model is typed.
const codexModels = () =>
  readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'), 'utf8').then(
    (t) => (JSON.parse(t).models ?? []).filter((m) => m.visibility === 'list' && typeof m.slug === 'string').map((m) => ({ id: m.slug, name: m.display_name || m.slug, efforts: (m.supported_reasoning_levels ?? []).map((e) => e.effort).filter((e) => CODEX_EFFORTS.includes(e)) })),
    () => null,
  );
const detectAgents = async () => [{ id: 'claude', version: await agentVersion('claude') }, { id: 'codex', version: await agentVersion('codex'), models: await codexModels() }];

// The same through Codex's CLI (`codex login`), signed in like the others: its last message back. With every tool it has
// switched off (shell, browser, computer use, apps, images, MCP servers, web search) and read-only, in an empty
// folder: like Claude above, it only reads what it's given (a PR's text could otherwise steer it to read files and
// put them in a review lgtm posts). In a review's copy of the repo its shell is on, under a profile that can read
// nothing else (codexText).
const CODEX_OFF = ['shell_tool', 'unified_exec', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'apps', 'view_image'];
// `cwd`: the repo's copy (reviewWorktree), read through its shell under a permission profile that lets it read only
// that copy, the system's basics (:minimal) and Codex's own install, and write nothing, no network: not your home
// folder (your GitHub token, keys). Without one, no shell at all.
async function codexText(input, model, effort, cwd, read = [], keep = null) {
  if ((model && !CLAUDE_MODEL.test(model)) || (effort && !CODEX_EFFORTS.includes(effort))) throw new Error('Bad request for Codex');
  const dir = await mkdtemp(join(tmpdir(), 'lgtm-codex-'));
  const off = cwd ? CODEX_OFF.filter((f) => !['shell_tool', 'unified_exec'].includes(f)) : CODEX_OFF;
  const bin = cwd && (process.env.PATH ?? '').split(':').map((d) => join(d, 'codex')).find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
  const readable = bin ? [dirname(bin), dirname(dirname(realpathSync(bin)))] : []; // its helper runs from there
  const sandbox = cwd
    ? ['-c', 'default_permissions="lgtm_review"', '-c', `permissions.lgtm_review.filesystem={${[':minimal', ':workspace_roots', ...readable].map((p) => `${JSON.stringify(p)}="read"`).join(',')}}`]
    : ['--sandbox', 'read-only'];
  const out = join(dir, 'answer.txt');
  try {
    await new Promise((resolve, reject) => {
      const child = execFile(
        'codex',
        ['exec', '--skip-git-repo-check', ...(keep ? [] : ['--ephemeral']), ...sandbox, '--color', 'never', '-C', cwd ?? dir, ...off.flatMap((f) => ['--disable', f]),
          '-c', 'mcp_servers={}', '-c', 'web_search="disabled"', ...(model ? ['-m', model] : []), ...(effort ? ['-c', `model_reasoning_effort=${effort}`] : []), ...(cwd || keep ? ['--json'] : []), '-o', out, '-'],
        { cwd: cwd ?? dir, maxBuffer: 1 << 26, timeout: cwd ? 600000 : 300000 },
        (err, stdout, stderr) => {
          if (err?.code === 'ENOENT') return reject(new Error("Codex isn't installed (brew install codex), or not on the PATH"));
          const last = (stderr || stdout).trim().split('\n').pop() || err?.message;
          if (err && /log ?in|auth|unauthori[sz]ed|401/i.test(last ?? '')) return reject(new Error("Codex isn't signed in: run `codex login` in Terminal, then try again"));
          if (err) return reject(new Error(last));
          if (keep) keep.id = stdout.match(/"type":"thread\.started","thread_id":"([\w-]+)"/)?.[1] ?? null; // to resume it
          // Reading the repo: its events (--json), each command's words that are files of the repo, as what it read.
          if (cwd)
            for (const line of stdout.split('\n')) {
              let cmd = null;
              try {
                cmd = line.includes('command_execution') ? JSON.parse(line)?.item?.command : null;
              } catch {}
              for (const w of typeof cmd === 'string' ? cmd.split(/[\s'"|;&<>()]+/) : []) {
                const f = w && !w.startsWith('-') && relTo(cwd, join(cwd, w));
                if (f && !read.includes(f) && statSync(join(cwd, f), { throwIfNoEntry: false })?.isFile()) read.push(f);
              }
            }
          resolve();
        },
      );
      child.stdin.end(input);
    });
    return (await readFile(out, 'utf8')).trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// A path inside `dir` as relative to it; null outside it.
const relTo = (dir, p) => {
  if (typeof p !== 'string' || !p) return null;
  const n = normalize(p.startsWith('/') ? p : join(dir, p));
  for (const d of [dir, realpathSync(dir)]) if (n.startsWith(d + sep)) return n.slice(d.length + 1); // /var is /private/var on macOS
  return null;
};

// A checkout of a repo ("owner/name" on GitHub, "host/group/name" on GitLab) on this machine: the folder Settings names
// for it, else one a Claude Code session worked in (its main checkout first; worktrees share its git data) whose remote
// is the repo. With the remote's name, to fetch from.
const git = (dir, args) =>
  new Promise((resolve, reject) =>
    execFile('git', ['-C', dir, ...args], { timeout: 120000, maxBuffer: 1 << 22, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => (err ? reject(new Error(stderr.trim().split('\n').pop() || err.message)) : resolve(stdout))),
  );
// Where you've worked, newest first, from the tools' own records (so wherever they put things, on any machine): Claude
// desktop's sessions (originCwd, cwd), Claude Code's transcripts ($CLAUDE_CONFIG_DIR or ~/.claude, projects/*/*.jsonl,
// their first "cwd") and Codex's ($CODEX_HOME or ~/.codex, sessions/**/*.jsonl, its session_meta's cwd). Kept ten
// minutes; the newest 400 files read, each from its start only.
let foldersSeen;
async function sessionFolders() {
  if (foldersSeen && Date.now() - foldersSeen.at < 600_000) return foldersSeen.dirs;
  const files = [];
  const walk = async (dir, depth, ok) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth > 0) await walk(p, depth - 1, ok);
      else if (e.isFile() && ok.test(e.name)) files.push(p);
    }
  };
  await walk(CLAUDE_SESSIONS, 3, /^local_[\w-]+\.json$/);
  await walk(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects'), 1, /\.jsonl$/);
  await walk(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'), 4, /\.jsonl$/);
  const dated = await Promise.all(files.map(async (f) => [f, (await stat(f).catch(() => null))?.mtimeMs ?? 0]));
  const dirs = [];
  for (const [f] of dated.sort((a, b) => b[1] - a[1]).slice(0, 400)) {
    if (f.endsWith('.json')) {
      const j = await readFile(f, 'utf8').then(JSON.parse).catch(() => null);
      for (const d of [j?.originCwd, j?.cwd]) if (typeof d === 'string' && d.startsWith('/') && !dirs.includes(d)) dirs.push(d);
      continue;
    }
    let head = '';
    try {
      const h = await openFile(f, 'r');
      const { bytesRead, buffer } = await h.read(Buffer.alloc(65536), 0, 65536, 0);
      await h.close();
      head = buffer.subarray(0, bytesRead).toString('utf8');
    } catch {
      continue;
    }
    const d = head.match(/"cwd":\s*"([^"\\]+)"/)?.[1];
    if (d?.startsWith('/') && !dirs.includes(d)) dirs.push(d);
  }
  foldersSeen = { at: Date.now(), dirs };
  return dirs;
}
async function localCheckout(repo, folder) {
  const [host, ...path] = repo.includes('.') && repo.split('/')[0].includes('.') ? repo.split('/') : ['github.com', ...repo.split('/')];
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const url = new RegExp(`${esc(host)}[:/]${esc(path.join('/'))}(\\.git)?/?$`, 'i');
  for (const dir of [folder, ...(await sessionFolders())].filter(Boolean)) {
    const remotes = await git(dir, ['remote', '-v']).catch(() => '');
    const hit = remotes.split('\n').map((l) => l.split(/\s+/)).find(([, u]) => u && url.test(u));
    if (hit) return { dir: (await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim().replace(/\/\.git$/, ''), remote: hit[0] };
  }
  return null;
}
// The repo at `sha` (the PR's base: its rules as they were before the PR), as a worktree of the user's checkout in a
// folder of its own, detached: their branch and files untouched. The commit fetched first when the checkout hasn't it.
// done() removes it. Null: no checkout of the repo here.
async function reviewWorktree({ repo, sha, folder }, at = null) {
  if (typeof repo !== 'string' || !/^[\w.-]+(\/[\w.-]+)+$/.test(repo) || !/^[0-9a-f]{40}$/.test(sha ?? '') || (folder && (typeof folder !== 'string' || !folder.startsWith('/')))) return null;
  const co = await localCheckout(repo, folder);
  if (!co) return null;
  if (!(await git(co.dir, ['cat-file', '-e', `${sha}^{commit}`]).then(() => true, () => false))) await git(co.dir, ['fetch', '--quiet', '--no-tags', co.remote, sha]);
  const dir = at ?? join(tmpdir(), `lgtm-review-${randomBytes(6).toString('hex')}`);
  await git(co.dir, ['worktree', 'prune']); // a copy of it removed before: its old record goes first
  await git(co.dir, ['worktree', 'add', '--detach', '--quiet', dir, sha]);
  return { dir, done: () => git(co.dir, ['worktree', 'remove', '--force', dir]).catch(() => rm(dir, { recursive: true, force: true })) };
}

// A kept agent-review session, resumed where it ran (Claude's in the Claude desktop app, else Terminal): its copy of the repo made again there first (same
// path and commit; it isn't removed after, it's yours to explore), else your home folder.
async function openAgentSession({ agent, id, dir, repo, sha, folder }) {
  if (!['claude', 'codex'].includes(agent) || !/^[\w-]{8,64}$/.test(id ?? '')) throw new Error('Bad session');
  let at = homedir();
  if (dir) {
    if (typeof dir !== 'string' || !/^\/[\w./-]+\/lgtm-review-[0-9a-f]+$/.test(dir)) throw new Error('Bad session');
    if (!statSync(dir, { throwIfNoEntry: false })) await reviewWorktree({ repo, sha, folder }, dir).then((w) => w ?? Promise.reject(new Error(`No checkout of ${repo} here to open it in`)));
    at = dir;
  }
  // Claude's: in the Claude desktop app, which imports a CLI session from its claude://resume link (where it ran: the
  // copy made again above). Codex's, or with no desktop app: Terminal.
  const run = (args) => new Promise((resolve, reject) => execFile('open', args, { timeout: 15000 }, (err, _o, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve())));
  if (agent === 'claude' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && (await run([`claude://resume?session=${id}`]).then(() => true, () => false))) return;
  // A .command file Terminal opens and runs: no permission to script Terminal needed.
  const file = join(tmpdir(), `lgtm-session-${id}.command`);
  await writeFile(file, `#!/bin/zsh -l\ncd '${at}' && ${agent === 'codex' ? 'codex resume' : 'claude --resume'} ${id}\n`, { mode: 0o700 });
  await run(['-a', 'Terminal', file]);
}

// A Jira ticket, via the Atlassian CLI (`acli jira auth login`), which owns the sign-in like gh and slackcli do.
const acli = (args) =>
  new Promise((resolve, reject) =>
    execFile('acli', args, { maxBuffer: 1 << 24, timeout: 30000 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') return reject(new Error('acli is not installed (brew install atlassian/homebrew-acli/acli)'));
      if (err) return reject(new Error((stderr || stdout).trim().split('\n').pop()?.replace(/^✗ Error: /, '') || err.message));
      resolve(stdout);
    }),
  );
let jiraSite; // https://<site>.atlassian.net, for browse links: the issue's own `self` is an internal API host
async function jiraIssue(key) {
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) throw new Error('Bad issue key');
  jiraSite ??= acli(['jira', 'auth', 'status']).then((out) => 'https://' + (out.match(/Site:\s*(\S+)/)?.[1] ?? ''));
  const [site, out] = await Promise.all([jiraSite, acli(['jira', 'workitem', 'view', key, '--json', '--fields', 'summary,status,issuetype,priority,description'])]);
  const f = JSON.parse(out).fields;
  return { key, url: `${site}/browse/${key}`, summary: f.summary, status: f.status?.name, statusCategory: f.status?.statusCategory?.key, type: f.issuetype?.name, priority: f.priority?.name, description: f.description ?? null };
}

// A new ticket (a PR comment turned into one): a Task in the project, its key and link.
async function jiraCreate(b) {
  const project = String(b?.project ?? ''), summary = String(b?.summary ?? '').trim(), description = String(b?.description ?? '');
  if (!/^[A-Z][A-Z0-9]+$/.test(project) || !summary || summary.length > 250 || /[\n\r]/.test(summary) || summary.startsWith('-')) throw new Error('Bad request');
  const [site, out] = await Promise.all([jiraSite ??= acli(['jira', 'auth', 'status']).then((o) => 'https://' + (o.match(/Site:\s*(\S+)/)?.[1] ?? '')), acli(['jira', 'workitem', 'create', '--project', project, '--type', 'Task', '--summary', summary, '--description', description || ' ', '--json'])]);
  const key = JSON.parse(out).key;
  return { key, url: `${site}/browse/${key}` };
}

// Tickets' priorities (the PR list's order), by key: one search for all of them.
async function jiraPriorities(keys) {
  keys = [...new Set(keys)].filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k)).slice(0, 100);
  if (!keys.length) return {};
  const out = await acli(['jira', 'workitem', 'search', '--jql', `key in (${keys.join(',')})`, '--fields', 'priority', '--limit', '100', '--json']);
  return Object.fromEntries(JSON.parse(out).map((i) => [i.key, i.fields?.priority?.name ?? '']));
}

// A ticket moved to another status (after its PR merges: the merge box), by the status's name as Jira shows it.
async function jiraMove(b) {
  const status = typeof b?.status === 'string' ? b.status.trim() : '';
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(b?.key ?? '') || !status || status.length > 60 || /[\n\r]/.test(status) || status.startsWith('-')) throw new Error('Bad request');
  await acli(['jira', 'workitem', 'transition', '--key', b.key, '--status', status, '--yes']);
}

// A project's statuses (Jira's names, and their category: new, indeterminate or done), for the after-merge pickers. acli
// can't list them, so: a ticket in none of the ones found so far, again and again (each query finds one more), the
// three categories side by side.
async function jiraStatuses(project) {
  if (!/^[A-Z][A-Z0-9]+$/.test(project ?? '')) throw new Error('Bad project');
  const inCategory = async (cat, key) => {
    const found = [];
    for (let i = 0; i < 25; i++) {
      const not = found.length ? ` AND status not in (${found.map((s) => JSON.stringify(s)).join(', ')})` : '';
      const out = await acli(['jira', 'workitem', 'search', '--jql', `project = ${project} AND statusCategory = "${cat}"${not}`, '--fields', 'status', '--limit', '1', '--json']);
      const name = (() => { try { return JSON.parse(out)[0]?.fields?.status?.name; } catch { return null; } })();
      if (!name) break;
      found.push(name);
    }
    return found.map((name) => ({ name, category: key }));
  };
  return (await Promise.all([inCategory('To Do', 'new'), inCategory('In Progress', 'indeterminate'), inCategory('Done', 'done')])).flat();
}

// --- Claude Code sessions per PR (Settings → Claude Code) ---
// Claude desktop keeps a record per Code session (its desktop id, title, transcript id) and Claude Code a transcript
// whose first message is the prompt. A session belongs to the PRs whose links appear in that first prompt (lgtm's
// "✳ Claude" puts the PR link there). Claude's internal formats: if they change, this finds nothing rather than failing.
const CLAUDE_SESSIONS = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
// PR links, or owner/repo#123 references (both normalised to the link); GitLab merge request links as they are.
const PR_REF_IN_TEXT = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)|https:\/\/([\w-]+(?:\.[\w-]+)+(?::\d+)?(?:\/[\w.-]+){2,}?)\/-\/merge_requests\/(\d+)|\b([\w.-]+\/[\w.-]+)#(\d+)\b/g;
const prsIn = (text) =>
  [...new Set([...text.matchAll(PR_REF_IN_TEXT)].map((m) => (m[3] ? `https://${m[3]}/-/merge_requests/${m[4]}` : `https://github.com/${m[1] ?? m[5]}/pull/${m[2] ?? m[6]}`)))];

// The text of a transcript's first user message (reading at most 4 MB to get there).
async function firstPrompt(file) {
  const fh = await openFile(file).catch(() => null);
  if (!fh) return '';
  try {
    const buf = Buffer.alloc(4 << 20);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
      if (!line.includes('"type":"user"')) continue;
      try {
        const c = JSON.parse(line).message?.content;
        return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x?.text ?? '').join('\n') : '';
      } catch {}
    }
    return '';
  } finally {
    await fh.close();
  }
}

const promptCache = new Map(); // transcript file → { mtime, prs }
async function claudeSessions() {
  const files = [];
  const walk = async (dir, depth) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 3) await walk(p, depth + 1);
      else if (e.isFile() && /^local_[\w-]+\.json$/.test(e.name)) files.push(p);
    }
  };
  await walk(CLAUDE_SESSIONS, 0);
  const projects = await readdir(CLAUDE_PROJECTS).catch(() => []);
  const out = [];
  for (const f of files) {
    const s = await readFile(f, 'utf8').then(JSON.parse).catch(() => null);
    if (!s || s.isArchived || !/^local_[A-Za-z0-9-]{1,64}$/.test(s.sessionId ?? '') || !/^[\w-]+$/.test(s.cliSessionId ?? '')) continue;
    let transcript = null;
    for (const d of projects) {
      const t = join(CLAUDE_PROJECTS, d, `${s.cliSessionId}.jsonl`);
      const st = await stat(t).catch(() => null);
      if (st) {
        transcript = { t, mtime: st.mtimeMs };
        break;
      }
    }
    if (!transcript) continue;
    let hit = promptCache.get(transcript.t);
    if (!hit || hit.mtime !== transcript.mtime) {
      hit = { mtime: transcript.mtime, prs: prsIn(await firstPrompt(transcript.t)) };
      promptCache.set(transcript.t, hit);
    }
    out.push({ id: s.sessionId, cli: s.cliSessionId, title: s.title ?? '', lastActivityAt: Number(s.lastActivityAt) || 0, prs: hit.prs });
  }
  return out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

// The lgtm-review skill that sends PRs ready for review to lgtm, installed for the user: Claude Code's
// (app/claude-skill.md, in ~/.claude/skills) or Codex's (app/codex-skill.md, in $CODEX_HOME/skills).
const SKILLS = {
  claude: { file: join(homedir(), '.claude', 'skills', 'lgtm-review', 'SKILL.md'), text: '../claude-skill.md' },
  codex: { file: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills', 'lgtm-review', 'SKILL.md'), text: '../codex-skill.md' },
};
// Messages lgtm leaves for a Claude Code session (a comment to address, a review), read by its lgtm-review skill when
// the user says "check lgtm" there: ~/.config/lgtm/outbox/<session>.md, appended to, deleted by the skill once read.
const SESSION_ID = /^(local_[A-Za-z0-9-]{1,64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const OUTBOX = join(dirname(CONFIG), 'outbox');
async function leaveForSession({ id, text }) {
  if (!SESSION_ID.test(id ?? '') || typeof text !== 'string' || !text.trim() || text.length > 50_000) throw new Error('Bad message for Claude');
  await mkdir(OUTBOX, { recursive: true });
  const file = join(OUTBOX, `${id}.md`);
  const before = await readFile(file, 'utf8').catch(() => '');
  await writeFile(file, `${before}${before ? '\n\n---\n\n' : ''}<!-- from lgtm, ${new Date().toISOString()} -->\n${text.trim()}\n`);
  return { path: file };
}

// A session's title and what it's doing, from its record in the Claude app: waiting for the user (a question or a
// permission), working (activity past its last turn edge, recently), or idle. A CLI-only session has no record.
const sessionFiles = new Map(); // session id → the record it was found in last time (it's polled every few seconds)
async function claudeSession(id) {
  if (!SESSION_ID.test(id ?? '')) throw new Error('Bad session id');
  const matches = (s) => s && (s.sessionId === id || s.cliSessionId === id || s.priorCliSessionIds?.includes(id));
  let found = null;
  if (sessionFiles.has(id)) {
    const s = await readFile(sessionFiles.get(id), 'utf8').then(JSON.parse).catch(() => null);
    if (matches(s)) found = s;
    else sessionFiles.delete(id);
  }
  const walk = async (dir, depth) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (found) return;
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 3) await walk(p, depth + 1);
      else if (e.isFile() && /^local_[\w-]+\.json$/.test(e.name)) {
        if (id.startsWith('local_') && e.name !== `${id}.json`) continue;
        const s = await readFile(p, 'utf8').then(JSON.parse).catch(() => null);
        if (matches(s)) (found = s), sessionFiles.set(id, p);
      }
    }
  };
  if (!found) await walk(CLAUDE_SESSIONS, 0);
  if (!found || found.isArchived) return null;
  const last = Number(found.lastActivityAt) || 0;
  const edge = Number(found.lastTurnEdgeAt) || 0;
  const state = found.interruptedAwaitingPerson ? 'waiting' : last - edge > 2000 && Date.now() - last < 120_000 ? 'working' : 'idle';
  return { id: found.sessionId, title: found.title ?? '', state };
}

// Is the lgtm-links mod (mods/lgtm-links in this repo) installed in Claude Code? Its record of installed plugins
// (~/.claude, or CLAUDE_CONFIG_DIR) names it as lgtm-links@<marketplace>.
// Codex's (agent "codex"): its config.toml has a [plugins."lgtm-links@…"] table that isn't switched off.
async function agentMod(agent) {
  if (agent === 'codex') {
    const config = await readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'utf8').catch(() => '');
    const table = config.match(/^\[plugins\."lgtm-links@[^\]]*\]([^[]*)/m);
    return { installed: !!table && !/^\s*enabled\s*=\s*false/m.test(table[1]) };
  }
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const d = JSON.parse(await readFile(join(dir, 'plugins', 'installed_plugins.json'), 'utf8').catch(() => '{}'));
  return { installed: Object.keys(d?.plugins ?? {}).some((k) => k.startsWith('lgtm-links@')) };
}

async function agentSkill(install, agent = 'claude') {
  const s = SKILLS[agent] ?? SKILLS.claude;
  const want = await readFile(new URL(s.text, import.meta.url), 'utf8');
  if (install) await mkdir(dirname(s.file), { recursive: true }).then(() => writeFile(s.file, want));
  const have = await readFile(s.file, 'utf8').catch(() => null);
  return { installed: have != null, current: have === want, path: s.file };
}

const json = (res, status, value) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));

// LGTM_NO_OPEN=1: don't open a browser tab (tests, or running lgtm as a background service).
function open(url) {
  if (process.env.LGTM_NO_OPEN === '1') return;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  execFile(cmd, args, () => {});
}

try {
  ghToken();
} catch {
  console.error('lgtm uses the GitHub CLI login. Install gh and run `gh auth login`, then try again.');
  process.exit(1);
}

// lgtm-web https://github.com/o/r/pull/1[?claude=<session>]: the PR, and the Claude Code session that sent it (skill).
const pr = process.argv[2]?.match(/github\.com\/[^/]+\/[^/]+\/pull\/\d+|[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:\/[\w.-]+){2,}?\/-\/merge_requests\/\d+/)?.[0]; // or a GitLab MR's
const from = process.argv[2]?.match(/[?&]claude=([\w-]{1,80})/)?.[1];
const url = ORIGIN + '/' + (pr ? '#https://' + pr + (from ? '?claude=' + from : '') : '');

const server = createServer(async (req, res) => {
  // DNS-rebinding guard: a hostile site resolving its own name to 127.0.0.1 sends its own Host header.
  if (!HOSTS.has(req.headers.host ?? '')) return res.writeHead(403).end();
  const path = new URL(req.url ?? '/', ORIGIN).pathname;

  if (path === '/lgtm') return res.end(`lgtm ${VERSION}`);
  // /token, /slack, /job-log and /jira act with your credentials: only our own page may call them
  // (browsers set Sec-Fetch-Site on every request, so other sites' requests and form posts are refused).
  if (['/token', '/slack', '/job-log', '/jira', '/integrations', '/slack-people', '/claude-sessions', '/agent-text', '/agent-skill', '/agent-mod', '/agent-outbox', '/agent-archive', '/claude-session', '/gh-accounts', '/glab-accounts', '/glab-token', '/agents', '/slack-emoji', '/slack-post', '/slack-done', '/slack-delete', '/agent-session', '/slack-request', '/slack-asked', '/slack-reply', '/slack-sent', '/slack-channel', '/slack-qa', '/slack-threads', '/jira-move', '/jira-statuses', '/jira-priorities', '/jira-create', '/slack-presence'].includes(path) && req.headers['sec-fetch-site'] !== 'same-origin') return res.writeHead(403).end();
  if (path === '/agent-text' && req.method === 'POST') {
    // A line of JSON per piece of the answer ({d}), then the whole of it ({text}) or why not ({error}).
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const say = (m) => res.write(JSON.stringify(m) + '\n');
    // local: the repo to read, and the prompt for reading it there; without a checkout here, the plain prompt.
    let wt = null;
    return readJson(req)
      .then(async (b) => {
        wt = b?.local ? await reviewWorktree(b.local).catch(() => null) : null;
        const read = [], keep = b?.keep ? {} : null;
        const text = await agentText(wt && typeof b.local.input === 'string' ? b.local.input : b?.input, b?.model, b?.effort, b?.agent, (d) => say({ d }), wt?.dir, read, keep);
        // The session kept: its agent, id, and where it ran (the review's copy: made again there to open it).
        const session = keep?.id ? { agent: b.agent === 'codex' ? 'codex' : 'claude', id: keep.id, ...(wt ? { dir: wt.dir, repo: b.local.repo, sha: b.local.sha } : {}) } : undefined;
        return { text, read: wt ? read : undefined, session };
      })
      .then(({ text, read, session }) => say({ text, read, session }), (e) => say({ error: e.message }))
      .finally(() => (wt?.done(), res.end()));
  }
  if (path === '/job-log') {
    const q = new URL(req.url ?? '/', ORIGIN).searchParams;
    return jobLog(q.get('repo') ?? '', q.get('job') ?? '', q.get('user') ?? '').then(
      (text) => res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(text),
      (e) => res.writeHead(500, { 'Content-Type': 'text/plain' }).end(e.message),
    );
  }
  if (path === '/slack-presence')
    return slackPresence((new URL(req.url ?? '/', ORIGIN).searchParams.get('logins') ?? '').split(',')).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/slack-people') {
    try {
      if (req.method === 'GET') return json(res, 200, await slackPeople());
      if (req.method === 'POST') return json(res, 200, await findSlack((await readJson(req)).people));
      if (req.method === 'PUT') return json(res, 200, await saveSlackPeople(await readJson(req)));
      return res.writeHead(405).end();
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }
  // A Codex conversation archived (codex archive) once its PR is approved, or back (undo).
  if (path === '/agent-archive' && req.method === 'POST')
    return readJson(req)
      .then((b) => {
        if (!SESSION_ID.test(b?.id ?? '')) throw new Error('Bad conversation id');
        return new Promise((ok, no) => execFile('codex', [b.undo ? 'unarchive' : 'archive', b.id], { timeout: 30000 }, (e, _o, err) => (e ? no(new Error(e.code === 'ENOENT' ? "Codex isn't installed" : err.trim().split('\n').at(-1)?.replace(/^Error:\s*/, '') || "Codex couldn't")) : ok({}))));
      })
      .then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/agent-outbox' && req.method === 'POST') return readJson(req).then(leaveForSession).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/claude-session') return claudeSession(new URL(req.url ?? '/', ORIGIN).searchParams.get('id')).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/agent-mod') return agentMod(new URL(req.url ?? '/', ORIGIN).searchParams.get('agent')).then((s) => json(res, 200, s), (e) => json(res, 500, { error: e.message }));
  if (path === '/agent-skill') return agentSkill(req.method === 'POST', new URL(req.url ?? '/', ORIGIN).searchParams.get('agent') ?? 'claude').then((s) => json(res, 200, s), (e) => json(res, 500, { error: e.message }));
  if (path === '/claude-sessions') return claudeSessions().then((s) => json(res, 200, s), (e) => json(res, 500, { error: e.message }));
  if (path === '/integrations') {
    const plain = (s = '') => s.replace(/\x1b\[[0-9;]*m/g, ''); // the CLIs colour their output
    const [slack, jira] = await Promise.all([
      // canSchedule: Slack schedules messages for app sign-ins, not a browser's.
      slackcli(['auth', 'whoami', '--json']).then((r) => ((d) => ({ ok: r.ok, error: r.error, who: d?.user, team: d?.workspace_id, canSchedule: !!d?.auth_type && d.auth_type !== 'browser' }))(r.ok ? parseJson(r.stdout) : null)),
      acli(['jira', 'auth', 'status']).then(
        (out) => ({ ok: true, site: plain(out).match(/Site:\s*(\S+)/)?.[1] }),
        (e) => ({ ok: false, error: e.message }),
      ),
    ]);
    return json(res, 200, { slack, jira });
  }
  if (path === '/jira-create' && req.method === 'POST') return readJson(req).then(jiraCreate).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/jira-priorities') return jiraPriorities((new URL(req.url ?? '/', ORIGIN).searchParams.get('keys') ?? '').split(',')).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/jira-statuses') return jiraStatuses(new URL(req.url ?? '/', ORIGIN).searchParams.get('project')).then((l) => json(res, 200, l), (e) => json(res, 500, { error: e.message }));
  if (path === '/jira-move' && req.method === 'POST')
    return readJson(req).then(jiraMove).then(() => json(res, 200, { ok: true }), (e) => json(res, 500, { error: e.message }));
  if (path === '/jira') {
    return jiraIssue(new URL(req.url ?? '/', ORIGIN).searchParams.get('key') ?? '').then(
      (issue) => json(res, 200, issue),
      (e) => json(res, 500, { error: e.message }),
    );
  }
  if (path === '/slack-threads') return (req.method === 'POST' ? readJson(req).then((b) => backupThreads(b?.threads)) : backupThreads()).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/slack-qa') return qaThreads((new URL(req.url ?? '/', ORIGIN).searchParams.get('prs') ?? '').split(',').filter(Boolean).slice(0, 100)).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/slack-channel') return checkChannel(new URL(req.url ?? '/', ORIGIN).searchParams.get('c') ?? '').then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/slack-reply' && req.method === 'POST') return readJson(req).then(slackReply).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/slack-sent') return slackSentTo(new URL(req.url ?? '/', ORIGIN).searchParams.get('pr')).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/slack-asked') return slackAsked(new URL(req.url ?? '/', ORIGIN).searchParams.get('lab') === '1').then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/slack-request' && req.method === 'POST') return readJson(req).then(requestReply).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/slack-done' && req.method === 'POST') return readJson(req).then(markDone).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/slack-post' && req.method === 'POST') return readJson(req).then(postToChannel).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/agent-session' && req.method === 'POST') return readJson(req).then(openAgentSession).then(() => json(res, 200, { ok: true }), (e) => json(res, 500, { error: e.message }));
  if (path === '/slack-delete') {
    if (req.method !== 'POST') return res.writeHead(405).end();
    try {
      return json(res, 200, await slackDelete(await readJson(req)));
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }
  if (path === '/slack') {
    try {
      if (req.method === 'GET') {
        const pr = new URL(req.url ?? '/', ORIGIN).searchParams.get('pr');
        const [r, threads] = await Promise.all([slackcli(['auth', 'whoami']), pr ? prThreads(pr).catch(() => []) : []]);
        return json(res, 200, { configured: r.ok, error: r.error, threads });
      }
      if (req.method === 'POST') return json(res, 200, await notify(await readJson(req)));
      return res.writeHead(405).end();
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }
  if (path === '/token') {
    const user = new URL(req.url ?? '/', ORIGIN).searchParams.get('user') ?? '';
    try {
      const token = ghToken(user); // before any header goes out: a failure answers 500
      return res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end(token);
    } catch {
      return res.writeHead(500).end(user ? `gh isn't signed in as ${user}.` : 'gh is not signed in. Run `gh auth login`, then reload.');
    }
  }
  if (path === '/gh-accounts') return ghAccounts().then((r) => json(res, 200, r));
  if (path === '/glab-accounts') return glabAccounts().then((r) => json(res, 200, r));
  if (path === '/agents') return detectAgents().then((r) => json(res, 200, r));
  if (path === '/glab-token') {
    const q = new URL(req.url ?? '/', ORIGIN).searchParams, host = q.get('host') ?? '';
    try {
      const token = glabToken(host, q.has('refresh'));
      if (!token) throw new Error();
      return res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end(token);
    } catch {
      return res.writeHead(500).end(`glab isn't signed in to ${host}. Run \`glab auth login --hostname ${host}\`, then reload.`);
    }
  }
  if (path === '/slack-emoji') return slackEmoji().then((r) => json(res, 200, r));

  const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
  if (!file.startsWith(DIST.endsWith(sep) ? DIST : DIST + sep)) return res.writeHead(404).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});

// The lgtm process listening on our port, if it is one (macOS/Linux: lsof).
function runningLgtm() {
  try {
    const pid = Number(execFileSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0]);
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    return /lgtm/.test(cmd) ? pid : null;
  } catch {
    return null;
  }
}

let replacing = false;
server.on('error', async (e) => {
  const running = e.code === 'EADDRINUSE' ? await fetch(ORIGIN + '/lgtm').then((r) => r.text()).catch(() => '') : '';
  // The same version already running: use it.
  if (running === `lgtm ${VERSION}`) {
    open(url);
    process.exit(0);
  }
  // An older (or newer) lgtm: stop it and take over, so the page always talks to the code it was built with.
  const pid = running.startsWith('lgtm') && !replacing && runningLgtm();
  if (pid) {
    replacing = true;
    console.log(`Replacing the lgtm already running (pid ${pid}) with this version.`);
    process.kill(pid);
    for (let i = 0; i < 20 && runningLgtm(); i++) await new Promise((r) => setTimeout(r, 150));
    return server.listen(PORT, '127.0.0.1');
  }
  console.error(
    running.startsWith('lgtm') ? `Another lgtm is running on port ${PORT}. Stop it (Ctrl-C in its terminal) and run lgtm again.`
    : e.code === 'EADDRINUSE' ? `Port ${PORT} is taken by another program. Set LGTM_PORT to use a different one.`
    : e,
  );
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`lgtm running at ${ORIGIN}${DRY_RUN ? ' (Slack dry run)' : ''} (Ctrl-C to stop)`);
  open(url);
});
