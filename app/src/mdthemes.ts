// Styles for rendered markdown files: lgtm's own (follows the app's colours) and the free themes of markdown.style
// (https://markdown.style/themes, Apache 2.0), whose CSS is in mdthemes.css. Fonts are bundled and load only for the
// style in use (as the code fonts do). Settings → Markdown files picks a theme and overrides any of its values.
import { useEffect, useState } from 'preact/hooks';
import { useStoredValue } from './platform.ts';
import './mdthemes.css';

export type MdTheme = { id: string; name: string; group: string; dark: boolean; fonts: string[] };
export const MD_THEMES: MdTheme[] = [
  { id: 'lgtm', name: 'lgtm', group: 'Follows the app', dark: false, fonts: [] },
  { id: 'atlas', name: 'Atlas', group: 'Reports', dark: false, fonts: ["Public Sans"] },
  { id: 'meridian', name: 'Meridian', group: 'Reports', dark: false, fonts: ["Manrope"] },
  { id: 'signal', name: 'Signal', group: 'Reports', dark: false, fonts: ["DM Sans"] },
  { id: 'handbook', name: 'Handbook', group: 'Docs and code', dark: false, fonts: ["IBM Plex Sans", "IBM Plex Mono"] },
  { id: 'mono', name: 'Mono', group: 'Docs and code', dark: false, fonts: ["IBM Plex Mono"] },
  { id: 'repo', name: 'Repo', group: 'Docs and code', dark: false, fonts: ["JetBrains Mono"] },
  { id: 'folio', name: 'Folio', group: 'Papers and books', dark: false, fonts: ["Fraunces", "Libre Baskerville"] },
  { id: 'journal', name: 'Journal', group: 'Papers and books', dark: false, fonts: ["Crimson Pro"] },
  { id: 'paper', name: 'Paper', group: 'Papers and books', dark: false, fonts: ["Lora", "Source Serif 4"] },
  { id: 'scholar', name: 'Scholar', group: 'Papers and books', dark: false, fonts: ["EB Garamond"] },
  { id: 'linen', name: 'Linen', group: 'Quiet', dark: false, fonts: ["Karla"] },
  { id: 'minimal', name: 'Minimal', group: 'Quiet', dark: false, fonts: ["Inter"] },
  { id: 'slate', name: 'Slate', group: 'Quiet', dark: false, fonts: ["Inter"] },
  { id: 'editorial', name: 'Editorial', group: 'Bold', dark: false, fonts: ["Playfair Display", "Source Sans 3"] },
  { id: 'pop', name: 'Pop', group: 'Bold', dark: false, fonts: ["Space Grotesk", "Work Sans"] },
  { id: 'swiss', name: 'Swiss', group: 'Bold', dark: false, fonts: ["Archivo"] },
  { id: 'carbon', name: 'Carbon', group: 'Dark', dark: true, fonts: ["Inter", "JetBrains Mono"] },
  { id: 'ember', name: 'Ember', group: 'Dark', dark: true, fonts: ["Figtree"] },
  { id: 'nocturne', name: 'Nocturne', group: 'Dark', dark: true, fonts: ["Newsreader"] },
  { id: 'terminal', name: 'Terminal', group: 'Dark', dark: true, fonts: ["JetBrains Mono"] },
];

// Each bundled family: the name it's registered under, and how to load it.
export const MD_FONTS: Record<string, { family: string; load: () => Promise<unknown> }> = {
  'Archivo': { family: '"Archivo Variable"', load: () => import('@fontsource-variable/archivo') },
  'Crimson Pro': { family: '"Crimson Pro Variable"', load: () => import('@fontsource-variable/crimson-pro') },
  'DM Sans': { family: '"DM Sans Variable"', load: () => import('@fontsource-variable/dm-sans') },
  'EB Garamond': { family: '"EB Garamond Variable"', load: () => import('@fontsource-variable/eb-garamond') },
  'Figtree': { family: '"Figtree Variable"', load: () => import('@fontsource-variable/figtree') },
  'Fraunces': { family: '"Fraunces Variable"', load: () => import('@fontsource-variable/fraunces') },
  'IBM Plex Mono': { family: '"IBM Plex Mono"', load: () => import('@fontsource/ibm-plex-mono/400.css') },
  'IBM Plex Sans': { family: '"IBM Plex Sans Variable"', load: () => import('@fontsource-variable/ibm-plex-sans') },
  'Inter': { family: '"Inter Variable"', load: () => import('@fontsource-variable/inter') },
  'JetBrains Mono': { family: '"JetBrains Mono Variable"', load: () => import('@fontsource-variable/jetbrains-mono') },
  'Karla': { family: '"Karla Variable"', load: () => import('@fontsource-variable/karla') },
  'Libre Baskerville': { family: '"Libre Baskerville"', load: () => import('@fontsource/libre-baskerville') },
  'Lora': { family: '"Lora Variable"', load: () => import('@fontsource-variable/lora') },
  'Manrope': { family: '"Manrope Variable"', load: () => import('@fontsource-variable/manrope') },
  'Newsreader': { family: '"Newsreader Variable"', load: () => import('@fontsource-variable/newsreader') },
  'Playfair Display': { family: '"Playfair Display Variable"', load: () => import('@fontsource-variable/playfair-display') },
  'Public Sans': { family: '"Public Sans Variable"', load: () => import('@fontsource-variable/public-sans') },
  'Source Sans 3': { family: '"Source Sans 3 Variable"', load: () => import('@fontsource-variable/source-sans-3') },
  'Source Serif 4': { family: '"Source Serif 4 Variable"', load: () => import('@fontsource-variable/source-serif-4') },
  'Space Grotesk': { family: '"Space Grotesk Variable"', load: () => import('@fontsource-variable/space-grotesk') },
  'Work Sans': { family: '"Work Sans Variable"', load: () => import('@fontsource-variable/work-sans') },
};

