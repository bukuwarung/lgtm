import { useEffect, useRef, useState } from 'preact/hooks';
import { useStoredValue } from './platform.ts';
import { Octicon } from './tags.tsx';

// ⌘F in the app: the macOS web view has no find bar of its own. Matches are marked with the CSS Custom Highlight API
// (no changes to the page); Enter / ⇧Enter move between them, Esc closes. The review page renders every file on ⌘F,
// so text in files below the fold is searchable too.
const HL = typeof CSS !== 'undefined' && 'highlights' in CSS ? { all: new Highlight(), cur: new Highlight() } : null;
if (HL) {
  CSS.highlights.set('lgtm-find', HL.all);
  CSS.highlights.set('lgtm-find-current', HL.cur);
}

function search(q: string): StaticRange[] {
  const root = document.querySelector('.shell');
  if (!root || !q) return [];
  const needle = q.toLowerCase();
  const out: StaticRange[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('input, textarea, script, style, .find-bar') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode() as Text | null; n && out.length < 2000; n = walk.nextNode() as Text | null) {
    const text = n.data.toLowerCase();
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
      out.push(new StaticRange({ startContainer: n, startOffset: i, endContainer: n, endOffset: i + needle.length })); // fixed: can't stretch when the page changes
    }
  }
  return out;
}

export function FindBar() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<StaticRange[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // Searches that found something, newest first (the last 10, this account's): offered under the box as you type.
  const [recentRaw, setRecent] = useStoredValue('findRecent', '[]');
  const recent: string[] = (() => {
    try {
      return JSON.parse(recentRaw);
    } catch {
      return [];
    }
  })();
  const remember = () => {
    const k = q.trim();
    if (k.length >= 2 && hits.length && recent[0] !== k) setRecent(JSON.stringify([k, ...recent.filter((x) => x !== k)].slice(0, 10)));
  };
  const close = () => (remember(), setOpen(false));
  // Those searches, under the box in LGTM's own menu (a <datalist> opened macOS's): as you type, or on ↓.
  const [sugOpen, setSugOpen] = useState(false);
  const [sugHi, setSugHi] = useState(-1);
  const sugs = sugOpen ? recent.filter((k) => k !== q && k.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  const take = (k: string) => (setQ(k), setSugOpen(false), setSugHi(-1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => input.current?.select());
      }
    };
    const show = () => (setOpen(true), requestAnimationFrame(() => input.current?.select()));
    addEventListener('keydown', onKey);
    addEventListener('lgtm:find', show); // Edit → Find… in the app's menu bar
    return () => (removeEventListener('keydown', onKey), removeEventListener('lgtm:find', show));
  }, []);

  // Search after typing pauses (and after the page has rendered every file).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const found = search(q);
      setHits(found);
      setI(0);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!HL) return;
    HL.all.clear();
    HL.cur.clear();
    if (!open) return;
    hits.forEach((r) => HL.all.add(r));
    const cur = hits[i];
    if (!cur) return;
    HL.cur.add(cur);
    // Open collapsed sections around it (threads, folded comments), then bring it into view.
    for (let d = cur.startContainer.parentElement?.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
    cur.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  }, [hits, i, open]);

  if (!open) return null;
  const step = (d: number) => hits.length && setI((i + d + hits.length) % hits.length);
  return (
    <div class="find-bar" role="search">
      <span class="find-field">
      <input
        ref={input}
        value={q}
        placeholder="Find in this page"
        aria-label="Find in this page"
        aria-autocomplete="list"
        aria-expanded={sugs.length > 0}
        onInput={(e) => (setQ(e.currentTarget.value), setSugOpen(true), setSugHi(-1))}
        onBlur={() => setSugOpen(false)}
        onKeyDown={(e) => {
          if (e.isComposing || e.keyCode === 229) return; // an input method's Enter or arrows (platform.ts composing)
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!sugOpen) return setSugOpen(true);
            const n = sugs.length;
            if (n) setSugHi((h) => (e.key === 'ArrowDown' ? (h + 1) % n : (h - 1 + n) % n));
          } else if (e.key === 'Enter' && sugs[sugHi]) {
            e.preventDefault();
            take(sugs[sugHi]);
          } else if (e.key === 'Escape' && sugs.length) {
            e.stopPropagation();
            setSugOpen(false); // the list first, then the bar
          } else if (e.key === 'Enter') {
            e.preventDefault();
            remember();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            close();
          }
        }}
      />
      {sugs.length > 0 && (
        <div class="select-menu find-sugs" role="listbox" aria-label="Recent searches">
          {sugs.map((k, j) => (
            <div role="option" aria-selected={j === sugHi} class={`select-opt${j === sugHi ? ' hi' : ''}`} onMouseEnter={() => setSugHi(j)} onMouseDown={(e) => (e.preventDefault(), take(k))}>
              <span class="select-tick"><Octicon name="history" /></span>
              <span class="select-text">{k}</span>
            </div>
          ))}
        </div>
      )}
      </span>
      <span class="find-count">{q ? (hits.length ? `${i + 1}/${hits.length}` : 'No matches') : ''}</span>
      <button class="icon-btn" title="Previous (⇧↵)" aria-label="Previous" onClick={() => step(-1)} disabled={!hits.length}><Octicon name="chevron-up" /></button>
      <button class="icon-btn" title="Next (↵)" aria-label="Next" onClick={() => step(1)} disabled={!hits.length}><Octicon name="chevron-down" /></button>
      <button class="icon-btn" title="Close (Esc)" aria-label="Close" onClick={close}><Octicon name="x" /></button>
    </div>
  );
}
