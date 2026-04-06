#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod deep_link;
mod error;
mod hotkeys;
mod legacy_patcher;
#[cfg(debug_assertions)]
mod log_layer;
mod logging;
mod mods;
mod overlay;
pub mod patcher;
mod setup;
mod state;
mod tray;
mod utils;
mod workshop;

fn main() {
    let logging_guards = logging::init();

    tracing::info!("Starting LTK Manager v{}", env!("CARGO_PKG_VERSION"));
    if let Some(ref p) = logging_guards.log_path {
        tracing::info!("Log directory: {}", p.display());
        logging::cleanup_old_logs(p, 7);
    }

    tauri::Builder::default()
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
        .manage(logging_guards)
        .setup(setup::run)
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
            // for dynamic icons
            tray::set_tray_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
