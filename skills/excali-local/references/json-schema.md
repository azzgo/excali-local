# JSON schema — Excalidraw elements as the live canvas accepts them

This schema is grounded in the **patched Excalidraw build** the Excali Local
editor actually runs (0.18.0-csp), verified by round-trip through its element
transform. There are two shapes to keep apart:

- **Add-input shape** — what `elements.add` accepts: **partials**. You omit
  most fields; the transform fills defaults, regenerates ids, and re-closes
  bindings. This is the shape you write.
- **Serialized shape** — what `scene.get` / `scene.elements` return: the full
  canonical form. This is the shape you read (and re-emit via `scene.update`,
  which is a passthrough).

## Element types

| Type | What it is | Add-input keys beyond common |
| --- | --- | --- |
| `rectangle` | box | (none) |
| `ellipse` | oval / dot (small) | (none) |
| `diamond` | diamond | (none) |
| `arrow` | directed line | `points`, `start`, `end`, optional `endArrowhead`/`startArrowhead` |
| `line` | open polyline | `points`, `polygon?: boolean`, explicit `width`/`height` |
| `text` | label (free or bound) | `text`, `fontSize`, `fontFamily`, `textAlign`, `verticalAlign`, `containerId` (serialized only) |
| `frame` | grouping region | `children: string[]`, `name?: string` |
| `freedraw` | freehand stroke | `points`, `pressures`, `simulatePressure` |
| `image` | embedded image | `fileId`, `status`, `scale`, `crop` (via `files.add`) |
| `iframe`/`embeddable` | embedded content | `link` etc. (rarely used in diagrams) |

The methodology (draw-a-diagram) works with `rectangle`, `ellipse`/`dot`,
`diamond`, `arrow`, `line`, `text`, and occasionally `frame` — that is the
"argument-over-display" vocabulary.

## Common properties (every element)

Add-input — only these matter to you:

| Key | Add-input | Notes |
| --- | --- | --- |
| `type` | **required** | one of the table above |
| `x`, `y` | **required** (except frames) | top-left of the element's bounding box |
| `width`, `height` | required for shapes/text/lines | **lines: required** (not derived from points); arrows derive from points |
| `points` | required for `line`/`arrow` | array of `[x, y]` relative to (x, y) |
| `strokeColor` | recommended | default `#1e1e1e` |
| `backgroundColor` | recommended | default `transparent` |
| `fillStyle` | optional | `solid` | `hachure` | `cross-hatch` | `zigzag`; default `solid` |
| `strokeWidth` | **required by methodology** | 1/2/3; default `2` |
| `strokeStyle` | optional | `solid` | `dashed` | `dotted`; default `solid` |
| `roughness` | **required by methodology** | methodology default **1** (Sketch, hand-drawn — also the canvas default); set `0` for the Clean preset, `2` for Cartoon |
| `opacity` | **required by methodology** | default `100` — keep `100` |
| `angle` | optional | radians; default `0` |
| `roundness` | optional | default `null` (sharp corners); Sketch/Notebook/Cartoon set `{ "type": 3 }` (soft); arrows stay `null` (straight) unless curving via the liveliness toolbox |
| `seed` / `version` / `versionNonce` / `index` / `updated` | **never set** | transform-owned |
| `id` | optional hint | **regenerated** by `elements.add`; use only as a binding target (`start`/`end`, `label`, `children`) |
| `groupIds` / `frameId` / `locked` / `link` / `isDeleted` | omit | transform fills (`groupIds: []`, `frameId: null`, `locked: false`, `link: null`, `isDeleted: false`) |
| `boundElements` | **output only** | read it from `scene.get`; never write it (label/start/end create it) |

## Render-safety & re-emitting via `scene.update`

`scene.update` is a **render-safe passthrough**: it preserves `id`/`version`/
`versionNonce`/`seed`/`index`/`updated` and any `startBinding`/`endBinding`/
`boundElements` closures exactly, but coerces array-typed fields so a malformed
re-emit can't crash the renderer.

**How to re-emit (lowest failure rate):** echo each element EXACTLY as
`scene.get` / `scene.elements` returned it, changing only the field you intend
to change. Do NOT strip `version`/`versionNonce`/`seed`/`index`/`updated`
(Excalidraw uses them for history/diff). You don't need to know which fields
are droppable — just echo + modify one field.

