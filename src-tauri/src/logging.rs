use fs_err as fs;
use ltk_manager_core::log_dir::LogDir;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tracing_appender::{non_blocking, non_blocking::WorkerGuard, rolling};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Return value from logging initialization, holding guards that must live for the app lifetime.
pub struct LoggingGuards {
    pub _file_guard: Option<WorkerGuard>,
    pub log_dir: Option<LogDir>,
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
    let (file_guard, writer, log_dir) = build_file_writer();

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
        log_dir,
        app_handle_holder,
    }
}

#[cfg(not(debug_assertions))]
pub fn init() -> LoggingGuards {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| DEFAULT_FILTER.into());

    let stdout_layer = tracing_subscriber::fmt::layer();
    let (file_guard, writer, log_dir) = build_file_writer();

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
        log_dir,
    }
}

fn build_file_writer() -> (
    Option<WorkerGuard>,
    Option<non_blocking::NonBlocking>,
    Option<LogDir>,
) {
    let log_dir = match default_log_dir() {
        Some(d) => d,
        None => return (None, None, None),
    };

    if let Err(e) = fs::create_dir_all(log_dir.path()) {
        eprintln!(
            "Failed to create log directory {}: {}",
            log_dir.path().display(),
            e
        );
        return (None, None, None);
    }

    // Before the appender opens today's file, so that the rewrite can replace it.
    log_dir.redact_existing();

    let file_appender = rolling::RollingFileAppender::builder()
        .rotation(rolling::Rotation::DAILY)
        .filename_prefix(LogDir::FILE_PREFIX)
        .filename_suffix(LogDir::FILE_SUFFIX)
        .build(log_dir.path())
        .expect("failed to create log file appender");
    let (writer, guard) = non_blocking(ltk_redact::RedactingWriter::new(file_appender));
    (Some(guard), Some(writer), Some(log_dir))
}

pub(crate) fn default_log_dir() -> Option<LogDir> {
    const IDENTIFIER: &str = "dev.leaguetoolkit.manager";

    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        return Some(LogDir::new(
            PathBuf::from(appdata).join(IDENTIFIER).join("logs"),
        ));
    }

    #[cfg(target_os = "macos")]
    if let Ok(home) = std::env::var("HOME") {
        return Some(LogDir::new(
            PathBuf::from(home)
                .join("Library")
                .join("Logs")
                .join(IDENTIFIER),
        ));
    }

    #[cfg(target_os = "linux")]
    if let Ok(home) = std::env::var("HOME") {
        return Some(LogDir::new(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join(IDENTIFIER)
                .join("logs"),
        ));
    }

    Some(LogDir::new(std::env::temp_dir().join("ltk-manager")))
}
