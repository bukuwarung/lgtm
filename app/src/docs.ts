import type { Hunk } from './diff.ts';

// Documentation comments (KDoc, Javadoc, JSDoc/TSDoc) in a diff, to show rendered like IntelliJ's reader mode: blocks
// whose lines are all added, all removed or all unchanged (docBlocks), and, if asked, edited ones (editedDocBlocks,
// kind '~'), rendered from their new version with the changed lines marked. `end` is inclusive.
export type DocLine = { text: string; changed: boolean };
// style 'line': a run of // comments (lineCommentBlocks) rather than one /** */ comment.
export type DocBlock = { hunk: number; start: number; end: number; kind: '+' | '-' | ' ' | '~'; text: string; indent: number; lines?: DocLine[]; style?: 'line' };

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

// Languages whose line comments are //.
export const lineCommentSyntax = (path: string) => /\.(kt|kts|java|[cm]?[jt]sx?|swift|go|rs|dart|scala|cs|php|c|cc|cpp|h|hpp|m|mm|groovy|gradle)$/.test(path);

// Runs of two or more // comment lines (comment-only lines) to show as prose: all of one kind, or (with `edited`) edited,
// read from the new side like editedDocBlocks. A run that reads as commented-out code stays source.
const LINE = /^(\s*)\/\/(?!\/\/)/;
const CODEISH = /[;{}]\s*$|^\s*(val|var|fun|if|else|for|while|return|import|package|class|private|public|const|let|def)\b|^\s*[\w.]+\(.*\)\s*$|^\s*[\w.]+\s*=[^=]/;
export function lineCommentBlocks(hunks: Hunk[], edited: boolean): DocBlock[] {
  const out: DocBlock[] = [];
  hunks.forEach((h, hi) => {
    const L = h.lines;
    for (let i = 0; i < L.length; i++) {
      if (!LINE.test(L[i].text)) continue;
      let end = i;
      while (end + 1 < L.length && LINE.test(L[end + 1].text)) end++;
      const run = L.slice(i, end + 1);
      const same = run.every((l) => l.kind === run[0].kind);
      const shown = same ? run : run.filter((l) => l.kind !== '-');
      const body = shown.map((l) => l.text.replace(/^\s*\/\/\/? ?/, ''));
      const code = body.filter((t) => t.trim() && CODEISH.test(t)).length;
      if (shown.length >= 2 && (same || edited) && code * 2 < body.filter((t) => t.trim()).length) {
        let removed = false;
        const lines: DocLine[] = [];
        for (const l of run) {
          if (!same && l.kind === '-') removed = true;
          else lines.push({ text: l.text, changed: !same && (l.kind === '+' || removed) }), (removed = false);
        }
        if (removed && lines.length) lines[lines.length - 1].changed = true;
        const indent = shown[0].text.match(LINE)![1].length;
        out.push({ hunk: hi, start: i, end, kind: same ? run[0].kind : '~', text: lines.map((l) => l.text).join('\n'), indent, lines, style: 'line' });
      }
      i = end;
    }
  });
  return out;
}

// Doc comments edited line by line: from an opening /** on the new side to its */, plus the removed doc lines just
// before it (an edited first line). Each new-side line says whether it changed (added, or right after removed lines).
export function editedDocBlocks(hunks: Hunk[]): DocBlock[] {
  const out: DocBlock[] = [];
  hunks.forEach((h, hi) => {
    const L = h.lines;
    for (let i = 0; i < L.length; i++) {
      const open = L[i].kind !== '-' && L[i].text.match(/^(\s*)\/\*\*(?!\/)/);
      if (!open) continue;
      let end = i;
      while (end < L.length && (L[end].kind === '-' || !L[end].text.includes('*/', end === i ? open[0].length : 0))) end++;
      if (end === L.length) break;
      let start = i;
      while (start > 0 && L[start - 1].kind === '-' && /^\s*(\/\*\*|\*)/.test(L[start - 1].text)) start--;
      const run = L.slice(start, end + 1);
      if (!run.every((l) => l.kind === run[0].kind)) {
        const lines: DocLine[] = [];
        let removed = false;
        for (const l of run) {
          if (l.kind === '-') removed = true;
          else lines.push({ text: l.text, changed: l.kind === '+' || removed }), (removed = false);
        }
        if (removed && lines.length) lines[lines.length - 1].changed = true;
        out.push({ hunk: hi, start, end, kind: '~', text: lines.map((l) => l.text).join('\n'), indent: open[1].length, lines });
      }
      i = end;
    }
  });
  return out;
}

