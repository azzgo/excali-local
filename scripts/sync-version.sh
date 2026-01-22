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

bun install
