# quick-marker Specification

## Purpose
TBD - created by archiving change add-marker-sidebar-configs. Update Purpose after archive.
## Requirements
### Requirement: Tool Selection

The Quick Marker sidebar SHALL provide tool selection buttons for marker, arrow, and line tools.

#### Scenario: Select marker tool

- **WHEN** user clicks the marker tool button
- **THEN** the system SHALL activate marker mode
- **AND** the marker button SHALL display as active
- **AND** the sidebar SHALL show marker-specific configuration options

#### Scenario: Select arrow tool

- **WHEN** user clicks the arrow tool button
- **THEN** the system SHALL deactivate marker mode
- **AND** the system SHALL set active tool to "arrow"
- **AND** the arrow button SHALL display as active
- **AND** the sidebar SHALL show arrow-specific configuration options

#### Scenario: Select line tool

- **WHEN** user clicks the line tool button
- **THEN** the system SHALL deactivate marker mode
- **AND** the system SHALL set active tool to "line"
- **AND** the line button SHALL display as active
- **AND** the sidebar SHALL show line-specific configuration options

### Requirement: Stroke Color Configuration

The Quick Marker sidebar SHALL provide stroke color configuration options.

#### Scenario: Select stroke color from preset

- **WHEN** user clicks a preset stroke color button
- **THEN** the system SHALL set `currentItemStrokeColor` to the selected color
- **AND** the selected button SHALL display as active
- **AND** the read-only color indicator SHALL show the selected color

#### Scenario: Stroke color preset options

