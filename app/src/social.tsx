// Reactions on a PR, its comments and reviews, and hiding comments or dismissing reviews, as GitHub's page has them
// (GitHub only: lgtm.getSocial). Loaded in one ask for the page (loadSocial), kept here, and drawn where each one is.
import { useEffect, useRef, useState } from 'preact/hooks';
import { dismissReview, getSocial, hideComment, isLab, setReaction, type Social } from './github.ts';
import { ask, askText } from './platform.ts';
import { Octicon } from './tags.tsx';

export const EMOJI: [string, string][] = [['THUMBS_UP', '👍'], ['THUMBS_DOWN', '👎'], ['LAUGH', '😄'], ['HOORAY', '🎉'], ['CONFUSED', '😕'], ['HEART', '❤️'], ['ROCKET', '🚀'], ['EYES', '👀']];
const HIDE: [string, string][] = [['OFF_TOPIC', 'Off-topic'], ['OUTDATED', 'Outdated'], ['RESOLVED', 'Resolved'], ['DUPLICATE', 'Duplicate'], ['LOW_QUALITY', 'Low quality'], ['SPAM', 'Spam'], ['ABUSE', 'Abuse']];

let store = new Map<string, Social>();
const changed = () => dispatchEvent(new Event('lgtm:social'));
const toast = (text: string) => dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text, ms: 4000 } }));
const put = (id: string, s: Social) => ((store = new Map(store).set(id, s)), changed());

// The page's PR, comments and reviews, by node ID (local ones, still sending, have none).
export function loadSocial(repo: string, ids: (string | undefined)[]) {
  if (isLab(repo)) return;
  const list = [...new Set(ids.filter((x): x is string => !!x && /^[\w=+/-]{8,}$/.test(x)))];
  if (list.length) void getSocial(list).then((m) => ((store = new Map([...store, ...m])), changed()), () => {});
}
export function useSocial() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = () => tick((x) => x + 1);
    addEventListener('lgtm:social', t);
    return () => removeEventListener('lgtm:social', t);
  }, []);
  return (id?: string) => (id ? store.get(id) : undefined);
}

// Mine on or off, shown at once and put back if GitHub says no.
export function react(id: string, content: string) {
  const s = store.get(id);
  if (!s?.canReact) return;
  const g = s.groups.find((x) => x.content === content);
  const on = !g?.mine;
  const groups = g ? s.groups.map((x) => (x === g ? { ...x, mine: on, n: x.n + (on ? 1 : -1) } : x)) : [...s.groups, { content, mine: true, n: 1 }];
  put(id, { ...s, groups });
  setReaction(id, content, on).catch((e) => (put(id, s), toast(`Couldn't react: ${e.message}`)));
}
async function hide(id: string, reason: string | null) {
  const s = store.get(id);
  if (!s) return;
  put(id, { ...s, hidden: reason ? reason.toLowerCase().replace(/_/g, '-') : null, canUnhide: !!reason || s.canUnhide });
  await hideComment(id, reason).catch((e) => (put(id, s), toast(`Couldn't ${reason ? 'hide' : 'unhide'} it: ${e.message}`)));
}
async function dismiss(id: string, who: string) {
  const r = await askText(`Dismiss @${who}'s review? It stops counting toward merging. Say why (they're told):`, 'Dismiss', 'Why…');
  if (!r?.text.trim()) return;
  await dismissReview(id, r.text.trim()).then(() => dispatchEvent(new Event('lgtm:refresh')), (e) => toast(`Couldn't dismiss it: ${e.message}`));
}

