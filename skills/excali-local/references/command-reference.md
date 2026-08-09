# Command reference — the `excali-bridge` CLI surface

The stable contract for this skill. **The CLI is the contract**: every
capability is one subcommand of the bundled `excali-bridge` binary, and the
subcommand name is exactly the method name. The transport behind it
(WebSocket, handshake tokens, JSON-RPC framing) is an internal detail and is
never part of this reference.

This file is machine-checked: `scripts/check-skill-commands.ts` asserts that
the command set documented here equals the wire contract
(`packages/excali-shared/src/agent-bridge.ts`) with **zero drift** — a method
listed here must exist there, and every method there must be listed here.

## Invocation form

```
excali-bridge <method> [params-json]
```

- `<method>` — one of the methods below. `serve`, `status`, `help` are
  lifecycle subcommands, not methods.
- `[params-json]` — optional single argument: a JSON object literal, e.g.
  `'{"elements":[...]}'`. Omit it for methods that take no params (an empty
  `{}` is assumed).
- On success: the result is printed as pretty-printed JSON on stdout,
  exit code `0`.
- On failure: `rpc error <code>: <message>` on stderr, exit code `1`.
  Invalid params JSON → exit code `2`. Unknown subcommand → exit code `2`.
- The daemon is spawned automatically on first use (lazy daemon). You may also
  start it explicitly with `serve`; both paths reach the same machine-wide,
  single-instance bridge (a second start reuses the live one — never
  double-launches).

Environment: `EXCALI_BRIDGE_PIDFILE` overrides the pidfile path;
`EXCALI_BRIDGE_ORIGIN` overrides the strict origin allow-list.

## The three gates (grouping)

Every method is documented under exactly one gate. The gate is the **consent
requirement** for that method (see SKILL.md):

| Gate | Requires | Methods |
| --- | --- | --- |
| **daemon-local** | the daemon itself (no page, no canvas, no pairing beyond connection auth) | `ping`, `commands.list`, `protocol.version`, `bridge.status`, `fonts.system.list` |
| **activated (canvas-bound)** | an **activated canvas** (plus the paired connection) | all `canvas/*` draw/read methods + `gallery.load` + `gallery.save` |
| **paired** | the **paired connection** (no canvas needed) | gallery metadata ops + font config ops |

## daemon-local

Resolved by the daemon itself — no page, no canvas, no user confirmation.

- `ping` — round-trip liveness check. No params. Result: `"pong"`.
- `commands.list` — the full callable method inventory (deduped). No params.
  Result: `["ping", "scene.get", ...]`.
- `protocol.version` — the contract version. No params. Result:
  `"canvas/v1"`.
- `bridge.status` — daemon context: the activated canvas's per-profile
  extension identity + the connected control-page identities. No params.
  Result: `{ "activeCanvas": { "profileId": "…" } | null, "controlPages": [ { "profileId": "…" } ] }`.
- `fonts.system.list` — OS-installed fonts, enumerated by the daemon (pure
  Go; no browser permission prompt, cross-browser, offline). No params.
  Result: `[ { "family": "SFNS-Regular", "postscriptName": "SFNS-Regular" }, … ]`.

## activated (canvas-bound)

Require an **activated canvas**. Without one: error `-32001` *no active
canvas* — never hang, never retry blindly; ask the user to activate a canvas.
These methods write/read the live scene of the activated canvas.

### Reads

- `scene.get` — full scene snapshot. No params.
  Result: `{ "elements": [ … ], "appState": { … }, "files": { … } }`
  (elements in canonical serialized form; appState includes
  `viewBackgroundColor`, `gridSize`, `zoom`, `scrollX`, `scrollY`,
  `viewModeEnabled`, `activeTool`, …).
- `scene.elements` — just the element array. No params.
  Result: `[ … ]`.
- `scene.state` — the curated appState subset. No params.
  Result: `{ "viewBackgroundColor": "…", "gridSize": 20, "zoom": { "value": 1 }, "scrollX": 0, "scrollY": 0, "viewModeEnabled": false, "activeTool": { "type": "selection" } }`.
- `scene.bounds` — bounding box of the scene (or of explicit elements).
  Params: `{ "elements"?: […] }` (default: current scene). Result:
  `{ "x": …, "y": …, "width": …, "height": … }`.
- `scene.exportPng` — render the scene (or explicit elements) to a PNG.
  Params: `{ "elements"?: […], "mimeType"?: "image/png", "scale"?: number }`.
  Result: `{ "dataURL": "data:image/png;base64,…", "width": …, "height": … }`.
  **This is the skill's "view" step** — the render→view→fix loop reads this.
