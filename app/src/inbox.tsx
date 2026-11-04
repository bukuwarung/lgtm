import { useEffect, useState } from 'preact/hooks';
import { awaitsMe, commitSuggestions, forgetThreadStatus, getMergedAwaiting, getPR, getThreads, getViewer, markBots, reply, resolveThread, suggestionOf, type QueueItem, type Thread } from './github.ts';
import { ago, markReplyDone, readBots, reportError } from './platform.ts';
import { PageSkeleton } from './history.tsx';
import { Tg } from './tags.tsx';

// Every review thread waiting on my reply (#/inbox): in the PRs in my list (only those the list already counts one
// waiting in are asked for their threads), and in PRs merged lately that I opened or reviewed, where a reply after
// the merge would go unseen. The last word in each, and a reply or a resolve right here; on my open PRs, a reviewer's
// suggestion committed. Keys: j/k move, r reply, e done, x resolve, c commit the suggestion, o open the PR.
type Item = Pick<QueueItem, 'id' | 'repo' | 'number' | 'title' | 'authored' | 'updatedAt'> & { mergedAt?: string };
type Waiting = { item: Item; threads: Thread[] };

export function Inbox({ items }: { items: QueueItem[] | null }) {
  const [me, setMe] = useState('');
  const [list, setList] = useState<Waiting[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set()); // replied to or resolved here
  const [cur, setCur] = useState(0); // the thread the keys act on, in page order
  const asked = (items ?? []).filter((i) => (i.thread?.awaiting ?? 0) > 0);
  const key = items ? asked.map((i) => `${i.id}@${i.updatedAt}`).join() + '|' : ''; // the list's arrival counts, even with nothing waiting in it
  useEffect(() => {
    if (!items) return;
    let stop = false;
    // Bots marked as the list marks them, so the count here is the list's.
    getViewer().then(async (login) => {
      const merged: Item[] = await getMergedAwaiting(login).catch(() => []);
      const look = (item: Item) => getThreads(item.repo, item.number).then((ts) => ({ item, threads: markBots(ts, readBots()).filter((t) => awaitsMe(t, login, item.authored)) }));
      Promise.all([...asked, ...merged.filter((m) => !asked.some((a) => a.id === m.id))].map(look)).then(
        (l) => !stop && (setMe(login), setList(l.filter((w) => w.threads.length))),
        (e) => !stop && (reportError(`Couldn't load your threads: ${e.message}`), setList([])),
      );
    });
    return () => void (stop = true);
  }, [key]);
  const open = (list ?? []).map((w) => ({ ...w, threads: w.threads.filter((t) => !done.has(t.id)) })).filter((w) => w.threads.length);
  const count = open.reduce((n, w) => n + w.threads.length, 0);
  const at = Math.min(cur, count - 1); // a thread done here leaves the keys on the one after it
  // The keys press the current thread's own buttons, so they do what a click does (and nothing a disabled one won't).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest('input, textarea, select, [contenteditable]') || document.querySelector('.help, .panel, dialog[open]')) return;
      const el = document.querySelectorAll<HTMLElement>('.inbox-thread')[at];
      const move = e.key === 'j' ? 1 : e.key === 'k' ? -1 : 0;
      if (move) setCur(Math.max(0, Math.min(count - 1, at + move)));
      else if (e.key === 'r') el?.querySelector('textarea')?.focus();
      else if ('exco'.includes(e.key) && e.key.length === 1) el?.querySelector<HTMLElement>(`[data-k="${e.key}"]`)?.click();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [at, count]);
  useEffect(() => document.querySelectorAll('.inbox-thread')[at]?.scrollIntoView({ block: 'nearest' }), [at]);
  if (!list) return <PageSkeleton title="threads waiting on your reply" />;
  let k = 0;
  return (
    <div class="page history inbox">
      <h2>Waiting on your reply</h2>
      <p class="note">
        {count ? `${count} thread${count === 1 ? '' : 's'} in ${open.length} PR${open.length === 1 ? '' : 's'}.` : 'Nothing waits on your reply.'}
        {count > 0 && (
          <span class="inbox-keys">
            <kbd>j</kbd> <kbd>k</kbd> move · <kbd>r</kbd> reply · <kbd>e</kbd> done · <kbd>x</kbd> resolve · <kbd>o</kbd> open the PR
          </span>
        )}
      </p>
      {open.map(({ item, threads }) => (
        <section>
          <h4>
            <a href={`#/${item.repo}/pull/${item.number}`}>{item.title}</a> <small>{item.repo.split('/')[1]}#{item.number}</small>
            {item.mergedAt && <small class="inbox-merged"> · merged {ago(item.mergedAt)}</small>}
          </h4>
          {threads.map((t) => {
            const n = k++;
            return <InboxThread t={t} item={item} me={me} current={n === at} onPick={() => setCur(n)} onDone={() => setDone((s) => new Set(s).add(t.id))} />;
          })}
        </section>
      ))}
    </div>
  );
}

