#!/usr/bin/env bash
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
ROOT_PACKAGE="$ROOT_DIR/package.json"
 
if [[ ! -f "$ROOT_PACKAGE" ]]; then
  echo "Root package.json not found at $ROOT_PACKAGE" >&2
  exit 1
fi
 
ROOT_VERSION=$(jq -r '.version' "$ROOT_PACKAGE")

WORKSPACE_DIRS=()
while IFS= read -r -d '' dir; do
  WORKSPACE_DIRS+=("$dir")
done < <(find packages -maxdepth 1 -type d -not -path "packages/node_modules" -not -path "packages/\.*" -print0)

for WS_PATH in "${WORKSPACE_DIRS[@]}"; do
  WS_JSON="$WS_PATH/package.json"
  if [[ -f "$WS_JSON" ]]; then
    WS_VERSION=$(jq -r '.version' "$WS_JSON")
    if [[ "$WS_VERSION" != "$ROOT_VERSION" ]]; then
      jq --arg v "$ROOT_VERSION" -M --indent 2 '.version=$v' "$WS_JSON" > "${WS_JSON}.tmp" && mv "${WS_JSON}.tmp" "$WS_JSON"
      echo "Synchronized version in $WS_PATH to $ROOT_VERSION"
    else
      echo "Versions in $WS_PATH are already synchronized"
    fi
  else
    echo "Workspace package.json not found at $WS_JSON" >&2
  fi
done

# The Go daemon carries its own semver literal (packages/bridge/main.go) because
# `excali-bridge version` is what the Presence host compares its bundled sidecar
# against (ADR 0014 decision 3). It is not a workspace member, so the loop above
# never sees it — keep it in step here or the shipped binary drifts silently.
BRIDGE_MAIN="$ROOT_DIR/packages/bridge/main.go"
if [[ -f "$BRIDGE_MAIN" ]]; then
  CURRENT_GO_VERSION=$(sed -n 's/^const Version = "\(.*\)"$/\1/p' "$BRIDGE_MAIN")
  if [[ "$CURRENT_GO_VERSION" != "$ROOT_VERSION" ]]; then
    sed -i.bak "s/^const Version = \".*\"$/const Version = \"$ROOT_VERSION\"/" "$BRIDGE_MAIN" && rm -f "${BRIDGE_MAIN}.bak"
    echo "Synchronized version in packages/bridge/main.go to $ROOT_VERSION"
  else
    echo "Version in packages/bridge/main.go is already synchronized"
  fi
else
  echo "Bridge main.go not found at $BRIDGE_MAIN" >&2
fi

# The Rust tray (packages/presence) is not a workspace member either; its
# Cargo.toml [package] version must track the root or release archives mislabel
# the presence binary. Only the [package] version line is touched — [dependencies]
# entries carry their own version pins and must stay untouched.
PRESENCE_CARGO="$ROOT_DIR/packages/presence/Cargo.toml"
if [[ -f "$PRESENCE_CARGO" ]]; then
  CURRENT_CARGO_VERSION=$(sed -n '/^\[package\]/,/^\[/s/^version = "\(.*\)"$/\1/p' "$PRESENCE_CARGO")
  if [[ "$CURRENT_CARGO_VERSION" != "$ROOT_VERSION" ]]; then
    sed -i.bak "/^\[package\]/,/^\[/s/^version = \".*\"$/version = \"$ROOT_VERSION\"/" "$PRESENCE_CARGO" && rm -f "${PRESENCE_CARGO}.bak"
    echo "Synchronized version in packages/presence/Cargo.toml to $ROOT_VERSION"
  else
    echo "Version in packages/presence/Cargo.toml is already synchronized"
  fi
else
  echo "Presence Cargo.toml not found at $PRESENCE_CARGO" >&2
fi

pnpm install
