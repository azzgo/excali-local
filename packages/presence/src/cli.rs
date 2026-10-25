use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DaemonStatus {
    pub running: bool,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BridgeStatus {
    pub active_canvas: Option<String>,
    pub lan_on: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub installed: bool,
    pub daemon: DaemonStatus,
    pub bridge: BridgeStatus,
    pub autostart_enabled: bool,
}

pub fn canonical_bin_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".local/bin/excali-bridge"))
}

pub fn resolve_bin() -> Option<PathBuf> {
    if let Some(override_path) = std::env::var_os("EXCALI_BRIDGE_BIN") {
        let path = PathBuf::from(override_path);
        return path.is_file().then_some(path);
    }
    canonical_bin_path().filter(|path| path.is_file())
}

pub fn version(bin: &Path, timeout: Duration) -> Option<String> {
    let outcome = run_bounded(bin, &["version"], timeout)?;
    if !outcome.success {
        return None;
    }
    let version = outcome.stdout.trim().to_string();
    (!version.is_empty()).then_some(version)
}

pub fn parse_status(text: &str) -> DaemonStatus {
    let port = text.split("port=").nth(1).and_then(|rest| {
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        digits.parse::<u16>().ok()
    });
    DaemonStatus {
        running: port.is_some() && text.contains("running"),
        port,
    }
}

pub fn parse_bridge_status(text: &str) -> BridgeStatus {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return BridgeStatus::default();
    };
    let active_canvas = value
        .get("activeCanvas")
        .and_then(|active| active.get("profileId"))
        .and_then(|id| id.as_str())
        .map(str::to_string);
    let lan_on = value.get("lan").and_then(|lan| lan.as_str()) == Some("on");
    BridgeStatus {
        active_canvas,
        lan_on,
    }
}

pub fn parse_autostart(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| value.get("enabled").and_then(|enabled| enabled.as_bool()))
        .unwrap_or(false)
}

struct CommandOutcome {
    success: bool,
    stdout: String,
}

fn run_bounded(bin: &Path, args: &[&str], timeout: Duration) -> Option<CommandOutcome> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let status = wait_with_deadline(&mut child, timeout)?;
    let stdout = read_stdout(&mut child);
    Some(CommandOutcome {
        success: status.success(),
        stdout,
    })
}

fn wait_with_deadline(child: &mut Child, timeout: Duration) -> Option<std::process::ExitStatus> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn read_stdout(child: &mut Child) -> String {
    let mut buffer = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_string(&mut buffer);
    }
    buffer
}

#[derive(Debug, Clone)]
pub struct BridgeCli {
    bin: Option<PathBuf>,
    timeout: Duration,
}

impl BridgeCli {
    pub fn from_env() -> Self {
        Self {
            bin: resolve_bin(),
            timeout: DEFAULT_TIMEOUT,
        }
    }

    #[cfg(test)]
    pub fn new(bin: PathBuf, timeout: Duration) -> Self {
        Self {
            bin: bin.is_file().then_some(bin),
            timeout,
        }
    }

    pub fn installed(&self) -> bool {
        self.bin.is_some()
    }

    fn run(&self, args: &[&str]) -> Option<CommandOutcome> {
        let bin = self.bin.as_deref()?;
        run_bounded(bin, args, self.timeout)
    }

    pub fn status(&self) -> DaemonStatus {
        match self.run(&["status"]) {
            Some(outcome) if outcome.success => parse_status(&outcome.stdout),
            _ => DaemonStatus::default(),
        }
    }

    pub fn bridge_status(&self) -> BridgeStatus {
        match self.run(&["bridge.status"]) {
            Some(outcome) if outcome.success => parse_bridge_status(&outcome.stdout),
            _ => BridgeStatus::default(),
        }
    }

    pub fn autostart_enabled(&self) -> bool {
        match self.run(&["autostart", "status", "--json"]) {
            Some(outcome) if outcome.success => parse_autostart(&outcome.stdout),
            _ => false,
        }
    }

    pub fn set_lan(&self, on: bool) {
        let _ = self.run(&["lan", if on { "on" } else { "off" }]);
    }

