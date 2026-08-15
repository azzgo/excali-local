# Workflow — draw a diagram on the activated canvas

This is the skill's methodology (adapted from the proven coleam00 diagram
methodology) **adapted to live-canvas delivery**: you emit elements onto the
activated canvas through the CLI, and you *see* your work through
`scene.exportPng` — no files written to disk, no headless browser, no CDN.
The live canvas IS the renderer.

Prerequisites: a **paired connection** and an **activated canvas** (see
`SKILL.md`). Check first: `scene.get` must succeed (not `-32001`).

## 0. Plan before you touch the canvas

0. **Pick a visual style preset** (default **Sketch** — rich, colorful, lively hand-drawn).
   Infer from the user's words: "技术 / 架构 / 示意 / clean / technical" →
   Clean; "草稿 / 白板 / 头脑风暴 / draft / whiteboard" → Notebook;
   "卡通 / playful" → Cartoon; unstated → Sketch. Say in one line which
   preset you're using and why. This sets your `roughness`, corners, palette,
   and font defaults — see [`style-presets.md`](../style-presets.md). Shape
   vocabulary is a separate axis in [`diagram-shape-grammar.md`](../diagram-shape-grammar.md).

1. **Diagrams should ARGUE, not DISPLAY.** Two tests:
   - *Isomorphism*: remove all text — does the structure alone still convey
     the concept?
   - *Education*: could someone learn something concrete from it?
2. **Assess depth.** Simple/conceptual vs Comprehensive/technical. Technical
   diagrams MUST include evidence artifacts — real code snippets, actual
   event names, real JSON payloads — and must be researched (read the real
   source, docs, configs) before drawing. If you cannot name the real
   artifacts, you are not ready to draw.
3. **Choose the multi-zoom architecture**:
   - **L1** — the summary flow (top-level arrows between major sections).
   - **L2** — section boundaries (each section is a region, not a blob).
   - **L3** — detail inside sections (only where it argues).
4. **Map concepts to patterns**: fan-out, convergence, tree, timeline,
   spiral/cycle, cloud, assembly-line, side-by-side, gap/break, and
   "lines as structure" (timelines/trees drawn with `line` + free-floating
   text — no boxes).

## 1. Layout discipline

- **Hierarchy through scale** (px units):
  - Hero `300 × 150`, Primary `180 × 90`, Secondary `120 × 60`,
    Small `60 × 40`.
  - Whitespace = importance: ≥ 200 px of clear space around the hero.
  - Scale tiers encode rank; text size follows the tier.
- **Explicit flow direction** — left→right by default, or top→bottom.
  If A relates to B, **there must be an arrow** between them
  (`arrow` with `start`/`end` bindings — see `element-templates.md`).
- **Container discipline**: default to free-floating text; **target < 30% of
  text elements inside containers**. A box must earn its border.
- **Coordinates**: place elements on a grid of your choosing (e.g. x = 100,
  400, 700…; y = 100, 300, 500…) and keep a consistent gutter (≥ 40 px)
  between elements. Compute `scene.bounds` to catch layout bleed.

## 2. Build section by section (never one shot)

Large diagrams are built in sections. Emit one section per `elements.add`
call, in reading order:

- **Descriptive string ids** for anything you reference later
  (`"trigger_rect"`, `"db_primary"`, …) — they make bindings readable, even
  though ids are regenerated on add.
- **Namespaced numeric seeds per section**: section 1 uses seeds 100000..199999,
  section 2 uses 200000.., etc. (Only meaningful if you *do* pass seeds —
  prefer omitting them and letting the transform generate them; the
  namespacing discipline still keeps your *sections* independent.)
- **Incremental binding**: bind text/arrows within the section as you emit
  it; never re-emit a whole section just to fix one binding.
- **Cross-section arrows**: `elements.add` resolves `start`/`end` only within
  its own batch — an arrow to a box from an earlier section comes out unbound.
  To connect to existing elements, read the scene, add the arrow with
  serialized `startBinding`/`endBinding` + the endpoints' `boundElements`
  closures, and push via `scene.update` (verified — see `element-templates.md`).
- Keep each `elements.add` batch self-contained (a few elements to a dozen),
  so failures are cheap to fix.

