import { useEffect, useRef, useState } from 'preact/hooks';
import { getEmojis, renderGfm } from './github.ts';
import { renderMermaid } from './mermaid.ts';
import { composing, own, recentPRs, useSavedReplies } from './platform.ts';
import { isLab } from './github.ts';
import { AGENTS, type AgentId } from './agents.ts';
import { AgentMark } from './tags.tsx';
import { mdStyleProps, useMdStyle } from './mdthemes.ts';

type Props = {
  value: string;
  onInput: (value: string) => void;
  onSubmit?: () => void; // ⌘↵
  onSubmitAlt?: () => void; // ⌘⇧↵ (a thread's reply: send and resolve)
  onCancel?: () => void; // Esc
  repo: string; // for the preview's #refs and @mentions
  mentions: string[]; // logins offered after "@"
  suggestion?: string | null; // the commented lines, for a ```suggestion block (line comments only)
  fix?: { agents: AgentId[]; run: (agent: AgentId, comment: string) => Promise<string> }; // an agent writes the suggestion
  autoFocus?: boolean;
  rows?: number;
  placeholder?: string;
  doc?: boolean; // a PR's description: previewed in your Markdown style (Settings → Markdown files), as it shows
};

type Completion = { kind: ':' | '@' | '/' | '`' | '#' | 'jira'; start: number; items: { name: string; img?: string; body?: string }[]; i: number };

// The open PR's code names (review.tsx sets them): the functions and classes it declares, and its files, offered after
// a backtick, so a comment names them right (and links to them once shown).
let codeNames: { name: string; where: string }[] = [];
export const setCodeNames = (names: typeof codeNames) => void (codeNames = names);

// PRs of this repo lgtm knows (the PR list's, the recently viewed), by number, for "#" (GitLab: "!").
function knownPRs(repo: string): { n: number; title: string }[] {
  const out = new Map<number, string>();
  try {
    for (const i of JSON.parse(localStorage.getItem(own('queueCache')) ?? '[]') ?? []) if (i.repo === repo) out.set(i.number, i.title);
  } catch {}
  for (const r of recentPRs()) if (r.repo === repo && !out.has(r.n)) out.set(r.n, r.title);
  return [...out].map(([n, title]) => ({ n, title }));
}
// Jira tickets lgtm has shown (review.tsx keepJira), newest last, for a key being typed.
function knownTickets(): { key: string; summary: string }[] {
  try {
    return Object.values(JSON.parse(localStorage.getItem('jiraSeen') ?? '{}') as Record<string, { key: string; summary: string }>).reverse();
  } catch {
    return [];
  }
}

