//! `ltk://` deep links and opened mod files as the window receives them: the rate limit, the
//! hand-off to a frontend that is not yet listening, and the window a link raises.

pub mod files;
pub mod install_list;

use std::time::Instant;

use ltk_manager_core::deep_link::{
    download_host, is_domain_trusted, parse_deep_link_url, DeepLinkRequest,
};
use parking_lot::Mutex;
use tauri::{Emitter, Manager};

use crate::error::{AppError, AppResult};
use crate::state::SettingsState;

/// Sends `request` to the frontend, on the event its route is heard on.
fn emit_to(app_handle: &tauri::AppHandle, request: &DeepLinkRequest) {
    let _ = match request {
        DeepLinkRequest::Install(request) => app_handle.emit("deep-link-install", request),
        DeepLinkRequest::InstallList(request) => app_handle.emit("deep-link-install-list", request),
        DeepLinkRequest::Settings(request) => app_handle.emit("deep-link-settings", request),
    };
}

/// A link that arrived before the frontend could hear it, and whether one still could.
#[derive(Debug, Default)]
struct Handoff {
    listening: bool,
    pending: Option<DeepLinkRequest>,
}

/// Rate-limiter and hand-off state for deep-link invocations.
pub struct DeepLinkState {
    last_invocation: Mutex<Option<Instant>>,
    handoff: Mutex<Handoff>,
    /// Whether the reader asked the running install list to stop.
    pub install_list_cancel: install_list::InstallListCancel,
}

impl DeepLinkState {
    pub fn new() -> Self {
        Self {
            last_invocation: Mutex::new(None),
            handoff: Mutex::new(Handoff::default()),
            install_list_cancel: install_list::InstallListCancel::default(),
        }
    }

    /// Returns `true` if the invocation should be dropped (rate-limited).
    pub fn should_rate_limit(&self) -> bool {
        let mut last = self.last_invocation.lock();
        let now = Instant::now();
        if let Some(prev) = *last {
            if now.duration_since(prev).as_secs_f64() < 1.0 {
                return true;
            }
        }
        *last = Some(now);
        false
    }

    /// Sends the link on, or holds it until the frontend asks for one.
    ///
    /// A URL handed to a cold start arrives before the window's script has run, so
    /// the event carrying it would reach nobody. Held and sent under the one lock
    /// [`Self::take_pending`] drains, so a link cannot fall between the two.
    pub fn deliver(&self, app_handle: &tauri::AppHandle, request: DeepLinkRequest) {
        let mut handoff = self.handoff.lock();
        if !handoff.listening {
            handoff.pending = Some(request);
            return;
        }

        crate::tray::reveal(app_handle);
        emit_to(app_handle, &request);
    }

    /// The held link, if there is one, and marks the frontend listening from here on.
    pub fn take_pending(&self) -> Option<DeepLinkRequest> {
        let mut handoff = self.handoff.lock();
        handoff.listening = true;
        handoff.pending.take()
    }
}

/// The link that arrived before the frontend was listening, if there was one.
///
/// The window is created hidden, so a link the frontend is only now hearing about
/// has nothing on screen under it yet.
pub fn take_pending(app_handle: &tauri::AppHandle) -> Option<DeepLinkRequest> {
    let state: tauri::State<'_, DeepLinkState> = app_handle.state();
    let pending = state.take_pending();
    if pending.is_some() {
        crate::tray::reveal(app_handle);
    }
    pending
}

/// Process deep-link URLs and emit events to the frontend.
pub fn handle_urls(app_handle: &tauri::AppHandle, urls: &[url::Url]) {
    for url in urls {
        handle_single(app_handle, url.as_str());
    }
}

/// Route a second launch's arguments: `ltk://` links, and mod files Explorer opened.
pub fn handle_argv(app_handle: &tauri::AppHandle, argv: &[String], cwd: &std::path::Path) {
    for arg in argv.iter().skip(1) {
        if arg.starts_with("ltk://") {
            handle_single(app_handle, arg);
        }
    }

    files::open(app_handle, files::mod_files(argv, cwd));

    crate::tray::reveal(app_handle);
}

fn handle_single(app_handle: &tauri::AppHandle, raw_url: &str) {
    tracing::info!("Received deep-link: {}", raw_url);

    let deep_link_state: tauri::State<'_, DeepLinkState> = app_handle.state();
    if deep_link_state.should_rate_limit() {
        tracing::warn!("Deep-link rate-limited, ignoring: {}", raw_url);
        return;
    }

    match parse_deep_link_url(raw_url) {
        Ok(mut request) => {
            tracing::info!("Parsed deep-link request: {:?}", request);

            match &mut request {
                DeepLinkRequest::Install(install) => {
                    install.untrusted_domain = untrusted_domain(app_handle, &install.url);
                }
                DeepLinkRequest::InstallList(list) => {
                    list.untrusted_domain = untrusted_domain(app_handle, &list.url);
                }
                DeepLinkRequest::Settings(_) => {}
            }

            deep_link_state.deliver(app_handle, request);
        }
        Err(e) => {
            tracing::error!("Failed to parse deep-link URL: {}", e);
        }
    }
}

/// The host a link would fetch `url` from, where the allowlist does not cover it.
///
/// The link still reaches the frontend, which asks the reader to trust the domain
/// or reject the install. Nothing downloads until they answer, because the install
/// commands read the same allowlist through [`reject_if_untrusted`].
fn untrusted_domain(app_handle: &tauri::AppHandle, url: &str) -> Option<String> {
    let settings_state: tauri::State<'_, SettingsState> = app_handle.state();
    let settings = settings_state.0.lock();

    if is_domain_trusted(url, &settings.trusted_domains) {
        return None;
    }

    let domain = download_host(url)?;
    tracing::warn!("Deep-link domain '{domain}' is not in the trusted list, asking the reader");
    Some(domain)
}

/// Refuse a fetch of `url` from a domain the reader's allowlist does not cover.
///
/// The deep-link handler already marks such a link, and the dialog it opens asks
/// the reader to trust the domain. Reading the list here too is what makes that
/// answer the gate rather than a formality, so a download only ever runs against
/// a domain the settings already hold.
///
/// # Errors
///
/// Returns [`AppError::UntrustedDomain`] naming the domain that was refused.
pub(crate) fn reject_if_untrusted(url: &str, settings: &SettingsState) -> AppResult<()> {
    let trusted = settings.0.lock().trusted_domains.clone();
    if is_domain_trusted(url, &trusted) {
        return Ok(());
    }

    let domain = download_host(url).unwrap_or_else(|| url.to_owned());
    Err(AppError::UntrustedDomain(domain))
}

#[cfg(test)]
mod tests;
