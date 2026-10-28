#!/usr/bin/env node
// lgtm: serve the review UI on 127.0.0.1 and hand it the GitHub CLI's token.
// Usage: lgtm [https://github.com/owner/repo/pull/123]
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, open as openFile, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
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
// Settings → Slack people fills it in.
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
  if (!/^[\w.-]+\/[\w.-]+#\d+$/.test(pr)) return [];
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
      const who = await slackProfile(t.user ?? users[login]);
      return { login, url: `${base}archives/${t.channel}/p${t.ts.replace('.', '')}`, name: who?.name, image: who?.image };
    }),
  );
}

// DMs you've already had about this PR (its link in a direct message, newest first): each becomes your thread with that
// person for it, when Slack people knows who they are on GitHub, so lgtm's messages to them reply there. Searched
// once a run per PR (slackcli search messages); saved with the threads lgtm starts itself.
const dmSearch = new Map();
// A PR's file opened in your editor at a line, from your checkout of the repo (Settings → Claude Code): JetBrains IDEs
// through their launcher (--line), VS Code and Cursor through their URLs.
const JETBRAINS = { studio: 'Android Studio', idea: 'IntelliJ IDEA' };
async function openInEditor(b) {
  const root = normalize(String(b?.folder ?? '').replace(/^~(?=\/|$)/, homedir()));
  const file = normalize(join(root, String(b?.path ?? '')));
  const line = Math.max(1, Math.floor(Number(b?.line) || 1));
  if (!root.startsWith('/') || !file.startsWith(root + sep)) throw new Error('Bad request');
  if (!(await stat(file).catch(() => null))) throw new Error(`${b.path} isn't in ${b.folder}`);
  const args = JETBRAINS[b.editor] ? ['-na', JETBRAINS[b.editor], '--args', '--line', String(line), file]
    : ['vscode', 'cursor'].includes(b.editor) ? [`${b.editor}://file${encodeURI(file)}:${line}`]
    : null;
  if (!args) throw new Error('Bad request');
  await new Promise((ok, no) => execFile('open', args, (e, _out, err) => (e ? no(new Error(String(err || e.message).trim())) : ok())));
}