// Comment editor: Write/Preview (rendered by GitHub, so it's exactly what gets posted), :emoji: and @mention
// completion, a formatting toolbar with the usual shortcuts, and "Suggest" for a GitHub suggested change.
export function Editor(p: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [mdStyle] = useMdStyle();
  const look = mdStyleProps(mdStyle);
  const [preview, setPreview] = useState<{ html?: string; error?: string } | null>(null);
  const [emojis, setEmojis] = useState<Record<string, string>>({});
  const [ac, setAc] = useState<Completion | null>(null);
  const [replies] = useSavedReplies();
  const [fixing, setFixing] = useState<AgentId | 'pick' | null>(null);
  const [fixErr, setFixErr] = useState('');

  useEffect(() => {
    getEmojis(p.repo).then(setEmojis, () => {});
    if (p.autoFocus) area.current?.focus();
  }, []);
  useEffect(() => void renderMermaid(previewRef.current), [preview]);

  // Replace the value and put the caret at `caret` (after React-style re-render).
  // The box takes the text and caret at once (not a frame later, when a key typed meanwhile would land where the caret
  // was); the state follows, and its redraw finds the box already holding that text.
  const set = (value: string, caret: number, selEnd = caret) => {
    const el = area.current;
    if (el) {
      el.value = value;
      el.focus();
      el.setSelectionRange(caret, selEnd);
    }
    p.onInput(value);
  };
  const sel = () => {
    const el = area.current!;
    return { v: el.value, s: el.selectionStart, e: el.selectionEnd };
  };
  const wrap = (before: string, after = before, fallback = '') => {
    const { v, s, e } = sel();
    const text = v.slice(s, e) || fallback;
    set(v.slice(0, s) + before + text + after + v.slice(e), s + before.length, s + before.length + text.length);
  };
  // Prefix every line touched by the selection ("> ", "- ", "- [ ] ").
  const prefix = (pre: string) => {
    const { v, s, e } = sel();
    const from = v.lastIndexOf('\n', s - 1) + 1;
    const block = v.slice(from, e).split('\n').map((l) => pre + l).join('\n');
    set(v.slice(0, from) + block + v.slice(e), from + block.length);
  };
  // Insert a block on its own lines at the caret.
  const insertBlock = (text: string) => {
    const { v, s, e } = sel();
    const before = s && v[s - 1] !== '\n' ? '\n' : '';
    const ins = `${before}${text}\n`;
    set(v.slice(0, s) + ins + v.slice(e), s + ins.length);
  };

  // Saved replies whose title matches `q`, as completions starting at `start` (the "/", or the caret from the toolbar).
  const offerReplies = (q: string, start: number) => {
    const items = replies.filter((r) => r.title.toLowerCase().includes(q.toLowerCase())).map((r) => ({ name: r.title, body: r.body }));
    setAc(items.length ? { kind: '/', start, items, i: 0 } : null);
  };
  const complete = (v: string, caret: number) => {
    const r = v.slice(0, caret).match(/(?:^|\n)\/([\w-]*)$/);
    if (r) return offerReplies(r[1], caret - r[1].length - 1);
    const ref = isLab(p.repo) ? '!' : '#';
    const h = v.slice(0, caret).match(new RegExp(`(?:^|[\\s(])\\${ref}(\\w+)$`));
    if (h) {
      const q = h[1].toLowerCase();
      const items = knownPRs(p.repo)
        .filter((x) => String(x.n).startsWith(q) || x.title.toLowerCase().includes(q))
        .sort((a, b) => +!String(a.n).startsWith(q) - +!String(b.n).startsWith(q) || b.n - a.n)
        .slice(0, 8);
      return setAc(items.length ? { kind: '#', start: caret - h[1].length - 1, items: items.map((x) => ({ name: `${ref}${x.n}`, body: x.title })), i: 0 } : null);
    }
    const j = v.slice(0, caret).match(/(?:^|[\s(])([A-Z][A-Z0-9]{1,9}-\d*)$/);
    if (j) {
      const items = knownTickets().filter((t) => t.key.startsWith(j[1])).slice(0, 8);
      if (items.length) return setAc({ kind: 'jira', start: caret - j[1].length, items: items.map((t) => ({ name: t.key, body: t.summary })), i: 0 });
    }
    const c = v.slice(0, caret).match(/(?:^|[\s(])`([\w.$-]+)$/);
    if (c && codeNames.length) {
      const ql = c[1].toLowerCase();
      const at = (n: string) => n.toLowerCase().indexOf(ql);
      const items = codeNames.filter((x) => at(x.name) >= 0).sort((a, b) => +(at(a.name) > 0) - +(at(b.name) > 0) || a.name.length - b.name.length).slice(0, 8);
      return setAc(items.length ? { kind: '`', start: caret - c[1].length - 1, items: items.map((x) => ({ name: x.name, body: x.where })), i: 0 } : null);
    }
    const m = v.slice(0, caret).match(/(?:^|[\s(])([:@])([\w+-]+)$/);
    if (!m) return setAc(null);
    const [, kind, q] = m as unknown as [string, ':' | '@', string];
    const ql = q.toLowerCase();
    const rank = (a: string, b: string) => +!a.startsWith(ql) - +!b.startsWith(ql) || a.length - b.length;
    const items =
      kind === ':'
        ? q.length < 2
          ? []
          : Object.keys(emojis).filter((n) => n.includes(ql)).sort(rank).slice(0, 8).map((name) => ({ name, img: emojis[name] }))
        : p.mentions.filter((l) => l.toLowerCase().includes(ql)).sort((a, b) => rank(a.toLowerCase(), b.toLowerCase())).slice(0, 8).map((name) => ({ name }));
    setAc(items.length ? { kind, start: caret - q.length - 1, items, i: 0 } : null);
  };
  const pick = (name: string) => {
    const { v, s } = sel();
    const ins = ac!.kind === '/' ? ac!.items.find((it) => it.name === name)!.body! : ac!.kind === '#' || ac!.kind === 'jira' ? `${name} ` : ac!.kind === '`' ? `\`${name}\`` : ac!.kind === ':' ? `:${name}: ` : `@${name} `;
    set(v.slice(0, ac!.start) + ins + v.slice(s), ac!.start + ins.length);
    setAc(null);
  };

  function onKeyDown(e: KeyboardEvent) {
    if (composing(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (ac) {
      const n = ac.items.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        return setAc({ ...ac, i: (ac.i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
      }
      if ((e.key === 'Enter' && !mod) || e.key === 'Tab') {
        e.preventDefault();
        return pick(ac.items[ac.i].name);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return setAc(null);
      }
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      return e.shiftKey && p.onSubmitAlt ? p.onSubmitAlt() : p.onSubmit?.();
    }
    if (e.key === 'Escape') return p.onCancel?.();
    const k = mod && !e.shiftKey && e.key.toLowerCase();
    const fmt: Record<string, () => void> = { b: () => wrap('**'), i: () => wrap('_'), e: () => wrap('`'), k: () => wrap('[', '](url)', 'text') };
    if (k && fmt[k]) {
      e.preventDefault();
      fmt[k]();
    }
  }

  const showPreview = () => {
    setTab('preview');
    setAc(null);
    setPreview(null);
    if (!p.value.trim()) return setPreview({ html: '<p class="note">Nothing to preview.</p>' });
    renderGfm(p.value, p.repo).then((html) => setPreview({ html }), (e) => setPreview({ error: e.message }));
  };

  // Toolbar buttons keep the textarea's selection: act on mousedown and don't take focus.
  // An agent's rewrite of the commented lines, from the comment so far, as a suggestion block at the caret.
  const fix = (agent: AgentId) => {
    setFixing(agent);
    setFixErr('');
    p.fix!.run(agent, p.value).then(
      (t) => insertBlock('```suggestion\n' + t + '\n```'),
      (e: Error) => setFixErr(`${AGENTS[agent].name} couldn't: ${e.message}`),
    ).finally(() => setFixing(null));
  };
  const tool = (label: string, title: string, run: () => void) => (
    // Mouse-down keeps the text box's focus and selection; the click runs it, so Enter and Space do too.
    <button type="button" class="ed-tool" title={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {label}
    </button>
  );

  return (
    <div class="editor">
      <div class="ed-bar">
        <button type="button" class={tab === 'write' ? 'ed-tab on' : 'ed-tab'} onClick={() => setTab('write')}>Write</button>
        <button type="button" class={tab === 'preview' ? 'ed-tab on' : 'ed-tab'} onClick={showPreview}>Preview</button>
        <span class="spacer" />
        {tab === 'write' && (
          <>
            {tool('B', 'Bold (⌘B)', () => wrap('**'))}
            {tool('I', 'Italic (⌘I)', () => wrap('_'))}
            {tool('</>', 'Code (⌘E)', () => wrap('`'))}
            {tool('🔗', 'Link (⌘K)', () => wrap('[', '](url)', 'text'))}
            {tool('❝', 'Quote', () => prefix('> '))}
            {tool('•', 'List', () => prefix('- '))}
            {tool('☐', 'Task', () => prefix('- [ ] '))}
            {replies.length > 0 && tool('↩︎ Replies', 'Saved replies (or type / at the start of a line)', () => offerReplies('', sel().s))}
            {p.suggestion != null && tool('± Suggest', 'Suggest a change to these lines', () => insertBlock('```suggestion\n' + p.suggestion + '\n```'))}
            {p.suggestion != null && !!p.fix?.agents.length && (
              <span class="ed-fix">
                <button
                  type="button"
                  class="ed-tool"
                  disabled={!!fixing && fixing !== 'pick'}
                  title={`A coding agent writes the change your comment asks for (or a fix, with no comment yet), as a suggestion to edit`}
                  aria-haspopup={p.fix.agents.length > 1 ? 'menu' : undefined}
                  aria-expanded={p.fix.agents.length > 1 ? fixing === 'pick' : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (p.fix!.agents.length > 1 ? setFixing(fixing === 'pick' ? null : 'pick') : fix(p.fix!.agents[0]))}
                >
                  {fixing && fixing !== 'pick' ? <><AgentMark id={fixing} /> Fixing…</> : p.fix.agents.length > 1 ? '✦ Fix' : <><AgentMark id={p.fix.agents[0]} /> Fix</>}
                </button>
                {fixing === 'pick' && (
                  <span class="account-menu ed-fix-pick" role="menu">
                    {p.fix.agents.map((a) => (
                      <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => fix(a)}>
                        <AgentMark id={a} /> Fix with {AGENTS[a].name}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            )}
          </>
        )}
      </div>
      {fixErr && <p class="error ed-fix-err">{fixErr}</p>}
      {tab === 'write' ? (
        <div class="ed-write">
          <textarea
            ref={area}
            rows={p.rows ?? 4}
            placeholder={p.placeholder ?? 'Leave a comment · : for emoji, @ to mention, ` for code, / for saved replies · ⌘↵ to save'}
            value={p.value}
            onInput={(e) => {
              p.onInput(e.currentTarget.value);
              complete(e.currentTarget.value, e.currentTarget.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setAc(null), 150)}
          />
          {ac && (
            <ul class="ed-ac" role="listbox">
              {ac.items.map((it, i) => (
                <li
                  key={it.name}
                  role="option"
                  aria-selected={i === ac.i}
                  class={i === ac.i ? 'on' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(it.name);
                  }}
                >
                  {it.img ? <img src={it.img} alt="" width={18} height={18} /> : <span class="ed-at">{ac.kind === '/' ? '/' : ac.kind === '`' ? '‹›' : ac.kind === '#' ? '' : ac.kind === 'jira' ? '◆' : '@'}</span>}
                  {ac.kind === ':' ? `:${it.name}:` : it.name}
                  {it.body && <span class="ed-reply">{it.body}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div class={p.doc ? 'ed-preview' : 'ed-preview md'} ref={previewRef}>
          {!preview ? <p class="note">Rendering preview…</p> : preview.error ? <p class="error">{preview.error}</p> : p.doc ? (
            <div class={`rich pr-desc ${look.class}`} style={look.style}>
              <div class="md chunk" dangerouslySetInnerHTML={{ __html: preview.html! }} />
            </div>
          ) : <div dangerouslySetInnerHTML={{ __html: preview.html! }} />}
        </div>
      )}
    </div>
  );
}
