// LGTM's own tooltips, for every title="" in the app (no screen changes): macOS's take a second, are small and grey,
// and write a shortcut as text. These show after 350ms (at once while moving between controls that have them), in the
// theme's colours, a trailing shortcut ("… (⌘K)") as keys. While one shows, its element's title waits in
// data-lgtm-title (so macOS's doesn't show too); one whose only name was its title keeps it as its aria-label.
// In the top layer (a popover), so it shows over open dialogs too.
const SHORTCUT = /\s\(((?:[⌘⇧⌥⌃]+\S{1,6})|[A-Za-z0-9?/.,[\]\\`]|Esc|Enter|Tab|Space|↵|⇧↵|[↑↓←→])\)$/;

let tip: HTMLDivElement | null = null;
let on: HTMLElement | null = null; // the element whose title is showing (or about to)
let timer = 0;
let warmUntil = 0; // shortly after one hid, the next shows at once, as macOS's do

function element() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'lgtm-tip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('popover', 'manual');
  document.body.append(tip);
  return tip;
}

function restore() {
  if (!on) return;
  const t = on.dataset.lgtmTitle;
  if (t != null) on.setAttribute('title', t);
  delete on.dataset.lgtmTitle;
  if (on.dataset.lgtmLabel != null) (on.removeAttribute('aria-label'), delete on.dataset.lgtmLabel);
  on = null;
}

// A click, a key or a scroll hides it; the title stays put away until the pointer leaves (else macOS's would show).
function hideTip() {
  clearTimeout(timer);
  if (tip?.matches(':popover-open')) {
    tip.hidePopover();
    warmUntil = Date.now() + 500;
  }
}
function hide() {
  hideTip();
  restore();
}

function show(el: HTMLElement, text: string) {
  const t = element();
  const m = text.match(SHORTCUT);
  t.replaceChildren(document.createTextNode(m ? text.slice(0, m.index) : text));
  if (m) {
    const k = document.createElement('kbd');
    k.textContent = m[1];
    t.append(' ', k);
  }
  if (!t.matches(':popover-open')) t.showPopover();
  const r = el.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
  const below = r.bottom + 6 + h <= innerHeight;
  t.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2))}px`;
  t.style.top = `${below ? r.bottom + 6 : Math.max(6, r.top - h - 6)}px`;
}

if (typeof document !== 'undefined') {
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as Element).closest?.('[title]:not([title=""]), [data-lgtm-title]') as HTMLElement | null;
    if (el === on) return;
    hide();
    if (!el || el.closest('.lgtm-tip')) return;
    const text = el.getAttribute('title') ?? '';
    if (!text.trim()) return;
    on = el;
    el.dataset.lgtmTitle = text;
    el.removeAttribute('title');
    if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) (el.setAttribute('aria-label', text), (el.dataset.lgtmLabel = ''));
    timer = window.setTimeout(() => on === el && el.isConnected && show(el, text), Date.now() < warmUntil ? 0 : 350);
  });
  document.addEventListener('mouseout', (e) => {
    if (on && !on.contains(e.relatedTarget as Node)) hide();
  });
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'scroll']) addEventListener(ev, hideTip, true);
  addEventListener('blur', hide);
}
