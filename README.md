# lgtm

Fast, markdown-first GitHub PR review in your own browser, signed in with your GitHub CLI login.

- Sidebar of every open PR you're asked to review or have reviewed, grouped: needs your review, you requested changes, you commented, you approved. A third tab, "Team", watches a GitHub team you pick: each member's open PRs in the team's organization with their status (draft, awaiting review, approved, changes requested, CI failing, conflicts). A second tab, "Your PRs", lists the PRs you opened or are assigned to: changes requested, approved, waiting for review, draft. Other people's draft PRs are hidden until you ask for them; yours always show. Each PR shows its size (+/− lines, files) and what needs you or blocks it: `CI failing`, `conflicts`, `N unsent comments` (drafts you never submitted), `💬 N awaiting your reply` (open, current threads where someone answered you, or anyone commented on your PR). A PR you commented on or requested changes on moves back to "Needs your review" (tagged `↻ re-review`, as is a PR whose author re-requested your review; the PR-wide verdict is hidden then, and whenever it just repeats your own) once every thread you're in is resolved. It refreshes every 3 minutes, shows the waiting count in the tab title, and can send a desktop notification for new review requests (🔔).
- Every changed file in one scrolling page with syntax highlighting (Kotlin coloured like IntelliJ: properties, named arguments, `it`, constants, annotations), in reading order: markdown first, then each source file followed by its test; file bodies render as they near the viewport. "Show more lines" expands unchanged code between hunks.
- Re-reviews open on only the changes since your last review (toggle back to the full diff), and stacked PRs get "‹ 2/4 · #123 ›" navigation (pick any layer from the list).
- Changed lines highlight the exact words that changed. Code moved without changes (3+ unique lines, across files too) is dimmed with "Moved here from …". `w` (or the checkbox at the bottom of the PR index) ignores whitespace-only changes.
- Images (PNG, WebP, JPEG, GIF, including Git LFS files like snapshot goldens) and Android vector drawables (`res/drawable*/*.xml` with a `<vector>` root) show as before → after images by default (click for full size); for vectors "Source" switches to the diff for line comments. Colours from resources are drawn grey.
- In Kotlin/Java and TypeScript/JavaScript files, the package line and changed import blocks (with the blank lines around them) fold to one quiet row (`⋯ +6 −2 imports · new: retrofit2`, or `package moved` when it did); a new file also drops its `@@ -0,0 …` header, so it starts at its code. It names only libraries the file didn't import before, leaving out the project's own packages (and relative or aliased TS imports) and the standard library (and `node:` built-ins) (hover for the full list).
- Reopening a PR returns to where you were reading, and files changed since your last visit are marked.
- The Jira ticket in the PR title (or branch) shows above the conversation: status, summary, description. Needs the Atlassian CLI (`acli jira auth login`).
- Bot comments (CI summaries, AI reviewers) fold to one line; bot-only review threads start collapsed.
- Mark files Viewed (synced with GitHub), resolve conversations, and edit pending comments.
- Comment editor with Write/Preview (rendered by GitHub), `:emoji:` and `@mention` completion, a formatting toolbar (⌘B/⌘I/⌘E/⌘K), and "± Suggest" for a GitHub suggested change.
- A PR Shortcut Index beside the diff: jump to the description, any comment or review (bot posts folded into one collapsed group), CI checks (failing and running listed, passed and skipped folded; one entry per check even when a workflow ran several times; each links to its run; failed GitHub Actions jobs show the end of their log), review threads (yours first, open before resolved; then people's; then bots'; resolved threads you're not in folded away), or a file in a GitHub-style tree.
- Drag the sidebars' edges to resize them (double-click to reset).
- The PR's status pills (draft, approved / changes requested / awaiting review, failing checks, conflicts, threads awaiting your reply, size) at the top of the page, then the PR conversation (description, comments, review verdicts) above the files; review threads inline. Each comment's timestamp links to it on github.com, and 🔗 copies that link.
- Markdown files first, rendered as rich diff by default. Hover a block and click the `+` gutter to comment on its source lines. Code blocks without a language are read as the language of the file a comment is on (a YAML file's comment as YAML), or, in markdown files and general comments, as the PR's most common code language. Mermaid diagrams are drawn, in files and in comments.
- Files marked `linguist-generated` in the root `.gitattributes`, and files only renamed or moved without changes, are hidden behind "N … hidden · Show" rows.
- Deleted files stay in place but collapse to one row; "Show its N lines" opens the old contents.
- Stacked PRs (one's base branch is another's head) show their layer (`2/4`). Each layer sits in its own status group; neighbouring layers in the same group stay together, bottom first.
- On your own PRs, a merge box shows whether it can merge and why not (draft, review required, failing checks, behind, conflicts), with Ready for review, Update branch, merge (commit message editable before confirming), auto-merge, and the admin bypass. "Your PRs" in the sidebar shows ready to merge / behind base / conflicts.
- Draft comments survive reloads and are submitted as one review (Comment / Approve / Request changes), optionally with a Slack DM to the author and assignees. The verdict starts as Request changes when you have pending comments (switching to Approve fills in "Approved, but please address the comments"), Comment when threads you're in are still unresolved, and Approve otherwise. After submitting, lgtm opens the next PR that needs your review (uncheck "Then open the next PR" to stay), or an "All caught up!" page when none is left. The PR page's top bar links to the Slack thread with each person you've messaged about it (💬 @login).

lgtm signs in through the GitHub CLI and slackcli; see [Setup](#setup).

Design and specs: [`openspec/changes/add-pr-review-app`](openspec/changes/add-pr-review-app).

## Less to read

Each of these is on by default and has a switch in ⚙ Settings, which shows the same examples.

**Changes since your last review.** Re-reviews start with only what changed since your last review.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/sinceFirst-dark.png">
  <img alt="Changes since your last review: off and on" src="docs/features/sinceFirst-light.png" width="760">
</picture>

**Fold package and import blocks.** Package and import blocks fold to one line, naming only new outside libraries.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/foldImports-dark.png">
  <img alt="Fold package and import blocks: off and on" src="docs/features/foldImports-light.png" width="760">
</picture>

**Hide generated files.** Files marked `linguist-generated` stay out of the way.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/hideGenerated-dark.png">
  <img alt="Hide generated files: off and on" src="docs/features/hideGenerated-light.png" width="760">
</picture>

**Hide files moved without changes.** Files renamed or moved without changes are hidden.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/hideNoDiff-dark.png">
  <img alt="Hide files moved without changes: off and on" src="docs/features/hideNoDiff-light.png" width="760">
</picture>

**Collapse deleted files.** Deleted files collapse to one row.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/collapseDeleted-dark.png">
  <img alt="Collapse deleted files: off and on" src="docs/features/collapseDeleted-light.png" width="760">
</picture>

**Dim code moved without changes.** Code moved without changes is dimmed, with where it came from.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/dimMoved-dark.png">
  <img alt="Dim code moved without changes: off and on" src="docs/features/dimMoved-light.png" width="760">
</picture>

**Highlight the changed words.** The changed words inside a line are highlighted.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/wordDiff-dark.png">
  <img alt="Highlight the changed words: off and on" src="docs/features/wordDiff-light.png" width="760">
</picture>

**Ignore whitespace-only changes.** Whitespace-only changes can be ignored (`w`).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/ignoreWs-dark.png">
  <img alt="Ignore whitespace-only changes: off and on" src="docs/features/ignoreWs-light.png" width="760">
</picture>

**Markdown rendered.** Markdown files show rendered, still commentable line by line.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/richMarkdown-dark.png">
  <img alt="Markdown rendered: off and on" src="docs/features/richMarkdown-light.png" width="760">
</picture>

**Images as pictures.** Images and Android vector drawables show as pictures.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/previewImages-dark.png">
  <img alt="Images as pictures: off and on" src="docs/features/previewImages-light.png" width="760">
</picture>

**Fold bot comments.** Bot comments fold to one line.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/foldBots-dark.png">
  <img alt="Fold bot comments: off and on" src="docs/features/foldBots-light.png" width="760">
</picture>

## Setup

You need Node 22+, plus two CLIs that lgtm signs in through. It never asks for a password or token itself.

**1. GitHub CLI** (required): lgtm reads PRs and submits reviews as you.

```bash
brew install gh
gh auth login            # GitHub.com → HTTPS → log in with a web browser
gh auth status           # should show you logged in to github.com
```

If bukuwarung enforces SSO, authorize the gh token for the org when GitHub asks.

**2. slackcli** (for Slack DMs): lgtm messages the PR author and assignees as you when you finish a review. No Slack app needed.

```bash
brew install shaharia-lab/tap/slackcli
slackcli auth login-auto # sign in to the bukuwarung Slack workspace in the browser that opens
slackcli auth whoami     # should show "Credentials verified"
```

Without slackcli, lgtm still works; the Slack option just doesn't appear.

**3. lgtm**

```bash
git clone https://github.com/bukuwarung/lgtm.git
cd lgtm/app && npm install && npm run build && npm link
```

## Use

```bash
lgtm
```

It serves the UI on `http://127.0.0.1:4517` and opens it in your default browser. Pass a PR URL to open it directly, e.g. `lgtm https://github.com/owner/repo/pull/123`. Running `lgtm` again reuses the running instance. Set `LGTM_PORT` to change the port; drafts are stored per port.

To update: `git pull && npm run build` in `app/` (restart `lgtm` only if `app/bin/lgtm.mjs` changed).

## Settings

⚙ Settings (top right) shows whether lgtm can use your GitHub, Slack and Jira sign-ins, with the commands to fix any that can't, and holds every preference: which PRs the list shows, desktop notifications, the team to watch, review defaults (PR index, ignore whitespace, Jira ticket, Slack message, open the next PR), the theme, and a switch for each diff helper: since-last-review, import folding, hidden generated / renamed-only files, collapsed deleted files, moved-code dimming, word highlights, rendered markdown, image previews, folded bot comments and resuming where you left off. Preferences are per browser.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `j` / `k` | Next / previous file |
| `n` / `p` | Next / previous review thread |
| `v` | Mark the current file viewed |
| `Space` | Comment on the line under the mouse (or at the top of the view) |
| `c` | Comment on the current file |
| `[` / `]` | Previous / next PR in the stack |
| `i` | Show / hide the index |
| `⌘↵` | Finish review (submit inside the panel) |
| `⌘F` | Find, in every file |
| `?` | Shortcut help |

## Slack: who is who

lgtm needs to know each GitHub account's Slack user. Open ⚙ Settings → Slack people: it lists your team and the people in your queue, and "Find Slack accounts" looks the unmapped ones up in Slack (their verified company email on GitHub first, then their GitHub name, then their login's first word, each only when Slack finds exactly one person). You confirm each match before it's saved to `~/.config/lgtm/config.json`:

```json
{ "slackUsers": { "github-login": "U012ABC" } }
```

Automation accounts that GitHub sees as people (an AI reviewer, a release bot) can be marked as bots there ("bot?"): they're never messaged, and their comments fold and count like GitHub's own bots. No match? Find the ID with `slackcli search people "their name"` and add it there by hand. Values can be a Slack user ID (preferred: survives handle renames), `@handle`, or email. Both are read on every send, so no restart is needed. Each PR gets one Slack thread per person: your first review of a PR starts a DM, later reviews of that PR reply in the same thread (remembered in `~/.config/lgtm/slack-threads.json`). `LGTM_SLACK_DRY_RUN=1 lgtm` checks recipients without sending.

## Develop

Running `lgtm` again while one is already running reuses it when it's the same version, and replaces it when it's an older (or newer) one, so after `git pull` and a rebuild, just run `lgtm`. `LGTM_NO_OPEN=1` starts it without opening a browser tab. The feature pictures come from `src/demos.tsx`: with lgtm running, `npm run demos` (in `app/`) recaptures them into `docs/features/` with headless Chrome.

```bash
cd app
npm test       # logic checks (patch parsing, anchors, .gitattributes, markdown mapping, highlighting)
npm start      # build, then run the server
```
