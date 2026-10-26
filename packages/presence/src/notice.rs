//! Outcome notices for user-initiated actions.
//!
//! A tray menu gives no place to report back: the row flips, and if the flip is
//! wrong the user is left guessing whether the click registered. Every action
//! that can fail therefore ends in one of these — success or failure, never
//! silence.
//!
//! macOS posts a real notification through the (soft-deprecated but still
//! delivered) NSUserNotification API. UserNotifications would be the modern
//! choice, but it refuses to deliver from an ad-hoc-signed binary without a
//! registered bundle identifier — which is exactly what an ADR 0014 build is.
//! NSUserNotification works from a plain executable, so users actually see the
//! outcome. The `[presence]` log line is written either way, and failing to
//! notify never fails the action that produced it.

/// How an action ended.
pub enum Outcome {
    Ok(String),
    Failed(String),
}

impl Outcome {
    pub fn ok(message: impl Into<String>) -> Self {
        Outcome::Ok(message.into())
    }

    pub fn failed(message: impl Into<String>) -> Self {
        Outcome::Failed(message.into())
    }

    pub fn message(&self) -> &str {
        match self {
            Outcome::Ok(message) | Outcome::Failed(message) => message,
        }
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, Outcome::Ok(_))
    }
}

/// Announce an outcome. Never panics, never blocks longer than the OS call.
pub fn announce(title: &str, outcome: &Outcome) {
    log_outcome(title, outcome);
    post(title, outcome);
}

/// Write the outcome to the log without posting a notification.
///
/// Separate from [`announce`] because posting is main-thread-only on macOS while
/// the action runs on a worker thread: the worker logs, then hands the notice to
/// the event loop, which posts it from the main thread. Logging from the worker
/// keeps the record even if the app exits before the UI turn arrives.
pub fn log_outcome(title: &str, outcome: &Outcome) {
    let prefix = if outcome.is_ok() { "" } else { "failed: " };
    sidecar_log(&format!("{title}: {prefix}{}", outcome.message()));
}

/// Post an already-logged outcome. Main thread only on macOS.
pub fn post(title: &str, outcome: &Outcome) {
    post_impl(title, outcome);
}

#[cfg(target_os = "macos")]
#[allow(deprecated)] // deliberate: see the module docs on why not UserNotifications
fn post_impl(title: &str, outcome: &Outcome) {
    use objc2_foundation::{
        NSString, NSUserNotification, NSUserNotificationCenter, NSUserNotificationDefaultSoundName,
    };

    // Silently returning here was the original bug: the action's worker thread
    // called announce(), this guard bailed, and the log line was the only trace
    // — the user saw nothing. Callers now post from the event loop instead, so
    // reaching this branch means someone skipped that step.
    let Some(_mtm) = objc2::MainThreadMarker::new() else {
        sidecar_log(&format!(
            "{title}: not posted — notifications must be delivered from the main thread"
        ));
        return;
    };
    objc2::rc::autoreleasepool(|_pool| unsafe {
        let notification = NSUserNotification::new();
        let title_text = NSString::from_str(title);
        let body_text = NSString::from_str(outcome.message());
        notification.setTitle(Some(&title_text));
        notification.setInformativeText(Some(&body_text));
        // Success is ambient (no sound); a failure is worth a nudge.
        if !outcome.is_ok() {
            notification.setSoundName(Some(NSUserNotificationDefaultSoundName));
        }
        NSUserNotificationCenter::defaultUserNotificationCenter()
            .deliverNotification(&notification);
    });
}

#[cfg(not(target_os = "macos"))]
fn post_impl(_title: &str, _outcome: &Outcome) {}

fn sidecar_log(message: &str) {
    crate::sidecar::log(message);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcome_keeps_its_message() {
        let ok = Outcome::ok("Daemon started (port 17331)");
        assert!(ok.is_ok());
        assert_eq!(ok.message(), "Daemon started (port 17331)");

        let failed = Outcome::failed("cannot reach the CLI");
        assert!(!failed.is_ok());
        assert_eq!(failed.message(), "cannot reach the CLI");
    }
}
