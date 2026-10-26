import { render, type VNode } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addedLines, anchor, changePairs, gaps, markText, rangeChange, ignoreWhitespace, importFolds, importSyntax, movedLines, ownRoot, parsePatch, removedRuns, wordChange, type Gap, type Hunk, type Line, type Moved, type Removed } from './diff.ts';
import { isGenerated, parseGeneratedRules } from './gitattributes.ts';
import {
  getChecks, getStatus, getCompare, getConversation, getEmails, getEmojis, getBlame, getFiles, getMyLastReview, getPR, getRaw, getDownloadUrl, getStack, getThreads, getViewed, getViewer,
  awaitsMe, markBots, renderGfm, reply, resolveThread, setViewed, submitReview,
  type BlameLine, type Check, type PRFile, type StackLayer, type ConversationItem, type Draft, type PR, type ReviewEvent, type Thread,
} from './github.ts';
import { highlightBlocks, highlightCode, highlightHunks, languageFor, majorityLanguage, splitLines } from './highlight.ts';
import { isMarkdown, md, renderChunks } from './markdown.ts';
import { renderMermaid } from './mermaid.ts';
import { Editor } from './editor.tsx';
import { MergeBox } from './merge.tsx';
import { ACTIONS, FIXED, hint, keyLabel, readBindings, useBindings, type Action } from './keys.ts';
import { CLAUDE_CONTINUE, claudeContinueLink, claudeNewLink, walkthroughPrompt, askPrompt, commentPrompt, prPrompt } from './claude.ts';
import { vectorToSvg } from './vector.ts';
import { docBlocks, docSyntax, parseDoc, type DocBlock } from './docs.ts';
import { reviewOrder, untested } from './files.ts';
import { ago, claudeWalkthrough, prCache, claudeFolder, fetchJira, useFoldBots, slackEscape, getClaudeSessions, type ClaudeSession, notifySlack, openClaude, slackStatus, storage, useBots, useStoredFlag, type JiraIssue, type SlackThread } from './platform.ts';
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
  langFor: (path?: string) => string | undefined; // the language an unmarked code block in a comment on `path` is read as
  mainLang?: string; // the PR's main code language
  moved: Map<string, Moved>; // code moved without changes, per file
  untested: Set<string>; // code files whose tests the PR doesn't touch (Settings switch)
  sinceComment: Map<string, SinceComment>; // my open threads, against the code now
};
type SinceComment = { kind: 'same' | 'gone' | 'unknown' } | { kind: 'changed'; lines: Line[] };
type Saved = { sha: string; drafts: Draft[] };
// My last visit to a PR: each file's blob then, and where I was reading (file + how far into it).
type Visit = { files: Record<string, string>; at: { path: string; y: number } | null };


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

