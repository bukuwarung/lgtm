import { useEffect, useState } from 'preact/hooks';
import { getPeople, getReviewQueue, getTeamMembers, getTeams, getViewer } from './github.ts';
import { fetchIntegrations, findSlackPeople, getSlackPeople, saveSlackPeople, useBots, useStoredFlag, useStoredValue, type Integrations, type SlackMatch, type SlackPeople } from './platform.ts';
import { SHORTCUTS } from './review.tsx';
import { DemoPair } from './demos.tsx';

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

// A switch; with an example (demos.tsx) it also shows what it does, the side you have now outlined.
function Flag({ k, initial, label, hint, demo }: { k: string; initial: boolean; label: string; hint?: string; demo?: boolean }) {
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
              if (!notify && (await Notification.requestPermission()) !== 'granted') return setErr('Notifications are blocked for this page in your browser settings.');
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
        <Flag k="showIndex" initial={true} label="Show the PR index beside the diff" hint="Also i." />
        <Flag k="ignoreWs" initial={false} label="Ignore whitespace-only changes" hint="Also w." demo />
        <Flag k="ticketOpen" initial={true} label="Expand the Jira ticket above the conversation" />
        <Flag k="slackNotify" initial={true} label="Message the author and assignees on Slack after a review" hint="You can still untick it per review." />
        <Flag k="nextAfterReview" initial={true} label="After a review, open the next PR that needs it" />
      </section>

      <section>
        <h3>Diff</h3>
        <Flag k="sinceFirst" initial={true} label="On a re-review, show only what changed since your last review" demo />
        <Flag k="foldImports" initial={true} label="Fold package and import blocks" hint="Kotlin, Java, TypeScript, JavaScript. New outside packages are still named." demo />
        <Flag k="hideGenerated" initial={true} label="Hide generated files" hint="Files marked linguist-generated in .gitattributes." demo />
        <Flag k="hideNoDiff" initial={true} label="Hide files renamed or moved without changes" demo />
        <Flag k="collapseDeleted" initial={true} label="Collapse deleted files to one row" demo />
        <Flag k="dimMoved" initial={true} label="Dim code moved without changes" demo />
        <Flag k="wordDiff" initial={true} label="Highlight the changed words inside a line" demo />
        <Flag k="richMarkdown" initial={true} label="Show markdown files rendered" hint="Source is a click away per file." demo />
        <Flag k="previewImages" initial={true} label="Show images and vector drawables as pictures" demo />
        <Flag k="foldBots" initial={true} label="Fold bot comments and bot-only threads" demo />
        <Flag k="resumePosition" initial={true} label="Reopen a PR where you left off" />
      </section>

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
      </section>

      <section>
        <h3>Keyboard shortcuts</h3>
        <table class="set-keys">
          <tbody>
            {SHORTCUTS.map(([k, d]) => (
              <tr key={k}>
                <td><kbd>{k}</kbd></td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
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
