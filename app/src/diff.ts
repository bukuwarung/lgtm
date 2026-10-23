export type Line = { kind: '+' | '-' | ' '; text: string; old?: number; new?: number };
export type Hunk = { header: string; newStart: number; lines: Line[] };
export type Removed = { at: number; oldStart: number; lines: string[] };
export type Anchor = { startLine?: number; line: number };

export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let h: Hunk | undefined;
  let o = 0, n = 0;
  for (const raw of patch.split('\n')) {
    const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) {
      o = +m[1];
      n = +m[2];
      hunks.push((h = { header: raw, newStart: n, lines: [] }));
    } else if (h && raw !== '' && !raw.startsWith('\\')) {
      const text = raw.slice(1);
      if (raw[0] === '+') h.lines.push({ kind: '+', text, new: n++ });
      else if (raw[0] === '-') h.lines.push({ kind: '-', text, old: o++ });
      else h.lines.push({ kind: ' ', text, old: o++, new: n++ });
    }
  }
  return hunks;
}

export const addedLines = (hunks: Hunk[]) =>
  new Set(hunks.flatMap((h) => h.lines.flatMap((l) => (l.kind === '+' ? [l.new!] : []))));

// Clamp a head-side line range to the hunk it overlaps most:
// GitHub only accepts comments on diff lines, and a range may not span hunks.
export function anchor(hunks: Hunk[], start: number, end: number): Anchor | null {
  let best: [number, number] | null = null;
  for (const h of hunks) {
    const nums = h.lines.flatMap((l) => l.new ?? []);
    if (!nums.length) continue;
    const a = Math.max(start, nums[0]), b = Math.min(end, nums[nums.length - 1]);
    if (a <= b && (!best || b - a > best[1] - best[0])) best = [a, b];
  }
  if (!best) return null;
  return best[0] === best[1] ? { line: best[1] } : { startLine: best[0], line: best[1] };
}

// Runs of removed lines, each positioned just before head line `at`.
export function removedRuns(hunks: Hunk[]): Removed[] {
  const out: Removed[] = [];
  for (const h of hunks) {
    let run: Removed | undefined;
    let next = h.newStart;
    for (const l of h.lines) {
      if (l.kind === '-') (run ??= { at: 0, oldStart: l.old!, lines: [] }).lines.push(l.text);
      else if (run) {
        run.at = l.new!;
        out.push(run);
        run = undefined;
      }
      if (l.new) next = l.new + 1;
    }
    if (run) out.push({ ...run, at: next });
  }
  return out;
}

// Unchanged stretches of the new file around the hunks, for "show more lines". A gap sits before hunk `before`
// (hunks.length = after the last hunk, running to the end of the file: `to` null). Old line = new line + offset.
// In a hunk with no new lines (pure deletion) the header's new start is the line *before* the hunk.
export type Gap = { before: number; from: number; to: number | null; offset: number };

export function gaps(hunks: Hunk[]): Gap[] {
  const out: Gap[] = [];
  let next = 1;
  let offset = 0;
  hunks.forEach((h, i) => {
    const news = h.lines.flatMap((l) => l.new ?? []);
    const first = news.length ? news[0] : h.newStart + 1;
    if (first - 1 >= next) out.push({ before: i, from: next, to: first - 1, offset });
    next = (news.length ? news[news.length - 1] : h.newStart) + 1;
    offset += h.lines.filter((l) => l.kind !== '+').length - news.length;
  });
  out.push({ before: hunks.length, from: next, to: null, offset });
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, '');

// "Ignore whitespace": inside each run of removed+added lines, lines equal but for whitespace become one unchanged
// line (an LCS over the whitespace-free text, so a re-indented block inside a new `if` still lines up). Line numbers
// are kept, so comments still anchor.
export function ignoreWhitespace(hunks: Hunk[]): Hunk[] {
  return hunks.map((h) => {
    const out: Line[] = [];
    let dels: Line[] = [], adds: Line[] = [];
    const flush = () => {
      const a = dels.map((l) => squash(l.text)), b = adds.map((l) => squash(l.text));
      // ponytail: O(n·m) table per change block; fine for diffs, swap in Myers if huge blocks show up.
      const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
      for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      let i = 0, j = 0;
      const pendD: Line[] = [], pendA: Line[] = [];
      const emit = () => out.push(...pendD.splice(0), ...pendA.splice(0));
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
          emit();
          out.push({ kind: ' ', text: adds[j].text, old: dels[i].old, new: adds[j].new });
          i++, j++;
        } else if (j >= b.length || (i < a.length && L[i + 1][j] >= L[i][j + 1])) pendD.push(dels[i++]);
        else pendA.push(adds[j++]);
      }
      emit();
      dels = [];
      adds = [];
    };
    for (const l of h.lines) {
      if (l.kind === '-') {
        if (adds.length) flush();
        dels.push(l);
      } else if (l.kind === '+') adds.push(l);
      else {
        flush();
        out.push(l);
      }
    }
    flush();
    return { ...h, lines: out };
  });
}

