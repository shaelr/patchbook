#!/bin/bash
# Builds a self-contained Patchbook.app for a GitHub release: Node.js, the server, the web app and
# its libraries all live inside the app, so it runs on any Mac (Apple silicon or Intel) without
# Node or this project folder. Output: mac/build/release/Patchbook-<version>-mac.zip
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/mac/build/release"
APP="$OUT/Patchbook.app"
RES="$APP/Contents/Resources"
STAGE="$RES/patchbook"
CACHE="$ROOT/mac/build/node-cache"
VERSION="$(node -p "require('$ROOT/package.json').version")"
NODE_VERSION="$(node -v)"

echo "Building the web app…"
(cd "$ROOT" && npm run build --silent)

rm -rf "$OUT"
mkdir -p "$APP/Contents/MacOS" "$RES" "$CACHE"

echo "Building Patchbook.app (universal)…"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13" "$ROOT/mac/Patchbook.swift" -o "$OUT/Patchbook-$arch" -framework AppKit
done
lipo -create "$OUT/Patchbook-arm64" "$OUT/Patchbook-x86_64" -output "$APP/Contents/MacOS/Patchbook"
rm "$OUT/Patchbook-arm64" "$OUT/Patchbook-x86_64"

ICONSET="$OUT/Patchbook.iconset"
swift "$ROOT/mac/make-icon.swift" "$ICONSET"
iconutil -c icns "$ICONSET" -o "$RES/Patchbook.icns"
rm -rf "$ICONSET"

echo "Bundling Node.js $NODE_VERSION (universal)…"
for arch in arm64 x64; do
  tarball="$CACHE/node-$NODE_VERSION-darwin-$arch.tar.gz"
  [ -f "$tarball" ] || curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$arch.tar.gz" -o "$tarball"
  tar -xzf "$tarball" -C "$CACHE" "node-$NODE_VERSION-darwin-$arch/bin/node"
done
lipo -create "$CACHE/node-$NODE_VERSION-darwin-arm64/bin/node" "$CACHE/node-$NODE_VERSION-darwin-x64/bin/node" -output "$RES/node"

echo "Bundling Patchbook…"
# Same layout as the project folder. The shared package stays outside node_modules (linked in),
# because Node won't strip TypeScript types from files inside node_modules.
mkdir -p "$STAGE/server" "$STAGE/shared" "$STAGE/web"
cp "$ROOT/package-lock.json" "$STAGE/"
node -e "
  const p = require('$ROOT/package.json')
  p.workspaces = ['shared', 'server']
  delete p.scripts; delete p.devDependencies
  require('fs').writeFileSync('$STAGE/package.json', JSON.stringify(p, null, 2))"
for pkg in server shared; do
  cp "$ROOT/$pkg/package.json" "$STAGE/$pkg/"
  rsync -a --exclude '*.test.ts' "$ROOT/$pkg/src/" "$STAGE/$pkg/src/"
done
cp -R "$ROOT/web/dist" "$STAGE/web/dist"
# --ignore-scripts: atem-connection's font library ships prebuilt for macOS; don't compile it.
(cd "$STAGE" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
rm "$STAGE/package-lock.json"
# Only the macOS builds of the font library are needed.
FT="$STAGE/node_modules/@julusian/freetype2"
rm -rf "$FT/src" "$FT/vendor" "$FT/gyp"
find "$FT/prebuilds" -mindepth 1 -maxdepth 1 ! -name 'freetype2-darwin-*' -exec rm -rf {} +

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
  <key>LSMinimumSystemVersion</key><string>13.5</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

echo "Signing (ad hoc)…"
xattr -cr "$APP"
find "$RES" -type f \( -name node -o -name '*.node' \) -exec codesign --force --sign - {} \;
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"

ZIP="$OUT/Patchbook-$VERSION-mac.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "Built $ZIP ($(du -h "$ZIP" | cut -f1))"
