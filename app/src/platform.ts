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

// Inside the macOS app (desktop/, Tauri) the page reaches the CLIs through app commands instead of the local server.
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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
    if (m) go(`/${m[1]}/pull/${m[2]}`);
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
    `lgtm ${__APP_VERSION__} (${isDesktop ? 'macOS app' : 'browser version'})`,
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
export type ClaudeSession = { id: string; title: string; lastActivityAt: number; prs: string[] };
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
