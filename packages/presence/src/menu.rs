use muda::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};

use crate::cli::Snapshot;

pub struct MenuState {
    pub menu: Menu,
    pub daemon: MenuItem,
    pub canvas: MenuItem,
    pub lan: MenuItem,
    pub autostart: MenuItem,
    pub quit: MenuItem,
}

impl MenuState {
    pub fn new() -> Self {
        let daemon = MenuItem::new("daemon: unknown", false, None);
        let canvas = MenuItem::new("active canvas: none", false, None);
        let lan = MenuItem::new("LAN: unknown", false, None);
        let autostart = MenuItem::new("start at login: ✗", false, None);
        let quit = MenuItem::new("Quit", true, None);
        let menu = Menu::new();
        menu.append_items(&[
            &daemon,
            &canvas,
            &lan,
            &autostart,
            &PredefinedMenuItem::separator(),
            &quit,
        ])
        .expect("build the presence menu");
        Self {
            menu,
            daemon,
            canvas,
            lan,
            autostart,
            quit,
        }
    }

    pub fn render(&self, snapshot: &Snapshot) {
        if !snapshot.installed {
            self.daemon.set_text("daemon: not installed");
            self.canvas.set_text("active canvas: not installed");
            self.lan.set_text("LAN: not installed");
            self.autostart.set_text("start at login: not installed");
            return;
        }
        let daemon_text = match snapshot.daemon.port {
            Some(port) if snapshot.daemon.running => format!("daemon: running @{port}"),
            _ => "daemon: not running".to_string(),
        };
        self.daemon.set_text(daemon_text);
        let canvas_text = match snapshot.bridge.active_canvas.as_deref() {
            Some(id) => format!("active canvas: {id}"),
            None => "active canvas: none".to_string(),
        };
        self.canvas.set_text(canvas_text);
        self.lan
            .set_text(format!("LAN: {}", if snapshot.bridge.lan_on { "on" } else { "off" }));
        self.autostart.set_text(format!(
            "start at login: {}",
            if snapshot.autostart_enabled { "✓" } else { "✗" }
        ));
    }
}

pub enum MenuAction {
    ToggleLan,
    ToggleAutostart,
    Quit,
    Ignore,
}

pub fn classify(state: &MenuState, event: &MenuEvent) -> MenuAction {
    let id = event.id();
    if id == state.quit.id() {
        MenuAction::Quit
    } else if id == state.lan.id() {
        MenuAction::ToggleLan
    } else if id == state.autostart.id() {
        MenuAction::ToggleAutostart
    } else {
        MenuAction::Ignore
    }
}
