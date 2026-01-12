## ADDED Requirements

### Requirement: Lazy Drawing Data Loading
The system SHALL separate drawing metadata from full drawing data to optimize gallery list performance by loading only metadata until a drawing is explicitly loaded to canvas.

#### Scenario: Gallery list loads metadata only
- **GIVEN** a user opens the gallery sidebar with 50+ saved drawings
- **WHEN** the gallery list is populated
- **THEN** the system SHALL call `getDrawings()` which returns only metadata fields
- **AND** metadata fields SHALL include: id, name, thumbnail, collectionIds, createdAt, updatedAt
- **AND** metadata SHALL NOT include: elements, appState, files
- **AND** the gallery list SHALL render without parsing any JSON canvas data

#### Scenario: Canvas load triggers full data fetch
- **GIVEN** a user clicks on a drawing card in the gallery
- **WHEN** the drawing is loaded to canvas
- **THEN** the system SHALL call `getDrawingFullData(drawingId)` to fetch the complete drawing
- **AND** full data SHALL include: id, elements, appState, files
- **AND** the system SHALL parse elements, appState, and files JSON strings
- **AND** the system SHALL apply the data to the Excalidraw canvas via `excalidrawAPI.updateScene()` and `excalidrawAPI.addFiles()`

#### Scenario: Save operation stores complete data structure
- **GIVEN** a user saves or updates a drawing
- **WHEN** `saveDrawing()` or `updateDrawing()` is called
- **THEN** the system SHALL continue storing all fields (metadata + full data) in IndexedDB
- **AND** the database schema SHALL remain unchanged (no migration required)
- **AND** future queries SHALL be able to selectively retrieve metadata or full data

### Requirement: Drawing Metadata Interface
The system SHALL define a new TypeScript interface for drawing metadata separate from the full Drawing interface.

#### Scenario: DrawingMetadata type definition
- **GIVEN** the codebase uses TypeScript for type safety
- **WHEN** defining the drawing data structures
- **THEN** a new `DrawingMetadata` interface SHALL be exported from `indexdb.ts`
- **AND** `DrawingMetadata` SHALL include: id, name, thumbnail, collectionIds, createdAt, updatedAt
- **AND** the existing `Drawing` interface SHALL remain unchanged and include all fields
- **AND** gallery components SHALL use `DrawingMetadata` type for list display

#### Scenario: Type safety in gallery components
- **GIVEN** gallery components receive drawing data
- **WHEN** rendering the drawing list
- **THEN** components SHALL accept `DrawingMetadata[]` type for list props
- **AND** TypeScript SHALL prevent accessing elements, appState, or files fields in gallery UI
- **AND** only the `handleLoad` function SHALL accept or fetch full `Drawing` type

### Requirement: Full Drawing Data Fetch Function
The system SHALL provide a function to fetch complete drawing data by ID for canvas loading operations.

#### Scenario: Fetch single drawing with full data
- **GIVEN** a user wants to load a specific drawing to canvas
- **WHEN** calling `getDrawingFullData(drawingId)`
- **THEN** the system SHALL query IndexedDB for the drawing with the provided ID
- **AND** it SHALL return an object containing: id, elements, appState, files
- **AND** it SHALL NOT include thumbnail, collectionIds, or timestamps (not needed for canvas)
- **AND** if the drawing is not found, it SHALL throw an error

#### Scenario: Error handling for missing drawing
- **GIVEN** a drawing ID that does not exist in the database
- **WHEN** calling `getDrawingFullData(invalidId)`
- **THEN** the system SHALL throw an error with message "Drawing not found"
- **AND** the calling code SHALL handle the error and display a toast notification to the user

### Requirement: Files-Only Drawing Data Fetch
The system SHALL provide a function to fetch only the files field from all drawings for file cleanup operations.

#### Scenario: Fetch drawing IDs and files for cleanup
- **GIVEN** the file cleanup process needs to identify orphaned files
- **WHEN** calling `getDrawingsFilesOnly()`
- **THEN** the system SHALL query IndexedDB for all drawings
- **AND** it SHALL return an array of objects containing only: id, files
- **AND** it SHALL NOT include elements, appState, thumbnail, or other fields
- **AND** the cleanup process SHALL parse the files field to extract file IDs

## MODIFIED Requirements

### Requirement: Drawing CRUD Operations
The system SHALL provide functions for creating, reading, updating, and deleting drawings, with optimized data fetching for different use cases.

#### Scenario: Save new drawing
- **GIVEN** a user has canvas content and provides a name
- **WHEN** calling `saveDrawing(data, name, collectionIds)`
- **THEN** the system SHALL generate a UUID for the drawing
- **AND** it SHALL generate a thumbnail from the canvas
- **AND** it SHALL persist the complete drawing (metadata + full data) to the `drawings` store
- **AND** it SHALL return the generated drawing ID

#### Scenario: Update existing drawing
- **GIVEN** a user modifies a loaded drawing
- **WHEN** calling `updateDrawing(id, data)`
- **THEN** the system SHALL update the drawing record with the provided ID
- **AND** it SHALL regenerate the thumbnail if canvas changed
- **AND** it SHALL update the `updatedAt` timestamp
- **AND** it SHALL persist all fields (metadata + full data)

#### Scenario: Load drawings with metadata only (MODIFIED)
- **GIVEN** a user wants to view the gallery list
- **WHEN** calling `getDrawings({ collectionId, search })`
- **THEN** the system SHALL query the `drawings` store
- **AND** if `collectionId` is provided, it SHALL filter by the `collectionIds` index
- **AND** if `search` is provided, it SHALL filter by matching `name` field
- **AND** it SHALL return **metadata only** (id, name, thumbnail, collectionIds, createdAt, updatedAt)
- **AND** it SHALL NOT include elements, appState, or files fields
- **AND** it SHALL return drawings sorted by `updatedAt` descending

#### Scenario: Load single drawing with full data (NEW)
- **GIVEN** a user clicks to load a drawing to canvas
- **WHEN** calling `getDrawingFullData(drawingId)`
- **THEN** the system SHALL query the `drawings` store for the specific ID
- **AND** it SHALL return full data fields (id, elements, appState, files)
- **AND** it SHALL NOT include metadata fields (thumbnail, collectionIds, timestamps)

#### Scenario: Delete drawing
- **GIVEN** a user wants to remove a drawing
- **WHEN** calling `deleteDrawing(id)`
- **THEN** the system SHALL remove the drawing from the `drawings` store
- **AND** it SHALL NOT delete associated files from the `files` store (handled by cleanup)

### Requirement: File Cleanup
The system SHALL provide a background process to remove orphaned files from the `files` store, optimized to fetch only necessary data.

#### Scenario: Automatic cleanup on startup (MODIFIED)
- **GIVEN** the application starts
- **WHEN** the last cleanup was more than 24 hours ago
- **THEN** the system SHALL schedule a cleanup task using `requestIdleCallback`
- **AND** it SHALL call `getDrawingsFilesOnly()` to retrieve only id and files fields
- **AND** it SHALL identify files not referenced by any drawing or current workspace
- **AND** it SHALL delete orphaned files in batches
- **AND** it SHALL log cleanup statistics

#### Scenario: Workspace protection during cleanup
- **GIVEN** the cleanup process is running
- **WHEN** identifying orphaned files
- **THEN** the system SHALL exclude files referenced in localStorage workspace
- **AND** it SHALL exclude files referenced by any drawing in the `drawings` store
- **AND** it SHALL parse files JSON only for drawings returned by `getDrawingsFilesOnly()`
