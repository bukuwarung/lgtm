import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  define: { __APP_VERSION__: JSON.stringify(version), __DEV_BUILD__: JSON.stringify(dev), __COMMIT__: JSON.stringify(commit) },
});
