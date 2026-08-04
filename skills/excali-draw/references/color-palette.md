# Color palette — the Excali Local seam

This file is the **single brand/palette seam** of the skill. It is derived
from Excali Local's actual UI tokens (`packages/excali-page/src/index.css`),
so diagrams you draw sit visually next to the product that hosts them. If a
brand refresh happens, only this file changes — the methodology, templates,
and workflows stay untouched.

## Core tokens

| Token | Hex | HSL (source) | Use |
| --- | --- | --- | --- |
| Ink / foreground | `#020817` | `222.2 84% 4.9%` | default stroke/text — near-black navy |
| Paper / background | `#ffffff` | `0 0% 100%` | canvas background (`scene.update` → `appState.viewBackgroundColor`) |
| Slate-100 fill | `#f1f5f9` | `210 40% 96.1%` | default container fill — neutral, quiet |
| Slate-500 muted | `#64748b` | `215.4 16.3% 46.9%` | secondary text, captions |
| Slate-200 border | `#e2e8f0` | `214.3 31.8% 91.4%` | hairline borders |
| Violet accent | `#7c5cff` ≈ `oklch(0.488 0.243 264.376)` | sidebar/accent | the one brand accent — use sparingly |

## Semantic pairs (fill / stroke) for diagrams

Use these for the *structure* of a diagram. "Stroke" is `strokeColor`,
"fill" is `backgroundColor`; always `roughness: 0`, `strokeWidth: 2`,
`opacity: 100`.

| Role | Fill | Stroke | Used for |
| --- | --- | --- | --- |
| Neutral container | `#f1f5f9` | `#020817` | default boxes |
| Brand / primary emphasis | `#e8c468` | `#020817` | the thing the diagram argues FOR |
| Teal / success-ish | `#2a9d90` | `#020817` | positive flows, "yes" paths |
| Coral / warn | `#e76e50` | `#020817` | negative flows, "no" paths, risks |
| Deep slate / technical | `#274754` | `#ffffff` | code/evidence artifacts (inverted) |
| Amber / highlight | `#e8c468` | `#020817` | highlights, "note this" markers |
| Orange / secondary emphasis | `#f4a462` | `#020817` | secondary emphasis |
| Destructive / danger | `#ef4444` | `#020817` | errors, blocked states |

(The chart-scale hexes above are the actual `--chart-1..5` tokens from the
product CSS, converted from HSL.)

## Text hierarchy

| Level | fontFamily | fontSize | strokeColor | Use |
| --- | --- | --- | --- | --- |
| Title / hero | `3` (code) or `2` | 20–24 | `#020817` | section titles, the hero |
| Body | `2` (normal) | 16 | `#020817` | labels, annotations |
| Caption / evidence | `3` (code) | 12–14 | `#64748b` | code snippets, timestamps, ids |
| Handwritten note | `1` (handwriting) | 16 | `#020817` | human-ish marginal notes |

## Usage rules

1. **Default everything to Ink-on-Paper** (`#020817` on `#ffffff` or
   `#f1f5f9`). Color must earn its place.
2. **One accent at a time.** The violet `#7c5cff` is the product's brand
   accent — a diagram that paints everything violet argues nothing.
3. **Fill carries semantics; stroke carries structure.** Keep strokes `#020817`
   except on inverted (technical) fills where white strokes read better.
4. **Evidence artifacts** (code, JSON, event names) get the Deep-slate
   treatment (`#274754` fill, `#ffffff` stroke, `fontFamily: 3`).
5. Dark-mode canvases: set `viewBackgroundColor` via `scene.update`, but keep
   the same semantic pairs — the pairs are chosen for contrast on both
   `#ffffff` and the dark navy background.
