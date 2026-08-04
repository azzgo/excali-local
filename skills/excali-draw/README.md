# excali-draw — the Agent-agnostic drawing skill

A self-contained skill that teaches any coding agent to drive the **Excali
Local** editor (a local-first browser extension running Excalidraw fully
offline) through one small CLI: `excali-bridge`.

- **Read** [`SKILL.md`](SKILL.md) first — overview, consent model, routing.
- **Reference docs** live in [`references/`](references/) (command surface,
  element templates, JSON schema, palette, workflows).
- **The daemon** is bundled pre-built for four platforms under [`bin/`](bin/).
  It is BOTH the WS server the editor page connects to (Leg B) AND the agent
  CLI you invoke (Leg A) — one binary, launched lazily on first use.

## Install set

1. **Excali Local** browser extension (Chrome/Firefox/Edge), with the editor
   open on a canvas.
2. **This skill** (this folder). No third artifact, no runtime, no downloads.

## Picking your binary

| Platform | Binary |
| --- | --- |
| macOS (Apple Silicon) | `bin/excali-bridge-darwin-arm64` |
| macOS (Intel) | `bin/excali-bridge-darwin-amd64` |
| Linux (x86-64) | `bin/excali-bridge-linux-amd64` |
| Windows (x86-64) | `bin/excali-bridge-windows-amd64.exe` |

Verify: `bin/excali-bridge-<your-platform> ping` → prints `"pong"`.

## Built binaries (static, dependency-free)

Built with `CGO_ENABLED=0 -trimpath -ldflags="-s -w"` (pure Go, cgo disabled,
symbols stripped) and **verified dep-free** per target: Linux is fully
statically linked (no glibc); Windows imports only `kernel32.dll` (no MSVC
runtime, no libgcc, no libwinpthread); macOS links only Apple system
libraries. Actual sizes and archive size are recorded below at pack time.

<!-- PACK-SIZES-BEGIN -->
| Target | Size | Static-verify |
| --- | --- | --- |
| _(populated by `scripts/skill-pack.ts` at pack time)_ |
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
bun run bridge:build                 # host build (dev)
bun scripts/skill-pack.ts            # cross-compile 4 targets + static-verify + assemble + archive
bun scripts/agent-bridge/driver-skill.ts   # smoke test against the assembled skill
bun scripts/check-skill-commands.ts  # command-reference.md <-> contract drift check
```

The pack script fails loudly if any target does not build, does not pass
`go vet`, or fails static verification.

## Version

`excali-draw` tracks the excali-local release version (currently `1.6.4`).
The archive produced by the pack script is named
`excali-draw-<version>.tar.gz`.
