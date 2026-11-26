import { useEffect, useState } from 'preact/hooks';
import { getPerson, type Person, type QueueItem, numRef } from './github.ts';
import { ago, duration, personKey, usePresence, repoLabel, viewAs, term, shownName, getSlackPeople, fetchIntegrations, openExternal, faceOf } from './platform.ts';
import { isAway, statusText, zoneLine } from './slackmsg.ts';
import { Octicon, Empty, Stats, Tg, Who, Time } from './tags.tsx';
import { PageSkeleton } from './history.tsx';

// The words of the site on show: GitHub's PRs and teams, or GitLab's MRs and groups (the avatar's menu; switching reloads).


// Someone's page (#/person/<login>), from their picture or name anywhere: their open PRs, the PRs waiting on their
// review, and their reviews of the last 30 days.
export const isPerson = (login?: string | null) => !!login && !/\[bot\]$|^ghost$/.test(login);
// A click on someone that opens their page (inside a link or a fold, it doesn't open those too).
// `repo`: the PR they're on (a GitLab one's people open as login@host); without one, the account on show's site.
export const toPerson = (login: string, repo?: string) => (e: Event) => {
  if (!isPerson(login)) return;
  e.preventDefault();
  e.stopPropagation();
  const key = repo ? personKey(repo, login) : viewAs() && !login.includes('@') ? `${login}@${viewAs()}` : login;
  location.hash = '/person/' + encodeURIComponent(key);
};

const hours = duration; // platform.ts: how LGTM writes a length of time
const VERDICT: Record<string, [string, string]> = { APPROVED: ['approved', 'Approved'], CHANGES_REQUESTED: ['changes', 'Requested changes'], COMMENTED: ['reply', 'Commented'], DISMISSED: ['', 'Dismissed'] };

function Row({ i, waiting }: { i: QueueItem; waiting?: boolean }) {
  const ci = i.ci === 'FAILURE' || i.ci === 'ERROR';
  return (
    <a class="history-row" href={`#/${i.repo}/pull/${i.number}`}>
      <span class="person-pills">
        {i.isDraft ? <span class="pill"><Tg i="draft" t="draft" /></span>
          : i.reviewDecision === 'APPROVED' ? <span class="pill p-ok"><Tg i="approved" t="approved" /></span>
          : i.reviewDecision === 'CHANGES_REQUESTED' ? <span class="pill p-bad"><Tg i="changes" t="changes requested" /></span>
          : <span class="pill"><Tg i="waiting" t="awaiting review" /></span>}
        {ci && <span class="pill p-bad"><Tg i="ci" t="CI failing" /></span>}
      </span>
      <b>{i.title}</b>
      <small>
        {repoLabel(i.repo)}{numRef(i.repo, i.number)}{waiting ? <> · <Who login={i.author} /> · waiting {duration(Date.now() - new Date(i.waitingSince).getTime())}</> : <> · active <Time at={i.updatedAt} /></>}
      </small>
    </a>
  );
}

export function PersonPage({ login, orgs }: { login: string; orgs: string[] }) {
  const [p, setP] = useState<Person | string | null>(null);
  const presence = usePresence([login])[login];
  // Your DM with them in Slack's app, for someone matched there (Settings → Slack → People).
  const [dm, setDm] = useState('');
  useEffect(() => {
    setDm('');
    Promise.all([getSlackPeople(), fetchIntegrations()]).then(([sp, i]) => {
      const id = sp.mine[login];
      if (i.slack.ok && i.slack.team && /^U[A-Z0-9]+$/.test(id ?? '')) setDm(`slack://user?team=${i.slack.team}&id=${id}`);
    }, () => {});
  }, [login]);
  const [tries, setTries] = useState(0);
  useEffect(() => void (setP(null), getPerson(login, orgs).then(setP, (e) => setP(e.message))), [login, orgs.join(), tries]);
  if (p === null) return <PageSkeleton title={`@${login}`} face />;
  if (typeof p === 'string') return <div role="main" class="page history person"><h2>@{login}</h2><Empty tone="err" action={['Retry', () => setTries((t) => t + 1)]}>{p}</Empty></div>;
  const count = (s: string) => p.reviews.filter((r) => r.state === s).length;
  const waits = p.reviews.flatMap((r) => (r.waited != null ? [r.waited] : [])).sort((a, b) => a - b);
  const median = waits.length ? waits[Math.floor(waits.length / 2)] : null;
  return (
    <div role="main" class="page history person">
      <header class="person-h">
        <img src={p.login.includes("@") ? p.avatar : faceOf(p.login, 96)} alt="" />
        <div>
          <h2>{p.name ?? shownName(p.login)}</h2>
          <p class="note">
            {p.login.includes('@') ? (
              <a href={`https://${p.login.slice(p.login.lastIndexOf('@') + 1)}/${encodeURIComponent(p.login.slice(0, p.login.lastIndexOf('@')))}`} target="_blank" rel="noopener">@{p.login.slice(0, p.login.lastIndexOf('@'))}</a>
            ) : (
              <a href={`https://github.com/${encodeURIComponent(p.login)}`} target="_blank" rel="noopener">@{p.login}</a>
            )}
            {p.bio && ` · ${p.bio}`}
          </p>
          {presence && <p class={isAway(presence) ? 'ix-status away' : 'ix-status'}>{isAway(presence) && '🌴 '}{statusText(presence)}</p>}
          {presence?.tz && zoneLine(presence.tz) && <p class="note"><Octicon name="clock" /> {zoneLine(presence.tz)}</p>}
          {dm && <button onClick={() => void openExternal(dm)}>Message on Slack</button>}
        </div>
      </header>
      <Stats items={[
        { n: p.asked.length, label: 'Waiting on their review' },
        { n: p.mine.length, label: `Open ${term(login.includes('@')).PR}${p.mine.length === 1 ? '' : 's'}` },
        { n: median != null ? hours(median) : '–', label: 'Typical response', title: 'How long after being asked they typically reviewed, this month (the median)' },
        { n: p.reviews.length, label: `Review${p.reviews.length === 1 ? '' : 's'} this month` },
        { n: count('APPROVED'), label: 'Approved', tone: 'ok' },
        { n: count('CHANGES_REQUESTED'), label: 'Changes requested' },
      ]} />
      <section>
        <h4>Waiting on their review</h4>
        {p.asked.length ? p.asked.map((i) => <Row i={i} waiting />) : <p class="note">None.</p>}
      </section>
      <section>
        <h4>Their open {term(login.includes('@')).PRs}</h4>
        {p.mine.length ? p.mine.map((i) => <Row i={i} />) : <p class="note">None.</p>}
      </section>
      <section>
        <h4>Reviewed in the last 30 days</h4>
        {p.reviews.length ? (
          p.reviews.map((r) => (
            <a class="history-row" href={`#/${r.repo}/pull/${r.number}`}>
              <span class={`ix-meta v-${r.state}`}><Tg i={VERDICT[r.state][0]} t={VERDICT[r.state][1]} /></span>
              <b>{r.title}</b>
              <small>{repoLabel(r.repo)}#{r.number} · <Who login={r.author} />{r.waited != null ? ` · ${hours(r.waited)} after being asked` : ''} · <Time at={r.at} /></small>
            </a>
          ))
        ) : (
          <p class="note">None.</p>
        )}
      </section>
    </div>
  );
}
