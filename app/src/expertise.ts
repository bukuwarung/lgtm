// Who knows the code a PR changes: whoever wrote, per git blame at the base commit, the lines it removes or edits
// and the unchanged lines around them (a pure insertion still lands in someone's code).
import { parsePatch } from './diff.ts';

export const touchedLines = (patch: string) => [...new Set(parsePatch(patch).flatMap((h) => h.lines.flatMap((l) => (l.kind !== '+' && l.old != null ? [l.old] : []))))];

export type BlameRange = { startingLine: number; endingLine: number; login: string | null };
// Lines per person among `lines`, from blame's ranges.
export function tally(ranges: BlameRange[], lines: number[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of lines) {
    const r = ranges.find((r) => r.startingLine <= n && n <= r.endingLine);
    if (r?.login) out.set(r.login, (out.get(r.login) ?? 0) + 1);
  }
  return out;
}

export type Knows = { login: string; share: number; file: string }; // share: of the touched lines, in their top file
// Across files: each person's share of all touched lines, and the file where they wrote most of it.
export function whoKnows(perFile: { path: string; lines: number; by: Map<string, number> }[]): Knows[] {
  const total = perFile.reduce((n, f) => n + f.lines, 0);
  if (!total) return [];
  const people = new Map<string, { n: number; file: string; best: number }>();
  for (const f of perFile)
    for (const [login, n] of f.by) {
      const p = people.get(login) ?? { n: 0, file: f.path, best: 0 };
      p.n += n;
      if (n > p.best) (p.best = n), (p.file = f.path);
      people.set(login, p);
    }
  return [...people].map(([login, p]) => ({ login, share: p.n / total, file: p.file })).sort((a, b) => b.share - a.share);
}
