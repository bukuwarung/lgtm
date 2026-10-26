import { useEffect, useRef, useState } from 'preact/hooks';
import { getPeople, getReviewQueue, getTeamMembers, getTeams, getViewer } from './github.ts';
import { askNotifications, useSavedReplies, type SavedReply, availableUpdate, copyDiagnostics, diagnostics, selfUpdate, UPGRADE, fetchIntegrations, restoreBackup, saveBackup, findSlackPeople, isDesktop, launchAtLogin, setLaunchAtLogin, getSlackPeople, saveSlackPeople, useBots, useStoredFlag, useStoredValue, type Integrations, type SlackMatch, type SlackPeople } from './platform.ts';
import { ACTIONS, FIXED, keyLabel, RESERVED, useBindings, type Action } from './keys.ts';
import { DemoPair } from './demos.tsx';
import { highlightCode } from './highlight.ts';
import { CODE_FONTS, CODE_THEMES, useCodeLook } from './look.ts';

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
      <span class={ok == null ? 'ck ck-pending' : ok ? 'ck ck-success' : 'ck ck-failure'}>{ok == null ? '●' : ok ? '✓' : '✕'}</span>
      <div>{children}</div>
    </div>
  );
}

// Everything lgtm remembers, in one place, plus whether the tools it drives (gh, slackcli, acli) are signed in.
// Preferences live in this browser; changing one here updates the open views at once.
export function Settings() {
  const [theme, setTheme] = useTheme();
  const look = useCodeLook();
  const [keys] = useBindings();
  const also = (k: string) => (k ? `Also ${keyLabel(k)} on a PR.` : undefined);
  const [team, setTeam] = useStoredValue('team', '');
  const [notify, toggleNotify] = useStoredFlag('notifyRequests', false);
  const [teams, setTeams] = useState<string[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [ints, setInts] = useState<Integrations | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    getViewer().then(setMe, () => setMe(''));
    getTeams().then(setTeams, () => setTeams([]));
    fetchIntegrations().then(setInts, (e) => setErr(e.message));
  }, []);

  return (
    <div class="page settings">
      <h2>Settings</h2>

      <section>
        <h3>Accounts</h3>
        <p class="note">lgtm runs on your machine and borrows the sign-ins of these command-line tools; it stores no tokens.</p>
        <Status ok={me == null ? null : !!me}>
          <b>GitHub</b> {me ? <>signed in as <code>@{me}</code> through the GitHub CLI</> : me === '' ? 'not signed in' : 'checking…'}
          {me === '' && <pre>gh auth login</pre>}
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
            <small>For new review requests, and PRs coming back to you for re-review.</small>
          </span>
        </label>
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

      <section>
        <h3>Reviewing</h3>
        <Flag k="showIndex" initial={true} label="Show the PR index beside the diff" hint={also(keys.index)} />
        <Flag k="ignoreWs" initial={false} label="Ignore whitespace-only changes" hint={also(keys.whitespace)} demo />
        <Flag k="ticketOpen" initial={true} label="Expand the Jira ticket above the conversation" />
        <Flag k="slackNotify" initial={true} label="Message the author and assignees on Slack after a review" hint="You can still untick it per review." />
        <Flag k="nextAfterReview" initial={true} label="After a review, open the next PR that needs it" />
      </section>

      <section>
        <h3>Diff</h3>
        <Flag k="sinceFirst" initial={true} label="On a re-review, show only what changed since your last review" demo>
          <Flag k="sinceNotOnMine" initial={true} label="Except on your own PRs" hint="They open with every change; the bar above the files still switches to just the new commits." />
        </Flag>
        <Flag k="foldImports" initial={true} label="Fold package and import blocks" hint="Kotlin, Java, TypeScript, JavaScript. New outside packages are still named." demo />
        <Flag k="hideGenerated" initial={true} label="Hide generated files" hint="Files marked linguist-generated or linguist-binary in .gitattributes." demo />
        <Flag k="hideNoDiff" initial={true} label="Hide files renamed or moved without changes" demo />
        <Flag k="collapseDeleted" initial={true} label="Collapse deleted files to one row" demo />
        <Flag k="dimMoved" initial={true} label="Dim code moved without changes" demo />
        <Flag k="wordDiff" initial={true} label="Highlight the changed words inside a line" demo />
        <Flag k="renderDocs" initial={true} label="Render doc comments" hint="KDoc, Javadoc and JSDoc read like IntelliJ's reader mode; edited ones stay source." demo />
        <Flag k="richMarkdown" initial={true} label="Show markdown files rendered" hint="Still commented line by line: hover a block for its +. Source is a click away per file." demo />
        <Flag k="previewImages" initial={true} label="Show images and vector drawables as pictures" demo />
        <Flag k="foldBots" initial={true} label="Fold bot comments and bot-only threads" demo>
          <Flag k="unfoldBotsOnMine" initial={true} label="Except on your own PRs" hint="There, CI and AI-reviewer comments are usually yours to act on." />
        </Flag>
        <Flag k="resumePosition" initial={true} label="Reopen a PR where you left off" />
        <Flag k="blameHover" initial={true} label="Show who last changed a line" hint="Hover a line number for a moment: the commit, when, and its PR." />
        <Flag k="flagUntested" initial={true} label="Point out code changed without test changes" hint="A guess by file name: Foo.kt counts as tested when the PR also changes FooTest.kt (or foo.test.ts, test_foo.py…)." />
      </section>

      {isDesktop && <LaunchAtLogin />}

      <section>
        <h3>Appearance</h3>
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

      <ClaudeFolders />

      <BackupSection />

      <Shortcuts />

      <SavedReplies />
      <About />
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
      lgtm {__APP_VERSION__} · {isDesktop ? 'macOS app' : 'browser version'}
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
                <button title="Remove" onClick={() => save(list.filter((_, k) => k !== i))}>✕</button>
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
function SlackPeopleSection({ team }: { team: string }) {
  const [everyone, setLogins] = useState<string[] | null>(null);
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
      const people = new Set([...members, ...queue.map((i) => i.author)]);
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
                <tr key={l}>
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
                      <small class="inline">no single match; add it to the config by hand</small>
                    ) : (
                      <small class="inline">not mapped</small>
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
      <Flag
        k="claudeSessions"
        initial={true}
        label="Find sessions per PR"
        hint="The ✳ menu also lists sessions started on that PR, to continue one. lgtm reads the Claude app's session records on this Mac (titles and first prompts) and keeps nothing."
      />
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
