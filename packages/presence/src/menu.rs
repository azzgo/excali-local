//! Menu construction and click dispatch for the presence tray.
//!
//! Layout — a label column on the left and a value column flush right, so the
//! rows read as a small table rather than ragged prose:
//!
//! ```text
//! Excali Local            ← section header (disabled)
//! ───────────────────────
//! Daemon (17331)     ⏹    ← the row is the start/stop action
//! Canvas         none
//! ───────────────────────
//! LAN              off    ← click toggles
//! AutoStart        off    ← click toggles
//! ───────────────────────
//! Quit
//! ```
//!
//! The start/stop affordance is a trailing glyph rather than a menu-item image
//! because muda's `IconMenuItem` images do not survive the macOS status-item
//! menu path tray-icon uses (`setMenu` → `performClick` → `setMenu(None)`); a
//! status row that silently loses its icon reads as a broken row.

use muda::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};

use crate::cli::Snapshot;
use crate::columns;

pub struct MenuState {
    pub menu: Menu,
    pub daemon_toggle: MenuItem,
    pub canvas: MenuItem,
    pub autostart: MenuItem,
    pub quit: MenuItem,
}

/// A row's two halves: what it is, and where it stands.
pub struct Row<'a> {
    pub label: &'a str,
    pub value: String,
}

impl<'a> Row<'a> {
    fn new(label: &'a str, value: impl Into<String>) -> Self {
        Self {
            label,
            value: value.into(),
        }
    }
}

/// Paint a row: attributed (two-column) on macOS, plain text elsewhere.
///
/// The plain title is set first and *not* cleared: NSMenu sizes a status-item
/// menu from the widest plain `title`, so an attributed title wider than the
/// plain one gets wrapped onto a second line (first observed with the ⏹ glyph
/// dropping below "Daemon (17331)"). Giving the plain title the same two-column
/// text — tab included — makes it measure at least as wide as the attributed
/// one, so the menu grows instead of wrapping.
fn paint(item: &MenuItem, row: &Row<'_>, column_x: f64) {
    match columns::two_columns(row.label, &row.value, column_x) {
        Some(title) => {
            // Right-aligned stop ⇒ every row measures exactly `column_x` wide, so
            // the plain title is padded to that same width.
            item.set_text(columns::padded_plain(row.label, &row.value, column_x));
            item.set_attributed_title(Some(&title));
        }
        None => item.set_text(columns::row_text(row.label, &row.value)),
    }
}

impl MenuState {
    pub fn new() -> Self {
        let daemon_toggle = MenuItem::new("Daemon", true, None);
        let canvas = MenuItem::new("Canvas", false, None);
        let autostart = MenuItem::new("Start at Login", false, None);
        let quit = MenuItem::new("Quit", true, None);
        let header = MenuItem::new("Excali Local", false, None);
        let menu = Menu::new();
        // No LAN row: Peering has no sender-side UI (see Known Limitations), so
        // exposing the switch would advertise a feature a user cannot reach. The
        // CLI keeps `lan on|off`; the row returns when the send side ships.
        menu.append_items(&[
            &header,
            &PredefinedMenuItem::separator(),
            &daemon_toggle,
            &canvas,
            &PredefinedMenuItem::separator(),
            &autostart,
            &PredefinedMenuItem::separator(),
            &quit,
        ])
        .expect("build the presence menu");
        Self {
            menu,
            daemon_toggle,
            canvas,
            autostart,
            quit,
        }
    }

