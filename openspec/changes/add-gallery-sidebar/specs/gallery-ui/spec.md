## ADDED Requirements

### Requirement: Optimistic UI Updates
The system SHALL implement optimistic updates for collection and drawing operations to provide instant feedback.

#### Scenario: Optimistic update pattern
- **GIVEN** a user performs a mutation operation (create, update, delete)
- **WHEN** the operation is initiated
- **THEN** the system SHALL immediately update the UI to reflect the expected result (optimistic update)
- **AND** it SHALL persist the change to IndexedDB asynchronously in the background
- **AND** if persistence succeeds, the UI SHALL remain in the updated state
- **AND** if persistence fails, the UI SHALL revert to the previous state
- **AND** a toast notification SHALL inform the user of the failure

#### Scenario: Local state management for collections
- **GIVEN** the collections section uses optimistic updates
- **WHEN** implementing state management
- **THEN** it SHALL use local React state (useState) to manage the collections list
- **AND** it SHALL NOT use async Jotai atoms or Suspense for collections
- **AND** it SHALL load the initial collections list from IndexedDB on mount
- **AND** all subsequent updates SHALL be synchronous UI updates with async persistence

#### Scenario: Collection operations with optimistic updates
- **GIVEN** collection operations (create, rename, delete) are performed
- **WHEN** the operation is triggered
- **THEN** the system SHALL use optimistic updates as follows:
  - **Create**: Add collection to UI immediately, persist async, rollback on failure
  - **Rename**: Update name in UI immediately, persist async, rollback on failure
  - **Delete**: Remove from UI immediately, persist async, rollback on failure
- **AND** the collections section SHALL remain stable (no loading states, no disappearing UI)

#### Scenario: Drawing metadata operations with optimistic updates
- **GIVEN** drawing metadata operations (rename, delete, add to collection) are performed
- **WHEN** the operation is triggered
- **THEN** the system SHALL use optimistic updates as follows:
  - **Rename**: Update name in card immediately, persist async, rollback on failure
  - **Delete**: Remove card immediately, persist async, rollback on failure
  - **Add to collection**: Update badges and counts immediately, persist async, rollback on failure
- **AND** the affected cards SHALL update in place without full list refresh

#### Scenario: Heavy operations with targeted updates
- **GIVEN** heavy operations that generate new data (save, overwrite) are performed
- **WHEN** the operation is triggered
- **THEN** the system SHALL show loading indicators during persistence
- **AND** it SHALL perform thumbnail generation and persist to IndexedDB
- **AND** upon successful persistence, it SHALL perform targeted UI updates:
  - **Save new drawing**: Insert the new drawing card at the top of the list (prepend)
  - **Overwrite existing drawing**: Update only the specific card (thumbnail, timestamp, name)
  - **Update existing drawing**: Update only the specific card (thumbnail, timestamp)
- **AND** it SHALL NOT trigger full gallery list refresh (`galleryRefreshAtom`)
- **AND** it SHALL coordinate with the parent list component to perform surgical DOM updates

#### Scenario: Minimal use of full refresh
- **GIVEN** the gallery manages drawing cards list
- **WHEN** implementing state updates
- **THEN** the system SHALL avoid triggering `galleryRefreshAtom` for operations with known scope:
  - Save new drawing → prepend card to list (no full refresh)
  - Update existing drawing → update specific card (no full refresh)
  - Overwrite existing drawing → update specific card (no full refresh)
  - Rename drawing → optimistic update (no full refresh)
  - Delete drawing → optimistic removal (no full refresh)
  - Add to collection → optimistic badge update (no full refresh)
- **AND** `galleryRefreshAtom` SHALL only be used for operations requiring full re-query:
  - Collection filter changed (need to re-filter from IndexedDB)
  - Search query changed (need to re-filter from IndexedDB)
  - Initial load of gallery sidebar
  - Bulk operations or external data changes

#### Scenario: Suspense only for initial load and filter changes
- **GIVEN** the gallery uses React Suspense for async data loading
- **WHEN** rendering the gallery sidebar
- **THEN** the collections section SHALL NOT use Suspense (synchronous rendering)
- **AND** the drawing cards section SHALL use Suspense only for:
  - Initial load when opening gallery sidebar
  - Collection filter changes (different subset from IndexedDB)
  - Search query changes (different filtered results)
- **AND** individual card operations SHALL NOT trigger Suspense fallback
- **AND** the collections section SHALL always remain visible and stable

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

#### Scenario: Card menu click isolation
- **GIVEN** a drawing card is displayed with a "..." menu icon
- **WHEN** the user clicks the "..." menu icon or any menu item
- **THEN** the dropdown menu SHALL open or the action SHALL execute
- **AND** the parent card's onClick handler (load drawing) SHALL NOT be triggered
- **AND** the event propagation SHALL be properly stopped at the DropdownMenuTrigger and DropdownMenuItem levels

