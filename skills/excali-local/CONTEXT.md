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

## Structural verification

The `scene.audit` call — a deterministic geometry audit of the live scene:
overlaps, gutter violations, label-vs-container fit, unbound arrows, dangling
bindings, and bend points inside unrelated nodes. Computed from numbers, never
from a picture. The baseline every model runs; on text-only agents it is the
whole verification. It returns two separate verdicts: **`ok`** for hard
geometry defects, and **`readabilityOk`** for quality (see *Wrapped label*
below). Detail:
[`references/workflows/draw-a-diagram.md`](references/workflows/draw-a-diagram.md).

## Measure-then-place

The layout protocol: emit labels first, read their renderer-measured
`width`/`height` back from `scene.get`, then derive container sizes from the
measurement and pack rows by measured width. The alternative — assigning a
fixed box size and a fixed grid step — is what forces labels to wrap and boxes
to collide. Detail: [`references/workflows/draw-a-diagram.md`](references/workflows/draw-a-diagram.md) §1.

## Wrapped label

A bound label that Excalidraw broke across lines because its container was too
narrow. **Not a geometry error** — the text is re-centered and the box still
contains it, so `ok` stays `true`. It is the "crammed into a fixed card" look,
reported as `readabilityOk: false` with a `wrappedLabels` count. The signal that
the box was sized by a guess instead of a measurement.

## Gap marker

A one-line declaration of a degradation: `[excali-gap] feature=… action=…`.
Required whenever you substitute something the workflow asked for — no vision,
an unconfigured font slot, a cross-batch binding workaround, a split canvas.
A silent fallback is the failure mode this exists to prevent.

## Visual verification

The picture readback (`scene.exportPng`) layered on top of structural
verification by agents with vision. Catches what arithmetic cannot — color,
aesthetics, whether the whole looks right. Never required; text-only agents run
structural verification alone and leave aesthetic acceptance to the user, who
owns the canvas. Detail: [`references/workflows/draw-a-diagram.md`](references/workflows/draw-a-diagram.md).
