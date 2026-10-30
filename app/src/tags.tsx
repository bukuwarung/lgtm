import type { ComponentChildren } from 'preact';

import { OCTICONS } from './octicons.ts';

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
