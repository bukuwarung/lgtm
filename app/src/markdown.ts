import MarkdownIt from 'markdown-it';
import { highlightCode, languageFor, splitLines } from './highlight.ts';

// A fence with no language is assumed to be Kotlin (the team's main language).
const fenceLanguage = (info: string) => languageFor('x.' + (info.trim().split(/\s+/)[0] || 'kt'));

// Raw HTML is parsed (so it's recognized) but rendered escaped; PR content never reaches the DOM as HTML.
export const md = new MarkdownIt({
  html: true,
  linkify: true,
  highlight: (code, info) => {
    const lang = fenceLanguage(info);
    return lang ? highlightCode(code, lang) : '';
  },
});

// HTML comments are invisible on GitHub; drop them instead of showing them as text.
const escapeHtml = (tokens: { content: string }[], i: number) =>
  /^\s*<!--[\s\S]*?-->\s*$/.test(tokens[i].content) ? '' : md.utils.escapeHtml(tokens[i].content);
md.renderer.rules.html_block = escapeHtml;
md.renderer.rules.html_inline = escapeHtml;

const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  tokens[i].attrSet('target', '_blank');
  tokens[i].attrSet('rel', 'noopener');
  return defaultLink(tokens, i, opts, env, self);
};

// Rows are commentable (their "+" is drawn on the first cell); sections and cells aren't.
const SKIP = new Set(['thead_open', 'tbody_open', 'th_open', 'td_open']);

const anyIn = (set: Set<number>, s: number, e: number) => {
  for (let i = s; i <= e; i++) if (set.has(i)) return true;
  return false;
};

// When rendering a diffed file, tag every block with its 1-based head line range, whether it has added lines
// (data-chg), and whether it lies entirely outside the diff (data-nd: shown for context, not commentable, since
// GitHub only takes line comments on diff lines).
md.core.ruler.push('src_map', (state) => {
  const added: Set<number> | undefined = state.env?.added;
  const inDiff: Set<number> | undefined = state.env?.inDiff;
  if (!added) return;
  for (const t of state.tokens) {
    if (!t.map || t.nesting === -1 || SKIP.has(t.type)) continue;
    const [s, e] = [t.map[0] + 1, t.map[1]];
    t.attrSet('data-src', `${s}-${e}`);
    if (anyIn(added, s, e)) t.attrSet('data-chg', '');
    if (inDiff && !anyIn(inDiff, s, e)) t.attrSet('data-nd', '');
  }
});

// In a diffed file, a code block is commentable as a whole (its <pre>) and line by line: each line is its own
// <span class="cl" data-src="n-n">, so it gets its own "+" gutter and changed-line highlight.
const fence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, i, opts, env, self) => {
  const t = tokens[i];
  const src = t.attrGet('data-src');
  const info = t.info.trim().split(/\s+/)[0];
  // Mermaid: a placeholder that mermaid.ts turns into the diagram (the source is escaped into an attribute).
  const diagram = `<div class="mermaid-svg" data-code="${md.utils.escapeHtml(t.content)}"></div>`;
  if (!src || !t.map) return info === 'mermaid' ? diagram : fence(tokens, i, opts, env, self);
  const added: Set<number> = env.added;
  const inDiff: Set<number> | undefined = env.inDiff;
  const lang = fenceLanguage(info);
  const code = t.content.replace(/\n$/, '');
  const lines = lang ? splitLines(highlightCode(code, lang)) : code.split('\n').map((l) => md.utils.escapeHtml(l));
  const first = t.map[0] + 2; // the opening ``` is line map[0] + 1
  const body = lines
    .map((h, k) => {
      const n = first + k;
      const marks = (added.has(n) ? ' data-chg=""' : '') + (inDiff && !inDiff.has(n) ? ' data-nd=""' : '');
      return `<span class="cl" data-src="${n}-${n}"${marks}>${h || ' '}</span>`;
    })
    .join('');
  const cls = info ? ` class="language-${md.utils.escapeHtml(info)}"` : '';
  const chg = (t.attrGet('data-chg') != null ? ' data-chg=""' : '') + (t.attrGet('data-nd') != null ? ' data-nd=""' : '');
  // A diagram is commentable as a whole; its source stays below (collapsed) for line comments.
  if (info === 'mermaid')
    return `<div class="mermaid-block" data-src="${src}"${chg}>${diagram}<details class="mermaid-source"><summary>Mermaid source</summary><pre><code${cls}>${body}</code></pre></details></div>\n`;
  return `<pre data-src="${src}"${chg}><code${cls}>${body}</code></pre>\n`;
};

// inDiff: whether any line of this top-level block is part of the diff (always true when no diff lines are given).
export type Chunk = { start: number; end: number; html: string; inDiff: boolean };

// Split into top-level blocks so threads and drafts can be rendered between them. `inDiff` = head lines inside the
// diff's hunks; blocks outside it are marked so the view can fold them and keep them uncommentable.
export function renderChunks(src: string, added: Set<number>, inDiff?: Set<number>): Chunk[] {
  const env = { added, inDiff };
  const isIn = (s: number, e: number) => !inDiff || anyIn(inDiff, s, e);
  const out: Chunk[] = [];
  // YAML front matter: show as a code block, and blank it out for markdown-it so line numbers still line up.
  const fm = src.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  if (fm) {
    const n = fm.trimEnd().split('\n').length;
    const marks = (anyIn(added, 1, n) ? ' data-chg=""' : '') + (isIn(1, n) ? '' : ' data-nd=""');
    out.push({ start: 1, end: n, inDiff: isIn(1, n), html: `<pre data-src="1-${n}"${marks}><code>${md.utils.escapeHtml(fm.trimEnd())}</code></pre>` });
    src = '\n'.repeat(n) + src.slice(fm.length);
  }
  const tokens = md.parse(src, env);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let j = i;
    if (t.nesting === 1) while (!(j > i && tokens[j].nesting === -1 && tokens[j].level === t.level)) j++;
    const [s, e] = t.map ?? [0, 0];
    out.push({ start: s + 1, end: e, inDiff: isIn(s + 1, e), html: md.renderer.render(tokens.slice(i, j + 1), md.options, env) });
    i = j;
  }
  return out;
}

export const isMarkdown = (path: string) => /\.(md|mdx|markdown)$/i.test(path);
