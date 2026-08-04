# Element templates — copy-paste JSON for `elements.add`

Every template below is a **partial** — you do not need Excalidraw's full
serialized fields (`version`, `versionNonce`, `seed`, `index`, `updated`,
`lastCommittedPoint`, `binders`, …). `elements.add` runs your partials
through the real Excalidraw element transform, which fills defaults,
**regenerates ids**, and re-closes bindings. These shapes were **verified by
round-trip** against the patched Excalidraw build the editor runs
(`test/features/editor/lib/element-templates-roundtrip.test.ts`); the notes
under each template are the verified behavior, not theory.

> **Rules that apply to every template**
>
> - **Always set `roughness: 0`** — the transform's default is `1`.
> - **Always set `strokeWidth`** (1/2/3 per the methodology) and
>   `opacity: 100`.
> - **Always set `fontFamily` (1|2|3) and `fontSize` on text** — the
>   transform's defaults are `fontFamily: 5` and `fontSize: 20`, and the
>   default alignment is left/top. The skill's defaults are
>   `fontFamily` 1|2|3, `fontSize: 16`, `textAlign: "center"`,
>   `verticalAlign: "middle"` — write them explicitly.
> - **Ids are input-hints, not output.** You may set ids (they let arrows
>   bind and text bind to containers), but the emitted elements will carry
>   fresh random ids. Never rely on an id surviving `elements.add`.
> - **Never hand-write `version`/`versionNonce`/`seed`/`index`/`updated`** —
>   the transform owns them.

## Text (free-floating)

```json
{ "type": "text", "x": 0, "y": 0, "text": "Hello",
  "fontFamily": 3, "fontSize": 16,
  "textAlign": "center", "verticalAlign": "middle",
  "strokeColor": "#020817", "strokeWidth": 2, "roughness": 0, "opacity": 100 }
```

- Verified: normalizes with id, `originalText` = text, `containerId: null`,
  `autoResize: true`, width/height computed from the text metrics, JSON
  round-trip stable (style + geometry survive re-normalization).
- `fontFamily` 1 = handwriting slot, 2 = normal slot, 3 = code slot — see
  `workflows/install-and-use-a-font.md` for what those slots hold.

## Line (open polyline)

```json
{ "type": "line", "x": 10, "y": 20, "width": 50, "height": 40,
  "points": [[0, 0], [50, 0], [50, 40]],
  "strokeColor": "#020817", "strokeWidth": 2, "roughness": 0, "opacity": 100 }
```

- **`width`/`height` are NOT derived from points** — a partial line without
  them normalizes to `100 × 0` (broken). Compute them as the extent of your
  points. (Arrows DO derive size from points; lines do not.)
- Verified: points preserved exactly; `polygon: false`, `startBinding: null`,
  `endBinding: null`, `roundness: null`.

## Dot (small filled ellipse — for markers, ticks, endpoints)

```json
{ "type": "ellipse", "x": 0, "y": 0, "width": 8, "height": 8,
  "strokeColor": "#020817", "backgroundColor": "#020817",
  "strokeWidth": 2, "roughness": 0, "opacity": 100 }
```

- Verified: geometry preserved; `fillStyle: "solid"`, `roundness: null`.

## Rectangle / shape (also diamond, ellipse)

```json
{ "type": "rectangle", "x": 100, "y": 100, "width": 180, "height": 90,
  "strokeColor": "#020817", "backgroundColor": "#f1f5f9",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 0, "opacity": 100 }
```

- Types `rectangle`, `diamond`, `ellipse` share this shape.
- Verified: geometry preserved; defaults filled (`fillStyle: "solid"`,
  `angle: 0`, `roundness: null`, `boundElements: null`).
- `roundness` is `null` by default — leave it null for clean corners; the
  methodology's diagrams are straight-edged.

## Text-in-shape (bound label)

The binding-close input form is a **`label` property on the container** —
NOT a `containerId` on a separate text element:

```json
{ "type": "rectangle", "x": 0, "y": 0, "width": 200, "height": 100,
  "strokeColor": "#020817", "backgroundColor": "#e8c468",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 0, "opacity": 100,
  "label": { "text": "Title", "fontFamily": 3, "fontSize": 16,
             "textAlign": "center", "verticalAlign": "middle" } }
```

- Verified: the transform creates the bound text element, closes the
  container's `boundElements` (`[{type:"text", id}]`), sets the text's
  `containerId`, centers it inside the container, and the text inherits the
  container's `strokeColor`.
- **Why not `containerId`?** A text partial with `containerId` is *echoed*
  but **not bound**: the container's `boundElements` stays null and the text
  floats at its own x/y. Verified. (A scene read back from `scene.get`
  *returns* the containerId form — that is the serialized shape, not the
  add-input shape.)
- **Re-emitting serialized scene content**: if you read `scene.get` and want
  to push the same scene back, use `scene.update` (passthrough — ids and
  bindings preserved), **not** `elements.add` (which regenerates ids and
  leaves `containerId`/`startBinding`/`endBinding` pointing at stale ids).

## Arrow with bindings

The binding-close input form uses `start`/`end` (linear-element style) —
**not** `startBinding`/`endBinding`:

```json
{ "type": "rectangle", "id": "from", "x": 0, "y": 0, "width": 100, "height": 50,
  "strokeColor": "#020817", "backgroundColor": "#f1f5f9",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 0, "opacity": 100 },
{ "type": "rectangle", "id": "to", "x": 300, "y": 0, "width": 100, "height": 50,
  "strokeColor": "#020817", "backgroundColor": "#f1f5f9",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 0, "opacity": 100 },
{ "type": "arrow", "x": 100, "y": 25, "width": 200, "height": 0,
  "points": [[0, 0], [200, 0]],
  "strokeColor": "#020817", "strokeWidth": 2, "roughness": 0, "opacity": 100,
  "start": { "id": "from" }, "end": { "id": "to" } }
```

- Verified: the transform remaps `start`/`end` through id regeneration and
  produces `startBinding`/`endBinding`
  (`{ elementId, mode: "orbit", fixedPoint: [x, y] }`), sets
  `endArrowhead: "arrow"`, and closes **both** containers' `boundElements`
  with the arrow. Emit the shapes and the arrow as one `elements.add` batch.
- **Why not `startBinding`/`endBinding`?** They are OUTPUT fields — passed as
  input they are ignored (bindings come out null; verified). If you read a
  scene via `scene.get` and re-emit via `elements.add`, bindings are dropped
  for the same reason — use `scene.update` for re-emission.
- Width/height of an arrow may be recomputed from points (verified: the
  transform runs `getSizeFromPoints`) — supplying them is fine, don't sweat
  ±1px drift.

## Frame (grouping region)

```json
{ "type": "rectangle", "id": "inside", "x": 20, "y": 20, "width": 100, "height": 50,
  "strokeColor": "#020817", "backgroundColor": "#f1f5f9", "strokeWidth": 2,
  "roughness": 0, "opacity": 100 },
{ "type": "frame", "id": "f1", "children": ["inside"], "name": "Phase 1" }
```

- **`children` must be an array** (empty `[]` is fine) — an undefined
  `children` crashes the transform (verified).
- Verified: the transform assigns `frameId` to each child and returns frames
  sorted AFTER their children — find frames by type when reading the result.
- The methodology uses frames sparingly; prefer the layout scale tiers and
  whitespace for grouping (see `workflows/draw-a-diagram.md`).
