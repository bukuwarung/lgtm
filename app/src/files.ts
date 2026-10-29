import { isMarkdown } from './markdown.ts';

// Where a test's subject would live: src/test|androidTest/… → src/main/…, FooTest.kt / foo.test.ts → Foo.kt / foo.ts.
const subject = (path: string) =>
  path
    .replace(/\/src\/(test|androidTest|sharedTest|testFixtures)\w*\//, '/src/main/')
    .replace(/(^|\/)__tests__\//, '$1')
    .replace(/(Tests?|Spec|IT)(\.\w+)$/, '$2')
    .replace(/[._-](test|spec)(\.\w+)$/, '$2');
const isTest = (path: string) => subject(path) !== path;
// A test file, or anything in a test folder (fixtures and resources too): what the diff and the index mark as test.
export const inTests = (path: string) =>
  isTest(path) || /(^|\/)(tests?|__tests__|spec|e2e|fixtures)\//.test(path) || /(^|\/)test_[^/]+$/.test(path);

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
// Did the change add logic worth a test: a function with a body, a lambda, or control flow? Constants, enum entries,
// properties, imports, annotations and abstract declarations don't count. Without a patch (too large), assume so.
// Functions by keyword (Kotlin fun, JS function, Python/Ruby/Scala def, Go/Swift func, Rust fn) or, for languages
// without one (Java, C#, C/C++, Dart, TS class methods), a call-shaped line opening a body that isn't a type.
const LOGIC = new RegExp(
  [
    /\bdef\b|\b(fun|function|func|fn)\b[^;]*[{=]\s*($|[^=])/.source,
    /^\s*(?!.*\b(class|enum|interface|object|record|struct|trait|impl|namespace|extension|protocol)\b)[\w<>[\],.?:@\s]*\b\w+\s*\([^;]*\)[^;=]*\{\s*$/.source,
    /=>|->|\blambda\b|\bcase\b.*:\s*$/.source, // a switch's case (Swift's enum cases have no colon)
    /\b(if|else|elif|elsif|unless|guard|when|for|foreach|while|do|loop|switch|match|select|return|yield|try|catch|except|throw|raise|defer)\b/.source,
  ].join('|'),
);
const QUIET = /^\s*(\/\/|\/?\*|#|import\b|package\b|@)/;
export const addsLogic = (patch?: string) =>
  patch == null || patch.split('\n').some((l) => l[0] === '+' && !l.startsWith('+++') && !QUIET.test(l.slice(1)) && LOGIC.test(l.slice(1)));
type Changed = { filename: string; status: string; additions: number; patch?: string };
export function untested(files: Changed[]): string[] {
  const tested = new Set(files.filter((f) => isTest(f.filename) || /(^|\/)test_[^/]+$/.test(f.filename)).map((f) => base(subject(f.filename))));
  return files
    .filter((f) => CODE.test(f.filename) && !/\.kts$/.test(f.filename) && !f.filename.includes('/src/debug/') && f.status !== 'removed' && f.additions > 0 && addsLogic(f.patch))
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

// The Gradle module of each changed file, from paths alone (no request): what comes before "/src/" (Gradle keeps a
// module's sources in <module>/src/<source set>/; "src/" at the top is the root project, "."), and the folder of a
// changed build file. Other files join the module whose folder holds them; the rest get ''. Only in a PR with
// Gradle-built code (Kotlin, Java, Groovy, Scala or a build script): elsewhere "src" means something else.
export function gradleModules(paths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!paths.some((p) => /\.(kt|kts|java|gradle|groovy|scala)$/.test(p))) return out;
  const direct = (p: string) =>
    p.startsWith('src/') || /^build\.gradle(\.kts)?$/.test(p) ? '.' : (p.match(/^(.*?)\/src\//) ?? p.match(/^(.*)\/build\.gradle(\.kts)?$/))?.[1];
  const mods = [...new Set(paths.map(direct).filter((m): m is string => !!m && m !== '.'))].sort((a, b) => b.length - a.length);
  for (const p of paths) out.set(p, direct(p) ?? mods.find((m) => p.startsWith(m + '/')) ?? '');
  return out;
}

// Modules from where the repo's build files sit (build.gradle(.kts), package.json, go.mod, Cargo.toml, pyproject.toml;
// github.ts getBuildRoots): each path in the deepest one holding it ('.' the repo's root). Without them, the guess above.
export type BuildRoot = { dir: string; gradle: boolean };
const plainRoots = new Set<string>(); // modules that aren't Gradle's, named by folder
export function modulesOf(paths: string[], roots: BuildRoot[] | null): Map<string, string> {
  if (!roots) return gradleModules(paths);
  const deepest = [...roots].sort((a, b) => b.dir.length - a.dir.length);
  for (const r of roots) if (!r.gradle) plainRoots.add(r.dir);
  return new Map(paths.map((p) => [p, deepest.find((r) => r.dir === '.' || p.startsWith(r.dir + '/'))?.dir ?? '']));
}

// Whether modules say anything about a PR: 'all' (2+ touched: group the index, tag files, a pill), 'pill' (just one,
// named in a pill), or 'none' (none, or only the repo's root).
export function moduleView(modules: Map<string, string>): 'all' | 'pill' | 'none' {
  const touched = new Set([...modules.values()].filter(Boolean));
  return touched.size >= 2 ? 'all' : touched.size === 1 && !touched.has('.') ? 'pill' : 'none';
}

// A module's name: Gradle's (core/network → :core:network; the root project ':'), else its folder.
export const moduleName = (m: string) => (plainRoots.has(m) ? (m === '.' ? '(root)' : m) : m === '.' ? ':' : ':' + m.replaceAll('/', ':'));
// As a heading: the root spelled out.
export const moduleLabel = (m: string) => (m === '.' && !plainRoots.has(m) ? ': (root)' : moduleName(m));

// Whether a set of changed files (a module's) changes code but none of its tests: code changed and added to (not
// build scripts or debug-only sources), and no test file among them.
export function codeWithoutTests(files: Changed[]): boolean {
  const test = (p: string) => isTest(p) || /(^|\/)test_[^/]+$/.test(p);
  if (files.some((f) => test(f.filename))) return false;
  return files.some((f) => CODE.test(f.filename) && !/\.kts$/.test(f.filename) && !f.filename.includes('/src/debug/') && f.status !== 'removed' && f.additions > 0 && addsLogic(f.patch));
}