- `scene.exportSvg` — render to SVG. Params: `{ "elements"?: […] }`.
  Result: `{ "svg": "<svg …>" }`.

### Writes

- `scene.update` — **render-safe passthrough** replace: ids/versions/bindings
  are preserved exactly (no id regeneration, no binding recompute). Array-typed
  fields (`groupIds`, `boundElements`) that are `null`/missing/non-array are
  coerced to `[]` (and non-record `boundElements` entries dropped) so a
  malformed re-emit can never crash the renderer — but emit them correctly so
  bindings survive. Params:
  `{ "elements"?: […], "appState"?: { viewBackgroundColor?, gridSize?, viewModeEnabled?, activeTool? }, "captureUpdate"?: "NEVER"|"IMMEDIATELY"|"EVENTUALLY" }`
  (at least one of elements/appState required; appState accepts ONLY the
  curated subset). **Use this to re-emit a scene read back from
  `scene.get`** — it is the id/version/binding-preserving path.
- `elements.add` — add NEW elements: partials are normalized through the
  real Excalidraw element transform (defaults filled, **ids regenerated**,
  bindings re-closed). Params: `{ "elements": [ … ] }`.
  Use for emitting fresh diagram content; see `element-templates.md` for the
  exact partial shapes the transform accepts (label-based text-in-shape,
  `start`/`end` arrow bindings).
- `elements.clear` — remove all elements. Destructive (non-blocking
  indicator). No params. Result: `null`.
- `scene.reset` — reset the scene (clear elements + history). Destructive
  (non-blocking). No params. Result: `null`.
- `files.add` — add (or overwrite) embedded files. Overwrite is destructive
  (non-blocking). Params: `{ "files": [ { "id": "…", "mimeType"?: "…", "dataURL": "data:…;base64,…", "created"?: number } ] }`.
- `tool.setActive` — switch the active tool. Params:
  `{ "type": "selection"|"lasso"|"rectangle"|"diamond"|"ellipse"|"arrow"|"line"|"freedraw"|"text"|"image"|"eraser"|"hand"|"frame"|"magicframe"|"embeddable"|"laser", "locked"?: boolean }`.
- `view.scrollTo` — scroll the view to content. Params:
  `{ "elements"?: […], "fitToContent"?: boolean }`.
- `history.clear` — clear undo history. Destructive (non-blocking).
  No params. Result: `null`.

### Gallery load/save (canvas-bound)

- `gallery.load` — load a saved drawing onto the activated canvas.
  Params: `{ "id": "…" }`. Missing id → `-32006`. Result:
  `{ "id": "…", "name": "…" }`.
- `gallery.save` — save the current canvas to the gallery. Params:
  `{ "id"?: "…", "name"?: "…", "collectionIds"?: [ "…" ] }`.
  Save-overwrite of an existing id is **blocking-confirmed**
  (reject → `-32005`). Result: `{ "id": "…", "isNew": true|false }`.

## paired

Require only the paired connection — no canvas needed. Reads auto-apply;
writes listed as destructive are **blocking-confirmed** by the user
(reject → `-32005`).

### Gallery metadata

- `gallery.list` — drawings (metadata only; thumbnails stripped by default).
  Params: `{ "collectionId"?: "…", "nameContains"?: "…", "includeThumbnail"?: boolean }`.
  Result: `[ { "id", "name", "thumbnail", "collectionIds", "createdAt", "updatedAt" }, … ]`.
- `gallery.get` — metadata for one drawing. Params: `{ "id": "…" }`.
  Missing id → `-32006`. Result: the drawing metadata object.
- `gallery.rename` — **blocking-confirmed**. Params: `{ "id": "…", "name": "…" }`.
  Result: `{ "id": "…", "name": "…" }`.
- `gallery.delete` — **blocking-confirmed**. Params: `{ "id": "…" }`.
  Result: `{ "id": "…", "deleted": true }`.
- `gallery.collections.list` — all collections. No params.
  Result: `[ { "id", "name", "createdAt" }, … ]`.
- `gallery.collections.create` — new collection (fresh uuid each call; not
  idempotent). Params: `{ "name": "…" }`.
  Result: `{ "id", "name", "createdAt" }`.
- `gallery.collections.rename` — **blocking-confirmed**.
  Params: `{ "id": "…", "name": "…" }`. Result: `{ "id", "name", "createdAt" }`.