### Default build order — skeleton first

Unless the diagram is tiny (a handful of elements), build in this order —
one `elements.add` + one `scene.exportPng` view per step:

1. **Structure lines / region dividers** — the L1/L2 skeleton: the flow lines,
   section boundaries, and region rectangles that give the diagram its
   architecture.
2. **Container boxes + their labels** — the L2/L3 containers that hold detail.
3. **Text / detail inside sections** — the L3 content, bound into the boxes.
4. **Arrows / bindings** — the connections between sections and elements.
5. **Coordinate / overlap / bleed fixes** — via `scene.bounds` (and
   `scene.get` for binding checks), adjusted with `scene.update`.

Each step is a separate visible iteration on the canvas; **revisiting and
revising earlier steps is expected** — re-emit only the changed elements read
back from `scene.get` via `scene.update` (never a serialized `scene.get`
scene through `elements.add` — it regenerates ids and drops bindings).

> **Hand-craft the JSON. No generator script. No JSON sub-agent.** You write
> the element payloads yourself, directly in the `elements.add` argument.
> Indirection (a script that builds JSON, or a sub-agent that drafts it)
> costs you the context needed to debug and iterate.

## 3. The mandatory render → verify → fix loop

This is non-negotiable. Emitting once and declaring success is not a
workflow. **One batch in = one verification out**: after every `elements.add`,
verify the result before the next batch — never stack several sections without
checking between them.

Verification comes in two composable tracks. Pick yours by self-declaration —
you know whether you can view images:

- **Structural verification** (every agent, the baseline) — an arithmetic audit
  of readback geometry. All inputs are exact numbers (`scene.get` returns
  renderer-measured text sizes), so nothing here needs vision.
- **Visual verification** (add-on for agents with vision) — the `scene.exportPng`
  picture readback layered on top, catching what arithmetic cannot: color,
  aesthetics, whether the whole looks right.

On the text-only track, **never call `exportPng` to self-check** — you cannot see
the PNG; the call is pure waste. (`exportPng` remains in your vocabulary for
when the user explicitly wants an image.)

### 3.1 Structural verification (baseline — run this on every track)

Compute the audit **before each emit** (all inputs are numbers, so mistakes are
cheapest to fix pre-emit), then read back what you could not predict:

```bash
$BIN scene.bounds      # {x, y, width, height} — layout bleed / composition
$BIN scene.get         # full scene — bindings, ids, measured sizes
```

Audit the readback against the defect list (each visual defect has an exact
structural counterpart):

| Visual defect | Structural check |
| --- | --- |
| clipped / overflowing text | `label.width/height` vs container `width/height` minus padding (measurements are renderer-exact — no estimation) |
| overlapping elements | pairwise AABB on returned `x/y/width/height` — **excluding arrows and freedraw accents** (they legitimately cross regions) |
| misrouted arrows | every arrow's `start`/`end` (or `startBinding`/`endBinding`) resolves to a live element id; no unbound endpoint that was meant to bind |
| lopsided composition | `scene.bounds` center vs the planned grid center |
| stale bindings | `containerId` ↔ `boundElements` bidirectional closure on containers and labels |
| cramped spacing | pairwise gap ≥ 40 px (the gutter rule — exact, where vision only estimates) |

Geometry is computable — there is no daemon-side audit method, and none is
needed: the arithmetic above is trivial per batch (a few → a dozen elements).

### 3.2 Visual verification (agents with vision only)

On top of the structural baseline, after each batch:

```bash
$BIN scene.exportPng '{"mimeType":"image/png"}'
```

→ returns a base64 `dataURL` — view it with your image tool, and audit against
the planned vision: clipped text, misrouted arrows, lopsided composition, and
the aesthetic qualities arithmetic cannot reach (color balance, hand-drawn
charm, whether the picture *argues*).

### 3.3 Fix and iterate

Adjust coordinates, widths/heights, points, or bindings and re-emit
(`elements.add` for new content, `scene.update` for replacing existing
elements read from `scene.get`). Re-render and re-verify.

