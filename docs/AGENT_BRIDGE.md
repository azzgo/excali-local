# Agent Bridge Guide

How to build the extension, enable the Agent Bridge, load the drawing skill into your agent,
and smoke-test the full round-trip. (Two-gate consent model — see `CONTEXT.md` for terms.)

---

## Part A — Build & load the extension

Build the editor + extension and load it into the browser following the commands and pipeline
in [`docs/BUILD_AND_RELEASE.md`](BUILD_AND_RELEASE.md) (`## Commands` and `## Build pipeline`):
`pnpm install` → `pnpm page:build` → `pnpm local:build`, then load `.output/chrome-mv3`
(Chromium) or `.output/firefox-mv3/manifest.json` (Firefox) as an unpacked/temporary add-on.

Open the editor: click the Excali Local toolbar icon → open the **Local editor** (a full
editor tab). This is the canvas the agent will drive.

---

## Part B — Enable the Agent Bridge (the two gates + master switch)

The bridge is **off by default**. Enable it in this order:

1. **Master switch (Layer 0):** open the extension **Options** page → find **"Agent control"**
   → turn it **ON**. (Default OFF is a kill-switch: pairing/activation are hidden while off.)
2. **Pair a connection (Gate 1):** click the toolbar icon to open the **popup** → click
   **"Open a paired connection"**. (Only visible after step 1.) This allows *your* local agent
   to connect. A paired connection gates **all** agent control.
3. **Activate a canvas (Gate 2):** in the **Local editor** tab, use the
   **agent-activation control** in the top-right toolbar to **activate** the current canvas.
   (Quick editor never activates.) Activation is an *additional* gate for canvas-bound ops +
   the single-active-canvas invariant.

> **What each gate allows:** with only a paired connection (steps 1-2), your agent can do
> **global** ops (gallery list/save, font config) — no canvas needed. **Canvas-bound** ops
> (draw, read scene, export, gallery load/save) additionally need an activated canvas (step 3).
> At most one canvas is active at a time; activating another **displaces** the prior.

---

## Part C — Build the skill & load it into your agent

The agent-facing surface is the **excali-local skill**: a `SKILL.md` + `references/` that
bundles static, dependency-free daemon binaries.

### Pack the skill
```bash
pnpm skill:pack
# → skills/excali-local/bin/            (4 platform binaries built in place, committed)
```
`skill-pack` cross-compiles 4 targets (`darwin-arm64`, `darwin-amd64`, `linux-amd64`,
`windows-amd64`; CGO disabled, symbols stripped) and **static-verifies** each is dep-free
before installing it into the skill. If any target fails to build/vet or isn't static,
the pack **fails fast**.

### Install into your agent's skills directory
The skill is agent-agnostic (YAML frontmatter `name`/`description`). Copy the assembled
folder into wherever your agent reads skills:

| Agent runtime | Skills directory |
| --- | --- |
| **pi** | `~/.pi/agent/skills/excali-local/` |
| **Claude Code** | `~/.claude/skills/excali-local/` |
| **Cursor** | `.cursor/skills/excali-local/` (project) or `~/.cursor/skills/` |
| **cross-agent standard** | `~/.agents/skills/excali-local/` |

```bash
# example: cross-agent home
mkdir -p ~/.agents/skills
cp -r skills/excali-local ~/.agents/skills/
chmod +x ~/.agents/skills/excali-local/bin/excali-bridge-*
```

### Verify the binary runs (no extension needed for this)
```bash
cd ~/.agents/skills/excali-local     # or wherever you installed it
BIN=bin/excali-bridge-darwin-arm64  # Apple Silicon Mac; use -darwin-amd64 on Intel,
                                    # -linux-amd64 on Linux, -windows-amd64.exe on Windows
chmod +x $BIN
$BIN ping                # → "pong"  (spawns the daemon lazily on first use)
$BIN commands.list       # → the 33-method inventory
```
If `ping` returns `"pong"`, the daemon + CLI are healthy. (The daemon binds `127.0.0.1`
on the first free port in `[17331..17335]`; nothing to configure, nothing to open.)