- **WHEN** user views stroke color options
- **THEN** the sidebar SHALL display these preset colors:
  - Black (#1e1e1e)
  - Red (#e03131)
  - Green (#2f9e44)
  - Blue (#1971c2)
  - Orange (#f08c00)
  - Cyan (#0c8599)
  - Transparent

### Requirement: Background Color Configuration

The Quick Marker sidebar SHALL provide background color configuration options.

#### Scenario: Select background color from preset

- **WHEN** user clicks a preset background color button
- **THEN** the system SHALL set `currentItemBackgroundColor` to the selected color
- **AND** the selected button SHALL display as active
- **AND** the read-only color indicator SHALL show the selected color

#### Scenario: Background color preset options

- **WHEN** user views background color options
- **THEN** the sidebar SHALL display these preset colors:
  - Light red (#ffc9c9)
  - Light green (#b2f2bb)
  - Light blue (#a5d8ff)
  - Light yellow (#ffec99)
  - Light purple (#eebefa)
  - Light gray (#e9ecef)
  - Transparent

### Requirement: Stroke Width Configuration

The Quick Marker sidebar SHALL provide stroke width configuration options that allow users to adjust the thickness of lines and shapes.

#### Scenario: Select thin stroke width

- **WHEN** user clicks the thin stroke width button
- **THEN** the system SHALL set `currentItemStrokeWidth` to `1`
- **AND** the thin button SHALL display as active
- **AND** newly drawn lines and shapes SHALL have thin stroke

#### Scenario: Select bold stroke width

- **WHEN** user clicks the bold stroke width button
- **THEN** the system SHALL set `currentItemStrokeWidth` to `2`
- **AND** the bold button SHALL display as active
- **AND** newly drawn lines and shapes SHALL have bold stroke

#### Scenario: Select extra bold stroke width

- **WHEN** user clicks the extra bold stroke width button
- **THEN** the system SHALL set `currentItemStrokeWidth` to `4`
- **AND** the extra bold button SHALL display as active
- **AND** newly drawn lines and shapes SHALL have extra bold stroke

### Requirement: Line Style Configuration

The Quick Marker sidebar SHALL provide line style configuration options.

#### Scenario: Select solid line style

- **WHEN** user clicks the solid line style button
- **THEN** the system SHALL set `currentItemStrokeStyle` to `"solid"`
- **AND** the solid button SHALL display as active

#### Scenario: Select dashed line style

- **WHEN** user clicks the dashed line style button
- **THEN** the system SHALL set `currentItemStrokeStyle` to `"dashed"`
- **AND** the dashed button SHALL display as active

#### Scenario: Select dotted line style

- **WHEN** user clicks the dotted line style button
- **THEN** the system SHALL set `currentItemStrokeStyle` to `"dotted"`
- **AND** the dotted button SHALL display as active

### Requirement: Sloppiness Configuration

The Quick Marker sidebar SHALL provide sloppiness (roughness) configuration options that control the hand-drawn style of elements.

#### Scenario: Select architect sloppiness

- **WHEN** user clicks the architect sloppiness button
- **THEN** the system SHALL set `currentItemRoughness` to `0`
- **AND** the architect button SHALL display as active
- **AND** newly drawn elements SHALL have clean, precise lines

#### Scenario: Select artist sloppiness

- **WHEN** user clicks the artist sloppiness button
- **THEN** the system SHALL set `currentItemRoughness` to `1`
- **AND** the artist button SHALL display as active
- **AND** newly drawn elements SHALL have moderate hand-drawn style

#### Scenario: Select cartoonist sloppiness

- **WHEN** user clicks the cartoonist sloppiness button
- **THEN** the system SHALL set `currentItemRoughness` to `2`
- **AND** the cartoonist button SHALL display as active
- **AND** newly drawn elements SHALL have pronounced hand-drawn style

### Requirement: Font Family Configuration

The Quick Marker sidebar SHALL provide font family configuration options that allow users to select different typography styles for text elements. This section SHALL only appear when marker mode is active.

#### Scenario: Select hand-drawn font

- **WHEN** user clicks the hand-drawn font button in marker mode
- **THEN** the system SHALL set `currentItemFontFamily` to `5`
- **AND** the hand-drawn button SHALL display as active
- **AND** newly drawn text SHALL use hand-drawn font style

#### Scenario: Select normal font

- **WHEN** user clicks the normal font button in marker mode
- **THEN** the system SHALL set `currentItemFontFamily` to `6`
- **AND** the normal button SHALL display as active
- **AND** newly drawn text SHALL use sans-serif font style

#### Scenario: Select code font

- **WHEN** user clicks the code font button in marker mode
- **THEN** the system SHALL set `currentItemFontFamily` to `8`
- **AND** the code button SHALL display as active
- **AND** newly drawn text SHALL use monospace font style

### Requirement: Font Size Configuration

The Quick Marker sidebar SHALL provide font size configuration options that allow users to adjust text element size. This section SHALL only appear when marker mode is active.

#### Scenario: Select small font size

- **WHEN** user clicks the small font size button in marker mode
- **THEN** the system SHALL set `currentItemFontSize` to `16`
- **AND** the small button SHALL display as active
- **AND** newly drawn text SHALL have small font size

#### Scenario: Select medium font size

- **WHEN** user clicks the medium font size button in marker mode
- **THEN** the system SHALL set `currentItemFontSize` to `20`
- **AND** the medium button SHALL display as active
- **AND** newly drawn text SHALL have medium font size

#### Scenario: Select large font size

- **WHEN** user clicks the large font size button in marker mode
- **THEN** the system SHALL set `currentItemFontSize` to `28`
- **AND** the large button SHALL display as active
- **AND** newly drawn text SHALL have large font size

#### Scenario: Select very large font size

- **WHEN** user clicks the very large font size button in marker mode
- **THEN** the system SHALL set `currentItemFontSize` to `36`
- **AND** the very large button SHALL display as active
- **AND** newly drawn text SHALL have very large font size

### Requirement: Corner Roundness Configuration

The Quick Marker sidebar SHALL provide corner roundness configuration options that allow users to control the sharpness or roundness of shape corners. This section SHALL only appear when the line tool is active.

#### Scenario: Select sharp corners

- **WHEN** user clicks the sharp corners button with line tool active
- **THEN** the system SHALL set `currentItemRoundness` to `"sharp"`
- **AND** the sharp button SHALL display as active
- **AND** newly drawn shapes SHALL have sharp corners

#### Scenario: Select round corners

- **WHEN** user clicks the round corners button with line tool active
- **THEN** the system SHALL set `currentItemRoundness` to `"round"`
- **AND** the round button SHALL display as active
- **AND** newly drawn shapes SHALL have rounded corners

### Requirement: Arrow Type Configuration

The Quick Marker sidebar SHALL provide arrow type configuration options that allow users to control arrowhead styles for the arrow tool. This section SHALL only appear when the arrow tool is active.

#### Scenario: Select sharp arrow type

- **WHEN** user clicks the sharp arrow button with arrow tool active
- **THEN** the system SHALL set `currentItemStartArrowhead` to `null`
- **AND** the system SHALL set `currentItemEndArrowhead` to `"arrow"`
- **AND** the sharp arrow button SHALL display as active
- **AND** newly drawn arrows SHALL have arrowhead only at the end

#### Scenario: Select round arrow type

- **WHEN** user clicks the round arrow button with arrow tool active
- **THEN** the system SHALL set `currentItemStartArrowhead` to `"arrow"`
- **AND** the system SHALL set `currentItemEndArrowhead` to `"arrow"`
- **AND** the round arrow button SHALL display as active
- **AND** newly drawn arrows SHALL have arrowheads at both ends

#### Scenario: Select elbow arrow type

- **WHEN** user clicks the elbow arrow button with arrow tool active
- **THEN** the system SHALL set `currentItemStartArrowhead` to `null`
- **AND** the system SHALL set `currentItemEndArrowhead` to `"dot"`
- **AND** the elbow arrow button SHALL display as active
- **AND** newly drawn arrows SHALL have dot at the end

### Requirement: Opacity Configuration

The Quick Marker sidebar SHALL provide opacity configuration options via a slider control.

#### Scenario: Adjust opacity via slider

- **WHEN** user drags the opacity slider
- **THEN** the system SHALL set `currentItemOpacity` to the selected value
- **AND** the opacity value SHALL display next to the slider
- **AND** newly drawn elements SHALL have the selected opacity

#### Scenario: Opacity range

- **WHEN** user views the opacity slider
- **THEN** the slider SHALL allow values from `0` to `100`
- **AND** the default value SHALL be `100`

### Requirement: Internationalization Support

All new configuration labels and options SHALL support both English and Chinese translations.

#### Scenario: Display English labels

- **WHEN** user's language is set to English
- **THEN** all configuration section headers SHALL display in English
- **AND** all button tooltips SHALL display in English
- **AND** all option labels SHALL display in English

#### Scenario: Display Chinese labels

- **WHEN** user's language is set to Chinese (zh-CN)
- **THEN** all configuration section headers SHALL display in Chinese
- **AND** all button tooltips SHALL display in Chinese
- **AND** all option labels SHALL display in Chinese

### Requirement: Sidebar Layout Organization

The Quick Marker sidebar SHALL organize configuration sections in a logical order for efficient workflow.

#### Scenario: Configuration sections order

- **WHEN** user views the Quick Marker sidebar
- **THEN** sections SHALL appear in this order:
  1. Tool selection (marker/arrow/line)
  2. Stroke color
  3. Background color
  4. Stroke width
  5. Line style (solid/dashed/dotted)
  6. Sloppiness (architect/artist/cartoonist)
  7. Font family (marker mode only)
  8. Font size (marker mode only)
  9. Corners (line tool only)
  10. Arrow types (arrow tool only)
  11. Opacity
- **AND** each section SHALL have a clear header label
- **AND** each section SHALL be visually separated with spacing

#### Scenario: Conditional section visibility

- **WHEN** marker mode is not active
- **THEN** the font family section SHALL be hidden
- **AND** the font size section SHALL be hidden
- **WHEN** the line tool is not active
- **THEN** the corners section SHALL be hidden
- **WHEN** the arrow tool is not active
- **THEN** the arrow types section SHALL be hidden

### Requirement: Empty State

The Quick Marker sidebar SHALL display an empty state when no appropriate tool is selected.

#### Scenario: Display empty state

- **WHEN** no tool (marker, arrow, or line) is active
- **THEN** the sidebar SHALL display an empty state component
- **AND** the empty state SHALL show a title saying "Select a tool"
- **AND** the empty state SHALL show a description with guidance

