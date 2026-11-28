import { useEffect, useState } from 'preact/hooks';
import { uniqueNames } from './files.ts';
import { isLab, awaitsMe, commentOnPR, commitSuggestions, forgetThreadStatus, getMentions, getMergedAwaiting, getPR, getThreads, getViewer, markBots, reply, resolveThread, suggestionOf, type Comment, type QueueItem, type Thread } from './github.ts';
import { ago, markReplyDone, offerUndo, readBots, reportError, unmarkReplyDone, useStoredFlag, repoLabel, term, notices, dropNotices, putBackNotices, askNotifications, isDesktop, type Notice } from './platform.ts';
import { Octicon } from './tags.tsx';
import { syncLabTodo } from './gitlab.ts';
import { Empty, Tg, Who, Time, ThreadCode, Lines } from './tags.tsx';
import { highlightBlocks, languageFor } from './highlight.ts';

// The words of the site on show: GitHub's PRs and teams, or GitLab's MRs and groups (the avatar's menu; switching reloads).
const T = term();

// Every review thread waiting on my reply (#/inbox): in the PRs in my list (only those the list already counts one
// waiting in are asked for their threads), and in PRs merged lately that I opened or reviewed, where a reply after
// the merge would go unseen. The last word in each, and a reply or a resolve right here; on my open PRs, a reviewer's
// suggestion committed. Also a PR conversation comment that @-mentions me, if I haven't written there since (in my
// PRs and those the list has as mentioning me). Keys: j/k move, r reply, e done, x resolve, c commit the suggestion,
// o open the PR.
const threadsAt = new Map<string, Promise<Thread[]>>(); // the inbox's PRs' threads, by PR and when it last changed
type Item = Pick<QueueItem, 'id' | 'repo' | 'number' | 'title' | 'authored' | 'updatedAt'> & { mergedAt?: string; myState?: QueueItem['myState'] };
type Waiting = { item: Item; threads: Thread[]; mention?: Comment };

