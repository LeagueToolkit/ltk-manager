#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod deep_link;
mod error;
mod events;
mod hotkeys;
#[cfg(debug_assertions)]
mod log_layer;
mod logging;
mod mods;
pub mod patcher;
mod protocol;
mod setup;
mod state;
mod tray;
mod workshop;

fn main() {
    let logging_guards = logging::init();

    tracing::info!("Starting LTK Manager v{}", env!("CARGO_PKG_VERSION"));
    if let Some(ref p) = logging_guards.log_path {
        tracing::info!("Log directory: {}", p.display());
        logging::cleanup_old_logs(p, 7);
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            deep_link::handle_argv(app, &argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            // Persisting visibility state breaks the start-in-tray option
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        );

    builder
        /* The preview's pixels come this way rather than over IPC, so an
        `<img>` draws them with the webview's own decoder. */
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            // A decode is tens of milliseconds, and this handler is the main thread.
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(protocol::serve(&app, &request));
            });
        })
        .manage(logging_guards)
        .setup(setup::run)
        .invoke_handler(tauri::generate_handler![
            // App
            commands::get_app_info,
            commands::get_platform_support,
            commands::show_main_window,
            commands::prepare_for_update,
            // Settings
            commands::get_settings,
            commands::save_settings,
            commands::get_default_settings,
            commands::auto_detect_league_path,
            commands::validate_league_path,
            commands::check_setup_required,
            commands::detect_league_run_as_admin,
            commands::list_available_wads,
            // Mods
            commands::get_installed_mods,
            commands::install_mod,
            commands::install_mods,
            commands::uninstall_mod,
            commands::toggle_mod,
            commands::set_mod_layers,
            commands::enable_mod_with_layers,
            commands::edit_mod_metadata,
            commands::set_mod_storage,
            commands::check_mod_health,
            commands::repair_mod,
            commands::repair_mods,
            commands::get_mod_health_verdicts,
            #[cfg(debug_assertions)]
            commands::time_mod_health,
            commands::cancel_mod_health_run,
            commands::get_health_sweep,
            commands::inspect_modpkg,
            commands::get_mod_thumbnail,
            commands::get_storage_directory,
            commands::reorder_mods,
            commands::get_mod_wad_report,
            commands::get_all_mod_wad_reports,
            commands::analyze_mod_wads,
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
            commands::get_layout_migration_state,
            // Patcher
            commands::start_patcher,
            commands::stop_patcher,
            commands::rebuild_overlay,
            commands::get_patcher_status,
            commands::get_linked_bin_offenders,
            // Launcher
            commands::launch_league,
            commands::cancel_launch,
            commands::stop_league,
            commands::get_launch_availability,
            commands::get_league_session,
            // Hotkeys
            commands::pause_hotkeys,
            commands::resume_hotkeys,
            commands::set_hotkey,
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
            // Storage
            commands::detect_storage_medium,
            // Diagnostics
            commands::run_diagnostics,
            commands::open_elevated_terminal,
            commands::list_incidents,
            commands::dismiss_incident,
            commands::reveal_game_log,
            commands::incident_report,
            commands::incident_token,
            commands::decode_incident_token,
            // Workshop
            commands::get_workshop_projects,
            commands::create_workshop_project,
            commands::get_workshop_project,
            commands::get_project_content_tree,
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
            commands::search_string_keys,
            commands::lookup_string_values,
            commands::get_layer_content_path,
            commands::get_layer_info,
            commands::create_project_layer,
            commands::rename_project_layer,
            commands::delete_project_layer,
            commands::reorder_project_layers,
            commands::update_layer_description,
            commands::add_files_to_layer,
            commands::delete_layer_content,
            commands::get_project_editor_state,
            commands::save_project_editor_state,
            // Problems
            commands::analyze_project,
            commands::fix_problems,
            // Hashtables
            commands::get_hashtable_cache_status,
            commands::check_hashtable_updates,
            commands::sync_hashtables,
            // Game WADs
            commands::get_game_wads,
            commands::read_game_wad,
            // Game index
            commands::get_game_index,
            commands::read_game_dir,
            commands::refresh_game_index,
            commands::search_game_index,
            commands::find_in_game_index,
            // Extract to disk
            commands::plan_game_extract,
            commands::extract_game_files,
            commands::cancel_extract,
            // Asset preview
            commands::read_asset_info,
            commands::save_asset_copy,
            // Ritobin
            commands::detect_ritobin_integration,
            commands::open_asset_in_ritobin,
            // Deep Link
            commands::deep_link_install_mod,
            commands::take_pending_deep_link,
            // for dynamic icons
            tray::set_tray_state,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(setup::handle_run_event);
}
