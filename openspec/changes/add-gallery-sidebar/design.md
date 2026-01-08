# Design Document: Gallery Sidebar Implementation

## Context
The Excali Local application currently only persists a single working canvas to localStorage with auto-save. Users cannot save multiple drawings, organize them, or switch between different projects. This design introduces a Gallery feature for permanent drawing management while maintaining the existing auto-save workspace.

**Constraints:**
- Must not break existing auto-save behavior
- Must work in both LocalEditor and QuickMarkerEditor contexts
- Must use existing dependencies (idb, jotai)
- Must follow existing component patterns (Excalidraw Sidebar component)

**Stakeholders:**
- End users: Need organized drawing management
- Developers: Need maintainable, testable architecture

## Goals / Non-Goals

**Goals:**
- Provide permanent storage for multiple named drawings
- Enable organization through collections
- Maintain complete isolation from auto-save workspace
- Support search and filtering of drawings
- Generate visual thumbnails for easy identification

**Non-Goals:**
- Cloud synchronization (local-only storage)
- Real-time collaboration
- Drawing version history
- Export/import functionality (future enhancement)

## Decisions

### Decision 1: IndexedDB for Gallery Storage
**What:** Use IndexedDB with a new `drawings` object store, separate from the existing `files` store.

**Why:**
- Existing `files` store is used by auto-save for binary data
- IndexedDB supports structured data with indexes for efficient querying
- Already using `idb` library in the project
- Enables offline-first architecture
- Supports large data volumes better than localStorage

**Alternatives considered:**
- localStorage: Too limited in size and lacks indexing capabilities
- Separate database: Unnecessary complexity for this feature
- File System API: Not widely supported, overkill for this use case

### Decision 2: Storage Isolation via Separate Stores
**What:** Auto-save continues using localStorage + `files` store. Gallery uses new `drawings` store. Track loaded drawing via in-memory Jotai atom.

**Why:**
- Clean separation of concerns: workspace vs permanent library
- No risk of auto-save overwriting Gallery drawings
- Users can experiment in workspace without affecting saved drawings
- Explicit save action makes user intent clear

**Alternatives considered:**
- Single unified storage: Would require complex logic to distinguish workspace from gallery
- Flag-based approach: Error-prone, harder to reason about
- Copy-on-load: Wastes storage space, confusing UX

### Decision 3: Component Structure - Separate Directory
**What:** Create `src/features/gallery/` directory mirroring the `features/editor/` structure with components, hooks, store, and utils subdirectories.

**Why:**
- Follows existing project convention (see `features/editor/`)
- Enables clear separation of concerns
- Makes code discoverable and maintainable
- Allows future extraction to separate package if needed

### Decision 4: Jotai for State Management
**What:** Use Jotai atoms for Gallery state (current collection, search query, drawings list, loaded drawing ID).

**Why:**
- Already used throughout the application (see `store/presentation.ts`)
- Atomic, minimal API
- Async atoms perfect for IndexedDB queries
- No additional dependencies needed

### Decision 5: Thumbnail Format - WebP
**What:** Generate WebP thumbnails at 200px height, quality 0.5.

**Why:**
- WebP provides better compression than PNG (smaller storage)
- Quality 0.5 is sufficient for thumbnails
- Fixed height maintains consistent UI while allowing variable width
- Excalidraw's `exportToBlob` already supports WebP

**Alternatives considered:**
- PNG: Larger file size, no advantage for thumbnails
- JPEG: Doesn't support transparency
- SVG: Would require additional rendering, overkill

### Decision 6: Database Migration Strategy
**What:** Upgrade existing `excali` database from v1 to v2 using idb's upgrade callback.

**Why:**
- idb handles version management automatically
- Existing `files` store preserved
- Backward compatible (users can rollback safely)
- Standard pattern in the codebase

### Decision 7: Explicit Save Only for Gallery
**What:** Gallery drawings are saved only via explicit user action (clicking "Save" button). Auto-save continues independently.

**Why:**
- Prevents accidental overwrites
- Makes user intent explicit
- Aligns with user mental model ("Save" means permanent)
- Reduces storage churn

## Risks / Trade-offs

### Risk 1: IndexedDB Storage Limits
**Issue:** Browsers typically limit IndexedDB to 50-100MB per origin.

**Mitigation:**
- Thumbnails are compressed WebP (<50KB each)
- Store only necessary data in `drawings` (exclude deleted elements)
- Binary files already in separate `files` store
- Implement file cleanup in Phase 3
- Monitor storage usage and warn users at 80% capacity (future enhancement)

