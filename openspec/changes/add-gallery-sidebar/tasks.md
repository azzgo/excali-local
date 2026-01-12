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
- [ ] 3.5.1 Refactor collection manager to use local state instead of async atoms
  - Replace `collectionsListAtom` usage with `useState` in `CollectionsList` component
  - Load initial collections from IndexedDB with `useEffect` on mount
  - Remove `Suspense` wrapper from `CollectionManager` component
  - Set default collapsed state to `true` for collections section
- [ ] 3.5.2 Refactor drawing list to use local state with targeted updates
  - Replace `drawingsListAtom` with `useState` in `GalleryList` component
  - Keep async atom ONLY for initial load and filter changes (collection/search)
  - Load initial drawings from IndexedDB on mount
  - Use Suspense ONLY for initial load and filter changes, not for card operations
- [ ] 3.5.3 Implement optimistic create collection in `collection-manager.tsx`
  - Add new collection to local state immediately with temporary ID
  - Call `createCollection()` asynchronously
  - On success: replace temporary ID with real ID from IndexedDB
  - On failure: remove collection from state and show error toast
- [ ] 3.5.4 Implement optimistic rename collection in `collection-manager.tsx`
  - Update collection name in local state immediately
  - Call `updateCollection()` asynchronously
  - On success: keep the new name
  - On failure: revert to old name in state and show error toast
- [ ] 3.5.5 Implement optimistic delete collection in `collection-manager.tsx`
  - Remove collection from local state immediately
  - Call `deleteCollection()` asynchronously
  - On success: keep removed
  - On failure: restore collection in state and show error toast
- [ ] 3.5.6 Implement optimistic rename drawing with targeted update
  - Update drawing name in local state immediately (update specific item)
  - Call `update()` asynchronously
  - On success: keep the updated local state (no full refresh)
  - On failure: revert name in local state and show error toast
- [ ] 3.5.7 Implement optimistic delete drawing with targeted removal
  - Remove drawing from local state immediately (filter out item)
  - Update collection counts in CollectionManager immediately (callback)
  - Call `remove()` asynchronously
  - On success: keep the updated local state (no full refresh)
  - On failure: restore drawing in local state and show error toast
- [ ] 3.5.8 Implement optimistic add to collection with targeted update
  - Update collection badges on card immediately (update specific item in local state)
  - Update collection counts in sidebar immediately (callback to parent)
  - Call `update()` with new `collectionIds` asynchronously
  - On success: keep the updated local state (no full refresh)
  - On failure: revert badges and counts in local state, show error toast
- [ ] 3.5.9 Implement targeted insert for save new drawing in `gallery-sidebar.tsx`
  - After successful save, prepend new drawing to local drawings list (unshift)
  - Update drawing card count in affected collections
  - DO NOT trigger `galleryRefreshAtom` or full list refresh
  - Show success toast
- [ ] 3.5.10 Implement targeted update for update existing drawing in `gallery-sidebar.tsx`
  - After successful update, find drawing in local list by ID and update it
  - Update only thumbnail, timestamp, elements fields
  - DO NOT trigger `galleryRefreshAtom` or full list refresh
  - Show success toast
- [ ] 3.5.11 Implement targeted update for overwrite drawing
  - In both `gallery-sidebar.tsx` and `drawing-card.tsx` overwrite handlers
  - After successful overwrite, find drawing in local list by ID and update it
  - Update thumbnail, timestamp, elements fields
  - DO NOT trigger `galleryRefreshAtom` or full list refresh
  - Show success toast
- [ ] 3.5.12 Update `galleryRefreshAtom` usage to minimal scope
  - Use ONLY for: initial load, collection filter change, search query change
  - Remove usage from: save, update, delete, rename, overwrite, add to collection
  - Verify atom increments only trigger Suspense for filter changes, not card operations
