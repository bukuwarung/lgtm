import hljs from 'highlight.js/lib/common';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import kotlin from 'highlight.js/lib/languages/kotlin';
import type { Hunk } from './diff.ts';

hljs.registerLanguage('dockerfile', dockerfile);
// Kotlin closer to IntelliJ: the stock grammar leaves property access, named arguments, `it` and constants plain.
// These modes come after the stock ones, so keywords, strings and comments still win where they overlap.
hljs.registerLanguage('kotlin', (h) => {
  const k = kotlin(h);
  k.contains = [
    ...k.contains,
    { scope: 'kt-arg', match: /(?<=[(,]\s*)[a-z_]\w*(?=\s*=(?!=))/ }, // fetch(id = 1)
    { scope: 'kt-prop', match: /(?<=\??\.)[a-z_]\w*\b(?!\s*[({<])/ }, // repo.items, a?.size
    { scope: 'kt-const', match: /\b[A-Z][A-Z0-9]*_[A-Z0-9_]*\b|\b[A-Z]{2,}[0-9]*\b(?![a-z])/ }, // MAX_SIZE, TAG
    { scope: 'kt-it', match: /\bit\b/ },
  ];
  // Kotlin-only colours for these (IntelliJ: types plain, annotations yellow), leaving other languages alone.
  k.classNameAliases = { ...k.classNameAliases, type: 'kt-type', built_in: 'kt-type', meta: 'kt-ann' };
  return k;
});

// By extension ("a.ts"), then by whole basename ("Dockerfile", "Makefile").
export function languageFor(path: string): string | undefined {
  const base = path.split('/').pop()!.toLowerCase();
  return [base.split('.').pop()!, base].find((n) => hljs.getLanguage(n));
}

export const highlightCode = (code: string, language: string) => hljs.highlight(code, { language, ignoreIllegals: true }).value;

// Split highlighted HTML into lines, closing and re-opening spans that cross a line break.
export function splitLines(html: string): string[] {
  const out: string[] = [];
  const open: string[] = [];
  let cur = '';
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (part === '\n') {
      out.push(cur + '</span>'.repeat(open.length));
      cur = open.join('');
      continue;
    }
    if (part.startsWith('<span')) open.push(part);
    else if (part === '</span>') open.pop();
    cur += part;
  }
  out.push(cur + '</span>'.repeat(open.length));
  return out;
}

// Per hunk, per line: highlighted HTML. Each side of a hunk is highlighted as one block so
// multi-line strings and comments keep their colors. null when the language is unknown.
export function highlightHunks(hunks: Hunk[], path: string): string[][] | null {
  const lang = languageFor(path);
  if (!lang) return null;
  return hunks.map((h) => {
    const side = (kind: '+' | '-') =>
      splitLines(highlightCode(h.lines.filter((l) => l.kind !== kind).map((l) => l.text).join('\n'), lang));
    const head = side('-'), base = side('+');
    let hi = 0, bi = 0;
    return h.lines.map((l) => {
      if (l.kind === '-') return base[bi++];
      if (l.kind === ' ') bi++;
      return head[hi++];
    });
  });
}
