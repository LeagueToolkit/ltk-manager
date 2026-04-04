#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tracing_appender::{non_blocking::WorkerGuard, rolling};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod commands;
mod deep_link;
mod error;
mod hotkeys;
mod legacy_patcher;
#[cfg(debug_assertions)]
mod log_layer;
mod mods;
mod overlay;
pub mod patcher;
mod state;
mod utils;
mod workshop;

use deep_link::DeepLinkState;
use mods::{ModLibrary, ModLibraryState};
use patcher::PatcherState;
use state::SettingsState;
use workshop::{Workshop, WorkshopState};

/// Perform first-run initialization:
/// - If league_path is not set, attempt auto-detection
/// - If auto-detection succeeds, save the path
fn initialize_first_run(app_handle: &tauri::AppHandle, settings_state: &SettingsState) {
    let mut settings = match settings_state.0.lock() {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to lock settings: {}", e);
            return;
        }
    };

    // Skip if league path is already configured
    if settings.league_path.is_some() {
        tracing::info!("League path already configured, skipping auto-detection");
        return;
    }

    tracing::info!("Attempting auto-detection of League installation...");

    // Use ltk_mod_core for detection
    if let Some(exe_path) = ltk_mod_core::auto_detect_league_path() {
        let path = std::path::Path::new(exe_path.as_str());

        // Navigate from "Game/League of Legends.exe" to installation root
        if let Some(install_root) = path.parent().and_then(|p| p.parent()) {
            tracing::info!("Auto-detected League at: {:?}", install_root);
            settings.league_path = Some(install_root.to_path_buf());
            settings.first_run_complete = true;

            // Persist the detected path
            if let Err(e) = state::save_settings_to_disk(app_handle, &settings) {
                tracing::error!("Failed to save auto-detected settings: {}", e);
            }
        }
    } else {
        tracing::info!("Auto-detection did not find League installation");
    }
}

