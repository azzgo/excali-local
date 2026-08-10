# Default is a rich, colorful hand-drawn style — not a minimalist one

**Status:** Accepted

## Context

[`0001-hand-drawn-default-style.md`](./0001-hand-drawn-default-style.md)
flipped the default to the hand-drawn "Sketch" preset — `roughness: 1`, soft
rounded corners, the Excalidraw-native warm palette, handwriting font, warm
ink — but it carried over the minimalist philosophy inherited from the
`coleam00` adaptation it replaced: ink-on-paper (neutral containers are
transparent, no fill), color must earn its place, one accent at a time.

The strokes were right; the color discipline was wrong. The default output
reads dark and black-text-heavy, with empty transparent boxes, and users
judged it 死板 / 朴素 / 不够花 (stiff, plain, not colorful enough). A
sketching/annotation tool's default should look alive, not like a stencil.

## Decision

Upgrade the default Sketch preset to a **rich, colorful hand-drawn** default:

- **Neutral containers get a default light-warm fill** — a new token, shallow
  cream `#fff9db`; ink `#1e1e1e` text on it keeps sufficient contrast, so
  legibility holds while boxes stop reading as empty.
- **Role-based multi-color fills on the same canvas** — the "one accent at a
  time" rule is dropped. Fill carries semantics (positive, negative, info,
  emphasis, neutral); stroke carries structure.
- **Titles / hero / caption text use palette accent colors**; body / label
  text keeps ink `#1e1e1e` for readability.
- **The liveliness toolbox becomes default-on in Sketch** — curved connections
  for non-spine routes, freedraw underline / circle accents on key terms,
  hachure on non-text regions, semantically varied arrowheads.
- **Roughness stays 1** — hand-drawn, not cartoon (2). This is a richer Sketch,
  not a different preset.

## Considered Options

- **Relax only the accent quota, keep transparent boxes** (rejected): too
  timid. Empty boxes were a core part of the 死板 complaint; adjusting color
  rules while leaving them unchanged fixes nothing users can see.
- **Full-saturation cartoon fills + roughness 2** (rejected): maximally
  colorful, but it hurts legibility and fights the methodology, which is
  text/evidence-heavy. The Clean preset remains the opt-in home for technical
  diagrams.
- **Rich, colorful hand-drawn default** (accepted).

## Consequences

This ADR supersedes the minimalist philosophy of
[`0001-hand-drawn-default-style.md`](./0001-hand-drawn-default-style.md); that
ADR's "hand-drawn by default" stance still stands. The change touches the
skill's style docs —
[`references/style-presets.md`](../../references/style-presets.md),
[`references/element-templates.md`](../../references/element-templates.md),
[`references/color-palette.md`](../../references/color-palette.md),
[`references/workflows/draw-a-diagram.md`](../../references/workflows/draw-a-diagram.md),
and [`SKILL.md`](../../SKILL.md). Canvas and app chrome stay decoupled: the
canvas stays on the Warm palette, the app UI on Slate — different surfaces,
styled independently.