#### Scenario: Card interaction - Load drawing
- **GIVEN** a drawing card is displayed
- **WHEN** the user clicks on the card (but not on the menu icon)
- **THEN** the system SHALL check for unsaved changes in the current canvas
- **AND** if unsaved changes exist, it SHALL prompt the user for confirmation
- **AND** if confirmed or no changes, it SHALL load the drawing into the canvas
- **AND** it SHALL update `currentLoadedDrawingIdAtom` with the drawing ID

#### Scenario: Card interaction - Rename drawing with optimistic update
- **GIVEN** a drawing card is displayed
- **WHEN** the user opens the card's "..." menu and selects "Rename" and confirms new name
- **THEN** the system SHALL immediately update the drawing name in the UI (optimistic update)
- **AND** it SHALL use shadcn UI Input component for the dialog
- **AND** it SHALL persist the name change to IndexedDB asynchronously
- **AND** if persistence fails, it SHALL revert the name in UI and show error toast

#### Scenario: Card interaction - Delete drawing with optimistic update
- **GIVEN** a drawing card is displayed
- **WHEN** the user opens the card's "..." menu and selects "Delete" and confirms deletion
- **THEN** the system SHALL immediately remove the drawing from the UI (optimistic update)
- **AND** it SHALL update collection counts immediately in the sidebar
- **AND** if the deleted drawing is currently loaded, it SHALL clear `currentLoadedDrawingIdAtom`
- **AND** it SHALL persist the deletion to IndexedDB asynchronously
- **AND** if persistence fails, it SHALL restore the drawing in UI and show error toast

#### Scenario: Card interaction - Overwrite drawing with targeted update
- **GIVEN** a drawing card is displayed
- **WHEN** the user opens the card's "..." menu and selects "Overwrite with current canvas" and confirms
- **THEN** the system SHALL check if there are unsaved changes in the current canvas
- **AND** if no changes, it SHALL show a message indicating nothing to overwrite
- **AND** if changes exist, it SHALL prompt for confirmation
- **AND** when confirmed, it SHALL generate new thumbnail and persist the overwrite to IndexedDB
- **AND** upon success, it SHALL update only the specific card (thumbnail, timestamp, elements)
- **AND** it SHALL NOT trigger `galleryRefreshAtom` or full list refresh
- **AND** it SHALL update `currentLoadedDrawingIdAtom` to the overwritten drawing's ID
- **AND** if persistence fails, it SHALL show error toast

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

#### Scenario: Save new drawing with targeted insert
- **GIVEN** no drawing is currently loaded
- **WHEN** the user clicks the save button and confirms the save dialog
- **THEN** the system SHALL open a "Save As" dialog
- **AND** it SHALL provide a name input field (pre-filled with auto-generated name based on timestamp)
- **AND** it SHALL use shadcn UI Input component
- **AND** it SHALL provide a collection multi-selector
- **AND** when confirmed, it SHALL generate thumbnail and persist to IndexedDB
- **AND** upon success, it SHALL prepend the new drawing card to the top of the list (targeted insert)
- **AND** it SHALL NOT trigger `galleryRefreshAtom` or full list refresh
- **AND** it SHALL update `currentLoadedDrawingIdAtom` with the new drawing ID
- **AND** it SHALL show a success feedback (toast notification)

#### Scenario: Update existing drawing with targeted update
- **GIVEN** the current canvas is associated with a Gallery drawing
- **WHEN** the user clicks the main save button
- **THEN** the system SHALL directly update the associated drawing without showing dialog
- **AND** it SHALL preserve the drawing's name and collections
- **AND** it SHALL generate new thumbnail and persist to IndexedDB
- **AND** upon success, it SHALL update only the specific card (thumbnail, timestamp)
- **AND** it SHALL NOT trigger `galleryRefreshAtom` or full list refresh
- **AND** it SHALL show a success feedback (toast notification)

#### Scenario: Save as new drawing with targeted insert
- **GIVEN** the current canvas is associated with a Gallery drawing
- **WHEN** the user clicks the dropdown arrow and selects "Save as New Drawing" and confirms
- **THEN** the system SHALL open a "Save As" dialog
- **AND** it SHALL pre-fill the name input with the current drawing's name + " (Copy)"
- **AND** it SHALL pre-select the same collections as the current drawing
- **AND** when confirmed, it SHALL generate thumbnail and create a new drawing in IndexedDB
- **AND** upon success, it SHALL prepend the new drawing card to the top of the list (targeted insert)
- **AND** it SHALL NOT trigger `galleryRefreshAtom` or full list refresh
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
- **AND** it SHALL show "All Drawings" as the first item with a folder icon (always visible)
- **AND** it SHALL list all collections below with folder icons and drawing counts
- **AND** it SHALL highlight the currently selected collection
- **AND** the section SHALL be collapsible with collapse/expand toggle
- **AND** the section SHALL be collapsed by default on initial render