    /// `busy` shows a transient "…" state right after a click, until the next
    /// snapshot lands (≤2s later) and reflects the real outcome.
    pub fn render(&self, snapshot: &Snapshot, busy: Option<Busy>) {
        let toggles = toggles_enabled(snapshot.installed);
        self.autostart.set_enabled(toggles);

        let running = snapshot.daemon.running && snapshot.daemon.port.is_some();
        // The port rides in the label, so the value column stays one glyph wide.
        let daemon_label = match (running, snapshot.daemon.port) {
            (true, Some(port)) => format!("Daemon ({port})"),
            _ => "Daemon".to_string(),
        };

        // Measure every row ONCE and hand the same x to all of them: that shared
        // right edge is what makes the value column line up.
        let daemon_value = if running { STOP } else { PLAY };
        let canvas_value = if snapshot.bridge.active_canvas.is_some() {
            "active"
        } else {
            "none"
        };
        let autostart_value = if snapshot.autostart_enabled { "on" } else { "off" };
        let column_x = columns::column_x([
            (daemon_label.as_str(), daemon_value),
            ("Canvas", canvas_value),
            ("AutoStart", autostart_value),
        ]);

        if !snapshot.installed {
            paint(&self.daemon_toggle, &Row::new(&daemon_label, "not installed"), column_x);
            self.daemon_toggle.set_enabled(false);
            paint(&self.canvas, &Row::new("Canvas", "not installed"), column_x);
            paint(&self.autostart, &Row::new("AutoStart", "not installed"), column_x);
            return;
        }

        match busy {
            Some(Busy::Daemon) => {
                paint(&self.daemon_toggle, &Row::new(&daemon_label, "…"), column_x);
                self.daemon_toggle.set_enabled(false);
            }
            _ => {
                paint(&self.daemon_toggle, &Row::new(&daemon_label, daemon_value), column_x);
                self.daemon_toggle.set_enabled(true);
            }
        }

        paint(&self.canvas, &Row::new("Canvas", canvas_value), column_x);

        match busy {
            Some(Busy::Autostart) => paint(&self.autostart, &Row::new("AutoStart", "…"), column_x),
            _ => paint(&self.autostart, &Row::new("AutoStart", autostart_value), column_x),
        }
    }
}

/// The start/stop affordances. Single glyphs: the value column stays narrow and
/// the row still reads as an action, not a status string.
const PLAY: &str = "▶";
const STOP: &str = "⏹";

/// Which toggle is mid-flight; the menu greys that row and shows "…" until the
/// next snapshot (≤2s) reports the outcome.
#[derive(Clone, Copy)]
pub enum Busy {
    Daemon,
    Autostart,
}

/// The two actionable items (LAN, start at login) stay clickable exactly while
/// the CLI is installed; muda items default to disabled and must be re-enabled
/// explicitly, otherwise macOS greys them out forever.
pub fn toggles_enabled(installed: bool) -> bool {
    installed
}

pub enum MenuAction {
    ToggleDaemon,
    ToggleAutostart,
    Quit,
    Ignore,
}

pub fn classify(state: &MenuState, event: &MenuEvent) -> MenuAction {
    let id = event.id();
    if id == state.quit.id() {
        MenuAction::Quit
    } else if id == state.daemon_toggle.id() {
        MenuAction::ToggleDaemon
    } else if id == state.autostart.id() {
        MenuAction::ToggleAutostart
    } else {
        MenuAction::Ignore
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggles_are_enabled_only_when_cli_is_installed() {
        assert!(toggles_enabled(true));
        assert!(!toggles_enabled(false));
    }

    #[test]
    fn every_value_is_one_short_token() {
        // The value column is 96pt wide; anything longer would be truncated by
        // AppKit rather than wrapped.
        // "pending" is 7 chars: it names the "switch on, listener not yet up"
        // state of the LAN row.
        for value in ["active", "none", "on", "off", "pending", PLAY, STOP, "…"] {
            assert!(
                value.chars().count() <= 7,
                "{value} is too wide for the value column"
            );
        }
    }

    #[test]
    fn every_row_label_fits_the_narrow_menu() {
        for label in ["Daemon (17331)", "Canvas", "LAN", "AutoStart"] {
            assert!(label.len() <= 15, "{label} is too long for the label column");
        }
    }
}
