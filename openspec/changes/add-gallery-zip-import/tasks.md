# Implementation Tasks

## 1. Gallery Import Flow
- [x] 1.1 Add `Import Gallery` action in gallery dropdown
- [x] 1.2 Add ZIP file picker and import mode dialog (default append)
- [x] 1.3 Implement append import behavior
- [x] 1.4 Implement overwrite restore behavior (clear then import)

## 2. Data and Storage
- [x] 2.1 Add IndexedDB helper to clear drawings/collections/files stores
- [x] 2.2 Add gallery import hook for ZIP parsing and drawing persistence
- [x] 2.3 Keep import compatible with ZIPs without metadata (`data.json`)
- [x] 2.4 Restore collections and collection mapping when metadata is present

## 3. Export Metadata Upgrade
- [x] 3.1 Extend export `data.json` schema with optional collections and drawing path mapping
- [x] 3.2 Keep exported `.excalidraw` content unchanged and compatible

## 4. UX and i18n
- [x] 4.1 Add loading/disabled states for import action
- [x] 4.2 Add import success/failure/validation toasts
- [x] 4.3 Add English and Chinese locale strings for import flow
