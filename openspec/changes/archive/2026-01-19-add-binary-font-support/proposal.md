# Change: Add Binary Font File Support

## Why
The extension currently supports selecting system fonts via PostScript names only. Users cannot use their own custom font files (.ttf, .otf, .woff, .woff2) for handwriting, normal, or code font slots. Adding binary font support will enable users to upload, store, and use custom fonts in their drawings.

## What Changes
- **NEW**: Custom font file upload capability in options page
- **NEW**: IndexedDB storage for font binary data (ArrayBuffer as Uint8Array)
- **NEW**: `FontSource` type supporting both system and custom modes
- **NEW**: `CustomFont` interface for stored font metadata
- **NEW**: Font injection via FontFace API in excali-page
- **NEW**: Independent system/custom toggle per font slot
- **NEW**: UUID-based references for custom fonts

## Impact
- Affected specs: `shared-utils` (new capability)
- Affected code:
  - `packages/excali-shared/src/db.ts` - IndexedDB operations
  - `packages/excali-shared/src/types.ts` - FontSource, CustomFont types
  - `packages/excali-page/src/lib/font-injector.ts` - Load fonts from IndexedDB
  - `packages/excali-local/entrypoints/options/FontSlot.tsx` - Font slot component
  - `packages/excali-local/entrypoints/options/CustomFontPanel.tsx` - Upload/select UI
  - `packages/excali-local/entrypoints/options/App.tsx` - Integration
