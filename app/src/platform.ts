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

// The local server answers with `gh auth token`.
export async function fetchToken(): Promise<string> {
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

export function useStoredFlag(key: string, initial: boolean) {
  const [v, set] = useStoredValue(key, initial ? '1' : '0');
  return [v === '1', () => set(v === '1' ? '0' : '1')] as const;
}

// GitHub is the gh login (in the page); this asks the server about the CLIs it drives: slackcli and acli.
export type Integrations = { slack: { ok: boolean; error?: string; who?: string }; jira: { ok: boolean; error?: string; site?: string } };
export const fetchIntegrations = (): Promise<Integrations> => fetch('/integrations').then((r) => r.json());

// Slack DMs go through the local server, which runs slackcli (it holds the Slack sign-in).
// Whether slackcli is signed in, and if not, why (shown in the submit panel instead of the Slack option).
// `pr` ("owner/repo#12") also returns links to that PR's Slack threads.
export type SlackThread = { login: string; url: string };
export const slackStatus = (pr: string): Promise<{ configured: boolean; error?: string; threads: SlackThread[] }> =>
  fetch(`/slack?pr=${encodeURIComponent(pr)}`)
    .then((r) => r.json())
    .then((d) => ({ configured: !!d.configured, error: d.error, threads: d.threads ?? [] }), (e) => ({ configured: false, error: e.message, threads: [] }));

export type SlackResult = { login: string; ok: boolean; threaded?: boolean; error?: string };
// `thread` ("owner/repo#12") keeps one Slack thread per PR and person; later reviews reply in it.
export async function notifySlack(recipients: { login: string; emails: string[] }[], text: string, thread: string): Promise<SlackResult[]> {
  const res = await fetch('/slack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients, text, thread }) });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error ?? 'Slack request failed');
  return d;
}

// Last lines of a failed GitHub Actions job's log, fetched by the local server with gh.
export async function fetchJobLog(repo: string, job: number): Promise<string> {
  const res = await fetch(`/job-log?repo=${encodeURIComponent(repo)}&job=${job}`);
  const text = await res.text();
  if (!res.ok) throw new Error(text || 'Could not load the log');
  return text;
}

export type JiraIssue = { key: string; url: string; summary: string; status?: string; statusCategory?: string; type?: string; description: any };
// A Jira ticket through the local server's acli.
export async function fetchJira(key: string): Promise<JiraIssue> {
  const res = await fetch(`/jira?key=${encodeURIComponent(key)}`);
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(body.error || 'Could not load the ticket');
  return body;
}
