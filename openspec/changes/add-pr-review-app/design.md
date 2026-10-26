## Context

Greenfield repo. Goal: a faster PR review surface for GitHub with markdown-first, rich-by-default rendering and generated files out of the way. Asked for "macOS app / Firefox extension". v1 shipped as a Firefox/Chrome extension, then moved to a local app (Decision 1) once it was clear the extension added little over a token-based web page.

## Goals / Non-Goals

**Goals:** fast first paint on large PRs, one continuous scroll, markdown reviewed as rendered prose but commentable by line, generated files hidden, full review round-trip (read threads, draft, submit).

**Non-Goals:** macOS shell, viewed-state sync, suggestion blocks, GHE, offline mode.

## Decisions

### 1. Local app: a tiny server on 127.0.0.1, the UI in your own browser
`lgtm [PR URL]` (`bin/lgtm.mjs`, Node standard library only) serves the built page on `http://127.0.0.1:4517` and opens it in the default browser. api.github.com allows CORS from any origin, so the page calls GitHub directly; the server only serves files and the token.
*Why not the extension:* with no OAuth App it fell back to a pasted PAT, so the extension's only real benefit (device-flow sign-in, which needs an extension or server because `github.com/login/*` has no CORS) wasn't used, while it cost Mozilla signing and per-browser packaging. The extension version is in git history (`570c939`).
*Why not a native macOS app:* same UI either way (it would be a WebView), plus Swift/Tauri packaging. The page has no platform APIs outside `src/platform.ts`, so a shell can still wrap it later.
*Alternative considered:* fork or extend Refined GitHub. Rejected: it patches github.com's DOM, and the core features here (one fast scroll, reordering files, commentable rich markdown) would mean fighting GitHub's own diff UI, which is the slow part we want to leave. Upstream is "highly opinionated" with "a high bar for adding features".

### 2. Auth: the GitHub CLI's login
The server runs `gh auth token` per request to `/token` (so `gh auth login`/`switch` apply on reload) and refuses to start if gh isn't signed in. The page keeps the token in memory only. Guards on `/token`: listen on 127.0.0.1 only; reject any `Host` other than `127.0.0.1:PORT`/`localhost:PORT` (DNS rebinding); require `Sec-Fetch-Site: same-origin` (other sites can't read it, and no CORS headers are sent). A `401` from GitHub shows "run `gh auth login`, then reload".
The port is fixed (override with `LGTM_PORT`) because drafts live in `localStorage`, which is per origin. A second `lgtm` reuses the running server.

