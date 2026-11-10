#!/bin/bash
# Signs lgtm.app with lgtm's own certificate ("lgtm Code Signing", self-signed): the same one every release, so macOS
# keeps what people allowed lgtm (Files and Folders, data from other apps) across updates. An ad-hoc signature changes
# with every build, and macOS asks again. The certificate comes as LGTM_SIGNING_P12 (the .p12, base64) and
# LGTM_SIGNING_PASSWORD, and lives in a throwaway keychain while it signs.
set -euo pipefail
# It puts a keychain of its own on the search list while it signs: fine on a throwaway CI runner, not on your Mac
# (a list that isn't put back exactly loses your login keychain, and every saved sign-in with it).
[ "${CI:-}" = true ] || { echo "scripts/sign.sh runs on CI only (.github/workflows/release.yml): it changes the keychain search list" >&2; exit 1; }
app=${1:?usage: scripts/sign.sh path/to/lgtm.app}
: "${LGTM_SIGNING_P12:?the .p12, base64}" "${LGTM_SIGNING_PASSWORD:?its password}"
tmp=$(mktemp -d)
kc="$tmp/signing.keychain-db"
kp=$(openssl rand -hex 16)
orig=()
while IFS= read -r k; do orig+=("$k"); done < <(security list-keychains -d user | sed -E 's/^ *"(.*)"$/\1/')
cleanup() {
  security list-keychains -d user -s "${orig[@]}"
  security delete-keychain "$kc" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT
printf '%s' "$LGTM_SIGNING_P12" | base64 -D > "$tmp/cert.p12"
security create-keychain -p "$kp" "$kc"
security set-keychain-settings "$kc"
security unlock-keychain -p "$kp" "$kc"
security import "$tmp/cert.p12" -k "$kc" -P "$LGTM_SIGNING_PASSWORD" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "$kp" "$kc" >/dev/null
security list-keychains -d user -s "$kc" "${orig[@]}" # codesign looks for identities on the search list only
# Self-signed, so not trusted: codesign takes it by its hash, not its name.
id=$(security find-identity -p codesigning "$kc" | awk '/"lgtm Code Signing"/ { print $2; exit }')
[ -n "$id" ] || { echo "No lgtm Code Signing identity in the .p12" >&2; exit 1; }
codesign --force --deep --options runtime --timestamp=none -s "$id" "$app"
codesign --verify --deep --strict "$app"
# What macOS remembers permissions by: this certificate, not the build.
codesign -d -r- "$app" 2>&1 | grep -q 'certificate root = H"' || { echo "$app isn't signed with the certificate" >&2; exit 1; }
echo "Signed $app with lgtm Code Signing ($id)"
