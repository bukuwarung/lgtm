import { PROMPTS, fillPrompt, type PromptKind } from './prompts.ts';
import { labMe } from './gitlab.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { budgets, commitEmails, tokenScopes, getBudgets, getEmojis, getPeople, getRaw, getReviewQueue, getTeamMembers, getTeams, getGitHubViewer, listDir, spentThisHour } from './github.ts';
import { AgentMark, CheckMark, Octicon, Tg, Who, Lines } from './tags.tsx';
import { AGENTS, AGENT_IDS, EFFORT_NAME, effortsOf, modelsOf, agentEffort, agentModel, agentOn, detectAgents, setAgentEffort, setAgentModel, setAgentOn, useAgents, type AgentId } from './agents.ts';
import { personKey, viewAs, ask, useJiraStatuses, notify as sendNotification, ghAccount, getGhAccounts, getSlackEmoji, type GhAccount, askNotifications, agentSkill, type SkillStatus, useSavedReplies, type SavedReply, availableUpdate, copyDiagnostics, forgetKept, diagnostics, selfUpdate, UPGRADE, fetchIntegrations, restoreBackup, saveBackup, findSlackPeople, isDesktop, peopleSeen, launchAtLogin, setLaunchAtLogin, getSlackPeople, saveSlackPeople, useBots, useStoredFlag, useStoredValue, agentMod, MOD_INSTALL, CODEX_MOD_INSTALL, copyText, SLACK_CHANNEL, checkSlackChannel, type ChannelCheck, type Integrations, type SlackMatch, type SlackPeople, glabAccounts, type GlabAccount, term, teamLabel, loginEnding } from './platform.ts';
import { StatusSelect } from './merge.tsx';
import { estimateLabel, STEPS, stepOrder, stepIcon, type StepKey } from './files.ts';
import { ACTIONS, FIXED, keyLabel, RESERVED, useBindings, type Action } from './keys.ts';
import { DemoPair } from './demos.tsx';
import { SlackPreview } from './emojibox.tsx';
import { highlightCode } from './highlight.ts';
import { CODE_FONTS, CODE_DEFAULT, CODE_THEMES, TEXT_DEFAULT, useCodeLook, allThemes, saveTheme, setTrial } from './look.ts';
import { fromVSCode, fromVSCodeSet, fromZedFile, parseThemeFile, pickVariant, vsAppearance, withIncludes, type AppTheme } from './themes.ts';
import { ThemeThumb } from './themecard.tsx';
import { GENERIC_FONTS, MD_COLORS, MD_FONTS, MD_THEMES, loadMdFonts, mdStyleProps, useAppDark, useMdStyle, type MdColor, type MdStyle } from './mdthemes.ts';
import { md } from './markdown.ts';
import { EmojiTextarea, useSlackEmoji } from './emojibox.tsx';
import { fillSlack, prValues, QA_CHANNEL, slackParts, SLACK_FIELDS, SLACK_MESSAGES, type SlackKind } from './slackmsg.ts';

// The words of the site on show: GitHub's PRs and teams, or GitLab's MRs and groups (the avatar's menu; switching reloads).
const T = term();

// Shows every token the themes colour: keywords, annotations, types, strings, numbers, properties, named arguments,
// `it`, constants, comments, and ligatures (->, !=, ===).
const SAMPLE = `// Totals for the cart, in cents
@JvmStatic
fun total(items: List<Item>, fee: Int = 0): Long =
    items.filter { it.qty != 0 }.sumOf { it.price * it.qty } + fee
val label = "Total: \${format(total(cart.items, fee = MAX_FEE))}" // -> shown at checkout`;

export const THEMES = [['', 'Auto', '◐'], ['light', 'Light', '☀'], ['dark', 'Dark', '☾']] as const;

// The saved theme ('' = follow the system); index.html applies it before first paint, this keeps it applied.
export function useTheme() {
  const [theme, setTheme] = useStoredValue('theme', '');
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  return [theme, setTheme] as const;
}

// A switch; with an example (demos.tsx) it also shows what it does, the side you have now outlined. Children are
// sub-switches: indented under it, and greyed out while it's off.
// How added and removed lines are marked: filled (GitHub's way), a lighter tint, or just a bar at their left edge.
function LineStyle() {
  const [style, setStyle] = useStoredValue('lineStyle', 'subtle');
  return (
    <div class="set-row">
      <span>Changed lines</span>
      <span class="set-seg" role="radiogroup" aria-label="Changed line style">
        {([['fill', 'Fill'], ['subtle', 'Subtle'], ['bar', 'Bar']] as const).map(([v, name]) => (
          <button role="radio" aria-checked={style === v} class={style === v ? 'on' : ''} onClick={() => setStyle(v)}>
            <span class={`ln-sample ln-${v}`}><i class="d" /><i class="a" /></span> {name}
          </button>
        ))}
      </span>
    </div>
  );
}

// How changed words are marked: filled (GitHub's way), boxed, or a wavy underline like a typo's.
function WordStyle() {
  const [style, setStyle] = useStoredValue('wordStyle', 'squiggle');
  return (
    <div class="set-row">
      <span>Style</span>
      <span class="set-seg" role="radiogroup" aria-label="Word highlight style">
        {([['fill', 'Fill'], ['box', 'Box'], ['squiggle', 'Squiggle']] as const).map(([v, name]) => (
          <button role="radio" aria-checked={style === v} class={style === v ? 'on' : ''} onClick={() => setStyle(v)}>
            <span class={`wd-sample wd-${v}`}><mark class="wd-del">old</mark> <mark class="wd-add">new</mark></span> {name}
          </button>
        ))}
      </span>
    </div>
  );
}

// Tags and pills (a file's added / modified, a PR's "CI failing"…) as words, icons or both. Icons alone say their words
// on hover; numbers always show.
function TagStyle() {
  const [style, setStyle] = useStoredValue('tagStyle', 'icons');
  return (
    <div class="set-row">
      <span>
        Tags and pills
        <small>Like a file's <span class="st s-added"><Tg i="added" t="added" /></span> or a {T.PRs_} <span class="pill p-bad"><Tg i="ci" t="CI failing" /></span></small>
      </span>
      <span class="set-seg" role="radiogroup" aria-label="Tags and pills">
        {([['both', 'Icons and text'], ['icons', 'Icons'], ['text', 'Text']] as const).map(([v, name]) => (
          <button role="radio" aria-checked={style === v} class={style === v ? 'on' : ''} onClick={() => setStyle(v)}>
            {name}
          </button>
        ))}
      </span>
    </div>
  );
}

// The reading order's steps, dragged (or moved with the arrows) into the order you read in. Pointer events, not HTML
// drag and drop: the Mac app's web view takes drags as file drops.
function ReadingSteps() {
  const [saved, save] = useStoredValue('readingSteps', '');
  const order = stepOrder(saved);
  const latest = useRef(order);
  latest.current = order;
  const list = useRef<HTMLOListElement>(null);
  const [dragging, setDragging] = useState<StepKey | null>(null);
  const move = (k: StepKey, to: number) => {
    const next = latest.current.filter((x) => x !== k);
    next.splice(to, 0, k);
    if (next.join() !== latest.current.join()) save(next.join() === stepOrder('').join() ? '' : next.join());
  };
  // Held down on a row: it goes where the pointer is among the other rows, until let go.
  const grab = (k: StepKey) => (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('button') || list.current?.closest('fieldset')?.disabled) return;
    e.preventDefault();
    setDragging(k);
    const follow = (m: PointerEvent) => {
      const others = [...list.current!.children].filter((r) => (r as HTMLElement).dataset.k !== k);
      move(k, others.filter((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < m.clientY; }).length);
    };
    const drop = () => (setDragging(null), removeEventListener('pointermove', follow), removeEventListener('pointerup', drop), removeEventListener('pointercancel', drop));
    addEventListener('pointermove', follow);
    addEventListener('pointerup', drop);
    addEventListener('pointercancel', drop);
  };
  return (
    <>
      <ol class="set-steps" ref={list}>
        {order.map((k, i) => {
          const [, title, why] = STEPS.find(([x]) => x === k)!;
          return (
            <li key={k} data-k={k} class={dragging === k ? 'dragging' : ''} onPointerDown={grab(k)}>
              <span class="set-grip" aria-hidden="true">⠿</span>
              <Octicon name={stepIcon(k)} size={14} />
              <span>
                <b>{title}</b> <small>{why}{k === 'tests' && `: the ones whose code the ${T.PR} doesn't change (the rest sit below their code)`}</small>
              </span>
              <button class="link" disabled={!i} aria-label={`Move ${title} up`} onClick={() => move(k, i - 1)}>↑</button>
              <button class="link" disabled={i === order.length - 1} aria-label={`Move ${title} down`} onClick={() => move(k, i + 1)}>↓</button>
            </li>
          );
        })}
      </ol>
      {saved && <button onClick={() => save('')}>Back to the default order</button>}
    </>
  );
}

// How many automatic reviews a day, at most (agentreview.ts); ones you ask for don't count.
function AgentLimit() {
  const [limit, setLimit] = useStoredValue('agentReviewLimit', '20');
  return (
    <label class="set-row">
      <span>
        At most <input type="number" min={0} max={500} class="num-input" value={limit} onChange={(e) => setLimit(String(Math.max(0, Math.round(Number(e.currentTarget.value) || 0))))} /> a day
        <small>0: no limit. Reviews you ask for don't count.</small>
      </span>
    </label>
  );
}

// Which coding agent does the automatic review (agentreview.ts), among those on (Settings → Coding agents).
function AutoAgent() {
  const { on } = useAgents();
  const [pick, setPick] = useStoredValue('agentReviewAgent', '');
  if (!on.length) return <p class="note">No coding agent is on: install Claude Code or Codex, or switch one on under Coding agents.</p>;
  const cur = on.includes(pick as AgentId) ? pick : on[0];
  return (
    <label class="set-row">
      <span>
        Reviewed by{' '}
        <select value={cur} onChange={(e) => setPick(e.currentTarget.value)}>
          {on.map((a) => <option value={a}>{AGENTS[a].name}</option>)}
        </select>

      </span>
    </label>
  );
}

// Where the agent's findings go (agentreview.ts).
function AgentPost() {
  const [mode, setMode] = useStoredValue('agentReviewPost', 'pending');
  return (
    <div class="set-choices">
      <label class="set-row">
        <input type="radio" name="agentReviewPost" checked={mode !== 'comment'} onChange={() => setMode('pending')} />
        <span>As your pending review<small>Drafts you edit or drop; Finish review sends them.</small></span>
      </label>
      <label class="set-row">
        <input type="radio" name="agentReviewPost" checked={mode === 'comment'} onChange={() => setMode('comment')} />
        <span>As comments, posted at once</span>
      </label>
    </div>
  );
}

function Flag({ k, initial, label, hint, demo, children }: { k: string; initial: boolean; label: string; hint?: string; demo?: boolean; children?: preact.ComponentChildren }) {
  const [on, toggle] = useStoredFlag(k, initial);
  return (
    <div class={demo ? 'set-flag with-demo' : 'set-flag'}>
      <label class="set-row">
        <input type="checkbox" checked={on} onChange={toggle} />
        <span>
          {label}
          {hint && <small>{hint}</small>}
        </span>
      </label>
      {children && (
        <fieldset class="set-sub" disabled={!on}>
          {children}
        </fieldset>
      )}
      {demo && <DemoPair k={k} active={on} />}
    </div>
  );
}

