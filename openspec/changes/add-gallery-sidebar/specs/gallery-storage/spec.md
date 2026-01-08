## ADDED Requirements

### Requirement: IndexedDB Database Schema
The system SHALL maintain an IndexedDB database named `excali` at version 2 with three object stores for persistent drawing storage.

#### Scenario: Database upgrade from v1 to v2
- **GIVEN** a user has an existing v1 database with a `files` object store
- **WHEN** the application initializes the database
- **THEN** the database SHALL upgrade to v2
- **AND** the existing `files` store SHALL remain unchanged
- **AND** a new `drawings` object store SHALL be created
- **AND** a new `collections` object store SHALL be created

#### Scenario: Drawings object store structure
- **GIVEN** the database is at version 2
- **WHEN** querying the `drawings` object store schema
- **THEN** it SHALL use `id` (string, UUID) as the keyPath
- **AND** it SHALL have an index on `updatedAt` for sorting
- **AND** it SHALL have a multiEntry index on `collectionIds` for collection filtering

#### Scenario: Collections object store structure
- **GIVEN** the database is at version 2
- **WHEN** querying the `collections` object store schema
- **THEN** it SHALL use `id` (string, UUID) as the keyPath
- **AND** it SHALL have an index on `createdAt` for sorting

### Requirement: Drawing Data Model
The system SHALL store drawings with complete canvas state and metadata.

#### Scenario: Drawing record structure
- **GIVEN** a user saves a drawing
- **WHEN** the drawing is persisted to IndexedDB
- **THEN** it SHALL include a UUID `id` field
- **AND** it SHALL include a `name` field (user-defined or auto-generated)
- **AND** it SHALL include a `thumbnail` field (DataURL in WebP format)
- **AND** it SHALL include an `elements` array (ExcalidrawElement[])
- **AND** it SHALL include an `appState` object (Partial<AppState>)
- **AND** it SHALL include a `files` object (BinaryFiles metadata)
- **AND** it SHALL include a `collectionIds` array (string[])
- **AND** it SHALL include a `createdAt` timestamp
- **AND** it SHALL include an `updatedAt` timestamp

### Requirement: Collection Data Model
The system SHALL store collection metadata for organizing drawings into groups.

#### Scenario: Collection record structure
- **GIVEN** a user creates a collection
- **WHEN** the collection is persisted to IndexedDB
- **THEN** it SHALL include a UUID `id` field
- **AND** it SHALL include a `name` field (display name)
- **AND** it SHALL include a `createdAt` timestamp

#### Scenario: Drawing-to-collection relationship
- **GIVEN** multiple drawings are assigned to a collection
- **WHEN** querying drawings by collection
- **THEN** the system SHALL use the `collectionIds` index on the drawings store
- **AND** it SHALL NOT maintain a separate `drawingIds` array in the collection record

### Requirement: Drawing CRUD Operations
The system SHALL provide functions for creating, reading, updating, and deleting drawings.

#### Scenario: Save new drawing
- **GIVEN** a user has canvas content and provides a name
- **WHEN** calling `saveDrawing(data, name, collectionIds)`
- **THEN** the system SHALL generate a UUID for the drawing
- **AND** it SHALL generate a thumbnail from the canvas
- **AND** it SHALL persist the drawing to the `drawings` store
- **AND** it SHALL return the generated drawing ID

#### Scenario: Update existing drawing
- **GIVEN** a user modifies a loaded drawing
- **WHEN** calling `updateDrawing(id, data)`
- **THEN** the system SHALL update the drawing record with the provided ID
- **AND** it SHALL regenerate the thumbnail if canvas changed
- **AND** it SHALL update the `updatedAt` timestamp

#### Scenario: Load drawings with filtering
- **GIVEN** a user wants to view drawings
- **WHEN** calling `getDrawings({ collectionId, search })`
- **THEN** the system SHALL query the `drawings` store
- **AND** if `collectionId` is provided, it SHALL filter by the `collectionIds` index
- **AND** if `search` is provided, it SHALL filter by matching `name` field
- **AND** it SHALL return drawings sorted by `updatedAt` descending

#### Scenario: Delete drawing
- **GIVEN** a user wants to remove a drawing
- **WHEN** calling `deleteDrawing(id)`
- **THEN** the system SHALL remove the drawing from the `drawings` store
- **AND** it SHALL NOT delete associated files from the `files` store (handled by cleanup)

### Requirement: Collection CRUD Operations
The system SHALL provide functions for creating and reading collections.

#### Scenario: Create new collection
- **GIVEN** a user provides a collection name
- **WHEN** calling `createCollection(name)`
- **THEN** the system SHALL generate a UUID for the collection
- **AND** it SHALL persist the collection to the `collections` store
- **AND** it SHALL return the created Collection object

#### Scenario: Load all collections
- **GIVEN** a user wants to view available collections
- **WHEN** calling `getCollections()`
- **THEN** the system SHALL return all collections sorted by `createdAt` descending

### Requirement: Thumbnail Generation
The system SHALL generate compressed thumbnail images for visual preview of drawings.

#### Scenario: Generate thumbnail on save
- **GIVEN** a user saves a drawing with canvas content
- **WHEN** the thumbnail generation process runs
- **THEN** the system SHALL use Excalidraw's `exportToBlob` utility
- **AND** it SHALL export in `image/webp` format
- **AND** it SHALL use quality 0.5 for compression
- **AND** it SHALL set a fixed height of 200px (width auto)
- **AND** it SHALL convert the blob to a DataURL for storage

#### Scenario: Thumbnail size constraint
- **GIVEN** a complex drawing with many elements
- **WHEN** generating the thumbnail
- **THEN** the resulting thumbnail SHALL be under 50KB
- **AND** if exceeding 50KB, the system SHALL log a warning (but still save)

### Requirement: File Cleanup
The system SHALL provide a background process to remove orphaned files from the `files` store.

#### Scenario: Automatic cleanup on startup
- **GIVEN** the application starts
- **WHEN** the last cleanup was more than 24 hours ago
- **THEN** the system SHALL schedule a cleanup task using `requestIdleCallback`
- **AND** it SHALL identify files not referenced by any drawing or current workspace
- **AND** it SHALL delete orphaned files in batches
- **AND** it SHALL log cleanup statistics

#### Scenario: Workspace protection during cleanup
- **GIVEN** the cleanup process is running
- **WHEN** identifying orphaned files
- **THEN** the system SHALL exclude files referenced in localStorage workspace
- **AND** it SHALL exclude files referenced by any drawing in the `drawings` store

#### Scenario: Manual cleanup trigger
- **GIVEN** a user wants to free up storage
- **WHEN** the user triggers manual cleanup (future enhancement)
- **THEN** the system SHALL run the cleanup algorithm immediately
- **AND** it SHALL report the amount of storage freed
