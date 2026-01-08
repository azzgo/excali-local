# Design Document: Gallery & Collections System

## 1. Feature Naming
- **English Name:** Gallery
- **Chinese Name:** 画廊 (Huàláng)
- **Rationale:** "Gallery" implies a visual collection of works, which fits the thumbnail-based UI requirement better than "Manager" or "List". "Collection" is reserved for the grouping mechanism within the Gallery.

## 2. Technical Architecture Overview

The Gallery feature will function as a self-contained module managed by a new "Gallery Manager" layer that bridges the UI (Sidebar) and the Persistence layer (IndexedDB).

```mermaid
graph TD
    UI[Sidebar UI] -->|User Actions| Hooks[Custom Hooks]
    Hooks -->|State Updates| Jotai[Jotai Store]
    Hooks -->|Data Operations| Service[Gallery Service]
    Service -->|CRUD| IDB[IndexedDB]
    
    subgraph "Data Stores"
        Drawings[Store: drawings]
        Collections[Store: collections]
        Files[Store: files (Existing)]
    end
    
    Service --> Drawings
    Service --> Collections
    Service --> Files
```

### Key Components:
1.  **GallerySidebar:** The main UI entry point.
2.  **GalleryService:** Business logic for saving, loading, and searching.
3.  **IndexedDB Adapter:** Enhanced storage layer.
4.  **State Sync:** Jotai atoms to keep the list view updated across renders.

## 3. IndexedDB Schema Design

We will upgrade the existing `excali` database from version 1 to 2.

**Database:** `excali`
**Version:** `2`

### Store: `drawings`
Stores the full canvas state and metadata.
- **KeyPath:** `id` (string, UUID)
- **Indexes:**
    - `updatedAt` (for sorting by recent)
    - `collectionIds` (multiEntry: true, for filtering by collection)
- **Schema Interface:**
```typescript
interface Drawing {
  id: string;              // UUID
  name: string;           // User-defined or auto-generated
  thumbnail: string;      // DataURL (WebP compressed)
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;     // Metadata of files used
  collectionIds: string[]; // Array of Collection IDs
  createdAt: number;      // Timestamp
  updatedAt: number;      // Timestamp
}
```

### Store: `collections`
Stores grouping metadata.
- **KeyPath:** `id` (string, UUID)
- **Indexes:** `createdAt`
- **Schema Interface:**
```typescript
interface Collection {
  id: string;             // UUID
  name: string;           // Display name
  createdAt: number;
  // No "drawingIds" here to avoid dual-maintenance. 
  // We query drawings by collectionId index.
}
```

### Store: `files` (Existing)
Remains unchanged. Continues to store binary data for images to prevent the `drawings` store from becoming too heavy.

## 4. Component Design

**Location:** `packages/excali-page/src/features/gallery/`

### File Structure
```
src/features/gallery/
├── components/
│   ├── gallery-sidebar.tsx      # Main sidebar tab
│   ├── drawing-card.tsx         # Thumbnail item
│   ├── collection-manager.tsx   # Create/Edit collections
│   ├── search-bar.tsx           # Search input
│   └── save-dialog.tsx          # Overwrite vs New dialog
├── hooks/
│   ├── use-gallery.ts           # Facade hook for UI
│   ├── use-thumbnail.ts         # Logic to generate thumbnails
│   └── use-drawing-crud.ts      # Core CRUD logic
├── store/
│   ├── gallery-atoms.ts         # Jotai state (active collection, search query)
│   └── db-schema.ts             # TS interfaces
└── utils/
    ├── db-migration.ts          # IDB upgrade logic
    └── idgen.ts                 # UUID generator
```

### Jotai Atoms (`gallery-atoms.ts`)
- `galleryIsOpenAtom`: Boolean
- `selectedCollectionIdAtom`: String | null (null = All)
- `searchQueryAtom`: String
- `drawingsListAtom`: Async atom that derives from DB based on collection/search
- `currentLoadedDrawingIdAtom`: String | null - Tracks which Gallery drawing is currently loaded in the canvas (memory-only, for isolation from auto-save)

## 5. Integration Points

### Editor Integration
Both `QuickMarkerEditor` and `LocalEditor` will include the `GallerySidebar` component inside their `Excalidraw` wrapper, similar to `QuickMarkSidebar`.

**Shared Access:**
Since IndexedDB is browser-scoped, both editors share the same data automatically. No special sync mechanism is needed between tabs unless real-time updates are required (BroadcastChannel could be added later).

**Event Handling:**
- **Load:** When a user clicks a drawing in the Gallery, we fire `excalidrawAPI.updateScene({ elements, appState })` and `excalidrawAPI.addFiles()`, and set `currentLoadedDrawingIdAtom` to track the association.
- **Save:** We read `excalidrawAPI.getSceneElements()` and `getAppState()` only on explicit user action (clicking "Save" button in Gallery).

