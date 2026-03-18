## ADDED Requirements

### Requirement: Gallery Import from ZIP
The gallery sidebar SHALL provide a ZIP import feature that restores drawings from previously exported gallery backup packages.

#### Scenario: User imports ZIP in append mode
- **WHEN** user clicks "Import Gallery" and selects a valid ZIP file
- **AND** user keeps default mode "Append Import"
- **THEN** the system SHALL keep existing gallery data
- **AND** SHALL add drawings from the ZIP as new drawings
- **AND** SHALL show success/failure import feedback

#### Scenario: User imports ZIP in overwrite mode
- **WHEN** user selects mode "Overwrite Restore" and confirms import
- **THEN** the system SHALL clear drawings, collections, and files stores before import
- **AND** SHALL import drawings from the selected ZIP
- **AND** SHALL refresh gallery list after import completes

#### Scenario: Import old ZIP without metadata
- **WHEN** selected ZIP contains `.excalidraw` files but lacks `data.json`
- **THEN** the system SHALL import drawings from file contents only
- **AND** SHALL not fail due to missing metadata

#### Scenario: Import ZIP with collection metadata
- **WHEN** selected ZIP includes collection metadata in `data.json`
- **THEN** the system SHALL restore collections
- **AND** SHALL restore drawing-to-collection relationships for imported drawings

#### Scenario: Invalid ZIP content handling
- **WHEN** selected ZIP has no valid `.excalidraw` files
- **THEN** the system SHALL show an error toast
- **AND** SHALL not mutate existing gallery data

## MODIFIED Requirements

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
- **AND** metadata MAY include collection data and drawing mapping data for import restore