// The emoji people left, mine marked: a click adds or takes back mine.
export function Reactions({ id }: { id?: string }) {
  const s = useSocial()(id);
  const shown = s?.groups.filter((g) => g.n > 0) ?? [];
  if (!id || !s || !shown.length) return null;
  return (
    <div class="reactions">
      {shown.map((g) => (
        <button class={g.mine ? 'reaction mine' : 'reaction'} aria-pressed={g.mine} disabled={!s.canReact} title={g.mine ? 'Take yours back' : 'React with this too'} onClick={() => react(id, g.content)}>
          {EMOJI.find(([c]) => c === g.content)?.[1] ?? g.content} {g.n}
        </button>
      ))}
    </div>
  );
}
// The smiley in a comment's header: one to pick (+ for 👍 under the mouse).
export function ReactPick({ id }: { id?: string }) {
  const s = useSocial()(id);
  const pick = useRef<HTMLDetailsElement>(null);
  if (!id || !s?.canReact) return null;
  return (
    <details class="react-pick" ref={pick}>
      <summary class="copy-link" title="React" aria-label="React"><Octicon name="smiley" /></summary>
      <div class="react-menu" role="menu">
        {EMOJI.map(([c, e]) => (
          <button role="menuitem" aria-pressed={!!s.groups.find((g) => g.content === c)?.mine} title={c.toLowerCase().replace('_', ' ')} onClick={() => (react(id, c), pick.current && (pick.current.open = false))}>{e}</button>
        ))}
      </div>
    </details>
  );
}

// ⋯ on a comment or review: hide it (with GitHub's reasons) or show it again, and dismiss a review that counts.
export function CommentMenu({ id, review }: { id?: string; review?: { who: string } }) {
  const of = useSocial();
  const s = of(id);
  const ref = useRef<HTMLDetailsElement>(null);
  if (!id || !s || !(s.canHide || (s.hidden && s.canUnhide) || review)) return null;
  const close = () => ref.current && (ref.current.open = false);
  return (
    <details class="comment-menu" ref={ref} data-comment-menu>
      <summary class="copy-link" title="More" aria-label="More"><Octicon name="kebab-horizontal" /></summary>
      <div class="account-menu" role="menu">
        {review && <button role="menuitem" onClick={() => (close(), void dismiss(id, review.who))}>Dismiss review…</button>}
        {s.hidden && s.canUnhide && <button role="menuitem" onClick={() => (close(), void hide(id, null))}>Unhide</button>}
        {!s.hidden && s.canHide && (
          <>
            <p class="menu-h">Hide as</p>
            {HIDE.map(([r, label]) => <button role="menuitem" onClick={async () => (close(), (r !== 'SPAM' && r !== 'ABUSE') || (await ask(`Hide it as ${label.toLowerCase()}?`, 'Hide', true)) ? hide(id, r) : undefined)}>{label}</button>)}
          </>
        )}
      </div>
    </details>
  );
}

// The pointer, for the shortcuts that act on the comment under it.
let at = { x: -1, y: -1 };
addEventListener('mousemove', (e) => (at = { x: e.clientX, y: e.clientY }), { passive: true });
const underMouse = () => document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-social]') ?? null;
// +: 👍 on the comment under the mouse; again, mine taken back.
export const reactUnderMouse = () => {
  const el = underMouse();
  if (el?.dataset.social) react(el.dataset.social, 'THUMBS_UP');
  return !!el;
};
// H: its ⋯ menu, opened.
export const menuUnderMouse = () => {
  const d = underMouse()?.querySelector<HTMLDetailsElement>('[data-comment-menu]');
  if (!d) return false;
  d.open = true;
  setTimeout(() => d.querySelector<HTMLElement>('[role=menuitem]')?.focus(), 0);
  return true;
};
// The smiley's and ⋯'s menus close on a click elsewhere, Escape, or another one opening.
const OPEN = '.react-pick[open], .comment-menu[open]';
addEventListener('pointerdown', (e) => document.querySelectorAll<HTMLDetailsElement>(OPEN).forEach((d) => !d.contains(e.target as Node) && (d.open = false)));
addEventListener('keydown', (e) => e.key === 'Escape' && document.querySelectorAll<HTMLDetailsElement>(OPEN).forEach((d) => (d.open = false)));
