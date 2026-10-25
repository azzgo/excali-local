# The Presence host: exec-not-WS, a bridge-only menu, and the sidecar overwrite protocol

ADR 0012 designed the Presence host (system tray / menubar) but did not build
it. This ADR pins down the four decisions 0012 left open: how the tray talks to
the daemon, what its menu contains, how the bundled sidecar is kept aligned
with the canonical CLI, and who writes the autostart login item.

## Status

accepted — 2026-10-25

## The decisions

**1. The tray drives the daemon by exec'ing the CLI, not by a WebSocket role.**
Every menu act and status read shells out to the canonical binary
(`excali-bridge bridge.status --json`, `lan on|off`, `autostart on|off`,
`peers list`) — the same interface an agent uses. No new WS role, no contract
change, no second auth story. The cost is a per-open-menu exec (~50ms); the menu
is pulled, not pushed, which is fine for a menu. ADR 0012 already called a
shell script a legitimate minimum Presence; this is the same shape with a
native menu around it.

**2. The menu is bridge-only — no browser-facing items.** The tray shows and
switches the local capability and nothing else:

```
daemon: running @17331 / not running        (bridge.status)
Active canvas: <name | none>
LAN: on / off                               → lan on|off
Start at login: ✓ / ✗                       → autostart on|off
Quit
```

No "open the extension" item, no peer list, no transfer progress: the offer's
answer authority is the editor page toast (ADR 0013), and anything
browser-facing would make the tray load-bearing in violation of 0012 decision 1.

**3. Sidecar alignment: `excali-bridge version` + overwrite-and-restart.** A new
`version` subcommand prints the binary's semver (version comparison is by
output, never by filename — 0012 decision 4). On start the tray compares its
bundled binary's version against the canonical path's; if they differ it
overwrites the canonical file by write-temp-then-rename (safe against a running
daemon — rename replaces the directory entry, the old inode keeps executing),
then SIGTERMs a running daemon and respawns it from the new binary. The tray is
allowed to kill a daemon the user is using: the daemon is stateless, editor
pages reconnect automatically, and the outage is under two seconds. This is the
0012 rule "an upgraded tray realigns its CLI" made concrete.

**4. The autostart write side lives in the daemon.** `internal/autostart`
gains `Enable`/`Disable` alongside `Detect`: macOS `LaunchAgent` plist, Linux
`.desktop` file, Windows per-user `Run` key (`reg add`/`reg delete`). The tray
and the Options page act only through `autostart on|off` — one login item, one
persistence location, per 0012 decision 2.

## Scope and distribution

- The tray lives in `packages/presence/` (Rust, `tray-icon` + `muda` per 0012
  decision 3), NOT a pnpm workspace member — same treatment as `packages/bridge`.
- Build matrix at launch: macOS (aarch64 + x86_64) and Linux. Windows is a
  placeholder — welcome-PR, until a maintainer with a Windows machine picks it up.
- No codesigning or notarization. This is open-source software; the artifact
  must simply build from source. Gate-on-signature would be pure ceremony for no user.
