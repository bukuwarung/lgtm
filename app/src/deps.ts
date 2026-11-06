// Dependency changes in a PR, from the patches of build files: Gradle (build.gradle[.kts], with "group:name:version"
// coordinates or catalog aliases), Gradle version catalogs (libs.versions.toml) and package.json. A library removed
// and added again is a version change.
import { parsePatch } from './diff.ts';

export type DepChange = { name: string; from?: string; to?: string; path: string; line: number; npm?: boolean; major?: boolean; removed?: boolean; test?: boolean; unpinned?: string }; // test: only for tests (testImplementation…); unpinned: why the version can change under you

export const isBuildFile = (p: string) => /(^|\/)(build\.gradle(\.kts)?|[\w.-]+\.versions\.toml|package\.json)$/.test(p);

const COORD = /["']([\w.-]+:[\w.-]+):([\w.+\-\[\](),]+)["']/; // "group:name:version"
const CATALOG_USE = /\b(?:implementation|api|compileOnly|runtimeOnly|kapt|ksp|annotationProcessor|\w+Implementation|\w+Api|classpath)\s*\(?\s*(?:platform\()?(libs\.[\w.]+)/;
const TOML_LIB = /^\s*([\w-]+)\s*=\s*\{.*?(?:module\s*=\s*"([\w.-]+:[\w.-]+)"|group\s*=\s*"([\w.-]+)".*?name\s*=\s*"([\w.-]+)")(?:.*?\bversion\s*=\s*"([^"]+)")?/;
const TOML_VER = /^\s*([\w-]+)\s*=\s*"(\d[\w.+-]*|latest\.\w+|[\[(][\w.,)\]]+)"\s*$/; // [versions] name = "1.2.3"
// package.json's own fields (and engines'), which look like "name": "1.2.3" but aren't libraries.
const NOT_A_DEP = new Set(['version', 'name', 'description', 'main', 'module', 'types', 'typings', 'license', 'packageManager', 'node', 'npm', 'yarn', 'pnpm', 'bun']);
const NPM = /^\s*"(@?[\w./-]+)"\s*:\s*"([\^~>=<]*\s*\d[\w.+-]*|workspace:[^"]*|npm:[^"]*|\*|latest|(?:git\+|git:|github:|gitlab:|bitbucket:)[^"]+|[\w-]+\/[\w.-]+#[^"]+)"/;

// A version that can resolve to a different build tomorrow: a snapshot, a dynamic version or a range, "latest", or a git
// branch. A git URL pinned to a commit or a tag isn't one; npm's ^ and ~ aren't either (the lockfile pins them).
export function unpinned(v: string | undefined, npm?: boolean): string | undefined {
  if (!v) return;
  if (npm) {
    if (v === '*' || v === 'latest') return `"${v}", whatever is newest`;
    if (!/^(git|github:|gitlab:|bitbucket:)|^[\w-]+\/[\w.-]+#/.test(v)) return;
    const ref = v.split('#')[1];
    return !ref ? "a git repo's default branch" : /^([0-9a-f]{7,40}|semver:.*|v?\d+\.\d+.*)$/.test(ref) ? undefined : `git branch ${ref}`;
  }
  if (/-SNAPSHOT$/i.test(v)) return 'a snapshot, rebuilt in place';
  if (v.includes('+')) return 'dynamic, the newest that matches';
  if (/^latest\./.test(v)) return `whatever is newest`;
  if (/^[\[(].*,.*[)\]]$/.test(v)) return 'a range, the newest in it';
}

function read(path: string, text: string): { name: string; version?: string; npm?: boolean; test?: boolean } | null {
  if (path.endsWith('package.json')) {
    const m = text.match(NPM);
    return m && !NOT_A_DEP.has(m[1]) ? { name: m[1], version: m[2], npm: true } : null;
  }
  if (path.endsWith('.toml')) {
    const lib = text.match(TOML_LIB);
    if (lib) return { name: lib[2] ?? `${lib[3]}:${lib[4]}`, version: lib[5] };
    const v = text.match(TOML_VER);
    return v ? { name: `${v[1]} (version)`, version: v[2] } : null;
  }
  const test = /\b\w*[tT]est\w*(Implementation|Api|CompileOnly|RuntimeOnly)\b/.test(text);
  const c = text.match(COORD);
  if (c) return { name: c[1], version: c[2], test };
  const u = text.match(CATALOG_USE);
  return u ? { name: u[1], test } : null;
}

const major = (v?: string) => v?.match(/\d+/)?.[0];

export function depChanges(files: { filename: string; patch?: string }[]): DepChange[] {
  const out: DepChange[] = [];
  for (const f of files.filter((f) => isBuildFile(f.filename) && f.patch)) {
    type Seen = { version?: string; line: number; npm?: boolean; test?: boolean };
    const gone = new Map<string, Seen>(), came = new Map<string, Seen>();
    for (const h of parsePatch(f.patch!))
      for (const l of h.lines) {
        if (l.kind === ' ' || /^\s*(\/\/|#)/.test(l.text)) continue;
        const d = read(f.filename, l.text);
        if (d) (l.kind === '-' ? gone : came).set(d.name, { version: d.version, line: (l.kind === '-' ? l.old : l.new)!, npm: d.npm, test: d.test });
      }
    for (const [name, a] of came) {
      const b = gone.get(name);
      if (b && b.version === a.version) continue; // moved, or the line changed around it
      out.push({ name, from: b?.version, to: a.version, path: f.filename, line: a.line, npm: a.npm, test: a.test, unpinned: unpinned(a.version, a.npm), major: !!b?.version && !!a.version && major(b.version) !== major(a.version) });
    }
    for (const [name, b] of gone) if (!came.has(name)) out.push({ name, from: b.version, path: f.filename, line: b.line, npm: b.npm, test: b.test, removed: true });
  }
  return out;
}
