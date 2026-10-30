import { ZED_BUILTIN } from './zedthemes.ts';

// Whole-app colour themes (Settings → Appearance): each a palette for lgtm's colour tokens (style.css :root) in a light
// and a dark version, code colours included; the light/dark switch picks one. lgtm's own look is the stylesheet's.
// Others come as Zed theme files: built in (One, Ayu, Gruvbox) or added from Zed's gallery or a file.
type Tokens = Record<string, string>; // --token → colour
// `variants`: a theme file's versions (Catppuccin's Latte, Frappé, Macchiato, Mocha…), for picking the light and dark one.
export type Variant = { name: string; appearance: 'light' | 'dark'; tokens: Tokens };
export type AppTheme = { name: string; light: Tokens; dark: Tokens; credit?: string; source?: string; variants?: Variant[]; pick?: { light: string; dark: string } };

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
    '--rb0': s.accents?.[0] ?? s.players?.[0]?.cursor,
    '--rb1': s.accents?.[1] ?? s.players?.[1]?.cursor,
    '--rb2': s.accents?.[2] ?? s.players?.[2]?.cursor,
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

// A Zed theme file as written: JSON, though some carry comments or trailing commas (Zed reads them leniently).
export function parseThemeFile(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? '').replace(/,(\s*[}\]])/g, '$1'));
  }
}

// A VS Code colour theme file (its UI `colors` and syntax `tokenColors`) as lgtm's tokens. It has one look, for both
// light and dark. One that only `include`s another file has too little in it to use.
export function fromVSCode(file: any, source: string): AppTheme {
  const c = file.colors ?? {};
  const rules: { scopes: string[]; fg?: string }[] = (file.tokenColors ?? []).map((r: any) => ({
    scopes: (Array.isArray(r.scope) ? r.scope : String(r.scope ?? '').split(',')).map((x: string) => x.trim()),
    fg: r.settings?.foreground,
  }));
  // The colour of the first scope, in order of preference, that a rule names exactly, else one it starts.
  const tok = (...want: string[]) =>
    want.map((w) => rules.find((r) => r.fg && r.scopes.includes(w))?.fg).find(Boolean) ??
    want.map((w) => rules.find((r) => r.fg && r.scopes.some((s) => s.startsWith(w + '.') || s.startsWith(w + ' ')))?.fg).find(Boolean);
  if (!c['editor.background'] && !rules.length) throw new Error("it has no colours of its own (it may only include another file)");
  const added = c['gitDecoration.addedResourceForeground'] ?? c['terminal.ansiGreen'];
  const deleted = c['gitDecoration.deletedResourceForeground'] ?? c['terminal.ansiRed'];
  const warning = c['editorWarning.foreground'] ?? c['terminal.ansiYellow'];
  const s = {
    'editor.background': c['editor.background'],
    'editor.foreground': c['editor.foreground'],
    'surface.background': c['sideBar.background'] ?? c['panel.background'] ?? c['editorWidget.background'],
    border: c['panel.border'] ?? c['editorGroup.border'] ?? c['sideBar.border'] ?? c['contrastBorder'] ?? c['input.border'],
    text: c['foreground'] ?? c['editor.foreground'],
    'text.muted': c['descriptionForeground'] ?? c['editorLineNumber.foreground'],
    'text.accent': c['textLink.foreground'] ?? c['focusBorder'] ?? c['button.background'],
    created: added,
    deleted,
    modified: c['gitDecoration.modifiedResourceForeground'] ?? c['terminal.ansiBlue'],
    warning,
    'search.match_background': c['editor.findMatchHighlightBackground'],
    'search.active_match_background': c['editor.findMatchBackground'],
    accents: [1, 2, 3].map((n) => c[`editorBracketHighlight.foreground${n}`]).filter(Boolean),
    syntax: Object.fromEntries(
      Object.entries({
        keyword: tok('keyword', 'keyword.control', 'storage.type', 'storage'),
        function: tok('entity.name.function', 'support.function', 'meta.function-call'),
        number: tok('constant.numeric', 'constant'),
        string: tok('string'),
        type: tok('entity.name.type', 'support.type', 'entity.name.class', 'support.class', 'storage.type'),
        comment: tok('comment'),
        tag: tok('entity.name.tag'),
        attribute: tok('meta.annotation', 'storage.type.annotation', 'meta.decorator', 'entity.name.function.decorator'),
        property: tok('variable.other.property', 'variable.other.object.property', 'support.variable.property', 'variable.other.member'),
        'variable.parameter': tok('variable.parameter'),
        'variable.special': tok('variable.language'),
      }).filter(([, v]) => v).map(([k, v]) => [k, { color: v }]),
    ),
  };
  const tokens = fromZed(s);
  const name = file.name ?? 'VS Code theme';
  const appearance = /light/i.test(file.type ?? '') ? 'light' : 'dark';
  return { name, light: tokens, dark: tokens, credit: file.author, source, variants: [{ name, appearance, tokens }], pick: { light: name, dark: name } };
}

// A theme file added in Settings: every version kept, so its light and dark one can be picked.
export function fromZedFile(file: any, source: string): AppTheme {
  const t = fromZedFamily(file);
  const variants: Variant[] = (file.themes ?? []).filter((v: any) => v?.style).map((v: any) => ({ name: v.name, appearance: v.appearance === 'light' ? 'light' : 'dark', tokens: fromZed(v.style) }));
  const first = (a: string) => variants.find((v) => v.appearance === a)?.name ?? variants[0]?.name;
  return { ...t, source, variants, pick: { light: first('light'), dark: first('dark') } };
}
// The same theme with another version picked for light or dark.
export function pickVariant(t: AppTheme, mode: 'light' | 'dark', name: string): AppTheme {
  const v = t.variants?.find((x) => x.name === name);
  return v ? { ...t, [mode]: v.tokens, pick: { ...t.pick!, [mode]: name } } : t;
}

export const BUILTIN_THEMES: Record<string, AppTheme> = Object.fromEntries(Object.entries(ZED_BUILTIN).map(([k, f]) => [k, fromZedFamily(f)]));

// The CSS custom properties for a theme: each token as light-dark(light, dark).
export function themeProps(t: AppTheme): Record<string, string> {
  const keys = new Set([...Object.keys(t.light), ...Object.keys(t.dark)]);
  return Object.fromEntries([...keys].map((k) => [k, `light-dark(${t.light[k] ?? t.dark[k]}, ${t.dark[k] ?? t.light[k]})`]));
}
