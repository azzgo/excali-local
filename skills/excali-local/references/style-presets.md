# Visual style presets — the character of what you draw

A **preset** is a bundle of visual-character choices: how rough the strokes are,
whether corners are soft or sharp, which palette of colors and which font
hierarchy the diagram uses, and how much "liveliness" (curved arrows, freedraw
accents, varied arrowheads) is on the table. Pick one before you touch the
canvas; it steers the whole drawing.

> **Presets carry no hex values.** Every color lives in
> [`color-palette.md`](color-palette.md) as named palettes (**Warm** and
> **Slate**). A preset names a palette; it never inlines color codes. That keeps
> `color-palette.md` the single place to change when the brand refreshes.
>
> **Two axes, independent.** A preset fixes *visual character*. *Which shape
> means what* (diamond = decision, ellipse = start) is a separate concern in
> [`diagram-shape-grammar.md`](diagram-shape-grammar.md). They compose: a
> flowchart can be Sketch or Clean. Layout is still governed by the methodology
> in [`workflows/draw-a-diagram.md`](workflows/draw-a-diagram.md).

## Quick reference

| Preset | One-liner | Palette | Primary font | When |
| --- | --- | --- | --- | --- |
| **Sketch** *(default)* | Excalidraw's signature hand-drawn, warm, lively | Warm | handwriting (1) | anything without a style qualifier |
| **Clean** / Technical | crisp, schematic, cool, readable | Slate | normal (2) | "技术 / 架构 / 示意图 / clean / technical / schematic" |
| **Notebook** / Whiteboard | loose sketch, hachure warmth, doodled accents | Warm | handwriting (1) | "草稿 / 白板 / 头脑风暴 / draft / whiteboard / brainstorm" |
| **Cartoon** *(optional)* | bold, very rough, saturated, playful | Warm (saturated) | handwriting (1), larger | "卡通 / 可爱 / 活泼夸张 / cartoon / playful" |

## Sketch (the default)

The Excalidraw look. This is what the canvas produces unless the user signals
otherwise.

| Knob | Default | Notes |
| --- | --- | --- |
| `roughness` | `1` | hand-drawn, organic |
| `roundness` | `{ "type": 3 }` | soft rounded corners on shapes |
| `fillStyle` | `"solid"` | `"hachure"` allowed as optional warmth on **light** fills; dark/inverted fills stay `"solid"` |
| `strokeWidth` | `2` | `1` hairlines, `3` hero/emphasis |
| `opacity` | `100` | always |
| ink / text `strokeColor` | Warm ink (see `color-palette.md`) | `#1e1e1e`, warm-neutral near-black |

- **Palette:** Warm.
- **Font hierarchy:** handwriting slot (`fontFamily: 1`) is the primary face for
  titles, labels, and body. Code slot (`fontFamily: 3`) is reserved for actual
  code / evidence snippets only.
- **Liveliness toolbox:** full (see appendix) — use as the diagram argues, not
  on everything.

## Clean / Technical

Crisp and schematic — the look the skill had before this redesign. Reach for it
when the user wants a schematic, an architecture doc, or explicitly "clean."

| Knob | Default | Notes |
| --- | --- | --- |
| `roughness` | `0` | crisp, deliberate |
| `roundness` | `null` | sharp 90° corners |
| `fillStyle` | `"solid"` | only `"solid"` in this preset |
| `strokeWidth` | `1`/`2`/`3` | `1` for hairlines/dividers |
| `opacity` | `100` | always |
| ink / text `strokeColor` | Slate ink (see `color-palette.md`) | near-black navy |

- **Palette:** Slate (the one derived from the product's UI tokens — only here
  does "diagrams sit next to the product" still apply).
- **Font hierarchy:** normal slot (`fontFamily: 2`) is primary; code slot
  (`fontFamily: 3`) for evidence. Readability over warmth.
- **Liveliness toolbox:** closed. Straight arrows, single `arrow` arrowhead,
  `solid` strokes only. No freedraw accents.

## Notebook / Whiteboard

Looser and warmer than Sketch — the feel of scribbling in a notebook or on a
whiteboard.

