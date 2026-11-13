use fs_err as fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime};
use tracing_appender::{non_blocking, non_blocking::WorkerGuard, rolling};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Return value from logging initialization, holding guards that must live for the app lifetime.
pub struct LoggingGuards {
    pub _file_guard: Option<WorkerGuard>,
    pub log_path: Option<PathBuf>,
    #[cfg(debug_assertions)]
    pub app_handle_holder: Arc<OnceLock<tauri::AppHandle>>,
}

/// The filter that applies when `RUST_LOG` is not set. The leading `warn` is the level
/// for every target that no later directive names, which includes `panic` and `ui`.
const DEFAULT_FILTER: &str =
    "warn,ltk_manager=debug,ritoclient=debug,ritoclient_core=debug,ltk_overlay=info,tauri=info";

#[cfg(debug_assertions)]
pub fn init() -> LoggingGuards {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| DEFAULT_FILTER.into());

    let stdout_layer = tracing_subscriber::fmt::layer();
    let (file_guard, writer, log_path) = build_file_writer();

    let app_handle_holder = Arc::new(OnceLock::new());
    let tauri_log_layer = crate::log_layer::TauriLogLayer::new(app_handle_holder.clone());

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(stdout_layer)
        .with(tauri_log_layer);

    if let Some(writer) = writer {
        let file_layer = tracing_subscriber::fmt::layer()
            .with_writer(writer)
            .with_ansi(false);
        registry.with(file_layer).init();
    } else {
        registry.init();
    }

    LoggingGuards {
        _file_guard: file_guard,
        log_path,
        app_handle_holder,
    }
}

#[cfg(not(debug_assertions))]
pub fn init() -> LoggingGuards {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| DEFAULT_FILTER.into());

    let stdout_layer = tracing_subscriber::fmt::layer();
    let (file_guard, writer, log_path) = build_file_writer();

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(stdout_layer);

    if let Some(writer) = writer {
        let file_layer = tracing_subscriber::fmt::layer()
            .with_writer(writer)
            .with_ansi(false);
        registry.with(file_layer).init();
    } else {
        registry.init();
    }

    LoggingGuards {
        _file_guard: file_guard,
        log_path,
    }
}

fn build_file_writer() -> (
    Option<WorkerGuard>,
    Option<non_blocking::NonBlocking>,
    Option<PathBuf>,
) {
    let log_dir = match default_log_dir() {
        Some(d) => d,
        None => return (None, None, None),
    };

    if let Err(e) = fs::create_dir_all(&log_dir) {
        eprintln!(
            "Failed to create log directory {}: {}",
            log_dir.display(),
            e
        );
        return (None, None, None);
    }

    // Before the appender opens today's file, so that the rewrite can replace it.
    redact_existing_logs(&log_dir);

    let file_appender = rolling::RollingFileAppender::builder()
        .rotation(rolling::Rotation::DAILY)
        .filename_prefix("ltk-manager")
        .filename_suffix("log")
        .build(&log_dir)
        .expect("failed to create log file appender");
    let (writer, guard) = non_blocking(RedactingWriter(file_appender));
    (Some(guard), Some(writer), Some(log_dir))
}

/// Redacts each log event before `W` writes it.
///
/// The appender's worker thread calls `write` once for each event, with the whole event.
struct RedactingWriter<W>(W);

