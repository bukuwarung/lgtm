# lgtm

Fast GitHub PR review in your own browser: every file on one page, markdown first, less noise. It runs on your machine and signs in with your GitHub CLI login.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/foldImports-dark.png">
  <img alt="Import blocks folded to one line" src="docs/features/foldImports-light.png" width="760">
</picture>

## Install

Node 22+ and the GitHub CLI are required; slackcli (Slack messages) and the Atlassian CLI (Jira tickets) are optional. lgtm never asks for a password or token: it uses these tools' sign-ins.

```bash
brew install gh && gh auth login                                         # required
brew install shaharia-lab/tap/slackcli && slackcli auth login-auto        # optional: Slack
brew install atlassian/homebrew-acli/acli && acli jira auth login --web   # optional: Jira
```

```bash
git clone https://github.com/bukuwarung/lgtm.git
cd lgtm/app && npm install && npm run build && npm link
```

If the org enforces SSO, authorize the gh token for it when GitHub asks. ⚙ Settings shows which sign-ins work and how to fix the rest.

## Use

```bash
lgtm                                          # opens the app on port 4517
lgtm https://github.com/owner/repo/pull/123   # straight to a PR
```

To update: `git pull && npm run build` in `app/`, then `lgtm` (it replaces an older copy that's still running).

## What it does

**Your queue.** Tabs for PRs to review, your own PRs, and a GitHub team you watch, grouped by where they stand. Each PR shows its size and what needs you: `CI failing`, `conflicts`, unsent comments, threads awaiting your reply, and `↻ re-review` when it's back on your plate. Refreshes every 3 minutes, with optional desktop notifications.

**Reading.** Every changed file on one page, markdown first and tests right after their source. Syntax highlighting in your pick of code themes (IntelliJ, GitHub, VS Code, One, Dracula, Solarized, Gruvbox, Catppuccin, Tokyo Night, Nord) and free fonts (JetBrains Mono, Fira Code, Cascadia Code, Geist Mono, Iosevka and more), the Jira ticket and PR status on top, a jump index of comments, checks (with failed-job logs), threads and files, and navigation for stacked PRs. It reopens where you left off and marks files changed since your last visit.

**Commenting.** Line, range and file comments everywhere, rendered markdown included. An editor with preview, `:emoji:` and `@mention` completion, and suggested changes. Drafts survive reloads and go out as one review, with the verdict pre-picked from your comments; then lgtm opens the next PR that needs you. Optional Slack DM to the author, one thread per PR.

**Claude Code.** ✳ Claude on the PR bar or on any comment opens a Claude Code session in the Claude desktop app with the PR or comment in the prompt (in the repo's local folder, set in Settings), or copies the prompt and reopens your last session.

**Your PRs.** A merge box with what's blocking and the controls: ready for review, update branch, merge, auto-merge.

## Less to read

On by default, each with a switch (and these examples) in ⚙ Settings. Click one to see it.

<details><summary><b>Changes since your last review</b>: re-reviews start with only what changed since you last reviewed.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/sinceFirst-dark.png">
  <img alt="Changes since your last review, off and on" src="docs/features/sinceFirst-light.png" width="760">
</picture>
</details>

<details><summary><b>Fold imports</b>: package and import blocks fold to one line that names only new outside libraries.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/foldImports-dark.png">
  <img alt="Fold imports, off and on" src="docs/features/foldImports-light.png" width="760">
</picture>
</details>

<details><summary><b>Hide generated files</b>: files marked <code>linguist-generated</code> wait behind one row.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/hideGenerated-dark.png">
  <img alt="Hide generated files, off and on" src="docs/features/hideGenerated-light.png" width="760">
</picture>
</details>

<details><summary><b>Hide moved files</b>: files renamed or moved without changes wait behind one row.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/hideNoDiff-dark.png">
  <img alt="Hide moved files, off and on" src="docs/features/hideNoDiff-light.png" width="760">
</picture>
</details>

<details><summary><b>Collapse deleted files</b>: a deleted file is one row until you open it.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/collapseDeleted-dark.png">
  <img alt="Collapse deleted files, off and on" src="docs/features/collapseDeleted-light.png" width="760">
</picture>
</details>

<details><summary><b>Dim moved code</b>: code moved without changes is dimmed, with where it came from.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/dimMoved-dark.png">
  <img alt="Dim moved code, off and on" src="docs/features/dimMoved-light.png" width="760">
</picture>
</details>

<details><summary><b>Word highlights</b>: the changed words inside a line stand out.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/wordDiff-dark.png">
  <img alt="Word highlights, off and on" src="docs/features/wordDiff-light.png" width="760">
</picture>
</details>

<details><summary><b>Ignore whitespace</b>: re-indented lines read as unchanged (<code>w</code>).</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/ignoreWs-dark.png">
  <img alt="Ignore whitespace, off and on" src="docs/features/ignoreWs-light.png" width="760">
</picture>
</details>

<details><summary><b>Rendered markdown</b>: markdown shows rendered, still commentable line by line.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/richMarkdown-dark.png">
  <img alt="Rendered markdown, off and on" src="docs/features/richMarkdown-light.png" width="760">
</picture>
</details>

<details><summary><b>Rendered doc comments</b>: KDoc, Javadoc and JSDoc read like IntelliJ's reader mode; edited ones stay source.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/renderDocs-dark.png">
  <img alt="Rendered doc comments, off and on" src="docs/features/renderDocs-light.png" width="760">
</picture>
</details>

<details><summary><b>Image previews</b>: PNG, WebP, JPEG, GIF (Git LFS too) and Android vector drawables show as pictures.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/previewImages-dark.png">
  <img alt="Image previews, off and on" src="docs/features/previewImages-light.png" width="760">
</picture>
</details>

<details><summary><b>Fold bot comments</b>: CI and AI-reviewer comments fold to one line.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/features/foldBots-dark.png">
  <img alt="Fold bot comments, off and on" src="docs/features/foldBots-light.png" width="760">
</picture>
</details>

## Keyboard shortcuts

| Key | Action |
|---|---|
| `j` / `k` | Next / previous file |
| `n` / `p` | Next / previous review thread |
| `Space` | Comment on the line under the mouse |
| `c` | Comment on the current file |
| `v` | Mark the current file viewed |
| `w` | Ignore whitespace on/off |
| `[` / `]` | Previous / next PR in the stack |
| `i` | Show / hide the index |
| `⌘↵` | Finish review |
| `⌘F` | Find, in every file |
| `?` | All shortcuts |

## Slack people

lgtm messages people as you through slackcli, so it needs each GitHub account's Slack user. In ⚙ Settings → Slack people, "Find Slack accounts" looks them up (company email, then name, accepting only a single match) and you confirm each one. Mappings are saved in `~/.config/lgtm/config.json` (`{ "slackUsers": { "github-login": "U012ABC" } }`). Mark automation accounts as bots there so they're never messaged. `LGTM_SLACK_DRY_RUN=1 lgtm` checks recipients without sending.

## Develop

```bash
cd app
npm test        # logic checks
npm start       # build, then run the server
npm run demos   # recapture docs/features/*.png from src/demos.tsx (lgtm must be running)
```

**Desktop app (in progress).** `desktop/` wraps the same UI in a macOS app with [Tauri](https://tauri.app) (plan: [`openspec/changes/add-desktop-app`](openspec/changes/add-desktop-app)). To build it you need Rust:

```bash
brew install rustup && rustup default stable
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"   # rustup is keg-only
cd desktop && npm install && npm run build         # → src-tauri/target/release/bundle/macos/lgtm.app
```

The app does everything the browser version does (GitHub, Slack, Jira, CI logs), plus a Dock badge with the "needs your review" count, macOS notifications, `lgtm://<owner>/<repo>/pull/<n>` links, links opening in your browser, its own ⌘F find bar, a remembered window, and "Launch at login" in Settings. Moving over from the browser version: Settings → Backup → Export there, Import in the app (preferences and pending comments). Keep the version in `app/package.json` and `desktop/src-tauri/tauri.conf.json` the same; Settings shows it. `cargo test -- --ignored --nocapture` in `desktop/src-tauri` checks the app's commands against your real gh, slackcli and acli (read-only; Slack in dry run).

`LGTM_PORT` changes the port (drafts are stored per port), `LGTM_NO_OPEN=1` skips opening a browser tab. Design and specs: [`openspec/changes/add-pr-review-app`](openspec/changes/add-pr-review-app).
