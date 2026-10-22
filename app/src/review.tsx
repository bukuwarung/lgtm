import { render, type VNode } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addedLines, anchor, changePairs, gaps, ignoreWhitespace, importFolds, isJvm, movedLines, ownRoot, parsePatch, removedRuns, wordChange, type Gap, type Hunk, type Moved, type Removed } from './diff.ts';
import { isGenerated, parseGeneratedRules } from './gitattributes.ts';
import {
  getChecks, getCompare, getConversation, getEmails, getEmojis, getFiles, getMyLastReviewCommit, getPR, getRaw, getStack, getThreads, getViewed, getViewer,
  awaitsMe, reply, resolveThread, setViewed, submitReview,
  type Check, type PRFile, type StackLayer, type ConversationItem, type Draft, type PR, type ReviewEvent, type Thread,
} from './github.ts';
import { highlightCode, highlightHunks, languageFor, splitLines } from './highlight.ts';
import { isMarkdown, md, renderChunks } from './markdown.ts';
import { renderMermaid } from './mermaid.ts';
import { Editor } from './editor.tsx';
import { MergeBox } from './merge.tsx';
import { reviewOrder } from './files.ts';
import { fetchJira, notifySlack, slackStatus, storage, useStoredFlag, type JiraIssue, type SlackThread } from './platform.ts';
import { adfToMarkdown, jiraKeys } from './jira.ts';
import { Resizer } from './resizer.tsx';
import { jumpTo, ShortcutIndex, threadOrder, type File } from './shortcuts.tsx';

type Side = 'LEFT' | 'RIGHT';
// Where the (single) open comment form is. No line = file-level; editId = the draft being edited;
// atEnd = a file-level comment started from the file's footer, so its form opens there.
type Target = { path: string; side: Side; line?: number; startLine?: number; editId?: string; body?: string; atEnd?: boolean };
type Ctx = {
  pr: PR;
  headRepo: string;
  target: Target | null;
  setTarget: (t: Target | null) => void;
  addDraft: (d: Omit<Draft, 'id'>) => void;
  updateDraft: (id: string, d: Omit<Draft, 'id'>) => void;
  removeDraft: (id: string) => void;
  reply: (t: Thread, body: string) => Promise<void>;
  resolve: (t: Thread, resolve: boolean) => Promise<void>;
  renderAll: boolean; // set by ⌘F so the browser's find can see every file
  repo: string;
  mentions: string[]; // people on this PR, for @-completion
  suggestion: (t: Target) => string | null; // the target's lines, for a ```suggestion block
  since: boolean; // showing only changes since my last review: old-side lines aren't the PR's base, so no LEFT comments
  me: string; // my login ('' until known)
  ignoreWs: boolean; // hide whitespace-only changes
  moved: Map<string, Moved>; // code moved without changes, per file
};
type Saved = { sha: string; drafts: Draft[] };
// My last visit to a PR: each file's blob then, and where I was reading (file + how far into it).
type Visit = { files: Record<string, string>; at: { path: string; y: number } | null };

const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function slackText(pr: PR, ref: string, event: ReviewEvent, body: string, comments: number) {
  // :approved: and :request-changes: are the workspace's custom Slack emoji.
  const verb = { APPROVE: ':approved: Approved', REQUEST_CHANGES: ':request-changes: Requested changes on', COMMENT: '💬 Reviewed' }[event];
  const extra = comments ? ` · ${comments} comment${comments > 1 ? 's' : ''}` : '';
  const quote = body.trim() ? '\n' + slackEscape(body.trim().slice(0, 1000)).replace(/^/gm, '>') : '';
  return `${verb} <${pr.html_url}|${slackEscape(`${ref} ${pr.title}`)}>${extra}${quote}`;
}

// Mark generated and content-free files, and put them in reading order (markdown first, tests after their source).
// Binary and too-large files also come without a patch but did change, so only renames/copies/mode changes count.
const prepare = (files: PRFile[], rules: ReturnType<typeof parseGeneratedRules>): File[] => {
  const order = new Map(reviewOrder(files.map((f) => f.filename)).map((p, i) => [p, i]));
  return files
    .map((f) => ({
      ...f,
      generated: isGenerated(rules, f.filename),
      noDiff: ['renamed', 'copied', 'changed'].includes(f.status) && !f.additions && !f.deletions,
    }))
    .sort((a, b) => order.get(a.filename)! - order.get(b.filename)!);
};

const isFileLevel = (t: Thread) => t.subjectType === 'FILE' || t.line == null;

