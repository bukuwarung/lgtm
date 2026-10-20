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
