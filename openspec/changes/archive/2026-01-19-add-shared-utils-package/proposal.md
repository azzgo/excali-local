# Change: Add Shared Utilities Package

## Why
Currently, `excali-page` and `excali-local` packages contain duplicated utility code:
- `cn()` function for CSS class name merging (duplicate in both packages)
- Browser detection utilities
- Font injection logic (partial overlap)
- Type definitions for shared interfaces

This duplication increases maintenance burden and risks inconsistencies between packages. Creating a dedicated shared package will:
- Eliminate code duplication
- Ensure consistent behavior across both packages
- Simplify future updates to shared utilities
- Provide a clear dependency path without using symlinks

## What Changes
- **NEW**: Create `packages/excali-shared` package containing:
  - `cn()` - CSS class name merging utility
  - `getBrowser()` - Browser detection utility
  - `getLang()` - Language detection utility
  - `FontConfig` type and font injection utilities
  - Shared type definitions
  - `PromiseWithResolver` pattern
- **MODIFIED**: `packages/excali-page` to depend on `excali-shared`
- **MODIFIED**: `packages/excali-local` to depend on `excali-shared`
- **REMOVED**: Duplicate utility code from both packages

## Impact
- Affected specs: `gallery-management` (indirect - shared utilities used by gallery features)
- Affected code:
  - `packages/excali-page/src/lib/utils.ts` → refactor to re-export from shared
  - `packages/excali-page/src/lib/font-injector.ts` → refactor to use shared types
  - `packages/excali-local/entrypoints/lib/utils.ts` → refactor to re-export from shared
- No breaking changes to user-facing functionality
- Build configuration updates required for both packages