export function Review({ repo, n, onSubmitted }: { repo: string; n: number; onSubmitted: () => void }) {
  const [data, setData] = useState<{ pr: PR; headRepo: string; files: File[]; rules: ReturnType<typeof parseGeneratedRules> } | null>(null);
  const [stack, setStack] = useState<StackLayer[]>([]);
  // "Changes since my last review": the commit I last reviewed, and that comparison once loaded.
  const [lastReviewed, setLastReviewed] = useState<string | null>(null);
  const [since, setSince] = useState(false);
  const [sinceData, setSinceData] = useState<{ status: string; files: File[] } | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [saved, setSaved] = useState<Saved>({ sha: '', drafts: [] });
  const [target, setTarget] = useState<Target | null>(null);
  const [showGenerated, setShowGenerated] = useState(false);
  const [showNoDiff, setShowNoDiff] = useState(false);
  const [showIndex, toggleIndex] = useStoredFlag('showIndex', true);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState('');
  // Who gets a Slack DM after submitting (author + assignees, minus me and bots); null = Slack not set up.
  const [slackTo, setSlackTo] = useState<string[] | null>(null);
  const [slackNote, setSlackNote] = useState('Checking Slack…'); // why there's no Slack option, if there isn't
  const [slackThreads, setSlackThreads] = useState<SlackThread[]>([]);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [viewed, setViewedPaths] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // viewed files opened anyway
  const [renderAll, setRenderAll] = useState(false);
  const [help, setHelp] = useState(false);
  const [ignoreWs, toggleWs] = useStoredFlag('ignoreWs', false);
  const [changedSinceVisit, setChangedSinceVisit] = useState<Set<string>>(new Set());
  const resumeAt = useRef<Visit['at']>(null);
  const visitKey = `visit:${repo}#${n}`;
  const [mine, setMine] = useState(false); // I opened it or it's assigned to me: show the merge box
  const [me, setMe] = useState('');
  const threadCursor = useRef(-1);
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const key = `drafts:${repo}#${n}`;

  // Checks are secondary: a failure here shouldn't block the review.
  const loadChecks = () => {
    setChecks(null);
    getChecks(repo, n).then(setChecks, () => setChecks([]));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const [, setEmojiReady] = useState(false);
  useEffect(() => {
    getEmojis().then(() => setEmojiReady(true), () => {});
    loadChecks();
    getViewed(repo, n).then(setViewedPaths, () => {});
    (async () => {
      const pr = await getPR(repo, n);
      const headRepo = pr.head.repo?.full_name ?? repo;
      const [files, threads, conversation, attrs, stored, visit] = await Promise.all([
        getFiles(repo, n),
        getThreads(repo, n),
        getConversation(repo, n),
        getRaw(headRepo, '.gitattributes', pr.head.sha),
        storage.get<Saved>(key),
        storage.get<Visit>(visitKey).catch(() => undefined),
      ]);
      if (visit) {
        setChangedSinceVisit(new Set(files.filter((f) => visit.files[f.filename] !== f.sha).map((f) => f.filename)));
        resumeAt.current = visit.at;
      }
      Promise.all([slackStatus(`${repo}#${n}`), getViewer()]).then(([slack, me]) => {
        setSlackThreads(slack.threads);
        const people = [...new Set([pr.user, ...pr.assignees].filter((u) => u.type !== 'Bot' && u.login !== me).map((u) => u.login))];
        setSlackTo(slack.configured ? people : null);
        setSlackNote(
          !slack.configured ? `Slack unavailable: ${slack.error ?? 'slackcli is not signed in'}`
          : !people.length ? 'No Slack message: nobody besides you is the author or an assignee'
          : '',
        );
      }, (e) => setSlackNote(`Slack unavailable: ${e.message}`));
      getViewer().then((me) => {
        setMe(me);
        setMine([pr.user, ...pr.assignees].some((u) => u.login === me));
      }, () => {});
      const rules = parseGeneratedRules(attrs ?? '');
      getStack(repo, pr).then(setStack, () => {});
      getMyLastReviewCommit(repo, n).then((sha) => {
        if (sha && sha !== pr.head.sha) {
          setLastReviewed(sha);
          setSince(true); // re-review: start with just what changed
        }
      }, () => {});
      setThreads(threads);
      setConversation(conversation);
      setSaved(stored ?? { sha: pr.head.sha, drafts: [] });
      setData({ pr, headRepo, files: prepare(files, rules), rules });
    })().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!since || !lastReviewed || !data || sinceData) return;
    getCompare(repo, lastReviewed, data.pr.head.sha).then(
      // After a rebase the comparison also carries the base branch's changes; keep only files this PR touches.
      (d) => {
        const inPR = new Set(data.files.map((f) => f.filename));
        setSinceData({ status: d.status, files: prepare(d.files.filter((f) => inPR.has(f.filename)), data.rules) });
      },
      (e) => {
        setSince(false);
        setNotice({ ok: false, text: `Couldn't load changes since your last review: ${e.message}` });
      },
    );
  }, [since, lastReviewed, data]);

  // Remember this visit when leaving the PR (or the page): file versions seen, and the reading position.
  useEffect(() => {
    if (!data) return;
    const where = (): Visit['at'] => {
      const top = 44 + 4;
      const cur = [...document.querySelectorAll<HTMLElement>('main > .file')].findLast((s) => s.getBoundingClientRect().top <= top);
      return cur ? { path: cur.id.slice(2), y: top - cur.getBoundingClientRect().top } : null;
    };
    let at = where();
    const onScroll = () => (at = where());
    const save = () => void storage.set(visitKey, { files: Object.fromEntries(data.files.map((f) => [f.filename, f.sha])), at } satisfies Visit);
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('pagehide', save);
    // Pick up where I left off. Files above render lazily and shift things, so settle once more.
    const resume = resumeAt.current && document.getElementById('f-' + resumeAt.current.path);
    if (resume) {
      const go = () => {
        resume.scrollIntoView();
        scrollBy(0, resumeAt.current!.y);
      };
      go();
      setTimeout(go, 400);
    }
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('pagehide', save);
      save();
    };
  }, [data]);

  // Moved code is matched across the whole PR (generated files aside, or their copies would count as moves).
  const moved = useMemo(() => {
    const fs = since && sinceData ? sinceData.files : (data?.files ?? []);
    return movedLines(fs.filter((f) => !f.generated).map((f) => ({ filename: f.filename, hunks: parsePatch(f.patch ?? '') })));
  }, [data, sinceData, since]);

  // In "since" mode old-side line numbers refer to my last reviewed commit, so old-side threads would sit on the wrong lines.
  const shownThreads = since && sinceData ? threads.filter((t) => t.diffSide === 'RIGHT' || t.line == null) : threads;
  const byPath = useMemo(() => Map.groupBy(shownThreads, (t) => t.path), [shownThreads]);
  useEffect(() => void renderMermaid(document.querySelector('main'))); // conversation, threads, drafts

  if (error) return <p class="error page">{error}</p>;
  if (!data) return <p class="note page">Loading pull request…</p>;
  const { pr, headRepo } = data;
  const files = since && sinceData ? sinceData.files : data.files;
  const { drafts } = saved;

  // Drafts remember the commit they were written on, so a push mid-review doesn't orphan them.
  function saveDrafts(next: Draft[]) {
    const s = { sha: drafts.length ? saved.sha : pr.head.sha, drafts: next };
    setSaved(s);
    (next.length ? storage.set(key, s) : storage.remove(key)).catch((e) => setError(e.message));
  }

  async function submit(event: ReviewEvent, body: string, notify: boolean) {
    const head = (await getPR(repo, n)).head.sha;
    const sha = drafts.length ? saved.sha : head;
    if (sha !== head && !confirm('New commits were pushed after you started this review. Submit your comments against the older commit?')) return false;
    await submitReview(pr.node_id, sha, event, body, drafts);
    saveDrafts([]);
    onSubmitted();
    setNotice(null);
    if (notify && slackTo?.length) {
      // The review is in; a Slack failure is reported, not thrown.
      try {
        const emails = await getEmails(repo.split('/')[0], slackTo);
        const results = await notifySlack(
          slackTo.map((login) => ({ login, emails: emails[login] })),
          slackText(pr, `${repo}#${n}`, event, body, drafts.length),
          `${repo}#${n}`,
        );
        slackStatus(`${repo}#${n}`).then((s) => setSlackThreads(s.threads)); // a first message starts a thread
        const failed = results.filter((r) => !r.ok);
        const sent = results.filter((r) => r.ok).map((r) => '@' + r.login + (r.threaded ? ' (in the existing thread)' : ''));
        setNotice({
          ok: !failed.length,
          text: [sent.length && `Messaged ${sent.join(', ')} on Slack.`, ...failed.map((r) => `Couldn't message @${r.login}: ${r.error}`)].filter(Boolean).join(' '),
        });
      } catch (e: any) {
        setNotice({ ok: false, text: `Review submitted, but Slack failed: ${e.message}` });
      }
    }
    const [t, c] = await Promise.all([getThreads(repo, n), getConversation(repo, n)]);
    setThreads(t);
    setConversation(c);
    return true;
  }

  const ctx: Ctx = {
    pr,
    headRepo,
    target,
    setTarget,
    addDraft: (d) => saveDrafts([...drafts, { ...d, id: crypto.randomUUID() }]),
    updateDraft: (id, d) => saveDrafts(drafts.map((x) => (x.id === id ? { ...d, id } : x))),
    removeDraft: (id) => saveDrafts(drafts.filter((d) => d.id !== id)),
    reply: async (t, body) => {
      await reply(repo, n, t.comments.nodes[0].databaseId, body);
      setThreads(await getThreads(repo, n));
    },
    resolve: async (t, resolve) => {
      await resolveThread(t.id, resolve);
      setThreads(await getThreads(repo, n));
    },
    renderAll,
    since: since && !!sinceData,
    me,
    ignoreWs,
    moved,
    repo,
    mentions: [
      ...new Set(
        [pr.user, ...pr.assignees, ...(pr.requested_reviewers ?? [])].map((u) => u.login)
          .concat(conversation.map((c) => c.author), threads.flatMap((t) => t.comments.nodes.map((c) => c.author?.login ?? '')))
          .filter((l) => l && !l.endsWith('[bot]') && l !== 'ghost'),
      ),
    ],
    // GitHub suggestions replace head-side lines, which (being commentable) are all in the diff's hunks.
    suggestion: (t) => {
      const f = files.find((x) => x.filename === t.path);
      if (t.side !== 'RIGHT' || !t.line || !f?.patch) return null;
      const text = new Map(parsePatch(f.patch).flatMap((h) => h.lines.flatMap((l) => (l.new ? [[l.new, l.text] as const] : []))));
      const lines = [];
      for (let n = t.startLine ?? t.line; n <= t.line; n++) {
        if (!text.has(n)) return null;
        lines.push(text.get(n));
      }
      return lines.join('\n');
    },
  };

  // Optimistic; GitHub's state is the source of truth, so a failure puts it back.
  function toggleViewed(path: string) {
    const on = !viewed.has(path);
    const flip = (v: boolean) => setViewedPaths((s) => { const x = new Set(s); v ? x.add(path) : x.delete(path); return x; });
    flip(on);
    setExpanded((s) => { const x = new Set(s); x.delete(path); return x; });
    setViewed(pr.node_id, path, on).catch((e) => {
      flip(!on);
      setNotice({ ok: false, text: `Couldn't update "Viewed" on GitHub: ${e.message}` });
    });
  }

  const visible = files.filter((f) => !f.generated && !f.noDiff);
  const generated = files.filter((f) => f.generated);
  const noDiff = files.filter((f) => f.noDiff && !f.generated);
  const shown = [...visible, ...(showGenerated ? generated : []), ...(showNoDiff ? noDiff : [])];
  const section = (f: File) => (
    <FileSection
      key={f.filename}
      file={f}
      ctx={ctx}
      threads={byPath.get(f.filename) ?? []}
      drafts={drafts.filter((d) => d.path === f.filename)}
      viewed={viewed.has(f.filename)}
      collapsed={viewed.has(f.filename) && !expanded.has(f.filename)}
      changed={changedSinceVisit.has(f.filename)}
      onToggleViewed={() => toggleViewed(f.filename)}
      onExpand={() => setExpanded((s) => new Set(s).add(f.filename))}
    />
  );

  const layer = stack.findIndex((l) => l.number === n);
  const stackAt = (d: number) => (layer < 0 ? undefined : stack[layer + d]);

  // Space: comment on the line (or rendered markdown block) under the mouse, else the first one at the top of the view.
  // It reuses the click paths: a diff row's line-number cell, or a block's "+" gutter just left of it.
  function commentAtCurrentLine() {
    const lines = '.diff tr.ln, .chunk [data-src]:not([data-nd])';
    const top = [...document.querySelectorAll(':hover')].at(-1);
    const hovered = top?.closest('.note-host, .notes') ? null : top?.closest(lines);
    const el = hovered ?? [...document.querySelectorAll(lines)].find((x) => { const t = x.getBoundingClientRect().top; return t >= 100 && t < innerHeight; });
    if (!el) return false;
    if (el.matches('tr')) el.querySelector('td.num:nth-child(2)')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: el.getBoundingClientRect().left - 10 }));
    return true;
  }

  // Keyboard shortcuts (see the ⌨ help). Reassigned every render so it sees current state.
  keys.current = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') return setRenderAll(true); // then the browser's find opens
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if ((e.target as Element).closest('textarea, input')) return; // forms handle their own ⌘↵
      e.preventDefault();
      return dispatchEvent(new Event('lgtm:finish'));
    }
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === ' ' && (e.target as Element).closest('button, a, summary, label')) return; // Space presses a focused control
    const sections = [...document.querySelectorAll<HTMLElement>('main > .file')];
    const top = 44 + 60;
    const cur = sections.reduce((c, s, i) => (s.getBoundingClientRect().top <= top ? i : c), -1);
    const path = sections[Math.max(cur, 0)]?.id.slice(2);
    const ordered = threadOrder(shownThreads, drafts, shown);
    const act: Record<string, () => void> = {
      j: () => sections[Math.min(cur + 1, sections.length - 1)]?.scrollIntoView(),
      k: () => sections[Math.max(cur - 1, 0)]?.scrollIntoView(),
      n: () => ordered.length && go(Math.min(threadCursor.current + 1, ordered.length - 1)),
      p: () => ordered.length && go(Math.max(threadCursor.current - 1, 0)),
      v: () => path && toggleViewed(path),
      c: () => path && ctx.setTarget({ path, side: 'RIGHT' }),
      ' ': () => commentAtCurrentLine() || scrollBy({ top: innerHeight * 0.85 }), // nothing to comment on: Space scrolls as usual
      i: toggleIndex,
      w: toggleWs,
      '[': () => stackAt(-1) && (location.hash = `/${repo}/pull/${stackAt(-1)!.number}`),
      ']': () => stackAt(1) && (location.hash = `/${repo}/pull/${stackAt(1)!.number}`),
      '?': () => setHelp(!help),
      Escape: () => setHelp(false),
    };
    function go(i: number) {
      threadCursor.current = i;
      jumpTo(ordered[i].id, 'f-' + ordered[i].path);
    }
    const k = e.key === '/' && e.shiftKey ? '?' : e.key;
    if (act[k]) {
      e.preventDefault();
      act[k]();
    }
  };

  return (
    <div class={showIndex ? 'review' : 'review no-index'}>
      {showIndex && (
        <aside class="side tree">
          <div class="side-scroll">
            <ShortcutIndex
              repo={repo}
              pr={pr}
              conversation={conversation}
              threads={shownThreads}
              drafts={drafts}
              checks={checks}
              onRefreshChecks={loadChecks}
              files={shown}
              viewed={viewed}
              me={me}
              counts={(path) => (byPath.get(path)?.length ?? 0) + drafts.filter((d) => d.path === path).length}
            />
          </div>
          <Resizer name="index" label="PR index" />
        </aside>
      )}
      <div>
        <div class="bar">
          <button title={showIndex ? 'Hide the PR index' : 'Show the PR index'} onClick={toggleIndex}>
            {showIndex ? '⇤' : '⇥'} Index
          </button>
          <h1>
            {pr.title} <a href={pr.html_url} target="_blank" rel="noopener">{repo}#{n}</a>
          </h1>
          {layer >= 0 && (
            <span class="stack-nav" title="This PR's stack ([ and ] to move)">
              {stackAt(-1) ? <a href={`#/${repo}/pull/${stackAt(-1)!.number}`} title={`#${stackAt(-1)!.number} ${stackAt(-1)!.title}`}>‹</a> : <span class="off">‹</span>}
              <span>Layer {layer + 1}/{stack.length}</span>
              {stackAt(1) ? <a href={`#/${repo}/pull/${stackAt(1)!.number}`} title={`#${stackAt(1)!.number} ${stackAt(1)!.title}`}>›</a> : <span class="off">›</span>}
            </span>
          )}
          <button class={ignoreWs ? 'on' : ''} aria-pressed={ignoreWs} title={ignoreWs ? 'Whitespace-only changes hidden (w to show)' : 'Hide whitespace-only changes (w)'} onClick={toggleWs}>
            ␣
          </button>
          <button title="Keyboard shortcuts (?)" onClick={() => setHelp(!help)}>⌨</button>
          <SubmitPanel count={drafts.length} slackTo={slackTo} slackNote={slackNote} onSubmit={submit} repo={repo} mentions={ctx.mentions} />
        </div>
        {help && <Help onClose={() => setHelp(false)} />}
        <main>
          {notice && <p class={notice.ok ? 'notice' : 'warn'}>{notice.text}</p>}
          {lastReviewed && (
            <div class={since ? 'since on' : 'since'}>
              {since ? (
                <>
                  Showing changes since your last review (<code>{lastReviewed.slice(0, 7)}</code> → <code>{pr.head.sha.slice(0, 7)}</code>)
                  {sinceData ? ` · ${sinceData.files.length} file${sinceData.files.length === 1 ? '' : 's'}` : ' · loading…'}
                  {sinceData?.status === 'diverged' && <b> · rebased since then, so these files may also show changes from the base branch</b>}
                  <button onClick={() => setSince(false)}>Show all changes</button>
                </>
              ) : (
                <>
                  New commits since your last review. <button onClick={() => setSince(true)}>Show only those changes</button>
                </>
              )}
            </div>
          )}
          {drafts.length > 0 && saved.sha !== pr.head.sha && (
            <p class="warn">New commits were pushed since you started this review. Your pending comments refer to the older commit.</p>
          )}
          {jiraKeys(pr.title, pr.head.ref).map((k) => <Ticket key={k} id={k} />)}
          {slackThreads.length > 0 && (
            <p class="slack-links">
              Slack:{' '}
              {slackThreads.map((t, i) => (
                <>
                  {i > 0 && ', '}
                  <a href={t.url} target="_blank" rel="noopener">thread with @{t.login}</a>
                </>
              ))}
            </p>
          )}
          {mine && <MergeBox repo={repo} n={n} url={pr.html_url} checks={checks} onChange={onSubmitted} />}
          <Conversation pr={pr} items={conversation} />
          {visible.map(section)}
          {generated.length > 0 &&
            (showGenerated ? generated.map(section) : (
              <button class="gen-row" onClick={() => setShowGenerated(true)}>
                {generated.length} generated file{generated.length > 1 ? 's' : ''} hidden. Show
              </button>
            ))}
          {noDiff.length > 0 &&
            (showNoDiff ? noDiff.map(section) : (
              <button class="gen-row" onClick={() => setShowNoDiff(true)}>
                {noDiff.length} file{noDiff.length > 1 ? 's' : ''} renamed or moved without changes hidden. Show
              </button>
            ))}
        </main>
      </div>
    </div>
  );
}

