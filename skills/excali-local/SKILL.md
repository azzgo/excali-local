---
name: excali-local
description: Draw, annotate, and iterate on Excalidraw diagrams inside the Excali Local editor (a local-first browser extension) by driving its agent bridge — a small Go daemon you invoke as a plain CLI. Covers canvas drawing (elements, scene, export), the local gallery (list/save/load/rename/delete/collections), and font configuration (system font list, slot assignment, custom-font install). No browser automation, no screenshots of the OS, no remote services — everything runs offline against a canvas the user has explicitly exposed to you.
---

# Excali Local — drive the editor from a CLI

You (any coding agent) draw diagrams by running a tiny command-line program:
`excali-bridge`. It talks to the **Excali Local** browser extension, which hosts
a fully offline Excalidraw editor. Everything you emit lands on the **activated
canvas** — the single canvas a user has explicitly exposed for agent driving —
and everything you read comes back over the same CLI. There is no other
interface you need: no HTTP, no WebSocket protocol, no browser automation, no
files written to disk.

> **The CLI is the contract.** Every capability in this skill is a subcommand
> of one binary: `excali-bridge <method> [params-json]`. The machinery behind
> it (WebSocket transport, token handshakes, JSON-RPC) is an internal detail —
> you never touch it. If a command misbehaves, the error is a machine-readable
> JSON-RPC error code, documented in [`references/command-reference.md`](references/command-reference.md).

## What you need (install set)

1. **The Excali Local extension**, installed in Chrome/Firefox/Edge, with the
   editor open on a canvas.
2. **This skill**, which carries the `excali-bridge` binary for your platform
   under `bin/`. Pick yours:

   ```
   bin/excali-bridge-darwin-arm64       macOS (Apple Silicon)
   bin/excali-bridge-darwin-amd64       macOS (Intel)
   bin/excali-bridge-linux-amd64        Linux (x86-64)
   bin/excali-bridge-windows-amd64.exe  Windows (x86-64)
   ```

   From a shell: `BIN="$(pwd)/bin/excali-bridge-$(uname -s)-$(uname -m | tr -d 'v')"` on macOS/Linux,
   or `bin\excali-bridge-windows-amd64.exe` on Windows. Mark it executable
   (`chmod +x`), then verify with `$BIN ping` — you should get a `"pong"`.
   The binary is self-contained: no runtime, no libraries to install. See
   [`README.md`](README.md) for the platform caveats.

That is the whole install set: extension + skill. There is no separate bridge
daemon to download — the daemon is launched automatically on first use.

## Consent model — the two gates (read before touching anything)

The user controls you through two consent gates. Respect them exactly; they
are the *user's* model, not yours:

- **Paired connection** — the user has allowed *your* bridge connection (a
  one-time first-use pairing). Gates **all** agent control. Without it,
  every command fails.
- **Activated canvas** — the user has explicitly exposed a specific canvas
  for agent driving (an action on the editor page, never automatic). This is
  an **additional** gate that applies only to **canvas-bound operations** and
  to the single-active-canvas invariant.

Consequences you must honor:

- **Canvas-bound operations** (draw, read the scene, set the tool, export,
  `gallery.load`/`gallery.save`) need an activated canvas. Without one you get
  error `-32001` — never retry blindly; tell the user to activate a canvas.
- **Global operations** (gallery list/get/rename/delete/collections, font
  config) need only the paired connection.
- **Destructive global operations** (gallery delete/rename, collection
  delete/rename, save-overwrite, font install/clear) show the user a
  **blocking confirmation**; if they decline you get `-32005` — back off,
  don't retry. Canvas destructive operations (clearing the scene, resetting)
  are **not** blocking — the editor shows a non-blocking indicator.
- **Single-active-canvas**: at most one canvas is active at a time. If you
  are working on a canvas and the user activates another one, your canvas is
  *displaced* and canvas-bound calls start failing — re-check with the user
  which canvas is active.
- **External-reach flows are out of scope**: screenshot capture/annotation,
  opening external `.excalidraw` files, and popup navigation are never
  agent-controllable. Do not attempt them.

The terminology above is the project's own (see the extension's `CONTEXT.md`):
*Activated canvas*, *Paired connection*, *Global allow*, *Canvas-bound vs
Global operation*, *Canvas-related*, *External-reach flow*. Use these words
when explaining anything to the user.

## How to use this skill

| When you need… | Read |
| --- | --- |
| The complete command surface: every method, its gate, exact invocation, payload shapes, error codes | [`references/command-reference.md`](references/command-reference.md) |
| The drawing methodology: how to design diagrams that argue, layout rules, the mandatory render→view→fix loop | [`references/workflows/draw-a-diagram.md`](references/workflows/draw-a-diagram.md) |
| Copy-paste element JSON (text, line, dot, rectangle, text-in-shape, arrow) verified against the live canvas | [`references/element-templates.md`](references/element-templates.md) |
| Shape vocabulary by diagram type (flowchart / architecture / mindmap / sequence / tree·timeline / ER) — lightweight conventions | [`references/diagram-shape-grammar.md`](references/diagram-shape-grammar.md) |
| The element schema: every element type + property the canvas actually accepts | [`references/json-schema.md`](references/json-schema.md) |
| The palette: the one brand seam for colors | [`references/color-palette.md`](references/color-palette.md) |
| Visual style presets (Sketch default · Clean · Notebook · Cartoon) + the liveliness toolbox | [`references/style-presets.md`](references/style-presets.md) |
| Save/load drawings to the local gallery | [`references/workflows/save-to-gallery.md`](references/workflows/save-to-gallery.md) |
| Install or assign fonts (the two-step recipe) | [`references/workflows/install-and-use-a-font.md`](references/workflows/install-and-use-a-font.md) |

