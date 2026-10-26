import { useEffect, useRef, useState } from 'preact/hooks';

// ⌘F in the app: the macOS web view has no find bar of its own. Matches are marked with the CSS Custom Highlight API
// (no changes to the page); Enter / ⇧Enter move between them, Esc closes. The review page renders every file on ⌘F,
// so text in files below the fold is searchable too.
const HL = typeof CSS !== 'undefined' && 'highlights' in CSS ? { all: new Highlight(), cur: new Highlight() } : null;
if (HL) {
  CSS.highlights.set('lgtm-find', HL.all);
  CSS.highlights.set('lgtm-find-current', HL.cur);
}

function search(q: string): Range[] {
  const root = document.querySelector('.shell');
  if (!root || !q) return [];
  const needle = q.toLowerCase();
  const out: Range[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('input, textarea, script, style, .find-bar') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode() as Text | null; n && out.length < 2000; n = walk.nextNode() as Text | null) {
    const text = n.data.toLowerCase();
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      out.push(r);
    }
  }
  return out;
}

export function FindBar() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Range[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

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
      <input
        ref={input}
        value={q}
        placeholder="Find in this page"
        aria-label="Find in this page"
        onInput={(e) => setQ(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <span class="find-count">{q ? (hits.length ? `${i + 1}/${hits.length}` : 'No matches') : ''}</span>
      <button title="Previous (⇧↵)" onClick={() => step(-1)} disabled={!hits.length}>↑</button>
      <button title="Next (↵)" onClick={() => step(1)} disabled={!hits.length}>↓</button>
      <button title="Close (Esc)" onClick={() => setOpen(false)}>✕</button>
    </div>
  );
}
