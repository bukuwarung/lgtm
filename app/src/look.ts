import { useEffect } from 'preact/hooks';
import { useStoredValue } from './platform.ts';
import { BUILTIN_THEMES, themeProps, type AppTheme } from './themes.ts';

// Code colours and font, picked in Settings → Appearance. A theme is a light and a dark palette for the
// highlighter's tokens (style.css --hl-*); the app's own light/dark choice picks which one shows.
type Palette = { kw: string; fn: string; const: string; str: string; builtin: string; com: string; tag: string; ann: string; prop: string; arg: string; it: string };
type CodeTheme = { name: string; light: Palette; dark: Palette };

const p = (kw: string, fn: string, cnst: string, str: string, builtin: string, com: string, tag: string, ann: string, prop: string, arg: string, it: string): Palette =>
  ({ kw, fn, const: cnst, str, builtin, com, tag, ann, prop, arg, it });

export const CODE_THEMES: Record<string, CodeTheme> = {
  intellij: {
    name: 'Classic (Light / Dark)',
    light: p('#0033b3', '#00627a', '#1750eb', '#067d17', '#871094', '#8c8c8c', '#0033b3', '#9e880d', '#871094', '#4a86e8', '#0033b3'),
    dark: p('#cc7832', '#ffc66d', '#6897bb', '#6a8759', '#9876aa', '#808080', '#e8bf6a', '#bbb529', '#9876aa', '#467cda', '#507874'),
  },
  github: {
    name: 'GitHub',
    light: p('#cf222e', '#8250df', '#0550ae', '#0a3069', '#953800', '#6e7781', '#116329', '#8250df', '#0550ae', '#953800', '#cf222e'),
    dark: p('#ff7b72', '#d2a8ff', '#79c0ff', '#a5d6ff', '#ffa657', '#8b949e', '#7ee787', '#d2a8ff', '#79c0ff', '#ffa657', '#ff7b72'),
  },
  vscode: {
    name: 'VS Code (Light+ / Dark+)',
    light: p('#0000ff', '#795e26', '#098658', '#a31515', '#267f99', '#008000', '#800000', '#795e26', '#001080', '#001080', '#0000ff'),
    dark: p('#569cd6', '#dcdcaa', '#b5cea8', '#ce9178', '#4ec9b0', '#6a9955', '#569cd6', '#dcdcaa', '#9cdcfe', '#9cdcfe', '#569cd6'),
  },
  one: {
    name: 'One (Light / Dark)',
    light: p('#a626a4', '#4078f2', '#986801', '#50a14f', '#c18401', '#a0a1a7', '#e45649', '#c18401', '#e45649', '#986801', '#e45649'),
    dark: p('#c678dd', '#61afef', '#d19a66', '#98c379', '#e5c07b', '#7f848e', '#e06c75', '#e5c07b', '#e06c75', '#d19a66', '#e06c75'),
  },
  dracula: {
    name: 'Dracula (Alucard / Dracula)',
    light: p('#a3144d', '#14710a', '#644ac9', '#846e15', '#036a96', '#635d97', '#a3144d', '#a34d14', '#036a96', '#a34d14', '#a34d14'),
    dark: p('#ff79c6', '#50fa7b', '#bd93f9', '#f1fa8c', '#8be9fd', '#6272a4', '#ff79c6', '#ffb86c', '#8be9fd', '#ffb86c', '#ffb86c'),
  },
  solarized: {
    name: 'Solarized',
    light: p('#859900', '#268bd2', '#d33682', '#2aa198', '#b58900', '#93a1a1', '#268bd2', '#cb4b16', '#268bd2', '#6c71c4', '#cb4b16'),
    dark: p('#859900', '#268bd2', '#d33682', '#2aa198', '#b58900', '#586e75', '#268bd2', '#cb4b16', '#268bd2', '#6c71c4', '#cb4b16'),
  },
  gruvbox: {
    name: 'Gruvbox',
    light: p('#9d0006', '#427b58', '#8f3f71', '#79740e', '#b57614', '#928374', '#076678', '#af3a03', '#076678', '#8f3f71', '#af3a03'),
    dark: p('#fb4934', '#8ec07c', '#d3869b', '#b8bb26', '#fabd2f', '#928374', '#83a598', '#fe8019', '#83a598', '#d3869b', '#fe8019'),
  },
  catppuccin: {
    name: 'Catppuccin (Latte / Mocha)',
    light: p('#8839ef', '#1e66f5', '#fe640b', '#40a02b', '#df8e1d', '#7c7f93', '#d20f39', '#df8e1d', '#7287fd', '#e64553', '#d20f39'),
    dark: p('#cba6f7', '#89b4fa', '#fab387', '#a6e3a1', '#f9e2af', '#9399b2', '#f38ba8', '#f9e2af', '#b4befe', '#eba0ac', '#f38ba8'),
  },
  tokyonight: {
    name: 'Tokyo Night (Day / Night)',
    light: p('#9854f1', '#2e7de9', '#b15c00', '#587539', '#188092', '#848cb5', '#f52a65', '#8c6c3e', '#007197', '#b15c00', '#f52a65'),
    dark: p('#bb9af7', '#7aa2f7', '#ff9e64', '#9ece6a', '#2ac3de', '#565f89', '#f7768e', '#e0af68', '#73daca', '#e0af68', '#f7768e'),
  },
  nord: {
    name: 'Nord',
    light: p('#5e81ac', '#3b6e8c', '#b48ead', '#4f7a3a', '#8f6a2a', '#7b88a1', '#5e81ac', '#b48ead', '#3b6e8c', '#a3593f', '#5e81ac'),
    dark: p('#81a1c1', '#88c0d0', '#b48ead', '#a3be8c', '#8fbcbb', '#616e88', '#81a1c1', '#d08770', '#88c0d0', '#d08770', '#81a1c1'),
  },
};

