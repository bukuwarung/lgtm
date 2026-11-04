import { useEffect, useState } from 'preact/hooks';
import { awaitsMe, getThreads, getViewer, markBots, reply, resolveThread, type QueueItem, type Thread } from './github.ts';
import { ago, readBots, reportError } from './platform.ts';
import { PageSkeleton } from './history.tsx';
import { Tg } from './tags.tsx';

// Every review thread waiting on my reply, across the PRs in my list (#/inbox): the last word in each, and a reply or
// a resolve right here. Only PRs the list already counts a thread waiting on me in are asked for their threads.
type Waiting = { item: QueueItem; threads: Thread[] };

export function Inbox({ items }: { items: QueueItem[] | null }) {
  const [me, setMe] = useState('');
  const [list, setList] = useState<Waiting[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set()); // replied to or resolved here
  const asked = (items ?? []).filter((i) => (i.thread?.awaiting ?? 0) > 0);
  const key = asked.map((i) => `${i.id}@${i.updatedAt}`).join();
  useEffect(() => {
    if (!items) return;
    let stop = false;
    // Bots marked as the list marks them, so the count here is the list's.
    getViewer().then((login) =>
      Promise.all(asked.map(async (item) => ({ item, threads: markBots(await getThreads(item.repo, item.number), readBots()).filter((t) => awaitsMe(t, login, item.authored)) }))).then(
        (l) => !stop && (setMe(login), setList(l.filter((w) => w.threads.length))),
        (e) => !stop && (reportError(`Couldn't load your threads: ${e.message}`), setList([])),
      ),
    );
    return () => void (stop = true);
  }, [key]);
  if (!list) return <PageSkeleton title="threads waiting on your reply" />;
  const open = list.map((w) => ({ ...w, threads: w.threads.filter((t) => !done.has(t.id)) })).filter((w) => w.threads.length);
  const count = open.reduce((n, w) => n + w.threads.length, 0);
  return (
    <div class="page history inbox">
      <h2>Waiting on your reply</h2>
      <p class="note">{count ? `${count} thread${count === 1 ? '' : 's'} in ${open.length} PR${open.length === 1 ? '' : 's'}.` : 'Nothing waits on your reply.'}</p>
      {open.map(({ item, threads }) => (
        <section>
          <h4>
            <a href={`#/${item.repo}/pull/${item.number}`}>{item.title}</a> <small>{item.repo.split('/')[1]}#{item.number}</small>
          </h4>
          {threads.map((t) => (
            <InboxThread t={t} item={item} me={me} onDone={() => setDone((s) => new Set(s).add(t.id))} />
          ))}
        </section>
      ))}
    </div>
  );
}

function InboxThread({ t, item, me, onDone }: { t: Thread; item: QueueItem; me: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const last = t.comments.nodes[t.comments.nodes.length - 1];
  const where = `${t.path.split('/').pop()}${t.line ? `:${t.line}` : ''}`;
  const act = (what: string, run: () => Promise<unknown>) => {
    setBusy(what);
    run().then(onDone, (e) => (setBusy(''), reportError(`Couldn't ${what === 'reply' ? 'send the reply' : 'resolve it'}: ${e.message}`)));
  };
  return (
    <div class="inbox-thread">
      <div class="inbox-where">
        <a href={`#/${item.repo}/pull/${item.number}`} title={`${t.path}: open the PR`}>{where}</a>
        {t.isOutdated && <Tg i="history" t="outdated" />}
        <small>
          {last?.author?.login ?? 'someone'} · {last ? ago(last.createdAt) : ''}
          {t.comments.nodes.length > 1 && ` · ${t.comments.nodes.length} comments`}
        </small>
      </div>
      {last && <div class="md inbox-last" dangerouslySetInnerHTML={{ __html: last.bodyHTML }} />}
      <textarea rows={2} placeholder={`Reply to ${last?.author?.login === me ? 'this thread' : `@${last?.author?.login ?? 'them'}`}`} value={text} onInput={(e) => setText(e.currentTarget.value)} disabled={!!busy} />
      <div class="row">
        {t.viewerCanResolve && <button disabled={!!busy} onClick={() => act('resolve', () => resolveThread(t.id, true))}>{busy === 'resolve' ? 'Resolving…' : 'Resolve'}</button>}
        <button class="primary" disabled={!!busy || !text.trim()} onClick={() => act('reply', () => reply(item.repo, item.number, t.comments.nodes[0].databaseId, text.trim()))}>
          {busy === 'reply' ? 'Sending…' : 'Reply'}
        </button>
      </div>
    </div>
  );
}