- `gallery.collections.delete` — **blocking-confirmed**; rewrites member
  drawings to strip the collection id. Params: `{ "id": "…" }`.
  Result: `{ "id": "…", "affectedDrawings": n }`.

### Fonts (paired; see the two-step recipe below)

- `fonts.get` — the current font config, trimmed (custom slots serialize as
  `{ type: "custom", family }` — **no bytes** on the wire). No params.
  Result: `{ "handwriting": { type: "system", postscriptName } | { type: "custom", family } | null, "normal": …, "code": … }`.
- `fonts.assign` — bind a system font to a slot (non-blocking, reversible).
  Params: `{ "slot": "handwriting"|"normal"|"code", "postscriptName": "…" }`.
  Result: `{ "config": { … }, "requiresReload": true }`.
- `fonts.install` — **blocking-confirmed**. Install a custom font into a
  slot. Params: `{ "slot": …, "family": "…", "data": "<base64 ttf/otf/woff/woff2>" }`
  — format (magic bytes) + size (≤ 30 MiB) validated **before** the
  confirmation; invalid → `-32602` before any prompt. Result:
  `{ "config": { … }, "requiresReload": true }`.
- `fonts.clear` — **blocking-confirmed**. Clear a slot. Params:
  `{ "slot": … }`. Result: `{ "config": { … }, "requiresReload": true }`.

### The two-step font recipe (documented, not optional)

Fonts inject once at page boot. A slot change does **not** render until the
editor page reloads — every page-side font write returns
`requiresReload: true` for exactly this reason. The complete recipe:

1. Configure the slot: `fonts.install` / `fonts.assign` / `fonts.clear`
   (paired; install/clear are blocking-confirmed).
2. **Ask the user to reload the editor page** (or do it via the editor's own
   reload affordance — you have no reload command). Fonts now inject.
3. Set the per-element `fontFamily` on text elements you emit — the slots map
   to Excalidraw fontFamily ids: `handwriting → 1`, `normal → 2`, `code → 3`
   (element templates carry `fontFamily` explicitly). The canvas's appState
   default font is NOT sufficient — set it on each text element.
   Which slot is the default depends on the preset — Sketch/Notebook/Cartoon
   use handwriting `1` as the primary face; Clean uses normal `2`; see
   [`style-presets.md`](style-presets.md).

Hot font-swap without a reload is out of scope for this skill — do not
attempt it; a reload is the contract.

## Error codes

Standard JSON-RPC + the bridge's custom range. Failures print
`rpc error <code>: <message>` on stderr, exit code 1.

| Code | Meaning | What to do |
| --- | --- | --- |
| `-32700` | Parse error (malformed request) | Fix the invocation. |
| `-32600` | Invalid request (not JSON-RPC 2.0) | Fix the invocation. |
| `-32601` | Method not found | Typo? Check `commands.list`. |
| `-32602` | Invalid params (e.g. bad font magic, missing id, unknown slot) | Fix the params JSON. |
| `-32603` | Internal error | Report; retry once. |
| `-32001` | No active canvas (canvas-bound op, no activation) | Ask the user to activate a canvas. |
| `-32002` | Page timeout (page did not answer in time) | Retry once; else report. |
| `-32003` | Page disconnected (the canvas page dropped) | Ask the user to re-check the editor. |
| `-32004` | Ambiguous target (paired op, >1 control pages, no active canvas) | Ask the user to activate a canvas to disambiguate. |
| `-32005` | User cancelled (blocking confirmation declined) | Back off; do not retry. |
| `-32006` | Not found (gallery id missing) | Re-list first. |

## Full command index (machine-checked)

The complete method set — every token below must exist in the wire contract
and appear exactly once:

daemon-local: `ping`, `commands.list`, `protocol.version`, `bridge.status`, `fonts.system.list`

activated (canvas-bound): `scene.get`, `scene.elements`, `scene.state`, `scene.bounds`, `scene.exportPng`, `scene.exportSvg`, `scene.update`, `elements.add`, `elements.clear`, `scene.reset`, `files.add`, `tool.setActive`, `view.scrollTo`, `history.clear`, `gallery.load`, `gallery.save`

paired: `gallery.list`, `gallery.get`, `gallery.rename`, `gallery.delete`, `gallery.collections.list`, `gallery.collections.create`, `gallery.collections.rename`, `gallery.collections.delete`, `fonts.get`, `fonts.assign`, `fonts.install`, `fonts.clear`
