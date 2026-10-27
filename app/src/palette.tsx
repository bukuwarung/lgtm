import { useEffect, useRef, useState } from 'preact/hooks';
import type { QueueItem } from './github.ts';

// Go to: a PR in your queue, or within the open PR a file or anything in its index (comments, checks, threads).
// Index entries are read from the page and clicked, so they jump exactly like the index does.
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

// The top bar's one box: type to go to a PR in your queue or within the open PR, or paste a PR link to open it.
// ⌘K (and ⌘L in the app) puts the cursor in it.
export function CommandBar({ queue, parse }: { queue: () => QueueItem[]; parse: (s: string) => { repo: string; n: number } | null }) {
  const [list, setList] = useState<Entry[] | null>(null); // open while not null
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const open = () => {
    setList(entries(queue()));
    setSel(0);
  };
  const close = () => {
    setList(null);
    setQ('');
    input.current?.blur();
  };
  useEffect(() => {
    const focus = () => (input.current?.focus(), input.current?.select());
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.defaultPrevented) { // a comment box's ⌘K is "link"
        e.preventDefault();
        focus();
      }
    };
    addEventListener('keydown', onKey);
    addEventListener('lgtm:palette', focus);
    return () => (removeEventListener('keydown', onKey), removeEventListener('lgtm:palette', focus));
  }, []);
  const pr = parse(q);
  const shown = !list
    ? []
    : [
        ...(pr ? [{ kind: 'Open', label: `${pr.repo}#${pr.n}`, sub: 'Pull request from the link', run: () => (location.hash = `/${pr.repo}/pull/${pr.n}`) }] : []),
        ...(pr ? [] : list.filter((e) => matches(q, `${e.kind} ${e.label} ${e.sub}`)).slice(0, 50)),
      ];
  const go = (e?: Entry) => {
    if (!e) return;
    close();
    e.run();
  };
  return (
    <div class="cmd">
      <svg class="cmd-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
      {!q && <kbd class="cmd-kbd">⌘K</kbd>}
      <input
        ref={input}
        value={q}
        placeholder="Go to a PR, file or thread, or paste a PR link"
        aria-label="Go to, or open a PR link"
        onFocus={open}
        onBlur={() => setTimeout(() => setList(null), 150)}
        onInput={(e) => (setQ(e.currentTarget.value), setSel(0), list || open())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(shown.length, 1));
          } else if (e.key === 'Enter') go(shown[sel]);
          else if (e.key === 'Escape') close();
        }}
      />
      {list && (
        <ul class="cmd-list" role="listbox">
          {shown.map((e, k) => (
            <li
              key={k}
              class={k === sel ? 'on' : ''}
              onMouseEnter={() => setSel(k)}
              onMouseDown={(ev) => (ev.preventDefault(), go(e))}
              ref={(el) => void (k === sel && el?.scrollIntoView({ block: 'nearest' }))}
            >
              <span class="pal-kind">{e.kind}</span>
              <span class="pal-label">{e.label}</span>
              {e.sub && <span class="pal-sub">{e.sub}</span>}
            </li>
          ))}
          {!shown.length && <li class="pal-none">{q ? 'Nothing matches' : 'Nothing to go to yet'}</li>}
        </ul>
      )}
    </div>
  );
}
