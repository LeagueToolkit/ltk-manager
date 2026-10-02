//! Filesystem moves the standard library does not offer.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use fs_err as fs;
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{AppError, AppResult, IoContext, io_context};

/// Move `staged` onto `target`. The existing `target` moves to `aside` first, is deleted once
/// `staged` is in place, and moves back when that move fails.
///
/// `old` and `new` name the two in a failure, as in "Failed to move the {old} aside".
///
/// # Errors
///
/// Fails when the existing `target` cannot be moved aside, or `staged` cannot be moved into
/// place.
pub(crate) fn replace_keeping_old(
    staged: &Path,
    target: &Path,
    aside: &Path,
    (old, new): (&str, &str),
) -> AppResult<()> {
    if target.exists() {
        fs::rename(target, aside).context(format!("Failed to move the {old} aside"))?;
    }

    if let Err(error) = fs::rename(staged, target) {
        let _ = fs::rename(aside, target);
        return Err(io_context(
            error,
            format!("Failed to move the {new} into place"),
        ));
    }

    let _ = if aside.is_dir() {
        fs::remove_dir_all(aside)
    } else {
        fs::remove_file(aside)
    };
    Ok(())
}

/// Write `contents` to `path` through a hidden temporary file beside it.
///
/// A plain `fs::write` can leave `path` truncated if the process dies or the disk fills mid-write.
/// The rename is atomic on every supported platform, so `path` is either the old bytes or the new
/// ones. The temporary file is hidden, so a scan of the folder passes over one a crash leaves.
///
/// # Errors
///
/// Fails when the temporary file cannot be written or renamed. A failed rename removes the
/// temporary file and leaves the destination as it was.
pub(crate) fn atomic_write(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let tmp = temp_beside(path);
    fs::write(&tmp, contents)?;

    if let Err(error) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }

    Ok(())
}

/// `.<name>.tmp` beside `path`.
fn temp_beside(path: &Path) -> PathBuf {
    let mut name = OsString::from(".");
    name.push(path.file_name().unwrap_or_default());
    name.push(".tmp");

    path.with_file_name(name)
}

/// `value` as pretty JSON at `path`, written through [`atomic_write`] into a folder made for it.
///
/// # Errors
///
/// Fails when `value` cannot be serialized, or the folder or the file cannot be written.
pub(crate) fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    atomic_write(path, &serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

/// The JSON document at `path`, and the default where it is missing or unreadable.
///
/// An unreadable document is logged and replaced, because every caller holds a cache that fills
/// again.
pub(crate) fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> T {
    let Ok(contents) = fs::read(path) else {
        return T::default();
    };

    serde_json::from_slice(&contents).unwrap_or_else(|error| {
        tracing::warn!(%error, file = %path.display(), "Unreadable document, starting over");
        T::default()
    })
}

/// Copy `source` and everything under it into `destination`.
///
/// Symlinks are skipped rather than followed or recreated, so a copy can never
/// walk out of `source` or reproduce a link the destination cannot resolve.
/// `destination` is created if it does not exist, and an existing file there is
/// overwritten.
///
/// # Errors
///
/// Fails with [`AppError::Io`] on the first entry that cannot be read or
/// written, which leaves whatever was already copied in place.
pub(crate) fn copy_dir_all(source: &Path, destination: &Path) -> AppResult<()> {
    fs::create_dir_all(destination)?;

    for entry in walkdir::WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
        let file_type = entry.file_type();
        if file_type.is_symlink() {
            continue;
        }

        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|e| AppError::Other(e.to_string()))?;
        let target = destination.join(relative);

        if file_type.is_dir() {
            fs::create_dir_all(&target)?;
        } else if file_type.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(entry.path(), &target)?;
        }
    }

    Ok(())
}