### 3. Data access
- PR meta: `GET /repos/{o}/{r}/pulls/{n}` (head/base SHA, title, body).
- Files + patches: `GET …/pulls/{n}/files?per_page=100`, paginated (API caps at 3000 files). Files with no `patch` (too large/binary) render as a "too large — open on GitHub" row.
- Threads: GraphQL `pullRequest.reviewThreads` (path, line, startLine, diffSide, isResolved, isOutdated, comments). REST `/pulls/{n}/comments` lacks resolved state.
- Raw file content (for markdown rendering and `.gitattributes`): `GET /repos/{o}/{r}/contents/{path}?ref={sha}` with `Accept: application/vnd.github.raw`.
- Submit: GraphQL `addPullRequestReview` (pending, at the drafts' commit) → `addPullRequestReviewThread` per draft (`subjectType: LINE|FILE`) → `submitPullRequestReview`. REST `POST …/reviews` can't carry file-level comments. On any failure the pending review is deleted (`deletePullRequestReview`) so a retry isn't blocked, and drafts are kept. Reply: `POST …/pulls/{n}/comments/{id}/replies`.
- PR sidebar: one GraphQL query with two searches, `review-requested:@me` and `reviewed-by:@me -author:@me` (GitHub drops a PR from the first once you review it), each with `latestReviews` to find my latest verdict and `reviewDecision` for the PR's overall state. Grouping: currently requested → *Needs your review* (re-requests flagged); otherwise by my latest review → *Changes requested* / *Commented* / *Approved*. Refreshed after submitting a review. Two more searches (`author:@me`, `assignee:@me`) fill a "Your PRs" section grouped by `reviewDecision` and draft state; an assigned PR that's in my review queue stays there only.
- Conversation: `GET …/issues/{n}/comments` + `GET …/pulls/{n}/reviews` (reviews with a body or a verdict), merged by time.
- Comment bodies (conversation, PR description, review threads) use GitHub's own rendering (`full+json` → `body_html`; GraphQL `bodyHTML`): already sanitized, hidden `<!-- -->` markers removed, and `<details>`/`<sub>` from bots render as on github.com.

### 4. Scrolling performance without a virtualization library
Each file is a `<section>` with `content-visibility: auto; contain-intrinsic-size: auto 600px`. The browser skips layout/paint for off-screen files natively. Patches are parsed into lines eagerly (cheap); markdown file contents are fetched lazily via `IntersectionObserver` when a section nears the viewport. Fallback if this measurably fails on 3000-file PRs: windowed rendering.

### 5. Markdown rich diff with line comments
- Render the **head** version with `markdown-it`. Raw HTML is parsed but rendered escaped, so no HTML from PR content reaches the DOM; HTML comments are dropped, as on GitHub.
- Override block renderer rules so every block token with a `map` emits `data-src="start-end"` (1-based head lines). That gives paragraph / list-item / table-row / heading / fence granularity for free; the innermost `[data-src]` under the cursor is the comment target.
- From the patch, compute `added` (head lines with `+`) and `commentable` (head lines inside any hunk). Blocks intersecting `added` get a "changed" highlight (CSS `:has()` keeps it on the innermost block). Every run of `-` lines inserts a "removed" marker before the block at that head position, showing the deleted source struck through; the marker has its own button for LEFT-side comments.
- Comment on a block → multi-line review comment on `RIGHT`, `start_line`/`line` = block range clamped to `commentable`. Like a code diff, only the diff is shown: top-level sections with no line in a hunk fold into "Show N unchanged sections" rows (kept open when they hold a comment), and anything outside the hunks (`data-nd`) has no gutter. This replaced an earlier fallback that posted such comments file-level with a quote of the block.
- Comments (threads, drafts, the form) render right under the deepest block covering their line: each top-level chunk is raw HTML, and Preact renders the comments into host elements inserted into it (under a list item's own text, in a new `<tr>` after a row, after a code line, otherwise after the block). Lines between blocks fall back to after the chunk. Fenced code renders each line as its own `data-src` span so code is commentable per line; `LEFT` threads attach to the nearest removed marker, else the file header.
- Added file: no "changed" tint (every block is new, so it would only add noise). Deleted or renamed-without-content markdown: source diff only.
- ```mermaid fences render as diagrams (mermaid 11, `securityLevel: 'strict'` since the source is PR content, theme follows light/dark, loaded only when a page has a diagram; GitHub's own mermaid markup in comment HTML is redrawn the same way). In a diffed file the diagram block is commentable as a whole and keeps its source collapsed below for per-line comments.
- YAML front matter is shown as a code block; its lines are blanked for markdown-it so line numbers stay aligned.
- Relative images are not resolved (private repos need auth); alt text shown. Per-file toggle switches to the normal source diff.

### 6. linguist-generated detection
Fetch root `.gitattributes` at head SHA. Parse each line into `pattern` + attrs; `linguist-generated` / `linguist-generated=true` sets, `-linguist-generated` / `linguist-generated=false` unsets; last matching line wins (git semantics). Pattern → RegExp: no `/` → matches basename at any depth; contains `/` → anchored to root; `*` = `[^/]*`, `**` = any depth, `?` = `[^/]`. Only the explicit attribute counts — Linguist's built-in heuristics (lockfiles, `*.min.js`) are out of scope.

### 7. Drafts survive reloads
Draft comments live in `localStorage` under `drafts:{owner}/{repo}#{n}` together with the head SHA they were written on, and are cleared only after a successful submit. Keying by PR (not SHA) means a push mid-review can't hide them. Losing a half-written review is the worst failure this tool can have.

### 8. Syntax highlighting
highlight.js `common` bundle (+ Dockerfile), language from extension or basename. Each hunk side (head = context + added, base = context + removed) is highlighted as one block, then split into lines with spans re-opened across line breaks, so multi-line strings and comments stay colored. Markdown fences use the same highlighter. Tokens are colored with CSS variables (GitHub palette, light and dark). Shiki was the alternative: better grammars but far heavier.

### 9. File tree and line comments
The sidebar groups files into folders, collapsing single-child chains (`src/core/utils`) like GitHub; native `<details>` handles collapsing. Files show a status dot and a thread/draft count. Code lines get a GitHub-style hover `+` (a CSS pseudo-element on the line-number cell, so no per-line DOM).

### 10. PR stacks
A PR is stacked on another when its `baseRefName` equals the other's `headRefName` and its repo equals the other's head repo (so forks don't link by accident). Chains are found among the sidebar's PRs only, ordered bottom → top; a stack sits in the group of its most urgent layer (needs review > changes requested > commented > approved), and each layer keeps its own status color. A layer missing from your list splits the stack; fetching outside PRs wasn't worth an extra query per stack.

### 11. Slack DM on submit, via slackcli
Optional: available when [slackcli](https://github.com/shaharia-lab/slackcli) is installed and `slackcli auth whoami` succeeds. slackcli owns the Slack sign-in (`auth login-auto` captures your browser session), so there's no Slack app, admin approval, or token in lgtm, and DMs come from you. After a successful submit the page posts `{recipients: [{login, emails}], text}` to the local server's `POST /slack`; for each person the server tries the mapping in `~/.config/lgtm/config.json`, then their GitHub emails, running `slackcli messages send --recipient-id=<target> --message-file - --json` (text on stdin, so no shell or argument parsing of content). Targets must look like a user ID, `@handle` or email, which also keeps them from being read as flags. Errors come from slackcli's one-line JSON error on stderr. `/slack` has the same Host and `Sec-Fetch-Site: same-origin` guards as `/token` and validates the body. Each PR keeps one DM thread per person: the server stores `{channel, ts}` from slackcli's `--json` output in `~/.config/lgtm/slack-threads.json` (keyed `owner/repo#n:login`, written atomically) and later reviews post with `--thread-ts`; if that fails (thread deleted), it sends a fresh DM and stores the new thread. A Slack failure is reported next to the submitted review, never undoes it; a remembered checkbox turns it off per review. `LGTM_SLACK_DRY_RUN=1` adds `--dry-run`.
*Alternative tried first:* calling Slack's Web API with a user token from a self-made Slack app; replaced because it needed an app install (likely admin approval) and a token in a config file.
Emails come from GitHub's `organizationVerifiedDomainEmails`, then the public email; for bukuwarung both are empty, so the mapping is what works. Each user builds theirs in Settings → Slack people (a lookup by email, then name, confirmed per person) into `~/.config/lgtm/config.json` `slackUsers`. An earlier committed team file (`app/slack-users.json`) was dropped in favour of this.

### 12. PR Shortcut Index and resizable columns
The file-tree column became an index of everything worth jumping to, in collapsible sections: Conversation (description, each comment and review), Checks (GraphQL `statusCheckRollup` on the head commit: Actions runs and commit statuses, failures → running → passed; cancelled/skipped copies of re-run checks are hidden; each links to its run; refreshable), Review threads (pending drafts first, then threads in diff order, resolved/outdated dimmed), and Files (the tree). A jump scrolls the file into view first when the target isn't rendered yet (lazy file bodies), waits up to 2 s for it, opens any collapsed `<details>` around it, and flashes it; `scroll-margin-top` keeps targets below the sticky bars.
Both sidebars have a drag handle (pointer capture, no library) that sets `--prs-w` / `--index-w` on `<html>`, which the grids read; widths persist in `localStorage`. The handle is a focusable `role="separator"` (arrow keys resize) and double-click resets.

### 13. Review flow improvements
- **Viewed:** GraphQL `viewerViewedState` / `markFileAsViewed` / `unmarkFileAsViewed`, so the state is GitHub's own and carries over to github.com. Optimistic toggle, rolled back on error. Viewed files collapse (a row expands them) and the index shows "N/M viewed".
- **Since my last review:** the commit of my latest submitted review (REST reviews) vs. head via the compare API, limited to files in the PR (after a rebase the comparison also contains the base branch's changes); `status: diverged` shows a warning. On by default when such a commit exists. Old-side threads and comments are off in this mode, because its old side is my last reviewed commit, not the PR base.
- **Stack navigation:** walk open PRs by branch: down while some PR's head is our base, up while exactly one PR is based on our head (≤10 layers; forks and branching stacks stop the walk). `[`/`]` move.
- **Show more lines:** `gaps()` computes the unchanged new-file ranges before, between and after hunks plus the old-line offset (zero-length hunk headers point at the line *before* the hunk). Lines come from the head file, fetched on first expand, and aren't commentable.
- **Keyboard:** one window listener, reassigned each render so it sees current state; ignored while typing. `⌘F` turns off lazy rendering for all files so the browser's find covers the whole PR.
- **Threads and drafts:** `resolveReviewThread` / `unresolveReviewThread` (per `viewerCanResolve`); drafts edit in place through the same comment form.
- **Live queue:** the sidebar refetches every 3 minutes; the tab title shows the waiting count; optional desktop notifications (permission asked on the 🔔 click) for review requests that appear after the page opened.
- **Failing job logs:** `GET /job-log` on the local server runs `gh api …/actions/jobs/{id}/logs` (the API redirects to storage the page can't read cross-origin), strips terminal escape codes and timestamps, and returns up to 60 lines ending at the last `##[error]`. Same-origin guard as `/token`; repo and job id are validated. Only GitHub Actions checks (`checkSuite.app.slug`) have a job id; Jenkins and other statuses just link out.

### 14. Comment editor
One `Editor` component for line comments, replies, and the review summary. Preview uses GitHub's `POST /markdown` (gfm, repo context) so it matches the posted result; emoji come from `GET /emojis` (cached; also used to draw `:shortcodes:` in locally rendered pending drafts); mentions are the PR's author, assignees, requested reviewers, and commenters. Completion triggers on `:xx`/`@x` before the caret (list under the textarea, arrows + Enter/Tab). "Suggest" inserts a ```suggestion block with the target's head-side lines, taken from the patch (commentable lines are always in a hunk). Toolbar buttons act on mousedown so the textarea keeps its selection.

### 15. Stack
TypeScript, Vite, Preact, markdown-it, highlight.js; the server is plain Node. Hunk parsing and glob matching are hand-written (~50 lines each) rather than pulled in as deps.

## Risks / Trade-offs

- Requires the GitHub CLI; people without `gh` can't use it. If teammates need it, revive the extension with an OAuth App (git history).
- Root-only `.gitattributes` misses nested ones → acceptable for v1; add per-directory lookup if users hit it.
- Head moves during review → on submit, compare current head SHA; if changed, warn and submit against the drafted SHA (GitHub marks comments outdated rather than failing).
- Rendered-block ↔ line mapping is block-granular; a 40-line paragraph can only be commented as a whole → toggle to source diff for precise lines.

## Open Questions

- Should hidden generated files be revealable (current plan: one "N hidden — show" row) or fully invisible?
