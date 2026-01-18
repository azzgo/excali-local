## 1. Create Shared Package Structure
- [ ] 1.1 Create `packages/excali-shared/package.json` with appropriate configuration
- [ ] 1.2 Create `packages/excali-shared/tsconfig.json` for TypeScript compilation
- [ ] 1.3 Create `packages/excali-shared/src/index.ts` as main entry point

## 2. Implement Shared Utilities
- [ ] 2.1 Implement `cn()` function for CSS class name merging
- [ ] 2.2 Implement `getBrowser()` browser detection utility
- [ ] 2.3 Implement `getLang()` language detection utility
- [ ] 2.4 Define `FontConfig` type and interfaces
- [ ] 2.5 Implement `PromiseWithResolver` utility pattern
- [ ] 2.6 Implement font injection utilities (`getFontConfig`, `transformToInitFontConfig`, `injectCustomFonts`)

## 3. Update excali-page Package
- [ ] 3.1 Add `excali-shared` dependency to `packages/excali-page/package.json`
- [ ] 3.2 Update `packages/excali-page/src/lib/utils.ts` to re-export from shared
- [ ] 3.3 Update `packages/excali-page/src/lib/font-injector.ts` to use shared types
- [ ] 3.4 Remove duplicate utility code from excali-page
- [ ] 3.5 Run tests to verify functionality

## 4. Update excali-local Package
- [ ] 4.1 Add `excali-shared` dependency to `packages/excali-local/package.json`
- [ ] 4.2 Update `packages/excali-local/entrypoints/lib/utils.ts` to re-export from shared
- [ ] 4.3 Remove duplicate utility code from excali-local
- [ ] 4.4 Verify extension still builds correctly

## 5. Validation
- [ ] 5.1 Run `bun run page:build` to verify editor builds
- [ ] 5.2 Run `bun run local:build` to verify extension builds
- [ ] 5.3 Run page tests: `bun run page:test`
- [ ] 5.4 Test extension in browser development mode
- [ ] 5.5 Verify no regression in gallery export functionality