// Word-level change inside a modified line: the removed line's [start, end) and the added line's, after the common
// prefix and suffix. Null when the lines share too little for a highlight to help.
// ponytail: one changed span per line (prefix/suffix), not a token LCS; two edits far apart highlight everything between.
export function wordChange(a: string, b: string): { del: [number, number]; add: [number, number] } | null {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  if ((p + s) / Math.max(a.length, b.length) < 0.3 || (p + s === a.length && p + s === b.length)) return null;
  return { del: [p, a.length - s], add: [p, b.length - s] };
}

// Removed lines paired with the added lines that replace them (i-th with i-th in each change run), as indexes into
// hunk.lines.
export function changePairs(h: Hunk): [number, number][] {
  const out: [number, number][] = [];
  let dels: number[] = [], adds: number[] = [];
  const flush = () => {
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) out.push([dels[k], adds[k]]);
    dels = [];
    adds = [];
  };
  h.lines.forEach((l, i) => {
    if (l.kind === '-') {
      if (adds.length) flush();
      dels.push(i);
    } else if (l.kind === '+') adds.push(i);
    else flush();
  });
  flush();
  return out;
}

// Code moved without changes: runs of 3+ removed lines whose text (whitespace aside) is added elsewhere in the PR, and
// those added runs. Only lines unique on both sides count (patience-diff style), so boilerplate repeated across files
// (`plugins {`, `dependencies {`) doesn't pass for a move; such lines, and short ones (braces, blanks), ride along
// inside a run without counting. For each file: line number → where the first line of its run went (or came from),
// set on the run's first line only; '' for the rest.
export type Moved = { old: Map<number, string>; new: Map<number, string> };
export function movedLines(files: { filename: string; hunks: Hunk[] }[]): Map<string, Moved> {
  const key = (t: string) => t.trim().replace(/\s+/g, ' ');
  const where = { '-': new Map<string, string>(), '+': new Map<string, string>() };
  const count = { '-': new Map<string, number>(), '+': new Map<string, number>() };
  for (const f of files)
    for (const h of f.hunks)
      for (const l of h.lines) {
        if (l.kind === ' ' || key(l.text).length < 6) continue;
        const k = key(l.text);
        count[l.kind].set(k, (count[l.kind].get(k) ?? 0) + 1);
        if (!where[l.kind].has(k)) where[l.kind].set(k, `${f.filename}:${l.kind === '-' ? l.old : l.new}`);
      }
  const unique = (k: string) => count['-'].get(k) === 1 && count['+'].get(k) === 1;
  const out = new Map<string, Moved>();
  for (const f of files) {
    const m: Moved = { old: new Map(), new: new Map() };
    for (const h of f.hunks) {
      for (const kind of ['-', '+'] as const) {
        const other = where[kind === '-' ? '+' : '-'];
        let run: Line[] = [];
        const end = () => {
          while (run.length && !unique(key(run.at(-1)!.text))) run.pop();
          if (run.filter((l) => unique(key(l.text))).length >= 3) {
            const side = kind === '-' ? m.old : m.new;
            run.forEach((l, i) => side.set(kind === '-' ? l.old! : l.new!, i ? '' : other.get(key(l.text))!));
          }
          run = [];
        };
        for (const l of h.lines) {
          if (l.kind !== kind) {
            if (l.kind === ' ') end();
            continue; // the other side's lines interleave; they don't break this side's run
          }
          const k = key(l.text);
          if (unique(k)) run.push(l);
          else if (k.length < 6 || other.has(k)) run.length && run.push(l); // rides along
          else end();
        }
        end();
      }
    }
    if (m.old.size || m.new.size) out.set(f.filename, m);
  }
  return out;
}

