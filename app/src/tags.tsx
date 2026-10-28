import type { ComponentChildren } from 'preact';

// Line icons for tags and pills (16×16, drawn in the text's colour). A name that isn't here is shown as it is (✳, ⏱).
const ICONS: Record<string, string> = {
  added: 'M8 3.5v9M3.5 8h9',
  modified: 'M10.5 3.5l2 2L6 12H4v-2z',
  changed: 'M10.5 3.5l2 2L6 12H4v-2z',
  removed: 'M3.5 8h9',
  renamed: 'M3 8h9.5M9.5 5l3 3-3 3',
  copied: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  test: 'M6 2h4M7 2v4l-3.5 6.5a1 1 0 0 0 .9 1.5h7.2a1 1 0 0 0 .9-1.5L9 6V2M5 10h6',
  notest: 'M6 2h4M7 2v4l-3.5 6.5a1 1 0 0 0 .9 1.5h7.2a1 1 0 0 0 .9-1.5L9 6V2M2 2l12 12',
  fail: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  ci: 'M6 2h4v2H6zM4.5 3H3.5v11h9V3h-1M6.25 7.25l3.5 3.5M9.75 7.25l-3.5 3.5', // a clipboard with ✕: checks failed
  approved: 'M3.5 8.5l3 3 6-7',
  changes: 'M8 3v6M8 12.5v.5',
  waiting: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 9.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z',
  reply: 'M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z',
  again: 'M13 8a5 5 0 1 1-1.6-3.7M13.2 2.2v3h-3',
  nobody: 'M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13.5c.5-2.5 2.5-4 5-4s4.5 1.5 5 4M2 2l12 12',
  conflict: 'M8 2.5l6 11H2zM8 6.5v3M8 11.5v.2',
  draft: 'M4 2.5h5l3 3v8H4zM9 2.5v3h3',
  assigned: 'M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 13.5c.4-2.3 2.2-3.8 4.5-3.8M10 10.5h4.5M12.5 8.5l2 2-2 2',
  merge: 'M4.5 2.5v11M4.5 6c0 4 7 2.5 7 7.5',
  behind: 'M8 3v9.5M4.5 9l3.5 3.5L11.5 9',
  aging: 'M4 2.5h8M4 13.5h8M5 2.5c0 3 6 3 6 5.5S5 10.5 5 13.5M11 2.5c0 3-6 3-6 5.5s6 2.5 6 5.5', // an hourglass
  auto: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3l2 1.5',
  unsent: 'M10.5 3.5l2 2L6 12H4v-2zM2.5 14h11',
};

export const TagIcon = ({ i }: { i: string }) =>
  ICONS[i] ? (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d={ICONS[i]} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  ) : (
    <>{i}</>
  );

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