type Notice = { text: string; ok: boolean };
// onReviewed: the review is in and the user chose to move on (with the Slack result, if any, to show next).
export function Review({ repo, n, onSubmitted, onReviewed, flash }: { repo: string; n: number; onSubmitted: () => void; onReviewed: (notice: Notice | null) => void; flash?: Notice | null }) {
  const [data, setData] = useState<{ pr: PR; headRepo: string; files: File[]; rules: ReturnType<typeof parseGeneratedRules> } | null>(null);
  const [stack, setStack] = useState<StackLayer[]>([]);
  // "Changes since my last review": the commit I last reviewed, and that comparison once loaded.
  const [lastReviewed, setLastReviewed] = useState<string | null>(null);
  const [lastReviewAt, setLastReviewAt] = useState(''); // when I submitted it
  const [newCommits, setNewCommits] = useState<number | null>(null); // since that review
  // My open threads, against the code now: unchanged, changed (the lines as they are), or unknown (history rewritten).
  const [sinceComment, setSinceComment] = useState<Map<string, SinceComment>>(new Map());
  const [since, setSince] = useState(false);
  const [sinceData, setSinceData] = useState<{ status: string; files: File[] } | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [saved, setSaved] = useState<Saved>({ sha: '', drafts: [] });
  const [target, setTarget] = useState<Target | null>(null);
  const [showGenerated, setShowGenerated] = useState(false);
  const [showNoDiff, setShowNoDiff] = useState(false);
  // Feature switches (Settings → Diff).
  const { bots } = useBots();
  const [foldGenerated] = useStoredFlag('hideGenerated', true);
  const [foldNoDiff] = useStoredFlag('hideNoDiff', true);
  const [startSince] = useStoredFlag('sinceFirst', true);
  const [wholeOnMine] = useStoredFlag('sinceNotOnMine', true); // my own PR opens whole, even after I reviewed it
  const [resumeOn] = useStoredFlag('resumePosition', true);
  const [dimMoved] = useStoredFlag('dimMoved', true);
  const [showIndex, toggleIndex] = useStoredFlag('showIndex', true);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState('');
  // Who gets a Slack DM after submitting (author + assignees, minus me and bots); null = Slack not set up.
  const [slackPeople, setSlackTo] = useState<string[] | null>(null);
  const slackTo = slackPeople && slackPeople.filter((l) => !bots.has(l)); // never message an account marked as a bot
  const [slackNote, setSlackNote] = useState('Checking Slack…'); // why there's no Slack option, if there isn't
  const [slackThreads, setSlackThreads] = useState<SlackThread[]>([]);
  const [notice, setNotice] = useState<Notice | null>(flash ?? null);
  const [viewed, setViewedPaths] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // viewed files opened anyway
  const [renderAll, setRenderAll] = useState(false);
  const [help, setHelp] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getStatus>> | null>(null);
  const [ignoreWs, toggleWs] = useStoredFlag('ignoreWs', false);
  const [changedSinceVisit, setChangedSinceVisit] = useState<Set<string>>(new Set());
  const resumeAt = useRef<Visit['at']>(null);
  const visitKey = `visit:${repo}#${n}`;
  const [mine, setMine] = useState(false); // I opened it or it's assigned to me: show the merge box
  const [me, setMe] = useState('');
  const [stale, setStale] = useState<number | null>(null); // showing the copy loaded at this time, while refreshing
  const threadCursor = useRef(-1);
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const [bindings] = useBindings();
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
    getStatus(repo, n).then(setStatus, () => {});
    getViewed(repo, n).then(setViewedPaths, () => {});
    (async () => {
      const [stored, visit] = await Promise.all([storage.get<Saved>(key), storage.get<Visit>(visitKey).catch(() => undefined)]);
      if (visit) resumeAt.current = visit.at;
      // Show a PR's last-loaded copy at once (marked as updating), then the fresh one.
      type Loaded = { pr: PR; files: PRFile[]; threads: Thread[]; conversation: ConversationItem[]; attrs: string | null };
      let fresh = false;
      let shownHead = '';
      const show = (d: Loaded) => {
        const headRepo = d.pr.head.repo?.full_name ?? repo;
        const rules = parseGeneratedRules(d.attrs ?? '');
        if (visit) setChangedSinceVisit(new Set(d.files.filter((f) => visit.files[f.filename] !== f.sha).map((f) => f.filename)));
        if (shownHead && shownHead !== d.pr.head.sha) setSinceData(null); // new commits: compare again
        shownHead = d.pr.head.sha;
        setThreads(d.threads);
        setConversation(d.conversation);
        setSaved(stored ?? { sha: d.pr.head.sha, drafts: [] });
        setData({ pr: d.pr, headRepo, files: prepare(d.files, rules), rules });
      };
      prCache.get<Loaded>(`${repo}#${n}`).then((c) => {
        if (!c || fresh) return;
        setStale(c.at);
        show(c.v);
      });
      let pr: PR;
      let loaded: Loaded;
      try {
        pr = await getPR(repo, n);
        const headRepo = pr.head.repo?.full_name ?? repo;
        const [files, threads, conversation, attrs] = await Promise.all([
          getFiles(repo, n),
          getThreads(repo, n),
          getConversation(repo, n),
          getRaw(headRepo, '.gitattributes', pr.head.sha),
        ]);
        loaded = { pr, files, threads, conversation, attrs };
      } catch (e: any) {
        if (!shownHead) throw e;
        return setNotice({ ok: false, text: `Couldn't refresh this PR (${e.message}); showing the copy loaded earlier.` });
      }
      fresh = true;
      setStale(null);
      show(loaded);
      void prCache.set(`${repo}#${n}`, loaded);
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
      getStack(repo, pr).then(setStack, () => {});
      Promise.all([getMyLastReview(repo, n), getViewer().catch(() => '')]).then(([last, me]) => {
        const sha = last?.sha;
        if (last) setLastReviewAt(last.at);
        if (sha && sha !== pr.head.sha) {
          getCompare(repo, sha, pr.head.sha).then((c) => setNewCommits(c.commits), () => {});
          setLastReviewed(sha);
          if (startSince && !(wholeOnMine && pr.user.login === me)) setSince(true); // re-review: start with just what changed
        }
      }, () => {});
    })().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!since || !lastReviewed || !data || sinceData) return;
    getCompare(repo, lastReviewed, data.pr.head.sha).then(
      // After a rebase the comparison also carries the base branch's changes; keep only files this PR touches.
      (d) => {
        // GitHub lists at most 300 files per comparison. After a rebase onto lots of base-branch work those can all be
        // base-branch files, and the PR's own changes are cut off: fall back to the full diff rather than show nothing.
        if (d.files.length >= 300) {
          setSince(false);
          setLastReviewed(null); // no "since" toggle either: it would hit the same limit
          setNotice({ ok: false, text: 'Showing the full diff: the branch was rebased onto so much new base-branch work since your last review that GitHub can\'t list just what changed in this PR.' });
          return;
        }
        const inPR = new Set(data.files.map((f) => f.filename));
        setSinceData({ status: d.status, files: prepare(d.files.filter((f) => inPR.has(f.filename)), data.rules) });
      },
      (e) => {
        setSince(false);
        setNotice({ ok: false, text: `Couldn't load changes since your last review: ${e.message}` });
      },
    );
  }, [since, lastReviewed, data]);

  // My open threads against the code now: a compare from the commit each thread was written on to the head (one per
  // commit, kept), then whether the commented lines changed. Rewritten history (force-push) can't be mapped.
  const compares = useRef(new Map<string, Promise<Awaited<ReturnType<typeof getCompare>> | null>>());
  useEffect(() => {
    if (!data || !me) return;
    const head = data.pr.head.sha;
    const mine = threads.filter(
      (t) => !t.isResolved && t.diffSide === 'RIGHT' && t.subjectType === 'LINE' && t.originalLine && t.comments.nodes.some((c) => c.author?.login === me),
    );
    let stop = false;
    Promise.all(
      mine.map(async (t): Promise<[string, SinceComment] | null> => {
        const oid = t.comments.nodes[0]?.originalCommit?.oid;
        if (!oid || oid === head) return null;
        if (!compares.current.has(oid)) compares.current.set(oid, getCompare(repo, oid, head).catch(() => null));
        const c = await compares.current.get(oid)!;
        if (!c || c.status === 'diverged') return [t.id, { kind: 'unknown' }];
        const f = c.files.find((f) => f.filename === t.path || f.previous_filename === t.path);
        if (!f) return [t.id, { kind: 'same' }];
        if (f.status === 'removed') return [t.id, { kind: 'gone' }];
        if (!f.patch) return [t.id, { kind: 'unknown' }];
        const lines = rangeChange(f.patch, t.originalStartLine ?? t.originalLine!, t.originalLine!);
        return [t.id, lines ? { kind: 'changed', lines } : { kind: 'same' }];
      }),
    ).then((r) => !stop && setSinceComment(new Map(r.filter((x): x is [string, SinceComment] => !!x))));
    return () => void (stop = true);
  }, [data?.pr.head.sha, threads, me]);

  // Remember this visit when leaving the PR (or the page): file versions seen, and the reading position.
  useEffect(() => {
    if (!data) return;
    const where = (): Visit['at'] => {
      const top = 46 + 44 + 4; // below the top bar (--nav) and the review bar (--bar)
      const cur = [...document.querySelectorAll<HTMLElement>('main > .file')].findLast((s) => s.getBoundingClientRect().top <= top);
      return cur ? { path: cur.id.slice(2), y: top - cur.getBoundingClientRect().top } : null;
    };
    let at = where();
    const onScroll = () => (at = where());
    const save = () => void storage.set(visitKey, { files: Object.fromEntries(data.files.map((f) => [f.filename, f.sha])), at } satisfies Visit);
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('pagehide', save);
    // Pick up where I left off. Files above render lazily and shift things, so settle once more.
    const resume = resumeOn && resumeAt.current && document.getElementById('f-' + resumeAt.current.path);
    if (resume) {
      const go = () => {
        resume.scrollIntoView();
        scrollBy(0, resumeAt.current!.y);
      };
      go();
      setTimeout(go, 400);
      resumeAt.current = null; // once: the fresh copy replacing a cached one mustn't move you back
    }
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('pagehide', save);
      save();
    };
  }, [data]);

  // Moved code is matched across the whole PR (generated files aside, or their copies would count as moves).
  const moved = useMemo(() => {
    if (!dimMoved) return new Map<string, Moved>();
    const fs = since && sinceData ? sinceData.files : (data?.files ?? []);
    return movedLines(fs.filter((f) => !f.generated).map((f) => ({ filename: f.filename, hunks: parsePatch(f.patch ?? '') })));
  }, [data, sinceData, since, dimMoved]);

  // In "since" mode old-side line numbers refer to my last reviewed commit, so old-side threads would sit on the wrong lines.
  // Accounts marked as bots in Settings count as bots here, like GitHub's own.
  const allThreads = useMemo(() => markBots(threads, bots), [threads, bots.size]);
  const conv = useMemo(() => (bots.size ? conversation.map((c) => (bots.has(c.author) ? { ...c, bot: true } : c)) : conversation), [conversation, bots.size]);
  const shownThreads = since && sinceData ? allThreads.filter((t) => t.diffSide === 'RIGHT' || t.line == null) : allThreads;
  const byPath = useMemo(() => Map.groupBy(shownThreads, (t) => t.path), [shownThreads]);
  useEffect(() => {
    const main = document.querySelector('main');
    void renderMermaid(main); // conversation, threads, drafts
    // Code blocks in comments, in the language of the file they're on (data-lang); see highlightBlocks.
    main?.querySelectorAll<HTMLElement>('.md[data-lang]').forEach((el) => highlightBlocks(el, el.dataset.lang || undefined));
  });

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

  async function submit(event: ReviewEvent, body: string, notify: boolean, next: boolean) {
    const head = (await getPR(repo, n)).head.sha;
    const sha = drafts.length ? saved.sha : head;
    if (sha !== head && !confirm('New commits were pushed after you started this review. Submit your comments against the older commit?')) return false;
    await submitReview(pr.node_id, sha, event, body, drafts);
    saveDrafts([]);
    onSubmitted();
    let result: Notice | null = null;
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
        result = {
          ok: !failed.length,
          text: [sent.length && `Messaged ${sent.join(', ')} on Slack.`, ...failed.map((r) => `Couldn't message @${r.login}: ${r.error}`)].filter(Boolean).join(' '),
        };
      } catch (e: any) {
        result = { ok: false, text: `Review submitted, but Slack failed: ${e.message}` };
      }
    }
    if (next) {
      onReviewed(result);
      return true;
    }
    setNotice(result);
    const [t, c] = await Promise.all([getThreads(repo, n), getConversation(repo, n)]);
    setThreads(t);
    setConversation(c);
    return true;
  }

  const mainLang = majorityLanguage(data.files.filter((f) => !f.generated).map((f) => f.filename));
  const [flagUntested] = useStoredFlag('flagUntested', true);
  const noTests = useMemo(() => new Set(flagUntested ? untested(data.files.filter((f) => !f.generated)) : []), [data.files, flagUntested]);
  const ctx: Ctx = {
    untested: noTests,
    sinceComment,
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
    mainLang,
    langFor: (path) => (path && !isMarkdown(path) && languageFor(path)) || mainLang,
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
  const genOpen = showGenerated || !foldGenerated, noDiffOpen = showNoDiff || !foldNoDiff;
  const shown = [...visible, ...(genOpen ? generated : []), ...(noDiffOpen ? noDiff : [])];
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
  const failingChecks = checks?.filter((c) => c.state === 'failure').length ?? 0;
  const waitingOnMe = me ? allThreads.filter((t) => awaitsMe(t, me, pr.user.login === me)).length : 0;
  const myOpenThreads = me ? allThreads.filter((t) => !t.isResolved && t.comments.nodes.some((c) => c.author?.login === me)).length : 0;
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

  // Keyboard shortcuts (see the ⌨ help; rebindable in Settings). Reassigned every render so it sees current state.
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
    const top = 46 + 44 + 60;
    const cur = sections.reduce((c, s, i) => (s.getBoundingClientRect().top <= top ? i : c), -1);
    const path = sections[Math.max(cur, 0)]?.id.slice(2);
    const ordered = threadOrder(shownThreads, drafts, shown);
    const act: Record<Action, () => void> = {
      nextFile: () => sections[Math.min(cur + 1, sections.length - 1)]?.scrollIntoView(),
      prevFile: () => sections[Math.max(cur - 1, 0)]?.scrollIntoView(),
      nextThread: () => ordered.length && go(Math.min(threadCursor.current + 1, ordered.length - 1)),
      prevThread: () => ordered.length && go(Math.max(threadCursor.current - 1, 0)),
      viewed: () => path && toggleViewed(path),
      fileComment: () => path && ctx.setTarget({ path, side: 'RIGHT' }),
      comment: () => commentAtCurrentLine() || scrollBy({ top: innerHeight * 0.85 }), // nothing to comment on: scroll as Space would
      index: toggleIndex,
      whitespace: toggleWs,
      stackPrev: () => stackAt(-1) && (location.hash = `/${repo}/pull/${stackAt(-1)!.number}`),
      stackNext: () => stackAt(1) && (location.hash = `/${repo}/pull/${stackAt(1)!.number}`),
      help: () => setHelp(!help),
    };
    function go(i: number) {
      threadCursor.current = i;
      jumpTo(ordered[i].id, 'f-' + ordered[i].path);
    }
    const k = e.key === '/' && e.shiftKey ? '?' : e.key;
    if (k === 'Escape') return setHelp(false);
    const a = ACTIONS.find(([a]) => bindings[a] === k)?.[0];
    if (a) {
      e.preventDefault();
      act[a]();
    }
  };

  return (
    <div class={showIndex ? 'review' : 'review no-index'}>
      {/* Always there, so showing and hiding can slide (style.css); hidden, it's out of reach of the keyboard. */}
      {(
        <aside class={showIndex ? 'side tree' : 'side tree collapsed'} aria-hidden={!showIndex}>
          <div class="side-scroll">
            <ShortcutIndex
              repo={repo}
              pr={pr}
              conversation={conv}
              threads={shownThreads}
              drafts={drafts}
              checks={checks}
              onRefreshChecks={loadChecks}
              files={shown}
              viewed={viewed}
              me={me}
              counts={(path) => (byPath.get(path)?.length ?? 0) + drafts.filter((d) => d.path === path).length}
            />
            <div class="ix-foot">
              <label title={`Hide whitespace-only changes${hint(bindings.whitespace)}`}>
                <input type="checkbox" checked={ignoreWs} onChange={toggleWs} /> Ignore whitespace
              </label>
              <button onClick={() => setHelp(!help)} title={`Keyboard shortcuts${hint(bindings.help)}`}>Shortcuts</button>
            </div>
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
            <a href={pr.html_url} target="_blank" rel="noopener" title={`${repo}#${n} ${pr.title}\nOpen on GitHub`}>
              <span class="pr-num">#{n}</span> {pr.title}
            </a>
          </h1>
          {slackThreads.map((t) => (
            <a class="bar-slack" href={t.url} target="_blank" rel="noopener" title={`Your Slack thread with @${t.login} about this PR`}>
              💬 @{t.login}
            </a>
          ))}
          <ClaudeMenu prompt={prPrompt(pr, repo)} repo={repo} prUrl={pr.html_url} label="Claude" />
          {layer >= 0 && (
            <span class="stack-nav" title="This PR's stack ([ and ] to move)">
              {stackAt(-1) ? <a href={`#/${repo}/pull/${stackAt(-1)!.number}`} title={`#${stackAt(-1)!.number} ${stackAt(-1)!.title}`}>‹</a> : <span class="off">‹</span>}
              <select value={n} onChange={(e) => (location.hash = `/${repo}/pull/${e.currentTarget.value}`)} aria-label="Jump to a stack layer">
                {stack.map((l, k) => (
                  <option value={l.number}>{k + 1}/{stack.length} · #{l.number} {l.title}</option>
                ))}
              </select>
              {stackAt(1) ? <a href={`#/${repo}/pull/${stackAt(1)!.number}`} title={`#${stackAt(1)!.number} ${stackAt(1)!.title}`}>›</a> : <span class="off">›</span>}
            </span>
          )}
          <SubmitPanel count={drafts.length} myOpenThreads={myOpenThreads} slackTo={slackTo} slackNote={slackNote} onSubmit={submit} repo={repo} mentions={ctx.mentions} authored={!!me && pr.user.login === me} />
        </div>
        {help && <Help onClose={() => setHelp(false)} ignoreWs={ignoreWs} toggleWs={toggleWs} />}
        <main>
          <div class="pills pr-status">
            {stale && <span class="pill" title={`Showing the copy loaded ${ago(stale)} while this one loads`}>updating…</span>}
            {pr.draft && <span class="pill">draft</span>}
            {status && !pr.draft && (
              <span class={'pill ' + ({ APPROVED: 'p-ok', CHANGES_REQUESTED: 'p-bad' } as Record<string, string>)[status.reviewDecision ?? ''] }>
                {{ APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'awaiting review' }[status.reviewDecision ?? 'REVIEW_REQUIRED']}
              </span>
            )}
            {failingChecks > 0 && <span class="pill p-bad">{failingChecks} check{failingChecks > 1 ? 's' : ''} failing</span>}
            {status?.mergeStateStatus === 'DIRTY' && <span class="pill p-bad">conflicts</span>}
            {waitingOnMe > 0 && <span class="pill p-reply">💬 {waitingOnMe} awaiting your reply</span>}
            {noTests.size > 0 && (
              <span class="pill p-warn" title={`Changed without a matching test change:\n${[...noTests].join('\n')}`}>
                {noTests.size} file{noTests.size > 1 ? 's' : ''} without test changes
              </span>
            )}
            {pr.additions != null && (
              <span class="pill p-size">
                <b class="a">+{pr.additions}</b> <b class="d">−{pr.deletions}</b> · {pr.changed_files} file{pr.changed_files === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {notice && <p class={notice.ok ? 'notice' : 'warn'}>{notice.text}</p>}
          {lastReviewed && (
            <div class={since ? 'since on' : 'since'}>
              <SinceSummary
                me={me}
                threads={threads}
                lastReviewAt={lastReviewAt}
                newCommits={newCommits}
                sinceComment={sinceComment}
                onCommits={() => setSince(true)}
              />
              {since ? (
                <>
                  <span class="since-state">
                    Showing only those changes (<code>{lastReviewed.slice(0, 7)}</code> → <code>{pr.head.sha.slice(0, 7)}</code>)
                    {sinceData ? ` · ${sinceData.files.length} file${sinceData.files.length === 1 ? '' : 's'}` : ' · loading…'}
                    {sinceData?.status === 'diverged' && sinceData.files.length > 0 && <b> · rebased since then, so these files may also show changes from the base branch</b>}
                    {sinceData && !sinceData.files.length && <b> · none of this PR's files changed (only a rebase)</b>}
                  </span>
                  <button onClick={() => setSince(false)}>Show all changes</button>
                </>
              ) : (
                <button onClick={() => setSince(true)}>Show only those changes</button>
              )}
            </div>
          )}
          {drafts.length > 0 && saved.sha !== pr.head.sha && (
            <p class="warn">New commits were pushed since you started this review. Your pending comments refer to the older commit.</p>
          )}
          {jiraKeys(pr.title, pr.head.ref).map((k) => <Ticket key={k} id={k} lang={mainLang} />)}
          <Walkthrough pr={pr} repo={repo} files={data.files} />
          <AskClaude pr={pr} repo={repo} headRepo={data.headRepo} files={data.files} />
          {mine && <MergeBox repo={repo} n={n} url={pr.html_url} checks={checks} onChange={onSubmitted} />}
          <Conversation pr={pr} items={conv} lang={mainLang} repo={repo} me={me} />
          {visible.map(section)}
          {generated.length > 0 &&
            (genOpen ? generated.map(section) : (
              <button class="gen-row" onClick={() => setShowGenerated(true)}>
                {generated.length} generated file{generated.length > 1 ? 's' : ''} hidden. Show
              </button>
            ))}
          {noDiff.length > 0 &&
            (noDiffOpen ? noDiff.map(section) : (
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
  myOpenThreads: number; // unresolved review threads I'm in
  slackTo: string[] | null;
  slackNote: string;
  onSubmit: (e: ReviewEvent, body: string, notify: boolean, next: boolean) => Promise<boolean>;
  repo: string;
  mentions: string[];
  authored: boolean; // my own PR: GitHub only takes comments there
};

const APPROVE_NOTE = 'Approved, but please address the comments';

// The verdict to start from: pending comments → request changes; my earlier threads still open → comment; else approve.
export const defaultEvent = (pending: number, myOpenThreads: number): ReviewEvent => (pending ? 'REQUEST_CHANGES' : myOpenThreads ? 'COMMENT' : 'APPROVE');

function SubmitPanel({ count, myOpenThreads, slackTo, slackNote, onSubmit, repo, mentions, authored }: SubmitProps) {
  const [open, setOpen] = useState(false);
  const [notify, toggleNotify] = useStoredFlag('slackNotify', true);
  const [next, toggleNext] = useStoredFlag('nextAfterReview', true);
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
  // Each time the panel opens, start from the verdict that fits the comments as they are now.
  useEffect(() => void (open && setEvent(authored ? 'COMMENT' : defaultEvent(count, myOpenThreads))), [open, authored]);
  // Approving with pending comments: say so, unless I've written my own summary.
  const pick = (v: ReviewEvent) => {
    setEvent(v);
    if (v === 'APPROVE' && count && !body.trim()) setBody(APPROVE_NOTE);
    else if (v !== 'APPROVE' && body === APPROVE_NOTE) setBody('');
  };

  async function go() {
    setBusy(true);
    setErr('');
    try {
      if (await onSubmit(event, body, notify, next)) {
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
          {!authored && (Object.keys(labels) as ReviewEvent[]).map((v) => (
            <label>
              <input type="radio" name="event" checked={event === v} onChange={() => pick(v)} /> {labels[v]}
            </label>
          ))}
          {slackTo && slackTo.length > 0 && (
            <label>
              <input type="checkbox" checked={notify} onChange={toggleNotify} /> Message {slackTo.map((l) => '@' + l).join(', ')} on Slack
            </label>
          )}
          <label>
            <input type="checkbox" checked={next} onChange={toggleNext} /> Then open the next PR that needs my review
          </label>
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
  const [richFirst] = useStoredFlag('richMarkdown', true);
  const [previewFirst] = useStoredFlag('previewImages', true);
  const [collapseDeleted] = useStoredFlag('collapseDeleted', true);
  const [rich, setRich] = useState(canRich && richFirst);
  // Android drawables preview as images by default; one that isn't a <vector> (a selector, a shape) falls back to source.
  const [canPreview, setCanPreview] = useState(DRAWABLE.test(file.filename) || BITMAP.test(file.filename));
  const [preview, setPreview] = useState(canPreview && previewFirst);
  // A deleted file's old contents are mostly noise: one row until asked for, unless a line comment is already on it.
  const [showDeleted, setShowDeleted] = useState(threads.some((x) => !isFileLevel(x)) || drafts.some((d) => d.line));
  const hideDeleted = collapseDeleted && file.status === 'removed' && !showDeleted;
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
        {ctx.untested.has(file.filename) && <span class="badge no-test" title="The PR changes this code but no test with its name">no test change</span>}
        {changed && <span class="new-b" title="This file changed since you last opened this PR">new since your last visit</span>}
        {canRich && <button onClick={() => setRich(!rich)}>{rich ? 'Source' : 'Rich'}</button>}
        {canPreview && <button onClick={() => setPreview(!preview)}>{preview ? 'Source' : 'Preview'}</button>}
        <button onClick={() => ctx.setTarget({ path, side: 'RIGHT' })}>Comment</button>
        <label class="viewed-box" title={`Mark as viewed on GitHub${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').viewed)}`}>
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
      {canPreview && preview && (near || ctx.renderAll) ? (
        <ImagePreview file={file} ctx={ctx} onFail={() => (setCanPreview(false), setPreview(false))} />
      ) : !file.patch ? (
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

// Before / after images (base branch vs PR head): bitmaps as they are, Android vector drawables converted to SVG.
const BITMAP = /\.(png|webp|jpe?g|gif)$/i;
const DRAWABLE = /\/res\/drawable[^/]*\/[^/]+\.xml$/;
type Shot = { src: string; size?: string; note?: string };
function ImagePreview({ file, ctx, onFail }: { file: File; ctx: Ctx; onFail: () => void }) {
  const [shots, setShots] = useState<{ before: Shot | null; after: Shot | null } | null>(null);
  const [dims, setDims] = useState<Record<string, string>>({});
  useEffect(() => {
    const load = async (repo: string, path: string, ref: string): Promise<Shot | null> => {
      if (BITMAP.test(file.filename)) {
        const src = await getDownloadUrl(repo, path, ref);
        return src ? { src } : null;
      }
      const text = await getRaw(repo, path, ref);
      const v = text ? vectorToSvg(text) : null;
      return v && { src: 'data:image/svg+xml,' + encodeURIComponent(v.svg), size: `${v.width}×${v.height}dp`, note: v.approx ? 'Colours from resources (@color/…, ?attr/…) are drawn grey.' : undefined };
    };
    Promise.all([
      file.status === 'added' ? null : load(ctx.repo, file.previous_filename ?? file.filename, ctx.pr.base.sha),
      file.status === 'removed' ? null : load(ctx.headRepo, file.filename, ctx.pr.head.sha),
    ]).then(([before, after]) => (before || after ? setShots({ before, after }) : onFail()), onFail);
  }, []);
  if (!shots) return <p class="note pad">Loading preview…</p>;
  const fig = (label: string, s: Shot | null) =>
    s && (
      <figure>
        <a href={s.src} target="_blank" rel="noopener" title="Open full size">
        <img
          src={s.src}
          alt={`${label}: ${file.filename}`}
          // Small icons scale up to be seen; big images scale down.
          style={{ height: '96px' }}
          onLoad={(e) => {
            const el = e.currentTarget;
            el.style.height = `${Math.min(320, Math.max(96, el.naturalHeight))}px`;
            if (BITMAP.test(file.filename)) setDims((d) => ({ ...d, [label]: `${el.naturalWidth}×${el.naturalHeight}px` }));
          }}
        />
        </a>
        <figcaption>{[label, dims[label], s.size].filter(Boolean).join(' · ')}</figcaption>
      </figure>
    );
  const note = shots.before?.note ?? shots.after?.note;
  return (
    <div class="vector-preview">
      {fig('Before', shots.before)}
      {shots.before && shots.after && <span class="vp-arrow">→</span>}
      {fig(shots.before ? 'After' : file.status === 'removed' ? 'Deleted' : 'New', shots.after)}
      {note && <p class="note">{note}</p>}
    </div>
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
  const words = useWordMarks(hunks);
  const codeHtml = (hi: number, li: number, text: string) => {
    const html = hl ? hl[hi][li] : md.utils.escapeHtml(text);
    const w = words.get(`${hi}-${li}`);
    return w ? markText(html, w[1], w[2], w[0]) : html;
  };
  const mv = ctx.moved.get(path);
  // Kotlin/Java import blocks fold to one row (opened by click, or by a comment on one of their lines).
  const [foldImports] = useStoredFlag('foldImports', true);
  const folds = useMemo(() => (foldImports && importSyntax(path) ? importFolds(hunks, importSyntax(path)!) : []), [hunks, foldImports]);
  const root = ownRoot(path);
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const noted = (side: Side, n: number) =>
    threads.some((x) => x.diffSide === side && x.line === n) || drafts.some((x) => x.side === side && x.line === n) || (t?.side === side && t.line === n);
  // Blocks shown in place of their lines (an import fold, a rendered doc comment), unless opened or commented on.
  const covering = <B extends { hunk: number; start: number; end: number }>(list: B[], open: Set<string>, hi: number, li: number) =>
    list.find(
      (b) =>
        b.hunk === hi && li >= b.start && li <= b.end && !open.has(`${hi}-${b.start}`) &&
        !hunks[hi].lines.slice(b.start, b.end + 1).some((l) => (l.old && noted('LEFT', l.old)) || (l.new && noted('RIGHT', l.new))),
    );
  // An import fold steps aside only for the lines that carry a comment: they show (with the thread) and the rest of
  // the block stays folded, one row per folded stretch.
  const lineNoted = (l: Line) => (l.old != null && noted('LEFT', l.old)) || (l.new != null && noted('RIGHT', l.new));
  const foldAt = (hi: number, li: number) => {
    const f = folds.find((b) => b.hunk === hi && li >= b.start && li <= b.end && !openFolds.has(`${hi}-${b.start}`));
    if (!f || lineNoted(hunks[hi].lines[li])) return undefined;
    return { ...f, head: li === f.start || lineNoted(hunks[hi].lines[li - 1]) };
  };
  // KDoc / Javadoc / JSDoc comments, rendered like IntelliJ's reader mode; "source" shows the lines again.
  const [renderDocs] = useStoredFlag('renderDocs', true);
  const docs = useMemo(() => (renderDocs && docSyntax(path) ? docBlocks(hunks) : []), [hunks, renderDocs]);
  const [openDocs, setOpenDocs] = useState<Set<string>>(new Set());
  const docAt = (hi: number, li: number) => covering(docs, openDocs, hi, li);
  // A doc comment switched to its source: a header row above its first line switches it back.
  const docOpenedAt = (hi: number, li: number) => docs.find((d) => d.hunk === hi && d.start === li && openDocs.has(`${hi}-${li}`));

  const blame = useBlameHover(ctx, file);
  return (
    <>
    {blame.pop}
    <table class="diff" ref={table} onMouseEnter={blame.enter} onMouseOver={blame.over} onMouseLeave={blame.hide} onMouseDown={blame.hide}>
      <tbody>
        {hunks.map((h, hi) => (
          <>
            {gapBefore(hi) && gapRows(gapBefore(hi)!)}
            {file.status !== 'added' && ( // a new file's one hunk header (@@ -0,0 +1,n @@) says nothing
              <tr class="hunk">
                <td colSpan={3}>{h.header}</td>
              </tr>
            )}
            {h.lines.map((l, li) => {
              const fold = foldAt(hi, li);
              // Outside the project and the standard library, one name per library (dagger.hilt rides with dagger).
              const outside = fold ? fold.newPackages.filter((p) => (!root || !p.startsWith(root)) && !/^(java|kotlin)(\.|$)/.test(p)) : [];
              const external = outside.filter((p) => !outside.some((q) => p.startsWith(q + '.')));
              if (fold)
                return !fold.head ? null : (
                  <tr class="import-fold">
                    <td colSpan={3}>
                      <button
                        title={`Show the package and imports${fold.newPackages.length ? `\nNew to this file: ${fold.newPackages.join(', ')}` : ''}`}
                        onClick={() => setOpenFolds((s) => new Set(s).add(`${hi}-${fold.start}`))}
                      >
                        ⋯ {[fold.packageMoved && 'package moved', (fold.added || fold.removed) && [fold.added && `+${fold.added}`, fold.removed && `−${fold.removed}`].filter(Boolean).join(' ') + ' imports'].filter(Boolean).join(', ') || 'package'}
                        {external.length > 0 && <span class="new-pkgs"> · new: {external.slice(0, 3).join(', ')}{external.length > 3 ? ` +${external.length - 3}` : ''}</span>}
                      </button>
                    </td>
                  </tr>
                );
              const doc = docAt(hi, li);
              if (doc) {
                if (li !== doc.start) return null;
                const first = h.lines[doc.start], last = h.lines[doc.end];
                return (
                  <tr class={`ln doc${doc.kind === '+' ? ' a' : doc.kind === '-' ? ' d' : ''}`}>
                    <td class="num" title={`Lines ${first.old}–${last.old}: comment (shift-click to extend)`} onClick={(e) => pick(e, doc.kind === '-' ? 'LEFT' : 'RIGHT', doc.kind === '-' ? first.old! : first.new!)}>
                      {first.old ?? ''}
                    </td>
                    <td class="num" title={`Lines ${first.new}–${last.new}: comment (shift-click to extend)`} onClick={(e) => pick(e, doc.kind === '-' ? 'LEFT' : 'RIGHT', doc.kind === '-' ? first.old! : first.new!)}>
                      {first.new ?? ''}
                    </td>
                    <td class="code">
                      <DocView doc={doc} syntax={docSyntax(path)!} onSource={() => setOpenDocs((s) => new Set(s).add(`${hi}-${doc.start}`))} />
                    </td>
                  </tr>
                );
              }
              const side: Side = l.kind === '-' ? 'LEFT' : 'RIGHT';
              const num = side === 'LEFT' ? l.old! : l.new!;
              const move = l.kind === '-' ? mv?.old.get(l.old!) : l.kind === '+' ? mv?.new.get(l.new!) : undefined;
              const opened = docOpenedAt(hi, li);
              return (
                <>
                  {opened && (
                    <tr class="doc-h">
                      <td colSpan={3}>
                        <button
                          class="link"
                          title="Show this doc comment rendered"
                          onClick={() => setOpenDocs((s) => { const x = new Set(s); x.delete(`${hi}-${li}`); return x; })}
                        >
                          ⤒ Render doc comment
                        </button>
                      </td>
                    </tr>
                  )}
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
                    <td class="code" dangerouslySetInnerHTML={{ __html: codeHtml(hi, li, l.text) }} />
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
    </>
  );
}

// Hovering a line number for a moment shows who last changed that line, above it (clear of a comment box opening
// below): the old number blames the base, the new one the head (a line this PR added shows its own commit). A file's
// blame is fetched when the mouse enters its diff, and kept for the session.
const blames = new Map<string, Promise<Map<number, BlameLine>>>();
function useBlameHover(ctx: Ctx, file: File) {
  const [on] = useStoredFlag('blameHover', true);
  const [pop, setPop] = useState<{ x: number; y: number; b: BlameLine } | null>(null);
  const timer = useRef(0);
  const cell = useRef<Element | null>(null); // the number being hovered
  const side = (old: boolean) => {
    const sha = old ? ctx.pr.base.sha : ctx.pr.head.sha;
    const path = old ? (file.previous_filename ?? file.filename) : file.filename;
    const key = `${ctx.repo}@${sha}:${path}`;
    if (!blames.has(key)) blames.set(key, getBlame(ctx.repo, sha, path).catch(() => new Map()));
    return blames.get(key)!;
  };
  const hide = () => (clearTimeout(timer.current), (cell.current = null), setPop(null));
  const enter = () => {
    if (!on) return;
    if (file.status !== 'added') void side(true);
    if (file.status !== 'removed') void side(false);
  };
  const over = (e: MouseEvent) => {
    const td = (e.target as Element).closest('td.num') as HTMLTableCellElement | null;
    if (!on || !td || !td.textContent) return cell.current && hide();
    if (td === cell.current) return;
    cell.current = td;
    clearTimeout(timer.current);
    setPop(null);
    const line = Number(td.textContent);
    timer.current = setTimeout(async () => {
      const b = (await side(td.cellIndex === 0)).get(line);
      if (!b || cell.current !== td || document.activeElement?.closest('.editor')) return; // moved on, or typing
      const r = td.getBoundingClientRect();
      setPop({ x: r.left, y: r.top - 4, b });
    }, 500) as unknown as number;
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    enter,
    over,
    hide,
    // On <body>: inside a file, whose containment (content-visibility) would place and clip a fixed element itself.
    pop:
      pop &&
      createPortal(
        <div class="blame-pop" style={{ left: pop.x, top: pop.y }}>
          <b>{pop.b.who}</b> · {ago(pop.b.when)} · <code>{pop.b.sha}</code>
          <div>{pop.b.message}</div>
          {pop.b.pr && <div class="note">#{pop.b.pr.number} {pop.b.pr.title}</div>}
        </div>,
        document.body,
      ),
  };
}

// The changed words inside a changed line, per row ("hunk-line"): marked in the row's own HTML (markText). The CSS
// Custom Highlight API drew them before, but the browser sometimes painted those far past their words (whole files
// green, header included) until the next re-render.
function useWordMarks(hunks: Hunk[]) {
  const [on] = useStoredFlag('wordDiff', true);
  return useMemo(() => {
    const m = new Map<string, [cls: string, start: number, end: number]>();
    if (on)
      hunks.forEach((h, hi) =>
        changePairs(h).forEach(([d, a]) => {
          const w = wordChange(h.lines[d].text, h.lines[a].text);
          if (!w) return;
          m.set(`${hi}-${d}`, ['wd-del', ...w.del]);
          m.set(`${hi}-${a}`, ['wd-add', ...w.add]);
        }),
      );
    return m;
  }, [hunks, on]);
}

// A documentation comment, rendered: the description as markdown, then the tags (Params, Returns, Throws…).
function DocView({ doc, syntax, onSource }: { doc: DocBlock; syntax: 'kdoc' | 'java' | 'jsdoc'; onSource: () => void }) {
  const { body, tags } = useMemo(() => parseDoc(doc.text, syntax), [doc.text]);
  return (
    <div class="doc-render" style={{ marginLeft: `${doc.indent}ch`, width: `calc(100% - ${doc.indent + 3}ch)` }}>
      <button class="link doc-source" title="Show the comment's source lines" onClick={onSource}>&lt;/&gt; source</button>
      {body && <div class="md" dangerouslySetInnerHTML={{ __html: md.render(body) }} />}
      {tags.length > 0 && (
        <dl class="doc-tags">
          {tags.map(([label, items]) => (
            <>
              <dt>{label}:</dt>
              <dd>
                {items.map(([name, text]) => (
                  <div>
                    {name && <code>{name}</code>}
                    {name && text && ' – '}
                    <span dangerouslySetInnerHTML={{ __html: md.renderInline(text) }} />
                  </div>
                ))}
              </dd>
            </>
          ))}
        </dl>
      )}
    </div>
  );
}

function RichView({ file, hunks, ctx, threads, drafts }: BodyProps) {
  const path = file.filename;
  const [src, setSrc] = useState<string | null>();
  useEffect(() => {
    getRaw(ctx.headRepo, path, ctx.pr.head.sha).then(setSrc, () => setSrc(null));
  }, []);
  // Only diff lines take line comments, so sections outside the diff fold away (expandable, read-only).
  const inDiff = useMemo(() => new Set(hunks.flatMap((h) => h.lines.flatMap((l) => l.new ?? []))), [hunks]);
  const chunks = useMemo(() => (src ? renderChunks(src, file.status === 'added' ? new Set() : addedLines(hunks), inDiff, ctx.mainLang) : []), [src, hunks]);
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
            <div class="md" data-lang={ctx.langFor(d.path) ?? ''} dangerouslySetInnerHTML={{ __html: md.render(d.body) }} />
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
  const foldBots = useFoldBots(!!ctx.me && ctx.pr.user.login === ctx.me);
  const bot = foldBots && t.comments.nodes.every((c) => c.author?.__typename === 'Bot');

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
        {ctx.sinceComment.get(t.id)?.kind === 'changed' && <span class="badge"> · code changed since</span>}
        {ctx.sinceComment.get(t.id)?.kind === 'same' && <span class="badge"> · code unchanged</span>}
      </summary>
      <ThenNow s={ctx.sinceComment.get(t.id)} />
      {t.comments.nodes.map((c) => (
        <div class="comment" key={c.databaseId}>
          <b>{c.author?.login ?? 'ghost'}</b> <a href={c.url} target="_blank" rel="noopener"><time>{new Date(c.createdAt).toLocaleString()}</time></a> <CopyLink url={c.url} />
          <ClaudeMenu repo={ctx.repo} prUrl={ctx.pr.html_url} prompt={commentPrompt({ author: c.author?.login ?? 'ghost', text: c.bodyText, url: c.url }, { repo: ctx.repo, number: ctx.pr.number, prUrl: ctx.pr.html_url, path: t.path, line: t.line })} />
          <div class="md" data-lang={ctx.langFor(t.path) ?? ''} dangerouslySetInnerHTML={{ __html: c.bodyHTML }} />
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

// On my open threads: did the commented lines change since the thread started? ("Did they fix it?")
function ThenNow({ s }: { s?: SinceComment }) {
  if (!s) return null;
  if (s.kind !== 'changed')
    return (
      <p class="then-now">
        {{ same: "✓ The commented lines haven't changed since.", gone: 'The file was removed since.', unknown: "The branch was rewritten since (force-push), so lgtm can't tell whether these lines changed." }[s.kind]}
      </p>
    );
  const shown = s.lines.slice(0, 12);
  return (
    <div class="then-now changed">
      ✎ Changed since this thread started:
      <table class="diff mini">
        <tbody>
          {shown.map((l) => (
            <tr class={l.kind === '+' ? 'ln a' : l.kind === '-' ? 'ln d' : 'ln'}>
              <td class="code">{l.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.lines.length > shown.length && <span class="note">…and {s.lines.length - shown.length} more lines</span>}
    </div>
  );
}

// "Since your last review": new commits, my threads with replies, code changed under my threads, my threads
// resolved. Each count jumps to the first one (or shows just the new commits).
function SinceSummary(p: { me: string; threads: Thread[]; lastReviewAt: string; newCommits: number | null; sinceComment: Map<string, SinceComment>; onCommits: () => void }) {
  const mine = p.me ? p.threads.filter((t) => t.comments.nodes.some((c) => c.author?.login === p.me)) : [];
  const replied = mine.filter((t) => !t.isResolved && t.comments.nodes.some((c) => c.author?.login !== p.me && c.createdAt > p.lastReviewAt));
  const changed = mine.filter((t) => p.sinceComment.get(t.id)?.kind === 'changed');
  const resolved = mine.filter((t) => t.isResolved);
  const go = (t: Thread) => jumpTo('t-' + t.id, 'f-' + t.path);
  const n = (k: number, one: string, many = one + 's') => `${k} ${k === 1 ? one : many}`;
  const parts = [
    p.newCommits ? <button class="link" onClick={p.onCommits}>{n(p.newCommits, 'new commit')}</button> : null,
    replied.length ? <button class="link" onClick={() => go(replied[0])}>{n(replied.length, 'thread')} with new replies</button> : null,
    changed.length ? <button class="link" onClick={() => go(changed[0])}>code changed under {n(changed.length, 'thread')} of yours</button> : null,
    resolved.length ? <span>{resolved.length} of your {n(mine.length, 'thread')} resolved</span> : null,
  ].filter(Boolean);
  if (!parts.length) return <span class="since-sum">New commits since your last review.</span>;
  return (
    <span class="since-sum">
      Since your last review: {parts.map((x, i) => (i ? [' · ', x] : x))}
    </span>
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
function Ticket({ id, lang }: { id: string; lang?: string }) {
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
      {html ? <div class="md" data-lang={lang ?? ''} dangerouslySetInnerHTML={{ __html: html }} /> : <p class="note">No description.</p>}
    </details>
  );
}

// "✳": hand this PR or comment to Claude Code: a new session with the prompt filled in (in the repo's folder, if set
// in Settings), or an earlier session with the prompt copied to paste (that link can't carry a prompt): the last one, or,
// with Settings → Claude Code → "Find sessions per PR", the ones started on this PR.
function ClaudeMenu({ prompt, repo, prUrl, label }: { prompt: string; repo: string; prUrl: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [findSessions] = useStoredFlag('claudeSessions', true);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  useEffect(() => {
    if (open && findSessions) getClaudeSessions().then((all) => setSessions(all.filter((s) => s.prs.includes(prUrl))), () => setSessions([]));
  }, [open, findSessions, prUrl]);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    addEventListener('mousedown', close);
    return () => removeEventListener('mousedown', close);
  }, [open]);
  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(''), 4000);
  };
  return (
    <span class="claude-menu" ref={box}>
      <button class={label ? 'claude-btn' : 'copy-link'} title={label ? 'Send this PR to Claude Code' : 'Send this comment to Claude Code'} onClick={() => setOpen(!open)}>
        ✳{label ? ` ${label}` : ''}
      </button>
      {open && (
        <span class="claude-pop" role="menu">
          {label && (
            <button role="menuitem" title="Claude reads the diff and summarizes it above the files" onClick={() => (setOpen(false), dispatchEvent(new Event('lgtm:walkthrough')))}>
              Walkthrough of this PR, here
            </button>
          )}
          <button role="menuitem" onClick={() => (setOpen(false), void openClaude(claudeNewLink(prompt, claudeFolder(repo))))}>
            New Claude Code session
          </button>
          {[...sessions.map((s) => ({ key: s.id, link: claudeContinueLink(s.id), text: `Continue “${s.title || 'Untitled'}” · ${ago(s.lastActivityAt)}` })), { key: 'last', link: CLAUDE_CONTINUE, text: 'Continue last session' }].map((o) => (
            <button
              key={o.key}
              role="menuitem"
              title="Opens the session; the prompt is copied to paste"
              onClick={async () => {
                setOpen(false);
                await navigator.clipboard.writeText(prompt).catch(() => {});
                void openClaude(o.link);
                flash('Prompt copied: paste it in the session (⌘V)');
              }}
            >
              {o.text}
            </button>
          ))}
        </span>
      )}
      {note && <span class="claude-note">{note}</span>}
    </span>
  );
}

// "✳ Claude → Walkthrough": Claude Code's summary of the PR, above the files. Kept per PR with the commit it read;
// file paths in it jump to the file.
type WalkthroughSaved = { sha: string; text: string; html: string };
function Walkthrough({ pr, repo, files }: { pr: PR; repo: string; files: File[] }) {
  const key = `walkthrough:${repo}#${pr.number}`;
  const read = (): WalkthroughSaved | null => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  };
  const [saved, setSaved] = useState(read);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      const text = await claudeWalkthrough(walkthroughPrompt(pr, files));
      const next = { sha: pr.head.sha, text, html: await renderGfm(text, repo) }; // GitHub sanitizes the HTML
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      setSaved(next);
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };
  useEffect(() => {
    const go = () => void run();
    addEventListener('lgtm:walkthrough', go);
    return () => removeEventListener('lgtm:walkthrough', go);
  }, [pr.head.sha, files]);
  // A path in backticks that names a file in this PR (in full, or by an unambiguous end) jumps to it.
  const fileFor = (t: string) => {
    const exact = files.find((f) => f.filename === t);
    const ends = files.filter((f) => f.filename.endsWith('/' + t));
    return exact ?? (ends.length === 1 ? ends[0] : undefined);
  };
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const c of body.current?.querySelectorAll('code') ?? []) if (fileFor(c.textContent ?? '')) c.classList.add('wt-file');
  }, [saved, files]);
  if (!saved && !busy && !err) return null;
  return (
    <details class="walkthrough" open>
      <summary>
        ✳ Walkthrough by Claude
        {saved && saved.sha !== pr.head.sha && <span class="pill p-warn">written before the latest commits</span>}
        <button disabled={busy} onClick={(e) => (e.preventDefault(), void run())}>{busy ? 'Claude is reading the diff…' : 'Write again'}</button>
        <button title="Remove" onClick={(e) => (e.preventDefault(), localStorage.removeItem(key), setSaved(null), setErr(''))}>✕</button>
      </summary>
      {err && (
        <p class="error">
          Couldn't get a walkthrough: {err}
          {/authenticat|oauth|log ?in/i.test(err) && <> Sign Claude Code in again: run <code>claude</code> in Terminal, then <code>/login</code>.</>}
        </p>
      )}
      {saved && (
        <div
          ref={body}
          class="md"
          dangerouslySetInnerHTML={{ __html: saved.html }}
          onClick={(e) => {
            const f = (e.target as Element).closest('code.wt-file') && fileFor((e.target as Element).textContent ?? '');
            if (f) document.getElementById('f-' + f.filename)?.scrollIntoView();
          }}
        />
      )}
    </details>
  );
}

// Select code in a file, then "✳ Ask Claude": a question about it, answered by the claude CLI (as the walkthrough)
// with the file, its diff in this PR and the selection.
function AskClaude({ pr, repo, headRepo, files }: { pr: PR; repo: string; headRepo: string; files: File[] }) {
  const [sel, setSel] = useState<{ path: string; text: string; x: number; y: number } | null>(null);
  const [panel, setPanel] = useState<{ path: string; text: string } | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ html?: string; error?: string } | null>(null);
  useEffect(() => {
    const up = () =>
      setTimeout(() => {
        const s = getSelection();
        // The selection's text keeps line breaks between rows; a range's raw text is the fallback where the page isn't laid out.
        const text = (s?.toString() || (s?.rangeCount ? s.getRangeAt(0).toString() : '')).trim();
        const n = s?.anchorNode;
        const el = n && (n.nodeType === 1 ? (n as Element) : n.parentElement);
        const file = el?.closest('main > .file');
        if (!s || !text || !file || el!.closest('.editor, .notes, .note-host')) return setSel(null);
        const r = s.getRangeAt(0).getBoundingClientRect();
        setSel({ path: file.id.slice(2), text: text.slice(0, 4000), x: Math.min(r.right, innerWidth - 140), y: r.bottom + 4 });
      });
    const away = () => setSel(null);
    addEventListener('mouseup', up);
    addEventListener('scroll', away, { passive: true });
    return () => (removeEventListener('mouseup', up), removeEventListener('scroll', away));
  }, []);
  const ask = async () => {
    if (!panel || !q.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const f = files.find((f) => f.filename === panel.path);
      const source = f?.status === 'removed' ? null : await getRaw(headRepo, panel.path, pr.head.sha).catch(() => null);
      const text = await claudeWalkthrough(askPrompt(pr, panel.path, f?.patch, source, panel.text, q.trim()));
      setAnswer({ html: await renderGfm(text, repo) }); // GitHub sanitizes the HTML
    } catch (e: any) {
      setAnswer({ error: e.message });
    }
    setBusy(false);
  };
  return (
    <>
      {sel && !panel && (
        <button
          class="ask-btn primary"
          style={{ left: sel.x, top: sel.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (setPanel({ path: sel.path, text: sel.text }), setSel(null), setQ(''), setAnswer(null))}
        >
          ✳ Ask Claude
        </button>
      )}
      {panel && (
        <div class="ask-panel" role="dialog" aria-label="Ask Claude">
          <div class="row">
            <b>Ask Claude about {panel.path.split('/').pop()}</b>
            <span class="spacer" />
            <button title="Close" onClick={() => setPanel(null)}>✕</button>
          </div>
          <pre class="ask-sel">{panel.text}</pre>
          <textarea
            rows={2}
            autoFocus
            placeholder="Your question · ↵ to ask"
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), void ask());
              else if (e.key === 'Escape') setPanel(null);
            }}
          />
          <button class="primary" disabled={busy || !q.trim()} onClick={ask}>{busy ? 'Claude is reading…' : 'Ask'}</button>
          {answer?.error && (
            <p class="error">
              {answer.error}
              {/authenticat|oauth|log ?in/i.test(answer.error) && <> Sign Claude Code in again: run <code>claude</code> in Terminal, then <code>/login</code>.</>}
            </p>
          )}
          {answer?.html && <div class="md ask-answer" dangerouslySetInnerHTML={{ __html: answer.html }} />}
        </div>
      )}
    </>
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

const botExcerpt = (html: string, max = 100) => (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function Conversation({ pr, items, lang, repo, me }: { pr: PR; items: ConversationItem[]; lang?: string; repo: string; me: string }) {
  const foldBots = useFoldBots(!!me && pr.user.login === me);
  return (
    <details class="conversation" id="conversation" open>
      <summary>
        Conversation <span class="badge">· {items.length} comment{items.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="comment" id="pr-description">
        <b>{pr.user.login}</b> <span class="badge">opened this pull request</span> <CopyLink url={pr.html_url} />
        {pr.body_html ? <div class="md" data-lang={lang ?? ''} dangerouslySetInnerHTML={{ __html: pr.body_html }} /> : <p class="note">No description.</p>}
      </div>
      {items.map((c) => {
        const head = (
          <>
            <b>{c.author}</b> {c.state && <span class={'rstate r-' + c.state}>{STATE_LABEL[c.state] ?? c.state}</span>}{' '}
            <a href={c.url} target="_blank" rel="noopener"><time>{new Date(c.at).toLocaleString()}</time></a> <CopyLink url={c.url} />
            {c.html && <ClaudeMenu repo={repo} prUrl={pr.html_url} prompt={commentPrompt({ author: c.author, text: botExcerpt(c.html, 4000), url: c.url }, { repo, number: pr.number, prUrl: pr.html_url })} />}
          </>
        );
        const body = c.html && <div class="md" data-lang={lang ?? ''} dangerouslySetInnerHTML={{ __html: c.html }} />;
        // Bot reports (CI summaries, AI reviewers, coverage) fold to one line; click to read.
        return c.bot && foldBots ? (
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

function Help({ onClose, ignoreWs, toggleWs }: { onClose: () => void; ignoreWs: boolean; toggleWs: () => void }) {
  const [bindings] = useBindings();
  return (
    <div class="help" role="dialog" aria-label="Keyboard shortcuts">
      <div class="row">
        <b>Keyboard shortcuts</b>
        <span class="spacer" />
        <label>
          <input type="checkbox" checked={ignoreWs} onChange={toggleWs} /> Ignore whitespace
        </label>
        <button onClick={onClose}>Close</button>
      </div>
      <table>
        <tbody>
          {[...ACTIONS.map(([a, d]) => [keyLabel(bindings[a]), d]), ...FIXED].map(([k, d]) => (
            <tr key={d}>
              <td><kbd>{k}</kbd></td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="note">Change them in ⚙ Settings → Keyboard shortcuts.</p>
    </div>
  );
}
