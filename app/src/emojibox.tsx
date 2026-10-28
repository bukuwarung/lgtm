import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getEmojis } from './github.ts';
import { getSlackEmoji } from './platform.ts';

// Slack emoji, to draw and suggest: the workspace's custom ones (aliases followed), then GitHub's standard set, whose
// names mostly match Slack's. `names` puts the workspace's own first.
export function useSlackEmoji() {
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [standard, setStandard] = useState<Record<string, string>>({});
  useEffect(() => {
    getSlackEmoji().then(setCustom);
    getEmojis().then(setStandard, () => {});
  }, []);
  const names = useMemo(() => [...new Set([...Object.keys(custom).sort(), ...Object.keys(standard).sort()])], [custom, standard]);
  const emoji = (name: string, depth = 0): string | undefined => {
    const v = custom[name] ?? standard[name];
    return v?.startsWith(':') && depth < 3 ? emoji(v.slice(1, -1), depth + 1) : v;
  };
  return { names, emoji };
}

// A textarea that suggests Slack emoji as you type ":" and a few letters: ↑↓ to pick, ↵ or Tab to put it in, Esc to
// close; a click works too. The workspace's own come first.
export function EmojiTextarea({ value, onInput, names, emoji, rows = 3, label }: { value: string; onInput: (v: string) => void; names: string[]; emoji: (name: string) => string | undefined; rows?: number; label?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [q, setQ] = useState<{ word: string; at: number } | null>(null);
  const [active, setActive] = useState(0);
  const look = () => {
    const t = ref.current!;
    const m = t.value.slice(0, t.selectionStart).match(/:([a-z0-9_+'-]{2,})$/i);
    setQ(m ? { word: m[1].toLowerCase(), at: t.selectionStart - m[0].length } : null);
    setActive(0);
  };
  const matches = !q ? [] : [...names.filter((n) => n.startsWith(q.word)), ...names.filter((n) => !n.startsWith(q.word) && n.includes(q.word))].slice(0, 8);
  const put = (name: string) => {
    const t = ref.current!;
    const end = t.selectionStart;
    const next = `${t.value.slice(0, q!.at)}:${name}: ${t.value.slice(end)}`;
    onInput(next);
    setQ(null);
    requestAnimationFrame(() => {
      t.focus();
      t.selectionStart = t.selectionEnd = q!.at + name.length + 3;
    });
  };
  return (
    <div class="emoji-ta">
      <textarea
        ref={ref}
        rows={rows}
        aria-label={label}
        value={value}
        onInput={(e) => (onInput(e.currentTarget.value), look())}
        onClick={look}
        onBlur={() => setTimeout(() => setQ(null), 150)}
        onKeyDown={(e) => {
          if (!matches.length) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            put(matches[active]);
          } else if (e.key === 'Escape') setQ(null);
        }}
      />
      {matches.length > 0 && (
        <div class="emoji-list" role="listbox">
          {matches.map((n, i) => (
            <button role="option" aria-selected={i === active} class={i === active ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), put(n))}>
              <img src={emoji(n)} alt="" /> :{n}:
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

