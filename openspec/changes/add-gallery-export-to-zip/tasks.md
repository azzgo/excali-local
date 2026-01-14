# Implementation Tasks

## 1. Setup and Dependencies
- [x] 1.1 Add `jszip` to `packages/excali-page/package.json` dependencies
- [x] 1.2 Run `bun install` to install new dependency

## 2. Utility Functions Implementation
- [x] 2.1 Create `export-helpers.ts` with `sanitizeFilename` function
- [x] 2.2 Create `export-helpers.ts` with `transformToExcalidrawFormat` function
- [x] 2.3 Create `export-helpers.ts` with `downloadBlob` native browser helper
- [x] 2.4 Add TypeScript interfaces: `ExcalidrawFile` and `ExportMetadata`
- [x] 2.5 Write vitest unit tests for `sanitizeFilename` function
- [x] 2.6 Write vitest unit tests for `transformToExcalidrawFormat` function

## 3. Core Export Hook Implementation
- [x] 3.1 Create `use-gallery-export.ts` hook file
- [x] 3.2 Implement state management (isExporting flag)
- [x] 3.3 Implement `exportAllDrawingsToZip` function using JSZip
- [x] 3.4 Add error handling for empty galleries and export failures
- [x] 3.5 Add batch processing for large datasets (50+ drawings)
- [x] 3.6 Write vitest tests for hook state management logic
- [x] 3.7 Write vitest tests for error handling scenarios (empty gallery, failures)

## 4. UI Integration
- [x] 4.1 Import `IconFileZip` from `@tabler/icons-react` in `gallery-sidebar.tsx`
- [x] 4.2 Add `isExporting` state to GallerySidebar component
- [x] 4.3 Import and initialize `useGalleryExport` hook
- [x] 4.4 Add new `DropdownMenuItem` for "Export Gallery" below "Remove Unused Files"
- [x] 4.5 Add loading state (spinner icon) when exporting
- [x] 4.6 Add hint/tooltip explaining export functionality

## 5. Internationalization
- [ ] 5.1 Add translation keys for "Export Gallery" label
- [ ] 5.2 Add translation keys for success toast message
- [ ] 5.3 Add translation keys for error messages
- [ ] 5.4 Add translation keys for hint/tooltip text

## 6. Testing and Validation

### 6.1 Vitest Unit Tests (Utility Functions)
- [ ] 6.1.1 Test `sanitizeFilename` with special characters (`<>:"/\\|?*`)
- [ ] 6.1.2 Test `sanitizeFilename` with spaces and case conversion
- [ ] 6.1.3 Test `transformToExcalidrawFormat` output schema validation
- [ ] 6.1.4 Test `transformToExcalidrawFormat` with missing optional fields (defaults)

### 6.2 Vitest Unit Tests (Hook Logic)
- [ ] 6.2.1 Test hook returns correct initial state (isExporting: false)
- [ ] 6.2.2 Test hook state transitions during export lifecycle
- [ ] 6.2.3 Test error handling for empty drawing array
- [ ] 6.2.4 Test error handling for storage access failures
- [ ] 6.2.5 Test batch processing logic for large datasets (mock)

### 6.3 Manual Integration Tests (UI & Browser)
- [ ] 6.3.1 Manual: Test export with empty gallery (should show appropriate message)
- [ ] 6.3.2 Manual: Test export with 1-5 drawings (basic functionality)
- [ ] 6.3.3 Manual: Test export with 20+ drawings (pagination scenario)
- [ ] 6.3.4 Manual: Test export with drawings containing embedded images
- [ ] 6.3.5 Manual: Verify ZIP structure matches spec (drawings/ folder, data.json)
- [ ] 6.3.6 Manual: Verify exported .excalidraw files import correctly to excalidraw.com
- [ ] 6.3.7 Manual: Test UI feedback (loading state, spinner icon, success/error toasts)
- [ ] 6.3.8 Manual: Verify memory cleanup (no leaks after export, check DevTools)
- [ ] 6.3.9 Manual: Test with special characters in drawing names (filesystem safety)
- [ ] 6.3.10 Manual: Test browser download trigger (file appears in Downloads folder)

## 7. Documentation
- [ ] 7.1 Add JSDoc comments to exported functions
- [ ] 7.2 Update README if needed to mention export feature