type SubmitProps = {
  count: number;
  slackTo: string[] | null;
  slackNote: string;
  onSubmit: (e: ReviewEvent, body: string, notify: boolean) => Promise<boolean>;
  repo: string;
  mentions: string[];
};

function SubmitPanel({ count, slackTo, slackNote, onSubmit, repo, mentions }: SubmitProps) {
  const [open, setOpen] = useState(false);
  const [notify, toggleNotify] = useStoredFlag('slackNotify', true);
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const labels: Record<ReviewEvent, string> = { COMMENT: 'Comment', APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes' };
  useEffect(() => {
    const show = () => {
      setOpen(true);
      setTimeout(() => document.querySelector<HTMLTextAreaElement>('.panel textarea')?.focus());
    };
    addEventListener('lgtm:finish', show);
    return () => removeEventListener('lgtm:finish', show);
  }, []);

  async function go() {
    setBusy(true);
    setErr('');
    try {
      if (await onSubmit(event, body, notify)) {
        setOpen(false);
        setBody('');
      }
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <div class="submit">
      <button class="primary" onClick={() => setOpen(!open)}>
        Finish review{count ? ` (${count})` : ''}
      </button>
      {open && (
        <div class="panel">
          <Editor
            value={body}
            onInput={setBody}
            onSubmit={() => !busy && go()}
            onCancel={() => setOpen(false)}
            repo={repo}
            mentions={mentions}
            autoFocus
            placeholder="Leave a review summary (optional) · ⌘↵ to submit"
          />
          {(Object.keys(labels) as ReviewEvent[]).map((v) => (
            <label>
              <input type="radio" name="event" checked={event === v} onChange={() => setEvent(v)} /> {labels[v]}
            </label>
          ))}
          {slackTo && slackTo.length > 0 && (
            <label>
              <input type="checkbox" checked={notify} onChange={toggleNotify} /> Message {slackTo.map((l) => '@' + l).join(', ')} on Slack
            </label>
          )}
          {slackNote && <p class="note">{slackNote}</p>}
          <button class="primary" disabled={busy} onClick={go}>
            {busy ? 'Submitting…' : 'Submit review'}
          </button>
          {err && <p class="error">{err}</p>}
        </div>
      )}
    </div>
  );
}

// Render a file's body only once it scrolls near the viewport.
function useNear<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '2000px 0px' },
    );
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);
  return [ref, near] as const;
}

