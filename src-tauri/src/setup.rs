use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_deep_link::DeepLinkExt;

use crate::deep_link::DeepLinkState;
use crate::mods::{LinkedBinState, ModLibrary, ModLibraryState, WadReportState};
use crate::patcher::PatcherState;
use crate::platform::LeagueInstall;
use crate::state::SettingsState;
use crate::workshop::{Workshop, WorkshopState};

pub fn run(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();

    #[cfg(debug_assertions)]
    {
        let logging_guards: tauri::State<'_, crate::logging::LoggingGuards> = app_handle.state();
        let _ = logging_guards.app_handle_holder.set(app_handle.clone());
    }

    let settings_state = SettingsState::new(&app_handle);
    let patcher_state = PatcherState::new();
    let mod_library = ModLibraryState(ModLibrary::new(&app_handle));
    let workshop = WorkshopState(Workshop::new(&app_handle));

    initialize_first_run(&app_handle, &settings_state);

    let settings = settings_state.0.lock().unwrap().clone();

    // Register WadReportState BEFORE reconcile so that the reconcile pass can
    // invalidate stale reports and prune orphans on the first startup.
    let storage_dir = mod_library.0.storage_dir(&settings).ok();
    let wad_report_state = WadReportState::new(storage_dir.as_deref());
    app.manage(wad_report_state);

    mod_library.0.reconcile_in_background(settings.clone());

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
    app.manage(LinkedBinState::default());
    app.manage(crate::strings::StringKeyIndexState::default());
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

    if settings.league_path.is_some() {
        tracing::info!("League path already configured, skipping auto-detection");
        return;
    }

    tracing::info!("Attempting auto-detection of League installation...");

    if let Some(install) = LeagueInstall::auto_detect() {
        tracing::info!("Auto-detected League at: {:?}", install.install_root);
        settings.league_path = Some(install.configured_root());
        settings.first_run_complete = true;

        if let Err(e) = crate::state::save_settings_to_disk(app_handle, &settings) {
            tracing::error!("Failed to save auto-detected settings: {}", e);
        }
    } else {
        tracing::info!("Auto-detection did not find League installation");
    }
}
