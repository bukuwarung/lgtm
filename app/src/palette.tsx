import { useEffect, useRef, useState } from 'preact/hooks';
import type { QueueItem } from './github.ts';

// ⌘K: jump to a PR in your queue, or within the open PR to a file or anything in its index (comments, checks,
// threads). Index entries are read from the page and clicked, so they jump exactly like the index does.
type Entry = { kind: string; label: string; sub: string; run: () => void };

function entries(queue: QueueItem[]): Entry[] {
  const prs = queue.map((i) => ({
    kind: 'PR',
    label: i.title,
    sub: `${i.repo}#${i.number} · ${i.author}`,
    run: () => (location.hash = `/${i.repo}/pull/${i.number}`),
  }));
  const index = [...document.querySelectorAll<HTMLElement>('.ix-item')].map((el) => ({
    kind: el.closest('.ix-sec')?.querySelector('summary')?.firstChild?.textContent?.trim() ?? '',
    label: el.querySelector('.ix-label')?.firstChild?.textContent?.trim() ?? el.textContent ?? '',
    sub: el.querySelector('.ix-sub')?.textContent ?? '',
    run: () => el.click(),
  }));
  // Files from the page itself (there even with the index hidden).
  const files = [...document.querySelectorAll<HTMLElement>('[id^="f-"]')].map((el) => {
    const path = el.id.slice(2);
    return { kind: 'File', label: path.split('/').pop()!, sub: path, run: () => el.scrollIntoView() };
  });
  return [...files, ...index, ...prs];
}

// Every word of the query, in any order, somewhere in the entry.
export const matches = (q: string, text: string) => q.toLowerCase().split(/\s+/).every((w) => text.toLowerCase().includes(w));

export function Palette({ queue }: { queue: () => QueueItem[] }) {
  const [list, setList] = useState<Entry[] | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const open = () => {
      setList(entries(queue()));
      setQ('');
      setSel(0);
      requestAnimationFrame(() => input.current?.focus());
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    addEventListener('keydown', onKey);
    addEventListener('lgtm:palette', open);
    return () => (removeEventListener('keydown', onKey), removeEventListener('lgtm:palette', open));
  }, []);
  if (!list) return null;
  const shown = list.filter((e) => matches(q, `${e.kind} ${e.label} ${e.sub}`)).slice(0, 50);
  const go = (e?: Entry) => {
    setList(null);
    e?.run();
  };
  return (
    <div class="palette-back" onMouseDown={(e) => e.target === e.currentTarget && setList(null)}>
      <div class="palette" role="dialog" aria-label="Go to">
        <input
          ref={input}
          value={q}
          placeholder="Go to a PR, file, thread or check…"
          onInput={(e) => (setQ(e.currentTarget.value), setSel(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(shown.length, 1));
            } else if (e.key === 'Enter') go(shown[sel]);
            else if (e.key === 'Escape') setList(null);
          }}
        />
        <ul>
          {shown.map((e, k) => (
            <li key={k} class={k === sel ? 'on' : ''} onMouseEnter={() => setSel(k)} onClick={() => go(e)} ref={(el) => void (k === sel && el?.scrollIntoView({ block: 'nearest' }))}>
              <span class="pal-kind">{e.kind}</span>
              <span class="pal-label">{e.label}</span>
              {e.sub && <span class="pal-sub">{e.sub}</span>}
            </li>
          ))}
          {!shown.length && <li class="pal-none">Nothing matches</li>}
        </ul>
      </div>
    </div>
  );
}