type BodyProps = { file: File; hunks: Hunk[]; ctx: Ctx; threads: Thread[]; drafts: Draft[] };

type SectionProps = {
  file: File;
  ctx: Ctx;
  threads: Thread[];
  drafts: Draft[];
  viewed: boolean;
  collapsed: boolean;
  onToggleViewed: () => void;
  onExpand: () => void;
  changed: boolean; // changed since my last visit
};

function FileSection({ file, ctx, threads, drafts, viewed, collapsed, onToggleViewed, onExpand, changed }: SectionProps) {
  const canRich = isMarkdown(file.filename) && file.status !== 'removed' && !!file.patch;
  const [rich, setRich] = useState(canRich);
  // A deleted file's old contents are mostly noise: one row until asked for, unless a line comment is already on it.
  const [showDeleted, setShowDeleted] = useState(threads.some((x) => !isFileLevel(x)) || drafts.some((d) => d.line));
  const hideDeleted = file.status === 'removed' && !showDeleted;
  const [ref, near] = useNear<HTMLElement>();
  const hunks = useMemo(() => (ctx.ignoreWs ? ignoreWhitespace : (h: Hunk[]) => h)(parsePatch(file.patch ?? '')), [file.patch, ctx.ignoreWs]);
  const path = file.filename;
  const t = ctx.target;
  const body: BodyProps = { file, hunks, ctx, threads: threads.filter((x) => !isFileLevel(x)), drafts: drafts.filter((d) => d.line) };

  return (
    <section class={viewed ? 'file viewed' : 'file'} id={'f-' + path} ref={ref}>
      <header class="file-h">
        <span class="st">{file.status}</span>
        <a href={file.blob_url} target="_blank" rel="noopener">
          {file.previous_filename ? `${file.previous_filename} → ` : ''}
          {path}
        </a>
        <span class="counts">
          <b class="a">+{file.additions}</b> <b class="d">−{file.deletions}</b>
        </span>
        {threads.length > 0 && <span class="badge" title="Review threads">💬 {threads.length}</span>}
        {changed && <span class="new-b" title="This file changed since you last opened this PR">new since your last visit</span>}
        {canRich && <button onClick={() => setRich(!rich)}>{rich ? 'Source' : 'Rich'}</button>}
        <button onClick={() => ctx.setTarget({ path, side: 'RIGHT' })}>Comment</button>
        <label class="viewed-box" title="Mark as viewed on GitHub (v)">
          <input type="checkbox" checked={viewed} onChange={onToggleViewed} /> Viewed
        </label>
      </header>
      {collapsed ? (
        <button class="collapsed-row" onClick={onExpand}>
          Viewed. Show {file.additions + file.deletions} changed line{file.additions + file.deletions === 1 ? '' : 's'}
        </button>
      ) : (
        <>
      <Notes
        ctx={ctx}
        threads={threads.filter(isFileLevel)}
        drafts={drafts.filter((d) => !d.line)}
        form={t?.path === path && t.line == null && !t.atEnd}
      />
      {!file.patch ? (
        <p class="note pad">
          No diff to show (binary, too large, or renamed without changes).{' '}
          <a href={file.blob_url} target="_blank" rel="noopener">View on GitHub</a>
        </p>
      ) : hideDeleted ? (
        <button class="collapsed-row" onClick={() => setShowDeleted(true)}>
          Deleted. Show its {file.deletions} line{file.deletions === 1 ? '' : 's'}
        </button>
      ) : !near && !ctx.renderAll ? (
        <div style={{ height: `${hunks.reduce((s, h) => s + h.lines.length + 1, 0) * 20}px` }} />
      ) : rich ? (
        <RichView {...body} />
      ) : (
        <DiffView {...body} />
      )}
          <Notes ctx={ctx} threads={[]} drafts={[]} form={t?.path === path && !!t.atEnd} />
          {!hideDeleted && <footer class="file-f">
            <span class="file-f-name" title={path}>{path.split('/').pop()}</span>
            <button onClick={() => ctx.setTarget({ path, side: 'RIGHT', atEnd: true })}>Comment</button>
            <label class="viewed-box" title="Mark as viewed and go to the next file">
              <input
                type="checkbox"
                checked={viewed}
                onChange={() => {
                  onToggleViewed();
                  // Done with this file: collapse it and bring the next one up.
                  if (!viewed) requestAnimationFrame(() => (ref.current?.nextElementSibling as HTMLElement | null)?.scrollIntoView());
                }}
              />{' '}
              Viewed
            </label>
          </footer>}
        </>
      )}
    </section>
  );
}

