# Implementation Tasks

## Phase 1: Core Storage (MVP)

### 1.1 Database Schema
- [x] 1.1.1 Upgrade IndexedDB from v1 to v2 in `utils/indexdb.ts`
- [x] 1.1.2 Create `drawings` object store with indexes
- [x] 1.1.3 Create `collections` object store with indexes
- [x] 1.1.4 Implement database migration logic
- [x] 1.1.5 Define TypeScript interfaces for Drawing and Collection

### 1.2 Drawing CRUD Operations
- [x] 1.2.1 Implement `saveDrawing()` function
- [x] 1.2.2 Implement `getDrawings()` function with filtering
- [x] 1.2.3 Implement `updateDrawing()` function
- [x] 1.2.4 Implement `deleteDrawing()` function
- [x] 1.2.5 Create `use-drawing-crud.ts` hook

### 1.3 Thumbnail Generation
- [x] 1.3.1 Implement `use-thumbnail.ts` hook using Excalidraw's exportToBlob
- [x] 1.3.2 Configure WebP format with quality 0.5
- [x] 1.3.3 Set fixed height of 200px for thumbnails

### 1.4 Gallery State Management
- [x] 1.4.1 Create `gallery-atoms.ts` with required Jotai atoms
- [x] 1.4.2 Implement `currentLoadedDrawingIdAtom` for tracking loaded drawings
- [x] 1.4.3 Implement `drawingsListAtom` as async atom
- [x] 1.4.4 Create `use-gallery.ts` facade hook

### 1.5 Basic UI Components
- [x] 1.5.1 Create `gallery-sidebar.tsx` with Sidebar wrapper
- [x] 1.5.2 Create `drawing-card.tsx` for thumbnail display
- [x] 1.5.3 Implement basic list view with load functionality
- [x] 1.5.4 Add "Save" button and basic save dialog

### 1.6 Editor Integration
- [x] 1.6.1 Integrate GallerySidebar into LocalEditor
- [x] 1.6.2 Integrate GallerySidebar into QuickMarkerEditor
- [x] 1.6.3 Implement load drawing functionality
- [x] 1.6.4 Implement explicit save functionality
- [x] 1.6.5 Implement sidebar trigger button hide/show behavior based on sidebar open state

## Phase 2: Collections & Search

### 2.1 Collection Management
- [x] 2.1.1 Implement `createCollection()` function
- [x] 2.1.2 Implement `getCollections()` function
- [x] 2.1.3 Create `collection-manager.tsx` component
- [x] 2.1.4 Add collection dropdown to sidebar header
- [x] 2.1.5 Implement "Add to Collection" functionality
- [x] 2.1.6 Refactor collection-manager.tsx to sidebar list layout (excalisave-style)
- [x] 2.1.7 Add "Collections" section header with "+" icon button
- [x] 2.1.8 Implement collection list items with folder icons and drawing counts
- [x] 2.1.9 Add "..." menu icon to each collection with rename/delete options
- [x] 2.1.10 Implement rename collection functionality
- [x] 2.1.11 Implement delete collection functionality with confirmation
- [x] 2.1.12 Add collection section collapse/expand functionality
- [x] 2.1.13 Use shadcn UI Input component in rename/create dialogs

### 2.2 Search Functionality
- [x] 2.2.1 Create `search-bar.tsx` component
- [x] 2.2.2 Implement real-time filtering by drawing name
- [x] 2.2.3 Update `drawingsListAtom` to handle search queries
- [x] 2.2.4 Add search query state management
- [x] 2.2.5 Add shadcn UI Input component to `@/components/ui/input.tsx`
- [x] 2.2.6 Replace native input in search-bar.tsx with shadcn Input component
- [x] 2.2.7 Implement 300ms debounce for search input

