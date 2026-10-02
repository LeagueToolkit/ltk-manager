//! The download an install link starts, streamed to a temporary file.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::Instant;

use fs_err as fs;
use reqwest::Url;

use super::{ProtocolInstallProgress, ProtocolInstallStage};
use crate::error::{AppError, AppResult};
use crate::events::{BackendEvent, EventSink};

const CHUNK_SIZE: usize = 64 * 1024;
const PROGRESS_INTERVAL_MS: u128 = 100;

/// Download a mod file from a URL to a temporary location.
///
/// Streams the response in chunks, reporting its progress through `events`.
/// Returns the path to the downloaded temp file.
pub fn download_mod_file(url: &str, events: &dyn EventSink) -> AppResult<PathBuf> {
    emit_progress(events, ProtocolInstallStage::Downloading, 0, None, None);

    let response = reqwest::blocking::get(url).map_err(|e| {
        emit_progress(
            events,
            ProtocolInstallStage::Error,
            0,
            None,
            Some(&e.to_string()),
        );
        AppError::Other(format!("Failed to download: {e}"))
    })?;

    if !response.status().is_success() {
        let msg = format!("Download failed with status {}", response.status());
        emit_progress(events, ProtocolInstallStage::Error, 0, None, Some(&msg));
        return Err(AppError::Other(msg));
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
