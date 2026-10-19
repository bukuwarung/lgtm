## Context

Greenfield repo. Goal: a faster PR review surface for GitHub with markdown-first, rich-by-default rendering and generated files out of the way. Asked for "macOS app / Firefox extension"; v1 is a browser extension for Firefox and Chrome.

## Goals / Non-Goals

**Goals:** fast first paint on large PRs, one continuous scroll, markdown reviewed as rendered prose but commentable by line, generated files hidden, full review round-trip (read threads, draft, submit).

**Non-Goals:** macOS shell, viewed-state sync, suggestion blocks, GHE, offline mode.

## Decisions

### 1. Browser extension first, not a macOS app
An extension page gets cross-origin `fetch` to GitHub via host permissions (no CORS proxy, no backend), ships via AMO and the Chrome Web Store, and is plain HTML/TS. A native app would need its own networking, auth storage, and a markdown renderer anyway (likely a WebView). The UI is a single web page with no extension-only APIs outside `src/platform.ts` (storage + open-tab), so a WKWebView/Tauri wrapper later only replaces that file.
*Alternative considered:* fork or extend Refined GitHub. Rejected: it patches github.com's DOM, and the core features here (one fast scroll, reordering files, commentable rich markdown) would mean fighting GitHub's own diff UI, which is the slow part we want to leave. Upstream is "highly opinionated" with "a high bar for adding features", so a fork would have to be rebased against 300+ features indefinitely. The two extensions can be installed side by side.

### 2. Auth: GitHub OAuth App device flow (PAT fallback)
`POST github.com/login/device/code` → show user code + link → poll `login/oauth/access_token`. No client secret, no redirect URI, works from an extension. Scope `repo` (needed to comment on private repos). Token in `storage.local`; sign-out deletes it. Any `401` from the API drops the token and returns to sign-in. A pasted personal access token is accepted as a fallback (no OAuth App yet, or orgs that block OAuth apps).
*Alternative considered:* GitHub App (fine-grained, per-repo) — better permissions story but requires an org install; revisit if orgs block OAuth apps.