Budget: visual track 2–4 iterations is normal (reactive — see, fix); text-only
track 1–3 fix iterations is normal (proactive — audit pre-emit, so iterations
absorb only surprises: binding closures from the real transform, normalization
quirks, payload typos). Quality here is the product.

**Text-only completion:** when the structural audit is clean and you are done,
tell the user to check the canvas themselves — they own it and can see what you
cannot — and offer to fix anything they spot. Structural verification cannot
judge aesthetics; the user is the aesthetic acceptance step.

If you catch yourself about to emit the whole remaining diagram in one call —
stop, split it into sections, and loop again (SKILL.md: incremental delivery is
mandatory).

## 4. Aesthetics (the standing rules)

These follow the preset you picked in step 0 (see
[`style-presets.md`](../style-presets.md)). The **Sketch** defaults:

- `roughness: 1` (hand-drawn — also the canvas's own default; set `0` only for
  the Clean preset).
- `roundness: { "type": 3 }` on shapes — soft rounded corners (`null` for the
  Clean preset's sharp corners).
- `strokeWidth` 1/2/3 — never arbitrary; use 1 for hairlines, 2 for
  structure, 3 for the hero/emphasis.
- `opacity: 100` always.
- `fontFamily` 5 (handwriting) primary for Sketch/Notebook/Cartoon; `6` (normal)
  for Clean; `8` (code) **only for real code/evidence**. `fontSize` explicit on
  every text element (canvas defaults are 5/20 — see `element-templates.md`).
- Colors from `color-palette.md` only — **Warm** for Sketch/Notebook/Cartoon,
  **Slate** for Clean.
- Neutral boxes default to the light-warm fill `#fff9db` (浅暖奶油底); roles
  use the full Warm palette (多色同框允许) — see `color-palette.md`.
- Liveliness toolbox **default-on** in Sketch: curved routes for non-spine
  connections, freedraw underline/circle accents on key terms, hachure on
  non-text regions, semantically varied arrowheads.

## 5. What NOT to do

- **Don't** generate the whole diagram in one response.
- **Don't** delegate JSON to a sub-agent, and **don't** write a generator
  script.
- **Don't** emit `version`/`versionNonce`/`seed`/`index` — transform-owned.
- **Don't** use `scene.update` for brand-new content (it bypasses
  normalization; `elements.add` is the normalize+concat path) and **don't**
  use `elements.add` to re-emit a serialized `scene.get` scene (it
  regenerates ids and drops bindings) — use `scene.update` for that.
- **Don't** retry a `-32001` (no active canvas) or `-32005` (user declined a
  confirmation) — stop and talk to the user.

## 6. A complete small example

Goal: a two-box flow — "input" → "pipeline" — with one arrow and a caption.

```bash
$BIN elements.add '{"elements":[
  {"type":"rectangle","id":"input","x":100,"y":200,"width":180,"height":90,
   "strokeColor":"#1e1e1e","backgroundColor":"#fff9db","fillStyle":"solid",
   "strokeWidth":2,"roughness":1,"opacity":100,"roundness":{"type":3},
   "label":{"text":"Input","fontFamily":5,"fontSize":16,
            "textAlign":"center","verticalAlign":"middle"}},
  {"type":"rectangle","id":"pipeline","x":420,"y":200,"width":180,"height":90,
   "strokeColor":"#1e1e1e","backgroundColor":"#ffec99","fillStyle":"solid",
   "strokeWidth":2,"roughness":1,"opacity":100,"roundness":{"type":3},
   "label":{"text":"Pipeline","fontFamily":5,"fontSize":16,
            "textAlign":"center","verticalAlign":"middle"}},
  {"type":"arrow","x":280,"y":245,"width":140,"height":0,
   "points":[[0,0],[140,0]],
   "strokeColor":"#1e1e1e","strokeWidth":2,"roughness":1,"opacity":100,
   "start":{"id":"input"},"end":{"id":"pipeline"}},
  {"type":"text","x":280,"y":270,"text":"feeds","fontFamily":5,"fontSize":14,
   "textAlign":"center","verticalAlign":"middle",
   "strokeColor":"#868e96","strokeWidth":2,"roughness":1,"opacity":100}
]}'
$BIN scene.get && $BIN scene.bounds   # structural verify; + scene.exportPng if you have vision
```
