import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The version (package.json; keep desktop/src-tauri/tauri.conf.json in step) shows in Settings.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  define: { __APP_VERSION__: JSON.stringify(version) },
});