### Storage Isolation Architecture

**Two Independent Storage Systems:**

1. **Workspace Auto-save (Existing):**
   - Location: `localStorage` + IndexedDB `files` store
   - Keys: `"excalidraw"`, `"excalidraw-state"`, `"excalidraw-libraryItems"`
   - Behavior: Automatic debounced save (50ms) on every canvas change
   - Purpose: Scratch pad / working canvas persistence

2. **Gallery Drawings (New):**
   - Location: IndexedDB `drawings` store
   - Behavior: Explicit save only (user clicks "Save" button)
   - Purpose: Permanent library of named drawings

**Isolation Mechanism:**
```typescript
// The auto-save onChange handler (existing in local-editor.tsx)
const handleSave = useCallback(
  async (elements, appState, files) => {
    // This continues to save to localStorage/files store
    // It does NOT touch the Gallery drawings store
    setLocalStorage(KeyForElements, elements.filter(isNotDeleted));
    setLocalStorage(KeyForAppState, appState);
    await batchSaveFile(Object.keys(files).map(key => ({ id: key, content: files[key] })));
  },
  []
);

// Gallery explicit save (new)
const handleGallerySave = async () => {
  const currentDrawingId = useAtomValue(currentLoadedDrawingIdAtom);
  const elements = excalidrawAPI.getSceneElements();
  const appState = excalidrawAPI.getAppState();
  const files = excalidrawAPI.getFiles();
  
  if (currentDrawingId) {
    // Update existing Gallery drawing
    await updateDrawing(currentDrawingId, { elements, appState, files });
  } else {
    // Save as new Gallery drawing
    const newId = await saveDrawing({ elements, appState, files }, name, collectionIds);
    setCurrentLoadedDrawingId(newId);
  }
};
```

**User Experience:**
- User works on canvas → Auto-save continues to workspace
- User loads a Gallery drawing → Canvas shows the drawing, but edits don't affect Gallery until explicit "Save"
- User can revert by reloading the Gallery drawing (discarding workspace changes)
- Clear separation: "Working on a drawing" ≠ "Saved to Gallery"

## 6. API Design

### Gallery Service (`use-drawing-crud.ts`)

```typescript
// Create
async function saveDrawing(
  data: { elements, appState, files }, 
  name: string, 
  collectionIds: string[]
): Promise<string> // returns ID

// Update (Overwrite)
async function updateDrawing(
  id: string, 
  data: { elements, appState, files, thumbnail? }
): Promise<void>

// Read
async function getDrawings(
  filter: { collectionId?: string, search?: string }
): Promise<Drawing[]>

// Delete
async function deleteDrawing(id: string): Promise<void>

// Collections
async function createCollection(name: string): Promise<Collection>
async function getCollections(): Promise<Collection[]>
```

