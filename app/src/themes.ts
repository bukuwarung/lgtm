import { ZED_BUILTIN } from './zedthemes.ts';

// Whole-app colour themes (Settings → Appearance): each a palette for lgtm's colour tokens (style.css :root) in a light
// and a dark version, code colours included; the light/dark switch picks one. lgtm's own look is the stylesheet's.
// Others come as Zed theme files: built in (One, Ayu, Gruvbox) or added from Zed's gallery or a file.
type Tokens = Record<string, string>; // --token → colour
export type AppTheme = { name: string; light: Tokens; dark: Tokens; credit?: string };

const opaque = (c?: string) => (c && /^#[0-9a-f]{8}$/i.test(c) && c.endsWith('ff') ? c.slice(0, 7) : c);

// One Zed theme variant's colours as lgtm's tokens. Tints (diff lines, word highlights) are mixed from its added /
// removed colours over its background, so every theme reads alike.
export function fromZed(s: any): Tokens {
  const syn = (...keys: string[]) => keys.map((k) => s.syntax?.[k]?.color).find(Boolean);
  const bg = opaque(s['editor.background'] ?? s.background);
  const tint = (c: string | undefined, pct: number) => c && bg && `color-mix(in srgb, ${opaque(c)} ${pct}%, ${bg})`;
  const accent = s['text.accent'];
  const t: Record<string, string | undefined> = {
    '--bg': bg,
    '--soft': s['surface.background'] ?? s['panel.background'],
    '--border': s.border,
    '--fg': s.text,
    '--code-fg': s['editor.foreground'] ?? s.text,
    '--muted': s['text.muted'],
    '--accent': accent,
    '--addfg': s.created,
    '--delfg': s.deleted,
    '--modfg': s.modified,
    '--warnfg': s.warning,
    '--add': tint(s.created, 16),
    '--del': tint(s.deleted, 16),
    '--warn': tint(s.warning, 18),
    '--wd-add': tint(s.created, 38),
    '--wd-del': tint(s.deleted, 38),
    '--primary': s.created,
    '--on-primary': bg,
    '--find': s['search.match_background'] ?? tint(s.warning, 35),
    '--find-current': s['search.active_match_background'] ?? tint(s.warning, 60),
    '--checker': tint(s.text, 12),
    '--test': syn('type'),
    '--pill-ok': s.created,
    '--pill-bad': s.deleted,
    '--pill-warn': s.warning,
    '--pill-info': accent,
    '--g-commented': s['text.muted'],
    '--rb0': s.players?.[0]?.cursor,
    '--rb1': s.players?.[1]?.cursor,
    '--rb2': s.players?.[2]?.cursor,
    '--hl-kw': syn('keyword'),
    '--hl-fn': syn('function'),
    '--hl-const': syn('number', 'constant'),
    '--hl-str': syn('string'),
    '--hl-builtin': syn('type'),
    '--hl-com': syn('comment'),
    '--hl-tag': syn('tag', 'keyword'),
    '--hl-ann': syn('attribute', 'function'),
    '--hl-prop': syn('property', 'variable'),
    '--hl-arg': syn('variable.parameter', 'variable.special', 'number'),
    '--hl-it': syn('variable.special', 'keyword'),
  };
  return Object.fromEntries(Object.entries(t).filter((e): e is [string, string] => !!e[1]).map(([k, v]) => [k, opaque(v)!]));
}

// A Zed theme file (a family: "Ayu" with Ayu Dark, Ayu Light, Ayu Mirage…) as one lgtm theme: its first dark and first
// light variant; with only one, that one for both.
export function fromZedFamily(file: any): AppTheme {
  const themes: any[] = file.themes ?? [];
  const dark = themes.find((t) => t.appearance === 'dark') ?? themes[0];
  const light = themes.find((t) => t.appearance === 'light') ?? dark;
  if (!dark?.style) throw new Error("That isn't a Zed theme file");
  return { name: file.name ?? dark.name, light: fromZed(light.style), dark: fromZed(dark.style), credit: file.author };
}

export const BUILTIN_THEMES: Record<string, AppTheme> = Object.fromEntries(Object.entries(ZED_BUILTIN).map(([k, f]) => [k, fromZedFamily(f)]));

// The CSS custom properties for a theme: each token as light-dark(light, dark).
export function themeProps(t: AppTheme): Record<string, string> {
  const keys = new Set([...Object.keys(t.light), ...Object.keys(t.dark)]);
  return Object.fromEntries([...keys].map((k) => [k, `light-dark(${t.light[k] ?? t.dark[k]}, ${t.dark[k] ?? t.light[k]})`]));
}
