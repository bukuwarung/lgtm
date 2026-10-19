import MarkdownIt from 'markdown-it';
import { highlightCode, languageFor } from './highlight.ts';

// html: false — PR content never reaches the DOM as raw HTML.
export const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight: (code, info) => {
    const lang = info && languageFor('x.' + info.split(/\s/)[0]);
    return lang ? highlightCode(code, lang) : '';
  },
});

const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  tokens[i].attrSet('target', '_blank');
  tokens[i].attrSet('rel', 'noopener');
  return defaultLink(tokens, i, opts, env, self);
};

// Table internals can't host the comment gutter (::before on <tr> breaks layout); the table itself does.
const SKIP = new Set(['thead_open', 'tbody_open', 'tr_open', 'th_open', 'td_open']);

// When rendering a diffed file, tag every block with its 1-based head line range and whether it has added lines.
md.core.ruler.push('src_map', (state) => {
  const added: Set<number> | undefined = state.env?.added;
  if (!added) return;
  for (const t of state.tokens) {
    if (!t.map || t.nesting === -1 || SKIP.has(t.type)) continue;
    const [s, e] = [t.map[0] + 1, t.map[1]];
    t.attrSet('data-src', `${s}-${e}`);
    for (let i = s; i <= e; i++) if (added.has(i)) { t.attrSet('data-chg', ''); break; }
  }
});

export type Chunk = { start: number; end: number; html: string };

// Split into top-level blocks so threads and drafts can be rendered between them.
export function renderChunks(src: string, added: Set<number>): Chunk[] {
  const env = { added };
  const out: Chunk[] = [];
  // YAML front matter: show as a code block, and blank it out for markdown-it so line numbers still line up.
  const fm = src.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  if (fm) {
    const n = fm.trimEnd().split('\n').length;
    const chg = [...Array(n)].some((_, i) => added.has(i + 1)) ? ' data-chg=""' : '';
    out.push({ start: 1, end: n, html: `<pre data-src="1-${n}"${chg}><code>${md.utils.escapeHtml(fm.trimEnd())}</code></pre>` });
    src = '\n'.repeat(n) + src.slice(fm.length);
  }
  const tokens = md.parse(src, env);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let j = i;
    if (t.nesting === 1) while (!(j > i && tokens[j].nesting === -1 && tokens[j].level === t.level)) j++;
    const [s, e] = t.map ?? [0, 0];
    out.push({ start: s + 1, end: e, html: md.renderer.render(tokens.slice(i, j + 1), md.options, env) });
    i = j;
  }
  return out;
}

export const isMarkdown = (path: string) => /\.(md|mdx|markdown)$/i.test(path);
