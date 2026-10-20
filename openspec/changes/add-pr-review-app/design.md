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
- PR sidebar: one GraphQL query with two searches, `review-requested:@me` and `reviewed-by:@me -author:@me` (GitHub drops a PR from the first once you review it), each with `latestReviews` to find my latest verdict and `reviewDecision` for the PR's overall state. Grouping: currently requested → *Needs your review* (re-requests flagged); otherwise by my latest review → *Changes requested* / *Commented* / *Approved*. Refreshed after submitting a review.
- Conversation: `GET …/issues/{n}/comments` + `GET …/pulls/{n}/reviews` (reviews with a body or a verdict), merged by time.
- Comment bodies (conversation, PR description, review threads) use GitHub's own rendering (`full+json` → `body_html`; GraphQL `bodyHTML`): already sanitized, hidden `<!-- -->` markers removed, and `<details>`/`<sub>` from bots render as on github.com.

### 4. Scrolling performance without a virtualization library
Each file is a `<section>` with `content-visibility: auto; contain-intrinsic-size: auto 600px`. The browser skips layout/paint for off-screen files natively. Patches are parsed into lines eagerly (cheap); markdown file contents are fetched lazily via `IntersectionObserver` when a section nears the viewport. Fallback if this measurably fails on 3000-file PRs: windowed rendering.

### 5. Markdown rich diff with line comments
- Render the **head** version with `markdown-it`. Raw HTML is parsed but rendered escaped, so no HTML from PR content reaches the DOM; HTML comments are dropped, as on GitHub.
- Override block renderer rules so every block token with a `map` emits `data-src="start-end"` (1-based head lines). That gives paragraph / list-item / table-row / heading / fence granularity for free; the innermost `[data-src]` under the cursor is the comment target.
- From the patch, compute `added` (head lines with `+`) and `commentable` (head lines inside any hunk). Blocks intersecting `added` get a "changed" highlight (CSS `:has()` keeps it on the innermost block). Every run of `-` lines inserts a "removed" marker before the block at that head position, showing the deleted source struck through; the marker has its own button for LEFT-side comments.
- Comment on a block → multi-line review comment on `RIGHT`, `start_line`/`line` = block range clamped to `commentable`. Block entirely outside hunks → file-level comment prefixed with a `>` quote of the block's first line; the form opens in place, the saved draft lives at the file top.
- Existing `RIGHT` threads render after the top-level block containing `line` (markdown-it output is split into top-level chunks so Preact can interleave threads); `LEFT` threads attach to the nearest removed marker, else the file header.
- Added file: no "changed" tint (every block is new, so it would only add noise). Deleted or renamed-without-content markdown: source diff only.
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

### 11. Slack DM on submit
Optional, off until `~/.config/lgtm/config.json` has a `slackToken` (a Slack user token, so DMs come from you). After a successful submit, the page sends `{recipients: [{login, emails}], text}` to the local server's `POST /slack`; the server maps each person to a Slack user (config `slackUsers` first, then `users.lookupByEmail`), opens a DM, and posts. Emails come from GitHub's `organizationVerifiedDomainEmails` for the repo's org, then the public email. The token stays in the server; `/slack` has the same Host and `Sec-Fetch-Site: same-origin` guards as `/token`, and validates the body. A Slack failure is reported next to the submitted review, never undoes it. A remembered checkbox in the submit panel turns it off per review.

### 12. Stack
TypeScript, Vite, Preact, markdown-it, highlight.js; the server is plain Node. Hunk parsing and glob matching are hand-written (~50 lines each) rather than pulled in as deps.

## Risks / Trade-offs

- Requires the GitHub CLI; people without `gh` can't use it. If teammates need it, revive the extension with an OAuth App (git history).
- Root-only `.gitattributes` misses nested ones → acceptable for v1; add per-directory lookup if users hit it.
- Head moves during review → on submit, compare current head SHA; if changed, warn and submit against the drafted SHA (GitHub marks comments outdated rather than failing).
- Rendered-block ↔ line mapping is block-granular; a 40-line paragraph can only be commented as a whole → toggle to source diff for precise lines.

## Open Questions

- Should hidden generated files be revealable (current plan: one "N hidden — show" row) or fully invisible?
