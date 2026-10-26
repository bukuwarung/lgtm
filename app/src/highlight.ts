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
  // A parameter's type starts at the first word after `:`, so `block: suspend () -> Unit` would swallow `suspend`
  // into the (plain) type; keep modifier keywords out of it so they stay keywords.
  const MODIFIER = /\b(?:suspend|crossinline|noinline|vararg)\b/;
  const seen = new Set<object>();
  const walk = (m: any) => {
    if (!m || typeof m !== 'object' || seen.has(m)) return;
    seen.add(m);
    // The type is a variant of a mode in m.contains (KOTLIN_PAREN_TYPE in the grammar).
    const holder = m.contains?.find((c: any) => c?.variants?.some((v: any) => v.className === 'type' && v.begin === h.UNDERSCORE_IDENT_RE));
    if (holder) {
      holder.variants.find((v: any) => v.className === 'type').begin = new RegExp(`\\b(?!${MODIFIER.source.slice(2)})[a-zA-Z_]\\w*`);
      m.contains.unshift({ scope: 'keyword', match: MODIFIER });
    }
    for (const c of [...(m.contains ?? []), ...(m.variants ?? [])]) walk(c);
  };
  walk(k);
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

// The PR's main code language: the most common among its files, markdown and plain text aside. Unmarked code blocks
// in markdown files and in comments not on a code file are read as this.
export function majorityLanguage(paths: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const lang = languageFor(p);
    if (!lang || /\.(md|mdx|markdown)$/i.test(p) || hljs.getLanguage(lang)?.name === 'Plain text') continue;
    const name = hljs.getLanguage(lang)!.name!; // kt and kts are both Kotlin
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top && paths.map(languageFor).find((l) => l && hljs.getLanguage(l)?.name === top);
}

// Highlights code blocks in rendered comment HTML (GitHub's, or ours for drafts). A block GitHub marked keeps its
// language (re-highlighted in our colours); an unmarked one takes `fallback`. Our own already-highlighted blocks
// (language-* class), rich-markdown blocks (data-src, per-line spans) and mermaid are left alone.
export function highlightBlocks(root: ParentNode, fallback?: string) {
  for (const pre of root.querySelectorAll<HTMLElement>('pre:not([data-hl]):not([data-src])')) {
    if (pre.querySelector('code[class*="language-"]') || pre.closest('.mermaid-svg, .mermaid-block') || pre.getAttribute('lang') === 'mermaid') continue;
    // GitHub names a fence's language as <pre lang="…">, or a highlight-source-… wrapper when it coloured it.
    const named = pre.getAttribute('lang') ?? pre.closest('[class*="highlight-source-"]')?.className.match(/highlight-source-([\w+-]+)/)?.[1];
    const lang = named ? languageFor('x.' + named) : fallback;
    pre.dataset.hl = '';
    if (lang) pre.innerHTML = `<code class="hljs">${highlightCode(pre.textContent ?? '', lang)}</code>`;
  }
}

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
