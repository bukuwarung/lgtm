#!/bin/sh
# Builds the app's icons (../*.png, ../icon.icns) from the glass icon (make.swift). Run from this folder.
set -e
swift make.swift
at="@" # the retina suffix's @, kept apart (a PII checker took the file names for email addresses)
rm -rf AppIcon.iconset && mkdir AppIcon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s icon-1024.png --out AppIcon.iconset/icon_${s}x${s}.png >/dev/null
  d=$((s * 2)); sips -z $d $d icon-1024.png --out "AppIcon.iconset/icon_${s}x${s}${at}2x.png" >/dev/null
done
iconutil -c icns AppIcon.iconset -o ../icon.icns
sips -z 32 32 icon-1024.png --out ../32x32.png >/dev/null
sips -z 128 128 icon-1024.png --out ../128x128.png >/dev/null
sips -z 256 256 icon-1024.png --out "../128x128${at}2x.png" >/dev/null
sips -z 512 512 icon-1024.png --out ../icon.png >/dev/null
rm -rf AppIcon.iconset icon-1024.png
echo done
