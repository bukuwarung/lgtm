#!/bin/bash
# Starts release X.Y.Z: one version everywhere, the third-party notices current, the tests, then a "Release X.Y.Z"
# commit and its tag vX.Y.Z. Pushing the tag (the command is printed) is what releases: GitHub Actions
# (.github/workflows/release.yml) builds the universal app, signs it with lgtm's certificate, publishes the release
# with docs/releases/X.Y.Z.md as its notes, and points Casks/lgtm.rb at it.
set -euo pipefail
v=${1:?usage: scripts/release.sh X.Y.Z}
cd "$(dirname "$0")/.."
[ -f "docs/releases/$v.md" ] || { echo "Write the release notes first: docs/releases/$v.md" >&2; exit 1; }
[ -z "$(git status --porcelain -- . ':!.claude')" ] || { echo "Commit or set aside your changes first" >&2; exit 1; }

# The UI shows app/package.json's version, the app bundle takes tauri.conf.json's.
(cd app && npm version "$v" --no-git-tag-version --allow-same-version >/dev/null)
sed -i '' -E "s/^  \"version\": \"[^\"]*\"/  \"version\": \"$v\"/" desktop/src-tauri/tauri.conf.json
sed -i '' -E "1,5 s/^version = \"[^\"]*\"/version = \"$v\"/" desktop/src-tauri/Cargo.toml
(cd desktop/src-tauri && cargo metadata --format-version 1 >/dev/null) # Cargo.lock takes the new version
node scripts/notices.mjs # the licenses of everything in this release, current
(cd app && npm test)

git add -A app/package.json app/package-lock.json desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock THIRD-PARTY-NOTICES.md "docs/releases/$v.md"
git commit -m "Release $v"
git tag -a "v$v" -m "lgtm $v"
cat <<MSG

Ready. To release: git push origin HEAD:main "v$v"
GitHub Actions builds, signs and publishes it, then updates the cask: https://github.com/bukuwarung/lgtm/actions
MSG