#### Scenario: Collections synchronous rendering
- **GIVEN** the Gallery sidebar is open
- **WHEN** rendering the collections section
- **THEN** it SHALL render collections synchronously without Suspense boundaries
- **AND** it SHALL NOT show skeleton loading states for collections
- **AND** "All Drawings" SHALL always be immediately visible

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

#### Scenario: Create new collection with optimistic update
- **GIVEN** the collections section is visible
- **WHEN** the user clicks the "+" icon and confirms a collection name
- **THEN** the system SHALL immediately add the new collection to the UI (optimistic update)
- **AND** it SHALL use shadcn UI Input component for the name input
- **AND** it SHALL assign a temporary ID to the new collection
- **AND** it SHALL persist the collection to IndexedDB asynchronously
- **AND** when persistence succeeds, it SHALL replace the temporary ID with the real ID
- **AND** if persistence fails, it SHALL remove the collection from UI and show error toast
- **AND** it SHALL select the newly created collection immediately

#### Scenario: Rename collection with optimistic update
- **GIVEN** a collection item is displayed
- **WHEN** the user selects "Rename" from the menu and confirms a new name
- **THEN** the system SHALL immediately update the collection name in the UI (optimistic update)
- **AND** it SHALL persist the name change to IndexedDB asynchronously
- **AND** if persistence fails, it SHALL revert the name in UI and show error toast

#### Scenario: Delete collection with optimistic update
- **GIVEN** a collection item is displayed
- **WHEN** the user selects "Delete" from the menu and confirms deletion
- **THEN** the system SHALL immediately remove the collection from the UI (optimistic update)
- **AND** if the collection is currently selected, it SHALL switch to "All Drawings"
- **AND** it SHALL persist the deletion to IndexedDB asynchronously
- **AND** if persistence fails, it SHALL restore the collection in UI and show error toast

#### Scenario: Collection menu click isolation
- **GIVEN** a collection item is displayed with a "..." menu icon
- **WHEN** the user clicks the "..." menu icon
- **THEN** the dropdown menu SHALL open
- **AND** the parent collection item's onClick handler SHALL NOT be triggered
- **AND** clicking menu items SHALL NOT trigger collection selection
- **AND** the event propagation SHALL be properly stopped at the DropdownMenuTrigger level

#### Scenario: Add drawing to collection with optimistic update
- **GIVEN** a drawing card is displayed
- **WHEN** the user opens the card's menu and selects "Add to Collection" and confirms selections
- **THEN** the system SHALL immediately update the drawing's collection badges in the UI (optimistic update)
- **AND** it SHALL immediately update the collection counts in the sidebar
- **AND** it SHALL persist the `collectionIds` update to IndexedDB asynchronously
- **AND** if persistence fails, it SHALL revert the badges and counts and show error toast

### Requirement: Gallery State Management
The system SHALL use Jotai atoms and local state to manage Gallery UI state efficiently with minimal re-renders.

#### Scenario: Gallery open/close state
- **GIVEN** the user toggles the Gallery sidebar
- **WHEN** the state changes
- **THEN** `galleryIsOpenAtom` SHALL reflect the current open/close state

#### Scenario: Drawings list with local state and targeted updates
- **GIVEN** drawings are displayed in the gallery
- **WHEN** implementing drawings list state
- **THEN** it SHALL use local React state (useState) to manage the drawings list
- **AND** it SHALL load initial data from IndexedDB on mount or when filters change
- **AND** it SHALL use async Jotai atom ONLY for initial load and filter changes (collection, search)
- **AND** individual drawing operations SHALL update local state directly without re-querying IndexedDB:
  - Save new drawing → prepend to local list
  - Update drawing → update specific item in local list
  - Delete drawing → remove from local list (optimistic)
  - Rename drawing → update specific item in local list (optimistic)
- **AND** `galleryRefreshAtom` SHALL trigger full re-query only for filter changes

#### Scenario: Collections list with local state
- **GIVEN** collections are displayed in the sidebar
- **WHEN** implementing collections list state
- **THEN** it SHALL use local React state (useState) to manage the collections list
- **AND** it SHALL load initial data from IndexedDB on component mount
- **AND** it SHALL NOT use async Jotai atoms or Suspense boundaries
- **AND** all updates SHALL be synchronous with optimistic UI updates

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
