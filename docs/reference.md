# Reference

## Keyboard shortcuts

Change the single-key ones in ⚙ Settings → Keyboard shortcuts.

| Key | Action |
|---|---|
| `j` / `k` | Next / previous file |
| `n` / `p` | Next / previous review thread |
| `d` / `⇧D` | Next / previous change, across files |
| `Space` | Comment on the line under the mouse |
| `c` | Comment on the current file |
| `v` | Mark the current file viewed |
| `w` | Ignore whitespace on/off |
| `[` / `]` | Previous / next PR in the stack |
| `s` | Open / close the stack's overview |
| `m` | Open / close the merge box (your PRs) |
| `.` | Open the file in view on github.dev |
| `i` | Show / hide the index |
| `⌘↵` | Finish review |
| `⌘K` | Go to a PR (the ones you opened lately first), file, thread or check |
| `⌘F` | Find in every file |
| `⌘+` / `⌘−` / `⌘0` | Bigger / smaller / default text |
| `?` | All shortcuts |

In any menu (the bell, the clock, your account, a pill's, ✳ Claude): `↓` / `↑`, `Home` / `End` move through it, `Esc` closes it and goes back to its button. Tooltips name each button's key, as you've set it.

In the inbox (fixed keys):

| Key | Action |
|---|---|
| `j` / `k` | Next / previous thread |
| `r` | Reply (`⌘↵` sends, `Esc` leaves the box) |
| `e` | Done: off your list until someone writes again |
| `x` | Resolve |
| `c` | Commit the suggested change (your PRs) |
| `o` | Open the PR |

## Install notes

- The app isn't notarized, so the cask clears macOS's quarantine on install. Downloading the zip from [Releases](https://github.com/bukuwarung/lgtm/releases) instead, allow it in System Settings → Privacy & Security → Open Anyway.
- If your org enforces SSO, authorize the gh token for it when GitHub asks.
- Slack and Jira, optional (lgtm uses these tools' sign-ins, never a password or token):

  ```bash
  brew install shaharia-lab/tap/slackcli && slackcli auth login-auto
  brew install atlassian/homebrew-acli/acli && acli jira auth login --web
  ```

## Slack people

lgtm messages people as you through slackcli, so it needs each GitHub account's Slack user. Settings → Slack → People finds them (company email, then name) and you confirm each; with several matches you pick, or search by name, handle, email or a Slack link (their profile, or your DM with them). Mappings are saved in `~/.config/lgtm/config.json` (`{ "slackUsers": { "github-login": "U012ABC" } }`). Mark automation accounts as bots so they're never messaged.

## QA requests

Settings → Slack → "A button to ask QA" puts **Ask QA** on your PRs. It posts to the QA channel set there (an ID, `#name` or link, checked on Slack as you type), in the wording under Messages; a `<!subteam^ID>` in it tags a Slack group. The request is saved with the PR's Slack threads in `~/.config/lgtm/slack-threads.json`. Its replies are read from Slack: the latest one that says "signed off" (or "sign-off", "signoff") marks it signed off, and one that mentions a bug, an error or a crash marks an issue.