| Knob | Default | Notes |
| --- | --- | --- |
| `roughness` | `1` (lean toward `2`) | sketchier than Sketch |
| `roundness` | `{ "type": 3 }` | soft |
| `fillStyle` | `"hachure"` on **light** containers; `"solid"` on dark/inverted | the notebook-sketch warmth; never hachure behind code |
| `strokeWidth` | `2` | |
| `opacity` | `100` | always |
| ink / text `strokeColor` | Warm ink | |

- **Palette:** Warm.
- **Font hierarchy:** handwriting slot primary; code slot for real code.
- **Liveliness toolbox:** full, and **leaned into** — but every accent must
  still argue: underline the key term, circle the critical value, hand-draw
  the arrow that matters. Decoration for its own sake (random sticky notes,
  doodles) is noise.

## Cartoon (optional)

Bold, very rough, saturated, playful. Use only when the user explicitly asks for
it.

| Knob | Default | Notes |
| --- | --- | --- |
| `roughness` | `2` | cartoonist |
| `roundness` | `{ "type": 3 }` | |
| `fillStyle` | `"solid"` (saturated Warm fills) | |
| `strokeWidth` | `3` | bold |
| `opacity` | `100` | always |
| ink / text `strokeColor` | Warm ink | |

- **Palette:** Warm, saturated end.
- **Font hierarchy:** handwriting slot, larger `fontSize`.
- **Liveliness toolbox:** full, maximal.

## Picking a preset (do this in step 0, before the canvas)

1. **Default to Sketch.**
2. **Infer from the user's words** — light steering, not a rule engine:
   - "技术 / 架构 / 示意 / 干净 / technical / clean / schematic" → **Clean**
   - "草稿 / 白板 / 头脑风暴 / draft / whiteboard / brainstorm / notebook" → **Notebook**
   - "卡通 / 可爱 / 活泼夸张 / cartoon / playful" → **Cartoon**
   - anything else / unstated → **Sketch**
3. **Say it out loud.** Before drawing, state in one line which preset you're
   using and why ("I'll use Sketch — warm hand-drawn, since you didn't ask for a
   schematic"). This lets the user correct you cheaply. Don't bury it.
4. **A preset is a starting point, not a cage.** Override an individual knob
   when a specific element argues for it (e.g., a hachure highlight inside an
   otherwise-solid Sketch diagram). The appendix below is the menu of every knob
   you can touch.

## Appendix — the independent knob menu

When a single element needs to deviate from its preset, pick from here. These
are the only style knobs Excalidraw exposes; nothing else affects character.

| Knob | Values | Meaning |
| --- | --- | --- |
| `roughness` | `0` clean · `1` hand-drawn · `2` cartoon | stroke jitter |
| `roundness` | `null` sharp · `{ "type": 3 }` soft | shape corners (arrows use it for straight-vs-curved routing) |
| `fillStyle` | `solid` · `hachure` · `cross-hatch` · `zigzag` | non-solid only on **light** fills; dark/inverted always `solid` |
| `strokeWidth` | `1` hairline · `2` structure · `3` hero/emphasis | |
| `strokeStyle` | `solid` · `dashed` (optional/weak link) · `dotted` (tentative/inferred) | second channel of meaning, not decoration |
| arrowheads | `arrow` (default) · `dot`/`circle` (start marker) · `triangle` · `bar` (terminate) | set `startArrowhead`/`endArrowhead` independently |
| `fontFamily` | `1` handwriting · `2` normal · `3` code | `1` primary in Sketch/Notebook/Cartoon; `2` primary in Clean; `3` only for real code |

### Liveliness toolbox (Sketch / Notebook / Cartoon; closed in Clean)

- **Arrowhead variety** — encode semantics in the head itself (dot = origin,
  bar = terminate, triangle = strong direction).
- **strokeStyle semantics** — `dashed` for optional/weak, `dotted` for
  tentative/inferred connections.
- **Curved arrows** — when a connection routes around elements or expresses an
  organic relation, use 3+ `points` with soft `roundness` instead of a straight
  2-point segment. Not the default; the structural spine stays straight.
- **Small dot markers** — 8–14 px filled `ellipse`s as timeline ticks, list
  bullets, connection nodes.
- **freedraw accents** — hand-drawn underlines, circle-arounds, emphasis arrows.
  Most alive in Notebook; available in Sketch; the signature flourish of the
  hand-drawn look that the old skill never used.
