# FontFamily mapping tracks the csp.14 build: 5/6/8

**Status:** Accepted

## Context

The skill documents the pre-csp.14 Excalidraw mapping — handwriting = 1
(Virgil) / normal = 2 (Helvetica) / code = 3 (Cascadia) — and *mandates*
`fontFamily: 1` on text. The csp.14 build (Excalidraw 0.18.0-csp.14, our
patched local tgz) replaced the default handwriting face with **Excalifont
(5)**: `DEFAULT_FONT_FAMILY` is Excalifont, and 1/2/3 survive only as
deprecated backwards-compat ids (`FONT_FAMILY` in the patched
`packages/common/src/constants.ts`, ~130–214; `FontPicker.tsx` 23–42).

## Decision

The skill's canonical mapping is now:

| slot | Excalidraw fontFamily |
| --- | --- |
| handwriting | **5 (Excalifont)** |
| normal | **6 (Nunito)** |
| code | **8 (Comic Shanns)** |

Old ids 1/2/3 are deprecated backwards-compat aliases. Never use them as the
default in templates or examples — emit 5/6/8.

## Key trade-off: the CJK fallback only rides on Excalifont (5)

This is the counterintuitive point that justifies the change. In
`getFontFamilyFallbacks`, **only Excalifont (5) prepends the
`CJK_HAND_DRAWN_FALLBACK_FONT` ("Xiaolai")**; every other id falls back to
generic sans/mono. Mandating `fontFamily: 1` (Virgil) meant Chinese text
rendered as plain sans-serif — the exact "Chinese text is not hand-written"
bug this ADR fixes. Virgil (1) still exists as an id, but Chinese will not
render hand-written with it. Use 5 for hand-drawn text that must carry CJK.

## Consequences

- Touches every skill doc that names a font slot:
  `references/element-templates.md`, `references/color-palette.md`,
  `references/style-presets.md`, `references/draw-a-diagram.md`,
  `references/install-and-use-a-font.md`, `references/json-schema.md`,
  `SKILL.md`, `command-reference.md`.
- The bridge validates nothing on `fontFamily` — the shared contract and the
  Go daemon treat it as pure passthrough, so this is doc-only: no protocol
  or binary change.
- Custom-font install/assign continues to use the Excalidraw slot keys
  (`handDrawn`/`normal`/`code` = the new ids); behavior unchanged.