function DiffView({ file, hunks, ctx, threads, drafts }: BodyProps) {
  const path = file.filename;
  const hl = useMemo(() => highlightHunks(hunks, path), [hunks]);
  // "Show more lines": unchanged stretches come from the head version of the file, fetched on first use.
  const gapList = useMemo(() => (file.status === 'added' || file.status === 'removed' ? [] : gaps(hunks)), [hunks]);
  const [head, setHead] = useState<string[] | null>(null);
  const [openGaps, setOpenGaps] = useState<Set<number>>(new Set());
  const [gapErr, setGapErr] = useState('');
  const expand = async (g: Gap) => {
    setGapErr('');
    try {
      if (!head) {
        const src = await getRaw(ctx.headRepo, path, ctx.pr.head.sha);
        if (src == null) throw new Error('file not found at the head commit');
        setHead(src.replace(/\n$/, '').split('\n'));
      }
      setOpenGaps((s) => new Set(s).add(g.before));
    } catch (e: any) {
      setGapErr(e.message);
    }
  };
  const gapRows = (g: Gap) => {
    if (!openGaps.has(g.before) || !head) {
      if (g.to === null && head && g.from > head.length) return null; // nothing after the last hunk
      const count = g.to === null ? null : g.to - g.from + 1;
      return (
        <tr class="gap">
          <td colSpan={3}>
            <button onClick={() => expand(g)}>
              {count === null ? '↓ Show the rest of the file' : `↕ Show ${count} unchanged line${count === 1 ? '' : 's'}`}
            </button>
            {gapErr && <span class="error"> {gapErr}</span>}
          </td>
        </tr>
      );
    }
    const lines = head.slice(g.from - 1, g.to ?? head.length);
    const lang = languageFor(path);
    const html = lang ? splitLines(highlightCode(lines.join('\n'), lang)) : null;
    return lines.map((text, i) => (
      <tr class="x">
        <td class="num">{g.from + i + g.offset}</td>
        <td class="num">{g.from + i}</td>
        {html ? <td class="code" dangerouslySetInnerHTML={{ __html: html[i] }} /> : <td class="code">{text}</td>}
      </tr>
    ));
  };
  const gapBefore = (i: number) => gapList.find((g) => g.before === i);
  const t = ctx.target?.path === path ? ctx.target : null;

  const pick = (e: MouseEvent, side: Side, line: number) => {
    if (side === 'LEFT' && ctx.since) return;
    if (e.shiftKey && t?.side === side && t.line) {
      const start = Math.min(t.startLine ?? t.line, line), end = Math.max(t.line, line);
      ctx.setTarget({ path, side, line: end, startLine: start === end ? undefined : start });
    } else ctx.setTarget({ path, side, line });
  };

  const notes = (side: Side, line: number) => {
    const th = threads.filter((x) => x.diffSide === side && x.line === line);
    const dr = drafts.filter((x) => x.side === side && x.line === line);
    const form = t?.side === side && t.line === line;
    if (!th.length && !dr.length && !form) return null;
    return (
      <tr>
        <td colSpan={3} class="notes-cell">
          <Notes ctx={ctx} threads={th} drafts={dr} form={form} />
        </td>
      </tr>
    );
  };

  const table = useRef<HTMLTableElement>(null);
  useWordHighlights(table, hunks);
  const mv = ctx.moved.get(path);
  // Kotlin/Java import blocks fold to one row (opened by click, or by a comment on one of their lines).
  const folds = useMemo(() => (isJvm(path) ? importFolds(hunks) : []), [hunks]);
  const root = ownRoot(path);
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const noted = (side: Side, n: number) =>
    threads.some((x) => x.diffSide === side && x.line === n) || drafts.some((x) => x.side === side && x.line === n) || (t?.side === side && t.line === n);
  const foldAt = (hi: number, li: number) =>
    folds.find(
      (f) =>
        f.hunk === hi && li >= f.start && li <= f.end && !openFolds.has(`${hi}-${f.start}`) &&
        !hunks[hi].lines.slice(f.start, f.end + 1).some((l) => (l.old && noted('LEFT', l.old)) || (l.new && noted('RIGHT', l.new))),
    );

  return (
    <table class="diff" ref={table}>
      <tbody>
        {hunks.map((h, hi) => (
          <>
            {gapBefore(hi) && gapRows(gapBefore(hi)!)}
            <tr class="hunk">
              <td colSpan={3}>{h.header}</td>
            </tr>
            {h.lines.map((l, li) => {
              const fold = foldAt(hi, li);
              // Outside the project and the standard library, one name per library (dagger.hilt rides with dagger).
              const outside = fold ? fold.newPackages.filter((p) => (!root || !p.startsWith(root)) && !/^(java|kotlin)(\.|$)/.test(p)) : [];
              const external = outside.filter((p) => !outside.some((q) => p.startsWith(q + '.')));
              if (fold)
                return li !== fold.start ? null : (
                  <tr class="import-fold">
                    <td colSpan={3}>
                      <button
                        title={`Show the imports${fold.newPackages.length ? `\nNew to this file: ${fold.newPackages.join(', ')}` : ''}`}
                        onClick={() => setOpenFolds((s) => new Set(s).add(`${hi}-${fold.start}`))}
                      >
                        ⋯ {[fold.added && `+${fold.added}`, fold.removed && `−${fold.removed}`].filter(Boolean).join(' ')} imports
                        {external.length > 0 && <span class="new-pkgs"> · new: {external.slice(0, 3).join(', ')}{external.length > 3 ? ` +${external.length - 3}` : ''}</span>}
                      </button>
                    </td>
                  </tr>
                );
              const side: Side = l.kind === '-' ? 'LEFT' : 'RIGHT';
              const num = side === 'LEFT' ? l.old! : l.new!;
              const move = l.kind === '-' ? mv?.old.get(l.old!) : l.kind === '+' ? mv?.new.get(l.new!) : undefined;
              return (
                <>
                  {move && (
                    <tr class="moved-h">
                      <td colSpan={3}>
                        {l.kind === '-' ? '↳ Moved to ' : '↰ Moved here from '}
                        <a href={'#f-' + move.split(':')[0]} onClick={(e) => { e.preventDefault(); jumpTo('f-' + move.split(':')[0]); }}>{move}</a>
                        {' '}without changes
                      </td>
                    </tr>
                  )}
                  <tr class={(l.kind === '+' ? 'ln a' : l.kind === '-' ? 'ln d' : 'ln') + (move !== undefined ? ' moved' : '')} data-k={`${hi}-${li}`}>
                    <td class="num" title="Comment (shift-click to extend)" onClick={(e) => pick(e, side, num)}>{l.old ?? ''}</td>
                    <td class="num" title="Comment (shift-click to extend)" onClick={(e) => pick(e, side, num)}>{l.new ?? ''}</td>
                    {hl ? <td class="code" dangerouslySetInnerHTML={{ __html: hl[hi][li] }} /> : <td class="code">{l.text}</td>}
                  </tr>
                  {notes(side, num)}
                  {l.kind === ' ' && notes('LEFT', l.old!)}
                </>
              );
            })}
          </>
        ))}
        {gapBefore(hunks.length) && gapRows(gapBefore(hunks.length)!)}
      </tbody>
    </table>
  );
}

