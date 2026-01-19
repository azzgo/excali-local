## 1. Shared Utilities Implementation
- [x] 1.1 Add FontSource and FontConfig types to types.ts (system/custom union)
- [x] 1.2 Implement IndexedDB schema (single store 'fontConfig') in db.ts
- [x] 1.3 Add getFontConfig() and saveFontConfig() operations
- [x] 1.4 Add clearFontSlot() helper for resetting individual slots
- [x] 1.5 Export types and utilities from shared package index.ts

## 2. Font Injection in excali-page
- [x] 2.1 Update font-injector.ts to load font configuration from IndexedDB directly
- [x] 2.2 Implement FontFace API integration for custom fonts (embedded Uint8Array)
- [x] 2.3 Handle font loading errors with fallback to system fonts
- [x] 2.4 Support concurrent loading of multiple custom fonts

## 3. Options Page Components
- [x] 3.1 Create FontSlot.tsx component with system/custom toggle per slot
- [x] 3.2 Create CustomFontUpload.tsx for file upload with validation
- [x] 3.3 Implement file validation (.ttf, .otf, .woff, .woff2, 30MB limit)
- [x] 3.4 Implement FileReader to ArrayBuffer → Uint8Array conversion
- [x] 3.5 Integrate components into App.tsx with save/load logic

## 4. Storage Integration
- [x] 4.1 Store complete font configuration (handwriting/normal/code) in one record
- [x] 4.2 Embed custom font binary data directly in configuration
- [x] 4.3 Handle configuration merge when updating single slot

## 5. Testing and Validation
- [x] 5.1 Test file upload with various font formats (.ttf, .otf, .woff, .woff2)
- [x] 5.2 Verify custom font rendering in excali-page via FontFace API
- [x] 5.3 Test system font vs custom font switching per slot
- [x] 5.4 Validate IndexedDB access from both excali-page and options contexts
- [x] 5.5 Test file size limit rejection (30MB)