### 2.3 Enhanced Save UX
- [x] 2.3.1 Create `save-dialog.tsx` with "Overwrite" vs "Save as New" options
- [x] 2.3.2 Implement logic to detect if current canvas is a loaded drawing
- [x] 2.3.3 Add collection selector to save dialog
- [x] 2.3.4 Implement name input with auto-generation fallback
- [x] 2.3.5 Refactor save button to text+icon button with conditional dropdown
- [x] 2.3.6 Implement split button behavior: main action + dropdown menu
- [x] 2.3.7 Add "Save as New Drawing" option in dropdown menu
- [x] 2.3.8 Implement quick save (direct update without dialog) for loaded drawings
- [x] 2.3.9 Add toast notifications for save/update success/error
- [x] 2.3.10 Update save dialog to use "Save As" mode only (remove overwrite option from dialog)

### 2.4 Drawing Management
- [x] 2.4.1 Add "..." menu icon to each drawing card
- [x] 2.4.2 Implement drawing card menu with Rename/Add to Collection/Overwrite/Delete options
- [x] 2.4.3 Implement rename drawing functionality with dialog
- [x] 2.4.4 Implement "Overwrite with current canvas" functionality
- [x] 2.4.5 Update delete functionality to trigger from menu (remove old trigger method)
- [x] 2.4.6 Add confirmation dialogs for destructive actions (overwrite, delete)

### 2.5 Layout & Spacing Optimization
- [x] 2.5.1 Adjust sidebar spacing for wider layout (increased padding and gaps)
- [x] 2.5.2 Implement two-column grid layout for drawing cards
- [x] 2.5.3 Update header spacing and component sizes for better visual balance
- [x] 2.5.4 Adjust collection manager spacing for consistency

## Phase 3: Polish & Optimization

### 3.1 Performance Optimization
- [x] 3.1.1 Implement pagination for drawing list (load 20 at a time)
- [x] 3.1.2 Add loading states and skeleton UI
- [x] 3.1.3 Optimize thumbnail generation performance

### 3.2 File Cleanup
- [x] 3.2.1 Create `use-file-cleanup.ts` hook
- [x] 3.2.2 Implement background cleanup algorithm
- [x] 3.2.3 Add cleanup on app startup (debounced, once per 24 hours)
- [ ] 3.2.4 Add manual "Clean Up Storage" button in settings (optional)

### 3.3 Internationalization
- [x] 3.3.1 Add i18n keys for all Gallery UI strings (including new save/rename/overwrite messages)
- [x] 3.3.2 Add Chinese translations for all keys
- [x] 3.3.3 Add English translations for all keys

### 3.4 UI/UX Polish - Event Handling
- [x] 3.4.1 Fix IconDots menu click bubbling in `collection-manager.tsx`
  - Wrap DropdownMenuTrigger Button in a container div with `onClick={(e) => e.stopPropagation()}`
  - Verify menu items also stop propagation
  - Test that collection selection only triggers on collection item click, not menu clicks
- [x] 3.4.2 Fix IconDots menu click bubbling in `drawing-card.tsx`
  - Wrap DropdownMenuTrigger Button in a container div with `onClick={(e) => e.stopPropagation()}`
  - Verify menu items stop propagation
  - Test that card onClick (load drawing) only triggers on card click, not menu clicks

### 3.5 UI/UX Polish - Optimistic Updates & Targeted Updates
- [x] 3.5.1 Refactor collection manager to use local state instead of async atoms
  - Replace `collectionsListAtom` usage with `useState` in `CollectionsList` component
  - Load initial collections from IndexedDB with `useEffect` on mount
  - Remove `Suspense` wrapper from `CollectionManager` component
  - Set default collapsed state to `false` for collections section
- [x] 3.5.2 Refactor drawing list to use local state with targeted updates
  - Replace `drawingsListAtom` with `useState` in `GallerySidebar` component
  - Remove async atoms for drawing list (now using local state)
  - Load initial drawings from IndexedDB on mount
  - Use Suspense ONLY for initial load wrapper, not for card operations