// What's left of GitHub's hourly limits, and what used them this hour (github.ts budgets), every 30 seconds.
function ApiBudget() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const look = () => getBudgets().then(() => setTick((t) => t + 1), () => {});
    look();
    const t = setInterval(look, 30_000);
    return () => clearInterval(t);
  }, []);
  // Only when it matters: a limit down to a quarter (lgtm also says so, in a message, at a tenth).
  const rows = (['core', 'graphql'] as const).map((b) => [b, budgets.get(b)] as const).filter((x) => x[1] && x[1].remaining <= x[1].limit / 4);
  if (!rows.length) return null;
  const at = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const NAME = { core: 'REST', graphql: 'GraphQL' };
  return (
    <div class="api-budget">
      <span class="api-head">GitHub's hourly API limit is running low: lgtm stops asking GitHub when it's used up, until it resets.</span>
      {rows.map(([b, x]) => {
        const left = x!.remaining / x!.limit;
        const by = spentThisHour(b).filter(([what]) => what !== 'other').slice(0, 3);
        const tip = `${x!.remaining.toLocaleString()} of ${x!.limit.toLocaleString()} left this hour, until ${at(x!.reset)}${by.length ? `. Most used since lgtm opened: ${by.map(([what, n]) => `${what} (${n.toLocaleString()} ${b === 'graphql' ? 'point' : 'request'}${n === 1 ? '' : 's'})`).join(', ')}` : ''}`;
        return (
          <div class="api-row" title={tip}>
            <span class="api-name">{NAME[b]} requests</span>
            <span class="api-bar" role="meter" aria-valuemin={0} aria-valuemax={x!.limit} aria-valuenow={x!.remaining} aria-label={`${NAME[b]} left this hour`}>
              <i class={left <= 0.1 ? 'low' : left <= 0.5 ? 'mid' : ''} style={{ width: `${Math.max(1, left * 100)}%` }} />
            </span>
            <span class="api-left">
              {x!.remaining.toLocaleString()} of {x!.limit.toLocaleString()} left · resets {at(x!.reset)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Status({ ok, children }: { ok: boolean | null; children: preact.ComponentChildren }) {
  return (
    <div class="set-int">
      <CheckMark state={ok == null ? 'pending' : ok ? 'success' : 'failure'} />
      <div>{children}</div>
    </div>
  );
}

// Everything lgtm remembers, in one place, plus whether the tools it drives (gh, slackcli, acli) are signed in.
// Preferences live in this browser; changing one here updates the open views at once.
// Each section's icon in the list beside them (Octicons).
const SECTION_ICON: Record<string, string> = {
  Accounts: 'person',
  Slack: 'comment-discussion',
  'PR list': 'git-pull-request',
  Notifications: 'bell',
  Conversation: 'comment',
  'Coding agents': 'dependabot',
  Jira: 'book',
  Names: 'person',
  'Saved replies': 'reply',
  'Keyboard shortcuts': 'command-palette',
  'MR list': 'git-pull-request',
  'Time to review': 'stopwatch',
  Reviewing: 'eye',
  Diff: 'diff',
  Checks: 'alert',
  Android: 'device-mobile',
  'Java backend': 'stack',
  Web: 'code',
  App: 'gear',
  'Mac app': 'device-desktop',
  Appearance: 'paintbrush',
  'Markdown files': 'markdown',
  Backup: 'archive',
};

export function Settings() {
  const [theme, setTheme] = useTheme();
  const look = useCodeLook();
  // Search: keeps the sections that mention every word, and within them only the matching switches (a section whose
  // title matches stays whole).
  const [q, setQ] = useState('');
  const [found, setFound] = useState(true);
  const page = useRef<HTMLDivElement>(null);
  // The side panel: every section by its title (the ones search keeps), the one you're in marked.
  const [toc, setToc] = useState<{ id: string; name: string; sub: boolean }[]>([]);
  const [cur, setCur] = useState('');
  useLayoutEffect(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const has = (el: Element) => words.every((w) => (el.textContent ?? '').toLowerCase().includes(w));
    let any = false;
    for (const sec of page.current?.querySelectorAll<HTMLElement>(':scope > section') ?? []) {
      const whole = !words.length || has(sec.querySelector('h3') ?? sec);
      const items = [...sec.querySelectorAll<HTMLElement>(':scope > .set-flag, :scope > .set-row')];
      for (const it of items) it.hidden = !whole && !has(it);
      // A platform's subsection (Checks → Android…): all of it when its name matches, else its matching switches.
      for (const g of sec.querySelectorAll<HTMLElement>(':scope > .set-group')) {
        const all = whole || has(g.querySelector('h4') ?? g);
        for (const it of g.querySelectorAll<HTMLElement>(':scope > .set-flag, :scope > .set-row')) it.hidden = !all && !has(it);
        g.hidden = !all && !has(g);
      }
      sec.hidden = !whole && !has(sec);
      any ||= !sec.hidden;
    }
    setFound(any);
    const list = [...(page.current?.querySelectorAll<HTMLElement>(':scope > section:not([hidden])') ?? [])].flatMap((sec) => {
      const name = sec.querySelector(':scope > h3')?.textContent ?? '';
      if (!name) return [];
      sec.id ||= 'set-' + name.toLowerCase().replace(/\W+/g, '-');
      const subs = [...sec.querySelectorAll<HTMLElement>(':scope > .set-group:not([hidden])')].map((g) => {
        const n = g.querySelector(':scope > h4')?.textContent ?? '';
        g.id ||= 'set-' + n.toLowerCase().replace(/\W+/g, '-');
        return { id: g.id, name: n, sub: true };
      });
      return [{ id: sec.id, name, sub: false }, ...subs];
    });
    if (list.map((t) => t.id).join() !== toc.map((t) => t.id).join()) setToc(list);
  });
  useEffect(() => {
    const spy = () => {
      let c = '';
      for (const sec of page.current?.querySelectorAll<HTMLElement>(':scope > section[id]:not([hidden]), :scope > section > .set-group[id]:not([hidden])') ?? []) if (sec.getBoundingClientRect().top < innerHeight * 0.3) c = sec.id;
      setCur(c);
    };
    spy();
    addEventListener('scroll', spy, { passive: true });
    return () => removeEventListener('scroll', spy);
  }, []);
  const [keys] = useBindings();
  const also = (k: string) => (k ? `Also ${keyLabel(k)} on a ${T.PR}.` : undefined);
  const [team, setTeam] = useStoredValue('team', '');
  const [notify, toggleNotify] = useStoredFlag('notifyRequests', true);
  const [teams, setTeams] = useState<string[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [ints, setInts] = useState<Integrations | null>(null);
  const [err, setErr] = useState('');
  const [accounts, setAccounts] = useState<GhAccount[] | null>(null);
  const [glab, setGlab] = useState<GlabAccount[] | null>(null);
  useEffect(() => {
    glabAccounts(true).then(setGlab);
    getGitHubViewer().then(setMe, () => setMe(''));
    getGhAccounts().then(setAccounts, () => setAccounts([]));
    getTeams().then(setTeams, () => setTeams([]));
    fetchIntegrations().then(setInts, (e) => setErr(e.message));
  }, []);

  return (
    <div class="page settings" ref={page}>
      <nav class="set-toc" aria-label="Settings sections">
        {toc.map((t) => (
          <button class={`${cur === t.id ? 'on' : ''}${t.sub ? ' sub' : ''}`} onClick={() => document.getElementById(t.id)?.scrollIntoView({ block: 'start' })}>
            <Octicon name={SECTION_ICON[t.name] ?? 'gear'} /> {t.name}
          </button>
        ))}
      </nav>
      <div class="set-head">
        <h2>Settings</h2>
        <input type="search" class="set-search" placeholder="Search settings" value={q} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Search settings" />
      </div>
      {q && !found && <p class="note">No setting matches “{q}”.</p>}

      <section>
        <h3>Accounts</h3>
        <p class="note">lgtm uses these command-line tools' sign-ins and stores no tokens.</p>
        <Status ok={me == null ? null : !!me}>
          <b>GitHub</b> {me ? <>signed in as <code>@{me}</code> through the GitHub CLI</> : me === '' ? 'not signed in' : 'checking…'}
          {me === '' && <pre>gh auth login</pre>}
          {me && <ApiBudget />}
          {me && <MissingScopes />}
          {accounts && accounts.length > 1 ? (
            <label class="gh-account">
              Account lgtm uses{' '}
              <select
                value={ghAccount()}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (v) localStorage.setItem('ghAccount', v);
                  else localStorage.removeItem('ghAccount');
                  location.reload(); // everything loaded so far was as the other account
                }}
              >
                <option value="">gh's active one ({accounts.find((a) => a.active)?.login ?? '?'})</option>
                {accounts.map((a) => (
                  <option value={a.login}>{a.login}</option>
                ))}
              </select>
            </label>
          ) : (
            accounts?.length === 1 && (
              <small>
                More GitHub accounts: add them with <code>gh auth login</code>, then pick one here.
              </small>
            )
          )}
        </Status>
        <Status ok={glab == null ? null : glab.length > 0}>
          <b>GitLab</b> (merge requests){' '}
          {!glab ? 'checking…' : glab.length ? <>signed in through the GitLab CLI as {glab.map((a, k) => <>{k ? ', ' : ''}<code>@{a.login}</code> on {a.host}</>)}</> : 'not signed in'}
          {glab && !glab.length && <pre>brew install glab{'\n'}glab auth login</pre>}
          <small>Optional. Another host: <code>glab auth login --hostname gitlab.example.com</code>.</small>
        </Status>
        <Status ok={ints ? ints.slack.ok : null}>
          <b>Slack</b> (review DMs){' '}
          {!ints ? 'checking…' : ints.slack.ok ? <>signed in{ints.slack.who && <> as <code>{ints.slack.who}</code></>} through slackcli</> : <>not available: {ints.slack.error}</>}
          {ints && !ints.slack.ok && <pre>brew install shaharia-lab/tap/slackcli{'\n'}slackcli auth login-auto</pre>}
        </Status>
        <Status ok={ints ? ints.jira.ok : null}>
          <b>Jira</b> (ticket summaries){' '}
          {!ints ? 'checking…' : ints.jira.ok ? <>signed in{ints.jira.site && <> to <code>{ints.jira.site}</code></>} through the Atlassian CLI</> : <>not available: {ints.jira.error}</>}
          {ints && !ints.jira.ok && <pre>brew install atlassian/homebrew-acli/acli{'\n'}acli jira auth login --web</pre>}
        </Status>
        {err && <p class="error">Couldn't check Slack and Jira: {err}</p>}
        <div class="set-group">
          <h4>Names</h4>
        <Flag k="realNames" initial={false} label="Real names" hint="From GitHub profiles. The login shows on hover." demo>
          <Flag k="slackNames" initial={true} label="Use Slack names" hint="For people with no name on GitHub." demo />
        </Flag>
        {loginEnding() && (
          <Flag k="shortLogins" initial={false} label="Shorter logins" hint="jane_acme shows as jane. The full login shows on hover." demo />
        )}
          <Flag k="slackFaces" initial={true} label="Pictures from Slack" hint="For people with no GitHub picture." demo />
        </div>
      </section>

      <section>
        <h3>{T.PR} list</h3>
        <Flag k="showDrafts" initial={false} label={`Show other people's draft ${T.PRs}`} hint="Yours always show."  demo />
        <Flag k="hideEmptyGroups" initial={false} label="Hide empty groups" hint={`"Needs your review" says when it's clear, and a tab with nothing in it shows no 0.`} demo />
        <Flag k="gitlabTodoSync" initial={true} label="Mark GitLab to-dos done from the inbox" hint="Done in the inbox clears the to-do on GitLab too." />
        <Flag k="muteApproved" initial={true} label={`Mute replies and mentions on ${T.PRs} you've approved`} hint="While your latest review is an approval. New commits that dismiss it bring them back." demo />
        <label class="set-row">
          <span>
            {T.Team} to watch
            <small>For reviewer suggestions and Slack lookups.</small>
          </span>
          <select value={team} onChange={(e) => setTeam(e.currentTarget.value)}>
            <option value="">None</option>
            {((all) => all.map((t) => <option value={t}>{teamLabel(t, all)}</option>))([...new Set([...(team ? [team] : []), ...(teams ?? [])])])}
          </select>
        </label>
        <TimeToReview />
      </section>

      <section>
        <h3>Notifications</h3>
        <label class="set-row">
          <input
            type="checkbox"
            checked={notify}
            onChange={async () => {
              if (!notify && !(await askNotifications())) return setErr(isDesktop ? 'Notifications are off for lgtm in System Settings → Notifications.' : 'Notifications are blocked for this page in your browser settings.');
              toggleNotify();
            }}
          />
          <span>
            Desktop notifications
            <small>Review requests and re-reviews, plus what you pick below.</small>
          </span>
        </label>
        <fieldset class="set-sub" disabled={!notify}>
          <Flag k="notifySound" initial={true} label="Play a sound" />
          <button class="set-test" onClick={() => void sendNotification('lgtm', 'A test notification. Click it to come back to lgtm.', '')}>
            Send a test notification
          </button>
          <Flag k="notifyReplies" initial={true} label="New replies waiting for you" />
          <Flag k="notifyVerdicts" initial={true} label={`Your ${T.PR} approved, or changes requested`} />
          <Flag k="notifyCI" initial={true} label={`Your ${T.PRs_} checks passed or failed`} />
          <Flag k="notifyReady" initial={true} label={`Your ${T.PR} is ready to merge`} hint="Approved, checks green, no auto-merge. Opens the merge box." />
          <Flag k="notifyConflicts" initial={true} label={`Your ${T.PR} has conflicts`} />
          <Flag k="notifyMentions" initial={true} label={`Someone mentions you in a ${T.PR}`} />
          <Flag k="notifyQueue" initial={true} label={`Your ${T.PR} left the merge queue, or its auto-merge turned off`} />
          <Flag k="notifyAgents" initial={true} label="A coding agent finished" hint="While lgtm is in the background." />
        </fieldset>
      </section>

      <section>
        <h3>Reviewing</h3>
        <Flag k="showIndex" initial={true} label={`Show the ${T.PR} index beside the diff`} hint={also(keys.index)}  demo />
        <Flag k="hideIndexToReview" initial={true} label={`Hide the index on ${T.PRs} waiting for your review`} hint={keys.index ? `${keyLabel(keys.index)} shows it.` : undefined} demo />
        <Flag k="hideEmptyIndex" initial={true} label="Hide empty sections in the index" hint="Labels, assignees, milestone, checks. Icons at the top of the index add them." demo />
        <ViewedMarks />
        <Flag k="viewOnScroll" initial={false} label="Mark files viewed as you scroll past them" hint="Once a file has been on screen a few seconds and you've scrolled past its end. It stays open." demo />
        <Flag k="ignoreWs" initial={true} label="Ignore whitespace-only changes" hint={keys.whitespace ? `${keyLabel(keys.whitespace)} switches it on one ${T.PR}.` : undefined} demo />
        <Flag k="sinceFirst" initial={false} label="On a re-review, show only what changed since your last review" demo />
        <Flag k="readingOrder" initial={true} label="Files in reading order" hint="Off: by path. Drag the steps to reorder them." demo>
          <ReadingSteps />
        </Flag>
        <Flag k="gradleModules" initial={true} label="Group files by module" hint="Folders with their own build file: Gradle, npm, Go, Rust, Python."  demo />
        <Flag k="commentNow" initial={false} label="Post comments at once" hint="Off: they wait as drafts until Finish review."  demo />
        <Flag k="nextAfterReview" initial={true} label={`After a review, open the next ${T.PR} that needs it`} demo />
        <Flag k="viewAllOnSubmit" initial={false} label="After a review, mark the files you haven't viewed as viewed" demo />
        <Flag k="archiveOnApprove" initial={true} label={`After approving or merging, archive the ${T.PR}'s Codex conversation`} hint="Claude app sessions can't be archived from outside the app." demo />
        <Flag k="resumePosition" initial={false} label={`Reopen a ${T.PR} where you left off`} />
        <SavedReplies />
      </section>

      <section>
        <h3>Diff</h3>
        <Flag k="foldImports" initial={true} label="Fold package and import blocks" hint="Kotlin, Java, TypeScript, JavaScript. New packages are still named." demo />
        <Flag k="hideArchivedSpecs" initial={true} label="Hide archived specs" hint="Docs in archive folders, behind one row. Code there still shows." demo />
        <Flag k="hideGenerated" initial={true} label="Hide generated files" hint="Marked linguist-generated or linguist-binary in .gitattributes." demo />
        <Flag k="hideNoDiff" initial={true} label="Hide files renamed or moved without changes" demo />
        <Flag k="collapseDeleted" initial={true} label="Collapse deleted files to one row" demo />
        <Flag k="dimMoved" initial={true} label="Fold code moved without changes" hint="One row naming where it went." demo />
        <Flag k="symbolNav" initial={true} label="Where functions and classes are used" hint={`Point at a function or class the ${T.PR} declares: every line naming it, and a repo search.`} demo />
        <Flag k="oldLineNumbers" initial={false} label="Show old line numbers too"   demo />
        <Flag k="trimIndent" initial={true} label="Leave out the indentation a file's lines share" hint="More room for long lines. Copies and comments keep the real text."  demo />
        <Flag k="splitDiff" initial={false} label="Show diffs side by side" hint={`Also a button beside the ${T.PRs_} title.`}  demo />
        <Flag k="centerDiff" initial={true} label={`Centre the ${T.PR} at a comfortable width`} hint={`Also a button beside the ${T.PRs_} title.`} demo>
          <CenterCols />
          <Flag k="centerFit" initial={false} label="Fill the window when a line in the diff is wider than that"  demo />
        </Flag>
        <Flag k="diffSigns" initial={false} label="Show + and − before changed lines"   demo />
        <Flag k="fileFooter" initial={false} label="Show a bar at the end of each file" hint="Name, Comment and Viewed, as in the header."  demo />
        <Flag k="rainbowBrackets" initial={true} label="Rainbow brackets" hint="Coloured by depth, as in IntelliJ."  demo />
        <LineStyle />
        <Flag k="wordDiff" initial={true} label="Highlight the changed words inside a line" demo>
          <WordStyle />
        </Flag>
        <Flag k="renderDocs" initial={true} label="Render doc comments" hint="KDoc, Javadoc and JSDoc, like IntelliJ's reader mode." demo>
          <Flag k="renderEditedDocs" initial={true} label="Edited ones too" hint="Changes highlighted."  demo />
          <Flag k="renderLineComments" initial={true} label="Line comments too" hint="Runs of // or # lines. Commented-out code stays source." demo>
            <Flag k="renderSingleComments" initial={true} label="Single comment lines too"   demo />
          </Flag>
        </Flag>
        <Flag k="richMarkdown" initial={true} label="Show markdown files rendered" hint="Comment on any block. <> beside a file shows its source." demo>
          <Flag k="strikeRemoved" initial={false} label="Strike through removed text"   demo />
        </Flag>
        <Flag k="previewImages" initial={true} label="Show images and vector drawables as pictures" demo />
      </section>

      <section>
        <h3>Conversation</h3>
        <Flag k="hideSettled" initial={true} label="Hide resolved and outdated threads" hint="Unless you commented in them."  demo />
        <Flag k="foldBots" initial={true} label="Bot comments behind one line, bot-only threads folded" hint="CI reports and AI reviewers." demo>
          <Flag k="unfoldBotsOnMine" initial={true} label={`Except on your own ${T.PRs}`}  demo />
        </Flag>
        <Flag k="agentsAsBots" initial={true} label="Comments that open with 🤖 are a bot's" hint="Agents posting from people's accounts. They fold and never wait on you." demo />
      </section>

      {/* What lgtm looks for in a PR. Ones for one platform or framework get a section of their own, below. */}
      <section>
        <h3>Checks</h3>
        <p class="note">What lgtm points out in a {T.PR}, each a click from a comment. Turn off what's noise.</p>
        <Flag k="checkSecrets" initial={true} label="Possible secrets" hint="Keys, tokens and literal passwords in added lines. Placeholders and tests don't count."  demo />
        <Flag k="checkDeps" initial={true} label="Dependency changes" hint="Major jumps and unpinned versions marked."  demo />
        <Flag k="checkBinaries" initial={true} label="Binary files: what they are" hint="Kind, size and Git LFS; warns over 1 MB outside LFS."  demo />
        <Flag k="checkSuppressions" initial={true} label="Tests, CI and checks switched off" hint="Skipped tests (@Ignore, .skip…), CI let off (-DskipTests, continue-on-error…), silenced checks (@Suppress, eslint-disable, noqa…)." demo />
        <Flag k="checkProtections" initial={true} label="Protections switched off" hint="Unminified release builds, debuggable, plain HTTP, user certificates trusted, TLS checks off." demo />
        <Flag k="flagUntested" initial={true} label="Code changed without test changes" hint="By name: Foo.kt counts as tested if FooTest.kt changes too."  demo />
        <Flag k="reviewPlan" initial={false} label={`A review plan for big ${T.PRs}`} hint="50 files or more: the reading steps, each with how much is viewed."  demo />
        <div class="set-group">
          <h4>Android</h4>
        <Flag k="checkHardcoded" initial={true} label="UI text not in strings.xml" hint="android:text, Text(“…”), toasts, dialogs. Tests and previews don't count."  demo />
        <Flag k="checkRoom" initial={true} label="Room tables changed without a version bump" hint="Installed apps crash on update."  demo />
        <Flag k="manifestSummary" initial={true} label="What a manifest change means" hint="Permissions and components added, removed or exported."  demo />
        <Flag k="lintBaselines" initial={true} label="Lint baselines as suppressions" hint="What lint-baseline.xml newly hides, and stops hiding."  demo />
        <Flag k="stringsView" initial={true} label="strings.xml as names and texts" demo>
          <Flag k="translationChecks" initial={true} label="Check the other languages" hint="Missing, mismatched placeholders, or left stale in values-xx."  demo />
        </Flag>
        </div>
        <div class="set-group">
          <h4>Java backend</h4>
        <Flag k="checkMigrations" initial={true} label="Flyway migrations edited or out of order" hint="An applied one changed, or a new one not newer than the base branch's newest." demo />
        <Flag k="checkJpa" initial={true} label="JPA entities changed with no migration"  demo />
        <Flag k="checkTransactional" initial={true} label="@Transactional on a private method" hint="Spring skips it: no transaction." demo />
        </div>
        <div class="set-group">
          <h4>Web</h4>
        <Flag k="checkLockfile" initial={true} label="Lockfile not updated" hint="package.json changed but its lockfile didn't: npm ci fails." demo />
        <Flag k="checkFocused" initial={true} label="Focused tests and debugger left in" hint=".only (CI runs only those) and debugger statements." demo />
        <Flag k="checkRawHtml" initial={true} label="Raw HTML rendering" hint="v-html, dangerouslySetInnerHTML, innerHTML, document.write." demo />
        </div>
      </section>

      <section>
        <h3>Coding agents</h3>
        <CodingAgents />
        <Flag
          k="agentReview"
          initial={false}
          label={`An agent reviews ${T.PRs} before you`}
          hint={`Each ${T.PR} new to Needs your review, and what changed on a re-review. Findings go on it under your name, starting with 🤖.`}
          demo
        >
          <AutoAgent />
          <AgentPost />
          <AgentLimit />
        </Flag>
        <Flag k="keepAgentSessions" initial={false} label="Keep agent review sessions" hint="To open one later from its pill (W on the PR), in a copy of the repo as it reviewed it (Claude Code's in the Claude app, Codex's in Terminal): to see what it read and thought, or ask it why. Sessions take space where Claude Code and Codex keep theirs." demo />
        <Flag
          k="agentThreads"
          initial={true}
          label="An agent checks whether your comments were addressed"
          hint={`After new commits, on ${T.PRs} you reviewed and on yours.`}
          demo
        />
      </section>

      <section>
        <h3>Slack</h3>
        <Flag k="slackNotify" initial={true} label="Message the author and assignees after a review" hint="Untick it per review."  demo />
          <Flag k="slackDone" initial={false} label="✅ on review requests" hint={`On the author's channel posts linking a ${T.PR} you approve; on yours when you merge.`} demo />
          <Flag k="reviewAsk" initial={false} label="Ask for review in a channel" hint={`A button on your ${T.PRs}. Tags each reviewer asked, by name; you read it first.`} demo>
            <SlackChannel k="reviewChannel" initial="" label="Review channel" />
          </Flag>
          <Flag k="reviewReplies" initial={false} label="Replies to your review request" hint={`Beside your ${T.PR}'s title, with how many you haven't opened.`} demo />
          <Flag k="slackAsked" initial={false} label={`${T.PRs} asked of you on Slack, in Needs your review`} hint="Linked in a DM to you or next to a tag of you, in the last 7 days. Its pill adds you as a reviewer." demo />
          <Flag k="slackSent" initial={false} label="People you asked on Slack, not as reviewers" hint={`Whoever you DM'd your ${T.PR} to, with a button to ask them.`} demo />
          <Flag k="closeReply" initial={false} label="Tell your review request when you close" hint="A reply in its thread, tagging the reviewers asked." demo />
          <Flag k="askThreadReply" initial={false} label="Answer in the thread where you were asked" hint="Your after-review message replies there, not as a DM." demo />
          <Flag k="againInThread" initial={false} label="Ask again in your review request's thread" hint="Not as a DM." demo />
          <Flag k="qaRequest" initial={true} label="Ask QA" hint={`A button on your ${T.PRs}. Filled in from the ${T.PR}; you read it first.`} demo>
            <SlackChannel k="qaChannel" initial={QA_CHANNEL} label="QA channel" />
          </Flag>
        {ints?.slack.ok && <SlackPeople team={team} />}
        <SlackMessages />
      </section>

      <section>
        <h3>Jira</h3>
        <Flag k="ticketOpen" initial={false} label="Expand the ticket above the conversation"  demo />
        <Flag k="jiraOnMerge" initial={true} label="Move the ticket when you merge" hint="Untick it per merge."  demo />
        <JiraAfterMerge />
        <Flag k="jiraOnReview" initial={false} label="Move the ticket when you ask for review" hint="Ready for review, or asking a reviewer. Done tickets stay." demo>
          <JiraStatusRow k="jiraInReview" initial="In Review" label="Move it to" />
        </Flag>
        <Flag k="jiraOnQa" initial={false} label="Move the ticket when you ask QA" demo>
          <JiraStatusRow k="jiraInQa" initial="In QA" label="Move it to" />
        </Flag>
      </section>

      <section>
        <h3>Appearance</h3>
        <Flag k="glass" initial={true} label="Glass" hint="Translucent bars and pop-ups. Off with Reduce transparency."  demo />
        <TagStyle />
        <Flag k="themeColors" initial={true} label="Theme colours for lgtm's marks" hint="Warnings and findings in the theme's colours. Solid badges keep lgtm's." demo />
        <Flag k="relativeTimes" initial={true} label="Relative times" hint="The exact time shows on hover." demo />
        <div class="set-row">
          <span>
            Colour theme
            <small>Each card: light, then dark.</small>
          </span>
        </div>
        <div class="thm-grid" role="radiogroup" aria-label="Colour theme">
          {Object.entries(allThemes(look.mine)).map(([k, t]) => (
            <span class="thm-slot">
              <button role="radio" aria-checked={look.appTheme === k} class={look.appTheme === k ? 'thm-card on' : 'thm-card'} onClick={() => look.setAppTheme(k)}>
                <ThemeThumb t={t} />
                <span class="thm-name" title={t ? t.name : 'lgtm'}>{t ? t.name : 'lgtm'}</span>
              </button>
              {k in savedThemes(look) && (
                <button class="thm-remove" title={`Delete ${t?.name}`} aria-label={`Delete ${t?.name}`} onClick={() => (look.appTheme === k && look.setAppTheme('lgtm'), saveTheme(look, k, null))}>
                  <Octicon name="x" />
                </button>
              )}
            </span>
          ))}
        </div>
        <MyTheme look={look} />
        <ThemeGallery look={look} />
        <div class="set-row">
          <span>Light or dark</span>
          <span class="set-seg" role="radiogroup" aria-label="Light or dark">
            {THEMES.map(([t, name, icon]) => (
              <button role="radio" aria-checked={theme === t} class={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>
                {icon} {name}
              </button>
            ))}
          </span>
        </div>
        <label class="set-row">
          <span>
            Text size

          </span>
          <span class="set-size">
            <input type="range" min={11} max={20} step={0.5} value={look.textSize} onInput={(e) => look.setTextSize(e.currentTarget.value)} />
            <span>{look.textSize}px</span>
            {look.textSize !== TEXT_DEFAULT && <button class="md-reset" title={`Back to ${TEXT_DEFAULT}px`} onClick={() => look.setTextSize(String(TEXT_DEFAULT))}>↺</button>}
          </span>
        </label>
        <label class="set-row">
          <span>
            Code size
          </span>
          <span class="set-size">
            <input type="range" min={10} max={18} step={0.5} value={look.codeSize} onInput={(e) => look.setCodeSize(e.currentTarget.value)} />
            <span>{look.codeSize}px</span>
            {look.codeSize !== CODE_DEFAULT && <button class="md-reset" title={`Back to ${CODE_DEFAULT}px`} onClick={() => look.setCodeSize(String(CODE_DEFAULT))}>↺</button>}
          </span>
        </label>
        <label class="set-row">
          <span>Code colours</span>
          <select value={look.theme} onChange={(e) => look.setTheme(e.currentTarget.value)}>
            <option value="theme">The colour theme's own</option>
            {Object.entries(CODE_THEMES).map(([k, t]) => <option value={k}>{t.name}</option>)}
          </select>
        </label>
        <label class="set-row">
          <span>
            Code font
          </span>
          <select value={look.font} onChange={(e) => look.setFont(e.currentTarget.value)}>
            {Object.entries(CODE_FONTS).map(([k, f]) => <option value={k}>{f.name}</option>)}
          </select>
        </label>
        <pre class="code-sample" dangerouslySetInnerHTML={{ __html: highlightCode(SAMPLE, 'kotlin') }} />
        <MarkdownStyle />
      </section>

      <section>
        <h3>App</h3>
        {isDesktop && <LaunchAtLogin />}
        <Shortcuts />
        <BackupSection />
      </section>
      <About />
    </div>
  );
}

type Look = ReturnType<typeof useCodeLook>;
const savedThemes = (look: Look): Record<string, AppTheme> => {
  try {
    return JSON.parse(look.mine);
  } catch {
    return {};
  }
};

// The picked theme, when it's one you added: its light and dark version (for a file with several), where it's from,
// and a way to remove it.
function MyTheme({ look }: { look: Look }) {
  const t = savedThemes(look)[look.appTheme];
  if (!t) return null;
  const of = (a: 'light' | 'dark') => t.variants?.filter((v) => v.appearance === a) ?? [];
  return (
    <div class="set-row set-mytheme">
      <span>
        {t.name}
        <small>
          {t.credit && <>By {t.credit.replace(/\s*<[^>]*>/, '')}. </>}
          {t.source && <a href={t.source} target="_blank" rel="noopener">Its source</a>}
        </small>
      </span>
      <span class="row">
        {(['light', 'dark'] as const).map((a) =>
          of(a).length > 1 ? (
            <select title={`The ${a} version`} value={t.pick?.[a]} onChange={(e) => saveTheme(look, look.appTheme, pickVariant(t, a, e.currentTarget.value))}>
              {of(a).map((v) => <option value={v.name}>{v.name}</option>)}
            </select>
          ) : null,
        )}
        <button onClick={() => (saveTheme(look, look.appTheme, null), look.setAppTheme('lgtm'))}>Delete</button>
      </span>
    </div>
  );
}

// More themes: Zed's theme gallery, or VS Code's from Open VSX (the open registry of VS Code extensions), most used
// first. Zed themes are read from their extension's GitHub repo, VS Code ones from Open VSX: as JSON, nothing in them
// runs. Or a Zed or VS Code theme file of your own.
type Source = 'zed' | 'vsx';
type Ext = { src: Source; id: string; name: string; description: string; downloads: number; repository?: string; ns?: string; ext?: string; version?: string; author?: string };
const VSX = 'https://open-vsx.org/api';
async function listThemes(src: Source, q: string): Promise<Ext[]> {
  if (src === 'zed') {
    const d = await (await fetch(`https://api.zed.dev/extensions?filter=${encodeURIComponent(q)}&provides=themes&max_schema_version=1`)).json();
    return (d.data ?? []).map((x: any): Ext => ({ src, id: x.id, name: x.name, description: x.description, downloads: x.download_count, repository: x.repository }));
  }
  const d = await (await fetch(`${VSX}/-/search?category=Themes&size=60&sortBy=downloadCount&sortOrder=desc&query=${encodeURIComponent(q)}`)).json();
  return (d.extensions ?? [])
    // Icon themes share the category; VS Code's built-in themes aren't readable from Open VSX.
    .filter((x: any) => !/icon/i.test(`${x.name} ${x.displayName}`) && x.namespace !== 'vscode')
    .map((x: any): Ext => ({ src, id: `${x.namespace}.${x.name}`, name: x.displayName || x.name, description: x.description ?? '', downloads: x.downloadCount ?? 0, ns: x.namespace, ext: x.name, version: x.version, author: x.namespace }));
}
// A file in an Open VSX extension's package, as JSON (lenient: VS Code themes are often JSONC).
const vsxFile = async (x: Ext, path: string) => {
  const r = await fetch(`https://open-vsx.org/vscode/unpkg/${x.ns}/${x.ext}/${x.version}/extension/${path.replace(/^\.\//, '')}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return parseThemeFile(await r.text());
};
const relPath = (from: string, rel: string) => new URL(rel, `https://x/${from.replace(/^\.\//, '')}`).pathname.slice(1);

function ThemeGallery({ look }: { look: Look }) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<Source>('zed');
  const [q, setQ] = useState('');
  const [list, setList] = useState<Ext[] | null>(null);
  const [files, setFiles] = useState<{ ext: Ext; names: string[] } | null>(null);
  const [preview, setPreview] = useState<{ key: string; t: AppTheme } | null>(null); // fetched, not yet added
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setList(null);
    let live = true; // a slower answer for the other gallery or an older search doesn't replace this one
    const t = setTimeout(() => {
      listThemes(src, q).then(
        (l) => live && setList(l.sort((a, b) => b.downloads - a.downloads).slice(0, 40)),
        (e) => live && setErr(`Couldn't reach the gallery: ${e.message}`),
      );
    }, 250);
    return () => ((live = false), clearTimeout(t));
  }, [open, q, src]);
  const repoOf = (ext: Ext) => ext.repository?.match(/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1];
  const browse = async (ext: Ext) => {
    setErr('');
    setBusy(ext.id);
    try {
      if (ext.src === 'vsx') await fetchVSCode(ext);
      else {
        const repo = repoOf(ext);
        if (!repo) throw new Error(`its source isn't on GitHub. Download its theme file and add it with "From a file"`);
        const names = (await listDir(repo, 'themes')).filter((f) => f.type === 'file' && /\.json$/i.test(f.name)).map((f) => f.name);
        if (!names.length) throw new Error('no theme files in its themes folder');
        if (names.length === 1) await fetchTheme(ext, names[0], false, ext.id);
        else setFiles({ ext, names });
      }
    } catch (e: any) {
      setErr(`Couldn't read ${ext.name}'s themes: ${e.message}`);
    }
    setBusy('');
  };
  // A VS Code extension's colour themes (up to 8), as one theme whose versions can be picked for light and dark.
  const fetchVSCode = async (ext: Ext) => {
    const themes: any[] = (await vsxFile(ext, 'package.json')).contributes?.themes ?? [];
    if (!themes.length) throw new Error('it has no colour themes (only icons, perhaps)');
    // A theme whose file isn't in the package (some are written only once running in VS Code) is skipped.
    const got = await Promise.allSettled(
      themes.slice(0, 8).map(async (t) => ({
        label: t.label ?? t.id ?? t.path,
        appearance: vsAppearance(t.uiTheme),
        file: await withIncludes(await vsxFile(ext, t.path), (p) => vsxFile(ext, relPath(t.path, p))),
      })),
    );
    const entries = got.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (!entries.length) throw new Error(`its theme files aren't in its package (${(got[0] as PromiseRejectedResult).reason?.message}). Its Zed version, if it has one, will work`);
    setPreview({ key: `vsx:${ext.id}`, t: fromVSCodeSet(ext.name, entries, `https://open-vsx.org/extension/${ext.ns}/${ext.ext}`, ext.author) });
  };
  const install = (key: string, t: AppTheme) => (saveTheme(look, key, t), setTrial(null), setFiles(null), setPreview(null));
  // A Zed theme file fetched for its preview card; several in one extension (Catppuccin's accents) go by their file names.
  const fetchTheme = async (ext: Ext, name: string, several: boolean, busyAs = name) => {
    setBusy(busyAs);
    setErr('');
    try {
      const repo = repoOf(ext)!;
      const text = await getRaw(repo, `themes/${name}`, 'HEAD');
      if (!text) throw new Error('the file is gone');
      const t = fromZedFile(parseThemeFile(text), `https://github.com/${repo}/blob/HEAD/themes/${name}`);
      setPreview({ key: `zed:${ext.id}/${name}`, t: { ...t, name: several ? `${t.name} (${name.replace(/\.json$/i, '')})` : t.name } });
    } catch (e: any) {
      setErr(`Couldn't read it: ${e.message}`);
    }
    if (busyAs === name) setBusy('');
  };
  const previewOf = (x: Ext) => (preview && (preview.key === `vsx:${x.id}` || preview.key.startsWith(`zed:${x.id}/`)) ? preview.key : null);
  // The fetched theme's card, under its row, scrolled into view (the list scrolls in its own box).
  const Preview = ({ k }: { k: string }) =>
    preview?.key === k ? (
      <div class="tg-preview" ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}>
        <span class="thm-card">
          <ThemeThumb t={preview.t} />
          <span class="thm-name" title={preview.t.name}>{preview.t.name}</span>
        </span>
        <span class="row">
          <button class="primary" onClick={() => install(preview.key, preview.t)}>Add</button>
          <button title="See it on the whole app first: look around, then keep it or not" onClick={() => setTrial(preview)}>Try</button>
          <button onClick={() => setPreview(null)}>Cancel</button>
        </span>
      </div>
    ) : null;
  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const file = parseThemeFile(await f.text());
      // Zed's: a family of themes; VS Code's: one theme's colors and tokenColors.
      const t = file.themes ? fromZedFile(file, '') : file.colors || file.tokenColors ? fromVSCode({ name: f.name.replace(/\.json$/i, ''), ...file }, '') : null;
      if (!t) throw new Error('it has neither a Zed theme list nor VS Code colours');
      install(`file:${f.name}`, t);
    } catch (e: any) {
      setErr(`Couldn't use that file: ${e.message}`);
    }
  };
  if (!open)
    return (
      <div class="set-row">
        <span>
          More themes
          <small>From Zed's or VS Code's galleries, or a theme file.</small>
        </span>
        <span class="row">
          <button onClick={() => setOpen(true)}>Browse themes</button>
          <label class="set-file">
            <input type="file" accept=".json,.jsonc,application/json" onChange={(e) => void fromFile(e.currentTarget.files?.[0])} />
            <span class="set-file-btn">From a file…</span>
          </label>
        </span>
      </div>
    );
  return (
    <div class="theme-gallery">
      <div class="row">
        <span class="set-seg" role="radiogroup" aria-label="Gallery">
          {(['zed', 'vsx'] as const).map((s) => (
            <button role="radio" aria-checked={src === s} class={src === s ? 'on' : ''} onClick={() => (setSrc(s), setFiles(null), setPreview(null), setErr(''))}>
              {s === 'zed' ? 'Zed' : 'VS Code'}
            </button>
          ))}
        </span>
        <input type="search" placeholder={src === 'zed' ? "Search Zed's themes" : 'Search VS Code themes (Open VSX)'} value={q} onInput={(e) => (setQ(e.currentTarget.value), setFiles(null))} autoFocus />
        <button onClick={() => (setOpen(false), setFiles(null))}>Done</button>
      </div>
      {err && <p class="error">{err}</p>}
      {files ? (
        <div class="tg-list">
          <p class="note">
            {files.ext.name} has {files.names.length} theme files. Add one: <button class="link" onClick={() => setFiles(null)}>back</button>
          </p>
          {files.names.map((n) => (
            <div class="tg-item">
              <b>{n.replace(/\.json$/i, '')}</b>
              <button disabled={!!busy} onClick={() => void fetchTheme(files.ext, n, true)}>{busy === n ? 'Getting…' : 'Preview'}</button>
              <Preview k={`zed:${files.ext.id}/${n}`} />
            </div>
          ))}
        </div>
      ) : (
        <div class="tg-list">
          {!list && <Lines />}
          {list?.length === 0 && <p class="note">No themes match.</p>}
          {list?.map((x) => (
            <div class="tg-item">
              <span>
                <b>{x.name}</b> <small class="note">{x.downloads.toLocaleString()} downloads</small>
                <small class="note tg-desc">{x.description}</small>
              </span>
              <button disabled={!!busy} onClick={() => (setPreview(null), void browse(x))}>{busy === x.id ? 'Getting…' : 'Preview'}</button>
              {previewOf(x) && <Preview k={previewOf(x)!} />}
            </div>
          ))}
        </div>
      )}
      <p class="note">Themes are their authors' work, under their own licenses; lgtm reads only their colours.</p>
    </div>
  );
}

// Viewed marks (each file's eye, the index's ticks and counts, the plan's bars): shown, hidden on small PRs, or hidden.
// Hidden, nothing is marked or collapsed by them; GitHub keeps what was marked.
function ViewedMarks() {
  const [v, set] = useStoredValue('viewedMarks', 'show');
  return (
    <div class="set-flag with-demo">
      <label class="set-row">
        <span>Viewed marks</span>
        <select value={v} onChange={(e) => set(e.currentTarget.value)}>
          <option value="show">Shown</option>
          <option value="small">Hidden on small {T.PRs} (under 10 files on show)</option>
          <option value="hide">Hidden</option>
        </select>
      </label>
      <DemoPair k="viewedMarks" active={v !== 'show'} />
    </div>
  );
}

// The centred PR's width, in columns of code.
function CenterCols() {
  const [cols, setCols] = useStoredValue('centerCols', '120');
  return (
    <label class="set-row">
      <span>Width</span>
      <select value={cols} onChange={(e) => setCols(e.currentTarget.value)}>
        {['80', '100', '120', '140', '160'].map((c) => <option value={c}>{c} columns of code</option>)}
      </select>
    </label>
  );
}

// What lgtm can't do with the gh login's scopes, and the command that adds them (gh's own login lacks read:user).
function MissingScopes() {
  const [scopes, setScopes] = useState<string[] | null>(null);
  useEffect(() => void tokenScopes().then(setScopes, () => {}), []);
  if (!scopes) return null;
  const has = (...any: string[]) => any.some((x) => scopes.includes(x));
  const missing = [
    !has('read:user', 'user', 'user:email') && ['read:user', "people's public GitHub emails, for matching them on Slack (their names, their org's verified emails and their commit emails still work)"],
    !has('read:org', 'admin:org', 'write:org') && ['read:org', "teams and their members, and the org's verified emails"],
  ].filter(Boolean) as [string, string][];
  if (!missing.length) return null;
  const cmd = `gh auth refresh -s ${missing.map(([s]) => s).join(',')}`;
  return (
    <div class="note scopes">
      {missing.map(([s, what]) => (
        <p>
          Without <code>{s}</code>, lgtm can't read {what}.
        </p>
      ))}
      <p>
        To allow it: <code>{cmd}</code> <button class="link" onClick={() => void copyText(cmd)}>Copy</button>
      </p>
    </div>
  );
}

// The status a merged PR's Jira ticket moves to, as the merge box offers it (you can change it there each time).
const JiraAfterMerge = () => <JiraStatusRow k="jiraAfterMerge" initial="Done" label="Move it to" note="" />;
function JiraStatusRow({ k, initial, label, note = '' }: { k: string; initial: string; label: string; note?: string }) {
  const [status, setStatus] = useStoredValue(k, initial);
  // The projects of the tickets seen lately (review.tsx keeps them), for their statuses.
  const projects = (() => {
    try {
      return Object.keys(JSON.parse(localStorage.getItem('jiraSeen') ?? '{}')).map((k) => k.split('-')[0]);
    } catch {
      return [];
    }
  })();
  const statuses = useJiraStatuses(projects);
  return (
    <label class="set-row">
      <span>
        {label}
        {!projects.length && <small>Open a {T.PR} with a Jira ticket to list its statuses.</small>}
      </span>
      <StatusSelect value={status} onChange={setStatus} statuses={statuses} />
    </label>
  );
}

// Where Ask QA posts: a channel's ID, #name or link (Slack → the channel → Copy link).
// Checked on Slack as you type (a moment after you stop): its name when it's there, or why it isn't.
function SlackChannel({ k, initial, label }: { k: string; initial: string; label: string }) {
  const [channel, setChannel] = useStoredValue(k, initial);
  const [check, setCheck] = useState<ChannelCheck | 'checking' | null>(null);
  useEffect(() => {
    if (!SLACK_CHANNEL.test(channel)) return setCheck(null);
    setCheck('checking');
    let stop = false;
    const t = setTimeout(() => checkSlackChannel(channel).then((r) => !stop && setCheck(r), (e) => !stop && setCheck({ ok: false, error: e.message })), 600);
    return () => ((stop = true), clearTimeout(t));
  }, [channel]);
  // What Slack says, under the field (the label's column is narrow).
  const status = !channel ? null : !SLACK_CHANNEL.test(channel) ? <span class="set-warn">Not a channel ID, #name or link.</span>
    : check === 'checking' ? 'Checking on Slack…'
    : check?.ok ? <span class="ok"><CheckMark state="success" /> {check.name ?? check.id} exists</span>
    : check && ((near) => (
        <span class="set-warn">
          Not found on Slack: {(check.error ?? '').replace(/ \(did you mean #[\w.-]+\?\)$/, '')}.
          {near && <> <button type="button" class="link" onClick={() => setChannel(near)}>Use {near}</button></>}
        </span>
      ))((check.error ?? '').match(/did you mean (#[\w.-]+)\?/)?.[1]);
  return (
    <>
      <label class="set-row">
        <span>
          {label}
          <small>Its ID, #name or link.</small>
        </span>
        <input type="text" value={channel} spellcheck={false} placeholder="#channel" onInput={(e) => setChannel(e.currentTarget.value.trim())} />
        {initial && channel !== initial && <button class="md-reset" title="Back to #qa-task-requests" onClick={() => setChannel(initial)}>↺</button>}
      </label>
      {status && <p class="note set-status">{status}</p>}
    </>
  );
}

// The messages lgtm sends on Slack, each yours to word (slackmsg.ts); {…} fills in, {@…} tags someone.
function SlackMessages() {
  const { names, emoji } = useSlackEmoji(); // for the previews and the suggestions
  return (
    <>
      <h5>Messages</h5>
      <p class="note">Open one to change it. Tags mention mapped people; Slack emoji work.</p>
      <div class="templates">
        {(Object.keys(SLACK_MESSAGES) as SlackKind[]).map((k) => (
          <SlackMessage k={k} emoji={emoji} names={names} />
        ))}
      </div>
    </>
  );
}
// A made-up PR, to show a message the way Slack will.
const SLACK_SAMPLE = {
  ...prValues({ repo: 'acme/app', number: 1234, title: 'Retry payments on network errors', url: 'https://github.com/acme/app/pull/1234', author: 'ana' }),
  verdict: ':approved: Approved',
  comments: ' · 3 comments on PaymentService.kt, RetryPolicy.kt',
  note: '>Looks good, two small nits.',
  days: '2 days',
  reviewers: '<@gh:budi> <@gh:rina>',
  jira: ' (Jira: <https://acme.atlassian.net/browse/APP-77|APP-77>)',
  description: 'Card payments that fail on a network error are retried three times, with backoff. Declines are not retried.',
};
function SlackMessage({ k, emoji, names }: { k: SlackKind; emoji: (name: string) => string | undefined; names: string[] }) {
  const m = SLACK_MESSAGES[k];
  const [text, setText] = useStoredValue('slackMsg.' + k, m.initial);
  return (
    <Template
      label={m.label}
      text={text}
      setText={setText}
      initial={m.initial}
      fields={{ ...SLACK_FIELDS, ...m.fields }}
      box={(ref) => <EmojiTextarea value={text} onInput={setText} names={names} emoji={emoji} boxRef={ref} rows={Math.max(3, text.split('\n').length + 1)} label={m.label} />}
      preview={<SlackPreview message={fillSlack(text, SLACK_SAMPLE)} emoji={emoji} />}
      note={m.note}
    />
  );
}

// A text lgtm sends that you can word (a Slack message, a Claude prompt): folded to its name (an edited one marked, ↺
// back to lgtm's); open, the text beside its preview on a sample PR, the fill-ins as chips that go in at the cursor
// (what each becomes on hover), and a line about it.
function Template({ label, text, setText, initial, fields, box, preview, note }: {
  label: string; text: string; setText: (v: string) => void; initial: string; fields: Record<string, string>;
  box: (ref: { current: HTMLTextAreaElement | null }) => preact.ComponentChildren; preview: preact.ComponentChildren; note?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const edited = text !== initial;
  const insert = (name: string) => {
    const t = ref.current;
    const [a, b] = t ? [t.selectionStart, t.selectionEnd] : [text.length, text.length];
    setText(text.slice(0, a) + `{${name}}` + text.slice(b));
    requestAnimationFrame(() => t && (t.focus(), t.setSelectionRange(a + name.length + 2, a + name.length + 2)));
  };
  return (
    <details class="template">
      <summary>
        <span class="template-name">{label}</span>
        {edited && <span class="template-edited">edited</span>}
        {edited && (
          <button class="md-reset" title="Back to lgtm's wording" onClick={(e) => (e.preventDefault(), setText(initial))}>
            ↺
          </button>
        )}
      </summary>
      <div class="template-body">
        <div class="template-edit">
          {box(ref)}
          {Object.keys(fields).length > 0 && (
            <div class="template-fields">
              {Object.entries(fields).map(([name, means]) => (
                <button class="template-chip" title={means} onClick={() => insert(name)}>{`{${name}}`}</button>
              ))}
            </div>
          )}
        </div>
        <div class="template-see">
          {preview}
          {note && <small class="note">{note}</small>}
        </div>
      </div>
    </details>
  );
}

// Markdown files' look: a theme (lgtm's own, or one of markdown.style's), and any of its values yours instead; each
// override has a ↺ back to the theme's. The preview is the real styling.
const MD_SAMPLE = [
  '# Rollout plan',
  'Ship the new checkout behind the `orders_v2` flag, then remove the old screen once [the dashboard](#) stays green for a week.',
  '## What changes',
  '- Payments retry on network errors, never on a declined card',
  '- The cart keeps its promo code after login',
  '> Ask what they were trying to do before you ask what is broken.',
  '| Step | Owner | When |\n|---|---|---|\n| Flag on for staff | Rina | Week 1 |\n| 10% of users | Budi | Week 2 |',
  '```kotlin\nsuspend fun charge(order: Order) = retry(times = 3) { api.charge(order.id) }\n```',
].join('\n\n');
const hex = (rgb: string) => {
  const m = rgb.match(/\d+(\.\d+)?/g)?.map(Number);
  if (!m || (m.length > 3 && m[3] === 0)) return '';
  return '#' + m.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
};
function MarkdownStyle() {
  const [mode, setMode] = useState<'light' | 'dark'>(useAppDark() ? 'dark' : 'light');
  const [s, save, same] = useMdStyle(mode);
  const look = mdStyleProps(s);
  const preview = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Record<string, string>>({}); // the values in effect, for the controls' labels
  useLayoutEffect(() => {
    const el = preview.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const v: Record<string, string> = {};
    for (const k of ['--doc-size', '--doc-leading', '--doc-measure', '--doc-space', '--doc-radius']) v[k] = cs.getPropertyValue(k).trim();
    // Colours: through a probe, so light-dark() and var() come out as plain colours.
    const probe = document.createElement('span');
    el.append(probe);
    for (const [k, , css] of MD_COLORS) {
      probe.style.background = `var(${css})`;
      v[k] = hex(getComputedStyle(probe).backgroundColor) || hex(getComputedStyle(document.body).backgroundColor);
    }
    probe.remove();
    setTheme(v);
  }, [JSON.stringify(s)]);
  const set = (patch: Partial<MdStyle>) => save({ ...s, ...patch });
  const unset = (k: keyof MdStyle) => {
    const n = { ...s };
    delete n[k];
    save(n);
  };
  const setColor = (k: MdColor, v: string | null) => {
    const colors = { ...(s.colors ?? {}) };
    if (v) colors[k] = v;
    else delete colors[k];
    save({ ...s, colors });
  };
  const reset = (k: keyof MdStyle) => s[k] != null && <button class="md-reset" title="Back to the theme's" onClick={() => unset(k)}>↺</button>;
  const num = (k: keyof MdStyle, label: string, min: number, max: number, step: number, unit: string, css: string) => {
    const cur = s[k] as number | undefined;
    const shown = cur ?? parseFloat(theme[css]) ?? min;
    return (
      <label class="md-ctl">
        <span>{label}</span>
        <input type="range" min={min} max={max} step={step} value={Number.isFinite(shown) ? shown : min} onInput={(e) => set({ [k]: Number(e.currentTarget.value) })} />
        <span class="md-val">{cur != null ? `${cur}${unit}` : `${theme[css] || '…'} (theme)`}</span>
        {reset(k)}
      </label>
    );
  };
  const fontSelect = (k: 'body' | 'heading', label: string) => (
    <label class="md-ctl">
      <span>{label}</span>
      <select value={s[k] ?? ''} onChange={(e) => (e.currentTarget.value ? set({ [k]: e.currentTarget.value }) : unset(k))}>
        <option value="">The theme's</option>
        <optgroup label="Your system">
          <option value="sans">Sans (the app's)</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace (your code font)</option>
        </optgroup>
        <optgroup label="Bundled">
          {Object.keys(MD_FONTS).map((f) => <option value={f}>{f}</option>)}
        </optgroup>
      </select>
      {reset(k)}
    </label>
  );
  useEffect(() => MD_THEMES.forEach((t) => loadMdFonts({ theme: t.id })), []); // for the previews
  return (
    <div class="set-group">
      <h4>Markdown files</h4>
      <p class="note">Markdown files and {T.PR} descriptions. In dark mode: your light theme's night version, or pick one.</p>
      <div class="md-mode">
        <span class="set-seg" role="radiogroup" aria-label="Style for">
          {(['light', 'dark'] as const).map((m) => (
            <button role="radio" aria-checked={mode === m} class={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'light' ? '☀ In light mode' : '☾ In dark mode'}
            </button>
          ))}
        </span>
        {mode === 'dark' && (
          <label>
            <input type="checkbox" checked={same} onChange={(e) => save(e.currentTarget.checked ? null : { ...s })} /> Follow light mode{same && s.theme.endsWith('-night') ? ` (${MD_THEMES.find((t) => t.id === s.theme)?.name})` : ''}
          </label>
        )}
      </div>
      <div class="md-themes" role="radiogroup" aria-label="Theme">
        {MD_THEMES.filter((t) => (mode === 'dark' ? t.dark || t.id === 'lgtm' : !t.base)).map((t) => (
          <button role="radio" aria-checked={s.theme === t.id} class={s.theme === t.id ? 'md-theme on' : 'md-theme'} title={t.group} onClick={() => set({ theme: t.id })}>
            <div class={`rich mdt mdt-${t.id} md-thumb`} aria-hidden="true">
              <div class="md chunk">
                <h3>Rollout</h3>
                <p>
                  Behind a <a>flag</a>, then <code>remove()</code>.
                </p>
              </div>
            </div>
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      <div class="md-style">
        <div class="md-ctls">
          {fontSelect('body', 'Text font')}
          {fontSelect('heading', 'Heading font')}
          {num('size', 'Text size', 12, 22, 0.5, 'px', '--doc-size')}
          {num('leading', 'Line height', 1.2, 2.2, 0.05, '', '--doc-leading')}
          {num('measure', 'Line width', 24, 80, 1, 'rem', '--doc-measure')}
          <label class="md-ctl md-check">
            <span />
            <span>
              <input type="checkbox" checked={s.measure === 0} onChange={(e) => (e.currentTarget.checked ? set({ measure: 0 }) : unset('measure'))} /> Full width
            </span>
          </label>
          {num('space', 'Space between blocks', 0.4, 2.4, 0.05, 'rem', '--doc-space')}
          {num('radius', 'Corners', 0, 14, 1, 'px', '--doc-radius')}
          <div class="md-colors">
            {MD_COLORS.map(([k, label]) => (
              <label class="md-color">
                <input type="color" value={s.colors?.[k] ?? theme[k] ?? '#000000'} onInput={(e) => setColor(k, e.currentTarget.value)} />
                <span>{label}</span>
                {s.colors?.[k] && <button class="md-reset" title="Back to the theme's" onClick={() => setColor(k, null)}>↺</button>}
              </label>
            ))}
          </div>
          <p>
            <button onClick={() => save({ theme: s.theme })}>Reset to the theme</button>
          </p>
          <p class="note">
            Themes other than lgtm and Linen Night (a dark Linen) are from <a href="https://markdown.style/themes" target="_blank" rel="noopener">markdown.style</a> (Apache 2.0), with their fonts bundled.
          </p>
        </div>
        <div class={`md-preview rich ${look.class}`} style={look.style} ref={preview}>
          <div class="md chunk" dangerouslySetInnerHTML={{ __html: md.render(MD_SAMPLE) }} />
        </div>
      </div>
    </div>
  );
}

// The version, a newer one if there is, and diagnostics for bug reports.
function About() {
  const [update, setUpdate] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [text, setText] = useState('');
  useEffect(() => void availableUpdate().then(setUpdate), []);
  return (
    <div class="note set-version">
      lgtm {__APP_VERSION__}
      {__DEV_BUILD__ && <b> dev{__COMMIT__ && ` (${__COMMIT__})`}</b>} · {isDesktop ? 'macOS app' : 'browser version'} · <i>Say LGTM and mean it.</i>
      {update && (
        <p class="notice">
          lgtm {update} is out. Update with <code>{UPGRADE}</code>{!isDesktop && ' (the browser version runs from source)'}.
          {isDesktop && (
            <>
              {' '}
              <button class="primary" disabled={updating === ''} onClick={() => (setUpdating(''), selfUpdate().catch((e) => setUpdating(e.message)))}>
                {updating === '' ? 'Updating… lgtm restarts when it’s done' : 'Update now'}
              </button>
            </>
          )}
        </p>
      )}
      {updating && (
        <p class="error">{updating}</p>
      )}
      <p>
        <button
          onClick={() =>
            copyDiagnostics().then(
              () => setCopied('Copied: paste it into your bug report.'),
              async () => (setCopied("Couldn't copy here; select the text below."), setText(await diagnostics())),
            )
          }
        >
          Copy diagnostics
        </button>{' '}
        {copied || `For a bug report: version, sign-ins and recent errors. No tokens or ${T.PR} text.`}
      </p>
      <p>
        <button onClick={forgetKept}>Refresh saved lookups</button> Teams, people, checks, code owners and emoji, kept a day or more. Fetches them again and reloads.
      </p>
      <p>
        lgtm is <a href="https://github.com/bukuwarung/lgtm/blob/main/LICENSE" target="_blank" rel="noopener">MIT licensed</a>. Its colour themes, icons,
        fonts and libraries are others' open-source work:{' '}
        <a href="https://github.com/bukuwarung/lgtm/blob/main/THIRD-PARTY-NOTICES.md" target="_blank" rel="noopener">third-party notices</a> (also in the app, as THIRD-PARTY-NOTICES.md).
      </p>
      {text && <textarea class="diag" readOnly rows={8} value={text} onFocus={(e) => e.currentTarget.select()} />}
    </div>
  );
}

// The stopwatch estimate in the PR list: where its paces come from, and your own pace on top (50%–200%).
function TimeToReview() {
  const [raw, setPace] = useStoredValue('reviewPace', '150');
  const pace = Number(raw) || 100;
  const example = (minutes: number) => estimateLabel(minutes / (pace / 100));
  return (
    <div class="set-group">
      <h4>Time to review</h4>
      <p class="note">
        The <Octicon name="stopwatch" /> estimate on each {T.PR}:
      </p>
      <ul class="note set-sources">
        <li>Code: 300 changed lines an hour, the careful end of the SmartBear/Cisco review study.</li>
        <li>Description: 200 words a minute.</li>
        <li>Tests twice as fast, docs six times, deleted lines a third; generated files skipped.</li>
      </ul>
      <label class="set-row set-pace">
        <span>
          Your pace: <b>{pace}%</b>
          <small>300 lines of code: {example(60)}.</small>
        </span>
        <input type="range" min={50} max={200} step={10} value={pace} onInput={(e) => setPace(e.currentTarget.value)} aria-label="Your review pace, percent" />
      </label>
      {pace !== 100 && <button onClick={() => setPace('100')}>Back to 100%</button>}
    </div>
  );
}

// Saved replies: a short name (typed after "/" in a comment box) and the text it puts in.
function SavedReplies() {
  const [list, save] = useSavedReplies();
  const change = (i: number, r: Partial<SavedReply>) => save(list.map((x, k) => (k === i ? { ...x, ...r } : x)));
  return (
    <div class="set-group">
      <h4>Saved replies</h4>
      <p class="note">Type / and the name at the start of a line in a comment box.</p>
      <table class="set-replies">
        <tbody>
          {list.map((r, i) => (
            <tr key={i}>
              <td>
                <input value={r.title} aria-label="Name" placeholder="name" onChange={(e) => change(i, { title: e.currentTarget.value.replace(/\s+/g, '-') })} />
              </td>
              <td>
                <textarea rows={2} value={r.body} aria-label="Reply" onChange={(e) => change(i, { body: e.currentTarget.value })} />
              </td>
              <td>
                <button title="Remove" onClick={() => save(list.filter((_, k) => k !== i))}><Octicon name="x" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => save([...list, { title: 'new', body: '' }])}>Add a reply</button>
    </div>
  );
}

// The review page's shortcuts: click one, press the new key (Backspace: no key, Esc: keep it). A key another action
// had moves here, and that action is left without one.
function Shortcuts() {
  const [b, setKey, reset] = useBindings();
  const [editing, setEditing] = useState<Action | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setEditing(null);
      if (e.metaKey || e.ctrlKey || e.altKey) return setMsg('Single keys only (Shift is fine): ⌘ shortcuts are fixed.');
      if (RESERVED.has(e.key)) return setMsg(`${e.key} is taken by the page. Pick another key.`);
      const key = e.key === 'Backspace' ? '' : e.key;
      const taken = ACTIONS.find(([a]) => a !== editing && key && b[a] === key);
      setKey(editing, key);
      setMsg(taken ? `“${taken[1]}” had ${keyLabel(key)}; it has no key now.` : '');
      setEditing(null);
    };
    addEventListener('keydown', onKey, true); // before the page's own shortcuts
    return () => removeEventListener('keydown', onKey, true);
  }, [editing, b]);
  return (
    <div class="set-group">
      <h4>Keyboard shortcuts</h4>
      <p class="note">Click a key to change it.</p>
      <table class="set-keys">
        <tbody>
          {ACTIONS.map(([a, d]) => (
            <tr key={a}>
              <td>
                <button class={editing === a ? 'key-btn on' : 'key-btn'} title={`Change the key for: ${d}`} aria-label={`${keyLabel(b[a])}: change the key for ${d}`} onClick={() => (setMsg(''), setEditing(editing === a ? null : a))}>
                  {editing === a ? 'Press a key…' : <kbd>{keyLabel(b[a])}</kbd>}
                </button>
              </td>
              <td>{d}</td>
            </tr>
          ))}
          {FIXED.filter(([k]) => k !== 'Esc').map(([k, d]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <p class="note">Backspace for no key, Esc to keep it.</p>}
      {msg && <p class="notice">{msg}</p>}
      <button onClick={() => (reset(), setMsg('Shortcuts back to the defaults.'))}>Reset to defaults</button>
    </div>
  );
}

const VIA: Record<string, string> = { email: 'same email', name: 'same name', username: 'GitHub username' };

// Who lgtm messages on Slack for each GitHub login. People come from the watched team and your review queue; for the
// unmapped ones, "Find" asks Slack (email first, then name) and each match waits for your OK before it's saved.
// Someone Slack had no single match for: who it might be (Save one), or a search of your own (a name, @handle, email,
// or a Slack link: their profile, or your DM with them).
function SlackPick({ m, busy, onSave, onSearch }: { m: SlackMatch; busy: boolean; onSave: (id: string) => void; onSearch: (q: string) => void }) {
  const [q, setQ] = useState('');
  return (
    <div class="slack-pick">
      {m.candidates?.length ? (
        m.candidates.map((c) => (
          <button disabled={busy} title={`Map to ${c.label}${c.display ? ` (${c.display})` : ''}`} onClick={() => onSave(c.id!)}>
            {c.label}
            {c.display && c.display !== c.label && <small> {c.display}</small>}
          </button>
        ))
      ) : (
        <small class="inline">No one found on Slack.</small>
      )}
      <form onSubmit={(e) => (e.preventDefault(), q.trim() && onSearch(q))}>
        <input value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Name, @handle, email, or a link to them or your DM" aria-label="Search Slack" />
        <button disabled={busy || !q.trim()}>Search</button>
      </form>
    </div>
  );
}

function SlackPeople({ team }: { team: string }) {
  const [everyone, setLogins] = useState<string[] | null>(null);
  // Sent here to map someone ("Find @x on Slack" on a notice): them, scrolled to and looked up on Slack.
  const [focus] = useState(() => {
    try {
      const l = localStorage.getItem('slackPeopleFocus');
      localStorage.removeItem('slackPeopleFocus');
      return l;
    } catch {
      return null;
    }
  });
  const { bots, toggleBot } = useBots();
  const logins = everyone && everyone.filter((l) => !bots.has(l));
  const [org, setOrg] = useState('');
  const [map, setMap] = useState<SlackPeople | null>(null);
  const [matches, setMatches] = useState<Record<string, SlackMatch>>({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    getSlackPeople().then(setMap, (e) => setErr(e.message));
    const mine = Promise.all([getGhAccounts().catch(() => []), glabAccounts()]).then(([gh, lab]) => [...gh.map((a) => a.login), ...lab.map((a) => `${a.login}@${a.host}`)]);
    Promise.all([team ? getTeamMembers(team).catch(() => []) : [], getReviewQueue().catch(() => []), getGitHubViewer(), mine]).then(([members, queue, me, yours]) => {
      setOrg(team.split('/')[0] || queue[0]?.repo.split('/')[0] || '');
      // Your team, the people in your PR list (authors, and reviewers asked), and everyone met on PRs you've opened.
      const people = new Set([...members.map((m) => (team.split('/')[0].includes('.') ? `${m}@${team.split('/')[0]}` : m)), ...queue.flatMap((i) => [i.author, ...i.pendingReviewers].map((l) => personKey(i.repo, l))), ...peopleSeen(), ...(focus ? [focus] : [])]);
      // Not you, on any of your accounts (GitHub's and GitLab's).
      for (const l of [me, ...yours]) people.delete(l);
      if (viewAs()) labMe(viewAs()).then((u) => setLogins((l) => l && l.filter((x) => x !== `${u.login}@${viewAs()}`)), () => {});
      setLogins([...people].filter((l) => !l.endsWith('[bot]') && l !== 'ghost').sort((a, b) => a.localeCompare(b)));
    });
  }, [team]);

  const current = (l: string) => map?.mine[l];
  const unmapped = (logins ?? []).filter((l) => !current(l));
  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setErr('');
    try {
      await f();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy('');
  };
  // Their profile (name, public and org-verified emails) and the emails their commits in the org carry, which need no
  // scope beyond gh's own. ponytail: commits for the first 25 (GitHub's search allows 30 a minute).
  const withCommits = async (logins: string[]) => {
    const [people, commits] = await Promise.all([getPeople(org, logins), Promise.all(logins.map((l, k) => (k < 25 ? commitEmails(org, l).catch(() => []) : Promise.resolve([] as string[]))))]);
    return Object.fromEntries(logins.map((l, k) => [l, { name: people[l]?.name ?? null, emails: [...new Set([...(people[l]?.emails ?? []), ...commits[k]])] }]));
  };
  const find = () =>
    run('find', async () => {
      const people = await withCommits(unmapped);
      const found = await findSlackPeople(unmapped.map((login) => ({ login, ...people[login] })));
      setMatches(Object.fromEntries(found.map((m) => [m.login, m])));
    });
  const save = (entries: Record<string, string>) => run('save', async () => setMap(await saveSlackPeople(entries)));
  const suggested = Object.values(matches).filter((m) => m.id && !current(m.login));
  // One person, looked up on Slack again: by their GitHub name and emails, or what you typed.
  const lookUp = (login: string, query = '') =>
    run('find', async () => {
      const people = await withCommits([login]);
      const found = await findSlackPeople([{ login, ...people[login], query: query.trim() || undefined }]);
      setMatches((m) => ({ ...m, ...Object.fromEntries(found.map((x) => [x.login, x])) }));
    });
  const looked = useRef(false);
  useEffect(() => {
    if (!focus || !logins || !map || !org || looked.current) return;
    looked.current = true;
    document.getElementById('slack-' + focus)?.scrollIntoView({ block: 'center' });
    if (!current(focus)) lookUp(focus);
  }, [logins, map, org]);

  return (
    <>
      <h5>People</h5>
      <p class="note">
        Who each account is on Slack, saved in <code>~/.config/lgtm/config.json</code>. Exact email matches map themselves; Find suggests the rest.
      </p>
      <div class="row">
        <button disabled={!!busy || !unmapped.length || !org} onClick={find}>
          {busy === 'find' ? 'Searching Slack…' : `Find Slack accounts for ${unmapped.length} unmapped`}
        </button>
        {((byEmail) =>
          byEmail.length > 0 && (
            <button disabled={!!busy} title="The ones whose GitHub, org or commit email is exactly one Slack account; guesses by name wait for you" onClick={() => save(Object.fromEntries(byEmail.map((m) => [m.login, m.id!])))}>
              Save the {byEmail.length} found by email
            </button>
          ))(suggested.filter((m) => m.via === 'email'))}
        {suggested.length > 1 && suggested.some((m) => m.via !== 'email') && (
          <button disabled={!!busy} onClick={() => save(Object.fromEntries(suggested.map((m) => [m.login, m.id!])))}>
            Save all {suggested.length} matches
          </button>
        )}
      </div>
      {err && <p class="error">{err}</p>}
      {!logins || !map ? (
        <Lines />
      ) : (
        <table class="set-people">
          <tbody>
            {logins.map((l) => {
              const m = matches[l];
              return (
                <tr key={l} id={'slack-' + l} class={l === focus ? 'focus' : ''}>
                  <td>
                    <Who login={l} />{' '}
                    <button class="link" title="Treat as a bot: no Slack messages; comments fold like bots'" disabled={!!busy} onClick={() => toggleBot(l)}>
                      bot?
                    </button>
                  </td>
                  <td>
                    {current(l) ? (
                      <>
                        <code>{current(l)}</code>
                        <button class="link" disabled={!!busy} onClick={() => save({ [l]: '' })}>remove</button>
                      </>
                    ) : m?.id ? (
                      <>
                        {m.label}
                        {m.display && m.display !== m.label && <> ({m.display})</>} <small class="inline">by {VIA[m.via!]}</small>{' '}
                        <button disabled={!!busy} onClick={() => save({ [l]: m.id! })}>Save</button>
                      </>
                    ) : m ? (
                      <SlackPick m={m} busy={!!busy} onSave={(id) => save({ [l]: id })} onSearch={(q) => lookUp(l, q)} />
                    ) : (
                      <>
                        <small class="inline">not mapped</small>{' '}
                        <button class="link" disabled={!!busy || !org} onClick={() => lookUp(l)}>find</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {bots.size > 0 && (
        <p class="note">
          Marked as bots (never messaged; their comments fold like bots'):{' '}
          {[...bots].map((b) => (
            <span key={b} class="bot-chip">
              <Who login={b} />
              <button class="link" title="Not a bot" onClick={() => toggleBot(b)}>×</button>
            </span>
          ))}
        </p>
      )}
    </>
  );
}

// The app only: start lgtm when you log in to your Mac.
function LaunchAtLogin() {
  const [on, setOn] = useState<boolean | null>(null);
  const [menuBar, toggleMenuBar] = useStoredFlag('menuBar', true);
  useEffect(() => void launchAtLogin().then(setOn, () => setOn(false)), []);
  return (
    <div class="set-group">
      <h4>Mac app</h4>
      <label class="set-row">
        <input
          type="checkbox"
          checked={!!on}
          disabled={on === null}
          onChange={async () => {
            await setLaunchAtLogin(!on);
            setOn(await launchAtLogin());
          }}
        />
        <span>
          Launch at login
        </span>
      </label>
      <div class="set-flag with-demo">
        <label class="set-row">
          <input type="checkbox" checked={menuBar} onChange={toggleMenuBar} />
          <span>
            Show in the menu bar
            <small>PRs waiting on you beside the icon; its menu lists them and starts review mode.</small>
          </span>
        </label>
        <DemoPair k="menuBar" active={menuBar} />
      </div>
      <Flag k="badgeInbox" initial={false} label="Count your inbox on the Dock badge" hint="Replies and mentions waiting on you join its count." demo />
    </div>
  );
}

// Moving to the app or another Mac: preferences and pending drafts as one JSON file.
function BackupSection() {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  return (
    <div class="set-group">
      <h4>Backup</h4>
      <p class="note">Preferences, added themes and unsent comments, to move to {isDesktop ? 'the browser version' : 'the macOS app'} or another Mac.</p>
      <div class="row">
        <button onClick={() => saveBackup().then((where) => setMsg({ ok: true, text: `Saved to ${where}.` }), (e) => setMsg({ ok: false, text: e.message }))}>Export settings and drafts</button>
        <button onClick={() => file.current?.click()}>Import…</button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (!f) return;
            try {
              const text = await f.text();
              if (!(await ask('Import these settings, drafts and Slack people and threads? Ones with the same name here are replaced; the page reloads.', 'Import', true))) return;
              const n = await restoreBackup(text);
              setMsg({ ok: true, text: `Imported ${n.entries} entries${n.people || n.threads ? `, ${n.people} Slack people and ${n.threads} Slack threads` : ''}. Reloading…` });
              setTimeout(() => location.reload(), 600);
            } catch (err: any) {
              setMsg({ ok: false, text: err instanceof SyntaxError ? "This isn't an lgtm settings file." : err.message });
            }
          }}
        />
      </div>
      {msg && <p class={msg.ok ? 'notice' : 'error'}>{msg.text}</p>}
    </div>
  );
}

// An agent's lgtm-review skill (Claude Code's or Codex's): it opens PRs ready for review here, linked to its session or
// conversation, and reads your review back.
function AgentSkill({ agent }: { agent: AgentId }) {
  const [s, setS] = useState<SkillStatus | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => void agentSkill(false, agent).then(setS, (e) => setErr(e.message)), []);
  const install = () => agentSkill(true, agent).then((x) => (setS(x), setErr('')), (e) => setErr(e.message));
  const where = agent === 'codex' ? 'conversation' : 'session';
  return (
    <div class="set-row">
      <span>
        lgtm-review skill
        <small>
          {AGENTS[agent].short} opens {T.PRs} here for review and reads your review when you say “check lgtm”.{s?.installed && <> In <code>{s.path}</code>.</>}
        </small>
        {err && <small class="error">{err}</small>}
      </span>
      {s && (s.current ? <CheckMark state="success" title="Installed and up to date" /> : <button onClick={install}>{s.installed ? 'Update' : 'Install'}</button>)}
    </div>
  );
}

// The lgtm-links mod for Claude Code, or plugin for Codex: installed or not; lgtm only gives the line that installs it.
function AgentMod({ agent }: { agent: AgentId }) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => void agentMod(agent).then((m) => setInstalled(m.installed), () => setInstalled(null)), []);
  const line = agent === 'codex' ? CODEX_MOD_INSTALL : MOD_INSTALL;
  return (
    <div class="set-row">
      <span>
        lgtm-links {agent === 'codex' ? 'plugin' : 'mod'}
        <small>
          {agent === 'codex' ? (
            <>Your reviews and comments from lgtm reach the conversation on your next message, without “check lgtm”, and <code>/lgtm</code> opens its {T.PR} here.</>
          ) : (
            <>An Open in lgtm button under replies that link a {T.PR}, <code>/lgtm</code>, and your reviews reaching the session by themselves.</>
          )}
          {installed === false && <> From a terminal: <code>{line}</code></>}
        </small>
      </span>
      {installed ? <CheckMark state="success" title="Installed" /> : installed === false && <button onClick={() => copyText(line).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy the install command'}</button>}
    </div>
  );
}

// One coding agent (agents.ts): installed or not, switched on or off, and the model and effort lgtm runs it with.
function AgentRow({ id }: { id: AgentId }) {
  const { detected } = useAgents();
  const a = AGENTS[id];
  const version = detected?.find((d) => d.id === id)?.version;
  const on = agentOn(id);
  const models = modelsOf(id), model = agentModel(id);
  return (
    <div class="set-flag">
      <label class="set-row">
        <input type="checkbox" checked={on} disabled={!version} onChange={() => setAgentOn(id, !on)} />
        <span>
          <AgentMark id={id} /> {a.name}
          <small>
            {!detected ? 'Looking for it…' : version ? <>{version}. Sign in from a terminal: <code>{a.login}</code></> : <>Not installed. Install it from a terminal: <code>{a.install}</code></>}
          </small>
        </span>
      </label>
      {version && (
        <fieldset class="set-sub" disabled={!on}>
          <div class="template-run">
            <label>
              Model{' '}
              {models ? (
                <select value={model} onChange={(e) => (setAgentModel(id, e.currentTarget.value), !effortsOf(id, e.currentTarget.value).includes(agentEffort(id)) && setAgentEffort(id, ''))}>
                  <option value="">Default</option>
                  {models.map(([v, n]) => <option value={v}>{n}</option>)}
                  {model && !models.some(([v]) => v === model) && <option value={model}>{model}</option>}
                </select>
              ) : (
                <input class="model-input" placeholder={`${a.short}'s default`} value={model} onChange={(e) => setAgentModel(id, e.currentTarget.value.trim())} />
              )}
            </label>
            <label>
              Effort{' '}
              <select value={agentEffort(id)} onChange={(e) => setAgentEffort(id, e.currentTarget.value)}>
                <option value="">Default</option>
                {effortsOf(id, model).map((v) => <option value={v}>{EFFORT_NAME[v]}</option>)}
              </select>
            </label>
          </div>
          <AgentSkill agent={id} />
          <AgentMod agent={id} />
          {id === 'claude' && <ClaudeFolders />}
        </fieldset>
      )}
    </div>
  );
}

// The coding agents (agents.ts): each one's switch, model and effort, and what links it to lgtm; then the prompts.
function CodingAgents() {
  const { detected } = useAgents();
  return (
    <>
      <p class="note">
        Found through their CLIs, signed in as you. They run with no tools.{' '}
        {detected && <button class="link" onClick={() => detectAgents(true).then(() => dispatchEvent(new Event('lgtm:agents-set')))}>Look again</button>}
      </p>
      {AGENT_IDS.map((id) => <AgentRow key={id} id={id} />)}
      <AgentPrompts />
    </>
  );
}

// Which local checkout a new Claude Code session for each repo opens in (the Agents menu). Without one, Claude asks
// for a folder itself.
function ClaudeFolders() {
  const [raw, setRaw] = useStoredValue('claudeFolders', '{}');
  const folders: Record<string, string> = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  })();
  const [repos, setRepos] = useState<string[] | null>(null);
  useEffect(() => {
    getReviewQueue().then((q) => setRepos([...new Set([...q.map((i) => i.repo), ...Object.keys(folders)])].sort()), () => setRepos(Object.keys(folders)));
  }, []);
  const set = (repo: string, path: string) => {
    const next = { ...folders };
    if (path.trim()) next[repo] = path.trim();
    else delete next[repo];
    setRaw(JSON.stringify(next));
  };
  const set_n = Object.keys(folders).length;
  return (
    <details class="set-fold">
      <summary>
        Where a new session starts, per repo <small>{set_n ? `${set_n} set` : 'none set: Claude asks'}</small>
      </summary>
      {!repos ? (
        <Lines />
      ) : (
        <table class="set-people">
          <tbody>
            {repos.map((r) => (
              <tr key={r}>
                <td>{r}</td>
                <td>
                  <input class="folder-input" placeholder="~/Developer/…" value={folders[r] ?? ''} onChange={(e) => set(r, e.currentTarget.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

// What lgtm says to Claude, each yours to word (prompts.ts); the diff, files and answer format it also needs follow.
const PROMPT_SAMPLE: Record<string, string> = {
  kind: 'pull request', site: 'GitHub', ref: '#1234', url: 'https://github.com/acme/app/pull/1234', title: 'Retry payments on network errors', repo: 'acme/app',
  branch: 'retry-payments', base: 'main', read: '`gh pr view 1234 --repo acme/app --comments` and `gh pr diff 1234 --repo acme/app`',
  author: 'ana', place: ' on `RetryPolicy.kt:41`', comment: '> Should a declined card be retried too?', commentUrl: 'https://github.com/acme/app/pull/1234#discussion_r1',
  path: 'RetryPolicy.kt', verdict: 'requested changes', summary: 'My summary:\n> Two things before this goes in.', comments: 'My comments (1):\n- `RetryPolicy.kt:41`: Declines shouldn\'t be retried.', ask: 'Please address them, then tell me what changed.',
};
function AgentPrompts() {
  return (
    <>
      <h5>Prompts</h5>
      <p class="note">What lgtm says to the agent. Open one to change it; what the agent also needs follows your text.</p>
      <div class="templates">{(Object.keys(PROMPTS) as PromptKind[]).map((k) => <AgentPrompt k={k} />)}</div>
    </>
  );
}
function AgentPrompt({ k }: { k: PromptKind }) {
  const p = PROMPTS[k];
  const [text, setText] = useStoredValue('claudePrompt.' + k, p.initial);
  return (
    <Template
      label={p.label}
      text={text}
      setText={setText}
      initial={p.initial}
      fields={p.fields}
      box={(ref) => <textarea ref={ref} rows={Math.max(5, text.split('\n').length + 1)} value={text} onInput={(e) => setText(e.currentTarget.value)} aria-label={p.label} />}
      preview={<pre class="prompt-preview">{fillPrompt(text || p.initial, PROMPT_SAMPLE)}</pre>}
      note={p.after && `Then lgtm adds ${p.after}.`}
    />
  );
}
