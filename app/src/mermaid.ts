import type { Mermaid } from 'mermaid';

// Turns mermaid sources under `root` into diagrams: our placeholders (.mermaid-svg[data-code], from markdown.ts) and
// GitHub's rendering of ```mermaid in comment HTML (a <pre lang="mermaid"> inside a section that needs GitHub's own
// JS to draw). The library (large) is loaded only when a page has a diagram. strict mode: labels can't carry HTML or
// click handlers, since the source comes from the PR.
let lib: Promise<Mermaid> | undefined;
let seq = 0;

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

export async function renderMermaid(root: ParentNode | null) {
  if (!root) return;
  for (const pre of root.querySelectorAll<HTMLElement>('pre[lang="mermaid"]')) {
    const box = document.createElement('div');
    box.className = 'mermaid-svg';
    box.dataset.code = pre.textContent ?? '';
    (pre.closest('section[data-type="mermaid"]') ?? pre).replaceWith(box);
  }
  const todo = [...root.querySelectorAll<HTMLElement>('.mermaid-svg[data-code]:not([data-done])')];
  if (!todo.length) return;
  for (const el of todo) el.dataset.done = '1'; // before awaiting, so overlapping calls don't render twice
  lib ??= import('mermaid').then(({ default: m }) => {
    m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default', suppressErrorRendering: true });
    return m;
  });
  const m = await lib;
  for (const el of todo) {
    try {
      el.innerHTML = (await m.render(`mermaid-${++seq}`, el.dataset.code!)).svg;
    } catch (e) {
      el.classList.add('mermaid-error');
      el.textContent = `Couldn't draw this diagram: ${(e as Error).message}`;
    }
  }
}
