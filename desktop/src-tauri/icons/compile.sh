#!/bin/sh
# Builds macOS 26's icon (AppIcon.icon: light, dark and tinted) into an app as its Assets.car, beside icon.icns, which
# older macOS keeps using. Needs Xcode 26's actool: the release build's machine has it (a Mac without Xcode keeps the
# one icon). Usage: compile.sh path/to/lgtm.app
set -e
app=$1
here=$(cd "$(dirname "$0")" && pwd)
x=$(ls -d /Applications/Xcode_26*.app 2>/dev/null | sort -V | tail -1)
[ -n "$x" ] && export DEVELOPER_DIR="$x/Contents/Developer"
xcodebuild -version | head -1
out=$(mktemp -d)
xcrun actool "$here/AppIcon.icon" --compile "$out" --platform macosx --target-device mac --minimum-deployment-target 11.0 \
  --app-icon AppIcon --output-partial-info-plist "$out/partial.plist" --output-format human-readable-text --notices --warnings --errors
ls "$out"
cp "$out/Assets.car" "$app/Contents/Resources/"
/usr/libexec/PlistBuddy -c 'Delete :CFBundleIconName' "$app/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleIconName string AppIcon' "$app/Contents/Info.plist"