const FAILED: Record<string, string> = { reply: 'send the reply', resolve: 'resolve it', commit: 'commit the suggestion' };

function InboxThread({ t, item, me, current, onPick, onDone }: { t: Thread; item: Item; me: string; current: boolean; onPick: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const last = t.comments.nodes[t.comments.nodes.length - 1];
  const where = `${t.path.split('/').pop()}${t.line ? `:${t.line}` : ''}`;
  // On my own open PR, the last word a current suggested change: committed to the branch, the thread resolved (as the
  // PR view's "Commit suggestion" does).
  const sug = item.authored && !item.mergedAt && !t.isOutdated && last && last.author?.login !== me ? suggestionOf(t, last) : null;
  const commit = async () => {
    const pr = await getPR(item.repo, item.number);
    await commitSuggestions(pr.head.repo?.full_name ?? item.repo, pr.head.ref, pr.head.sha, [sug!], me);
    await resolveThread(t.id, true).catch(() => {});
    dispatchEvent(new Event('lgtm:list-refresh'));
  };
  const act = (what: string, run: () => Promise<unknown>) => {
    setBusy(what);
    run().then(onDone, (e) => (setBusy(''), reportError(`Couldn't ${FAILED[what]}: ${e.message}`)));
  };
  const send = () => text.trim() && !busy && act('reply', () => reply(item.repo, item.number, t.comments.nodes[0].databaseId, text.trim()));
  return (
    <div class={current ? 'inbox-thread cur' : 'inbox-thread'} onPointerDown={onPick} onFocusIn={onPick}>
      <div class="inbox-where">
        <a href={`#/${item.repo}/pull/${item.number}`} title={`${t.path}: open the PR`} data-k="o">{where}</a>
        {t.isOutdated && <Tg i="history" t="outdated" />}
        <small>
          {last?.author?.login ?? 'someone'} · {last ? ago(last.createdAt) : ''}
          {t.comments.nodes.length > 1 && ` · ${t.comments.nodes.length} comments`}
        </small>
      </div>
      {last && <div class="md inbox-last" dangerouslySetInnerHTML={{ __html: last.bodyHTML }} />}
      <textarea rows={2} placeholder={`Reply to ${last?.author?.login === me ? 'this thread' : `@${last?.author?.login ?? 'them'}`}`} value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => (e.key === 'Escape' ? e.currentTarget.blur() : e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), send()))}
        disabled={!!busy}
      />
      <div class="row">
        {/* Done: off the list without a reply or a resolve, until someone writes again (kept on this machine). */}
        <button
          disabled={!!busy || !last}
          data-k="e"
          title="Take it off your list without replying; it comes back if someone writes again. Nothing changes on GitHub."
          onClick={() => (markReplyDone(t.id, last!.databaseId), forgetThreadStatus(item.id), dispatchEvent(new Event('lgtm:list-refresh')), onDone())}
        >
          Done
        </button>
        {t.viewerCanResolve && <button disabled={!!busy} data-k="x" onClick={() => act('resolve', () => resolveThread(t.id, true))}>{busy === 'resolve' ? 'Resolving…' : 'Resolve'}</button>}
        {sug && (
          <button disabled={!!busy} data-k="c" title={`Commit @${last!.author?.login}'s suggestion to the branch and resolve the thread (c)`} onClick={() => act('commit', commit)}>
            {busy === 'commit' ? 'Committing…' : 'Commit suggestion'}
          </button>
        )}
        <button class="primary" disabled={!!busy || !text.trim()} title="Send (⌘↵)" onClick={send}>
          {busy === 'reply' ? 'Sending…' : 'Reply'}
        </button>
      </div>
    </div>
  );
}
