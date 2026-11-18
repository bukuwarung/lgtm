#!/bin/bash
# Signs a lgtm.app built on your Mac with a certificate in your login keychain, so macOS keeps what you allowed lgtm
# (Files and Folders…) across your own rebuilds, as scripts/sign.sh does for releases. An ad-hoc signature (what a
# local build gets) changes with every build, and macOS asks again.
# It only reads your keychain: the certificate is yours to add (Keychain Access → Certificate Assistant → Create a
# Certificate…, name "lgtm Local Signing", type Code Signing; or import the release's "lgtm Code Signing" .p12, and
# local builds then share their permissions with the releases). Without one it leaves the build as it is.
set -euo pipefail
app=${1:-"$(dirname "$0")/../desktop/src-tauri/target/release/bundle/macos/lgtm.app"}
# Self-signed, so not trusted: codesign takes it by its hash, not its name. The release's certificate first.
id=$(security find-identity -p codesigning | awk '/"lgtm Code Signing"/ { print $2; exit }')
[ -n "$id" ] || id=$(security find-identity -p codesigning | awk '/"lgtm Local Signing"/ { print $2; exit }')
if [ -z "$id" ]; then
  echo "No \"lgtm Code Signing\" or \"lgtm Local Signing\" certificate in your keychain: $app keeps its ad-hoc signature (macOS will ask for permissions again)" >&2
  exit 0
fi
codesign --force --deep --options runtime --timestamp=none -s "$id" "$app"
codesign --verify --deep --strict "$app"
# What macOS remembers permissions by: the certificate (a self-signed one is its own leaf), not the build.
codesign -d -r- "$app" 2>&1 | grep -Eq 'certificate (root|leaf) = H"' || { echo "$app isn't signed with the certificate" >&2; exit 1; }
echo "Signed $app with $(security find-identity -p codesigning | awk -v id="$id" '$2 == id { $1 = $2 = ""; print; exit }' | xargs)"
