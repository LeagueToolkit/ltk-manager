use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_deep_link::DeepLinkExt;

use crate::deep_link::DeepLinkState;
use crate::events::TauriEventSink;
use crate::mods::{LinkedBinState, ModLibrary, ModLibraryState, WadReportState};
use crate::patcher::{PatcherHostState, PatcherState};
use crate::state::SettingsState;
use crate::workshop::{Workshop, WorkshopState};
use ltk_manager_core::events::EventSink;
use std::sync::Arc;

pub fn run(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();

    #[cfg(debug_assertions)]
    {
        let logging_guards: tauri::State<'_, crate::logging::LoggingGuards> = app_handle.state();
        let _ = logging_guards.app_handle_holder.set(app_handle.clone());
    }

    let settings_state = SettingsState::new(&app_handle);
    let patcher_state = PatcherState::new();
    let events: Arc<dyn EventSink> = Arc::new(TauriEventSink::new(app_handle.clone()));
    let workshop = WorkshopState(Workshop::new(Arc::clone(&events)));

    initialize_first_run(&app_handle, &settings_state);

    let settings = settings_state.0.lock().unwrap().clone();

    // The library owns these stores; `manage` below registers the same `Arc`s so
    // commands can reach them. Constructing them here (rather than having the
    // library fetch them) is what removed the old "must be managed before
    // reconcile" ordering constraint.
    let default_storage_dir = crate::state::get_app_data_dir(&app_handle);
    let storage_dir = settings
        .config
        .mod_storage_path
        .clone()
        .or_else(|| default_storage_dir.clone());
    let wad_reports = Arc::new(WadReportState::new(storage_dir.as_deref()));
    let linked_bins = Arc::new(LinkedBinState::default());

    let mod_library = ModLibraryState(ModLibrary::new(
        Arc::clone(&events),
        default_storage_dir,
        env!("CARGO_PKG_VERSION"),
        Arc::clone(&linked_bins),
        Arc::clone(&wad_reports),
    ));

    mod_library
        .0
        .reconcile_in_background(settings.config.clone());

    let hotkey_manager = crate::hotkeys::HotkeyManager::new(&app_handle);
    hotkey_manager.register_from_settings(&settings);

    let autolaunch = app_handle.autolaunch();
    if settings.auto_run {
        let _ = autolaunch.enable();
    } else {
        let _ = autolaunch.disable();
    }

    let deep_link_state = DeepLinkState::new();

    app.manage(settings_state);
    app.manage(patcher_state);
    app.manage(PatcherHostState::default());
    app.manage(crate::commands::launcher::LaunchState::default());
    app.manage(linked_bins);
    app.manage(wad_reports);
    app.manage(ltk_manager_core::strings::StringKeyIndexState::default());
    app.manage(ltk_manager_core::game_index::GameIndexState::default());
    app.manage(ltk_manager_core::game_wads::WadCache::default());
    app.manage(mod_library);
    app.manage(workshop);
    app.manage(hotkey_manager);
    app.manage(deep_link_state);

    crate::tray::setup(app)?;

    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_decorations(true);
        }
    }

    {
        let settings_state: tauri::State<'_, SettingsState> = app_handle.state();
        let settings = settings_state.0.lock().unwrap();
        if settings.watcher_enabled {
            crate::mods::watcher::start_library_watcher(&app_handle);
        }
    }

    if let Ok(Some(urls)) = app.deep_link().get_current() {
        crate::deep_link::handle_urls(&app_handle, &urls);
    }

    let handle_clone = app_handle.clone();
    app.deep_link().on_open_url(move |event| {
        crate::deep_link::handle_urls(&handle_clone, &event.urls());
    });

    Ok(())
}

/// Runtime event hook for [`tauri::App::run`].
pub fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Exit = event {
        crate::patcher::shutdown_resources(app_handle);
    }
}

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

    if settings.config.league_path.is_some() {
        tracing::info!("League path already configured, skipping auto-detection");
        return;
    }

    tracing::info!("Attempting auto-detection of League installation...");

    if let Some(exe_path) = ltk_mod_core::auto_detect_league_path() {
        let path = std::path::Path::new(exe_path.as_str());

        if let Some(install_root) = path.parent().and_then(|p| p.parent()) {
            tracing::info!("Auto-detected League at: {:?}", install_root);
            settings.config.league_path = Some(install_root.to_path_buf());
            settings.first_run_complete = true;

            if let Err(e) = crate::state::persist_settings(app_handle, &settings) {
                tracing::error!("Failed to save auto-detected settings: {}", e);
            }
        }
    } else {
        tracing::info!("Auto-detection did not find League installation");
    }
}
