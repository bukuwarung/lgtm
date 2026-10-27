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

// Read per request so `gh auth login` / `gh auth switch` take effect on reload.
const ghToken = () => execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

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
  const mine = Object.entries(await readThreads()).filter(([k]) => k.startsWith(pr + ':'));
  if (!mine.length) return [];
  slackUrl ??= slackcli(['team', 'info', '--json']).then((r) => (r.ok ? JSON.parse(r.stdout).url : null));
  const base = await slackUrl;
  if (!base) return [];
  return mine.map(([k, t]) => ({ login: k.slice(pr.length + 1), url: `${base}archives/${t.channel}/p${t.ts.replace('.', '')}` }));
}

// --- GitHub ↔ Slack people (Settings) ---

const LOGIN = /^[\w-]{1,39}$/;
const SLACK_ID = /^U[A-Z0-9]{6,}$/;
// slackcli may print a spinner line first, and prints nothing at all for an empty search.
const parseJson = (out = '') => {
  try {
    return JSON.parse(out.slice(out.indexOf('{')));
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
async function findSlack(people) {
  if (!Array.isArray(people) || people.length > 50) throw new Error('Bad request');
  const one = (u, via) => ({ id: u.id, label: u.real_name || u.profile?.real_name || u.name, display: u.profile?.display_name || '', via });
  const out = [];
  for (const p of people) {
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
    for (const [query, via] of [[p.name, 'name'], [p.login.split(/[-_]/)[0], 'username']]) {
      if (found || typeof query !== 'string' || query.trim().length < 3 || query.startsWith('-')) continue;
      const r = await slackcli(['search', 'people', query.slice(0, 100), '--json', '--limit', '5']);
      const live = r.ok ? (parseJson(r.stdout)?.people ?? []).filter((u) => !u.deleted && !u.is_bot) : [];
      if (live.length === 1) found = one(live[0], via);
    }
    out.push({ login: p.login, ...(found ?? {}) });
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

async function notify({ recipients, text, thread }) {
  const valid = Array.isArray(recipients) && recipients.length <= 10 && typeof text === 'string' && text.length <= 4000 &&
    typeof thread === 'string' && /^[\w.-]+\/[\w.-]+#\d+$/.test(thread) &&
    recipients.every((r) => typeof r?.login === 'string' && Array.isArray(r.emails) && r.emails.every((e) => typeof e === 'string'));
  if (!valid) throw new Error('Bad Slack request');
  const users = (await readConfig()).slackUsers ?? {};
  const threads = await readThreads();
  const send = (args) => slackcli(['messages', 'send', ...args, '--message-file', '-', '--json', ...(DRY_RUN ? ['--dry-run'] : [])], text);
  const results = await Promise.all(
    recipients.map(async ({ login, emails }) => {
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
            const sent = JSON.parse(r.stdout);
            threads[key] = { channel: sent.channel_id, ts: sent.ts };
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
function jobLog(repo, job) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(job)) return Promise.reject(new Error('Bad job'));
  // Newer gh refuses to print escape sequences without --allow-escape-sequences; older gh doesn't know the flag.
  const run = (extra) =>
    new Promise((resolve, reject) =>
      execFile('gh', ['api', ...extra, `repos/${repo}/actions/jobs/${job}/logs`], { maxBuffer: 1 << 27, timeout: 30000 }, (err, stdout, stderr) =>
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
  if (['/token', '/slack', '/job-log', '/jira', '/integrations', '/slack-people', '/claude-sessions', '/claude-text', '/claude-skill'].includes(path) && req.headers['sec-fetch-site'] !== 'same-origin') return res.writeHead(403).end();
  if (path === '/claude-text' && req.method === 'POST') {
    return readJson(req)
      .then((b) => claudeText(b?.input))
      .then((text) => json(res, 200, { text }), (e) => json(res, 500, { error: e.message }));
  }
  if (path === '/job-log') {
    const q = new URL(req.url ?? '/', ORIGIN).searchParams;
    return jobLog(q.get('repo') ?? '', q.get('job') ?? '').then(
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
    try {
      return res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end(ghToken());
    } catch {
      return res.writeHead(500).end('gh is not signed in. Run `gh auth login`, then reload.');
    }
  }

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
