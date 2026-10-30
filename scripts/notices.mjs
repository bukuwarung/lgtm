// Writes THIRD-PARTY-NOTICES.md: the colour themes and icons lgtm's palettes come from, then every npm package the UI
// bundles and every Rust crate the Mac app is built with, each with its license text. Run before a release
// (scripts/release.sh does); the UI build ships the file (vite.config.ts).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIT = (who) => `MIT License\n\nCopyright (c) ${who}\n\n${readFileSync(join(root, 'LICENSE'), 'utf8').split('\n\n').slice(2).join('\n\n').trim()}`;

// Palettes and icons: lgtm uses their colours or images, not their code.
const credits = [
  ['One Dark / One Light (Atom)', 'https://github.com/atom/atom', 'MIT', MIT('2011-2022 GitHub Inc.')],
  ['Ayu', 'https://github.com/dempfi/ayu', 'MIT', MIT('2016 Ike Kurghinyan (Ike Ku)')],
  ['Gruvbox', 'https://github.com/morhetz/gruvbox', 'MIT', MIT('Pavel Pertsev (morhetz); its README declares the MIT/X11 license')],
  ['Catppuccin', 'https://github.com/catppuccin/catppuccin', 'MIT', MIT('2021 Catppuccin')],
  ['Dracula', 'https://github.com/dracula/dracula-theme', 'MIT', MIT('2023 Dracula Theme')],
  ['Nord', 'https://github.com/nordtheme/nord', 'MIT', MIT('2016-present Sven Greb')],
  ['Solarized', 'https://github.com/altercation/solarized', 'MIT', MIT('2011 Ethan Schoonover')],
  ['Tokyo Night', 'https://github.com/enkia/tokyo-night-vscode-theme', 'MIT', MIT('2018-present Enkia')],
  ['GitHub Primer colors', 'https://github.com/primer/primitives', 'MIT', MIT('2018 GitHub Inc.')],
  ['VS Code Light+ / Dark+', 'https://github.com/microsoft/vscode', 'MIT', MIT('2015 - present Microsoft Corporation')],
  ['Octicons', 'https://github.com/primer/octicons', 'MIT', MIT('2026 GitHub Inc.')],
  ['Material Icon Theme', 'https://github.com/material-extensions/vscode-material-icon-theme', 'MIT', MIT('2025 Material Extensions')],
  ['markdown.style themes', 'https://markdown.style/themes', 'Apache-2.0', null],
];

const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;
// A package's license files; for one offered under MIT or another (MIT OR Apache-2.0), just its MIT text.
const licenseText = (dir, declared) => {
  if (!existsSync(dir)) return '';
  let files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  const mit = files.filter((f) => /mit/i.test(f));
  if (/\bMIT\b/.test(declared) && /\bOR\b|\//.test(declared) && mit.length) files = mit;
  return files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n');
};

// npm: what the UI bundles (production dependencies, all the way down).
const npm = JSON.parse(execFileSync('npm', ['query', ':not(.dev)'], { cwd: join(root, 'app'), encoding: 'utf8', maxBuffer: 64 << 20 }))
  .filter((p) => p.name && p.name !== 'lgtm' && p.path)
  .map((p) => ({ name: p.name, version: p.version, license: typeof p.license === 'string' ? p.license : p.license?.type ?? '', text: licenseText(p.path, typeof p.license === 'string' ? p.license : '') }));

// Rust: the crates the Mac app links, on macOS.
const meta = JSON.parse(
  execFileSync('cargo', ['metadata', '--format-version', '1', '--filter-platform', 'aarch64-apple-darwin', '--manifest-path', join(root, 'desktop/src-tauri/Cargo.toml')], { encoding: 'utf8', maxBuffer: 256 << 20 }),
);
const used = new Set(meta.resolve.nodes.map((n) => n.id));
const crates = meta.packages
  .filter((p) => used.has(p.id) && p.source)
  .map((p) => ({ name: p.name, version: p.version, license: p.license ?? '', text: licenseText(dirname(p.manifest_path), p.license ?? '') }));

// Packages under one heading per license text, so the Apache and MIT texts aren't repeated hundreds of times.
function section(title, list) {
  const byText = new Map();
  for (const p of list.sort((a, b) => a.name.localeCompare(b.name))) {
    const text = p.text || `(no license file in the package; declared: ${p.license || 'none'})`;
    const key = text.replace(/\s+/g, ' '); // the same text, however it's wrapped
    const had = byText.get(key);
    byText.set(key, { text: had?.text ?? text, ps: [...(had?.ps ?? []), p] });
  }
  return [`## ${title}`, ...[...byText.values()].map(({ text, ps }) => `${ps.map((p) => `- ${p.name} ${p.version} (${p.license})`).join('\n')}\n\n\`\`\`\n${text}\n\`\`\``)].join('\n\n');
}

const out = [
  '# Third-party notices',
  'lgtm is MIT licensed (see LICENSE). It includes or draws on the work below, under their own licenses.',
  '## Colour themes and icons',
  ...credits.map(([name, url, lic, text]) => `### [${name}](${url}) (${lic})${text ? `\n\n\`\`\`\n${text}\n\`\`\`` : '\n\nLicensed under the Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0'}`),
  section('npm packages in the UI', npm),
  section('Rust crates in the Mac app', crates),
].join('\n\n');
writeFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), out + '\n');
console.log(`THIRD-PARTY-NOTICES.md: ${credits.length} credits, ${npm.length} npm packages, ${crates.length} crates`);
