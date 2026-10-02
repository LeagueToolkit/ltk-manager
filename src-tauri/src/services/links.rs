//! The links service: installing the mod an `ltk://` link names, and the link that arrived before
//! the frontend listened.

use ltk_manager_core::deep_link::{self, DeepLinkRequest};

use crate::error::{AppError, AppResult, IpcResult};
use crate::events::TauriEventSink;
use crate::mods::{InstalledMod, ModLibraryState};
use crate::patcher::PatcherState;
use crate::state::SettingsState;
use fs_err as fs;
use tauri::{AppHandle, State};

/// Refuse a download from a domain the reader's allowlist does not cover.
///
/// The deep-link handler already marks such a link, and the dialog it opens asks
/// the reader to trust the domain. Reading the list here too is what makes that
/// answer the gate rather than a formality, so a download only ever runs against
/// a domain the settings already hold.
///
/// # Errors
///
/// Returns [`AppError::UntrustedDomain`] naming the domain that was refused.
fn reject_if_untrusted(url: &str, settings: &State<SettingsState>) -> AppResult<()> {
    let trusted = settings.0.lock().trusted_domains.clone();
    if deep_link::is_domain_trusted(url, &trusted) {
        return Ok(());
    }

    let domain = deep_link::download_host(url).unwrap_or_else(|| url.to_owned());
    Err(AppError::UntrustedDomain(domain))
}

/// Take the deep link that arrived before the frontend could listen for it.
///
/// A URL handed to a cold start reaches the backend while the window's script is
/// still loading, so the event carrying it would reach nobody. The frontend asks
/// once, as its listener comes up, and the answer is `None` from then on.
#[tauri::command]
#[specta::specta]
pub fn take_pending_deep_link(app_handle: AppHandle) -> IpcResult<Option<DeepLinkRequest>> {
    let pending: AppResult<Option<DeepLinkRequest>> =
        Ok(crate::deep_link::take_pending(&app_handle));
    pending.into()
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
) -> IpcResult<InstalledMod> {
    let result: AppResult<InstalledMod> = (|| {
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
        let temp_path = deep_link::download_mod_file(&url, &events)?;
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

/// The links service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the link commands.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    super::plugin::<Table>().build()
}
