import { useEffect, useState } from 'preact/hooks';
import { awaitsMe, commentOnPR, commitSuggestions, forgetThreadStatus, getMentions, getMergedAwaiting, getPR, getThreads, getViewer, markBots, reply, resolveThread, suggestionOf, type Comment, type QueueItem, type Thread } from './github.ts';
import { ago, markReplyDone, readBots, reportError, useStoredFlag } from './platform.ts';
import { PageSkeleton } from './history.tsx';
import { Tg, Who } from './tags.tsx';

// Every review thread waiting on my reply (#/inbox): in the PRs in my list (only those the list already counts one
// waiting in are asked for their threads), and in PRs merged lately that I opened or reviewed, where a reply after
// the merge would go unseen. The last word in each, and a reply or a resolve right here; on my open PRs, a reviewer's
// suggestion committed. Also a PR conversation comment that @-mentions me, if I haven't written there since (in my
// PRs and those the list has as mentioning me). Keys: j/k move, r reply, e done, x resolve, c commit the suggestion,
// o open the PR.
type Item = Pick<QueueItem, 'id' | 'repo' | 'number' | 'title' | 'authored' | 'updatedAt'> & { mergedAt?: string; myState?: QueueItem['myState'] };
type Waiting = { item: Item; threads: Thread[]; mention?: Comment };

