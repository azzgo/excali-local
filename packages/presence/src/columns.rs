//! Two-column menu rows: labels flush left, values flush right.
//!
//! macOS menus have no column layout, but an `NSAttributedString` title with a
//! RIGHT-aligned tab stop gives exactly that: the label starts at the leading
//! edge and the value *ends* at a fixed x, so short values ("on") and long ones
//! ("active") share one right edge — the same shape the system's own menus use
//! for their shortcut column. With a right-aligned stop every row also measures
//! exactly `x` wide, which is what keeps NSMenu from re-wrapping a row.
//!
//! Non-macOS builds have no attributed-title channel; they keep the same shape
//! as plain text so the layout intent still exists for tests.

/// Minimum x for the right-hand column. The real value is measured per render
/// (see [`column_x`]) because the menu font and the row labels decide it, and a
/// hard-coded number either wraps a long label or pads the menu for no reason.
const MIN_COLUMN_PT: f64 = 72.0;

/// Breathing room between the longest label and its value. Widening this is the
/// only knob that adds whitespace to the middle of the menu: the right edge is
/// pinned to the value, so growing the gap pushes the whole column right and the
/// menu grows with it.
#[cfg(target_os = "macos")]
const COLUMN_GAP_PT: f64 = 26.0;

/// Plain-text rendering of a two-column row: label, tab, value.
pub fn row_text(label: &str, value: &str) -> String {
    if value.is_empty() {
        label.to_string()
    } else {
        format!("{label}\t{value}")
    }
}

#[cfg(target_os = "macos")]
pub fn two_columns(
    label: &str,
    value: &str,
    column_x: f64,
) -> Option<objc2::rc::Retained<objc2_foundation::NSAttributedString>> {
    use objc2::rc::Retained;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSMutableParagraphStyle, NSParagraphStyleAttributeName, NSTextAlignment, NSTextTab,
        NSTextTabOptionKey,
    };
    use objc2_foundation::{
        NSArray, NSAttributedString, NSAttributedStringKey, NSDictionary, NSString,
    };

    let mtm = MainThreadMarker::new()?;
    let _ = mtm;
    objc2::rc::autoreleasepool(|_pool| unsafe {
        let paragraph: Retained<NSMutableParagraphStyle> = NSMutableParagraphStyle::new();
        // ONE left-aligned stop at a fixed x. This is what makes the column align:
        // `setDefaultTabInterval` jumps to the next *multiple* of the interval, so
        // a long label lands the value further right than a short one (that was
        // the ragged-column bug). A single explicit stop ignores the label width.
        let options: Retained<NSDictionary<NSTextTabOptionKey, objc2::runtime::AnyObject>> =
            NSDictionary::new();
        let tab = NSTextTab::initWithTextAlignment_location_options(
            NSTextTab::alloc(),
            NSTextAlignment::Right,
            column_x,
            &options,
        );
        paragraph.setTabStops(Some(&NSArray::from_retained_slice(&[tab])));
        paragraph.setDefaultTabInterval(0.0);

        let text = row_text(label, value);
        let string = NSString::from_str(&text);

        let key: &NSAttributedStringKey = NSParagraphStyleAttributeName;
        let val: &objc2::runtime::AnyObject = &paragraph;
        let attrs: Retained<NSDictionary<NSAttributedStringKey, objc2::runtime::AnyObject>> =
            NSDictionary::from_slices(&[key], &[val]);

        let attr = NSAttributedString::initWithString_attributes(
            NSAttributedString::alloc(),
            &string,
            Some(&attrs),
        );
        Some(attr)
    })
}

#[cfg(not(target_os = "macos"))]
pub fn two_columns(_label: &str, _value: &str, _column_x: f64) -> Option<()> {
    None
}

