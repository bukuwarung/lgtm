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
    offset += h.lines.filter((l) => l.old != null).length - news.length;
  });
  out.push({ before: hunks.length, from: next, to: null, offset });
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, '');

// "Ignore whitespace": inside each run of removed+added lines, lines equal but for whitespace become one unchanged
// line (an LCS over the whitespace-free text, so a re-indented block inside a new `if` still lines up). Blank lines
// left over count as whitespace too and show unchanged (an added one with its new number, a removed one its old).
// Line numbers are kept, so comments still anchor.
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
      const emit = () =>
        out.push(
          ...pendD.splice(0).map((l): Line => (squash(l.text) === '' ? { kind: ' ', text: l.text, old: l.old } : l)),
          ...pendA.splice(0).map((l): Line => (squash(l.text) === '' ? { kind: ' ', text: l.text, new: l.new } : l)),
        );
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

// With whitespace ignored, a hunk's re-indented lines read as unchanged: keep `keep` of them around each real change
// (or a line someone commented on), as git cuts its hunks, and split the hunk there; the lines between become a gap
// like any other ("Show N unchanged lines").
export function trimContext(hunks: Hunk[], keep = 3, noted: Set<number> = new Set()): Hunk[] {
  return hunks.flatMap((h) => {
    const key = h.lines.map((l) => l.kind !== ' ' || (l.new != null && noted.has(l.new)));
    const kept = h.lines.map((_, i) => key.slice(Math.max(0, i - keep), i + keep + 1).some(Boolean));
    if (kept.every(Boolean)) return [h];
    const out: Hunk[] = [];
    let run: Line[] = [];
    const close = () => {
      if (!run.length) return;
      const olds = run.filter((l) => l.old != null), news = run.filter((l) => l.new != null);
      const newStart = news[0]?.new ?? h.newStart;
      out.push({ header: `@@ -${olds[0]?.old ?? 0},${olds.length} +${newStart},${news.length} @@${h.header.replace(/^@@[^@]*@@/, '')}`, newStart, lines: run });
      run = [];
    };
    h.lines.forEach((l, i) => (kept[i] ? run.push(l) : close()));
    close();
    return out;
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

// A file whose every change is in its imports (a wildcard spelled out, imports sorted or added), blank lines aside:
// with imports folded there's nothing left in it to read.
export function importsOnly(path: string, hunks: Hunk[]): boolean {
  const syntax = importSyntax(path);
  if (!syntax) return false;
  const folds = importFolds(hunks, syntax);
  let changed = false;
  for (const [hi, h] of hunks.entries())
    for (const [i, l] of h.lines.entries()) {
      if (l.kind === ' ') continue;
      changed = true;
      if (l.text.trim() && !folds.some((f) => f.hunk === hi && i >= f.start && i <= f.end)) return false;
    }
  return changed;
}

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

// Wraps characters [start, end) of a line's HTML (syntax-highlighted, or escaped text) in <mark class=cls>, counting
// text only (an entity is one character). The mark closes and reopens around tags, so the HTML stays well nested.
// A range split by the highlighter's tags becomes several marks: they're tagged wd-s (first), wd-m and wd-e (last) so
// a boxed style can draw them as one box (style.css).
export function markText(html: string, start: number, end: number, cls: string): string {
  if (start >= end) return html;
  const open = `<mark class="${cls}">`;
  const opens: number[] = []; // where each piece's open tag sits in `out`
  let out = '';
  let pos = 0;
  let inMark = false;
  const begin = () => (opens.push(out.length), (out += open));
  for (let i = 0; i < html.length; ) {
    if (html[i] === '<') {
      const j = html.indexOf('>', i) + 1 || html.length;
      if (inMark) {
        out += `</mark>${html.slice(i, j)}`;
        begin();
      } else out += html.slice(i, j);
      i = j;
      continue;
    }
    if (pos === start) begin(), (inMark = true);
    if (pos === end && inMark) (out += '</mark>'), (inMark = false);
    const ch = html[i] === '&' ? (html.slice(i).match(/^&(#\d+|#x[\da-f]+|\w+);/i)?.[0] ?? '&') : html[i];
    out += ch;
    i += ch.length;
    pos++;
  }
  if (inMark) out += '</mark>';
  if (opens.length < 2) return out;
  // Tag the pieces, last first so earlier positions hold.
  const at = open.length - 2; // just inside the class attribute's closing quote
  for (let k = opens.length - 1; k >= 0; k--) {
    const tag = k === 0 ? ' wd-s' : k === opens.length - 1 ? ' wd-e' : ' wd-m';
    out = out.slice(0, opens[k] + at) + tag + out.slice(opens[k] + at);
  }
  return out;
}

// What became of lines [start, end] of a file, given the patch from that version to now: null when no line in the
// range changed, else the patch lines touching it (removed, added, and kept ones between them).
export function rangeChange(patch: string, start: number, end: number): Line[] | null {
  for (const h of parsePatch(patch)) {
    let lastOld = 0;
    const touched: number[] = [];
    h.lines.forEach((l, i) => {
      if (l.old != null) lastOld = l.old;
      const inside = l.kind === '-' ? l.old! >= start && l.old! <= end : l.kind === '+' ? lastOld >= start && lastOld < end : false;
      if (inside) touched.push(i);
    });
    if (touched.length) return h.lines.slice(touched[0], touched.at(-1)! + 1);
  }
  return null;
}

// Where a hunk's change sits: the declaration it adds or changes (past its doc comment and annotations), or whose doc
// comment it changes (the next one below in the new file), else the nearest one enclosing it in the new file (`head`, its lines), found by indentation: from the first changed line,
// walk up to lines indented less, through blocks (if, when, a lambda), to the first that declares a function, class,
// object… Git's own hunk header can't do this for Kotlin or Java: it takes the nearest unindented line, so every change
// inside a class reads as the class. Null when nothing encloses it.
const DECL =
  /^\s*(?:@\w+(?:\([^)]*\))?\s+|(?:public|private|protected|internal|override|open|abstract|final|static|suspend|inline|operator|infix|tailrec|external|data|sealed|enum|annotation|inner|companion|synchronized|native|default|const|actual|expect|value|fun\s+interface)\s+)*(?:fun|class|object|interface|constructor|init)\b|^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)+[\w<>[\],.? ]+\s+\w+\s*\(/;
const COMMENT = /^\s*(\/\*|\*|\/\/|@\w)/;
const declName = (line: string) => line.trim().replace(/\s*[{=:]\s*$/, '');
export function enclosing(head: string[], hunk: Hunk): string | null {
  const { lines } = hunk;
  let at = lines.findIndex((l) => l.kind !== ' ' && l.text.trim());
  if (at < 0) {
    // Only blank lines changed: place them by the next line with text.
    const c = lines.findIndex((l) => l.kind !== ' ');
    at = c < 0 ? -1 : lines.findIndex((l, i) => i >= c && l.text.trim());
    if (at < 0) return null;
  }
  let d = at;
  while (d < lines.length && lines[d].kind !== ' ' && (COMMENT.test(lines[d].text) || !lines[d].text.trim())) d++;
  if (d < lines.length && lines[d].kind !== ' ' && DECL.test(lines[d].text)) return declName(lines[d].text);
  const indent = (s: string) => s.match(/^\s*/)![0].replace(/\t/g, '    ').length;
  // (A doc comment's " * " lines sit one space in from where the comment starts.)
  let limit = indent(lines[at].text) - (/^\s*\*/.test(lines[at].text) ? 1 : 0);
  // The changed line's place in the new file: its own number, or (a removal) the next line's there.
  const next = lines.slice(at).find((l) => l.new != null)?.new ?? hunk.newStart;
  if (COMMENT.test(lines[at].text)) {
    // A doc comment changed: the declaration it documents, below it at its own depth.
    for (let i = next - 1; i < head.length; i++) {
      if (!head[i].trim() || COMMENT.test(head[i])) continue;
      if (DECL.test(head[i]) && indent(head[i]) === limit) return declName(head[i]);
      break;
    }
  }
  for (let i = Math.min(next, head.length) - 2; i >= 0 && limit > 0; i--) {
    const line = head[i];
    if (!line.trim() || indent(line) >= limit) continue;
    if (DECL.test(line)) return declName(line);
    limit = indent(line);
  }
  return null;
}
