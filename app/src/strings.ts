// Android string resources (res/values*/strings*.xml) as their names and readable text, for a nicer diff: escapes
// undone (\' &amp; …), a line break shown as ↵, format arguments (%1$s) marked, and a changed text's changed part.
export const isStringsXml = (path: string) => /(^|\/)res\/values[\w-]*\/[^/]*strings[^/]*\.xml$/.test(path);

// A one-line <string name="…">…</string>, or a plural's / array's <item>.
export type StringLine = { lead: string; name: string; value: string; untranslated: boolean };
export function parseString(text: string): StringLine | null {
  const m = text.match(/^(\s*)<string\s+name="([^"]+)"([^>]*)>(.*)<\/string>\s*$/) ?? text.match(/^(\s*)<item(?:\s+quantity="([^"]+)")?([^>]*)>(.*)<\/item>\s*$/);
  return m ? { lead: m[1], name: m[2] ?? '', value: readable(m[4]), untranslated: /translatable="false"/.test(m[3]) } : null;
}

// What the text reads as in the app.
export function readable(raw: string): string {
  let v = raw.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim();
  if (/^"[\s\S]*"$/.test(v)) v = v.slice(1, -1);
  return v
    .replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([\da-f]+));/gi, (e, n, d, h) => (d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[n.toLowerCase()] ?? e))
    .replace(/\\(n|t|u[\da-fA-F]{4}|.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c[0] === 'u' && c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : c));
}

// Where two texts differ: from the first differing character to the last, in each.
export function changedRange(a: string, b: string): [[number, number], [number, number]] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return [[p, a.length - q], [p, b.length - q]];
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt' }[c]};`);
const show = (s: string) => esc(s).replace(/%(\d+\$)?[-#+ 0,(]*\d*(\.\d+)?[sdfxXoeEgGc%]/g, '<span class="sx-arg">$&</span>').replace(/\n/g, '<span class="sx-nl">↵</span>');
// The row: its name, then its text (`changed`: the part to mark, in the readable text).
export function stringHtml(s: StringLine, changed?: [number, number], notes: string[] = []): string {
  const v = s.value;
  const text = changed && changed[1] > changed[0] ? `${show(v.slice(0, changed[0]))}<mark class="sx-ch">${show(v.slice(...changed))}</mark>${show(v.slice(changed[1]))}` : show(v);
  // Name and text side by side, so a long text wraps in its own column; the indentation as a margin.
  return `<span class="sx" style="padding-left:${s.lead.replace(/\t/g, '    ').length}ch"><span class="sx-key">${esc(s.name)}</span><span class="sx-val">${text || '<span class="sx-empty">empty</span>'}${s.untranslated ? '<span class="sx-tag">not translated</span>' : ''}${notes.map((n) => `<span class="sx-warn">${esc(n)}</span>`).join('')}</span></span>`;
}

// --- Translations: a changed string against the same file in the other languages (values/, values-in/, …) ---

// A language folder (values, values-in, values-zh-rCN, values-b+sr+Latn), not another qualifier (night, v21, sw600dp).
export const isLocaleDir = (dir: string) => /^values(-[a-z]{2,3}(-r[A-Z]{2})?|-b\+[\w+]+)?$/.test(dir);
export const placeholders = (v: string) => (v.match(/%(\d+\$)?[-#+ 0,(]*\d*(\.\d+)?[sdfxXoeEgGc]/g) ?? []).sort().join(' ');
// A file's strings, one line or several: name → readable text; ones not to translate left out.
export function stringsOf(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<string\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/string>/g)) if (!/translatable="false"/.test(m[2])) out.set(m[1], readable(m[3]));
  return out;
}
// What a diff changes: each added string's name → its new text, and whether it was there before (edited, not new).
export function changedStrings(lines: { kind: string; text: string }[]): Map<string, { value: string; edited: boolean }> {
  const removed = new Set(lines.filter((l) => l.kind === '-').map((l) => parseString(l.text)?.name).filter(Boolean));
  const out = new Map<string, { value: string; edited: boolean }>();
  for (const l of lines) {
    const s = l.kind === '+' && parseString(l.text);
    if (s && s.name && !s.untranslated) out.set(s.name, { value: s.value, edited: removed.has(s.name) });
  }
  return out;
}
// Per changed string, what's off in the other languages: missing there, different placeholders, or (edited here)
// not updated there too.
export type Locale = { dir: string; strings: Map<string, string>; changed: Set<string> };
export function translationNotes(changed: Map<string, { value: string; edited: boolean }>, others: Locale[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [name, { value, edited }] of changed) {
    const notes = others.flatMap((o) => {
      const there = o.strings.get(name);
      if (there == null) return [`missing in ${o.dir}`];
      if (placeholders(there) !== placeholders(value)) return [`placeholders differ in ${o.dir}`];
      return edited && !o.changed.has(name) ? [`${o.dir} not updated`] : [];
    });
    if (notes.length) out.set(name, notes);
  }
  return out;
}
