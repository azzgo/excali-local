mod cli;
mod columns;
mod menu;
mod notice;
mod sidecar;

use std::path::Path;
use std::time::{Duration, Instant};

use muda::MenuEvent;
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};
use winit::application::ApplicationHandler;
use winit::event::StartCause;
use winit::event_loop::{ControlFlow, EventLoop, EventLoopProxy};

use cli::{BridgeCli, Snapshot};
use menu::{MenuAction, MenuState};

const REFRESH_INTERVAL: Duration = Duration::from_secs(2);
const ICON_SIZE: u32 = 64;

enum UserEvent {
    Snapshot(Snapshot),
    Menu(MenuEvent),
    /// An action finished. Carried to the event loop because posting a macOS
    /// notification is main-thread-only, and actions run on a worker thread.
    Notice(&'static str, notice::Outcome),
}

struct App {
    cli: BridgeCli,
    menu: MenuState,
    tray: Option<TrayIcon>,
    proxy: EventLoopProxy<UserEvent>,
    snapshot: Snapshot,
    refreshing: bool,
    should_exit: bool,
    busy: Option<menu::Busy>,
}

impl App {
    fn new(proxy: EventLoopProxy<UserEvent>) -> Self {
        Self {
            cli: BridgeCli::from_env(),
            menu: MenuState::new(),
            tray: None,
            proxy,
            snapshot: Snapshot::default(),
            refreshing: false,
            should_exit: false,
            busy: None,
        }
    }

    fn request_refresh(&mut self) {
        if self.refreshing {
            return;
        }
        self.refreshing = true;
        let cli = self.cli.clone();
        let proxy = self.proxy.clone();
        std::thread::spawn(move || {
            let _ = proxy.send_event(UserEvent::Snapshot(cli.snapshot()));
        });
    }

    fn apply(&mut self, snapshot: Snapshot) {
        self.snapshot = snapshot;
        self.busy = None;
        self.menu.render(&self.snapshot, None);
        self.refreshing = false;
    }

    fn handle_menu(&mut self, event: MenuEvent) {
        match menu::classify(&self.menu, &event) {
            MenuAction::Quit => {
                self.should_exit = true;
            }
            MenuAction::ToggleDaemon => {
                let running = self.snapshot.daemon.running;
                self.mark_busy(menu::Busy::Daemon);
                self.spawn_action("Daemon", move |cli| {
                    if running {
                        cli.stop_daemon()
                    } else {
                        cli.start_daemon()
                    }
                });
            }
            MenuAction::ToggleAutostart => {
                let target = !self.snapshot.autostart_enabled;
                self.mark_busy(menu::Busy::Autostart);
                self.spawn_action("AutoStart", move |cli| cli.set_autostart(target));
            }
            MenuAction::Ignore => {}
        }
    }

    /// Show the in-flight state on the clicked row before the work happens, so
    /// a slow CLI call never looks like an ignored click.
    fn mark_busy(&mut self, busy: menu::Busy) {
        self.busy = Some(busy);
        self.menu.render(&self.snapshot, self.busy);
    }

    /// Run an action off the UI thread, then report how it ended.
    ///
    /// The report is the point: a tray menu has no other channel, so a click
    /// that silently did nothing is indistinguishable from a click that worked.
    /// The action also blocks until the CLI's effect is observable, which is why
    /// the row no longer flips for a moment and then flips back.
    fn spawn_action<F>(&mut self, title: &'static str, act: F)
    where
        F: FnOnce(&BridgeCli) -> notice::Outcome + Send + 'static,
    {
        if !self.cli.installed() {
            let outcome = notice::Outcome::failed("the bridge CLI is not installed");
            notice::log_outcome(title, &outcome);
            notice::post(title, &outcome); // already on the main thread
            return;
        }
        let cli = self.cli.clone();
        let proxy = self.proxy.clone();
        std::thread::spawn(move || {
            let outcome = act(&cli);
            // Log from the worker so the record survives even if the app exits
            // before the UI turn; post from the event loop, where AppKit allows
            // it. Doing both here is what made notifications never appear.
            notice::log_outcome(title, &outcome);
            let _ = proxy.send_event(UserEvent::Notice(title, outcome));
            let _ = proxy.send_event(UserEvent::Snapshot(cli.snapshot()));
        });
    }
}

impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, _event_loop: &winit::event_loop::ActiveEventLoop) {
        if self.tray.is_some() {
            return;
        }
        let builder = TrayIconBuilder::new()
            .with_menu(Box::new(self.menu.menu.clone()))
            .with_tooltip("Excali Local");
        // Template rendering is an AppKit concept; on Linux the icon ships as-is
        // and the desktop theme handles tinting.
        #[cfg(target_os = "macos")]
        let builder = builder.with_icon_templated(tray_icon());
        #[cfg(not(target_os = "macos"))]
        let builder = builder.with_icon(tray_icon());
        let tray = builder.build().expect("build the tray icon");
        self.tray = Some(tray);
        self.menu.render(&self.snapshot, self.busy);
        // First contact with the CLI is slow (a cold status + bridge.status run),
        // so report alignment before the menu has anything to show.
        self.request_refresh();
    }

