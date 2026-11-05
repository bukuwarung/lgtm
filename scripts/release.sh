#!/bin/bash
# Builds release X.Y.Z on this Mac: a universal lgtm.app (zip), and points Casks/lgtm.rb at it. Publishing is up to
# you; the script prints the commands. (The browser version is for development only: it isn't released.)
# Needs Rust with both Mac targets: rustup target add aarch64-apple-darwin x86_64-apple-darwin
set -euo pipefail
v=${1:?usage: scripts/release.sh X.Y.Z}
cd "$(dirname "$0")/.."
out=desktop/src-tauri/target/release-assets
rm -rf "$out" && mkdir -p "$out"

# One version everywhere: the UI shows app/package.json's, the app bundle takes tauri.conf.json's.
(cd app && npm version "$v" --no-git-tag-version --allow-same-version >/dev/null)
sed -i '' -E "s/^  \"version\": \"[^\"]*\"/  \"version\": \"$v\"/" desktop/src-tauri/tauri.conf.json
sed -i '' -E "1,5 s/^version = \"[^\"]*\"/version = \"$v\"/" desktop/src-tauri/Cargo.toml

node scripts/notices.mjs # the licenses of everything in this release, current
export LGTM_RELEASE=1 # a release build: no DEV badge
(cd app && npm ci && npm test)
(cd desktop && npm ci && npm run build -- --target universal-apple-darwin) # builds app/ first
(cd app && npm run smoke) # the built app, end to end on made-up GitHub data: list, PR, comment, submit
ditto -c -k --keepParent desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos/lgtm.app "$out/lgtm-$v.zip"

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
# The app's `lgtm` command (desktop/src-tauri/bin/lgtm), on the PATH through the cask; from 0.8.1, the first release with it.
grep -q 'binary "#{appdir}/lgtm.app/Contents/Resources/bin/lgtm"' Casks/lgtm.rb || sed -i '' -E 's|^  app "lgtm.app"$|  app "lgtm.app"\
  binary "#{appdir}/lgtm.app/Contents/Resources/bin/lgtm" # `lgtm [PR link]` opens the app|' Casks/lgtm.rb
sed -i '' -E "s/^  version \"[^\"]*\"/  version \"$v\"/; s/^  sha256 \"[^\"]*\"/  sha256 \"$(sha "$out/lgtm-$v.zip")\"/" Casks/lgtm.rb

cat <<MSG

Built $out/lgtm-$v.zip. To publish:
  git commit -am "Release $v" && git push origin HEAD:main
  gh release create v$v --repo bukuwarung/lgtm --title "lgtm $v" --generate-notes $out/lgtm-$v.zip
Then check: brew update && brew upgrade --cask lgtm (or brew install, see the README).
MSG
