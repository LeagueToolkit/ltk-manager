//! `ltk://` deep links: the route a link names, and the download an install link starts.

mod download;

use std::collections::HashMap;

use reqwest::Url;
use serde::{Deserialize, Serialize};

pub use download::download_mod_file;

use crate::error::{AppError, AppResult};
use crate::events::{BackendEvent, EventSink};

/// A `ltk://` deep link, as the route named in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DeepLinkRequest {
    Install(DeepLinkInstallRequest),
    Settings(DeepLinkSettingsRequest),
}

/// Parsed representation of a `ltk://install` deep-link URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkInstallRequest {
    pub url: String,
    pub name: Option<String>,
    pub author: Option<String>,
    pub source: Option<String>,
    /// The host outside the allowlist, or `None` where the allowlist covers it.
    ///
    /// Stamped by the host rather than by parsing, since the trust is a property of the
    /// reader's settings and not of the URL.
    pub untrusted_domain: Option<String>,
}

/// Parsed representation of a `ltk://settings` deep-link URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkSettingsRequest {
    /// The public setting or group id the page opens on, as `?focus=` carries it.
    pub focus: String,
}

/// Where a protocol install has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ProtocolInstallStage {
    Downloading,
    Validating,
    Complete,
    Error,
}

/// Progress payload emitted during protocol install download.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProtocolInstallProgress {
    pub stage: ProtocolInstallStage,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub error: Option<String>,
}

/// Parse and validate a `ltk://` deep-link URL into the route it names.
///
/// # Errors
///
/// Returns [`AppError::ValidationFailed`] for a URL that is malformed, is not the
/// `ltk` scheme, names no route the app serves, or carries parameters that route
/// rejects.
pub fn parse_deep_link_url(raw_url: &str) -> AppResult<DeepLinkRequest> {
    let parsed = Url::parse(raw_url)
        .map_err(|e| AppError::ValidationFailed(format!("Malformed deep-link URL: {e}")))?;

    if parsed.scheme() != "ltk" {
        return Err(AppError::ValidationFailed(format!(
            "Expected 'ltk' scheme, got '{}'",
            parsed.scheme()
        )));
    }

    // The host portion of ltk://install is "install"
    let host = parsed.host_str().unwrap_or("");
    let path = parsed.path().trim_start_matches('/');
    let action = if !host.is_empty() { host } else { path };

    let pairs: HashMap<String, String> = parsed.query_pairs().into_owned().collect();

    match action {
        "install" => parse_install(&pairs).map(DeepLinkRequest::Install),
        "settings" => parse_settings(&pairs).map(DeepLinkRequest::Settings),
        _ => Err(AppError::ValidationFailed(format!(
            "Unknown action '{action}', expected 'install' or 'settings'"
        ))),
    }
}

/// Longest `?focus=` value accepted, well past the longest id the app draws.
const FOCUS_MAX_CHARS: usize = 128;

fn parse_settings(pairs: &HashMap<String, String>) -> AppResult<DeepLinkSettingsRequest> {
    let focus = pairs
        .get("focus")
        .ok_or_else(|| AppError::ValidationFailed("Missing required 'focus' parameter".into()))?;

    if focus.is_empty() || focus.chars().count() > FOCUS_MAX_CHARS {
        return Err(AppError::ValidationFailed(format!(
            "'focus' must be 1 to {FOCUS_MAX_CHARS} characters"
        )));
    }

    // The value is handed to the frontend to put back into its own URL, and an id is
    // only ever a namespace, a dot and a name. An id this rejects is not one that
    // resolves, so nothing is lost by refusing it at the boundary.
    if !focus
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err(AppError::ValidationFailed(
            "'focus' may only contain letters, digits, '.', '-' and '_'".into(),
        ));
    }

    Ok(DeepLinkSettingsRequest {
        focus: focus.clone(),
    })
}

fn parse_install(pairs: &HashMap<String, String>) -> AppResult<DeepLinkInstallRequest> {
    let download_url = pairs
        .get("url")
        .ok_or_else(|| AppError::ValidationFailed("Missing required 'url' parameter".into()))?;

    let download_parsed = Url::parse(download_url)
        .map_err(|e| AppError::ValidationFailed(format!("Invalid download URL: {e}")))?;

    if download_parsed.scheme() != "https" {
        return Err(AppError::ValidationFailed(
            "Download URL must use HTTPS".into(),
        ));
    }

    // SSRF prevention: reject loopback/private hosts
    if let Some(host) = download_parsed.host_str() {
        let lower = host.to_lowercase();
        let normalized = lower.trim_start_matches('[').trim_end_matches(']');
        if normalized == "localhost"
            || normalized == "127.0.0.1"
            || normalized == "::1"
            || normalized.starts_with("10.")
            || normalized.starts_with("192.168.")
            || normalized == "0.0.0.0"
        {
            return Err(AppError::ValidationFailed(
                "Download URL must not point to a local/private address".into(),
            ));
        }
        // Check 172.16.0.0/12 range
        if let Some(second_octet) = normalized
            .strip_prefix("172.")
            .and_then(|s| s.split('.').next())
            .and_then(|s| s.parse::<u8>().ok())
            && (16..=31).contains(&second_octet)
        {
            return Err(AppError::ValidationFailed(
                "Download URL must not point to a local/private address".into(),
            ));
        }
    }

    let name = pairs.get("name").map(|s| truncate_str(s, 256).to_string());
    let author = pairs
        .get("author")
        .map(|s| truncate_str(s, 256).to_string());
    let source = pairs
        .get("source")
        .map(|s| truncate_str(s, 256).to_string());

    Ok(DeepLinkInstallRequest {
        url: download_url.clone(),
        name,
        author,
        source,
        untrusted_domain: None,
    })
}

/// Report a finished protocol install through `events`.
pub fn emit_install_complete(events: &dyn EventSink) {
    events.emit(BackendEvent::ProtocolInstallProgress(
        ProtocolInstallProgress {
            stage: ProtocolInstallStage::Complete,
            bytes_downloaded: 0,
            total_bytes: None,
            error: None,
        },
    ));
}

/// Check if a hostname is trusted against a domain allowlist.
///
/// Matches exact domain or any subdomain (e.g., `cdn.runeforge.dev` matches `runeforge.dev`).
/// Returns `true` if `trusted_domains` is empty (allowlist disabled).
pub fn is_domain_trusted(download_url: &str, trusted_domains: &[String]) -> bool {
    if trusted_domains.is_empty() {
        return true;
    }

    let host = match Url::parse(download_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
    {
        Some(h) => h,
        None => return false,
    };

    trusted_domains
        .iter()
        .any(|d| host == d.as_str() || host.ends_with(&format!(".{d}")))
}

/// The host a download URL names, lower-cased, or `None` for a URL with no host.
pub fn download_host(download_url: &str) -> Option<String> {
    Url::parse(download_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
}

fn truncate_str(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        Some((idx, _)) => &s[..idx],
        None => s,
    }
}

#[cfg(test)]
mod tests;
