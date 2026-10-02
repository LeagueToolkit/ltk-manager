#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod deep_link;
mod error;
mod events;
mod hotkeys;
mod ipc;
#[cfg(debug_assertions)]
mod log_layer;
mod logging;
mod mods;
pub mod patcher;
mod protocol;
mod services;
mod setup;
mod state;
mod telemetry;
mod tray;
mod updater;
mod workshop;

use ltk_manager_core::bin_document::BinDocuments;
use semver::Version;
use tauri::webview::PageLoadEvent;
use tauri::Manager;

/// The one window the frontend runs in, as `tauri.conf.json` leaves it unlabelled.
const MAIN_WINDOW: &str = "main";

/// The version this build runs at.
fn running_version() -> Version {
    Version::parse(env!("CARGO_PKG_VERSION"))
        .expect("CARGO_PKG_VERSION is semver, since cargo refuses a manifest whose version is not")
}

fn main() {
    // Before logging, so a panic while that is still being set up is reported.
    telemetry::install_panic_hook();

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
        .plugin(tauri_plugin_clipboard_manager::init())
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
        )
        .plugin(services::app_update::plugin())
        .plugin(services::atlas::plugin())
        .plugin(services::bin::plugin())
        .plugin(services::game::plugin())
        .plugin(services::library::plugin())
        .plugin(services::objects::plugin())
        .plugin(services::preview::plugin())
        .plugin(services::settings::plugin())
        .plugin(services::patcher::plugin())
        .plugin(services::launcher::plugin())
        .plugin(services::diagnostics::plugin())
        .plugin(services::hotkeys::plugin())
        .plugin(services::workshop::plugin());

    builder
        /* The preview's pixels come this way rather than over IPC, so an
        `<img>` draws them with the webview's own decoder. */
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            // A decode is tens of milliseconds, and this handler is the main thread.
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(protocol::answer(&app, &request));
            });
        })
        .manage(logging_guards)
        .setup(setup::run)
        /* A reload runs no cleanup, so the handles the last page held are dropped here,
        before the new page can open any. */
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Started || webview.label() != MAIN_WINDOW {
                return;
            }
            if let Some(documents) = webview.try_state::<BinDocuments>() {
                documents.close_all();
            }
            if let Some(watches) = webview.try_state::<workshop::LayerWatches>() {
                watches.release_all();
            }
        })
        .invoke_handler(ipc::invoke_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(setup::handle_run_event);
}
