//! The download an install link starts, streamed to a temporary file.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use fs_err as fs;
use reqwest::header::{HeaderMap, RETRY_AFTER};
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};

use super::{ProtocolInstallProgress, ProtocolInstallStage};
use ltk_manager_base::error::{AppError, AppResult, DomainError, ErrorKind};
use ltk_manager_base::events::{BackendEvent, EventSink};

const CHUNK_SIZE: usize = 64 * 1024;
const PROGRESS_INTERVAL_MS: u128 = 100;

/// How long a connection to the download host may take to open.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Why the download an install link starts failed.
///
/// Sent over IPC whole, as the `error` of the `DOWNLOAD` code, so the frontend switches on
/// `kind` and renders the data that a variant carries. The status variants follow the RuneForge
/// download routes, which give a file only for a link the site signed in the last 15 minutes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum DownloadError {
    /// The server refused the link as unsigned, expired or tampered (403).
    #[error("the download link is unsigned, expired or tampered")]
    LinkExpired,

    /// The mod or the release is gone, or the mod is private (404).
    #[error("the mod is not available to download")]
    Unavailable,

    /// The release's files were pruned (410).
    #[error("the release's files were removed")]
    FilesRemoved,

    /// The per-minute or the guest daily limit was reached (429). `retry_after` is in seconds.
    #[error("the download limit was reached")]
    RateLimited { retry_after: Option<u64> },

    /// The server answered with a `status` that has no variant of its own.
    #[error("the download failed with status {status}")]
    Http { status: u16 },

    /// The server was not reached, or the connection broke before the headers arrived.
    #[error("the download host is unreachable: {detail}")]
    Offline { detail: String },
}

impl From<DownloadError> for AppError {
    fn from(error: DownloadError) -> Self {
        Self::Domain(DomainError::new(ErrorKind::Download, error))
    }
}

impl DownloadError {
    /// Reads a failed answer of `status`, with its `headers`, into a variant.
    pub(crate) fn from_status(status: StatusCode, headers: &HeaderMap) -> Self {
        match status {
            StatusCode::FORBIDDEN => Self::LinkExpired,
            StatusCode::NOT_FOUND => Self::Unavailable,
            StatusCode::GONE => Self::FilesRemoved,
            StatusCode::TOO_MANY_REQUESTS => Self::RateLimited {
                retry_after: retry_after(headers),
            },
            other => Self::Http {
                status: other.as_u16(),
            },
        }
    }

    /// Reads a transport failure of `reqwest` into a variant.
    fn transport(error: &reqwest::Error) -> Self {
        Self::Offline {
            detail: without_url(error),
        }
    }
}

/// Returns the wait of a `Retry-After` header in seconds, or `None` for a date or no header.
pub(crate) fn retry_after(headers: &HeaderMap) -> Option<u64> {
    headers.get(RETRY_AFTER)?.to_str().ok()?.trim().parse().ok()
}

/// Returns the text of `error` and its sources, without the URL that `error` names.
///
/// The URL carries the link's signature, which no message repeats.
fn without_url(error: &reqwest::Error) -> String {
    let mut text = if error.is_timeout() {
        "the request timed out".to_owned()
    } else if error.is_connect() {
        "the connection failed".to_owned()
    } else {
        "the request failed".to_owned()
    };

    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }

    text
}

/// Builds the client of one download, which names the running `version` in the `User-Agent`.
///
/// The client has a connect timeout and no total timeout, so a large mod on a slow connection
/// finishes. It follows redirects to any host, because the download route answers with a redirect
/// to the storage host.
///
/// # Errors
///
/// Fails with [`DownloadError::Offline`] if the TLS backend cannot be set up.
fn client(version: &str) -> Result<reqwest::blocking::Client, DownloadError> {
    reqwest::blocking::Client::builder()
        .user_agent(format!("ltk-manager/{version}"))
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(None)
        .build()
        .map_err(|error| DownloadError::transport(&error))
}