Read `command-reference.md` first — it defines the language every other file
uses. Then read the workflow for what you are doing.

## How drawing works here (methodology, adapted)

This skill reuses a battle-tested diagram methodology (argument-over-display,
depth assessment, multi-zoom L1/L2/L3 architecture, container discipline,
layout scale tiers, section-by-section builds, hand-crafted JSON) **adapted
to the live-canvas delivery model**. The complete methodology is in
[`references/workflows/draw-a-diagram.md`](references/workflows/draw-a-diagram.md); the essentials:

1. **Diagrams should ARGUE, not DISPLAY.** Remove all text — does the
   structure still convey the concept? Could someone learn something concrete?
2. **Assess depth first.** Simple/conceptual or comprehensive/technical?
   Technical diagrams must include evidence artifacts (real code snippets,
   actual event names, real payloads) and must be researched before drawing.
3. **Build section by section.** For large diagrams, emit one section at a
   time with descriptive string ids and namespaced numeric seeds
   (100xxx, 200xxx, …). Never try to emit the whole diagram in one shot.
4. **Hand-craft the JSON.** No generator scripts, no delegating JSON
   generation to a sub-agent — write the element payloads yourself, directly
   as `elements.add` arguments. Indirection hurts debugging.
5. **Render → view → fix (mandatory, 2–4 iterations).** This is where the
   delivery differs from disk-based skills: you never write a file and you
   never run a headless browser. The **live canvas is the renderer**:
   - Render: apply your elements to the activated canvas via the CLI.
   - View: read back a picture with `scene.exportPng` (base64 PNG — view it
     with your image tool), or structural readbacks with `scene.get` /
     `scene.bounds` (bounds catch clipped text, overlaps, misrouted arrows).
   - Fix: adjust coordinates/sizes/points and re-emit; re-render.
6. **Aesthetics — a default hand-drawn style.** The skill defaults to the
   **Sketch** preset (`roughness: 1`, soft rounded corners, Warm palette,
   handwriting font primary); Clean/Notebook/Cartoon are opt-in. `strokeWidth`
   1/2/3 and `opacity: 100` always; `fontFamily`/`fontSize` always explicit
   (canvas defaults are roughness 1 / fontFamily 5 / fontSize 20 — see
   `element-templates.md`). Presets live in
   [`references/style-presets.md`](references/style-presets.md), colors in
   [`references/color-palette.md`](references/color-palette.md).

Because the canvas is the renderer, everything is offline-safe: no CDN, no
Playwright, no Python, no network — the same reason this skill carries its
own binaries instead of fetching anything at runtime.

## Visual style — presets (pick one before drawing)

The skill ships a small set of named visual presets; the default is **Sketch**
(Excalidraw's hand-drawn, warm look). The others are opt-in:

- **Sketch** *(default)* — hand-drawn, warm, lively.
- **Clean** / Technical — crisp, schematic, cool.
- **Notebook** / Whiteboard — loose sketch, hachure warmth, doodled accents.
- **Cartoon** *(optional)* — bold, very rough, playful.

Each bundles `roughness`, corners, palette, and font defaults. Pick one from the
user's wording (or default to Sketch), and say in one line which you're using.
Full details, the liveliness toolbox, and the per-knob menu are in
[`references/style-presets.md`](references/style-presets.md); colors in
[`references/color-palette.md`](references/color-palette.md); per-type shape
vocabulary in [`references/diagram-shape-grammar.md`](references/diagram-shape-grammar.md).

## Incremental delivery is mandatory (never one-shot)

**This is a hard rule, not a suggestion.** The protocol supports incremental
building — `elements.add` appends and the canvas re-renders immediately on
every call; `scene.update` replaces — and you MUST use it. Emitting the whole
diagram in a single `elements.add` / `scene.update` blob is a failure mode.

- **Never emit the whole diagram in one call.** One section/layer per
  `elements.add`, in reading order, a few → ~a dozen elements per batch.
- **After every batch: render → view → fix.** `scene.exportPng` (view the
  returned dataURL with your image tool) + check `scene.bounds` / `scene.get`,
  fix, repeat. 2–4 iterations is normal — plan for it.
- **Multiple adjustment rounds are expected and welcome.** Revising earlier
  sections via `scene.update` (re-emitting only the changed elements read
  back from `scene.get`) is the normal path, not a mistake.
- **Skeleton first.** Default build order: (1) structure lines / region
  dividers, (2) container boxes + labels, (3) detail text inside sections,
  (4) arrows/bindings, (5) coordinate/overlap/bleed fixes via `scene.bounds`.

The full methodology — including the render→view→fix loop and the
skeleton-first scaffold — is in
[`references/workflows/draw-a-diagram.md`](references/workflows/draw-a-diagram.md).
Read it before drawing anything.

## Quick start

```bash
BIN=bin/excali-bridge-darwin-arm64        # your platform's binary

$BIN ping                                  # daemon-local: pong
$BIN commands.list                         # full method inventory
$BIN scene.get                             # current scene (needs activated canvas)
$BIN scene.exportPng '{"mimeType":"image/png"}'   # base64 PNG of the scene
$BIN elements.add '{"elements":[{"type":"rectangle","x":100,"y":100,"width":180,"height":90,"strokeColor":"#1e1e1e","strokeWidth":2,"roughness":1,"opacity":100,"roundness":{"type":3}}]}'
$BIN scene.bounds                          # bounding box of the scene
```

Every command prints a JSON result on success; failures print
`rpc error <code>: <message>` to stderr with a non-zero exit code.
