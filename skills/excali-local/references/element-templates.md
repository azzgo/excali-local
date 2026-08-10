# Element templates — copy-paste JSON for `elements.add`

Every template below is a **partial** — you do not need Excalidraw's full
serialized fields (`version`, `versionNonce`, `seed`, `index`, `updated`,
`lastCommittedPoint`, `binders`, …). `elements.add` runs your partials
through the real Excalidraw element transform, which fills defaults,
**regenerates ids**, and re-closes bindings. These shapes were **verified by
round-trip** against the patched Excalidraw build the editor runs
(`test/features/editor/lib/element-templates-roundtrip.test.ts`); the notes
under each template are the verified behavior, not theory.

> **Rules that apply to every template** (Sketch preset — the skill default)
>
> - **Default `roughness: 1`** (hand-drawn). Set `0` only for the Clean preset.
>   The transform's own default is also `1`, so Sketch simply stays out of its
>   way instead of fighting it.
> - **Default `roundness: { "type": 3 }`** on shapes — soft rounded corners.
>   Omit it (→ `null`, sharp corners) for the Clean preset.
> - **Always set `strokeWidth`** (1/2/3 per the methodology) and `opacity: 100`.
> - **Default text font is `fontFamily: 1` (handwriting)** for
>   Sketch/Notebook/Cartoon; `2` (normal) for Clean; `3` (code) **only for real
>   code/evidence**. Always set `fontFamily` and `fontSize` — the transform's
>   defaults are `fontFamily: 5` and `fontSize: 20` with left/top alignment; the
>   skill default is `fontSize: 16`, `textAlign: "center"`,
>   `verticalAlign: "middle"`.
> - **Ids are input-hints, not output.** You may set ids (they let arrows
>   bind and text bind to containers), but the emitted elements will carry
>   fresh random ids. Never rely on an id surviving `elements.add`.
> - **Never hand-write `version`/`versionNonce`/`seed`/`index`/`updated`** —
>   the transform owns them.
>
> Colors below use the **Warm** palette (Sketch default). For the Clean preset,
> swap to the **Slate** values from [`color-palette.md`](color-palette.md).

## Text (free-floating)

```json
{ "type": "text", "x": 0, "y": 0, "text": "Hello",
  "fontFamily": 1, "fontSize": 16,
  "textAlign": "center", "verticalAlign": "middle",
  "strokeColor": "#1e1e1e", "strokeWidth": 2, "roughness": 1, "opacity": 100 }
```

- Verified: normalizes with id, `originalText` = text, `containerId: null`,
  `autoResize: true`, width/height computed from the text metrics, JSON
  round-trip stable (style + geometry survive re-normalization).
- `fontFamily` 1 = handwriting slot, 2 = normal slot, 3 = code slot — see
  [`workflows/install-and-use-a-font.md`](workflows/install-and-use-a-font.md).
  An unconfigured slot falls back to Excalidraw's built-in font for that id, so
  a handwriting primary renders hand-drawn with zero font setup.

## Line (open polyline)

```json
{ "type": "line", "x": 10, "y": 20, "width": 50, "height": 40,
  "points": [[0, 0], [50, 0], [50, 40]],
  "strokeColor": "#1e1e1e", "strokeWidth": 2, "roughness": 1, "opacity": 100 }
```

- **`width`/`height` are NOT derived from points** — a partial line without
  them normalizes to `100 × 0` (broken). Compute them as the extent of your
  points. (Arrows DO derive size from points; lines do not.)
- Verified: points preserved exactly; `polygon: false`, `startBinding: null`,
  `endBinding: null`, `roundness: null` (lines stay angular at waypoints —
  straight structural strokes; `roughness: 1` gives the hand-drawn jitter).

## Dot (small filled ellipse — for markers, ticks, endpoints)

```json
{ "type": "ellipse", "x": 0, "y": 0, "width": 10, "height": 10,
  "strokeColor": "#1e1e1e", "backgroundColor": "#1e1e1e",
  "strokeWidth": 2, "roughness": 1, "opacity": 100 }
```

- Verified: geometry preserved; `fillStyle: "solid"`, `roundness: null` (an
  ellipse is already round — corner roundness is irrelevant).

## Rectangle / shape (also diamond, ellipse)

```json
{ "type": "rectangle", "x": 100, "y": 100, "width": 180, "height": 90,
  "strokeColor": "#1e1e1e",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 1, "opacity": 100,
  "roundness": { "type": 3 } }
```

