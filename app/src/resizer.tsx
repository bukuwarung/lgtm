import { useEffect, useRef } from 'preact/hooks';

// Drag handle on a sidebar's right edge. The width lives in a CSS variable on <html> (`--<name>-w`, read by
// the grid) and in localStorage. Double-click resets; arrow keys resize when focused.
export function Resizer({ name, label, min = 160, max = 720 }: { name: string; label: string; min?: number; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const cssVar = `--${name}-w`;
  const key = `width:${name}`;

  const set = (width: number, save = false) => {
    const w = Math.round(Math.min(max, Math.max(min, width)));
    document.documentElement.style.setProperty(cssVar, `${w}px`);
    if (save)
      try {
        localStorage.setItem(key, String(w));
      } catch {
        // not remembered
      }
  };

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      if (saved) set(saved);
    } catch {
      // default width
    }
  }, []);

  const left = () => ref.current!.parentElement!.getBoundingClientRect().left;

  return (
    <div
      ref={ref}
      class="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        const x0 = left();
        el.setPointerCapture(e.pointerId);
        document.body.classList.add('resizing');
        const move = (ev: PointerEvent) => set(ev.clientX - x0);
        const up = (ev: PointerEvent) => {
          set(ev.clientX - x0, true);
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          document.body.classList.remove('resizing');
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
      onDblClick={() => {
        document.documentElement.style.removeProperty(cssVar);
        try {
          localStorage.removeItem(key);
        } catch {
          // nothing stored
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const width = ref.current!.parentElement!.getBoundingClientRect().width;
        set(width + (e.key === 'ArrowLeft' ? -16 : 16), true);
      }}
    />
  );
}