    fn user_event(&mut self, _event_loop: &winit::event_loop::ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Snapshot(snapshot) => self.apply(snapshot),
            UserEvent::Menu(event) => self.handle_menu(event),
            UserEvent::Notice(title, outcome) => notice::post(title, &outcome),
        }
    }

    fn new_events(
        &mut self,
        _event_loop: &winit::event_loop::ActiveEventLoop,
        cause: StartCause,
    ) {
        if matches!(cause, StartCause::ResumeTimeReached { .. }) {
            self.request_refresh();
        }
    }

    fn about_to_wait(&mut self, event_loop: &winit::event_loop::ActiveEventLoop) {
        if self.should_exit {
            event_loop.exit();
            return;
        }
        event_loop.set_control_flow(ControlFlow::WaitUntil(Instant::now() + REFRESH_INTERVAL));
    }

    fn window_event(
        &mut self,
        _event_loop: &winit::event_loop::ActiveEventLoop,
        _window_id: winit::window::WindowId,
        _event: winit::event::WindowEvent,
    ) {
    }
}

/// The menu-bar glyph: a whiteboard with a pen, drawn as a template image so
/// macOS tints it correctly in both light and dark menu bars.
///
/// Drawn on a 64px canvas for a ~18pt status item: a stroke is 5px, which lands
/// at ~1.4pt on screen — the weight macOS gives its own status glyphs. Thin
/// 1px strokes (the first attempt) rendered at 0.5pt and looked like a hairline
/// next to the system icons.
fn tray_icon() -> Icon {
    const S: i32 = ICON_SIZE as i32;
    let mut rgba = vec![0u8; (S * S * 4) as usize];

    // One mutable sink for every primitive below; closures taking `&mut Vec`
    // avoid the double-borrow that nested writer closures would hit.
    fn put(rgba: &mut [u8], x: i32, y: i32) {
        if x < 0 || y < 0 || x >= ICON_SIZE as i32 || y >= ICON_SIZE as i32 {
            return;
        }
        let o = ((y as usize) * ICON_SIZE as usize + x as usize) * 4;
        rgba[o] = 0xff;
        rgba[o + 1] = 0xff;
        rgba[o + 2] = 0xff;
        rgba[o + 3] = 0xff;
    }
    fn bar_h(rgba: &mut [u8], x0: i32, x1: i32, y: i32, t: i32) {
        for dy in 0..t {
            for x in x0..=x1 {
                put(rgba, x, y + dy);
            }
        }
    }
    fn bar_v(rgba: &mut [u8], x: i32, y0: i32, y1: i32, t: i32) {
        for dx in 0..t {
            for y in y0..=y1 {
                put(rgba, x + dx, y);
            }
        }
    }

    const T: i32 = 5; // stroke weight
    // Board: frame filling the upper-left three quarters.
    let (bx, by, bw, bh) = (4, 8, 40, 34);
    bar_h(&mut rgba, bx, bx + bw, by, T); // top
    bar_h(&mut rgba, bx, bx + bw, by + bh, T); // bottom
    bar_v(&mut rgba, bx, by, by + bh, T); // left
    bar_v(&mut rgba, bx + bw, by, by + bh, T); // right

    // Board content: two bars standing in for "a drawing".
    bar_h(&mut rgba, bx + T + 4, bx + T + 18, by + T + 6, 4);
    bar_h(&mut rgba, bx + T + 4, bx + T + 12, by + T + 14, 4);

    // Stand legs.
    bar_v(&mut rgba, bx + bw / 2 - 8, by + bh + T, by + bh + T + 6, 4);
    bar_v(&mut rgba, bx + bw / 2 + 5, by + bh + T, by + bh + T + 6, 4);

    // Pen: a diagonal shaft crossing the board's lower-right corner, with a nib
    // that pokes outside the frame — the "drawing" half of the mark.
    for i in 0..22i32 {
        let x = 26 + i;
        let y = 40 - i;
        for w in 0..6i32 {
            put(&mut rgba, x + w, y);
            put(&mut rgba, x, y - w);
        }
    }
    // Nib tip.
    for i in 0..6i32 {
        for j in 0..6i32 {
            if i + j <= 7 {
                put(&mut rgba, 47 + i, 17 + j);
            }
        }
    }

    Icon::from_rgba(rgba, ICON_SIZE, ICON_SIZE).expect("tray icon")
}

