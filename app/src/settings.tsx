import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getEmojis, getPeople, getReviewQueue, getTeamMembers, getTeams, getViewer } from './github.ts';
import { CheckMark, Octicon, Tg } from './tags.tsx';
import { ghAccount, getGhAccounts, getSlackEmoji, type GhAccount, askNotifications, claudeSkill, type SkillStatus, useSavedReplies, type SavedReply, availableUpdate, copyDiagnostics, diagnostics, selfUpdate, UPGRADE, fetchIntegrations, restoreBackup, saveBackup, findSlackPeople, isDesktop, peopleSeen, launchAtLogin, setLaunchAtLogin, getSlackPeople, saveSlackPeople, useBots, useStoredFlag, useStoredValue, type Integrations, type SlackMatch, type SlackPeople } from './platform.ts';
import { estimateLabel } from './files.ts';
import { ACTIONS, FIXED, keyLabel, RESERVED, useBindings, type Action } from './keys.ts';
import { DemoPair } from './demos.tsx';
import { highlightCode } from './highlight.ts';
import { CODE_FONTS, CODE_SIZE, CODE_THEMES, TEXT_SIZE, useCodeLook } from './look.ts';
import { GENERIC_FONTS, MD_COLORS, MD_FONTS, MD_THEMES, loadMdFonts, mdStyleProps, useAppDark, useMdStyle, type MdColor, type MdStyle } from './mdthemes.ts';
import { md } from './markdown.ts';
import { EmojiTextarea, useSlackEmoji } from './emojibox.tsx';
import { COMMON_FIELDS, fillSlack, prValues, slackParts, SLACK_MESSAGES, type SlackKind } from './slackmsg.ts';

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
// Tags and pills (a file's added / modified, a PR's "CI failing"…) as words, icons or both. Icons alone say their words
// on hover; numbers always show.
function TagStyle() {
  const [style, setStyle] = useStoredValue('tagStyle', 'both');
  return (
    <div class="set-row">
      <span>
        Tags and pills
        <small>Like a file's <span class="st s-added"><Tg i="added" t="added" /></span> or a PR's <span class="pill p-bad"><Tg i="ci" t="CI failing" /></span></small>
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
export function Settings() {
  const [theme, setTheme] = useTheme();
  const look = useCodeLook();
  // Search: keeps the sections that mention every word, and within them only the matching switches (a section whose
  // title matches stays whole).
  const [q, setQ] = useState('');
  const [found, setFound] = useState(true);
  const page = useRef<HTMLDivElement>(null);
  // The side panel: every section by its title (the ones search keeps), the one you're in marked.
  const [toc, setToc] = useState<{ id: string; name: string }[]>([]);
  const [cur, setCur] = useState('');
  useLayoutEffect(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const has = (el: Element) => words.every((w) => (el.textContent ?? '').toLowerCase().includes(w));
    let any = false;
    for (const sec of page.current?.querySelectorAll<HTMLElement>(':scope > section') ?? []) {
      const whole = !words.length || has(sec.querySelector('h3') ?? sec);
      const items = [...sec.querySelectorAll<HTMLElement>(':scope > .set-flag, :scope > .set-row')];
      for (const it of items) it.hidden = !whole && !has(it);
      sec.hidden = !whole && !has(sec);
      any ||= !sec.hidden;
    }
    setFound(any);
    const list = [...(page.current?.querySelectorAll<HTMLElement>(':scope > section:not([hidden])') ?? [])].flatMap((sec) => {
      const name = sec.querySelector(':scope > h3')?.textContent ?? '';
      if (!name) return [];
      sec.id ||= 'set-' + name.toLowerCase().replace(/\W+/g, '-');
      return [{ id: sec.id, name }];
    });
    if (list.map((t) => t.id).join() !== toc.map((t) => t.id).join()) setToc(list);
  });
  useEffect(() => {
    const spy = () => {
      let c = '';
      for (const sec of page.current?.querySelectorAll<HTMLElement>(':scope > section[id]:not([hidden])') ?? []) if (sec.getBoundingClientRect().top < innerHeight * 0.3) c = sec.id;
      setCur(c);
    };
    spy();
    addEventListener('scroll', spy, { passive: true });
    return () => removeEventListener('scroll', spy);
  }, []);
  const [keys] = useBindings();
  const also = (k: string) => (k ? `Also ${keyLabel(k)} on a PR.` : undefined);
  const [team, setTeam] = useStoredValue('team', '');
  const [notify, toggleNotify] = useStoredFlag('notifyRequests', false);
  const [teams, setTeams] = useState<string[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [ints, setInts] = useState<Integrations | null>(null);
  const [err, setErr] = useState('');
  const [accounts, setAccounts] = useState<GhAccount[] | null>(null);
  useEffect(() => {
    getViewer().then(setMe, () => setMe(''));
    getGhAccounts().then(setAccounts, () => setAccounts([]));
    getTeams().then(setTeams, () => setTeams([]));
    fetchIntegrations().then(setInts, (e) => setErr(e.message));
  }, []);

  return (
    <div class="page settings" ref={page}>
      <nav class="set-toc" aria-label="Settings sections">
        {toc.map((t) => (
          <button class={cur === t.id ? 'on' : ''} onClick={() => document.getElementById(t.id)?.scrollIntoView({ block: 'start' })}>
            {t.name}
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
        <p class="note">lgtm runs on your machine and borrows the sign-ins of these command-line tools; it stores no tokens.</p>
        <Status ok={me == null ? null : !!me}>
          <b>GitHub</b> {me ? <>signed in as <code>@{me}</code> through the GitHub CLI</> : me === '' ? 'not signed in' : 'checking…'}
          {me === '' && <pre>gh auth login</pre>}
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
                Signed in to more than one GitHub account in gh (<code>gh auth login</code> adds one)? You'll pick here which lgtm uses.
              </small>
            )
          )}
        </Status>
        <Status ok={ints ? ints.slack.ok : null}>
          <b>Slack</b> (review DMs){' '}
          {!ints ? 'checking…' : ints.slack.ok ? <>signed in{ints.slack.who && <> as <code>{ints.slack.who}</code></>} through slackcli</> : <>not available: {ints.slack.error}</>}
          {ints && !ints.slack.ok && <pre>brew install shaharia-lab/tap/slackcli{'\n'}slackcli auth login-auto</pre>}
          <small>
            Who's who on Slack is set under Slack people below (saved in <code>~/.config/lgtm/config.json</code>).
          </small>
        </Status>
        <Status ok={ints ? ints.jira.ok : null}>
          <b>Jira</b> (ticket summaries){' '}
          {!ints ? 'checking…' : ints.jira.ok ? <>signed in{ints.jira.site && <> to <code>{ints.jira.site}</code></>} through the Atlassian CLI</> : <>not available: {ints.jira.error}</>}
          {ints && !ints.jira.ok && <pre>brew install atlassian/homebrew-acli/acli{'\n'}acli jira auth login --web</pre>}
        </Status>
        {err && <p class="error">Couldn't check Slack and Jira: {err}</p>}
      </section>

      {ints?.slack.ok && <SlackPeopleSection team={team} />}

      <SlackMessages />

      <section>
        <h3>Pull request list</h3>
        <Flag k="showDrafts" initial={false} label="Show other people's draft PRs" hint="Your own drafts always show." />
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
            <small>For new review requests, PRs coming back to you for re-review, and what you pick below.</small>
          </span>
        </label>
        <fieldset class="set-sub" disabled={!notify}>
          <Flag k="notifyReplies" initial={true} label="New replies waiting for you" />
          <Flag k="notifyVerdicts" initial={true} label="Your PR approved, or changes requested" />
          <Flag k="notifyCI" initial={true} label="Your PR's checks passed or failed" />
          <Flag k="notifyMentions" initial={true} label="Someone mentions you in a PR" />
        </fieldset>
        <label class="set-row">
          <span>
            Team to watch
            <small>The Team tab lists its members' open PRs.</small>
          </span>
          <select value={team} onChange={(e) => setTeam(e.currentTarget.value)}>
            <option value="">None</option>
            {[...new Set([...(team ? [team] : []), ...(teams ?? [])])].map((t) => <option value={t}>{t}</option>)}
          </select>
        </label>
      </section>

      <TimeToReview />

      <section>
        <h3>Reviewing</h3>
        <Flag k="showIndex" initial={true} label="Show the PR index beside the diff" hint={also(keys.index)} />
        <Flag k="ignoreWs" initial={false} label="Ignore whitespace-only changes" hint={also(keys.whitespace)} demo />
        <Flag k="ticketOpen" initial={true} label="Expand the Jira ticket above the conversation" />
        <JiraAfterMerge />
        <Flag k="gradleModules" initial={true} label="Group files by Gradle module" hint="In Gradle projects: the PR index lists files by module (the folder before src/), and a pill says how many modules the PR touches." />
        <Flag k="slackNotify" initial={true} label="Message the author and assignees on Slack after a review" hint="You can still untick it per review." />
        <Flag k="nextAfterReview" initial={true} label="After a review, open the next PR that needs it" />
      </section>

      <section>
        <h3>Diff</h3>
        <Flag k="sinceFirst" initial={true} label="On a re-review, show only what changed since your last review" demo />
        <Flag k="foldImports" initial={true} label="Fold package and import blocks" hint="Kotlin, Java, TypeScript, JavaScript. New outside packages are still named." demo />
        <Flag k="hideGenerated" initial={true} label="Hide generated files" hint="Files marked linguist-generated or linguist-binary in .gitattributes." demo />
        <Flag k="hideNoDiff" initial={true} label="Hide files renamed or moved without changes" demo />
        <Flag k="collapseDeleted" initial={true} label="Collapse deleted files to one row" demo />
        <Flag k="dimMoved" initial={true} label="Dim code moved without changes" demo />
        <Flag k="oldLineNumbers" initial={false} label="Show old line numbers too" hint="Off: one column, the new line numbers (a removed line shows its old one, faint)." />
        <Flag k="wordDiff" initial={true} label="Highlight the changed words inside a line" demo />
        <Flag k="renderDocs" initial={true} label="Render doc comments" hint="KDoc, Javadoc and JSDoc read like IntelliJ's reader mode." demo>
          <Flag k="renderEditedDocs" initial={true} label="Edited ones too" hint="Rendered from the new version, the changed paragraphs and tags highlighted, as in rendered markdown. Otherwise they show as source." />
          <Flag k="renderLineComments" initial={true} label="Line comments too" hint="Runs of two or more // lines read as prose. Commented-out code stays source." />
        </Flag>
        <Flag k="richMarkdown" initial={true} label="Show markdown files rendered" hint="Still commented line by line: hover a block for its +. Source is a click away per file. Their look: Markdown files, below." demo />
        <Flag k="previewImages" initial={true} label="Show images and vector drawables as pictures" demo />
        <Flag k="foldBots" initial={true} label="Fold bot comments and bot-only threads" demo>
          <Flag k="unfoldBotsOnMine" initial={true} label="Except on your own PRs" hint="There, CI and AI-reviewer comments are usually yours to act on." />
        </Flag>
        <Flag k="resumePosition" initial={true} label="Reopen a PR where you left off" />
        <Flag k="flagUntested" initial={true} label="Point out code changed without test changes" hint="A guess by file name: Foo.kt counts as tested when the PR also changes FooTest.kt (or foo.test.ts, test_foo.py…)." />
      </section>

      {isDesktop && <LaunchAtLogin />}

      <section>
        <h3>Appearance</h3>
        <Flag k="glass" initial={true} label="Glass" hint="Translucent, blurred bars and pop-ups with capsule buttons, in the spirit of macOS's Liquid Glass. Off when macOS is set to reduce transparency." />
        <TagStyle />
        <div class="set-row">
          <span>Theme</span>
          <span class="set-seg" role="radiogroup" aria-label="Theme">
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
            <small>The app's own text: lists, comments, menus. Markdown files have theirs, below.</small>
          </span>
          <span class="set-size">
            <input type="range" min={11} max={20} step={0.5} value={look.textSize} onInput={(e) => look.setTextSize(e.currentTarget.value)} />
            <span>{look.textSize}px</span>
            {look.textSize !== TEXT_SIZE && <button class="md-reset" title="Back to 14px" onClick={() => look.setTextSize(String(TEXT_SIZE))}>↺</button>}
          </span>
        </label>
        <label class="set-row">
          <span>
            Code size
            <small>Code in diffs.</small>
          </span>
          <span class="set-size">
            <input type="range" min={10} max={18} step={0.5} value={look.codeSize} onInput={(e) => look.setCodeSize(e.currentTarget.value)} />
            <span>{look.codeSize}px</span>
            {look.codeSize !== CODE_SIZE && <button class="md-reset" title="Back to 12px" onClick={() => look.setCodeSize(String(CODE_SIZE))}>↺</button>}
          </span>
        </label>
        <label class="set-row">
          <span>Code colours</span>
          <select value={look.theme} onChange={(e) => look.setTheme(e.currentTarget.value)}>
            {Object.entries(CODE_THEMES).map(([k, t]) => <option value={k}>{t.name}</option>)}
          </select>
        </label>
        <label class="set-row">
          <span>
            Code font
            <small>Free, open-source fonts, bundled with lgtm.</small>
          </span>
          <select value={look.font} onChange={(e) => look.setFont(e.currentTarget.value)}>
            {Object.entries(CODE_FONTS).map(([k, f]) => <option value={k}>{f.name}</option>)}
          </select>
        </label>
        <pre class="code-sample" dangerouslySetInnerHTML={{ __html: highlightCode(SAMPLE, 'kotlin') }} />
      </section>

      <MarkdownStyle />

      <ClaudeFolders />

      <BackupSection />

      <Shortcuts />

      <SavedReplies />
      <About />
    </div>
  );
}

// The status a merged PR's Jira ticket moves to, as the merge box offers it (you can change it there each time).
function JiraAfterMerge() {
  const [status, setStatus] = useStoredValue('jiraAfterMerge', 'Ready for QA');
  return (
    <label class="set-row">
      <span>
        After merging, move the Jira ticket to
        <small>Offered under the merge box once your PR is merged; Jira's own status name.</small>
      </span>
      <input value={status} onInput={(e) => setStatus(e.currentTarget.value)} style={{ maxWidth: '220px' }} />
    </label>
  );
}

// The messages lgtm sends on Slack, each yours to word (slackmsg.ts); {…} fills in, {@…} tags someone.
function SlackMessages() {
  const { names, emoji } = useSlackEmoji(); // for the previews and the suggestions
  return (
    <section>
      <h3>Slack messages</h3>
      <p class="note">
        What lgtm says on Slack. Fill-ins: {COMMON_FIELDS}. A tag becomes a Slack mention for people in Slack people above (or, for who gets it, by their
        email); anyone else stays @login.
      </p>
      <p class="note">Slack emoji work as on Slack, your workspace's own too: <code>:approved:</code>, <code>:tada:</code>.</p>
      {(Object.keys(SLACK_MESSAGES) as SlackKind[]).map((k) => (
        <SlackMessage k={k} emoji={emoji} names={names} />
      ))}
    </section>
  );
}
// A made-up PR, to show a message the way Slack will.
const SLACK_SAMPLE = {
  ...prValues({ repo: 'acme/app', number: 1234, title: 'Retry payments on network errors', url: 'https://github.com/acme/app/pull/1234', author: 'ana' }),
  verdict: ':approved: Approved',
  comments: ' · 3 comments',
  note: '>Looks good, two small nits.',
  days: '2 days',
};
function SlackPreview({ text, emoji }: { text: string; emoji: (name: string) => string | undefined }) {
  return (
    <div class="slack-preview" aria-label="How it looks on Slack">
      {slackParts(fillSlack(text, SLACK_SAMPLE), emoji).map((l) => (
        <div class={l.quote ? 'slack-quote' : ''}>
          {l.parts.map((p) =>
            'link' in p ? <a>{p.link}</a> : 'tag' in p ? <span class="slack-tag">@{p.tag}</span> : 'emoji' in p ? <img src={p.src} alt={`:${p.emoji}:`} title={`:${p.emoji}:`} /> : p.text,
          ) }
          {!l.parts.length && '\u00a0'}
        </div>
      ))}
    </div>
  );
}
function SlackMessage({ k, emoji, names }: { k: SlackKind; emoji: (name: string) => string | undefined; names: string[] }) {
  const m = SLACK_MESSAGES[k];
  const [text, setText] = useStoredValue('slackMsg.' + k, m.initial);
  return (
    <label class="slack-msg">
      <span>
        {m.label}
        {text !== m.initial && (
          <button class="md-reset" title="Back to lgtm's wording" onClick={(e) => (e.preventDefault(), setText(m.initial))}>
            ↺
          </button>
        )}
      </span>
      <EmojiTextarea value={text} onInput={setText} names={names} emoji={emoji} />
      <SlackPreview text={text} emoji={emoji} />
      {m.fields && <small>Also: {m.fields}</small>}
    </label>
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
    <section>
      <h3>Markdown files</h3>
      <p class="note">How markdown files and PR descriptions read: pick a theme, then change anything in it. In dark mode they follow your light-mode theme (its night version), or pick another.</p>
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
    </section>
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
      {__DEV_BUILD__ && <b> dev{__COMMIT__ && ` (${__COMMIT__})`}</b>} · {isDesktop ? 'macOS app' : 'browser version'}
      {update && (
        <p class="notice">
          lgtm {update} is out. Update with <code>{UPGRADE}</code>{!isDesktop && <> (or <code>git pull</code> and <code>npm run build</code> from source)</>}.
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
        {copied || 'Version, macOS, which sign-ins work and recent errors, for a bug report. No tokens or PR text.'}
      </p>
      {text && <textarea class="diag" readOnly rows={8} value={text} onFocus={(e) => e.currentTarget.select()} />}
    </div>
  );
}

// The stopwatch estimate in the PR list: where its paces come from, and your own pace on top (50%–200%).
function TimeToReview() {
  const [raw, setPace] = useStoredValue('reviewPace', '100');
  const pace = Number(raw) || 100;
  const example = (minutes: number) => estimateLabel(minutes / (pace / 100));
  return (
    <section>
      <h3>Time to review</h3>
      <p class="note">
        Each PR in the list gets a rough time to review (<Octicon name="stopwatch" />): reading its description, then its changed lines. The paces:
      </p>
      <ul class="note set-sources">
        <li>
          Code: 5 changed lines a minute (300 an hour), the careful end of the SmartBear/Cisco code review study, which found reviewers catch the
          most defects below 300–500 lines an hour (Jason Cohen, <i>Best Kept Secrets of Peer Code Review</i>, 2006).
        </li>
        <li>Description: 200 words a minute, a little under typical silent reading (about 240; Brysbaert, 2019), since PR descriptions are technical.</li>
        <li>Tests at twice the code pace, docs at six times, deleted lines counted at a third, generated files and lockfiles skipped: lgtm's own guesses.</li>
      </ul>
      <label class="set-row set-pace">
        <span>
          Your pace: <b>{pace}%</b>
          <small>{pace === 100 ? 'As above.' : pace < 100 ? 'Slower: estimates grow.' : 'Faster: estimates shrink.'} 300 lines of code would take {example(60)}.</small>
        </span>
        <input type="range" min={50} max={200} step={10} value={pace} onInput={(e) => setPace(e.currentTarget.value)} aria-label="Your review pace, percent" />
      </label>
      {pace !== 100 && <button onClick={() => setPace('100')}>Back to 100%</button>}
    </section>
  );
}

// Saved replies: a short name (typed after "/" in a comment box) and the text it puts in.
function SavedReplies() {
  const [list, save] = useSavedReplies();
  const change = (i: number, r: Partial<SavedReply>) => save(list.map((x, k) => (k === i ? { ...x, ...r } : x)));
  return (
    <section>
      <h3>Saved replies</h3>
      <p class="note">In a comment box, type / and the name at the start of a line (or use ↩︎ Replies), then Enter.</p>
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
    </section>
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
    <section>
      <h3>Keyboard shortcuts</h3>
      <p class="note">On a PR. Click a key to change it.</p>
      <table class="set-keys">
        <tbody>
          {ACTIONS.map(([a, d]) => (
            <tr key={a}>
              <td>
                <button class={editing === a ? 'key-btn on' : 'key-btn'} onClick={() => (setMsg(''), setEditing(editing === a ? null : a))}>
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
    </section>
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

function SlackPeopleSection({ team }: { team: string }) {
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
    Promise.all([team ? getTeamMembers(team).catch(() => []) : [], getReviewQueue().catch(() => []), getViewer()]).then(([members, queue, me]) => {
      setOrg(team.split('/')[0] || queue[0]?.repo.split('/')[0] || '');
      // Your team, the people in your PR list (authors, and reviewers asked), and everyone met on PRs you've opened.
      const people = new Set([...members, ...queue.flatMap((i) => [i.author, ...i.pendingReviewers]), ...peopleSeen(), ...(focus ? [focus] : [])]);
      people.delete(me);
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
  const find = () =>
    run('find', async () => {
      const people = await getPeople(org, unmapped);
      const found = await findSlackPeople(unmapped.map((login) => ({ login, ...people[login] })));
      setMatches(Object.fromEntries(found.map((m) => [m.login, m])));
    });
  const save = (entries: Record<string, string>) => run('save', async () => setMap(await saveSlackPeople(entries)));
  const suggested = Object.values(matches).filter((m) => m.id && !current(m.login));
  // One person, looked up on Slack again: by their GitHub name and emails, or what you typed.
  const lookUp = (login: string, query = '') =>
    run('find', async () => {
      const people = await getPeople(org, [login]);
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
    <section>
      <h3>Slack people</h3>
      <p class="note">
        Who gets the Slack message for each GitHub account, saved in your <code>~/.config/lgtm/config.json</code>. Unmapped people are
        still tried by their GitHub email when you send.
      </p>
      <div class="row">
        <button disabled={!!busy || !unmapped.length || !org} onClick={find}>
          {busy === 'find' ? 'Searching Slack…' : `Find Slack accounts for ${unmapped.length} unmapped`}
        </button>
        {suggested.length > 1 && (
          <button disabled={!!busy} onClick={() => save(Object.fromEntries(suggested.map((m) => [m.login, m.id!])))}>
            Save all {suggested.length} matches
          </button>
        )}
      </div>
      {err && <p class="error">{err}</p>}
      {!logins || !map ? (
        <p class="note">Loading…</p>
      ) : (
        <table class="set-people">
          <tbody>
            {logins.map((l) => {
              const m = matches[l];
              return (
                <tr key={l} id={'slack-' + l} class={l === focus ? 'focus' : ''}>
                  <td>
                    @{l}{' '}
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
              @{b}
              <button class="link" title="Not a bot" onClick={() => toggleBot(b)}>×</button>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

// The app only: start lgtm when you log in to your Mac.
function LaunchAtLogin() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => void launchAtLogin().then(setOn, () => setOn(false)), []);
  return (
    <section>
      <h3>App</h3>
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
          <small>Start lgtm when you log in to your Mac, so the Dock badge and notifications are there from the start.</small>
        </span>
      </label>
    </section>
  );
}

// Moving to the app or another Mac: preferences and pending drafts as one JSON file.
function BackupSection() {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  return (
    <section>
      <h3>Backup</h3>
      <p class="note">Your preferences and pending (unsubmitted) comments live in this {isDesktop ? 'app' : 'browser'}. Export them to move to {isDesktop ? 'the browser version' : 'the macOS app'} or another Mac.</p>
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
              if (!confirm('Import these settings and drafts? Ones with the same name here are replaced; the page reloads.')) return;
              const n = restoreBackup(text);
              setMsg({ ok: true, text: `Imported ${n} entries. Reloading…` });
              setTimeout(() => location.reload(), 600);
            } catch (err: any) {
              setMsg({ ok: false, text: err instanceof SyntaxError ? "This isn't an lgtm settings file." : err.message });
            }
          }}
        />
      </div>
      {msg && <p class={msg.ok ? 'notice' : 'error'}>{msg.text}</p>}
    </section>
  );
}

// The lgtm-review skill for Claude Code: lets Claude open PRs ready for review here, linked back to its session.
function ClaudeSkill() {
  const [s, setS] = useState<SkillStatus | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => void claudeSkill().then(setS, (e) => setErr(e.message)), []);
  const install = () => claudeSkill(true).then((x) => (setS(x), setErr('')), (e) => setErr(e.message));
  return (
    <div class="set-row">
      <span>
        Claude Code skill
        <small>
          Lets Claude open a pull request that's ready for review here, linked to its session: ✳ Claude on that PR goes back to it, and after
          your review lgtm offers to send it the outcome. Claude asks once whether you want this.
          {s?.installed && <> Installed in <code>{s.path}</code>.</>}
        </small>
        {err && <small class="error">{err}</small>}
      </span>
      {s && (s.current ? <CheckMark state="success" title="Installed and up to date" /> : <button onClick={install}>{s.installed ? 'Update' : 'Install'}</button>)}
    </div>
  );
}

// Claude Code: which local checkout a new session for each repo opens in (the ✳ Claude menu). Without one, Claude
// asks for a folder itself.
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
  return (
    <section>
      <h3>Claude Code</h3>
      <p class="note">
        ✳ Claude (on a PR or a comment) opens a Claude Code session in the Claude desktop app with the PR or comment in the prompt. Set where each repo is checked
        out so the session starts there.
      </p>
      <ClaudeSkill />
      {!repos ? (
        <p class="note">Loading…</p>
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
    </section>
  );
}
