# Color palette — the Excali Local seam

This file is the **single brand/palette seam** of the skill: the only place hex
values live. Two named palettes live here — **Warm** (Excalidraw-native, the
default for the Sketch/Notebook/Cartoon presets) and **Slate** (derived from the
product's UI tokens, for the Clean preset). Style presets in
[`style-presets.md`](style-presets.md) name a palette; they never inline hex, so
a brand refresh changes only this file.

> **Canvas and chrome are decoupled.** The old rationale — "diagrams sit
> visually next to the product" — now applies **only to the Slate palette**
> (Clean preset). Canvas content defaults to the Warm palette because what users
> expect on an Excalidraw canvas is Excalidraw's own warm, hand-drawn look, not
> the app's cold-slate chrome. Chrome and canvas are different surfaces. See
> `docs/adr/0001-hand-drawn-default-style.md` for the decision.

## Core inks & paper

| Token | Hex | Use |
| --- | --- | --- |
| Warm ink *(default)* | `#1e1e1e` | default stroke/text for Warm presets — Excalidraw's own ink, warm-neutral near-black |
| Slate ink | `#020817` | default stroke/text for the Clean preset — near-black navy (`222.2 84% 4.9%`) |
| Muted warm | `#868e96` | secondary text, captions (Warm) |
| Muted slate | `#64748b` | secondary text, captions (Slate) |
| Paper / background | `#ffffff` | canvas background (`scene.update` → `appState.viewBackgroundColor`) |

## Warm palette (Excalidraw-native — Sketch / Notebook / Cartoon)

Excalidraw's own color-picker swatches, so canvas content reads as genuine
Excalidraw. "Stroke" is `strokeColor`, "fill" is `backgroundColor`; pair with
`roughness: 1`, `roundness: { "type": 3 }`, `strokeWidth: 2`, `opacity: 100`.

| Role | Fill | Stroke | Used for |
| --- | --- | --- | --- |
| Neutral container | `transparent` | `#1e1e1e` | default boxes — ink stroke, no fill (color earns its place) |
| Primary emphasis | `#ffec99` | `#1e1e1e` | the thing the diagram argues FOR (warm yellow — Excalidraw's signature) |
| Positive / success | `#b2f2bb` | `#2f9e44` | positive flows, "yes" paths |
| Negative / risk | `#ffc9c9` | `#e03131` | negative flows, "no" paths, risks |
| Info / secondary | `#a5d8ff` | `#1971c2` | secondary emphasis, neutral highlight |
| Warm secondary | `#ffd8a8` | `#f08c00` | secondary emphasis (peach) |
| Accent | `#d0bfff` | `#ae3ec9` | the one accent — use sparingly |
| Highlight / note | `#ffec99` | `#1e1e1e` | the yellow highlighter marker |
| Evidence / code (inverted) | `#1e1e1e` | `#ffffff` | code/evidence artifacts — inverted, Excalidraw ink |
| Destructive | `#ffc9c9` | `#e03131` | errors, blocked states (stronger stroke) |

## Slate palette (product-derived — Clean preset)

Derived from Excali Local's actual UI tokens (`packages/excali-page/src/index.css`,
the `--chart-1..5` values converted from HSL), so a Clean-preset diagram sits
visually next to the product. Pair with `roughness: 0`, `roundness: null`,
`strokeWidth: 1`/`2`/`3`, `opacity: 100`.

| Role | Fill | Stroke | Used for |
| --- | --- | --- | --- |
| Neutral container | `#f1f5f9` | `#020817` | default boxes |
| Brand / primary emphasis | `#e8c468` | `#020817` | the thing the diagram argues FOR |
| Teal / success-ish | `#2a9d90` | `#020817` | positive flows, "yes" paths |
| Coral / warn | `#e76e50` | `#020817` | negative flows, "no" paths, risks |
| Deep slate / technical | `#274754` | `#ffffff` | code/evidence artifacts (inverted) |
| Amber / highlight | `#e8c468` | `#020817` | highlights, "note this" markers |
| Orange / secondary | `#f4a462` | `#020817` | secondary emphasis |
| Destructive / danger | `#ef4444` | `#020817` | errors, blocked states |

## Text hierarchy

| Level | fontFamily | fontSize | strokeColor | Use |
| --- | --- | --- | --- | --- |
| **Warm (Sketch/Notebook/Cartoon)** | | | | |
| Title / hero | `5` (handwriting) | 20–24 | Warm ink | section titles, the hero |
| Body / label | `5` (handwriting) | 16 | Warm ink | labels, annotations |
| Caption | `5` (handwriting) | 12–14 | `#868e96` | timestamps, ids, marginal notes |
| Code / evidence | `8` (code) | 12–14 | `#ffffff` (on inverted) / Warm ink | **only** real code, JSON, event names |
| **Slate (Clean)** | | | | |
| Title / hero | `6` (normal) or `8` | 20–24 | Slate ink | section titles, the hero |
| Body | `6` (normal) | 16 | Slate ink | labels, annotations |
| Caption / evidence | `8` (code) | 12–14 | `#64748b` | code snippets, timestamps, ids |

> `fontFamily` slots: `5` = handwriting, `6` = normal, `8` = code
> (see [`workflows/install-and-use-a-font.md`](workflows/install-and-use-a-font.md)).
> Unconfigured slots fall back to Excalidraw's built-in font for that id, so a
> handwriting primary still renders hand-drawn with zero config.

## Usage rules

1. **Match the palette to the preset.** Warm for Sketch/Notebook/Cartoon, Slate
   for Clean. Don't mix palettes in one diagram.
2. **Default to ink-on-paper.** A neutral container is an ink stroke with no
   fill; color must earn its place.
3. **One accent at a time.** Whether it's Warm's `#d0bfff` or Slate's brand
   yellow, a diagram that paints everything the accent color argues nothing.
4. **Fill carries semantics; stroke carries structure.** Keep strokes at the
   palette's ink except on inverted (evidence) fills where white strokes read
   better.
5. **Evidence artifacts** (code, JSON, event names) always get the inverted
   treatment: Warm `#1e1e1e` fill / `#ffffff` stroke or Slate `#274754` /
   `#ffffff`, with `fontFamily: 8`. Never put hachure behind code.
6. **Dark-mode canvases:** set `viewBackgroundColor` via `scene.update`, but keep
   the same semantic pairs — they are chosen for contrast on both `#ffffff` and
   a dark background.
