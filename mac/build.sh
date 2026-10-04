#!/bin/bash
# Builds Patchbook.app (menu bar app) and installs it in /Applications (or ~/Applications).
# The app runs Patchbook from this project folder, so keep the folder where it is; re-run after updates.
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/mac/build"
APP="$BUILD/Patchbook.app"

echo "Building the web app…"
(cd "$ROOT" && npm run build --silent)

echo "Building Patchbook.app…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O "$ROOT/mac/Patchbook.swift" -o "$APP/Contents/MacOS/Patchbook" -framework AppKit

ICONSET="$BUILD/Patchbook.iconset"
rm -rf "$ICONSET"
swift "$ROOT/mac/make-icon.swift" "$ICONSET"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Patchbook.icns"

VERSION="$(node -p "require('$ROOT/package.json').version")"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Patchbook</string>
  <key>CFBundleDisplayName</key><string>Patchbook</string>
  <key>CFBundleIdentifier</key><string>com.patchbook.menubar</string>
  <key>CFBundleExecutable</key><string>Patchbook</string>
  <key>CFBundleIconFile</key><string>Patchbook</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>PatchbookRoot</key><string>$ROOT</string>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP" >/dev/null 2>&1 || true

if [ -w /Applications ]; then DEST="/Applications"; else DEST="$HOME/Applications"; mkdir -p "$DEST"; fi
# Quit a running copy before replacing it.
osascript -e 'tell application id "com.patchbook.menubar" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf "$DEST/Patchbook.app"
cp -R "$APP" "$DEST/"
echo "Installed $DEST/Patchbook.app"
