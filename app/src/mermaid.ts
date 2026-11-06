import type { Mermaid } from 'mermaid';

// Turns mermaid sources under `root` into diagrams: our placeholders (.mermaid-svg[data-code], from markdown.ts) and
// GitHub's rendering of ```mermaid in comment HTML (a <pre lang="mermaid"> inside a section that needs GitHub's own
// JS to draw). The library (large) is loaded only when a page has a diagram. strict mode: labels can't carry HTML or
// click handlers, since the source comes from the PR.
let lib: Promise<Mermaid> | undefined;
let seq = 0;

// The page's colours for the diagrams (mermaid's "base" theme): lgtm's, or the theme's, resolved to hex as the
// mermaid library reads them.
function colours() {
  const probe = document.body.appendChild(document.createElement('i'));
  const ctx = document.createElement('canvas').getContext('2d')!;
  const c = (v: string) => {
    probe.style.color = `var(${v})`;
    ctx.fillStyle = '#000';
    ctx.fillStyle = getComputedStyle(probe).color;
    return ctx.fillStyle as string;
  };
  const v = { bg: c('--bg'), soft: c('--soft'), fg: c('--fg'), border: c('--border'), muted: c('--muted'), accent: c('--accent') };
  probe.remove();
  return {
    darkMode: isDark(), background: v.bg, mainBkg: v.soft, primaryColor: v.soft, secondaryColor: v.soft, tertiaryColor: v.bg,
    primaryTextColor: v.fg, secondaryTextColor: v.fg, tertiaryTextColor: v.fg, textColor: v.fg, titleColor: v.fg,
    primaryBorderColor: v.border, secondaryBorderColor: v.border, tertiaryBorderColor: v.border, nodeBorder: v.border,
    lineColor: v.muted, clusterBkg: v.bg, clusterBorder: v.border, edgeLabelBackground: v.bg, noteBkgColor: v.soft, noteTextColor: v.fg,
    actorBkg: v.soft, actorBorder: v.border, actorTextColor: v.fg, signalColor: v.fg, signalTextColor: v.fg, labelBoxBkgColor: v.soft,
    fontFamily: getComputedStyle(document.body).fontFamily,
  };
}

// Light/dark or the app's theme changed: every diagram drawn again in the new colours.
let redraw = 0;
const again = () => {
  clearTimeout(redraw);
  redraw = window.setTimeout(() => {
    const drawn = document.querySelectorAll<HTMLElement>('.mermaid-svg[data-done]');
    if (!drawn.length) return;
    for (const el of drawn) delete el.dataset.done;
    void renderMermaid(document);
  }, 150);
};
new MutationObserver(again).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', again);

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
  lib ??= import('mermaid').then(({ default: m }) => m);
  const m = await lib;
  m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: colours(), suppressErrorRendering: true });
  for (const el of todo) {
    el.classList.remove('mermaid-error');
    try {
      el.innerHTML = (await m.render(`mermaid-${++seq}`, el.dataset.code!)).svg;
      // Its own size, scaled with Settings → Text size (mermaid draws at a fixed 16px), never wider than the page.
      const svg = el.querySelector('svg');
      const w = svg?.viewBox.baseVal?.width;
      if (svg && w) svg.style.width = `calc(${w}px * var(--ts))`;
      svg?.style.setProperty('max-width', '100%');
    } catch (e) {
      el.classList.add('mermaid-error');
      el.textContent = `Couldn't draw this diagram: ${(e as Error).message}`;
    }
  }
}
