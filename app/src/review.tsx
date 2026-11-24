import { render, type ComponentChildren, type VNode } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { findSecrets, type Secret } from './secrets.ts';
import { depChanges, type DepChange } from './deps.ts';
import { findHardcoded, type Hardcoded } from './hardcoded.ts';
import { roomCheck, type SchemaChange } from './room.ts';
import { focused, lockfileDrift, rawHtml, type WebHit } from './web.ts';
import { protectionsOff, switchedOff } from './switchedoff.ts';
import { entityWithoutMigration, isMigration, migrationIssues, privateTransactional, type MigrationIssue } from './spring.ts';
import { isManifest, isRisky, manifestChanges, type ManifestChanges } from './manifest.ts';
import { baselineChanges, isLintBaseline, type Suppression } from './lintbaseline.ts';
import { addedLines, interdiff, hiddenChanges, moveRuns, wholeFromPatch, type MoveRun, relocate, commonIndent, dedentHtml, anchor, changePairs, gaps, markText, rangeChange, ignoreWhitespace, trimContext, importFolds, importsOnly, importSyntax, movedLines, ownRoot, parsePatch, removedRuns, wordChange, type Gap, type Hunk, type Line, type Moved, type Removed, alignChanges } from './diff.ts';
import { inLfs, isGenerated, parseGeneratedRules } from './gitattributes.ts';
import {
  getChecks, baseChecks, onBaseOf, getStatus, getCompare, requestReview, unrequestReview, ownersToAsk, siteBusy, signRelativeImages, signRepoImages, suggestReviewers, whoWrote, type ReviewerPick, unnamedGroup, getBlobInfo, getConversation, slackRecipients, getEmojis, getFiles, getMyLastReview, getPR, getRaw, listDir, getDownloadUrl, getStack, getThreads, getViewed, getViewer,
  awaitsMe, commitSuggestions, getBuildRoots, getHead, getActivity, editPosted, deletePosted, getPushPoints, prCommits, revertCommit, loadPR, updatePR, type PushPoint, markReady, type LoadedPR, markBots, renderGfm, reply, resolveThread, setViewed, submitReview, suggestionOf, type Suggestion,
  discardReview, deleteReviewComment, editReviewComment, getPendingReview, type PendingReview, type Check, type PRFile, type StackLayer, type ConversationItem, type Draft, type PR, type ReviewEvent, type Thread,
  ticketPRs, earlierVerdicts, agentSays, repeatedFindings, type Repeat, type TicketPR, blobWebUrl, parsePrUrl, prWebUrl, site, isLab, numRef, revertPR, revertOf, revertGaps, revertedBy, prRights, reopenPR, convertToDraft, closeWithReason, restoreBranch, deleteBranch, type PrRights, postAgentFindings, updateBranchAndWait, searchBranches, changeBase, takeReview, fixedIn, myOwnedFiles, type Fix, type Comment as GhComment } from './github.ts';
import { highlightBlocks, highlightCode, highlightHunks, languageFor, majorityLanguage, splitLines } from './highlight.ts';
import { loadLanguages } from './languages.ts';
import { isMarkdown, md, onDocClick, renderChunks, tidyDoc, toggleTask } from './markdown.ts';
import { CommentMenu, ReactPick, Reactions, editUnderMouse, loadSocial, menuUnderMouse, reactUnderMouse, useSocial } from './social.tsx';
import { renderMermaid } from './mermaid.ts';
import { Editor, setCodeNames } from './editor.tsx';
import { MergeBox, mergeOnceApproved } from './merge.tsx';
import { StackNav } from './stacknav.tsx';
import { AgentMark, CheckMark, DECISION, Octicon, Tg, Who, Time, Lines, num, CopyCode, Retry, ThreadCode, CodeSnippet } from './tags.tsx';
import { ACTIONS, FIXED, hint, keyLabel, readBindings, useBindings, type Action } from './keys.ts';
import { claudeContinueLink, claudeNewLink, askPrompt, ciPrompt, fixPrompt, reindent, prAskPrompt, reviewDonePrompt, commentPrompt, prPrompt } from './prompts.ts';
import { vectorToSvg } from './vector.ts';
import { mdStyleProps, useMdStyle } from './mdthemes.ts';
import { fillSlack, firstParagraph, isAway, lateFor, prValues, QA_CHANNEL, slackTemplate, type SlackKind } from './slackmsg.ts';
import { EmojiTextarea, SlackPreview, StatusMark, useSlackEmoji } from './emojibox.tsx';
import { docBlocks, docParts, docSyntax, editedDocBlocks, lineCommentBlocks, lineCommentSyntax, testPhase, type DocBlock } from './docs.ts';
import { isArchivedSpec, deletedTests, inTests, moduleLabel, moduleName, modulesOf, moduleView, PLAN_AT, reviewOrder, reviewPlan, stepIcon, stepOrder, untested, type BuildRoot, type PlanStep, fileLabel, knowFiles } from './files.ts';
import { closeOnBackdrop, composing, dropNotices, markDoneOnSlack, notifyAgentDone, noteReadSaved, getSlackPeople, slackFindsByEmail, rememberPR, agentMod, MOD_INSTALL, qaSeen, qaThreads, seeQa, type QaThread, fetchIntegrations, postSlack, SLACK_CHANNEL, slackPresence, type SlackPresence, reportError, ask, askText, slackRequest, type SlackRequest, ticketsToReview, againInThread, askFor, slackReply, slackSentTo, closeTold, closedOnSlack, ticketsToQa, copyText, own, useStoredValue, mapOnSlack, rememberPeople, ago, backToSession, claudeSessionState, linkNewClaude, seenClaudePR, unlinkSession, type SessionState, linkedSession, prCache, claudeFolder, agentSkill, openExternal, isDesktop, fetchJira, useFoldBots, slackEscape, getClaudeSessions, type ClaudeSession, notifySlack, openAppLink, slackStatus, storage, useBots, useStoredFlag, type JiraIssue, type SlackThread, type SlackSent, slackDelete, useDismiss, repoLabel, offerUndo, useMedia, faceOf, personKey, pageTerm, shownName, shownAt, WHY_CLOSE, lookedDrafts, markLooked } from './platform.ts';
import { adfToMarkdown, jiraKeys, knowJiraKeys } from './jira.ts';
import { changedRange, changedStrings, isLocaleDir, isStringsXml, parseString, stringHtml, stringsOf, translationNotes } from './strings.ts';
import { agentRunOf, reviewNow } from './agentreview.ts';
import { openAgentSession, AGENTS, askAgent, autoAgent, detectAgents, setAskAgent, runAgent, useAgents, type AgentId } from './agents.ts';
import { checkThreads, savedCheck, type ThreadCheck, type Verdict } from './threadcheck.ts';
import { toPerson } from './person.tsx';
import { SymbolNav } from './symbolnav.tsx';
import { codeIndex, docSnippet, isDoc, peekLines, refTo, specRefs, type CodeIndex, type SpecRef } from './specrefs.ts';
import { createPortal } from 'preact/compat';
import { Resizer } from './resizer.tsx';
import { OnBase, below, firstBox, jumpTo, noteJump, ModuleIcon, FileIcon, ShortcutIndex, threadOrder, type File, FileName } from './shortcuts.tsx';

type Side = 'LEFT' | 'RIGHT';
// Where the (single) open comment form is. No line = file-level; editId = the draft being edited;
// atEnd = a file-level comment started from the file's footer, so its form opens there.
type Target = { path: string; side: Side; line?: number; startLine?: number; editId?: string; body?: string; atEnd?: boolean; at?: { line: number; startLine?: number } }; // at: where a comment on a commit's lines goes in all changes
type Ctx = {
  pr: PR;
  headRepo: string;
  target: Target | null;
  setTarget: (t: Target | null) => void;
  suggest: (path: string, line: number | undefined, body: string, side?: Side) => void; // a comment form, written for me, on a finding
  addDraft: (d: Omit<Draft, 'id'>) => void;
  postNow: (d: Omit<Draft, 'id'>) => Promise<void>; // a comment out at once, not kept for Finish review
  updateDraft: (id: string, d: Omit<Draft, 'id'>) => void;
  removeDraft: (id: string) => void;
  reply: (t: Thread, body: string) => Promise<void>;
  resolve: (t: Thread, resolve: boolean) => Promise<void>;
  renderAll: boolean; // set by ⌘F so the browser's find can see every file
  repo: string;
  mentions: string[]; // people on this PR, for @-completion
  suggestion: (t: Target) => string | null; // the target's lines, for a ```suggestion block
  files: File[]; // the PR's files, for an agent's fix (their diffs)
  checked: Record<string, Verdict>; // an agent's word on whether my threads were addressed (threadcheck.ts)
  checkBy?: AgentId;
  pending: boolean; // a review of mine is open on GitHub: comments join it, none post on their own
  editPending: (id: string, body: string | null) => Promise<void>; // one of its comments changed, or (null) deleted
  restorePending: (d: Draft) => Promise<void>; // a dropped one put back (its Undo)
  dropPending: (ids: string[]) => Promise<void>; // several of its comments deleted at once (Your threads: the outdated ones)
  since: boolean; // showing only changes since my last review: old-side lines aren't the PR's base, so no LEFT comments
  me: string; // my login ('' until known)
  ignoreWs: boolean; // hide whitespace-only changes
  langFor: (path?: string) => string | undefined; // the language an unmarked code block in a comment on `path` is read as
  mainLang?: string; // the PR's main code language
  moved: Map<string, Moved>; // code moved without changes, per file
  repeats: Map<string, Repeat>; // 🤖 findings posted again: thread → the first (github.ts repeatedFindings)
  untested: Set<string>; // code files whose tests the PR doesn't touch (Settings switch)
  modules?: Map<string, string>; // each file's Gradle module, when shown (Settings → Reviewing)
  sinceComment: Map<string, SinceComment>; // my open threads, against the code now
  batch: Suggestion[]; // suggestions picked to commit together
  toggleBatch?: (s: Suggestion) => void; // unset where I can't commit suggestions (not my PR)
  applySuggestions: (list: Suggestion[]) => Promise<void>;
  codeIx: CodeIndex; // the PR's changed code files and what they declare, for specs naming them (specrefs.ts)
  specRefs: Map<string, SpecRef[]>; // where the specs name each changed file
  secrets: Map<string, Map<number, string>>; // added lines that look like a secret, per file: line → what (secrets.ts)
  hardcoded: Map<string, Map<number, string>>; // added UI text written in code, not strings.xml: line → the text (hardcoded.ts)
  flagged: Map<string, Map<number, { bad: boolean; why: string }>>; // other line findings (switched off, protections, focused tests, raw HTML, @Transactional): line → its colour and reason
};
type SinceComment = { kind: 'same' | 'gone' | 'unknown' } | { kind: 'changed'; lines: Line[] };
type Saved = { sha: string; drafts: Draft[] };
// My last visit to a PR: each file's blob then, and where I was reading (file + how far into it).
type Visit = { files: Record<string, string>; at: { path: string; y: number } | null; seenAt?: number };


// The note to the author and assignees after a review (Settings → Slack → Messages).
// places: the files my comments in this review are on (else my open threads'), for "3 comments on A.kt, B.kt".
function slackText(pr: PR, repo: string, n: number, event: ReviewEvent, body: string, places: string[]) {
  const files = [...new Set(places.map(base))];
  const on = files.length ? ` on ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}` : '';
  const comments = places.length;
  // :approved: and :request-changes: are the workspace's custom Slack emoji.
  const verdict = { APPROVE: ':approved: Approved', REQUEST_CHANGES: ':request-changes: Requested changes on', COMMENT: '💬 Reviewed' }[event];
  return fillSlack(slackTemplate('review'), {
    ...prValues({ repo, number: n, title: pr.title, url: pr.html_url, author: pr.user.login }),
    verdict,
    comments: comments ? ` · ${comments} comment${comments > 1 ? 's' : ''}${on}` : '',
    note: body.trim() ? slackEscape(body.trim().slice(0, 1000)).replace(/^/gm, '>') : '',
  });
}

// Mark generated and content-free files (in GitHub's order: the reading order is the view's, by its switch).
// Binary and too-large files also come without a patch but did change, so only renames/copies/mode changes count.
const prepare = (files: PRFile[], rules: ReturnType<typeof parseGeneratedRules>): File[] => {
  return files
    .map((f) => ({
      ...f,
      generated: isGenerated(rules, f.filename),
      lfs: inLfs(rules, f.filename),
      // Nothing in it changed: renamed, copied or mode-changed as it was, or an empty text file added or deleted (GitHub
      // gives that no diff, as it does a binary one: its type tells them apart).
      noDiff: !f.additions && !f.deletions && (['renamed', 'copied', 'changed'].includes(f.status) || (!f.patch && ['added', 'removed'].includes(f.status) && !!languageFor(f.filename))),
    }));
};

const isFileLevel = (t: Thread) => t.subjectType === 'FILE' || t.line == null;

type Notice = { text: string; ok: boolean };
// Reviews on their way to GitHub after you moved on (submit): opening one again meanwhile waits for it, not sending twice.
const sending = new Map<string, Promise<unknown>>();
// Comments on their way into my pending review on the site, one after another (it keeps one pending review a person:
// two added at once would each start one). By PR.
const toPendingChain = new Map<string, Promise<unknown>>();
// onReviewed: the review is in and the user chose to move on (with the Slack result, if any, to show next).

// On my own PR (Settings → Slack → "A button to ask QA"): the QA request, filled in from the PR and yours to edit, then
// posted to the QA channel. Once posted it's one of the PR's Slack threads (login "#qa"), beside the title, and the
// button goes. kind 'channel': the review request in the review channel instead (Settings → Slack), naming each reviewer
// asked on the PR (so it's someone's, not the channel's); it needs some.
let jiraSite: Promise<string | undefined> | undefined;
// inMenu: no button of its own; the ⋯ menu (or q) opens it (lgtm:ask-qa).
function AskQA({ pr, repo, n, onPosted, kind = 'qa', inMenu }: { pr: PR; repo: string; n: number; onPosted: () => void; kind?: Extract<SlackKind, 'qa' | 'channel'>; inMenu?: boolean }) {
  const review = kind === 'channel';
  const [channel] = useStoredValue(review ? 'reviewChannel' : 'qaChannel', review ? '' : QA_CHANNEL);
  const reviewers = (pr.requested_reviewers ?? []).map((u) => u.login);
  const [unmatched, setUnmatched] = useState<string[]>([]); // named, but lgtm can't tag them
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false); // the Slack markup itself, else the message as Slack shows it
  const { emoji } = useSlackEmoji();
  const box = useRef<HTMLDialogElement>(null);
  useEffect(() => void (text != null && !box.current?.open && (box.current?.showModal(), closeOnBackdrop(box.current))), [text]);
  const open = async () => {
    // The Jira site, for the ticket's link: asked once, and not waited on past a moment (its check can be slow).
    jiraSite ??= fetchIntegrations().then((i) => i.jira.site, () => undefined);
    const site = await Promise.race([jiraSite, new Promise<undefined>((r) => setTimeout(r, 1500))]);
    const keys = jiraKeys(pr.title, pr.head.ref);
    const jira = keys.length ? ` (Jira: ${keys.map((k) => (site ? `<https://${site}/browse/${k}|${k}>` : k)).join(', ')})` : '';
    setErr('');
    setEditing(false);
    if (review) getSlackPeople().then((p) => setUnmatched(reviewers.filter((l) => !p.mine[l])), () => {});
    setText(fillSlack(slackTemplate(kind), { ...prValues({ repo, number: n, title: pr.title, url: pr.html_url, author: pr.user.login }), jira, description: slackEscape(firstParagraph(pr.body)), reviewers: reviewers.map((l) => `<@gh:${l}>`).join(' ') }));
  };
  const close = () => (box.current?.close(), setText(null));
  const send = () => {
    if (!text?.trim()) return;
    setBusy(true);
    postSlack(channel, text, `${repo}#${n}`, review ? 'review' : undefined).then(
      () => (close(), onPosted(), review || void ticketsToQa(jiraKeys(pr.title, pr.head.ref))),
      (e) => setErr(e.message),
    ).finally(() => setBusy(false));
  };
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!inMenu) return;
    const show = () => openRef.current();
    addEventListener('lgtm:ask-qa', show);
    return () => removeEventListener('lgtm:ask-qa', show);
  }, [inMenu]);
  return (
    <>
      {inMenu ? null : review ? (
        <button disabled={!reviewers.length} title={reviewers.length ? `Post a review request for this ${pageTerm().PR} to ${channel || 'your review channel'} on Slack, naming ${reviewers.map((l) => '@' + l).join(', ')} (you see it first)` : 'Ask reviewers first: the post names each of them'} onClick={open}>
          Ask in channel
        </button>
      ) : (
        <button title={`Post a QA request for this ${pageTerm().PR} to ${channel} on Slack (you see it first)`} onClick={open}>
          Ask QA
        </button>
      )}
      {text != null && (
        <dialog ref={box} class="ask qa-dialog" aria-label={review ? 'Ask for review' : 'Ask QA'} onClose={() => setText(null)}>
          <p>
            <b>{review ? 'Ask for review' : 'Ask QA'}</b> in <code>{channel || 'no channel yet'}</code>
          </p>
          {editing ? (
            <textarea rows={12} value={text} onInput={(e) => setText(e.currentTarget.value)} disabled={busy} />
          ) : (
            <SlackPreview message={text} emoji={emoji} />
          )}
          {!SLACK_CHANNEL.test(channel) && <p class="warn">The {review ? 'review' : 'QA'} channel in Settings isn't a channel ID, #name or link.</p>}
          {review && unmatched.length > 0 && <p class="warn">Not matched on Slack, so named but not tagged: {unmatched.map((l) => '@' + l).join(', ')}. Match them in Settings → Slack → People.</p>}
          {err && <p class="warn">{err}</p>}
          <form method="dialog" onSubmit={(e) => e.preventDefault()}>
            <button type="button" class="link qa-edit" onClick={() => setEditing(!editing)} disabled={busy}>
              {editing ? 'Preview' : 'Edit'}
            </button>
            <button type="button" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" class="primary" onClick={send} disabled={busy || !text.trim() || !SLACK_CHANNEL.test(channel)}>
              {busy ? 'Posting…' : 'Post to Slack'}
            </button>
          </form>
        </dialog>
      )}
    </>
  );
}

// On my own PR, in the index's Reviewers: who to ask (this repo's recent reviewers, else the PR list's team), least
// busy first. A click asks them on GitHub and, unless unticked, on Slack too.
// On a draft, asking someone first marks it ready for review (GitHub doesn't tell reviewers about drafts).
type Finding = { text: string; go: () => void };
// What became of the Slack message when a review request was taken back (platform.ts slackDelete), as the end of a sentence.
const slackGone = (r: { ok: boolean; error?: string; edited?: boolean; followedUp?: boolean }, had: boolean) =>
  !had ? '.' : !r.ok ? `. The Slack message is still there: ${r.error}.` : r.followedUp ? `. Your Slack workspace allows neither deleting nor editing messages, so lgtm replied under it that the review isn't needed anymore.` : r.edited ? `. Your Slack workspace doesn't allow deleting messages, so the Slack message now just says "-".` : ', and deleted its Slack message.';

function AskReviewer({ pr, repo, n, skip, slackOk, onAsked, findings = [], files = [] }: { pr: PR; repo: string; n: number; skip: Set<string>; slackOk: boolean; onAsked: (text: string, ok: boolean, asked?: string) => void; findings?: Finding[]; files?: PRFile[] }) {
  // What lgtm found in my PR, shown once before the first ask: reviewers needn't point out the obvious.
  const [held, setHeld] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const draft = useRef(pr.draft);
  const emoji = useSlackEmoji(); // suggested as you type the message
  const [team] = useStoredValue('team', '');
  const [picks, setPicks] = useState<ReviewerPick[] | null>(null);
  const [err, setErr] = useState('');
  const [slack, setSlack] = useState(true);
  const [text, setText] = useState(() => slackTemplate('ask'));
  // Each person on their own: asking one doesn't hold up the others, and ones asked stay marked.
  const [state, setState] = useState<Record<string, 'asking' | 'asked'>>({});
  const mark = (login: string, s?: 'asking' | 'asked') => setState((m) => ({ ...m, [login]: s! }));
  // Who wrote the code being changed (git blame) goes first; then the least busy of those who review here.
  useEffect(
    () =>
      void whoWrote(repo, pr.base.sha, files)
        .catch(() => [])
        .then((knows) => suggestReviewers(repo, skip, team, knows))
        .then(setPicks, (e) => setErr(e.message)),
    [team],
  );
  // Their Slack statuses: someone out sick, on vacation or leave shows it, and goes to the bottom (still askable).
  const [presence, setPresence] = useState<Record<string, SlackPresence>>({});
  const shownPicks = picks?.slice(0, 6).map((p) => p.login).join() ?? '';
  useEffect(() => void (slackOk && shownPicks && slackPresence(shownPicks.split(',')).then(setPresence, () => {})), [shownPicks, slackOk]);
  // When it ends: a time today, else the day.
  const until = (s: SlackPresence) => {
    if (!s.until) return '';
    const d = new Date(s.until * 1000);
    return ` · until ${d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}`;
  };
  const askThem = async (login: string) => {
    mark(login, 'asking');
    setErr('');
    try {
      if (draft.current) {
        await markReady(pr.node_id);
        draft.current = false;
        dispatchEvent(new Event('lgtm:refresh'));
      }
      await requestReview(repo, n, login);
      void ticketsToReview(jiraKeys(pr.title, pr.head.ref));
    } catch (e: any) {
      mark(login);
      return setErr(`Couldn't ask @${login} on ${site(repo)}: ${e.message}`);
    }
    mark(login, 'asked');
    onAsked(`Asked @${login} for a review.`, true, login); // the index lists them at once, then the PR reloads
    // A wrong row clicked: Undo takes the request back, and the Slack message with it.
    const undo = (sent?: SlackSent | null) =>
      offerUndo(`Asked ${shownAt(login, repo)} to review`, async () => {
        try {
          await unrequestReview(repo, n, login);
          const r: { ok: boolean; error?: string; edited?: boolean; followedUp?: boolean } = sent ? await slackDelete(`${repo}#${n}`, login, sent).catch((e: Error) => ({ ok: false, error: e.message })) : { ok: true };
          mark(login);
          onAsked(`Took back the review request for @${login}${slackGone(r, !!sent)}`, r.ok);
          dispatchEvent(new Event('lgtm:refresh'));
        } catch (e: any) {
          onAsked(`Couldn't take back the request for @${login}: ${e.message}`, false);
        }
      });
    if (!(slack && slackOk)) return onAsked(`Asked @${login} for a review.`, true), undo();
    try {
      const message = fillSlack(text, prValues({ repo, number: n, title: pr.title, url: pr.html_url, author: pr.user.login }));
      const [r] = await notifySlack(await slackRecipients(repo, [login]), message, `${repo}#${n}`);
      onAsked(r?.ok ? `Asked @${login} for a review, on ${site(repo)} and Slack.` : `Asked @${login} on ${site(repo)}; Slack didn't reach them (${r?.error ?? 'no reply'}).`, !!r?.ok);
      undo(r?.sent);
    } catch (e: any) {
      onAsked(`Asked @${login} on ${site(repo)}; Slack failed (${e.message}).`, false);
      undo();
    }
  };
  return (
    <div class="ix-ask">
      {err && <p class="warn ix-pad">{err}</p>}
      {held && (
        <div class="preflight ix-pad">
          <p>
            <b>Before asking @{held}</b>, lgtm found in this PR:
          </p>
          <ul>
            {findings.map((f) => (
              <li>
                <button class="link" onClick={f.go}>{f.text}</button>
              </li>
            ))}
          </ul>
          <div class="row">
            <button onClick={() => setHeld(null)}>Fix first</button>
            <button class="primary" onClick={() => (setCleared(true), setHeld(null), void askThem(held))}>Ask anyway</button>
          </div>
        </div>
      )}
      {picks == null && !err && <p class="note ix-pad">Finding who's free…</p>}
      {picks?.length === 0 && <p class="note ix-pad">No one to suggest: nobody else has reviewed here lately{team ? `, and ${team} has no one else` : ''}.</p>}
      {picks
        ?.slice(0, 6)
        .map((p) => ({ p, s: presence[p.login], away: !!p.busy || isAway(presence[p.login]), late: lateFor(presence[p.login]) }))
        .sort((a, b) => +a.away - +b.away || +!!a.late - +!!b.late)
        .slice(0, 5)
        .map(({ p, s, away, late }) => (
          <button
            class={`ix-item ix-person ${state[p.login] ?? ''}${away ? ' away' : ''}`}
            disabled={!!state[p.login]}
            title={`Ask @${p.login} to review: ${p.why}; ${p.load} open ${pageTerm().PR}${p.load === 1 ? '' : 's'} already waiting on their review${p.busy ? `. Busy on ${site(repo)}: ${p.busy}` : ''}${s?.text ? `. Slack: ${s.text}${until(s)}` : ''}${late ? `. It's ${late}` : ''}`}
            onClick={async () => {
              // Away, busy or late where they are: asked first (a click on the wrong row shouldn't ask them).
              const who = shownAt(p.login, repo);
              const why = [p.busy && `${who} is busy on ${site(repo)} (${p.busy}).`, isAway(s) && `${who} is away${s?.text ? `: ${s.text}${until(s)}` : ''}.`, late && `It's ${late} where they are.`].filter(Boolean).join(' ');
              if (why && !(await ask(`${why} Ask them anyway?`, 'Ask anyway'))) return;
              findings.length && !cleared ? setHeld(p.login) : askThem(p.login);
            }}
          >
            <span class="ix-label">
              <img src={faceOf(p.login)} alt="" />{shownAt(p.login, repo)}{' '}
              {state[p.login] ? (
                <span class="ix-meta">{state[p.login] === 'asking' ? 'asking…' : <><Octicon name="check" /> asked</>}</span>
              ) : (
                !away && (p.load ? (
                  <span class="ix-meta ix-load" title={`${p.load} open ${pageTerm().PR}${p.load === 1 ? '' : 's'} already waiting on their review`}><Octicon name="git-pull-request" />{p.load}</span>
                ) : (
                  <span class="ix-meta ix-load free" title={`No open ${pageTerm().PRs} waiting on their review`}><Octicon name="check" /></span>
                ))
              )}
              <StatusMark s={s} late={late} busy={p.busy} />
            </span>
          </button>
        ))}
      {slackOk ? (
        <label class="ix-ask-slack">
          <span>
            <input type="checkbox" checked={slack} onChange={(e) => setSlack(e.currentTarget.checked)} /> Also message them on Slack
          </span>
          {slack && <EmojiTextarea rows={2} value={text} onInput={setText} names={emoji.names} emoji={emoji.emoji} label="Slack message" />}
        </label>
      ) : (
        <p class="note ix-pad">Slack isn't set up, so this only asks on {site(repo)}.</p>
      )}
    </div>
  );
}

// A path's file name, and its folder ('' at the root).
const base = fileLabel; // a file's name as shown: unique among the PR's (files.ts)
const leaf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const dir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
// A file's folder as shown beside its name: without the folders its name (base) already carries.
const rest = (folder: string, p: string) => {
  const shown = dir(base(p));
  return shown && (folder === shown || folder.endsWith('/' + shown)) ? folder.slice(0, folder.length - shown.length).replace(/\/$/, '') : folder;
};

// How many modules the PR touches (or the one); a click lists them, each with its files, and goes to its first.
function ModulesPill({ modules }: { modules?: Map<string, string> }) {
  const by = new Map<string, string[]>();
  for (const [p, m] of modules ?? []) if (m) by.set(m, [...(by.get(m) ?? []), p]);
  if (!by.size) return null;
  const label = moduleLabel;
  const list = [...by].sort(([a], [b]) => label(a).localeCompare(label(b)));
  return (
    <PillMenu label={by.size === 1 ? <Tg i={<ModuleIcon />} n={label(list[0][0])} /> : <Tg i={<ModuleIcon />} n={by.size} t="modules" />} head={`Modules this ${pageTerm().PR} changes:`}>
      {list.map(([m, paths]) => (
        <button onClick={() => jumpTo('f-' + paths[0])} title={m === '.' ? 'The root project' : `In ${m}/`}>
          <b>{label(m)}</b> <small>{paths.length} file{paths.length > 1 ? 's' : ''}</small>
        </button>
      ))}
    </PillMenu>
  );
}

// A pill that says what it counts: a click opens the list behind it (what each item is, in a line on top), each one a
// link or a jump; a click elsewhere, or Esc, closes it.
type StateAct = 'close' | 'closeBranch' | 'draft' | 'reopen' | 'restore' | 'update' | 'ready' | 'base';
function StateActs({ rights, draft, acting, act }: { rights: PrRights; draft: boolean; acting: StateAct | null; act: (a: StateAct) => void }) {
  const b = (a: StateAct, label: string, busy: string, title: string): preact.JSX.Element => <button disabled={!!acting} title={title} onClick={() => act(a)}>{acting === a ? busy : label}</button>;
  const t = pageTerm().PR;
  return (
    <>
      {draft && rights.update && rights.close && b('ready', 'Ready for review', 'Marking…', 'Mark it ready: reviewers are notified')}
      {rights.updateBranch && (rights.rebase ? b('update', 'Rebase', 'Rebasing…', 'Rebase it onto its target branch, which has moved on') : b('update', 'Update branch', 'Updating…', 'Merge its base branch in: it has moved on'))}
      {rights.close && !draft && rights.update && b('draft', 'Convert to draft', 'Converting…', `Keep it open, but not asking for review until it's marked ready`)}
      {rights.close && rights.update && b('base', 'Change base…', 'Changing…', `Point it at another branch: its diff becomes what's not on that one`)}
      {rights.close && b('close', 'Close', 'Closing…', `Close without merging; it can be reopened`)}
      {rights.close && rights.branch && b('closeBranch', 'Close and delete branch', 'Closing…', `Close without merging and delete ${rights.headRefName}, unless another open ${t} builds on it`)}
      {rights.reopen && b('reopen', 'Reopen', 'Reopening…', `Open it again for review`)}
      {rights.restore && b('restore', 'Restore branch and reopen', 'Reopening…', `Its branch ${rights.headRefName} is gone: make it again at the PR's last commit, then reopen`)}
    </>
  );
}

// Change base…: the repo's branches, the latest first, searched as you type (github.ts searchBranches); picking one
// points the PR at it and reloads (its diff is now what that branch doesn't have).
function BaseDialog({ repo, n, base, head, onClose }: { repo: string; n: number; base: string; head: string; onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [list, setList] = useState<string[] | null>(null);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => void (box.current?.showModal(), closeOnBackdrop(box.current)), []);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => searchBranches(repo, q.trim()).then((l) => live && (setList(l.filter((b) => b !== base && b !== head)), setAt(0)), (e) => live && setErr(e.message)), q ? 250 : 0);
    return () => ((live = false), clearTimeout(t));
  }, [q]);
  const pick = (b: string) => {
    setBusy(b);
    setErr('');
    changeBase(repo, n, b).then(
      () => (box.current?.close(), dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `Its base is ${b} now.` } })), dispatchEvent(new Event('lgtm:refresh'))),
      (e) => (setErr(e.message), setBusy('')),
    );
  };
  return (
    <dialog ref={box} class="ask base-dialog" aria-label="Change base" onClose={onClose}>
      <p>
        <b>Change base</b> from <code>{base}</code> to:
      </p>
      <input
        type="search"
        autoFocus
        value={q}
        placeholder="Find a branch…"
        aria-label="Find a branch"
        onInput={(e) => setQ(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (composing(e)) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), setAt((a) => (list?.length ? (a + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length : 0)));
          else if (e.key === 'Enter' && list?.[at] && !busy) (e.preventDefault(), pick(list[at]));
        }}
      />
      <div class="base-list" role="listbox">
        {list == null ? <p class="note">Loading…</p> : !list.length ? <p class="note">No branch matches.</p> : list.map((b, k) => (
          <button role="option" aria-selected={k === at} class={k === at ? 'on' : ''} disabled={!!busy} onMouseEnter={() => setAt(k)} onClick={() => pick(b)} ref={(el) => void (k === at && el?.scrollIntoView({ block: 'nearest' }))}>
            {busy === b ? 'Changing…' : b}
          </button>
        ))}
      </div>
      {err && <p class="warn">{err}</p>}
    </dialog>
  );
}

// The bar's ⋯ (X): StateActs in a menu, its button like Agents'.
function StateMenu({ askQa, rights, ...p }: { rights: PrRights | null; draft: boolean; acting: StateAct | null; act: (a: StateAct) => void; askQa?: boolean }) {
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), '.pr-acts');
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    addEventListener('lgtm:pr-acts', toggle);
    return () => removeEventListener('lgtm:pr-acts', toggle);
  }, []);
  useEffect(() => void (open && pop.current?.querySelector('button')?.focus()), [open]);
  return (
    <span class="agents-menu pr-acts">
      <button class="agents-btn" title={`${askQa ? 'Ask QA, ' : ''}Close, reopen or convert to draft${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').prActions)}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Octicon name="kebab-horizontal" />
      </button>
      {open && (
        <div class="account-menu" role="menu" ref={pop} onClick={(e) => (e.target as Element).closest('button') && setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          {askQa && <button title={`Post a QA request for this ${pageTerm().PR} on Slack (you see it first)${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').askQa)}`} onClick={() => dispatchEvent(new Event('lgtm:ask-qa'))}>Ask QA…</button>}
          {rights && <StateActs rights={rights} {...p} />}
        </div>
      )}
    </span>
  );
}

function PillMenu({ cls = '', label, head, children }: { cls?: string; label: ComponentChildren; head: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Opened near the window's right edge: it opens leftward, from the pill's right end, so none of it is cut off.
  // ponytail: CSS anchor positioning (position-try-fallbacks: flip-inline) does this once Safari 27 is the norm.
  const fit = () => {
    const p = pop.current;
    if (!p || !ref.current?.open) return;
    p.style.left = p.style.right = '';
    if (p.getBoundingClientRect().right > innerWidth - 8) (p.style.left = 'auto'), (p.style.right = '0');
  };
  useEffect(() => {
    const away = (e: Event) => ref.current?.open && !ref.current.contains(e.target as Node) && (ref.current.open = false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && ref.current?.open && (ref.current.open = false);
    addEventListener('pointerdown', away);
    addEventListener('keydown', esc);
    return () => (removeEventListener('pointerdown', away), removeEventListener('keydown', esc));
  }, []);
  return (
    <details
      class="pill-menu"
      ref={ref}
      onToggle={() => ref.current?.open && (fit(), document.querySelectorAll<HTMLDetailsElement>('.pill-menu[open]').forEach((d) => d !== ref.current && (d.open = false)))}
    >
      <summary class={`pill ${cls}`}>
        {label} <span class="caret" aria-hidden="true" />
      </summary>
      <div class="pill-pop" ref={pop} onClick={(e) => (e.target as Element).closest('a, button') && ref.current && (ref.current.open = false)}>
        <p class="pill-head">{head}</p>
        {children}
      </div>
    </details>
  );
}

// A file's Viewed switch as an icon: an eye, a green check once viewed. Still a checkbox underneath (keyboard, screen
// readers), only drawn as the icon.
function ViewedToggle({ viewed, onToggle, title }: { viewed: boolean; onToggle: () => void; title: string }) {
  return (
    <label class={viewed ? 'viewed-box on' : 'viewed-box'} title={title}>
      <input type="checkbox" checked={viewed} onChange={onToggle} aria-label="Viewed" />
      <Octicon name={viewed ? 'check' : 'eye'} />
    </label>
  );
}

// While a PR loads (one never opened before; others show their saved copy at once): its shape, shimmering, where the
// index, title, pills and files will be.
const SKEL_LINES = [62, 48, 71, 35, 80, 54, 66, 28];
// `pr`: once the PR itself is here (its files still loading), its title and description show in place.
function PRSkeleton({ pr }: { pr?: PR | null }) {
  const [showIndex] = useStoredFlag('showIndex', true);
  const [mdStyle] = useMdStyle();
  const look = mdStyleProps(mdStyle);
  return (
    <div class={showIndex ? 'review skel' : 'review no-index skel'} aria-busy="true" aria-label={`Loading the ${pageTerm().PR}`}>
      <aside class="side">
        {[70, 50, 85, 40, 65, 55, 75].map((w) => (
          <span class="sk" style={{ width: `${w}%` }} />
        ))}
      </aside>
      <main>
        {pr ? (
          <h1 class="skel-h1">
            <span class="pr-num">{pr.html_url.includes("/-/merge_requests/") ? "!" : "#"}{pr.number}</span> {pr.title}
          </h1>
        ) : (
          <span class="sk sk-title" />
        )}
        {pr?.body_html && (
          <div class={`rich pr-desc skel-desc ${look.class}`} style={look.style}>
            <div class="md chunk" dangerouslySetInnerHTML={{ __html: pr.body_html }} />
          </div>
        )}
        <div class="skel-pills">
          {[70, 110, 60, 90].map((w) => (
            <span class="sk sk-pill" style={{ width: `${w}px` }} />
          ))}
        </div>
        {[8, 5, 7].map((n, k) => (
          <div class="skel-file">
            <div class="skel-fh">
              <span class="sk" style={{ width: `${30 + k * 8}%` }} />
            </div>
            {SKEL_LINES.slice(0, n).map((w) => (
              <span class="sk" style={{ width: `${w}%` }} />
            ))}
          </div>
        ))}
      </main>
    </div>
  );
}

// A notice, with a way to fix it when it's someone Slack can't place: "Find @x on Slack" opens Settings → Slack → People
// at them. Shared with the PR list's notices (main.tsx).
export function NoticeText({ text }: { text: string }) {
  const who = [...new Set([...text.matchAll(/no Slack user known: map @([\w-]+)/g)].map((m) => m[1]))];
  return (
    <>
      {text}
      {who.map((l) => (
        <button class="notice-cta" onClick={() => mapOnSlack(l)}>
          Find @{l} on Slack
        </button>
      ))}
    </>
  );
}

// What you'd seen of each PR you opened (for "changed since your last visit") piles up in localStorage, one record
// a PR, some of them large; keep the 100 most recent.
function pruneVisits() {
  const mine = own('visit:'); // this account's
  const keys = Object.keys(localStorage).filter((k) => k.startsWith(mine));
  if (keys.length <= 100) return;
  const when = (k: string) => {
    try {
      return Number(JSON.parse(localStorage.getItem(k) ?? '{}').seenAt) || 0;
    } catch {
      return 0;
    }
  };
  for (const [k] of keys.map((k) => [k, when(k)] as const).sort((a, b) => a[1] - b[1]).slice(0, keys.length - 100)) localStorage.removeItem(k);
}

// A reviewer who's away swapped for the first suggested one who isn't (Slack status, or busy on GitHub/GitLab), skipping
// `skip`: on my PR's page (Ask), and the PR list's away pill. Asked as a code owner, only another owner of the changed
// files will do (GitHub needs an owner's approval), in the suggestions' order. With Slack set up, they get your "ask"
// message there too, as asking from the Reviewers list does. Who was asked, and a sentence saying how.
export async function swapReviewer(repo: string, n: number, away: string, skip: string[], pr: { title: string; url: string; author: string }) {
  const [owners, suggested] = await Promise.all([ownersToAsk(repo, n, away), suggestReviewers(repo, new Set([away, ...skip]), localStorage.getItem(own('team')) ?? '')]); // the team watched (Settings)
  let picks: { login: string; busy?: string }[] = suggested.slice(0, 8);
  if (owners) {
    const out = new Set([away, ...skip].map((l) => l.toLowerCase()));
    const rank = (l: string) => ((k) => (k < 0 ? suggested.length : k))(suggested.findIndex((p) => p.login.toLowerCase() === l.toLowerCase()));
    const ranked = owners.filter((l) => !out.has(l.toLowerCase()) && !l.endsWith('[bot]')).sort((a, b) => rank(a) - rank(b)).slice(0, 8);
    const busy = await siteBusy(ranked);
    picks = ranked.map((login) => ({ login, busy: busy[login] }));
  }
  const status = await slackPresence(picks.map((p) => p.login)).catch(() => ({}) as Record<string, SlackPresence>);
  // Someone it's working hours for, else anyone free.
  const free = picks.filter((p) => !p.busy && !isAway(status[p.login]));
  const next = free.find((p) => !lateFor(status[p.login])) ?? free[0];
  if (!next)
    throw new Error(owners ? `No free code owner to ask: @${away} was asked as one, and GitHub needs an owner's approval; the other owners of these files are away, busy or already asked.` : 'No one free to ask: everyone suggested is away or already asked.');
  await requestReview(repo, n, next.login);
  await unrequestReview(repo, n, away);
  dispatchEvent(new Event('lgtm:refresh'));
  const login = next.login;
  if (!(await fetchIntegrations().then((i) => i.slack?.ok, () => false))) return { login, said: `Asked @${login} instead of @${away}.` };
  try {
    const [r] = await notifySlack(await slackRecipients(repo, [login]), fillSlack(slackTemplate('ask'), prValues({ repo, number: n, ...pr })), `${repo}#${n}`);
    return { login, said: r?.ok ? `Asked @${login} instead of @${away}, on ${site(repo)} and Slack.` : `Asked @${login} instead of @${away} on ${site(repo)}; Slack didn't reach them (${r?.error ?? 'no reply'}).` };
  } catch (e: any) {
    return { login, said: `Asked @${login} instead of @${away} on ${site(repo)}; Slack failed (${e.message}).` };
  }
}

// focus: review mode (main.tsx), where the index starts hidden and a review always moves on.
// practice: review mode's practice run, where finishing a review only moves on (github.ts refuses every write).
// toReview: the list has it as waiting for my review (undefined until the list is in).
export function Review({ repo, n, toReview: listed, onOpened, onSubmitted, onReviewed, flash, focus, practice }: { repo: string; n: number; toReview?: boolean; onOpened: () => void; onSubmitted: (event?: ReviewEvent) => void; onReviewed: (notice: Notice | null, event?: ReviewEvent) => void | Promise<unknown>; flash?: Notice | null; focus?: boolean; practice?: boolean }) {
  const [data, setData] = useState<{ pr: PR; headRepo: string; files: File[]; rules: ReturnType<typeof parseGeneratedRules> } | null>(null);
  const [stack, setStack] = useState<StackLayer[]>([]);
  // "Changes since my last review": the commit I last reviewed, and that comparison once loaded.
  const [lastReviewed, setLastReviewed] = useState<string | null>(null);
  const [lastReviewAt, setLastReviewAt] = useState(''); // when I submitted it
  const [newCommits, setNewCommits] = useState<number | null>(null); // since that review
  // Commits pushed while the PR is open: looked for each minute (not while lgtm is in the background, and at once on
  // coming back), then offered as a reload. Anything else new on it (a comment, a reply, a review): its conversation and
  // threads loaded again in place.
  const [pushed, setPushed] = useState<number | null>(null);
  const shownHead = data?.pr.head.sha;
  const lastActive = useRef('');
  useEffect(() => {
    setPushed(null);
    lastActive.current = '';
    if (!shownHead) return;
    const look = () =>
      !document.hidden &&
      getActivity(repo, n).then(
        ({ head, updated }) => {
          const was = lastActive.current;
          lastActive.current = updated;
          if (head !== shownHead) return void getCompare(repo, shownHead, head).then((c) => setPushed(c.commits || 1), () => setPushed(1));
          if (was && updated !== was) dispatchEvent(new CustomEvent('lgtm:reload-talk', { detail: { tell: true } }));
        },
        () => {},
      );
    void look(); // when it last changed, to compare with
    const t = setInterval(look, 60_000);
    addEventListener('visibilitychange', look);
    return () => (clearInterval(t), removeEventListener('visibilitychange', look));
  }, [repo, n, shownHead]);
  // My open threads, against the code now: unchanged, changed (the lines as they are), or unknown (history rewritten).
  const [sinceComment, setSinceComment] = useState<Map<string, SinceComment>>(new Map());
  const [since, setSince] = useState(false);
  const [fromSha, setFromSha] = useState<string | null>(null); // a point picked in "Changes since…" (else my last review)
  const [toSha, setToSha] = useState<string | null>(null); // one commit on its own (the commits pill): fromSha is its parent
  const [points, setPoints] = useState<PushPoint[] | null>(null);
  const [sinceData, setSinceData] = useState<{ status: string; files: File[]; body?: string } | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [pending, setPending] = useState<PendingReview | null>(null); // my review in progress on GitHub
  const pendingNow = pending; // as this render has it (submit's own copy may be fresher)
  const [discarding, setDiscarding] = useState(false);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [saved, setSaved] = useState<Saved>({ sha: '', drafts: [] });
  const [target, setTarget] = useState<Target | null>(null);
  const [showGenerated, setShowGenerated] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false); // Your threads (y): my threads on their own, in place of the diff
  // The pill bar stays in view under the bar as you scroll; what sticks below it (file headers) moves down by its height.
  const pillsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pillsRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--pills', `${el.offsetHeight}px`);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return () => (ro.disconnect(), document.documentElement.style.removeProperty('--pills'));
  }, [!!data]);
  const [showNoDiff, setShowNoDiff] = useState(false);
  const [showWsOnly, setShowWsOnly] = useState(false);
  const [showImportsOnly, setShowImportsOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [owned, setOwned] = useState<Set<string>>(new Set()); // the PR's files CODEOWNERS gives me
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [foldImports] = useStoredFlag('foldImports', true);
  // Feature switches (Settings → Diff).
  const { bots } = useBots();
  const [foldGenerated] = useStoredFlag('hideGenerated', true);
  const [foldNoDiff] = useStoredFlag('hideNoDiff', true);
  const [foldArchived] = useStoredFlag('hideArchivedSpecs', true);
  const [collapseDeleted] = useStoredFlag('collapseDeleted', true);
  const [startSince] = useStoredFlag('sinceFirst', false);
  const [resumeOn] = useStoredFlag('resumePosition', false);
  const [dimMoved] = useStoredFlag('dimMoved', true);
  const index = useStoredFlag('showIndex', true);
  const focusIndex = useStoredFlag('reviewModeIndex', false);
  // Settings → "Hide the index on PRs waiting for your review": such a PR opens without it; i (or the button) shows it,
  // on this PR only. Decided once the PR and I are known (until then, without), so a review sent doesn't bring it back.
  const [hideToReview] = useStoredFlag('hideIndexToReview', true);
  const [toReview, setToReview] = useState<boolean | null>(null);
  const [peek, setPeek] = useState(false);
  const quiet = !focus && hideToReview && toReview !== false && index[0];
  // A narrow window keeps the diff readable: the index tucks away, and its button (or i) lays it over the diff until you
  // pick something in it, click elsewhere or press Esc.
  const narrowIx = useMedia('(max-width: 1280px)');
  const [ixOver, setIxOver] = useState(false);
  useDismiss(narrowIx && ixOver, () => setIxOver(false), '.side.tree, .bar-index');
  const [showIndex, toggleIndex] = narrowIx ? ([ixOver, () => setIxOver((o) => !o)] as const) : focus ? focusIndex : quiet ? ([peek, () => setPeek((p) => !p)] as const) : index;
  const [centered, toggleCentered] = useStoredFlag('centerDiff', true);
  const [split, toggleSplit] = useStoredFlag('splitDiff', false);
  const [fit] = useStoredFlag('centerFit', false);
  const [cols] = useStoredValue('centerCols', '120');
  useEffect(() => {
    const show = () => !showIndex && toggleIndex();
    addEventListener('lgtm:show-index', show);
    return () => removeEventListener('lgtm:show-index', show);
  }, [showIndex]);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState('');
  // Who gets a Slack DM after submitting (author + assignees, minus me and bots); null = Slack not set up.
  const [slackPeople, setSlackTo] = useState<string[] | null>(null);
  const slackTo = slackPeople && slackPeople.filter((l) => !bots.has(l)); // never message an account marked as a bot
  const [slackNote, setSlackNote] = useState('Checking Slack…'); // why there's no Slack option, if there isn't
  const [slackThreads, setSlackThreads] = useState<SlackThread[]>([]);
  // The QA request's replies (when there's one), and the newest seen here: opening it from the beaker sees them.
  const [qa, setQa] = useState<QaThread | null>(null);
  const [qaSeenAt, setQaSeenAt] = useState(() => qaSeen(`${repo}#${n}`));
  const hasQa = slackThreads.some((t) => t.login === '#qa');
  useEffect(() => void (hasQa && qaThreads([`${repo}#${n}`]).then((r) => setQa(r[`${repo}#${n}`] ?? null), () => {})), [hasQa]);
  // My PR's review request on Slack (slackRequest): its replies beside the title (Settings → Slack, reviewReplies); the
  // channel button only while there's none (reviewAsk).
  const [reviewAsk] = useStoredFlag('reviewAsk', false);
  const [reviewReplies] = useStoredFlag('reviewReplies', false);
  const [request, setRequest] = useState<SlackRequest | null>(null);
  const [requestSeenAt, setRequestSeenAt] = useState(() => qaSeen(`${repo}#${n}:review`));
  const [notice, setNotice] = useState<Notice | null>(flash ?? null);
  const [viewed, setViewedPaths] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // viewed files opened anyway
  const [renderAll, setRenderAll] = useState(false);
  const [help, setHelp] = useState(false);
  const [reverting, setReverting] = useState(false);
  // A revert (its "Reverts …#n" line): how it compares with undoing that PR exactly (github.ts revertGaps).
  const undoes = data ? revertOf(data.pr.body, repo) : null;
  const [gaps, setGaps] = useState<ReturnType<typeof revertGaps> | null>(null);
  useEffect(() => {
    setGaps(null);
    if (undoes && data) getFiles(repo, undoes).then((orig) => setGaps(revertGaps(data.files, orig)), () => {});
  }, [undoes, data?.pr.head.sha]);
  const cleanRevert = !!gaps && !gaps.differ.length; // brings back what was there: no test checks
  // A merged PR that a later one reverts (open or merged): said in its merged banner.
  const [undoneBy, setUndoneBy] = useState<Awaited<ReturnType<typeof revertedBy>>>(null);
  useEffect(() => {
    setUndoneBy(null);
    if (data?.pr.merged) revertedBy(repo, n).then(setUndoneBy, () => {});
  }, [repo, n, !!data?.pr.merged]);
  // Revert, on a merged PR: once you say so, the PR that undoes it, opened here.
  async function revert(id: string, base: string) {
    // The PR's review request on Slack, if any: a box to say so in its thread.
    const author = data && data.pr.user.login !== me ? data.pr.user.login : undefined;
    const where = slackRequest(`${repo}#${n}`, author).then((d) => d.where && `Reply in its review request's thread in ${d.where}`, () => null);
    const a = await askText(`Open a ${pageTerm().PR} that reverts this one on ${base}? It's reviewed and merged like any other. Why goes in its description.`, 'Revert', 'Why (optional): what it breaks', where);
    if (!a) return;
    setReverting(true);
    try {
      const made = await revertPR(repo, n, id, a.text);
      if (a.checked)
        slackRequest(`${repo}#${n}`, author, `Reverting this: ${prWebUrl(repo, made)}${a.text ? `\n${a.text}` : ''}`).then(
          (d) => d.where && dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `Replied in ${d.where} on Slack.` } })),
          (e) => reportError(`Couldn't reply on Slack: ${e.message}`),
        );
      location.hash = `/${repo}/pull/${made}`;
    } catch (e: any) {
      reportError(`Couldn't revert: ${e.message}`);
    } finally {
      setReverting(false);
    }
  }
  useEffect(() => {
    const open = () => setHelp(true); // the title bar's ? button
    addEventListener('lgtm:help', open);
    return () => removeEventListener('lgtm:help', open);
  }, []);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getStatus>> | null>(null);
  // Settings → Diff sets the default; the pill, w, help and "less to read" switch it for this PR only (they used to
  // flip the setting itself, so one stray w or click turned it off everywhere).
  const [wsPref] = useStoredFlag('ignoreWs', true);
  const [wsHere, setWsHere] = useState<boolean | null>(null);
  const ignoreWs = wsHere ?? wsPref;
  const toggleWs = () => setWsHere(!ignoreWs);
  const [changedSinceVisit, setChangedSinceVisit] = useState<Set<string>>(new Set());
  const resumeAt = useRef<Visit['at']>(null);
  const visitKey = `visit:${repo}#${n}`;
  const [mine, setMine] = useState(false); // I opened it or it's assigned to me: show the merge box
  useEffect(onOpened, [repo, n]);
  const [batch, setBatch] = useState<Suggestion[]>([]);
  const [roots, setRoots] = useState<BuildRoot[] | null>(null); // the repo's modules (files.ts modulesOf)
  const rootsAt = data && `${data.headRepo}@${data.pr.head.sha}`;
  useEffect(() => void (data && getBuildRoots(data.headRepo, data.pr.head.sha).then(setRoots, () => setRoots(null))), [rootsAt]);
  useEffect(() => setBatch([]), [repo, n]);
  useEffect(() => void document.documentElement.classList.remove('threads-hidden'), [repo, n]); // t's hiding is for one PR
  const [me, setMe] = useState('');
  const myOpenPR = !!me && data?.pr.user.login === me && data.pr.state === 'open';
  // People I sent my PR to in a Slack DM (Settings → Slack): the ones GitHub or GitLab doesn't ask, and who haven't
  // reviewed it, to ask there too (so it's in their list, the PR's status and the review load lgtm counts).
  const [sentTo, setSentTo] = useState<{ login: string; url: string | null }[]>([]);
  useEffect(() => {
    setSentTo([]);
    if (myOpenPR) slackSentTo(`${repo}#${n}`).then(setSentTo, () => {});
  }, [repo, n, myOpenPR]);
  const slackOnly = data ? sentTo.map((s) => s.login).filter((l) => l !== me && !bots.has(l) && !(data.pr.requested_reviewers ?? []).some((u) => u.login === l) && !conversation.some((c) => c.state && c.author === l)) : [];
  // My PR closed without merging somewhere else (Settings → Slack, closeReply): whether its review request's thread can
  // still hear it (where it is), once.
  const myClosed = !!me && data?.pr.user.login === me && data.pr.state === 'closed' && !data.pr.merged;
  const [closeWhere, setCloseWhere] = useState<string | null>(null);
  useEffect(() => {
    setCloseWhere(null);
    if (myClosed && !closeTold(`${repo}#${n}`)) slackRequest(`${repo}#${n}`).then((r) => setCloseWhere(r.where), () => {});
  }, [repo, n, myClosed]);
  // The agent's drafts in my pending review, in file order (set below, once the PR is in): r steps to the next one not
  // looked at, focused, where ↵ keeps it, e edits and ⌫ drops it (PendingComment); Finish review counts the rest.
  const agentDraftsRef = useRef<{ id: string; path: string }[]>([]);
  const [, setLookTick] = useState(0);
  useEffect(() => {
    const seen = () => setLookTick((t) => t + 1);
    const next = () => {
      const list = agentDraftsRef.current, looked = new Set(lookedDrafts());
      const cur = (document.activeElement as HTMLElement | null)?.closest?.('[data-agent-draft]')?.getAttribute('data-agent-draft');
      const at = list.findIndex((d) => d.id === cur);
      const d = [...list.slice(at + 1), ...list.slice(0, at + 1)].find((d) => !looked.has(d.id) && d.id !== cur);
      if (!d) return setNotice({ ok: true, text: list.length ? 'You looked at every agent draft.' : 'No agent drafts in your review.' });
      jumpTo('ad-' + d.id, 'f-' + d.path);
      let tries = 0;
      const focus = () => ((el) => (el ? el.focus({ preventScroll: true }) : tries++ < 40 && setTimeout(focus, 50)))(document.getElementById('ad-' + d.id));
      focus();
    };
    // Finish review's Look now: Your threads, at the first one not looked at.
    const look = () => (setOnlyMine(true), setTimeout(next, 50));
    const mineOnly = () => (setOnlyMine(true), scrollTo({ top: 0 }));
    addEventListener('lgtm:my-threads', mineOnly);
    addEventListener('lgtm:looked', seen);
    addEventListener('lgtm:agent-next', next);
    addEventListener('lgtm:look-drafts', look);
    return () => (removeEventListener('lgtm:looked', seen), removeEventListener('lgtm:agent-next', next), removeEventListener('lgtm:look-drafts', look), removeEventListener('lgtm:my-threads', mineOnly));
  }, []);
  // What you may do to the PR itself (github.ts prRights): Close, Close and delete branch, Convert to draft, Reopen, in
  // the ⋯ menu; a PR quiet for 30 days or more has them up front, in a banner.
  const [rights, setRights] = useState<PrRights | null>(null);
  const [acting, setActing] = useState<StateAct | null>(null);
  const [basePick, setBasePick] = useState(false); // Change base…: its dialog open
  useEffect(() => {
    setRights(null);
    if (data && !data.pr.merged) prRights(repo, n).then(setRights, () => {});
  }, [repo, n, data?.pr.state, data?.pr.draft, data?.pr.merged, data?.pr.head.sha]); // a push: up to date again, or not
  const stateAct = async (a: StateAct) => {
    if (!data || !rights) return;
    if (a === 'base') return setBasePick(true); // its dialog (BaseDialog) does the rest
    const t = pageTerm().PR;
    const [q, yes] = {
      close: [`Close this ${t} without merging? It can be reopened later.`, 'Close'],
      closeBranch: [`Close this ${t} and delete its branch ${rights.headRefName}? lgtm can bring the branch back to reopen it.`, 'Close and delete'],
      draft: [`Convert this ${t} to a draft? It stays open; it's marked ready again when it's worth reviewing.`, 'Convert to draft'],
      reopen: [`Reopen this ${t}?`, 'Reopen'],
      restore: [`Make ${rights.headRefName} again at this ${t}'s last commit, and reopen it?`, 'Restore and reopen'],
      update: ['', rights.rebase ? 'Rebase' : 'Update branch'], // as on GitHub, no question: it only adds the base's commits
      ready: ['', 'Ready for review'],
      base: ['', ''],
    }[a];
    // Closing asks why (optional): a comment on the PR, and the review thread hears it.
    const said = a === 'close' || a === 'closeBranch' ? await askText(q, yes, WHY_CLOSE) : a === 'update' || a === 'ready' || (await ask(q, yes)) ? { text: '' } : null;
    if (!said) return;
    setActing(a);
    try {
      if (a === 'draft') await convertToDraft(data.pr.node_id);
      else if (a === 'ready') await markReady(data.pr.node_id).then(() => void ticketsToReview(jiraKeys(data.pr.title, data.pr.head.ref))); // as the Merge panel's does
      else if (a === 'update') await updateBranchAndWait(repo, n, { id: data.pr.node_id, headRefOid: data.pr.head.sha }); // "Updating…" until the new head is there
      else if (a === 'reopen') await reopenPR(repo, n);
      else if (a === 'restore') await restoreBranch(repo, rights).then(() => reopenPR(repo, n));
      else {
        await closeWithReason(repo, n, said.text);
        if (a === 'closeBranch') await deleteBranch(repo, rights).catch((e) => setNotice({ ok: false, text: `Closed, but ${e.message}` }));
        if (data.pr.user.login === me) closedOnSlack(`${repo}#${n}`, (data.pr.requested_reviewers ?? []).map((u) => u.login), said.text).then((w) => w && setNotice({ ok: true, text: `Closed. Said so in your review request's thread in ${w}.` }), () => {});
      }
      onSubmitted(); // the lists
      dispatchEvent(new Event('lgtm:refresh')); // this page, and what you may do now
    } catch (e) {
      setNotice({ ok: false, text: `Couldn't ${yes.toLowerCase()}: ${(e as Error).message}` });
    }
    setActing(null);
  };
  // Right-click on the title (in the app): the link, and Browse This Repository (main.tsx: the Browse tab on it).
  const titleMenu = async (e: MouseEvent) => {
    if (!isDesktop || !data || getSelection()?.toString()) return;
    e.preventDefault();
    const { Menu } = await import('@tauri-apps/api/menu');
    const url = data.pr.html_url;
    await (await Menu.new({
      items: [
        { text: `Open on ${site(repo)}`, action: () => void openExternal(url) },
        { text: 'Copy Link', action: () => void copyText(url) },
        { text: 'Browse This Repository', action: () => void dispatchEvent(new CustomEvent('lgtm:browse-repo', { detail: repo })) },
      ],
    })).popup();
  };
  const idleDays = data?.pr.state === 'open' && data.pr.updated_at ? Math.floor((Date.now() - Date.parse(data.pr.updated_at)) / 86_400_000) : 0;
  // My PR asks a group but no one in it by name (a GitHub team, a GitLab approval rule: github.ts unnamedGroup): everyone
  // in it is told, so it's no one's. Its least busy member, to ask by name.
  const reviewedYet = conversation.some((c) => c.state && c.author !== me);
  const [teamPick, setTeamPick] = useState<(ReviewerPick & { group: string }) | null>(null);
  useEffect(() => {
    setTeamPick(null);
    if (myOpenPR && data && !data.pr.draft)
      unnamedGroup(repo, n, data.pr, reviewedYet)
        .then((g) => g && suggestReviewers(repo, new Set([me, ...bots]), '', [], g.members).then((l) => ((p) => p && setTeamPick({ ...p, group: g.label }))(l.find((p) => !p.busy))))
        .catch(() => {});
  }, [repo, n, myOpenPR, data?.pr.requested_reviewers?.length, reviewedYet]);
  useEffect(() => {
    setRequest(null);
    if (myOpenPR && (reviewAsk || reviewReplies)) slackRequest(`${repo}#${n}`, undefined, undefined, true).then(setRequest, () => {});
  }, [repo, n, myOpenPR, reviewAsk, reviewReplies]);
  const botsFolded = useFoldBots(!!me && data?.pr.user.login === me); // as the conversation folds them
  // As the list has it ("Needs your review"); opened before the list is in, whether my review is requested.
  useEffect(() => {
    if (toReview !== null) return;
    if (listed !== undefined) return setToReview(listed);
    if (!data) return;
    // The signed-in login, known already (not `me`, which waits for the PR's refresh from GitHub).
    getViewer(repo).then((login) => setToReview(data.pr.user.login !== login && (data.pr.requested_reviewers ?? []).some((u) => u.login === login)), () => setToReview(false));
  }, [data, listed]);
  const [stale, setStale] = useState<number | null>(null); // showing the copy loaded at this time, while refreshing
  const [early, setEarly] = useState<PR | null>(null); // the PR, before its files (PRSkeleton shows its title)
  const threadCursor = useRef(-1);
  useEffect(() => seenClaudePR(repo, n), []); // for the list's "✳ updated"
  const keys = useRef<(e: KeyboardEvent, named?: Action) => void>(() => {});
  const [bindings] = useBindings();
  const key = `drafts:${repo}#${n}`;
  // A review of it still on its way (sent as you moved on): Finish review waits for it, then the page reloads.
  const [inFlight, setInFlight] = useState(() => sending.has(`${repo}#${n}`));
  useEffect(() => {
    const p = sending.get(`${repo}#${n}`);
    if (!p) return;
    let live = true;
    const done = () => live && (setInFlight(false), dispatchEvent(new Event('lgtm:refresh')));
    p.then(done, done);
    return () => void (live = false);
  }, []);

  // Checks are secondary: a failure here shouldn't block the review.
  const [checksErr, setChecksErr] = useState('');
  const loadChecks = () => {
    setChecks(null);
    setChecksErr('');
    getChecks(repo, n).then((cs) => {
      setChecks(cs);
      // A failing check: is it failing on the base branch too (not this PR's doing)?
      if (!cs.some((c) => c.state === 'failure')) return;
      getPR(repo, n)
        .then((pr) => baseChecks(repo, pr.base.ref))
        .then((base) => setChecks(cs.map((c) => (c.state === 'failure' ? { ...c, onBase: onBaseOf(base, c) } : c))), () => {});
    }, (e) => (setChecks([]), setChecksErr(e.message)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    const named = (e: Event) => keys.current(new KeyboardEvent('keydown'), (e as CustomEvent<Action>).detail); // palette.tsx
    addEventListener('keydown', onKey);
    addEventListener('lgtm:act', named);
    return () => (removeEventListener('keydown', onKey), removeEventListener('lgtm:act', named));
  }, []);

  const [, setEmojiReady] = useState(false);
  // The top bar's ↻ loads the PR again, as on opening it, minus what only opening does (scrolling back to where
  // you were, starting on what's new).
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    const again = () => setReloads((r) => r + 1);
    addEventListener('lgtm:refresh', again);
    return () => removeEventListener('lgtm:refresh', again);
  }, []);
  useEffect(() => {
    const first = reloads === 0;
    getEmojis().then(() => setEmojiReady(true), () => {});
    loadChecks();
    getStatus(repo, n).then(setStatus, () => {});
    getViewed(repo, n, setViewedPaths).catch(() => {}); // each page's marks as it comes (100 files a page)
    (async () => {
      const [stored, visit] = await Promise.all([storage.get<Saved>(key), storage.get<Visit>(visitKey).catch(() => undefined)]);
      if (visit && first) resumeAt.current = visit.at;
      // Show a PR's last-loaded copy at once (marked as updating), then the fresh one.
      type Loaded = LoadedPR;
      let fresh = false;
      let shownHead = '';
      const show = (d: Loaded) => {
        const headRepo = d.pr.head.repo?.full_name ?? repo;
        const rules = parseGeneratedRules(d.attrs ?? '');
        if (visit) setChangedSinceVisit(new Set(d.files.filter((f) => visit.files[f.filename] !== f.sha).map((f) => f.filename)));
        if (shownHead && shownHead !== d.pr.head.sha) setSinceData(null); // new commits: compare again
        shownHead = d.pr.head.sha;
        setThreads(d.threads);
        setPending(d.pending ?? null);
        setConversation(d.conversation);
        setSaved(stored ?? { sha: d.pr.head.sha, drafts: [] });
        setData({ pr: d.pr, headRepo, files: prepare(d.files, rules), rules });
        knowJiraKeys([d.pr.title, d.pr.head.ref]);
        rememberPR({ repo, n, title: d.pr.title, author: d.pr.user.login, state: d.pr.merged ? 'merged' : d.pr.state === 'closed' ? 'closed' : d.pr.draft ? 'draft' : undefined });
      };
      // A copy saved in the last 30 seconds (the list loads a PR the pointer rests on) is as good as fresh: no second load.
      const RECENT = 30_000;
      const cached = first ? prCache.get<Loaded>(`${repo}#${n}`) : Promise.resolve(undefined);
      if (first)
        cached.then(async (c) => {
          if (c) await loadLanguages(repo, c.v.files.map((f) => f.filename));
          if (!c || fresh || Date.now() - c.at < RECENT) return;
          setStale(c.at);
          // Not its review in progress: that one may have been sent or discarded since (it showed "1 review in
          // progress" until the fresh copy came, on every open). GitHub's word comes with the fresh copy.
          show({ ...c.v, pending: null });
        });
      else setStale(Date.now()); // the page as it is stays, marked as updating
      let pr: PR;
      let loaded: Loaded;
      const recent = await cached;
      const reuse = !!recent && Date.now() - recent.at < RECENT && !recent.v.paused;
      try {
        if (reuse) extras((loaded = { ...recent!.v, pending: await getPendingReview(repo, n).catch(() => null) }).pr); // the review in progress asked fresh: one small ask
        else
          loaded = await loadPR(repo, n, (p) => {
            if (!shownHead) setEarly(p); // nothing shown yet: its title and description, while the files load
            extras(p);
          });
        pr = loaded.pr;
      } catch (e: any) {
        if (first && !shownHead) throw e;
        setStale(null);
        return setNotice({ ok: false, text: `Couldn't refresh this ${pageTerm().PR} (${e.message}); showing the copy loaded earlier.` });
      }
      await loadLanguages(repo, loaded.files.map((f) => f.filename)); // any language beyond the built-in ones, before drawing
      fresh = true;
      setStale(null);
      show(loaded);
      setPaused(loaded.paused ?? '');
      if (!loaded.paused && !reuse) void prCache.set(`${repo}#${n}`, loaded); // not a copy missing its threads
    })().catch((e) => setError(e.message));
    // What needs only the PR (not its files), started as soon as it's here: who I am to it, its stack, my last review.
    let started = false;
    function extras(pr: PR) {
      if (started) return;
      started = true;
      getViewer(repo).then((me) => {
        setMe(me);
        setMine([pr.user, ...pr.assignees].some((u) => u.login === me));
      }, () => {});
      getStack(repo, pr).then(setStack, () => {});
      // My "reviews" of my own PR are only replies to threads: no "since your last review" there.
      Promise.all([getMyLastReview(repo, n), getViewer(repo).catch(() => '')]).then(([last, me]) => {
        if (pr.user.login === me) return;
        const sha = last?.sha;
        if (last) setLastReviewAt(last.at);
        if (sha && sha !== pr.head.sha) {
          getCompare(repo, sha, pr.head.sha).then((c) => setNewCommits(c.commits), () => {});
          setLastReviewed(sha);
          if (first && startSince) setSince(true); // re-review: start with just what changed
        }
      }, () => {});
    }
  }, [reloads]);

  // Did they address my comments? (threadcheck.ts): back with new commits since my review, an agent reads my open
  // threads against them, once a push (Settings → Reviewing). On my own PR, the same for the threads of whoever asked
  // for changes before I pushed, before I ask them to look again.
  const [checkOn] = useStoredFlag('agentThreads', true);
  const [check, setCheck] = useState<ThreadCheck | null>(null);
  const [checkTry, setCheckTry] = useState(0);
  const checking = useRef('');
  const head = data?.pr.head.sha ?? '';
  const ownPR = !!me && data?.pr.user.login === me;
  const theirs = ownPR && data ? askAgainOf(conversation.filter((c) => !c.author.endsWith('[bot]')), data.pr) : null;
  const checkSince = ownPR ? theirs?.since ?? null : lastReviewed;
  const myOpen = !me ? [] : threads.filter((t) => !t.isResolved && (ownPR ? !!theirs?.who.includes(t.comments.nodes[0]?.author?.login ?? '') : t.comments.nodes.some((c) => c.author?.login === me)));
  const myOpenIds = myOpen.map((t) => t.id).join();
  useEffect(() => {
    if (!data || !checkOn || !checkSince || !myOpen.length) return setCheck(null);
    const saved = savedCheck(repo, n, head);
    if (saved) return setCheck(saved);
    const run = `${head}:${checkTry}`;
    if (checking.current === run) return;
    checking.current = run;
    void detectAgents().then(() => {
      const agent = autoAgent();
      if (!agent) return;
      setCheck({ sha: head, by: agent, state: 'running', verdicts: {} });
      checkThreads({ repo, n, headRepo: data.headRepo, head, since: checkSince, threads: myOpen, agent }).then((c) => {
        if (checking.current === run) setCheck(c);
        const all = Object.values(c.verdicts), done = all.filter((v) => v.addressed).length;
        if (c.state === 'done' && all.length) notifyAgentDone(`${AGENTS[agent].name} checked ${ownPR ? 'their' : 'your'} threads`, `${data.pr.title}: ${done} of ${all.length} addressed`, `/${repo}/pull/${n}`);
      });
    });
  }, [head, checkSince, myOpenIds, checkOn, checkTry]);

  // Slack, with the PR and on each reload; while it isn't reachable (lgtm just launched, or the Mac just woke: slackcli
  // can fail for a moment), again every 15 seconds for 2 minutes, and whenever the window is back in focus or online.
  const [slackTry, setSlackTry] = useState(0);
  useEffect(() => {
    if (!data) return;
    const pr = data.pr;
    let live = true;
    let timer = 0;
    const again = () => setSlackTry((k) => k + 1);
    const retry = () => {
      if (!live) return;
      if (slackTry < 8) timer = window.setTimeout(again, 15_000);
      addEventListener('focus', again);
      addEventListener('online', again);
    };
    Promise.all([slackStatus(`${repo}#${n}`), getViewer(repo)]).then(([slack, me]) => {
      if (!live) return;
      setSlackThreads(slack.threads);
      const people = [...new Set([pr.user, ...pr.assignees].filter((u) => u.type !== 'Bot' && u.login !== me).map((u) => u.login))];
      setSlackTo(slack.configured ? people : null);
      setSlackNote(slack.configured ? '' : `Slack unavailable: ${slack.error ?? 'slackcli is not signed in'}`);
      if (!slack.configured) retry();
    }, (e) => live && (setSlackNote(`Slack unavailable: ${e.message}`), retry()));
    return () => {
      live = false;
      clearTimeout(timer);
      removeEventListener('focus', again);
      removeEventListener('online', again);
    };
  }, [!!data, reloads, slackTry]);

  // Everyone on this PR, for Settings → Slack → People to offer mapping (not just your team).
  useEffect(() => {
    if (!data) return;
    const pr = data.pr;
    rememberPeople([pr.user.login, ...(pr.requested_reviewers ?? []).map((u) => u.login), ...conversation.filter((c) => !c.bot).map((c) => c.author)].map((l) => personKey(repo, l)));
  }, [data, conversation]);

  // The conversation and threads loaded again in place (a comment edited or deleted; something new on the PR, said in a
  // toast when it's someone else's). Not while a reply of mine is still sending: it'd drop from view.
  useEffect(() => {
    const again = (e: Event) => {
      const tell = !!(e as CustomEvent<{ tell?: boolean }>).detail?.tell;
      if (threadsNow.current.some((t) => t.comments.nodes.some((c) => c.state === 'SENDING'))) return;
      void Promise.all([getThreads(repo, n), getConversation(repo, n)]).then(([t, c]) => {
        const seen = new Set([...threadsNow.current.flatMap((x) => x.comments.nodes.map((y) => y.url)), ...convNow.current.map((x) => x.id)]);
        const fresh = [...t.flatMap((x) => x.comments.nodes.filter((y) => !seen.has(y.url)).map((y) => y.author?.login ?? 'ghost')), ...c.filter((x) => !seen.has(x.id)).map((x) => x.author)].filter((w) => w !== me);
        setThreads(t), setConversation(c);
        if (tell && fresh.length) dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `New from ${[...new Set(fresh)].map((w) => '@' + w).join(', ')}`, ms: 4000 } }));
      }, () => {});
    };
    addEventListener('lgtm:reload-talk', again);
    return () => removeEventListener('lgtm:reload-talk', again);
  }, [repo, n, me]);
  const threadsNow = useRef(threads), convNow = useRef(conversation);
  threadsNow.current = threads;
  convNow.current = conversation;
  // Reactions and hidden comments for the PR, its conversation and its threads (social.tsx), once each is in.
  useEffect(() => void (data && loadSocial(repo, n, data.pr.node_id, [data.pr.node_id, ...conversation.map((c) => c.node), ...threads.flatMap((t) => t.comments.nodes.map((c) => c.id))])), [data?.pr.node_id, conversation, threads]);
  const sinceBase = fromSha ?? lastReviewed;
  useEffect(() => void (data && getPushPoints(repo, n).then(setPoints, () => setPoints([]))), [repo, n, data?.pr.head.sha]); // once the PR (its head) is here, not before too
  useEffect(() => {
    if (!since || !sinceBase || !data || sinceData) return;
    getCompare(repo, sinceBase, toSha ?? data.pr.head.sha).then(
      // After a rebase the comparison also carries the base branch's changes; keep only files this PR touches.
      async (d) => {
        // GitHub lists at most 300 files per comparison. After a rebase onto lots of base-branch work those can all be
        // base-branch files, and the PR's own changes are cut off: fall back to the full diff rather than show nothing.
        if (d.files.length >= 300) {
          setSince(false);
          setLastReviewed(null); // no "since" toggle either: it would hit the same limit
          setNotice({ ok: false, text: `Showing the full diff: the branch was rebased onto so much new base-branch work since your last review that ${site(repo)} can't list just what changed in this ${pageTerm().PR}.` });
          return;
        }
        const inPR = new Set(data.files.map((f) => f.filename));
        // Rebased since then: the PR's diff now, cut to the changes it didn't have then (diff.ts interdiff), so what
        // came in from the base branch stays out. The diff then: from where that push left the base, to it.
        if (!toSha && d.status === 'diverged') {
          const then = await getCompare(repo, data.pr.base.sha, sinceBase).catch(() => null);
          if (then && then.files.length < 300) {
            const was = new Map(then.files.map((f) => [f.filename, f]));
            const files = data.files.flatMap((f) => {
              const old = was.get(f.previous_filename ?? f.filename) ?? was.get(f.filename);
              if (!f.patch) return old && old.sha === f.sha ? [] : [f]; // binary or too big: in when it's different
              const patch = interdiff(old?.patch, f.patch);
              if (!patch) return [];
              const ls = patch.split('\n');
              return [{ ...f, patch, additions: ls.filter((l) => l[0] === '+').length, deletions: ls.filter((l) => l[0] === '-').length }];
            });
            return setSinceData({ status: 'rebased', files: prepare(files, data.rules) });
          }
        }
        setSinceData({ status: d.status, files: prepare(toSha ? d.files : d.files.filter((f) => inPR.has(f.filename)), data.rules), body: toSha && fromSha === `${toSha}^` ? d.message?.split('\n').slice(1).join('\n').trim() : undefined }); // commits: all they changed; one, its message under the headline
      },
      (e) => {
        setSince(false);
        setNotice({ ok: false, text: toSha ? `Couldn't load that commit: ${e.message}` : `Couldn't load changes since ${fromSha ? 'then' : 'your last review'}: ${e.message}` });
        setToSha(null), setFromSha(null);
      },
    );
  }, [since, sinceBase, toSha, data]);
  // Changes since a picked point: the diff narrows to them, as after a review.
  const showSince = (sha: string | null) => (setFromSha(sha), setToSha(null), setSinceData(null), setSince(true));
  // One commit on its own (GitHub's Commits tab), or a run of them (shift-click in the index's Commits): what they
  // changed. fromSha is the first one's parent; comments go on the same lines in all changes (commitTarget).
  const commits = useMemo(() => prCommits(points ?? []), [points]);
  const firstSha = toSha && fromSha?.endsWith('^') ? fromSha.slice(0, -1) : toSha;
  const ci = (sha: string | null) => commits.findIndex((c) => c.sha === sha);
  // The commits I've opened, on this machine: ticked in the index, and Next skips them.
  const readKey = `commitsRead:${repo}#${n}`;
  const [readTick, setReadTick] = useState(0);
  const readCommits = useMemo(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(readKey) ?? '[]'));
    } catch {
      return new Set<string>();
    }
  }, [readKey, readTick]);
  const showCommit = (sha: string | null, last = sha) => {
    if (sha && last) {
      try {
        localStorage.setItem(readKey, JSON.stringify([...new Set([...readCommits, ...commits.slice(ci(sha), ci(last) + 1).map((c) => c.sha)])]));
      } catch {
        // not remembered
      }
      setReadTick((k) => k + 1);
      setFromSha(`${sha}^`), setToSha(last), setSinceData(null), setSince(true);
    } else setSince(false), setFromSha(null), setToSha(null), setSinceData(null);
    scrollTo({ top: 0 });
  };
  // Shift: from the first commit on show to this one (either way round).
  const pickCommit = (sha: string | null, shift = false) => {
    if (!sha || !shift || !firstSha) return showCommit(sha);
    const [a, b] = [ci(firstSha), ci(sha)].sort((x, y) => x - y);
    showCommit(commits[a].sha, commits[b].sha);
  };
  // The commit before the ones on show, or the next one I haven't opened (else just the next); from all changes, the
  // first unopened one (or the last, going back); past either end, all changes.
  const stepCommit = (by: 1 | -1) => {
    if (commits.length < 2) return;
    const a = ci(firstSha), b = ci(toSha);
    let next = by < 0 ? (b < 0 ? commits.length - 1 : a - 1) : b + 1;
    const unread = by > 0 ? commits.findIndex((c, i) => i >= next && !readCommits.has(c.sha)) : -1;
    if (unread >= 0) next = unread;
    showCommit(commits[next]?.sha ?? null);
  };
  const commitView = since && !!toSha;
  const newFrom = lastReviewed && ci(lastReviewed) >= 0 && ci(lastReviewed) < commits.length - 1 ? ci(lastReviewed) + 1 : -1; // the first commit pushed since my last review
  const commitTarget = async (t: Target | null) => {
    const no = (text: string) => dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text, ms: 4000 } }));
    if (!t || t.editId || !data || !toSha) return setTarget(t);
    const f = data.files.find((x) => x.filename === t.path);
    if (!f) return no(`${t.path.split('/').pop()} has no changes in all changes now: nothing to comment on there`);
    if (!t.line) return setTarget(t); // on the file
    if (t.side === 'LEFT') return no('Comment on removed lines in all changes');
    const [a, b] = await Promise.all([getRaw(data.headRepo, t.path, toSha), getRaw(data.headRepo, t.path, data.pr.head.sha)].map((p) => p.catch(() => null)));
    const at = a != null && b != null && relocate(a.split('\n'), b.split('\n'), parsePatch(f.patch ?? ''), t.startLine ?? t.line, t.line);
    if (!at) return no('That line changed after this commit, or isn\'t in the diff now: comment on it in all changes');
    setTarget({ ...t, at });
  };

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

  // A PR opens at its top (the window keeps the last PR's scroll otherwise), unless it resumes where I left off.
  useLayoutEffect(() => void scrollTo(0, 0), [repo, n]);

  // Remember this visit when leaving the PR (or the page): file versions seen, and the reading position.
  useLayoutEffect(() => {
    if (!data) return;
    const where = (): Visit['at'] => {
      const top = 46 + 44 + 4; // below the top bar (--nav) and the review bar (--bar)
      const all = document.querySelectorAll<HTMLElement>('main > .file');
      const below = firstBox(all, (r) => r.top > top);
      const cur = all[(below < 0 ? all.length : below) - 1];
      return cur ? { path: cur.id.slice(2), y: top - cur.getBoundingClientRect().top } : null;
    };
    let at = where();
    // Noted once scrolling stops, not on every scroll event: it's only read when you leave.
    let settle = 0;
    const onScroll = () => (clearTimeout(settle), (settle = window.setTimeout(() => (at = where()), 250)));
    const save = () => {
      clearTimeout(settle);
      at = where() ?? at; // where you are now, if the page is still there; else where scrolling last stopped
      void storage.set(visitKey, { files: Object.fromEntries(data.files.map((f) => [f.filename, f.sha])), at, seenAt: Date.now() } satisfies Visit);
      pruneVisits();
    };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('pagehide', save);
    // Pick up where I left off, before the page first paints (so it doesn't show its top first). Files above that
    // render later and shift things are HoldPlace's to absorb.
    const resume = resumeOn && resumeAt.current && document.getElementById('f-' + resumeAt.current.path);
    if (resume) {
      resume.scrollIntoView();
      scrollBy(0, resumeAt.current!.y);
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
  // Resolved and outdated conversations are hidden unless I'm in them (Settings → Conversation), until "show".
  const [hideSettled] = useStoredFlag('hideSettled', true);
  const [showSettled, setShowSettled] = useStoredFlag(`showSettled:${repo}#${n}`, false); // remembered per PR
  const settled = (t: Thread) => (t.isResolved || t.isOutdated) && !t.comments.nodes.some((c) => c.author?.login === me);
  const settledCount = hideSettled ? allThreads.filter(settled).length : 0;
  const hiddenThreads = showSettled ? 0 : settledCount;
  // A link into this PR (main.tsx "lgtm:link"): a comment, review or review thread of it goes there (hidden resolved
  // threads shown first); a file of it, from its blob URL, goes to that file, at the line when the link is of the head.
  useEffect(() => {
    const on = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      // A GitLab note (#note_…) is a thread's comment or the conversation's; whichever this page has.
      const note = url.startsWith(prWebUrl(repo, n)) && url.match(/#note_(\d+)$/)?.[1];
      if (note) {
        const id = document.getElementById(`rc-${note}`) ? `rc-${note}` : `cv-c${note}`;
        e.preventDefault();
        if (!document.getElementById(id) && hiddenThreads) setShowSettled();
        return jumpTo(id);
      }
      const here = url.startsWith(`https://github.com/${repo}/pull/${n}`) && url.match(/#(discussion_r|issuecomment-|pullrequestreview-|r)(\d+)$/); // #r…: the files tab's links
      if (here) {
        const id = ({ discussion_r: 'rc-', r: 'rc-', 'issuecomment-': 'cv-c', 'pullrequestreview-': 'cv-r' } as Record<string, string>)[here[1]] + here[2];
        e.preventDefault();
        if (!document.getElementById(id) && hiddenThreads) setShowSettled();
        return jumpTo(id);
      }
      const blob = url.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/blob\/([^/]+)\/([^#?]+)[^#]*(?:#L(\d+)(?:-L\d+)?)?$/) ?? url.match(/^https:\/\/([\w.-]+(?:\/[\w.-]+)+?)\/-\/blob\/([^/]+)\/([^#?]+)[^#]*(?:#L(\d+)(?:-\d+)?)?$/);
      const path = blob && decodeURIComponent(blob[3]);
      if (!blob || !data || ![repo, data.headRepo].includes(blob[1]) || !data.files.some((f) => f.filename === path)) return;
      e.preventDefault();
      jumpToLine(path!, [data.pr.head.sha, data.pr.head.ref].includes(blob[2]) && blob[4] ? Number(blob[4]) : undefined);
    };
    addEventListener('lgtm:link', on);
    return () => removeEventListener('lgtm:link', on);
  }, [repo, n, data, hiddenThreads]);
  const shownThreads = commitView ? [] : (since && sinceData ? allThreads.filter((t) => t.diffSide === 'RIGHT' || t.line == null) : allThreads).filter((t) => !hiddenThreads || !settled(t));
  const byPath = useMemo(() => Map.groupBy(shownThreads, (t) => t.path), [shownThreads]);
  useEffect(() => {
    const main = document.querySelector('main');
    reserveImages(main); // before their addresses are swapped for signed ones
    void renderMermaid(main); // conversation, threads, drafts
    signRepoImages(main); // their images from a (private) repo
    // Code blocks in comments, in the language of the file they're on (data-lang); see highlightBlocks.
    main?.querySelectorAll<HTMLElement>('.md[data-lang]').forEach((el) => highlightBlocks(el, el.dataset.lang || undefined));
  });

  const [readingOrder] = useStoredFlag('readingOrder', true); // files in the plan's order, else GitHub's
  const [qaRequest] = useStoredFlag('qaRequest', true); // Settings → Slack: the Ask QA button on my PRs
  const [stepsSaved] = useStoredValue('readingSteps', ''); // its steps' order, if dragged into another
  const [paused, setPaused] = useState(''); // GraphQL's limit used up: the threads couldn't load
  // Settings → Checks and → Android: what lgtm points out.
  const [chkSecrets] = useStoredFlag('checkSecrets', true);
  const [chkDeps] = useStoredFlag('checkDeps', true);
  const [chkTexts] = useStoredFlag('checkHardcoded', true);
  const [chkRoom] = useStoredFlag('checkRoom', true);
  const [chkMigrations] = useStoredFlag('checkMigrations', true);
  const [chkJpa] = useStoredFlag('checkJpa', true);
  const [chkTx] = useStoredFlag('checkTransactional', true);
  const [chkLock] = useStoredFlag('checkLockfile', true);
  const [chkFocus] = useStoredFlag('checkFocused', true);
  const [chkSupp] = useStoredFlag('checkSuppressions', true);
  const [chkUnsafe] = useStoredFlag('checkProtections', true);
  const [chkHtml] = useStoredFlag('checkRawHtml', true);
  // package.json changed without its lockfile (web.ts): the base's file names in that folder, listed.
  const [drift, setDrift] = useState<Awaited<ReturnType<typeof lockfileDrift>>>([]);
  useEffect(() => {
    setDrift([]);
    if (!data || !chkLock) return;
    let stop = false;
    lockfileDrift(data.files, (d) => listDir(repo, d, data.pr.base.sha).then((l) => l.map((x) => x.name))).then((r) => !stop && setDrift(r), () => {});
    return () => void (stop = true);
  }, [data?.files, chkLock]);
  // Java backends (spring.ts): migrations edited or out of order (the base's migration folders, listed), JPA entities
  // changed with no migration (their files, read).
  const [backend, setBackend] = useState<{ mig: MigrationIssue[]; ent: Awaited<ReturnType<typeof entityWithoutMigration>> }>({ mig: [], ent: [] });
  useEffect(() => {
    setBackend({ mig: [], ent: [] });
    if (!data || (!chkMigrations && !chkJpa)) return;
    let stop = false;
    const folders = [...new Set(data.files.filter((f) => isMigration(f.filename)).map((f) => f.filename.slice(0, f.filename.lastIndexOf('/'))))];
    Promise.all([
      chkMigrations
        ? Promise.all(folders.map((d) => listDir(repo, d, data.pr.base.sha).then((l) => [d, l.map((x) => x.path)] as const, () => [d, [] as string[]] as const))).then((ls) => migrationIssues(data.files, new Map(ls)))
        : [],
      chkJpa ? entityWithoutMigration(data.files, (f) => (wholeFromPatch(f) != null ? Promise.resolve(wholeFromPatch(f)) : getRaw(data.headRepo, f.filename, data.pr.head.sha))) : [], // an added file's diff is the file
    ]).then(([mig, ent]) => !stop && setBackend({ mig, ent }), () => {});
    return () => void (stop = true);
  }, [data?.files, chkMigrations, chkJpa]);
  const [showPlan] = useStoredFlag('reviewPlan', false);
  // Room tables changed with no database version raised (room.ts): it reads the files it needs, so after the PR.
  const [room, setRoom] = useState<SchemaChange[]>([]);
  useEffect(() => {
    setRoom([]);
    if (!data || !chkRoom) return;
    let stop = false;
    const read = (f: { filename: string; status: string; patch?: string }) =>
      wholeFromPatch(f) != null ? Promise.resolve(wholeFromPatch(f)) : f.status === 'removed' ? getRaw(repo, f.filename, data.pr.base.sha) : getRaw(data.headRepo, f.filename, data.pr.head.sha); // an added or removed file's diff is the file
    roomCheck(data.files, read).then((r) => !stop && setRoom(r), () => {});
    return () => void (stop = true);
  }, [data?.files, chkRoom]);
  useEffect(() => {
    if (!data) return;
    let stop = false;
    myOwnedFiles(repo, data.files.map((f) => f.filename)).then((l) => !stop && setOwned(new Set(l)), () => {});
    return () => void (stop = true);
  }, [data?.files]);
  if (error) return <p class="error page">{error} <Retry onClick={() => (setError(''), dispatchEvent(new Event('lgtm:refresh')))} /></p>;
  if (!data) return <PRSkeleton pr={early} />;
  const { pr, headRepo } = data;
  // The commit on show, undone on the branch (your PR, or one you may push to), after asking.
  const canRevert = commitView && firstSha === toSha && pr.state === 'open' && !!rights?.update;
  const revertShown = async () => {
    const c = commits[ci(toSha)];
    if (!canRevert || !c) return;
    if (!(await ask(`Revert ${c.sha.slice(0, 7)} "${c.label}" on ${pr.head.ref}? A new commit undoes it.`, 'Revert'))) return;
    try {
      await revertCommit(headRepo, pr.head.ref, pr.head.sha, c.sha, c.label);
      setNotice({ ok: true, text: `Reverted ${c.sha.slice(0, 7)} on ${pr.head.ref}.` });
      showCommit(null);
      dispatchEvent(new Event('lgtm:refresh'));
    } catch (e) {
      setNotice({ ok: false, text: `Couldn't revert it: ${(e as Error).message}` });
    }
  };
  const files = since && sinceData ? sinceData.files : data.files;
  const { drafts } = saved;

  // Drafts remember the commit they were written on, so a push mid-review doesn't orphan them.
  function saveDrafts(next: Draft[]) {
    const s = { sha: drafts.length ? saved.sha : pr.head.sha, drafts: next };
    setSaved(s);
    (next.length ? storage.set(key, s) : storage.remove(key)).catch((e) => setError(e.message));
  }

  // step: what it's doing now, for the button. merge: an approval, then merged (or auto-merge) once it may be.
  // Moving on (the next PR, review mode): the next one opens at once and the review goes in the background; a failure
  // says so, with a way back to it, its comments and summary as they were (they're cleared once it's in).
  async function submit(event: ReviewEvent, body: string, notify: boolean, next: boolean, step: (s: string) => void = () => {}, merge = false): Promise<boolean | 'sending'> {
    if (practice) return onSubmitted(event), onReviewed(null, event), true;
    // Comments still on their way into the pending review: wait for them, then go by what's here and what's there now.
    const k0 = `${repo}#${n}`;
    let drafts = saved.drafts;
    let pending = pendingNow;
    if (toPendingChain.has(k0)) {
      step('Saving your comments…');
      await toPendingChain.get(k0)!.catch(() => {});
      toPendingChain.delete(k0);
      drafts = (await storage.get<Saved>(key))?.drafts ?? [];
      pending = await getPendingReview(repo, n).catch(() => pendingNow);
    }
    // GitHub won't take a comment or a change request with nothing in it. A comment with nothing new (my comments
    // already posted one by one) has nothing to send: it's done, move on. A change request needs to say what.
    if (event === 'REQUEST_CHANGES' && !body.trim() && !drafts.length && !pending?.count) {
      if (!mySummary) throw new Error('Write what to change in the summary first.'); // no comments of mine to say it
      body = mySummary;
    }
    if (event !== 'APPROVE' && !body.trim() && !drafts.length && !pending?.count) {
      noteReadSaved(`${repo}#${n}`, trimmedLines);
      onSubmitted(event);
      if (next || focus) onReviewed(null, event);
      else setNotice({ ok: true, text: `Your comments are already on ${site(repo)}: nothing more to send.` });
      return true;
    }
    // Comments written on an older commit: new commits move them with their lines, and only ones whose lines changed
    // need asking about, here, before anything goes.
    let sha = '';
    let send = drafts;
    if (drafts.length) {
      step('Checking for new commits…');
      const now = await getPR(repo, n);
      sha = saved.sha;
      if (sha !== now.head.sha) {
        const { moved, stuck } = await moveDrafts(repo, n, drafts, sha, pr, now);
        if (!stuck) (send = moved), (sha = now.head.sha);
        else if (!(await ask(`New commits changed the lines under ${stuck === drafts.length ? (stuck === 1 ? 'your comment' : `your ${stuck} comments`) : `${stuck} of your ${drafts.length} comments`}. Submit ${drafts.length === 1 ? 'it' : 'them all'} on the older commit, where ${drafts.length === 1 ? 'it was' : 'they were'} written?`, 'Submit'))) return false;
      }
    }
    const k = `${repo}#${n}`;
    const job = (async (): Promise<Notice | null> => {
      step('Submitting…');
      if (!sha) sha = (await getPR(repo, n)).head.sha;
      await submitReview(pr.node_id, sha, event, body, send, pending?.id).catch((e) => {
        // Comments that made it into the review on GitHub are there now: a retry sends only the rest.
        if (e.sent?.length) saveDrafts(drafts.filter((d) => !e.sent.includes(d.id))), setPending((p) => p && { ...p, count: p.count + e.sent.length });
        throw e;
      });
      setPending(null);
      saveDrafts([]);
      void storage.remove(`summary:${k}`);
      // A Claude Code session or Codex conversation sent this PR here: offer to send it the outcome.
      const from = linkedSession(repo, n);
      if (from) {
        const text = reviewDonePrompt(pr, event, body, drafts.map((d) => ({ path: d.path, line: d.line, body: d.body })));
        dispatchEvent(
          new CustomEvent('lgtm:toast', {
            detail: { text: `${k} has a ${from.agent === 'codex' ? 'Codex conversation' : 'Claude Code session'}.`, action: ['Send it your review', () => void backToSession(from.id, text, from.agent).then((note) => dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: note } })))] },
          }),
        );
      }
      if (event === 'APPROVE') void markDoneOnSlack(k, pr.user.login);
      noteReadSaved(k, trimmedLines);
      dropNotices((x) => x.pr === k && (x.what === 'Review requested' || x.what === 'Your comments were resolved')); // the bell's: answered
      onSubmitted(event);
      const said: Notice[] = [];
      if (merge && event === 'APPROVE') {
        step('Merging…');
        said.push(await mergeOnceApproved(repo, n).catch((e) => ({ ok: false, text: `Approved, but it didn't merge: ${e.message}` })));
      }
      if (notify && slackTo?.length) {
        step('Messaging on Slack…');
        // The review is in; a Slack failure is reported, not thrown.
        try {
          const text = slackText(pr, repo, n, event, body, drafts.length ? drafts.map((d) => d.path) : me ? allThreads.filter((t) => !t.isResolved && t.comments.nodes.some((c) => c.author?.login === me)).map((t) => t.path) : []);
          // Asked about it on Slack (Settings → Slack): the answer replies there, tagging who asked; the others by DM.
          const asked = await askFor(repo, n).catch(() => null);
          let there = '';
          if (asked) {
            await slackReply(asked.channel, asked.thread, `<@${asked.user}> ${text}`);
            there = `Answered in the thread where ${asked.login ? '@' + asked.login : asked.name ?? 'they'} asked on Slack.`;
          }
          const rest = asked?.login ? slackTo.filter((l) => l !== asked.login) : slackTo;
          const results = rest.length ? await notifySlack(await slackRecipients(repo, rest), text, k) : [];
          slackStatus(k).then((s) => setSlackThreads(s.threads)); // a first message starts a thread
          const failed = results.filter((r) => !r.ok);
          const sent = results.filter((r) => r.ok).map((r) => '@' + r.login + (r.threaded ? ' (in the existing thread)' : '') + (r.at ? ' (at 9 am their time)' : ''));
          said.push({
            ok: !failed.length,
            text: [there, sent.length && `Messaged ${sent.join(', ')} on Slack.`, ...failed.map((r) => `Couldn't message @${r.login}: ${slackWhy(r)}`)].filter(Boolean).join(' '),
          });
        } catch (e: any) {
          said.push({ ok: false, text: `Review submitted, but Slack failed: ${e.message}` });
        }
      }
      for (const s of said) if (!s.ok) reportError(s.text, { route: `/${repo}/pull/${n}`, name: `${repoLabel(repo)}${numRef(repo, n)}` }); // the review is in; Slack or the merge didn't go; named, as you may be on the next PR by now
      return said.length ? { ok: said.every((s) => s.ok), text: said.map((s) => s.text).filter(Boolean).join(' ') } : null;
    })();
    if (!(next || focus)) {
      setNotice(await job);
      step('Loading the threads…');
      const [t, c] = await Promise.all([getThreads(repo, n), getConversation(repo, n)]);
      setThreads(t);
      setConversation(c);
      return true;
    }
    sending.set(k, job);
    job.then(
      (r) => r?.ok && r.text && dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `${k}: ${r.text}` } })),
      (e) => {
        reportError(`Your review of ${k} didn't go: ${e.message}`);
        dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `Your review of ${k} didn't go: ${e.message}. Its comments and summary are as you left them.`, action: ['Back to it', () => (location.hash = `/${repo}/pull/${n}`)], ms: 120_000 } }));
      },
    ).finally(() => sending.delete(k));
    step(`Opening the next ${pageTerm().PR}…`);
    await onReviewed(null, event);
    return 'sending';
  }

  const mainLang = majorityLanguage(data.files.filter((f) => !f.generated).map((f) => f.filename));
  const [flagUntested] = useStoredFlag('flagUntested', true);
  const supp = useMemo(() => (chkSupp ? switchedOff(data.files.filter((f) => !f.generated)) : []), [data.files, chkSupp]);
  const unsafe = useMemo(() => (chkUnsafe ? protectionsOff(data.files.filter((f) => !f.generated)) : []), [data.files, chkUnsafe]);
  const goneTests = useMemo(() => (cleanRevert ? [] : deletedTests(data.files)), [data.files, cleanRevert]);
  const noTests = useMemo(() => new Set(flagUntested && !cleanRevert ? untested(data.files.filter((f) => !f.generated)) : []), [data.files, flagUntested, cleanRevert]);
  // Modules (Settings → Reviewing), from where the repo's build files sit: with 2+ touched the index groups files by
  // them and files are tagged; with one, a pill names it.
  const [byModule] = useStoredFlag('gradleModules', true);
  const modules = useMemo(() => modulesOf(data.files.map((f) => f.filename), roots), [data.files, roots]);
  const codeIx = useMemo(() => codeIndex(data.files), [data.files]);
  // My own @name in comments stands out (GitHub links each mention to the person's page).
  useEffect(() => {
    if (!me || !/^[\w.-]+$/.test(me)) return;
    const st = document.createElement('style');
    st.textContent = `a.user-mention[href$="/${me}" i] { background: var(--mention-me); border-radius: 4px; padding: 0 3px; color: var(--fg); font-weight: 600; }`;
    document.head.append(st);
    return () => st.remove();
  }, [me]);
  // My PR: the threads waiting on me whose lines a later commit changed (as ThreadView's "Fixed in"), each with those
  // commits, so one click answers them all.
  const fixable = useMemo(
    () => (!me || data.pr.user.login !== me ? [] : threads.filter((t) => awaitsMe(t, me, true) && !t.isResolved && (t.isOutdated || sinceComment.get(t.id)?.kind === 'changed') && t.comments.nodes.some((c) => c.author?.login !== me && c.state !== 'PENDING'))),
    [threads, sinceComment, me, data.pr.user.login],
  );
  const [allFixes, setAllFixes] = useState<{ t: Thread; fixes: Fix[] }[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all(fixable.map((t) => {
      const theirs = t.comments.nodes.findLast((c) => c.author?.login !== me && c.state !== 'PENDING')!;
      return fixedIn(repo, data.pr.head.sha, t.path, t.line && !t.isOutdated ? [t.startLine ?? t.line, t.line] : null, theirs.createdAt).then((fixes) => ({ t, fixes }), () => ({ t, fixes: [] }));
    })).then((r) => live && setAllFixes(r.filter((x) => x.fixes.length)));
    return () => void (live = false);
  }, [fixable, data.pr.head.sha]);
  // Settings → Reviewing: a file scrolled past, after a few seconds on screen, marked viewed (and left open, so nothing
  // above it folds and moves the page). Not on commits on their own or your threads (not the PR's files as they are).
  const [viewOnScroll] = useStoredFlag('viewOnScroll', false);
  const viewedNow = useRef(viewed);
  viewedNow.current = viewed;
  const markNow = useRef(markViewed);
  markNow.current = markViewed;
  useEffect(() => {
    if (!viewOnScroll || commitView || onlyMine) return;
    const onScreen = new Map<string, number>(); // when each file came into view
    const once = new Set<string>(); // marked here already: unmarked again (Undo, or by hand), it stays unmarked
    let raf = 0;
    const check = () => {
      raf = 0;
      const now = Date.now(), past: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('main section.file[id^="f-"]')) {
        const path = el.id.slice(2), r = el.getBoundingClientRect();
        if (viewedNow.current.has(path) || once.has(path)) continue;
        if (r.bottom > 0 && r.top < innerHeight) onScreen.has(path) || onScreen.set(path, now);
        else if (r.bottom <= 0 && now - (onScreen.get(path) ?? now) >= 3000) past.push(path);
      }
      if (!past.length) return;
      for (const p of past) once.add(p);
      markNow.current(past, true);
      setExpanded((x) => new Set([...x, ...past]));
      offerUndo(`Marked ${past.length === 1 ? fileLabel(past[0]) : `${past.length} files`} viewed`, () => markNow.current(past, false)); // scrolled past without reading
    };
    const on = () => void (raf ||= requestAnimationFrame(check));
    addEventListener('scroll', on, { passive: true });
    const tick = setInterval(check, 1000); // what's on screen while you read, not only while scrolling
    return () => (removeEventListener('scroll', on), clearInterval(tick), cancelAnimationFrame(raf));
  }, [viewOnScroll, commitView, onlyMine]);
  const [symbolNav] = useStoredFlag('symbolNav', true); // Settings → Diff: where a declared name is used
  const symPeek = useRefPeek(codeIx); // a line in its list, previewed
  // What a backtick offers in comment boxes (editor.tsx): the declared names (with their file), then the files.
  useEffect(() => {
    const seen = new Set<string>();
    setCodeNames(
      [...[...codeIx.symbols].map(([name, r]) => ({ name, where: base(r.path) + (r.line ? `:${r.line}` : '') })), ...codeIx.files.map((f) => ({ name: base(f), where: f.slice(0, f.lastIndexOf('/') + 1) }))].filter((x) => !seen.has(x.name) && seen.add(x.name)),
    );
  }, [codeIx]);
  // Code names in comments (threads, the conversation) link to the code they name, previewed on hover, as the
  // description's and specs' do: linked as comments are drawn.
  const commentPeek = useRefPeek(codeIx);
  useEffect(() => {
    // Every comment at first, then only the ones a change brings (a file drawn as you scroll used to re-scan them all).
    const SEL = '.comment:not(#pr-description) .md';
    document.querySelectorAll<HTMLElement>(SEL).forEach((el) => linkSpecRefs(el, codeIx, false));
    const watch = new MutationObserver((ms) => {
      for (const m of ms) {
        (m.target as Element).closest?.<HTMLElement>(SEL) && linkSpecRefs((m.target as Element).closest<HTMLElement>(SEL), codeIx, false);
        for (const n of m.addedNodes) if (n instanceof HTMLElement) (n.matches(SEL) ? [n] : n.querySelectorAll<HTMLElement>(SEL)).forEach((el) => linkSpecRefs(el, codeIx, false));
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    const inComment = (e: Event) => !!(e.target as Element).closest?.('.comment:not(#pr-description) .md [data-jump]'); // the description has its own
    const over = (e: MouseEvent) => inComment(e) && commentPeek.over(e);
    const out = (e: MouseEvent) => inComment(e) && commentPeek.out();
    const click = (e: MouseEvent) => inComment(e) && commentPeek.click(e);
    addEventListener('mouseover', over);
    addEventListener('mouseout', out);
    addEventListener('click', click);
    return () => (watch.disconnect(), removeEventListener('mouseover', over), removeEventListener('mouseout', out), removeEventListener('click', click));
  }, [codeIx]);
  const refs = useMemo(() => specRefs(data.files, codeIx), [data.files, codeIx]);
  const none = { list: [], byPath: new Map() };
  const secrets = chkSecrets ? secretsOf(data.files) : none;
  const deps = chkDeps ? depsOf(data.files) : [];
  const texts = chkTexts ? textsOf(data.files) : none;
  // What a reviewer would point out, for asking on my own PR (AskReviewer): each with a jump to the first of it.
  const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const majors = deps.filter((d) => d.major);
  const txs = chkTx ? privateTransactional(data.files) : [];
  const web = webOf(data.files);
  const focusHits = chkFocus ? web.focus : [], html = chkHtml ? web.html : [];
  const migText = (m: MigrationIssue) =>
    m.kind === 'edited' ? 'an applied migration changed: Flyway refuses to start where it already ran' : m.kind === 'duplicate' ? 'the same version as one already on the base branch' : `older than ${m.newest}, the newest on the base branch: Flyway refuses it where that one ran`;
  const findings: { text: string; go: () => void }[] = [
    ...(unsafe.length ? [{ text: plural(unsafe.length, 'protection') + ' switched off', go: () => jumpToLine(unsafe[0].path, unsafe[0].line) }] : []),
    ...(secrets.list.length ? [{ text: plural(secrets.list.length, 'possible secret'), go: () => jumpToLine(secrets.list[0].path, secrets.list[0].line) }] : []),
    ...(texts.list.length ? [{ text: `${plural(texts.list.length, 'text')} not in strings.xml`, go: () => jumpToLine(texts.list[0].path, texts.list[0].line) }] : []),
    ...(room.length ? [{ text: `${room[0].entity}: a table changed with no database version raised`, go: () => jumpToLine(room[0].path, room[0].side === 'RIGHT' ? room[0].line : undefined) }] : []),
    ...backend.mig.map((m) => ({ text: `${base(m.path)}: ${migText(m)}`, go: () => jumpTo('f-' + m.path) })),
    ...(backend.ent.length ? [{ text: `${backend.ent[0].entity}: columns changed with no migration in this ${pageTerm().PR}`, go: () => jumpToLine(backend.ent[0].path, backend.ent[0].side === 'RIGHT' ? backend.ent[0].line : undefined) }] : []),
    ...drift.map((d) => ({ text: `${d.path}: dependencies changed, ${d.lock} not`, go: () => jumpToLine(d.path, d.line) })),
    ...(focusHits.length ? [{ text: `${plural(focusHits.length, 'focused test or debugger', 'focused tests or debuggers')} left in (${[...new Set(focusHits.map((f) => f.what))].join(', ')})`, go: () => jumpToLine(focusHits[0].path, focusHits[0].line) }] : []),
    ...(html.length ? [{ text: `${plural(html.length, 'place')} rendering raw HTML (${[...new Set(html.map((f) => f.what))].join(', ')})`, go: () => jumpToLine(html[0].path, html[0].line) }] : []),
    ...(txs.length ? [{ text: `${plural(txs.length, '@Transactional on a private method')}: it runs without a transaction`, go: () => jumpToLine(txs[0].path, txs[0].line) }] : []),
    ...(deps.some((d) => d.unpinned) ? [{ text: `${plural(deps.filter((d) => d.unpinned).length, 'dependency', 'dependencies')} not pinned`, go: () => jumpToLine(deps.find((d) => d.unpinned)!.path, deps.find((d) => d.unpinned)!.line) }] : []),
    ...(majors.length ? [{ text: `${plural(majors.length, 'major dependency jump')} (${majors.map((d) => d.name.split(':').pop()).join(', ')})`, go: () => jumpToLine(majors[0].path, majors[0].line) }] : []),
  ];
  // The threads the agent found addressed, resolved together once I say so; one undo puts them all back.
  const resolveAddressed = async () => {
    const list = threads.filter((t) => !t.isResolved && t.viewerCanResolve && check?.state === 'done' && check.verdicts[t.id]?.addressed);
    if (!list.length || !(await ask(`Resolve the ${list.length} thread${list.length > 1 ? 's' : ''} ${AGENTS[check!.by].short} found addressed?`, 'Resolve'))) return;
    const done: Thread[] = [];
    try {
      for (const t of list) await resolveThread(t.id, true), done.push(t);
    } catch (e: any) {
      dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `Resolved ${done.length} of ${list.length}: ${e.message}` } }));
    }
    setThreads(await getThreads(repo, n));
    if (done.length) offerUndo(`${done.length} thread${done.length > 1 ? 's' : ''} resolved`, () => Promise.all(done.map((t) => resolveThread(t.id, false))).then(async () => setThreads(await getThreads(repo, n))));
  };
  const ctx: Ctx = {
    codeIx,
    specRefs: refs,
    secrets: secrets.byPath,
    hardcoded: texts.byPath,
    flagged: (() => {
      // Each line finding's mark on its line, in its pill's colour (red: protections, focused tests and debugger).
      const m = new Map<string, Map<number, { bad: boolean; why: string }>>();
      const put = (path: string, line: number, bad: boolean, why: string) => (m.get(path) ?? m.set(path, new Map()).get(path)!).set(line, { bad, why });
      for (const u of unsafe) put(u.path, u.line, true, `${u.what}: ${u.why}`);
      for (const f of focusHits) put(f.path, f.line, true, f.what === 'debugger' ? 'A debugger left in: it stops the app in anyone\u2019s dev tools' : `${f.what}: CI runs only this test`);
      for (const x of supp) put(x.path, x.line, false, `${x.what}: ${x.ci ? 'a CI step let off' : x.test ? 'a test switched off' : 'a check silenced'}`);
      for (const h of html) put(h.path, h.line, false, `${h.what}: an XSS hole if any of it comes from users`);
      for (const t of txs) put(t.path, t.line, false, '@Transactional on a private method: Spring never sees the call, so no transaction');
      return m;
    })(),
    untested: noTests,
    modules: undefined, // set below, once the shown files are known
    sinceComment,
    pr,
    headRepo,
    target,
    // On commits on their own, a comment goes on the same lines in all changes, while they're still there unchanged.
    setTarget: commitView ? (t) => void commitTarget(t) : setTarget,
    // A finding's comment, drafted: the form opens on its line (or the file) with the text in, to edit or send.
    suggest: (path, line, body, side = 'RIGHT') => {
      setTarget({ path, side, line, body });
      if (line && side === 'RIGHT') jumpToLine(path, line);
      else jumpTo('f-' + path);
    },
    // A new comment shows at once and goes into my pending review on the site in the background (kept there, not on
    // this machine: on github.com too, and safe if this app's data goes); here until it's there, sent with the review
    // as before if that fails.
    addDraft: (d) => {
      const draft = { ...d, id: crypto.randomUUID() };
      saveDrafts([...drafts, draft]);
      if (practice) return;
      const k = `${repo}#${n}`;
      const job = (toPendingChain.get(k) ?? Promise.resolve())
        .then(() => postAgentFindings(repo, n, pr, [draft], '', 'pending'))
        .then(async () => {
          const [t, p] = await Promise.all([getThreads(repo, n), getPendingReview(repo, n)]);
          setSaved((s) => {
            const next = { ...s, drafts: s.drafts.filter((x) => x.id !== draft.id) };
            void (next.drafts.length ? storage.set(key, next) : storage.remove(key));
            return next;
          });
          setThreads(t);
          setPending(p);
        })
        .catch((e) => setNotice({ ok: false, text: `Your comment is kept here, not in your review on ${site(repo)} yet (${e.message}); it goes with the review.` }));
      toPendingChain.set(k, job);
    },
    updateDraft: (id, d) => saveDrafts(drafts.map((x) => (x.id === id ? { ...d, id } : x))),
    removeDraft: (id) => {
      const gone = drafts.find((d) => d.id === id);
      saveDrafts(drafts.filter((d) => d.id !== id));
      if (gone) offerUndo('Comment deleted', () => setSaved((s) => (s.drafts.some((d) => d.id === id) ? s : (void storage.set(key, { ...s, drafts: [...s.drafts, gone] }), { ...s, drafts: [...s.drafts, gone] }))));
    },
    // A reply shows at once (marked sending) and goes in the background; if it fails it's taken out again (the thread
    // gets its text back).
    reply: (t, body) => {
      const esc = body.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
      const temp: GhComment = { databaseId: -Date.now(), url: '', body, bodyText: body, bodyHTML: `<p style="white-space: pre-wrap">${esc}</p>`, createdAt: new Date().toISOString(), author: me ? { login: me } : null, state: 'SENDING' };
      const put = (f: (c: GhComment[]) => GhComment[]) => setThreads((ts) => ts.map((x) => (x.id === t.id ? { ...x, comments: { nodes: f(x.comments.nodes) } } : x)));
      put((c) => [...c, temp]);
      return reply(repo, n, t.comments.nodes[0].databaseId, body, t.id).then(
        (pendingNow) => {
          void getThreads(repo, n).then(setThreads, () => {});
          if (pendingNow) void getPendingReview(repo, n).then(setPending, () => {}); // it went into my review in progress
        },
        (e) => {
          put((c) => c.filter((x) => x !== temp));
          throw e;
        },
      );
    },
    // Resolved (or not) at once, then on the site; put back if that fails.
    resolve: async (t, resolve) => {
      const flip = (on: boolean) => setThreads((ts) => ts.map((x) => (x.id === t.id ? { ...x, isResolved: on, viewerCanUnresolve: on || x.viewerCanUnresolve, viewerCanResolve: !on || x.viewerCanResolve } : x)));
      flip(resolve);
      await resolveThread(t.id, resolve).catch((e) => (flip(!resolve), Promise.reject(e)));
      void getThreads(repo, n).then(setThreads, () => {});
      if (resolve) offerUndo('Thread resolved', () => resolveThread(t.id, false).then(async () => setThreads(await getThreads(repo, n)), (e) => setError(`Couldn't unresolve it: ${e.message}`)));
    },
    // As GitHub's "Add single comment": a one-comment review on the commit on show; then its thread appears.
    postNow: async (d) => {
      await submitReview(pr.node_id, pr.head.sha, 'COMMENT', '', [{ ...d, id: '' }]);
      setThreads(await getThreads(repo, n));
    },
    batch,
    toggleBatch: me && pr.user.login === me ? (x) => setBatch((b) => (b.some((y) => y.id === x.id) ? b.filter((y) => y.id !== x.id) : [...b, x])) : undefined,
    // Committed to the branch, their threads resolved (as GitHub does), then the PR reloads with the new commit.
    applySuggestions: async (list) => {
      await commitSuggestions(headRepo, pr.head.ref, pr.head.sha, list, me);
      await Promise.all([...new Set(list.map((x) => x.thread))].map((id) => resolveThread(id, true).catch(() => {})));
      setBatch((b) => b.filter((y) => !list.some((x) => x.id === y.id)));
      setNotice({ ok: true, text: `Committed ${list.length > 1 ? `${list.length} suggestions` : 'the suggestion'} to ${pr.head.ref}.` });
      dispatchEvent(new Event('lgtm:refresh'));
    },
    renderAll,
    pending: !!pending,
    editPending: async (id, body) => {
      await (body == null ? deleteReviewComment(id) : editReviewComment(id, body));
      const [t, p] = await Promise.all([getThreads(repo, n), getPendingReview(repo, n)]);
      setThreads(t);
      setPending(p);
    },
    dropPending: async (ids) => {
      let gone = 0;
      try {
        for (const id of ids) await deleteReviewComment(id), gone++;
      } finally {
        const [t, p] = await Promise.all([getThreads(repo, n), getPendingReview(repo, n)]);
        setThreads(t);
        setPending(p);
        if (gone < ids.length) setNotice({ ok: false, text: `Dropped ${gone} of ${ids.length}.` });
      }
    },
    restorePending: async (d) => {
      await postAgentFindings(repo, n, pr, [d], '', 'pending'); // into the pending review, as the agent put it
      const [t, p] = await Promise.all([getThreads(repo, n), getPendingReview(repo, n)]);
      setThreads(t);
      setPending(p);
    },
    since: since && !!sinceData,
    me,
    mainLang,
    langFor: (path) => (path && !isMarkdown(path) && languageFor(path)) || mainLang,
    ignoreWs,
    moved,
    repeats: repeatedFindings(allThreads),
    repo,
    mentions: [
      ...new Set(
        [pr.user, ...pr.assignees, ...(pr.requested_reviewers ?? [])].map((u) => u.login)
          .concat(conversation.map((c) => c.author), threads.flatMap((t) => t.comments.nodes.map((c) => c.author?.login ?? '')))
          .filter((l) => l && !l.endsWith('[bot]') && l !== 'ghost'),
      ),
    ],
    files,
    checked: check?.state === 'done' ? check.verdicts : {},
    checkBy: check?.by,
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

  // Optimistic; GitHub's state is the source of truth, so a failure puts it back. Several at once from the index (a
  // folder, a module).
  function markViewed(paths: string[], on: boolean) {
    const change = paths.filter((p) => viewed.has(p) !== on);
    if (!change.length) return;
    const apply = (v: boolean) =>
      setViewedPaths((s) => {
        const x = new Set(s);
        for (const p of change) v ? x.add(p) : x.delete(p);
        return x;
      });
    apply(on);
    setExpanded((s) => {
      const x = new Set(s);
      for (const p of change) x.delete(p);
      return x;
    });
    setViewed(pr.node_id, change, on).catch((e) => {
      apply(!on);
      setNotice({ ok: false, text: `Couldn't update "Viewed" on ${site(repo)}: ${e.message}` });
    });
  }
  const toggleViewed = (path: string) => markViewed([path], !viewed.has(path));
  // Ask a reviewer to look again, from the index (my own PR): a re-request on GitHub, then the "again" message on Slack
  // (in your thread with them; none if that message is emptied, or there's no Slack). The PR reloads to show them asked.
  // A review request taken back (the index's ×), after asking; the Slack message lgtm sent them about it goes too.
  async function withdraw(login: string): Promise<boolean> {
    const last = slackThreads.some((t) => t.login === login && t.last);
    if (!(await ask(`Take back the review request for ${shownAt(login, repo)}?${last ? ' The Slack message lgtm sent them about it is deleted too.' : ''}`, 'Take back'))) return false;
    try {
      await unrequestReview(repo, n, login);
    } catch (e: any) {
      setNotice({ ok: false, text: `Couldn't take back the request for @${login}: ${e.message}` });
      return false;
    }
    const r: { ok: boolean; error?: string; edited?: boolean; followedUp?: boolean } = last ? await slackDelete(`${repo}#${n}`, login).catch((e: Error) => ({ ok: false, error: e.message })) : { ok: true };
    setNotice({ ok: r.ok, text: `Took back the review request for @${login}${slackGone(r, last)}` });
    dispatchEvent(new Event('lgtm:refresh'));
    void slackStatus(`${repo}#${n}`).then((st) => setSlackThreads(st.threads), () => {});
    return true;
  }
  async function reRequest(login: string): Promise<boolean> {
    try {
      await requestReview(repo, n, login);
      if (data) void ticketsToReview(jiraKeys(data.pr.title, data.pr.head.ref));
    } catch (e: any) {
      setNotice({ ok: false, text: `Couldn't ask @${login} again on ${site(repo)}: ${e.message}` });
      return false;
    }
    let note = `Asked @${login} to review again.`;
    const text = fillSlack(slackTemplate('again'), prValues({ repo, number: n, title: pr.title, url: pr.html_url, author: pr.user.login }));
    if (text && slackPeople !== null) {
      try {
        const where = await againInThread(`${repo}#${n}`, [login], text);
        const [r] = where ? [{ ok: true, error: '' }] : await notifySlack(await slackRecipients(repo, [login]), text, `${repo}#${n}`);
        note = where ? `Asked @${login} to review again, on ${site(repo)} and in ${where} on Slack.` : r?.ok ? `Asked @${login} to review again, on ${site(repo)} and Slack.` : `Asked @${login} again on ${site(repo)}; Slack didn't reach them: ${r?.error ?? 'no reply'}`;
      } catch (e: any) {
        note = `Asked @${login} again on ${site(repo)}; Slack failed (${e.message}).`;
      }
    }
    setNotice({ ok: !note.includes("didn't") && !note.includes('failed'), text: note });
    dispatchEvent(new Event('lgtm:refresh'));
    return true;
  }
  // Ask a reviewer on Slack, from the index (my own PR): the "ask" message (Settings → Slack → Messages); its thread
  // then shows by the title.
  async function askOnSlack(login: string): Promise<boolean> {
    try {
      const text = fillSlack(slackTemplate('ask'), prValues({ repo, number: n, title: pr.title, url: pr.html_url, author: pr.user.login }));
      const [r] = await notifySlack(await slackRecipients(repo, [login]), text, `${repo}#${n}`);
      setNotice(r?.ok ? { ok: true, text: `Asked @${login} for a review on Slack.` } : { ok: false, text: `Slack didn't reach @${login}: ${r?.error ?? 'no reply'}` });
      if (r?.ok) slackStatus(`${repo}#${n}`).then((s) => setSlackThreads(s.threads), () => {});
      return !!r?.ok;
    } catch (e: any) {
      setNotice({ ok: false, text: `Slack failed: ${e.message}` });
      return false;
    }
  }

  // Only the files I own, when asked (the pill, o), and I own some but not all; the rest of the page still knows them all.
  const ownSome = owned.size > 0 && files.some((f) => !owned.has(f.filename));
  const viewFiles = onlyOwned && ownSome ? files.filter((f) => owned.has(f.filename)) : files;
  // With whitespace ignored, files whose every change is whitespace wait behind one row too.
  const wsOnlySet = new Set(
    ignoreWs ? viewFiles.filter((f) => !f.generated && !f.noDiff && whitespaceOnly(f)).map((f) => f.filename) : [],
  );
  // And, with imports folded, files whose every change is an import.
  const importsOnlySet = new Set(
    foldImports ? viewFiles.filter((f) => !f.generated && !f.noDiff && !wsOnlySet.has(f.filename) && onlyImports(f, ignoreWs)).map((f) => f.filename) : [],
  );
  // Specs in an archive folder (docs/archive/…, specs/archived/…): history, not this change (Settings → Diff).
  const archivedSet = new Set(foldArchived ? viewFiles.filter((f) => !f.generated && !f.noDiff && isArchivedSpec(f.filename)).map((f) => f.filename) : []);
  const visible = viewFiles.filter((f) => !f.generated && !f.noDiff && !wsOnlySet.has(f.filename) && !importsOnlySet.has(f.filename) && !archivedSet.has(f.filename));
  const wsFolded = ignoreWs ? visible.reduce((n, f) => n + wsSections(f).folded, 0) : 0; // sections folded in the rest
  const generated = viewFiles.filter((f) => f.generated);
  const noDiff = viewFiles.filter((f) => f.noDiff && !f.generated);
  const wsOnly = viewFiles.filter((f) => wsOnlySet.has(f.filename));
  const importOnly = viewFiles.filter((f) => importsOnlySet.has(f.filename));
  const archived = viewFiles.filter((f) => archivedSet.has(f.filename) && !wsOnlySet.has(f.filename) && !importsOnlySet.has(f.filename));
  const genOpen = showGenerated || !foldGenerated, noDiffOpen = showNoDiff || !foldNoDiff;
  // The files on show in reading order (files.ts reviewPlan: specs, build, models, the change, tests, resources) or
  // GitHub's (Settings → Pull request view); a big PR also gets the plan itself, with how much of each step is viewed.
  const steps = readingOrder || showPlan ? reviewPlan(reviewOrder(visible.map((f) => f.filename)), stepOrder(stepsSaved)) : [];
  const plan = showPlan && visible.length >= PLAN_AT ? steps : null;
  const rank = readingOrder ? new Map(steps.flatMap((s) => s.paths).map((p, i) => [p, i])) : null;
  const inOrder = rank ? visible.toSorted((a, b) => rank.get(a.filename)! - rank.get(b.filename)!) : visible;
  const shown = [...inOrder, ...(genOpen ? generated : []), ...(noDiffOpen ? noDiff : []), ...(showWsOnly ? wsOnly : []), ...(showImportsOnly ? importOnly : []), ...(showArchived ? archived : [])];
  knowFiles(shown.map((f) => f.filename)); // names unique among the files on show (files.ts fileLabel), before they draw
  // What waits behind a row, for the index to say so too.
  const hiddenRows = [
    [generated.length && !genOpen, `${generated.length} generated file${generated.length > 1 ? 's' : ''}`, () => setShowGenerated(true)],
    [noDiff.length && !noDiffOpen, `${noDiff.length} file${noDiff.length > 1 ? 's' : ''} with no content change`, () => setShowNoDiff(true)],
    [wsOnly.length && !showWsOnly, `${wsOnly.length} whitespace-only`, () => setShowWsOnly(true)],
    [importOnly.length && !showImportsOnly, `${importOnly.length} imports-only`, () => setShowImportsOnly(true)],
    [archived.length && !showArchived, `${archived.length} archived spec${archived.length > 1 ? 's' : ''}`, () => setShowArchived(true)],
  ].filter(([on]) => on).map(([, label, show]) => ({ label: label as string, show: show as () => void }));
  // How much of the PR's change lgtm keeps out of sight: the files behind a row, and in the files on show their
  // whitespace-only changes, folded imports and deleted files' contents.
  const replacedVerdicts = new Set([...earlierVerdicts(conv).values()].flat());
  const changedIn = (fs: File[]) => fs.reduce((n, f) => n + f.additions + f.deletions, 0);
  const inShown = inOrder.filter((f) => !(collapseDeleted && f.status === 'removed')).map((f) => hiddenIn(f, ignoreWs, foldImports)); // a collapsed deleted file counts whole, below
  const trimmed = ([
    [genOpen ? 0 : changedIn(generated), 'generated files', () => setShowGenerated(true)],
    [showArchived ? 0 : changedIn(archived), 'archived specs', () => setShowArchived(true)],
    [showWsOnly ? 0 : changedIn(wsOnly), 'files with only whitespace changes', () => setShowWsOnly(true)],
    [showImportsOnly ? 0 : changedIn(importOnly), 'files with only import changes', () => setShowImportsOnly(true)],
    [inShown.reduce((n, h) => n + h.ws, 0), 'whitespace changes in other files', toggleWs],
    [inShown.reduce((n, h) => n + h.imports, 0), 'folded imports', undefined],
    [collapseDeleted ? inOrder.filter((f) => f.status === 'removed').reduce((n, f) => n + f.deletions, 0) : 0, 'deleted files, collapsed', undefined],
    [split ? 0 : inOrder.filter((f) => !(collapseDeleted && f.status === 'removed')).reduce((n, f) => n + movedIn(f, moved.get(f.filename)), 0), 'moved without changes, folded', undefined],
    // Comments, by their lines of text: resolved and outdated threads, bots' comments, verdicts a later one replaced.
    [hiddenThreads ? linesIn(allThreads.filter(settled).flatMap((t) => t.comments.nodes.map((c) => c.bodyText ?? c.body ?? ''))) : 0, `lines in ${hiddenThreads} resolved or outdated thread${hiddenThreads === 1 ? '' : 's'}`, () => setShowSettled()],
    [botsFolded ? linesIn(conv.filter((c) => c.bot && !replacedVerdicts.has(c.id)).map((c) => htmlText(c.html))) : 0, `lines in bots' comments`, undefined],
    [botsFolded ? linesIn(allThreads.filter((t) => !(hiddenThreads && settled(t)) && !t.isResolved && !t.isOutdated && foldedAsBot(t, !!me && awaitsMe(t, me, pr.user.login === me))).flatMap((t) => t.comments.nodes.map((c) => c.bodyText ?? c.body ?? ''))) : 0, `lines in bots' and agents' threads, folded`, undefined],
    [linesIn(conv.filter((c) => replacedVerdicts.has(c.id)).map((c) => htmlText(c.html))), `lines in reviews a later one replaced`, undefined],
  ] as [number, string, (() => void) | undefined][]).filter(([n]) => n > 0);
  const toRead = changedIn(files) + linesIn(allThreads.flatMap((t) => t.comments.nodes.map((c) => c.bodyText ?? c.body ?? ''))) + linesIn(conv.map((c) => htmlText(c.html)));
  const trimmedLines = trimmed.reduce((n, [k]) => n + k, 0), changedLines = toRead;
  // Centred, a changed line too wide for it: the PR fills the window instead (Settings → Diff); tabs count as 4.
  const tooWide = centered && (split || (fit && visible.some((f) => f.patch?.split('\n').some((l) => l[0] !== '@' && l.length > Number(cols) + 1 && l.replace(/\t/g, '    ').length > Number(cols) + 1))));
  // Modules as the files on show have them (not the ones waiting behind a row).
  const shownModules = new Map(shown.map((f) => [f.filename, modules.get(f.filename) ?? '']));
  const view = byModule ? moduleView(shownModules) : 'none';
  ctx.modules = view === 'all' ? shownModules : undefined;
  const section = (f: File) => (
    <FileSection
      key={f.filename}
      file={f}
      ctx={ctx}
      threads={byPath.get(f.filename) ?? []}
      drafts={commitView ? [] : drafts.filter((d) => d.path === f.filename)}
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
  const askQa = !!(mine && qaRequest && !slackThreads.some((t) => t.login === '#qa')); // Ask QA, in the ⋯ menu
  const fileAt = new Map([...shown, ...files].reverse().map((f, k, all) => [f.filename, all.length - k])); // as shown, hidden ones after
  agentDraftsRef.current = allThreads
    .flatMap((t) => t.comments.nodes.filter((c) => c.state === 'PENDING' && c.id && agentSays(c.body)).map((c) => ({ id: c.id!, path: t.path, line: t.line ?? 0 })))
    .sort((a, b) => (fileAt.get(a.path) ?? 0) - (fileAt.get(b.path) ?? 0) || a.line - b.line);
  const lookedSet = new Set(lookedDrafts());
  const unlooked = agentDraftsRef.current.filter((d) => !lookedSet.has(d.id)).length;
  // Threads I started that are still open and whose code hasn't changed since (or no commit came after): approving
  // past them is worth a word in the submit panel.
  const stillOpen = me
    ? allThreads
        .filter((t) => !t.isResolved && t.comments.nodes[0]?.author?.login === me && (sinceComment.get(t.id)?.kind === 'same' || t.comments.nodes[0]?.originalCommit?.oid === pr.head.sha))
        .map((t) => ({ id: t.id, path: t.path, line: t.line }))
    : [];
  // Unresolved threads, for the merge box: the ones waiting on my reply first.
  const openThreads = allThreads
    .filter((t) => !t.isResolved)
    .map((t) => ({ id: t.id, path: t.path, awaiting: !!me && awaitsMe(t, me, pr.user.login === me), bot: t.comments.nodes.every((c) => c.author?.__typename === 'Bot') }))
    .sort((a, b) => +b.awaiting - +a.awaiting);
  const myOpenThreads = me ? allThreads.filter((t) => !t.isResolved && t.comments.nodes.some((c) => c.author?.login === me)).length : 0;
  const mySummary = me ? changesSummary(allThreads, me) : '';
  // On my PR: a reviewer who's away swapped (swapReviewer), past the ones asked and who've reviewed.
  const replaceReviewer = (login: string) =>
    swapReviewer(repo, n, login, [me, ...bots, ...(pr.requested_reviewers ?? []).map((u) => u.login), ...conversation.filter((c) => c.state).map((c) => c.author)], { title: pr.title, url: pr.html_url, author: pr.user.login });
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
  // `named`: an action picked by name (⌘K, lgtm:act), not a key: none of a key's checks apply.
  keys.current = (e: KeyboardEvent, named?: Action) => {
    if (named) return run(named);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') return setRenderAll(true); // then the browser's find opens
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if ((e.target as Element).closest('textarea, input')) return; // forms handle their own ⌘↵
      e.preventDefault();
      return dispatchEvent(new Event('lgtm:finish'));
    }
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === ' ' && (e.target as Element).closest('button, a, summary, label')) return; // Space presses a focused control
    // Shift with a letter is its capital (some keyboards report the letter as typed, with Shift held).
    const k = e.key === '/' && e.shiftKey ? '?' : e.shiftKey && /^[a-z]$/.test(e.key) ? e.key.toUpperCase() : e.key;
    if (k === 'Escape') return setHelp(false);
    const a = ACTIONS.find(([a]) => bindings[a] === k)?.[0];
    if (a) {
      e.preventDefault();
      run(a);
    }
  };
  function run(a: Action) {
    const sections = [...document.querySelectorAll<HTMLElement>('main > .file')];
    const top = 46 + 44 + 60;
    const cur = sections.reduce((c, s, i) => (s.getBoundingClientRect().top <= top ? i : c), -1);
    const path = sections[Math.max(cur, 0)]?.id.slice(2);
    const ordered = threadOrder(shownThreads, drafts, shown);
    // The next (or previous) change below the bars: where a run of changed lines starts, or a changed block in a
    // rendered markdown file. Files draw as they come near, so past the last drawn one, the next file with changes.
    const jumpChange = (dir: 1 | -1, again = true) => {
      const isChange = (el: Element | null) => !!el?.matches('tr.ln.a, tr.ln.d');
      const starts = [...document.querySelectorAll<HTMLElement>('main > .file tr.ln.a, main > .file tr.ln.d, main > .file [data-chg]')].filter(
        (el) => !el.matches('tr') || !isChange(el.previousElementSibling),
      );
      const at = (el: HTMLElement) => el.getBoundingClientRect().top - top;
      const next = dir > 0 ? starts.find((el) => at(el) > 2) : starts.findLast((el) => at(el) < -2);
      if (next) return scrollBy({ top: at(next) });
      const file = dir > 0 ? sections.slice(cur + 1).find((s) => !s.querySelector('table.diff, .rich')) : null;
      if (!file) return;
      file.scrollIntoView();
      if (again) setTimeout(() => jumpChange(dir, false), 250); // once it has drawn, its first change
    };
    // The index's Details (shortcuts.tsx): shown first if it's hidden, then asked to open a picker or flip a switch.
    const details = (what: string) => (showIndex || toggleIndex(), setTimeout(() => dispatchEvent(new CustomEvent('lgtm:details', { detail: what })), showIndex ? 0 : 150));
    const act: Record<Action, () => void> = {
      usages: () => {}, // symbolnav.tsx, which knows the name under the mouse
      nextFile: () => sections[Math.min(cur + 1, sections.length - 1)]?.scrollIntoView(),
      prevFile: () => sections[Math.max(cur - 1, 0)]?.scrollIntoView(),
      // The next file not marked viewed (after the last, the first one left).
      quoteReply: () => void (quoteSelection() || dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: 'Select text in a comment to quote it', ms: 2500 } }))),
      agentSession: () => {
        const sess = agentRunOf({ id: pr.node_id })?.session;
        const say = (text: string) => dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text, ms: 3500 } }));
        if (!sess) return say(`No kept session for this ${pageTerm().PR}'s agent review (Settings → Coding agents → Keep agent review sessions)`);
        openAgentSession(sess, claudeFolder(repo)).catch((e: Error) => say(`Couldn't open the session: ${e.message}`));
      },
      fixedAll: () => (allFixes.length > 1 ? dispatchEvent(new Event('lgtm:fixed-all')) : dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: allFixes.length ? 'One thread to answer: its own "Fixed in" button' : 'No threads waiting on you that later commits changed', ms: 3000 } }))),
      nextUnviewed: () => {
        const left = (s: HTMLElement) => !viewed.has(s.id.slice(2));
        const to = sections.slice(cur + 1).find(left) ?? sections.find(left);
        if (to) to.scrollIntoView();
        else dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: 'Every file is viewed', ms: 2500 } }));
      },
      nextChange: () => jumpChange(1),
      prevChange: () => jumpChange(-1),
      nextThread: () => ordered.length && go(Math.min(threadCursor.current + 1, ordered.length - 1)),
      prevThread: () => ordered.length && go(Math.max(threadCursor.current - 1, 0)),
      viewed: () => path && toggleViewed(path),
      fileComment: () => path && ctx.setTarget({ path, side: 'RIGHT' }),
      comment: () => commentAtCurrentLine() || scrollBy({ top: innerHeight * 0.85 }), // nothing to comment on: scroll as Space would
      index: toggleIndex,
      whitespace: toggleWs,
      finish: () => dispatchEvent(new Event('lgtm:finish')), // SubmitPanel opens, its summary box focused
      approve: () => dispatchEvent(new CustomEvent('lgtm:finish', { detail: { event: 'APPROVE' } })), // …with Approve picked
      // The next or previous PR as the list shows it (its tab, groups and order), from the one open.
      browse: () => dispatchEvent(new Event('lgtm:browse')), // main.tsx: the Browse tab, its switcher open
      prActions: () => dispatchEvent(new Event('lgtm:pr-acts')), // StateMenu opens
      askQa: () => (askQa ? dispatchEvent(new Event('lgtm:ask-qa')) : setNotice({ ok: true, text: mine ? 'QA is asked already, or no QA channel is set (Settings → Slack).' : 'Ask QA is for your own PRs.' })),
      ready: () => (pr.draft && rights?.update && rights.close ? void stateAct('ready') : setNotice({ ok: true, text: pr.draft ? "You can't change this one." : "It's not a draft." })),
      changeBase: () => (rights?.update && rights.close ? setBasePick(true) : setNotice({ ok: true, text: "You can't change this one's base." })),
      updateBranch: () => (rights?.updateBranch ? void stateAct('update') : setNotice({ ok: true, text: `Nothing to update: it's up to date with ${pr.base.ref}, or you can't push to it.` })),
      agentDraft: () => dispatchEvent(new Event('lgtm:agent-next')), // Review: the next agent draft not looked at
      nextPR: () => stepPR(1),
      prevPR: () => stepPR(-1),
      // The diff's threads out of the way while reading the code through (ones waiting on me stay): the page's class.
      threads: () => {
        const off = document.documentElement.classList.toggle('threads-hidden');
        dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: off ? `Threads hidden while you read. ${bindings.threads ? `${bindings.threads === ' ' ? 'Space' : bindings.threads} shows them.` : ''}` : 'Threads shown.', ms: 2500 } }));
      },
      stackPrev: () => stackAt(-1) && (location.hash = `/${repo}/pull/${stackAt(-1)!.number}`),
      stackNext: () => stackAt(1) && (location.hash = `/${repo}/pull/${stackAt(1)!.number}`),
      help: () => setHelp(!help),
      skip: () => dispatchEvent(new Event('lgtm:skip')), // review mode (main.tsx) moves on
      docCode: () => dispatchEvent(new Event('lgtm:doc-code')), // DocCodeJump
      myThreads: () => (setOnlyMine((v) => !v), scrollTo({ top: 0 })),
      react: () => void (reactUnderMouse() || dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: 'Point at a comment to react to it', ms: 2500 } }))),
      editComment: () => void (editUnderMouse() || dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: 'Point at a comment of yours to edit it', ms: 2500 } }))),
      commentMenu: () => void (menuUnderMouse() || dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: 'Point at a comment to hide, unhide or dismiss it', ms: 2500 } }))),
      assign: () => details('assign'),
      milestone: () => details('milestone'),
      subscribe: () => details('subscribe'),
      lock: () => details('lock'),
      prevCommit: () => stepCommit(-1),
      nextCommit: () => stepCommit(1),
      newCommits: () => newFrom >= 0 && showCommit(commits[newFrom].sha, commits.at(-1)!.sha),
      revertCommit: () => void revertShown(),
      ownFiles: () => ownSome && (setOnlyOwned((v) => !v), scrollTo({ top: 0 })),
      merge: () => dispatchEvent(new Event('lgtm:merge')),
      stack: () => dispatchEvent(new Event('lgtm:stack')),
      agents: () => dispatchEvent(new Event('lgtm:agents-menu')), // the PR bar's Agents (AgentsMenu)
      // The file in view on github.dev, at the first line showing below the bars.
      githubDev: () => {
        const sec = sections[Math.max(cur, 0)];
        if (!sec) return;
        const row = [...sec.querySelectorAll<HTMLElement>('tr.ln:not(.d)')].find((r) => r.getBoundingClientRect().top >= top);
        const line = Number([...(row?.querySelectorAll('td.num') ?? [])].at(-1)?.textContent) || undefined; // the new number
        void openExternal(githubDev(headRepo, pr.head.sha, sec.id.slice(2), line));
      },
    };
    function go(i: number) {
      threadCursor.current = i;
      jumpTo(ordered[i].id, 'f-' + ordered[i].path);
    }
    act[a]();
  }

  // The dependency pill: with the amber findings when a major jump or an unpinned version is marked, else with the info.
  const depsPill = deps.length > 0 && (
    <PillMenu cls={deps.some((d) => d.major || d.unpinned) ? 'p-warn' : ''} label={<Tg i="package" n={deps.length} t={`dependenc${deps.length > 1 ? 'ies' : 'y'} changed`} />} head="Libraries added, removed or moved to another version (major jumps and versions not pinned marked):">
      {deps.map((d) => (
        <div class="pill-row">
          <button onClick={() => jumpToLine(d.path, d.removed ? undefined : d.line)} title={`${d.path}:${d.line}`}>
            <b>{d.name}</b>{' '}
            <small class={d.major ? 'dep-major' : ''}>
              {d.removed ? `removed${d.from ? ` (was ${d.from})` : ''}` : d.from && d.to ? `${d.from} → ${d.to}${d.major ? ' · major' : ''}` : `added${d.to ? ` ${d.to}` : ''}`}
              {d.test && ' · for tests'}
            </small>
            {d.unpinned && <small class="dep-major">not pinned · {d.unpinned}</small>}
            {new Set(deps.map((x) => x.path)).size > 1 && <small>{dir(d.path) || 'root'}</small>}
          </button>
          {depPage(d) && <a href={depPage(d)} target="_blank" rel="noopener" title="Its page: versions, changelog"><Octicon name="link-external" /></a>}
          {d.unpinned && <SayIt onClick={() => ctx.suggest(d.path, d.line, `${d.name} isn't pinned (${d.to}, ${d.unpinned}), so the same commit can build with different code tomorrow. Could it be pinned to a release${d.npm && /#/.test(d.to ?? '') ? ', or a commit' : ''}?`)} />}
          {d.major && !d.unpinned && <SayIt onClick={() => ctx.suggest(d.path, d.line, `${d.name} goes from ${d.from} to ${d.to}, a major version. Have its breaking changes been checked?${depPage(d) ? ` ${depPage(d)}` : ''}`)} />}
        </div>
      ))}
    </PillMenu>
  );
  // Finish review: in the bar, and inline at the page's end (the same summary in both).
  const submitPanel = (inline = false) => (
    <SubmitPanel inline={inline} count={drafts.length + (pending?.count ?? 0)} myOpenThreads={myOpenThreads} mySummary={mySummary} lineComments={drafts.map((d) => ({ path: d.path, line: d.line }))} slackTo={slackTo} slackNote={slackNote} threaded={slackThreads.map((t) => t.login)} onSubmit={submit}
      checkLanded={async () => {
        const head = await getHead(repo, n);
        if (!head || head === pr.head.sha) return null;
        const c = await getCompare(repo, pr.head.sha, head).catch(() => null);
        return !c || c.status === 'diverged' || !c.commits
          ? `The branch was rewritten since you opened it: your review goes on code you haven't seen.`
          : `${plural(c.commits, 'commit')} (${plural(c.files.length, 'file')}) landed since you opened it: your review goes on the newest.`;
      }}
      seeLanded={() => (showSince(pr.head.sha), dispatchEvent(new Event('lgtm:refresh')))}
      canMerge={!!rights?.merge && pr.state === 'open' && !pr.draft} inFlight={inFlight} saveAs={`summary:${repo}#${n}`} repo={repo} mentions={ctx.mentions} authored={(!!me && pr.user.login === me) || pr.state === 'closed'} stillOpen={stillOpen} unlooked={unlooked}
      unviewed={data.files.filter((f) => !viewed.has(f.filename)).length} viewAll={() => markViewed(data.files.map((f) => f.filename), true)} />
  );
  return (
    <div class={`review${showIndex && !narrowIx ? '' : ' no-index'}${tooWide ? ' too-wide' : ''}`}>
      {/* Always there, so showing and hiding can slide (style.css); hidden, it's out of reach of the keyboard. */}
      {(
        <aside class={`side tree${showIndex ? '' : ' collapsed'}${narrowIx && showIndex ? ' over' : ''}`} aria-hidden={!showIndex} onClick={(e) => narrowIx && (e.target as Element).closest('.ix-item, .tree-file, .ix-hidden-row') && setIxOver(false)}>
          <div class="side-scroll">
            <ShortcutIndex
              commits={commits}
              atCommit={commitView ? toSha : null}
              fromCommit={commitView ? firstSha : null}
              readCommits={readCommits}
              onCommit={pickCommit}
              newFrom={newFrom}
              onNew={() => newFrom >= 0 && showCommit(commits[newFrom].sha, commits.at(-1)!.sha)}
              canLabel={!!rights?.label}
              checksErr={checksErr}
              hidden={hiddenRows}
              repo={repo}
              pr={pr}
              conversation={conv}
              threads={shownThreads}
              settled={settledCount}
              settledShown={showSettled}
              onToggleSettled={setShowSettled}
              drafts={drafts}
              checks={checks}
              onRefreshChecks={loadChecks}
              files={noTests.size ? shown.map((f) => (noTests.has(f.filename) ? { ...f, untested: true } : f)) : shown}
              viewed={viewed}
              onViewed={markViewed}
              slackAsk={!!me && pr.user.login === me && slackPeople !== null ? askOnSlack : undefined}
              slackWith={new Set(slackThreads.map((t) => t.login))}
              reRequest={!!me && pr.user.login === me ? reRequest : undefined}
              withdraw={(!!me && pr.user.login === me) || rights?.update ? withdraw : undefined}
              replace={!!me && pr.user.login === me ? replaceReviewer : undefined}
              addMe={!!me && pr.user.login !== me ? () => takeReview(repo, n, (pr.requested_teams ?? []).map((t) => t.slug)).then(() => dispatchEvent(new Event('lgtm:refresh'))) : undefined}
              me={me}
              modules={view === 'all' ? shownModules : undefined}
              steps={readingOrder ? steps : undefined}
              ask={
                !!me && pr.user.login === me && (
                  <AskReviewer
                    findings={findings}
                    files={data.files}
                    pr={pr}
                    repo={repo}
                    n={n}
                    skip={new Set([me, ...bots, ...(pr.requested_reviewers ?? []).map((u) => u.login), ...conversation.filter((c) => c.state).map((c) => c.author)])}
                    slackOk={slackPeople !== null}
                    onAsked={(text, ok, asked) => {
                      setNotice({ ok, text });
                      if (!asked) return;
                      // Asked: among the reviewers now (as GitHub has them), while the PR loads again behind.
                      setData((d) => d && ({ ...d, pr: { ...d.pr, requested_reviewers: [...(d.pr.requested_reviewers ?? []).filter((u) => u.login !== asked), { login: asked }] } }));
                      dispatchEvent(new Event('lgtm:refresh'));
                    }}
                  />
                )
              }
              counts={(path) => (byPath.get(path)?.length ?? 0) + drafts.filter((d) => d.path === path).length}
            />
          </div>
          <Resizer name="index" label={`${pageTerm().PR} index`} />
        </aside>
      )}
      <div>
        {/* Where you are (index, stack), what it is, who it's with, then what you can do. */}
        <div class="bar">
          <button class="bar-index" title={`${showIndex ? `Hide the ${pageTerm().PR} index` : `Show the ${pageTerm().PR} index`}${hint(bindings.index)}`} aria-label={showIndex ? `Hide the ${pageTerm().PR} index` : `Show the ${pageTerm().PR} index`} onClick={toggleIndex}>
            <Octicon name={showIndex ? 'sidebar-expand' : 'sidebar-collapse'} />
          </button>
          <button class="bar-index" title={split ? 'One column: removed lines above added ones' : 'Side by side: old and new next to each other'} aria-label="Side by side" aria-pressed={split} onClick={toggleSplit}>
            <Octicon name="columns" />
          </button>
          <button class="bar-index" title={centered ? 'Fill the window' : 'Centre at a comfortable width'} aria-label={centered ? 'Fill the window' : 'Centre at a comfortable width'} onClick={toggleCentered}>
            <Octicon name={centered ? 'screen-full' : 'screen-normal'} />
          </button>
          {layer >= 0 && <StackNav repo={repo} n={n} stack={stack} />}
          {(pr.merged || pr.state === 'closed' || pr.draft) && (
            <span class={`state-chip ${pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'draft'}`} title={pr.merged ? `Merged${pr.merged_by ? ` by @${pr.merged_by.login}` : ''} into ${pr.base.ref}${pr.merged_at ? ` ${ago(pr.merged_at)}` : ''}` : pr.state === 'closed' ? `Closed without merging${pr.closed_at ? ` ${ago(pr.closed_at)}` : ''}` : 'A draft: not ready for review yet'}>
              <Octicon name={pr.merged ? 'git-merge' : pr.state === 'closed' ? 'git-pull-request-closed' : 'git-pull-request-draft'} />
              {pr.merged ? 'Merged' : pr.state === 'closed' ? 'Closed' : 'Draft'}
            </span>
          )}
          <h1 onContextMenu={titleMenu}>
            <a href={pr.html_url} target="_blank" rel="noopener" title={`${repo}#${n} ${pr.title}\nOpen on ${site(repo)}`}>
              <span class="pr-num">{numRef(repo, n)}</span> {pr.title}
            </a>
          </h1>
          <div class="bar-group">
            {slackThreads.map((t) =>
              t.login === '#qa' ? (
                <a
                  class={`bar-slack bar-qa${qa?.status ? ' qa-' + qa.status : ''}`}
                  href={t.url}
                  target="_blank"
                  rel="noopener"
                  title={`Your QA request${t.name ? ` in ${t.name}` : ''}, on Slack${qa?.status === 'signed' ? ': signed off' : qa?.status === 'issue' ? ': a reply mentions a bug, an error or a crash' : ''}${qa?.replies.length ? ` · ${qa.replies.length} repl${qa.replies.length === 1 ? 'y' : 'ies'}` : ''}`}
                  onClick={() => { const last = qa?.replies.at(-1); if (last) seeQa(`${repo}#${n}`, last), setQaSeenAt(last); }}
                >
                  <Octicon name="beaker" />
                  {!!qa && qa.replies.filter((ts) => ts > qaSeenAt).length > 0 && <span class="qa-new">{qa.replies.filter((ts) => ts > qaSeenAt).length}</span>}
                </a>
              ) : (
                <a class="bar-slack" href={t.url} target="_blank" rel="noopener" title={`Your Slack thread with ${t.name ? `${t.name} (@${t.login})` : `@${t.login}`} about this ${pageTerm().PR}`}>
                  {t.image ? <img src={t.image} alt={t.name ?? t.login} /> : <Octicon name="comment" />}
                </a>
              ),
            )}
            {reviewReplies && request?.where && request.url && (
              <a
                class="bar-slack bar-qa"
                href={request.url}
                target="_blank"
                rel="noopener"
                title={`Your review request in ${request.where}, on Slack${request.replies?.length ? ` · ${request.replies.length} repl${request.replies.length === 1 ? 'y' : 'ies'}` : ''}`}
                onClick={() => { const last = request.replies?.at(-1); if (last) seeQa(`${repo}#${n}:review`, last), setRequestSeenAt(last); }}
              >
                <Octicon name="comment-discussion" />
                {(request.replies ?? []).filter((ts) => ts > requestSeenAt).length > 0 && <span class="qa-new">{request.replies!.filter((ts) => ts > requestSeenAt).length}</span>}
              </a>
            )}
            <AgentsMenu prompt={prPrompt(pr, repo)} repo={repo} prUrl={pr.html_url} label="Agents" full={pr} />
          </div>
          <div class="bar-group bar-actions">
            {batch.length > 0 && <CommitBatch batch={batch} apply={ctx.applySuggestions} onError={(text) => setNotice({ ok: false, text })} />}
            {myOpenPR && reviewAsk && request && !request.where && !pr.draft && <AskQA kind="channel" pr={pr} repo={repo} n={n} onPosted={() => slackRequest(`${repo}#${n}`, undefined, undefined, true).then((r) => setRequest(r.where ? r : { where: 'the review channel' }), () => setRequest({ where: 'the review channel' }))} />}
            {askQa && <AskQA inMenu pr={pr} repo={repo} n={n} onPosted={() => slackStatus(`${repo}#${n}`).then((s) => setSlackThreads(s.threads), () => {})} />}
            {mine && <MergeBox repo={repo} n={n} revert={!!undoes} asked={(pr.requested_reviewers ?? []).map((u) => u.login)} url={pr.html_url} checks={checks} onChange={() => onSubmitted()} tickets={jiraKeys(pr.title, pr.head.ref)} openThreads={openThreads} qa={((t) => t && { url: t.url, thread: qa })(slackThreads.find((t) => t.login === '#qa'))} />}
            {basePick && <BaseDialog repo={repo} n={n} base={pr.base.ref} head={pr.head.ref} onClose={() => setBasePick(false)} />}
            {(askQa || (rights && (rights.close || rights.reopen || rights.restore || rights.updateBranch))) && <StateMenu rights={rights} draft={!!pr.draft} acting={acting} act={stateAct} askQa={askQa} />}
            {submitPanel()}
          </div>
        </div>
        {help && <Help onClose={() => setHelp(false)} ignoreWs={ignoreWs} toggleWs={toggleWs} />}
        <ScrollMarks files={shown} />
        <DocCodeJump files={shown} />
        <HoldPlace />
        <main class={onlyMine ? 'only-mine' : undefined}>
          {pr.merged ? (
            <p class="pr-state merged">
              <Octicon name="git-merge" size={16} /> <span><b>Merged</b>{pr.merged_by && <> by <Who login={pr.merged_by.login} /></>} into <CopyCode>{pr.base.ref}</CopyCode>{pr.merged_at && <> <Time at={pr.merged_at} /></>}.
                {undoneBy && (
                  <>
                    {' '}<b>{undoneBy.merged ? 'Reverted' : 'Being reverted'}</b> by <a href={`#/${repo}/pull/${undoneBy.number}`}>{numRef(repo, undoneBy.number)}</a>
                    {undoneBy.merged ? <>, merged <Time at={undoneBy.at} /></> : ', still open'}.
                  </>
                )}{' '}
                A review now can only comment.</span>
              {!undoneBy && <button class="pr-state-act" disabled={reverting} title={`A new ${pageTerm().PR} that undoes this one on ${pr.base.ref}, to review and merge like any other`} onClick={() => void revert(pr.node_id, pr.base.ref)}>
                {reverting ? 'Reverting…' : 'Revert'}
              </button>}
            </p>
          ) : pr.state === 'closed' ? (
            <p class="pr-state closed">
              <Octicon name="git-pull-request-closed" size={16} /> <span><b>Closed without merging</b>{pr.closed_at && <> <Time at={pr.closed_at} /></>}. A review now can only comment.</span>
              {(rights?.reopen || rights?.restore) && (
                <button class="pr-state-act" disabled={!!acting} title={rights.reopen ? undefined : `Its branch ${rights.headRefName} is gone: make it again at the PR's last commit, then reopen`} onClick={() => void stateAct(rights.reopen ? 'reopen' : 'restore')}>
                  {acting ? 'Reopening…' : rights.reopen ? 'Reopen' : 'Restore branch and reopen'}
                </button>
              )}
              {closeWhere && (
                <button
                  class="pr-state-act"
                  title={`Reply in your review request's thread in ${closeWhere}, tagging the reviewers asked, that it's closed and needs no review`}
                  onClick={() =>
                    closedOnSlack(`${repo}#${n}`, (pr.requested_reviewers ?? []).map((u) => u.login)).then(
                      (w) => (setCloseWhere(null), w && setNotice({ ok: true, text: `Said so in your review request's thread in ${w}.` })),
                      (e) => setNotice({ ok: false, text: `Couldn't reply on Slack: ${e.message}` }),
                    )
                  }
                >
                  Tell the review thread
                </button>
              )}
            </p>
          ) : idleDays >= 30 && rights?.close ? (
            <p class="pr-state idle">
              <Octicon name="hourglass" size={16} /> <span><b>No activity for {idleDays} days.</b> Close it if it's not going anywhere, or {pr.draft ? 'pick it up again' : 'make it a draft until it is'}.</span>
              <span class="pr-state-act"><StateActs rights={rights} draft={!!pr.draft} acting={acting} act={stateAct} /></span>
            </p>
          ) : pr.draft ? (
            <p class="pr-state draft">
              <Octicon name="git-pull-request-draft" size={16} /> <span><b>Draft.</b> {me && pr.user.login === me ? "Reviewers aren't notified until you mark it ready for review." : "The author hasn't asked for review yet: it may still change."}</span>
              {rights?.update && rights.close && (
                <button class="pr-state-act" disabled={!!acting} title={`Mark it ready: reviewers are notified${hint(bindings.ready)}`} onClick={() => void stateAct('ready')}>
                  {acting === 'ready' ? 'Marking…' : 'Ready for review'}
                </button>
              )}
            </p>
          ) : null}
          <div class="pills pr-status" ref={pillsRef}>
            {stale && <span class="pill" title={`Showing the copy loaded ${ago(stale)} while this one loads`}><Tg i="again" t="updating…" /></span>}
            {pr.state === 'open' && rights?.updateBranch && (
              <span class="pill p-warn" title={`${pr.base.ref} has commits this branch doesn't${hint(bindings.updateBranch)}`}>
                <Tg i={<Octicon name="arrow-down" />} t={`behind ${pr.base.ref}`} />{' '}
                <button class="link" disabled={!!acting} onClick={() => void stateAct('update')}>{acting === 'update' ? (rights.rebase ? 'Rebasing…' : 'Updating…') : rights.rebase ? 'Rebase' : 'Update branch'}</button>
              </span>
            )}
            {status && !pr.draft && (
              <span class={'pill ' + ({ APPROVED: 'p-ok', CHANGES_REQUESTED: 'p-bad' } as Record<string, string>)[status.reviewDecision ?? ''] || '' }>
                <Tg i={DECISION[status.reviewDecision ?? 'REVIEW_REQUIRED'][0]} t={DECISION[status.reviewDecision ?? 'REVIEW_REQUIRED'][1]} />
              </span>
            )}
            {undoes && gaps && (
              <span
                class={`pill ${gaps.differ.length ? 'p-warn' : 'p-ok'}`}
                title={gaps.differ.length ? `Not what undoing #${undoes} exactly would change:\n${gaps.differ.join('\n')}` : gaps.unknown.length ? `Every file lgtm could compare undoes #${undoes} exactly. No diff to compare for:\n${gaps.unknown.join('\n')}` : `Every line it changes undoes #${undoes}, and nothing else`}
              >
                <Tg i="history" t={gaps.differ.length ? `differs from a clean revert of #${undoes} in ${gaps.differ.length} file${gaps.differ.length > 1 ? 's' : ''}` : `exactly undoes #${undoes}${gaps.unknown.length ? ` (${gaps.unknown.length} not compared)` : ''}`} />
              </span>
            )}
            {slackOnly.length > 0 && (
              <span class="pill p-warn" title={`You sent this ${pageTerm().PR} to ${slackOnly.map((l) => '@' + l).join(', ')} in a Slack DM, but ${site(repo)} doesn't ask them to review it: it's not in their list, and ${site(repo)} doesn't wait on them.`}>
                <Tg i="nobody" t={`asked ${slackOnly.map((l) => '@' + l).join(', ')} on Slack, not on ${site(repo)}`} />{' '}
                <button
                  class="link"
                  onClick={() =>
                    Promise.all(slackOnly.map((l) => requestReview(repo, n, l))).then(
                      () => (void ticketsToReview(jiraKeys(pr.title, pr.head.ref)), setNotice({ ok: true, text: `Asked ${slackOnly.map((l) => '@' + l).join(', ')} on ${site(repo)} too.` }), dispatchEvent(new Event('lgtm:refresh'))),
                      (e) => setNotice({ ok: false, text: `Couldn't ask on ${site(repo)}: ${e.message}` }),
                    )
                  }
                >
                  ask on {site(repo)}
                </button>
              </span>
            )}
            {teamPick && (
              <span class="pill p-warn" title={`${teamPick.group} is asked, but no one in it by name: everyone in it is told, so it's no one's. @${teamPick.login} ${teamPick.why}, with ${teamPick.load} open review request${teamPick.load === 1 ? '' : 's'}.`}>
                <Tg i="nobody" t={isLab(repo) ? `${teamPick.group}: no approver asked` : 'asked a team, no one named'} />{' '}
                <button
                  class="link"
                  onClick={() =>
                    requestReview(repo, n, teamPick.login).then(
                      () => (void ticketsToReview(jiraKeys(pr.title, pr.head.ref)), setTeamPick(null), setNotice({ ok: true, text: `Asked @${teamPick.login} for a review.` }), dispatchEvent(new Event('lgtm:refresh'))),
                      (e) => setNotice({ ok: false, text: `Couldn't ask @${teamPick.login} on ${site(repo)}: ${e.message}` }),
                    )
                  }
                >
                  ask @{teamPick.login}
                </button>
              </span>
            )}
            {/* What needs you, or blocks the merge */}
            {waitingOnMe > 0 && <span class="pill p-reply"><Tg i="reply" n={waitingOnMe} t="awaiting your reply" /></span>}
            {status?.mergeStateStatus === 'DIRTY' && <span class="pill p-bad"><Tg i="conflict" t="conflicts" /></span>}
            {failingChecks > 0 && (
              <PillMenu cls="p-bad" label={<Tg i="ci" n={failingChecks} t={`check${failingChecks > 1 ? 's' : ''} failing`} />} head="CI checks that failed on the latest commit:">
                {checks!.filter((c) => c.state === 'failure').map((c) => (
                  <a href={c.url ?? undefined} target="_blank" rel="noopener" title={c.summary}>
                    <CheckMark state="failure" /> {c.name}
                    {c.summary && <small>{c.summary}</small>}
                    <OnBase c={c} branch={pr.base.ref} />
                  </a>
                ))}
              </PillMenu>
            )}
            {/* Red findings */}
            {secrets.list.length > 0 && (
              <PillMenu cls="p-bad" label={<Tg i="key" n={secrets.list.length} t={`possible secret${secrets.list.length > 1 ? 's' : ''}`} />} head="Added lines that look like a secret (a key, a token, a password in the code):">
                {secrets.list.map((x) => (
                  <div class="pill-row">
                    <button onClick={() => jumpToLine(x.path, x.line)} title={x.path}>
                      <b>{x.kind}</b> <small>{base(x.path)}:{x.line}</small>
                    </button>
                    <SayIt onClick={() => ctx.suggest(x.path, x.line, `This looks like ${aKind(x.kind)}. If it's real, it's in the Git history now: please revoke it, and load it from a secret store or the build environment instead.`)} />
                  </div>
                ))}
              </PillMenu>
            )}
            {unsafe.length > 0 && (
              <PillMenu cls="p-bad" label={<Tg i="alert" n={unsafe.length} t={`protection${unsafe.length > 1 ? 's' : ''} switched off`} />} head={`Safeguards the ${pageTerm().PR} turns off:`}>
                {unsafe.map((x) => (
                  <div class="pill-row">
                    <button onClick={() => jumpToLine(x.path, x.line)} title={`${x.path}: ${x.why}`}>
                      <b>{x.what}</b> <small>{base(x.path)}:{x.line}</small>
                      <small>{x.why}</small>
                    </button>
                    <SayIt onClick={() => ctx.suggest(x.path, x.line, `${x.what}: ${x.why.charAt(0).toLowerCase() + x.why.slice(1)} Is that meant for this build? If it's only for debugging, could it go in a debug-only config instead?`)} />
                  </div>
                ))}
              </PillMenu>
            )}
            {backend.mig.length > 0 && (
              <PillMenu cls="p-bad" label={<Tg i="alert" n={backend.mig.length} t={`migration problem${backend.mig.length > 1 ? 's' : ''}`} />} head="Flyway checks every migration it already ran, and runs new ones in version order:">
                {backend.mig.map((m) => (
                  <div class="pill-row">
                    <button onClick={() => jumpTo('f-' + m.path)} title={m.path}>
                      <b>{base(m.path)}</b> <small>{migText(m)}</small>
                    </button>
                    <SayIt
                      onClick={() =>
                        ctx.suggest(m.path, undefined, m.kind === 'edited'
                          ? "This migration was already there, so it has run on our databases: Flyway checks its checksum and won't start once it changes. Could the change go in a new migration instead?"
                          : m.kind === 'duplicate'
                            ? 'A migration with this version is already on the base branch, so Flyway will refuse to start. Could it take the next version?'
                            : `This version is older than ${m.newest}, already on the base branch: where that one has run, Flyway refuses this one (unless outOfOrder is on). Could it take a newer version?`)
                      }
                    />
                  </div>
                ))}
              </PillMenu>
            )}
            {drift.length > 0 && (
              <PillMenu cls="p-bad" label={<Tg i="package" t="lockfile not updated" />} head="package.json's dependencies changed, its lockfile didn't: npm ci (and the like) fail on the mismatch.">
                {drift.map((d) => (
                  <div class="pill-row">
                    <button onClick={() => jumpToLine(d.path, d.line)} title={d.path}>
                      <b>{d.path}</b> <small>{d.lock} unchanged</small>
                    </button>
                    <SayIt onClick={() => ctx.suggest(d.path, d.line, `The dependencies change here but ${d.lock} doesn't, so a clean install (npm ci and the like) will fail. Could you run the install and commit ${d.lock}?`)} />
                  </div>
                ))}
              </PillMenu>
            )}
            {focusHits.length > 0 && (
              <PillMenu cls="p-bad" label={<Tg i="alert" n={focusHits.length} t={focusHits.every((f) => f.what === 'debugger') ? 'debugger left in' : 'focused test left in'} />} head="A .only makes CI run just that test (and pass); a debugger stops the app in anyone's dev tools:">
                {focusHits.map((x) => (
                  <div class="pill-row">
                    <button onClick={() => jumpToLine(x.path, x.line)} title={x.path}>
                      <b>{x.what}</b> <small>{base(x.path)}:{x.line}</small>
                    </button>
                    <SayIt onClick={() => ctx.suggest(x.path, x.line, x.what === 'debugger' ? 'A debugger statement is left in: it stops the app for anyone with dev tools open. Remove it?' : `${x.what} makes CI run only this, and skip the rest of the suite. Remove the .only?`)} />
                  </div>
                ))}
              </PillMenu>
            )}
            {room.length > 0 && (
              <PillMenu cls="p-bad" label={<Tg i="alert" t="table changed, database version not raised" />} head={`These change a Room table's columns, but no @Database version is raised in this ${pageTerm().PR}: installed apps keep the old table and crash when they update, until the version goes up (with a migration).`}>
                {room.map((x) => (
                  <div class="pill-row">
                    <button onClick={() => (x.side === 'RIGHT' ? jumpToLine(x.path, x.line) : jumpTo('f-' + x.path))} title={`${x.path}:${x.line}`}>
                      <b>{x.entity}</b> <small>{x.side === 'LEFT' ? 'removed: ' : ''}{x.text}</small>
                    </button>
                    <SayIt onClick={() => ctx.suggest(x.path, x.line, `This changes the ${x.entity} table, but the database version isn't raised in this ${pageTerm().PR}. Installed apps would keep the old table, and Room would crash on update: could the @Database version go up, with a migration?`, x.side)} />
                  </div>
                ))}
              </PillMenu>
            )}
            {/* Amber findings */}
            {supp.length > 0 && (
              <PillMenu
                cls={supp.some((x) => x.test || x.ci) ? 'p-warn' : ''}
                label={<Tg i="alert" n={supp.length} t={offLabel(supp)} />}
                head={`Tests skipped, CI steps let fail or skipped, and checks (types, lint, warnings, coverage) silenced by the ${pageTerm().PR}:`}
              >
                {supp.map((x) => (
                  <div class="pill-row">
                    <button onClick={() => jumpToLine(x.path, x.line)} title={x.path}>
                      <b>{x.what}</b> <small>{base(x.path)}:{x.line}</small>
                    </button>
                    <SayIt onClick={() => ctx.suggest(x.path, x.line, x.ci ? `With ${x.what} here, CI can pass without this step or its tests passing. Is that meant to stay?` : x.test ? `${x.what} switches this test off. Should it stay off? If it's broken or flaky, could it be fixed here, or tracked in a ticket so it comes back?` : `${x.what} switches a check off here. Could the code satisfy it instead${/ts-/.test(x.what) ? ' (or @ts-expect-error with the reason, so it shows when it\u2019s no longer needed)' : ''}?`)} />
                  </div>
                ))}
              </PillMenu>
            )}
            {goneTests.length > 0 && (
              <PillMenu cls="p-warn" label={<Tg i="removed" n={goneTests.length} t={`test file${goneTests.length > 1 ? 's' : ''} deleted`} />} head={`Tests this ${pageTerm().PR} deletes (not moved or renamed):`}>
                {goneTests.map((p) => (
                  <button onClick={() => jumpTo('f-' + p)} title={p}>
                    <b>{base(p)}</b> <small>{rest(dir(p), p)}</small>
                  </button>
                ))}
              </PillMenu>
            )}
            {noTests.size > 0 && (
              <PillMenu cls="p-warn" label={<Tg i="notest" n={noTests.size} t={`file${noTests.size > 1 ? 's' : ''} without test changes`} />} head={`Code changed, but no test for it changed in this ${pageTerm().PR}:`}>
                {[...noTests].map((p) => (
                  <button onClick={() => jumpTo('f-' + p)} title={p}>
                    <b>{base(p)}</b> <small>{rest(dir(p), p)}</small>
                  </button>
                ))}
              </PillMenu>
            )}
            {backend.ent.length > 0 && (
              <PillMenu cls="p-warn" label={<Tg i="alert" t="entity changed, no migration" />} head={`These change a JPA entity's columns, and this ${pageTerm().PR} adds no migration: the database won't have them (unless something else creates them).`}>
                {backend.ent.map((x) => (
                  <div class="pill-row">
                    <button onClick={() => (x.side === 'RIGHT' ? jumpToLine(x.path, x.line) : jumpTo('f-' + x.path))} title={`${x.path}:${x.line}`}>
                      <b>{x.entity}</b> <small>{x.side === 'LEFT' ? 'removed: ' : ''}{x.text}</small>
                    </button>
                    <SayIt onClick={() => ctx.suggest(x.path, x.line, `This changes the ${x.entity} table's columns, but the ${pageTerm().PR} adds no migration. Where does the database get the change?`, x.side)} />
                  </div>
                ))}
              </PillMenu>
            )}
            {texts.list.length > 0 && (
              <PillMenu cls="p-warn" label={<Tg i="text" n={texts.list.length} t={`text${texts.list.length > 1 ? 's' : ''} not in strings.xml`} />} head="Text people see, written in the code instead of strings.xml, so never translated:">
                {texts.list.map((x) => (
                  <div class="pill-row">
                    <button onClick={() => jumpToLine(x.path, x.line)} title={x.path}>
                      <b>“{x.text}”</b> <small>{base(x.path)}:{x.line}</small>
                    </button>
                    <SayIt onClick={() => ctx.suggest(x.path, x.line, `“${x.text}” is written in the code, so it won't be translated. Could it go in strings.xml?`)} />
                  </div>
                ))}
              </PillMenu>
            )}
            {html.length > 0 && (
              <PillMenu cls="p-warn" label={<Tg i="alert" n={html.length} t="raw HTML" />} head="HTML put in as is: safe only if none of it comes from users (else it's an XSS hole):">
                {html.map((x) => (
                  <div class="pill-row">
                    <button onClick={() => jumpToLine(x.path, x.line)} title={x.path}>
                      <b>{x.what}</b> <small>{base(x.path)}:{x.line}</small>
                    </button>
                    <SayIt onClick={() => ctx.suggest(x.path, x.line, `${x.what} puts this HTML in as is. Can any of it come from a user? If so it needs sanitizing (DOMPurify or the like), or rendering as text.`)} />
                  </div>
                ))}
              </PillMenu>
            )}
            {txs.length > 0 && (
              <PillMenu cls="p-warn" label={<Tg i="alert" n={txs.length} t="@Transactional on a private method" />} head="Spring's proxy never sees a call to a private method, so it runs without a transaction:">
                {txs.map((x) => (
                  <div class="pill-row">
                    <button onClick={() => jumpToLine(x.path, x.line)} title={x.path}>
                      <b>{base(x.path)}</b> <small>line {x.line}</small>
                    </button>
                    <SayIt onClick={() => ctx.suggest(x.path, x.line, "@Transactional does nothing on a private method: Spring's proxy never sees the call, so this runs without a transaction. Could it be public, or the transaction start in the caller?")} />
                  </div>
                ))}
              </PillMenu>
            )}
            {deps.some((d) => d.major || d.unpinned) && depsPill}
            {/* Info */}
            {!deps.some((d) => d.major || d.unpinned) && depsPill}
            {ownSome && (
              <PillMenu cls={onlyOwned ? 'p-reply' : ''} label={<Tg i="assigned" n={`${num(owned.size)} of ${num(files.length)}`} t={onlyOwned ? 'files yours, only those shown' : 'files yours'} />} head={`Files CODEOWNERS gives you, by name or through a team you're in:`}>
                <div class="pill-row">
                  <button onClick={() => (setOnlyOwned((v) => !v), scrollTo({ top: 0 }))} title={`${onlyOwned ? 'Show every file again' : 'Show only these files'}${hint(bindings.ownFiles)}`}>
                    {onlyOwned ? 'Show all files' : 'Show only these'}
                  </button>
                </div>
                {files.filter((f) => owned.has(f.filename)).slice(0, 40).map((f) => (
                  <button class="link" onClick={() => jumpTo('f-' + f.filename)} title={f.filename}>
                    <FileIcon path={f.filename} /> <FileName path={f.filename} />
                  </button>
                ))}
                {owned.size > 40 && <small>…and {owned.size - 40} more</small>}
              </PillMenu>
            )}
            <ModulesPill modules={view !== 'none' ? shownModules : undefined} />
            {pr.additions != null && (
              <span class="pill p-size">
                <b class="a">+{num(pr.additions)}</b> <b class="d">−{num(pr.deletions ?? 0)}</b> · {num(pr.changed_files ?? 0)} file{pr.changed_files === 1 ? '' : 's'}
              </span>
            )}
            {trimmedLines > 0 && changedLines > 0 && (
              <PillMenu cls="p-size" label={<><b>{trimmedLines * 100 < changedLines ? '<1' : Math.round((trimmedLines * 100) / changedLines)}%</b> less to read</>} head={`lgtm keeps ${num(trimmedLines)} of the ${num(changedLines)} lines to read (changes and comments) out of sight:`}>
                {trimmed.map(([k, what, show]) => (
                  <div class="pill-row">
                    {show ? (
                      <button onClick={show} title="Show them">
                        <b>{num(k)}</b> <span>{what}</span> <small>Show</small>
                      </button>
                    ) : (
                      <span>
                        <b>{num(k)}</b> {what}
                      </span>
                    )}
                  </div>
                ))}
              </PillMenu>
            )}
            {/* View */}
            {ignoreWs && (
              <button
                class="pill"
                title={`Whitespace-only changes are hidden: ${wsOnlySet.size} file${wsOnlySet.size === 1 ? '' : 's'} and ${wsFolded} section${wsFolded === 1 ? '' : 's'} in others. Click to show them${hint(bindings.whitespace)}`}
                onClick={toggleWs}
              >
                <Tg i="ws" t="whitespace ignored" />
              </button>
            )}
            {/* On a re-review (or while showing changes since a point): the push to show changes after. */}
            {points && points.length > 1 && (lastReviewed || since) && (
              <PillMenu label={<Tg i="history" t="changes since…" />} head="Show only what changed after:">
                {lastReviewed && (
                  <button onClick={() => showSince(null)}>
                    <b>Your last review</b> <small><Time at={lastReviewAt} /></small>
                  </button>
                )}
                {points.filter((p) => p.sha !== pr.head.sha).map((p) => (
                  <button onClick={() => showSince(p.sha)} title={p.sha}>
                    <Octicon name={p.force ? 'repo-push' : 'git-commit'} /> <b>{p.label}</b> <small><Time at={p.at} /></small>
                  </button>
                ))}
              </PillMenu>
            )}
          </div>
          {notice && (
            <p class={notice.ok ? 'notice' : 'warn'}>
              <NoticeText text={notice.text} />
            </p>
          )}
          {pushed && (
            <p class="look-again">
              {pushed} new commit{pushed > 1 ? 's' : ''} pushed since you opened this.
              <button class="primary" onClick={() => (setPushed(null), dispatchEvent(new Event('lgtm:refresh')))}>Reload</button>
            </p>
          )}
          {!commitView && allFixes.length > 1 && <FixedAll fixes={allFixes} ctx={ctx} />}
          <QuoteButton keyHint={hint(bindings.quoteReply)} />
          {!commitView && !!me && pr.user.login === me && <LookAgain conv={conv} pr={pr} again={reRequest} check={check} onRecheck={() => setCheckTry((k) => k + 1)} />}
          {(lastReviewed || fromSha) && (
            <div class={since ? 'since on' : 'since'}>
              {lastReviewed && !fromSha && <SinceSummary
                me={me}
                threads={threads}
                lastReviewAt={lastReviewAt}
                newCommits={newCommits}
                sinceComment={sinceComment}
                onCommits={() => setSince(true)}
                check={check}
                onRecheck={() => setCheckTry((k) => k + 1)}
                onResolveAll={resolveAddressed}
                onFocus={() => (setOnlyMine(true), scrollTo({ top: 0 }))}
              />}
              {commitView ? (
                <>
                  <span class="since-state">
                    {firstSha === toSha ? (
                      <>Commit {ci(toSha) + 1} of {commits.length}: <CopyCode text={toSha!}>{toSha!.slice(0, 7)}</CopyCode> <b>{commits[ci(toSha)]?.label}</b></>
                    ) : (
                      <>Commits {ci(firstSha) + 1}–{ci(toSha) + 1} of {commits.length}: <CopyCode text={firstSha!}>{firstSha!.slice(0, 7)}</CopyCode> … <CopyCode text={toSha!}>{toSha!.slice(0, 7)}</CopyCode></>
                    )}
                    {sinceData ? ` · ${sinceData.files.length} file${sinceData.files.length === 1 ? '' : 's'}` : ' · loading…'}
                    {sinceData?.body && <span class="commit-body">{sinceData.body}</span>}
                  </span>
                  <button disabled={firstSha === commits[0]?.sha} onClick={() => stepCommit(-1)} title={`Previous commit${hint(bindings.prevCommit)}`}>‹ Previous</button>
                  <button disabled={toSha === commits.at(-1)?.sha} onClick={() => stepCommit(1)} title={`Next commit${hint(bindings.nextCommit)}`}>Next ›</button>
                  {canRevert && <button onClick={revertShown} title={`Revert this commit on ${pr.head.ref} (asks first)${hint(bindings.revertCommit)}`}>Revert…</button>}
                  <button onClick={() => showCommit(null)}>Show all changes</button>
                </>
              ) : since ? (
                <>
                  <span class="since-state">
                    {fromSha ? `Showing only the changes after ${points?.find((p) => p.sha === fromSha)?.label ?? 'that point'} ` : 'Showing only those changes '}
                    (<CopyCode text={sinceBase!}>{sinceBase!.slice(0, 7)}</CopyCode> → <CopyCode text={pr.head.sha}>{pr.head.sha.slice(0, 7)}</CopyCode>)
                    {sinceData ? ` · ${sinceData.files.length} file${sinceData.files.length === 1 ? '' : 's'}` : ' · loading…'}
                    {sinceData?.status === 'diverged' && sinceData.files.length > 0 && <b> · rebased since then, so these files may also show changes from the base branch</b>}
                    {sinceData?.status === 'rebased' && <> · rebased since then: the base branch's changes left out</>}
                    {sinceData && !sinceData.files.length && <b> · none of this {pageTerm().PRs_} files changed (only a rebase)</b>}
                  </span>
                  <button onClick={() => showCommit(null)}>Show all changes</button>
                </>
              ) : (
                <button onClick={() => setSince(true)}>Show only those changes</button>
              )}
            </div>
          )}
          {paused && !commitView && (
            <p class="warn">
              Review threads aren't shown: {paused.replace(/: lgtm waits until then$/, '')}. The diff, description and conversation are here; reload after that for the threads.
            </p>
          )}
          {!commitView && drafts.length > 0 && saved.sha !== pr.head.sha && (
            <p class="warn">New commits were pushed since you started this review. Your comments move to them with their lines when you submit; you'll be asked about any whose lines changed.</p>
          )}
          {/* One commit on its own: just it, its message and its files; the PR's description, conversation, ticket and
              review state wait for all changes. */}
          {plan && !commitView && <ReviewPlan plan={plan} viewed={viewed} />}
          {pending && !commitView && (
            <p class="warn">
              You have a review in progress on {site(repo)} ({pending.count} comment{pending.count === 1 ? '' : 's'}): Finish review sends it, with your comments here.{' '}
              <button
                class="link"
                disabled={discarding}
                onClick={async () => {
                  if (!(await ask(`Discard your review in progress on ${site(repo)}${pending.count ? `, and its ${pending.count} comment${pending.count === 1 ? '' : 's'}` : ''}?`, 'Discard', true))) return;
                  setDiscarding(true);
                  await discardReview(pending.id).catch((e) => setError(e.message));
                  setPending(null);
                  setThreads(await getThreads(repo, n));
                  setDiscarding(false);
                }}
              >
                {discarding ? 'Discarding…' : 'Discard it'}
              </button>
            </p>
          )}
          {!commitView && jiraKeys(pr.title, pr.head.ref).map((k) => <Ticket key={k} id={k} lang={mainLang} />)}
          {!commitView && <TicketPRs repo={repo} n={n} keys={jiraKeys(pr.title, pr.head.ref)} />}
          <AskAgent pr={pr} repo={repo} headRepo={data.headRepo} files={data.files} onComment={(path, line, body) => ctx.suggest(path, line && ctx.suggestion({ path, side: 'RIGHT', line }) != null ? line : undefined, body)} />
          {commentPeek.node}
          {symPeek.node}
          {symbolNav && (
            <SymbolNav
              ix={codeIx}
              go={(path, line, old) => (isDoc(path) ? jumpToSpec({ spec: path, line, label: '' }) : jumpToLine(path, line, old))}
              peek={symPeek}
              usageKey={bindings.usages}
              repoSearch={(name) => (isLab(repo) ? `https://${repo.split('/')[0]}/${repo.slice(repo.indexOf('/') + 1)}/-/search?scope=blobs&search=${encodeURIComponent(name)}` : `https://github.com/search?type=code&q=${encodeURIComponent(`repo:${repo} ${name}`)}`)}
            />
          )}
          {!commitView && <Conversation pr={pr} items={conv} lang={mainLang} repo={repo} me={me} mentions={ctx.mentions} folded={focus} ix={codeIx} threads={threads} reveal={() => hiddenThreads && setShowSettled()} canEdit={!!me && (pr.user.login === me || !!rights?.update)} canDismiss={!isLab(repo) && !!rights?.merge} />}
          {onlyMine && !commitView ? (
            <MyThreads threads={threads} drafts={drafts} files={data.files} ctx={ctx} close={(t) => (setOnlyMine(false), t && setTimeout(() => jumpTo(('comments' in t ? 't-' : 'd-') + t.id, 'f-' + t.path), 50))} />
          ) : (
          <>
          {inOrder.map(section)}
          {generated.length > 0 &&
            (genOpen ? generated.map(section) : (
              <button class="gen-row" onClick={() => setShowGenerated(true)}>
                {generated.length} generated file{generated.length > 1 ? 's' : ''} hidden. Show
              </button>
            ))}
          {archived.length > 0 &&
            (showArchived ? archived.map(section) : (
              <button class="gen-row" onClick={() => setShowArchived(true)}>
                {archived.length} archived spec{archived.length > 1 ? 's' : ''} hidden. Show
              </button>
            ))}
          {noDiff.length > 0 &&
            (noDiffOpen ? noDiff.map(section) : (
              <button class="gen-row" onClick={() => setShowNoDiff(true)}>
                {noDiff.length} file{noDiff.length > 1 ? 's' : ''} with no content change (renamed, moved or empty) hidden. Show
              </button>
            ))}
          {wsOnly.length > 0 &&
            (showWsOnly ? wsOnly.map(section) : (
              <button class="gen-row" onClick={() => setShowWsOnly(true)}>
                {wsOnly.length} file{wsOnly.length > 1 ? 's' : ''} with only whitespace changes hidden. Show
              </button>
            ))}
          {importOnly.length > 0 &&
            (showImportsOnly ? importOnly.map(section) : (
              <button class="gen-row" onClick={() => setShowImportsOnly(true)}>
                {importOnly.length} file{importOnly.length > 1 ? 's' : ''} with only import changes hidden. Show
              </button>
            ))}
          </>
          )}
          {!commitView && !onlyMine && <div class="review-end">{submitPanel(true)}</div>}
        </main>
      </div>
    </div>
  );
}

type SubmitProps = {
  unviewed?: number; // the PR's files I haven't marked viewed
  viewAll?: () => void; // marks them viewed
  inline?: boolean; // at the page's end, always there (else the bar's button and its panel)
  unlooked?: number; // the agent's drafts in my pending review I haven't looked at (kept or edited)
  stillOpen?: { id: string; path: string; line?: number | null }[]; // threads I started, unresolved, their code unchanged since
  saveAs: string; // where an unsent summary is kept
  count: number;
  myOpenThreads: number; // unresolved review threads I'm in
  slackTo: string[] | null;
  threaded: string[];
  slackNote: string;
  onSubmit: (e: ReviewEvent, body: string, notify: boolean, next: boolean, step: (s: string) => void, merge: boolean) => Promise<boolean | 'sending'>;
  canMerge?: boolean; // I may merge it, and it's open and ready: approving can merge it too
  inFlight?: boolean; // a review of it is still on its way (sent as you moved on)
  checkLanded?: () => Promise<string | null>; // commits pushed since the page loaded, in words (none: null)
  seeLanded?: () => void; // show just those
  repo: string;
  mentions: string[];
  authored: boolean; // my own PR: GitHub only takes comments there
  mySummary: string; // what my open comments ask for, to start a change request's summary from
  lineComments: { path: string; line?: number | null }[]; // my comments waiting to go with the review
};

// A change request's summary from my open threads: what I asked, once per text, with where.
function changesSummary(threads: Thread[], me: string): string {
  const asks = new Map<string, string[]>();
  for (const t of threads) {
    if (t.isResolved) continue;
    const mine = t.comments.nodes.filter((c) => c.author?.login === me && c.state !== 'PENDING').at(-1);
    if (!mine?.bodyText.trim()) continue;
    const text = mine.bodyText.trim().split('\n')[0];
    asks.set(text, [...(asks.get(text) ?? []), `[${base(t.path)}${t.line ? ':' + t.line : ''}](${mine.url})`]);
  }
  if (!asks.size) return '';
  return ['Please address my comments:', '', ...[...asks].map(([text, at]) => `- ${text} (${at.join(', ')})`)].join('\n');
}

const APPROVE_NOTE = 'Approved, but please address the comments';

// The verdict to start from: pending comments → request changes; my earlier threads still open → comment; else approve.
export const defaultEvent = (pending: number, myOpenThreads: number): ReviewEvent => (pending ? 'REQUEST_CHANGES' : myOpenThreads ? 'COMMENT' : 'APPROVE');

// Why Slack couldn't reach someone, in words: a Slack sign-in from the browser can't look people up by email.
const slackWhy = (r: { login: string; error?: string }) =>
  /not_allowed_token_type/.test(r.error ?? '') ? `your Slack sign-in can't find people by email; map @${r.login} in Settings → Slack → People` : r.error;

function SubmitPanel({ unviewed = 0, viewAll, inline = false, count, myOpenThreads, mySummary, lineComments, slackTo, slackNote, threaded, onSubmit, saveAs, repo, mentions, authored, stillOpen = [], unlooked = 0, canMerge = false, inFlight = false, checkLanded, seeLanded }: SubmitProps) {
  const [open, setOpen] = useState(false);
  useDismiss(open && !inline, () => setOpen(false), '.review-submit');
  const root = useRef<HTMLDivElement>(null);
  // Inline, at the page's end: always there, and "open" (its checks run, its verdict picked) once scrolled to.
  useEffect(() => {
    if (!inline || !root.current) return;
    const o = new IntersectionObserver(([e]) => e.isIntersecting && setOpen(true));
    o.observe(root.current);
    return () => o.disconnect();
  }, [inline]);
  const [notify, toggleNotify] = useStoredFlag('slackNotify', true);
  const [next, toggleNext] = useStoredFlag('nextAfterReview', true);
  const [mergeIt, toggleMergeIt] = useStoredFlag('mergeOnApprove', false);
  const [viewRest, toggleViewRest] = useStoredFlag('viewAllOnSubmit', false);
  const viewing = viewRest && unviewed > 0;
  const merging = canMerge && mergeIt && !authored;
  const want = useRef<ReviewEvent | null>(null); // the verdict asked for (A: Approve), picked as it opens
  // Pushed while I read: the review would go on code I haven't seen. Asked each time the panel opens.
  const [landed, setLanded] = useState('');
  useEffect(() => {
    if (!open || !checkLanded) return;
    let live = true;
    checkLanded().then((t) => live && setLanded(t ?? ''), () => {});
    return () => void (live = false);
  }, [open]);
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [busy, setBusy] = useState(''); // what submitting is doing now
  const [err, setErr] = useState('');
  const labels: Record<ReviewEvent, string> = { COMMENT: 'Comment', APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes' };
  // Before you submit: can Slack reach each of them? Someone is reached through your mapping, a thread with them on this
  // PR, or their email, which a browser Slack sign-in can't look up (asked once a run). No Slack call per person.
  const [slackWarn, setSlackWarn] = useState('');
  const who = slackTo?.join(',') ?? '';
  useEffect(() => {
    if (!open || !notify || !slackTo?.length) return;
    let live = true;
    Promise.all([getSlackPeople(), slackFindsByEmail()]).then(([{ mine }, email]) => {
      const lost = slackTo.filter((l) => !mine[personKey(repo, l)] && !threaded.includes(l) && !threaded.includes(personKey(repo, l)));
      if (live) setSlackWarn(lost.length && !email ? `Slack won't reach ${lost.map((l) => '@' + l).join(', ')}: not mapped, and your Slack sign-in can't find people by email. Map them in Settings → Slack → People.` : '');
    }, () => {});
    return () => void (live = false);
  }, [open, notify, who, threaded.join(',')]);
  useEffect(() => {
    // detail.append: text for the summary, after what's there (an agent's answer, from Ask).
    const show = (e: Event) => {
      // The inline form when it's on screen, else the bar's.
      const end = document.querySelector('.submit-inline')?.getBoundingClientRect();
      if (inline !== (!!end && end.top < innerHeight && end.bottom > 0)) return;
      const { append: add, event: v } = (e as CustomEvent<{ append?: string; event?: ReviewEvent } | null>).detail ?? {};
      if (v) want.current = v;
      if (add) setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${add}` : add));
      setOpen(true);
      setTimeout(() => root.current?.querySelector<HTMLTextAreaElement>('.panel textarea')?.focus());
    };
    addEventListener('lgtm:finish', show);
    return () => removeEventListener('lgtm:finish', show);
  }, []);
  // Each time the panel opens, start from the verdict that fits the comments as they are now.
  // An unsent summary (and its verdict) is kept until it's sent: leaving, reloading or a failed send don't lose it.
  const kept = useRef<{ body: string; event: ReviewEvent } | null>(null);
  useEffect(() => {
    kept.current = null;
    void storage.get<{ body: string; event: ReviewEvent }>(saveAs).then((k) => k && ((kept.current = k), setBody(k.body), setEvent(k.event)));
  }, [saveAs]);
  // The two forms (bar, page's end) are one: what's written or picked in either shows in the other.
  const self = useRef(Symbol());
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) return void (mounted.current = true); // a form appearing doesn't blank the other
    dispatchEvent(new CustomEvent('lgtm:summary', { detail: { saveAs, from: self.current, body, event } }));
  }, [body, event]);
  useEffect(() => {
    const sync = (e: Event) => {
      const d = (e as CustomEvent<{ saveAs: string; from: symbol; body: string; event: ReviewEvent }>).detail;
      if (d.saveAs !== saveAs || d.from === self.current) return;
      setBody(d.body), setEvent(d.event);
      kept.current = d.body.trim() ? { body: d.body, event: d.event } : null;
    };
    addEventListener('lgtm:summary', sync);
    return () => removeEventListener('lgtm:summary', sync);
  }, [saveAs]);
  const keep = (b: string, e: ReviewEvent) => void (b.trim() && b !== mySummary && b !== APPROVE_NOTE ? storage.set(saveAs, { body: b, event: e }) : storage.remove(saveAs));
  useEffect(() => {
    if (!open) return;
    const w = want.current;
    want.current = null;
    if (w && !authored) pick(w);
    else if (!kept.current) setEvent(authored ? 'COMMENT' : defaultEvent(count, myOpenThreads));
  }, [open, authored]);
  // Approving with pending comments: say so, unless I've written my own summary.
  // Some verdicts start their summary: approving with comments pending says so; a change request, what my comments ask.
  const pick = (v: ReviewEvent) => {
    setEvent(v);
    if (kept.current) keep(body, v);
    if (v === 'APPROVE' && count && !body.trim()) setBody(APPROVE_NOTE);
    else if (v === 'REQUEST_CHANGES' && !count && mySummary && (!body.trim() || body === APPROVE_NOTE)) setBody(mySummary);
    else if (v !== 'APPROVE' && body === APPROVE_NOTE) setBody('');
    else if (v !== 'REQUEST_CHANGES' && body === mySummary) setBody('');
  };

  async function go() {
    setBusy('Submitting…');
    setErr('');
    try {
      const done = await onSubmit(event, body, notify, next && !authored, setBusy, merging && event === 'APPROVE');
      if (done) {
        if (viewing) viewAll?.();
        setOpen(false);
        setBody('');
        kept.current = null;
        if (done === true) void storage.remove(saveAs); // still sending: cleared once it's in
      }
    } catch (e: any) {
      setErr(e.message);
      reportError(`The review wasn't submitted: ${e.message}`);
    }
    setBusy('');
  }

  return (
    <div ref={root} class={inline ? 'submit-inline' : 'submit review-submit'}>
      {inline ? <h3>{authored ? 'Comment' : 'Finish review'}{count ? ` (${count})` : ''}</h3> : <button class="primary" aria-expanded={open} disabled={inFlight} onClick={() => setOpen(!open)}>
        {inFlight ? <><span class="btn-spin" aria-hidden="true" />Sending your review…</> : busy && !open ? <><span class="btn-spin" aria-hidden="true" />{busy}</> : <>{authored ? 'Comment' : 'Finish review'}{count ? ` (${count})` : ''} <span class="caret" aria-hidden="true" /></>}
      </button>}
      {(open || inline) && (
        <div class="panel">
          {inline && inFlight && <p class="note"><span class="btn-spin" aria-hidden="true" />Sending your review…</p>}
          <Editor
            value={body}
            onInput={(b: string) => (setBody(b), keep(b, event), (kept.current = b.trim() ? { body: b, event } : null))}
            onSubmit={() => !busy && go()}
            onCancel={() => !inline && setOpen(false)}
            repo={repo}
            mentions={mentions}
            autoFocus={!inline}
            placeholder="Leave a review summary (optional) · ⌘↵ to submit"
          />
          {!authored && (Object.keys(labels) as ReviewEvent[]).map((v) => (
            <label>
              <input type="radio" name={inline ? "event-end" : "event"} checked={event === v} onChange={() => pick(v)} /> {labels[v]}
            </label>
          ))}
          {slackTo && slackTo.length > 0 && (
            <label>
              <input type="checkbox" checked={notify} onChange={toggleNotify} /> Message {slackTo.map((l) => '@' + l).join(', ')} on Slack
            </label>
          )}
          {canMerge && !authored && event === 'APPROVE' && (
            <label title="Once your approval is in: merged the repo's usual way if nothing else is in the way, or auto-merge while only checks are left. Failing checks, a do-not-merge sign or another review still needed: not merged, and it says why">
              <input type="checkbox" checked={mergeIt} onChange={toggleMergeIt} /> Then merge it, or turn on auto-merge while checks run
            </label>
          )}
          {unviewed > 0 && (
            <label>
              <input type="checkbox" checked={viewRest} onChange={toggleViewRest} /> Then mark the rest viewed ({unviewed === 1 ? '1 file' : `${unviewed} files`})
            </label>
          )}
          {!authored && (
            <label>
              <input type="checkbox" checked={next} onChange={toggleNext} /> Then open the next PR that needs my review
            </label>
          )}
          {slackNote && <p class="note">{slackNote}</p>}
          {notify && slackWarn && <p class="warn">{slackWarn}</p>}
          {landed && (
            <p class="warn">
              {landed} <button class="link" onClick={() => (setOpen(false), seeLanded?.())}>See what changed</button>
            </p>
          )}
          {/* One place to look them over (Your threads): at the first agent draft not looked at, when there is one. */}
          {count > 0 && (
            <button class={unlooked ? 'look-over warn' : 'look-over'} title="Your comments to send, then your other threads, each with the code it's on" onClick={() => (setOpen(false), dispatchEvent(new Event(unlooked ? 'lgtm:look-drafts' : 'lgtm:my-threads')))}>
              {unlooked > 0 && <>{unlooked === 1 ? "An agent draft you haven't looked at goes" : `${unlooked} agent drafts you haven't looked at go`} with this review. </>}
              <span class="look-go">Look {count === 1 ? 'it' : `the ${count} comments`} over before sending →</span>
            </button>
          )}
          {event === 'APPROVE' && stillOpen.length > 0 && (
            <p class="warn approve-open">
              {stillOpen.length === 1 ? 'A thread you started is' : `${stillOpen.length} threads you started are`} still open, and{' '}
              {stillOpen.length === 1 ? 'its' : 'their'} code hasn't changed since you commented:{' '}
              {stillOpen.slice(0, 4).map((t, i) => (
                <>
                  {i ? ', ' : ''}
                  <button class="link" onClick={() => jumpTo(t.id, 'f-' + t.path)}>{fileLabel(t.path)}{t.line ? `:${t.line}` : ''}</button>
                </>
              ))}
              {stillOpen.length > 4 && ` and ${stillOpen.length - 4} more`}. You can still approve.
            </p>
          )}
          {/* What GitHub (and Slack) will get, so nothing about submitting is a surprise. */}
          <div class="sends">
            {event !== 'APPROVE' && !body.trim() && !count && !(event === 'REQUEST_CHANGES' && mySummary) ? (
              event === 'COMMENT' ? (myOpenThreads ? `Nothing new to send: your comments are already on ${site(repo)}. Submitting just moves on.` : 'Nothing to send yet: write a summary, or comment on lines.') : 'A change request needs to say what to change: write it above.'
            ) : (
              <>
                Sends {authored ? 'a comment' : { COMMENT: 'a comment', APPROVE: 'an approval', REQUEST_CHANGES: 'a change request' }[event]}
                {body.trim() ? ' with your summary' : event === 'REQUEST_CHANGES' ? ' with a summary of your comments' : ''}
                {count > 0 && `, and ${count} line comment${count > 1 ? 's' : ''}`}
                {merging && event === 'APPROVE' && '; then merges it if it may'}
                {viewing && `; marks ${unviewed === 1 ? 'the last file' : `the other ${unviewed} files`} viewed`}
                {notify && slackTo && slackTo.length > 0 && `; messages ${slackTo.map((l) => '@' + l).join(', ')} on Slack`}.
                {next && !authored && ' The next PR opens at once; this goes on in the background.'}
                {lineComments.length > 0 && (
                  <span class="sends-list">
                    {lineComments.slice(0, 6).map((d) => `${base(d.path)}${d.line ? ':' + d.line : ''}`).join(' · ')}
                    {lineComments.length > 6 ? ` · ${lineComments.length - 6} more` : ''}
                  </span>
                )}
              </>
            )}
          </div>
          <button class="primary" disabled={!!busy || (inline && inFlight)} onClick={go}>
            {busy ? <><span class="btn-spin" aria-hidden="true" />{busy}</> : authored ? 'Comment' : 'Submit review'}
          </button>
          {err && <p class="error">{err}</p>}
        </div>
      )}
    </div>
  );
}

// Source or rich diff, as GitHub's pair of buttons: <> the source, the file icon it rendered (Markdown, images).
function DiffMode({ rich, set }: { rich: boolean; set: (rich: boolean) => void }) {
  return (
    <span class="diff-mode" role="group" aria-label="Diff view">
      <button class="icon-btn" aria-pressed={!rich} title="Display the source diff" aria-label="Display the source diff" onClick={() => set(false)}><Octicon name="code" /></button>
      <button class="icon-btn" aria-pressed={rich} title="Display the rich diff" aria-label="Display the rich diff" onClick={() => set(true)}><Octicon name="file" /></button>
    </span>
  );
}

// A file on github.dev (VS Code in the browser, with the whole repo) at the PR's commit; the . key too. GitLab's own
// is its Web IDE.
const githubDev = (headRepo: string, sha: string, path: string, line?: number) =>
  isLab(headRepo)
    ? `https://${headRepo.slice(0, headRepo.indexOf('/'))}/-/ide/project/${headRepo.slice(headRepo.indexOf('/') + 1)}/edit/${sha}/-/${path.split('/').map(encodeURIComponent).join('/')}`
    : `https://github.dev/${headRepo}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}`;
function OpenInEditor({ headRepo, sha, path, line }: { headRepo: string; sha: string; path: string; line?: number }) {
  return (
    <button
      class="icon-btn"
      title={`Open ${isLab(headRepo) ? "in GitLab's Web IDE" : 'on github.dev'}, at the ${pageTerm().PRs_} commit${line ? `, line ${line}` : ''}${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').githubDev)}`}
      onClick={() => openExternal(githubDev(headRepo, sha, path, line))}
    >
      <Octicon name="link-external" />
    </button>
  );
}

// A file's sections (hunks) whose every change is whitespace, blank lines included, and how many it has: worked out
// once per loaded file.
const wsSeen = new WeakMap<File, { folded: number; total: number }>();
function wsSections(f: File) {
  if (!f.patch) return { folded: 0, total: 0 };
  if (!wsSeen.has(f)) {
    const hs = ignoreWhitespace(parsePatch(f.patch));
    wsSeen.set(f, { folded: hs.filter((h) => h.lines.every((l) => l.kind === ' ')).length, total: hs.length });
  }
  return wsSeen.get(f)!;
}
// Lines of text, for "less to read": a comment's, or its HTML's with paragraphs, items and breaks as line ends.
const linesIn = (texts: string[]) => texts.reduce((n, t) => n + t.split('\n').filter((l) => l.trim()).length, 0);
const htmlText = (html: string) => html.replace(/<\/(p|li|h\d|pre|tr|div|blockquote)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
// A file's moved lines folded (diff.ts moveRuns), once per file's moves.
const movedSeen = new WeakMap<Moved, number>();
function movedIn(f: File, m: Moved | undefined) {
  if (!m || !f.patch) return 0;
  if (!movedSeen.has(m)) movedSeen.set(m, moveRuns(parsePatch(f.patch), m).reduce((n, r) => n + r.count, 0));
  return movedSeen.get(m)!;
}
// A shown file's changed lines kept out of sight (diff.ts hiddenChanges), once per loaded file and setting.
const hiddenSeen = new WeakMap<File, Map<string, { ws: number; imports: number }>>();
function hiddenIn(f: File, ws: boolean, imports: boolean) {
  if (!f.patch || (!ws && !imports)) return { ws: 0, imports: 0 };
  const seen = hiddenSeen.get(f) ?? new Map();
  hiddenSeen.set(f, seen);
  const k = `${ws}${imports}`;
  if (!seen.has(k)) seen.set(k, hiddenChanges(f.filename, f.patch, ws, imports));
  return seen.get(k)!;
}
// A file whose every change is an import (diff.ts importsOnly), worked out once per loaded file and whitespace setting.
const importsSeen = new WeakMap<File, Map<boolean, boolean>>();
function onlyImports(f: File, ws: boolean) {
  if (!f.patch) return false;
  const seen = importsSeen.get(f) ?? new Map<boolean, boolean>();
  importsSeen.set(f, seen);
  if (!seen.has(ws)) seen.set(ws, importsOnly(f.filename, ws ? ignoreWhitespace(parsePatch(f.patch)) : parsePatch(f.patch)));
  return seen.get(ws)!;
}
const whitespaceOnly = (f: File) => { const s = wsSections(f); return s.total > 0 && s.folded === s.total; };

// A comment author's picture beside their name (GitHub's own URL for it when the data has one; bots' differ).
const Avatar = ({ login, src }: { login: string; src?: string }) => (
  <img class="c-avatar" src={src ?? faceOf(login)} alt="" loading="lazy" />
);

// Images' sizes once loaded (by their address as the page first had it; the 400 most recent), set on them next time
// before they load, so their space is kept and nothing below them jumps when they arrive.
let imgSizes: Record<string, [number, number]> | null = null;
let imgSave = 0;
function reserveImages(root: ParentNode | null) {
  try {
    imgSizes ??= JSON.parse(localStorage.getItem('imageSizes') ?? '{}');
  } catch {
    imgSizes = {};
  }
  for (const img of root?.querySelectorAll<HTMLImageElement>('img:not([data-sized])') ?? []) {
    img.dataset.sized = '';
    const key = img.getAttribute('src');
    if (!key || key.startsWith('data:')) continue;
    const seen = imgSizes![key];
    if (seen && !img.hasAttribute('width') && !img.hasAttribute('height')) [img.width, img.height] = seen;
    const keep = () => {
      if (!img.naturalWidth || seen?.[0] === img.naturalWidth) return;
      imgSizes![key] = [img.naturalWidth, img.naturalHeight];
      clearTimeout(imgSave);
      imgSave = window.setTimeout(() => {
        try {
          localStorage.setItem('imageSizes', JSON.stringify(Object.fromEntries(Object.entries(imgSizes!).slice(-400))));
        } catch {}
      }, 1000);
    };
    if (img.complete) keep();
    else img.addEventListener('load', keep, { once: true });
  }
}

// Files' heights as last drawn, by version and how they were shown (the 600 most recent), to stand in for them before
// they're drawn again.
let heights: Record<string, number> | null = null;
let heightsSave = 0;
const drawnHeight = (k: string) => {
  try {
    heights ??= JSON.parse(localStorage.getItem('fileHeights') ?? '{}');
  } catch {
    heights = {};
  }
  return heights![k];
};
const keepHeight = (k: string, h: number) => {
  if (drawnHeight(k) === h || h < 30) return;
  delete heights![k];
  heights![k] = h;
  clearTimeout(heightsSave);
  heightsSave = window.setTimeout(() => {
    try {
      localStorage.setItem('fileHeights', JSON.stringify(Object.fromEntries(Object.entries(heights!).slice(-600))));
    } catch {}
  }, 1000);
};

// What's come near and waits to be drawn, drawn one per task, the nearest to the screen first; one that leaves reach
// before its turn waits till it comes near again. A fast scroll passes dozens of files: drawn all at once, in page
// order, the ones you land on stayed blank till those you'd passed were done, and nothing could be drawn meanwhile.
const toDraw = new Map<Element, () => void>();
let drawing = 0;
const drawNearest = () => {
  drawing = 0;
  let best: Element | undefined;
  let far = Infinity;
  for (const el of toDraw.keys()) {
    const r = el.getBoundingClientRect();
    const d = Math.max(0, r.top - innerHeight, -r.bottom);
    if (d < far) (best = el), (far = d);
  }
  if (!best) return;
  toDraw.get(best)!();
  toDraw.delete(best);
  if (toDraw.size) drawing = window.setTimeout(drawNearest);
};

// Render a file's body only once it scrolls near the viewport (2000px either way, so it's drawn before it's seen).
// A shorter reach, on an element of its own, for work that costs a request (filling small gaps reads the file).
function useNear<T extends Element>(margin = '2000px', given?: { current: T | null }) {
  const own = useRef<T>(null);
  const ref = given ?? own;
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver(
      (es) => {
        if (es[es.length - 1].isIntersecting) {
          toDraw.set(el, () => (setNear(true), io.disconnect()));
          drawing ||= window.setTimeout(drawNearest);
        } else toDraw.delete(el);
      },
      { rootMargin: `${margin} 0px` },
    );
    io.observe(el);
    return () => (io.disconnect(), toDraw.delete(el));
  }, []);
  return [ref, near] as const;
}

// stand: the file's expected height (CSS) for a view that draws only once it has loaded, to hold its place till then.
type BodyProps = { file: File; hunks: Hunk[]; ctx: Ctx; threads: Thread[]; drafts: Draft[]; stand?: string; strings?: boolean; sxNotes?: Map<string, string[]> }; // strings: an Android strings file, read as texts; sxNotes: its translation checks

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
  // Right-click on the header (in the app): what its buttons do, in one menu.
  const fileMenu = async (e: MouseEvent) => {
    if (!isDesktop || getSelection()?.toString()) return;
    e.preventDefault();
    const { Menu } = await import('@tauri-apps/api/menu');
    const p = file.filename;
    const menu = await Menu.new({
      items: [
        { text: 'Copy Path', action: () => void copyText(p) },
        { text: 'Copy File Name', action: () => void copyText(p.slice(p.lastIndexOf('/') + 1)) },
        { text: `Open on ${site(ctx.repo)}`, action: () => void openExternal(file.blob_url) },
        { text: 'Comment on This File', action: () => ctx.setTarget({ path: p, side: 'RIGHT' }) },
        { text: viewed ? 'Mark as Not Viewed' : 'Mark as Viewed', action: onToggleViewed },
      ],
    });
    await menu.popup();
  };
  const canRich = isMarkdown(file.filename) && file.status !== 'removed' && !!file.patch;
  const [stringsView] = useStoredFlag('stringsView', true);
  const [translationChecks] = useStoredFlag('translationChecks', true);
  const [lintBaselines] = useStoredFlag('lintBaselines', true);
  const [manifestSummary] = useStoredFlag('manifestSummary', true);
  const [checkBinaries] = useStoredFlag('checkBinaries', true);
  const canStrings = stringsView && isStringsXml(file.filename) && !!file.patch;
  const [strings, setStrings] = useState(canStrings); // its names and texts; the pair of buttons switches to the XML
  const canLint = lintBaselines && isLintBaseline(file.filename) && !!file.patch;
  const [lint, setLint] = useState(canLint); // what it now suppresses, and what it no longer does; or the XML
  const [richFirst] = useStoredFlag('richMarkdown', true);
  const [previewFirst] = useStoredFlag('previewImages', true);
  const [collapseDeleted] = useStoredFlag('collapseDeleted', true);
  const [rich, setRich] = useState(canRich && richFirst);
  // Android drawables preview as images by default; one that isn't a <vector> (a selector, a shape) falls back to source.
  const [canPreview, setCanPreview] = useState(DRAWABLE.test(file.filename) || BITMAP.test(file.filename) || SVG.test(file.filename));
  const [preview, setPreview] = useState(canPreview && previewFirst);
  // A deleted file's old contents are mostly noise: one row until asked for, unless a line comment is already on it.
  const [showDeleted, setShowDeleted] = useState(threads.some((x) => !isFileLevel(x)) || drafts.some((d) => d.line));
  const hideDeleted = collapseDeleted && file.status === 'removed' && !showDeleted;
  const [ref, near] = useNear<HTMLElement>();
  const sxNotes = useTranslationNotes(file, ctx, canStrings && strings && near && translationChecks);
  // With whitespace ignored, a hunk left with no change at all (nor a comment on it) folds into the unchanged lines
  // around it. ponytail: those lines' old numbers (shown only with "old line numbers") can be off by the blank lines
  // the folded hunk added; split the gap there if that matters.
  const hunks = useMemo(() => {
    const all = parsePatch(file.patch ?? '');
    const noted = new Set([...threads.map((x) => x.line), ...drafts.map((d) => d.line)].filter((n): n is number => n != null));
    // Then only a few unchanged lines around each real change, as git would show them, minus the ones that say nothing.
    return trimContext(
      ctx.ignoreWs ? ignoreWhitespace(all).filter((h) => h.lines.some((l) => l.kind !== ' ' || (l.new != null && noted.has(l.new)))) : all,
      3,
      noted,
    );
  }, [file.patch, ctx.ignoreWs, threads.length, drafts.length]);
  const path = file.filename;
  const mod = ctx.modules?.get(path) ?? '';
  const folder = rest(mod ? dir(below(path, mod === '.' ? '' : mod)) : dir(path), path);
  const t = ctx.target;
  const body: BodyProps = { file, hunks, ctx, threads: threads.filter((x) => !isFileLevel(x)), drafts: drafts.filter((d) => d.line) };
  // Until it's first drawn, a file stands in at about its height (style.css content-visibility): its rows at a code
  // line each, plus the header; so drawing it barely moves the page (WebKit, the app's, doesn't hold your place).
  const rows = collapsed || hideDeleted ? 1 : hunks.reduce((n, h) => n + h.lines.length + 1, 0);
  // Better still, its height when last drawn (this version, shown this way), so reopening a PR barely moves at all.
  const shape = `${path}@${file.sha}:${rich || (canLint && lint) ? 'r' : 'd'}${ctx.ignoreWs ? 'w' : ''}${collapsed || hideDeleted ? 'c' : ''}`;
  const seen = drawnHeight(shape);
  const placeholder = seen ? `auto ${seen}px` : `auto calc(${rows} * 20px * var(--cs) + 48px)`;
  body.stand = seen ? `${Math.max(0, seen - 48)}px` : `calc(${rows} * 20px * var(--cs))`;
  useEffect(() => {
    const el = ref.current;
    if (!el || !near) return;
    const check = () => {
      const r = el.getBoundingClientRect();
      // Drawn (on screen, not stood in for) and complete (not waiting for its file).
      if (r.bottom > 0 && r.top < innerHeight && !el.querySelector('p.note.pad[style]')) keepHeight(shape, Math.round(r.height));
    };
    // When it changes size, and when it comes on screen (it may have finished drawing while away).
    const ro = new ResizeObserver(check);
    const io = new IntersectionObserver((es) => es[0].isIntersecting && check());
    ro.observe(el);
    io.observe(el);
    return () => (ro.disconnect(), io.disconnect());
  }, [near, shape]);

  return (
    <section class={viewed ? 'file viewed' : 'file'} id={'f-' + path} ref={ref} style={{ containIntrinsicSize: placeholder }}>
      <header class="file-h" onContextMenu={(e) => void fileMenu(e)}>
        {file.status !== 'modified' && <span class={`st s-${file.status}`}><Tg i={file.status} t={file.status} /></span>}{/* modified: the usual, untagged */}
        {/* The file's name, prominent; its Gradle module, if known; its folder small beside them (within the module, below
            src/), cut from the left (the nearest folders stay); the full path on hover. */}
        <a
          class="file-name"
          href={file.blob_url}
          target="_blank"
          rel="noopener"
          title={file.previous_filename ? `${file.previous_filename} → ${path}` : path}
        >
          <FileIcon path={path} big untested={ctx.untested.has(file.filename)} />
          <b>
            {file.previous_filename && leaf(file.previous_filename) !== leaf(path) && <>{leaf(file.previous_filename)} → </>}
            <FileName path={path} />
          </b>
          {mod && (
            <span class="file-mod" title={mod === '.' ? 'The root project' : `Module ${moduleName(mod)}, in ${mod}/`}>
              <ModuleIcon /> <span class="file-mod-name">{mod === '.' ? ':' : moduleName(mod)}</span>
            </span>
          )}
          {folder && (
            <span class="file-dir">
              <bdi>
                {file.previous_filename && dir(file.previous_filename) !== dir(path) && `${dir(file.previous_filename)} → `}
                {folder}
              </bdi>
            </span>
          )}
        </a>
        <span class="counts">
          <b class="a">+{num(file.additions)}</b> <b class="d">−{num(file.deletions)}</b>
        </span>
        <SpecChips refs={ctx.specRefs.get(path)} ix={ctx.codeIx} />
        {threads.length > 0 && <span class="badge" title="Review threads"><Octicon name="comment" /> {threads.length}</span>}
        {changed && <span class="new-b" title={`This file changed since you last opened this ${pageTerm().PR}`}>new since your last visit</span>}
        {canRich && <DiffMode rich={rich} set={setRich} />}
        {canStrings && <DiffMode rich={strings} set={setStrings} />}
        {canLint && <DiffMode rich={lint} set={setLint} />}
        {canPreview && <DiffMode rich={preview} set={setPreview} />}
        {file.status !== 'removed' && <OpenInEditor headRepo={ctx.headRepo} sha={ctx.pr.head.sha} path={path} line={hunks.flatMap((h) => h.lines).find((l) => l.kind === '+')?.new ?? hunks[0]?.lines.find((l) => l.new)?.new} />}
        <button class="icon-btn" title={`Comment on this file${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').fileComment)}`} aria-label="Comment on this file" onClick={() => ctx.setTarget({ path, side: 'RIGHT' })}>
          <Octicon name="comment" />
        </button>
        <ViewedToggle viewed={viewed} onToggle={onToggleViewed} title={`${viewed ? 'Viewed: click to mark as not viewed' : 'Mark as viewed'} on ${site(ctx.repo)}${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').viewed)}`} />
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
      {manifestSummary && isManifest(path) && (near || ctx.renderAll) && <ManifestSummary file={file} ctx={ctx} />}
      {canPreview && preview && (near || ctx.renderAll) ? (
        <ImagePreview file={file} ctx={ctx} onFail={() => (setCanPreview(false), setPreview(false))} />
      ) : checkBinaries && !file.patch && !file.additions && !file.deletions && file.status !== 'renamed' && (near || ctx.renderAll) ? (
        <BinaryInfo file={file} ctx={ctx} />
      ) : !file.patch ? (
        <p class="note pad">
          {!file.additions && !file.deletions && ['added', 'removed'].includes(file.status) && !!languageFor(file.filename) ? `An empty file, ${file.status === 'added' ? 'added' : 'deleted'}.` : 'No diff to show (binary, too large, or renamed without changes).'}{' '}
          <a href={file.blob_url} target="_blank" rel="noopener">View on {site(ctx.repo)}</a>
        </p>
      ) : hideDeleted ? (
        <button class="collapsed-row" onClick={() => setShowDeleted(true)}>
          Deleted. Show its {file.deletions} line{file.deletions === 1 ? '' : 's'}
        </button>
      ) : !near && !ctx.renderAll ? (
        <div style={{ height: `${hunks.reduce((s, h) => s + h.lines.length + 1, 0) * 20}px` }} />
      ) : canLint && lint ? (
        <LintBaselineView file={file} ctx={ctx} />
      ) : rich ? (
        <RichView {...body} />
      ) : (
        <DiffView {...body} strings={strings} sxNotes={sxNotes} />
      )}
          <Notes ctx={ctx} threads={[]} drafts={[]} form={t?.path === path && !!t.atEnd} />
          {!hideDeleted && <footer class="file-f">
            <span class="file-f-name" title={path}>{fileLabel(path)}</span>
            <button class="icon-btn" title="Comment on this file" aria-label="Comment on this file" onClick={() => ctx.setTarget({ path, side: 'RIGHT', atEnd: true })}>
              <Octicon name="comment" />
            </button>
            <ViewedToggle
              viewed={viewed}
              title={viewed ? 'Viewed: click to mark as not viewed' : 'Mark as viewed and go to the next file'}
              onToggle={() => {
                onToggleViewed();
                // Done with this file: collapse it and bring the next one up.
                if (!viewed) requestAnimationFrame(() => (ref.current?.nextElementSibling as HTMLElement | null)?.scrollIntoView());
              }}
            />
          </footer>}
        </>
      )}
    </section>
  );
}

// A file Git can't diff (a binary): what it is, its size before and after, where it ends up, and a word when it's
// big and not in Git LFS (every clone downloads every version of it, for good).
const BINARY_KINDS: [RegExp, string][] = [
  [/\.(bin|hex|img|fw|ota)$/i, 'Firmware or raw binary'],
  [/\.(so|a|dylib|dll)$/i, 'Native library'],
  [/\.(jar|aar)$/i, 'Java library'],
  [/\.(apk|aab|ipa)$/i, 'App package'],
  [/\.(zip|gz|tgz|tar|7z|rar)$/i, 'Archive'],
  [/\.(ttf|otf|woff2?)$/i, 'Font'],
  [/\.(mp3|wav|ogg|m4a|aac)$/i, 'Audio'],
  [/\.(mp4|mov|webm)$/i, 'Video'],
  [/\.pdf$/i, 'PDF'],
  [/\.(db|sqlite|realm)$/i, 'Database'],
  [/\.(jks|keystore|p12|pfx|pem|key)$/i, 'Key store or key: check it holds no secret'],
];
const BIG = 1024 * 1024;
const bytes = (n: number) => (n < 1024 ? `${n} B` : n < BIG ? `${(n / 1024).toFixed(1)} KB` : `${(n / BIG).toFixed(1)} MB`);
function BinaryInfo({ file, ctx }: { file: File; ctx: Ctx }) {
  const path = file.filename;
  const [info, setInfo] = useState<{ was?: { size: number; lfs: boolean } | null; now?: { size: number; lfs: boolean } | null } | null>(null);
  useEffect(() => {
    const repo = ctx.repo;
    Promise.all([
      file.status === 'added' ? null : getBlobInfo(repo, file.previous_filename ?? path, ctx.pr.base.sha).catch(() => null),
      file.status === 'removed' ? null : getBlobInfo(ctx.headRepo, path, ctx.pr.head.sha).catch(() => null),
    ]).then(([was, now]) => setInfo({ was, now }));
  }, [file.sha]);
  const kind = BINARY_KINDS.find(([re]) => re.test(path))?.[1];
  const ships = path.match(/(?:^|\/)src\/(\w+)\/(?:assets|res\/raw)\//)?.[1]; // Android: packed into the app as is
  const { was, now } = info ?? {};
  if (info && !was?.size && !now?.size)
    return <p class="note pad">{file.status === 'removed' ? 'An empty file, deleted.' : file.status === 'added' ? 'An empty file, added.' : 'No diff to show.'} <a href={file.blob_url} target="_blank" rel="noopener">View on {site(ctx.repo)}</a></p>;
  return (
    <div class="bin-info">
      <p>
        <Octicon name="file" /> {kind ?? 'Binary file'}
        {info ? (
          <>
            {' · '}
            {was && now ? <>{bytes(was.size)} → <b>{bytes(now.size)}</b></> : now ? <b>{bytes(now.size)}</b> : was ? <>{bytes(was.size)}, deleted</> : null}
            {(now ?? was)?.lfs && ' · in Git LFS'}
          </>
        ) : (
          ' · …'
        )}
        {ships && file.status !== 'removed' && <> · packed into the app{ships === 'main' ? '' : ` (${ships} builds)`}</>}{' '}
        <a href={file.blob_url} target="_blank" rel="noopener">View on {site(ctx.repo)}</a>
      </p>
      {now && !now.lfs && file.lfs && (
        <p class="bin-warn">
          <Octicon name="alert" /> The repo's .gitattributes puts this in Git LFS, but it went straight into Git: Git LFS wasn't set up where it was
          committed. Run <code>git lfs install</code>, then <code>git rm --cached</code> and add it again.{' '}
          <SayIt onClick={() => ctx.suggest(path, undefined, "The repo's .gitattributes puts this file in Git LFS, but it was committed straight into Git (Git LFS wasn't installed where it was committed). Could you run `git lfs install`, then `git rm --cached` it and add it again?")} />
        </p>
      )}
      {now && !now.lfs && !file.lfs && now.size > BIG && (
        <p class="bin-warn">
          <Octicon name="alert" /> Over 1 MB, straight in Git: every clone downloads it, and every version of it, for good. Git LFS keeps big files out of the history.{' '}
          <SayIt onClick={() => ctx.suggest(path, undefined, `This is ${bytes(now.size)}, committed straight into Git: every clone will download it, and every later version of it, for good. Could it go in Git LFS?`)} />
        </p>
      )}
    </div>
  );
}

// "2 tests switched off", "3 checks switched off", "CI step let off", or "4 switched off" for a mix.
const offLabel = (xs: { test: boolean; ci?: boolean }[]) => {
  const kinds = new Set(xs.map((x) => (x.ci ? 'CI step' : x.test ? 'test' : 'check')));
  return kinds.size > 1 ? 'switched off' : `${[...kinds][0]}${xs.length > 1 ? 's' : ''} switched off`;
};

// Possible secrets, worked out once per file list (the list is the same object until the PR reloads).
const secretsSeen = new WeakMap<object, { list: Secret[]; byPath: Map<string, Map<number, string>> }>();
function secretsOf(files: File[]) {
  let s = secretsSeen.get(files);
  if (!s) {
    const list = findSecrets(files);
    const byPath = new Map<string, Map<number, string>>();
    for (const x of list) byPath.set(x.path, (byPath.get(x.path) ?? new Map()).set(x.line, x.kind));
    secretsSeen.set(files, (s = { list, byPath }));
  }
  return s;
}

// "an AWS access key", "a private key", "a hard-coded storePassword": a secret's kind (secrets.ts) in a sentence.
const aKind = (kind: string) => {
  const k = kind.replace(/^A literal /, 'hard-coded ').replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());
  return `${/^[aeiouAEIO]|^[FHLMNRSX][A-Z]/.test(k) ? 'an' : 'a'} ${k}`;
};

// A finding's "comment on it" button, beside it in a list.
const SayIt = ({ onClick }: { onClick: () => void }) => (
  <button class="say-it" title="Comment on it: a comment drafted for you to edit" aria-label="Comment on it" onClick={onClick}>
    <Octicon name="comment" />
  </button>
);

// UI text written in code (hardcoded.ts), once per file list.
const textsSeen = new WeakMap<object, { list: Hardcoded[]; byPath: Map<string, Map<number, string>> }>();
function textsOf(files: File[]) {
  let t = textsSeen.get(files);
  if (!t) {
    const list = findHardcoded(files);
    const byPath = new Map<string, Map<number, string>>();
    for (const x of list) byPath.set(x.path, (byPath.get(x.path) ?? new Map()).set(x.line, x.text));
    textsSeen.set(files, (t = { list, byPath }));
  }
  return t;
}

// The web checks (web.ts), once per file list.
const webSeen = new WeakMap<object, { focus: WebHit[]; html: WebHit[] }>();
const webOf = (files: File[]) => webSeen.get(files) ?? (webSeen.set(files, { focus: focused(files), html: rawHtml(files) }), webSeen.get(files)!);

// Dependency changes (deps.ts), once per file list; and a library's page, where its versions and changelog are.
const depsSeen = new WeakMap<object, DepChange[]>();
const depsOf = (files: File[]) => depsSeen.get(files) ?? (depsSeen.set(files, depChanges(files)), depsSeen.get(files)!);
const depPage = (d: DepChange) =>
  d.npm ? `https://www.npmjs.com/package/${d.name}?activeTab=versions` : /^[\w.-]+:[\w.-]+$/.test(d.name) ? `https://central.sonatype.com/artifact/${d.name.replace(':', '/')}/versions` : undefined;

// A big PR's reading plan (files.ts reviewPlan): each step with how much of it is viewed, a click to its first file
// not yet viewed. The files are in its order unless Settings → "Files in reading order" is off.
function ReviewPlan({ plan, viewed }: { plan: PlanStep[]; viewed: Set<string> }) {
  const [open, toggleOpen] = useStoredFlag('planOpen', true);
  const total = plan.reduce((n, s) => n + s.paths.length, 0);
  const done = plan.reduce((n, s) => n + s.paths.filter((p) => viewed.has(p)).length, 0);
  return (
    <details class="plan" open={open} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open !== open && toggleOpen()}>
      <summary>
        <b>Review plan</b> · {total} files in {plan.length} steps · {done}/{total} viewed
      </summary>
      <ol>
        {plan.map((s) => {
          const left = s.paths.filter((p) => !viewed.has(p));
          const seen = s.paths.length - left.length;
          return (
            <li class={left.length ? '' : 'done'}>
              <span class="plan-t">
                <Octicon name={stepIcon(s.key)} /> <b>{s.title}</b> <small>{s.why}</small>
              </span>
              <span class="plan-bar" title={`${seen} of ${s.paths.length} viewed`}>
                <i style={{ width: `${(100 * seen) / s.paths.length}%` }} />
              </span>
              <small class="plan-n">{seen}/{s.paths.length}</small>
              {left.length ? (
                <button class="link" onClick={() => jumpTo('f-' + left[0])}>{seen ? 'Continue' : 'Start'}</button>
              ) : (
                <span class="plan-ok"><Octicon name="check" /></span>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

// An Android manifest's change, above its diff: permissions asked for or dropped (the ones users are asked about
// marked), and components other apps can now reach. Whole files, before and after: a tag cut by a hunk still counts.
function ManifestSummary({ file, ctx }: { file: File; ctx: Ctx }) {
  const [c, setC] = useState<ManifestChanges | null>(null);
  useEffect(() => {
    const get = (repo: string, path: string, sha: string) => getRaw(repo, path, sha).then((t) => t ?? '', () => null);
    Promise.all([
      file.status === 'added' ? '' : wholeFromPatch(file) ?? get(ctx.repo, file.previous_filename ?? file.filename, ctx.pr.base.sha), // an added or removed file's diff is the file
      file.status === 'removed' ? '' : wholeFromPatch(file) ?? get(ctx.headRepo, file.filename, ctx.pr.head.sha),
    ]).then(([a, b]) => a != null && b != null && setC(manifestChanges(a, b)));
  }, [file.sha]);
  if (!c || !(c.added.length + c.removed.length + c.newComps.length + c.goneComps.length + c.nowExported.length)) return null;
  const say = (body: string) => <SayIt onClick={() => ctx.suggest(file.filename, undefined, body)} />;
  const perm = (p: string, ask = false) => (
    <>
      <code class={isRisky(p) ? 'risky' : ''} title={isRisky(p) ? 'Users are asked for this one, or it reaches far' : undefined}>
        {p.replace(/^android\.permission\./, '')}
      </code>
      {ask && isRisky(p) && say(`This asks for ${p.replace(/^android\.permission\./, '')}, which users are asked to grant (or which reaches far). Is it needed, and is a refusal handled?`)}
    </>
  );
  const comp = (x: { type: string; name: string; exported: boolean; implicit: boolean }) => (
    <>
      {x.type} {cls(x.name)}
      {x.exported && <b class="risky"> exported{x.implicit ? ' (by its intent-filter)' : ''}</b>}
      {x.exported && say(`${x.name.split('.').pop()} is exported${x.implicit ? ' (its intent-filter makes it so)' : ''}, so other apps can start it. Is that intended? If not, android:exported="false".`)}
    </>
  );
  const list = (items: ComponentChildren[]) => items.map((x, i) => <>{i ? ', ' : ''}{x}</>);
  const cls = (name: string) => <code title={name}>{name.split('.').pop()}</code>; // the class; its package on hover
  return (
    <div class="manifest-sum">
      {c.added.length > 0 && <p><b>Asks for</b> {list(c.added.map((p) => perm(p, true)))}</p>}
      {c.removed.length > 0 && <p><b>No longer asks for</b> {list(c.removed.map((p) => perm(p)))}</p>}
      {c.nowExported.length > 0 && <p><b>Now exported</b>, other apps can reach: {list(c.nowExported.map((x) => <>{x.type} {cls(x.name)}{say(`${x.name.split('.').pop()} is now exported, so other apps can start it. Is that intended?`)}</>))}</p>}
      {c.newComps.length > 0 && <p><b>New</b> {list(c.newComps.map(comp))}</p>}
      {c.goneComps.length > 0 && <p><b>Removed</b> {list(c.goneComps.map((x) => <>{x.type} {cls(x.name)}</>))}</p>}
    </div>
  );
}

// A lint baseline as what changed in it: new suppressions first (warnings now hidden: worth a question), then the
// cleared ones (fixed), each at its code (in this PR, or on GitHub).
function LintBaselineView({ file, ctx }: { file: File; ctx: Ctx }) {
  const { added, removed } = useMemo(() => baselineChanges(file.filename, file.patch ?? ''), [file.patch]);
  const at = (x: Suppression) => {
    const where = `${fileLabel(x.file)}${x.line ? `:${x.line}` : ''}`;
    return ctx.codeIx.patches.has(x.file) ? (
      <a href={'#'} onClick={(e) => (e.preventDefault(), jumpToLine(x.file, x.line))} title={x.file}>{where}</a>
    ) : (
      <a href={blobWebUrl(ctx.headRepo, ctx.pr.head.sha, x.file, x.line)} target="_blank" rel="noopener" title={x.file}>{where}</a>
    );
  };
  const row = (x: Suppression, ask = false) => (
    <li>
      <code>{x.id}</code> {at(x)} <span class="lint-msg">{x.message}</span>
      {ask && <SayIt onClick={() => ctx.suggest(file.filename, undefined, `This adds a lint suppression for ${x.id} in ${x.file.split('/').pop()}${x.line ? `:${x.line}` : ''} ("${x.message}"). Could the warning be fixed instead?`)} />}
    </li>
  );
  return (
    <div class="lint-sum">
      {added.length ? (
        <>
          <p class="lint-new">
            <Octicon name="alert" /> <b>{added.length} new suppression{added.length === 1 ? '' : 's'}</b>: warnings lint will no longer report.
          </p>
          <ul>{added.map((x) => row(x, true))}</ul>
        </>
      ) : (
        <p>No new suppressions.</p>
      )}
      {removed.length > 0 && (
        <details>
          <summary>{removed.length} cleared (fixed, or their code went)</summary>
          <ul>{removed.map((x) => row(x))}</ul>
        </details>
      )}
      {!added.length && !removed.length && <p class="note">Only line numbers moved.</p>}
    </div>
  );
}

// Before / after images (base branch vs PR head): bitmaps as they are, SVG files as images (an <img> runs none of
// their scripts; nor are they linked to open on their own, where it would), Android vector drawables converted to SVG.
const BITMAP = /\.(png|webp|jpe?g|gif)$/i;
const SVG = /\.svg$/i;
// An SVG's size from its own attributes (width × height, else its viewBox), for the caption.
const svgSize = (text: string) => {
  const tag = text.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const attr = (n: string) => tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)`, 'i'))?.[1];
  const [w, h] = [attr('width'), attr('height')];
  if (w && h) return `${w.replace(/px$/, '')}×${h.replace(/px$/, '')}`;
  const vb = attr('viewBox')?.trim().split(/[\s,]+/);
  return vb?.length === 4 ? `${vb[2]}×${vb[3]} (viewBox)` : undefined;
};
const DRAWABLE = /\/res\/drawable[^/]*\/[^/]+\.xml$/;
type Shot = { src: string; size?: string; note?: string; noLink?: boolean };
function ImagePreview({ file, ctx, onFail }: { file: File; ctx: Ctx; onFail: () => void }) {
  const [shots, setShots] = useState<{ before: Shot | null; after: Shot | null } | null>(null);
  const [dims, setDims] = useState<Record<string, string>>({});
  const [mode, setMode] = useStoredValue('imageCompare', 'side'); // a changed image: side by side, swiped, faded, or its difference
  const [x, setX] = useState(50);
  const [h, setH] = useState(160); // the swipe's height: the new image's, small icons scaled up as side by side
  useEffect(() => {
    const load = async (repo: string, path: string, ref: string): Promise<Shot | null> => {
      if (BITMAP.test(file.filename)) {
        const src = await getDownloadUrl(repo, path, ref);
        return src ? { src } : null;
      }
      const text = await getRaw(repo, path, ref);
      if (SVG.test(file.filename)) return text ? { src: 'data:image/svg+xml,' + encodeURIComponent(text), size: svgSize(text), noLink: true } : null;
      const v = text ? vectorToSvg(text) : null;
      return v && { src: 'data:image/svg+xml,' + encodeURIComponent(v.svg), size: `${v.width}×${v.height}dp`, note: v.approx ? 'Colours from resources (@color/…, ?attr/…) are drawn grey.' : undefined };
    };
    Promise.all([
      file.status === 'added' ? null : load(ctx.repo, file.previous_filename ?? file.filename, ctx.pr.base.sha),
      file.status === 'removed' ? null : load(ctx.headRepo, file.filename, ctx.pr.head.sha),
    ]).then(([before, after]) => (before || after ? setShots({ before, after }) : onFail()), onFail);
  }, []);
  if (!shots) return <div class="pad"><Lines n={4} /></div>;
  // Its file name in Preview: before-icon.png and after-icon.png (a drawable, drawn as SVG, as .svg).
  const shotName = (label: string, s: Shot) => `${label.toLowerCase()}-${file.filename.split('/').pop()!.replace(/\.xml$/, '')}${s.src.startsWith('data:image/svg') && !/\.svg$/.test(file.filename) ? '.svg' : ''}`;
  const fig = (label: string, s: Shot | null) =>
    s && (
      <figure>
        <a href={s.noLink ? undefined : s.src} target="_blank" rel="noopener" title={s.noLink ? undefined : 'Open full size'}>
        <img
          src={s.src}
          alt={`${label}: ${file.filename}`}
          data-name={shotName(label, s)}
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
  const both = shots.before && shots.after;
  const modes = both && (
    <span class="set-seg img-modes" role="radiogroup" aria-label="Compare">
      {([['side', 'Side by side'], ['swipe', 'Swipe'], ['fade', 'Fade'], ['diff', 'Difference']] as const).map(([v, name]) => (
        <button role="radio" aria-checked={mode === v} class={mode === v ? 'on' : ''} onClick={() => setMode(v)}>{name}</button>
      ))}
    </span>
  );
  // Swipe: the new version over the old, cut at the slider; left of it the old, right the new. Fade: the new one over
  // the old, as see-through as the slider says. Difference: what's the same goes black, what changed lights up.
  if (both && (mode === 'swipe' || mode === 'fade' || mode === 'diff'))
    return (
      <div class="vector-preview swipe-preview">
        {modes}
        <div class={mode === 'diff' ? 'img-swipe diff' : 'img-swipe'}>
          <img src={shots.before!.src} alt={`Before: ${file.filename}`} data-name={shotName('Before', shots.before!)} style={{ height: `${h}px` }} />
          <img
            src={shots.after!.src}
            alt={`After: ${file.filename}`}
            data-name={shotName('After', shots.after!)}
            style={{ height: `${h}px`, ...(mode === 'swipe' ? { clipPath: `inset(0 0 0 ${x}%)` } : mode === 'fade' ? { opacity: x / 100 } : { mixBlendMode: 'difference' }) }}
            onLoad={(e) => setH(Math.min(320, Math.max(96, e.currentTarget.naturalHeight)))}
          />
          {mode === 'swipe' && <span class="img-swipe-line" style={{ left: `${x}%` }} />}
        </div>
        {mode === 'diff' ? (
          <span class="img-swipe-labels"><span>Black: unchanged · bright: changed</span></span>
        ) : (
          <>
            <input type="range" min={0} max={100} value={x} onInput={(e) => setX(Number(e.currentTarget.value))} aria-label="Before ↔ after" />
            <span class="img-swipe-labels"><span>Before</span><span>After</span></span>
          </>
        )}
        {note && <p class="note">{note}</p>}
      </div>
    );
  return (
    <div class="vector-preview">
      {modes}
      {fig('Before', shots.before)}
      {both && <span class="vp-arrow">→</span>}
      {fig(shots.before ? 'After' : file.status === 'removed' ? 'Deleted' : 'New', shots.after)}
      {note && <p class="note">{note}</p>}
    </div>
  );
}

// An Android strings file's changed strings checked against the other languages' same file at the PR's commit
// (strings.ts translationNotes): one folder listing per res/ folder, one file per language.
const resDirs = new Map<string, Promise<string[]>>();
function useTranslationNotes(file: File, ctx: Ctx, on: boolean) {
  const [notes, setNotes] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    const m = file.filename.match(/^(.*\/res)\/(values[^/]*)\/([^/]+)$/);
    const changed = on && m && file.patch ? changedStrings(parsePatch(file.patch).flatMap((h) => h.lines)) : null;
    if (!m || !changed?.size) return;
    const [, res, dir, name] = m;
    const sha = ctx.pr.head.sha;
    let stop = false;
    (async () => {
      const key = `${ctx.headRepo}@${sha}:${res}`;
      if (!resDirs.has(key)) resDirs.set(key, listDir(ctx.headRepo, res, sha).then((l) => l.filter((x) => x.type === 'dir').map((x) => x.name), () => []));
      const others = [];
      for (const d of (await resDirs.get(key)!).filter((d) => d !== dir && isLocaleDir(d))) {
        const path = `${res}/${d}/${name}`;
        const xml = await getRaw(ctx.headRepo, path, sha).catch(() => null);
        if (xml == null) continue;
        const theirs = ctx.codeIx.patches.get(path);
        others.push({ dir: d, strings: stringsOf(xml), changed: new Set(theirs ? changedStrings(parsePatch(theirs).flatMap((h) => h.lines)).keys() : []) });
      }
      if (!stop) setNotes(translationNotes(changed, others));
    })();
    return () => void (stop = true);
  }, [file.sha, on]);
  return notes;
}

function DiffView({ file, hunks, ctx, threads, drafts, strings, sxNotes }: BodyProps) {
  // One line number, the new one (a removed line shows its old one, faint), unless Settings asks for both.
  const [oldNums] = useStoredFlag('oldLineNumbers', false);
  const path = file.filename;
  const [rainbowOn] = useStoredFlag('rainbowBrackets', true); // highlightCode reads it (main.tsx sets it)
  const hl = useMemo(() => highlightHunks(hunks, path), [hunks, rainbowOn]);
  // "Show more lines": unchanged stretches come from the head version of the file, fetched on first use.
  const gapList = useMemo(() => (file.status === 'added' || file.status === 'removed' ? [] : gaps(hunks)), [hunks]);
  const [head, setHead] = useState<string[] | null>(null);
  const [openGaps, setOpenGaps] = useState<Set<number>>(new Set());
  const [gapErr, setGapErr] = useState('');
  const headLoad = useRef<Promise<string[]> | null>(null); // fetched once, however many gaps open
  const expand = async (...gs: Gap[]) => {
    setGapErr('');
    try {
      headLoad.current ??= getRaw(ctx.headRepo, path, ctx.pr.head.sha).then((src) => {
        if (src == null) throw new Error('file not found at the head commit');
        return src.replace(/\n$/, '').split('\n');
      });
      setHead(await headLoad.current);
      setOpenGaps((s) => new Set([...s, ...gs.map((g) => g.before)]));
    } catch (e: any) {
      headLoad.current = null;
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
        {html ? <td class="code" dangerouslySetInnerHTML={{ __html: dedentHtml(html[i], indent) }} /> : <td class="code">{text.replace(new RegExp(`^[ \\t]{0,${indent}}`), '')}</td>}
      </tr>
    ));
  };
  const gapBefore = (i: number) => gapList.find((g) => g.before === i);
  const t = ctx.target?.path === path ? ctx.target : null;

  // A line on GitHub at this PR's commit (the old file for a removed line).
  const lineUrl = (side: Side, line: number) =>
    side === 'LEFT' ? blobWebUrl(ctx.repo, ctx.pr.base.sha, file.previous_filename ?? path, line) : blobWebUrl(ctx.headRepo, ctx.pr.head.sha, path, line);
  // Right-click on a line (in the app): what its number does, in one menu. Selected text keeps the system's own menu.
  const lineMenu = async (e: MouseEvent, side: Side, line: number) => {
    if (!isDesktop || (e.target as Element).closest('a, img, video') || getSelection()?.toString()) return;
    e.preventDefault();
    const { Menu } = await import('@tauri-apps/api/menu');
    const menu = await Menu.new({
      items: [
        { text: 'Comment on This Line', action: () => pick({ altKey: false, shiftKey: false } as MouseEvent, side, line) },
        { text: 'Copy Link to Line', action: () => pick({ altKey: true, shiftKey: false } as MouseEvent, side, line) },
        { text: `Open on ${site(ctx.repo)}`, action: () => void openExternal(lineUrl(side, line)) },
      ],
    });
    await menu.popup();
  };
  const pick = (e: MouseEvent, side: Side, line: number) => {
    // ⌥-click: a link to the line on GitHub at this PR's commit (the old file for a removed line), to share.
    if (e.altKey) {
      const url = lineUrl(side, line);
      void copyText(url).then(
        () => dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `Link to line ${line} copied`, ms: 2500 } })),
        () => dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: "Couldn't copy the link", ms: 2500 } })),
      );
      return;
    }
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
  // A gap of a few lines takes about the room of its button: its lines show instead, once the file is about on screen
  // (filling it reads the whole file; the 2000px the file draws ahead would read dozens at once on a big PR).
  const [, onScreen] = useNear('300px', table);
  useEffect(() => {
    const small = onScreen ? gapList.filter((g) => g.to !== null && g.to - g.from + 1 <= 3) : [];
    if (small.length) void expand(...small);
  }, [gapList, onScreen]);
  const words = useWordMarks(hunks);
  // In a test, a phase comment (// Given …) shows as its label: setup, action and checks each their colour.
  const testFile = inTests(path);
  const phaseHtml = (text: string) => {
    const p = testPhase(text)!;
    const lead = text.match(/^\s*/)![0].slice(indent);
    return `${lead}<span class="ph ph-${p.kind}">${p.word}</span>${p.rest ? ` <span class="ph-rest">${md.utils.escapeHtml(p.rest)}</span>` : ''}`;
  };
  // An Android string: its name and text; changed, the part that changed (against the same name's other side).
  const stringRow = (hi: number, li: number, s: NonNullable<ReturnType<typeof parseString>>) => {
    const l = hunks[hi].lines[li];
    const other = l.kind === ' ' ? null : hunks[hi].lines.map((x) => parseString(x.text)).find((o, i) => o && o.name === s.name && hunks[hi].lines[i].kind === (l.kind === '+' ? '-' : '+'));
    const r = other && changedRange(l.kind === '-' ? s.value : other.value, l.kind === '-' ? other.value : s.value);
    return stringHtml({ ...s, lead: s.lead.slice(indent) }, r ? (l.kind === '-' ? r[0] : r[1]) : undefined, l.kind === '+' ? sxNotes?.get(s.name) : undefined);
  };
  const codeHtml = (hi: number, li: number, text: string) => {
    if (testFile && testPhase(text)) return phaseHtml(text);
    const sx = strings ? parseString(text) : null;
    if (sx) return stringRow(hi, li, sx);
    const html = hl ? hl[hi][li] : md.utils.escapeHtml(text);
    const w = words.get(`${hi}-${li}`);
    return dedentHtml(w ? markText(html, w[1], w[2], w[0]) : html, indent);
  };
  const mv = ctx.moved.get(path);
  const secretAt = ctx.secrets.get(path);
  const textAt = ctx.hardcoded.get(path);
  const flagAt = ctx.flagged.get(path);
  // Kotlin/Java import blocks fold to one row (opened by click, or by a comment on one of their lines).
  const [foldImports] = useStoredFlag('foldImports', true);
  const folds = useMemo(() => (foldImports && importSyntax(path) ? importFolds(hunks, importSyntax(path)!) : []), [hunks, foldImports]);
  // The indentation all the file's shown lines share, left out (Settings → Diff), so nested code starts at the left.
  // Folded imports don't count: they sit at the left anyway.
  const [trimIndent] = useStoredFlag('trimIndent', true);
  const indent = useMemo(
    () => (trimIndent ? commonIndent(hunks.flatMap((h, hi) => h.lines.filter((_, i) => !folds.some((f) => f.hunk === hi && i >= f.start && i <= f.end)).map((l) => l.text))) : 0),
    [hunks, folds, trimIndent],
  );
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
  // Code moved without changes (diff.ts moveRuns): each copy one row until opened, or commented on (unified view only:
  // side by side pairs its rows across the sides).
  const moves = useMemo(() => moveRuns(hunks, mv), [hunks, mv]);
  const [openMoves, setOpenMoves] = useState<Set<string>>(new Set());
  const moveAt = (hi: number, li: number): MoveRun | undefined => {
    const l = hunks[hi].lines[li];
    return moves.find((r) => r.hunk === hi && r.kind === l.kind && li >= r.start && li <= r.end && !openMoves.has(`${hi}-${r.start}`) && !hunks[hi].lines.slice(r.start, r.end + 1).some((x) => x.kind === r.kind && lineNoted(x)));
  };
  // Hunks that are nothing but a folded import block (one, or several in a row: a long import list changed in two
  // places): one row for them all until it's opened, taking in the unchanged imports between them and, at the file's
  // top, the lines above; the unchanged lines after them get their button in that same row.
  const importRuns = useMemo(() => {
    const only = hunks.map((h, hi) => !h.lines.some(lineNoted) && folds.some((f) => f.hunk === hi && f.start === 0 && f.end === h.lines.length - 1));
    const runs: { first: number; last: number }[] = [];
    only.forEach((yes, hi) => {
      if (!yes) return;
      const r = runs.at(-1);
      if (r && r.last === hi - 1) r.last = hi;
      else runs.push({ first: hi, last: hi });
    });
    return runs;
  }, [hunks, folds, threads.length, drafts.length]);
  const closedRun = (hi: number) => importRuns.find((r) => hi >= r.first && hi <= r.last && !folds.some((f) => f.hunk >= r.first && f.hunk <= r.last && openFolds.has(`${f.hunk}-${f.start}`)));
  // The gap row before hunk `i` that a closed run's one row stands in for: between its hunks, above it at the file's
  // top, and (until opened) the one after it.
  const gapInRun = (i: number) => {
    const at = closedRun(i), before = closedRun(i - 1);
    return (!!at && (i > at.first || at.first === 0)) || (!!before && before.last === i - 1 && !openGaps.has(i));
  };
  // KDoc / Javadoc / JSDoc comments, rendered like IntelliJ's reader mode; "source" shows the lines again.
  const [renderDocs] = useStoredFlag('renderDocs', true);
  const [renderEdited] = useStoredFlag('renderEditedDocs', true); // edited ones too, changed parts marked
  const [renderLine] = useStoredFlag('renderLineComments', true); // runs of // comments too
  const [renderSingle] = useStoredFlag('renderSingleComments', true); // and lone comment lines
  // Side by side (Settings → Diff, or the bar's button): old and new as two halves of each row, removed lines paired
  // with the added ones after them. Doc comments stay as source there.
  const [split] = useStoredFlag('splitDiff', false);
  // Each run of changed lines (removed and added, in any order) drawn at its first line, its removed and added lines
  // lined up by likeness (diff.ts alignChanges); an unchanged line, a row of its own.
  const splitPlan = useMemo(
    () =>
      split
        ? hunks.map((h) => {
            const at = new Map<number, [number | null, number | null][]>();
            for (let i = 0; i < h.lines.length; ) {
              if (h.lines[i].kind === ' ') {
                at.set(i, [[i, i]]);
                i++;
                continue;
              }
              const start = i, dels: number[] = [], adds: number[] = [];
              for (; i < h.lines.length && h.lines[i].kind !== ' '; i++) (h.lines[i].kind === '-' ? dels : adds).push(i);
              at.set(start, alignChanges(dels.map((k) => h.lines[k].text), adds.map((k) => h.lines[k].text)).map(([d, a]) => [d == null ? null : dels[d], a == null ? null : adds[a]]));
            }
            return at;
          })
        : null,
    [hunks, split],
  );
  const docs = useMemo(
    () =>
      !renderDocs || split
        ? []
        : [
            ...(docSyntax(path) ? [...docBlocks(hunks), ...(renderEdited ? editedDocBlocks(hunks) : [])] : []),
            ...(renderLine && lineCommentSyntax(path) ? lineCommentBlocks(hunks, renderEdited, lineCommentSyntax(path)!, renderSingle ? 1 : 2, testFile ? (t) => !!testPhase(t) : undefined) : []),
          ],
    [hunks, renderDocs, renderEdited, renderLine, renderSingle, split],
  );
  const [openDocs, setOpenDocs] = useState<Set<string>>(new Set());
  const docAt = (hi: number, li: number) => covering(docs, openDocs, hi, li);
  // A doc comment switched to its source: a header row above its first line switches it back.
  const docOpenedAt = (hi: number, li: number) => docs.find((d) => d.hunk === hi && d.start === li && openDocs.has(`${hi}-${li}`));

  return (
    <table class={oldNums ? 'diff' : 'diff one-num'} ref={table}>
      <tbody>
        {hunks.map((h, hi) => (
          <>
            {/* No @@ header row: the line numbers say where each line is, and the gap rows divide the hunks. */}
            {gapBefore(hi) && !gapInRun(hi) && gapRows(gapBefore(hi)!)}
            {h.lines.map((l, li) => {
              const one = foldAt(hi, li);
              const run = one && closedRun(hi);
              if (run && (hi > run.first || !one.head)) return null; // the run's one row is its first hunk's
              // A run of import-only hunks: its folds added up, and opening it opens them all and the imports between.
              const members = run ? folds.filter((f) => f.hunk >= run.first && f.hunk <= run.last) : [];
              const fold = one && run
                ? { ...one, added: members.reduce((n, f) => n + f.added, 0), removed: members.reduce((n, f) => n + f.removed, 0), newPackages: [...new Set(members.flatMap((f) => f.newPackages))], packageMoved: members.some((f) => f.packageMoved) }
                : one;
              const open = () => {
                setOpenFolds((s) => new Set([...s, ...(run ? members : [one!]).map((f) => `${f.hunk}-${f.start}`)]));
                if (run) for (let i = run.first === 0 ? 0 : run.first + 1; i <= run.last; i++) if (gapBefore(i)) void expand(gapBefore(i)!);
              };
              // The unchanged lines after the run, as a button in its row (not a row of their own).
              const after = run && gapBefore(run.last + 1);
              const afterCount = after && (after.to === null ? null : after.to - after.from + 1);
              // Outside the project and the standard library, one name per library (dagger.hilt rides with dagger).
              const outside = fold ? fold.newPackages.filter((p) => (!root || !p.startsWith(root)) && !/^(java|kotlin)(\.|$)/.test(p)) : [];
              const external = outside.filter((p) => !outside.some((q) => p.startsWith(q + '.')));
              if (fold)
                return !fold.head ? null : (
                  <tr class="import-fold">
                    <td colSpan={3}>
                      <button
                        title={`Show the package and imports${fold.newPackages.length ? `\nNew to this file: ${fold.newPackages.join(', ')}` : ''}`}
                        onClick={open}
                      >
                        ⋯ {[fold.packageMoved && 'package moved', (fold.added || fold.removed) && [fold.added && `+${fold.added}`, fold.removed && `−${fold.removed}`].filter(Boolean).join(' ') + ' imports'].filter(Boolean).join(', ') || 'package'}
                        {external.length > 0 && <span class="new-pkgs"> · new: {external.slice(0, 3).join(', ')}{external.length > 3 ? ` +${external.length - 3}` : ''}</span>}
                      </button>
                      {after && !openGaps.has(after.before) && !(after.to === null && head && after.from > head.length) && (
                        <button onClick={() => void expand(after)}>{afterCount === null ? ' · ↓ Show the rest of the file' : ` · ↕ Show ${afterCount} unchanged line${afterCount === 1 ? '' : 's'}`}</button>
                      )}
                    </td>
                  </tr>
                );
              const doc = docAt(hi, li);
              if (doc) {
                if (li !== doc.start) return null;
                const run = h.lines.slice(doc.start, doc.end + 1);
                const first = h.lines[doc.start], last = h.lines[doc.end];
                // An edited one comments on its new version: from its first line there.
                const at = doc.kind === '~' ? run.find((x) => x.kind !== '-')! : first;
                const onNum = (e: MouseEvent) => pick(e, doc.kind === '-' ? 'LEFT' : 'RIGHT', doc.kind === '-' ? first.old! : at.new!);
                return (
                  <tr class={`ln doc${doc.kind === '+' ? ' a' : doc.kind === '-' ? ' d' : doc.kind === '~' ? ' edited' : ''}`}>
                    <td class="num" title={`Lines ${first.old}–${last.old}: comment (shift-click to extend)`} onClick={onNum}>
                      {run.find((x) => x.old != null)?.old ?? ''}
                    </td>
                    <td class="num" title={`Lines ${at.new}–${last.new}: comment (shift-click to extend)`} onClick={onNum} data-old={at.new == null ? first.old : undefined}>
                      {at.new ?? ''}
                    </td>
                    <td class="code">
                      <DocView doc={indent ? { ...doc, indent: Math.max(0, doc.indent - indent) } : doc} syntax={docSyntax(path) ?? 'kdoc'} onSource={() => setOpenDocs((s) => new Set(s).add(`${hi}-${doc.start}`))} />
                    </td>
                  </tr>
                );
              }
              const moveRun = !splitPlan && moveAt(hi, li);
              if (moveRun) {
                if (li !== moveRun.start) return null;
                const [file, at] = moveRun.to.split(':');
                return (
                  <tr class="import-fold moved-fold">
                    <td colSpan={3}>
                      <button title="Show the moved lines" onClick={() => setOpenMoves((s) => new Set(s).add(`${hi}-${moveRun.start}`))}>
                        ⋯ {moveRun.count} line{moveRun.count === 1 ? '' : 's'} moved {moveRun.to ? (moveRun.kind === '-' ? 'to' : 'here from') : ''}
                      </button>
                      {moveRun.to && <>{' '}<a href={'#f-' + file} title={moveRun.to} onClick={(e) => { e.preventDefault(); jumpTo('f-' + file); }}>{file === path ? `line ${at}` : `${fileLabel(file)}:${at}`}</a></>} without changes
                    </td>
                  </tr>
                );
              }
              if (splitPlan) {
                const rows = splitPlan[hi].get(li);
                if (!rows) return null; // drawn with its run, at the run's first line
                const half = (x: Line | null, i: number | null, right: boolean) => {
                  const s: Side = x?.kind === '-' ? 'LEFT' : 'RIGHT';
                  const n = x ? (right ? x.new! : x.old!) : 0;
                  return (
                    <>
                      <span class={x ? 'num' : 'num none'} title={x ? 'Comment (shift-click to extend)' : undefined} onClick={x ? (e) => pick(e, right ? 'RIGHT' : s, n) : undefined} onContextMenu={x ? (e) => void lineMenu(e, right ? 'RIGHT' : s, n) : undefined}>
                        {x ? n : ''}
                      </span>
                      <span class={`code${!x ? ' none' : x.kind === '-' ? ' d' : x.kind === '+' ? ' a' : ''}`} onContextMenu={x ? (e) => void lineMenu(e, right ? 'RIGHT' : s, n) : undefined} dangerouslySetInnerHTML={{ __html: x && i != null ? codeHtml(hi, i, x.text) : '' }} />
                    </>
                  );
                };
                return rows.map((row) => {
                  const L = row[0] != null ? h.lines[row[0]] : null, R = row[1] != null ? h.lines[row[1]] : null;
                  return (
                    <>
                      <tr class="ln split" data-k={`${hi}-${row[0] ?? row[1]}`}>
                        <td colSpan={3} class="split-cell">
                          <div class="split-row">
                            {half(L, row[0], false)}
                            {half(R, row[1], true)}
                          </div>
                        </td>
                      </tr>
                      {L && notes('LEFT', L.old!)}
                      {R && notes('RIGHT', R.new!)}
                    </>
                  );
                });
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
                  <tr class={(l.kind === '+' ? 'ln a' : l.kind === '-' ? 'ln d' : 'ln') + (move !== undefined ? ' moved' : '') + (testFile && testPhase(l.text) ? ' phase' : '') + (l.kind === '+' && secretAt?.has(l.new!) ? ' secret' : l.kind === '+' && textAt?.has(l.new!) ? ' hardcoded' : l.kind !== '-' && flagAt?.has(l.new!) ? (flagAt.get(l.new!)!.bad ? ' flag-bad' : ' flag-warn') : '')} data-k={`${hi}-${li}`} onContextMenu={(e) => void lineMenu(e, side, num)} title={l.kind === '-' ? undefined : l.kind === '+' && secretAt?.has(l.new!) ? `Looks like a secret: ${secretAt.get(l.new!)}` : l.kind === '+' && textAt?.has(l.new!) ? 'Text written in the code, not in strings.xml: it won\u2019t be translated' : flagAt?.get(l.new!)?.why}>
                    <td class="num" title="Comment (shift-click to extend; ⌥-click copies a link to the line)" onClick={(e) => pick(e, side, num)}>{l.old ?? ''}</td>
                    <td class="num" title="Comment (shift-click to extend; ⌥-click copies a link to the line)" onClick={(e) => pick(e, side, num)} data-old={l.new == null ? l.old : undefined}>{l.new ?? ''}</td>
                    <td class="code" dangerouslySetInnerHTML={{ __html: codeHtml(hi, li, l.text) }} />
                  </tr>
                  {notes(side, num)}
                  {l.kind === ' ' && notes('LEFT', l.old!)}
                </>
              );
            })}
          </>
        ))}
        {gapBefore(hunks.length) && !gapInRun(hunks.length) && gapRows(gapBefore(hunks.length)!)}
      </tbody>
    </table>
  );
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
// An edited one ('~') marks its changed paragraphs and tags, as rendered markdown marks changed blocks.
function DocView({ doc, syntax, onSource }: { doc: DocBlock; syntax: 'kdoc' | 'java' | 'jsdoc'; onSource: () => void }) {
  const { paras, tags } = useMemo(() => docParts(doc.lines ?? doc.text.split('\n').map((text) => ({ text, changed: false })), syntax, doc.style), [doc.text]);
  return (
    <div class={doc.style === 'line' && doc.start === doc.end ? 'doc-render doc-one' : 'doc-render'} style={{ marginLeft: `${doc.indent}ch`, width: `calc(100% - ${doc.indent + 3}ch)` }}>
      <button class="link doc-source" title="Show the comment's source lines" onClick={onSource} aria-label="Show the comment's source lines">&lt;/&gt;</button>
      {paras.map((p) => (
        <div class={p.changed ? 'md doc-chg' : 'md'} dangerouslySetInnerHTML={{ __html: md.render(p.md) }} />
      ))}
      {tags.length > 0 && (
        <dl class="doc-tags">
          {tags.map(([label, items]) => (
            <>
              <dt>{label}:</dt>
              <dd>
                {items.map(([name, text, changed]) => (
                  <div class={changed ? 'doc-chg' : undefined}>
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

const rawSeen = new Map<string, string>(); // ponytail: the last 100 kept (a session lasts days); getRaw's cache and the browser's hold more
// A spec's code spans naming a changed file become links to it (specrefs.ts); its tasks ("[ ] 2.1 …") say how many of
// the PR's files they name (one naming none says nothing: "build it", "delete the X block" name no file). Run after
// each draw (the blocks' HTML is set as is).
function linkSpecRefs(root: HTMLElement | null, ix: CodeIndex, tasks = true) {
  if (!root) return;
  for (const c of root.querySelectorAll('code')) {
    if (c.closest('pre, a') || c.hasAttribute('data-ref')) continue;
    const to = refTo(c.textContent ?? '', ix);
    c.setAttribute('data-ref', to?.path ?? '');
    if (to) {
      c.setAttribute('data-jump', to.path);
      if (to.line) c.setAttribute('data-line', String(to.line));
      c.classList.add('spec-ref');
      c.title = `${to.path}${to.line ? `:${to.line}` : ''}: go there`;
    }
  }
  if (!tasks || !root.querySelector('[data-jump]')) return; // a spec that names no code: its tasks aren't about this PR's files
  for (const li of root.querySelectorAll('li')) {
    if (!/^\s*\[[ xX]\]/.test(li.textContent ?? '')) continue;
    const files = new Set([...li.querySelectorAll('[data-jump]')].filter((e) => e.closest('li') === li).map((e) => e.getAttribute('data-jump')));
    let tag = li.querySelector<HTMLElement>(':scope > .spec-touch');
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'spec-touch';
      li.insertBefore(tag, li.querySelector(':scope > ul, :scope > ol'));
    }
    tag.textContent = files.size ? `${files.size} file${files.size > 1 ? 's' : ''} in this ${pageTerm().PR}` : '';
  }
}

// To where a spec names a file: its block holding that line, once drawn (else the spec).
function jumpToSpec(r: SpecRef) {
  noteJump();
  const sec = document.getElementById('f-' + r.spec);
  sec?.scrollIntoView();
  let tries = 0;
  const go = () => {
    // The deepest block holding the line (blocks nest: a list, its item): the last in document order that covers it.
    const el = [...(sec?.querySelectorAll('[data-src]') ?? [])].filter((e) => {
      const [s, end] = e.getAttribute('data-src')!.split('-').map(Number);
      return s <= r.line && r.line <= end;
    }).at(-1);
    if (!el) return void (tries++ < 60 ? (sec?.scrollIntoView(), setTimeout(go, 100)) : jumpTo('f-' + r.spec, undefined, true)); // it may still be loading
    el.id ||= `sl-${r.spec}-${r.line}`;
    jumpTo(el.id, undefined, true);
  };
  setTimeout(go, 50);
}

// To the PR after (or before) the open one in the PR list, as it's shown.
function stepPR(by: 1 | -1) {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.side.prs a.pr-item')];
  const at = links.findIndex((a) => a.classList.contains('cur'));
  const to = at < 0 ? links[0] : links[at + by];
  if (to) location.hash = to.getAttribute('href')!;
}

// To a changed file, at its new-side line when that's on show (not folded away), else its top. old: a removed line, by
// its old number.
function jumpToLine(path: string, line?: number, old = false) {
  if (!line) return jumpTo('f-' + path);
  noteJump();
  const sec = document.getElementById('f-' + path);
  sec?.scrollIntoView();
  let tries = 0;
  const go = () => {
    const row = [...(sec?.querySelectorAll('tr.ln') ?? [])].find((r) => (old ? r.children[1]?.getAttribute('data-old') : r.children[1]?.textContent) === String(line));
    if (!row) return void (tries++ < 30 ? (sec?.scrollIntoView(), setTimeout(go, 100)) : jumpTo('f-' + path, undefined, true)); // drawing, or not on show
    row.id ||= `ln-${path}-${old ? 'o' : ''}${line}`;
    jumpTo(row.id, undefined, true);
  };
  setTimeout(go, 50);
}

// Hovering a link to the code (linkSpecRefs) or a spec chip previews what it names, after a moment; the preview stays
// while the mouse is on it, and a click on it goes there.
type PeekAt = { path: string; line?: number; at: DOMRect; go: () => void };
function useRefPeek(ix: CodeIndex) {
  const [peek, setPeek] = useState<PeekAt | null>(null);
  const timer = useRef(0);
  // Scrolling away closes it, and cancels one about to open (links pass under the pointer while the page moves); so do
  // a click outside it and Esc.
  useEffect(() => {
    const away = () => (clearTimeout(timer.current), setPeek(null));
    const click = (e: PointerEvent) => !(e.target as Element).closest?.('.spec-peek') && away();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && away();
    addEventListener('scroll', away, { passive: true });
    addEventListener('pointerdown', click);
    addEventListener('keydown', esc);
    return () => (clearTimeout(timer.current), removeEventListener('scroll', away), removeEventListener('pointerdown', click), removeEventListener('keydown', esc));
  }, []);
  const show = (p: Omit<PeekAt, 'at'>, el: Element) => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek({ ...p, at: el.getBoundingClientRect() }), 250);
  };
  const out = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(null), 200);
  };
  const refOf = (e: Event) => (e.target as Element).closest('[data-jump]');
  const target = (ref: Element) => ({ path: ref.getAttribute('data-jump')!, line: Number(ref.getAttribute('data-line')) || undefined });
  return {
    show,
    out,
    over: (e: MouseEvent) => {
      const ref = refOf(e);
      if (!ref) return clearTimeout(timer.current);
      const t = target(ref);
      show({ ...t, go: () => jumpToLine(t.path, t.line) }, ref);
    },
    // A click on a link goes there; true when it was one.
    click: (e: MouseEvent) => {
      const ref = refOf(e);
      if (!ref) return false;
      e.preventDefault();
      setPeek(null);
      const t = target(ref);
      jumpToLine(t.path, t.line);
      return true;
    },
    node:
      peek &&
      createPortal(<SpecPeek p={peek} ix={ix} onEnter={() => clearTimeout(timer.current)} onLeave={out} onGo={() => (setPeek(null), peek.go())} />, document.body),
  };
}

// A link's preview: the lines of the change it names, highlighted, below the link (above it near the window's bottom).
function SpecPeek({ p, ix, onEnter, onLeave, onGo }: { p: PeekAt; ix: CodeIndex; onEnter: () => void; onLeave: () => void; onGo: () => void }) {
  const [mdStyle] = useMdStyle();
  const doc = isDoc(p.path) && isMarkdown(p.path) && !!p.line; // a spec: its block, rendered as the spec is
  const lines = doc ? [] : peekLines(ix.patches.get(p.path) ?? '', p.line);
  const lang = languageFor(p.path);
  const text = lines.map((l) => l.text).join('\n');
  const html = lang ? splitLines(highlightCode(text, lang)) : text.split('\n').map((l) => l.replace(/[&<>]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt' }[c]};`));
  const below = p.at.bottom + 320 < innerHeight;
  const style = { left: `${Math.min(p.at.left, innerWidth - 580)}px`, ...(below ? { top: `${p.at.bottom + 6}px` } : { bottom: `${innerHeight - p.at.top + 6}px` }) };
  return (
    <div class={doc ? 'spec-peek doc' : 'spec-peek'} style={style} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onGo} title="Go there">
      <div class="spec-peek-h">
        <b>{base(p.path)}</b>
        {p.line ? `:${p.line}` : ''} <small>{rest(dir(p.path), p.path)}</small>
      </div>
      {doc ? (
        ((look) => <div class={`rich ${look.class}`} style={look.style} dangerouslySetInnerHTML={{ __html: md.render(docSnippet(ix.patches.get(p.path) ?? '', p.line!)) }} />)(mdStyleProps(mdStyle))
      ) : lines.length ? (
        <table class="diff">
          {lines.map((l, i) => (
            <tr class={l.kind === '+' ? 'ln a' : l.kind === '-' ? 'ln d' : 'ln'}>
              <td class="num">{l.new ?? ''}</td>
              <td class="code" dangerouslySetInnerHTML={{ __html: html[i] ?? '' }} />
            </tr>
          ))}
        </table>
      ) : (
        <p class="note">No lines to show.</p>
      )}
    </div>
  );
}

// A changed file's header: where the specs name it, a chip per spec (its first mention; all of them on hover).
function SpecChips({ refs, ix }: { refs?: SpecRef[]; ix: CodeIndex }) {
  const peek = useRefPeek(ix);
  if (!refs?.length) return null;
  const bySpec = [...new Map(refs.map((r) => [r.spec, refs.filter((x) => x.spec === r.spec)])).values()];
  const chip = (l: SpecRef[], cls: string, text: ComponentChildren) => (
    <button
      class={cls}
      title={`Named in ${l.map((r) => r.label).join(', ')}: go there`}
      onClick={() => jumpToSpec(l[0])}
      onMouseEnter={(e) => peek.show({ path: l[0].spec, line: l[0].line, go: () => jumpToSpec(l[0]) }, e.currentTarget)}
      onMouseLeave={peek.out}
    >
      {text}
    </button>
  );
  const more = (l: SpecRef[]) => (l.length > 1 ? ` +${l.length - 1}` : '');
  // One spec: its chip. More: one chip that lists them, each with its folder (specs share names: design.md, tasks.md).
  return (
    <>
      {bySpec.length === 1 ? (
        chip(bySpec[0], 'spec-chip', <><Octicon name="file" /> {bySpec[0][0].label}{more(bySpec[0])}</>)
      ) : (
        <PillMenu cls="spec-chip" label={<><Octicon name="file" /> {bySpec.length} specs</>} head="Specs that name this file">
          {bySpec.map((l) => chip(l, 'spec-item', <><Octicon name="file" /> <span class="spec-dir">{l[0].spec.split('/').slice(-2, -1)[0]}/</span>{l[0].spec.split('/').pop()} <small>{l[0].label}{more(l)}</small></>))}
        </PillMenu>
      )}
      {peek.node}
    </>
  );
}

function RichView({ file, hunks, ctx, threads, drafts, stand }: BodyProps) {
  const [mdStyle] = useMdStyle();
  const look = mdStyleProps(mdStyle); // Settings → Markdown files
  const path = file.filename;
  const root = useRef<HTMLDivElement>(null);
  const linkTo = (slug: string) => `${blobWebUrl(ctx.headRepo, ctx.pr.head.sha, path)}#${slug}`;
  const peek = useRefPeek(ctx.codeIx);
  useEffect(() => {
    tidyDoc(root.current, linkTo);
    signRelativeImages(root.current, ctx.headRepo, ctx.pr.head.sha, dir(path)); // its images, by their path in the repo
    linkSpecRefs(root.current, ctx.codeIx);
  });
  // The whole file at the PR's head (kept for the session, so a second look draws at once). It's drawn only once it's
  // here: drawing the diff's lines first and the rest later would make the page jump by thousands of pixels.
  const rawKey = `${ctx.headRepo}@${ctx.pr.head.sha}:${path}`;
  const [src, setSrc] = useState<string | null | undefined>(() => rawSeen.get(rawKey));
  useEffect(() => {
    if (src === undefined) getRaw(ctx.headRepo, path, ctx.pr.head.sha).then((t) => (t != null && (rawSeen.set(rawKey, t), rawSeen.size > 100 && rawSeen.delete(rawSeen.keys().next().value!)), setSrc(t)), () => setSrc(null));
  }, [src === undefined]);
  // Only diff lines take line comments, so sections outside the diff fold away (expandable, read-only).
  const inDiff = useMemo(() => new Set(hunks.flatMap((h) => h.lines.flatMap((l) => l.new ?? []))), [hunks]);
  const chunks = useMemo(() => (src ? renderChunks(src, file.status === 'added' ? new Set() : addedLines(hunks), inDiff, ctx.mainLang) : []), [src, hunks]);
  const [openRuns, setOpenRuns] = useState<Set<number>>(new Set());
  const removed = useMemo(() => removedRuns(hunks), [hunks]);

  if (src === undefined) return <div class="pad" style={{ minHeight: stand }}><Lines n={6} /></div>;
  if (src === null) return <p class="note pad">Couldn't load this file. <Retry onClick={() => setSrc(undefined)} /> · The {'<>'} button in its header shows the source diff.</p>;

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
        <span class="removed-label">Removed</span>
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
    <div
      class={`rich ${look.class}`}
      style={look.style}
      ref={root}
      onMouseOver={peek.over}
      onMouseOut={peek.out}
      onClick={(e) => peek.click(e) || onDocClick(e, root.current, linkTo)}
    >
      {peek.node}
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
        // Removed lines that gave way to a line inside this block go just before it (a list item, not the whole list).
        const here = removed.filter((r) => markerSlot(r) === i);
        const within = here.filter((r) => r.at > c.start && r.at <= c.end);
        return (
          <>
            {here.filter((r) => !within.includes(r)).map(marker)}
            <ChunkView html={c.html} onClick={onChunkClick} placed={inside.map((l) => ({ line: l, node: notesAt(l) }))} before={within.map((r) => ({ line: r.at, node: marker(r) }))} />
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
// `before`: removed lines, shown just before the deepest block they gave way to (a list item, not the whole list).
function ChunkView({ html, placed, before = [], onClick }: { html: string; placed: { line: number; node: VNode }[]; before?: { line: number; node: VNode }[]; onClick: (e: MouseEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const hosts = useRef(new Map<Element, { host: HTMLElement; outer: HTMLElement }>());
  const ahead = useRef(new Map<Element, { host: HTMLElement; outer: HTMLElement }>());

  useLayoutEffect(() => {
    const blocks = [...ref.current!.querySelectorAll('[data-src]')];
    const covers = (b: Element, line: number) => {
      const [s, e] = b.getAttribute('data-src')!.split('-').map(Number);
      return line >= s && line <= e;
    };
    // Sibling blocks don't overlap, so the last block in document order that covers a line is the deepest one.
    const place = (items: { line: number; node: VNode }[], map: Map<Element, { host: HTMLElement; outer: HTMLElement }>, put: (el: Element, host: HTMLElement) => HTMLElement) => {
      const groups = new Map<Element, VNode[]>();
      for (const p of items) {
        const el = blocks.filter((b) => covers(b, p.line)).at(-1);
        if (el) groups.set(el, [...(groups.get(el) ?? []), p.node]);
      }
      for (const [el, h] of map)
        if (!groups.has(el) || !h.outer.isConnected) {
          render(null, h.host);
          h.outer.remove();
          map.delete(el);
        }
      for (const [el, nodes] of groups) {
        let h = map.get(el);
        if (!h) {
          const host = document.createElement('div');
          host.className = 'note-host';
          const outer = put(el, host);
          // A comment on a line inside collapsed content (a diagram's source) opens it.
          for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
          map.set(el, (h = { host, outer }));
        }
        render(<>{nodes}</>, h.host);
      }
    };
    // A table row: in a row of its own; else beside the block (before it, or after: a list item's under its own text).
    const row = (el: Element, host: HTMLElement, where: 'before' | 'after') => {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = el.children.length;
      td.append(host);
      tr.append(td);
      tr.className = 'note-tr';
      el[where](tr);
      return tr;
    };
    place(placed, hosts.current, (el, host) => {
      if (el.matches('tr')) return row(el, host, 'after');
      if (el.matches('li')) {
        const sub = [...el.children].find((c) => c.matches('ul, ol'));
        if (sub) sub.before(host);
        else el.append(host);
      } else el.after(host);
      return host;
    });
    place(before, ahead.current, (el, host) => (el.matches('tr') ? row(el, host, 'before') : (el.before(host), host)));
    renderMermaid(ref.current);
  });

  useEffect(
    () => () => {
      for (const h of [...hosts.current.values(), ...ahead.current.values()]) {
        render(null, h.host);
        h.outer.remove();
      }
    },
    [],
  );

  return <div ref={ref} class="md chunk" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Marks along the right edge for where things are on this long page: threads still open (the ones waiting on you
// stronger), your drafts, and changed or removed parts of rendered docs (in a diff, everything is a change), plus a
// box for the part on screen. A click on a mark goes there.
// The strip is laid out by file, not by pixel: files render only near the screen, so the page's height keeps changing
// as you scroll, and marks placed by pixel would jump. What's above the files takes its height; each file a share by
// its diff's length (fixed from the start); a mark sits at its place within its file.
const MARKS: [string, string, string][] = [
  ['.rich [data-chg]:not(:has([data-chg])):not(.note-host *)', 'm-chg', 'Changed'],
  ['.rich .removed', 'm-del', 'Removed'],
  ['details.thread:not(.bot)[open]', 'm-thread', 'Open thread'],
  ['details.thread.awaiting', 'm-await', 'Waiting on you'],
  ['.draft', 'm-draft', 'Your draft'],
];
const LINE_PX = 20; // a diff line, roughly, to weigh files against what's above them
// A file's share of the strip, worked out once (it's asked for on every scroll frame).
const stripWeights = new WeakMap<File, number>();
const stripWeight = (f: File) => {
  let w = stripWeights.get(f);
  if (w == null) stripWeights.set(f, (w = 44 + LINE_PX * Math.max(3, (f.patch ?? '').split('\n').length)));
  return w;
};
// WebKit (the app's) doesn't hold your place when something above what you're reading changes height, as a file
// does when it's first drawn, or a markdown file when its rendered view arrives: what you're reading jumps. Where the
// browser doesn't (or it's turned off: overflow-anchor), lgtm does, as browsers that do it: it keeps the first line
// you can see (below the pinned headers) where it was, and should that line be replaced (a "Loading…" giving way to
// the file), the next file's top. Both are noted on every scroll; when any file changes size, the page scrolls by
// however far they moved, before it's drawn.
function HoldPlace() {
  useEffect(() => {
    const native = CSS.supports('overflow-anchor', 'auto') && getComputedStyle(document.documentElement).overflowAnchor !== 'none';
    if (native) return;
    const main = document.querySelector('main');
    if (!main) return;
    // The reference's place on the page (not in the window), so scrolling between a look and a resize doesn't count
    // as a move.
    let refs: { el: Element; at: number }[] = [];
    let notedY = scrollY; // where the page was when refs were taken
    const note = () => {
      refs = [];
      notedY = scrollY;
      const x = main.getBoundingClientRect().left + 80;
      const top = barsHeight();
      for (let y = top + 8; y < innerHeight - 20; y += 12) {
        const el = document.elementFromPoint(x, y);
        // Pinned headers stay put, so they can't say where you are.
        if (el && main.contains(el) && !el.closest('.file-h, .pill-pop')) {
          refs.push({ el, at: el.getBoundingClientRect().top + scrollY });
          // If that gets re-drawn (gone), the file it's in stands for it: it stays, and only what's above in it can
          // move it. (The next file down would also move by this one's change.)
          const own = el.closest('main > section.file');
          if (own) refs.push({ el: own, at: own.getBoundingClientRect().top + scrollY });
          break;
        }
      }
      const files = main.querySelectorAll(':scope > section.file');
      const next = files[firstBox(files, (r) => r.top >= top)];
      if (next && !refs.some((r) => r.el === next)) refs.push({ el: next, at: next.getBoundingClientRect().top + scrollY });
    };
    const ro = new ResizeObserver(() => {
      // Jumped more than a screen since the last look (to a thread, resuming where I left off) before its scroll event
      // came: the refs are for another part of the page, so take new ones rather than "correct" against them.
      if (Math.abs(scrollY - notedY) > innerHeight) return note();
      const ref = refs.find((r) => r.el.isConnected);
      if (ref) {
        const moved = ref.el.getBoundingClientRect().top + scrollY - ref.at;
        if (Math.abs(moved) >= 1 && scrollY > 0) scrollBy(0, moved); // at the very top, new content just flows in below
      }
      note();
    });
    // The files, and the column itself: banners, pills and the ticket arriving above the files grow it without resizing
    // any file.
    const watch = () => (ro.observe(main), main.querySelectorAll(':scope > section.file').forEach((f) => ro.observe(f)));
    watch();
    note();
    const mo = new MutationObserver(watch); // files shown later (generated ones, opened)
    mo.observe(main, { childList: true });
    addEventListener('scroll', note, { passive: true });
    return () => (ro.disconnect(), mo.disconnect(), removeEventListener('scroll', note));
  }, []);
  return null;
}

// A PR with both specs (isDoc) and code: a button to jump from the one you're reading to the other (g, too).
function DocCodeJump({ files }: { files: File[] }) {
  const both = files.some((f) => isDoc(f.filename)) && files.some((f) => !isDoc(f.filename));
  const [at, setAt] = useState<{ doc: boolean; up: boolean } | null>(null);
  const sections = () => [...document.querySelectorAll<HTMLElement>('main > section.file')];
  // The file under the bars, and whether the first file of the other kind is above it or below.
  const where = () => {
    const y = barsHeight() + 40;
    const all = sections();
    const cur = firstBox(all, (r) => r.bottom > y);
    if (cur < 0) return null;
    const doc = isDoc(all[cur].id.slice(2));
    const to = all.findIndex((s) => isDoc(s.id.slice(2)) !== doc);
    return to < 0 ? null : { doc, up: to < cur, to: all[to] };
  };
  useEffect(() => {
    if (!both) return setAt(null);
    let raf = 0;
    const look = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = where();
        setAt(w && { doc: w.doc, up: w.up });
      });
    };
    const go = () => {
      const w = where();
      if (w) jumpTo(w.to.id);
    };
    look();
    addEventListener('scroll', look, { passive: true });
    addEventListener('lgtm:doc-code', go);
    return () => (cancelAnimationFrame(raf), removeEventListener('scroll', look), removeEventListener('lgtm:doc-code', go));
  }, [both, files.length]);
  if (!at) return null;
  return (
    <button class="doc-code-jump" title={`Jump between the specs and the code${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').docCode)}`} onClick={() => dispatchEvent(new Event('lgtm:doc-code'))}>
      {at.doc ? 'Code' : 'Specs'} {at.up ? '↑' : '↓'}
    </button>
  );
}

// The strip's layout now: a page position (document y) to a place on it (0–1), and back.
function stripLayout(files: File[]) {
  const shown = files.map((f) => [f, document.getElementById('f-' + f.filename)] as const).filter((x): x is [File, HTMLElement] => !!x[1]);
  const weights = shown.map(([f]) => stripWeight(f));
  const rects = shown.map(([, e]) => {
    const r = e.getBoundingClientRect();
    return [r.top + scrollY, r.bottom + scrollY];
  });
  const head = rects[0]?.[0] ?? document.documentElement.scrollHeight;
  const total = head + weights.reduce((a, b) => a + b, 0);
  const at = (y: number) => {
    if (y <= head) return Math.max(0, y) / total;
    let acc = head;
    for (let k = 0; k < rects.length; k++) {
      const [top, bottom] = rects[k];
      const end = rects[k + 1]?.[0] ?? Infinity; // the gap after a file counts as its end
      if (y < end) return (acc + weights[k] * Math.min(1, (y - top) / Math.max(1, bottom - top))) / total;
      acc += weights[k];
    }
    return 1;
  };
  const yAt = (f: number) => {
    let v = Math.max(0, Math.min(1, f)) * total;
    if (v <= head) return v;
    v -= head;
    for (let k = 0; k < rects.length; k++) {
      if (v <= weights[k] || k === rects.length - 1) return rects[k][0] + (rects[k][1] - rects[k][0]) * Math.min(1, v / weights[k]);
      v -= weights[k];
    }
    return head;
  };
  return { at, yAt };
}
const barsHeight = () => {
  const css = getComputedStyle(document.documentElement);
  return parseFloat(css.getPropertyValue('--nav')) + parseFloat(css.getPropertyValue('--bar'));
};

// It is the page's scrollbar too (the browser's own is hidden while it shows): drag the box, or click the strip.
function ScrollMarks({ files }: { files: File[] }) {
  const [marks, setMarks] = useState<{ at: number; cls: string; title: string; el: Element }[]>([]);
  const [view, setView] = useState<[number, number] | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const rail = useRef<HTMLDivElement>(null);
  const grab = useRef<number | null>(null); // while dragging: where in the box it was taken, as a strip fraction
  const [glide, setGlide] = useState(false); // the box moved by the page changing size (not a scroll): glide there
  useEffect(() => {
    let t = 0;
    let frame = 0;
    const placeView = () => {
      if (document.documentElement.scrollHeight <= innerHeight * 1.5) return setView(null);
      const { at } = stripLayout(filesRef.current);
      setView([at(scrollY + barsHeight()), at(scrollY + innerHeight)]);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => (setGlide(false), placeView()));
    };
    const measure = () => {
      placeView();
      if (document.documentElement.scrollHeight <= innerHeight * 1.5) return setMarks([]);
      const { at } = stripLayout(filesRef.current);
      // ponytail: geometry inside off-screen files (content-visibility) forces their layout; fine for the dozens of
      // marks a PR has, measure per file instead if it ever gets slow.
      setMarks(MARKS.flatMap(([sel, cls, title]) => [...document.querySelectorAll(`main ${sel}`)].map((el) => ({ at: at(el.getBoundingClientRect().top + scrollY), cls, title, el }))));
    };
    const soon = () => {
      clearTimeout(t);
      t = window.setTimeout(measure, 300);
    };
    // The page changed size (files drawn, images in): the box moves now, gliding; the marks follow when it settles.
    const ro = new ResizeObserver(() => (cancelAnimationFrame(frame), (frame = requestAnimationFrame(() => (setGlide(true), placeView()))), soon()));
    ro.observe(document.body);
    const mo = new MutationObserver(soon);
    mo.observe(document.querySelector('main') ?? document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'class'] });
    addEventListener('scroll', onScroll, { passive: true });
    soon();
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('own-scrollbar', !!view);
    return () => document.documentElement.classList.remove('own-scrollbar');
  }, [!!view]);
  if (!view) return null;
  const toStrip = (e: PointerEvent) => {
    const r = rail.current!.getBoundingClientRect();
    return (e.clientY - r.top) / r.height;
  };
  const scrollToStrip = (f: number) => scrollTo({ top: stripLayout(filesRef.current).yAt(f) - barsHeight() });
  return (
    <div
      class="scroll-marks"
      ref={rail}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button')) return;
        const f = toStrip(e);
        const inBox = f >= view[0] && f <= view[1];
        grab.current = inBox ? f - view[0] : (view[1] - view[0]) / 2; // the strip: the box centres there
        if (!inBox) scrollToStrip(f - grab.current);
        rail.current!.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => grab.current != null && scrollToStrip(toStrip(e) - grab.current)}
      onPointerUp={() => (grab.current = null)}
      onPointerCancel={() => (grab.current = null)}
    >
      <div class={glide ? 'm-view glide' : 'm-view'} style={{ top: `${view[0] * 100}%`, height: `${Math.max(1, (view[1] - view[0]) * 100)}%` }} />
      {marks.map((m) => (
        <button class={m.cls} title={m.title} style={{ top: `${m.at * 100}%` }} tabIndex={-1} onClick={() => m.el.scrollIntoView({ block: 'center' })} />
      ))}
    </div>
  );
}

const where = (d: { side: Side; line?: number; startLine?: number }) =>
  d.line == null ? 'File' : `${d.side === 'LEFT' ? 'Old line' : 'Line'}${d.startLine ? `s ${d.startLine}–${d.line}` : ` ${d.line}`}`;

// Two or more resolved or outdated threads in one place (a file's top gathers its outdated ones) fold behind one line;
// a jump to one of them opens it (jumpTo opens the details around its target).
const settledThread = (t: Thread) => (t.isResolved || t.isOutdated) && !t.comments.nodes.some((c) => c.state === 'PENDING');
function Notes({ ctx, threads, drafts, form }: { ctx: Ctx; threads: Thread[]; drafts: Draft[]; form: boolean }) {
  if (!threads.length && !drafts.length && !form) return null;
  const settled = threads.filter(settledThread);
  const grouped = settled.length >= 2;
  return (
    <div class="notes">
      {threads.filter((t) => !grouped || !settledThread(t)).map((t) => (
        <ThreadView key={t.id} t={t} ctx={ctx} />
      ))}
      {grouped && (
        <details class="settled-group">
          <summary>
            <Octicon name="check" /> {settled.length} resolved or outdated threads
          </summary>
          {settled.map((t) => (
            <ThreadView key={t.id} t={t} ctx={ctx} />
          ))}
        </details>
      )}
      {drafts
        .filter((d) => d.id !== ctx.target?.editId)
        .map((d) => (
          <div class="draft" key={d.id} id={'d-' + d.id}>
            <div class="badge">Pending · {where(d)}</div>
            {/* A suggestion shows the lines it replaces (data-old, from data-from on), as GitHub will. */}
            <div
              class="md"
              data-lang={ctx.langFor(d.path) ?? ''}
              data-old={d.body.includes('```suggestion') ? (ctx.suggestion({ path: d.path, side: d.side, line: d.line, startLine: d.startLine }) ?? undefined) : undefined}
              data-from={d.startLine ?? d.line}
              ref={(el) => void (el && highlightBlocks(el, ctx.langFor(d.path), languageFor(d.path)))}
              dangerouslySetInnerHTML={{ __html: md.render(d.body) }}
            />
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

// A thread that starts folded to its preview with bots folded: all bots', or one an agent opened from a person's
// account (its first comment starts with 🤖) that doesn't wait on me and isn't in my review still to send.
// Quote reply (GitHub's): the text selected in a comment, quoted, into the reply box of its thread, or for one in the
// conversation (or the description), into the Finish review summary. False when nothing quotable is selected.
function quoteSelection(): boolean {
  const sel = getSelection();
  const text = sel?.toString().trim();
  const at = sel?.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
  const el = at && (at instanceof Element ? at : at.parentElement);
  const where = el?.closest('details.thread[id^="t-"] .comment, .comment[id^="cv-"], #pr-description');
  if (!text || !where) return false;
  const quote = text.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n');
  const thread = where.closest('details.thread[id^="t-"]');
  sel!.removeAllRanges();
  if (thread) dispatchEvent(new CustomEvent('lgtm:quote', { detail: { thread: thread.id.slice(2), quote } }));
  else dispatchEvent(new CustomEvent('lgtm:finish', { detail: { append: quote } }));
  return true;
}
// My PR: every thread waiting on me whose lines later commits changed, answered at once ("Fixed in …", then resolved,
// as each thread's own button does), after asking.
function FixedAll({ fixes, ctx }: { fixes: { t: Thread; fixes: Fix[] }[]; ctx: Ctx }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    if (busy || !(await ask(`Reply "Fixed in …" to ${fixes.length} threads, each with the commits that changed its lines, and resolve them?`, 'Reply and resolve'))) return;
    setBusy(true), setErr('');
    let failed = 0;
    for (const { t, fixes: f } of fixes)
      await ctx.reply(t, `Fixed in ${f.map((x) => x.oid).join(', ')}`).then(() => (t.viewerCanResolve ? ctx.resolve(t, true) : undefined)).catch(() => failed++);
    setBusy(false);
    if (failed) setErr(`${failed} didn't go through: try those from the thread.`);
  };
  const run = useRef(go);
  run.current = go;
  useEffect(() => {
    const on = () => void run.current();
    addEventListener('lgtm:fixed-all', on);
    return () => removeEventListener('lgtm:fixed-all', on);
  }, []);
  return (
    <p class="note fixed-all">
      {fixes.length} threads waiting on you have commits that changed their lines.{' '}
      <button disabled={busy} onClick={go} title={`Each gets "Fixed in" with its commits, then is resolved${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').fixedAll)}`}>
        {busy ? 'Replying…' : `Reply "Fixed in" and resolve all ${fixes.length}`}
      </button>
      {err && <span class="error"> {err}</span>}
    </p>
  );
}

// The button under a selection in a comment.
function QuoteButton({ keyHint }: { keyHint: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const place = () => {
      const sel = getSelection();
      const node = sel?.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).commonAncestorContainer : null;
      const el = node && (node instanceof Element ? node : node.parentElement);
      if (!el?.closest('details.thread[id^="t-"] .comment, .comment[id^="cv-"], #pr-description') || el.closest('textarea, input, .editor')) return setAt(null);
      const r = sel!.getRangeAt(0).getBoundingClientRect();
      setAt({ x: Math.max(8, Math.min(r.left, innerWidth - 140)), y: Math.min(r.bottom + 6, innerHeight - 36) });
    };
    const hide = () => setAt(null);
    document.addEventListener('selectionchange', place);
    addEventListener('scroll', hide, { passive: true });
    return () => (document.removeEventListener('selectionchange', place), removeEventListener('scroll', hide));
  }, []);
  if (!at) return null;
  return (
    <button class="quote-btn" style={{ left: at.x, top: at.y }} onMouseDown={(e) => e.preventDefault()} onClick={() => (quoteSelection(), setAt(null))}>
      <Octicon name="quote" /> Quote reply{keyHint}
    </button>
  );
}

const foldedAsBot = (t: Thread, waiting: boolean) =>
  t.comments.nodes.every((c) => c.author?.__typename === 'Bot') || (!waiting && t.comments.nodes[0]?.state !== 'PENDING' && agentSays(t.comments.nodes[0]?.body));
function ThreadView({ t, ctx }: { t: Thread; ctx: Ctx }) {
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  const first = t.comments.nodes[0];
  const waiting = !!ctx.me && awaitsMe(t, ctx.me, ctx.pr.user.login === ctx.me);
  // Bot-only threads (AI reviewers, linters) start collapsed to their one-line preview.
  const foldBots = useFoldBots(!!ctx.me && ctx.pr.user.login === ctx.me);
  const bot = foldBots && foldedAsBot(t, waiting);
  const again = ctx.repeats.get(t.id);
  const [showAgain, setShowAgain] = useState(false);
  // On someone else's PR, other people's threads start folded too: mine (and ones waiting on me) stay open.
  const others = !!ctx.me && ctx.pr.user.login !== ctx.me && !t.comments.nodes.some((c) => c.author?.login === ctx.me);
  const verdict = ctx.checked[t.id];
  const social = useSocial();
  const [editingC, setEditingC] = useState<number | null>(null);
  const delC = (id: string) => void deletePosted(id, 'thread').then(() => dispatchEvent(new Event('lgtm:reload-talk')), (e: Error) => setErr(`Couldn't delete it: ${e.message}`));

  // An unsent reply is kept (on this machine) until it's sent: another PR, a reload or a crash don't lose it.
  const replyKey = `reply:${ctx.repo}#${ctx.pr.number}:${t.id}`; // by PR: the PR list marks the ones waiting
  const loaded = useRef(false);
  useEffect(() => {
    loaded.current = false;
    void storage.get<string>(replyKey).then((b) => (b && setBody((cur) => cur || b), (loaded.current = true)), () => (loaded.current = true));
  }, [replyKey]);
  useEffect(() => void (loaded.current && (body.trim() ? storage.set(replyKey, body) : storage.remove(replyKey))), [body]);
  // Sent in the background (it shows at once); a failure gives the text back. andResolve: then resolved (⌘⇧↵).
  const send = (andResolve = false) => {
    const b = body;
    setBody('');
    setErr('');
    ctx.reply(t, b)
      .then(() => (andResolve && t.viewerCanResolve && !t.isResolved ? ctx.resolve(t, true) : undefined))
      .catch((e: Error) => (setBody((cur) => (cur.trim() ? cur : b)), setErr(`Couldn't send it: ${e.message}`)));
  };
  const canResolve = t.viewerCanResolve && !t.isResolved;
  const flip = (on: boolean) => (setErr(''), ctx.resolve(t, on).catch((e: Error) => setErr(e.message)));
  // Quote reply from one of its comments (quoteSelection): the quote in the reply box, after what's there.
  useEffect(() => {
    const take = (e: Event) => {
      const { thread, quote } = (e as CustomEvent<{ thread: string; quote: string }>).detail;
      if (thread !== t.id) return;
      setBody((b) => `${b.trim() ? `${b.trimEnd()}\n\n` : ''}${quote}\n\n`);
      const box = document.getElementById('t-' + t.id) as HTMLDetailsElement | null;
      if (box) box.open = true;
      setTimeout(() => box?.querySelector<HTMLTextAreaElement>(':scope > textarea, .editor textarea')?.focus());
    };
    addEventListener('lgtm:quote', take);
    return () => removeEventListener('lgtm:quote', take);
  }, [t.id]);
  // My PR, a reviewer waiting on me, and the code under it changed since: the commit that did it, to say so in one click
  // (Fixed in abc1234, then resolved).
  const theirs = t.comments.nodes.findLast((c) => c.author?.login !== ctx.me && c.state !== 'PENDING');
  const fixable = !!ctx.me && ctx.pr.user.login === ctx.me && waiting && !t.isResolved && !!theirs && (t.isOutdated || ctx.sinceComment.get(t.id)?.kind === 'changed');
  const [fixes, setFixes] = useState<Fix[]>([]);
  useEffect(() => {
    if (!fixable) return setFixes([]);
    let live = true;
    fixedIn(ctx.repo, ctx.pr.head.sha, t.path, t.line && !t.isOutdated ? [t.startLine ?? t.line, t.line] : null, theirs!.createdAt).then((f) => live && setFixes(f));
    return () => void (live = false);
  }, [fixable, ctx.pr.head.sha]);
  const fixedIt = () => {
    setErr('');
    ctx.reply(t, `Fixed in ${fixes.map((f) => f.oid).join(', ')}`).then(() => (t.viewerCanResolve ? ctx.resolve(t, true) : undefined)).catch((e: Error) => setErr(e.message));
  };

  // A 🤖 finding posted again: one line pointing at the first, until shown.
  if (again && !showAgain && first?.state !== 'PENDING')
    return (
      <div class="thread-again" id={'t-' + t.id}>
        🤖 Posted again, the same as{' '}
        <a href={'#t-' + again.id} onClick={(e) => (e.preventDefault(), jumpTo('t-' + again.id, 'f-' + again.path))}>
          {again.path === t.path ? (again.line ? `the one on line ${again.line}` : 'an earlier one on this file') : `the one on ${fileLabel(again.path)}${again.line ? ':' + again.line : ''}`}
        </a>{' '}
        · <button class="link" onClick={() => setShowAgain(true)}>Show</button>
      </div>
    );
  return (
    <details class={`thread${waiting ? ' awaiting' : ''}${bot ? ' bot' : ''}${t.isResolved || t.isOutdated ? ' settled' : ''}`} id={'t-' + t.id} open={!t.isResolved && !t.isOutdated && !bot && !others}>
      <summary>
        {waiting && <span class="badge awaiting-b">awaiting your reply · </span>}
        {/* The preview is for a collapsed thread; once open, the comments below say it. */}
        {first?.state === 'PENDING' && <span class="badge">Pending, started on {site(ctx.repo)} · </span>}
        <span class="t-preview"><Avatar login={first?.author?.login ?? 'ghost'} src={first?.author?.avatarUrl} /> <b class="person-link" onClick={toPerson(first?.author?.login ?? 'ghost', ctx.repo)} title={`@${first?.author?.login ?? 'ghost'}`}>{shownName(first?.author?.login ?? 'ghost', ctx.repo)}</b> {first?.bodyText.split('\n')[0].slice(0, 80)}</span>
        {t.isResolved && <span class="badge"> · resolved</span>}
        {t.isOutdated && <span class="badge"> · outdated</span>}
        {ctx.sinceComment.get(t.id)?.kind === 'changed' && <span class="badge"> · code changed since</span>}
        {ctx.sinceComment.get(t.id)?.kind === 'same' && <span class="badge"> · code unchanged</span>}
        {!t.isResolved && verdict && <span class={`badge ${verdict.addressed ? 'v-done' : 'v-open'}`} title={verdict.why}> · {verdict.addressed ? 'addressed' : 'not addressed yet'}</span>}
      </summary>
      {!t.isResolved && verdict && ctx.checkBy && (
        <p class={`t-verdict ${verdict.addressed ? 'v-done' : 'v-open'}`}>
          <AgentMark id={ctx.checkBy} /> {verdict.addressed ? 'Addressed' : 'Not addressed yet'}: {verdict.why}
          {verdict.addressed && t.viewerCanResolve && <> <button class="link" onClick={() => flip(true)}>Resolve</button></>}
        </p>
      )}
      <ThenNow s={ctx.sinceComment.get(t.id)} />
      {t.comments.nodes.map((c) => (
        <div class="comment" key={c.databaseId} id={'rc-' + c.databaseId} data-url={c.url} data-src={c.body ?? undefined} data-social={c.id}>
          <Avatar login={c.author?.login ?? 'ghost'} src={c.author?.avatarUrl} /> <b class="person-link" onClick={toPerson(c.author?.login ?? 'ghost', ctx.repo)} title={`@${c.author?.login ?? 'ghost'}`}>{shownName(c.author?.login ?? 'ghost', ctx.repo)}</b> <a href={c.url} target="_blank" rel="noopener"><Time at={c.createdAt} /></a> <CopyLink url={c.url} />
          {c.state === 'PENDING' && <span class="badge"> · pending</span>}
          {c.state === 'SENDING' && <span class="badge"> · sending…</span>}
          <AgentsMenu repo={ctx.repo} prUrl={ctx.pr.html_url} prompt={commentPrompt({ author: c.author?.login ?? 'ghost', text: c.bodyText, url: c.url }, ctx.pr, ctx.repo, { path: t.path, line: t.line })} />
          {c.state !== 'PENDING' && <><ReactPick id={c.id} /><CommentMenu id={c.id} onEdit={c.body != null ? () => setEditingC(c.databaseId) : undefined} onDelete={c.id ? () => delC(c.id!) : undefined} /></>}
          {c.state === 'PENDING' && c.id ? (
            <PendingComment c={c} ctx={ctx} path={t.path} t={t} />
          ) : editingC === c.databaseId && c.id ? (
            <EditPosted body={c.body ?? ''} repo={ctx.repo} mentions={ctx.mentions} save={(b) => editPosted(c.id!, 'thread', b)} onDone={() => setEditingC(null)} />
          ) : social(c.id)?.hidden ? (
            <details class="hidden-comment">
              <summary><small class="hidden-why">Hidden as {social(c.id)!.hidden}</small></summary>
              <div class="md" data-lang={ctx.langFor(t.path) ?? ''} ref={(el) => void (el && highlightBlocks(el, ctx.langFor(t.path), languageFor(t.path)))} dangerouslySetInnerHTML={{ __html: c.bodyHTML }} />
            </details>
          ) : (
            <div class="md" data-lang={ctx.langFor(t.path) ?? ''} ref={(el) => void (el && highlightBlocks(el, ctx.langFor(t.path), languageFor(t.path)))} dangerouslySetInnerHTML={{ __html: c.bodyHTML }} />
          )}
          {c.state !== 'PENDING' && <Reactions id={c.id} />}
          <SuggestionActions t={t} c={c} ctx={ctx} />
        </div>
      ))}
      {first?.state !== 'PENDING' && (
        <>
        <Editor value={body} onInput={setBody} onSubmit={() => body.trim() && send()} onSubmitAlt={() => body.trim() && send(canResolve)} repo={ctx.repo} mentions={ctx.mentions} rows={2} placeholder={canResolve ? 'Reply… (⌘↵ to send, ⌘⇧↵ to send and resolve)' : 'Reply… (⌘↵ to send)'} />
        <div class="row">
          {body.trim() && (
            <button onClick={() => send()} title="⌘↵">
              Reply
            </button>
          )}
          {body.trim() && canResolve && (
            <button onClick={() => send(true)} title="⌘⇧↵">
              Reply and resolve
            </button>
          )}
          {fixes.length > 0 && !body.trim() && (
            <button title={`Reply "Fixed in" with ${fixes.length > 1 ? 'these commits' : 'this commit'}, and resolve the thread:\n${fixes.map((f) => `${f.oid.slice(0, 7)} ${f.headline}`).join('\n')}`} onClick={fixedIt}>
              Fixed in {fixes.map((f) => f.oid.slice(0, 7)).join(', ')}
            </button>
          )}
          {(t.isResolved ? t.viewerCanUnresolve : t.viewerCanResolve) && (
            <button onClick={() => flip(!t.isResolved)}>
              {t.isResolved ? 'Unresolve' : 'Resolve thread'}
            </button>
          )}
        </div>
        </>
      )}
      {err && <p class="error">{err}</p>}
    </details>
  );
}

// A comment in my review in progress on GitHub: still mine to change or take out, as lgtm's own drafts.
function PendingComment({ c, ctx, path, t }: { c: Thread['comments']['nodes'][number]; ctx: Ctx; path: string; t: Thread }) {
  const [text, setText] = useState<string | null>(null); // being edited
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = (body: string | null) => (setBusy(true), setErr(''), ctx.editPending(c.id!, body).then(() => (setText(null), true), (e) => (setErr(e.message), false)).finally(() => setBusy(false)));
  // The agent's draft: kept, edited or dropped from the keyboard once r focuses it; edited counts as looked at.
  const agent = agentSays(c.body);
  const looked = agent && lookedDrafts().includes(c.id!);
  const next = () => dispatchEvent(new Event('lgtm:agent-next'));
  const save = (body: string) => run(body).then((ok) => ok && agent && markLooked(c.id!));
  // Dropped without asking, so a few seconds to take it back: the same text, on the same lines.
  const drop = () =>
    run(null).then((ok) => {
      if (!ok) return;
      const d: Draft = { id: 'undo', path, side: t.diffSide, body: c.body ?? c.bodyText, ...(t.subjectType === 'LINE' && t.line ? { line: t.line, ...(t.startLine && t.startLine < t.line ? { startLine: t.startLine } : {}) } : {}) };
      offerUndo('Agent draft dropped', () => ctx.restorePending(d).catch((e) => reportError(`Couldn't put it back: ${e.message}`)));
      next();
    });
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey || busy) return;
    const k = e.key === 'Enter' ? () => (markLooked(c.id!), next()) : e.key === 'e' ? () => setText(c.body ?? c.bodyText) : e.key === 'Delete' || e.key === 'Backspace' ? drop : null;
    if (k) (e.preventDefault(), e.stopPropagation(), k());
  };
  if (text != null)
    return (
      <>
        <Editor value={text} onInput={setText} onSubmit={() => text.trim() && save(text)} onCancel={() => setText(null)} repo={ctx.repo} mentions={ctx.mentions} autoFocus />
        <div class="row">
          <button class="primary" disabled={busy || !text.trim()} onClick={() => save(text)}>Update comment</button>
          <button onClick={() => setText(null)}>Cancel</button>
        </div>
        {err && <p class="error">{err}</p>}
      </>
    );
  return (
    <div
      class={agent ? `agent-draft${looked ? ' looked' : ''}` : undefined}
      id={agent ? 'ad-' + c.id : undefined}
      data-agent-draft={agent ? c.id : undefined}
      tabIndex={agent ? -1 : undefined}
      onKeyDown={agent ? onKey : undefined}
      title={agent ? `The agent's draft: ↵ keep, e edit, ⌫ drop, ${keyLabel(readBindings(localStorage.getItem('shortcuts') ?? '{}').agentDraft ?? 'r')} the next one` : undefined}
    >
      <div class="md" data-lang={ctx.langFor(path) ?? ''} ref={(el) => void (el && highlightBlocks(el, ctx.langFor(path), languageFor(path)))} dangerouslySetInnerHTML={{ __html: c.bodyHTML }} />
      <div class="row">
        {agent && !looked && <button disabled={busy} onClick={() => markLooked(c.id!)} title="Keep it in your review (↵)">Keep</button>}
        <button disabled={busy} onClick={() => setText(c.body ?? c.bodyText)}>Edit</button>
        <button disabled={busy} onClick={async () => (agent ? drop() : (await ask(`Delete this comment from your review in progress on ${site(ctx.repo)}? Its text goes with it.`, 'Delete', true)) && run(null))} title={agent ? 'Drop it from your review (⌫)' : undefined}>{agent ? 'Drop' : 'Delete'}</button>
        {looked && <span class="note">Kept</span>}
      </div>
      {err && <p class="error">{err}</p>}
    </div>
  );
}

// On my own PR, under a current suggested change: commit it now, or pick it to commit with others (the top bar's
// "Commit N suggestions").
function SuggestionActions({ t, c, ctx }: { t: Thread; c: Thread['comments']['nodes'][number]; ctx: Ctx }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const s = ctx.toggleBatch && !t.isOutdated && !t.isResolved ? suggestionOf(t, c) : null;
  if (!s) return null;
  const picked = ctx.batch.some((x) => x.id === s.id);
  const commit = () => (setBusy(true), setErr(''), ctx.applySuggestions([s]).catch((e) => setErr(e.message)).finally(() => setBusy(false)));
  return (
    <div class="row sug-actions">
      <button class="primary" disabled={busy} onClick={commit}>{busy ? 'Committing…' : 'Commit suggestion'}</button>
      <button disabled={busy} onClick={() => ctx.toggleBatch!(s)}>{picked ? 'Remove from batch' : 'Add to batch'}</button>
      {err && <span class="error">{err}</span>}
    </div>
  );
}

function CommitBatch({ batch, apply, onError }: { batch: Suggestion[]; apply: (l: Suggestion[]) => Promise<void>; onError: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      title="Commit the suggestions you added to the batch, as one commit"
      onClick={() => (setBusy(true), apply(batch).catch((e) => onError(`Couldn't commit the suggestions: ${e.message}`)).finally(() => setBusy(false)))}
    >
      {busy ? 'Committing…' : `Commit ${batch.length} suggestion${batch.length > 1 ? 's' : ''}`}
    </button>
  );
}

// On my open threads: did the commented lines change since the thread started? ("Did they fix it?")
function ThenNow({ s }: { s?: SinceComment }) {
  if (!s) return null;
  if (s.kind !== 'changed')
    return (
      <p class="then-now">
        {{ same: <><Octicon name="check" /> The commented lines haven't changed since.</>, gone: 'The file was removed since.', unknown: "The branch was rewritten since (force-push), so lgtm can't tell whether these lines changed." }[s.kind]}
      </p>
    );
  const shown = s.lines.slice(0, 12);
  const indent = commonIndent(shown.map((l) => l.text));
  return (
    <div class="then-now changed">
      ✎ Changed since this thread started:
      <table class="diff mini">
        <tbody>
          {shown.map((l) => (
            <tr class={l.kind === '+' ? 'ln a' : l.kind === '-' ? 'ln d' : 'ln'}>
              <td class="code">{l.text.slice(indent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.lines.length > shown.length && <span class="note">…and {s.lines.length - shown.length} more lines</span>}
    </div>
  );
}

// On my own PR, after I've pushed since someone asked for changes (their latest verdict was of an older commit, and
// they aren't asked again yet): one click asks them all to look again, on GitHub and Slack.
// Who asked for changes on an older commit and isn't asked again yet, and the oldest of those commits.
function askAgainOf(conv: ConversationItem[], pr: PR) {
  const latest = new Map<string, ConversationItem>();
  for (const c of conv) if (!c.bot && (c.state === 'APPROVED' || c.state === 'CHANGES_REQUESTED')) latest.set(c.author, c);
  const asked = new Set((pr.requested_reviewers ?? []).map((r) => r.login));
  const them = [...latest.values()].filter((c) => c.state === 'CHANGES_REQUESTED' && c.commit && c.commit !== pr.head.sha && !asked.has(c.author));
  return { who: them.map((c) => c.author), since: them[0]?.commit ?? null };
}
function LookAgain({ conv, pr, again, check, onRecheck }: { conv: ConversationItem[]; pr: PR; again: (login: string) => Promise<boolean>; check: ThreadCheck | null; onRecheck: () => void }) {
  const [hidden, setHidden] = useState('');
  const [busy, setBusy] = useState(false);
  const { who } = askAgainOf(conv, pr);
  if (!who.length || hidden === pr.head.sha) return null;
  const names = who.map((l) => '@' + l).join(', ').replace(/, ([^,]*)$/, ' and $1');
  return (
    <p class="look-again">
      You've pushed since {names} asked for changes.
      {agentCheck(check, onRecheck, 'their')}
      <button class="primary" disabled={busy} onClick={() => (setBusy(true), Promise.all(who.map(again)).finally(() => setBusy(false)))}>
        {busy ? 'Asking…' : 'Ask them to look again'}
      </button>
      <button class="link" onClick={() => setHidden(pr.head.sha)} title="Not yet: hide this until the next push">Not yet</button>
    </p>
  );
}

// "Since your last review": new commits, my threads with replies, code changed under my threads, my threads
// resolved. Each count jumps to the first one (or shows just the new commits).
// The agent's thread check, in the since-review line: under way, how many it found addressed (the first one not yet,
// a click away), or why it couldn't.
function agentCheck(c: ThreadCheck | null, again: () => void, whose = 'your', resolve?: { n: number; run: () => void }) {
  if (!c) return null;
  const who = AGENTS[c.by].short;
  if (c.state === 'running') return <span class="check-state"><AgentMark id={c.by} /> {who} is checking {whose} open threads…</span>;
  if (c.state === 'failed') return <span class="check-state" title={c.error}><AgentMark id={c.by} /> {who} couldn't check {whose} threads <button class="link" onClick={again}>Try again</button></span>;
  const all = Object.entries(c.verdicts), done = all.filter(([, v]) => v.addressed).length;
  const open = all.find(([, v]) => !v.addressed)?.[0];
  if (!all.length) return null;
  return (
    <span class="check-state">
      <AgentMark id={c.by} /> {who}: {done} of {all.length} open thread{all.length > 1 ? 's' : ''} addressed
      {open && <> · <button class="link" onClick={() => jumpTo('t-' + open)}>{all.length - done} not yet</button></>}
      {!!resolve?.n && <> · <button class="link" onClick={resolve.run}>Resolve the {resolve.n} addressed</button></>}
    </span>
  );
}

// Your threads (y), on their own in place of the diff: the ones I started or replied in (my agent's too, sent or still
// drafts in my pending review), each with the lines it's on and
// what changed under it since, to go through on a re-review. Waiting on me first; resolved and outdated ones folded.
// The open ones stay where they are while I go through them (resolving one doesn't move it); Esc goes back.
// What's still to send comes first (my drafts here, and what's in my pending review on the site, my agent's too), to
// look over before submitting.
function MyThreads({ threads, drafts, files, ctx, close }: { threads: Thread[]; drafts: Draft[]; files: PRFile[]; ctx: Ctx; close: (t?: Thread | Draft) => void }) {
  const mine = threads.filter((t) => t.comments.nodes.some((c) => c.author?.login === ctx.me));
  const unsent = (t: Thread) => t.comments.nodes.some((c) => c.state === 'PENDING');
  const settled = (t: Thread) => t.isResolved || t.isOutdated;
  const waits = (t: Thread) => awaitsMe(t, ctx.me, ctx.pr.user.login === ctx.me);
  // Where each thread goes is settled when it first shows (threads that load later too): resolving one as I go through
  // them doesn't move it.
  const first = useRef(new Map<string, boolean>()).current;
  for (const t of mine) if (!first.has(t.id)) first.set(t.id, !settled(t) || unsent(t));
  const toSend = mine.filter((t) => first.get(t.id) && unsent(t));
  const open = mine.filter((t) => first.get(t.id) && !unsent(t)).sort((a, b) => +waits(b) - +waits(a));
  const done = mine.filter((t) => !first.get(t.id));
  const sending = drafts.length + toSend.length;
  // Comments to send whose code has changed since they were written (an agent's run on an older commit, say): gone in
  // one go, after asking (they can't be put back where they were).
  const stale = toSend.filter((t) => t.isOutdated).flatMap((t) => t.comments.nodes.filter((c) => c.state === 'PENDING' && c.id && c.author?.login === ctx.me).map((c) => c.id!));
  const [dropping, setDropping] = useState(false);
  const dropStale = async () => {
    const n = stale.length;
    if (!(await ask(`Drop the ${n === 1 ? 'outdated comment' : `${n} outdated comments`} from your review? The code under ${n === 1 ? 'it' : 'them'} changed since; ${n === 1 ? 'it' : 'they'} can't be put back.`, 'Drop', true))) return;
    setDropping(true);
    await ctx.dropPending(stale).catch((e) => reportError(`Couldn't drop them all: ${e.message}`));
    setDropping(false);
  };
  const [showDone, setShowDone] = useState(!open.length);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as Element).closest?.('input, textarea, [contenteditable], dialog') && close();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, []);
  const one = (t: Thread) => (
    <section class="my-thread" key={t.id}>
      <button class="link my-thread-at" title="Show it in the diff" onClick={() => close(t)}>
        <FileName path={t.path} />{t.line ? `:${t.line}` : ''}
      </button>
      <ThreadCode t={t} />
      <ThreadView t={t} ctx={ctx} />
    </section>
  );
  const draft = (d: Draft) => (
    <section class="my-thread" key={d.id}>
      <button class="link my-thread-at" title="Show it in the diff" onClick={() => close(d)}>
        <FileName path={d.path} />{d.line ? `:${d.line}` : ''}
      </button>
      <DraftCode d={d} files={files} />
      <Notes ctx={ctx} threads={[]} drafts={[d]} form={ctx.target?.editId === d.id} />
    </section>
  );
  return (
    <div class="my-threads">
      <h3>
        Your threads <span class="note">{[sending && `${sending} to send`, open.length && `${open.length} open`, done.length && `${done.length} resolved or outdated`].filter(Boolean).join(', ') || 'none yet'}</span>
        <button onClick={() => close()}>Back to the diff <kbd>Esc</kbd></button>
      </h3>
      {!mine.length && !drafts.length && <p class="note">You haven't commented on its code yet.</p>}
      {sending > 0 && (
        <h4 class="my-threads-sub">
          To send with your review
          {stale.length > 0 && <button disabled={dropping} title="Your comments to send whose code changed since they were written" onClick={() => void dropStale()}>{dropping ? 'Dropping…' : `Drop ${stale.length} outdated`}</button>}
        </h4>
      )}
      {drafts.map(draft)}
      {toSend.map(one)}
      {sending > 0 && open.length > 0 && <h4 class="my-threads-sub">Open</h4>}
      {open.map(one)}
      {done.length > 0 && (showDone ? done.map(one) : <button class="gen-row" onClick={() => setShowDone(true)}>{done.length} resolved or outdated. Show</button>)}
    </div>
  );
}

// A draft's lines: the diff up to its line, as a thread's (ThreadCode) shows them.
function DraftCode({ d, files }: { d: Draft; files: PRFile[] }) {
  const patch = files.find((f) => f.filename === d.path)?.patch;
  if (!patch || d.line == null) return null;
  const lines = parsePatch(patch).flatMap((h) => h.lines);
  const at = lines.findIndex((l) => (d.side === 'LEFT' ? l.old === d.line && l.kind !== '+' : l.new === d.line && l.kind !== '-'));
  if (at < 0) return null;
  const span = d.startLine ? d.line - d.startLine + 1 : 1;
  const shown = lines.slice(Math.max(0, at + 1 - Math.min(12, Math.max(4, span))), at + 1);
  const from = d.startLine ?? d.line;
  return <CodeSnippet lines={shown} path={d.path} hit={(l) => ((n) => n != null && n >= from && n <= d.line!)(d.side === 'LEFT' ? l.old : l.new)} />;
}

function SinceSummary(p: { me: string; threads: Thread[]; lastReviewAt: string; newCommits: number | null; sinceComment: Map<string, SinceComment>; onCommits: () => void; check: ThreadCheck | null; onRecheck: () => void; onResolveAll: () => void; onFocus: () => void }) {
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
    mine.length - resolved.length > 0 ? <button class="link" title="Your threads on their own, each with its code and what changed since (y)" onClick={p.onFocus}>go through your threads</button> : null,
    agentCheck(p.check, p.onRecheck, 'your', {
      n: p.threads.filter((t) => !t.isResolved && t.viewerCanResolve && p.check?.state === 'done' && p.check.verdicts[t.id]?.addressed).length,
      run: p.onResolveAll,
    }),
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
  const [nowPref] = useStoredFlag('commentNow', false); // Settings → Reviewing: post at once, or keep for Finish review
  const now = nowPref && !ctx.pending; // with a review open on GitHub, comments join it
  const [posting, setPosting] = useState<'' | 'posting' | string>('');
  const { on: agents } = useAgents();
  // "Fix" in the editor: the commented lines rewritten by the agent picked, from the comment so far.
  const fix = async (agent: AgentId, comment: string) => {
    const lines = ctx.suggestion(target) ?? '';
    const f = ctx.files.find((x) => x.filename === target.path);
    const source = await getRaw(ctx.headRepo, target.path, ctx.pr.head.sha).catch(() => null);
    const on = target.at ?? target; // the head's lines
    const out = (await runAgent(fixPrompt(ctx.pr, target.path, on.startLine ?? on.line!, on.line!, lines, source, f?.patch, comment), agent))
      .replace(/^\s*```[\w-]*\n?|\n?```\s*$/g, '').replace(/^\n+|\s+$/g, '');
    return reindent(out, lines);
  };

  function save(post = now && !target.editId) {
    if (!body.trim() || posting === 'posting') return;
    const { editId, body: _b, atEnd: _e, at, ...was } = target;
    const rest = at ? { ...was, line: at.line, startLine: at.startLine } : was; // from a commit on its own: its line in all changes
    if (at) dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `On line ${at.line} in all changes` } }));
    if (editId) ctx.updateDraft(editId, { ...rest, body });
    else if (post) {
      setPosting('posting');
      return void ctx.postNow({ ...rest, body }).then(() => ctx.setTarget(null), (e) => setPosting(`Couldn't post it: ${e.message}`));
    } else ctx.addDraft({ ...rest, body });
    ctx.setTarget(null);
  }

  return (
    <div class="draft-form">
      <div class="badge">{where(target)}{target.at && ` · goes on line ${target.at.line} in all changes`}</div>
      <Editor
        value={body}
        onInput={setBody}
        onSubmit={() => save()}
        onCancel={() => ctx.setTarget(null)}
        repo={ctx.repo}
        mentions={ctx.mentions}
        suggestion={ctx.suggestion(target)}
        fix={agents.length ? { agents, run: fix } : undefined}
        autoFocus
      />
      {posting && posting !== 'posting' && <p class="error">{posting}</p>}
      <div class="row">
        <button class="primary" disabled={!body.trim() || posting === 'posting'} onClick={() => save()}>
          {target.editId ? 'Update comment' : now ? (posting === 'posting' ? 'Posting…' : 'Comment') : 'Add to review'}
        </button>
        {!target.editId && (
          <button
            disabled={!body.trim() || posting === 'posting' || (!now && ctx.pending)}
            onClick={() => save(!now)}
            title={now ? 'Keep it as a draft, sent with Finish review' : ctx.pending ? `You have a review in progress on ${site(ctx.repo)}: comments go out with it (Finish review)` : 'Post it now, on its own'}
          >
            {now ? 'Add to review' : 'Comment now'}
          </button>
        )}
        <button onClick={() => ctx.setTarget(null)}>Cancel</button>
      </div>
    </div>
  );
}

// The Jira ticket the PR names, so the review can be held against its intent without leaving the page.
// Tickets as last loaded, so a PR shows its ticket at once (no jump when Jira answers); refreshed each time. The 40
// most recent are kept.
const jiraSeen = (): Record<string, JiraIssue> => {
  try {
    return JSON.parse(localStorage.getItem('jiraSeen') ?? '{}');
  } catch {
    return {};
  }
};
const keepJira = (issue: JiraIssue) => {
  try {
    const all = jiraSeen();
    delete all[issue.key];
    localStorage.setItem('jiraSeen', JSON.stringify(Object.fromEntries([...Object.entries(all), [issue.key, issue]].slice(-40))));
  } catch {}
};

// Other PRs for this PR's Jira tickets (github.ts ticketPRs), each opening here: the merge order at a glance.
const PR_ICON = { MERGED: 'git-merge', CLOSED: 'git-pull-request-closed', OPEN: 'git-pull-request' } as const;
function TicketPRs({ repo, n, keys }: { repo: string; n: number; keys: string[] }) {
  const [list, setList] = useState<TicketPR[]>([]);
  useEffect(() => void ticketPRs(repo, n, keys).then(setList, () => setList([])), [repo, n, keys.join()]);
  if (!list.length) return null;
  return (
    <div class="ticket-prs">
      <span class="note">Also for {[...new Set(list.flatMap((p) => p.keys))].join(', ')}:</span>
      {list.map((p) => {
        const st = p.state === 'OPEN' && p.isDraft ? 'draft' : p.state.toLowerCase();
        return (
          <a href={`#/${p.repo}/pull/${p.number}`} title={`${p.title}\n${p.repo}#${p.number} by ${p.author}`}>
            <Octicon name={p.isDraft && p.state === 'OPEN' ? 'git-pull-request-draft' : PR_ICON[p.state]} class={`recent-${st}`} />
            <b>{p.repo === repo ? '' : repoLabel(p.repo)}{numRef(p.repo, p.number)}</b> <span class="ticket-pr-title">{p.title}</span> <small>{st}</small>
          </a>
        );
      })}
    </div>
  );
}

function Ticket({ id, lang }: { id: string; lang?: string }) {
  const [issue, setIssue] = useState<JiraIssue | null>(() => jiraSeen()[id] ?? null);
  const [err, setErr] = useState('');
  const [open, toggle] = useStoredFlag('ticketOpen', false);
  const [tries, setTries] = useState(0);
  useEffect(() => void fetchJira(id).then((i) => (setIssue(i), keepJira(i), setErr('')), (e) => setErr(e.message)), [id, tries]);
  if (err && !issue) return <p class="note ticket-err">Jira {id}: {err} <Retry onClick={() => (setErr(''), setTries((t) => t + 1))} /></p>;
  // The first time: a placeholder its summary's height while Jira answers.
  if (!issue) return <div class="ticket ticket-wait"><span class="sk sk-line" /> {id}</div>;
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

// A review's comments on the code, under its verdict: each its thread's place and first words, a click away (a resolved
// or outdated one hidden here is shown first: reveal).
// A review's threads, one line each; its resolved and outdated ones folded behind one line, unless asked for.
function ReviewThreads({ review, threads, reveal }: { review: ConversationItem; threads: Thread[]; reveal: () => void }) {
  const id = review.id.startsWith('r') ? Number(review.id.slice(1)) : NaN;
  const [showSettled, setShowSettled] = useState(false);
  const all = threads.flatMap((t) => t.comments.nodes.filter((c) => c.pullRequestReview?.databaseId === id).map((c) => ({ t, c })));
  if (!all.length) return null;
  const settled = all.filter(({ t }) => t.isResolved || t.isOutdated);
  const mine = showSettled ? all : all.filter(({ t }) => !t.isResolved && !t.isOutdated);
  return (
    <div class="review-threads">
      {settled.length > 0 && (
        <button class="review-threads-settled" onClick={() => setShowSettled(!showSettled)} title={showSettled ? 'Fold them again' : 'List them'}>
          <Octicon name="check" /> {settled.length} resolved or outdated thread{settled.length === 1 ? '' : 's'}{showSettled ? ' · hide' : ' · show'}
        </button>
      )}
      {mine.map(({ t, c }) => (
        <a
          href={c.url}
          onClick={(e) => (e.preventDefault(), document.getElementById('t-' + t.id) || reveal(), jumpTo('t-' + t.id, 'f-' + t.path))}
        >
          <Octicon name="file" /> <b><FileName path={t.path} />{t.line ?? t.originalLine ? `:${t.line ?? t.originalLine}` : ''}</b>
          <span class="review-thread-text">{c.bodyText.replace(/\s+/g, ' ').trim()}</span>
          {(t.isResolved || t.isOutdated) && <small>{t.isResolved ? 'resolved' : 'outdated'}</small>}
        </a>
      ))}
    </div>
  );
}

// "Agents" (the PR bar, `label`; with one agent on, that agent's mark and name): a menu of what the coding agents on (Settings → Coding agents) can do here: a review
// by each one, a question about the whole PR (the Ask panel, its agent picked there) and, with Claude Code on, this PR's
// Claude Code session. A comment's Claude mark is that session alone. With one linked (a dot: the session that sent
// the PR here, or one this button started), it opens it, with a comment left for it; without one, it starts a session
// with the PR or comment in the prompt (in the repo's folder, if set in Settings) and links it once the Claude app
// records it. ⌥-click starts a new one anyway.
function AgentsMenu({ prompt, repo, prUrl, label, full }: { prompt: string; repo: string; prUrl: string; label?: string; full?: PR }) {
  const [note, setNote] = useState('');
  const [menu, setMenu] = useState(false);
  const { on: agents } = useAgents();
  const claudeOn = agents.includes('claude'), codexOn = agents.includes('codex');
  useEffect(() => {
    if (!menu) return;
    const away = (e: Event) => !(e.target as Element).closest?.('.agents-menu') && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    addEventListener('pointerdown', away);
    addEventListener('keydown', esc);
    return () => (removeEventListener('pointerdown', away), removeEventListener('keydown', esc));
  }, [menu]);
  const [offer, setOffer] = useState<AgentId | null>(null); // that agent's lgtm-review skill isn't installed: offer it
  const [offerSkill, noOffer] = useStoredFlag('offerSkill', true);
  const [offerMod, setOfferMod] = useState(false); // the lgtm-links mod isn't installed: suggest it
  const [suggestMod, noModOffer] = useStoredFlag('offerMod', true);
  const [session, setSession] = useState<SessionState>(null);
  const title = session?.title ?? '';
  const [, setTick] = useState(0);
  const pr = parsePrUrl(prUrl) ?? { repo: '', n: 0 };
  const from = linkedSession(pr.repo, pr.n);
  const linkAgent: AgentId = from?.agent === 'codex' ? 'codex' : 'claude'; // whose session (conversation) it is
  // A comment's button: the linked session's agent, else Claude Code's new session, else Codex's.
  const sessAgent: AgentId | null = from && agents.includes(linkAgent) ? linkAgent : claudeOn ? 'claude' : codexOn ? 'codex' : null;
  useEffect(() => {
    const t = () => setTick((x) => x + 1);
    addEventListener('lgtm:session-link', t);
    const toggle = () => label && setMenu((m) => !m); // its shortcut (a), on the PR bar's
    addEventListener('lgtm:agents-menu', toggle);
    return () => (removeEventListener('lgtm:session-link', t), removeEventListener('lgtm:agents-menu', toggle));
  }, []);
  // The linked session's title and state (working, waiting for you), every 10 seconds; an app session that's gone
  // (archived, deleted) is let go.
  useEffect(() => {
    if (!from || from.agent === 'codex') return setSession(null); // Codex keeps no state lgtm can read
    let stop = false;
    const look = () =>
      claudeSessionState(from.id).then((s) => {
        if (stop) return;
        setSession(s);
        if (!s && from.id.startsWith('local_')) unlinkSession(pr.repo, pr.n);
      }, () => {});
    look();
    const t = setInterval(look, 10_000);
    return () => ((stop = true), clearInterval(t));
  }, [from?.id]);
  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(''), 4000);
  };
  // To its linked session (conversation), with the comment left for it; or a new one with the PR or comment in the
  // prompt: Claude Code's in the repo's folder, then linked once the Claude app records it; Codex's linked once its
  // skill sends the PR back here.
  const go = async (e: { altKey: boolean }, a: AgentId) => {
    setMenu(false);
    if (from && !e.altKey && linkAgent === a) return flash(await backToSession(from.id, label ? '' : prompt, from.agent));
    if (a === 'codex') {
      await openAppLink(`codex://threads/new?prompt=${encodeURIComponent(prompt)}`);
      if (offerSkill && !(await agentSkill(false, 'codex').catch(() => null))?.installed) setOffer('codex');
      return;
    }
    await openAppLink(claudeNewLink(prompt, claudeFolder(repo)));
    linkNewClaude(pr.repo, pr.n, prUrl);
    if (offerSkill && !(await agentSkill().catch(() => null))?.installed) return setOffer('claude');
    if (suggestMod && (await agentMod().catch(() => null))?.installed === false) setOfferMod(true);
  };
  const install = (a: AgentId) => agentSkill(true, a).then(() => (setOffer(null), flash(`Skill installed: ${AGENTS[a].short} can now send ${pageTerm().PRs} here`)), (e) => flash(`Couldn't install it: ${e.message}`));
  const what = label ? `this ${pageTerm().PR}` : 'this comment';
  const place = (a: AgentId) => (a === 'codex' ? 'Codex conversation' : 'Claude Code session');
  if (!label && !sessAgent) return null;
  return (
    <span class="agents-menu">
      <button
        class={`${label ? 'agents-btn' : 'copy-link'}${from ? ' linked' : ''}`}
        title={label ? `Coding agents: a review or a question about this ${pageTerm().PR}, or its session${hint(readBindings(localStorage.getItem('shortcuts') ?? '{}').agents)}` : from && sessAgent === linkAgent ? `Open its ${place(sessAgent!)}${title ? `, “${title}”` : ''}, with this comment left for it (⌥-click for a new one)` : `Start a ${place(sessAgent!)} on ${what}`}
        aria-haspopup={label ? 'menu' : undefined}
        aria-expanded={label ? menu : undefined}
        onClick={(e) => (label && !e.altKey ? setMenu(!menu) : go(e, sessAgent ?? 'claude'))}
      >
        {!label ? <AgentMark id={sessAgent!} /> : agents.length === 1 ? <><AgentMark id={agents[0]} /> {AGENTS[agents[0]].short}</> : <><Octicon name="dependabot" /> {label}</>}
        {from && <span class={`session-dot${session?.state === 'waiting' ? ' waiting' : ''}`} aria-label="linked to a session" />}
        {label && session?.state === 'working' && <span class="session-state"> working…</span>}
        {label && session?.state === 'waiting' && <span class="session-state waiting"> waiting for you</span>}
      </button>
      {menu && (
        <div class="account-menu agents-pop" role="menu">
          {full && agents.map((a) => (
            <button
              key={a}
              role="menuitem"
              title={`An adversarial review of this ${pageTerm().PR} by ${AGENTS[a].name}: its findings go on it under your name, each starting with 🤖 (Settings → Coding agents: as your pending review or as comments)`}
              onClick={() => (setMenu(false), flash(reviewNow({ id: full.node_id, repo, number: full.number, headSha: full.head.sha }, a) ? `${AGENTS[a].name} is reviewing it: you'll hear when it's done` : 'An agent is already on it'))}
            >
              <AgentMark id={a} /> Review with {AGENTS[a].name} <small>adversarial</small>
            </button>
          ))}
          {agents.length > 0 && (
            <button role="menuitem" onClick={() => (setMenu(false), dispatchEvent(new Event('lgtm:ask-pr')))}>
              <Octicon name="comment-discussion" /> Ask a question about this {pageTerm().PR} <small>no session</small>
            </button>
          )}
          {full && convosOn(repo, full.number, full.head.sha).map((c) => (
            <button key={c.key} role="menuitem" title={`Asked about ${c.about}: open the conversation (${c.n} answer${c.n > 1 ? 's' : ''})`} onClick={() => (setMenu(false), dispatchEvent(new CustomEvent('lgtm:ask-again', { detail: c.key })))}>
              <Octicon name="history" /> <span class="ask-again-label">{c.label}</span> <small>{c.about}</small>
            </button>
          ))}
          {(['claude', 'codex'] as const).filter((a) => agents.includes(a)).map((a) => {
            const mine = !!from && linkAgent === a;
            return (
              [
                <button key={a} role="menuitem" onClick={() => go({ altKey: false }, a)}>
                  <AgentMark id={a} /> {mine ? `Open its ${place(a)}` : `Start a ${place(a)}`}
                  {mine && title && <small>{title}</small>}
                </button>,
                mine && (
                  <button key={a + '-new'} role="menuitem" onClick={() => go({ altKey: true }, a)}>
                    <AgentMark id={a} /> New {place(a)} <small>⌥-click</small>
                  </button>
                ),
              ]
            );
          })}
          {!agents.length && <p class="note">No coding agent is on. Install Claude Code or Codex, or switch one on in Settings → Coding agents.</p>}
        </div>
      )}
      {note && <span class="agents-note">{note}</span>}
      {offerMod && !offer && !note && (
        <span class="agents-note">
          Add the lgtm-links mod to Claude Code: an Open in lgtm button under PR links, and your reviews reach the session by themselves.{' '}
          <button class="link" onClick={() => (setOfferMod(false), copyText(MOD_INSTALL).then(() => flash(`Copied: paste it in a terminal (${MOD_INSTALL})`), () => flash(MOD_INSTALL)))}>Copy the install command</button> ·{' '}
          <button class="link" onClick={() => (setOfferMod(false), noModOffer())}>Don't ask again</button>
        </span>
      )}
      {offer && !note && (
        <span class="agents-note">
          Add the lgtm skill so {AGENTS[offer].short} sends {pageTerm().PRs} ready for review here, linked to its {offer === 'codex' ? 'conversation' : 'session'}.{' '}
          <button class="link" onClick={() => install(offer)}>Add it</button> · <button class="link" onClick={() => (setOffer(null), noOffer())}>Don't ask again</button>
        </span>
      )}
    </span>
  );
}

// Ask's conversations, kept (per account) so closing the panel loses nothing: by PR and commit, then what they're
// about. ponytail: the latest 30 kept; an older one starts over.
type Turn = { q: string; text: string; html: string; by: AgentId };
type AskPanel = { path: string; text: string; line?: number; ci?: { check: string; onBase: string | null; log: string } };
const CONVOS = 'askConvos';
const readConvos = (): Record<string, { at: number; turns: Turn[]; panel?: AskPanel }> => {
  try {
    return JSON.parse(localStorage.getItem(own(CONVOS)) ?? '{}');
  } catch {
    return {};
  }
};
const convoOf = (k: string) => readConvos()[k]?.turns ?? [];
function keepConvo(k: string, turns: Turn[], panel?: AskPanel) {
  const all = readConvos();
  if (turns.length) all[k] = { at: Date.now(), turns, panel: panel && (panel.ci ? { ...panel, ci: { ...panel.ci, log: panel.ci.log.slice(-40_000) } } : panel) };
  else delete all[k];
  const latest = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 30);
  try {
    localStorage.setItem(own(CONVOS), JSON.stringify(Object.fromEntries(latest)));
  } catch {}
}
// This commit's conversations, newest first, for the Agents menu: what each was about and its first question.
export const convosOn = (repo: string, n: number, sha: string) =>
  Object.entries(readConvos())
    .filter(([k, c]) => k.startsWith(`${repo}#${n}@${sha}:`) && c.panel && c.turns.length)
    .sort((a, b) => b[1].at - a[1].at)
    .map(([k, c]) => ({ key: k, label: c.panel!.ci ? `${c.panel!.ci.check}: why it failed` : c.turns[0].q, about: c.panel!.ci ? 'failed check' : c.panel!.path ? fileLabel(c.panel!.path) : 'the whole PR', n: c.turns.length }));
const hashOf = (t: string) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7).toString(36);

// Select code in a file, then "Ask": a question about it, answered by a coding agent's CLI (picked in the panel, the last one
// remembered) with the file, its diff in this PR and the selection.
// onComment: a comment form on the file (at the line, when the selection's in the diff), written with the answer.
function AskAgent({ pr, repo, headRepo, files, onComment }: { pr: PR; repo: string; headRepo: string; files: File[]; onComment: (path: string, line: number | undefined, body: string) => void }) {
  const [sel, setSel] = useState<{ path: string; text: string; line?: number; x: number; y: number } | null>(null);
  // What it's about: code selected in a file (path, text, its last line), the whole PR (neither), or a failed check (ci).
  type Panel = AskPanel;
  const [panel, setPanel] = useState<Panel | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  // The conversation so far: each question with its answer; a follow-up sends the earlier ones along (the CLI keeps
  // no session).
  const [turns, setTurns] = useState<Turn[]>([]);
  // The question under way and its answer as it's written, until the answer is in.
  const [live, setLive] = useState<{ k: string; q: string; text: string } | null>(null);
  const keyOf = (p: Panel) => `${repo}#${pr.number}@${pr.head.sha}:${p.ci ? `ci:${p.ci.check}` : p.path ? `sel:${p.path}:${hashOf(p.text)}` : 'pr'}`;
  const asking = useRef(new Set<string>()); // conversations with a question under way
  const shown = useRef(''); // the conversation on show, so one finishing after it's closed is kept, not shown
  const open = (p: Panel) => {
    const k = keyOf(p);
    shown.current = k;
    setPanel(p), setQ(''), setError(''), setTurns(convoOf(k));
    return convoOf(k).length > 0;
  };
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const { on: agents } = useAgents();
  const [agent, pickAgent] = useState<AgentId | null>(null);
  const who = agent && agents.includes(agent) ? agent : askAgent();
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
        const fe = s.focusNode && (s.focusNode.nodeType === 1 ? (s.focusNode as Element) : s.focusNode.parentElement);
        const line = Number([...(fe?.closest('tr.ln')?.querySelectorAll('td.num') ?? [])].at(-1)?.textContent) || undefined; // the new side's
        setSel({ path: file.id.slice(2), text: text.slice(0, 4000), line, x: Math.min(r.right, innerWidth - 140), y: r.bottom + 4 });
      });
    const away = () => setSel(null);
    const whole = () => void open({ path: '', text: '' }); // the Agents menu's Ask
    // Why did it fail? (a failed check in the index): asked of the agent picked there, at once.
    const ci = (e: Event) => {
      const d = (e as CustomEvent<{ check: string; onBase: string | null; log: string; agent: AgentId }>).detail;
      const p = { path: '', text: '', ci: { check: d.check, onBase: d.onBase, log: d.log } };
      pickAgent(d.agent);
      if (!open(p)) void send(p, 'Why did it fail?', d.agent, []); // asked before, on this commit: as it was
    };
    // One of this commit's conversations, from the Agents menu.
    const again = (e: Event) => {
      const c = readConvos()[(e as CustomEvent<string>).detail];
      if (c?.panel) open(c.panel);
    };
    addEventListener('lgtm:ask-pr', whole);
    addEventListener('lgtm:ask-ci', ci);
    addEventListener('lgtm:ask-again', again);
    addEventListener('mouseup', up);
    addEventListener('scroll', away, { passive: true });
    return () => (removeEventListener('mouseup', up), removeEventListener('scroll', away), removeEventListener('lgtm:ask-pr', whole), removeEventListener('lgtm:ask-ci', ci), removeEventListener('lgtm:ask-again', again));
  }, []);
  const ask = () => panel && q.trim() && who && !busy && send(panel, q.trim(), who, turns);
  async function send(panel: Panel, asked: string, who: AgentId, turns: Turn[]) {
    const k = keyOf(panel);
    if (asking.current.has(k)) return; // already under way (closed and opened again meanwhile)
    asking.current.add(k);
    setBusy(true);
    setError('');
    setLive({ k, q: asked, text: '' });
    if (shown.current === k) setQ('');
    // More of the answer: shown, and followed down unless you've scrolled up to read.
    const onText = (text: string) => {
      setLive((l) => (l?.k === k ? { ...l, text } : l));
      const p = panelRef.current;
      if (p && shown.current === k && p.scrollHeight - p.scrollTop - p.clientHeight < 80) requestAnimationFrame(() => (p.scrollTop = p.scrollHeight));
    };
    // ponytail: the earlier answers go along whole; a long conversation is cut to its last 6 turns.
    const question = turns.length
      ? `Earlier in this conversation (oldest first):\n\n${turns.slice(-6).map((t) => `Q: ${t.q}\nA: ${t.text}`).join('\n\n')}\n\nTheir follow-up question: ${asked}`
      : asked;
    try {
      let prompt: string;
      if (panel.ci) prompt = ciPrompt(pr, panel.ci.check, panel.ci.onBase, panel.ci.log, files, turns.length ? question : undefined); // the first: the diagnosis
      else if (!panel.path) prompt = prAskPrompt(pr, files, question); // the whole PR (the Agents menu's Ask)
      else {
        const f = files.find((f) => f.filename === panel.path);
        const source = f?.status === 'removed' ? null : await getRaw(headRepo, panel.path, pr.head.sha).catch(() => null);
        prompt = askPrompt(pr, panel.path, f?.patch, source, panel.text, question);
      }
      const text = await runAgent(prompt, who, onText);
      const html = await renderGfm(text, repo); // GitHub sanitizes the HTML
      const all = [...turns, { q: asked, text, html, by: who }];
      keepConvo(keyOf(panel), all, panel);
      if (shown.current === keyOf(panel)) {
        // still on show (else it's kept for when it's opened again)
        setTurns(all);
        requestAnimationFrame(() => panelRef.current?.scrollTo({ top: panelRef.current.scrollHeight, behavior: 'smooth' }));
      }
      if (panel.ci && !turns.length) notifyAgentDone(`${AGENTS[who].name}: why ${panel.ci.check} failed`, text.replace(/[`*_>#]/g, '').split('\n').find((l) => l.trim())?.slice(0, 160) ?? '', `/${repo}/pull/${pr.number}`);
    } catch (e: any) {
      setError(e.message);
      if (shown.current === k) setQ((q) => q || asked); // to ask again
    }
    setLive((l) => (l?.k === k ? null : l));
    asking.current.delete(k);
    setBusy(asking.current.size > 0);
  }
  return (
    <>
      {sel && !panel && who && (
        <button
          class="ask-btn primary"
          style={{ left: sel.x, top: sel.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open({ path: sel.path, text: sel.text, line: sel.line }), setSel(null))}
        >
          <AgentMark id={who} /> Ask {AGENTS[who].short}
        </button>
      )}
      {panel && who && (
        <div class="ask-panel" role="dialog" aria-label={`Ask ${AGENTS[who].short}`} ref={panelRef}>
          <div class="row">
            <b>
              Ask{' '}
              {agents.length > 1 ? (
                <select aria-label="Agent" value={who} onChange={(e) => (pickAgent(e.currentTarget.value as AgentId), setAskAgent(e.currentTarget.value as AgentId))}>
                  {agents.map((a) => <option key={a} value={a}>{AGENTS[a].short}</option>)}
                </select>
              ) : (
                <><AgentMark id={who} /> {AGENTS[who].short}</>
              )}{' '}
              about {panel.ci ? `the failed check ${panel.ci.check}` : panel.path ? fileLabel(panel.path) : `this ${pageTerm().PR}`}
            </b>
            <span class="spacer" />
            {turns.length > 0 && !busy && (
              <button class="link" title="Forget this conversation and ask again" onClick={() => (keepConvo(keyOf(panel), []), setTurns([]), panel.ci && void send(panel, 'Why did it fail?', who, []))}>
                Start over
              </button>
            )}
            <button title="Close" onClick={() => ((shown.current = ''), setPanel(null))}><Octicon name="x" /></button>
          </div>
          {panel.text ? <pre class="ask-sel">{panel.text}</pre> : <p class="note">{AGENTS[who].short} reads {panel.ci ? "the end of the job's log and the diff" : "the description and every file's diff, specs included"}.</p>}
          {turns.map((t) => {
            // The answer as a comment of yours, marked as the agent's (🤖, as its review findings are), to edit before it goes.
            const body = `🤖 ${AGENTS[t.by].name}${panel.ci ? ` on why ${panel.ci.check} failed` : ''}:\n\n${t.text}`;
            return (
              <div class="ask-turn">
                <p class="ask-q">{t.q}</p>
                <div class="md ask-answer" title={`${AGENTS[t.by].name}'s answer`} dangerouslySetInnerHTML={{ __html: t.html }} />
                <div class="ask-use">
                  {panel.path && (
                    <button class="link" onClick={() => (onComment(panel.path, panel.line, body), (shown.current = ''), setPanel(null))}>
                      <Octicon name="comment" /> Comment on {fileLabel(panel.path)}{panel.line ? `:${panel.line}` : ''}
                    </button>
                  )}
                  <button class="link" onClick={() => ((shown.current = ''), setPanel(null), dispatchEvent(new CustomEvent('lgtm:finish', { detail: { append: body } })))}>
                    <Octicon name="list-unordered" /> Add to the review's summary
                  </button>
                </div>
              </div>
            );
          })}
          {live?.k === keyOf(panel) && (
            <div class="ask-turn">
              <p class="ask-q">{live.q}</p>
              {live.text && <div class="md ask-answer ask-live">{live.text}</div>}
            </div>
          )}
          <textarea
            rows={2}
            autoFocus
            placeholder={turns.length || panel.ci ? 'A follow-up · ↵ to ask' : panel.path ? 'Your question · ↵ to ask' : "What's risky here? Does it match the spec? · ↵ to ask"}
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.isComposing || e.keyCode === 229) return; // an input method's Enter or arrows (platform.ts composing)
              if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), void ask());
              else if (e.key === 'Escape') setPanel(null);
            }}
          />
          <button class="primary" disabled={busy || !q.trim()} onClick={ask}>{busy ? `${AGENTS[who].short} is reading…` : 'Ask'}</button>
          {error && (
            <p class="error">
              {error}
              {/authenticat|oauth|log ?in/i.test(error) && <> Sign {AGENTS[who].name} in: run <code>{who === 'codex' ? 'codex login' : 'claude'}</code> in Terminal{who === 'claude' && <>, then <code>/login</code></>}.</>}
            </p>
          )}
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
      onClick={() => copyText(url).then(() => show('Copied'), () => show("Couldn't copy"))}
    >
      {done || '🔗'}
    </button>
  );
}

// My PR's title and description, edited here with the comment editor (preview, emoji, mentions); saved to GitHub.
// A comment of mine already sent, edited in place: saved on the site, then the conversation and threads load again.
function EditPosted({ body, repo, mentions, save, onDone }: { body: string; repo: string; mentions: string[]; save: (b: string) => Promise<unknown>; onDone: () => void }) {
  const [text, setText] = useState(body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = () => {
    if (!text.trim() || busy) return;
    if (text === body) return onDone(); // nothing changed
    setBusy(true);
    setErr('');
    save(text).then(
      () => (onDone(), dispatchEvent(new Event('lgtm:reload-talk'))),
      (e) => (setErr(e.message), setBusy(false)),
    );
  };
  return (
    <div class="edit-posted">
      <Editor value={text} onInput={setText} onSubmit={go} onCancel={onDone} repo={repo} mentions={mentions} rows={5} autoFocus placeholder="⌘↵ to save · Esc to cancel" />
      <div class="row">
        <button class="primary" disabled={busy || !text.trim()} onClick={go}>{busy ? 'Saving…' : 'Save'}</button>
        <button disabled={busy} onClick={onDone}>Cancel</button>
        {err && <span class="error">{err}</span>}
      </div>
    </div>
  );
}

function EditDescription({ pr, repo, mentions, onDone }: { pr: PR; repo: string; mentions: string[]; onDone: () => void }) {
  const [title, setTitle] = useState(pr.title);
  const [body, setBody] = useState(pr.body ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr('');
    updatePR(repo, pr.number, { title: title.trim(), body }).then(
      () => (onDone(), dispatchEvent(new Event('lgtm:refresh'))),
      (e) => (setErr(e.message), setBusy(false)),
    );
  };
  return (
    <div class="edit-desc">
      <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} aria-label="Title" />
      <Editor value={body} onInput={setBody} onSubmit={save} onCancel={onDone} repo={repo} mentions={mentions} rows={14} autoFocus placeholder="Describe the change · ⌘↵ to save" doc />
      <div class="row">
        <button class="primary" disabled={busy || !title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button disabled={busy} onClick={onDone}>Cancel</button>
        {err && <span class="error">{err}</span>}
      </div>
    </div>
  );
}

const STATE_ICON: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', COMMENTED: 'reply' };
const STATE_LABEL: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'reviewed', DISMISSED: 'review dismissed' };

const botExcerpt = (html: string, max = 100) => (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Before / after screenshots in a description: a table with Before and After columns (a row each), or an image under a
// "Before" label followed by one under "After". The images themselves, so they show as the description has them signed.
type ShotPair = { label: string; before: HTMLImageElement; after: HTMLImageElement };
const BEFORE = /^\W*(before|old|current|sebelum)\b/i;
const AFTER = /^\W*(after|new|now|sesudah|setelah)\b/i;
function shotPairs(root: HTMLElement | null): ShotPair[] {
  if (!root) return [];
  const out: ShotPair[] = [];
  for (const t of root.querySelectorAll('table')) {
    const head = [...(t.querySelector('tr')?.children ?? [])].map((c) => c.textContent?.trim() ?? '');
    const b = head.findIndex((h) => BEFORE.test(h)), a = head.findIndex((h) => AFTER.test(h));
    if (b < 0 || a < 0) continue;
    for (const tr of [...t.querySelectorAll('tr')].slice(1)) {
      const cells = [...tr.children];
      const bi = cells[b]?.querySelector('img'), ai = cells[a]?.querySelector('img');
      if (bi && ai) out.push({ label: cells.find((_, k) => k !== a && k !== b)?.textContent?.trim() ?? '', before: bi, after: ai });
    }
  }
  // Outside tables: the short text just before an image (in its block, else the block before) names it.
  let before: HTMLImageElement | null = null;
  for (const img of [...root.querySelectorAll('img')].filter((i) => !i.closest('table'))) {
    const block = img.closest('p, li, div, h1, h2, h3, h4, h5, h6') as HTMLElement | null;
    const r = document.createRange();
    if (block) (r.setStartBefore(block.firstChild ?? block), r.setEndBefore(img));
    const label = ((block && r.toString().trim()) || (block?.previousElementSibling?.textContent ?? '')).trim().split('\n').pop()!.slice(-40);
    if (BEFORE.test(label)) before = img;
    else if (AFTER.test(label) && before) out.push({ label: '', before, after: img }), (before = null);
  }
  return out;
}

// One pair: side by side, or one over the other with a slider (as a changed image in the diff).
function ShotCompare({ p }: { p: ShotPair }) {
  const [mode, setMode] = useStoredValue('descCompare', 'swipe');
  const [x, setX] = useState(50);
  return (
    <figure class="shot-pair">
      <span class="set-seg img-modes" role="radiogroup" aria-label="Compare">
        {([['swipe', 'Swipe'], ['side', 'Side by side']] as const).map(([v, name]) => (
          <button role="radio" aria-checked={mode === v} class={mode === v ? 'on' : ''} onClick={() => setMode(v)}>{name}</button>
        ))}
      </span>
      {p.label && <figcaption>{p.label}</figcaption>}
      {mode === 'swipe' ? (
        <>
          <div class="img-swipe shot-swipe">
            <img src={p.before.src} alt="Before" />
            <img src={p.after.src} alt="After" style={{ clipPath: `inset(0 0 0 ${x}%)` }} />
            <span class="img-swipe-line" style={{ left: `${x}%` }} />
          </div>
          <input type="range" min={0} max={100} value={x} onInput={(e) => setX(Number(e.currentTarget.value))} aria-label="Before ↔ after" />
          <span class="img-swipe-labels"><span>Before</span><span>After</span></span>
        </>
      ) : (
        <div class="shot-side">
          <figure><img src={p.before.src} alt="Before" /><figcaption>Before</figcaption></figure>
          <figure><img src={p.after.src} alt="After" /><figcaption>After</figcaption></figure>
        </div>
      )}
    </figure>
  );
}

// folded: review mode starts with it closed, the diff first.
function Conversation({ pr, items, lang, repo, me, mentions, folded, ix, threads, reveal, canEdit, canDismiss }: { pr: PR; items: ConversationItem[]; lang?: string; repo: string; me: string; mentions: string[]; folded?: boolean; ix: CodeIndex; threads: Thread[]; reveal: () => void; canEdit: boolean; canDismiss: boolean }) {
  const [editing, setEditing] = useState(false);
  const foldBots = useFoldBots(!!me && pr.user.login === me);
  const [mdStyle] = useMdStyle();
  const look = mdStyleProps(mdStyle); // the description reads like a markdown file (Settings → Markdown files)
  const desc = useRef<HTMLDivElement>(null);
  const [shots, setShots] = useState<ShotPair[]>([]);
  useEffect(() => {
    tidyDoc(desc.current);
    linkSpecRefs(desc.current, ix); // links to the code too, as specs have
    setTimeout(() => setShots(shotPairs(desc.current)), 300); // once its images are signed
    // Its task list ticked and unticked here, as on GitHub, by whoever may edit it.
    const boxes = [...(desc.current?.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox') ?? [])];
    if (!canEdit) return;
    boxes.forEach((b, k) => {
      b.disabled = false;
      b.onchange = () => {
        const body = toggleTask(pr.body ?? '', k, b.checked);
        if (body == null) return void (b.checked = !b.checked);
        boxes.forEach((x) => (x.disabled = true));
        updatePR(repo, pr.number, { title: pr.title, body }).then(
          () => dispatchEvent(new Event('lgtm:refresh')),
          (e) => ((b.checked = !b.checked), boxes.forEach((x) => (x.disabled = false)), dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `Couldn't save it: ${e.message}`, ms: 4000 } }))),
        );
      };
    });
  }, [pr.body_html, ix, canEdit]);
  const peek = useRefPeek(ix);
  const earlier = useMemo(() => earlierVerdicts(items), [items]);
  const replaced = new Set([...earlier.values()].flat());
  // A bot's PR leads with the human it's assigned to, not the bot.
  const lead = (pr.user.type === 'Bot' && pr.assignees[0]) || pr.user;
  const social = useSocial();
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const del = (c: ConversationItem) => void deletePosted(c.node!, 'comment').then(() => dispatchEvent(new Event('lgtm:reload-talk')), (e) => dispatchEvent(new CustomEvent('lgtm:toast', { detail: { text: `Couldn't delete it: ${e.message}`, ms: 4000 } })));
  return (
    <details class="conversation" id="conversation" open={!folded}>
      <summary>
        Conversation <span class="badge">· {items.length} comment{items.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="comment" id="pr-description" data-social={pr.node_id}>
        <Avatar login={lead.login} src={lead === pr.user ? pr.user.avatar_url : undefined} /> <b class="person-link" title={lead === pr.user ? undefined : `Assigned; opened by ${pr.user.login}`} onClick={toPerson(lead.login, repo)}>{lead.login}</b>
        {pr.assignees.filter((a) => a.login !== pr.user.login && a !== lead).map((a, k) => (
          <span key={a.login} class="assigned-to">
            {k ? ', ' : ' · assigned to '}
            <span class="person-link" onClick={toPerson(a.login, repo)} title={`@${a.login}`}>{shownName(a.login, repo)}</span>
          </span>
        ))}{' '}
        <CopyLink url={pr.html_url} />
        <ReactPick id={pr.node_id} />
        {(canEdit || me === pr.user.login) && !editing && (
          <button class="icon-btn" title="Edit the title and description" aria-label="Edit the title and description" onClick={() => setEditing(true)}>
            <Octicon name="pencil" />
          </button>
        )}
        {editing ? (
          <EditDescription pr={pr} repo={repo} mentions={mentions} onDone={() => setEditing(false)} />
        ) : pr.body_html ? (
          <div class={`rich pr-desc ${look.class}`} style={look.style} ref={desc} onMouseOver={peek.over} onMouseOut={peek.out} onClick={(e) => peek.click(e) || onDocClick(e, desc.current)}>
            <div class="md chunk" data-lang={lang ?? ''} dangerouslySetInnerHTML={{ __html: pr.body_html }} />
            {peek.node}
          </div>
        ) : (
          <p class="note">No description.</p>
        )}
        {!editing && <Reactions id={pr.node_id} />}
        {!editing && shots.length > 0 && (
          <div class="shots">
            <p class="shots-h">Screenshots, before and after</p>
            {shots.map((p) => <ShotCompare p={p} />)}
          </div>
        )}
      </div>
      {(() => {
        // Plain approvals (no text, no comments on the code) one after another: one line, "Approved by budi, rina and ana".
        const reviewThreads = (c: ConversationItem) => threads.filter((t) => t.comments.nodes.some((x) => x.pullRequestReview?.databaseId === Number(c.id.slice(1))));
        const bare = (c: ConversationItem) => c.state === 'APPROVED' && !c.html?.trim() && !earlier.has(c.id) && !reviewThreads(c).length && !canDismiss; // one I may dismiss keeps its own line, for its ⋯
        const units: (ConversationItem | ConversationItem[])[] = [];
        for (const c of items) {
          if ((c.bot && foldBots) || replaced.has(c.id)) continue; // bots below, behind one line; earlier verdicts under the later one
          const last = units.at(-1);
          if (bare(c) && Array.isArray(last)) last.push(c);
          else units.push(bare(c) ? [c] : c);
        }
        return units.map((u) => {
        if (Array.isArray(u) && u.length > 1)
          return (
            <div class="comment approvals" key={u[0].id}>
              <span class="rstate r-APPROVED"><Octicon name="check" /> Approved</span> by{' '}
              {u.map((c, k) => (
                <>
                  {k ? (k === u.length - 1 ? ' and ' : ', ') : ''}
                  <span id={'cv-' + c.id} title={new Date(c.at).toLocaleString()}>
                    <Avatar login={c.author} src={c.avatar} /> <b class="person-link" onClick={toPerson(c.author, repo)}>{shownName(c.author, repo)}</b>
                  </span>
                </>
              ))}
              {' · '}<Time at={u.at(-1)!.at} />
            </div>
          );
        const c = Array.isArray(u) ? u[0] : u;
        const head = (
          <>
            <Avatar login={c.author} src={c.avatar} /> <b class="person-link" onClick={toPerson(c.author, repo)} title={`@${c.author}`}>{shownName(c.author, repo)}</b> {c.state && <span class={'rstate r-' + c.state}><Tg i={STATE_ICON[c.state] ?? ''} t={STATE_LABEL[c.state] ?? c.state} /></span>}{' '}
            <a href={c.url} target="_blank" rel="noopener"><Time at={c.at} /></a> <CopyLink url={c.url} />
            {c.html && <AgentsMenu repo={repo} prUrl={pr.html_url} prompt={commentPrompt({ author: c.author, text: botExcerpt(c.html, 4000), url: c.url }, pr, repo)} />}
            <ReactPick id={c.node} />
            <CommentMenu
              id={c.node}
              review={canDismiss && (c.state === 'APPROVED' || c.state === 'CHANGES_REQUESTED') ? { who: c.author } : undefined}
              onEdit={c.body || c.id.startsWith('c') ? () => setEditingItem(c.id) : undefined}
              onDelete={c.id.startsWith('c') ? () => del(c) : undefined}
            />
          </>
        );
        const body = (
          <>
            {editingItem === c.id ? (
              <EditPosted body={c.body ?? ''} repo={repo} mentions={mentions} save={(b) => editPosted(c.node!, c.id.startsWith('c') ? 'comment' : 'review', b)} onDone={() => setEditingItem(null)} />
            ) : (
              c.html && <div class="md" data-lang={lang ?? ''} ref={(el) => void (el && highlightBlocks(el, lang))} dangerouslySetInnerHTML={{ __html: c.html }} />
            )}
            <Reactions id={c.node} />
            <ReviewThreads review={c} threads={threads} reveal={reveal} />
          </>
        );
        // Hidden on GitHub (off-topic, outdated…): folded to its first line, as GitHub shows it.
        const hidden = social(c.node)?.hidden;
        if (hidden)
          return (
            <details class="comment hidden-comment" key={c.id} id={'cv-' + c.id} data-url={c.url} data-social={c.node}>
              <summary>{head} <small class="hidden-why">hidden as {hidden}</small></summary>
              {body}
            </details>
          );
        const earlierOnes = earlier.get(c.id)?.map((id) => {
              const e = items.find((x) => x.id === id)!;
              const n = threads.filter((t) => t.comments.nodes.some((x) => x.pullRequestReview?.databaseId === Number(id.slice(1)))).length;
              return (
                <details class="earlier-verdict" key={id} id={'cv-' + id}>
                  <summary>
                    Earlier: <span class={'rstate r-' + e.state}><Tg i={STATE_ICON[e.state!] ?? ''} t={STATE_LABEL[e.state!] ?? e.state} /></span>{' '}
                    <Time at={e.at} />
                    {n > 0 && ` · ${n} comment${n === 1 ? '' : 's'} on the code`}
                  </summary>
                  {e.html && <div class="md" data-lang={lang ?? ''} ref={(el) => void (el && highlightBlocks(el, lang))} dangerouslySetInnerHTML={{ __html: e.html }} />}
                  <ReviewThreads review={e} threads={threads} reveal={reveal} />
                </details>
              );
            });
        // A review whose comments on the code are all resolved or outdated: folded to one line, its text a preview.
        const own = reviewThreads(c);
        if (c.html?.trim() && own.length && own.every((t) => t.isResolved || t.isOutdated))
          return (
            <details class="comment done-review" key={c.id} id={'cv-' + c.id} data-url={c.url} data-social={c.node}>
              <summary>
                {head} <span class="bot-excerpt">{botExcerpt(c.html)}</span>
                <small> · {own.length} thread{own.length === 1 ? '' : 's'}, all resolved or outdated</small>
              </summary>
              {body}
              {earlierOnes}
            </details>
          );
        return (
          <div class="comment" key={c.id} id={'cv-' + c.id} data-url={c.url} data-social={c.node}>
            {head}
            {body}
            {earlierOnes}
          </div>
        );
        });
      })()}
      {/* Bot reports (CI summaries, AI reviewers, coverage): all behind one line, each a line of its own inside; the
          index's jump to one opens them. */}
      {foldBots && items.some((c) => c.bot) && (
        <details class="bots-hidden">
          <summary><Octicon name="dependabot" /> {items.filter((c) => c.bot).length} comment{items.filter((c) => c.bot).length === 1 ? '' : 's'} from bots</summary>
          {/* One line per bot with more than one comment (a bot posting on every push), its comments newest first. */}
          {[...Map.groupBy(items.filter((c) => c.bot), (c) => c.author)].map(([author, list]) => {
            const one = (c: ConversationItem) => (
            <details class="comment bot" key={c.id} id={'cv-' + c.id} data-url={c.url}>
              <summary>
                <Avatar login={c.author} src={c.avatar} /> <b class="person-link" onClick={toPerson(c.author, repo)} title={`@${c.author}`}>{shownName(c.author, repo)}</b>{' '}
                <a href={c.url} target="_blank" rel="noopener"><Time at={c.at} /></a> <CopyLink url={c.url} />
                {c.html && <AgentsMenu repo={repo} prUrl={pr.html_url} prompt={commentPrompt({ author: c.author, text: botExcerpt(c.html, 4000), url: c.url }, pr, repo)} />}{' '}
                <span class="bot-excerpt">{botExcerpt(c.html)}</span>
              </summary>
              {c.html && <div class="md" data-lang={lang ?? ''} ref={(el) => void (el && highlightBlocks(el, lang))} dangerouslySetInnerHTML={{ __html: c.html }} />}
            </details>
            );
            if (list.length === 1) return one(list[0]);
            const newest = list.toSorted((a, b) => b.at.localeCompare(a.at));
            return (
              <details class="bot-group" key={author}>
                <summary>
                  <Avatar login={author} src={list[0].avatar} /> <b>{shownName(author, repo)}</b> · {list.length} comments · latest <Time at={newest[0].at} />
                </summary>
                {newest.map(one)}
              </details>
            );
          })}
        </details>
      )}
    </details>
  );
}

function Help({ onClose, ignoreWs, toggleWs }: { onClose: () => void; ignoreWs: boolean; toggleWs: () => void }) {
  useDismiss(true, onClose, '.help, .help-btn');
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
      <p class="note">Change them in Settings → Keyboard shortcuts.</p>
    </div>
  );
}

// Drafts written on an older commit, moved onto the head where their lines are unchanged (diff.ts relocate). A
// comment on the base side stays if the base didn't move and its lines are still in the diff. `stuck`: how many
// couldn't move (then all of them go on the older commit, together).
async function moveDrafts(repo: string, n: number, drafts: Draft[], from: string, was: PR, now: PR): Promise<{ moved: Draft[]; stuck: number }> {
  const files = await getFiles(repo, n).catch(() => [] as PRFile[]);
  const src = now.head.repo?.full_name ?? repo;
  const text = new Map<string, Promise<string[] | null>>();
  const lines = (sha: string, path: string) => {
    if (!text.has(sha + path)) text.set(sha + path, getRaw(src, path, sha).then((t) => t?.split('\n') ?? null, () => null));
    return text.get(sha + path)!;
  };
  const moved = await Promise.all(
    drafts.map(async (d): Promise<Draft | null> => {
      const f = files.find((f) => f.filename === d.path);
      if (!f) return null;
      if (!d.line) return d; // on the file
      const hunks = parsePatch(f.patch ?? '');
      if (d.side === 'LEFT') {
        const old = new Set(hunks.flatMap((h) => h.lines.flatMap((l) => l.old ?? [])));
        return was.base.sha === now.base.sha && old.has(d.line) && (!d.startLine || old.has(d.startLine)) ? d : null;
      }
      const [a, b] = await Promise.all([lines(from, d.path), lines(now.head.sha, d.path)]);
      const at = a && b && relocate(a, b, hunks, d.startLine ?? d.line, d.line);
      return at ? { ...d, line: at.line, startLine: at.startLine } : null;
    }),
  );
  return { moved: moved.filter((d): d is Draft => !!d), stuck: moved.filter((d) => !d).length };
}