---

## Part D — Smoke-test the round-trip against your live canvas

With the extension loaded (Part A), the bridge enabled + a canvas activated (Part B), and the
skill installed (Part C), run from the skill folder:

```bash
BIN=bin/excali-bridge-darwin-arm64

$BIN scene.get                              # read the activated canvas (JSON)
$BIN scene.exportPng '{"mimeType":"image/png"}'   # base64 PNG snapshot — save & view it

# draw a rectangle, then read it back:
$BIN elements.add '{"elements":[{"type":"rectangle","x":100,"y":100,"width":180,"height":90,"strokeColor":"#020817","backgroundColor":"#f1f5f9","strokeWidth":2,"roughness":0,"opacity":100}]}'
$BIN scene.get                              # the rectangle is now on your canvas ✓

# global op (no canvas needed, only paired):
$BIN gallery.list                           # your local gallery

# fonts: list OS fonts (daemon-local), then assign one to the "code" slot
$BIN fonts.system.list | head               # OS-installed fonts, from the daemon
$BIN fonts.assign '{"slot":"code","postscriptName":"<a postscriptName from the list>"}'
# → returns {config, requiresReload:true}: reload the editor page, then the slot is active
```

If `scene.get` reflects your `elements.add`, the full **agent → daemon → page → daemon → agent**
loop works. If you get `-32001` you forgot to activate a canvas (Part B step 3); `-32005` means
a blocking op (gallery delete, font install/clear) was declined on the confirm modal.

> **Render→view→fix loop:** this is the skill's core workflow. "Render" = emit elements via
> the CLI; "view" = `scene.exportPng` (save the base64, open the PNG) or `scene.bounds`
> (catches clipped text/overlaps); "fix" = adjust coords and re-emit. See
> `skills/excali-local/references/workflows/draw-a-diagram.md`.

---

## Part E — What to watch for / known limits

- **Live-browser rendering is your QA lane.** The e2e drivers stub `window.excaliAPI`, so
  they prove the *protocol* loop but not that Excalidraw actually renders your elements.
  Visually confirm drawings, the destructive indicator, the blocking confirm modal, and the
  displacement UI in a real tab.
- **The skill's element templates were round-trip-verified** against the patched Excalidraw
  (`test/features/editor/lib/element-templates-roundtrip.test.ts`). Notable: `elements.add`
  **regenerates ids** (your id is a binding hint only); text defaults `fontSize 20`/
  `fontFamily 5`/left/top — **be explicit**; `roughness` defaults to **1** (set `0` for clean).
  See `skills/excali-local/references/element-templates.md`.
- **Fonts need a reload + a fontFamily set.** `fonts.install`/`fonts.assign` return
  `requiresReload:true` (fonts inject once at boot). After reloading, set the canvas
  `appState.fontFamily` (1/2/3 = handwriting/normal/code) for the change to render. Hot-swap
  without reload is not supported.
- **macOS binaries link 4 Apple system libs** (libSystem, libresolv, CoreFoundation,
  Security) — this is Go ≥1.24's cgo-less x509 behavior, not a bug; nothing to install.
- **`TestCloseHandshake` in `internal/ws` can flake under heavy concurrent load** — passes in
  isolation; ignore unless it fails when run alone.

---

## Quick reference

For the daily build/test command list (`page:*`, `local:*`, `bridge:*`, `skill:*`), see
[`AGENTS.md`](../AGENTS.md) ("Daily commands") and [`docs/BUILD_AND_RELEASE.md`](BUILD_AND_RELEASE.md)
(`## Commands`). The agent-bridge-specific bits not covered there:

```bash
tsx scripts/agent-bridge/driver-skill.ts   # smoke-test the source skill binary
# cleanup after any driver:
pkill -f 'excali-bridge serve'; pkill -f 'bin/excali-bridge'; rm -f ~/.excali-local/bridge.pid
```

The agent-facing contract is `skills/excali-local/SKILL.md` + `references/`; deeper context in
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
