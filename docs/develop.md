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

`cargo test -- --ignored --nocapture` in `desktop/src-tauri` checks the app's commands against your real gh, slackcli and acli (read-only; Slack in dry run).

## The browser version

The same UI, served by Node 22+ in your browser: `brew install bukuwarung/lgtm/lgtm-cli`, or from source `cd app && npm install && npm run build && npm link`. Then `lgtm`, or `lgtm <PR link>`.

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

It sets the version everywhere, runs the tests, builds a universal `lgtm.app` and the browser version's tarball, points [`Casks/lgtm.rb`](../Casks/lgtm.rb) and [`Formula/lgtm-cli.rb`](../Formula/lgtm-cli.rb) at them, and prints the two publishing commands. This repo is its own Homebrew tap, so `brew upgrade` picks the release up once it's out.

Design and specs: [`openspec/`](../openspec).
