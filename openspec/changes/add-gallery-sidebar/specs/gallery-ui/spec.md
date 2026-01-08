## ADDED Requirements

### Requirement: Gallery Sidebar Component
The system SHALL provide a sidebar component for browsing and managing saved drawings.

#### Scenario: Sidebar integration in editors
- **GIVEN** the user is in LocalEditor or QuickMarkerEditor
- **WHEN** the component tree renders
- **THEN** the GallerySidebar SHALL be included as a child of the Excalidraw component
- **AND** it SHALL use the Excalidraw `Sidebar` wrapper component
- **AND** it SHALL be accessible via the sidebar toggle UI

#### Scenario: Sidebar structure
- **GIVEN** the Gallery sidebar is open
- **WHEN** viewing the sidebar
- **THEN** it SHALL display a header with the title "Gallery" (i18n key)
- **AND** it SHALL include a save button in the header
- **AND** it SHALL include a collection filter dropdown
- **AND** it SHALL include a search bar
- **AND** it SHALL display a scrollable list of drawing cards

#### Scenario: Docked mode behavior
- **GIVEN** the Gallery sidebar is docked
- **WHEN** the sidebar docks
- **THEN** the system SHALL enable Excalidraw's zen mode
- **AND** when the sidebar undocks, it SHALL disable zen mode

### Requirement: Drawing Card Component
The system SHALL display individual drawings as thumbnail cards with metadata.

#### Scenario: Card visual structure
- **GIVEN** a drawing exists in the Gallery
- **WHEN** displaying the drawing card
- **THEN** it SHALL show a thumbnail image (200px height, auto width)
- **AND** it SHALL show the drawing name
- **AND** it SHALL show the last updated timestamp (relative format)
- **AND** it SHALL show collection badges if assigned to collections

#### Scenario: Card interaction - Load drawing
- **GIVEN** a drawing card is displayed
- **WHEN** the user clicks on the card
- **THEN** the system SHALL check for unsaved changes in the current canvas
- **AND** if unsaved changes exist, it SHALL prompt the user for confirmation
- **AND** if confirmed or no changes, it SHALL load the drawing into the canvas
- **AND** it SHALL update `currentLoadedDrawingIdAtom` with the drawing ID

#### Scenario: Card interaction - Delete drawing
- **GIVEN** a drawing card is displayed
- **WHEN** the user triggers delete (right-click menu or button)
- **THEN** the system SHALL prompt for confirmation
- **AND** if confirmed, it SHALL delete the drawing from IndexedDB
- **AND** it SHALL refresh the drawings list
- **AND** if the deleted drawing is currently loaded, it SHALL clear `currentLoadedDrawingIdAtom`

### Requirement: Save Dialog Component
The system SHALL provide a dialog for saving canvas content to the Gallery.

#### Scenario: Save new drawing
- **GIVEN** the current canvas is not a loaded Gallery drawing
- **WHEN** the user clicks the save button
- **THEN** the system SHALL open a "Save As" dialog
- **AND** it SHALL provide a name input field (pre-filled with auto-generated name)
- **AND** it SHALL provide a collection selector (multi-select)
- **AND** when confirmed, it SHALL save the drawing and update `currentLoadedDrawingIdAtom`

#### Scenario: Update existing drawing
- **GIVEN** the current canvas is a loaded Gallery drawing (tracked by `currentLoadedDrawingIdAtom`)
- **WHEN** the user clicks the save button
- **THEN** the system SHALL open a dialog with two options
- **AND** option 1 SHALL be "Overwrite [Drawing Name]"
- **AND** option 2 SHALL be "Save as New"
- **AND** if "Overwrite" selected, it SHALL update the existing drawing
- **AND** if "Save as New" selected, it SHALL create a new drawing and update `currentLoadedDrawingIdAtom`

### Requirement: Search Bar Component
The system SHALL provide real-time search filtering for drawings by name.

#### Scenario: Search input
- **GIVEN** the Gallery sidebar is open
- **WHEN** the user types in the search input
- **THEN** the system SHALL update `searchQueryAtom` on each keystroke
- **AND** the drawings list SHALL re-filter to show only matching names