// Your style: a theme, and any of its values overridden (unset = the theme's).
export type MdStyle = {
  theme: string;
  size?: number; // px
  leading?: number; // line height
  measure?: number; // rem; 0 = the full width
  space?: number; // rem between blocks
  radius?: number; // px
  body?: string; // a font: a key of MD_FONTS, or sans / serif / mono
  heading?: string;
  colors?: Partial<Record<MdColor, string>>;
};
export const MD_COLORS = [
  ['bg', 'Page', '--doc-bg'],
  ['fg', 'Text', '--doc-fg'],
  ['heading', 'Headings', '--doc-heading'],
  ['link', 'Links', '--doc-link'],
  ['accent', 'Accent (quotes, rules)', '--doc-accent'],
  ['border', 'Borders', '--doc-border'],
  ['code', 'Code background', '--doc-code-bg'],
] as const;
export type MdColor = (typeof MD_COLORS)[number][0];
export const GENERIC_FONTS: Record<string, string> = {
  sans: 'var(--sans)',
  serif: "Charter, 'Iowan Old Style', Georgia, serif",
  mono: 'var(--mono)',
};
const fontStack = (f: string) => GENERIC_FONTS[f] ?? (MD_FONTS[f] ? `${MD_FONTS[f].family}, var(--sans)` : '');

export function readMdStyle(raw: string): MdStyle {
  try {
    const s = JSON.parse(raw);
    if (s && MD_THEMES.some((t) => t.id === s.theme)) return s;
  } catch {}
  return { theme: 'lgtm' };
}

// The class and inline custom properties for a rendered file in this style, and its fonts loaded.
export function mdStyleProps(s: MdStyle): { class: string; style: Record<string, string> } {
  const style: Record<string, string> = {};
  if (s.size) style['--doc-size'] = `${s.size}px`;
  if (s.leading) style['--doc-leading'] = String(s.leading);
  if (s.measure != null) style['--doc-measure'] = s.measure ? `${s.measure}rem` : 'none';
  if (s.space != null) style['--doc-space'] = `${s.space}rem`;
  if (s.radius != null) style['--doc-radius'] = `${s.radius}px`;
  if (s.body && fontStack(s.body)) style['--doc-font-body'] = fontStack(s.body);
  if (s.heading && fontStack(s.heading)) style['--doc-font-heading'] = fontStack(s.heading);
  for (const [k, , v] of MD_COLORS) if (s.colors?.[k]) style[v] = s.colors[k]!;
  if (s.colors?.code) style['--doc-th-bg'] = s.colors.code;
  return { class: `mdt mdt-${s.theme}`, style };
}
export function loadMdFonts(s: MdStyle) {
  const fams = [...(MD_THEMES.find((t) => t.id === s.theme)?.fonts ?? []), s.body ?? '', s.heading ?? ''];
  for (const f of fams) void MD_FONTS[f]?.load();
}

// Whether the app is dark now: its theme setting (Settings → Appearance), or the system's when that's Auto.
export function useAppDark() {
  const [theme] = useStoredValue('theme', '');
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const [sys, setSys] = useState(mq.matches);
  useEffect(() => {
    const f = () => setSys(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return theme ? theme === 'dark' : sys;
}

// A style for light mode and one for dark (unset: the light one). Without `mode`, the one for the app's mode now.
// Returns the style, its setter (null: dark goes back to the light one), and whether dark is the light one.
export function useMdStyle(mode?: 'light' | 'dark') {
  const dark = useAppDark();
  const [light, setLight] = useStoredValue('mdStyle', '{"theme":"lgtm"}');
  const [darkRaw, setDark] = useStoredValue('mdStyleDark', '');
  const m = mode ?? (dark ? 'dark' : 'light');
  const same = m === 'dark' && !darkRaw;
  const raw = m === 'dark' && darkRaw ? darkRaw : light;
  const s = readMdStyle(raw);
  useEffect(() => loadMdFonts(s), [raw]);
  const save = (next: MdStyle | null) => (m === 'dark' ? setDark(next ? JSON.stringify(next) : '') : setLight(JSON.stringify(next ?? { theme: 'lgtm' })));
  return [s, save, same] as const;
}
