// Reactions on a PR, its comments and reviews, and hiding comments or dismissing reviews, as GitHub's page has them
// (GitHub only: lgtm.getSocial). Loaded in one ask for the page (loadSocial), kept here, and drawn where each one is.
import { useEffect, useRef, useState } from 'preact/hooks';
import { dismissReview, editHistory, getPageSocial, hideComment, isLab, setReaction, type Edit, type Social } from './github.ts';
import { lineDiff } from './diff.ts';
import { ask, askText, shownName } from './platform.ts';
import { Octicon, Time } from './tags.tsx';

export const EMOJI: [string, string][] = [['THUMBS_UP', '👍'], ['THUMBS_DOWN', '👎'], ['LAUGH', '😄'], ['HOORAY', '🎉'], ['CONFUSED', '😕'], ['HEART', '❤️'], ['ROCKET', '🚀'], ['EYES', '👀']];
const HIDE: [string, string][] = [['OFF_TOPIC', 'Off-topic'], ['OUTDATED', 'Outdated'], ['RESOLVED', 'Resolved'], ['DUPLICATE', 'Duplicate'], ['LOW_QUALITY', 'Low quality'], ['SPAM', 'Spam'], ['ABUSE', 'Abuse']];

let store = new Map<string, Social>();
const changed = () => dispatchEvent(new Event('lgtm:social'));
const toast = (text: string) => dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text, ms: 4000 } }));
const put = (id: string, s: Social) => ((store = new Map(store).set(id, s)), changed());

// The page's PR, comments and reviews, by node ID (local ones, still sending, have none); GitLab's from the MR.
export function loadSocial(repo: string, n: number, prNode: string, ids: (string | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x && /^[\w=+/-]{8,}$/.test(x)))];
  if (list.length || isLab(repo)) void getPageSocial(repo, n, prNode, list).then((m) => ((store = new Map([...store, ...m])), changed()), () => {});
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
  const who = (w: string[] = []) => (!s.me ? w : on ? [s.me, ...w.filter((x) => x !== s.me)] : w.filter((x) => x !== s.me));
  const groups = g ? s.groups.map((x) => (x === g ? { ...x, mine: on, n: x.n + (on ? 1 : -1), who: who(x.who) } : x)) : [...s.groups, { content, mine: true, n: 1, who: who() }];
  put(id, { ...s, groups });
  setReaction(s.target ?? id, content, on).catch((e) => (put(id, s), toast(`Couldn't react: ${e.message}`)));
}
async function hide(id: string, reason: string | null) {
  const s = store.get(id);
  if (!s) return;
  put(id, { ...s, hidden: reason ? reason.toLowerCase().replace(/_/g, '-') : null, canUnhide: !!reason || s.canUnhide });
  await hideComment(id, reason).catch((e) => (put(id, s), toast(`Couldn't ${reason ? 'hide' : 'unhide'} it: ${e.message}`)));
}
async function dismiss(id: string, who: string) {
  const r = await askText(`Dismiss @${who}'s review? Say why (they're told):`, 'Dismiss', 'Why…', undefined, true);
  if (!r?.text.trim()) return;
  await dismissReview(id, r.text.trim()).then(() => dispatchEvent(new Event('lgtm:refresh')), (e) => toast(`Couldn't dismiss it: ${e.message}`));
}

// Who left an emoji, as GitHub's tooltip has it: "You, Rina and 3 more reacted with 👍" (the first ten named).
const reactedBy = (g: Social['groups'][number], me: string | undefined, emoji: string) => {
  const names = [...(g.mine ? ['You'] : []), ...(g.who ?? []).filter((w) => w !== me).map((w) => shownName(w))].slice(0, Math.max(g.n, 0));
  const more = g.n - names.length;
  if (!names.length) return '';
  const list = more > 0 ? `${names.join(', ')} and ${more} more` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `${list} reacted with ${emoji}`;
};

