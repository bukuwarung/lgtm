import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';

// The version (package.json; keep desktop/src-tauri/tauri.conf.json in step) shows in Settings.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// Any build but scripts/release.sh's (LGTM_RELEASE=1) is a dev build: the top bar says so, with its commit.
const dev = process.env.LGTM_RELEASE !== '1';
let commit = '';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // not a git checkout
}

// Every highlight.js language, loadable on its own (src/highlight.ts loads one when a PR's files need it): each name and
// alias (the file extensions) to its language, and a loader per language, so each becomes a chunk of its own.
const require = createRequire(import.meta.url);
function hljsLanguages() {
  const hljs = require('highlight.js/lib/core');
  const names = readdirSync(new URL('./node_modules/highlight.js/lib/languages', import.meta.url))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.js.js'))
    .map((f) => f.slice(0, -3));
  const alias: Record<string, string> = {};
  for (const n of names) for (const a of [n, ...(require(`highlight.js/lib/languages/${n}`)(hljs).aliases ?? [])]) alias[a.toLowerCase()] ??= n;
  const loaders = names.map((n) => `${JSON.stringify(n)}: () => import('highlight.js/lib/languages/${n}')`).join(',\n');
  return `export const alias = ${JSON.stringify(alias)};\nexport const load = {${loaders}};`;
}

export default defineConfig({
  plugins: [
    {
      name: 'hljs-languages',
      resolveId: (id) => (id === 'virtual:hljs-languages' ? '\0hljs-languages' : undefined),
      load: (id) => (id === '\0hljs-languages' ? hljsLanguages() : undefined),
    },
  ],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  define: { __APP_VERSION__: JSON.stringify(version), __DEV_BUILD__: JSON.stringify(dev), __COMMIT__: JSON.stringify(commit) },
});
