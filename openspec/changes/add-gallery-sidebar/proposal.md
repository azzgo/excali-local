# Change: Add Gallery Sidebar for Drawing Management

## Why
Users need a way to save and organize multiple Excalidraw drawings locally. Currently, the application only supports auto-save for a single working canvas to localStorage. This change introduces a Gallery feature that allows users to explicitly save named drawings with thumbnails, organize them into collections, and switch between different drawings without losing work.

## What Changes
- Add IndexedDB storage for permanent drawing library (upgrade database from v1 to v2)
- Create Gallery sidebar component with thumbnail view, search, and collection management
- Implement storage isolation between auto-save workspace and Gallery drawings
- Add drawing CRUD operations (save, load, update, delete)
- Add collection management for grouping drawings
- Implement thumbnail generation for visual preview
- Integrate Gallery sidebar into both LocalEditor and QuickMarkerEditor

## Impact
- **Affected specs**: gallery-storage, gallery-ui, storage-isolation
- **Affected code**: 
  - `packages/excali-page/src/features/editor/utils/indexdb.ts` (database upgrade)
  - `packages/excali-page/src/features/editor/components/local-editor.tsx` (sidebar integration)
  - `packages/excali-page/src/features/editor/components/quick-marker-editor.tsx` (sidebar integration)
  - New feature directory: `packages/excali-page/src/features/gallery/`
- **Dependencies**: Existing `idb` library, existing Jotai state management
- **Breaking changes**: None (database migration is additive, existing auto-save behavior unchanged)