/// Downloads a mod file from `url` to a temporary location.
///
/// Streams the response in chunks, reporting its progress through `events`. `version` names the
/// running app in the `User-Agent`. Returns the path to the downloaded temp file.
///
/// # Errors
///
/// Fails with a [`DownloadError`] if the server refuses the link or is not reached, and with
/// [`AppError::ValidationFailed`] if the file is empty or in no format the app installs.
pub fn download_mod_file(url: &str, version: &str, events: &dyn EventSink) -> AppResult<PathBuf> {
    emit_progress(events, ProtocolInstallStage::Downloading, 0, None, None);

    let response = client(version)
        .and_then(|client| {
            client
                .get(url)
                .send()
                .map_err(|error| DownloadError::transport(&error))
        })
        .map_err(|error| {
            emit_progress(
                events,
                ProtocolInstallStage::Error,
                0,
                None,
                Some(&error.to_string()),
            );
            AppError::from(error)
        })?;

    let status = response.status();
    if !status.is_success() {
        let error = DownloadError::from_status(status, response.headers());
        emit_progress(
            events,
            ProtocolInstallStage::Error,
            0,
            None,
            Some(&error.to_string()),
        );
        return Err(AppError::from(error));
    }

    let ext_from_metadata = infer_extension_from_metadata(&response, url);
    let total_bytes = response.content_length();

    let (temp_path, bytes_written) = stream_to_temp_file(response, total_bytes, events)?;

    if bytes_written == 0 {
        let _ = fs::remove_file(&temp_path);
        let msg = "Downloaded file is empty";
        emit_progress(
            events,
            ProtocolInstallStage::Error,
            0,
            total_bytes,
            Some(msg),
        );
        return Err(AppError::ValidationFailed(msg.into()));
    }

    emit_progress(
        events,
        ProtocolInstallStage::Validating,
        bytes_written,
        total_bytes,
        None,
    );

    let ext = ext_from_metadata
        .or_else(|| sniff_extension_from_file(&temp_path))
        .ok_or_else(|| {
            let _ = fs::remove_file(&temp_path);
            let msg = "Could not determine file format, expected .modpkg or .fantome";
            emit_progress(
                events,
                ProtocolInstallStage::Error,
                0,
                total_bytes,
                Some(msg),
            );
            AppError::ValidationFailed(msg.into())
        })?;

    let final_path = temp_path.with_extension(&ext);
    fs::rename(&temp_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        AppError::Io(e)
    })?;

    Ok(final_path)
}

/// Stream the response body to a temp file in chunks, emitting progress events.
fn stream_to_temp_file(
    mut response: reqwest::blocking::Response,
    total_bytes: Option<u64>,
    events: &dyn EventSink,
) -> AppResult<(PathBuf, u64)> {
    let temp_name = format!("{}.tmp", uuid::Uuid::new_v4());
    let temp_path = std::env::temp_dir().join(temp_name);

    let mut file = fs::File::create(&temp_path).map_err(|e| {
        emit_progress(
            events,
            ProtocolInstallStage::Error,
            0,
            None,
            Some(&e.to_string()),
        );
        AppError::Io(e)
    })?;

    let mut downloaded: u64 = 0;
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut last_emit = Instant::now();

    loop {
        let n = response.read(&mut buf).map_err(|e| {
            let _ = fs::remove_file(&temp_path);
            emit_progress(
                events,
                ProtocolInstallStage::Error,
                downloaded,
                total_bytes,
                Some(&e.to_string()),
            );
            AppError::Io(e)
        })?;

        if n == 0 {
            break;
        }

        file.write_all(&buf[..n]).map_err(|e| {
            let _ = fs::remove_file(&temp_path);
            emit_progress(
                events,
                ProtocolInstallStage::Error,
                downloaded,
                total_bytes,
                Some(&e.to_string()),
            );
            AppError::Io(e)
        })?;

        downloaded += n as u64;

        if last_emit.elapsed().as_millis() >= PROGRESS_INTERVAL_MS {
            emit_progress(
                events,
                ProtocolInstallStage::Downloading,
                downloaded,
                total_bytes,
                None,
            );
            last_emit = Instant::now();
        }
    }

    emit_progress(
        events,
        ProtocolInstallStage::Downloading,
        downloaded,
        total_bytes,
        None,
    );

    Ok((temp_path, downloaded))
}

/// Determine file extension from response headers and URL.
/// Returns `None` when the format can't be determined from metadata alone.
fn infer_extension_from_metadata(
    response: &reqwest::blocking::Response,
    url: &str,
) -> Option<String> {
    if let Some(ext) = response
        .headers()
        .get("content-disposition")
        .and_then(|cd| cd.to_str().ok())
        .and_then(|cd| extract_extension_from_content_disposition(cd))
    {
        return Some(ext.to_string());
    }

    if let Ok(parsed) = Url::parse(url) {
        let path = parsed.path();
        if path.ends_with(".fantome") {
            return Some("fantome".to_string());
        }
        if path.ends_with(".modpkg") {
            return Some("modpkg".to_string());
        }
    }

    None
}

pub(crate) fn extract_extension_from_content_disposition(header: &str) -> Option<&'static str> {
    let lower = header.to_ascii_lowercase();
    for part in lower.split(';') {
        let part = part.trim();
        if let Some(value) = part
            .strip_prefix("filename")
            .and_then(|s| s.split('=').nth(1))
        {
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if value.ends_with(".fantome") {
                return Some("fantome");
            }
            if value.ends_with(".modpkg") {
                return Some("modpkg");
            }
        }
    }
    None
}

/// Sniff the file format from the first 4 bytes of a file.
pub(crate) fn sniff_extension_from_file(path: &std::path::Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).ok()?;

    // ZIP magic: PK\x03\x04
    if magic == [0x50, 0x4B, 0x03, 0x04] {
        return Some("fantome".to_string());
    }
    None
}

fn emit_progress(
    events: &dyn EventSink,
    stage: ProtocolInstallStage,
    bytes_downloaded: u64,
    total_bytes: Option<u64>,
    error: Option<&str>,
) {
    events.emit(BackendEvent::ProtocolInstallProgress(
        ProtocolInstallProgress {
            stage,
            bytes_downloaded,
            total_bytes,
            error: error.map(String::from),
        },
    ));
}
