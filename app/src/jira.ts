// Jira keys in a PR's title (or, failing that, its branch name), and Jira's rich-text format (ADF) turned into
// markdown, which our markdown renderer then shows with HTML escaped, like any PR text.
export const jiraKeys = (...texts: string[]) => {
  for (const t of texts) {
    const keys = [...new Set(t.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [])];
    if (keys.length) return keys;
  }
  return [];
};

// Jira keys in rendered text (comments, threads, descriptions) as links to the ticket, for projects lgtm has seen in PR
// titles and branches (so UTF-8 or SHA-256 never is one); not inside links or code.
const projects = new Set<string>();
export const knowJiraKeys = (texts: string[]) => texts.forEach((t) => jiraKeys(t).forEach((k) => projects.add(k.split('-')[0])));
export function linkJiraKeys(root: Element, site: string) {
  if (!projects.size) return;
  const base = /^https?:\/\//.test(site) ? site.replace(/\/$/, '') : `https://${site}`; // acli gives the host alone
  const re = new RegExp(`\\b(?:${[...projects].join('|')})-\\d+\\b`, 'g');
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('a, code, pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const hits: Text[] = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (new RegExp(re.source).test(n.textContent ?? '')) hits.push(n as Text);
  for (const t of hits) {
    const text = t.textContent!;
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const m of text.matchAll(re)) {
      frag.append(text.slice(at, m.index));
      const a = Object.assign(document.createElement('a'), { href: `${base}/browse/${m[0]}`, textContent: m[0], target: '_blank', rel: 'noopener', className: 'jira-link' });
      frag.append(a);
      at = m.index! + m[0].length;
    }
    frag.append(text.slice(at));
    t.replaceWith(frag);
  }
}

type Node = { type: string; text?: string; content?: Node[]; attrs?: Record<string, any>; marks?: { type: string; attrs?: Record<string, any> }[] };

function inline(n: Node): string {
  if (n.type === 'text') {
    let t = n.text ?? '';
    for (const m of n.marks ?? []) {
      if (m.type === 'code') t = '`' + t + '`';
      else if (m.type === 'strong') t = `**${t}**`;
      else if (m.type === 'em') t = `_${t}_`;
      else if (m.type === 'strike') t = `~~${t}~~`;
      else if (m.type === 'link') t = `[${t}](${m.attrs?.href})`;
    }
    return t;
  }
  if (n.type === 'hardBreak') return '  \n';
  if (n.type === 'inlineCard' || n.type === 'blockCard') return n.attrs?.url ?? '';
  if (n.type === 'mention') return n.attrs?.text ?? '@someone';
  if (n.type === 'emoji') return n.attrs?.text ?? n.attrs?.shortName ?? '';
  if (n.type === 'status') return `[${n.attrs?.text}]`;
  if (n.type === 'date') return new Date(+n.attrs?.timestamp).toLocaleDateString();
  return (n.content ?? []).map(inline).join('');
}

function block(n: Node, indent = ''): string {
  const kids = (sep = '\n\n', ind = indent) => (n.content ?? []).map((c) => block(c, ind)).filter(Boolean).join(sep);
  switch (n.type) {
    case 'doc':
      return kids();
    case 'paragraph':
      return indent + inline(n);
    case 'heading':
      return '#'.repeat(n.attrs?.level ?? 2) + ' ' + inline(n);
    case 'bulletList':
    case 'orderedList':
      return (n.content ?? [])
        .map((li, i) => {
          const bullet = n.type === 'bulletList' ? '- ' : `${i + 1}. `;
          const body = (li.content ?? []).map((c) => block(c, indent + '   ')).join('\n').trimStart();
          return indent + bullet + body;
        })
        .join('\n');
    case 'taskList':
      return (n.content ?? []).map((t) => `${indent}- [${t.attrs?.state === 'DONE' ? 'x' : ' '}] ${inline(t)}`).join('\n');
    case 'codeBlock':
      return '```' + (n.attrs?.language ?? '') + '\n' + inline(n) + '\n```';
    case 'blockquote':
    case 'panel':
      return kids().replace(/^/gm, '> ');
    case 'rule':
      return '---';
    case 'table':
      return (n.content ?? [])
        .map((row, i) => {
          const cells = (row.content ?? []).map((c) => inline(c).replace(/\|/g, '\\|').replace(/\n/g, ' '));
          const line = `| ${cells.join(' | ')} |`;
          return i === 0 ? `${line}\n|${cells.map(() => ' --- |').join('')}` : line;
        })
        .join('\n');
    case 'mediaSingle':
    case 'mediaGroup':
      return '_(attachment)_';
    default:
      return n.content ? kids() : inline(n);
  }
}

export const adfToMarkdown = (doc: Node | null) => (doc ? block(doc).trim() : '');
