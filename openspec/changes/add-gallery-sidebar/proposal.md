# Change: Add Gallery Sidebar for Drawing Management

## Why
Users need a way to save and organize multiple Excalidraw drawings locally. Currently, the application only supports auto-save for a single working canvas to localStorage. This change introduces a Gallery feature that allows users to explicitly save named drawings with thumbnails, organize them into collections, and switch between different drawings without losing work.

## What Changes
- Add IndexedDB storage for permanent drawing library (upgrade database from v1 to v2)
- Create Gallery sidebar component with thumbnail view, search, and collection management
- Implement storage isolation between auto-save workspace and Gallery drawings
- Add drawing CRUD operations (save, load, update, delete, **rename**)
- Add collection management for grouping drawings
- Implement thumbnail generation for visual preview
- Integrate Gallery sidebar into both LocalEditor and QuickMarkerEditor
- **Replace native input with shadcn UI Input component**
- **Add debouncing to search functionality** (300ms delay)
- **Implement sidebar-based collections list** (inspired by excalisave design)
  - Collections displayed as a sidebar list with folder icons and counts
  - Each collection has a "..." menu for rename/delete actions
  - Collapsible collections section
- **Implement menu-based collection interaction** (similar to official Excalidraw patterns)
- **Implement sidebar trigger button visibility control** (hide when sidebar is open)
- **Enhanced save UX with split button**:
  - Text+icon save button with conditional dropdown
  - Quick save (no dialog) when drawing is loaded
  - "Save as New Drawing" option in dropdown
- **Drawing card menu enhancements**:
  - Add "Rename" functionality for drawings
  - Add "Overwrite with current canvas" to replace any drawing with current canvas state
- **Polish improvements**:
  - Fix event bubbling issues in dropdown menus (prevent unwanted parent clicks)
  - Implement optimistic UI updates for instant feedback on collection and drawing operations
  - Use local React state for both collections and drawings (minimal Suspense usage)
  - Suspense only for initial load and filter changes (collection/search), not for card operations
  - Collections collapsed by default, always visible, no loading states
  - Targeted updates for heavy operations to avoid full gallery refresh:
    - Save new drawing → prepend card to list (no full refresh)
    - Update existing drawing → update specific card only (no full refresh)
    - Overwrite drawing → update specific card only (no full refresh)
  - All lightweight operations use optimistic updates with targeted DOM updates
  - `galleryRefreshAtom` only used for filter changes, not individual card operations

## Impact
- **Affected specs**: gallery-storage, gallery-ui, storage-isolation
- **Affected code**: 
  - `packages/excali-page/src/features/editor/utils/indexdb.ts` (database upgrade)
  - `packages/excali-page/src/features/editor/components/local-editor.tsx` (sidebar integration)
  - `packages/excali-page/src/features/editor/components/quick-marker-editor.tsx` (sidebar integration)
  - New feature directory: `packages/excali-page/src/features/gallery/`
  - `packages/excali-page/src/components/ui/` (add Input component)
- **Dependencies**: Existing `idb` library, existing Jotai state management, shadcn UI Input component
- **Breaking changes**: None (database migration is additive, existing auto-save behavior unchanged)
