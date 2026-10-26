## 1. Skeleton

- [x] 1.1 Install the toolchain on the build machine (`rustup`, Tauri CLI); document it in the README's Develop section
- [x] 1.2 `desktop/`: Tauri 2 project (`tauri.conf.json`, Rust crate, app icon from the `:mantap:` favicon, min macOS 13) that bundles `app/`'s built UI
- [x] 1.3 `app/src/platform.ts`: server calls or app commands, by runtime check (`isDesktop`); one UI build for both
- [x] 1.4 `gh_token` command + login-shell `PATH` lookup; the app opens signed in and lists PRs

## 2. Port the server routes

- [x] 2.1 `integrations` (slackcli + acli status) and `jira_issue`
- [x] 2.2 `slack_status`, `slack_notify` (threads file, atomic writes, dry run)
- [x] 2.3 `slack_people_get/find/save`
- [x] 2.4 `job_log`
- [x] 2.5 Carry over input validation; unit tests for validation and parsing in Rust
- [x] 2.6 Capabilities and CSP locked to lgtm's commands and the needed hosts

## 3. WebKit and native behaviour

- [x] 3.1 External links open in the default browser (opener plugin)
- [x] 3.2 In-app find bar for ⌘F
- [x] 3.3 Native notifications for review requests and re-reviews
- [x] 3.4 Dock badge with the "needs your review" count
- [x] 3.5 `lgtm://<owner>/<repo>/pull/<n>` deep links open the PR (and focus the window)
- [x] 3.6 Remember window size and position; "Launch at login" switch in Settings
- [ ] 3.7 Walk every feature in the app (Settings examples help) and fix WebKit differences

## 4. Data

- [x] 4.1 Settings → Export / Import (preferences + pending drafts as JSON), in both versions
- [x] 4.2 Show the version in Settings

## 5. Release and Homebrew

- [ ] 5.1 Create the public repo `bukuwarung/homebrew-tap` (README with install line and the quarantine note)
- [ ] 5.2 Release checklist in the README's Develop section: bump version, build UI, universal Tauri build, zip the app, package `lgtm-cli`, `gh release create` in the tap repo, update cask + formula (version, SHA-256)
- [ ] 5.3 `Casks/lgtm.rb`: depends on `gh`, macOS ≥ Ventura, quarantine postflight, caveats for slackcli/acli
- [ ] 5.4 `Formula/lgtm-cli.rb`: terminal version, depends on `node` and `gh`
- [ ] 5.5 First release; install on a clean account with `brew install --cask bukuwarung/tap/lgtm` and with `lgtm-cli`; `brew upgrade` to a second release
- [ ] 5.6 README: install via Homebrew first, building from source second
