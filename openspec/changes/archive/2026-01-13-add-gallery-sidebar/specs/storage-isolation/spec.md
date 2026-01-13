## ADDED Requirements

### Requirement: Independent Storage Systems
The system SHALL maintain two completely independent storage systems for workspace and Gallery.

#### Scenario: Auto-save workspace isolation
- **GIVEN** the user is editing on the canvas
- **WHEN** the auto-save handler triggers (every 50ms debounce)
- **THEN** it SHALL save to localStorage keys (`"excalidraw"`, `"excalidraw-state"`)
- **AND** it SHALL save files to the `files` IndexedDB store
- **AND** it SHALL NOT modify any records in the `drawings` IndexedDB store

#### Scenario: Gallery explicit save isolation
- **GIVEN** the user clicks "Save" in the Gallery sidebar
- **WHEN** the save operation executes
- **THEN** it SHALL save to the `drawings` IndexedDB store
- **AND** it SHALL NOT modify localStorage workspace keys
- **AND** it SHALL NOT affect the auto-save behavior

#### Scenario: Loaded drawing tracking
- **GIVEN** a user loads a drawing from the Gallery
- **WHEN** the drawing is applied to the canvas
- **THEN** the system SHALL store the drawing ID in `currentLoadedDrawingIdAtom` (memory-only)
- **AND** subsequent edits SHALL continue auto-saving to localStorage
- **AND** the Gallery drawing SHALL remain unchanged until explicit save

### Requirement: Workspace Auto-save Behavior
The system SHALL maintain existing auto-save functionality without modification.

#### Scenario: Continued auto-save operation
- **GIVEN** the Gallery feature is enabled
- **WHEN** the user makes changes to the canvas
- **THEN** the auto-save handler SHALL continue to execute as before
- **AND** it SHALL debounce at 50ms
- **AND** it SHALL save elements to localStorage `KeyForElements`
- **AND** it SHALL save appState to localStorage `KeyForAppState`
- **AND** it SHALL save files to the `files` IndexedDB store using `batchSaveFile()`

#### Scenario: Auto-save persistence scope
- **GIVEN** the user is working on any canvas (new, loaded from Gallery, or existing)
- **WHEN** the auto-save triggers
- **THEN** it SHALL save the current canvas state as the "working canvas"
- **AND** this working canvas SHALL be restored on next application load
- **AND** it SHALL NOT be associated with any Gallery drawing

### Requirement: Gallery Explicit Save Behavior
The system SHALL only modify Gallery drawings via explicit user action.

#### Scenario: Save current canvas as new drawing
- **GIVEN** `currentLoadedDrawingIdAtom` is null (no Gallery drawing loaded)
- **WHEN** the user clicks "Save" in Gallery
- **THEN** the system SHALL read `excalidrawAPI.getSceneElements()`
- **AND** it SHALL read `excalidrawAPI.getAppState()`
- **AND** it SHALL read `excalidrawAPI.getFiles()`
- **AND** it SHALL call `saveDrawing()` with this data
- **AND** it SHALL set `currentLoadedDrawingIdAtom` to the new drawing ID

#### Scenario: Update existing Gallery drawing
- **GIVEN** `currentLoadedDrawingIdAtom` contains a drawing ID
- **WHEN** the user clicks "Save" (and chooses "Overwrite")
- **THEN** the system SHALL read current canvas state from `excalidrawAPI`
- **AND** it SHALL call `updateDrawing(currentLoadedDrawingIdAtom, data)`
- **AND** the Gallery drawing SHALL be updated in IndexedDB
- **AND** `currentLoadedDrawingIdAtom` SHALL remain unchanged

### Requirement: Loading Gallery Drawings
The system SHALL load Gallery drawings into the canvas without affecting auto-save.

#### Scenario: Load drawing from Gallery
- **GIVEN** a user clicks a drawing card in the Gallery
- **WHEN** the load operation executes
- **THEN** the system SHALL call `excalidrawAPI.updateScene({ elements, appState })`
- **AND** it SHALL call `excalidrawAPI.addFiles(drawing.files)`
- **AND** it SHALL set `currentLoadedDrawingIdAtom` to the drawing ID
- **AND** the canvas SHALL display the loaded drawing

