// The page is served by bin/lgtm.mjs on a fixed 127.0.0.1 port, so localStorage persists drafts across runs.
export const storage = {
  get: async <T>(key: string): Promise<T | undefined> => {
    const v = localStorage.getItem(key);
    return v == null ? undefined : JSON.parse(v);
  },
  set: async (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value)),
  remove: async (key: string) => localStorage.removeItem(key),
};

// The local server answers with `gh auth token`.
export async function fetchToken(): Promise<string> {
  const res = await fetch('/token');
  if (!res.ok) throw new Error((await res.text()) || 'Could not get a token from the lgtm server.');
  return res.text();
}