// Free, open-source monospace fonts. Each is bundled (no requests to font services) and loaded only when picked.
export const CODE_FONTS: Record<string, { name: string; family: string; load?: () => Promise<unknown> }> = {
  jetbrains: { name: 'JetBrains Mono', family: '"JetBrains Mono Variable"' }, // loaded up front (main.tsx)
  fira: { name: 'Fira Code', family: '"Fira Code Variable"', load: () => import('@fontsource-variable/fira-code') },
  cascadia: { name: 'Cascadia Code', family: '"Cascadia Code Variable"', load: () => import('@fontsource-variable/cascadia-code') },
  source: { name: 'Source Code Pro', family: '"Source Code Pro Variable"', load: () => import('@fontsource-variable/source-code-pro') },
  plex: { name: 'IBM Plex Mono', family: '"IBM Plex Mono"', load: () => Promise.all([import('@fontsource/ibm-plex-mono/400.css'), import('@fontsource/ibm-plex-mono/600.css')]) },
  geist: { name: 'Geist Mono', family: '"Geist Mono Variable"', load: () => import('@fontsource-variable/geist-mono') },
  victor: { name: 'Victor Mono', family: '"Victor Mono Variable"', load: () => import('@fontsource-variable/victor-mono') },
  commit: { name: 'Commit Mono', family: '"Commit Mono"', load: () => Promise.all([import('@fontsource/commit-mono/400.css'), import('@fontsource/commit-mono/600.css')]) },
  iosevka: { name: 'Iosevka', family: '"Iosevka"', load: () => Promise.all([import('@fontsource/iosevka/400.css'), import('@fontsource/iosevka/600.css')]) },
  monaspace: { name: 'Monaspace Neon', family: '"Monaspace Neon"', load: () => Promise.all([import('@fontsource/monaspace-neon/400.css'), import('@fontsource/monaspace-neon/600.css')]) },
  inconsolata: { name: 'Inconsolata', family: '"Inconsolata Variable"', load: () => import('@fontsource-variable/inconsolata') },
  redhat: { name: 'Red Hat Mono', family: '"Red Hat Mono Variable"', load: () => import('@fontsource-variable/red-hat-mono') },
  roboto: { name: 'Roboto Mono', family: '"Roboto Mono Variable"', load: () => import('@fontsource-variable/roboto-mono') },
  ubuntu: { name: 'Ubuntu Mono', family: '"Ubuntu Mono"', load: () => Promise.all([import('@fontsource/ubuntu-mono/400.css'), import('@fontsource/ubuntu-mono/700.css')]) },
  system: { name: 'System monospace', family: 'ui-monospace, SFMono-Regular, Menlo' },
};

const FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// The text sizes, in px: the app's text and the diff's code (style.css scales every size by --ts / --cs).
export const TEXT_SIZE = 14;
export const CODE_SIZE = 12;

// Every app theme: lgtm's own (the stylesheet's colours, so nothing to set), the built-in ones, and ones added in
// Settings (saved as JSON under myThemes).
export function allThemes(mine: string): Record<string, AppTheme | null> {
  let added: Record<string, AppTheme> = {};
  try {
    added = JSON.parse(mine);
  } catch {}
  return { lgtm: null, ...BUILTIN_THEMES, ...added };
}

// A theme's colours as CSS properties, code colours included (lgtm's own: the stylesheet's, with Classic code colours).
export function themeStyle(app: AppTheme | null): Record<string, string> {
  const props = app ? themeProps(app) : {};
  if (!props['--hl-kw']) {
    const c = CODE_THEMES.intellij;
    for (const k of Object.keys(c.light) as (keyof Palette)[]) props[`--hl-${k}`] = `light-dark(${c.light[k]}, ${c.dark[k]})`;
  }
  return props;
}

let applied: string[] = []; // the colour properties set on the page, to take off when the theme changes
// Applies the saved app theme, code colours and font, and the text sizes, to the page (once, in App), and gives
// Settings the setters. Code colours "theme": the app theme's own (lgtm's own look: Classic).
export function useCodeLook() {
  const [appTheme, setAppTheme] = useStoredValue('appTheme', 'lgtm');
  const [mine, setMine] = useStoredValue('myThemes', '{}');
  const [theme, setTheme] = useStoredValue('codeTheme', 'theme');
  const [font, setFont] = useStoredValue('codeFont', 'jetbrains');
  useEffect(() => {
    const app = allThemes(mine)[appTheme] ?? null;
    const props = app ? themeProps(app) : {};
    if (!app || theme !== 'theme') for (const k of Object.keys(props)) if (k.startsWith('--hl-')) delete props[k];
    const code = theme === 'theme' ? (app ? null : CODE_THEMES.intellij) : (CODE_THEMES[theme] ?? CODE_THEMES.intellij);
    if (code) for (const k of Object.keys(code.light) as (keyof Palette)[]) props[`--hl-${k}`] = `light-dark(${code.light[k]}, ${code.dark[k]})`;
    const style = document.documentElement.style;
    for (const k of applied) if (!(k in props)) style.removeProperty(k);
    for (const [k, v] of Object.entries(props)) style.setProperty(k, v);
    applied = Object.keys(props);
  }, [appTheme, theme, mine]);
  useEffect(() => {
    const f = CODE_FONTS[font] ?? CODE_FONTS.jetbrains;
    void f.load?.();
    document.documentElement.style.setProperty('--mono', `${f.family}, ${FALLBACK}`);
  }, [font]);
  const [textSize, setTextSize] = useStoredValue('textSize', String(TEXT_SIZE));
  const [codeSize, setCodeSize] = useStoredValue('codeSize', String(CODE_SIZE));
  useEffect(() => document.documentElement.style.setProperty('--ts', String(Number(textSize) / TEXT_SIZE)), [textSize]);
  useEffect(() => document.documentElement.style.setProperty('--cs', String(Number(codeSize) / CODE_SIZE)), [codeSize]);
  return { appTheme, setAppTheme, mine, setMine, theme, setTheme, font, setFont, textSize: Number(textSize), setTextSize, codeSize: Number(codeSize), setCodeSize };
}