function dmThreads(pr) {
  if (!dmSearch.has(pr))
    dmSearch.set(
      pr,
      (async () => {
        const [repo, n] = pr.split('#');
        const link = new RegExp(`github\\.com/${repo.replace(/\./g, '\\.')}/pull/${n}(?!\\d)`);
        const r = await slackcli(['search', 'messages', `github.com/${repo}/pull/${n}`, '--json', '--limit', '40']);
        const users = (await readConfig()).slackUsers ?? {};
        const loginOf = Object.fromEntries(Object.entries(users).filter(([, v]) => /^U[A-Z0-9]+$/.test(v)).map(([l, v]) => [v, l]));
        const threads = await readThreads();
        const found = {};
        for (const m of (r.ok && parseJson(r.stdout)?.matches) || []) {
          // The message's own links: its text, and the URLs its previews unfurl (not their text: a stacked PR's preview
          // lists the other layers).
          const own = [m.text ?? '', ...(m.attachments ?? []).flatMap((a) => [a.from_url, a.original_url, a.app_unfurl_url, a.title_link])].join(' ');
          if (!m.channel?.is_im || !link.test(own)) continue;
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

// --- GitHub ↔ Slack people (Settings) ---

const LOGIN = /^[\w-]{1,39}$/;
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
      const u = r.ok && parseJson(r.stdout);
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
    for (const [query, via] of [[p.query, 'search'], [p.name, 'name'], [p.login.split(/[-_]/)[0], 'username']]) {
      if (found || typeof query !== 'string' || query.trim().length < 2 || query.startsWith('-')) continue;
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
async function mentions(text, recipient, users) {
  if (!text.includes('<@gh:')) return text;
  const found = new Map();
  for (const [, who] of text.matchAll(/<@gh:([A-Za-z0-9-]{1,39}|\*)>/g)) {
    if (found.has(who)) continue;
    const login = who === '*' ? recipient.login : who;
    const target = users[login] ?? (login === recipient.login ? recipient.emails[0] : undefined);
    const id = /^U[A-Z0-9]+$/.test(target ?? '') ? target : (await slackProfile(target))?.id;
    found.set(who, id ? `<@${id}>` : `@${login}`);
  }
  return text.replace(/<@gh:([A-Za-z0-9-]{1,39}|\*)>/g, (_, who) => found.get(who));
}

async function notify({ recipients, text, thread }) {
  const valid = Array.isArray(recipients) && recipients.length <= 10 && typeof text === 'string' && text.length <= 4000 &&
    typeof thread === 'string' && /^[\w.-]+\/[\w.-]+#\d+$/.test(thread) &&
    recipients.every((r) => typeof r?.login === 'string' && Array.isArray(r.emails) && r.emails.every((e) => typeof e === 'string'));
  if (!valid) throw new Error('Bad Slack request');
  const users = (await readConfig()).slackUsers ?? {};
  const threads = await readThreads();
  const results = await Promise.all(
    recipients.map(async ({ login, emails }) => {
      const body = await mentions(text, { login, emails }, users);
      const send = (args) => slackcli(['messages', 'send', ...args, '--message-file', '-', '--json', ...(DRY_RUN ? ['--dry-run'] : [])], body);
      const key = `${thread}:${login}`;
      const prev = threads[key];
      if (prev && /^[CDG][A-Z0-9]+$/.test(prev.channel) && /^\d+\.\d+$/.test(prev.ts)) {
        const r = await send([`--recipient-id=${prev.channel}`, `--thread-ts=${prev.ts}`]);
        if (r.ok) return { login, ok: true, threaded: true, ...(DRY_RUN ? { dryRun: r.stdout.trim() } : {}) };
      }
      const targets = [users[login], ...emails].filter((t) => typeof t === 'string' && SLACK_TARGET.test(t));
      if (!targets.length) return { login, ok: false, error: `no Slack user known: map @${login} in Settings → Slack people` };
      let error = '';
      for (const target of targets) {
        const r = await send([`--recipient-id=${target}`]);
        if (r.ok) {
          if (!DRY_RUN) {
            const sent = parseJson(r.stdout);
            if (sent?.channel_id) threads[key] = { channel: sent.channel_id, ts: sent.ts, user: target }; // who it's with, for their name and picture
          }
          return { login, ok: true, threaded: false, ...(DRY_RUN ? { dryRun: r.stdout.trim() } : {}) };
        }
        error = r.error;
      }
      return { login, ok: false, error };
    }),
  );
  if (!DRY_RUN) await saveThreads(threads);
  return results;
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
function claudeText(input) {
  if (typeof input !== 'string' || !input || input.length > 800_000) return Promise.reject(new Error('Bad request for Claude'));
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--tools', '', '--no-session-persistence', '--output-format', 'text'],
      { cwd: homedir(), maxBuffer: 1 << 24, timeout: 300000 },
      (err, stdout, stderr) => {
        if (err?.code === 'ENOENT') return reject(new Error('Claude Code isn\'t installed (see claude.com/code), or not on the PATH'));
        if (err) return reject(new Error((stderr || stdout).trim().split('\n').pop() || err.message));
        resolve(stdout.trim());
      },
    );
    child.stdin.end(input);
  });
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
  const [site, out] = await Promise.all([jiraSite, acli(['jira', 'workitem', 'view', key, '--json', '--fields', 'summary,status,issuetype,description'])]);
  const f = JSON.parse(out).fields;
  return { key, url: `${site}/browse/${key}`, summary: f.summary, status: f.status?.name, statusCategory: f.status?.statusCategory?.key, type: f.issuetype?.name, description: f.description ?? null };
}

// A ticket moved to another status (after its PR merges: the merge box), by the status's name as Jira shows it.
async function jiraMove(b) {
  const status = typeof b?.status === 'string' ? b.status.trim() : '';
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(b?.key ?? '') || !status || status.length > 60 || /[\n\r]/.test(status) || status.startsWith('-')) throw new Error('Bad request');
  await acli(['jira', 'workitem', 'transition', '--key', b.key, '--status', status, '--yes']);
}

// --- Claude Code sessions per PR (Settings → Claude Code) ---
// Claude desktop keeps a record per Code session (its desktop id, title, transcript id) and Claude Code a transcript
// whose first message is the prompt. A session belongs to the PRs whose links appear in that first prompt (lgtm's
// "✳ Claude" puts the PR link there). Claude's internal formats: if they change, this finds nothing rather than failing.
const CLAUDE_SESSIONS = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
// PR links, or owner/repo#123 references (both normalised to the link).
const PR_REF_IN_TEXT = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)|\b([\w.-]+\/[\w.-]+)#(\d+)\b/g;
const prsIn = (text) => [...new Set([...text.matchAll(PR_REF_IN_TEXT)].map((m) => `https://github.com/${m[1] ?? m[3]}/pull/${m[2] ?? m[4]}`))];

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

// The Claude Code skill that sends PRs ready for review to lgtm (app/claude-skill.md), installed for the user.
const SKILL = join(homedir(), '.claude', 'skills', 'lgtm-review', 'SKILL.md');
const skillText = () => readFile(new URL('../claude-skill.md', import.meta.url), 'utf8');
// Messages lgtm leaves for a Claude Code session (a comment to address, a review), read by its lgtm-review skill when
// the user says "check lgtm" there: ~/.config/lgtm/outbox/<session>.md, appended to, deleted by the skill once read.
const SESSION_ID = /^(local_[A-Za-z0-9-]{1,64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const OUTBOX = join(dirname(CONFIG), 'outbox');
async function leaveForClaude({ id, text }) {
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

async function claudeSkill(install) {
  const want = await skillText();
  if (install) await mkdir(dirname(SKILL), { recursive: true }).then(() => writeFile(SKILL, want));
  const have = await readFile(SKILL, 'utf8').catch(() => null);
  return { installed: have != null, current: have === want, path: SKILL };
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

// lgtm https://github.com/o/r/pull/1[?claude=<session>]: the PR, and the Claude Code session that sent it (skill).
const pr = process.argv[2]?.match(/github\.com\/[^/]+\/[^/]+\/pull\/\d+/)?.[0];
const from = process.argv[2]?.match(/[?&]claude=([\w-]{1,80})/)?.[1];
const url = ORIGIN + '/' + (pr ? '#https://' + pr + (from ? '?claude=' + from : '') : '');

const server = createServer(async (req, res) => {
  // DNS-rebinding guard: a hostile site resolving its own name to 127.0.0.1 sends its own Host header.
  if (!HOSTS.has(req.headers.host ?? '')) return res.writeHead(403).end();
  const path = new URL(req.url ?? '/', ORIGIN).pathname;

  if (path === '/lgtm') return res.end(`lgtm ${VERSION}`);
  // /token, /slack, /job-log and /jira act with your credentials: only our own page may call them
  // (browsers set Sec-Fetch-Site on every request, so other sites' requests and form posts are refused).
  if (['/token', '/slack', '/job-log', '/jira', '/integrations', '/slack-people', '/claude-sessions', '/claude-text', '/claude-skill', '/claude-outbox', '/claude-session', '/gh-accounts', '/slack-emoji', '/jira-move', '/open-editor'].includes(path) && req.headers['sec-fetch-site'] !== 'same-origin') return res.writeHead(403).end();
  if (path === '/claude-text' && req.method === 'POST') {
    return readJson(req)
      .then((b) => claudeText(b?.input))
      .then((text) => json(res, 200, { text }), (e) => json(res, 500, { error: e.message }));
  }
  if (path === '/job-log') {
    const q = new URL(req.url ?? '/', ORIGIN).searchParams;
    return jobLog(q.get('repo') ?? '', q.get('job') ?? '', q.get('user') ?? '').then(
      (text) => res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(text),
      (e) => res.writeHead(500, { 'Content-Type': 'text/plain' }).end(e.message),
    );
  }
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
  if (path === '/claude-outbox' && req.method === 'POST') return readJson(req).then(leaveForClaude).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/claude-session') return claudeSession(new URL(req.url ?? '/', ORIGIN).searchParams.get('id')).then((r) => json(res, 200, r), (e) => json(res, 500, { error: e.message }));
  if (path === '/claude-skill') return claudeSkill(req.method === 'POST').then((s) => json(res, 200, s), (e) => json(res, 500, { error: e.message }));
  if (path === '/claude-sessions') return claudeSessions().then((s) => json(res, 200, s), (e) => json(res, 500, { error: e.message }));
  if (path === '/integrations') {
    const plain = (s = '') => s.replace(/\x1b\[[0-9;]*m/g, ''); // the CLIs colour their output
    const [slack, jira] = await Promise.all([
      slackcli(['auth', 'whoami']).then((r) => ({ ok: r.ok, error: r.error, who: plain(r.stdout).match(/User:\s*(\S+)/)?.[1] })),
      acli(['jira', 'auth', 'status']).then(
        (out) => ({ ok: true, site: plain(out).match(/Site:\s*(\S+)/)?.[1] }),
        (e) => ({ ok: false, error: e.message }),
      ),
    ]);
    return json(res, 200, { slack, jira });
  }
  if (path === '/open-editor' && req.method === 'POST')
    return readJson(req).then(openInEditor).then(() => json(res, 200, { ok: true }), (e) => json(res, 500, { error: e.message }));
  if (path === '/jira-move' && req.method === 'POST')
    return readJson(req).then(jiraMove).then(() => json(res, 200, { ok: true }), (e) => json(res, 500, { error: e.message }));
  if (path === '/jira') {
    return jiraIssue(new URL(req.url ?? '/', ORIGIN).searchParams.get('key') ?? '').then(
      (issue) => json(res, 200, issue),
      (e) => json(res, 500, { error: e.message }),
    );
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