fn align_sidecar() {
    let Some(bundled) = sidecar::bundled_bin_path() else {
        // A bare `cargo build` tree has no CLI beside the exe. Say so — the menu
        // then reads "not installed" everywhere, and silence here is the one
        // thing that makes that state unexplainable.
        sidecar::log("no bundled excali-bridge beside the executable — skipping sidecar alignment");
        return;
    };
    let Some(canonical) = cli::canonical_bin_path() else {
        sidecar::log("cannot resolve the canonical CLI path — skipping sidecar alignment");
        return;
    };
    report_alignment(
        &bundled,
        &canonical,
        sidecar::ensure_aligned(&bundled, &canonical),
    );
}

fn report_alignment(bundled: &Path, canonical: &Path, outcome: sidecar::Alignment) {
    match outcome {
        sidecar::Alignment::Skipped => {
            sidecar::log("sidecar alignment skipped (EXCALI_BRIDGE_BIN set)");
        }
        sidecar::Alignment::Aligned { version } => {
            sidecar::log(&format!(
                "sidecar aligned at {} (version {version})",
                canonical.display()
            ));
        }
        sidecar::Alignment::Overwrote {
            from,
            to,
            restarted,
        } => {
            sidecar::log(&format!(
                "sidecar realigned {} → {to} (was {}), daemon restarted: {restarted}",
                canonical.display(),
                from.as_deref().unwrap_or("absent"),
            ));
        }
        sidecar::Alignment::Failed(reason) => {
            sidecar::log(&format!(
                "sidecar alignment failed (bundled {}, canonical {}): {reason}",
                bundled.display(),
                canonical.display()
            ));
        }
    }
}

fn main() {
    // A hidden test hook for the outcome notice: posting a notification from a
    // menu-bar accessory needs a bundle identifier, which only the installed
    // .app has, so verifying it by clicking is the only honest check. This
    // reports through the same path the menu uses, from the same process.
    if std::env::args().any(|arg| arg == "--selftest-notice") {
        notice::announce("Excali Local", &notice::Outcome::ok("Notification path works"));
        return;
    }
    align_sidecar();
    let mut builder = EventLoop::<UserEvent>::with_user_event();
    #[cfg(target_os = "macos")]
    {
        use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
        builder.with_activation_policy(ActivationPolicy::Accessory);
    }
    let event_loop = builder.build().expect("create the event loop");
    event_loop.set_control_flow(ControlFlow::Wait);

    let proxy = event_loop.create_proxy();
    let menu_proxy = proxy.clone();
    std::thread::spawn(move || {
        let receiver = MenuEvent::receiver();
        while let Ok(event) = receiver.recv() {
            if menu_proxy.send_event(UserEvent::Menu(event)).is_err() {
                break;
            }
        }
    });

    let mut app = App::new(proxy);
    event_loop.run_app(&mut app).expect("run the presence loop");
}