#### Scenario: Auto-save after loading Gallery drawing
- **GIVEN** a Gallery drawing is loaded (tracked by `currentLoadedDrawingIdAtom`)
- **WHEN** the user makes edits and auto-save triggers
- **THEN** the auto-save SHALL save to localStorage/files store as normal
- **AND** the Gallery drawing in the `drawings` store SHALL remain unchanged
- **AND** `currentLoadedDrawingIdAtom` SHALL remain set

#### Scenario: Unsaved changes warning
- **GIVEN** the user has made edits to the canvas (auto-saved to workspace)
- **AND** `currentLoadedDrawingIdAtom` is set (indicating a Gallery drawing is loaded)
- **WHEN** the user attempts to load a different Gallery drawing
- **THEN** the system SHALL detect workspace changes differ from loaded Gallery drawing
- **AND** it SHALL prompt "You have unsaved changes. Discard changes and load?"
- **AND** if confirmed, it SHALL load the new drawing
- **AND** if cancelled, it SHALL abort the load operation

### Requirement: Storage Separation Mental Model
The system SHALL clearly communicate the separation between workspace and Gallery to users.

#### Scenario: User understanding of auto-save
- **GIVEN** the user is working on the canvas
- **WHEN** observing the application behavior
- **THEN** the auto-save SHALL continue to persist the "working canvas" automatically
- **AND** this working canvas SHALL be restored on next session
- **AND** it SHALL be independent of Gallery drawings

#### Scenario: User understanding of Gallery save
- **GIVEN** the user loads a Gallery drawing and makes edits
- **WHEN** observing the application behavior
- **THEN** the edits SHALL not be reflected in the Gallery until "Save" is clicked
- **AND** the user can revert by reloading the original Gallery drawing
- **AND** the user can save edits as a new drawing or overwrite the original

### Requirement: Files Store Sharing
The system SHALL share the `files` IndexedDB store between workspace and Gallery while maintaining isolation.

#### Scenario: File storage for auto-save
- **GIVEN** the user adds an image to the canvas
- **WHEN** auto-save triggers
- **THEN** the file SHALL be saved to the `files` store using `batchSaveFile()`
- **AND** the file reference SHALL be stored in localStorage metadata

#### Scenario: File storage for Gallery drawings
- **GIVEN** the user saves a drawing to Gallery that contains files
- **WHEN** the save operation executes
- **THEN** the files SHALL already be in the `files` store (from auto-save or previous saves)
- **AND** the drawing record SHALL store file metadata (references)
- **AND** it SHALL NOT duplicate file data

#### Scenario: File cleanup considerations
- **GIVEN** files are shared between workspace and Gallery
- **WHEN** the cleanup process runs
- **THEN** it SHALL identify files referenced by either workspace OR any Gallery drawing
- **AND** it SHALL only delete files referenced by neither
- **AND** it SHALL NOT delete files currently in use

### Requirement: Canvas State Transitions
The system SHALL handle transitions between different canvas states correctly.

#### Scenario: New canvas creation
- **GIVEN** the user wants to start a new drawing
- **WHEN** clearing the canvas or creating new
- **THEN** `currentLoadedDrawingIdAtom` SHALL be reset to null
- **AND** subsequent saves SHALL create a new Gallery drawing

#### Scenario: Switching between Gallery drawings
- **GIVEN** a Gallery drawing is loaded
- **WHEN** the user loads a different Gallery drawing
- **THEN** `currentLoadedDrawingIdAtom` SHALL update to the new drawing ID
- **AND** workspace auto-save SHALL continue independently

#### Scenario: Reloading workspace after application restart
- **GIVEN** the user closes and reopens the application
- **WHEN** the application initializes
- **THEN** it SHALL load the workspace canvas from localStorage/files store
- **AND** `currentLoadedDrawingIdAtom` SHALL be null (not persisted)
- **AND** the user starts in workspace mode, not Gallery mode
