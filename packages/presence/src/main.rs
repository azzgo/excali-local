mod cli;
mod menu;
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
const ICON_SIZE: u32 = 32;

enum UserEvent {
    Snapshot(Snapshot),
    Menu(MenuEvent),
}

struct App {
    cli: BridgeCli,
    menu: MenuState,
    tray: Option<TrayIcon>,
    proxy: EventLoopProxy<UserEvent>,
    snapshot: Snapshot,
    refreshing: bool,
    should_exit: bool,
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
        self.menu.render(&snapshot);
        self.snapshot = snapshot;
        self.refreshing = false;
    }

    fn handle_menu(&mut self, event: MenuEvent) {
        match menu::classify(&self.menu, &event) {
            MenuAction::Quit => {
                self.should_exit = true;
            }
            MenuAction::ToggleLan => {
                let target = !self.snapshot.bridge.lan_on;
                self.spawn_toggle(move |cli| cli.set_lan(target));
            }
            MenuAction::ToggleAutostart => {
                let target = !self.snapshot.autostart_enabled;
                self.spawn_toggle(move |cli| cli.set_autostart(target));
            }
            MenuAction::Ignore => {}
        }
    }

    fn spawn_toggle<F>(&mut self, act: F)
    where
        F: FnOnce(&BridgeCli) + Send + 'static,
    {
        if !self.cli.installed() {
            return;
        }
        let cli = self.cli.clone();
        let proxy = self.proxy.clone();
        std::thread::spawn(move || {
            act(&cli);
            let _ = proxy.send_event(UserEvent::Snapshot(cli.snapshot()));
        });
    }
}

impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, _event_loop: &winit::event_loop::ActiveEventLoop) {
        if self.tray.is_some() {
            return;
        }
        let tray = TrayIconBuilder::new()
            .with_menu(Box::new(self.menu.menu.clone()))
            .with_tooltip("Excali Local")
            .with_icon(placeholder_icon())
            .build()
            .expect("build the tray icon");
        self.tray = Some(tray);
        self.menu.render(&self.snapshot);
        self.request_refresh();
    }

    fn user_event(&mut self, _event_loop: &winit::event_loop::ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Snapshot(snapshot) => self.apply(snapshot),
            UserEvent::Menu(event) => self.handle_menu(event),
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

fn placeholder_icon() -> Icon {
    let mut rgba = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];
    let center = ICON_SIZE as f32 / 2.0;
    let radius = center - 2.0;
    for y in 0..ICON_SIZE {
        for x in 0..ICON_SIZE {
            let dx = x as f32 + 0.5 - center;
            let dy = y as f32 + 0.5 - center;
            let inside = dx * dx + dy * dy <= radius * radius;
            let offset = ((y * ICON_SIZE + x) * 4) as usize;
            if inside {
                rgba[offset] = 0x4c;
                rgba[offset + 1] = 0x6e;
                rgba[offset + 2] = 0xf5;
                rgba[offset + 3] = 0xff;
            }
        }
    }
    Icon::from_rgba(rgba, ICON_SIZE, ICON_SIZE).expect("placeholder icon")
}

fn align_sidecar() {
    let Some(bundled) = sidecar::bundled_bin_path() else {
        return;
    };
    let Some(canonical) = cli::canonical_bin_path() else {
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
