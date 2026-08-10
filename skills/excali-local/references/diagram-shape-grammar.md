# Diagram shape grammar — common types (lightweight guidance)

This is a **shape grammar**, not a template library: short conventions for the
most common diagram families so shapes carry consistent meaning (a decision is
always a diamond, a start is always an ellipse). It is deliberately minimal —
guide, don't over-define. The modern models this skill targets can fill the
gaps; this file just stops them from drawing a decision as a rectangle.

> **Two axes, independent.** This file fixes *which shape means what*. The
> visual *character* (hand-drawn vs clean, warm vs slate, handwriting vs code
> font) is a separate choice — see [`style-presets.md`](style-presets.md). A
> flowchart can be Sketch or Clean. The argument-over-display methodology and
> the pattern library (fan-out, convergence, tree, timeline…) in
> [`workflows/draw-a-diagram.md`](workflows/draw-a-diagram.md) still govern
> *layout*; this file only governs *shape vocabulary*.

## Flowchart

- **Start / end** → `ellipse`. **Process / step** → `rectangle`. **Decision** →
  `diamond`.
- Connect with bound `arrow`s; default direction top→down or left→right, one
  direction per diagram.
- Reserve the accent pair (a Warm/Slate emphasis role) for the happy path or
  the pivotal decision — it carries the strongest color on the canvas; other
  roles still take their role fills (role-based multi-color, see color-palette.md).

## Architecture

- **Layers** as horizontal regions: presentation / business / data (use `frame`
  or faint full-width rectangles as region bands).
- **Components / services** → `rectangle`. Group related ones inside their
  layer.
- **Sync call** → solid `arrow`. **Async / event** → `dashed` arrow
  (`strokeStyle: "dashed"`). Wrap the whole system in one labeled container to
  mark the trust/external boundary.

## Mind map

- **Center topic** → `ellipse`, hero size (the most whitespace around it).
- **Main branches** → `rectangle`s radiating outward; **sub-branches** → smaller
  rectangles or free-floating text.
- Give each main branch its own color from the palette roles; connect center →
  branch with a line or arrow.

## Sequence

- **Participants** → `rectangle`s across the top. **Lifeline** → a `dashed`
  vertical `line` dropping from each participant.
- **Messages** → horizontal `arrow`s between lifelines: solid = call, dashed =
  return. Label each. Time flows top→down.
- Optional: thin `rectangle` activation bars on a lifeline while it's active.

## Tree / Timeline (lines as structure — no boxes)

- Use `line` + free-floating `text` + small dot `ellipse`s (8–14 px), **not**
  containers. This is the existing "lines as structure" pattern and reads
  cleaner than boxes.
- **Tree**: vertical trunk + horizontal branch lines, labels as free text at
  each node. **Timeline**: a spine line + dot markers, labels alternating sides.

## ER (entity-relationship)

- **Entity** → `rectangle` (name as a header; attributes listed inside as bound
  or free text). **Relationship** → `diamond`. **Attribute** → `ellipse`.
- Connect with `arrow`s; label cardinality (`1`, `N`, `M`) on the arrow. Mark
  primary keys (underlined / `PK`) and foreign keys (`FK`).

## Composing with style

Pick the shape vocabulary from this file, then pick a preset from
`style-presets.md` for the character. The two never conflict: a decision is a
diamond whether the diagram is hand-drawn or clean.
