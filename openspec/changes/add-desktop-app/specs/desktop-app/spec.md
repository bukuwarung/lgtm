## ADDED Requirements

### Requirement: macOS desktop app with the same review UI
The system SHALL provide a macOS app (macOS 13 or later, Apple Silicon and Intel) that shows the lgtm review UI in its own window and Dock icon, bundled into the app, with no local server or port. Every feature of the browser version SHALL work the same in the app.

#### Scenario: First launch
- **WHEN** a user with `gh` signed in opens the app
- **THEN** the window shows their PR list, signed in, without a terminal or browser

#### Scenario: Browser version unaffected
- **WHEN** the same user runs `lgtm` in a terminal
- **THEN** the browser version still works, sharing the Slack mapping and threads in `~/.config/lgtm/`

### Requirement: CLIs reached through app commands
The app SHALL get the GitHub token, Slack status, threads, people and messages, Jira tickets, CI job logs and integration status by running `gh`, `slackcli` and `acli` itself, with the same inputs, validation and results as the browser version's server, and SHALL find these CLIs even when started from Finder or the Dock (whose `PATH` lacks Homebrew's directory).

#### Scenario: Started from the Dock
- **WHEN** the app is opened from the Dock and `gh` lives in `/opt/homebrew/bin`
- **THEN** it finds `gh` and signs in; Settings → Accounts shows any CLI it still can't find, with the install command

#### Scenario: Slack message from the app
- **WHEN** the user finishes a review with "Message @author on Slack" checked
- **THEN** the message is sent through slackcli and replies in the PR's existing thread, as in the browser version

### Requirement: Native integration
The app SHALL open external links in the default browser, show native notifications for new review requests and re-reviews (when enabled), badge the Dock icon with the number of PRs needing review, open `lgtm://<owner>/<repo>/pull/<n>` links on that PR, remember its window size and position, offer an opt-in "Launch at login" setting, and provide a find bar for ⌘F.

#### Scenario: Dock badge
- **WHEN** three non-draft PRs are in "Needs your review"
- **THEN** the Dock icon shows 3, and clears when none are left

#### Scenario: GitHub link in a comment
- **WHEN** the user clicks a link to github.com in a comment
- **THEN** it opens in their default browser, not inside the app

#### Scenario: Deep link
- **WHEN** the user opens `lgtm://bukuwarung/bukuwarung-edc-app/pull/1725`
- **THEN** the app comes to the front on that PR

### Requirement: Moving settings and drafts
Settings SHALL export preferences and pending drafts to a JSON file and import such a file, in both the app and the browser version.

#### Scenario: Switch to the app with drafts pending
- **WHEN** the user exports from the browser version and imports in the app
- **THEN** their preferences and pending comments appear in the app

### Requirement: Locked-down web view
The app's web view SHALL only reach lgtm's own commands and the plugins it needs (links, notifications, deep links, window state, launch at login), with no shell or file access from the page, and a content security policy limiting connections to GitHub and the hosts its rendered content uses.

#### Scenario: Page tries a shell
- **WHEN** script in the page calls any command other than lgtm's own
- **THEN** Tauri rejects it
