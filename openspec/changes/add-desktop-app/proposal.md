## Why

lgtm runs as a local server plus a browser tab. That works, but it lives in a tab among others, needs a terminal to start, can't badge a Dock icon or own `lgtm://` links, and the local port brings its own chores (Host and `Sec-Fetch-Site` guards, replacing a stale `lgtm` after an update). Teammates want to install it the usual way. A macOS desktop app, installed with Homebrew, fixes all of that while keeping the review UI exactly as it is.

## What Changes

- New macOS desktop app built with **Tauri 2**: its own window and Dock icon, loading the same review UI (`app/src`) bundled into the app. No local server or port.
- The six local-server routes (`/token`, `/slack`, `/slack-people`, `/jira`, `/job-log`, `/integrations`) become **Rust commands** that run the same CLIs (`gh`, `slackcli`, `acli`) and read/write the same files in `~/.config/lgtm/`. `src/platform.ts` gets a desktop implementation chosen at build time; nothing else in the UI changes.
- **Native extras:** Dock badge with the "needs your review" count, native notifications, `lgtm://` links (open a PR in the app), external links opening in the default browser, remembered window size and position, and an opt-in "Launch at login" setting.
- **Releases:** a GitHub Actions workflow builds a universal (Apple Silicon + Intel), ad-hoc-signed app on a version tag and publishes it to a **public** repo, `bukuwarung/homebrew-tap`, which is also the Homebrew tap.
- **Homebrew:** `brew install --cask bukuwarung/tap/lgtm` installs the app (depends on `gh`; the cask clears macOS quarantine, since the app isn't notarized). `brew install bukuwarung/tap/lgtm-cli` installs today's terminal `lgtm` (browser version). `brew upgrade` handles updates.
- The browser version keeps working from the same code.

## Non-goals

- **Apple Developer signing and notarization.** Not using an Apple Developer account; the app is ad-hoc signed and the cask clears quarantine instead (see design, decision 5).
- In-app auto-updater (Homebrew updates it), Windows and Linux builds, a menu-bar queue, Mac App Store.
- Changing the review UI itself.

## Capabilities

### New Capabilities
- `desktop-app`: the Tauri app: window, bundled UI, local commands replacing the server routes, native extras.
- `distribution`: release workflow, public releases repo and Homebrew tap (cask for the app, formula for the terminal version).

### Modified Capabilities
None. `github-auth`, `slack-notify` and the rest keep their behaviour; only where the page reaches the CLIs changes (server route → Tauri command).

## Impact

- New `desktop/` (Tauri 2 project: Rust crate, `tauri.conf.json`, capabilities, icons) building `app/`'s UI.
- `app/src/platform.ts` split into a web and a desktop implementation behind the same exports; `vite build --mode desktop` selects it.
- New public repo `bukuwarung/homebrew-tap` (cask, formula, release assets) and a release workflow in `bukuwarung/lgtm` with a token that can publish there.
- Build machines need Rust (`rustup`) and Xcode command-line tools; users need neither.
- Pending draft comments live in the browser's storage and don't move to the app by themselves (design, decision 7).
