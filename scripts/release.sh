#!/bin/bash
# Builds release X.Y.Z on this Mac: a universal lgtm.app (zip) and the browser version (tar.gz), and points
# Casks/lgtm.rb and Formula/lgtm-cli.rb at them. Publishing is up to you; the script prints the commands.
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
ditto -c -k --keepParent desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos/lgtm.app "$out/lgtm-$v.zip"
tar -czf "$out/lgtm-cli-$v.tar.gz" -C app bin dist package.json claude-skill.md

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
sed -i '' -E "s/^  version \"[^\"]*\"/  version \"$v\"/; s/^  sha256 \"[^\"]*\"/  sha256 \"$(sha "$out/lgtm-$v.zip")\"/" Casks/lgtm.rb
sed -i '' -E "s#/v[^/]*/lgtm-cli-[^/]*\.tar\.gz\"#/v$v/lgtm-cli-$v.tar.gz\"#; s/^  sha256 \"[^\"]*\"/  sha256 \"$(sha "$out/lgtm-cli-$v.tar.gz")\"/" Formula/lgtm-cli.rb

cat <<MSG

Built $out/lgtm-$v.zip and $out/lgtm-cli-$v.tar.gz. To publish:
  git commit -am "Release $v" && git push origin HEAD:main
  gh release create v$v --repo bukuwarung/lgtm --title "lgtm $v" --generate-notes $out/lgtm-$v.zip $out/lgtm-cli-$v.tar.gz
Then check: brew update && brew upgrade --cask lgtm (or brew install, see the README).
MSG
