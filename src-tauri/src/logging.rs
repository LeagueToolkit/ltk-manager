use std::path::{Path, PathBuf};
#[cfg(debug_assertions)]
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

#[cfg(debug_assertions)]
pub fn init() -> LoggingGuards {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "ltk_manager=debug,ltk_overlay=info,tauri=info".into());

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
        .unwrap_or_else(|_| "ltk_manager=debug,ltk_overlay=info,tauri=info".into());

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

    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!(
            "Failed to create log directory {}: {}",
            log_dir.display(),
            e
        );
        return (None, None, None);
    }

    let file_appender = rolling::RollingFileAppender::builder()
        .rotation(rolling::Rotation::DAILY)
        .filename_prefix("ltk-manager")
        .filename_suffix("log")
        .build(&log_dir)
        .expect("failed to create log file appender");
    let (writer, guard) = non_blocking(file_appender);
    (Some(guard), Some(writer), Some(log_dir))
}

/// Delete log files older than `max_age_days` from the log directory.
pub fn cleanup_old_logs(log_dir: &Path, max_age_days: u64) {
    let max_age = Duration::from_secs(max_age_days * 24 * 60 * 60);

    let entries = match std::fs::read_dir(log_dir) {
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
            if let Err(e) = std::fs::remove_file(&path) {
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
