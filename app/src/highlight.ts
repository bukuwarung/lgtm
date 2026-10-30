import hljs from 'highlight.js/lib/common';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import kotlin from 'highlight.js/lib/languages/kotlin';
import groovy from 'highlight.js/lib/languages/groovy';
import { alias, load } from 'virtual:hljs-languages';
import type { Hunk } from './diff.ts';

hljs.registerLanguage('dockerfile', dockerfile);
// Groovy: Jenkins pipelines (Jenkinsfile, vars/*.groovy) and Groovy-DSL Gradle builds.
hljs.registerLanguage('groovy', groovy);
hljs.registerAliases(['gradle', 'gvy', 'jenkinsfile'], { languageName: 'groovy' });
// ProGuard / R8 rules (highlight.js has none): directives, class specifications, member wildcards, comments.
hljs.registerLanguage('proguard', (h) => ({
  name: 'ProGuard',
  aliases: ['pro', 'proguard.cfg', 'proguard-rules.txt', 'proguard-android.txt', 'proguard-android-optimize.txt', 'proguard-project.txt'],
  keywords: {
    keyword: 'class interface enum extends implements public private protected static final abstract native synchronized volatile transient synthetic bridge varargs strictfp',
    type: 'void boolean byte char short int long float double',
  },
  contains: [
    h.HASH_COMMENT_MODE,
    { className: 'meta', begin: /(?<![\w.$])-[a-z]\w*/ }, // -keep, -dontwarn, -keepclassmembers
    { className: 'meta', begin: /,\s*(allow\w+|includedescriptorclasses|includecode)\b/ }, // -keep's modifiers
    { className: 'meta', begin: /@[\w.$]+/ }, // annotations
    { className: 'symbol', begin: /<(init|clinit|fields|methods|\d+)>/ },
    h.QUOTE_STRING_MODE,
  ],
}));
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
// Languages beyond the ones built in, loaded once a PR's files need them (their own small chunks, vite.config.ts).
const loading = new Map<string, Promise<void>>();
export function loadLanguages(paths: string[]): Promise<unknown> {
  const want = new Set<string>();
  for (const p of paths) {
    const base = p.split('/').pop()!.toLowerCase();
    const names = [base.split('.').pop()!, base];
    if (!names.some((n) => hljs.getLanguage(n))) names.forEach((n) => alias[n] && want.add(alias[n]));
  }
  return Promise.all(
    [...want].map((name) => {
      if (!loading.has(name)) loading.set(name, load[name]().then((m) => hljs.registerLanguage(name, m.default), () => {}));
      return loading.get(name);
    }),
  );
}

export function languageFor(path: string): string | undefined {
  const base = path.split('/').pop()!.toLowerCase();
  return [base.split('.').pop()!, base].find((n) => hljs.getLanguage(n));
}

// Rainbow brackets (Settings → Code): ( [ { and their partners coloured by how deep they nest, three colours round,
// leaving strings and comments alone. A diff hunk starts at depth 0, as its start is all lgtm sees.
let rainbowOn = false;
export const setRainbow = (on: boolean) => void (rainbowOn = on);
const QUOTED = /hljs-(string|comment|regexp|char|quote)/;
export function rainbow(html: string): string {
  let depth = 0;
  const quoted: boolean[] = [];
  const color = (d: number) => `rb${((d % 3) + 3) % 3}`;
  return html.replace(/<span class="([^"]*)">|<\/span>|<[^>]*>|&[^;]*;|[^<&]+/g, (m, cls) => {
    if (cls != null) return quoted.push(QUOTED.test(cls) || quoted.at(-1) === true), m;
    if (m === '</span>') return quoted.pop(), m;
    if (m[0] === '<' || m[0] === '&' || quoted.at(-1)) return m;
    return m.replace(/[([{}\])]/g, (b) => ('([{'.includes(b) ? `<span class="${color(depth++)}">${b}</span>` : `<span class="${color(--depth)}">${b}</span>`));
  });
}

export const highlightCode = (code: string, language: string) => {
  const html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
  return rainbowOn ? rainbow(html) : html;
};

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
