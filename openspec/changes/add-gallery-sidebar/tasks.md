# Implementation Tasks

## Phase 1: Core Storage (MVP)

### 1.1 Database Schema
- [ ] 1.1.1 Upgrade IndexedDB from v1 to v2 in `utils/indexdb.ts`
- [ ] 1.1.2 Create `drawings` object store with indexes
- [ ] 1.1.3 Create `collections` object store with indexes
- [ ] 1.1.4 Implement database migration logic
- [ ] 1.1.5 Define TypeScript interfaces for Drawing and Collection

### 1.2 Drawing CRUD Operations
- [ ] 1.2.1 Implement `saveDrawing()` function
- [ ] 1.2.2 Implement `getDrawings()` function with filtering
- [ ] 1.2.3 Implement `updateDrawing()` function
- [ ] 1.2.4 Implement `deleteDrawing()` function
- [ ] 1.2.5 Create `use-drawing-crud.ts` hook

### 1.3 Thumbnail Generation
- [ ] 1.3.1 Implement `use-thumbnail.ts` hook using Excalidraw's exportToBlob
- [ ] 1.3.2 Configure WebP format with quality 0.5
- [ ] 1.3.3 Set fixed height of 200px for thumbnails

### 1.4 Gallery State Management
- [ ] 1.4.1 Create `gallery-atoms.ts` with required Jotai atoms
- [ ] 1.4.2 Implement `currentLoadedDrawingIdAtom` for tracking loaded drawings
- [ ] 1.4.3 Implement `drawingsListAtom` as async atom
- [ ] 1.4.4 Create `use-gallery.ts` facade hook

### 1.5 Basic UI Components
- [ ] 1.5.1 Create `gallery-sidebar.tsx` with Sidebar wrapper
- [ ] 1.5.2 Create `drawing-card.tsx` for thumbnail display
- [ ] 1.5.3 Implement basic list view with load functionality
- [ ] 1.5.4 Add "Save" button and basic save dialog

### 1.6 Editor Integration
- [ ] 1.6.1 Integrate GallerySidebar into LocalEditor
- [ ] 1.6.2 Integrate GallerySidebar into QuickMarkerEditor
- [ ] 1.6.3 Implement load drawing functionality
- [ ] 1.6.4 Implement explicit save functionality

## Phase 2: Collections & Search

### 2.1 Collection Management
- [ ] 2.1.1 Implement `createCollection()` function
- [ ] 2.1.2 Implement `getCollections()` function
- [ ] 2.1.3 Create `collection-manager.tsx` component
- [ ] 2.1.4 Add collection dropdown to sidebar header
- [ ] 2.1.5 Implement "Add to Collection" functionality

### 2.2 Search Functionality
- [ ] 2.2.1 Create `search-bar.tsx` component
- [ ] 2.2.2 Implement real-time filtering by drawing name
- [ ] 2.2.3 Update `drawingsListAtom` to handle search queries
- [ ] 2.2.4 Add search query state management

### 2.3 Enhanced Save UX
- [ ] 2.3.1 Create `save-dialog.tsx` with "Overwrite" vs "Save as New" options
- [ ] 2.3.2 Implement logic to detect if current canvas is a loaded drawing
- [ ] 2.3.3 Add collection selector to save dialog
- [ ] 2.3.4 Implement name input with auto-generation fallback

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
- [ ] 3.3.1 Add i18n keys for all Gallery UI strings
- [ ] 3.3.2 Add Chinese translations
- [ ] 3.3.3 Add English translations

### 3.4 Testing & Validation
- [ ] 3.4.1 Test database migration from v1 to v2
- [ ] 3.4.2 Test save/load/delete operations
- [ ] 3.4.3 Test storage isolation (auto-save doesn't affect Gallery)
- [ ] 3.4.4 Test collection management
- [ ] 3.4.5 Test search functionality
- [ ] 3.4.6 Test thumbnail generation across different drawing sizes

## Dependencies & Sequencing
- Phase 1 tasks must be completed sequentially (1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6)
- Phase 2 can start after Phase 1 is complete
- Phase 3 can be implemented in parallel after Phase 2.1 and 2.2 are done
- Phase 3.1 (Performance) can be done independently
- Phase 3.2 (File Cleanup) can be done independently
- Phase 3.3 (i18n) should be done before final release
