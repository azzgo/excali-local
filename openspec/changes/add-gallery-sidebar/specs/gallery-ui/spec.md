## ADDED Requirements

### Requirement: Gallery Sidebar Component
The system SHALL provide a sidebar component for browsing and managing saved drawings.

#### Scenario: Sidebar integration in editors
- **GIVEN** the user is in LocalEditor or QuickMarkerEditor
- **WHEN** the component tree renders
- **THEN** the GallerySidebar SHALL be included as a child of the Excalidraw component
- **AND** it SHALL use the Excalidraw `Sidebar` wrapper component
- **AND** it SHALL be accessible via the sidebar toggle UI

#### Scenario: Sidebar trigger button visibility
- **GIVEN** the Gallery sidebar is open
- **WHEN** viewing the editor UI
- **THEN** the sidebar trigger button SHALL be hidden (consistent with official Excalidraw behavior)
- **AND** when the sidebar is closed, the trigger button SHALL be visible again

#### Scenario: Sidebar structure
- **GIVEN** the Gallery sidebar is open
- **WHEN** viewing the sidebar
- **THEN** it SHALL display a header with the title "Gallery" (i18n key)
- **AND** it SHALL include a save button (text+icon, with optional dropdown)
- **AND** it SHALL include a search bar
- **AND** it SHALL display a "Collections" section with a collapsible list of collections
- **AND** it SHALL display a scrollable list of drawing cards below the collections section

#### Scenario: Docked mode behavior
- **GIVEN** the Gallery sidebar is docked
- **WHEN** the sidebar docks
- **THEN** the system SHALL enable Excalidraw's zen mode
- **AND** when the sidebar undocks, it SHALL disable zen mode

### Requirement: UI Component Dependencies
The system SHALL use shadcn UI components for consistent styling and behavior.

#### Scenario: Required shadcn UI components
- **GIVEN** the Gallery UI components are being implemented
- **WHEN** selecting input UI controls
- **THEN** it SHALL use Input component from `@/components/ui/input` for text inputs
- **AND** this component SHALL be added to the project if not already present

#### Scenario: Component styling consistency
- **GIVEN** shadcn UI components are used
- **WHEN** rendering Gallery UI
- **THEN** all shadcn components SHALL follow the project's design system
- **AND** they SHALL integrate with existing CSS custom properties for theming

### Requirement: Drawing Card Component
The system SHALL display individual drawings as thumbnail cards with metadata.

#### Scenario: Card visual structure
- **GIVEN** a drawing exists in the Gallery
- **WHEN** displaying the drawing card
- **THEN** it SHALL show a thumbnail image (200px height, auto width)
- **AND** it SHALL show the drawing name
- **AND** it SHALL show the last updated timestamp (relative format)
- **AND** it SHALL show collection badges if assigned to collections
- **AND** it SHALL show a "..." menu icon on hover or focus

#### Scenario: Card menu structure
- **GIVEN** a drawing card is displayed
- **WHEN** the user clicks the "..." menu icon
- **THEN** it SHALL open a dropdown menu with the following options:
  - **"Rename"**: Opens rename dialog
  - **"Add to Collection"**: Opens collection multi-selector
  - **"Overwrite with current canvas"**: Overwrites the drawing with current canvas state
  - **"Delete"**: Deletes the drawing with confirmation

#### Scenario: Card interaction - Load drawing
- **GIVEN** a drawing card is displayed
- **WHEN** the user clicks on the card
- **THEN** the system SHALL check for unsaved changes in the current canvas
- **AND** if unsaved changes exist, it SHALL prompt the user for confirmation
- **AND** if confirmed or no changes, it SHALL load the drawing into the canvas
- **AND** it SHALL update `currentLoadedDrawingIdAtom` with the drawing ID

#### Scenario: Card interaction - Rename drawing
- **GIVEN** a drawing card is displayed
- **WHEN** the user opens the card's "..." menu and selects "Rename"
- **THEN** the system SHALL open a dialog with input pre-filled with current name
- **AND** it SHALL use shadcn UI Input component
- **AND** when confirmed, it SHALL call `updateDrawing()` with the new name
- **AND** it SHALL refresh the drawing card to show the updated name

