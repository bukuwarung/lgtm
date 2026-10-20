#!/usr/bin/env node
// lgtm: serve the review UI on 127.0.0.1 and hand it the GitHub CLI's token.
// Usage: lgtm [https://github.com/owner/repo/pull/123]
import { execFile, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixed port: drafts live in localStorage, which is per origin.
const PORT = Number(process.env.LGTM_PORT ?? 4517);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
// Optional: { "slackToken": "xoxp-…", "slackUsers": { "github-login": "U012ABC" } }
const CONFIG = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'lgtm', 'config.json');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

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

async function slack(token, method, params) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams(params),
  });
  const d = await res.json();
  if (!d.ok) throw new Error(`${method}: ${d.error}`);
  return d;
}

// DM each recipient. Slack user = config mapping, else looked up by one of their GitHub emails.
async function notify({ recipients, text }) {
  const valid = Array.isArray(recipients) && recipients.length <= 10 && typeof text === 'string' && text.length <= 4000 &&
    recipients.every((r) => typeof r?.login === 'string' && Array.isArray(r.emails) && r.emails.every((e) => typeof e === 'string'));
  if (!valid) throw new Error('Bad Slack request');
  const cfg = await readConfig();
  if (!cfg.slackToken) throw new Error(`No slackToken in ${CONFIG}`);
  return Promise.all(
    recipients.map(async ({ login, emails }) => {
      try {
        let user = cfg.slackUsers?.[login];
        for (const email of user ? [] : emails) {
          user = await slack(cfg.slackToken, 'users.lookupByEmail', { email }).then((d) => d.user.id, () => undefined);
          if (user) break;
        }
        if (!user) throw new Error(`no Slack user found (add "${login}" to slackUsers in ${CONFIG})`);
        const { channel } = await slack(cfg.slackToken, 'conversations.open', { users: user });
        await slack(cfg.slackToken, 'chat.postMessage', { channel: channel.id, text, unfurl_links: 'false' });
        return { login, ok: true };
      } catch (e) {
        return { login, ok: false, error: e.message };
      }
    }),
  );
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65536) throw new Error('Request too large');
  }
  return JSON.parse(body);
}

const json = (res, status, value) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));

function open(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  execFile(cmd, args, () => {});
}

try {
  ghToken();
} catch {
  console.error('lgtm uses the GitHub CLI login. Install gh and run `gh auth login`, then try again.');
  process.exit(1);
}

const pr = process.argv[2]?.match(/github\.com\/[^/]+\/[^/]+\/pull\/\d+/)?.[0];
const url = ORIGIN + '/' + (pr ? '#https://' + pr : '');

const server = createServer(async (req, res) => {
  // DNS-rebinding guard: a hostile site resolving its own name to 127.0.0.1 sends its own Host header.
  if (!HOSTS.has(req.headers.host ?? '')) return res.writeHead(403).end();
  const path = new URL(req.url ?? '/', ORIGIN).pathname;

  if (path === '/lgtm') return res.end('lgtm');
  // /token and /slack act with your credentials: only our own page may call them
  // (browsers set Sec-Fetch-Site on every request, so other sites' requests and form posts are refused).
  if ((path === '/token' || path === '/slack') && req.headers['sec-fetch-site'] !== 'same-origin') return res.writeHead(403).end();
  if (path === '/slack') {
    try {
      if (req.method === 'GET') return json(res, 200, { configured: !!(await readConfig()).slackToken });
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

server.on('error', async (e) => {
  // Already running? Reuse it.
  if (e.code === 'EADDRINUSE' && (await fetch(ORIGIN + '/lgtm').then((r) => r.text()).catch(() => '')) === 'lgtm') {
    open(url);
    process.exit(0);
  }
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is taken by another program. Set LGTM_PORT to use a different one.` : e);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`lgtm running at ${ORIGIN} (Ctrl-C to stop)`);
  open(url);
});