- [x] 3.5.3 Implement optimistic create collection in `collection-manager.tsx`
  - Add new collection to local state immediately with temporary ID (`temp-${Date.now()}`)
  - Call `createCollection()` asynchronously
  - On success: replace temporary ID with real ID from IndexedDB
  - On failure: remove collection from state and show error toast
- [x] 3.5.4 Implement optimistic rename collection in `collection-manager.tsx`
  - Update collection name in local state immediately
  - Call `updateCollection()` asynchronously
  - On success: keep the new name
  - On failure: revert to old name in state and show error toast
- [x] 3.5.5 Implement optimistic delete collection in `collection-manager.tsx`
  - Remove collection from local state immediately
  - Call `deleteCollection()` asynchronously
  - On success: keep removed
  - On failure: restore collection in state and show error toast
- [x] 3.5.6 Implement targeted update for rename drawing
  - Update drawing name in local state immediately via `handleDrawingUpdate` callback
  - Call `update()` asynchronously
  - On success: keep the updated local state (no full refresh)
  - Local state update only (no optimistic rollback yet)
- [x] 3.5.7 Implement targeted removal for delete drawing
  - Remove drawing from local state immediately via `handleDrawingDelete` callback
  - Update collection counts via `onCollectionCountUpdate` callback
  - Call `remove()` asynchronously
  - On success: keep the updated local state (no full refresh)
  - Local state update only (no optimistic rollback yet)
- [x] 3.5.8 Implement targeted update for add to collection
  - Update drawing collectionIds in local state via `handleDrawingUpdate` callback
  - Update collection counts via `onCollectionCountUpdate` callback
  - Call `update()` with new `collectionIds` asynchronously
  - On success: keep the updated local state (no full refresh)
  - Local state update only (no optimistic rollback yet)
- [x] 3.5.9 Implement targeted insert for save new drawing in `gallery-sidebar.tsx`
  - After successful save, new drawing appears at top via frontend pagination/filtering
  - Update collection counts via `handleCollectionCountUpdate` when needed
  - Uses `setAllDrawings` for local state management
  - No `galleryRefreshAtom` trigger
- [x] 3.5.10 Implement targeted update for update existing drawing in `gallery-sidebar.tsx`
  - After successful update, use `handleDrawingUpdate` to update specific drawing
  - Update only thumbnail, timestamp, elements, name fields
  - No `galleryRefreshAtom` trigger
  - Show success toast
- [x] 3.5.11 Implement targeted update for overwrite drawing
  - In `gallery-sidebar.tsx` overwrite handler
  - After successful overwrite, use `handleDrawingUpdate` to update specific drawing
  - Update thumbnail, timestamp, elements fields
  - No `galleryRefreshAtom` trigger
  - Show success toast
- [x] 3.5.12 Eliminate `galleryRefreshAtom` usage (partially complete)
  - Removed from: save, update, delete, rename, overwrite, add to collection operations
  - `galleryRefreshAtom` still exists but mostly unused (can be removed in future cleanup)
  - All operations now use targeted local state updates
- [x] 3.5.13 Remove `collectionsRefreshAtom` from codebase
  - Removed atom definition from `gallery-atoms.ts`
  - Removed all imports and usages of `setCollectionsRefresh`
  - Collections section renders synchronously with local state
- [x] 3.5.14 Coordinate state between GallerySidebar, GalleryList, and CollectionManager
  - Pass drawings list state from GallerySidebar to GalleryList via `displayedDrawings` prop
  - Pass collections list state and setter from GallerySidebar to CollectionManager
  - Pass `drawingCounts` computed via `useMemo` in GallerySidebar
  - Pass callbacks: `handleDrawingUpdate`, `handleDrawingDelete`, `handleCollectionCountUpdate`, `handleResetPage`
  - All targeted updates work through shared state managed in GallerySidebar
- [x] 3.5.15 Remove `currentPageAtom` and migrate to local state
  - Removed `currentPageAtom` from `gallery-atoms.ts`
  - Changed `search-bar.tsx` and `collection-manager.tsx` to use `onResetPage` callback
  - `GallerySidebar` manages `currentPage` with local `useState`
  - Pass `handleResetPage` callback to child components for pagination reset

