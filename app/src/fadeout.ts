// Menus, panels and toasts leave as they came: a short fade, not a cut. When one is taken out of the page, a copy of it
// (inert, hidden from screen readers, not clickable) stands where it was for the fade, then goes. One place for every
// menu, instead of each keeping itself on screen while it closes. Skipped with reduced motion.
const LEAVES = '.account-menu, .pill-pop, .panel, .cmd-list, .quick-menu, .whats-new, .select-menu, .toast';

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  new MutationObserver((records) => {
    if (still.matches) return;
    for (const r of records)
      for (const n of r.removedNodes) {
        if (!(n instanceof HTMLElement) || n.isConnected || !r.target.isConnected || !n.matches(LEAVES) || n.classList.contains('leaving')) continue;
        const ghost = n.cloneNode(true) as HTMLElement;
        ghost.classList.add('leaving');
        ghost.inert = true;
        ghost.setAttribute('aria-hidden', 'true');
        for (const e of [ghost, ...ghost.querySelectorAll('[id]')]) e.removeAttribute('id');
        const next = r.nextSibling?.parentNode === r.target ? r.nextSibling : null;
        r.target.insertBefore(ghost, next);
        const up = ghost.classList.contains('toast') ? '0 6px' : '0 -4px';
        ghost.animate([{ opacity: 1 }, { opacity: 0, translate: up }], { duration: 100, easing: 'ease-in', fill: 'forwards' }).finished.finally(() => ghost.remove());
      }
  }).observe(document.body, { childList: true, subtree: true });
}

// A sidebar (the PR list, a PR's index) too short to scroll doesn't hand the trackpad to the page behind it: WebKit
// passes a scroll on from a box with nothing to scroll even with overscroll-behavior (style.css .side-scroll), which
// covers one that does scroll. Anything inside it that scrolls on its own (a picker's list) still does.
addEventListener(
  'wheel',
  (e) => {
    const side = (e.target as Element).closest?.('.side-scroll');
    if (!side || side.scrollHeight > side.clientHeight + 1) return;
    for (let el = e.target as Element | null; el && el !== side; el = el.parentElement) if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return;
    e.preventDefault();
  },
  { passive: false },
);
