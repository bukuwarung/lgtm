# Develop

`app/` is the UI (Preact) and a small Node server for the browser version; `desktop/` wraps the same UI in the Mac app with [Tauri](https://tauri.app).

```bash
cd app
npm test        # logic checks
npm start       # build, then run the browser version on port 4517
npm run demos   # recapture docs/features/*.png (lgtm must be running)
```

## The Mac app

Needs Rust:

```bash
brew install rustup && rustup default stable
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"   # rustup is keg-only
cd desktop && npm install && npm run build         # → src-tauri/target/release/bundle/macos/lgtm.app
```

`npm run smoke` in `app/` (after `npm run build`) runs the built app end to end in headless Chrome on made-up GitHub data: the PR list, a PR, a line comment, Finish review and Submit. It fails on an uncaught error or a `confirm()`/`alert()`/`prompt()` (the Mac app answers those without asking), and the release script runs it.

`cargo test -- --ignored --nocapture` in `desktop/src-tauri` checks the app's commands against your real gh, slackcli and acli (read-only; Slack in dry run).

## The browser version

For development and testing only (it isn't released): the same UI, served by Node 22+ in your browser. From source, `cd app && npm install && npm run build && npm link`, then `lgtm-web`, or `lgtm-web <PR link>`. (`lgtm` is the app's own command, installed by the cask: it opens the app.)

| Variable | Effect |
|---|---|
| `LGTM_PORT` | The port (drafts are stored per port) |
| `LGTM_NO_OPEN=1` | Don't open a tab |
| `LGTM_SLACK_DRY_RUN=1` | Check Slack recipients without sending |

Settings → Backup moves preferences and pending comments between it and the app.

## Releasing

Needs both Mac targets (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`):

```bash
scripts/release.sh X.Y.Z
```

It sets the version everywhere, runs the tests, builds a universal `lgtm.app`, points [`Casks/lgtm.rb`](../Casks/lgtm.rb) at it, and prints the two publishing commands. This repo is its own Homebrew tap, so `brew upgrade` picks the release up once it's out.

Design and specs: [`openspec/`](../openspec).
