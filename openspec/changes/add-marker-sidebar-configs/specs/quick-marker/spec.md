# quick-marker Specification

## Purpose
The quick-marker capability provides a sidebar interface for configuring Excalidraw drawing tools and properties, allowing users to quickly adjust stroke, color, style, font, and other properties for annotations.

## ADDED Requirements

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

### Requirement: Corner Roundness Configuration

The Quick Marker sidebar SHALL provide corner roundness configuration options that allow users to control the sharpness or roundness of shape corners.

#### Scenario: Select sharp corners

- **WHEN** user clicks the sharp corners button
- **THEN** the system SHALL set `currentItemRoundness` to `"sharp"`
- **AND** the sharp button SHALL display as active
- **AND** newly drawn shapes SHALL have sharp corners

#### Scenario: Select round corners

- **WHEN** user clicks the round corners button
- **THEN** the system SHALL set `currentItemRoundness` to `"round"`
- **AND** the round button SHALL display as active
- **AND** newly drawn shapes SHALL have rounded corners

### Requirement: Arrow Type Configuration

The Quick Marker sidebar SHALL provide arrow type configuration options that allow users to control arrowhead styles for the arrow tool.

#### Scenario: Select one-sided arrow

- **WHEN** user clicks the one-sided arrow button
- **THEN** the system SHALL set `currentItemStartArrowhead` to `null`
- **AND** the system SHALL set `currentItemEndArrowhead` to `"arrow"`
- **AND** the one-sided arrow button SHALL display as active
- **AND** newly drawn arrows SHALL have arrowhead only at the end

#### Scenario: Select two-sided arrow

- **WHEN** user clicks the two-sided arrow button
- **THEN** the system SHALL set `currentItemStartArrowhead` to `"arrow"`
- **AND** the system SHALL set `currentItemEndArrowhead` to `"arrow"`
- **AND** the two-sided arrow button SHALL display as active
- **AND** newly drawn arrows SHALL have arrowheads at both ends

#### Scenario: Select dot arrowhead

- **WHEN** user clicks the dot arrowhead button
- **THEN** the system SHALL set `currentItemStartArrowhead` to `null`
- **AND** the system SHALL set `currentItemEndArrowhead` to `"dot"`
- **AND** the dot button SHALL display as active
- **AND** newly drawn arrows SHALL have dot at the end

### Requirement: Font Family Configuration

The Quick Marker sidebar SHALL provide font family configuration options that allow users to select different typography styles for text elements.

#### Scenario: Select hand-drawn font

- **WHEN** user clicks the hand-drawn font button
- **THEN** the system SHALL set `currentItemFontFamily` to `1` (FontFamily.Hand)
- **AND** the hand-drawn button SHALL display as active
- **AND** newly drawn text SHALL use hand-drawn font style

#### Scenario: Select normal font

- **WHEN** user clicks the normal font button
- **THEN** the system SHALL set `currentItemFontFamily` to `2` (FontFamily.Sans)
- **AND** the normal button SHALL display as active
- **AND** newly drawn text SHALL use sans-serif font style

#### Scenario: Select code font

- **WHEN** user clicks the code font button
- **THEN** the system SHALL set `currentItemFontFamily` to `3` (FontFamily.Monospace)
- **AND** the code button SHALL display as active
- **AND** newly drawn text SHALL use monospace font style

### Requirement: Font Size Configuration

The Quick Marker sidebar SHALL provide font size configuration options that allow users to adjust text element size.

#### Scenario: Select small font size

- **WHEN** user clicks the small font size button
- **THEN** the system SHALL set `currentItemFontSize` to `16`
- **AND** the small button SHALL display as active
- **AND** newly drawn text SHALL have small font size

#### Scenario: Select medium font size

- **WHEN** user clicks the medium font size button
- **THEN** the system SHALL set `currentItemFontSize` to `20`
- **AND** the medium button SHALL display as active
- **AND** newly drawn text SHALL have medium font size

#### Scenario: Select large font size

- **WHEN** user clicks the large font size button
- **THEN** the system SHALL set `currentItemFontSize` to `28`
- **AND** the large button SHALL display as active
- **AND** newly drawn text SHALL have large font size

#### Scenario: Select very large font size

- **WHEN** user clicks the very large font size button
- **THEN** the system SHALL set `currentItemFontSize` to `36`
- **AND** the very large button SHALL display as active
- **AND** newly drawn text SHALL have very large font size

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
  2. Stroke width
  3. Line style (solid/dashed/dotted)
  4. Corners (sharp/round)
  5. Arrow type
  6. Stroke color
  7. Background color
  8. Font family
  9. Font size
- **AND** each section SHALL have a clear header label
- **AND** each section SHALL be visually separated with spacing