export function Inbox({ items }: { items: QueueItem[] | null }) {
  const [me, setMe] = useState('');
  const [list, setList] = useState<Waiting[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set()); // replied to or resolved here
  const [cur, setCur] = useState(0); // the thread the keys act on, in page order
  const asked = (items ?? []).filter((i) => (i.thread?.awaiting ?? 0) > 0);
  const [muteApproved] = useStoredFlag('muteApproved', false); // Settings: nothing from PRs I've approved
  // Asked for comments mentioning me: the list's mentioning PRs and mine, unless the list already knows none waits.
  const named = (items ?? []).filter((i) => (i.mentioned || i.authored) && i.mentionWaiting !== false && !(muteApproved && i.myState === 'APPROVED'));
  // A refresh asks again about the PRs that changed: until it knows, what's shown stays (and a reply being typed with it).
  const pending = !!items?.some((i) => (i.mine || i.myState) && !i.thread);
  const key = items ? [...asked, ...named].map((i) => `${i.id}@${i.updatedAt}`).join() + '|' + (pending ? 'pending' : '') : ''; // the list's arrival counts, even with nothing waiting in it
  useEffect(() => {
    if (!items || (pending && list)) return;
    let stop = false;
    // Bots marked as the list marks them, so the count here is the list's.
    getViewer().then(async (login) => {
      const [merged, mentions] = await Promise.all([getMergedAwaiting(login).catch((): Item[] => []), getMentions(named.map((i) => i.id), login, readBots()).catch(() => new Map<string, Comment>())]);
      const look = (item: Item) => getThreads(item.repo, item.number).then((ts) => ({ item, threads: markBots(ts, readBots()).filter((t) => awaitsMe(t, login, item.authored)) }));
      const threaded = [...asked, ...merged.filter((m) => !asked.some((a) => a.id === m.id) && !(muteApproved && m.myState === 'APPROVED'))];
      Promise.all(threaded.map(look)).then(
        (l) => {
          if (stop) return;
          const only = named.filter((i) => mentions.has(i.id) && !threaded.some((t) => t.id === i.id)).map((item) => ({ item, threads: [] }));
          setMe(login);
          setList([...l, ...only].map((w) => ({ ...w, mention: mentions.get(w.item.id) })).filter((w) => w.threads.length || w.mention));
        },
        (e) => !stop && (reportError(`Couldn't load your threads: ${e.message}`), setList([])),
      );
    });
    return () => void (stop = true);
  }, [key]);
  const open = (list ?? [])
    .map((w) => ({ ...w, threads: w.threads.filter((t) => !done.has(t.id)), mention: w.mention && !done.has(w.mention.id!) ? w.mention : undefined }))
    .filter((w) => w.threads.length || w.mention);
  const threadCount = open.reduce((n, w) => n + w.threads.length, 0);
  const mentionCount = open.filter((w) => w.mention).length;
  const count = threadCount + mentionCount;
  const at = Math.min(cur, count - 1); // a thread done here leaves the keys on the one after it
  // The keys press the current thread's own buttons, so they do what a click does (and nothing a disabled one won't).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest('input, textarea, select, [contenteditable]') || document.querySelector('.help, .panel, dialog[open]')) return;
      // From the page, not this render's state: a key pressed just after a thread goes acts on what's shown.
      const all = [...document.querySelectorAll<HTMLElement>('.inbox-thread')];
      const el = document.querySelector<HTMLElement>('.inbox-thread.cur');
      const move = e.key === 'j' ? 1 : e.key === 'k' ? -1 : 0;
      if (move) setCur(Math.max(0, Math.min(all.length - 1, all.indexOf(el!) + move)));
      else if (e.key === 'r') el?.querySelector('textarea')?.focus();
      else if ('exco'.includes(e.key) && e.key.length === 1) el?.querySelector<HTMLElement>(`[data-k="${e.key}"]`)?.click();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => document.querySelectorAll('.inbox-thread')[at]?.scrollIntoView({ block: 'nearest' }), [at]);
  if (!list) return <PageSkeleton title="threads waiting on your reply" />;
  let k = 0;
  return (
    <div class="page history inbox">
      <h2>Waiting on your reply</h2>
      <p class="note">
        {count
          ? `${[threadCount && `${threadCount} thread${threadCount === 1 ? '' : 's'}`, mentionCount && `${mentionCount} mention${mentionCount === 1 ? '' : 's'}`].filter(Boolean).join(' and ')} in ${open.length} PR${open.length === 1 ? '' : 's'}.`
          : 'Nothing waits on your reply.'}
        {count > 0 && (
          <span class="inbox-keys">
            <kbd>j</kbd> <kbd>k</kbd> move · <kbd>r</kbd> reply · <kbd>e</kbd> done · <kbd>x</kbd> resolve · <kbd>o</kbd> open the PR
          </span>
        )}
      </p>
      {open.map(({ item, threads, mention }) => (
        <section key={item.id}>
          <h4>
            <a href={`#/${item.repo}/pull/${item.number}`}>{item.title}</a> <small>{item.repo.split('/')[1]}#{item.number}</small>
            {item.mergedAt && <small class="inbox-merged"> · merged {ago(item.mergedAt)}</small>}
          </h4>
          {mention && (() => {
            const n = k++;
            return <InboxMention key={mention.id} c={mention} item={item} current={n === at} onPick={() => setCur(n)} onDone={() => setDone((s) => new Set(s).add(mention.id!))} />;
          })()}
          {threads.map((t) => {
            const n = k++;
            return <InboxThread key={t.id} t={t} item={item} me={me} current={n === at} onPick={() => setCur(n)} onDone={() => setDone((s) => new Set(s).add(t.id))} />;
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
          {last?.author ? <Who login={last.author.login} src={last.author.avatarUrl} /> : 'someone'} · {last ? ago(last.createdAt) : ''}
          {t.comments.nodes.length > 1 && ` · ${t.comments.nodes.length} comments`}
        </small>
      </div>
      <Code t={t} />
      {t.comments.nodes.length > 1 && (
        <details class="inbox-earlier">
          <summary>{t.comments.nodes.length - 1} earlier comment{t.comments.nodes.length > 2 ? 's' : ''}</summary>
          {t.comments.nodes.slice(0, -1).map((c) => (
            <div class="inbox-earlier-one">
              <small>{c.author ? <Who login={c.author.login} src={c.author.avatarUrl} /> : 'someone'} · {ago(c.createdAt)}</small>
              <div class="md" dangerouslySetInnerHTML={{ __html: c.bodyHTML }} />
            </div>
          ))}
        </details>
      )}
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

// The lines the thread is on: the end of the diff its first comment was written on (as GitHub's thread shows), the
// commented lines and a few above them.
function Code({ t }: { t: Thread }) {
  const hunk = t.hunk?.nodes[0]?.diffHunk;
  if (!hunk || t.subjectType === 'FILE') return null; // on a whole file: no lines to show
  const lines = hunk.split('\n').filter((l) => !l.startsWith('@@'));
  const span = t.line && t.startLine ? t.line - t.startLine + 1 : 1;
  return (
    <pre class="inbox-code">
      {lines.slice(-Math.min(12, Math.max(4, span))).map((l) => (
        <div class={l[0] === '+' ? 'a' : l[0] === '-' ? 'd' : ''}>{l || ' '}</div>
      ))}
    </pre>
  );
}

// A PR conversation comment mentioning me: a reply goes on the conversation; Done as a thread's.
function InboxMention({ c, item, current, onPick, onDone }: { c: Comment; item: Item; current: boolean; onPick: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    commentOnPR(item.repo, item.number, text.trim()).then(onDone, (e) => (setBusy(false), reportError(`Couldn't send the reply: ${e.message}`)));
  };
  return (
    <div class={current ? 'inbox-thread cur' : 'inbox-thread'} onPointerDown={onPick} onFocusIn={onPick}>
      <div class="inbox-where">
        <a href={c.url} target="_blank" rel="noreferrer" title="The comment on GitHub">mentioned you</a>
        <a href={`#/${item.repo}/pull/${item.number}`} data-k="o" hidden />
        <small>{c.author ? <Who login={c.author.login} src={c.author.avatarUrl} /> : 'someone'} · {ago(c.createdAt)}</small>
      </div>
      <div class="md inbox-last" dangerouslySetInnerHTML={{ __html: c.bodyHTML }} />
      <textarea
        rows={2}
        placeholder={`Reply to @${c.author?.login ?? 'them'} on the PR`}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => (e.key === 'Escape' ? e.currentTarget.blur() : e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), send()))}
        disabled={busy}
      />
      <div class="row">
        <button disabled={busy} data-k="e" title="Take it off your list without replying. Nothing changes on GitHub." onClick={() => (markReplyDone(c.id!, c.databaseId), forgetThreadStatus(item.id), dispatchEvent(new Event('lgtm:list-refresh')), onDone())}>
          Done
        </button>
        <button class="primary" disabled={busy || !text.trim()} title="Send (⌘↵)" onClick={send}>
          {busy ? 'Sending…' : 'Reply'}
        </button>
      </div>
    </div>
  );
}
