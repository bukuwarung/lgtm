import { useEffect, useState } from 'preact/hooks';

// The page is served by bin/lgtm.mjs on a fixed 127.0.0.1 port, so localStorage persists drafts across runs.
export const storage = {
  get: async <T>(key: string): Promise<T | undefined> => {
    const v = localStorage.getItem(key);
    return v == null ? undefined : JSON.parse(v);
  },
  set: async (key: string, value: unknown) => {
    localStorage.setItem(key, JSON.stringify(value));
    dispatchEvent(new Event('lgtm:storage')); // the PR list shows unsent comments
  },
  remove: async (key: string) => {
    localStorage.removeItem(key);
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
      return await done((await openCache()).transaction('prs').objectStore('prs').get(key));
    } catch {
      return undefined;
    }
  },
  async set(key: string, v: unknown) {
    try {
      const store = (await openCache()).transaction('prs', 'readwrite').objectStore('prs');
      store.put({ v, at: Date.now() }, key);
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

// The local server (or, in the app, its command) answers with `gh auth token`.
export async function fetchToken(): Promise<string> {
  if (isDesktop) return command<string>('gh_token');
  const res = await fetch('/token');
  if (!res.ok) throw new Error((await res.text()) || 'Could not get a token from the lgtm server.');
  return res.text();
}

// A remembered on/off UI preference (sidebar visibility etc.). Storage failures just mean it isn't remembered.
// Every user of a key sees a change at once (the settings page and the views it configures are on screen together).
export function useStoredValue(key: string, initial: string) {
  const read = () => {
    try {
      return localStorage.getItem(key) ?? initial;
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
      localStorage.setItem(key, v);
    } catch {
      // not remembered
    }
    dispatchEvent(new CustomEvent('lgtm:pref', { detail: key }));
  };
  return [value, set] as const;
}

// GitHub accounts you've marked as bots (automation users GitHub sees as people): treated like GitHub's own bots.
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
export type SlackMatch = { login: string; id?: string; label?: string; display?: string; via?: 'email' | 'name' | 'username' };
async function call<T>(method: string, body?: any): Promise<T> {
  if (isDesktop)
    return method === 'GET' ? command<T>('slack_people_get') : method === 'POST' ? command<T>('slack_people_find', body) : command<T>('slack_people_save', { map: body });
  const res = await fetch('/slack-people', { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const d = await res.json().catch(() => ({ error: 'the running lgtm is older than this page. Restart it (Ctrl-C, then lgtm) and reload.' }));
  if (!res.ok) throw new Error(d.error);
  return d;
}
export const getSlackPeople = () => call<SlackPeople>('GET');
export const findSlackPeople = (people: { login: string; name: string | null; emails: string[] }[]) => call<SlackMatch[]>('POST', { people });
export const saveSlackPeople = (map: Record<string, string>) => call<SlackPeople>('PUT', map);

// GitHub is the gh login (in the page); this asks the server about the CLIs it drives: slackcli and acli.
export type Integrations = { slack: { ok: boolean; error?: string; who?: string }; jira: { ok: boolean; error?: string; site?: string } };
export async function fetchIntegrations(): Promise<Integrations> {
  if (isDesktop) return command<Integrations>('integrations');
  const res = await fetch('/integrations').catch(() => {
    throw new Error("lgtm isn't running. Start it with the lgtm command, then reload.");
  });
  // An lgtm started before this page existed doesn't know the route: the page is newer than the running server.
  if (!res.ok) throw new Error('the running lgtm is older than this page. Restart it (Ctrl-C, then lgtm) and reload.');
  return res.json();
}

// Slack DMs go through the local server, which runs slackcli (it holds the Slack sign-in).
// Whether slackcli is signed in, and if not, why (shown in the submit panel instead of the Slack option).
// `pr` ("owner/repo#12") also returns links to that PR's Slack threads.
export type SlackThread = { login: string; url: string };
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

// Last lines of a failed GitHub Actions job's log, fetched by the local server with gh.
export async function fetchJobLog(repo: string, job: number): Promise<string> {
  if (isDesktop) return command<string>('job_log', { repo, job });
  const res = await fetch(`/job-log?repo=${encodeURIComponent(repo)}&job=${job}`);
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

// --- Native side: the app uses macOS through Tauri plugins; the browser version falls back to web APIs ---

// Notifications: macOS notifications in the app, the Web Notification API in the browser.
export async function askNotifications(): Promise<boolean> {
  if (!isDesktop) return (await Notification.requestPermission()) === 'granted';
  const n = await import('@tauri-apps/plugin-notification');
  return (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted';
}
export async function notify(title: string, body: string, open: () => void) {
  if (!isDesktop) {
    if (Notification.permission !== 'granted') return;
    const note = new Notification(title, { body });
    note.onclick = () => {
      focus();
      open();
    };
    return;
  }
  const n = await import('@tauri-apps/plugin-notification');
  if (await n.isPermissionGranted()) n.sendNotification({ title, body }); // clicking it brings the app forward
}

// The Dock icon's badge (the app); the browser version shows the count in the tab title instead.
export async function setBadge(count: number) {
  if (!isDesktop) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setBadgeCount(count || undefined);
}

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
    const m = urls?.[0]?.match(/([^/\s:]+\/[^/\s]+)\/pull\/(\d+)/);
    const from = urls?.[0]?.match(/[?&]claude=([\w-]{1,80})/)?.[1]; // the Claude Code session that sent it (its skill)
    if (m) go(`/${m[1]}/pull/${m[2]}${from ? `?claude=${from}` : ''}`);
  };
  open(await getCurrent()); // the link that launched the app
  await onOpenUrl(open);
  // The menu bar's own items (desktop/src-tauri/src/lib.rs), passed on as "lgtm:menu" with the item's id.
  const { listen } = await import('@tauri-apps/api/event');
  await listen<string>('menu', (e) => dispatchEvent(new CustomEvent('lgtm:menu', { detail: e.payload })));
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
    localStorage.setItem(`claudeFrom:${repo}#${n}`, JSON.stringify({ id, at: Date.now() }));
  } catch {}
  dispatchEvent(new Event('lgtm:claude-link')); // ✳ Claude buttons show it
}
export function unlinkClaude(repo: string, n: number) {
  try {
    localStorage.removeItem(`claudeFrom:${repo}#${n}`);
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
    const v = JSON.parse(localStorage.getItem(`claudeFrom:${repo}#${n}`) ?? 'null');
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
    localStorage.setItem(`claudeFrom:${repo}#${n}`, JSON.stringify({ ...l, seen: Date.now() }));
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
      async () => (await navigator.clipboard.writeText(message).catch(() => {}), 'Copied: paste it in the session (⌘V)'),
    );
  const local = id.startsWith('local_') ? id : (await claudeSessionState(id).catch(() => null))?.id;
  if (local) {
    await openClaude(`claude://code/continue?session=${encodeURIComponent(local)}`);
    return note;
  }
  await navigator.clipboard.writeText(`claude --resume ${id}${message ? " 'check lgtm'" : ''}`).catch(() => {});
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

// The app: upgrade through Homebrew and restart (resolves only on failure: success restarts the app).
export const selfUpdate = () => command<void>('self_update');
export const UPGRADE = isDesktop ? 'brew upgrade --cask lgtm' : 'brew upgrade lgtm-cli';

// --- Diagnostics (Help → Copy Diagnostics, Settings): what a bug report needs, with no tokens or PR text ---
const errors: string[] = [];
export function recordError(text: string) {
  errors.push(`${new Date().toISOString().slice(0, 19)} ${text.slice(0, 300)}`);
  if (errors.length > 20) errors.shift();
}
if (typeof window !== 'undefined') {
  addEventListener('error', (e) => recordError(`error: ${e.message}`));
  addEventListener('unhandledrejection', (e) => recordError(`unhandled: ${e.reason?.message ?? e.reason}`));
}

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
export type Backup = { lgtm: 1; version: string; exportedAt: string; storage: Record<string, string> };

export function makeBackup(): Backup {
  const storage: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    storage[k] = localStorage.getItem(k) ?? '';
  }
  return { lgtm: 1, version: __APP_VERSION__, exportedAt: new Date().toISOString(), storage };
}

// Browser: a download. App: saved to ~/Downloads by the app (the page never names a path). Returns where it went.
export async function saveBackup(): Promise<string> {
  const text = JSON.stringify(makeBackup(), null, 2);
  const date = new Date().toISOString().slice(0, 10);
  if (isDesktop) return command<string>('export_settings', { json: text, date });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `lgtm-settings-${date}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return `your downloads (${a.download})`;
}

// Adds the file's settings and drafts, replacing ones with the same name; returns how many entries.
export function restoreBackup(text: string): number {
  const b = JSON.parse(text) as Partial<Backup>;
  if (b?.lgtm !== 1 || typeof b.storage !== 'object' || !b.storage) throw new Error("This isn't an lgtm settings file.");
  const entries = Object.entries(b.storage).filter(([k, v]) => typeof k === 'string' && typeof v === 'string');
  for (const [k, v] of entries) localStorage.setItem(k, v);
  return entries.length;
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
