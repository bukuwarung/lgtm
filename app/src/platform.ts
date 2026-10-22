import { useState } from 'preact/hooks';

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
export function useStoredFlag(key: string, initial: boolean) {
  const [on, setOn] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  const toggle = () => {
    setOn(!on);
    try {
      localStorage.setItem(key, on ? '0' : '1');
    } catch {
      // not remembered
    }
  };
  return [on, toggle] as const;
}

// Slack DMs go through the local server, which runs slackcli (it holds the Slack sign-in).
export const slackConfigured = (): Promise<boolean> =>
  fetch('/slack').then((r) => r.json()).then((d) => !!d.configured, () => false);

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
