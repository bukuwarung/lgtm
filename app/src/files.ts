import { isMarkdown } from './markdown.ts';

// Where a test's subject would live: src/test|androidTest/… → src/main/…, FooTest.kt / foo.test.ts → Foo.kt / foo.ts.
const subject = (path: string) =>
  path
    .replace(/\/src\/(test|androidTest|sharedTest|testFixtures)\w*\//, '/src/main/')
    .replace(/(^|\/)__tests__\//, '$1')
    .replace(/(Tests?|Spec|IT)(\.\w+)$/, '$2')
    .replace(/[._-](test|spec)(\.\w+)$/, '$2');
const isTest = (path: string) => subject(path) !== path;

// Reading order: markdown (the intent) first, then each source file followed by its tests.
export const reviewOrder = (paths: string[]) =>
  [...paths].sort(
    (a, b) => +isMarkdown(b) - +isMarkdown(a) || subject(a).localeCompare(subject(b)) || +isTest(a) - +isTest(b) || a.localeCompare(b),
  );

// Code files whose tests the PR doesn't touch: a guess for "is this tested?". Code = common source languages, not
// tests, not deleted, not Android's debug-only source set, with added lines; a test counts for a file when its subject has the same name (FooTest.kt,
// foo.test.ts, tests/test_foo.py → Foo.kt, foo.ts, foo.py), wherever it lives.
const CODE = /\.(kt|kts|java|swift|m|mm|go|py|rb|rs|dart|scala|cs|php|c|cc|cpp|h|hpp|ts|tsx|js|jsx|mjs|vue|svelte)$/;
const base = (p: string) => p.split('/').pop()!.replace(/^test_/, '');
export function untested(files: { filename: string; status: string; additions: number }[]): string[] {
  const tested = new Set(files.filter((f) => isTest(f.filename) || /(^|\/)test_[^/]+$/.test(f.filename)).map((f) => base(subject(f.filename))));
  return files
    .filter((f) => CODE.test(f.filename) && !/\.kts$/.test(f.filename) && !f.filename.includes('/src/debug/') && f.status !== 'removed' && f.additions > 0)
    .filter((f) => !isTest(f.filename) && !/(^|\/)test_[^/]+$/.test(f.filename) && !tested.has(base(f.filename)))
    .map((f) => f.filename);
}

// A rough time to review a PR, in minutes: reading its description, then its changes. Code at about 5 changed lines a
// minute, tests twice that, docs faster still; deleted lines at a third; generated files and lockfiles skipped.
const SKIP = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Podfile\.lock|Cargo\.lock|go\.sum|gradle\.lockfile)$|(^|\/)(generated|build|dist)\/|\.(min\.js|pb\.go|g\.dart|snap|svg|png|jpe?g|webp|gif)$/;
export type Estimate = { minutes: number; words: number; code: number; tests: number; docs: number };
export function estimate(files: { path: string; additions: number; deletions: number }[], description: string | null): Estimate {
  const e: Estimate = { minutes: 0, words: (description ?? '').split(/\s+/).filter(Boolean).length, code: 0, tests: 0, docs: 0 };
  for (const f of files.filter((f) => !SKIP.test(f.path))) {
    const lines = f.additions + f.deletions / 3;
    if (isMarkdown(f.path)) e.docs += lines;
    else if (isTest(f.path) || /(^|\/)test_[^/]+$/.test(f.path)) e.tests += lines;
    else e.code += lines;
  }
  e.minutes = e.words / 200 + e.code / 5 + e.tests / 10 + e.docs / 30;
  return e;
}
// "~5 min", "~40 min", "~1 h 30": rounded to what an estimate can claim.
export function estimateLabel(minutes: number): string {
  if (minutes < 5) return '<5 min';
  if (minutes < 60) return `~${Math.round(minutes / 5) * 5} min`;
  const q = Math.round(minutes / 15) * 15;
  return `~${Math.floor(q / 60)} h${q % 60 ? ` ${q % 60}` : ''}`;
}
