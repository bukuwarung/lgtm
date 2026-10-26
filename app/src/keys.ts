import { useStoredValue } from './platform.ts';

// The review page's single-key shortcuts, rebindable in Settings. A binding is the key's `KeyboardEvent.key`
// ("j", "J" for Shift+J, " " for Space). ⌘ shortcuts stay fixed: in the app they're the menu bar's.
export const ACTIONS = [
  ['nextFile', 'Next file', 'j'],
  ['prevFile', 'Previous file', 'k'],
  ['nextThread', 'Next review thread', 'n'],
  ['prevThread', 'Previous review thread', 'p'],
  ['viewed', 'Mark the current file viewed', 'v'],
  ['whitespace', 'Ignore whitespace on/off', 'w'],
  ['comment', 'Comment on the line under the mouse (or at the top of the view)', ' '],
  ['fileComment', 'Comment on the current file', 'c'],
  ['stackPrev', 'Previous PR in the stack', '['],
  ['stackNext', 'Next PR in the stack', ']'],
  ['index', 'Show / hide the index', 'i'],
  ['help', 'Keyboard shortcuts', '?'],
] as const;
export type Action = (typeof ACTIONS)[number][0];
export type Bindings = Record<Action, string>;

export const FIXED: [string, string][] = [
  ['⌘↵', 'Finish review (submit inside the panel)'],
  ['⌘K', 'Go to a PR, file, thread or check'],
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
// "Ignore whitespace (w)" in tooltips, or nothing when the action has no key.
export const hint = (k: string) => (k ? ` (${keyLabel(k)})` : '');
