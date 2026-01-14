# gallery-management Specification

## Purpose
TBD - created by archiving change add-gallery-export-to-zip. Update Purpose after archive.
## Requirements
### Requirement: Gallery Export to ZIP

The gallery sidebar SHALL provide a bulk export feature that allows users to export all drawings to a single ZIP archive containing standard `.excalidraw` files. The implementation SHALL use manual JSON assembly (reading directly from IndexedDB storage and transforming to Excalidraw format) rather than official export APIs to achieve optimal performance (< 1 second for typical galleries).

#### Scenario: Export all drawings successfully

- **WHEN** user clicks "Export Gallery" from the dropdown menu
- **AND** the gallery contains one or more drawings
- **THEN** the system SHALL generate a ZIP file containing all drawings in `.excalidraw` format
- **AND** the ZIP SHALL include a `data.json` metadata file with export timestamp, count, and version
- **AND** the ZIP SHALL be named `excalidraw-export-{timestamp}.zip` with ISO timestamp
- **AND** the browser SHALL automatically download the ZIP file
- **AND** a success toast SHALL display showing "Exported X drawings successfully"

#### Scenario: Export with empty gallery

- **WHEN** user clicks "Export Gallery" from the dropdown menu
- **AND** the gallery contains zero drawings
- **THEN** the system SHALL display an informational toast with message "No drawings to export"
- **AND** no ZIP file SHALL be created

#### Scenario: Export with loading state feedback

- **WHEN** user initiates export
- **THEN** the dropdown menu item SHALL show a spinner icon
- **AND** the menu item SHALL be disabled to prevent double-clicks
- **THEN** once export completes, the menu item SHALL return to normal state

#### Scenario: Export failure handling

- **WHEN** export process encounters an error (storage access failure, ZIP generation failure)
- **THEN** the system SHALL display an error toast with descriptive message
- **AND** the loading state SHALL be cleared
- **AND** the error SHALL be logged to console with full details

### Requirement: Excalidraw Format Compatibility

Exported `.excalidraw` files SHALL conform to the official Excalidraw JSON schema to ensure compatibility with excalidraw.com.

#### Scenario: Valid Excalidraw file structure

- **WHEN** a drawing is exported to ZIP
- **THEN** each `.excalidraw` file SHALL contain:
  - `type` field with value `"excalidraw"`
  - `version` field with value `2`
  - `source` field with application origin URL
  - `elements` array with parsed JSON elements
  - `appState` object with at least `viewBackgroundColor`, `theme`, and `gridSize`
  - `files` object with parsed JSON files data

#### Scenario: File name sanitization

- **WHEN** a drawing with special characters in name is exported
- **THEN** the filename SHALL replace invalid filesystem characters (`<>:"/\\|?*`) with underscores
- **AND** spaces SHALL be replaced with underscores
- **AND** the filename SHALL be converted to lowercase

### Requirement: ZIP Archive Structure

The exported ZIP archive SHALL follow a standardized structure for readability and machine parsing.

#### Scenario: ZIP contains drawings folder

- **WHEN** ZIP is generated
- **THEN** all `.excalidraw` files SHALL be placed in a `drawings/` subdirectory
- **AND** file names SHALL match sanitized drawing names with `.excalidraw` extension

#### Scenario: ZIP contains metadata file

- **WHEN** ZIP is generated
- **THEN** a `data.json` file SHALL be created at the root level
- **AND** the metadata SHALL include:
  - `exportedAt` - ISO 8601 timestamp string
  - `count` - number of drawings exported (integer)
  - `version` - export schema version string (e.g., "1.0.0")

### Requirement: Performance and Memory Management

Export operations SHALL be optimized to prevent UI blocking and memory issues, especially for large galleries.

#### Scenario: Batch processing for large datasets

- **WHEN** exporting 50 or more drawings
- **THEN** the system SHALL process drawings in batches of 50
- **AND** SHALL use `requestAnimationFrame` between batches to allow UI updates
- **AND** SHALL apply DEFLATE compression with level 6

#### Scenario: Memory cleanup after export

- **WHEN** export completes or fails
- **THEN** the system SHALL revoke any created object URLs via `URL.revokeObjectURL()`
- **AND** SHALL clear any temporary state variables

### Requirement: User Interface Integration

The export feature SHALL be integrated into the existing gallery sidebar dropdown menu as a new menu item.

#### Scenario: Export menu item placement

- **WHEN** user opens the save dropdown menu in gallery sidebar
- **THEN** an "Export Gallery" menu item SHALL appear below "Remove Unused Files"
- **AND** the item SHALL display a file-zip icon
- **AND** the item SHALL have a tooltip/hint explaining the feature

#### Scenario: Visual feedback during export

- **WHEN** export is in progress
- **THEN** the menu item icon SHALL change to a loading spinner
- **AND** the menu item SHALL be disabled
- **AND** the disabled state SHALL be visually indicated

### Requirement: Native Browser Download

The export feature SHALL use native browser Blob download API without external dependencies like file-saver. This approach is supported by all modern browsers (Chrome 52+, Firefox 20+, Safari 10+) and eliminates an unnecessary 4KB dependency.

#### Scenario: Download using native API

- **WHEN** ZIP blob is generated
- **THEN** the system SHALL create an object URL using `URL.createObjectURL(blob)`
- **AND** SHALL create a temporary `<a>` element with `download` attribute
- **AND** SHALL programmatically click the link to trigger download
- **AND** SHALL remove the temporary element from DOM
- **AND** SHALL revoke the object URL after download to prevent memory leaks

### Requirement: Data Transformation

Drawing data stored in IndexedDB SHALL be correctly transformed to Excalidraw format during export.

#### Scenario: Parse JSON fields correctly

- **WHEN** retrieving drawing data from IndexedDB
- **THEN** the system SHALL parse `elements` field from JSON string to array
- **AND** SHALL parse `appState` field from JSON string to object
- **AND** SHALL parse `files` field from JSON string to object
- **THEN** transformed data SHALL match Excalidraw schema requirements

#### Scenario: Handle missing optional fields

- **WHEN** a drawing lacks optional appState fields
- **THEN** the system SHALL provide defaults:
  - `viewBackgroundColor` defaults to `"#ffffff"`
  - `theme` defaults to `"light"`
  - `gridSize` defaults to `null`

