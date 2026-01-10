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
- [ ] 1.6.5 Implement sidebar trigger button hide/show behavior based on sidebar open state

## Phase 2: Collections & Search

### 2.1 Collection Management
- [x] 2.1.1 Implement `createCollection()` function
- [x] 2.1.2 Implement `getCollections()` function
- [x] 2.1.3 Create `collection-manager.tsx` component
- [x] 2.1.4 Add collection dropdown to sidebar header
- [x] 2.1.5 Implement "Add to Collection" functionality
- [ ] 2.1.6 Refactor collection-manager.tsx to sidebar list layout (excalisave-style)
- [ ] 2.1.7 Add "Collections" section header with "+" icon button
- [ ] 2.1.8 Implement collection list items with folder icons and drawing counts
- [ ] 2.1.9 Add "..." menu icon to each collection with rename/delete options
- [ ] 2.1.10 Implement rename collection functionality
- [ ] 2.1.11 Implement delete collection functionality with confirmation
- [ ] 2.1.12 Add collection section collapse/expand functionality
- [ ] 2.1.13 Use shadcn UI Input component in rename/create dialogs

### 2.2 Search Functionality
- [x] 2.2.1 Create `search-bar.tsx` component
- [x] 2.2.2 Implement real-time filtering by drawing name
- [x] 2.2.3 Update `drawingsListAtom` to handle search queries
- [x] 2.2.4 Add search query state management
- [ ] 2.2.5 Add shadcn UI Input component to `@/components/ui/input.tsx`
- [ ] 2.2.6 Replace native input in search-bar.tsx with shadcn Input component
- [ ] 2.2.7 Implement 300ms debounce for search input

### 2.3 Enhanced Save UX
- [x] 2.3.1 Create `save-dialog.tsx` with "Overwrite" vs "Save as New" options
- [x] 2.3.2 Implement logic to detect if current canvas is a loaded drawing
- [x] 2.3.3 Add collection selector to save dialog
- [x] 2.3.4 Implement name input with auto-generation fallback
- [ ] 2.3.5 Refactor save button to text+icon button with conditional dropdown
- [ ] 2.3.6 Implement split button behavior: main action + dropdown menu
- [ ] 2.3.7 Add "Save as New Drawing" option in dropdown menu
- [ ] 2.3.8 Implement quick save (direct update without dialog) for loaded drawings
- [ ] 2.3.9 Add toast notifications for save/update success/error
- [ ] 2.3.10 Update save dialog to use "Save As" mode only (remove overwrite option from dialog)

### 2.4 Drawing Management
- [ ] 2.4.1 Add "..." menu icon to each drawing card
- [ ] 2.4.2 Implement drawing card menu with Rename/Add to Collection/Overwrite/Delete options
- [ ] 2.4.3 Implement rename drawing functionality with dialog
- [ ] 2.4.4 Implement "Overwrite with current canvas" functionality
- [ ] 2.4.5 Update delete functionality to trigger from menu (remove old trigger method)
- [ ] 2.4.6 Add confirmation dialogs for destructive actions (overwrite, delete)

## Phase 3: Polish & Optimization

### 3.1 Performance Optimization
- [ ] 3.1.1 Implement pagination for drawing list (load 20 at a time)
- [ ] 3.1.2 Add loading states and skeleton UI
- [ ] 3.1.3 Optimize thumbnail generation performance

### 3.2 File Cleanup
- [ ] 3.2.1 Create `use-file-cleanup.ts` hook
- [ ] 3.2.2 Implement background cleanup algorithm
- [ ] 3.2.3 Add cleanup on app startup (debounced, once per 24 hours)
- [ ] 3.2.4 Add manual "Clean Up Storage" button in settings (optional)

### 3.3 Internationalization
- [ ] 3.3.1 Add i18n keys for all Gallery UI strings (including new save/rename/overwrite messages)
- [ ] 3.3.2 Add Chinese translations for all keys
- [ ] 3.3.3 Add English translations for all keys

### 3.4 Testing & Validation
- [ ] 3.4.1 Test database migration from v1 to v2
- [ ] 3.4.2 Test save/load/delete operations
- [ ] 3.4.3 Test storage isolation (auto-save doesn't affect Gallery)
- [ ] 3.4.4 Test collection management (create/rename/delete)
- [ ] 3.4.5 Test search functionality with debouncing
- [ ] 3.4.6 Test thumbnail generation across different drawing sizes
- [ ] 3.4.7 Test split button save behavior (with and without loaded drawing)
- [ ] 3.4.8 Test "Save as New Drawing" functionality
- [ ] 3.4.9 Test "Overwrite with current canvas" functionality
- [ ] 3.4.10 Test rename drawing functionality

## Dependencies & Sequencing
- Phase 1 tasks must be completed sequentially (1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6)
- Phase 2 can start after Phase 1 is complete
- Phase 3 can be implemented in parallel after Phase 2.1 and 2.2 are done
- Phase 3.1 (Performance) can be done independently
- Phase 3.2 (File Cleanup) can be done independently
- Phase 3.3 (i18n) should be done before final release
