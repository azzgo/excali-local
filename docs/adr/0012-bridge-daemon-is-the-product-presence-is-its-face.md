# The Bridge daemon is the product; Presence is a replaceable face; CLI artifacts leave git

The extension's local capabilities have always been materially present but
*experientially absent*: nothing runs until an agent runs a CLI command, and the
only visibility is a passive pill on the Options page. The instinct is to fix
that with a resident desktop app (a "workbench"). This ADR records the shape we
actually chose, because the obvious shape — one GUI program that owns
everything — is the wrong one and will be re-proposed.

## Status

accepted — 2026-10-01 (chat-time; supersedes the `skills/excali-local/bin/` clause
of [AGENTS.md](../../AGENTS.md), see *Consequences*)

## The decision

**1. The daemon is the subject; the tray is a face.** `packages/bridge` (the Go
Bridge daemon) is the only thing that *is* the local capability. It owns the
local-only surface, the LAN listener, discovery, and autostart registration. A
Presence host (system tray / menubar) is a **replaceable client** of it: it holds
no protocol, no capability the daemon lacks, and its death degrades visibility
only. A shell script printing status is a legitimate minimum Presence.

The rejected alternative was a single resident GUI application that both *is* the
daemon and *shows* it. Rejected because it couples two very different change
rates (protocol vs. menu chrome), forces the protocol into whatever UI stack the
tray needs, and makes "I don't want a tray app" mean "I can't have the bridge".

**2. Autostart and the LAN switch are daemon capabilities, not tray features.**
`excali-bridge autostart on|off|status` and `excali-bridge lan on|off|status` are
the single source of truth. The tray menu and the extension's Options page are
both viewers/actors over those; there is never a second persistence location, and
there are never two login items.

**3. The tray stack is `tray-icon` + `muda`, not Tauri.** No window, no webview,
no bundler is needed for a fixed six-item menu. Tauri's tray layer *is*
`tray-icon` + `muda`; adopting Tauri would add a web application shell to a
program that never draws HTML. Note the earlier objection ("a Go tray needs cgo,
which collides with `CGO_ENABLED=0`") only holds for one binary — the Presence
host is a separate program, so cgo was never the blocker; the blocker is stack
weight.

**4. CLI distribution: one canonical binary per machine, artifacts out of git.**
The CLI stays Go (zero runtime for an agent's fast draw→render→fix loop; the
4-target cross-compile and static-link gates already exist and are paid for), but
its **build products leave the source tree**:

- binaries are released as GitHub release assets, not committed;
- `skills/excali-local/bin/` becomes empty/downloaded-on-demand, and
  `pnpm skill:check` gains a guard that no executable may reappear there;
- a single canonical install location is the only copy that may exist:
  `~/.local/bin/excali-bridge-<os>-<arch>` (real file) + `~/.local/bin/excali-bridge`
  (symlink); `%LOCALAPPDATA%\ExcaliLocal\bin\` on Windows. The tray **bundles its own
  sidecar** and is the owner of that path: on start, if the installed binary's version
  differs from its bundled one, it **overwrites** it (an upgraded tray realigns its CLI,
  so a tray and its CLI can never be a mismatched pair). The skill preflight installs
  **only when the path is empty** and otherwise uses whatever is there — never
  overwrites, never downgrades. Exactly one side may write, so overwriting cannot become
  a downgrade loop. Overwriting a binary the daemon is currently running requires
  restarting the daemon (the tray does it in the same act);
- version comparison is by `excali-bridge version`, **not** by filename — no
  version-suffixed paths, so N versions can never co-exist;
- `EXCALI_BRIDGE_BIN` is an explicit override for development only; there is no
  silent fallback to a second copy;
- `~/.local/bin` is not on every PATH. The preflight **prints** the one-line
  export to add; it never edits the user's shell rc files.

**5. State and config leave `~`, and leave each other.** Executables live in the
conventional bin dir; mutable state and config follow the platform convention
(`XDG_STATE_HOME`/`XDG_CONFIG_HOME` on Linux,
`~/Library/Application Support/excali-local/` on macOS, `%LOCALAPPDATA%` on
Windows) rather than accumulating more dot-directories. `~/.excali-local/` is
migrated once and left behind as a tombstone for one release cycle.

## Consequences

- **`AGENTS.md`'s "`skills/excali-local/bin/` is COMMITTED (source-is-the-artifact)"
  hard constraint is superseded.** The skill dir stays the *teaching* artifact; it
  stops being the *binary* artifact. `scripts/skill-pack.ts` keeps the
  cross-compile + static-verify gates but writes to the OS temp dir and an upload
  directory instead of the repo; `.github/workflows/release.yml` gains the binary
  assets, `checksums.txt`, and a binary-free skill tarball.
- The existing `~/.excali-local/bridge.pid` (and `bridge.log`) relocate; both
  `pidfile` and the CLI's lazy-spawn path must read the old location once to
  migrate, or users silently get a second daemon.
- Removing committed binaries rewrites what a source checkout can do offline: a
  fresh clone can no longer `ping` without a download. That is the accepted cost
  of not maintaining binaries in git.
- The tray never becomes load-bearing: any future feature that only works when
  the tray is installed is a violation of decision 1.
