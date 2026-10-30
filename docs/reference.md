# Reference

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
| `s` | Open / close the stack's overview |
| `m` | Open / close the merge box (your PRs) |
| `.` | Open the file in view on github.dev |
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

## Slack people

lgtm messages people as you through slackcli, so it needs each GitHub account's Slack user. Settings → Slack → People finds them (company email, then name) and you confirm each; with several matches you pick, or search by name, handle, email or a Slack link (their profile, or your DM with them). Mappings are saved in `~/.config/lgtm/config.json` (`{ "slackUsers": { "github-login": "U012ABC" } }`). Mark automation accounts as bots so they're never messaged.
