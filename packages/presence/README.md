# excali-presence

The Presence host (ADR 0014): a macOS menu-bar tray that drives the Agent Bridge
daemon by exec'ing the canonical `excali-bridge` CLI. No WS role, no contract
change — the menu is bridge-only and pulled on open.

```
daemon: running @17331 / not running     ← excali-bridge status
active canvas: <profileId | none>        ← excali-bridge bridge.status
LAN: on / off                            → excali-bridge lan on|off
start at login: ✓ / ✗                    → excali-bridge autostart on|off
Quit
```

`tray-icon` + `muda` on a `winit` event loop (macOS needs a main-thread event
loop for the tray to appear at all). State refreshes on a 2s timer through an
`EventLoopProxy`; menu labels are updated in place with `MenuItem::set_text`.

## Binary lookup

1. `EXCALI_BRIDGE_BIN` if set and a file.
2. `~/.local/bin/excali-bridge` (ADR 0012 decision 4).

If neither exists every item reads `not installed` and clicks are no-ops.

## Sidecar alignment

On start (before the menu is built) the tray compares its bundled sidecar's
`version` output against the canonical path's (ADR 0014 decision 3):

- equal → nothing happens;
- different (or missing) → the canonical file is overwritten by
  write-temp-then-rename (the running daemon keeps its old inode), then a
  running daemon is SIGTERMed (SIGKILL after 5s) and `serve` is respawned
  detached from the new binary;
- `EXCALI_BRIDGE_BIN` set → alignment is skipped entirely (dev override).

Failures are logged to stderr and `$STATE_DIR/presence.log`; the tray keeps
running — Presence never degrades capability, only visibility.

## Build

```bash
cargo build --release   # target/release/excali-presence
cargo test              # status/JSON parsing against fake CLI scripts
cargo clippy -- -D warnings
```

To assemble the double-clickable menu-bar bundle (requires
`packages/bridge/bin/excali-bridge`, built with `pnpm bridge:build`):

```bash
pnpm presence:app       # → packages/presence/target/Excali Presence.app
```

The bundle carries the cargo binary plus its `excali-bridge` sidecar in
`Contents/MacOS/`, an `Info.plist` with `LSUIElement` (no Dock icon), and an
ad-hoc signature. Not signed with a certificate and not notarized (ADR 0014).


Not a pnpm workspace member, same treatment as `packages/bridge`.