// Word-level highlights inside changed lines, drawn with the CSS Custom Highlight API so the syntax-highlighted HTML
// stays untouched. Each diff adds its ranges to two shared highlights and takes them back out on re-render.
const WORD = typeof CSS !== 'undefined' && 'highlights' in CSS ? { del: new Highlight(), add: new Highlight() } : null;
if (WORD) {
  CSS.highlights.set('lgtm-word-del', WORD.del);
  CSS.highlights.set('lgtm-word-add', WORD.add);
}
function rangeIn(el: Element | null, start: number, end: number) {
  if (!el) return null;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0, started = false;
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    const len = n.data.length;
    if (!started && start <= pos + len) {
      r.setStart(n, start - pos);
      started = true;
    }
    if (started && end <= pos + len) {
      r.setEnd(n, end - pos);
      return r;
    }
    pos += len;
  }
  return null;
}
function useWordHighlights(table: { current: HTMLTableElement | null }, hunks: Hunk[]) {
  useLayoutEffect(() => {
    if (!WORD || !table.current) return;
    const mine: [Highlight, Range][] = [];
    hunks.forEach((h, hi) =>
      changePairs(h).forEach(([d, a]) => {
        const w = wordChange(h.lines[d].text, h.lines[a].text);
        if (!w) return;
        const cell = (li: number) => table.current!.querySelector(`tr[data-k="${hi}-${li}"] td.code`);
        const rd = rangeIn(cell(d), ...w.del), ra = rangeIn(cell(a), ...w.add);
        if (rd) mine.push([WORD.del, rd]);
        if (ra) mine.push([WORD.add, ra]);
      }),
    );
    for (const [hl, r] of mine) hl.add(r);
    return () => mine.forEach(([hl, r]) => hl.delete(r));
  });
}