// The emoji people left, mine marked: a click adds or takes back mine. Hovering one names who left it.
export function Reactions({ id }: { id?: string }) {
  const s = useSocial()(id);
  const shown = s?.groups.filter((g) => g.n > 0) ?? [];
  if (!id || !s || !shown.length) return null;
  return (
    <div class="reactions">
      {shown.map((g) => (
        ((e) => (
          <button class={g.mine ? 'reaction mine' : 'reaction'} aria-pressed={g.mine} disabled={!s.canReact} title={[reactedBy(g, s.me, e), s.canReact && (g.mine ? 'Click to take yours back' : 'Click to react with this too')].filter(Boolean).join('\n')} onClick={() => react(id, g.content)}>
            {e} {g.n}
          </button>
        ))(EMOJI.find(([c]) => c === g.content)?.[1] ?? g.content)
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

// What an edit changed, with two lines around each change; the unchanged runs between, one line saying how many.
const folded = (d: { kind: string; text: string }[] | null) =>
  d?.flatMap((l, k) => {
    const near = d.slice(Math.max(0, k - 2), k + 3).some((x) => x.kind !== ' ');
    if (near) return [l];
    const prevNear = k > 0 && d.slice(Math.max(0, k - 3), k + 2).some((x) => x.kind !== ' ');
    if (k > 0 && !prevNear) return []; // inside a run already counted
    let n = 0;
    while (k + n < d.length && !d.slice(Math.max(0, k + n - 2), k + n + 3).some((x) => x.kind !== ' ')) n++;
    return [{ kind: 'gap', text: `⋯ ${n} unchanged line${n === 1 ? '' : 's'}` }];
  }) ?? null;

// "edited", as GitHub marks a changed comment: a click lists its versions (who, when), and one picked shows what that
// edit changed, line by line against the version before it.
export function Edited({ id }: { id?: string }) {
  const s = useSocial()(id);
  const [list, setList] = useState<{ edits: Edit[]; total: number } | string | null>(null);
  const [pick, setPick] = useState(0);
  if (!id || !s?.edited) return null;
  const load = (open: boolean) => open && list == null && editHistory(id).then((h) => (setList(h), setPick(0)), (e) => setList(`Couldn't load the history: ${e.message}`));
  const edits = typeof list === 'object' && list ? list.edits : [];
  const e = edits[pick];
  const before = edits.slice(pick + 1).find((x) => x.text != null)?.text;
  const lines = e?.text == null ? null : e.created || before == null ? e.text.split('\n').map((text) => ({ kind: e.created ? ' ' : '+', text })) : folded(lineDiff(before.split('\n'), e.text.split('\n')));
  return (
    <details class="edited-pick" onToggle={(ev) => void load(ev.currentTarget.open)}>
      <summary title={`Edited${s.edited.by ? ` by ${shownName(s.edited.by)}` : ''} ${new Date(s.edited.at).toLocaleString()}`}>edited <Octicon name="chevron-down" /></summary>
      <div class="edited-menu" role="menu">
        {typeof list === 'string' ? <p class="warn">{list}</p> : !list ? <p class="note">Loading…</p> : (
          <>
            <p class="menu-h">Edited {list.total} time{list.total === 1 ? '' : 's'}</p>
            <div class="edited-list">
              {edits.map((x, k) => (
                <button role="menuitem" aria-pressed={k === pick} onClick={() => setPick(k)}>
                  <b>{shownName(x.by)}</b> {x.created ? 'created' : 'edited'} <Time at={x.at} />{x.text == null && <small> · deleted from the history</small>}
                </button>
              ))}
            </div>
            {lines && (
              <pre class="edited-diff">{lines.map((l) => <span class={l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : l.kind === 'gap' ? 'gap' : ''}>{l.text || ' '}</span>)}</pre>
            )}
          </>
        )}
      </div>
    </details>
  );
}

// ⋯ on a comment or review: hide it (with GitHub's reasons) or show it again, and dismiss a review that counts.
// onEdit, onDelete: where the comment can be (its own page's editor; deleting asks first). toIssue: a new issue or Jira
// ticket from it (GitHub's "Reference in new issue"), for anyone.
export function CommentMenu({ id, review, onEdit, onDelete, toIssue }: { id?: string; review?: { who: string }; onEdit?: () => void; onDelete?: () => void; toIssue?: () => void }) {
  const of = useSocial();
  const s = of(id);
  const ref = useRef<HTMLDetailsElement>(null);
  const edit = !!s?.canEdit && !!onEdit, del = !!s?.canDelete && !!onDelete;
  if (!id || !s || !(s.canHide || (s.hidden && s.canUnhide) || review || edit || del || toIssue)) return null;
  const close = () => ref.current && (ref.current.open = false);
  return (
    <details class="comment-menu" ref={ref} data-comment-menu>
      <summary class="copy-link" title="More" aria-label="More"><Octicon name="kebab-horizontal" /></summary>
      <div class="account-menu" role="menu">
        {edit && <button role="menuitem" data-edit onClick={() => (close(), onEdit!())}>Edit</button>}
        {toIssue && <button role="menuitem" onClick={() => (close(), toIssue())}>New issue or ticket…</button>}
        {del && <button role="menuitem" onClick={async () => (close(), (await ask("Delete this comment? It can't be undone.", 'Delete', true)) && onDelete!())}>Delete…</button>}
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
export const commentUnderMouse = underMouse; // h: a new issue or ticket from it (review.tsx)
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
const OPEN = '.react-pick[open], .comment-menu[open], .edited-pick[open]';
addEventListener('pointerdown', (e) => document.querySelectorAll<HTMLDetailsElement>(OPEN).forEach((d) => !d.contains(e.target as Node) && (d.open = false)));
addEventListener('keydown', (e) => e.key === 'Escape' && document.querySelectorAll<HTMLDetailsElement>(OPEN).forEach((d) => (d.open = false)));
// E: edit the comment under the mouse, when it's one I may.
export const editUnderMouse = () => {
  const b = underMouse()?.querySelector<HTMLButtonElement>('[data-comment-menu] [data-edit]');
  b?.click();
  return !!b;
};