#### Scenario: Card interaction - Delete drawing
- **GIVEN** a drawing card is displayed
- **WHEN** the user opens the card's "..." menu and selects "Delete"
- **THEN** the system SHALL prompt for confirmation
- **AND** if confirmed, it SHALL delete the drawing from IndexedDB
- **AND** it SHALL refresh the drawings list
- **AND** if the deleted drawing is currently loaded, it SHALL clear `currentLoadedDrawingIdAtom`

#### Scenario: Card interaction - Overwrite drawing
- **GIVEN** a drawing card is displayed
- **WHEN** the user opens the card's "..." menu and selects "Overwrite with current canvas"
- **THEN** the system SHALL check if there are unsaved changes in the current canvas
- **AND** if no changes, it SHALL show a message indicating nothing to overwrite
- **AND** if changes exist, it SHALL prompt for confirmation
- **AND** when confirmed, it SHALL overwrite the drawing with current canvas state
- **AND** it SHALL update `currentLoadedDrawingIdAtom` to the overwritten drawing's ID
- **AND** it SHALL refresh the drawing card with new thumbnail and timestamp

### Requirement: Save Button Component
The system SHALL provide a split button with dropdown for saving canvas content to the Gallery.

#### Scenario: Save button display when no drawing is loaded
- **GIVEN** the current canvas is not associated with any Gallery drawing (`currentLoadedDrawingIdAtom` is null)
- **WHEN** viewing the Gallery sidebar header
- **THEN** the save button SHALL display as a text+icon button with "Save" label (i18n key)
- **AND** clicking the button SHALL open a "Save As" dialog
- **AND** there SHALL be NO dropdown arrow (single action mode)

#### Scenario: Save button display when drawing is loaded
- **GIVEN** the current canvas is associated with a Gallery drawing (`currentLoadedDrawingIdAtom` is not null)
- **WHEN** viewing the Gallery sidebar header
- **THEN** the save button SHALL display as a text+icon split button with "Save" label
- **AND** clicking the main button SHALL directly save to the associated drawing (no dialog)
- **AND** there SHALL be a dropdown arrow on the right side
- **AND** clicking the dropdown SHALL reveal a menu with "Save as New Drawing" option

#### Scenario: Save new drawing
- **GIVEN** no drawing is currently loaded
- **WHEN** the user clicks the save button
- **THEN** the system SHALL open a "Save As" dialog
- **AND** it SHALL provide a name input field (pre-filled with auto-generated name based on timestamp)
- **AND** it SHALL use shadcn UI Input component
- **AND** it SHALL provide a collection multi-selector
- **AND** when confirmed, it SHALL save the drawing with the specified name and collections
- **AND** it SHALL update `currentLoadedDrawingIdAtom` with the new drawing ID
- **AND** it SHALL show a success feedback (toast notification)

#### Scenario: Update existing drawing (quick save)
- **GIVEN** the current canvas is associated with a Gallery drawing
- **WHEN** the user clicks the main save button
- **THEN** the system SHALL directly update the associated drawing without showing dialog
- **AND** it SHALL preserve the drawing's name and collections
- **AND** it SHALL update thumbnail, elements, appState, files, and updatedAt timestamp
- **AND** it SHALL show a success feedback (toast notification)

#### Scenario: Save as new drawing from dropdown
- **GIVEN** the current canvas is associated with a Gallery drawing
- **WHEN** the user clicks the dropdown arrow and selects "Save as New Drawing"
- **THEN** the system SHALL open a "Save As" dialog
- **AND** it SHALL pre-fill the name input with the current drawing's name + " (Copy)"
- **AND** it SHALL pre-select the same collections as the current drawing
- **AND** when confirmed, it SHALL create a new drawing
- **AND** it SHALL update `currentLoadedDrawingIdAtom` to the new drawing ID
- **AND** it SHALL NOT modify the original drawing

