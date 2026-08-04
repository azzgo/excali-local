# Workflow — draw a diagram on the activated canvas

This is the skill's methodology (adapted from the proven coleam00 diagram
methodology) **adapted to live-canvas delivery**: you emit elements onto the
activated canvas through the CLI, and you *see* your work through
`scene.exportPng` — no files written to disk, no headless browser, no CDN.
The live canvas IS the renderer.

Prerequisites: a **paired connection** and an **activated canvas** (see
`SKILL.md`). Check first: `scene.get` must succeed (not `-32001`).

## 0. Plan before you touch the canvas

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
- Keep each `elements.add` batch self-contained (a few elements to a dozen),
  so failures are cheap to fix.

> **Hand-craft the JSON. No generator script. No JSON sub-agent.** You write
> the element payloads yourself, directly in the `elements.add` argument.
> Indirection (a script that builds JSON, or a sub-agent that drafts it)
> costs you the context needed to debug and iterate.

## 3. The mandatory render → view → fix loop (2–4 iterations)

This is non-negotiable. Emitting once and declaring success is not a
workflow.

1. **Render** — apply the current section (or the whole scene):
   ```bash
   $BIN elements.add '{"elements":[...your partials...]}'
   ```
2. **View** — read back a picture:
   ```bash
   $BIN scene.exportPng '{"mimeType":"image/png"}'
   ```
   → returns a base64 `dataURL` — view it with your image tool. For
   structural readbacks:
   ```bash
   $BIN scene.bounds      # {x, y, width, height} — layout bleed / overlaps
   $BIN scene.get         # full scene — check bindings, ids, values
   ```
3. **Audit against the planned vision** — check the defect list:
   - clipped or overflowing text (element larger than its container /
     bounds mismatch),
   - overlapping elements (two elements at the same x/y region),
   - misrouted arrows (arrow not visually connected — check `start`/`end`
     ids in `scene.get`),
   - lopsided composition (bounds far off the intended center),
   - stale bindings (`boundElements` / `containerId` mismatches).
4. **Fix** — adjust coordinates, widths/heights, points, or bindings and
   re-emit (`elements.add` for new content, `scene.update` for replacing
   existing elements read from `scene.get`). Re-render and re-view.

Repeat until the picture matches the plan. 2–4 iterations is normal; quality
here is the product.

## 4. Aesthetics (the standing rules)

- `roughness: 0` (clean, deliberate — the canvas default is 1, set it).
- `strokeWidth` 1/2/3 — never arbitrary; use 1 for hairlines, 2 for
  structure, 3 for the hero/emphasis.
- `opacity: 100` always.
- `fontFamily` 1|2|3 and `fontSize` explicit on every text element
  (canvas defaults are 5/20 — see `element-templates.md`).
- Colors from `color-palette.md` only.

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
   "strokeColor":"#020817","backgroundColor":"#f1f5f9","fillStyle":"solid",
   "strokeWidth":2,"roughness":0,"opacity":100,
   "label":{"text":"Input","fontFamily":3,"fontSize":16,
            "textAlign":"center","verticalAlign":"middle"}},
  {"type":"rectangle","id":"pipeline","x":420,"y":200,"width":180,"height":90,
   "strokeColor":"#020817","backgroundColor":"#e8c468","fillStyle":"solid",
   "strokeWidth":2,"roughness":0,"opacity":100,
   "label":{"text":"Pipeline","fontFamily":3,"fontSize":16,
            "textAlign":"center","verticalAlign":"middle"}},
  {"type":"arrow","x":280,"y":245,"width":140,"height":0,
   "points":[[0,0],[140,0]],
   "strokeColor":"#020817","strokeWidth":2,"roughness":0,"opacity":100,
   "start":{"id":"input"},"end":{"id":"pipeline"}},
  {"type":"text","x":280,"y":270,"text":"feeds","fontFamily":2,"fontSize":14,
   "textAlign":"center","verticalAlign":"middle",
   "strokeColor":"#64748b","strokeWidth":2,"roughness":0,"opacity":100}
]}'
$BIN scene.exportPng   # view → fix → repeat
```