### 3. Data access
- PR meta: `GET /repos/{o}/{r}/pulls/{n}` (head/base SHA, title, body).
- Files + patches: `GET …/pulls/{n}/files?per_page=100`, paginated (API caps at 3000 files). Files with no `patch` (too large/binary) render as a "too large — open on GitHub" row.
- Threads: GraphQL `pullRequest.reviewThreads` (path, line, startLine, diffSide, isResolved, isOutdated, comments). REST `/pulls/{n}/comments` lacks resolved state.
- Raw file content (for markdown rendering and `.gitattributes`): `GET /repos/{o}/{r}/contents/{path}?ref={sha}` with `Accept: application/vnd.github.raw`.
- Submit: GraphQL `addPullRequestReview` (pending, at the drafts' commit) → `addPullRequestReviewThread` per draft (`subjectType: LINE|FILE`) → `submitPullRequestReview`. REST `POST …/reviews` can't carry file-level comments. On any failure the pending review is deleted (`deletePullRequestReview`) so a retry isn't blocked, and drafts are kept. Reply: `POST …/pulls/{n}/comments/{id}/replies`.
- PR sidebar: one GraphQL query with two searches, `review-requested:@me` and `reviewed-by:@me -author:@me` (GitHub drops a PR from the first once you review it), each with `latestReviews` to find my latest verdict and `reviewDecision` for the PR's overall state. Grouping: currently requested → *Needs your review* (re-requests flagged); otherwise by my latest review → *Changes requested* / *Commented* / *Approved*. Refreshed after submitting a review.
- Conversation: `GET …/issues/{n}/comments` + `GET …/pulls/{n}/reviews` (reviews with a body or a verdict), merged by time.

### 4. Scrolling performance without a virtualization library
Each file is a `<section>` with `content-visibility: auto; contain-intrinsic-size: auto 600px`. The browser skips layout/paint for off-screen files natively. Patches are parsed into lines eagerly (cheap); markdown file contents are fetched lazily via `IntersectionObserver` when a section nears the viewport. Fallback if this measurably fails on 3000-file PRs: windowed rendering.

### 5. Markdown rich diff with line comments
- Render the **head** version with `markdown-it` (`html: false` — no raw HTML from PR content reaches the DOM).
- Override block renderer rules so every block token with a `map` emits `data-src="start-end"` (1-based head lines). That gives paragraph / list-item / table-row / heading / fence granularity for free; the innermost `[data-src]` under the cursor is the comment target.
- From the patch, compute `added` (head lines with `+`) and `commentable` (head lines inside any hunk). Blocks intersecting `added` get a "changed" highlight (CSS `:has()` keeps it on the innermost block). Every run of `-` lines inserts a "removed" marker before the block at that head position, showing the deleted source struck through; the marker has its own button for LEFT-side comments.
- Comment on a block → multi-line review comment on `RIGHT`, `start_line`/`line` = block range clamped to `commentable`. Block entirely outside hunks → file-level comment prefixed with a `>` quote of the block's first line; the form opens in place, the saved draft lives at the file top.
- Existing `RIGHT` threads render after the top-level block containing `line` (markdown-it output is split into top-level chunks so Preact can interleave threads); `LEFT` threads attach to the nearest removed marker, else the file header.
- Added file: no "changed" tint (every block is new, so it would only add noise). Deleted or renamed-without-content markdown: source diff only.
- YAML front matter is shown as a code block; its lines are blanked for markdown-it so line numbers stay aligned.
- Relative images are not resolved (private repos need auth); alt text shown. Per-file toggle switches to the normal source diff.

### 6. One build for Firefox and Chrome
No per-browser builds and no `webextension-polyfill`:
- **Namespace:** `const ext = globalThis.browser ?? chrome` in `platform.ts`. Both browsers return promises from MV3 APIs, so nothing else differs.
- **Background:** a single manifest declares both `background.service_worker` (Chrome) and `background.scripts` (Firefox); each browser ignores the key it doesn't use (Chrome 121+, Firefox 121+). The script only handles `action.onClicked` and `runtime.onInstalled` (opens the page after install so Firefox users hit the grant button immediately), so it is stateless and fine as either a service worker or an event page.
- **Host permissions:** Chrome grants them at install; Firefox may leave MV3 host permissions ungranted. The sign-in screen checks `permissions.contains` and, if missing, shows a "Grant GitHub access" button that calls `permissions.request` (must be from a user click).
- **Manifest:** `browser_specific_settings.gecko.id` is required by Firefox; Chrome ignores it with a warning.
- **CSS:** `content-visibility: auto` needs Firefox 125+ / Chrome 85+. Minimum versions: Firefox 128 ESR, Chrome 121.

### 7. linguist-generated detection
Fetch root `.gitattributes` at head SHA. Parse each line into `pattern` + attrs; `linguist-generated` / `linguist-generated=true` sets, `-linguist-generated` / `linguist-generated=false` unsets; last matching line wins (git semantics). Pattern → RegExp: no `/` → matches basename at any depth; contains `/` → anchored to root; `*` = `[^/]*`, `**` = any depth, `?` = `[^/]`. Only the explicit attribute counts — Linguist's built-in heuristics (lockfiles, `*.min.js`) are out of scope.

### 8. Drafts survive reloads
Draft comments live in `storage.local` under `drafts:{owner}/{repo}#{n}` together with the head SHA they were written on, and are cleared only after a successful submit. Keying by PR (not SHA) means a push mid-review can't hide them. Losing a half-written review is the worst failure this tool can have.

### 9. Syntax highlighting
highlight.js `common` bundle (+ Dockerfile), language from extension or basename. Each hunk side (head = context + added, base = context + removed) is highlighted as one block, then split into lines with spans re-opened across line breaks, so multi-line strings and comments stay colored. Markdown fences use the same highlighter. Tokens are colored with CSS variables (GitHub palette, light and dark). Shiki was the alternative: better grammars but far heavier.

### 10. File tree and line comments
The sidebar groups files into folders, collapsing single-child chains (`src/core/utils`) like GitHub; native `<details>` handles collapsing. Files show a status dot and a thread/draft count. Code lines get a GitHub-style hover `+` (a CSS pseudo-element on the line-number cell, so no per-line DOM).

### 11. Stack
TypeScript, Vite, Preact, markdown-it, highlight.js, web-ext. Hunk parsing and glob matching are hand-written (~50 lines each) rather than pulled in as deps.

## Risks / Trade-offs

- Orgs with OAuth app access restrictions will block the token until an admin approves → document; GitHub App path (Decision 2 alt).
- Root-only `.gitattributes` misses nested ones → acceptable for v1; add per-directory lookup if users hit it.
- Head moves during review → on submit, compare current head SHA; if changed, warn and submit against the drafted SHA (GitHub marks comments outdated rather than failing).
- Rendered-block ↔ line mapping is block-granular; a 40-line paragraph can only be commented as a whole → toggle to source diff for precise lines.

## Open Questions

- Should hidden generated files be revealable (current plan: one "N hidden — show" row) or fully invisible?