// Import blocks fold to one row (Kotlin/Java, TypeScript/JavaScript): mostly fallout of the code changes (lint
// catches unused ones), but a new package can be a new dependency or a layering slip, so the row names the packages
// this file didn't import before. A fold covers a run of package/import/blank lines with at least one changed import
// (or package line); `end` is inclusive.
// ponytail: "didn't import before" only sees imports inside the hunks; an old import outside them can look new.
export type ImportFold = { hunk: number; start: number; end: number; added: number; removed: number; newPackages: string[]; packageMoved: boolean };
type Syntax = {
  starts: RegExp; // a line that begins an import
  ends: RegExp; // the line that names the module (counted as one import)
  pkg: RegExp | null; // a package declaration that folds along
  packageOf: (text: string) => string | null; // what the import brings in, for "new: …" (null: the project's own)
};
const JVM_IMPORT = /^\s*import\s+(?:static\s+)?([\w.]+)(\.\*)?/;
const TS_SPEC = /(?:\bfrom\s+|^\s*import\s+)['"]([^'"]+)['"]/;
const SYNTAX: Record<'jvm' | 'ts', Syntax> = {
  jvm: {
    starts: JVM_IMPORT,
    ends: JVM_IMPORT,
    pkg: /^\s*package\s+[\w.]+/,
    packageOf: (text) => {
      const m = text.match(JVM_IMPORT);
      if (!m) return null;
      const segs = m[1].split('.');
      if (m[2]) return segs.join('.'); // import a.b.* → a.b
      const cls = segs.findIndex((s) => /^[A-Z]/.test(s));
      return segs.slice(0, cls < 0 ? -1 : cls).join('.'); // a.b.Foo → a.b; a.b.someFunction → a.b
    },
  },
  ts: {
    starts: /^\s*import\b/,
    ends: TS_SPEC,
    pkg: null,
    packageOf: (text) => {
      const spec = text.match(TS_SPEC)?.[1];
      // Relative paths, path aliases (@/…, ~/…) and Node built-ins are the project or the platform, not dependencies.
      if (!spec || /^(\.|\/|@\/|~|node:)/.test(spec)) return null;
      return spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'); // @scope/pkg/sub → @scope/pkg
    },
  },
};
export const importSyntax = (path: string) => (/\.(kt|kts|java)$/.test(path) ? 'jvm' : /\.[cm]?[jt]sx?$/.test(path) ? 'ts' : null);
// The project's own package root from a source path (…/java/com/acme/… → com.acme): new imports from inside it are
// everyday wiring, so only packages outside it are called out as new.
export const ownRoot = (path: string) => path.match(/\/(?:java|kotlin)\/(\w+)\/(\w+)\//)?.slice(1).join('.') ?? null;

export function importFolds(hunks: Hunk[], lang: 'jvm' | 'ts' = 'jvm'): ImportFold[] {
  const { starts, ends, pkg, packageOf } = SYNTAX[lang];
  const known = new Set(hunks.flatMap((h) => h.lines.filter((l) => l.kind !== '+').map((l) => packageOf(l.text)).filter((p) => p != null)));
  const out: ImportFold[] = [];
  hunks.forEach((h, hi) => {
    let start = -1;
    let open = false; // inside a multi-line `import {` … `} from '…'`
    // The fold also takes the package line and the blank lines around the imports, so the file starts at its code.
    const close = (end: number) => {
      const run = h.lines.slice(start, end + 1);
      const changed = run.filter((l) => l.kind !== ' ' && ends.test(l.text));
      const packageChanged = !!pkg && run.some((l) => l.kind !== ' ' && pkg.test(l.text));
      if (changed.length || packageChanged) {
        const added = changed.filter((l) => l.kind === '+');
        const fresh = [...new Set(added.map((l) => packageOf(l.text)).filter((p): p is string => !!p && !known.has(p)))];
        const packageMoved = !!pkg && run.some((l) => l.kind === '-' && pkg.test(l.text)); // not just a new file's package
        out.push({ hunk: hi, start, end, added: added.length, removed: changed.length - added.length, newPackages: fresh, packageMoved });
      }
      start = -1;
    };
    h.lines.forEach((l, i) => {
      let fits: boolean;
      if (open) {
        fits = true;
        if (ends.test(l.text) || l.text.includes('}')) open = false;
      } else if (starts.test(l.text)) {
        fits = true;
        open = !ends.test(l.text) && /\{[^}]*$/.test(l.text);
      } else fits = !!pkg?.test(l.text) || (start >= 0 && !l.text.trim());
      if (fits && start < 0) start = i;
      else if (!fits && start >= 0) close(i - 1);
    });
    if (start >= 0) close(h.lines.length - 1);
  });
  return out;
}