- Types `rectangle`, `diamond`, `ellipse` share this shape.
- Verified: geometry preserved; defaults filled (`fillStyle: "solid"`,
  `angle: 0`, `boundElements: null`). **`roundness` omitted → `null` (sharp
  corners)**; setting `{ "type": 3 }` produces the soft rounded corners that are
  the Sketch default. No `backgroundColor` above = transparent neutral (ink
  outline box); add a Warm fill from `color-palette.md` when the box carries
  meaning.

## Text-in-shape (bound label)

The binding-close input form is a **`label` property on the container** —
NOT a `containerId` on a separate text element:

```json
{ "type": "rectangle", "x": 0, "y": 0, "width": 200, "height": 100,
  "strokeColor": "#1e1e1e", "backgroundColor": "#ffec99",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 1, "opacity": 100,
  "roundness": { "type": 3 },
  "label": { "text": "Title", "fontFamily": 1, "fontSize": 16,
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
  to push the same scene back, use `scene.update` (render-safe passthrough — ids and
  bindings preserved), **not** `elements.add` (which regenerates ids and
  leaves `containerId`/`startBinding`/`endBinding` pointing at stale ids).
- **`scene.update` is full-replace per element**: a container's `boundElements`
  holds its bindings — the label's `{type:"text",id}` plus any
  `{type:"arrow",id}` for glued arrows. Re-emitting a container with `[]`,
  `null`, or a partial `boundElements` detaches the label (and drops glued
  arrows' reverse-link). Echo the element exactly as `scene.get` returned it
  and change only the target field — the page's `null`→`[]` coercion is a
  render-safety net, not binding recovery. (Arrows: keep
  `startBinding`/`endBinding` likewise.)

## Arrow with bindings

The binding-close input form uses `start`/`end` (linear-element style) —
**not** `startBinding`/`endBinding`:

```json
{ "type": "rectangle", "id": "from", "x": 0, "y": 0, "width": 100, "height": 50,
  "strokeColor": "#1e1e1e", "fillStyle": "solid", "strokeWidth": 2,
  "roughness": 1, "opacity": 100, "roundness": { "type": 3 } },
{ "type": "rectangle", "id": "to", "x": 300, "y": 0, "width": 100, "height": 50,
  "strokeColor": "#1e1e1e", "fillStyle": "solid", "strokeWidth": 2,
  "roughness": 1, "opacity": 100, "roundness": { "type": 3 } },
{ "type": "arrow", "x": 100, "y": 25, "width": 200, "height": 0,
  "points": [[0, 0], [200, 0]],
  "strokeColor": "#1e1e1e", "strokeWidth": 2, "roughness": 1, "opacity": 100,
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
- **Bindings resolve within the batch only** (verified live): `start`/`end`
  reference elements in the SAME `elements.add` batch. An arrow bound to a
  box from an earlier batch comes out with `startBinding`/`endBinding` null.
  To bind an arrow to elements already on the canvas, push it via
  `scene.update` with serialized `startBinding`/`endBinding`
  (`{ elementId, mode: "orbit", fixedPoint: [x, y] }`) and append the arrow id
  to both endpoints' `boundElements` as `{ "type": "arrow", "id": "<arrow-id>" }`
  — an ARRAY of records, never `null` (the page coerces null→[] as a safety
  net, but a missing entry means the binding won't survive) — verified to
  render and survive.
  **`fixedPoint` is a NORMALIZED RATIO, not pixels**: the bound point is
  `element.x + width·fx, element.y + height·fy` (clamped to [−10, 10]
  internally) — verified against the csp.14 build's
  `getGlobalFixedPointForBindableElement`. So bottom-center of a box is
  `[0.5, 1]`, right-edge midpoint is `[1, 0.5]`.
- **Bbox discipline for hand-serialized linear elements** (scene.update is
  passthrough — no transform fixes your numbers): an arrow's `x`/`y` must be
  the MIN point of its absolute path and `width`/`height` its extent. The
  points are RELATIVE to `x`/`y`, so with a first point of `[0,0]` set
  `x,y` = path start and `w,h` = max extent. A stale bbox (e.g. `y` set to
  the path's start when the path goes UP) renders fine for bound arrows but
  skews `scene.bounds`, hit-testing and export clipping — and it is exactly
  the kind of thing the render→view→fix loop misses until you audit
  absolute points.
- **Route loop-backs with curves, not raw 90° elbows**: a long return arrow
  drawn as two hard right-angle corners (right → up → left) reads as a stiff
  zigzag. Give it 3+ points and `roundness: { type: 2 }` so the corners
  curve, and keep a dedicated routing lane with ≥ 40 px gutter away from
  captions.
- **Default arrows are straight** (2 points, no `roundness`) — the structural
  spine stays reliable to bind and route. Curved arrows live in the liveliness
  toolbox below.

## Liveliness toolbox (Sketch / Notebook / Cartoon — closed in Clean)

The hand-drawn vocabulary the old skill never used. Schema-supported; the
transform behavior is pinned in
`test/features/editor/lib/element-templates-roundtrip.test.ts` (freedraw's
groupIds/pressures omission + the page's normalize, curved-arrow
`roundness {type:2}` + same-batch binding, dashed strokes, varied arrowheads
— all verified live). **Use where the diagram argues, not on everything** —
an accent must underline a key term, circle a critical value, or point at
the thing that matters. Decoration for its own sake (random sticky notes,
doodles) is noise, not liveliness.

**Dashed / dotted connections** (semantic stroke style):

```json
{ "type": "arrow", "x": 100, "y": 25, "width": 200, "height": 0,
  "points": [[0, 0], [200, 0]],
  "strokeColor": "#1e1e1e", "strokeWidth": 2, "roughness": 1, "opacity": 100,
  "strokeStyle": "dashed",
  "start": { "id": "from" }, "end": { "id": "to" } }
```

`strokeStyle: "dashed"` = optional / weak link; `"dotted"` = tentative /
inferred. A second channel of meaning, not decoration.

**Varied arrowheads** (encode semantics in the head):

```json
{ "type": "arrow", "x": 100, "y": 25, "width": 200, "height": 0,
  "points": [[0, 0], [200, 0]],
  "strokeColor": "#1e1e1e", "strokeWidth": 2, "roughness": 1, "opacity": 100,
  "startArrowhead": "dot", "endArrowhead": "arrow",
  "start": { "id": "from" }, "end": { "id": "to" } }
```

Valid heads: `arrow` (default), `dot` / `circle` (origin marker), `triangle`,
`bar` (terminate). Set `startArrowhead` and `endArrowhead` independently.

**Curved arrow** (route around elements / organic relation — 3+ points with
the linear-element round setting):

```json
{ "type": "arrow", "x": 100, "y": 0, "width": 200, "height": 100,
  "points": [[0, 0], [100, 80], [200, 0]],
  "strokeColor": "#1e1e1e", "strokeWidth": 2, "roughness": 1, "opacity": 100,
  "roundness": { "type": 3 },
  "start": { "id": "from" }, "end": { "id": "to" } }
```

A 2-point arrow is always straight; curvature needs 3+ points. Verified
live: `roundness: { "type": 2 }` on an arrow survives the transform and
renders curved through the waypoints. Binding follows the same within-batch
rule as any arrow — emit the endpoints and the curved arrow in one batch, or
bind cross-batch via `scene.update` (see the Arrow section).

**Small dot marker** — see the Dot template above (8–14 px filled ellipse) for
timeline ticks, list bullets, connection nodes.

**freedraw accent** (hand-drawn underline, circle-around, emphasis arrow):

```json
{ "type": "freedraw", "x": 90, "y": 40, "width": 120, "height": 10,
  "points": [[0, 8], [20, 4], [60, 0], [100, 5], [120, 8]],
  "strokeColor": "#1e1e1e", "strokeWidth": 2, "roughness": 1, "opacity": 100 }
```

`points` are relative to `x`/`y`; `pressures`/`simulatePressure` are optional.
Most alive in the Notebook preset — the signature flourish of a hand-drawn
look.

## Frame (grouping region)

```json
{ "type": "rectangle", "id": "inside", "x": 20, "y": 20, "width": 100, "height": 50,
  "strokeColor": "#1e1e1e", "strokeWidth": 2,
  "roughness": 1, "opacity": 100, "roundness": { "type": 3 } },
{ "type": "frame", "id": "f1", "children": ["inside"], "name": "Phase 1" }
```

- **`children` must be an array** (empty `[]` is fine) — an undefined
  `children` crashes the transform (verified).
- Verified: the transform assigns `frameId` to each child and returns frames
  sorted AFTER their children — find frames by type when reading the result.
- The methodology uses frames sparingly; prefer the layout scale tiers and
  whitespace for grouping (see [`workflows/draw-a-diagram.md`](workflows/draw-a-diagram.md)).
