# What lgtm does

Most of this can be switched off in ⚙ Settings.

- [Your queue](#your-queue)
- [Reading](#reading)
- [Less to read](#less-to-read)
- [Commenting](#commenting)
- [Your PRs](#your-prs)
- [Slack](#slack)
- [Claude Code](#claude-code)
- [On your Mac](#on-your-mac)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Install notes](#install-notes)

## Your queue

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/scene-queue-dark.png">
  <img alt="The PR list: Reviewing, Your PRs and Team tabs, PRs grouped by where they stand, with pills for what needs you" src="features/scene-queue-light.png" width="380">
</picture>

- Tabs for PRs to review, your own, and a GitHub team you watch, grouped by where they stand.
- Pills for what needs you: `CI failing`, `conflicts`, unsent comments, threads awaiting your reply, `↻ re-review`.
- A rough time to review (⏱), from the description and changed lines; set your pace in Settings → Time to review.
- When each PR was last active (amber after a week).
- On the Team tab, how many reviews each member is asked for.
- Refreshes every 3 minutes, with optional desktop notifications.

## Reading

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/scene-review-dark.png">
  <img alt="A PR: the bar with ✳ Claude and Finish review, the Jira ticket, status pills, changes since your last review, and a diff" src="features/scene-review-light.png" width="760">
</picture>

- Every changed file on one page: markdown first, tests right after their source.
- The Jira ticket and PR status on top; an index of comments, reviewers, checks (with failed-job logs), threads and files.
- Re-reviews start with what happened since your last one, and your threads say whether their lines changed.
- Reopens where you left off, and marks files changed since your last visit.
- Status pills (checks failing, files without test changes, modules) open the list behind them.
- File headers lead with the file name; status tags in colour; one line-number column.
- In Kotlin and Java, each hunk names the function it's in, pinned while you scroll.
- In Gradle projects, files grouped by module, with modules whose code changed but no test did.
- A strip down the right edge is the scrollbar, with marks for threads, drafts and changes.
- Images in descriptions and comments (private repos too), in markdown files, and SVG files.
- Code themes (IntelliJ, GitHub, VS Code, Dracula, Catppuccin and more), free code fonts with ligatures, and text sizes.
- Stacked PRs: move between layers with `[` and `]`.

## Less to read

On by default, each with a switch (and these examples) in ⚙ Settings.

<details open><summary><b>Changes since your last review</b>: re-reviews show only what changed since you last reviewed (not on your own PRs).</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/sinceFirst-dark.png">
  <img alt="Changes since your last review, off and on" src="features/sinceFirst-light.png" width="760">
</picture>
</details>

<details open><summary><b>Fold imports</b>: import blocks fold to one line naming only new outside libraries.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/foldImports-dark.png">
  <img alt="Fold imports, off and on" src="features/foldImports-light.png" width="760">
</picture>
</details>

<details open><summary><b>Hide generated files</b>: files marked <code>linguist-generated</code> wait behind one row.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/hideGenerated-dark.png">
  <img alt="Hide generated files, off and on" src="features/hideGenerated-light.png" width="760">
</picture>
</details>

<details open><summary><b>Hide moved files</b>: files moved without changes wait behind one row.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/hideNoDiff-dark.png">
  <img alt="Hide moved files, off and on" src="features/hideNoDiff-light.png" width="760">
</picture>
</details>

<details open><summary><b>Collapse deleted files</b>: a deleted file is one row until you open it.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/collapseDeleted-dark.png">
  <img alt="Collapse deleted files, off and on" src="features/collapseDeleted-light.png" width="760">
</picture>
</details>

<details open><summary><b>Dim moved code</b>: code moved without changes is dimmed, with where it came from.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/dimMoved-dark.png">
  <img alt="Dim moved code, off and on" src="features/dimMoved-light.png" width="760">
</picture>
</details>

<details open><summary><b>Word highlights</b>: the changed words inside a line stand out.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/wordDiff-dark.png">
  <img alt="Word highlights, off and on" src="features/wordDiff-light.png" width="760">
</picture>
</details>

<details open><summary><b>Ignore whitespace</b>: re-indented lines read as unchanged (<code>w</code>).</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/ignoreWs-dark.png">
  <img alt="Ignore whitespace, off and on" src="features/ignoreWs-light.png" width="760">
</picture>
</details>

<details open><summary><b>Rendered markdown</b>: markdown files and descriptions show rendered, still commentable line by line, in a theme you pick (Settings → Markdown files).</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/richMarkdown-dark.png">
  <img alt="Rendered markdown, off and on" src="features/richMarkdown-light.png" width="760">
</picture>
</details>

<details open><summary><b>Rendered doc comments</b>: KDoc, Javadoc, JSDoc and runs of <code>//</code> comments read like IntelliJ's reader mode.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/renderDocs-dark.png">
  <img alt="Rendered doc comments, off and on" src="features/renderDocs-light.png" width="760">
</picture>
</details>

<details open><summary><b>Image previews</b>: PNG, WebP, JPEG, GIF, SVG and Android vector drawables show as pictures.</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/previewImages-dark.png">
  <img alt="Image previews, off and on" src="features/previewImages-light.png" width="760">
</picture>
</details>

<details open><summary><b>Fold bot comments</b>: CI and AI-reviewer comments fold to one line (not on your own PRs).</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/foldBots-dark.png">
  <img alt="Fold bot comments, off and on" src="features/foldBots-light.png" width="760">
</picture>
</details>

Markdown themes: lgtm's own or 20 from [markdown.style](https://markdown.style/themes), each with a night version, every font, size and colour adjustable.

## Commenting

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/scene-comment-dark.png">
  <img alt="A review thread under a diff line, with a suggested change and a reply being written" src="features/scene-comment-light.png" width="760">
</picture>

- Line, range and file comments, rendered markdown included.
- An editor with preview, `:emoji:` and `@mention` completion, saved replies (`/`), and suggested changes.
- Drafts survive reloads and go out as one review, the verdict pre-picked; then the next PR opens.
- ⌥-click a line number to copy a link to it.

## Your PRs

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/scene-merge-dark.png">
  <img alt="The merge box: what is blocking, update branch, merge method, merge and auto-merge" src="features/scene-merge-light.png" width="760">
</picture>

- Reviewers in the index, with their verdict.
- Nobody asked yet: reviewers suggested, least busy first; a click asks them on GitHub and Slack.
- Ask a reviewer on Slack, or ask one who's reviewed to look again.
- Mark files, folders or modules viewed from the index; rerun failed GitHub Actions jobs.
- A merge box with what's blocking: ready for review, update branch, merge, auto-merge.
- Once merged, move the Jira ticket on (to "Ready for QA", or your pick).
- Waiting a day for review: `🔔 nudge` reminds the reviewers on Slack.

## Slack

lgtm messages people as you, through slackcli.

- One thread per PR and person; a DM you already had about the PR counts.
- Every message is yours to word (Settings → Slack messages): fill-ins like `{pr}`, tags like `{@recipient}` and `{@author}` that become mentions, and your workspace's emoji, suggested and previewed.
- Settings → Slack people maps GitHub accounts to Slack users: found by email or name, or searched by name, handle, email or a Slack link. Saved in `~/.config/lgtm/config.json`.
- Mark automation accounts as bots so they're never messaged.

## Claude Code

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="features/scene-claude-dark.png">
  <img alt="✳ Claude with a linked session (the green dot)" src="features/scene-claude-light.png" width="760">
</picture>

- ✳ Claude on a PR or comment opens the PR's session in the Claude app, or starts one with the PR in the prompt.
- A green dot, "working…" or "waiting for you" shows the session's state; ⌥-click starts a new one.
- ✳ Ask Claude answers a question about code you select.
- The `lgtm-review` skill (Settings → Claude Code → Install) lets Claude send PRs here, linked to its session.
- After your review, send Claude the outcome; it can reply on each thread and resolve it.
- The list shows "✳ updated" when it pushes and "✳ waiting for you" when it needs you.

## On your Mac

- A Dock badge with the "needs your review" count, and notifications.
- `lgtm://<owner>/<repo>/pull/<n>` links; copy a PR link anywhere and lgtm offers to open it.
- Several GitHub accounts: switch from your avatar (each one's drafts kept apart).
- ⌘F across every file, ⌘[ ⌘] Back and Forward, ⌘+ ⌘− ⌘0 text sizes.
- Glass bars and pop-ups, a remembered window, Launch at login.
- Updates through Homebrew from Settings; what's new shown once after.
- Help → Copy Diagnostics for bug reports (no tokens or PR text).

## Keyboard shortcuts

Change the single-key ones in ⚙ Settings → Keyboard shortcuts.

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
| `⌘K` | Go to a PR, file, thread or check |
| `⌘F` | Find in every file |
| `⌘+` / `⌘−` / `⌘0` | Bigger / smaller / default text |
| `?` | All shortcuts |

## Install notes

- The app isn't notarized, so the cask clears macOS's quarantine on install. Downloading the zip from [Releases](https://github.com/bukuwarung/lgtm/releases) instead, allow it in System Settings → Privacy & Security → Open Anyway.
- If your org enforces SSO, authorize the gh token for it when GitHub asks.
- Slack and Jira, optional (lgtm uses these tools' sign-ins, never a password or token):

  ```bash
  brew install shaharia-lab/tap/slackcli && slackcli auth login-auto
  brew install atlassian/homebrew-acli/acli && acli jira auth login --web
  ```
