import { useEffect, useRef, useState } from 'preact/hooks';
import { fileLabel } from './files.ts';
import { usesOf, type CodeIndex, type Use } from './specrefs.ts';
import { Octicon } from './tags.tsx';
import { pageTerm } from './platform.ts';

// Where a function or class the PR declares is declared and used in the PR (Settings → Diff): pointing at its name in
// the diff pops a small badge beside it (as rendered markdown's "+"), and the badge lists every line naming it, to jump
// to (specrefs.ts usesOf).
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The word under the pointer in a diff's code, and where it is on screen.
function wordAt(x: number, y: number): { name: string; rect: DOMRect } | null {
  const d = document as any;
  const p = d.caretPositionFromPoint?.(x, y);
  const r = p ? null : d.caretRangeFromPoint?.(x, y);
  const node: Node | undefined = p?.offsetNode ?? r?.startContainer;
  const off: number = p?.offset ?? r?.startOffset ?? 0;
  if (!(node instanceof Text)) return null;
  const t = node.data;
  let s = off, e = off;
  while (s > 0 && /[\w$]/.test(t[s - 1])) s--;
  while (e < t.length && /[\w$]/.test(t[e])) e++;
  if (e - s < 3 || /^\d/.test(t[s])) return null;
  const range = document.createRange();
  range.setStart(node, s);
  range.setEnd(node, e);
  const rect = range.getBoundingClientRect();
  return x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1 ? { name: t.slice(s, e), rect } : null;
}

