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

## Build

```bash
cargo build --release   # target/release/excali-presence
cargo test              # status/JSON parsing against fake CLI scripts
cargo clippy -- -D warnings
```

Not a pnpm workspace member, same treatment as `packages/bridge`.
