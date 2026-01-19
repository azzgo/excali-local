## ADDED Requirements

### Requirement: Font Source Type

The system SHALL support both system and custom font sources through a discriminated union type stored directly in the font configuration.

#### Scenario: System font source

- **WHEN** font source has type === 'system'
- **THEN** the postscriptName field SHALL contain the PostScript name of the installed font
- **AND** the data and family fields SHALL NOT be present
- **AND** the system SHALL use `local-font:{postscriptName}` URI format

#### Scenario: Custom font source

- **WHEN** font source has type === 'custom'
- **THEN** the data field SHALL contain the Uint8Array of the font binary
- **AND** the family field SHALL contain the font family name for registration
- **AND** the postscriptName field SHALL NOT be present

### Requirement: Font Configuration Storage

The system SHALL store font configuration (all three slots) in a single IndexedDB record for simplicity and data consistency.

#### Scenario: Store complete font configuration

- **WHEN** user saves font configuration
- **THEN** the system SHALL store a single record with key 'font-config'
- **AND** the record SHALL contain handwriting, normal, and code slots
- **AND** each slot SHALL contain a FontSource (system or custom or null)
- **AND** custom fonts SHALL have binary data embedded directly

#### Scenario: Retrieve complete font configuration

- **WHEN** system retrieves font configuration
- **THEN** the system SHALL return the complete configuration in a single query
- **AND** SHALL return null if no configuration exists
- **AND** binary data SHALL be returned as Uint8Array for serialization safety

#### Scenario: Overwrite single slot preserves other slots

- **WHEN** user changes only one font slot
- **THEN** the system SHALL merge the new value with existing slots
- **AND** unchanged slots SHALL remain unmodified
- **AND** binary data from removed custom fonts SHALL be garbage collected automatically

#### Scenario: Clear single font slot

- **WHEN** user clears a font slot
- **THEN** the slot SHALL be set to null
- **AND** no orphaned binary data SHALL remain

### Requirement: Font Slot Configuration UI

Each font slot (handwriting, normal, code) SHALL have independent mode switching between system and custom fonts.

#### Scenario: Configure handwriting slot with custom font

- **WHEN** user selects a custom font file for the handwriting slot
- **THEN** the slot configuration SHALL store { type: 'custom', family: 'FontName', data: Uint8Array }
- **AND** the excali-page SHALL load the font via FontFace API using the embedded data
- **AND** the slot mode SHALL persist as 'custom'

#### Scenario: Configure normal slot with system font

- **WHEN** user selects a system font for the normal slot
- **THEN** the slot configuration SHALL store { type: 'system', postscriptName: 'Arial' }
- **AND** the excalidraw SHALL use `local-font:Arial` URI format
- **AND** the slot mode SHALL persist as 'system'

#### Scenario: Switch slot from custom to system

- **WHEN** user changes a slot from custom mode to system mode
- **THEN** the custom font binary data SHALL be removed from that slot
- **AND** the slot SHALL store system font reference
- **AND** other slots SHALL be unaffected

#### Scenario: Switch slot from system to custom

- **WHEN** user changes a slot from system mode to custom mode
- **THEN** the system SHALL prompt for font file upload
- **AND** after file selection, the slot SHALL store custom font data
- **AND** previous system font reference SHALL be replaced

### Requirement: Font File Upload Validation

The system SHALL validate uploaded font files for format, size, and integrity.

#### Scenario: Accept valid font formats

- **WHEN** user uploads a file with extension .ttf, .otf, .woff, or .woff2
- **THEN** the system SHALL accept the file
- **AND** SHALL detect mime type: font/ttf, font/otf, font/woff, or font/woff2
- **AND** SHALL proceed with storage

#### Scenario: Reject invalid file types

- **WHEN** user uploads a file with extension other than .ttf, .otf, .woff, .woff2
- **THEN** the system SHALL reject the upload
- **AND** SHALL display error message "Unsupported font format"
- **AND** SHALL not modify IndexedDB

#### Scenario: Reject files exceeding size limit

- **WHEN** user uploads a font file larger than 30MB
- **THEN** the system SHALL reject the upload
- **AND** SHALL display error message "Font file too large (max 30MB)"
- **AND** SHALL not modify IndexedDB

### Requirement: FontFace API Integration

The system SHALL use the browser FontFace API to load custom fonts into excali-page from embedded binary data.

#### Scenario: Load custom font from configuration

- **WHEN** excali-page initializes with custom font configuration
- **THEN** the system SHALL retrieve the configuration from IndexedDB
- **AND** for each slot with type 'custom', SHALL create a FontFace object
- **AND** SHALL call fontFace.load() and await completion
- **AND** SHALL add the font to document.fonts
- **AND** the font SHALL be available for canvas/text rendering

#### Scenario: Handle font load failure

- **WHEN** font binary data is corrupt or incompatible
- **THEN** the FontFace.load() SHALL reject with an error
- **AND** the system SHALL log the error with font family name
- **AND** SHALL fall back to default font for that slot
- **AND** SHALL display warning toast to user

#### Scenario: Multiple custom fonts load concurrently

- **WHEN** multiple slots use different custom fonts
- **THEN** the system SHALL load all fonts in parallel using Promise.all
- **AND** SHALL await all fonts before completing excalidraw initialization
- **AND** total load time SHALL NOT exceed 500ms for typical font sizes (100KB-500KB)

#### Scenario: Custom font loads synchronously on configuration change

- **WHEN** user changes font configuration in options page
- **AND** the options page creates a new FontFace with the embedded data
- **THEN** the font SHALL be immediately available for preview
- **AND** the FontFace SHALL be added to document.fonts in options page context

### Requirement: IndexedDB Schema

The system SHALL use a simple IndexedDB schema with a single store for font configuration.

#### Scenario: Font configuration store structure

- **WHEN** IndexedDB is first accessed
- **THEN** the system SHALL create a store named 'fontConfig'
- **AND** the store SHALL use 'key' as the keyPath with constant value 'font-config'
- **AND** the store SHALL have a single record with interface FontConfigRecord
- **AND** the store SHALL NOT have indexes

#### Scenario: FontConfigRecord structure

- **WHEN** a record is stored
- **THEN** it SHALL match the following interface:
  ```typescript
  interface FontConfigRecord {
    key: 'font-config';
    handwriting: FontSource | null;
    normal: FontSource | null;
    code: FontSource | null;
  }
  ```
- **AND** FontSource SHALL be:
  ```typescript
  type FontSource =
    | { type: 'system'; postscriptName: string }
    | { type: 'custom'; family: string; data: Uint8Array };
  ```

### Requirement: Font Configuration Initialization

The excali-page font injector SHALL read font configuration directly from IndexedDB without background script communication.

#### Scenario: Font injector retrieves configuration

- **WHEN** injectCustomFonts() is called
- **THEN** the system SHALL read from IndexedDB directly (not via chrome.runtime.sendMessage)
- **AND** SHALL return the complete ExcalidrawFontConfig object
- **AND** system fonts SHALL use `local-font:{postscriptName}` format
- **AND** custom fonts SHALL be prepared for FontFace loading

#### Scenario: Options page saves configuration

- **WHEN** user saves font configuration
- **THEN** the options page SHALL write directly to IndexedDB
- **AND** SHALL update the 'font-config' record with all slots
- **AND** changes SHALL be immediately visible to excali-page on next load
