//! The links service: installing the mod an `ltk://` link names, and the link or mod files that
//! arrived before the frontend listened.

use ltk_manager_core::deep_link::install_list::{fetch_install_list, InstallList};
use ltk_manager_core::deep_link::{self, DeepLinkRequest};

use crate::deep_link::files::{self, FilesOpened};
use crate::deep_link::install_list::{self as list_run, InstallListPlan, InstallListReport};
use crate::deep_link::{reject_if_untrusted, DeepLinkState};
use crate::error::{AppError, AppResult, IpcResult};
use crate::events::TauriEventSink;
use crate::mods::{InstallOutcome, ModLibraryState};
use crate::patcher::PatcherState;
use crate::services::shared::off_thread;
use crate::state::SettingsState;
use fs_err as fs;
use tauri::{AppHandle, Manager, State};

/// Take the deep link that arrived before the frontend could listen for it.
///
/// A URL handed to a cold start reaches the backend while the window's script is
/// still loading, so the event carrying it would reach nobody. The frontend asks
/// once, as its listener comes up, and the answer is `None` from then on.
#[tauri::command]
#[specta::specta]
pub async fn take_pending_deep_link(app_handle: AppHandle) -> IpcResult<Option<DeepLinkRequest>> {
    let pending: AppResult<Option<DeepLinkRequest>> =
        Ok(crate::deep_link::take_pending(&app_handle));
    pending.into()
}

/// Take the mod files Explorer opened before the frontend could listen for them.
#[tauri::command]
#[specta::specta]
pub async fn take_pending_opened_files(app_handle: AppHandle) -> IpcResult<FilesOpened> {
    IpcResult::ok(files::take_pending(&app_handle))
}

/// Install a mod from a deep-link protocol URL.
///
/// Downloads the file to a temp directory, validates it, then installs
/// using the existing mod library pipeline.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub fn deep_link_install_mod(
    url: String,
    name: Option<String>,
    author: Option<String>,
    source: Option<String>,
    app_handle: AppHandle,
    library: State<ModLibraryState>,
    settings: State<SettingsState>,
    patcher: State<PatcherState>,
) -> IpcResult<InstallOutcome> {
    let result: AppResult<InstallOutcome> = (|| {
        let parsed = url::Url::parse(&url)
            .map_err(|e| AppError::ValidationFailed(format!("Invalid URL: {e}")))?;
        if parsed.scheme() != "https" {
            return Err(AppError::ValidationFailed(
                "Download URL must use HTTPS".into(),
            ));
        }

        reject_if_untrusted(&url, &settings)?;

        tracing::info!(
            "Protocol install: downloading from {} (name: {:?}, author: {:?}, source: {:?})",
            url,
            name,
            author,
            source
        );

        let events = TauriEventSink::new(app_handle.clone());
        let version = crate::running_version().to_string();
        let temp_path = deep_link::download_mod_file(&url, &version, &events)?;
        let temp_path_str = temp_path.to_string_lossy().to_string();

        let config = settings.config();
        let result = library.0.install_mod_from_package(&config, &temp_path_str);

        if let Err(e) = fs::remove_file(&temp_path) {
            tracing::warn!("Failed to clean up temp file: {}", e);
        }

        deep_link::emit_install_complete(&events);

        result
    })();
    patcher.refresh_overlay();
    result.into()
}

/// Fetch the list an `ltk://install-list` link names, within its limits.
///
/// Runs only against a host the allowlist holds, as the install does: the dialog that asks the
/// reader to trust the domain saves before it asks for the list.
#[tauri::command]
#[specta::specta]
pub async fn deep_link_install_list_fetch(
    url: String,
    app_handle: AppHandle,
) -> IpcResult<InstallList> {
    if let Err(error) = reject_if_untrusted(&url, &app_handle.state::<SettingsState>()) {
        return AppResult::<InstallList>::Err(error).into();
    }
    let version = crate::running_version().to_string();
    off_thread(move || fetch_install_list(&url, &version)).await
}

/// Install the items of a list the reader confirmed, one after another, and report each.
///
/// Holds for the whole run. The frontend hears each item on `install-list-progress` and each
/// file's bytes on `protocol-install-progress`, and `deep_link_install_list_cancel` stops the
/// run between items.
#[tauri::command]
#[specta::specta]
pub async fn deep_link_install_list(
    plan: InstallListPlan,
    app_handle: AppHandle,
) -> IpcResult<InstallListReport> {
    off_thread(move || {
        let library = app_handle.state::<ModLibraryState>().0.clone();
        let settings = app_handle.state::<SettingsState>();
        let deep_link = app_handle.state::<DeepLinkState>();
        let version = crate::running_version().to_string();
        let context = list_run::RunContext {
            app: &app_handle,
            library: &library,
            settings: &settings,
            cancel: &deep_link.install_list_cancel,
            version: &version,
        };
        let result = list_run::run(plan, &context);
        app_handle.state::<PatcherState>().refresh_overlay();
        result
    })
    .await
}

/// Stop the running install list after the item it is on.
#[tauri::command]
#[specta::specta]
pub fn deep_link_install_list_cancel(deep_link: State<DeepLinkState>) -> IpcResult<()> {
    deep_link.install_list_cancel.cancel();
    IpcResult::ok(())
}

/// The links service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the link commands.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    super::plugin::<Table>().build()
}
