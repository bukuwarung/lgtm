// What a PR switches off: tests skipped or ignored, and checks silenced (type checks, linters, compiler warnings,
// coverage, security scanners), in any language. Added lines only; a line also removed in the same file (moved or
// re-indented) doesn't count.
import { parsePatch } from './diff.ts';
import { isMarkdown } from './markdown.ts';
import { inTests } from './files.ts';

type F = { filename: string; status?: string; patch?: string };
export type Off = { path: string; line: number; what: string; test: boolean; ci?: boolean };

// In test files only: @Ignore is also Room's (a field not stored), skip: an ordinary argument elsewhere.
const TEST: RegExp[] = [
  /@(Ignore|Disabled\w*)\b(\([^)]*\))?/, // JUnit 4/5, Kotest
  /\b(it|test|describe|context|suite)\.(skip|fixme)\s*\(/, // Jest, Vitest, Mocha, Playwright
  /\b(xit|xtest|xdescribe|xcontext|xspecify)\s*\(/,
  /@pytest\.mark\.(skip\w*|xfail)\b|\bpytest\.skip\(|@unittest\.(skip\w*|expectedFailure)\b/,
  /\bt\.Skip(f|Now)?\(/, // Go
  /\bXCTSkip(If|Unless)?\b|@Test\([^)]*\.disabled\b/, // XCTest, Swift Testing
  /#\[ignore\b[^\]]*\]/, // Rust
  /\[Ignore\b[^\]]*\]|\[(Fact|Theory)\([^)]*\bSkip\s*=/, // NUnit, MSTest, xUnit
];
// Ones that only mean that in their language.
const TEST_IN: [RegExp, RegExp][] = [
  [/\.dart$/, /\bskip:\s*(true|['"])/],
  [/_spec\.rb$/, /^\s*(skip|pending)\b(?!\s*[=:(.])/],
];
// Anywhere but docs.
const CHECK: RegExp[] = [
  /@ts-(ignore|nocheck)\b/, // not ts-expect-error: that one says when it's no longer needed
  /\b(eslint|stylelint|oxlint)-disable(-next-line|-line)?(\s+[\w@/-]+(,\s*[\w@/-]+)*)?/,
  /\bbiome-ignore\S*(\s+[\w/]+)?/,
  /\b(istanbul|c8|v8)\s+ignore\b(\s+(next|else|if|start|file))?/,
  /@(file:)?Suppress(Warnings|Lint|FBWarnings)?\([^)]*\)?/,
  /\[SuppressMessage\([^)]*\)?/,
  /\/\/\s*noinspection\s+\w+/,
  /\bNOSONAR\b|\bnosemgrep\b|\bNOLINT(NEXTLINE)?\b(\([^)]*\))?/,
  /\b(ktlint|detekt)-disable\S*/,
  /\bCHECKSTYLE[:.]OFF\b\S*/,
  /#\s*noqa\b(:\s*[\w, ]+)?|#\s*type:\s*ignore\b(\[[^\]]*\])?|#\s*(pylint|pyright):\s*(disable|ignore)\S*|#\s*mypy:\s*ignore-errors|#\s*pragma:\s*no\s*cover|#\s*nosec\b/,
  /\/\/\s*nolint\b(:\S+)?|\/\/\s*lint:ignore\s+\S+|\/\/\s*#nosec\b/,
  /#\s*rubocop:disable\s+\S+/,
  /\/\/\s*swiftlint:disable\S*(\s+\S+)?/,
  /#!?\[allow\([^)]*\)\]/, // Rust
  /#pragma\s+warning\s+disable\b(\s+\S+)?|#pragma\s+(GCC|clang)\s+diagnostic\s+ignored\s+"[^"]*"/,
  /@(phpstan-ignore\S*|psalm-suppress\s+\S+)|\bphpcs:(ignore|disable)\b/,
  /\/\/\s*ignore(_for_file)?:\s*[\w, ]+/, // Dart
  /#\s*shellcheck\s+disable=\S+/,
  /\btools:ignore="[^"]*"/, // Android lint, in XML
];

// CI let off: a step or job that can fail without failing the build, or never runs; tests skipped on the command line.
const CI_FILE = /(^|\/)(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|\.circleci\/config\.ya?ml|azure-pipelines\.ya?ml|bitrise\.ya?ml|codemagic\.ya?ml|Jenkinsfile|\.buildkite\/[^/]+\.ya?ml)$/;
const SCRIPT_FILE = /(^|\/)(Makefile|package\.json|Fastfile|[^/]+\.(sh|bash|gradle|gradle\.kts))$/;
const CI: RegExp[] = [
  /\bcontinue-on-error:\s*true\b/,
  /\ballow_failure:\s*true\b/, // GitLab
  /^\s*-?\s*if:\s*(false|\$\{\{\s*false\s*\}\})\s*$/,
];
// || true lets a command fail quietly: worth asking only on one that tests, lints or scans (not kill, jq, gh…).
const SWALLOW = /\|\|\s*(true|:|exit 0)\b/;
const CHECK_CMD = /\b(\w*test\w*|\w*lint\w*|\w*check\w*|\w*scan\w*|detekt|tsc|mypy|ruff|flake8|semgrep|sonar\w*|go vet)\b/;
const CI_SKIP = /(?:^|\s)-x\s+:?[\w:-]*[tT]est\w*|-DskipTests\b|-Dmaven\.test\.skip=true|--passWithNoTests\b|--no-verify\b/;

export function switchedOff(files: F[]): Off[] {
  const out: Off[] = [];
  for (const f of files) {
    if (!f.patch || isMarkdown(f.filename)) continue;
    const hunks = parsePatch(f.patch);
    const gone = new Set(hunks.flatMap((h) => h.lines.filter((l) => l.kind === '-').map((l) => l.text.trim())));
    const tests = inTests(f.filename);
    for (const l of hunks.flatMap((h) => h.lines)) {
      if (l.kind !== '+' || l.new == null || gone.has(l.text.trim())) continue;
      const t = tests ? [...TEST, ...TEST_IN.filter(([file]) => file.test(f.filename)).map(([, re]) => re)].map((re) => l.text.match(re)).find(Boolean) : null;
      const swallowed = CI_FILE.test(f.filename) && CHECK_CMD.test(l.text.replace(SWALLOW, '')) && !/^\s*\w+=\$\(/.test(l.text) ? l.text.match(SWALLOW) : null;
      const ci = t ? null : CI_FILE.test(f.filename) ? ([...CI, CI_SKIP].map((re) => l.text.match(re)).find(Boolean) ?? swallowed) : SCRIPT_FILE.test(f.filename) ? l.text.match(CI_SKIP) : null;
      if (ci) {
        out.push({ path: f.filename, line: l.new, what: ci[0].trim(), test: false, ci: true });
        continue;
      }
      const m = t ?? CHECK.map((re) => l.text.match(re)).find(Boolean);
      if (m) out.push({ path: f.filename, line: l.new, what: m[0].trim(), test: !!t });
    }
  }
  return out;
}

// Protections a PR switches off: release builds left readable, debugging or plain HTTP allowed, TLS not checked.
// Not in debug-only sources, and TLS ones not in tests.
export type Unsafe = { path: string; line: number; what: string; why: string };
const READABLE = 'Release builds ship unshrunk and unobfuscated: anyone can read the code back from the app.';
const NO_TLS = "Certificates aren't checked: anyone on the network can pose as the server and read or change the traffic.";
const UNSAFE: [file: RegExp, re: RegExp, why: string][] = [
  [/(\.pro|proguard[^/]*\.(txt|cfg))$/, /^\s*-(dontobfuscate|dontshrink)\b/, READABLE],
  [/(\.pro|proguard[^/]*\.(txt|cfg))$/, /^\s*-keep\w*\s+class\s+\*{1,2}\s*\{\s*\*;\s*\}/, 'Keeps every class as it is: nothing is shrunk or obfuscated.'],
  [/AndroidManifest\.xml$/, /android:debuggable="true"/, 'Anyone with the app can attach a debugger to it and read its memory.'],
  [/AndroidManifest\.xml$/, /android:usesCleartextTraffic="true"/, 'Plain HTTP allowed: traffic can be read and changed on the network.'],
  [/\.xml$/, /cleartextTrafficPermitted="true"/, 'Plain HTTP allowed: traffic can be read and changed on the network.'],
  [/\.xml$/, /<certificates\s+src="user"/, 'Trusts certificates people install themselves: a proxy can read the traffic.'],
  [/./, /\bverify\s*=\s*False\b|\bInsecureSkipVerify:\s*true\b|\brejectUnauthorized:\s*false\b|NODE_TLS_REJECT_UNAUTHORIZED\W{1,4}0\b|[hH]ostnameVerifier\b.*->\s*true\b|\b(ALLOW_ALL_HOSTNAME_VERIFIER|NoopHostnameVerifier|SSL_VERIFYPEER,\s*(false|0))\b|curl\s.*--insecure\b/, NO_TLS],
];
const DEBUG_ONLY = /\/src\/\w*[dD]ebug\w*\/|(^|\/)build\//; // debug sources, and build output
// minifyEnabled (or shrinkResources) turned from true to false in a release build type: false on its own is how every
// library module starts. The nearest block opened above it in the hunk names the build type; one the hunk doesn't show
// isn't guessed at.
const NO_MINIFY = /\b(is)?(minifyEnabled|MinifyEnabled|shrinkResources|ShrinkResources)\s*(=\s*)?false\b/;
const BLOCK = /^\s*(?:getByName\("(\w+)"\)|create\("(\w+)"\)|named\("(\w+)"\)|(\w+))\s*\{\s*$/;

export function protectionsOff(files: F[]): Unsafe[] {
  const out: Unsafe[] = [];
  for (const f of files) {
    if (!f.patch || isMarkdown(f.filename) || DEBUG_ONLY.test(f.filename)) continue;
    const gradle = /\.gradle(\.kts)?$/.test(f.filename);
    for (const h of parsePatch(f.patch)) {
      const gone = new Set(h.lines.filter((l) => l.kind === '-').map((l) => l.text.trim()));
      let debugOverrides = false; // inside network_security_config's <debug-overrides>: debug builds only
      for (const [i, l] of h.lines.entries()) {
        if (l.kind !== '-' && /<debug-overrides\b/.test(l.text)) debugOverrides = true;
        if (l.kind !== '-' && /<\/debug-overrides>/.test(l.text)) debugOverrides = false;
        if (l.kind !== '+' || l.new == null || debugOverrides || gone.has(l.text.trim()) || /^\s*(\/\/|#)/.test(l.text)) continue;
        if (gradle && NO_MINIFY.test(l.text)) {
          const key = l.text.match(NO_MINIFY)![2].toLowerCase();
          if (!h.lines.some((x) => x.kind === '-' && x.text.toLowerCase().includes(key) && /\btrue\b/.test(x.text))) continue;
          let type: string | undefined;
          for (let j = i - 1; j >= 0 && !type; j--) if (h.lines[j].kind !== '-') type = h.lines[j].text.match(BLOCK)?.slice(1).find(Boolean);
          if (type && /^(release|prod\w*)$/i.test(type)) out.push({ path: f.filename, line: l.new, what: l.text.match(NO_MINIFY)![0], why: READABLE });
          continue;
        }
        const hit = UNSAFE.find(([file, re, why]) => file.test(f.filename) && re.test(l.text) && !(why === NO_TLS && inTests(f.filename)));
        if (hit) out.push({ path: f.filename, line: l.new, what: l.text.match(hit[1])![0].trim(), why: hit[2] });
      }
    }
  }
  return out;
}