**Trade-off:** Users with hundreds of complex drawings may hit limits. Acceptable for MVP; can add export/cleanup tools later.

### Risk 2: Database Migration Failures
**Issue:** Users on v1 might experience migration issues if browser interrupts upgrade.

**Mitigation:**
- idb handles transaction rollback automatically
- Existing `files` store remains untouched
- Log migration errors to console for debugging
- Test migration with various browser versions

**Trade-off:** Cannot recover from catastrophic migration failure without user data loss. Consider adding export feature in future.

### Risk 3: Performance with Large Drawing Count
**Issue:** Loading 1000+ drawings could slow down UI.

**Mitigation:**
- Implement pagination (20 drawings per page) in Phase 3.1
- Use IndexedDB indexes for efficient filtering
- Lazy-load thumbnails
- Search filters reduce visible set

**Trade-off:** Pagination adds UI complexity. Most users won't have >100 drawings in MVP timeframe.

### Risk 4: Storage Isolation Confusion
**Issue:** Users might not understand why their edits don't auto-save to Gallery.

**Mitigation:**
- Clear UI indicators (show loaded drawing name in sidebar)
- "Unsaved changes" warning when loading different drawing
- Tooltip on Save button explaining behavior
- i18n strings clearly communicate "Save to Gallery"

**Trade-off:** Requires user education. Consider adding onboarding tooltip in future.

## Migration Plan

### Phase 1: Database Migration (v1 → v2)
1. Update `indexdb.ts` with new version number
2. Add upgrade callback to create new object stores
3. Existing data in `files` store remains untouched
4. Test migration on local development
5. Test migration on staging with v1 database

### Phase 2: Feature Rollout
1. Deploy Phase 1 (Core Storage) as alpha feature flag (optional)
2. Monitor for storage errors in logs
3. Deploy Phase 2 (Collections & Search) after Phase 1 stability confirmed
4. Deploy Phase 3 (Polish) incrementally

### Rollback Strategy
- If critical bug found: Temporarily hide Gallery sidebar via feature flag
- Database v2 is additive, so users can continue using auto-save
- Future versions can keep database at v2, no downgrade needed

## Open Questions

### Q1: Should we allow exporting drawings as .excalidraw files?
**Status:** Deferred to Phase 4 (future enhancement)
**Reasoning:** Nice-to-have, not blocking for core functionality. Excalidraw already supports this via native export.

### Q2: Should we sync collection order preference?
**Status:** Yes, store order in `slideIdOrderListAtom` pattern
**Reasoning:** Existing pattern in `store/presentation.ts` for slide ordering. Can reuse approach.

### Q3: How to handle drawings with missing file references?
**Status:** Graceful degradation - show placeholder icon
**Reasoning:** File cleanup might delete unreferenced files. Better to show something than crash.

## Technical Specifications

### IndexedDB Schema
**Database:** `excali`  
**Version:** `2`

**Object Store: `drawings`**
- KeyPath: `id` (string, UUID)
- Indexes:
  - `updatedAt` (for sorting by recent)
  - `collectionIds` (multiEntry: true, for filtering by collection)

**Object Store: `collections`**
- KeyPath: `id` (string, UUID)
- Indexes:
  - `createdAt` (for sorting)

**Object Store: `files`** (existing, unchanged)
- KeyPath: `id`

### State Atoms (Jotai)
```typescript
// gallery-atoms.ts
galleryIsOpenAtom: boolean
selectedCollectionIdAtom: string | null
searchQueryAtom: string
drawingsListAtom: Promise<Drawing[]>
currentLoadedDrawingIdAtom: string | null
```

### File Structure
```
src/features/gallery/
├── components/
│   ├── gallery-sidebar.tsx
│   ├── drawing-card.tsx
│   ├── collection-manager.tsx
│   ├── search-bar.tsx
│   └── save-dialog.tsx
├── hooks/
│   ├── use-gallery.ts
│   ├── use-thumbnail.ts
│   └── use-drawing-crud.ts
├── store/
│   ├── gallery-atoms.ts
│   └── db-schema.ts
└── utils/
    ├── db-migration.ts
    └── idgen.ts
```

## Success Metrics
- Users can save and load drawings without errors
- Database migration completes successfully for 100% of users
- Thumbnail generation completes in <500ms for typical drawings
- No performance degradation in auto-save behavior
- Storage usage remains under browser limits for typical use (50-100 drawings)
