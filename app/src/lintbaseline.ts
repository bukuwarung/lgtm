// Android lint baselines (lint-baseline.xml): warnings lint is told to ignore. A diff of one says little line by line;
// what matters is which suppressions are new (warnings now hidden, worth asking about) and which went (fixed).
import { parsePatch } from './diff.ts';

export type Suppression = { id: string; message: string; file: string; line?: number };

export const isLintBaseline = (path: string) => /(^|\/)lint-baseline[^/]*\.xml$/.test(path);

const attr = (tag: string, name: string) => {
  const v = tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  return v?.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
};

function issues(xml: string, base: string): Suppression[] {
  return [...xml.matchAll(/<issue\b[\s\S]*?<\/issue>/g)].map(([block]) => {
    const loc = block.match(/<location\b[^>]*>/)?.[0] ?? '';
    const line = Number(attr(loc, 'line'));
    return { id: attr(block, 'id') ?? '?', message: attr(block, 'message') ?? '', file: resolve(base, attr(loc, 'file') ?? ''), line: line || undefined };
  });
}

// A location's file is relative to the baseline's module folder.
function resolve(base: string, file: string): string {
  const out = base ? base.split('/') : [];
  for (const p of file.split('/')) p === '..' ? out.pop() : p && p !== '.' && out.push(p);
  return out.join('/');
}

// From the patch: each hunk's old and new text, issues read from both; one in both (by rule, file and message: lines
// move all the time) is unchanged. ponytail: an issue cut by a hunk's edge isn't seen; the whole files would catch it.
export function baselineChanges(path: string, patch: string): { added: Suppression[]; removed: Suppression[] } {
  const base = path.split('/').slice(0, -1).join('/');
  const was: Suppression[] = [], now: Suppression[] = [];
  for (const h of parsePatch(patch)) {
    was.push(...issues(h.lines.filter((l) => l.kind !== '+').map((l) => l.text).join('\n'), base));
    now.push(...issues(h.lines.filter((l) => l.kind !== '-').map((l) => l.text).join('\n'), base));
  }
  const key = (s: Suppression) => `${s.id}|${s.file}|${s.message}`;
  const minus = (a: Suppression[], b: Suppression[]) => {
    const left = new Map<string, number>();
    for (const s of b) left.set(key(s), (left.get(key(s)) ?? 0) + 1);
    return a.filter((s) => {
      const n = left.get(key(s)) ?? 0;
      return n ? (left.set(key(s), n - 1), false) : true;
    });
  };
  return { added: minus(now, was), removed: minus(was, now) };
}
