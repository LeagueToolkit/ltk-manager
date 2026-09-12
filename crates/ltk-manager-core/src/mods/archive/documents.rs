//! An installed mod's readme and license, read wherever the format left them.
//!
//! A modpkg's readme is written into the mod directory at import and a
//! fantome's is not, so the first ask for one mounts the archive and writes it
//! where the modpkg import already would have. Both formats converge on
//! `README.md` in the mod directory, and every later ask is a file read.
//!
//! A license text reaches disk for neither format and is not cached here. It is
//! read once, rarely, and only when a reader asks to see it.

use crate::error::{AppError, AppResult};
use crate::mods::index::{LibraryIndex, LibraryModEntry, ModArchiveFormat};
use fs_err as fs;
use ltk_modpkg::{Modpkg, error::ModpkgError};
use serde::Serialize;
use std::path::Path;

/// The file both formats' readmes are read back from.
const README_FILE: &str = "README.md";

/// One of a mod's text documents, or why there is none to show.
///
/// An absent document and a document that could not be read are two facts. The
/// second says the mod's archive is not answering, which is a mod that may not
/// work at all, and reporting it as a mod whose author wrote nothing is a
/// silent lie about something the reader has installed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ModDocument {
    /// The document, as the mod's author wrote it.
    #[serde(rename_all = "camelCase")]
    Present { text: String },
    /// The mod carries no such document.
    Absent,
    /// The archive that would hold it did not answer.
    #[serde(rename_all = "camelCase")]
    Unreadable { reason: String },
}

impl ModDocument {
    /// Read `bytes` as text, or report the encoding that defeated it.
    fn from_bytes(bytes: Vec<u8>) -> Self {
        match String::from_utf8(bytes) {
            Ok(text) => Self::Present { text },
            Err(error) => Self::Unreadable {
                reason: error.to_string(),
            },
        }
    }
}

/// An installed mod's readme, extracted from its archive if it is not on disk yet.
///
/// # Errors
///
/// Fails only where the answer itself cannot be formed. An archive that refuses
/// to open is [`ModDocument::Unreadable`] rather than an error, because it is
/// one mod's answer and not the library's.
pub(crate) fn read_readme(storage_dir: &Path, entry: &LibraryModEntry) -> AppResult<ModDocument> {
    let mod_dir = entry.mod_dir(storage_dir);
    let cached = mod_dir.join(README_FILE);
    if cached.exists() {
        return Ok(match fs::read(&cached) {
            Ok(bytes) => ModDocument::from_bytes(bytes),
            Err(error) => ModDocument::Unreadable {
                reason: error.to_string(),
            },
        });
    }

    let archive_path = entry.archive_path(storage_dir);
    if !archive_path.exists() {
        return Ok(ModDocument::Unreadable {
            reason: format!("{} is not beside the mod", archive_path.display()),
        });
    }

    let extracted = match entry.format {
        ModArchiveFormat::Modpkg => modpkg_readme(&archive_path),
        ModArchiveFormat::Fantome | ModArchiveFormat::Unknown => fantome_readme(&archive_path),
    };

    // A readme found in the archive is written where the modpkg import writes
    // one, so the next ask never opens the archive again.
    if let ModDocument::Present { text } = &extracted
        && let Err(error) = fs::write(&cached, text)
    {
        tracing::warn!(mod_id = %entry.id, %error, "readme not cached");
    }

    Ok(extracted)
}

/// An installed mod's license text, read out of its archive and not kept.
///
/// A license is consulted once and rarely re-consulted, so nothing is written
/// beside the mod. What is cheap enough to hold for a session is the reader's
/// to hold.
///
/// # Errors
///
/// Fails only where the answer itself cannot be formed, as [`read_readme`] does.
pub(crate) fn read_license(storage_dir: &Path, entry: &LibraryModEntry) -> AppResult<ModDocument> {
    let archive_path = entry.archive_path(storage_dir);
    if !archive_path.exists() {
        return Ok(ModDocument::Unreadable {
            reason: format!("{} is not beside the mod", archive_path.display()),
        });
    }

    Ok(match entry.format {
        ModArchiveFormat::Modpkg => modpkg_license(&archive_path),
        ModArchiveFormat::Fantome | ModArchiveFormat::Unknown => fantome_license(&archive_path),
    })
}

/// The `_meta_/readme.md` chunk of a modpkg.
fn modpkg_readme(archive_path: &Path) -> ModDocument {
    mount_modpkg(archive_path, |modpkg| modpkg.load_readme())
}

/// The `_meta_/license` chunk of a modpkg.
fn modpkg_license(archive_path: &Path) -> ModDocument {
    mount_modpkg(archive_path, |modpkg| modpkg.load_license_text())
}

/// Mount `archive_path` and read one meta chunk out of it.
///
/// A chunk no package carries is [`ModDocument::Absent`]. Every other failure
/// is the package refusing to be read.
fn mount_modpkg(
    archive_path: &Path,
    load: impl FnOnce(&mut Modpkg<fs::File>) -> Result<Vec<u8>, ModpkgError>,
) -> ModDocument {
    let mounted = fs::File::open(archive_path)
        .map_err(ModpkgError::from)
        .and_then(Modpkg::mount_from_reader);

    let mut modpkg = match mounted {
        Ok(modpkg) => modpkg,
        Err(error) => {
            return ModDocument::Unreadable {
                reason: error.to_string(),
            };
        }
    };

    match load(&mut modpkg) {
        Ok(bytes) => ModDocument::from_bytes(bytes),
        Err(ModpkgError::MissingChunk(_)) => ModDocument::Absent,
        Err(error) => ModDocument::Unreadable {
            reason: error.to_string(),
        },
    }
}

/// The `META/README.md` entry of a fantome, or a `README.md` at its root.
fn fantome_readme(archive_path: &Path) -> ModDocument {
    read_fantome(archive_path, |reader| reader.read_readme())
}

/// The `META/LICENSE` entry of a fantome, whichever spelling it carries.
fn fantome_license(archive_path: &Path) -> ModDocument {
    read_fantome(archive_path, |reader| {
        reader
            .read_license()
            .map(|found| found.map(|(_name, bytes)| bytes))
    })
}

/// Open `archive_path` as a fantome and read one `META/` entry out of it.
fn read_fantome<E: std::fmt::Display>(
    archive_path: &Path,
    read: impl FnOnce(&mut ltk_fantome::FantomeReader<fs::File>) -> Result<Option<Vec<u8>>, E>,
) -> ModDocument {
    let opened = fs::File::open(archive_path)
        .map_err(|error| error.to_string())
        .and_then(|file| ltk_fantome::FantomeReader::new(file).map_err(|error| error.to_string()));

    let mut reader = match opened {
        Ok(reader) => reader,
        Err(reason) => return ModDocument::Unreadable { reason },
    };

    match read(&mut reader) {
        Ok(Some(bytes)) => ModDocument::from_bytes(bytes),
        Ok(None) => ModDocument::Absent,
        Err(error) => ModDocument::Unreadable {
            reason: error.to_string(),
        },
    }
}

/// Find `mod_id` in `index`, or say which id no mod answers to.
pub(crate) fn entry_of<'index>(
    index: &'index LibraryIndex,
    mod_id: &str,
) -> AppResult<&'index LibraryModEntry> {
    index
        .mods
        .iter()
        .find(|entry| entry.id == mod_id)
        .ok_or_else(|| AppError::Other(format!("No installed mod with id {mod_id}")))
}

#[cfg(test)]
mod tests;
