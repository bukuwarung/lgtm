## Context

lgtm today: `app/bin/lgtm.mjs` (Node, stdlib only) serves the built Preact UI on a loopback port (4517) and exposes six routes that run `gh`, `slackcli` and `acli` and read/write `~/.config/lgtm/`. The UI calls GitHub directly (api.github.com allows CORS) and reaches the server only through `app/src/platform.ts`. Users run `lgtm` in a terminal; the page opens in their browser.

Goal: a macOS app installable with Homebrew, without an Apple Developer account, sharing the UI code with the browser version.

## Goals / Non-Goals

**Goals:** native window and Dock presence; no local port; same features and look; one-command install and upgrade for teammates; browser version keeps working.

**Non-Goals:** notarization, in-app updater, Windows/Linux, menu-bar app, UI changes.

## Decisions

### 1. Tauri 2 with native commands (not a Node sidecar, not Electron)
The window loads the bundled UI from Tauri's asset protocol; the server routes become Rust `#[tauri::command]`s.
*Why:* ~10–15 MB universal app vs ~60 MB with a bundled Node sidecar or ~150 MB with Electron; one process; no port, so no DNS-rebinding/`Sec-Fetch-Site` guards and no "replace a stale server" logic. The routes are thin (run a CLI, parse JSON, read/write a file), roughly 300 lines of Rust.
*Alternatives:* **Tauri + Node sidecar** reuses `lgtm.mjs` nearly as is but ships a Node runtime and keeps the port. **Electron** reuses the most code but is the heaviest and keeps a Chromium per app.

