# Default visual style is hand-drawn (Sketch), not clean/technical

**Status:** Accepted

The skill was adapted from `coleam00/excalidraw-diagram-skill`, whose
methodology defaults to `roughness: 0` (clean/crisp) "for most professional use
cases." Our adaptation went further and *mandated* `roughness: 0`, sharp
corners (`roundness: null`), solid fills, a cold slate palette, and code-font
titles — locking the skill into a sterile, "Visio-like" look that fought
Excalidraw's signature hand-drawn identity.

We decided to flip the default to a **hand-drawn "Sketch" preset** —
`roughness: 1`, soft rounded corners `{type: 3}`, the Excalidraw-native warm
palette, handwriting font as primary, ink `#1e1e1e` — with the clean/technical
look demoted to an explicit opt-in preset. Reasoning: Excali Local is a
sketching/annotation tool, not a Visio replacement; canvas content should look
like Excalidraw (warm, hand-drawn, lively), independent of the app's cold-slate
chrome. We deliberately **decouple the canvas palette from the app-chrome UI
tokens** — the old rationale ("diagrams sit visually next to the product") now
applies only to the clean/technical preset.

## Considered Options

- **Keep clean-default** (rejected): produces the rigid output the skill was
  redesigned to fix, and suppresses the host tool's defining aesthetic.
- **Default to hachure fills + cartoon roughness** (rejected): maximally
  hand-drawn, but the methodology is text/evidence-heavy and hachure hurts
  legibility — kept as opt-in per-element warmth instead of a global default.
- **Hand-drawn-default, clean as opt-in** (accepted).

## Consequences

Canvas drawings no longer match the app's slate/violet chrome by default —
intentional, since chrome and canvas are different surfaces. The flip touches
seven files (`roughness: 0` previously appeared 18 times); reversing it is
non-trivial. Style is now organized as named presets in
[`references/style-presets.md`](../../references/style-presets.md), decoupled
from the hex source of truth in
[`references/color-palette.md`](../../references/color-palette.md). See that
ADR's companions for the per-type shape conventions in
[`references/diagram-shape-grammar.md`](../../references/diagram-shape-grammar.md).
