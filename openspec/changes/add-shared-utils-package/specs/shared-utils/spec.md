## ADDED Requirements
### Requirement: Shared Utilities Package

The system SHALL provide a dedicated `excali-shared` package that contains reusable utilities, types, and functions shared between `excali-page` and `excali-local` packages. The shared package SHALL be installed as a regular npm dependency (not via symlinks).

#### Scenario: Shared package structure
- **WHEN** the shared package is created at `packages/excali-shared`
- **THEN** it SHALL contain a `package.json` with appropriate configuration
- **AND** it SHALL export utilities from a main entry point (`src/index.ts`)
- **AND** it SHALL be buildable as a standalone TypeScript package

#### Scenario: Package exports utilities
- **WHEN** consumer packages import from `excali-shared`
- **THEN** the following utilities SHALL be available:
  - `cn()` - CSS class name merging function
  - `getBrowser()` - Browser runtime detection
  - `getLang()` - Language detection utility
  - `FontConfig` type definition
  - `PromiseWithResolver` utility pattern
  - Font injection utilities

### Requirement: CSS Class Name Merging

The shared package SHALL provide a `cn()` function that merges CSS class names using `clsx` and `tailwind-merge` libraries, ensuring proper Tailwind CSS class merging behavior.

#### Scenario: Merge class names
- **WHEN** `cn("px-2", "py-2", isActive && "bg-blue-500")` is called
- **THEN** it SHALL return a merged string with proper Tailwind merge behavior
- **AND** conflicting classes SHALL be handled correctly
- **AND** conditional classes SHALL be included when truthy

#### Scenario: Handle edge cases
- **WHEN** `cn(null, undefined, "", "valid-class")` is called
- **THEN** it SHALL filter out falsy values
- **AND** only valid class names SHALL be returned

### Requirement: Browser Runtime Detection

The shared package SHALL provide a `getBrowser()` function that detects the browser runtime environment, returning the appropriate browser API object.

#### Scenario: Detect Chrome browser
- **WHEN** running in Chrome extension context
- **THEN** `getBrowser()` SHALL return the `chrome` object
- **AND** the returned object SHALL have extension APIs available

#### Scenario: Detect Firefox browser
- **WHEN** running in Firefox extension context
- **THEN** `getBrowser()` SHALL return the `browser` object (Firefox's namespace)
- **AND** the returned object SHALL have extension APIs available

#### Scenario: No browser runtime available
- **WHEN** running in a regular web page context
- **THEN** `getBrowser()` SHALL return `null`
- **AND** consumer code SHALL handle this case gracefully

### Requirement: Language Detection

The shared package SHALL provide a `getLang()` function that detects the user's preferred language, supporting both browser extension i18n and web page language detection.

#### Scenario: Detect language from Chrome i18n
- **WHEN** running in Chrome extension context with i18n available
- **THEN** `getLang()` SHALL return `"zh-CN"` for Chinese or `"en"` for English

#### Scenario: Detect language from navigator
- **WHEN** running in web page context without i18n
- **THEN** `getLang()` SHALL use `navigator.language`
- **AND** SHALL map to `"zh-CN"` or `"en"` based on the value

### Requirement: Font Configuration Types

The shared package SHALL define TypeScript types for font configuration used by the editor's custom font injection system.

#### Scenario: FontConfig interface
- **WHEN** font configuration is needed
- **THEN** the `FontConfig` interface SHALL define:
  - `handwriting: string | null` - PostScript name for handwriting font replacement
  - `normal: string | null` - PostScript name for normal font replacement
  - `code: string | null` - PostScript name for code font replacement

### Requirement: Font Injection Utilities

The shared package SHALL provide utilities for injecting custom fonts into the Excalidraw editor, abstracting the communication with the extension's background script.

#### Scenario: Get font configuration
- **WHEN** `getFontConfig()` is called in extension context
- **THEN** it SHALL communicate with the background script via `chrome.runtime.sendMessage`
- **AND** it SHALL return a `FontConfig` object or `null` if unavailable

#### Scenario: Transform to Excalidraw format
- **WHEN** `transformToInitFontConfig(config)` is called
- **THEN** it SHALL convert `FontConfig` to Excalidraw's expected format
- **AND** each configured font SHALL be formatted as `local-font:{PostScriptName}`

#### Scenario: Inject custom fonts
- **WHEN** `injectCustomFonts()` is called
- **THEN** it SHALL retrieve the font configuration
- **AND** it SHALL transform it to Excalidraw format
- **AND** it SHALL return the formatted config for Excalidraw initialization
- **AND** it SHALL return `null` gracefully if no configuration is available

### Requirement: Promise Utility Pattern

The shared package SHALL provide a `PromiseWithResolver` utility that creates a promise with external resolve/reject functions.

#### Scenario: Create promise with resolvers
- **WHEN** `PromiseWithResolver<string>()` is called
- **THEN** it SHALL return an object with:
  - `promise: Promise<string>` - the promise to await
  - `resolve: (value: string) => void` - function to resolve the promise
  - `reject: (reason: any) => void` - function to reject the promise

#### Scenario: Use resolvers externally
- **WHEN** the returned object is used
- **THEN** calling `resolve(value)` SHALL fulfill the promise
- **AND** calling `reject(error)` SHALL reject the promise

## MODIFIED Requirements
### Requirement: Gallery Export to ZIP

The gallery export feature SHALL use shared utilities from the `excali-shared` package for CSS class merging and browser detection when applicable.

#### Scenario: Export uses shared utilities
- **WHEN** the gallery export feature is implemented
- **THEN** it SHALL use `cn()` from `excali-shared` for UI styling
- **AND** any browser detection SHALL use `getBrowser()` from `excali-shared`