// peek: review.tsx useRefPeek, to preview a listed line (beside the list) before going there.
type Peek = { show: (p: { path: string; line?: number; go: () => void }, el: Element) => void; out: () => void };
// usageKey: the key that opens the list for the name under the mouse (Settings → Keyboard), as a click on its badge does.
export function SymbolNav({ ix, repoSearch, go, peek, usageKey }: { ix: CodeIndex; repoSearch: (name: string) => string; go: (path: string, line: number, old: boolean) => void; peek?: Peek; usageKey?: string }) {
  const badgeRef = useRef<{ name: string; rect: DOMRect } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [badge, setBadge] = useState<{ name: string; rect: DOMRect } | null>(null);
  const [open, setOpen] = useState<{ name: string; rect: DOMRect; uses: Use[] } | null>(null);
  const hide = useRef(0);
  useEffect(() => {
    let frame = 0;
    const move = (e: PointerEvent) => {
      const el = e.target as Element;
      if (el.closest?.('.sym-badge, .sym-pop, .spec-peek')) return clearTimeout(hide.current);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const hit = el.closest?.('.diff td.code, .diff span.code') && wordAt(e.clientX, e.clientY);
        if (hit && ix.symbols.has(hit.name)) {
          clearTimeout(hide.current);
          setBadge((b) => (b?.name === hit.name && b.rect.top === hit.rect.top && b.rect.left === hit.rect.left ? b : hit));
        } else {
          clearTimeout(hide.current);
          hide.current = setTimeout(() => setBadge(null), 250) as unknown as number;
        }
      });
    };
    const away = () => (setBadge(null), setOpen(null));
    const click = (e: PointerEvent) => !(e.target as Element).closest?.('.sym-pop, .sym-badge, .spec-peek') && setOpen(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return away();
      // The list open: ↑/↓ move between its lines (the preview follows), Enter goes there.
      const list = popRef.current ? [...popRef.current.querySelectorAll<HTMLElement>('.sym-use, .sym-more')] : [];
      if (list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const at = list.indexOf(document.activeElement as HTMLElement);
        list[at < 0 ? (e.key === 'ArrowDown' ? 0 : list.length - 1) : (at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
        return;
      }
      const typing = (e.target as Element).closest?.('input, textarea, select, [contenteditable]');
      if (usageKey && e.key === usageKey && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && badgeRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        show(badgeRef.current);
        requestAnimationFrame(() => popRef.current?.querySelector<HTMLElement>('.sym-use')?.focus()); // from the keyboard, on its first line
      }
    };
    addEventListener('pointermove', move, { passive: true });
    addEventListener('scroll', away, { passive: true });
    addEventListener('pointerdown', click);
    addEventListener('keydown', key, true);
    return () => (cancelAnimationFrame(frame), clearTimeout(hide.current), removeEventListener('pointermove', move), removeEventListener('scroll', away), removeEventListener('pointerdown', click), removeEventListener('keydown', key, true));
  }, [ix, usageKey]);
  badgeRef.current = badge;

  const show = (b: { name: string; rect: DOMRect }) => setOpen({ ...b, uses: usesOf(b.name, ix.patches) });
  // From a little before its first mention, so a long line still shows it.
  const mark = (line: string, name: string) => {
    const at = line.search(new RegExp(`(?<![\\w$])${esc(name)}(?![\\w$])`));
    const text = at > 24 ? '…' + line.slice(at - 16) : line;
    return text.split(new RegExp(`((?<![\\w$])${esc(name)}(?![\\w$]))`)).map((p, i) => (i % 2 ? <mark>{p}</mark> : p));
  };
  const group = (title: string, list: Use[], name: string) =>
    list.length > 0 && (
      <>
        <div class="sym-group">{title}</div>
        {list.map((u) => (
          <button
            class={u.old ? 'sym-use old' : 'sym-use'}
            onClick={() => (peek?.out(), setOpen(null), setBadge(null), go(u.path, u.line, u.old))}
            onMouseEnter={() => !u.old && popRef.current && peek?.show({ path: u.path, line: u.line, go: () => (setOpen(null), go(u.path, u.line, false)) }, popRef.current)}
            onFocus={() => !u.old && popRef.current && peek?.show({ path: u.path, line: u.line, go: () => (setOpen(null), go(u.path, u.line, false)) }, popRef.current)}
            onMouseLeave={() => peek?.out()}
            title={`${u.path}:${u.line}`}
          >
            <span class="sym-at">{fileLabel(u.path)}:{u.line}</span>
            <code>{mark(u.text, name)}</code>
          </button>
        ))}
      </>
    );
  const pos = (r: DOMRect) => ({ left: `${Math.max(8, Math.min(r.left, innerWidth - 580))}px`, ...(r.bottom + 320 < innerHeight ? { top: `${r.bottom + 4}px` } : { bottom: `${innerHeight - r.top + 4}px` }) });
  return (
    <>
      {badge && !open && (
        <button
          class="sym-badge"
          style={{ left: `${badge.rect.right + 2}px`, top: `${badge.rect.top - 10}px` }}
          title={`Where ${badge.name} is declared and used in this ${pageTerm().PR}`}
          onPointerEnter={() => clearTimeout(hide.current)}
          onClick={() => show(badge)}
        >
          <Octicon name="list-unordered" size={10} />
        </button>
      )}
      {open && (() => {
        const decl = open.uses.filter((u) => u.decl && !u.spec);
        const code = open.uses.filter((u) => !u.spec);
        const used = code.filter((u) => !u.decl && !u.old && !u.imp);
        const imported = code.filter((u) => !u.decl && !u.old && u.imp);
        const specs = open.uses.filter((u) => u.spec);
        const gone = open.uses.filter((u) => u.old);
        return (
          <div class="sym-pop" ref={popRef} style={pos(open.rect)}>
            <div class="sym-h">
              <code>{open.name}</code> <small>in this {pageTerm().PR}'s changes, matched by name</small>
            </div>
            <div class="sym-list">
              {group('Declared', decl, open.name)}
              {group(used.length ? `Used (${used.length})` : 'Used', used, open.name)}
              {!used.length && <p class="note">Not used anywhere else in this {pageTerm().PR}'s changes.</p>}
              {group(`Imported (${imported.length})`, imported, open.name)}
              {group('Named in specs', specs, open.name)}
              {group('Removed', gone, open.name)}
            </div>
            <a class="sym-more" href={repoSearch(open.name)} target="_blank" rel="noopener">
              Search the repo for {open.name}
            </a>
          </div>
        );
      })()}
    </>
  );
}
