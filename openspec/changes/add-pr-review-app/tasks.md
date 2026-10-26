## 1. Scaffold

- [x] 1.1 `extension/` with Vite + TypeScript + Preact, one MV3 `manifest.json` for both browsers (`service_worker` + `scripts` background, `gecko.id`, host permissions `github.com`, `api.github.com`; `storage`, `tabs`)
- [x] 1.2 Toolbar button opens `review.html`, passing the active tab URL if it is a PR
- [x] 1.3 `src/platform.ts`: storage get/set/remove + open tab via `globalThis.browser ?? chrome` (only file touching extension APIs)
- [x] 1.4 `web-ext run` (Firefox) and `web-ext run --target chromium` scripts; `web-ext build` produces the zip for both stores

## 2. GitHub auth

- [x] 2.1 ~~Register OAuth App~~ superseded by 9 (gh CLI login)
- [x] 2.2 Device flow: request code, show code + link, poll honoring `interval`/`slow_down`/`expired_token`
- [x] 2.3 Host-permission check + "Grant GitHub access" button when missing (Firefox)
- [x] 2.4 Token storage, sign-out, `401` → signed-out (drafts untouched)
- [x] 2.5 `api.ts`: REST + GraphQL fetch wrapper with auth header and pagination via `Link`

## 3. PR inbox and loading

- [x] 3.1 Inbox from search `review-requested:@me`; open-by-URL input
- [x] 3.2 Load PR meta, all file pages, review threads (GraphQL)

## 4. Scrolling diff view

- [x] 4.1 Hunk parser (`@@` headers → typed lines with old/new line numbers) + check
- [x] 4.2 File sections with sticky headers, `content-visibility: auto`, outline sidebar with jump
- [x] 4.3 Placeholder row for files without `patch`
- [x] 4.4 Inline threads (collapsed when resolved/outdated) and reply

## 5. Generated filter

- [x] 5.1 `.gitattributes` parser + glob→RegExp, last-match-wins + check covering spec scenarios
- [x] 5.2 Fetch root `.gitattributes` at head; hide matches; "N generated files hidden" reveal row

## 6. Markdown rich diff

- [x] 6.1 Sort markdown files first
- [x] 6.2 Lazy-fetch head content on near-viewport; render with markdown-it (`html: false`), `data-src` ranges on block tokens
- [x] 6.3 Changed-block highlight from added lines; removed-only markers
- [x] 6.4 Block → comment anchor (clamp to hunk lines, file-level fallback) + check
- [x] 6.5 Place existing threads on innermost containing block; LEFT threads on removed marker/header
- [x] 6.6 Per-file rich/source toggle

## 7. Review drafting and submit

- [x] 7.1 Draft line / range / file comments in both views; persist under `drafts:{repo}#{n}` with the head SHA
- [x] 7.2 Submit dialog (body + Comment/Approve/Request changes); clear drafts only on success; show GitHub error on failure
- [x] 7.3 Head-moved warning before submit

## 8. Review feedback round 1

- [x] 8.1 PR sidebar: requested + reviewed-by-me searches, grouped by my latest review, re-request and overall-decision pills, refresh after submit
- [x] 8.2 File tree with collapsed single-child folders and comment counts
- [x] 8.3 Conversation section (description, comments, reviews)
- [x] 8.4 Syntax highlighting for diffs and markdown fences (+ check)
- [x] 8.5 Hover "+" on code lines
- [x] 8.6 No "changed" tint on added markdown files

## 9. Local app instead of extension

- [x] 9.1 `bin/lgtm.mjs`: serve `dist/` on 127.0.0.1:4517, `/token` from `gh auth token` with Host + Sec-Fetch-Site guards, reuse a running instance, open the browser (optional PR URL argument)
- [x] 9.2 `platform.ts` → `localStorage` + `fetchToken`; remove manifest, background script, host-permission and sign-in screens, device flow, web-ext
- [x] 9.3 Check guards with curl; load a real PR against live GitHub

## 10. Review feedback round 2

- [x] 10.1 Collapsible file tree (remembered)
- [x] 10.2 Group stacked PRs in the sidebar (`findStacks` + check)
- [x] 10.3 Slack DM on submit: `/slack` endpoint (config token, email lookup, mapping, validation), submit-panel checkbox, result notice; checked against Slack's API with a fake token

- [x] 10.4 Switch Slack sending to slackcli (no Slack app/token); dry-run checked against the real workspace
- [x] 10.5 Commit the team GitHub → Slack mapping (`app/slack-users.json`); README setup for gh + slackcli

