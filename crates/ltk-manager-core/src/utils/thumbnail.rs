//! A mod's or a project's thumbnail, stored as lossy WebP whatever image it came from.

use std::path::Path;

use fs_err as fs;

use super::fs::atomic_write;
use crate::error::{AppError, AppResult};

/// The file a thumbnail is stored as, beside the mod's or the project's config.
pub(crate) const THUMBNAIL_FILE: &str = "thumbnail.webp";

/// The PNG an older build stored, removed once a WebP replaces it.
const LEGACY_THUMBNAIL_FILE: &str = "thumbnail.png";

const SUPPORTED_FORMATS: [&str; 9] = [
    "webp", "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "ico",
];

/// WebP quality for a re-encoded image, lossy because the lossless encoder can turn a 1 MB
/// JPEG into 5 MB or more.
const QUALITY: f32 = 90.0;

/// Store the image at `source` as `dir`'s thumbnail.
///
/// A WebP is kept as its own bytes once it decodes, and any other supported image is
/// re-encoded.
///
/// # Errors
///
/// Fails when `source` is missing, is not a supported image, does not decode, or the
/// thumbnail cannot be written.
pub(crate) fn write_thumbnail(source: &Path, dir: &Path) -> AppResult<()> {
    if !source.exists() {
        return Err(AppError::InvalidPath(source.display().to_string()));
    }

    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    if !SUPPORTED_FORMATS.contains(&extension.as_str()) {
        return Err(AppError::ValidationFailed(format!(
            "Unsupported image format: {extension}. Supported formats: {}",
            SUPPORTED_FORMATS.join(", ")
        )));
    }

    let image = image::open(source)
        .map_err(|e| AppError::ValidationFailed(format!("Failed to open image: {e}")))?;
    let webp = if extension == "webp" {
        fs::read(source)?
    } else {
        webp::Encoder::from_image(&image)
            .map_err(|e| AppError::ValidationFailed(format!("Failed to encode WebP: {e}")))?
            .encode(QUALITY)
            .to_vec()
    };

    atomic_write(&dir.join(THUMBNAIL_FILE), &webp)?;
    let _ = fs::remove_file(dir.join(LEGACY_THUMBNAIL_FILE));

    Ok(())
}
