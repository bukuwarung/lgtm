// A dropdown in LGTM's own look, open as well as closed: <select> opens macOS's own menu, unlike every other menu here.
// Written as a <select> is (value, onChange reading e.currentTarget.value, <option> and <optgroup> children), so it
// swaps in for one. Its list opens over everything (on the page's body, or the open dialog's), below the button or
// above it when there's more room there; keys as a select's: ↑ ↓ Home End to move, Enter or Space to pick, Esc or Tab
// to close, a letter to jump.
import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Octicon } from './tags.tsx';

type Opt = { value: string; label: ComponentChildren; text: string; disabled?: boolean; group?: string };
const textOf = (c: ComponentChildren): string =>
  toChildArray(c).map((x) => (typeof x === 'object' ? textOf((x as VNode<{ children?: ComponentChildren }>).props.children) : String(x))).join('');
const optionsOf = (children: ComponentChildren, group?: string): Opt[] =>
  toChildArray(children).flatMap((c) => {
    if (typeof c !== 'object') return [];
    const v = c as VNode<{ value?: string; label?: string; disabled?: boolean; children?: ComponentChildren }>;
    if (v.type === 'optgroup') return optionsOf(v.props.children, v.props.label);
    if (v.type !== 'option') return [];
    const text = textOf(v.props.children);
    return [{ value: v.props.value ?? text, label: v.props.children, text, disabled: v.props.disabled, group }];
  });

type Props = {
  value?: string;
  onChange?: (e: { currentTarget: { value: string } }) => void;
  children: ComponentChildren;
  title?: string;
  class?: string;
  disabled?: boolean;
  'aria-label'?: string;
};

export function Select({ value, onChange, children, title, class: cls, disabled, 'aria-label': label }: Props) {
  const opts = optionsOf(children);
  const cur = opts.find((o) => o.value === (value ?? '')) ?? opts[0];
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  // The highlight as of the last key, not the last draw: ↓ then Enter faster than a redraw picks the one moved to.
  const hiNow = useRef(0);
  const moveHi = (to: number | ((h: number) => number)) => setHi((h) => (hiNow.current = typeof to === 'function' ? to(hiNow.current) : to));
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number; minWidth: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const placed = useRef({ x: 0, y: 0 }); // where the button was when it opened

  const show = () => {
    const r = btn.current!.getBoundingClientRect();
    placed.current = { x: r.left, y: r.top };
    const below = innerHeight - r.bottom - 8, above = r.top - 8;
    const up = below < 240 && above > below;
    setAt({ left: Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 160) - 8)), ...(up ? { bottom: innerHeight - r.top + 4 } : { top: r.bottom + 4 }), minWidth: r.width, maxHeight: Math.min(360, up ? above : below) });
    moveHi(Math.max(0, cur ? opts.indexOf(cur) : 0));
    setOpen(true);
    btn.current!.focus({ preventScroll: true }); // a click doesn't focus a button in WebKit: the keys (Esc, ↑ ↓) go to it
  };
  const close = (refocus = true) => (setOpen(false), refocus && btn.current?.focus());
  const pick = (o: Opt) => {
    if (o.disabled) return;
    close();
    if (o.value !== cur?.value) onChange?.({ currentTarget: { value: o.value } });
  };
  const step = (from: number, by: number) => {
    for (let i = from + by; i >= 0 && i < opts.length; i += by) if (!opts[i].disabled) return i;
    return from;
  };

  // Closes when the page scrolls the button away or resizes (it's placed where the button was), or on a click elsewhere.
  // A scroll that leaves the button where it was is no reason: WebKit fires a scroll's event a frame late, so one
  // finished just before opening (a click straight after scrolling) closed it again, and the next ↓ reopened it.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !btn.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node) && setOpen(false);
    const gone = (e: Event) => {
      const r = btn.current?.getBoundingClientRect();
      if (list.current?.contains(e.target as Node) || (r && Math.abs(r.left - placed.current.x) < 1 && Math.abs(r.top - placed.current.y) < 1)) return;
      setOpen(false);
    };
    const shut = () => setOpen(false);
    addEventListener('pointerdown', away, true);
    addEventListener('scroll', gone, true);
    addEventListener('resize', shut);
    return () => (removeEventListener('pointerdown', away, true), removeEventListener('scroll', gone, true), removeEventListener('resize', shut));
  }, [open]);
  // The highlight kept in sight by scrolling the list alone: scrollIntoView scrolls the page behind too, and that scroll
  // closes the list (gone, above), so a ↓ soon after reopened it and Enter picked what was already chosen.
  useEffect(() => {
    const l = list.current, o = open ? l?.querySelectorAll<HTMLElement>('[role=option]')[hi] : null;
    if (!l || !o) return;
    if (o.offsetTop < l.scrollTop) l.scrollTop = o.offsetTop;
    else if (o.offsetTop + o.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = o.offsetTop + o.offsetHeight - l.clientHeight;
  }, [open, hi]);

  const key = (e: KeyboardEvent) => {
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') (e.preventDefault(), show());
      return;
    }
    if (k === 'Escape') return void (e.preventDefault(), e.stopPropagation(), close()); // this menu only, not the panel it's in
    if (k === 'Tab') return close(false);
    if (k === 'ArrowDown' || k === 'ArrowUp') return void (e.preventDefault(), (hiNow.current = step(hiNow.current, k === 'ArrowDown' ? 1 : -1)), moveHi(hiNow.current));
    if (k === 'Home' || k === 'End') return void (e.preventDefault(), moveHi((hiNow.current = k === 'Home' ? step(-1, 1) : step(opts.length, -1))));
    if (k === 'Enter' || k === ' ') return void (e.preventDefault(), opts[hiNow.current] && pick(opts[hiNow.current]));
    if (k.length === 1 && !e.metaKey && !e.ctrlKey) {
      const t = typed.current;
      t.text = (Date.now() - t.at < 700 ? t.text : '') + k.toLowerCase();
      t.at = Date.now();
      const i = opts.findIndex((o) => !o.disabled && o.text.toLowerCase().startsWith(t.text));
      if (i >= 0) moveHi((hiNow.current = i));
    }
  };

  let group: string | undefined;
  const menu = open && at && (
    <div
      ref={list}
      class="select-menu"
      role="listbox"
      aria-label={label ?? title}
      style={{ left: at.left, top: at.top, bottom: at.bottom, minWidth: at.minWidth, maxHeight: at.maxHeight }}
      // A click here is the select's: not a click away from the panel or menu it's in (their own listeners are told so).
      onPointerDown={(e) => (e.stopPropagation(), e.preventDefault())}
    >
      {opts.map((o, i) => {
        const head = o.group !== group && o.group ? <div class="select-group">{o.group}</div> : null;
        group = o.group;
        return (
          <>
            {head}
            <div
              role="option"
              aria-selected={o === cur}
              aria-disabled={o.disabled || undefined}
              class={`select-opt${i === hi ? ' hi' : ''}${o.disabled ? ' off' : ''}`}
              onMouseEnter={() => !o.disabled && moveHi(i)}
              onClick={() => pick(o)}
            >
              <span class="select-tick">{o === cur && <Octicon name="check" />}</span>
              <span class="select-text">{o.label}</span>
            </div>
          </>
        );
      })}
    </div>
  );
  return (
    <>
      <button
        ref={btn}
        type="button"
        class={`select${cls ? ' ' + cls : ''}`}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close() : show())}
        onKeyDown={key}
      >
        {cur?.label}
      </button>
      {menu && createPortal(menu, (btn.current?.closest('dialog[open]') as HTMLElement | null) ?? document.body)}
    </>
  );
}
