// Added lines that put user-facing text straight in code (a layout's android:text="…", Compose's Text("…"), a toast,
// a dialog's buttons…) instead of strings.xml: text there is never translated. Tests, debug-only code and previews are
// left out, as are texts that aren't words (ids, URLs, a lone placeholder) and tools: attributes.
import { parsePatch } from './diff.ts';
import { inTests } from './files.ts';

export type Hardcoded = { path: string; line: number; text: string };

const LAYOUT_ATTR = /\b(?:android|app):(?:text|hint|contentDescription|title|subtitle|label|placeholderText|helperText|prefixText|suffixText)\s*=\s*"([^"@?][^"]*)"/;
// Kotlin and Java UI calls taking a literal: Compose, Views, toasts, snackbars, dialogs.
const CODE_CALLS = [
  /\bText\(\s*(?:text\s*=\s*)?"((?:[^"\\]|\\.)*)"/,
  /\b(?:contentDescription|placeholderText|label|title|subtitle|hint)\s*=\s*"((?:[^"\\]|\\.)*)"/,
  /\.(?:text|hint)\s*=\s*"((?:[^"\\]|\\.)*)"/,
  /\.set(?:Text|Hint|Title|Subtitle|Message|ContentDescription|PositiveButton|NegativeButton|NeutralButton)\(\s*"((?:[^"\\]|\\.)*)"/,
  /\b(?:Toast\.makeText|Snackbar\.make)\([^,]+,\s*"((?:[^"\\]|\\.)*)"/,
];
const UI_CODE = /\.(kt|java)$/;
const UI_XML = /\/res\/(layout|menu|navigation)[\w-]*\/[^/]+\.xml$/;

// Words a person reads: with ${…}, $name and %s taken out, still two letters; not an id (snake_case, dotted), not a URL.
function isWords(text: string): boolean {
  const t = text.replace(/\$\{[^}]*\}|\$\w+|%(\d+\$)?[-#+ 0,(]*\d*(\.\d+)?[a-zA-Z]/g, '').trim();
  if ((t.match(/\p{L}/gu) ?? []).length < 2) return false;
  return !/^[\w.-]*[_.][\w.-]*$/.test(t) && !/^[a-z]+:\/\//i.test(t) && !/^#?[0-9a-f]{3,8}$/i.test(t);
}

export function findHardcoded(files: { filename: string; patch?: string }[]): Hardcoded[] {
  const out: Hardcoded[] = [];
  for (const f of files) {
    const p = f.filename;
    const xml = UI_XML.test(p), code = UI_CODE.test(p);
    if (!f.patch || !(xml || code) || inTests(p) || /\/src\/debug\//.test(p) || /Preview|Sample|Fake|Mock/.test(p.split('/').pop()!)) continue;
    for (const h of parsePatch(f.patch)) {
      // Inside preview code, as far as the hunk shows: a top-level declaration marked @Preview, or named like one
      // (PREVIEW_STATE, sampleItems, FakeRepo), up to the next top-level declaration.
      let marked = false, preview = false;
      for (const l of h.lines) {
        if (/@Preview\b/.test(l.text)) marked = true;
        const decl = l.text.match(/^(?:(?:private|internal|public)\s+)?(?:fun|val|var|object|class)\s+(?:[\w.<>]+\.)?(\w+)/);
        if (decl) (preview = marked || /preview|sample|fake|mock|dummy|stub/i.test(decl[1])), (marked = false);
        if (l.kind !== '+' || l.new == null || preview || /^\s*(\/\/|\*|<!--)/.test(l.text)) continue;
        const m = xml ? l.text.match(LAYOUT_ATTR) : CODE_CALLS.map((re) => l.text.match(re)).find(Boolean);
        if (m && isWords(m[1])) out.push({ path: p, line: l.new, text: m[1] });
      }
    }
  }
  return out;
}