## 11. Review feedback round 3

- [x] 11.1 Drag-resizable PR list and index columns (remembered, keyboard, double-click reset)
- [x] 11.2 PR Shortcut Index: conversation, checks, review threads, files; jump with lazy-render wait
- [x] 11.3 Hide draft PRs in the sidebar by default (remembered toggle)

## 12. Improvement round

- [x] 12.1 Viewed state synced with GitHub; collapse + N/M viewed
- [x] 12.2 Keyboard shortcuts + help; ⌘F renders all files
- [x] 12.3 Resolve/unresolve threads; edit pending drafts
- [x] 12.4 Stack navigation (‹ Layer n/N ›, [ ])
- [x] 12.5 Changes since my last review (compare, PR files only, rebase warning)
- [x] 12.6 Show more lines (`gaps()` + check)
- [x] 12.7 Live queue: 3-minute refresh, title count, desktop notifications
- [x] 12.8 Failed GitHub Actions job log excerpt via `/job-log`
- [x] 12.9 One Slack thread per PR and person (`slack-threads.json`, fallback to a new DM)
- [x] 12.10 "Your PRs" sidebar section (authored/assigned), own drafts always visible
- [x] 12.11 Hide renamed/copied/mode-only files without content changes by default
- [x] 12.12 Space comments at the hovered (or top-of-view) line
- [x] 12.13 Per-line comments in code blocks; comments render under their list item / table row / code line
- [x] 12.14 Mermaid diagrams in markdown files and comments (lazy-loaded, strict mode)
- [x] 12.15 Rich diff shows only sections in the diff; others fold, read-only; quote fallback removed; unmarked fences = Kotlin
- [x] 12.16 Comment editor: GitHub preview, :emoji:/@mention completion, toolbar + shortcuts, Suggest
- [x] 12.17 Merge box on my PRs (status + reasons, ready for review, update branch, merge/auto-merge, admin bypass) and merge pills in "Your PRs"
- [x] 12.18 Deleted files collapse to one row until shown (expanded if they carry line comments)
- [x] 12.19 Every comment (description, conversation, review threads) links to github.com and has a copy-link button
- [x] 12.20 Open review threads drop the header row; "Reviewing" and "Your PRs" are tabs (choice remembered)
- [x] 12.21 Checks: one entry per check (latest run wins); failing/running listed, passed and skipped folded into groups
- [x] 12.22 Queue: CI failing / conflicts / size / unsent comments / awaiting-your-reply pills
- [x] 12.23 Word-level highlights (CSS Custom Highlight API), moved-code dimming, ignore-whitespace toggle (w)
- [x] 12.24 Reading order (tests after their source), resume position, changed-since-last-visit badges
- [x] 12.25 Bot comments folded; Jira ticket box via `acli` (`/jira`)
- [x] 12.26 Kotlin/Java import blocks fold to one row naming packages new to the file
- [x] 12.27 Submit panel says why there's no Slack option; PR page links to its Slack threads (permalinks via `slackcli team info`)
- [x] 12.28 PRs whose threads I'm in are all resolved move back to "Needs your review"
- [x] 12.29 Kotlin highlighting closer to IntelliJ (properties, named args, `it`, constants; plain types, yellow annotations)
- [x] 12.30 Index: bot conversation posts folded; review threads tiered (mine, people, bots, resolved-without-me folded)
- [x] 12.31 "Since my last review" falls back to the full diff when GitHub's comparison is truncated (300 files) by a big rebase
- [x] 12.32 Team tab: pick a GitHub team, see each member's open PRs and their status
- [x] 12.33 Stack layer picker; status pills on the PR page; whitespace toggle and shortcuts moved from the bar to the index footer
- [x] 12.34 After submitting, open the next PR that needs review (default on), else an "All caught up!" page
- [x] 12.35 Android vector drawables preview as before/after images (VectorDrawable → SVG)
- [x] 12.36 Bitmap image previews (incl. Git LFS via signed download links); default review verdict from pending/open comments
- [x] 12.37 Import folding for TypeScript/JavaScript (multi-line imports, external packages named)
- [x] 12.38 Settings page: integration status (gh, slackcli, acli) with setup commands, and every preference in one place, synced live

## 13. Verify

- [ ] 13.1 Manual review session on a real PR containing markdown, generated files, and a 500+ file diff (done so far: live read-only load of a real PR)
- [x] 13.2 `openspec validate add-pr-review-app` (if OpenSpec CLI is installed)
