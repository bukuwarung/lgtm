## ADDED Requirements

### Requirement: Install and upgrade with Homebrew
Users SHALL tap the source repo (`brew tap bukuwarung/lgtm https://github.com/bukuwarung/lgtm`), install the app with `brew install --cask bukuwarung/lgtm/lgtm` and the terminal version with `brew install bukuwarung/lgtm/lgtm-cli`, and get new versions with `brew upgrade`. The cask SHALL depend on `gh`, require macOS 13 or later, and mention slackcli and acli as optional. Because the app is not notarized, the cask SHALL clear the macOS quarantine flag after installing so the app opens without a Gatekeeper prompt.

#### Scenario: Teammate installs
- **WHEN** a teammate taps the repo and runs `brew install --cask bukuwarung/lgtm/lgtm`
- **THEN** `gh` is installed if missing, lgtm.app lands in /Applications, and it opens on the first double-click

#### Scenario: Upgrade
- **WHEN** a new version is released and the user runs `brew upgrade`
- **THEN** the app is replaced by the new version and still opens without a prompt

### Requirement: The public source repo is the tap
The public `bukuwarung/lgtm` SHALL hold the cask (`Casks/lgtm.rb`), the formula (`Formula/lgtm-cli.rb`) and the release assets (GitHub Releases).

#### Scenario: Anonymous download
- **WHEN** Homebrew downloads the release asset without any GitHub login
- **THEN** the download succeeds

### Requirement: Documented manual releases
A script (`scripts/release.sh X.Y.Z`), run on a maintainer's Mac, SHALL set the version, build a universal, ad-hoc-signed `lgtm.app` and the terminal package, and update the cask and formula (version and SHA-256); the maintainer then pushes and publishes the GitHub release, as the README documents. The version SHALL show in Settings.

#### Scenario: Releasing v0.2.0
- **WHEN** a maintainer runs the script for `0.2.0` and publishes
- **THEN** the repo has release v0.2.0 with `lgtm-0.2.0.zip` and `lgtm-cli-0.2.0.tar.gz`, the cask and formula point at them with matching checksums, `brew upgrade` installs it, and the app's Settings shows 0.2.0
