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

### Measure, then place — never guess a size

**This is the single most important rule in the file.** Every layout defect
this skill used to produce — labels crammed into two lines, boxes covering
each other, arrows landing nowhere — traces back to placing elements by a
*guessed* size. The canvas measures text exactly; use that instead of a
number you made up.

The protocol, in three steps:

1. **Measure.** Emit your labels as bare `text` elements (any position — you
   are going to move them) in one `elements.add`. Read `scene.get` back: the
   returned `width`/`height` on each text element are the renderer's measured
   sizes, including whatever wrapping Excalidraw applied.
2. **Place.** Derive each container from its measured label:
   `boxWidth = max(160, labelWidth + 28)`, `boxHeight = max(64, labelHeight + 22)`.
   Then pack. Do **not** reuse a fixed box size for every node — that is what
   forces a long label to wrap.
3. **Emit.** Send the containers (with `label`) and the arrows in one
   `elements.add`, then `scene.audit` (see §3.1).

A fixed size tier cannot be correct for a set of labels of different lengths.
Use tiers only to rank *relative* importance (font size, stroke weight,
whitespace around the hero) — never as a literal `width`/`height` for a
container that holds text.

### Spacing numbers

Use these gaps rather than "a grid of your choosing". They come from the
layered-graph preset (ELK) that has been stress-tested on complex diagrams;
they are also what `scene.audit` checks against:

| Gap | Value | Between |
| --- | --- | --- |
| sibling gap | **56 px** | two nodes in the same row |
| layer gap | **80 px** | one row of nodes and the next |
| edge-to-node | **32 px** | an arrow and a node it does not touch |
| edge-to-edge | **24 px** | two arrows running in parallel |
| canvas padding | **48 px** | the outermost element and the scene edge |
| minimum gutter | **40 px** | anything at all (`scene.audit`'s floor) |

A uniform gutter is not the same as a *correct* gutter: two nodes 40 px apart
are still wrong if their labels are 300 px wide and they overlap.

### The rest

- **Hierarchy through scale**: hero / primary / secondary / small still ranks
  elements — but express rank through `fontSize` (20 / 16 / 14 / 12),
  `strokeWidth` (3 / 2 / 1) and surrounding whitespace, **not** through a
  fixed box size. Whitespace = importance: ≥ 200 px of clear space around the
  hero.
- **Explicit flow direction** — left→right by default, or top→bottom.
  If A relates to B, **there must be an arrow** between them
  (`arrow` with `start`/`end` bindings — see `element-templates.md`).
- **Container discipline**: default to free-floating text; **target < 30% of
  text elements inside containers**. A box must earn its border.
- **Verify with `scene.bounds` and `scene.audit`**, not by eyeballing
  coordinates. `scene.bounds` catches layout bleed; `scene.audit` catches
  everything else (see §3.1).
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

> **Hand-craft the payload. Coordinates may be computed; the elements may
> not.** Two different things, and the distinction matters:
>
> - ✅ **Computing geometry is fine** — measuring a label, deriving
>   `width = labelWidth + 28`, packing a row by measured widths, computing a
>   layer's y. That is deterministic arithmetic over numbers you read back from
>   the canvas. It removes guessing; it does not hide anything from you.
> - ❌ **Delegating the payload is not fine** — a script that emits the whole
>   `elements.add` JSON, or a sub-agent that drafts the element list. You lose
>   the context needed to debug what came out, and the transform's real
>   behaviour (id regeneration, binding closure, label normalization) becomes
>   invisible to you.
>
> So: write every element's `type`, `label`, `start`/`end`, and style yourself.
> Computing the `x`/`y`/`width`/`height` you feed them is encouraged.

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

Run the audit **after every emit**, and again after every fix. It is one call —
do not hand-compute pairwise geometry:

```bash
$BIN scene.audit              # audit the live scene with the default thresholds
$BIN scene.audit '{"gutter":40,"maxLabelLines":1}'
$BIN scene.bounds             # {x, y, width, height} — layout bleed / composition
```

`scene.audit` returns `ok`, `readabilityOk`, and the defect lists. Read it in
two passes, because the two flags mean different things:

**Pass 1 — `ok` (hard geometry). If `false`, fix before continuing.**

| Field | Means | Fix |
| --- | --- | --- |
| `overlaps` | two solids share area (arrows and bound labels excluded) | move them apart; the pair is named with its overlap area |
| `gutterViolations` | clear gap under the floor | widen to the spacing table in §1 |
| `textFit` | a bound label exceeds its container's inner box (`too-wide` / `too-tall`) | enlarge the container from the measured label |
| `unboundArrows` | an arrow has no `startBinding` or `endBinding` | bind it (see `element-templates.md` — cross-batch bindings need `scene.update`) |
| `bindingViolations` | `dangling-target` (bound to an id that does not exist) or `missing-reverse` (the container's `boundElements` lacks the arrow) | re-emit both halves of the binding |
| `waypointsInsideNodes` | a bend point landed inside a node the arrow is **not** attached to | reroute; this is the "line goes through a box" defect |

**Pass 2 — `readabilityOk` (quality, not geometry). If `false`, you can still
ship, but you should not want to.**

`readabilityOk: false` means `wrappedLabels` exceeded `maxLabelLines`: a label
had to wrap. This is **not** a geometry error — Excalidraw wraps and re-centers
text, so the box still contains it, and `ok` stays `true`. It is the
"crammed into a fixed card" look, and it means you placed a box by a guessed
size instead of a measured one. Fix it by re-running the measure-then-place
protocol from §1.

Also watch `deadSpaceRatio` (container area not covered by its label — high
means over-sized boxes) and `bounds` (composition; a very high `aspect` means a
wide strip, which usually wants splitting into pages).

**What `scene.audit` deliberately does not do**, so you do not mistake silence
for approval:

- It does not check where an arrow's fold points land relative to *its own*
  endpoints — those sit inside their boxes by definition, and Excalidraw
  computes the real route in the renderer.
- It does not judge aesthetics: colour balance, whether the diagram *argues*.
  That is the visual track (§3.2) or the user.
- It does not check text against the scene edge; use `scene.bounds` for bleed.

The algorithm is `packages/shared/src/scene-audit.ts`, and its behaviour is
pinned by tests in both `shared` and `page` — so the thresholds above are what
actually runs, not an aspiration.

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
- **Don't** delegate the *payload* to a sub-agent or a generator script — but
  **do** compute geometry (see the boxed note in §2). Measuring and packing by
  measured size is required; emitting the element JSON blindly is not.
- **Don't** place a text-bearing container by a guessed size, and **don't**
  reuse one fixed box size for every node — that is what forces labels to wrap.
  Measure first (§1).
- **Don't** hand-compute pairwise geometry when `scene.audit` answers it.
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
$BIN scene.audit                       # structural verify — expect "ok"
$BIN scene.bounds                      # composition
# + scene.exportPng only if you have vision
```

Expected `scene.audit` result: `ok: true`, `readabilityOk: true`,
`wrappedLabels: 0`. Both labels are short enough to sit on one line, and the
gap between the boxes is 140 px — well above the 40 px floor.
