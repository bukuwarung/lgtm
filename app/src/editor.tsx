import { useEffect, useRef, useState } from 'preact/hooks';
import { getEmojis, renderGfm } from './github.ts';
import { renderMermaid } from './mermaid.ts';

type Props = {
  value: string;
  onInput: (value: string) => void;
  onSubmit?: () => void; // ⌘↵
  onCancel?: () => void; // Esc
  repo: string; // for the preview's #refs and @mentions
  mentions: string[]; // logins offered after "@"
  suggestion?: string | null; // the commented lines, for a ```suggestion block (line comments only)
  autoFocus?: boolean;
  rows?: number;
  placeholder?: string;
};

type Completion = { kind: ':' | '@'; start: number; items: { name: string; img?: string }[]; i: number };

// Comment editor: Write/Preview (rendered by GitHub, so it's exactly what gets posted), :emoji: and @mention
// completion, a formatting toolbar with the usual shortcuts, and "Suggest" for a GitHub suggested change.
export function Editor(p: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState<{ html?: string; error?: string } | null>(null);
  const [emojis, setEmojis] = useState<Record<string, string>>({});
  const [ac, setAc] = useState<Completion | null>(null);

  useEffect(() => {
    getEmojis().then(setEmojis, () => {});
    if (p.autoFocus) area.current?.focus();
  }, []);
  useEffect(() => void renderMermaid(previewRef.current), [preview]);

  // Replace the value and put the caret at `caret` (after React-style re-render).
  const set = (value: string, caret: number, selEnd = caret) => {
    p.onInput(value);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(caret, selEnd);
    });
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

  const complete = (v: string, caret: number) => {
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
    const ins = ac!.kind === ':' ? `:${name}: ` : `@${name} `;
    set(v.slice(0, ac!.start) + ins + v.slice(s), ac!.start + ins.length);
    setAc(null);
  };

  function onKeyDown(e: KeyboardEvent) {
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
      return p.onSubmit?.();
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
  const tool = (label: string, title: string, run: () => void) => (
    <button type="button" class="ed-tool" title={title} onMouseDown={(e) => { e.preventDefault(); run(); }}>
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
            {p.suggestion != null && tool('± Suggest', 'Suggest a change to these lines', () => insertBlock('```suggestion\n' + p.suggestion + '\n```'))}
          </>
        )}
      </div>
      {tab === 'write' ? (
        <div class="ed-write">
          <textarea
            ref={area}
            rows={p.rows ?? 4}
            placeholder={p.placeholder ?? 'Leave a comment · : for emoji, @ to mention · ⌘↵ to save'}
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
                  {it.img ? <img src={it.img} alt="" width={18} height={18} /> : <span class="ed-at">@</span>}
                  {ac.kind === ':' ? `:${it.name}:` : it.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div class="ed-preview md" ref={previewRef}>
          {!preview ? <p class="note">Rendering preview…</p> : preview.error ? <p class="error">{preview.error}</p> : <div dangerouslySetInnerHTML={{ __html: preview.html! }} />}
        </div>
      )}
    </div>
  );
}