#### Scenario: Search matching behavior
- **GIVEN** a search query is entered
- **WHEN** filtering drawings
- **THEN** the system SHALL perform case-insensitive substring matching on drawing names
- **AND** it SHALL show no results if no drawings match

#### Scenario: Clear search
- **GIVEN** a search query is active
- **WHEN** the user clears the search input
- **THEN** the system SHALL show all drawings (filtered by collection if applicable)

### Requirement: Collection Manager Component
The system SHALL provide UI for creating and managing collections.

#### Scenario: Collection dropdown display
- **GIVEN** the Gallery sidebar is open
- **WHEN** viewing the collection filter dropdown
- **THEN** it SHALL show "All Drawings" as the default option
- **AND** it SHALL list all available collections
- **AND** it SHALL show the currently selected collection

#### Scenario: Filter by collection
- **GIVEN** the collection dropdown is open
- **WHEN** the user selects a collection
- **THEN** the system SHALL update `selectedCollectionIdAtom`
- **AND** the drawings list SHALL re-filter to show only drawings in that collection

#### Scenario: Create new collection
- **GIVEN** the collection dropdown is open
- **WHEN** the user clicks "Create New Collection"
- **THEN** the system SHALL open a dialog prompting for a collection name
- **AND** when confirmed, it SHALL call `createCollection(name)`
- **AND** it SHALL refresh the collections list
- **AND** it SHALL select the newly created collection

#### Scenario: Add drawing to collection
- **GIVEN** a drawing card is displayed
- **WHEN** the user right-clicks and selects "Add to Collection"
- **THEN** the system SHALL open a multi-select dialog with available collections
- **AND** when confirmed, it SHALL update the drawing's `collectionIds` array
- **AND** it SHALL refresh the drawing card to show updated collection badges

### Requirement: Gallery State Management
The system SHALL use Jotai atoms to manage Gallery UI state.

#### Scenario: Gallery open/close state
- **GIVEN** the user toggles the Gallery sidebar
- **WHEN** the state changes
- **THEN** `galleryIsOpenAtom` SHALL reflect the current open/close state

#### Scenario: Drawings list synchronization
- **GIVEN** drawings are saved, loaded, or deleted
- **WHEN** the Gallery sidebar is open
- **THEN** `drawingsListAtom` SHALL re-query IndexedDB
- **AND** it SHALL apply current filters (collection, search)
- **AND** the UI SHALL re-render with updated list

#### Scenario: Loaded drawing tracking
- **GIVEN** a user loads a drawing from the Gallery
- **WHEN** the drawing is applied to the canvas
- **THEN** `currentLoadedDrawingIdAtom` SHALL be set to the drawing's ID
- **AND** when the user saves, the system SHALL know to update this drawing
- **AND** when the user creates a new canvas, this atom SHALL be reset to null

### Requirement: Pagination for Large Lists
The system SHALL implement pagination to handle large numbers of drawings efficiently.

#### Scenario: Initial load with pagination
- **GIVEN** a user has more than 100 drawings
- **WHEN** opening the Gallery sidebar
- **THEN** the system SHALL load only the first 20 drawings
- **AND** it SHALL display a "Load More" button at the bottom

#### Scenario: Load more drawings
- **GIVEN** the drawings list is paginated
- **WHEN** the user clicks "Load More"
- **THEN** the system SHALL fetch the next 20 drawings using IndexedDB cursor
- **AND** it SHALL append them to the displayed list

#### Scenario: Performance with pagination
- **GIVEN** pagination is enabled
- **WHEN** rendering the drawings list
- **THEN** the initial render SHALL complete in under 500ms
- **AND** scrolling SHALL remain smooth (60fps)

### Requirement: Internationalization Support
The system SHALL provide translations for all Gallery UI strings.

#### Scenario: Gallery UI strings
- **GIVEN** the application is running
- **WHEN** displaying the Gallery sidebar
- **THEN** all labels SHALL use i18n keys from the localization system
- **AND** keys SHALL include: "Gallery", "Save", "Save As", "Overwrite", "Search", "All Drawings", "Create Collection", "Add to Collection", "Delete", "Confirm", "Cancel"

#### Scenario: Language switching
- **GIVEN** the user changes the application language
- **WHEN** the Gallery sidebar is open
- **THEN** all UI strings SHALL update to the selected language