**Array-typed fields must be arrays, never `null`:** `groupIds`, `boundElements`,
`points`, `pressures`. The renderer reads `.length` / iterates them without
null-checks. As a safety net the page coerces `null`/missing/non-array
`groupIds`/`boundElements` to `[]` and drops non-record `boundElements`
entries — but emit them correctly so bindings survive:

- `groupIds`: `string[]` (usually `[]`).
- `boundElements`: array of `{ "type": "text"|"arrow", "id": "<element-id>" }`.

If you edit an arrow's bindings via `scene.update`, keep the arrow's
`startBinding`/`endBinding` consistent with both endpoints' `boundElements`
(append `{ "type": "arrow", "id": "<arrow-id>" }` to each endpoint).

## Text properties

| Key | Add-input | Notes |
| --- | --- | --- |
| `text` | **required** | the readable words; `originalText` is derived |
| `fontFamily` | **required** | `5` handwriting, `6` normal, `8` code (see fonts workflow); Sketch/Notebook/Cartoon default `5` (handwriting primary), Clean defaults `6`; `8` **only for real code**; **canvas default is 5** — always set it |
| `fontSize` | **required** | methodology default `16`; **canvas default is 20** — always set it |
| `textAlign` | recommended | `left` | `center` | `right`; canvas default `left` — set `center` for labels |
| `verticalAlign` | recommended | `top` | `middle` | `bottom`; canvas default `top` — set `middle` for labels |
| `containerId` | serialized-only | set by the transform when a label binds; as add-input it is echoed but NOT bound |
| `autoResize` / `lineHeight` | omit | transform fills (`true` / per-font) |

## Arrow & linear properties

| Key | Add-input | Notes |
| --- | --- | --- |
| `points` | **required** | relative coordinates; the transform may recompute width/height from them (verified) |
| `start` / `end` | **the binding input** | `{ "id": "<element-id>" }` (optionally with `focus`/`gap`) — creates `startBinding`/`endBinding` + both `boundElements` closures |
| `startBinding` / `endBinding` | **output only** | serialized as `{ elementId, mode, fixedPoint }`; ignored as input (verified) |
| `startArrowhead` / `endArrowhead` | optional | `endArrowhead` defaults to `arrow`; `startArrowhead` null |
| `elbowed` / `polygon` | output-only | `elbowed: false` for arrows, `polygon: false` for lines |

## Binding model (verified)

Excalidraw 0.18 binds via a two-way closure:

- **Text ↔ container**: input `label: { text, fontFamily, fontSize, textAlign, verticalAlign }`
  on the container → output: container `boundElements: [{ type: "text", id }]`
  + text `containerId: <container id>`, auto-centered.
- **Arrow ↔ endpoints**: input `start: { id }`, `end: { id }` on the arrow →
  output: arrow `startBinding`/`endBinding` (`{ elementId, mode: "orbit",
  fixedPoint }`) + both containers' `boundElements` include
  `{ type: "arrow", id }`.

If you read a serialized scene and re-add it via `elements.add`, these
closures break (ids regenerate; `containerId`/`startBinding`/`endBinding`
are not remapped). **Re-emit serialized scenes with `scene.update`** — the
passthrough path that preserves ids, versions, and bindings exactly.

## appState (write subset)

`scene.update` accepts ONLY these `appState` keys (anything else is
silently dropped):

| Key | Type | Notes |
| --- | --- | --- |
| `viewBackgroundColor` | string | hex color, e.g. `"#ffffff"` |
| `gridSize` | number | grid spacing in px, e.g. `20` |
| `viewModeEnabled` | boolean | presentation-ish mode |
| `activeTool` | object | `{ type, locked? }` (also via `tool.setActive`) |

`scene.state` returns the read subset: `viewBackgroundColor`, `gridSize`,
`zoom`, `scrollX`, `scrollY`, `viewModeEnabled`, `activeTool`.

## files (embedded images)

`files.add` takes `{ id, mimeType?, dataURL, created? }` — binary travels as
base64 `data:` URLs. `scene.get` returns `files` as `{ [id]: { mimeType,
dataURL, created } }`. Image elements reference them via `fileId` (rarely
needed in methodology diagrams; prefer shapes + text).