export function Inbox({ items }: { items: QueueItem[] | null }) {
  const [me, setMe] = useState('');
  const [list, setList] = useState<Waiting[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set()); // replied to or resolved here
  // Back: puts it on the list again (what it was for didn't go).
  const hide = (id: string, what?: string, undo?: () => unknown) => {
    const back = () => setDone((s) => new Set([...s].filter((x) => x !== id)));
    setDone((s) => new Set(s).add(id));
    if (what && undo) offerUndo(what, () => (undo(), back()));
    return back;
  };
  const [cur, setCur] = useState(0); // the thread the keys act on, in page order
  const asked = (items ?? []).filter((i) => (i.thread?.awaiting ?? 0) > 0);
  const [muteApproved] = useStoredFlag('muteApproved', true); // Settings: nothing from PRs I've approved
  // Asked for comments mentioning me: the list's mentioning PRs and mine, unless the list already knows none waits.
  const named = (items ?? []).filter((i) => (i.mentioned || i.authored) && i.mentionWaiting !== false && !(muteApproved && i.myState === 'APPROVED'));
  // A refresh asks again about the PRs that changed: until it knows, what's shown stays (and a reply being typed with it).
  const pending = !!items?.some((i) => (i.mine || i.myState) && !i.thread);
  const key = items ? [...asked, ...named].map((i) => `${i.id}@${i.updatedAt}`).join() + '|' + (pending ? 'pending' : '') : ''; // the list's arrival counts, even with nothing waiting in it
  const [loadErr, setLoadErr] = useState('');
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!items || (pending && list)) return;
    let stop = false;
    // Bots marked as the list marks them, so the count here is the list's.
    getViewer().then(async (login) => {
      const [merged, mentions] = await Promise.all([getMergedAwaiting(login).catch((): Item[] => []), getMentions(named.map((i) => i.id), login, readBots()).catch(() => new Map<string, Comment>())]);
      // A PR's threads are read again only once it has changed: one PR's update doesn't re-read every waiting PR's.
      const was = new Map(threadsAt);
      threadsAt.clear();
      const threadsOf = (item: Item) => {
        const k = `${item.id}@${item.updatedAt}`;
        const t = was.get(k) ?? getThreads(item.repo, item.number);
        threadsAt.set(k, t);
        t.catch(() => threadsAt.delete(k));
        return t;
      };
      const look = (item: Item) => threadsOf(item).then((ts) => ({ item, threads: markBots(ts, readBots()).filter((t) => awaitsMe(t, login, item.authored)) }));
      const threaded = [...asked, ...merged.filter((m) => !asked.some((a) => a.id === m.id) && !(muteApproved && m.myState === 'APPROVED'))];
      Promise.all(threaded.map(look)).then(
        (l) => {
          if (stop) return;
          const only = named.filter((i) => mentions.has(i.id) && !threaded.some((t) => t.id === i.id)).map((item) => ({ item, threads: [] }));
          setMe(login);
          setList([...l, ...only].map((w) => ({ ...w, mention: mentions.get(w.item.id) })).filter((w) => w.threads.length || w.mention));
        },
        (e) => !stop && (setLoadErr(e.message), setList([])),
      );
    });
    return () => void (stop = true);
  }, [key, tries]);
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
  // Updates are kept here, so they show at once; the threads waiting on a reply load below them.
  const head = (
    <>
      <NotifySwitch />
      <h2>Updates</h2>
      <Updates />
    </>
  );
  if (!list) return <div role="main" class="page history inbox">{head}<h2>Waiting on your reply</h2><div aria-busy="true" aria-label="Loading the threads waiting on your reply"><Lines /></div></div>;
  let k = 0;
  return (
    <div role="main" class="page history inbox">
      {pending && <p class="list-updating" role="status"><span class="sk-dot" /> Updating…</p>}
      {head}
      <h2>Waiting on your reply</h2>
      {loadErr && <Empty tone="err" action={['Retry', () => (setLoadErr(''), setList(null), setTries((t) => t + 1))]}>Couldn't load your threads. {loadErr}</Empty>}
      {!count && !loadErr && <Empty tone="ok">Nothing waits on your reply.</Empty>}
      {count > 0 && <p class="note inbox-count">
        {`${[threadCount && `${threadCount} thread${threadCount === 1 ? '' : 's'}`, mentionCount && `${mentionCount} mention${mentionCount === 1 ? '' : 's'}`].filter(Boolean).join(' and ')} in ${open.length} ${T.PR}${open.length === 1 ? '' : 's'}.`}
        {(
          <span class="inbox-keys">
            <span><kbd>j</kbd> <kbd>k</kbd> move</span> · <span><kbd>r</kbd> reply</span> · <span><kbd>e</kbd> done</span> · <span><kbd>x</kbd> resolve</span> · <span><kbd>o</kbd> open the PR</span>
          </span>
        )}
      </p>}
      {open.map(({ item, threads, mention }) => (
        <section key={item.id}>
          <h4>
            <a href={`#/${item.repo}/pull/${item.number}`}>{item.title}</a> <small>{repoLabel(item.repo)}#{item.number}</small>
            {item.mergedAt && <small class="inbox-merged"> · merged <Time at={item.mergedAt} /></small>}
          </h4>
          {mention && (() => {
            const n = k++;
            return <InboxMention key={mention.id} c={mention} item={item} current={n === at} onPick={() => setCur(n)} onDone={(what, undo) => hide(mention.id!, what, undo)} />;
          })()}
          {threads.map((t, _, all) => {
            const n = k++;
            return <InboxThread key={t.id} t={t} names={uniqueNames(all.map((x) => x.path))} item={item} me={me} current={n === at} onPick={() => setCur(n)} onDone={(what, undo) => hide(t.id, what, undo)} />;
          })}
        </section>
      ))}
    </div>
  );
}

// The inbox's Updates (once the bell's): what lgtm would have notified you about (a review requested, approved, ready to
// merge, checks failed…) that you haven't acted on (opened its PR, or dismissed), newest first. On the page, and in the
// inbox button's right-click quick look (main.tsx). onGo: a row opened.
export function useNotices() {
  const [list, setList] = useState<Notice[]>(notices);
  useEffect(() => {
    const h = () => setList(notices());
    addEventListener('lgtm:notices', h);
    addEventListener('storage', h);
    return () => (removeEventListener('lgtm:notices', h), removeEventListener('storage', h));
  }, []);
  return list;
}
export function Updates({ onGo }: { onGo?: () => void }) {
  const list = useNotices();
  const go = (n: Notice) => {
    const [repo, num] = n.pr.split('#');
    location.hash = `/${repo}/pull/${num}`; // opening it clears what it said (main.tsx's route effect)
    onGo?.();
  };
  if (!list.length) return <p class="note bell-empty">No new updates.</p>;
  return (
    <div class="inbox-updates">
      {list.map((n) => (
        <div class="bell-row">
          <button role="menuitem" onClick={() => go(n)} title={`Open ${n.pr}`}>
            <span class="bell-title"><b>{n.what}</b> · {n.title}</span>
            <small>{repoLabel(n.pr.split('#')[0])}#{n.pr.split('#')[1]} · <Time at={n.at} /></small>
          </button>
          <button class="bell-x" title="Dismiss" aria-label="Dismiss" onClick={() => { const gone = dropNotices((x) => x.id === n.id); offerUndo('Dismissed', () => putBackNotices(gone)); }}>
            <Octicon name="x" />
          </button>
        </div>
      ))}
      <button role="menuitem" class="bell-act bell-clear" onClick={() => { const gone = dropNotices(() => true); offerUndo(`Cleared ${gone.length}`, () => putBackNotices(gone)); }}>
        Clear all
      </button>
    </div>
  );
}
// Desktop notifications on or off (Settings → Notifications has it too): the inbox page's header.
function NotifySwitch() {
  const [notify, toggleNotify] = useStoredFlag('notifyRequests', true);
  const [err, setErr] = useState('');
  return (
    <div class="bell-notify inbox-notify">
      <Octicon name={notify ? 'bell' : 'bell-slash'} />
      <span>Desktop notifications<small>New review requests, and what you pick in Settings</small></span>
      <button
        type="button"
        role="switch"
        aria-checked={notify}
        aria-label="Desktop notifications"
        class="switch"
        onClick={async () => {
          setErr('');
          if (!notify && !(await askNotifications())) return setErr(isDesktop ? 'Notifications are off for LGTM in System Settings → Notifications' : 'Notifications are blocked for this page in your browser settings');
          toggleNotify();
        }}
      />
      {err && <p class="note">{err}</p>}
    </div>
  );
}

