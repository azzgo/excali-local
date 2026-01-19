## 1. Create Shared Package Structure
- [x] 1.1 Create `packages/excali-shared/package.json` with appropriate configuration
- [x] 1.2 Create `packages/excali-shared/tsconfig.json` for TypeScript compilation
- [x] 1.3 Create `packages/excali-shared/src/index.ts` as main entry point

## 2. Implement Shared Utilities
- [x] 2.1 Implement `cn()` function for CSS class name merging
- [x] 2.2 Implement `getBrowser()` browser detection utility
- [x] 2.3 Implement `getLang()` language detection utility
- [x] 2.4 Define `FontConfig` type and interfaces
- [x] 2.5 Implement `PromiseWithResolver` utility pattern
- [x] 2.6 Implement font injection utilities (`getFontConfig`, `transformToInitFontConfig`, `injectCustomFonts`)

## 3. Update excali-page Package
- [x] 3.1 Add `excali-shared` dependency to `packages/excali-page/package.json`
- [x] 3.2 Update `packages/excali-page/src/lib/utils.ts` to re-export from shared
- [x] 3.3 Update `packages/excali-page/src/lib/font-injector.ts` to use shared types
- [x] 3.4 Remove duplicate utility code from excali-page
- [x] 3.5 Run tests to verify functionality

## 4. Update excali-local Package
- [x] 4.1 Add `excali-shared` dependency to `packages/excali-local/package.json`
- [x] 4.2 Update `packages/excali-local/entrypoints/lib/utils.ts` to re-export from shared
- [x] 4.3 Remove duplicate utility code from excali-local
- [x] 4.4 Verify extension still builds correctly

## 5. Validation
- [x] 5.1 Run `bun run page:build` to verify editor builds
- [x] 5.2 Run `bun run local:build` to verify extension builds
- [x] 5.3 Run page tests: `bun run page:test`
- [x] 5.4 Test extension in browser development mode
- [x] 5.5 Verify no regression in gallery export functionality
