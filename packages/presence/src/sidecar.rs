use std::env;
use std::fs::{self, File};
use std::io::{self, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::cli;

pub const VERSION_TIMEOUT: Duration = Duration::from_secs(2);
pub const TERMINATE_TIMEOUT: Duration = Duration::from_secs(5);
const KILL_TIMEOUT: Duration = Duration::from_secs(1);
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const OVERRIDE_ENV: &str = "EXCALI_BRIDGE_BIN";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Alignment {
    Skipped,
    Aligned {
        version: String,
    },
    Overwrote {
        from: Option<String>,
        to: String,
        restarted: bool,
    },
    Failed(String),
}

pub trait DaemonControl {
    fn running_pid(&self) -> Option<u32>;
    fn terminate(&self, pid: u32);
    fn spawn_serve(&self, canonical: &Path) -> bool;
}

pub struct SystemDaemon {
    pidfile: Option<PathBuf>,
}

impl SystemDaemon {
    pub fn from_env() -> Self {
        Self {
            pidfile: pidfile_path(),
        }
    }
}

impl DaemonControl for SystemDaemon {
    fn running_pid(&self) -> Option<u32> {
        let pidfile = self.pidfile.as_deref()?;
        let data = fs::read_to_string(pidfile).ok()?;
        let value: serde_json::Value = serde_json::from_str(&data).ok()?;
        let pid = value.get("pid")?.as_u64()?;
        let pid = u32::try_from(pid)
            .ok()
            .filter(|pid| *pid > 0 && *pid <= i32::MAX as u32)?;
        alive(pid).then_some(pid)
    }

    fn terminate(&self, pid: u32) {
        if !signal(pid, libc::SIGTERM) {
            return;
        }
        if wait_gone(pid, TERMINATE_TIMEOUT) {
            return;
        }
        let _ = signal(pid, libc::SIGKILL);
        let _ = wait_gone(pid, KILL_TIMEOUT);
    }

    fn spawn_serve(&self, canonical: &Path) -> bool {
        let Ok(dir) = state_dir() else {
            return false;
        };
        if fs::create_dir_all(&dir).is_err() {
            return false;
        }
        let Ok(log) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("bridge.log"))
        else {
            return false;
        };
        let Ok(log_err) = log.try_clone() else {
            return false;
        };
        let mut command = Command::new(canonical);
        command
            .arg("serve")
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err));
        unsafe {
            command.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
        command.spawn().is_ok()
    }
}

