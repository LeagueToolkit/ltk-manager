use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_deep_link::DeepLinkExt;

use crate::commands::launcher::LauncherState;
use crate::deep_link::DeepLinkState;
use crate::events::TauriEventSink;
use crate::mods::{
    ChecksumMismatchState, LinkedBinState, ModLibrary, ModLibraryState, WadReportState,
};
use crate::patcher::{PatcherHostState, PatcherState};
use crate::state::{IncidentStoreState, SettingsState};
use crate::workshop::{Workshop, WorkshopState};
use ltk_manager_core::diagnostics::store::IncidentStore;
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

    let settings = settings_state.0.lock().clone();

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
    let incidents_dir = match &default_storage_dir {
        Some(dir) => dir.join("incidents"),
        None => {
            tracing::warn!("No app data directory, keeping incidents under the temp directory");
            std::env::temp_dir()
                .join("dev.leaguetoolkit.manager")
                .join("incidents")
        }
    };
    let incident_store = IncidentStoreState(Arc::new(
        IncidentStore::new(incidents_dir).with_keep(settings.config.keep_incidents as usize),
    ));
    let linked_bins = Arc::new(LinkedBinState::default());
    let checksum_mismatches = Arc::new(ChecksumMismatchState::default());
    // The library unpacks fantome archives, which needs the same chunk names
    // the browser resolves with, so both hold this one handle.
    let wad_resolver = Arc::new(ltk_manager_core::hashtables::WadPathResolverState::default());

    let mod_library = ModLibraryState(ModLibrary::new(
        Arc::clone(&events),
        default_storage_dir,
        env!("CARGO_PKG_VERSION"),
        Arc::clone(&linked_bins),
        Arc::clone(&checksum_mismatches),
        Arc::clone(&wad_reports),
        Arc::clone(&wad_resolver),
    ));

    let library = mod_library.0.clone();

    let hotkey_manager = crate::hotkeys::HotkeyManager::new(&app_handle);
    hotkey_manager.register_from_settings(&settings);

    let autolaunch = app_handle.autolaunch();
    if settings.auto_run {
        let _ = autolaunch.enable();
    } else {
        let _ = autolaunch.disable();
    }

    let deep_link_state = DeepLinkState::new();

    let launcher_state = LauncherState::new(&app_handle, &settings.config)?;
    let launcher = Arc::clone(launcher_state.launcher());

    app.manage(settings_state);
    app.manage(patcher_state);
    app.manage(PatcherHostState::default());
    app.manage(incident_store);
    app.manage(launcher_state);
    app.manage(crate::commands::launcher::LaunchState::default());
    app.manage(linked_bins);
    app.manage(checksum_mismatches);
    app.manage(wad_reports);
    app.manage(ltk_manager_core::strings::StringKeyIndexState::default());
    app.manage(ltk_manager_core::game_index::GameIndexState::default());
    app.manage(wad_resolver);
    app.manage(ltk_manager_core::game_index::SearchGeneration::default());
    app.manage(ltk_manager_core::game_index::FindGeneration::default());
    app.manage(ltk_manager_core::game_wads::WadCache::default());
    app.manage(crate::commands::ObjectIndexState::default());
    app.manage(ltk_manager_core::object_index::ObjectSearchGeneration::default());
    app.manage(ltk_manager_core::object_index::ObjectFindGeneration::default());
    app.manage(ltk_manager_core::object_index::ObjectReferenceGeneration::default());
    app.manage(ltk_manager_core::problems::ProblemsState::default());
    app.manage(ltk_manager_core::bin_document::BinDocuments::default());
    app.manage(ltk_manager_core::hashtables::BinHashTablesState::default());
    app.manage(crate::commands::ExtractState::default());
    app.manage(mod_library);
    app.manage(workshop);
    app.manage(hotkey_manager);
    app.manage(deep_link_state);

    // Started below the `manage` calls rather than beside the library it
    // maintains: its hashtable sync ends by dropping what the app read out of
    // the tables it replaced, and `state` on an unmanaged one is a panic.
    let for_tables = app_handle.clone();
    library.maintain_in_background(settings.config.clone(), move || {
        crate::commands::hashtables::reopen_after_sync(&for_tables);
    });

    crate::tray::setup(app)?;

    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_decorations(true);
        }
    }

    {
        let settings_state: tauri::State<'_, SettingsState> = app_handle.state();
        let settings = settings_state.0.lock();
        if settings.watcher_enabled {
            crate::mods::watcher::start_library_watcher(&app_handle);
        }
    }

    // A game outlives the manager and the session id following it does not, so
    // the watcher is put back on it here. Off the setup path because it asks the
    // Riot Client, which may be mid-boot. The frontend asks for the same thing
    // when it mounts, which is what gets a session already in progress onto the
    // status bar - this only guarantees something is following it.
    std::thread::spawn(move || {
        launcher.follow_current_session();
    });

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

        // The session watcher ends on its own, but the window hider polls for
        // five minutes waiting for a game that will never come now.
        let launcher: tauri::State<'_, LauncherState> = app_handle.state();
        launcher.launcher().shutdown();
    }
}

/// Perform first-run initialization:
/// - If league_path is not set, attempt auto-detection
/// - If auto-detection succeeds, save the path
fn initialize_first_run(app_handle: &tauri::AppHandle, settings_state: &SettingsState) {
    let mut settings = settings_state.0.lock();

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
