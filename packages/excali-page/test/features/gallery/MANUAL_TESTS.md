# Manual Testing Guide: Gallery Sidebar

This document provides detailed instructions for manual verification of the Gallery Sidebar feature. These tests cover scenarios that are difficult or impossible to automate reliably with Vitest (e.g., visual layout, cross-store isolation, debouncing timing, and menu click isolation).

## How to Use This Document

1.  **Preparation**: Ensure you have the latest version of the application running locally.
2.  **Environment**: Use a modern browser (Chrome, Firefox, or Safari) with DevTools accessible.
3.  **Data Reset**: Before starting a test run, it is recommended to clear your browser's IndexedDB and LocalStorage for the application origin to start with a clean state.
4.  **Execution**: Follow the steps for each test case sequentially.
5.  **Verification**: Check the "Expected Results" for each step. If any step fails, record the actual behavior and report it.

## Summary of Manual Tests

| ID | Priority | Test Case | Description |
|:---|:---|:---|:---|
| [MT-GS-001](#mt-gs-001) | Critical | Storage Isolation | Verify auto-save workspace and Gallery drawings don't affect each other. |
| [MT-GS-002](#mt-gs-002) | High | Search Debouncing | Verify the 300ms debounce prevents excessive database queries. |
| [MT-GS-003](#mt-gs-003) | High | Thumbnail Generation | Verify thumbnails are correctly generated for various drawing sizes/shapes. |
| [MT-GS-004](#mt-gs-004) | High | Split Button Save Behavior | Verify the Save button text and dropdown options change based on state. |
| [MT-GS-005](#mt-gs-005) | Medium | Collection Menu Click Isolation | Verify clicking the "..." menu doesn't trigger collection selection. |
| [MT-GS-006](#mt-gs-006) | Medium | Drawing Card Menu Click Isolation | Verify clicking the "..." menu doesn't trigger drawing loading. |

---

<a name="mt-gs-001"></a>
## MT-GS-001: Storage Isolation Testing
**Priority**: Critical  
**Description**: Ensure that the auto-save mechanism for the working canvas (LocalStorage) is completely isolated from the Gallery drawings (IndexedDB).

### Prerequisites
- Browser DevTools open (Application tab).
- Gallery sidebar closed.

### Test Steps
1. Draw a unique shape (e.g., a large red circle) on the canvas.
2. Wait 2 seconds for auto-save to trigger (check LocalStorage `excalidraw-canvas` or similar).
3. Open Gallery Sidebar and save the drawing as "Original Drawing".
4. Modify the canvas by adding a blue square.
5. Wait for auto-save to trigger again.
6. In Gallery Sidebar, click "Original Drawing" to load it.
7. Observe the canvas state.
8. Click the "All Drawings" collection to ensure the gallery list is stable.
9. Refresh the page.

### Expected Results
- After Step 6, a "Unsaved Changes" warning (if implemented) should appear or the drawing should load.
- After loading "Original Drawing", only the red circle should be visible (the blue square should NOT be part of the saved gallery drawing).
- After Step 9 (refresh), the canvas should restore the state of the last *auto-save* (red circle + blue square) OR the last *loaded* drawing depending on implementation.
- **Success Criteria**: Saving to Gallery never overwrites the auto-save buffer, and auto-save never modifies items in the Gallery IndexedDB store.

---

<a name="mt-gs-002"></a>
## MT-GS-002: Search Debouncing
**Priority**: High  
**Description**: Verify that the search functionality waits for 300ms of inactivity before triggering a filter operation.

### Prerequisites
- Have at least 10 drawings with different names (e.g., "Alpha", "Beta", "Gamma", etc.).
- Network or Performance tab in DevTools open (optional, but helpful to see re-renders).

### Test Steps
1. Open the Gallery Sidebar.
2. Rapidly type "Alpha" into the search box (within < 300ms).
3. Observe when the list updates.
4. Clear the search box.
5. Type "A", wait 500ms, then type "lpha".
6. Observe when the list updates.

### Expected Results
- In Step 2, the list should update only ONCE after you finish typing "Alpha".
- In Step 6, the list should update twice: once after "A" and once after "lpha".
- **Success Criteria**: The UI should not flicker or re-filter for every single keystroke if typed rapidly. There must be a perceptible but short (300ms) delay.

---

<a name="mt-gs-003"></a>
## MT-GS-003: Thumbnail Generation
**Priority**: High  
**Description**: Verify that thumbnails are generated correctly and look appropriate for drawings of various aspect ratios and sizes.

### Prerequisites
- Clean canvas.

### Test Steps
1. Draw a very tall/thin vertical line. Save as "Tall".
2. Draw a very wide/short horizontal rectangle. Save as "Wide".
3. Draw a tiny dot in the center. Save as "Tiny".
4. Draw elements spread far apart in four corners. Save as "Spread".
5. Observe the thumbnails in the Gallery Sidebar.

### Expected Results
- All thumbnails should be visible and centered within their cards.
- The "Spread" thumbnail should show all elements scaled down to fit.
- Aspect ratios should be preserved or handled gracefully (no stretching).
- **Success Criteria**: Thumbnails are clear, not blurry, and accurately represent the content of the drawing.

---

<a name="mt-gs-004"></a>
## MT-GS-004: Split Button Save Behavior
**Priority**: High  
**Description**: Verify that the Save button UI updates its text and behavior based on whether a drawing is currently "loaded" from the gallery.

### Prerequisites
- Gallery sidebar open.

### Test Steps
1. Start with a fresh canvas (no drawing loaded). Observe the Save button in the sidebar.
2. Click Save, enter a name "Test 1", and save.
3. Observe the Save button again.
4. Draw something new on the canvas.
5. Click the main part of the Save button (the text/icon).
6. Click the dropdown arrow on the Save button.
7. Select "Save as New Drawing".

### Expected Results
- In Step 1, the button should say "Save" (or "Save to Gallery").
- In Step 3, after saving, the button should change to "Update".
- In Step 5, clicking the main button should perform a overwrite of "Test 1" without opening a dialog.
- In Step 7, a dialog should appear asking for a new name.
- **Success Criteria**: The button correctly identifies the "Active" drawing and provides appropriate shortcuts.

---

<a name="mt-gs-005"></a>
## MT-GS-005: Collection Menu Click Isolation
**Priority**: Medium  
**Description**: Verify that clicking the "..." (ellipsis) menu on a collection item does not trigger the selection of that collection.

### Prerequisites
- Create at least two collections: "Work" and "Personal".
- Select "Work" so it is highlighted.

### Test Steps
1. Hover over the "Personal" collection in the sidebar.
2. Click the "..." button on the "Personal" item.
3. Observe if the "Personal" collection becomes selected (highlighted) and if the drawings list filters.
4. Click outside the menu to close it.

### Expected Results
- In Step 2, the rename/delete menu should open.
- The "Work" collection should REMAIN selected.
- The drawings list should NOT change to show "Personal" drawings.
- **Success Criteria**: `e.stopPropagation()` correctly prevents the click from bubbling up to the collection selection handler.

---

<a name="mt-gs-006"></a>
## MT-GS-006: Drawing Card Menu Click Isolation
**Priority**: Medium  
**Description**: Verify that clicking the "..." (ellipsis) menu on a drawing card does not trigger the loading of that drawing onto the canvas.

### Prerequisites
- Have a drawing "Safe Drawing" on the canvas.
- Have a different drawing "Other Drawing" in the Gallery.

### Test Steps
1. Locate "Other Drawing" in the Gallery Sidebar.
2. Click the "..." button on the "Other Drawing" card.
3. Observe the canvas and the card state.
4. Click "Rename" in the menu.
5. Close the rename dialog without saving.

### Expected Results
- In Step 2, the card menu should open.
- The canvas should still show "Safe Drawing".
- "Other Drawing" should NOT be loaded.
- **Success Criteria**: Clicking the menu button only opens the menu and does not trigger the `onClick` handler of the parent card.

---

## Browser/Environment Requirements
- **Browsers**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+.
- **Storage**: Minimum 100MB free disk space for IndexedDB.
- **Screen Size**: Best viewed on desktop/tablet resolutions where the sidebar is fully visible.