### Thumbnail Generation (`use-thumbnail.ts`)
Uses `exportToBlob` from Excalidraw utils.
- **Format:** `image/webp` (Better compression than PNG)
- **Quality:** 0.5 (Thumbnails don't need high res)
- **Height:** Fixed 200px (Width auto)

## 7. UX Flow

### A. Save Flow
1. User clicks "Save" icon in Gallery Sidebar.
2. System checks if current canvas was previously loaded from IDB.
   - **If New:** Open "Save As" dialog -> Enter Name -> Select Collections -> Confirm.
   - **If Existing:** Show dialog with "Overwrite [Name]" or "Save as New".

### B. Load Flow
1. User opens Gallery Sidebar.
2. Clicks on a Drawing Card.
3. **Confirmation:** If current canvas has unsaved changes, prompt user.
4. Canvas clears and loads new data.
5. `files` are loaded into the Excalidraw instance.

### C. Collection Management
1. Dropdown in Sidebar Header shows "All Drawings".
2. Click "+" to create new Collection.
3. Drag & Drop (future) or "Right Click -> Add to Collection" on Drawing Cards.

### D. Search
1. Input field at top of list.
2. Filters by `name` field in real-time.

## 8. Performance Considerations

1.  **Thumbnails:** Storing base64 strings in IDB is fine for thumbnails (<50KB). Full resolution exports should NOT be stored in the `drawings` store.
2.  **Pagination:** If user has >100 drawings, load top 20 first. `IDBKeyRange` + `openCursor` allows paging.
3.  **Search:** IndexedDB indexes are exact match. For fuzzy search ("my dra"), we fetch metadata (names) into memory and filter in JS. Since drawing count is likely <1000, in-memory filtering of names is fast enough.
4.  **Concurrency:** Use `readwrite` transactions sparingly.

## 9. Implementation Phases

### Phase 1: Core Storage (MVP)
1.  Update `indexdb.ts` to V2 with new schema.
2.  Implement `saveDrawing` and `getDrawings` (No collections yet).
3.  Basic Sidebar with List View + Load functionality.

### Phase 2: Collections & Search
1.  Implement `collections` store.
2.  Add Collection creation UI.
3.  Implement "Add to Collection" logic.
4.  Add Search bar.

### Phase 3: Polish
1.  Thumbnail generation optimization.
2.  "Overwrite" vs "Save As" UX logic.
3.  i18n for all new strings.
4.  Background file cleanup (nice-to-have).

## 10. Open Questions - RESOLVED

### Question 1: Storage Isolation Between Gallery and Auto-save
**Decision:** Gallery drawings and auto-save canvas are completely isolated.

**Implementation:**
- The existing auto-save mechanism (localStorage + IndexedDB `files` store) continues to work independently for the "working canvas".
- Gallery drawings are stored in the new `drawings` store and are NOT affected by auto-save.
- When a drawing is loaded from Gallery:
  - Store the loaded drawing's `id` in memory (Jotai atom: `currentLoadedDrawingIdAtom: string | null`)
  - This creates a temporary association between the canvas and the Gallery drawing
  - The auto-save system ignores this association and continues saving to the default workspace
- When user explicitly clicks "Save" or "Overwrite" in Gallery:
  - The system reads the current canvas state via `excalidrawAPI.getSceneElements()`
  - Saves to the Gallery `drawings` store (either as new or updating the loaded drawing ID)
- **Key principle:** Auto-save (localStorage) = workspace scratch pad. Gallery = explicit saved drawings library.

**State Management:**
```typescript
// New atom to track loaded drawing
export const currentLoadedDrawingIdAtom = atom<string | null>(null);

// When loading from Gallery
const loadDrawing = async (drawingId: string) => {
  const drawing = await getDrawing(drawingId);
  excalidrawAPI.updateScene({ elements: drawing.elements, appState: drawing.appState });
  excalidrawAPI.addFiles(drawing.files);
  setCurrentLoadedDrawingId(drawingId); // Mark as loaded
};

// When saving to Gallery (explicit action)
const saveToGallery = async () => {
  const elements = excalidrawAPI.getSceneElements();
  const appState = excalidrawAPI.getAppState();
  const files = excalidrawAPI.getFiles();
  
  if (currentLoadedDrawingId) {
    // User wants to update existing drawing
    await updateDrawing(currentLoadedDrawingId, { elements, appState, files });
  } else {
    // Save as new
    const newId = await saveDrawing({ elements, appState, files }, name, collectionIds);
    setCurrentLoadedDrawingId(newId);
  }
};
```

### Question 2: Files Cleanup Strategy
**Decision:** Implement as a nice-to-have background cleanup feature.

**Implementation:**
- **Automatic cleanup:** Background task runs periodically (e.g., every 24 hours or on app startup with debounce)
- **Algorithm:**
  1. Query all `drawings` and extract all `fileIds` referenced in their `files` metadata
  2. Query all keys in the `files` store
  3. Identify orphaned files (in `files` store but not referenced by any drawing or current workspace)
  4. Delete orphaned files in batches
- **Workspace protection:** Never delete files currently referenced in localStorage workspace (current auto-save state)
- **Execution:**
  - Use `requestIdleCallback` to avoid blocking UI
  - Add a manual "Clean Up Storage" button in settings for advanced users
  - Log cleanup statistics (e.g., "Cleaned up 15MB of unused assets")

**Cleanup Hook (`use-file-cleanup.ts`):**
```typescript
export function useFileCleanup() {
  useEffect(() => {
    const cleanup = async () => {
      const lastCleanup = localStorage.getItem('lastFileCleanup');
      const now = Date.now();
      
      // Run once per day
      if (lastCleanup && now - parseInt(lastCleanup) < 24 * 60 * 60 * 1000) {
        return;
      }
      
      requestIdleCallback(async () => {
        const referencedFileIds = await getReferencedFileIds(); // from drawings + workspace
        const allFileIds = await getAllFileIds(); // from files store
        const orphanedIds = allFileIds.filter(id => !referencedFileIds.has(id));
        
        if (orphanedIds.length > 0) {
          await deleteFiles(orphanedIds);
          console.log(`[Gallery] Cleaned up ${orphanedIds.length} orphaned files`);
        }
        
        localStorage.setItem('lastFileCleanup', now.toString());
      });
    };
    
    cleanup();
  }, []);
}
```

**Phase Assignment:** This feature will be implemented in Phase 3 (Polish) or later as a background enhancement.