function RichView({ file, hunks, ctx, threads, drafts }: BodyProps) {
  const path = file.filename;
  const [src, setSrc] = useState<string | null>();
  useEffect(() => {
    getRaw(ctx.headRepo, path, ctx.pr.head.sha).then(setSrc, () => setSrc(null));
  }, []);
  // Only diff lines take line comments, so sections outside the diff fold away (expandable, read-only).
  const inDiff = useMemo(() => new Set(hunks.flatMap((h) => h.lines.flatMap((l) => l.new ?? []))), [hunks]);
  const chunks = useMemo(() => (src ? renderChunks(src, file.status === 'added' ? new Set() : addedLines(hunks), inDiff) : []), [src, hunks]);
  const [openRuns, setOpenRuns] = useState<Set<number>>(new Set());
  const removed = useMemo(() => removedRuns(hunks), [hunks]);

  if (src === undefined) return <p class="note pad">Loading…</p>;
  if (src === null) return <p class="note pad">Couldn't load this file. Switch to Source.</p>;

  const t = ctx.target?.path === path ? ctx.target : null;
  // Threads, drafts and removals attach to the first top-level block ending at or after their line.
  const chunkOf = (line: number) => {
    const i = chunks.findIndex((c) => c.end >= line);
    return i < 0 ? chunks.length - 1 : i;
  };
  const markerSlot = (r: Removed) => {
    const i = chunks.findIndex((c) => c.end >= r.at);
    return i < 0 ? chunks.length : i;
  };
  const inRun = (r: Removed, line?: number | null) => line != null && line >= r.oldStart && line < r.oldStart + r.lines.length;

  const rightT = threads.filter((x) => x.diffSide === 'RIGHT');
  const rightD = drafts.filter((x) => x.side === 'RIGHT');
  const leftT = threads.filter((x) => x.diffSide === 'LEFT');
  const leftD = drafts.filter((x) => x.side === 'LEFT');
  const orphanT = leftT.filter((x) => !removed.some((r) => inRun(r, x.line)));
  const orphanD = leftD.filter((x) => !removed.some((r) => inRun(r, x.line)));
  const formLine = t?.side === 'RIGHT' ? t.line : undefined;
  const linesWithNotes = [...new Set([...rightT.map((x) => x.line!), ...rightD.map((x) => x.line!), ...(formLine != null ? [formLine] : [])])].sort((a, b) => a - b);
  // A section outside the diff is folded unless it holds a comment or its run was opened.
  const holdsNote = (i: number) => linesWithNotes.some((l) => chunkOf(l) === i);
  const runStart = (i: number) => {
    while (i > 0 && !chunks[i - 1].inDiff && !holdsNote(i - 1)) i--;
    return i;
  };
  const hidden = (i: number) => !chunks[i].inDiff && !holdsNote(i) && !openRuns.has(runStart(i));

  function onChunkClick(e: MouseEvent) {
    if ((e.target as Element).closest('.note-host')) return; // a click inside a comment placed in the block
    const el = (e.target as Element).closest('[data-src]');
    // Only the "+" gutter (drawn left of the block) starts a comment, so text stays selectable; context outside
    // the diff (data-nd) has none.
    if (!el || el.hasAttribute('data-nd') || e.clientX >= el.getBoundingClientRect().left) return;
    const [s, end] = el.getAttribute('data-src')!.split('-').map(Number);
    const a = anchor(hunks, s, end);
    if (a) ctx.setTarget({ path, side: 'RIGHT', ...a });
  }

  const marker = (r: Removed) => {
    const last = r.oldStart + r.lines.length - 1;
    return (
      <div class="removed">
        {!ctx.since && <button
          class="removed-c"
          title="Comment on removed lines"
          onClick={() => ctx.setTarget({ path, side: 'LEFT', line: last, startLine: last > r.oldStart ? r.oldStart : undefined })}
        >
          +
        </button>}
        <pre>{r.lines.join('\n')}</pre>
        <Notes
          ctx={ctx}
          threads={leftT.filter((x) => inRun(r, x.line))}
          drafts={leftD.filter((x) => inRun(r, x.line))}
          form={t?.side === 'LEFT' && inRun(r, t.line)}
        />
      </div>
    );
  };

  return (
    <div class="rich">
      <Notes ctx={ctx} threads={orphanT} drafts={orphanD} form={t?.side === 'LEFT' && !removed.some((r) => inRun(r, t.line))} />
      {chunks.map((c, i) => {
        if (hidden(i)) {
          // The first of a run of folded sections stands in for the whole run.
          if (i > 0 && hidden(i - 1)) return removed.filter((r) => markerSlot(r) === i).map(marker);
          let j = i;
          while (j < chunks.length && hidden(j)) j++;
          return (
            <>
              {removed.filter((r) => markerSlot(r) === i).map(marker)}
              <button class="md-gap" onClick={() => setOpenRuns((s) => new Set(s).add(i))}>
                ↕ Show {j - i} unchanged section{j - i === 1 ? '' : 's'}
              </button>
            </>
          );
        }
        // Notes on a line inside this block render right under that line (see ChunkView); a line between
        // blocks (blank lines) falls back to after the block.
        const lines = linesWithNotes.filter((l) => chunkOf(l) === i);
        const notesAt = (l: number) => (
          <Notes
            key={l}
            ctx={ctx}
            threads={rightT.filter((x) => x.line === l)}
            drafts={rightD.filter((x) => x.line === l)}
            form={formLine === l}
          />
        );
        const inside = lines.filter((l) => l >= c.start && l <= c.end);
        return (
          <>
            {removed.filter((r) => markerSlot(r) === i).map(marker)}
            <ChunkView html={c.html} onClick={onChunkClick} placed={inside.map((l) => ({ line: l, node: notesAt(l) }))} />
            {lines.filter((l) => !inside.includes(l)).map(notesAt)}
          </>
        );
      })}
      {removed.filter((r) => markerSlot(r) === chunks.length).map(marker)}
    </div>
  );
}

