// Web apps (TypeScript, JavaScript, Vue, React): what breaks CI, hides a problem, or opens one.
import { parsePatch } from './diff.ts';
import { inTests } from './files.ts';
import { depChanges } from './deps.ts';

type F = { filename: string; status: string; patch?: string };
export type WebHit = { path: string; line: number; what: string };

const WEB = /\.(m?[jt]sx?|cjs|vue|svelte|astro)$/;
const added = (f: F, test: (text: string) => string | null): WebHit[] =>
  f.patch ? parsePatch(f.patch).flatMap((h) => h.lines.flatMap((l) => { const w = l.kind === '+' && l.new != null ? test(l.text) : null; return w ? [{ path: f.filename, line: l.new!, what: w }] : []; })) : [];

// it.only / describe.only / test.only (Jest, Vitest, Mocha, Playwright, Cypress): CI runs only those, and passes.
// debugger: stops the app in anyone's dev tools.
export const focused = (files: F[]) =>
  files.filter((f) => WEB.test(f.filename)).flatMap((f) =>
    added(f, (t) => (/^\s*(\/\/|\*)/.test(t) ? null : /\b(it|test|describe|context|suite)\.only\s*\(/.test(t) && inTests(f.filename) ? t.match(/\b(\w+)\.only/)![0] : /^\s*debugger\s*;?\s*$/.test(t) ? 'debugger' : null)),
  );

// HTML put in as is: Vue's v-html, React's dangerouslySetInnerHTML, innerHTML/outerHTML assigned, document.write.
export const rawHtml = (files: F[]) =>
  files.filter((f) => WEB.test(f.filename) && !inTests(f.filename)).flatMap((f) =>
    added(f, (t) => (/^\s*(\/\/|\*)/.test(t) ? null : t.match(/\bv-html\b|dangerouslySetInnerHTML|\.(inner|outer)HTML\s*\+?=(?!=)|document\.write\(/)?.[0] ?? null)),
  );

// package.json dependencies changed, its folder's lockfile not: `npm ci` (and the like) fail on the mismatch.
// `lockOf(folder)`: the lockfile that folder has on the base branch, if any.
const LOCKS = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json'];
export async function lockfileDrift(files: F[], list: (folder: string) => Promise<string[]>): Promise<{ path: string; line: number; lock: string }[]> {
  const out: { path: string; line: number; lock: string }[] = [];
  for (const f of files.filter((f) => /(^|\/)package\.json$/.test(f.filename) && f.status !== 'removed')) {
    const deps = depChanges([f]).filter((d) => d.npm);
    if (!deps.length) continue;
    const folder = f.filename.includes('/') ? f.filename.slice(0, f.filename.lastIndexOf('/')) : '';
    if (files.some((g) => LOCKS.some((l) => g.filename === (folder ? `${folder}/${l}` : l)))) continue;
    const lock = (await list(folder).catch(() => [])).find((n) => LOCKS.includes(n));
    if (lock) out.push({ path: f.filename, line: deps[0].line, lock });
  }
  return out;
}