### Requirement: Search Bar Component
The system SHALL provide debounced search filtering for drawings by name using shadcn UI Input component.

#### Scenario: Search input with debouncing
- **GIVEN** the Gallery sidebar is open
- **WHEN** the user types in the search input
- **THEN** the system SHALL debounce the input with a 300ms delay
- **AND** after the delay, it SHALL update `searchQueryAtom`
- **AND** the drawings list SHALL re-filter to show only matching names

#### Scenario: Search UI component
- **GIVEN** the search bar is rendered
- **WHEN** viewing the component
- **THEN** it SHALL use shadcn UI Input component from `@/components/ui/input`
- **AND** it SHALL include a search icon on the left side
- **AND** it SHALL include a clear button on the right side when query is not empty

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
The system SHALL provide UI for creating and managing collections as a sidebar list (inspired by excalisave design).

#### Scenario: Collections section display
- **GIVEN** the Gallery sidebar is open
- **WHEN** viewing the collections section
- **THEN** it SHALL display a "Collections" header with a "+" icon button for adding new collections
- **AND** it SHALL show "All Drawings" as the first item with a folder icon
- **AND** it SHALL list all collections below with folder icons and drawing counts
- **AND** it SHALL highlight the currently selected collection
- **AND** the section SHALL be collapsible (expand/collapse toggle)

#### Scenario: Collection list item structure
- **GIVEN** a collection is displayed in the list
- **WHEN** viewing a collection item
- **THEN** it SHALL show a folder icon on the left
- **AND** it SHALL show the collection name
- **AND** it SHALL show the count of drawings in that collection
- **AND** it SHALL show a "..." (more options) menu icon on hover or focus

#### Scenario: Collection selection
- **GIVEN** collections are displayed in the sidebar
- **WHEN** the user clicks on a collection item
- **THEN** the system SHALL update `selectedCollectionIdAtom`
- **AND** the drawings list SHALL re-filter to show only drawings in that collection
- **AND** the selected collection SHALL be visually highlighted

#### Scenario: Create new collection
- **GIVEN** the collections section is visible
- **WHEN** the user clicks the "+" icon in the Collections header
- **THEN** the system SHALL open a dialog prompting for a collection name
- **AND** it SHALL use shadcn UI Input component for the name input
- **AND** when confirmed, it SHALL call `createCollection(name)`
- **AND** it SHALL refresh the collections list
- **AND** it SHALL select the newly created collection

#### Scenario: Collection menu actions
- **GIVEN** a collection item is displayed
- **WHEN** the user clicks the "..." menu icon
- **THEN** it SHALL open a dropdown menu with options
- **AND** the menu SHALL include "Rename" option
- **AND** the menu SHALL include "Delete" option
- **AND** when "Rename" is selected, it SHALL open a dialog with input pre-filled with current name
- **AND** when "Delete" is selected, it SHALL prompt for confirmation before deletion

#### Scenario: Add drawing to collection via menu
- **GIVEN** a drawing card is displayed
- **WHEN** the user opens the card's menu (similar to official Excalidraw menu patterns)
- **THEN** it SHALL display menu options including "Add to Collection"
- **AND** when "Add to Collection" is selected, it SHALL open a multi-select dialog with available collections
- **AND** when confirmed, it SHALL update the drawing's `collectionIds` array
- **AND** it SHALL refresh the drawing card to show updated collection badges
- **AND** it SHALL update the drawing count for affected collections

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
- **AND** keys SHALL include: 
  - "Gallery", "Save", "Save As", "Save as New Drawing"
  - "Search", "Collections", "All Drawings"
  - "Create Collection", "Add to Collection", "Rename", "Delete"
  - "Overwrite", "Overwrite with current canvas"
  - "Confirm", "Cancel"
  - Success/error messages for save/update/delete operations

#### Scenario: Language switching
- **GIVEN** the user changes the application language
- **WHEN** the Gallery sidebar is open
- **THEN** all UI strings SHALL update to the selected language