### 2. One UI, two platforms
`app/src/platform.ts` keeps its exports (`fetchToken`, `slackStatus`, `notifySlack`, `getSlackPeople`/`findSlackPeople`/`saveSlackPeople`, `fetchJira`, `fetchJobLog`, `fetchIntegrations`, `storage`, …). Each export checks `isDesktop` (Tauri's injected `__TAURI_INTERNALS__`) and either calls the local server (`fetch`) or the matching command (`invoke`, from `@tauri-apps/api`, loaded only in the app). One UI build (`app/dist`) serves both, so there's no separate build mode. Nothing else imports Tauri. Desktop-only features (Dock badge, notifications, launch at login) are optional exports that are no-ops on the web.

### 3. Commands mirror the server routes
| Server route | Command | Notes |
|---|---|---|
| `GET /token` | `gh_token` | `gh auth token`, per call (account switches apply) |
| `GET/POST /slack` | `slack_status`, `slack_notify` | whoami + this PR's threads; send/reply, thread file written atomically |
| `/slack-people` | `slack_people_get/find/save` | same matching order; saves `slackUsers` in `config.json` |
| `/jira` | `jira_issue` | `acli jira workitem view` |
| `/job-log` | `job_log` | `gh api …/logs`, ANSI stripped, last 60 lines to the last `##[error]` |
| `/integrations` | `integrations` | slackcli + acli sign-in status |

Input validation is carried over unchanged (repo/login/key/ID patterns, recipient and text limits). CLIs are run with an argument vector, never a shell string. `LGTM_SLACK_DRY_RUN` keeps working.

### 4. Finding the CLIs from a GUI app
Apps opened from Finder or the Dock don't inherit the shell's `PATH`, so `/opt/homebrew/bin` is missing. At startup the app reads `PATH` from the user's login shell (`$SHELL -lc 'printf %s "$PATH"'`, with a short timeout) and falls back to prepending `/opt/homebrew/bin:/usr/local/bin`. The Settings "Accounts" check shows any CLI still not found.

### 5. Unsigned (ad-hoc) app, quarantine cleared by the cask
Without an Apple Developer account the app gets an ad-hoc signature (`signingIdentity: "-"`, the whole bundle sealed), enough to run on Apple Silicon and Intel. Downloads carry the `com.apple.quarantine` flag, and macOS 15+ blocks such apps until the user clicks "Open Anyway" in System Settings. The cask removes the flag after install (Homebrew 7's declarative steps):
```ruby
postflight_steps do
  run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{appdir}}/lgtm.app"]
end
```
*Trade-off:* installing skips Gatekeeper for lgtm, so trust rests on the repo and on who can publish releases (its maintainers). The README says so, and documents the manual "Open Anyway" path for a download by hand.

### 6. The source repo is the tap
`bukuwarung/lgtm` is public, so it holds everything: `Casks/lgtm.rb`, `Formula/lgtm-cli.rb`, and GitHub Releases with the assets. A repo not named `homebrew-*` needs its URL when tapping: `brew tap bukuwarung/lgtm https://github.com/bukuwarung/lgtm`.
- **Releasing, by hand:** `scripts/release.sh X.Y.Z` on a maintainer's Mac sets the version (`app/package.json`, `tauri.conf.json`, `Cargo.toml`), runs the tests, builds the universal app (`--target universal-apple-darwin`) and zips it with `ditto` as `lgtm-X.Y.Z.zip`, packages the terminal version (`app/bin`, `app/dist`, `package.json`) as `lgtm-cli-X.Y.Z.tar.gz`, and writes version and SHA-256 into the cask and formula. Then: push, `gh release create vX.Y.Z` with both files, and `brew upgrade` to check. A CI workflow can take this over later.
- **Cask:** `depends_on formula: "gh"`, `depends_on macos: :ventura`, the quarantine step, `zap` for its data, and `caveats` pointing to `gh auth login` and the optional slackcli and acli.
- **Formula `lgtm-cli`:** installs the packaged terminal version into `libexec`, `depends_on "node"` and `"gh"`, and puts `lgtm` on the PATH running Homebrew's node.
*Alternative:* a separate `bukuwarung/homebrew-tap` (the plan while the source was private). Not needed now.

### 7. Data and settings
Preferences and pending drafts live in the web view's `localStorage`, which is per app (and per browser origin today), so moving to the app starts fresh. Settings gains **Export / Import** (a JSON file of preferences and drafts) in both versions, so a user can carry them over once. Files in `~/.config/lgtm/` (Slack mapping, threads) are shared by both versions as before.

### 8. WebKit instead of Firefox/Chrome
Tauri on macOS uses WKWebView (Safari's engine). What lgtm relies on is supported on macOS 13+: CSS `light-dark()` (Safari 17.5), the Custom Highlight API (17.2), `color-mix`, `content-visibility`, ES2023. Differences to handle:
- **Find (⌘F):** WKWebView has no built-in find bar under Tauri. Add an in-app find bar (⌘F) over the rendered page (we already render every file on ⌘F).
- **Links:** `target="_blank"` links open in the default browser through Tauri's opener plugin, not a new web view.
- **Notifications:** the notification plugin instead of the Web Notification API.
- **Clipboard:** `navigator.clipboard.writeText` works on a user gesture; keep.
Minimum macOS: 13 (Ventura).

### 9. Security
Tauri capabilities allow only lgtm's own commands plus the opener, notification, deep-link, window-state and autostart plugins; no shell or filesystem plugin is exposed to the page. A content security policy limits scripts to the bundle and connections to `api.github.com`, `github.com`, `*.githubusercontent.com` and the image hosts used in rendered content. The gh token stays in memory in the page, as today.

## Risks / Trade-offs

- **Quarantine bypass** (decision 5): acceptable for an internal tool published by its maintainers; revisit if an Apple Developer account appears (then: sign, notarize, drop the postflight).
- **WebKit gaps** found during the port; mitigated by testing each feature in the app before release.
- **Two builds to keep working:** the web/desktop split stays in `platform.*.ts` and a few desktop checks; the release checklist builds both.
- **Manual releases** can drift (a wrong checksum, a forgotten formula bump); the checklist ends with installing from the tap on another account.
- **Rust in the codebase:** small, mostly process spawning and JSON; covered by unit tests on the parsing/validation parts.

## Open Questions

- Should lgtm also handle `https://github.com/.../pull/N` links (e.g. an "Open in lgtm" Services menu item)? Deferred until the basics ship.
