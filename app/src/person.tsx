import { useEffect, useState } from 'preact/hooks';
import { getPerson, type Person, type QueueItem, numRef } from './github.ts';
import { ago, personKey, usePresence, repoLabel, viewAs, term } from './platform.ts';
import { isAway, statusText } from './slackmsg.ts';
import { Tg, Who, Time } from './tags.tsx';
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

const hours = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} d`);
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
        {repoLabel(i.repo)}{numRef(i.repo, i.number)}{waiting ? <> · <Who login={i.author} /> · waiting {ago(i.waitingSince).replace(/ ago$/, '')}</> : <> · active <Time at={i.updatedAt} /></>}
      </small>
    </a>
  );
}

export function PersonPage({ login, orgs }: { login: string; orgs: string[] }) {
  const [p, setP] = useState<Person | string | null>(null);
  const presence = usePresence([login])[login];
  useEffect(() => void (setP(null), getPerson(login, orgs).then(setP, (e) => setP(e.message))), [login, orgs.join()]);
  if (p === null) return <PageSkeleton title={`@${login}`} face />;
  if (typeof p === 'string') return <div class="page history person"><h2>@{login}</h2><p class="error">{p}</p></div>;
  const count = (s: string) => p.reviews.filter((r) => r.state === s).length;
  const waits = p.reviews.flatMap((r) => (r.waited != null ? [r.waited] : [])).sort((a, b) => a - b);
  const median = waits.length ? waits[Math.floor(waits.length / 2)] : null;
  return (
    <div class="page history person">
      <header class="person-h">
        <img src={p.avatar} alt="" />
        <div>
          <h2>{p.name ?? p.login}</h2>
          <p class="note">
            {p.login.includes('@') ? (
              <a href={`https://${p.login.slice(p.login.lastIndexOf('@') + 1)}/${encodeURIComponent(p.login.slice(0, p.login.lastIndexOf('@')))}`} target="_blank" rel="noopener">@{p.login.slice(0, p.login.lastIndexOf('@'))}</a>
            ) : (
              <a href={`https://github.com/${encodeURIComponent(p.login)}`} target="_blank" rel="noopener">@{p.login}</a>
            )}
            {p.bio && ` · ${p.bio}`}
          </p>
          {presence && <p class={isAway(presence) ? 'ix-status away' : 'ix-status'}>{isAway(presence) && '🌴 '}{statusText(presence)}</p>}
        </div>
      </header>
      <p class="history-sum">
        {[
          `${p.mine.length} open ${term(login.includes('@')).PR}${p.mine.length === 1 ? '' : 's'}`,
          `${p.asked.length} waiting on their review`,
          `${p.reviews.length} review${p.reviews.length === 1 ? '' : 's'} this month`,
          count('APPROVED') && `${count('APPROVED')} approved`,
          count('CHANGES_REQUESTED') && `${count('CHANGES_REQUESTED')} with changes requested`,
          median != null && `typically ${hours(median)} after being asked`,
        ].filter(Boolean).join(' · ')}
      </p>
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
