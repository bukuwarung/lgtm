import { alias, load } from 'virtual:hljs-languages';
import { hljs } from './highlight.ts';

// Apart from highlight.ts so the tests (plain Node) can load that one: this needs Vite's list of languages.
// Languages beyond the ones built in, loaded once a PR's files need them (their own small chunks, vite.config.ts).
// Each repo remembers the ones its PRs needed, and loads them up front: code blocks in comments read them too.
const loading = new Map<string, Promise<void>>();
export function loadLanguages(repo: string, paths: string[]): Promise<unknown> {
  const key = `hlLangs:${repo}`;
  let known: string[] = [];
  try {
    known = JSON.parse(localStorage.getItem(key) ?? '[]');
  } catch {}
  const want = new Set(known.filter((n) => load[n]));
  for (const p of paths) {
    const base = p.split('/').pop()!.toLowerCase();
    const names = [base.split('.').pop()!, base];
    if (!names.some((n) => hljs.getLanguage(n))) names.forEach((n) => alias[n] && want.add(alias[n]));
  }
  if (want.size > known.length)
    try {
      localStorage.setItem(key, JSON.stringify([...want]));
    } catch {}
  return Promise.all(
    [...want].map((name) => {
      if (!loading.has(name)) loading.set(name, load[name]().then((m) => hljs.registerLanguage(name, m.default), () => {}));
      return loading.get(name);
    }),
  );
}
