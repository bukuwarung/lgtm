import { useEffect, useState } from 'preact/hooks';
import { getMyReviews, type MyReview } from './github.ts';
import { copyText } from './platform.ts';
import { Tg } from './tags.tsx';

// While a page of PRs loads (this one, a person's): its shape, shimmering (style.css .sk). `face`: a picture by the title.
const SK = [78, 62, 88, 55, 70];
export function PageSkeleton({ title, face }: { title: string; face?: boolean }) {
  return (
    <div class="page history" aria-busy="true" aria-label={`Loading ${title}`}>
      <header class="person-h">
        {face && <span class="sk sk-face" />}
        <div class="sk-head">
          <span class="sk" style={{ width: '220px', height: '20px' }} />
          {face && <span class="sk" style={{ width: '160px' }} />}
        </div>
      </header>
      <span class="sk sk-sum" />
      {[4, 3].map((rows, s) => (
        <section>
          <span class="sk sk-h4" />
          {Array.from({ length: rows }, (_, k) => (
            <div class="history-row sk-row">
              <span class="sk sk-pill" style={{ width: '96px' }} />
              <span class="sk" style={{ width: `${SK[(k + s) % SK.length]}%`, height: '12px' }} />
              <span class="sk sk-meta" style={{ width: `${SK[(k + s + 2) % SK.length] - 20}%` }} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// Your reviews of the last 30 days (#/history): a summary line, then each day's, to read back or paste in a standup.
const VERDICT: Record<string, [string, string]> = { APPROVED: ['approved', 'Approved'], CHANGES_REQUESTED: ['changes', 'Requested changes'], COMMENTED: ['reply', 'Commented'], DISMISSED: ['', 'Dismissed'] };
const hours = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} d`);
const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });

export function History() {
  const [list, setList] = useState<MyReview[] | string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => void getMyReviews(30).then(setList, (e) => setList(e.message)), []);
  if (list === null) return <PageSkeleton title="your reviews" />;
  if (typeof list === 'string') return <div class="page history"><h2>Your reviews this month</h2><p class="error">{list}</p></div>;
  const count = (s: string) => list.filter((r) => r.state === s).length;
  const waits = list.flatMap((r) => (r.waited != null ? [r.waited] : [])).sort((a, b) => a - b);
  const median = waits.length ? waits[Math.floor(waits.length / 2)] : null;
  const summary = [
    `${list.length} review${list.length === 1 ? '' : 's'}`,
    count('APPROVED') && `${count('APPROVED')} approved`,
    count('CHANGES_REQUESTED') && `${count('CHANGES_REQUESTED')} with changes requested`,
    count('COMMENTED') && `${count('COMMENTED')} commented`,
    median != null && `typically ${hours(median)} after being asked`,
  ].filter(Boolean).join(' · ');
  const days = [...new Set(list.map((r) => day(r.at)))];
  const copy = () =>
    copyText([`Reviews in the last 30 days: ${summary}`, ...list.map((r) => `- ${VERDICT[r.state][1]}: ${r.title} (${r.repo}#${r.number}) ${r.url}`)].join('\n'))
      .then(() => setCopied(true), () => {});
  return (
    <div class="page history">
      <h2>Your reviews this month</h2>
      <p class="history-sum">
        {list.length ? summary : 'No reviews in the last 30 days.'}
        {list.length > 0 && <button class="link" onClick={copy}>{copied ? 'Copied' : 'Copy as text'}</button>}
      </p>
      {days.map((d) => (
        <section>
          <h4>{d}</h4>
          {list.filter((r) => day(r.at) === d).map((r) => (
            <a class="history-row" href={`#/${r.repo}/pull/${r.number}`}>
              <span class={`ix-meta v-${r.state}`}><Tg i={VERDICT[r.state][0]} t={VERDICT[r.state][1]} /></span>
              <b>{r.title}</b>
              <small>{r.repo}#{r.number} · {r.author}{r.waited != null ? ` · ${hours(r.waited)} after you were asked` : ''} · {new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>
            </a>
          ))}
        </section>
      ))}
    </div>
  );
}
