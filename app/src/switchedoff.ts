// What a PR switches off: tests skipped or ignored, and checks silenced (type checks, linters, compiler warnings,
// coverage, security scanners), in any language. Added lines only; a line also removed in the same file (moved or
// re-indented) doesn't count.
import { parsePatch } from './diff.ts';
import { isMarkdown } from './markdown.ts';
import { inTests } from './files.ts';

type F = { filename: string; status?: string; patch?: string };
export type Off = { path: string; line: number; what: string; test: boolean };

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

// Not in a file the PR adds: Kotlin, Java and Android code is full of these from the start (written as it was
// written, all there to read); added to code that's already there, they hide something that used to be reported.
const ONLY_IN_EXISTING = /^(@(file:)?Suppress(Warnings|Lint|FBWarnings)?\(|tools:ignore=)/;

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
      const m = t ?? CHECK.map((re) => l.text.match(re)).find(Boolean);
      if (m && !t && f.status === 'added' && ONLY_IN_EXISTING.test(m[0])) continue;
      if (m) out.push({ path: f.filename, line: l.new, what: m[0].trim(), test: !!t });
    }
  }
  return out;
}