impl<W: Write> Write for RedactingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match std::str::from_utf8(buf) {
            Ok(text) => self.0.write_all(ltk_redact::redact(text).as_bytes())?,
            Err(_) => self.0.write_all(buf)?,
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

/// The file in the log directory that holds the ruleset version of the last rewrite.
const REDACTED_MARKER: &str = ".redacted";

/// Rewrites each log file in `log_dir` through the redactor, once for each ruleset version.
///
/// A release that did not redact the log wrote the existing files. Skips the rewrite if the
/// marker file holds the current ruleset version. Leaves a file unchanged if it cannot be
/// read or replaced, and then writes no marker, so the next start tries again.
fn redact_existing_logs(log_dir: &Path) {
    let marker = log_dir.join(REDACTED_MARKER);
    let current = ltk_redact::RULESET_VERSION.to_string();
    if fs::read_to_string(&marker).is_ok_and(|done| done.trim() == current) {
        return;
    }
    let Ok(entries) = fs::read_dir(log_dir) else {
        return;
    };

    let mut complete = true;
    for path in entries.flatten().map(|entry| entry.path()) {
        if !is_log_file(&path) {
            continue;
        }
        if let Err(e) = redact_log_file(&path) {
            eprintln!("Failed to redact log file {}: {}", path.display(), e);
            complete = false;
        }
    }
    if complete {
        let _ = fs::write(&marker, current);
    }
}

/// Rewrites the file at `path` through the redactor. Writes nothing if no line changes.
fn redact_log_file(path: &Path) -> std::io::Result<()> {
    let original = String::from_utf8_lossy(&fs::read(path)?).into_owned();
    let mut redacted = String::with_capacity(original.len());
    for line in original.split_inclusive('\n') {
        redacted.push_str(&ltk_redact::redact(line));
    }
    if redacted == original {
        return Ok(());
    }
    let temporary = path.with_extension("log.redacting");
    fs::write(&temporary, redacted)?;
    fs::rename(&temporary, path)
}

fn is_log_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("ltk-manager.") && name.ends_with(".log"))
}

/// Delete log files older than `max_age_days` from the log directory.
pub fn cleanup_old_logs(log_dir: &Path, max_age_days: u64) {
    let max_age = Duration::from_secs(max_age_days * 24 * 60 * 60);

    let entries = match fs::read_dir(log_dir) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("Failed to read log directory for cleanup: {}", e);
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if !file_name.starts_with("ltk-manager.") || !file_name.ends_with(".log") {
            continue;
        }

        let modified = match entry.metadata().and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let age = match SystemTime::now().duration_since(modified) {
            Ok(d) => d,
            Err(_) => continue,
        };

        if age > max_age {
            if let Err(e) = fs::remove_file(&path) {
                tracing::warn!("Failed to delete old log file {}: {}", path.display(), e);
            } else {
                tracing::info!("Deleted old log file: {}", path.display());
            }
        }
    }
}

pub(crate) fn default_log_dir() -> Option<PathBuf> {
    const IDENTIFIER: &str = "dev.leaguetoolkit.manager";

    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        return Some(PathBuf::from(appdata).join(IDENTIFIER).join("logs"));
    }

    #[cfg(target_os = "macos")]
    if let Ok(home) = std::env::var("HOME") {
        return Some(
            PathBuf::from(home)
                .join("Library")
                .join("Logs")
                .join(IDENTIFIER),
        );
    }

    #[cfg(target_os = "linux")]
    if let Ok(home) = std::env::var("HOME") {
        return Some(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join(IDENTIFIER)
                .join("logs"),
        );
    }

    Some(std::env::temp_dir().join("ltk-manager"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacting_writer_replaces_a_deep_link_payload() {
        let mut out = Vec::new();
        let event = b"INFO opened ltk://install?url=https://cdn.example.com/a.modpkg\n";
        let written = RedactingWriter(&mut out).write(event).unwrap();

        assert_eq!(written, event.len());
        assert_eq!(out, b"INFO opened ltk://install\n");
    }

    #[test]
    fn redact_existing_logs_rewrites_log_files_once() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("ltk-manager.2026-11-01.log");
        let other = dir.path().join("notes.txt");
        fs::write(&log, "GET https://a.example/b?sig=1\nplain line\n").unwrap();
        fs::write(&other, "https://a.example/b?sig=1").unwrap();

        redact_existing_logs(dir.path());

        assert_eq!(
            fs::read_to_string(&log).unwrap(),
            "GET https://a.example/b\nplain line\n"
        );
        assert_eq!(
            fs::read_to_string(&other).unwrap(),
            "https://a.example/b?sig=1"
        );

        fs::write(&log, "GET https://a.example/b?sig=2\n").unwrap();
        redact_existing_logs(dir.path());
        assert_eq!(
            fs::read_to_string(&log).unwrap(),
            "GET https://a.example/b?sig=2\n"
        );
    }
}
