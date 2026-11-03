import { parsePatch, type Line } from './diff.ts';

// Specs that name the PR's code. A code span in a spec naming a changed file (by path, or its name), or a class or
// function the PR's diff declares, links to that file; and each file lists where the specs name it.

// Specs: Markdown, and anything under openspec/ or docs/.
export const isDoc = (path: string) => /\.(md|mdx|markdown)$/i.test(path) || /(^|\/)(openspec|docs)\//.test(path);

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export type Ref = { path: string; line?: number }; // a changed file, and the line declaring what's named (new side)
export type CodeIndex = { files: string[]; symbols: Map<string, Ref>; patches: Map<string, string> }; // patches: every file's, specs' too (previews)
type F = { filename: string; patch?: string };

// Declarations in the diff's added and unchanged lines; a file named like a class stands for it (Kotlin, Java, Swift).
const DECL = /\b(?:class|interface|object|enum|fun|def|func|function|struct|trait|protocol|record)\s+([A-Za-z_]\w{2,})/g;
export function codeIndex(files: F[]): CodeIndex {
  const code = files.filter((f) => !isDoc(f.filename));
  const symbols = new Map<string, Ref>();
  for (const f of code)
    for (const h of parsePatch(f.patch ?? ''))
      for (const l of h.lines) if (l.kind !== '-' && l.new != null) for (const m of l.text.matchAll(DECL)) if (!symbols.has(m[1])) symbols.set(m[1], { path: f.filename, line: l.new });
  for (const f of code) {
    const name = base(f.filename).replace(/\.\w+$/, '');
    if (/^[A-Z]\w{2,}$/.test(name) && !symbols.has(name)) symbols.set(name, { path: f.filename });
  }
  return { files: code.map((f) => f.filename), symbols, patches: new Map(files.map((f) => [f.filename, f.patch ?? ''])) };
}

// What a link's preview shows: the diff around the declaration it names, else the file's first change that isn't an
// import (an added import says little about the change).
const IMPORT = /^\s*(?:import|package|using|#include|from\s+\S+\s+import)\b/;
const telling = (l: Line) => l.kind !== ' ' && !!l.text.trim() && !IMPORT.test(l.text);
export function peekLines(patch: string, line?: number, max = 14): Line[] {
  const hunks = parsePatch(patch);
  const h = (line && hunks.find((x) => x.lines.some((l) => l.new === line))) || hunks.find((x) => x.lines.some(telling)) || hunks.find((x) => x.lines.some((l) => l.kind !== ' ')) || hunks[0];
  if (!h) return [];
  const first = h.lines.findIndex(telling);
  const at = line && h.lines.some((l) => l.new === line) ? h.lines.findIndex((l) => l.new === line) : Math.max(0, first >= 0 ? first : h.lines.findIndex((l) => l.kind !== ' '));
  const from = Math.max(0, at - 2);
  return h.lines.slice(from, from + max);
}

// The changed file a code span names, if any: `app/build.gradle.kts`, `proguard-rules.pro`, `Foo.kt:12`,
// `LegacySignalHandler`, `initialiseBureau()`, `Foo.bar`, `Foo#bar`.
export function refTo(text: string, ix: CodeIndex): Ref | null {
  const t = text.trim().replace(/^\.?\//, '').replace(/:\d+(?:-\d+)?$/, '').replace(/\(.*\)$/, '');
  if (!t || /\s/.test(t)) return null;
  if (t.includes('/') || /\.\w+$/.test(t)) {
    const hit = ix.files.find((p) => p === t) ?? ix.files.find((p) => p.endsWith('/' + t));
    if (hit) return { path: hit };
  }
  const parts = t.split(/[.#:]+/).filter(Boolean); // the member named first, then its class
  for (const s of [parts.at(-1), parts[0]]) if (s && ix.symbols.has(s)) return ix.symbols.get(s)!;
  return null;
}

// A task's number ("2.3") on a spec line, for naming where a file is mentioned.
const taskNo = (line: string) => line.match(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?)?(\d+(?:\.\d+)+)\b/)?.[1];

// Where the specs name each changed file: the spec, its line (new side) and a label ("tasks.md 2.3"). From the specs'
// diffs, so it's known before they're drawn (a new spec's diff is all of it).
export type SpecRef = { spec: string; line: number; label: string };
export function specRefs(files: F[], ix: CodeIndex): Map<string, SpecRef[]> {
  const out = new Map<string, SpecRef[]>();
  for (const f of files.filter((f) => isDoc(f.filename) && f.patch))
    for (const h of parsePatch(f.patch!))
      for (const l of h.lines) {
        if (l.kind === '-' || l.new == null) continue;
        for (const m of l.text.matchAll(/`([^`\n]+)`/g)) {
          const to = refTo(m[1], ix)?.path;
          if (!to) continue;
          const no = taskNo(l.text);
          const list = out.get(to) ?? [];
          if (!list.some((r) => r.spec === f.filename && r.line === l.new)) list.push({ spec: f.filename, line: l.new, label: no ? `${base(f.filename)} ${no}` : base(f.filename) });
          out.set(to, list);
        }
      }
  return out;
}
