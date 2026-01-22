# Change: Add Quick Marker Sidebar Configuration Items

## Why
The Quick Marker sidebar currently provides limited configuration options (tool selection, stroke color, background color, and line style). Users need more granular control over drawing properties including stroke width, corner roundness, arrow types, font family, and font size to create more expressive and professional annotations.

## What Changes
- Add stroke width configuration (thin/bold/extra bold) with Excalidraw mapping
- Add corner/roundness configuration (sharp/round) for shapes
- Add arrow type configuration (one-sided, two-sided, dot)
- Add font family configuration (hand-drawn, normal, code)
- Add font size configuration (small, medium, large, very large)
- Add i18n translations for all new labels and options (English and Chinese)
- Maintain existing configuration items and layout structure

## Impact
- Affected specs: `quick-marker` (new capability)
- Affected code:
  - `packages/excali-page/src/features/editor/components/marker-sidebar.tsx`
  - `packages/excali-page/src/locales/locales.ts`
- Dependencies: `@excalidraw/excalidraw` (v0.18.0-csp.12), `@tabler/icons-react` (for icons)