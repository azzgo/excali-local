# Skill glossary (CONTEXT)

The vocabulary of the Excali Local drawing skill, in plain terms. This file is
intentionally free of implementation details — no hex codes, no font ids, no
JSON fields — and every term points at the reference doc that carries the
detail.

## Preset

A bundle of visual-character choices: how rough the strokes are, whether
corners are soft or sharp, which palette and font hierarchy the diagram uses,
and how much liveliness is on the table. Pick one before drawing — it steers
the whole canvas. Detail: [`references/style-presets.md`](references/style-presets.md).

## Sketch (default)

The rich, colorful, lively hand-drawn look — the default preset. Anything
without a style qualifier comes out Sketch. Detail: [`references/style-presets.md`](references/style-presets.md).

## Clean / Technical

The crisp, schematic opt-in preset for technical and architecture diagrams;
the one place the Slate palette is used. Detail: [`references/style-presets.md`](references/style-presets.md).

## Notebook / Whiteboard

The loose, hachure-warm opt-in preset for drafts, whiteboards, and
brainstorms. Detail: [`references/style-presets.md`](references/style-presets.md).

## Cartoon

The bold, playful opt-in preset — only when the user explicitly asks for it.
Detail: [`references/style-presets.md`](references/style-presets.md).

## Palette

The named color family a preset uses: **Warm** (Excalidraw-native, the canvas
default) and **Slate** (product-derived, Clean preset only). Detail: [`references/color-palette.md`](references/color-palette.md).

## Neutral container

A default box. In Sketch it now carries a default light-warm fill rather than
a transparent one. Detail: [`references/color-palette.md`](references/color-palette.md).

## Role-based fill

Fill color encodes the element's role — positive, negative, info, emphasis,
neutral — and multiple roles may share one canvas. Detail: [`references/color-palette.md`](references/color-palette.md).

## Font slot

The three named font slots — handwriting, normal, code — that map to
Excalidraw's per-element font ids. Detail: [`references/workflows/install-and-use-a-font.md`](references/workflows/install-and-use-a-font.md).

## Liveliness toolbox

The hand-drawn accent vocabulary: curved arrows, freedraw underlines and
circle-arounds, varied arrowheads, dashed/dotted semantics, small dot markers.
Default-on in Sketch; closed in Clean. Detail: [`references/style-presets.md`](references/style-presets.md).

## Canvas vs chrome decoupling

Canvas content uses the Warm palette; the app UI uses Slate. They are
different surfaces, so they are styled independently. Detail: [`references/color-palette.md`](references/color-palette.md).