    pub fn set_autostart(&self, on: bool) {
        let _ = self.run(&["autostart", if on { "on" } else { "off" }]);
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            installed: self.installed(),
            daemon: self.status(),
            bridge: self.bridge_status(),
            autostart_enabled: self.autostart_enabled(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    struct FakeBin {
        path: PathBuf,
    }

    impl FakeBin {
        fn new(body: &str) -> Self {
            let id = COUNTER.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!(
                "excali-presence-test-{}-{id}",
                std::process::id()
            ));
            fs::create_dir_all(&dir).unwrap();
            let path = dir.join("excali-bridge");
            fs::write(&path, body).unwrap();
            let mut perms = fs::metadata(&path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&path, perms).unwrap();
            Self { path }
        }
    }

    impl Drop for FakeBin {
        fn drop(&mut self) {
            if let Some(dir) = self.path.parent() {
                let _ = fs::remove_dir_all(dir);
            }
        }
    }

    #[test]
    fn status_text_running_parses_port() {
        let status = parse_status("bridge daemon: running (pid=1 port=17331)");
        assert_eq!(
            status,
            DaemonStatus {
                running: true,
                port: Some(17331),
            }
        );
    }

    #[test]
    fn status_text_not_running() {
        let status = parse_status("bridge daemon: not running");
        assert_eq!(status, DaemonStatus::default());
    }

    #[test]
    fn status_command_running() {
        let fake = FakeBin::new("#!/bin/sh\necho 'bridge daemon: running (pid=1 port=17331)'\n");
        let cli = BridgeCli::new(fake.path.clone(), DEFAULT_TIMEOUT);
        let status = cli.status();
        assert!(status.running);
        assert_eq!(status.port, Some(17331));
    }

    #[test]
    fn status_command_nonzero_exit_is_not_running() {
        let fake = FakeBin::new("#!/bin/sh\necho 'bridge daemon: not running'\nexit 1\n");
        let cli = BridgeCli::new(fake.path.clone(), DEFAULT_TIMEOUT);
        assert_eq!(cli.status(), DaemonStatus::default());
    }

    #[test]
    fn status_command_timeout_is_not_running() {
        let fake = FakeBin::new("#!/bin/sh\nsleep 5\necho 'bridge daemon: running (pid=1 port=17331)'\n");
        let cli = BridgeCli::new(fake.path.clone(), Duration::from_secs(2));
        let started = Instant::now();
        assert_eq!(cli.status(), DaemonStatus::default());
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn bridge_status_with_active_canvas() {
        let fake = FakeBin::new(
            "#!/bin/sh\nprintf '%s' '{\"lan\":\"on\",\"lanPort\":17331,\"activeCanvas\":{\"profileId\":\"profile-abc\"},\"controlPages\":[]}'\n",
        );
        let cli = BridgeCli::new(fake.path.clone(), DEFAULT_TIMEOUT);
        let status = cli.bridge_status();
        assert_eq!(status.active_canvas.as_deref(), Some("profile-abc"));
        assert!(status.lan_on);
    }

    #[test]
    fn bridge_status_without_active_canvas_is_none() {
        let fake = FakeBin::new(
            "#!/bin/sh\nprintf '%s' '{\"lan\":\"off\",\"activeCanvas\":null,\"controlPages\":[]}'\n",
        );
        let cli = BridgeCli::new(fake.path.clone(), DEFAULT_TIMEOUT);
        let status = cli.bridge_status();
        assert_eq!(status.active_canvas, None);
        assert!(!status.lan_on);
    }

    #[test]
    fn bridge_status_nonzero_exit_is_default() {
        let fake = FakeBin::new("#!/bin/sh\nexit 3\n");
        let cli = BridgeCli::new(fake.path.clone(), DEFAULT_TIMEOUT);
        assert_eq!(cli.bridge_status(), BridgeStatus::default());
    }

    #[test]
    fn autostart_enabled_true_and_false() {
        let on = FakeBin::new("#!/bin/sh\nprintf '%s' '{\"enabled\":true,\"entries\":[\"x\"]}'\n");
        let cli = BridgeCli::new(on.path.clone(), DEFAULT_TIMEOUT);
        assert!(cli.autostart_enabled());

        let off = FakeBin::new("#!/bin/sh\nprintf '%s' '{\"enabled\":false,\"entries\":[]}'\n");
        let cli = BridgeCli::new(off.path.clone(), DEFAULT_TIMEOUT);
        assert!(!cli.autostart_enabled());
    }

    #[test]
    fn autostart_command_nonzero_exit_is_disabled() {
        let fake = FakeBin::new("#!/bin/sh\nexit 1\n");
        let cli = BridgeCli::new(fake.path.clone(), DEFAULT_TIMEOUT);
        assert!(!cli.autostart_enabled());
    }

    #[test]
    fn missing_binary_is_not_installed() {
        let cli = BridgeCli::new(PathBuf::from("/nonexistent/excali-bridge"), DEFAULT_TIMEOUT);
        assert!(!cli.installed());
        let snapshot = cli.snapshot();
        assert!(!snapshot.installed);
        assert_eq!(snapshot.daemon, DaemonStatus::default());
    }
}