// Off the list: with what happened and how to take it back when it can be (an Undo toast), else just gone (a reply sent).
// Back: on the list again.
type Done = (what?: string, undo?: () => unknown) => () => void;
// A reply that didn't go, kept for its thread as it comes back on the list.
const unsentReplies = new Map<string, string>();
const FAILED: Record<string, string> = { reply: 'send the reply', resolve: 'resolve it', commit: 'commit the suggestion' };

function InboxThread({ t, names, item, me, current, onPick, onDone }: { t: Thread; names: Map<string, string>; item: Item; me: string; current: boolean; onPick: () => void; onDone: Done }) {
  const [text, setText] = useState(() => unsentReplies.get(t.id) ?? '');
  const last = t.comments.nodes[t.comments.nodes.length - 1];
  const where = `${names.get(t.path) ?? t.path}${t.line ? `:${t.line}` : ''}`;
  // On my own open PR, the last word a current suggested change: committed to the branch, the thread resolved (as the
  // PR view's "Commit suggestion" does).
  const sug = item.authored && !item.mergedAt && !t.isOutdated && last && last.author?.login !== me ? suggestionOf(t, last) : null;
  const commit = async () => {
    const pr = await getPR(item.repo, item.number);
    await commitSuggestions(pr.head.repo?.full_name ?? item.repo, pr.head.ref, pr.head.sha, [sug!], me);
    await resolveThread(t.id, true).catch(() => {});
    dispatchEvent(new Event('lgtm:list-refresh'));
  };
  // Off the list at once, done in the background; if it fails it's back on the list (a reply with its text) and says so.
  const act = (what: string, run: () => Promise<unknown>, undo?: () => unknown) => {
    const back = onDone(undo && 'Thread resolved', undo);
    run().then(() => unsentReplies.delete(t.id), (e) => (back(), reportError(`Couldn't ${FAILED[what]}: ${e.message}`)));
  };
  const send = () => text.trim() && (unsentReplies.set(t.id, text.trim()), act('reply', () => reply(item.repo, item.number, t.comments.nodes[0].databaseId, text.trim(), t.id)));
  return (
    <div class={current ? 'inbox-thread cur' : 'inbox-thread'} onPointerDown={onPick} onFocusIn={onPick}>
      <div class="inbox-where">
        <a href={`#/${item.repo}/pull/${item.number}`} title={`${t.path}: open the ${T.PR}`} data-k="o">{where}</a>
        {t.isOutdated && <Tg i="history" t="outdated" />}
        <small>
          {last?.author ? <Who login={last.author.login} src={last.author.avatarUrl} /> : 'someone'} · {last ? ago(last.createdAt) : ''}
          {t.comments.nodes.length > 1 && ` · ${t.comments.nodes.length} comments`}
        </small>
      </div>
      <ThreadCode t={t} />
      {t.comments.nodes.length > 1 && (
        <details class="inbox-earlier">
          <summary>{t.comments.nodes.length - 1} earlier comment{t.comments.nodes.length > 2 ? 's' : ''}</summary>
          {t.comments.nodes.slice(0, -1).map((c) => (
            <div class="inbox-earlier-one">
              <small>{c.author ? <Who login={c.author.login} src={c.author.avatarUrl} /> : 'someone'} · <Time at={c.createdAt} /></small>
              <div class="md" ref={(el) => void (el && highlightBlocks(el, languageFor(t.path), languageFor(t.path)))} dangerouslySetInnerHTML={{ __html: c.bodyHTML }} />
            </div>
          ))}
        </details>
      )}
      {last && <div class="md inbox-last" ref={(el) => void (el && highlightBlocks(el, languageFor(t.path), languageFor(t.path)))} dangerouslySetInnerHTML={{ __html: last.bodyHTML }} />}
      <textarea rows={2} placeholder={`Reply to ${last?.author?.login === me ? 'this thread' : `@${last?.author?.login ?? 'them'}`}`} value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => (e.key === 'Escape' ? e.currentTarget.blur() : e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), send()))}
      />
      <div class="row">
        {/* Done: off the list without a reply or a resolve, until someone writes again (kept on this machine). */}
        <button
          disabled={!last}
          data-k="e"
          title={`Take it off your list without replying; it comes back if someone writes again. Nothing changes on ${T.site}.`}
          onClick={() => (markReplyDone(t.id, last!.databaseId), forgetThreadStatus(item.id), dispatchEvent(new Event('lgtm:list-refresh')), onDone('Marked done', () => (unmarkReplyDone(t.id), forgetThreadStatus(item.id), dispatchEvent(new Event('lgtm:list-refresh')))))}
        >
          Done
        </button>
        {t.viewerCanResolve && <button data-k="x" onClick={() => act('resolve', () => resolveThread(t.id, true), () => resolveThread(t.id, false).catch((e) => reportError(`Couldn't unresolve it: ${e.message}`)))}>Resolve</button>}
        {sug && (
          <button data-k="c" title={`Commit @${last!.author?.login}'s suggestion to the branch and resolve the thread (c)`} onClick={() => act('commit', commit)}>
            Commit suggestion
          </button>
        )}
        <button class="primary" disabled={!text.trim()} title="Send (⌘↵)" onClick={send}>
          Reply
        </button>
      </div>
    </div>
  );
}