// A line's content without /** (first line), */ (last line) and the leading *.
const stripLine = (l: string, i: number, n: number) => {
  let s = l;
  if (i === 0) s = s.replace(/^\s*\/\*\*/, '');
  if (i === n - 1) s = s.replace(/\*\/\s*$/, '');
  return s.replace(/^\s*\* ?/, '');
};

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

// The description as markdown paragraphs, then the block tags grouped by label: [label, [name, description, changed][]].
// A paragraph or tag is `changed` when any of its lines is.
export type DocParts = { paras: { md: string; changed: boolean }[]; tags: [string, [string, string, boolean][]][] };
export function docParts(lines: DocLine[], syntax: 'kdoc' | 'java' | 'jsdoc', style?: 'line'): DocParts {
  const clean = (s: string) => {
    if (syntax === 'java') s = javadoc(s);
    // KDoc/JSDoc links [Foo] / {@link Foo} read as code names.
    return s.replace(/\{@link\s+([^}\s|]+)[^}]*\}/g, '`$1`').replace(/(?<![\]`])\[([\w.#]+)\](?![(\[:])/g, '`$1`');
  };
  const text = lines.map((l, i) => ({ text: style === 'line' ? l.text.replace(/^\s*\/\/\/? ?/, '') : stripLine(l.text, i, lines.length), changed: l.changed }));
  // Segments: body paragraphs, then one per @tag (running to the next). A paragraph ends at a blank line, or at a line
  // ending a sentence when the next starts one (not lowercase: "e.g." doesn't split); lists and code blocks stay whole.
  const segs: { tag: boolean; lines: DocLine[] }[] = [];
  let fence = false;
  text.forEach((l, i) => {
    const t = l.text.trim();
    if (t.startsWith('```')) fence = !fence;
    const isTag = !fence && /^@\w+/.test(t);
    const cur = segs.at(-1);
    if (isTag) segs.push({ tag: true, lines: [l] });
    else if (cur?.tag) cur.lines.push(l);
    else if (!t && !fence) (cur?.lines.length ? segs.push({ tag: false, lines: [] }) : null);
    else if (cur) cur.lines.push(l);
    else segs.push({ tag: false, lines: [l] });
    const next = text[i + 1]?.text.trim() ?? '';
    const sentenceEnd = /[.!?]$/.test(t) && !/^[-*+]\s|^\d+\.\s/.test(t) && next && !/^[a-z(]/.test(next) && !/^([-*+]|\d+\.)\s|^@|^```/.test(next);
    if (!fence && sentenceEnd && segs.at(-1)?.tag === false && segs.at(-1)!.lines.length) segs.push({ tag: false, lines: [] });
  });
  const paras: DocParts['paras'] = [];
  const tags = new Map<string, [string, string, boolean][]>();
  for (const seg of segs.filter((g) => g.lines.length)) {
    const changed = seg.lines.some((l) => l.changed);
    const body = clean(seg.lines.map((l) => l.text).join('\n')).trim();
    if (!seg.tag) {
      if (body) paras.push({ md: body, changed });
      continue;
    }
    const m = body.match(/^@(\w+)\s*([\s\S]*)$/);
    if (!m || m[1] === 'suppress') continue;
    const label = TAGS[m[1]] ?? m[1];
    let rest = m[2].trim().replace(/^\{[^}]*\}\s*/, ''); // JSDoc {Type}
    let name = '';
    if (['param', 'property', 'throws', 'exception', 'template'].includes(m[1])) [name, rest] = [rest.split(/\s+/)[0], rest.split(/\s+/).slice(1).join(' ')];
    tags.set(label, [...(tags.get(label) ?? []), [name, rest.replace(/\s+/g, ' '), changed]]);
  }
  return { paras, tags: [...tags] };
}

// Markdown for the description, then the block tags grouped by label: [label, [name, description][]].
export function parseDoc(text: string, syntax: 'kdoc' | 'java' | 'jsdoc'): { body: string; tags: [string, [string, string][]][] } {
  const { paras, tags } = docParts(text.split('\n').map((t) => ({ text: t, changed: false })), syntax);
  return { body: paras.map((p) => p.md).join('\n\n'), tags: tags.map(([label, items]) => [label, items.map(([n, t]) => [n, t] as [string, string])]) };
}
