import type { ComponentChildren } from 'preact';
import { AGENTS, type AgentId } from './agents.ts';

import { OCTICONS } from './octicons.ts';
import { useAppDark } from './mdthemes.ts';
import { ago, copyText, useStoredFlag, faceOf, shownName } from './platform.ts';
import { useState } from 'preact/hooks';
import type { Thread } from './github.ts';
import { commonIndent, parsePatch, type Line } from './diff.ts';
import { highlightCode, languageFor, splitLines } from './highlight.ts';

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
  waiting: 'clock',
  reply: 'comment',
  skipped: 'skip',
  again: 'sync',
  nobody: 'person/',
  conflict: 'alert',
  draft: 'git-pull-request-draft',
  assigned: 'person',
  opened: 'git-pull-request',
  people: 'people',
  merge: 'git-merge',
  behind: 'arrow-down',
  pushed: 'repo-push',
  mention: 'mention',
  ws: 'eye/',
  view: 'eye',
  deploy: 'link-external',
  history: 'history',
  commit: 'git-commit',
  aging: 'hourglass',
  auto: 'git-merge-queue',
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
  i === '✳' ? <AgentMark id="claude" /> : i in AGENTS ? <AgentMark id={i as AgentId} /> : ICONS[i] ? <Octicon name={ICONS[i].replace('/', '')} slash={ICONS[i].endsWith('/')} /> : <>{i}</>;

// A coding agent's official mark (agents.ts), at the text's size.
export const AgentMark = ({ id }: { id: AgentId }) => (
  <svg class="agent-mark" viewBox="0 0 24 24" aria-label={AGENTS[id].name} role="img" style={AGENTS[id].color ? { fill: AGENTS[id].color } : undefined}>
    <path d={AGENTS[id].mark} fill-rule="evenodd" />
  </svg>
);

// A tag's or pill's contents: its icon, any number (always shown) and its words, shown as text, icons or both (Settings →
// Appearance; style.css hides one or the other). The icon carries the words on hover for when they're hidden.
export function Tg({ i, t, n }: { i: string | ComponentChildren; t?: string; n?: string | number }) {
  return (
    <>
      <span class="ti" title={[n, t].filter((x) => x != null && x !== '').join(' ') || undefined}>
        {typeof i === 'string' ? <TagIcon i={i} /> : i}
      </span>
      {n != null && <span class="tn" title={t ? `${n} ${t}` : undefined}>{n}</span>}
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
  <span class="who" title={shownName(login) !== login ? `@${login}` : undefined}>
    <img class="who-av" src={src ?? faceOf(login)} alt="" loading="lazy" />
    {shownName(login)}
    <BotMark login={login} />
  </span>
);
// A bot's mark beside its name (shown without GitHub's "[bot]", as GitHub shows it).
export const BotMark = ({ login }: { login: string }) => (login.endsWith('[bot]') ? <span class="who-bot" title={`@${login}`} aria-label="(a bot)"><Octicon name="dependabot" /></span> : null);

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

// A page or list with nothing in it, or that couldn't load: an icon, one line, and its action as a button.
// An action is a button, or (a URL) a link out, opened as any link here is (the app: in your browser).
const openOut = (href: string) => {
  const a = Object.assign(document.createElement('a'), { href, target: '_blank', rel: 'noopener' });
  document.body.append(a);
  a.click();
  a.remove();
};
// A failed load's one way out: Retry, or, with a GitHub limit used up (Retry does nothing until it resets), what used it.
export const errorAction = (err: string, retry: () => void): [string, () => void] =>
  /limit is used up until|rate-limited LGTM until/.test(err) ? ['What used it', () => void (location.hash = '/settings')] : ['Retry', retry];
export const Empty = ({ icon = 'check', tone, children, action }: { icon?: string; tone?: 'ok' | 'err'; children: ComponentChildren; action?: [string, (() => void) | string] }) => (
  <div class={`empty${tone ? ` empty-${tone}` : ''}`} role={tone === 'err' ? 'alert' : undefined}>
    <Octicon name={tone === 'err' ? 'alert' : icon} size={24} />
    <p>{children}</p>
    {action && <button type="button" onClick={() => (typeof action[1] === 'string' ? openOut(action[1]) : action[1]())}>{action[0]}</button>}
  </div>
);

// Numbers at a glance (the start page, Your reviews, a person's page): each a card, its number above its label. One that's
// nothing (0, –) is grey; one that asks something of you takes its colour. With onClick, a card opens what it counts.
export type Stat = { n: number | string; label: string; tone?: 'act' | 'ok' | 'bad'; title?: string; onClick?: () => void };
export const Stats = ({ items, cols = 3 }: { items: Stat[]; cols?: number }) => (
  <div class={`start-grid cols-${cols}`} style={{ '--cols': cols }}>
    {items.map((s) => {
      const cls = `start-card${s.n === 0 || s.n === '–' ? ' none' : s.tone ? ' ' + s.tone : ''}${s.onClick ? '' : ' still'}`;
      const body = <><b>{s.n}</b><span>{s.label}</span></>;
      return s.onClick ? <button class={cls} title={s.title} onClick={s.onClick}>{body}</button> : <div class={cls} title={s.title}>{body}</div>;
    })}
  </div>
);

// LGTM's icon as the app is now, light or dark (the Dock's own follows macOS's icon style instead).
export const AppIcon = ({ size, alt = '' }: { size?: number; alt?: string }) => (
  <img src={useAppDark() ? '/app-icon-dark.png' : '/app-icon.png'} alt={alt} width={size} height={size} />
);

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

// The lines a review thread is on: the end of the diff its first comment was written on (as GitHub's thread shows),
// the commented lines and a few above them, drawn as the diff draws code. The inbox's, and the PR page's Your threads.
export function ThreadCode({ t }: { t: Thread }) {
  const hunk = t.hunk?.nodes[0]?.diffHunk;
  if (!hunk || t.subjectType === 'FILE') return null; // on a whole file: no lines to show
  const lines = parsePatch(hunk).flatMap((h) => h.lines);
  const to = t.originalLine ?? t.line, from = t.originalStartLine ?? t.startLine ?? to;
  return <CodeSnippet lines={lines.slice(-Math.min(12, Math.max(4, to && from ? to - from + 1 : 1)))} path={t.path} hit={(l) => !!to && !!from && ((n) => n != null && n >= from && n <= to)(t.diffSide === 'LEFT' ? l.old : l.new)} />;
}
// A few lines of a diff: one line-number column, the language's colours, the shared indent dropped; hit: the lines a
// comment is on.
export function CodeSnippet({ lines, path, hit }: { lines: Line[]; path: string; hit: (l: Line) => boolean }) {
  const indent = commonIndent(lines.map((l) => l.text));
  const lang = languageFor(path);
  const text = lines.map((l) => l.text.slice(indent)).join('\n');
  const html = lang ? splitLines(highlightCode(text, lang)) : text.split('\n').map((l) => l.replace(/[&<>]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt' }[c]};`));
  return (
    <div class="snippet">
      <table class="diff">
        <tbody>
          {lines.map((l, i) => (
            <tr class={`ln${l.kind === '+' ? ' a' : l.kind === '-' ? ' d' : ''}${hit(l) ? ' hit' : ''}`}>
              <td class="num">{l.kind === '-' ? l.old : l.new}</td>
              <td class="code" dangerouslySetInnerHTML={{ __html: html[i] || ' ' }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Jira's mark (simple-icons, CC0), for what links a Jira ticket: in Jira's blue, lighter on dark.
export const JiraMark = () => (
  <svg class="jira-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z" /></svg>
);
