import type { ComponentChildren } from 'preact';

import { OCTICONS } from './octicons.ts';
import { ago, copyText, useStoredFlag, faceOf } from './platform.ts';
import { useState } from 'preact/hooks';

// An Octicon, in the text's colour; `slash` strikes it through (no person, no test change).
export function Octicon({ name, size = 12, slash, class: cls }: { name: string; size?: number; slash?: boolean; class?: string }) {
  return (
    <svg class={cls ? `octicon ${cls}` : 'octicon'} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      {OCTICONS[name].map((d) => (
        <path d={d} fill="currentColor" />
      ))}
      {slash && <path d="M1.5 1.5l13 13" stroke="var(--slash-gap, var(--bg))" stroke-width="3.5" />}
      {slash && <path d="M1.5 1.5l13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />}
    </svg>
  );
}

// A check's state as GitHub shows it: ✓ passed, ✕ failed, • running, skipped.
const CHECK: Record<string, string> = { success: 'check', failure: 'x', pending: 'dot-fill', neutral: 'skip' };
export const CheckMark = ({ state, title }: { state: 'success' | 'failure' | 'pending' | 'neutral'; title?: string }) => (
  <span class={`ck ck-${state}`} title={title}>
    <Octicon name={CHECK[state]} />
  </span>
);

// Each tag's or pill's Octicon (a "/" suffix strikes it through). A name that isn't here is shown as it is (✳).
const ICONS: Record<string, string> = {
  qa: 'beaker',
  added: 'diff-added',
  modified: 'diff-modified',
  changed: 'diff-modified',
  removed: 'diff-removed',
  renamed: 'diff-renamed',
  copied: 'copy',
  test: 'beaker',
  notest: 'beaker/',
  ci: 'x-circle',
  fail: 'git-pull-request-closed',
  approved: 'check',
  changes: 'file-diff',
  waiting: 'eye',
  reply: 'comment',
  skipped: 'skip',
  again: 'sync',
  nobody: 'person/',
  conflict: 'alert',
  draft: 'git-pull-request-draft',
  assigned: 'person',
  merge: 'git-merge',
  behind: 'arrow-down',
  pushed: 'repo-push',
  mention: 'mention',
  ws: 'eye/',
  history: 'history',
  aging: 'hourglass',
  auto: 'git-merge',
  queue: 'git-merge-queue',
  unsent: 'pencil',
  key: 'key',
  alert: 'alert',
  package: 'package',
  text: 'typography',
  '🔔': 'bell',
  '⏱': 'stopwatch',
};

export const TagIcon = ({ i }: { i: string }) =>
  ICONS[i] ? <Octicon name={ICONS[i].replace('/', '')} slash={ICONS[i].endsWith('/')} /> : <>{i}</>;

// A tag's or pill's contents: its icon, any number (always shown) and its words, shown as text, icons or both (Settings →
// Appearance; style.css hides one or the other). The icon carries the words on hover for when they're hidden.
export function Tg({ i, t, n }: { i: string | ComponentChildren; t?: string; n?: string | number }) {
  return (
    <>
      <span class="ti" title={[n, t].filter((x) => x != null && x !== '').join(' ') || undefined}>
        {typeof i === 'string' ? <TagIcon i={i} /> : i}
      </span>
      {n != null && <span class="tn">{n}</span>}
      {t && <span class="tt">{t}</span>}
    </>
  );
}

// A PR's review decision: its icon and words.
export const DECISION: Record<string, [string, string]> = {
  APPROVED: ['approved', 'approved'],
  CHANGES_REQUESTED: ['changes', 'changes requested'],
  REVIEW_REQUIRED: ['waiting', 'awaiting review'],
};

// A GitHub login with its avatar, wherever a person is named in a line of text.
export const Who = ({ login, src }: { login: string; src?: string }) => (
  <span class="who">
    <img class="who-av" src={src ?? faceOf(login)} alt="" loading="lazy" />
    {login}
  </span>
);

// When something happened: "2 hours ago", or the date and time (Settings → Appearance → Relative times); the other on hover.
export const exactTime = (at: string | number) => new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
export function Time({ at }: { at: string | number }) {
  const [relative] = useStoredFlag('relativeTimes', true);
  const iso = new Date(at).toISOString();
  return <time dateTime={iso} title={relative ? exactTime(at) : ago(at)}>{relative ? ago(at) : exactTime(at)}</time>;
}

// Something still loading: grey lines where it will be, as the rest of the app's placeholders (never a "Loading…").
export const Lines = ({ n = 3 }: { n?: number }) => (
  <div class="sk-lines" aria-busy="true" aria-label="Loading">
    {Array.from({ length: n }, (_, i) => <span class="sk" key={i} />)}
  </div>
);

// A count as your Mac writes numbers: 14,703.
export const num = (n: number) => n.toLocaleString();

// A branch name or commit SHA that copies on click (`text`: the whole of it, when what shows is shortened).
export function CopyCode({ children, text }: { children: string; text?: string }) {
  const [done, setDone] = useState(false);
  return (
    <code
      class={done ? 'copyable copied' : 'copyable'}
      title={done ? 'Copied' : `Copy ${text ?? children}`}
      onClick={(e) => (e.preventDefault(), e.stopPropagation(), copyText(text ?? children).then(() => (setDone(true), setTimeout(() => setDone(false), 1200)), () => {}))}
    >
      {children}
    </code>
  );
}

// After "Couldn't load …": fetch just that part again.
export const Retry = ({ onClick }: { onClick: () => void }) => (
  <button type="button" class="link retry" onClick={onClick}>Retry</button>
);

// A foldable section that keeps your choice, open or folded, from one PR to the next (`k` names it; `initial` until you
// choose). Opening one to jump into it counts as choosing.
export function Fold({ k, initial = true, class: cls, id, children }: { k: string; initial?: boolean; class?: string; id?: string; children: ComponentChildren }) {
  const [open, toggle] = useStoredFlag(`fold:${k}`, initial);
  return (
    <details class={cls} id={id} open={open} onToggle={(e) => e.currentTarget.open !== open && toggle()}>
      {children}
    </details>
  );
}

// Shown from an earlier copy while a fresh one loads, as the list and the PR page say it.
export const Updating = () => (
  <span class="updating" role="status"><span class="sk-dot" /> updating…</span>
);