// A PR conversation comment mentioning me: a reply goes on the conversation; Done as a thread's.
function InboxMention({ c, item, current, onPick, onDone }: { c: Comment; item: Item; current: boolean; onPick: () => void; onDone: Done }) {
  const [text, setText] = useState(() => unsentReplies.get(c.id!) ?? '');
  // A GitLab mention's to-do follows Done (Settings → Inbox), and its Undo.
  const [todoSync] = useStoredFlag('gitlabTodoSync', true);
  const todo = todoSync && isLab(item.repo);
  const sync = (done: boolean) => todo && void syncLabTodo(c, done).catch((e) => reportError(`Couldn't ${done ? 'mark' : 'restore'} the GitLab to-do: ${e.message}`));
  // Off the list at once, sent in the background; back with its text if it doesn't go.
  const send = () => {
    if (!text.trim()) return;
    unsentReplies.set(c.id!, text.trim());
    const back = onDone();
    commentOnPR(item.repo, item.number, text.trim()).then(() => unsentReplies.delete(c.id!), (e) => (back(), reportError(`Couldn't send the reply: ${e.message}`)));
  };
  return (
    <div class={current ? 'inbox-thread cur' : 'inbox-thread'} onPointerDown={onPick} onFocusIn={onPick}>
      <div class="inbox-where">
        <a href={c.url} target="_blank" rel="noreferrer" title={`The comment on ${T.site}`}>mentioned you</a>
        <a href={`#/${item.repo}/pull/${item.number}`} data-k="o" hidden />
        <small>{c.author ? <Who login={c.author.login} src={c.author.avatarUrl} /> : 'someone'} · <Time at={c.createdAt} /></small>
      </div>
      <div class="md inbox-last" ref={(el) => void (el && highlightBlocks(el))} dangerouslySetInnerHTML={{ __html: c.bodyHTML }} />
      <textarea
        rows={2}
        placeholder={`Reply to @${c.author?.login ?? 'them'} on the ${T.PR}`}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => (e.key === 'Escape' ? e.currentTarget.blur() : e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), send()))}
      />
      <div class="row">
        <button data-k="e" title={todo ? 'Take it off your list without replying; its GitLab to-do is marked done too.' : `Take it off your list without replying. Nothing changes on ${T.site}.`} onClick={() => (markReplyDone(c.id!, c.databaseId), sync(true), forgetThreadStatus(item.id), dispatchEvent(new Event('lgtm:list-refresh')), onDone('Marked done', () => (unmarkReplyDone(c.id!), sync(false), forgetThreadStatus(item.id), dispatchEvent(new Event('lgtm:list-refresh')))))}>
          Done
        </button>
        <button class="primary" disabled={!text.trim()} title="Send (⌘↵)" onClick={send}>
          Reply
        </button>
      </div>
    </div>
  );
}
