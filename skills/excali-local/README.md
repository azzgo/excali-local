# excali-local — the Agent-agnostic drawing skill

A self-contained skill that teaches any coding agent to drive the **Excali
Local** editor (a local-first browser extension running Excalidraw fully
offline) through one small CLI: `excali-bridge`.

- **Read** [`SKILL.md`](SKILL.md) first — overview, consent model, routing.
- **Reference docs** live in [`references/`](references/) (command surface,
  element templates, JSON schema, color palette, style presets, shape grammar,
  workflows).
- **The daemon** is bundled pre-built for four platforms under [`bin/`](bin/).
  It is BOTH the WS server the editor page connects to (Leg B) AND the agent
  CLI you invoke (Leg A) — one binary, launched lazily on first use.

## Install

### Quick Install (Recommended)

Paste this into your AI agent (Claude, Codex, Cursor, Pi, Gemini CLI, etc.) — it will handle everything for you:

> Install the excali-local skill from azzgo/excali-local. After installing,
> use it to start the daemon by running `excali-bridge ping` from the skill's
> bin directory. I'm on macOS Apple Silicon.

That's it. The agent will install the skill, detect your platform, and start the daemon.
Once the daemon is running, open the Excali Local extension in your browser —
it will detect the daemon and offer pairing (popup: "Paired"; canvas button: ready → activate).

### Manual Install

If you prefer to install yourself, use the [`skills`](https://github.com/vercel-labs/skills) CLI
(npm package `skills`, maintained by **vercel-labs/skills**):

```bash
npx skills add azzgo/excali-local --skill excali-local -y
```

Read-only discovery (`--list`) confirms the skill exists and is named
`excali-local` before installing:

```bash
npx skills add azzgo/excali-local --list
```

Then start the daemon by telling your agent:

> **"Use the excali-local skill: run excali-bridge ping"**

Or run it yourself from the skill folder (see [Picking your binary](#picking-your-binary) below).

> **Installing is not enough — you must start the daemon.**
> The pairing condition is a **running daemon**, and the daemon only spawns
> lazily on first use. Only then does the extension detect it and offer pairing

## Picking your binary

| Platform | Binary |
| --- | --- |
| macOS (Apple Silicon) | `bin/excali-bridge-darwin-arm64` |
| macOS (Intel) | `bin/excali-bridge-darwin-amd64` |
| Linux (x86-64) | `bin/excali-bridge-linux-amd64` |
| Windows (x86-64) | `bin/excali-bridge-windows-amd64.exe` |

Verify: `bin/excali-bridge-<your-platform> ping` → prints `"pong"`. The
human-facing way to start it is to tell your agent: **"Use the excali-local
skill: run excali-bridge ping"** — the first invocation starts the daemon
(lazy spawn) — the local bridge your canvas connects to (or run `excali-bridge serve` yourself).

## Built binaries (static, dependency-free)

Built with `CGO_ENABLED=0 -trimpath -buildvcs=false -ldflags="-s -w"` (pure Go, cgo disabled,
symbols stripped) and **verified dep-free** per target: Linux is fully
statically linked (no glibc); Windows imports only `kernel32.dll` (no MSVC
runtime, no libgcc, no libwinpthread); macOS links only Apple system
libraries. Actual sizes are recorded below at pack time.

<!-- PACK-SIZES-BEGIN -->
| `excali-bridge-darwin-arm64` | 6.37 MiB | Apple system libs only: /usr/lib/libSystem.B.dylib, /usr/lib/libresolv.9.dylib, /System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation, /System/Library/Frameworks/Security.framework/Versions/A/Security |
| `excali-bridge-darwin-amd64` | 6.86 MiB | Apple system libs only: /usr/lib/libSystem.B.dylib, /usr/lib/libresolv.9.dylib, /System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation, /System/Library/Frameworks/Security.framework/Versions/A/Security |
| `excali-bridge-linux-amd64` | 6.73 MiB | statically linked (file) |
| `excali-bridge-windows-amd64.exe` | 6.93 MiB | imports only: kernel32.dll |
<!-- PACK-SIZES-END -->

### macOS caveat (read before distributing to Macs)

Fully-static binaries are impossible on Apple: every macOS binary must link
system libraries. The daemon links **only Apple system libraries** — present
on every Mac, no install step — but it is not *one* library:

```
$ otool -L bin/excali-bridge-darwin-arm64
    /usr/lib/libSystem.B.dylib
    /usr/lib/libresolv.9.dylib
    /System/Library/Frameworks/CoreFoundation.framework
    /System/Library/Frameworks/Security.framework
```

`CoreFoundation` + `Security` are pulled in by Go ≥ 1.24's standard library
`crypto/x509` (its cgo-free macOS system-root loading — a Go toolchain
artifact, not this program's code and not cgo); `libresolv` by the `net`
package. All four are Apple components on every macOS release. If you see
more libraries than these in a fresh build, that is a packaging regression.

## Reproducing the build

```bash
# from the excali-local repo
pnpm bridge:build                 # host build (dev)
pnpm skill:pack                   # cross-compile 4 targets into bin/ + static-verify + refresh README sizes
tsx scripts/agent-bridge/driver-skill.ts   # smoke test the source skill's binary
pnpm skill:check                  # command-reference.md <-> contract drift check
```

`skill-pack` builds the binaries **in place** into `bin/` (the committed source
skill IS the artifact) and refreshes the size table below. It fails loudly if any
target does not build, does not pass `go vet`, or fails static verification.

**Why `-buildvcs=false` (don't remove it).** Go 1.18+ stamps binaries with the
surrounding git repo's `vcs.revision`/`vcs.time`/`vcs.modified` by default, which
makes two builds of identical source byte-different across commits or dirty
state. `-buildvcs=false` disables that so the 4 binaries are **byte-reproducible**:
re-running `skill-pack` leaves them unchanged unless the Go source actually
changes (`git status` stays clean). Consequence: `go version -m <bin>` shows no
`vcs.*` lines — that is intentional, not a bug. Do **not** drop the flag to "add
version info"; it would re-introduce non-idempotent binaries that dirty every commit.

## Version

This skill tracks the excali-local release version (currently `1.7.4`).
