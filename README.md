# lgtm

Fast, markdown-first GitHub PR review in your own browser, signed in with your GitHub CLI login.

- Sidebar of every open PR you're asked to review or have reviewed, grouped: needs your review, you requested changes, you commented, you approved. A second tab, "Your PRs", lists the PRs you opened or are assigned to: changes requested, approved, waiting for review, draft. Other people's draft PRs are hidden until you ask for them; yours always show. It refreshes every 3 minutes, shows the waiting count in the tab title, and can send a desktop notification for new review requests (🔔).
- Every changed file in one scrolling page with syntax highlighting; file bodies render as they near the viewport. "Show more lines" expands unchanged code between hunks.
- Re-reviews open on only the changes since your last review (toggle back to the full diff), and stacked PRs get "‹ Layer 2/4 ›" navigation.
- Mark files Viewed (synced with GitHub), resolve conversations, and edit pending comments.
- Comment editor with Write/Preview (rendered by GitHub), `:emoji:` and `@mention` completion, a formatting toolbar (⌘B/⌘I/⌘E/⌘K), and "± Suggest" for a GitHub suggested change.
- A PR Shortcut Index beside the diff: jump to the description, any comment or review, CI checks (failing and running listed, passed and skipped folded; one entry per check even when a workflow ran several times; each links to its run; failed GitHub Actions jobs show the end of their log), review threads, or a file in a GitHub-style tree.
- Drag the sidebars' edges to resize them (double-click to reset).
- The PR conversation (description, comments, review verdicts) above the files; review threads inline. Each comment's timestamp links to it on github.com, and 🔗 copies that link.
- Markdown files first, rendered as rich diff by default. Hover a block and click the `+` gutter to comment on its source lines. Mermaid diagrams are drawn, in files and in comments.
- Files marked `linguist-generated` in the root `.gitattributes`, and files only renamed or moved without changes, are hidden behind "N … hidden · Show" rows.
- Deleted files stay in place but collapse to one row; "Show its N lines" opens the old contents.
- Stacked PRs (one's base branch is another's head) are grouped in the sidebar, bottom layer first.
- On your own PRs, a merge box shows whether it can merge and why not (draft, review required, failing checks, behind, conflicts), with Ready for review, Update branch, merge (commit message editable before confirming), auto-merge, and the admin bypass. "Your PRs" in the sidebar shows ready to merge / behind base / conflicts.
- Draft comments survive reloads and are submitted as one review (Comment / Approve / Request changes), optionally with a Slack DM to the author and assignees.

lgtm signs in through the GitHub CLI and slackcli; see [Setup](#setup).

Design and specs: [`openspec/changes/add-pr-review-app`](openspec/changes/add-pr-review-app).

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

GitHub doesn't expose our emails, so [`app/slack-users.json`](app/slack-users.json) maps GitHub logins to Slack user IDs for the team. New teammate? Add them there and open a PR:

```bash
slackcli search people "their name"   # shows their Slack user ID (U…)
```

Values can be a Slack user ID (preferred: survives handle renames), `@handle`, or email. For a personal addition or override without committing, use `~/.config/lgtm/config.json`:

```json
{ "slackUsers": { "github-login": "U012ABC" } }
```

Both are read on every send, so no restart is needed. Each PR gets one Slack thread per person: your first review of a PR starts a DM, later reviews of that PR reply in the same thread (remembered in `~/.config/lgtm/slack-threads.json`). `LGTM_SLACK_DRY_RUN=1 lgtm` checks recipients without sending.

## Develop

```bash
cd app
npm test       # logic checks (patch parsing, anchors, .gitattributes, markdown mapping, highlighting)
npm start      # build, then run the server
```
