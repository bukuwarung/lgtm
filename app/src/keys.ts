import { useStoredValue, words } from './platform.ts';

// The review page's single-key shortcuts, rebindable in Settings. A binding is the key's `KeyboardEvent.key`
// ("j", "J" for Shift+J, " " for Space). ⌘ shortcuts stay fixed: in the app they're the menu bar's.
export const ACTIONS = [
  ['nextFile', 'Next file', 'j'],
  ['prevFile', 'Previous file', 'k'],
  ['nextUnviewed', 'Next file not marked viewed', 'V'],
  ['nextThread', 'Next review thread', 'n'],
  ['prevThread', 'Previous review thread', 'p'],
  ['nextChange', 'Next change (across files)', 'd'],
  ['prevChange', 'Previous change', 'D'],
  ['viewed', 'Mark the current file viewed', 'v'],
  ['whitespace', words('Ignore whitespace on/off, on this PR'), 'w'],
  ['comment', 'Comment on the line under the mouse (or at the top of the view)', ' '],
  ['fileComment', 'Comment on the current file', 'c'],
  ['stackPrev', words('Previous PR in the stack'), '['],
  ['stackNext', words('Next PR in the stack'), ']'],
  ['index', 'Show / hide the index', 'i'],
  ['merge', words('Open / close the merge box (your PRs)'), 'm'],
  ['stack', "Open / close the stack's overview", 's'],
  ['githubDev', 'Open the file in view on github.dev', '.'],
  ['agents', 'Open / close the Agents menu (coding agents)', 'a'],
  ['docCode', 'Jump between the specs (Markdown) and the code', 'g'],
  ['usages', 'Where the function or class under the mouse is used', 'u'],
  ['threads', 'Hide / show the review threads in the diff (ones waiting on you stay)', 't'],
  ['myThreads', 'Your threads on their own, each with its code and what changed since', 'y'],
  ['prevCommit', 'Previous commit on its own (from all changes: the last one)', '<'],
  ['nextCommit', 'Next commit on its own (from all changes: the first; after the last, all changes again)', '>'],
  ['newCommits', 'The commits pushed since your last review, together', 'C'],
  ['revertCommit', words('Revert the commit on show on its own (your PR; asks first)'), 'Z'],
  ['quoteReply', 'Quote the text selected in a comment in a reply', 'Q'],
  ['fixedAll', words('Reply "Fixed in" and resolve every thread later commits changed (your PR)'), 'F'],
  ['agentSession', words("Open the PR's agent review session (Settings → Coding agents → Keep agent review sessions)"), 'W'],
  ['react', 'React 👍 to the comment under the mouse (again: take it back)', '+'],
  ['editComment', 'Edit your comment under the mouse', 'E'],
  ['commentMenu', 'The comment under the mouse: edit, delete, hide or dismiss it', 'H'],
  ['assign', words('Assign someone to the PR (the index)'), 'G'],
  ['label', words('Add a label to the PR (the index)'), 'l'],
  ['milestone', words("Set the PR's milestone (the index)"), 'M'],
  ['editPR', words("Edit the PR's title and description"), 'e'],
  ['projects', words('Add the PR to a GitHub Project, or set its Status there (the index)'), 'P'],
  ['linkIssue', words('Link an issue or a Jira ticket to the PR (the index)'), 'L'],
  ['newIssue', 'A new issue or Jira ticket from the comment under the mouse', 'h'],
  ['copyCheckout', words("Copy the PR's checkout command (gh pr checkout)"), 'Y'],
  ['openDiff', words('Open the PR as a .diff'), 'T'],
  ['openPatch', words('Open the PR as a .patch'), 'x'],
  ['rebaseUpdate', words('Update the branch with rebase (GitHub)'), 'I'],
  ['subscribe', words("Subscribe to or unsubscribe from the PR's notifications"), 'S'],
  ['lock', words("Lock or unlock the PR's conversation"), 'O'],
  ['ownFiles', 'Only the files you own (CODEOWNERS), or all files again', 'o'],
  ['finish', words('Open Finish review (Comment, on your own PRs)'), 'f'],
  ['approve', words('Open Finish review with Approve picked'), 'A'],
  ['browse', words('Browse: switch to a team, repository or person'), 'B'],
  ['prActions', words('PR actions: close, reopen, convert to draft'), 'X'],
  ['askQa', words('Ask QA on Slack (your PR, from the ⋯ menu)'), 'q'],
  ['ready', words('Ready for review (a draft you may change)'), 'R'],
  ['changeBase', words('Change the base branch'), 'b'],
  ['updateBranch', words("Update the branch with its base (when it's behind)"), 'U'],
  ['agentDraft', words("Next agent draft you haven't looked at (on it: ↵ keep, e edit, ⌫ drop)"), 'r'],
  ['nextPR', words('Next PR in the list'), 'J'],
  ['prevPR', words('Previous PR in the list'), 'K'],
  ['skip', words('Skip to the next PR (review mode)'), 'N'],
  ['help', 'Keyboard shortcuts', '?'],
] as const;
export type Action = (typeof ACTIONS)[number][0];
export type Bindings = Record<Action, string>;

export const FIXED: [string, string][] = [
  ['⌘↵', 'Finish review (submit inside the panel)'],
  ['⌘K', words('Go to a PR, file, thread or check, or do any action here by name')],
  ['⌘F', 'Find, in every file'],
  ['Esc', 'Close this help'],
];

// Keys a shortcut can't take: they already mean something on the page.
export const RESERVED = new Set(['Escape', 'Tab', 'Enter', 'Shift', 'Alt', 'Control', 'Meta', 'CapsLock']);

const DEFAULTS = Object.fromEntries(ACTIONS.map(([a, , k]) => [a, k])) as Bindings;

// Saved overrides on top of the defaults ("" = no key).
export function readBindings(raw: string): Bindings {
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

// The new overrides after binding `key` to `action`: an action that had this key loses it (shown as no key).
export function bind(b: Bindings, action: Action, key: string): Partial<Bindings> {
  const next: Bindings = { ...b, [action]: key };
  if (key) for (const [a] of ACTIONS) if (a !== action && next[a] === key) next[a] = '';
  return Object.fromEntries(ACTIONS.filter(([a]) => next[a] !== DEFAULTS[a]).map(([a]) => [a, next[a]]));
}

export function useBindings() {
  const [raw, setRaw] = useStoredValue('shortcuts', '{}');
  const b = readBindings(raw);
  return [b, (action: Action, key: string) => setRaw(JSON.stringify(bind(b, action, key))), () => setRaw('{}')] as const;
}

const NAMES: Record<string, string> = { ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫', Delete: '⌦' };
export const keyLabel = (k: string) => (k ? NAMES[k] ?? k : '—');
// The menu bar's form of a key ("Shift+V", "BracketLeft"), for the app's Go, Review and View menus; null: one it can't show.
const ACCEL: Record<string, string> = { ' ': 'Space', '[': 'BracketLeft', ']': 'BracketRight', '.': 'Period', ',': 'Comma', '/': 'Slash', '?': 'Shift+Slash', '<': 'Shift+Comma', '>': 'Shift+Period', '+': 'Shift+Equal', '=': 'Equal', '-': 'Minus' };
export const menuAccel = (k: string) => (!k ? null : ACCEL[k] ?? (/^[a-z0-9]$/.test(k) ? k.toUpperCase() : /^[A-Z]$/.test(k) ? `Shift+${k}` : null));
// "Ignore whitespace (w)" in tooltips, or nothing when the action has no key.
export const hint = (k: string) => (k ? ` (${keyLabel(k)})` : '');