/// The x where every row's value lands: past the widest label in `labels`, plus
/// a gap. Measured with the actual menu font, so a longer port number or a
/// renamed label widens the column instead of colliding with it.
#[cfg(target_os = "macos")]
pub fn column_x<'a>(rows: impl IntoIterator<Item = (&'a str, &'a str)>) -> f64 {
    use objc2_app_kit::{NSFont, NSFontAttributeName, NSStringDrawing};
    use objc2_foundation::{NSDictionary, NSString};

    let Some(_mtm) = objc2::MainThreadMarker::new() else {
        return MIN_COLUMN_PT;
    };
    objc2::rc::autoreleasepool(|_pool| unsafe {
        let font = NSFont::menuFontOfSize(0.0);
        let font_obj: &objc2::runtime::AnyObject = &font;
        let attrs = NSDictionary::from_slices(&[NSFontAttributeName], &[font_obj]);
        let width = |text: &str| NSString::from_str(text).sizeWithAttributes(Some(&attrs)).width;

        // The stop sits at the row's right edge, so it must clear the widest
        // label *plus* that row's value — otherwise the tab collapses and the
        // value falls back to the default 28pt grid (the misalignment bug).
        rows.into_iter()
            .map(|(label, value)| width(label) + COLUMN_GAP_PT + width(value))
            .fold(0.0_f64, f64::max)
            .max(MIN_COLUMN_PT)
    })
}

/// Plain-text equivalent of a two-column row, padded so NSMenu measures the row
/// at least as wide as its attributed title.
///
/// macOS sizes a menu by the plain `title`, but draws the `attributedTitle`; a
/// narrower plain title makes AppKit wrap the attributed one (the ⏹ glyph kept
/// dropping onto a second line). Interpolating the padding until the measured
/// plain width reaches the attributed width removes that mismatch for good,
/// instead of hard-coding a magic width that breaks with the next label.
#[cfg(target_os = "macos")]
pub fn padded_plain(label: &str, value: &str, target_width: f64) -> String {
    use objc2_app_kit::{NSFont, NSFontAttributeName, NSStringDrawing};
    use objc2_foundation::{NSDictionary, NSString};

    let Some(_mtm) = objc2::MainThreadMarker::new() else {
        return row_text(label, value);
    };
    objc2::rc::autoreleasepool(|_pool| unsafe {
        let font = NSFont::menuFontOfSize(0.0);
        let font_obj: &objc2::runtime::AnyObject = &font;
        let attrs = NSDictionary::from_slices(&[NSFontAttributeName], &[font_obj]);
        let width = |text: &str| NSString::from_str(text).sizeWithAttributes(Some(&attrs)).width;

        // NSMenu sizes itself from the plain title but draws the attributed one;
        // a narrower plain title makes AppKit wrap the attributed row. With a
        // right-aligned stop the target is the same for every row, so one pad
        // loop over a fixed width is enough.
        let mut pad = 0;
        loop {
            let candidate = format!("{label}{}{value}", " ".repeat(pad));
            if width(&candidate) >= target_width || pad >= 96 {
                return candidate;
            }
            pad += 1;
        }
    })
}

#[cfg(not(target_os = "macos"))]
pub fn padded_plain(label: &str, value: &str, _attributed_width: f64) -> String {
    row_text(label, value)
}

#[cfg(not(target_os = "macos"))]
pub fn column_x<'a>(_rows: impl IntoIterator<Item = (&'a str, &'a str)>) -> f64 {
    MIN_COLUMN_PT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_text_joins_with_a_tab() {
        assert_eq!(row_text("LAN", "off"), "LAN\toff");
    }

    #[test]
    fn row_text_without_a_value_is_the_label_alone() {
        assert_eq!(row_text("Quit", ""), "Quit");
    }
}

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    use super::*;

    #[test]
    fn two_columns_declines_off_the_main_thread() {
        // AppKit paragraph styles are main-thread-only. A unit test runs on a
        // worker thread, so the honest expectation is `None` — the caller then
        // falls back to a plain title instead of trapping.
        assert!(
            two_columns("LAN", "off", MIN_COLUMN_PT).is_none(),
            "off the main thread there is no attributed title to build"
        );
    }
}