fn main() {
    // Initialize logging (stdout + persistent file).
    //
    // If you need more/less verbosity at runtime, set `RUST_LOG`, e.g.:
    // - `RUST_LOG=ltk_manager=trace,tauri=info`
    // - `RUST_LOG=ltk_manager=debug,tauri=warn`
    #[cfg(debug_assertions)]
    let (_file_guard, log_path, app_handle_holder) = init_logging();
    #[cfg(not(debug_assertions))]
    let (_file_guard, log_path) = init_logging();

    tracing::info!("Starting LTK Manager v{}", env!("CARGO_PKG_VERSION"));
    if let Some(ref p) = log_path {
        tracing::info!("Log directory: {}", p.display());
        cleanup_old_logs(p, 7);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // When a second instance is launched with a deep-link URL, forward it here
            handle_deep_link_argv(app, &argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(move |app| {
            let app_handle = app.handle();

            // Populate the app handle for the log layer in debug builds
            #[cfg(debug_assertions)]
            let _ = app_handle_holder.set(app_handle.clone());

            // Create individual states
            let settings_state = SettingsState::new(app_handle);
            let patcher_state = PatcherState::new();
            let mod_library = ModLibraryState(ModLibrary::new(app_handle));
            let workshop = WorkshopState(Workshop::new(app_handle));

            // Run first-run initialization (auto-detect League path)
            initialize_first_run(app_handle, &settings_state);

            // Reconcile library index (clean up orphaned mod entries from disk changes)
            {
                let settings = settings_state.0.lock().unwrap();
                match mod_library.0.reconcile_index(&settings) {
                    Ok(true) => tracing::info!("Library index reconciled on startup"),
                    Ok(false) => {}
                    Err(e) => tracing::warn!("Failed to reconcile library on startup: {}", e),
                }
            }

            // Register persisted global hotkeys
            let hotkey_manager = hotkeys::HotkeyManager::new(app_handle);
            {
                let settings = settings_state.0.lock().unwrap();
                hotkey_manager.register_from_settings(&settings);
            }

            // Sync OS autolaunch with the saved setting
            {
                let settings = settings_state.0.lock().unwrap();
                let autolaunch = app_handle.autolaunch();
                if settings.auto_run {
                    let _ = autolaunch.enable();
                } else {
                    let _ = autolaunch.disable();
                }
            }

            let deep_link_state = DeepLinkState::new();

            // Manage each state separately
            app.manage(settings_state);
            app.manage(patcher_state);
            app.manage(mod_library);
            app.manage(workshop);
            app.manage(hotkey_manager);
            app.manage(deep_link_state);

            // Set up system tray icon
            let show_item = MenuItem::with_id(app, "show", "Show Manager", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("LTK Manager")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Watch archives/mods directories for external changes (if enabled)
            {
                let settings_state: tauri::State<'_, SettingsState> = app_handle.state();
                let settings = settings_state.0.lock().unwrap();
                if settings.watcher_enabled {
                    mods::watcher::start_library_watcher(app_handle);
                }
            }

            // Hide the main window on startup if start_in_tray or start_in_tray_unless_update is enabled
            {
                let settings_state: tauri::State<'_, SettingsState> = app_handle.state();
                let settings = settings_state.0.lock().unwrap();
                if settings.start_in_tray || settings.start_in_tray_unless_update {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }

            // Check for deep-link URLs passed at launch
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                handle_deep_link_urls(app_handle, &urls);
            }

            // Listen for deep-link URLs received while app is running
            let handle_clone = app_handle.clone();
            app.deep_link().on_open_url(move |event| {
                handle_deep_link_urls(&handle_clone, &event.urls());
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // App
            commands::get_app_info,
            // Settings
            commands::get_settings,
            commands::save_settings,
            commands::auto_detect_league_path,
            commands::validate_league_path,
            commands::check_setup_required,
            // Mods
            commands::get_installed_mods,
            commands::install_mod,
            commands::install_mods,
            commands::uninstall_mod,
            commands::toggle_mod,
            commands::set_mod_layers,
            commands::enable_mod_with_layers,
            commands::inspect_modpkg,
            commands::get_mod_thumbnail,
            commands::get_storage_directory,
            commands::reorder_mods,
            // Folders
            commands::get_folders,
            commands::get_folder_order,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_mod_to_folder,
            commands::toggle_folder,
            commands::reorder_folder_mods,
            commands::reorder_folders,
            // Migration
            commands::scan_cslol_mods,
            commands::import_cslol_mods,
            // Patcher
            commands::start_patcher,
            commands::stop_patcher,
            commands::get_patcher_status,
            // Hotkeys
            commands::pause_hotkeys,
            commands::resume_hotkeys,
            commands::set_hotkey,
            commands::hot_reload_mods,
            commands::kill_league,
            // Profiles
            commands::list_mod_profiles,
            commands::get_active_mod_profile,
            commands::create_mod_profile,
            commands::delete_mod_profile,
            commands::switch_mod_profile,
            commands::rename_mod_profile,
            // Shell
            commands::reveal_in_explorer,
            commands::minimize_to_tray,
            // Workshop
            commands::get_workshop_projects,
            commands::create_workshop_project,
            commands::get_workshop_project,
            commands::save_project_config,
            commands::rename_workshop_project,
            commands::delete_workshop_project,
            commands::pack_workshop_project,
            commands::import_from_modpkg,
            commands::peek_fantome,
            commands::import_from_fantome,
            commands::import_from_git_repo,
            commands::validate_project,
            commands::set_project_thumbnail,
            commands::remove_project_thumbnail,
            commands::get_project_thumbnail,
            commands::save_layer_string_overrides,
            commands::create_project_layer,
            commands::delete_project_layer,
            commands::reorder_project_layers,
            commands::update_layer_description,
            // Deep Link
            commands::deep_link_install_mod,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Process deep-link URLs and emit events to the frontend.
fn handle_deep_link_urls(app_handle: &tauri::AppHandle, urls: &[url::Url]) {
    for url in urls {
        handle_single_deep_link(app_handle, url.as_str());
    }
}

/// Process deep-link URLs from CLI argv (used by single-instance callback).
fn handle_deep_link_argv(app_handle: &tauri::AppHandle, argv: &[String]) {
    for arg in argv.iter().skip(1) {
        if arg.starts_with("ltk://") {
            handle_single_deep_link(app_handle, arg);
        }
    }

    // Focus the existing window
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn handle_single_deep_link(app_handle: &tauri::AppHandle, raw_url: &str) {
    tracing::info!("Received deep-link: {}", raw_url);

    let deep_link_state: tauri::State<'_, DeepLinkState> = app_handle.state();
    if deep_link_state.should_rate_limit() {
        tracing::warn!("Deep-link rate-limited, ignoring: {}", raw_url);
        return;
    }

    match deep_link::parse_deep_link_url(raw_url) {
        Ok(request) => {
            tracing::info!("Parsed deep-link install request: {:?}", request);

            let settings_state: tauri::State<'_, SettingsState> = app_handle.state();
            if let Ok(settings) = settings_state.0.lock() {
                if !deep_link::is_domain_trusted(&request.url, &settings.trusted_domains) {
                    let domain = url::Url::parse(&request.url)
                        .ok()
                        .and_then(|u| u.host_str().map(String::from))
                        .unwrap_or_default();
                    tracing::warn!("Deep-link blocked: domain '{}' not in trusted list", domain);
                    let _ = app_handle.emit(
                        "deep-link-blocked",
                        serde_json::json!({
                            "domain": domain,
                            "url": request.url,
                        }),
                    );
                    return;
                }
            }

            let _ = app_handle.emit("deep-link-install", &request);
        }
        Err(e) => {
            tracing::error!("Failed to parse deep-link URL: {}", e);
        }
    }
}

#[cfg(debug_assertions)]
fn init_logging() -> (
    Option<WorkerGuard>,
    Option<std::path::PathBuf>,
    std::sync::Arc<std::sync::OnceLock<tauri::AppHandle>>,
) {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "ltk_manager=debug,ltk_overlay=info,tauri=info".into());

    let stdout_layer = tracing_subscriber::fmt::layer();

    let (file_guard, file_layer, log_path) = match default_log_dir() {
        Some(log_dir) => {
            if let Err(e) = std::fs::create_dir_all(&log_dir) {
                eprintln!(
                    "Failed to create log directory {}: {}",
                    log_dir.display(),
                    e
                );
                (None, None, None)
            } else {
                let file_appender = rolling::RollingFileAppender::builder()
                    .rotation(rolling::Rotation::DAILY)
                    .filename_prefix("ltk-manager")
                    .filename_suffix("log")
                    .build(&log_dir)
                    .expect("failed to create log file appender");
                let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
                let layer = tracing_subscriber::fmt::layer()
                    .with_writer(non_blocking)
                    .with_ansi(false);
                (Some(guard), Some(layer), Some(log_dir))
            }
        }
        None => (None, None, None),
    };

    let app_handle_holder = std::sync::Arc::new(std::sync::OnceLock::new());
    let tauri_log_layer = log_layer::TauriLogLayer::new(app_handle_holder.clone());

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(stdout_layer)
        .with(tauri_log_layer);
    if let Some(layer) = file_layer {
        registry.with(layer).init();
    } else {
        registry.init();
    }

    (file_guard, log_path, app_handle_holder)
}

#[cfg(not(debug_assertions))]
fn init_logging() -> (Option<WorkerGuard>, Option<std::path::PathBuf>) {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "ltk_manager=debug,ltk_overlay=info,tauri=info".into());

    let stdout_layer = tracing_subscriber::fmt::layer();

    let (file_guard, file_layer, log_path) = match default_log_dir() {
        Some(log_dir) => {
            if let Err(e) = std::fs::create_dir_all(&log_dir) {
                eprintln!(
                    "Failed to create log directory {}: {}",
                    log_dir.display(),
                    e
                );
                (None, None, None)
            } else {
                let file_appender = rolling::RollingFileAppender::builder()
                    .rotation(rolling::Rotation::DAILY)
                    .filename_prefix("ltk-manager")
                    .filename_suffix("log")
                    .build(&log_dir)
                    .expect("failed to create log file appender");
                let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
                let layer = tracing_subscriber::fmt::layer()
                    .with_writer(non_blocking)
                    .with_ansi(false);
                (Some(guard), Some(layer), Some(log_dir))
            }
        }
        None => (None, None, None),
    };

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(stdout_layer);
    if let Some(layer) = file_layer {
        registry.with(layer).init();
    } else {
        registry.init();
    }

    (file_guard, log_path)
}

/// Delete log files older than `max_age_days` from the log directory.
fn cleanup_old_logs(log_dir: &std::path::Path, max_age_days: u64) {
    let max_age = std::time::Duration::from_secs(max_age_days * 24 * 60 * 60);

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

        // Only target dated log files (e.g. "ltk-manager.2026-02-17.log")
        if !file_name.starts_with("ltk-manager.") || !file_name.ends_with(".log") {
            continue;
        }

        let modified = match entry.metadata().and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let age = match std::time::SystemTime::now().duration_since(modified) {
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

pub(crate) fn default_log_dir() -> Option<std::path::PathBuf> {
    // Match `tauri.conf.json` identifier so logs sit next to `settings.json` on Windows.
    const IDENTIFIER: &str = "dev.leaguetoolkit.manager";

    if let Ok(appdata) = std::env::var("APPDATA") {
        return Some(
            std::path::PathBuf::from(appdata)
                .join(IDENTIFIER)
                .join("logs"),
        );
    }

    // Best-effort fallback for non-Windows environments.
    if let Ok(home) = std::env::var("HOME") {
        return Some(
            std::path::PathBuf::from(home)
                .join(".local")
                .join("share")
                .join(IDENTIFIER)
                .join("logs"),
        );
    }

    Some(std::env::temp_dir().join("ltk-manager"))
}