// A rendered markdown block (raw HTML) with comments mounted inside it, right under the line they're on: in the
// deepest block covering the line. A list item gets them under its own text (before any sub-list), a table row
// in a new row after it, a code line right after that line, anything else right after the block.
function ChunkView({ html, placed, onClick }: { html: string; placed: { line: number; node: VNode }[]; onClick: (e: MouseEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const hosts = useRef(new Map<Element, { host: HTMLElement; outer: HTMLElement }>());

  useLayoutEffect(() => {
    const blocks = [...ref.current!.querySelectorAll('[data-src]')];
    const covers = (b: Element, line: number) => {
      const [s, e] = b.getAttribute('data-src')!.split('-').map(Number);
      return line >= s && line <= e;
    };
    // Sibling blocks don't overlap, so the last block in document order that covers a line is the deepest one.
    const groups = new Map<Element, VNode[]>();
    for (const p of placed) {
      const el = blocks.filter((b) => covers(b, p.line)).at(-1);
      if (el) groups.set(el, [...(groups.get(el) ?? []), p.node]);
    }
    for (const [el, h] of hosts.current)
      if (!groups.has(el) || !h.outer.isConnected) {
        render(null, h.host);
        h.outer.remove();
        hosts.current.delete(el);
      }
    for (const [el, nodes] of groups) {
      let h = hosts.current.get(el);
      if (!h) {
        const host = document.createElement('div');
        host.className = 'note-host';
        let outer: HTMLElement = host;
        if (el.matches('tr')) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = el.children.length;
          td.append(host);
          tr.append(td);
          tr.className = 'note-tr';
          el.after(tr);
          outer = tr;
        } else if (el.matches('li')) {
          const sub = [...el.children].find((c) => c.matches('ul, ol'));
          if (sub) sub.before(host);
          else el.append(host);
        } else el.after(host);
        // A comment on a line inside collapsed content (a diagram's source) opens it.
        for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
        hosts.current.set(el, (h = { host, outer }));
      }
      render(<>{nodes}</>, h.host);
    }
    renderMermaid(ref.current);
  });

  useEffect(
    () => () => {
      for (const h of hosts.current.values()) {
        render(null, h.host);
        h.outer.remove();
      }
    },
    [],
  );

  return <div ref={ref} class="md chunk" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

const where = (d: { side: Side; line?: number; startLine?: number }) =>
  d.line == null ? 'File' : `${d.side === 'LEFT' ? 'Old line' : 'Line'}${d.startLine ? `s ${d.startLine}–${d.line}` : ` ${d.line}`}`;

function Notes({ ctx, threads, drafts, form }: { ctx: Ctx; threads: Thread[]; drafts: Draft[]; form: boolean }) {
  if (!threads.length && !drafts.length && !form) return null;
  return (
    <div class="notes">
      {threads.map((t) => (
        <ThreadView key={t.id} t={t} ctx={ctx} />
      ))}
      {drafts
        .filter((d) => d.id !== ctx.target?.editId)
        .map((d) => (
          <div class="draft" key={d.id} id={'d-' + d.id}>
            <div class="badge">Pending · {where(d)}</div>
            <div class="md" dangerouslySetInnerHTML={{ __html: md.render(d.body) }} />
            <div class="row">
              <button onClick={() => ctx.setTarget({ path: d.path, side: d.side, line: d.line, startLine: d.startLine, editId: d.id, body: d.body })}>Edit</button>
              <button onClick={() => ctx.removeDraft(d.id)}>Delete</button>
            </div>
          </div>
        ))}
      {form && <DraftForm key={JSON.stringify(ctx.target)} ctx={ctx} />}
    </div>
  );
}

function ThreadView({ t, ctx }: { t: Thread; ctx: Ctx }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const first = t.comments.nodes[0];
  const waiting = !!ctx.me && awaitsMe(t, ctx.me, ctx.pr.user.login === ctx.me);
  // Bot-only threads (AI reviewers, linters) start collapsed to their one-line preview.
  const bot = t.comments.nodes.every((c) => c.author?.__typename === 'Bot');

  async function act(f: () => Promise<void>) {
    setBusy(true);
    setErr('');
    try {
      await f();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }
  const send = () => act(async () => {
    await ctx.reply(t, body);
    setBody('');
  });

  return (
    <details class={`thread${waiting ? ' awaiting' : ''}${bot ? ' bot' : ''}`} id={'t-' + t.id} open={!t.isResolved && !t.isOutdated && !bot}>
      <summary>
        {waiting && <span class="badge awaiting-b">awaiting your reply · </span>}
        {/* The preview is for a collapsed thread; once open, the comments below say it. */}
        <span class="t-preview"><b>{first?.author?.login ?? 'ghost'}</b> {first?.bodyText.split('\n')[0].slice(0, 80)}</span>
        {t.isResolved && <span class="badge"> · resolved</span>}
        {t.isOutdated && <span class="badge"> · outdated</span>}
      </summary>
      {t.comments.nodes.map((c) => (
        <div class="comment" key={c.databaseId}>
          <b>{c.author?.login ?? 'ghost'}</b> <a href={c.url} target="_blank" rel="noopener"><time>{new Date(c.createdAt).toLocaleString()}</time></a> <CopyLink url={c.url} />
          <div class="md" dangerouslySetInnerHTML={{ __html: c.bodyHTML }} />
        </div>
      ))}
      <Editor value={body} onInput={setBody} onSubmit={() => body.trim() && !busy && send()} repo={ctx.repo} mentions={ctx.mentions} rows={2} placeholder="Reply… (⌘↵ to send)" />
      <div class="row">
        {body.trim() && (
          <button disabled={busy} onClick={send}>
            Reply
          </button>
        )}
        {(t.isResolved ? t.viewerCanUnresolve : t.viewerCanResolve) && (
          <button disabled={busy} onClick={() => act(() => ctx.resolve(t, !t.isResolved))}>
            {t.isResolved ? 'Unresolve' : 'Resolve conversation'}
          </button>
        )}
      </div>
      {err && <p class="error">{err}</p>}
    </details>
  );
}

function DraftForm({ ctx }: { ctx: Ctx }) {
  const target = ctx.target!;
  const [body, setBody] = useState(target.body ?? '');

  function save() {
    if (!body.trim()) return;
    const { editId, body: _b, atEnd: _e, ...rest } = target;
    if (editId) ctx.updateDraft(editId, { ...rest, body });
    else ctx.addDraft({ ...rest, body });
    ctx.setTarget(null);
  }

  return (
    <div class="draft-form">
      <div class="badge">{where(target)}</div>
      <Editor
        value={body}
        onInput={setBody}
        onSubmit={save}
        onCancel={() => ctx.setTarget(null)}
        repo={ctx.repo}
        mentions={ctx.mentions}
        suggestion={ctx.suggestion(target)}
        autoFocus
      />
      <div class="row">
        <button class="primary" disabled={!body.trim()} onClick={save}>
          {target.editId ? 'Update comment' : 'Add to review'}
        </button>
        <button onClick={() => ctx.setTarget(null)}>Cancel</button>
      </div>
    </div>
  );
}

// The Jira ticket the PR names, so the review can be held against its intent without leaving the page.
function Ticket({ id }: { id: string }) {
  const [issue, setIssue] = useState<JiraIssue | null>(null);
  const [err, setErr] = useState('');
  const [open, toggle] = useStoredFlag('ticketOpen', true);
  useEffect(() => void fetchJira(id).then(setIssue, (e) => setErr(e.message)), [id]);
  if (err) return <p class="note ticket-err">Jira {id}: {err}</p>;
  if (!issue) return null;
  const html = md.render(adfToMarkdown(issue.description));
  return (
    <details class="ticket" open={open} onToggle={(e) => e.currentTarget.open !== open && toggle()}>
      <summary>
        <a href={issue.url} target="_blank" rel="noopener">{issue.key}</a> <span class={'jira-st js-' + issue.statusCategory}>{issue.status}</span>{' '}
        <span class="badge">{issue.type}</span> <b>{issue.summary}</b>
      </summary>
      {html ? <div class="md" dangerouslySetInnerHTML={{ __html: html }} /> : <p class="note">No description.</p>}
    </details>
  );
}

// Copies a comment's github.com link (the timestamp next to it opens it).
function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState('');
  const show = (text: string) => {
    setDone(text);
    setTimeout(() => setDone(''), 1500);
  };
  return (
    <button
      class="copy-link"
      title="Copy link to this comment"
      onClick={() => navigator.clipboard.writeText(url).then(() => show('Copied'), () => show("Couldn't copy"))}
    >
      {done || '🔗'}
    </button>
  );
}

const STATE_LABEL: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'reviewed', DISMISSED: 'review dismissed' };

const botExcerpt = (html: string) => (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);

function Conversation({ pr, items }: { pr: PR; items: ConversationItem[] }) {
  return (
    <details class="conversation" id="conversation" open>
      <summary>
        Conversation <span class="badge">· {items.length} comment{items.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="comment" id="pr-description">
        <b>{pr.user.login}</b> <span class="badge">opened this pull request</span> <CopyLink url={pr.html_url} />
        {pr.body_html ? <div class="md" dangerouslySetInnerHTML={{ __html: pr.body_html }} /> : <p class="note">No description.</p>}
      </div>
      {items.map((c) => {
        const head = (
          <>
            <b>{c.author}</b> {c.state && <span class={'rstate r-' + c.state}>{STATE_LABEL[c.state] ?? c.state}</span>}{' '}
            <a href={c.url} target="_blank" rel="noopener"><time>{new Date(c.at).toLocaleString()}</time></a> <CopyLink url={c.url} />
          </>
        );
        const body = c.html && <div class="md" dangerouslySetInnerHTML={{ __html: c.html }} />;
        // Bot reports (CI summaries, AI reviewers, coverage) fold to one line; click to read.
        return c.bot ? (
          <details class="comment bot" key={c.id} id={'cv-' + c.id}>
            <summary>{head} <span class="bot-excerpt">{botExcerpt(c.html)}</span></summary>
            {body}
          </details>
        ) : (
          <div class="comment" key={c.id} id={'cv-' + c.id}>
            {head}
            {body}
          </div>
        );
      })}
    </details>
  );
}

const SHORTCUTS: [string, string][] = [
  ['j / k', 'Next / previous file'],
  ['n / p', 'Next / previous review thread'],
  ['v', 'Mark the current file viewed'],
  ['w', 'Ignore whitespace on/off'],
  ['Space', 'Comment on the line under the mouse (or at the top of the view)'],
  ['c', 'Comment on the current file'],
  ['[ / ]', 'Previous / next PR in the stack'],
  ['i', 'Show / hide the index'],
  ['⌘↵', 'Finish review (submit inside the panel)'],
  ['⌘F', 'Find, in every file'],
  ['?', 'This help'],
];

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div class="help" role="dialog" aria-label="Keyboard shortcuts">
      <div class="row">
        <b>Keyboard shortcuts</b>
        <span class="spacer" />
        <button onClick={onClose}>Close</button>
      </div>
      <table>
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