### 3.6 Testing & Validation
- [ ] 3.6.1 Test database migration from v1 to v2
- [ ] 3.6.2 Test save/load/delete operations
- [ ] 3.6.3 Test storage isolation (auto-save doesn't affect Gallery)
- [x] 3.6.4 Test collection management optimistic updates
  - Create collection → UI updates immediately, persists async ✓
  - Rename collection → name changes immediately, persists async ✓
  - Delete collection → removed immediately, persists async ✓
  - Rollback on persistence failure implemented with toast notifications ✓
- [ ] 3.6.5 Test search functionality with debouncing
- [ ] 3.6.6 Test thumbnail generation across different drawing sizes
- [ ] 3.6.7 Test split button save behavior (with and without loaded drawing)
- [x] 3.6.8 Test "Save as New Drawing" with targeted insert
  - New drawing appears in list via local state management ✓
  - No full list refresh or unnecessary loading ✓
  - Other cards remain stable ✓
- [x] 3.6.9 Test "Overwrite with current canvas" with targeted update
  - Only the specific card updates (thumbnail, timestamp) via `handleDrawingUpdate` ✓
  - No full list refresh ✓
  - Other cards remain stable ✓
- [x] 3.6.10 Test update existing drawing with targeted update
  - Only the specific card updates via `handleDrawingUpdate` ✓
  - No full list refresh ✓
  - Other cards remain stable ✓
- [x] 3.6.11 Test rename drawing with targeted update
  - Name changes immediately in specific card via callback ✓
  - Persists async to IndexedDB ✓
  - No full list refresh ✓
  - (Rollback on failure not yet implemented - using basic local state update)
- [x] 3.6.12 Test delete drawing with targeted removal
  - Drawing removed immediately from list via callback ✓
  - Collection counts update immediately via `onCollectionCountUpdate` ✓
  - Persists async to IndexedDB ✓
  - No full list refresh ✓
  - (Rollback on failure not yet implemented - using basic local state update)
- [x] 3.6.13 Test add to collection with targeted update
  - Collection IDs update immediately via callback ✓
  - Collection counts update immediately in sidebar ✓
  - Persists async to IndexedDB ✓
  - No full list refresh ✓
  - (Rollback on failure not yet implemented - using basic local state update)
- [x] 3.6.14 Test menu click isolation in collections (no unwanted collection switches) ✓
- [x] 3.6.15 Test menu click isolation in drawing cards (no unwanted drawing loads) ✓
- [x] 3.6.16 Test collections section stability
  - Collections section collapsed by default (set to `false` for better UX) ✓
  - No Suspense loading states in collections ✓
  - Collections remain visible during all drawing operations ✓
  - "All Drawings" always visible immediately ✓
- [x] 3.6.17 Test operations no longer trigger full refresh
  - Save/update/delete/rename operations → NO full refresh ✓
  - Cards update in place via targeted callbacks ✓
  - Only filtering (collection/search) triggers data reload ✓

## Phase 4: Lazy Drawing Data Loading Optimization

### 4.1 IndexedDB Query Optimization
- [x] 4.1.1 Create `DrawingMetadata` TypeScript interface in `indexdb.ts`
  - Export interface with fields: id, name, thumbnail, collectionIds, createdAt, updatedAt
  - Keep existing `Drawing` interface unchanged with all fields
- [x] 4.1.2 Modify `getDrawings()` to return metadata only
  - Update query to select only metadata fields (id, name, thumbnail, collectionIds, createdAt, updatedAt)
  - Exclude elements, appState, files from query result
  - Keep same filtering logic (collectionId, search)
  - Keep same sorting logic (updatedAt descending)
  - Update return type to `Promise<DrawingMetadata[]>`
- [x] 4.1.3 Implement `getDrawingFullData(drawingId: string)` function
  - Query single drawing by ID from IndexedDB
  - Return only: id, elements, appState, files
  - Throw error "Drawing not found" if ID doesn't exist
  - Return type: `Promise<{ id: string; elements: string; appState: string; files: string }>`
- [x] 4.1.4 Implement `getDrawingsFilesOnly()` function
  - Query all drawings from IndexedDB
  - Return only: id, files
  - Return type: `Promise<{ id: string; files: string }[]>`
  - Used for file cleanup operations

### 4.2 Hook Integration
- [x] 4.2.1 Update `use-drawing-crud.ts` to support lazy loading
  - Keep `getAll()` returning metadata only (via updated `getDrawings()`)
  - Add new `getFullData(id)` function wrapping `getDrawingFullData()`
  - Add new `getFilesOnly()` function wrapping `getDrawingsFilesOnly()`
  - Export all three functions
- [x] 4.2.2 Update `use-file-cleanup.ts` to use files-only query
  - Replace `getDrawings()` call with `getDrawingsFilesOnly()`
  - Update code to work with `{ id, files }[]` instead of full `Drawing[]`
  - Verify cleanup logic still correctly identifies orphaned files

### 4.3 Gallery Component Updates
- [x] 4.3.1 Update `gallery-sidebar.tsx` state types
  - Change `allDrawings` state type from `Drawing[]` to `DrawingMetadata[]`
  - Update `GalleryListProps.drawings` type to `DrawingMetadata[]`
  - Update all references to drawings to use `DrawingMetadata` type
- [x] 4.3.2 Update `handleLoad` function to fetch full data
  - Import `getFullData` from `useDrawingCrud`
  - Before parsing, call `const fullDrawing = await getFullData(drawing.id)`
  - Parse elements, appState, files from `fullDrawing` instead of `drawing`
  - Keep error handling with toast notification
- [x] 4.3.3 Update `getDrawingName` helper function
  - Keep using `getAll()` since it returns metadata with name field
  - No changes needed (metadata includes name)

### 4.4 Type Safety Updates
- [x] 4.4.1 Update `drawing-card.tsx` prop types
  - Change `drawing` prop type from `Drawing` to `DrawingMetadata`
  - Verify all accessed fields (name, thumbnail, updatedAt, collectionIds) exist in `DrawingMetadata`
  - TypeScript should prevent accessing elements, appState, files
- [x] 4.4.2 Update `save-dialog.tsx` if needed
  - Review if it accesses any drawing data
  - Update types if necessary

### 4.5 Testing & Validation
- [ ] 4.5.1 Test gallery list loading with metadata only
  - Open gallery sidebar with 50+ drawings
  - Verify list renders correctly showing thumbnails and names
  - Verify no elements/appState/files data is loaded
  - Check browser DevTools → Application → IndexedDB for query results
- [ ] 4.5.2 Test canvas loading with full data fetch
  - Click on a drawing card
  - Verify `getDrawingFullData()` is called
  - Verify drawing loads correctly to canvas with all elements and files
  - Check console for any parsing errors
- [ ] 4.5.3 Test file cleanup with files-only query
  - Trigger file cleanup (or wait 24 hours)
  - Verify cleanup runs without errors
  - Verify orphaned files are correctly identified and removed
  - Check console logs for cleanup statistics
- [ ] 4.5.4 Performance testing
  - Compare gallery list load time before/after optimization
  - Measure memory usage with 100+ drawings before/after
  - Verify canvas load time is not significantly affected
- [ ] 4.5.5 Error handling testing
  - Try loading a drawing that doesn't exist (edge case)
  - Verify error toast is displayed
  - Verify app doesn't crash

## Dependencies & Sequencing
- Phase 1 tasks must be completed sequentially (1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6)
- Phase 2 can start after Phase 1 is complete
- Phase 3 can be implemented in parallel after Phase 2.1 and 2.2 are done
- Phase 3.1 (Performance) can be done independently
- Phase 3.2 (File Cleanup) can be done independently
- Phase 3.3 (i18n) should be done before final release
- **Phase 3.4 (Event Handling) must be done before Phase 3.6 testing** ✓ COMPLETED
- **Phase 3.5 (Optimistic Updates & Targeted Updates) must be done before Phase 3.6 testing** ✓ COMPLETED
- Phase 3.4 and 3.5 can be done in parallel
- Phase 3.5 requires significant state management refactoring (local state for both collections and drawings) ✓ COMPLETED
- **Phase 4 (Lazy Loading) can be implemented independently after Phase 1 is complete**
- **Phase 4 is OPTIONAL for MVP but RECOMMENDED for performance at scale (100+ drawings)**
- Phase 4 requires Phase 3.5 to be completed (centralized state management)

## Phase 3.5 Implementation Summary (Completed)

### What Was Implemented
1. **Eliminated Refresh Atoms**
   - Removed `collectionsRefreshAtom` completely
   - Removed `currentPageAtom` completely  
   - `galleryRefreshAtom` mostly unused (exists but no longer triggers full refreshes)

2. **Centralized State Management in GallerySidebar**
   - `allDrawings`: Full drawing list (loaded once on mount)
   - `collections`: Full collections list (loaded once on mount)
   - `currentPage`: Local pagination state
   - All state managed with `useState` in `GallerySidebar`

3. **Optimistic Updates for Collections**
   - Create: Immediate UI update with temp ID → async save → replace temp ID
   - Rename: Immediate UI update → async save → rollback on failure
   - Delete: Immediate UI removal → async delete → rollback on failure
   - All with toast notifications for errors

4. **Targeted Updates for Drawings**
   - Rename: Update via `handleDrawingUpdate` callback
   - Delete: Remove via `handleDrawingDelete` callback
   - Add to collection: Update via `handleDrawingUpdate` + collection count update
   - Save/overwrite: Direct state update, no full refresh

5. **Efficient Computed Values**
   - `drawingCounts`: Computed via `useMemo` from `allDrawings` and `collections`
   - `filteredDrawings`: Computed via `useMemo` with collection/search filters
   - `displayedDrawings`: Computed via `useMemo` for pagination
   - Only recompute when dependencies change

6. **Props-Based Communication**
   - `CollectionManager`: Receives `collections`, `setCollections`, `drawingCounts`, `onResetPage`
   - `GalleryList`: Receives `displayedDrawings`, `collections`, and update callbacks
   - `DrawingCard`: Receives `onUpdate`, `onDelete`, `onCollectionCountUpdate` callbacks
   - `SearchBar`: Receives `onResetPage` callback

### Benefits Achieved
- ✅ **No unnecessary database queries**: Load once, filter/paginate in memory
- ✅ **Instant UI feedback**: Optimistic updates make UI feel responsive
- ✅ **No full list re-renders**: Targeted updates only affect specific cards
- ✅ **Error resilience**: Failed operations rollback with user notification
- ✅ **Cleaner state flow**: Props-based communication is explicit and traceable
- ✅ **Better performance**: `useMemo` prevents redundant computations

### Future Optimizations (Optional)
1. **Complete Rollback for Drawing Operations**
   - Currently: Drawing operations update local state but don't rollback on failure
   - Future: Store old values before update, restore on failure with toast
   - Impact: Medium - would improve error UX consistency with collections

2. **Remove `galleryRefreshAtom` Completely**
   - Currently: Atom exists but is mostly unused
   - Future: Remove atom definition and remaining imports
   - Impact: Low - cleanup only, no functional change

3. **Virtual Scrolling for Large Lists**
   - Currently: Pagination with "Load More" button (20 items per page)
   - Future: Implement react-window or similar for infinite scroll
   - Impact: High for users with 100+ drawings - better UX

4. **Debounced Collection Count Updates**
   - Currently: Collection counts recomputed on every drawing operation
   - Future: Debounce the recomputation when multiple operations happen quickly
   - Impact: Low - only matters with bulk operations (not supported yet)

