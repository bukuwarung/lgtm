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

Write the notes in `docs/releases/X.Y.Z.md`, then:

```bash
scripts/release.sh X.Y.Z
```

It sets the version everywhere, refreshes the third-party notices, runs the tests, and commits and tags `vX.Y.Z`. Pushing the tag (the script prints the command) releases: [GitHub Actions](../.github/workflows/release.yml) builds a universal `lgtm.app`, runs the smoke test on it, signs it, publishes the release with your notes, and points [`Casks/lgtm.rb`](../Casks/lgtm.rb) at it. This repo is its own Homebrew tap, so `brew upgrade` picks the release up once it's out. Running the workflow by hand builds and signs only, and keeps the zip.

**Signing.** Releases are signed with lgtm's own certificate, "lgtm Code Signing" (self-signed, valid to 2046), by [`scripts/sign.sh`](../scripts/sign.sh). It must be the same certificate every time: macOS remembers what people allowed lgtm (Files and Folders, data from other apps) by it, and asks again if it changes. It's in the repo's secrets as `LGTM_SIGNING_P12` (the `.p12`, base64) and `LGTM_SIGNING_PASSWORD`; keep the `.p12` and its password somewhere safe too, since secrets can't be read back. It isn't an Apple Developer ID, so lgtm still isn't notarized: the cask clears the quarantine flag as before.

Design and specs: [`openspec/`](../openspec).
