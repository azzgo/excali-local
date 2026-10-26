#!/usr/bin/env bash
# Assemble a double-clickable `Excali Presence.app` from the cargo binary.
#
# ADR 0014: Presence is the face of the bridge daemon. The tray execs the
# canonical CLI, but ships its own sidecar next to the executable so the bundle
# is self-contained; src/sidecar.rs looks for `excali-bridge` beside the exe
# before falling back to Contents/Resources.
#
# Usage: pnpm presence:app
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PRESENCE_DIR="$ROOT/packages/presence"
BIN="$PRESENCE_DIR/target/release/excali-presence"
SIDECAR="$ROOT/packages/bridge/bin/excali-bridge"
APP="$PRESENCE_DIR/target/Excali Presence.app"
CONTENTS="$APP/Contents"

fail() {
  echo "[presence-app] FAIL — $*" >&2
  exit 1
}

[ -f "$BIN" ] || fail "missing $BIN (run: cargo build --release in packages/presence)"
[ -f "$SIDECAR" ] || fail "missing $SIDECAR (run: pnpm bridge:build)"

VERSION="$(node -p "require('$ROOT/package.json').version")"
[ -n "$VERSION" ] || fail "could not read version from $ROOT/package.json"

rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

cp "$BIN" "$CONTENTS/MacOS/excali-presence"
cp "$SIDECAR" "$CONTENTS/MacOS/excali-bridge"
chmod +x "$CONTENTS/MacOS/excali-presence" "$CONTENTS/MacOS/excali-bridge"

PLIST="$CONTENTS/Info.plist"
plutil -create xml1 "$PLIST"
plutil -insert CFBundleIdentifier -string "com.excali-local.presence" "$PLIST"
plutil -insert CFBundleName -string "Excali Presence" "$PLIST"
plutil -insert CFBundleDisplayName -string "Excali Presence" "$PLIST"
plutil -insert CFBundleExecutable -string "excali-presence" "$PLIST"
plutil -insert CFBundlePackageType -string "APPL" "$PLIST"
plutil -insert CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -insert CFBundleVersion -string "$VERSION" "$PLIST"
plutil -insert LSUIElement -bool true "$PLIST"
plutil -insert NSHighResolutionCapable -bool true "$PLIST"
plutil -insert LSMinimumSystemVersion -string "13.0" "$PLIST"

"$PRESENCE_DIR/make-icon.sh" "$CONTENTS/Resources/AppIcon.icns"
plutil -insert CFBundleIconFile -string "AppIcon" "$PLIST"

codesign --force --sign - --timestamp=none "$CONTENTS/MacOS/excali-bridge"
codesign --force --sign - --timestamp=none "$CONTENTS/MacOS/excali-presence"
codesign --force --sign - --timestamp=none "$APP"

echo "[presence-app] ✓ $APP (version $VERSION)"
