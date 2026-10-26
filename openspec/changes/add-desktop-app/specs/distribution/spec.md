## ADDED Requirements

### Requirement: Install and upgrade with Homebrew
Users SHALL install the app with `brew install --cask bukuwarung/tap/lgtm` and the terminal version with `brew install bukuwarung/tap/lgtm-cli`, and get new versions with `brew upgrade`. The cask SHALL depend on `gh`, require macOS 13 or later, and mention slackcli and acli as optional. Because the app is not notarized, the cask SHALL clear the macOS quarantine flag after installing so the app opens without a Gatekeeper prompt.

#### Scenario: Teammate installs
- **WHEN** a teammate runs `brew install --cask bukuwarung/tap/lgtm`
- **THEN** `gh` is installed if missing, lgtm.app lands in /Applications, and it opens on the first double-click

#### Scenario: Upgrade
- **WHEN** a new version is released and the user runs `brew upgrade`
- **THEN** the app is replaced by the new version and still opens without a prompt

### Requirement: Public tap with release assets, private source
The tap and the release assets SHALL live in the public repo `bukuwarung/homebrew-tap` (cask, formula, GitHub Releases); the source SHALL stay in the private `bukuwarung/lgtm`.

#### Scenario: Anonymous download
- **WHEN** Homebrew downloads the release asset without any GitHub login
- **THEN** the download succeeds, while the source repo stays private

### Requirement: Documented manual releases
The repo SHALL document the release steps a maintainer runs on their Mac: bump the version, build a universal, ad-hoc-signed `lgtm.app` and the terminal package, publish them as a release in the tap repo, and update the cask and formula (version and SHA-256). The version SHALL show in Settings.

#### Scenario: Releasing v0.2.0
- **WHEN** a maintainer follows the checklist for `0.2.0`
- **THEN** the tap has release v0.2.0 with `lgtm-0.2.0.zip` and `lgtm-cli-0.2.0.tar.gz`, the cask and formula point at them with matching checksums, `brew upgrade` installs it, and the app's Settings shows 0.2.0