- [ ] 3.5.13 Remove `collectionsRefreshAtom` from codebase
  - Remove atom definition from `gallery-atoms.ts`
  - Remove all imports and usages of `setCollectionsRefresh`
  - Verify collections section renders synchronously without atom dependency
- [ ] 3.5.14 Coordinate state between GallerySidebar, GalleryList, and CollectionManager
  - Pass drawings list state and setter from GallerySidebar down to GalleryList
  - Pass collections list state and setter from GallerySidebar to CollectionManager
  - Pass callbacks for cross-component updates (e.g., collection count updates)
  - Ensure all targeted updates work through shared state

### 3.6 Testing & Validation
- [ ] 3.6.1 Test database migration from v1 to v2
- [ ] 3.6.2 Test save/load/delete operations
- [ ] 3.6.3 Test storage isolation (auto-save doesn't affect Gallery)
- [ ] 3.6.4 Test collection management optimistic updates
  - Create collection → UI updates immediately, persists async
  - Rename collection → name changes immediately, persists async
  - Delete collection → removed immediately, persists async
  - Test rollback on persistence failure for each operation
- [ ] 3.6.5 Test search functionality with debouncing
- [ ] 3.6.6 Test thumbnail generation across different drawing sizes
- [ ] 3.6.7 Test split button save behavior (with and without loaded drawing)
- [ ] 3.6.8 Test "Save as New Drawing" with targeted insert
  - New drawing appears at top of list immediately
  - No full list refresh or Suspense loading
  - Other cards remain stable
- [ ] 3.6.9 Test "Overwrite with current canvas" with targeted update
  - Only the specific card updates (thumbnail, timestamp)
  - No full list refresh or Suspense loading
  - Other cards remain stable
- [ ] 3.6.10 Test update existing drawing with targeted update
  - Only the specific card updates (thumbnail, timestamp)
  - No full list refresh or Suspense loading
  - Other cards remain stable
- [ ] 3.6.11 Test rename drawing optimistic update with targeted update
  - Name changes immediately in specific card
  - Persists async to IndexedDB
  - No full list refresh
  - Rollback on failure with toast
- [ ] 3.6.12 Test delete drawing optimistic update with targeted removal
  - Drawing removed immediately from list
  - Collection counts update immediately
  - Persists async to IndexedDB
  - No full list refresh
  - Rollback on failure with toast
- [ ] 3.6.13 Test add to collection optimistic update with targeted update
  - Badges update immediately on specific card
  - Collection counts update immediately in sidebar
  - Persists async to IndexedDB
  - No full list refresh
  - Rollback on failure with toast
- [ ] 3.6.14 Test menu click isolation in collections (no unwanted collection switches)
- [ ] 3.6.15 Test menu click isolation in drawing cards (no unwanted drawing loads)
- [ ] 3.6.16 Test collections section stability
  - Collections section collapsed by default
  - No Suspense loading states in collections
  - Collections remain visible during all drawing operations
  - "All Drawings" always visible immediately
- [ ] 3.6.17 Test Suspense only for filter changes
  - Initial load → shows skeleton
  - Collection filter change → shows skeleton
  - Search query change → shows skeleton
  - Save/update/delete/rename operations → NO skeleton, cards update in place

## Dependencies & Sequencing
- Phase 1 tasks must be completed sequentially (1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6)
- Phase 2 can start after Phase 1 is complete
- Phase 3 can be implemented in parallel after Phase 2.1 and 2.2 are done
- Phase 3.1 (Performance) can be done independently
- Phase 3.2 (File Cleanup) can be done independently
- Phase 3.3 (i18n) should be done before final release
- **Phase 3.4 (Event Handling) must be done before Phase 3.6 testing**
- **Phase 3.5 (Optimistic Updates & Targeted Updates) must be done before Phase 3.6 testing**
- Phase 3.4 and 3.5 can be done in parallel
- Phase 3.5 requires significant state management refactoring (local state for both collections and drawings)
