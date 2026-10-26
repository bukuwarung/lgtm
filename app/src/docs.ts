import type { Hunk } from './diff.ts';

// Documentation comments (KDoc, Javadoc, JSDoc/TSDoc) in a diff, to show rendered like IntelliJ's reader mode. Only
// blocks whose lines are all added, all removed or all unchanged qualify: a doc comment edited line by line stays
// source, so the edit itself is visible. `end` is inclusive.
export type DocBlock = { hunk: number; start: number; end: number; kind: '+' | '-' | ' '; text: string; indent: number };

export const docSyntax = (path: string) => (/\.java$/.test(path) ? 'java' : /\.(kt|kts)$/.test(path) ? 'kdoc' : /\.[cm]?[jt]sx?$/.test(path) ? 'jsdoc' : null);

export function docBlocks(hunks: Hunk[]): DocBlock[] {
  const out: DocBlock[] = [];
  hunks.forEach((h, hi) => {
    for (let i = 0; i < h.lines.length; i++) {
      const open = h.lines[i].text.match(/^(\s*)\/\*\*(?!\/)/);
      if (!open) continue;
      let end = i;
      while (end < h.lines.length && !h.lines[end].text.includes('*/', end === i ? open[0].length : 0)) end++;
      if (end === h.lines.length) break; // runs past the hunk: leave it as source
      const run = h.lines.slice(i, end + 1);
      if (run.every((l) => l.kind === run[0].kind)) out.push({ hunk: hi, start: i, end, kind: run[0].kind, text: run.map((l) => l.text).join('\n'), indent: open[1].length });
      i = end;
    }
  });
  return out;
}

// The comment's content without /**, */ and the leading * of each line.
const strip = (text: string) =>
  text
    .replace(/^\s*\/\*\*/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim();

// Javadoc's HTML and inline tags → markdown (our markdown renderer escapes any HTML left over).
const javadoc = (s: string) =>
  s
    .replace(/\{@(?:code|literal)\s+([^}]*)\}/g, '`$1`')
    .replace(/\{@(?:link|linkplain)\s+([^}\s]+)(?:\s+([^}]*))?\}/g, (_, ref, label) => '`' + (label || ref.replace(/^#/, '')) + '`')
    .replace(/<\/?(?:code|tt)>/gi, '`')
    .replace(/<\/?(?:b|strong)>/gi, '**')
    .replace(/<\/?(?:i|em)>/gi, '_')
    .replace(/<li>/gi, '\n- ')
    .replace(/<\/?(?:ul|ol|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '  \n')
    .replace(/<\/?p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

const TAGS: Record<string, string> = {
  param: 'Params', property: 'Properties', return: 'Returns', returns: 'Returns', throws: 'Throws', exception: 'Throws',
  receiver: 'Receiver', constructor: 'Constructor', see: 'See also', sample: 'Samples', since: 'Since', author: 'Author',
  deprecated: 'Deprecated', type: 'Type', template: 'Type params',
};

// Markdown for the description, then the block tags grouped by label: [label, [name, description][]].
export function parseDoc(text: string, syntax: 'kdoc' | 'java' | 'jsdoc'): { body: string; tags: [string, [string, string][]][] } {
  let s = strip(text);
  if (syntax === 'java') s = javadoc(s);
  // KDoc/JSDoc links [Foo] / {@link Foo} read as code names.
  s = s.replace(/\{@link\s+([^}\s|]+)[^}]*\}/g, '`$1`').replace(/(?<![\]`])\[([\w.#]+)\](?![(\[:])/g, '`$1`');
  const parts = s.split(/^(?=@\w+)/m);
  const body = parts[0].trim();
  const tags = new Map<string, [string, string][]>();
  for (const part of parts.slice(1)) {
    const m = part.match(/^@(\w+)\s*([\s\S]*)$/);
    if (!m || m[1] === 'suppress') continue;
    const label = TAGS[m[1]] ?? m[1];
    let rest = m[2].trim().replace(/^\{[^}]*\}\s*/, ''); // JSDoc {Type}
    let name = '';
    if (['param', 'property', 'throws', 'exception', 'template'].includes(m[1])) [name, rest] = [rest.split(/\s+/)[0], rest.split(/\s+/).slice(1).join(' ')];
    tags.set(label, [...(tags.get(label) ?? []), [name, rest.replace(/\s+/g, ' ')]]);
  }
  return { body, tags: [...tags] };
}