/// Locate the CLI bundled beside this binary (release layout) or a sibling
/// resource dir (app-bundle layout). Returns None in a bare `cargo build` tree,
/// where there is nothing to align — the caller logs that rather than failing
/// silently, because "menu says not installed and nothing explains why" is the
/// single most confusing state this program can be in.
pub fn bundled_bin_path() -> Option<PathBuf> {
    let exe = env::current_exe().ok()?;
    let dir = exe.parent()?;
    [
        dir.join("excali-bridge"),
        dir.join("../Resources/excali-bridge"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

pub fn log(message: &str) {
    eprintln!("[presence] {message}");
    let Ok(dir) = state_dir() else {
        return;
    };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("presence.log"))
    {
        let _ = writeln!(file, "[presence] {message}");
    }
}

pub fn ensure_aligned(bundled: &Path, canonical: &Path) -> Alignment {
    ensure_aligned_with(bundled, canonical, &SystemDaemon::from_env())
}

pub fn ensure_aligned_with(
    bundled: &Path,
    canonical: &Path,
    daemon: &dyn DaemonControl,
) -> Alignment {
    if env::var_os(OVERRIDE_ENV).is_some() {
        return Alignment::Skipped;
    }
    let Some(bundled_version) = cli::version(bundled, VERSION_TIMEOUT) else {
        return Alignment::Failed(format!(
            "cannot read bundled version from {}",
            bundled.display()
        ));
    };
    let canonical_version = cli::version(canonical, VERSION_TIMEOUT);
    if canonical_version.as_deref() == Some(bundled_version.as_str()) {
        return Alignment::Aligned {
            version: bundled_version,
        };
    }
    if let Err(error) = overwrite(bundled, canonical) {
        return Alignment::Failed(format!("cannot overwrite {}: {error}", canonical.display()));
    }
    let restarted = restart_daemon(daemon, canonical);
    Alignment::Overwrote {
        from: canonical_version,
        to: bundled_version,
        restarted,
    }
}

fn restart_daemon(daemon: &dyn DaemonControl, canonical: &Path) -> bool {
    match daemon.running_pid() {
        Some(pid) => {
            daemon.terminate(pid);
            daemon.spawn_serve(canonical)
        }
        None => false,
    }
}

fn overwrite(bundled: &Path, canonical: &Path) -> io::Result<()> {
    let bytes = fs::read(bundled)?;
    let mode = fs::metadata(bundled)
        .map(|meta| meta.permissions().mode() & 0o777)
        .unwrap_or(0o755);
    let dir = canonical
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "canonical path has no dir"))?;
    fs::create_dir_all(dir)?;
    let name = canonical
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "canonical path has no name"))?;
    let mut tmp_name = name.to_os_string();
    tmp_name.push(format!(".tmp-{}", std::process::id()));
    let tmp = dir.join(tmp_name);
    let result = write_then_rename(&tmp, canonical, &bytes, mode);
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn write_then_rename(tmp: &Path, canonical: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    {
        let mut file = File::create(tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::set_permissions(tmp, fs::Permissions::from_mode(mode))?;
    fs::rename(tmp, canonical)?;
    if let Some(dir) = canonical.parent() {
        if let Ok(handle) = File::open(dir) {
            let _ = handle.sync_all();
        }
    }
    Ok(())
}

fn pidfile_path() -> Option<PathBuf> {
    if let Some(path) = env::var_os("EXCALI_BRIDGE_PIDFILE") {
        return Some(PathBuf::from(path));
    }
    state_dir().ok().map(|dir| dir.join("bridge.pid"))
}

fn state_dir() -> Result<PathBuf, ()> {
    if let Some(dir) = env::var_os("EXCALI_BRIDGE_STATE_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let home = PathBuf::from(env::var_os("HOME").ok_or(())?);
    if cfg!(target_os = "macos") {
        return Ok(home.join("Library/Application Support/excali-local"));
    }
    let base = env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/state"));
    Ok(base.join("excali-local"))
}

fn alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0 || io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

fn signal(pid: u32, sig: libc::c_int) -> bool {
    pid != 0 && unsafe { libc::kill(pid as libc::pid_t, sig) } == 0
}

fn wait_gone(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !alive(pid) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let id = COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = env::temp_dir().join(format!(
                "excali-presence-sidecar-{}-{id}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn join(&self, name: &str) -> PathBuf {
            self.path.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn fake_bin(dir: &TempDir, name: &str, version: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(
            &path,
            format!("#!/bin/sh\nif [ \"$1\" = version ]; then echo {version}; fi\n"),
        )
        .unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[derive(Default)]
    struct FakeDaemon {
        pid: Option<u32>,
        terminated: RefCell<Vec<u32>>,
        spawned: RefCell<Vec<PathBuf>>,
    }

    impl DaemonControl for FakeDaemon {
        fn running_pid(&self) -> Option<u32> {
            self.pid
        }

        fn terminate(&self, pid: u32) {
            self.terminated.borrow_mut().push(pid);
        }

        fn spawn_serve(&self, canonical: &Path) -> bool {
            self.spawned.borrow_mut().push(canonical.to_path_buf());
            true
        }
    }

    #[test]
    fn equal_versions_leave_canonical_untouched() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = TempDir::new();
        let bundled = fake_bin(&dir, "bundled", "1.9.0");
        let canonical = fake_bin(&dir, "canonical", "1.9.0");
        let before = fs::metadata(&canonical).unwrap().modified().unwrap();
        let content = fs::read(&canonical).unwrap();
        thread::sleep(Duration::from_millis(20));

        let daemon = FakeDaemon {
            pid: Some(4242),
            ..FakeDaemon::default()
        };
        let outcome = ensure_aligned_with(&bundled, &canonical, &daemon);

        assert_eq!(
            outcome,
            Alignment::Aligned {
                version: "1.9.0".into()
            }
        );
        assert_eq!(fs::read(&canonical).unwrap(), content);
        assert_eq!(
            fs::metadata(&canonical).unwrap().modified().unwrap(),
            before
        );
        assert!(daemon.terminated.borrow().is_empty());
        assert!(daemon.spawned.borrow().is_empty());
    }

    #[test]
    fn mismatch_overwrites_canonical() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = TempDir::new();
        let bundled = fake_bin(&dir, "bundled", "2.0.0");
        let canonical = fake_bin(&dir, "canonical", "1.9.0");
        let daemon = FakeDaemon::default();

        let outcome = ensure_aligned_with(&bundled, &canonical, &daemon);

        assert_eq!(
            outcome,
            Alignment::Overwrote {
                from: Some("1.9.0".into()),
                to: "2.0.0".into(),
                restarted: false,
            }
        );
        assert_eq!(fs::read(&canonical).unwrap(), fs::read(&bundled).unwrap());
        assert_eq!(
            cli::version(&canonical, VERSION_TIMEOUT).as_deref(),
            Some("2.0.0")
        );
        let mode = fs::metadata(&canonical).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
        assert!(daemon.terminated.borrow().is_empty());
        assert!(daemon.spawned.borrow().is_empty());
    }

    #[test]
    fn missing_canonical_is_installed() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = TempDir::new();
        let bundled = fake_bin(&dir, "bundled", "2.0.0");
        let canonical = dir.join("bin/excali-bridge");
        let daemon = FakeDaemon::default();

        let outcome = ensure_aligned_with(&bundled, &canonical, &daemon);

        assert_eq!(
            outcome,
            Alignment::Overwrote {
                from: None,
                to: "2.0.0".into(),
                restarted: false,
            }
        );
        assert_eq!(fs::read(&canonical).unwrap(), fs::read(&bundled).unwrap());
    }

    #[test]
    fn running_daemon_is_terminated_and_respawned() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = TempDir::new();
        let bundled = fake_bin(&dir, "bundled", "2.0.0");
        let canonical = fake_bin(&dir, "canonical", "1.9.0");
        let daemon = FakeDaemon {
            pid: Some(4242),
            ..FakeDaemon::default()
        };

        let outcome = ensure_aligned_with(&bundled, &canonical, &daemon);

        assert_eq!(
            outcome,
            Alignment::Overwrote {
                from: Some("1.9.0".into()),
                to: "2.0.0".into(),
                restarted: true,
            }
        );
        assert_eq!(*daemon.terminated.borrow(), vec![4242]);
        assert_eq!(*daemon.spawned.borrow(), vec![canonical.clone()]);
    }

    #[test]
    fn env_override_skips_alignment() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = TempDir::new();
        let bundled = fake_bin(&dir, "bundled", "2.0.0");
        let canonical = fake_bin(&dir, "canonical", "1.9.0");
        let content = fs::read(&canonical).unwrap();
        env::set_var(OVERRIDE_ENV, &bundled);
        let daemon = FakeDaemon {
            pid: Some(4242),
            ..FakeDaemon::default()
        };

        let outcome = ensure_aligned_with(&bundled, &canonical, &daemon);
        env::remove_var(OVERRIDE_ENV);

        assert_eq!(outcome, Alignment::Skipped);
        assert_eq!(fs::read(&canonical).unwrap(), content);
        assert!(daemon.terminated.borrow().is_empty());
        assert!(daemon.spawned.borrow().is_empty());
    }

    #[test]
    fn unreadable_bundled_version_fails_without_touching_canonical() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = TempDir::new();
        let bundled = dir.join("bundled");
        fs::write(&bundled, "#!/bin/sh\nexit 1\n").unwrap();
        fs::set_permissions(&bundled, fs::Permissions::from_mode(0o755)).unwrap();
        let canonical = fake_bin(&dir, "canonical", "1.9.0");
        let content = fs::read(&canonical).unwrap();
        let daemon = FakeDaemon::default();

        let outcome = ensure_aligned_with(&bundled, &canonical, &daemon);

        assert!(matches!(outcome, Alignment::Failed(_)));
        assert_eq!(fs::read(&canonical).unwrap(), content);
    }

    #[test]
    fn state_dir_honours_env_override() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = TempDir::new();
        env::set_var("EXCALI_BRIDGE_STATE_DIR", &dir.path);
        let state = state_dir();
        env::remove_var("EXCALI_BRIDGE_STATE_DIR");
        assert_eq!(state, Ok(dir.path.clone()));
    }
}
