//! Moves the data directory of the manager to another folder.
//!
//! The data directory is `Config::mod_storage_path`, or the app data directory if the setting is
//! unset. A move carries only the entries that the library and the shell write there, so a folder
//! that holds other files keeps them. See ADR-0069.

use fs_err as fs;
use ltk_manager_base::config::Config;
use ltk_manager_base::platform::free_disk_bytes;
use ltk_manager_library::mods::{is_library_entry, StorageLayout as _};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

/// The directory of the unpacked copies of packed mods, under the data directory.
pub const MOD_PREVIEWS: &str = "mod-previews";

/// The directory of the translated shaders, under the data directory.
pub const SHADERS: &str = "shaders";

/// The directory of the patcher delivery state, under the data directory.
pub const PATCHER: &str = "patcher";

/// The directory of the incident store, under the data directory.
pub const INCIDENTS: &str = "incidents";

/// The directory of the game store, under the data directory.
pub const GAMES: &str = "games";

/// Names of the entries that the shell writes under the data directory.
const SHELL_ENTRIES: [&str; 5] = [MOD_PREVIEWS, SHADERS, PATCHER, INCIDENTS, GAMES];

/// Resolves the data directory that `config` selects.
///
/// Returns the app data directory if `config` sets no storage path. Returns `None` if the
/// setting is unset and the app data directory cannot be resolved.
pub fn data_dir(app_handle: &AppHandle, config: &Config) -> Option<PathBuf> {
    data_dir_under(crate::state::get_app_data_dir(app_handle), config)
}

/// Resolves the data directory that `config` selects, for the app data directory `app_data`.
///
/// Returns `app_data` if `config` sets no storage path.
pub fn data_dir_under(app_data: Option<PathBuf>, config: &Config) -> Option<PathBuf> {
    config.mod_storage_path.clone().or(app_data)
}

/// What a move of the data directory does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataMoveKind {
    /// The entries of the current directory move into the new folder.
    Move,
    /// The new folder holds a library and the current directory holds none, so nothing moves.
    Adopt,
}

/// One entry of the data directory that a move carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataEntry {
    /// The entry's name under the data directory.
    pub name: String,
    /// Bytes of the files under the entry.
    pub bytes: u64,
}

/// A move of the data directory, planned before anything is written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataMovePlan {
    pub kind: DataMoveKind,
    /// The current data directory.
    pub from: PathBuf,
    /// The new data directory.
    pub to: PathBuf,
    /// The entries that move. Empty for [`DataMoveKind::Adopt`].
    pub entries: Vec<DataEntry>,
}

impl DataMovePlan {
    /// Returns the bytes under every entry that moves.
    pub fn bytes(&self) -> u64 {
        self.entries.iter().map(|entry| entry.bytes).sum()
    }
}

/// A reason that a data directory move is refused or failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DataMoveError {
    /// The new folder is the current data directory.
    #[error("the new folder is the current data folder")]
    SameFolder,
    /// The new folder is inside an entry that the move carries.
    #[error("the new folder is inside the data that moves")]
    InsideData,
    /// Both folders hold data entries with these names.
    #[error("the new folder already contains {entries:?}")]
    Occupied { entries: Vec<String> },
    /// The patcher is running and holds files of the data directory.
    #[error("the patcher is running")]
    PatcherRunning,
    /// The volume of the new folder has less free space than the move needs.
    #[error("the new folder has {available} bytes free and the move needs {needed}")]
    NoSpace { needed: u64, available: u64 },
    /// A read, a write or a rename failed.
    #[error("{detail}")]
    Io { detail: String },
}

impl From<std::io::Error> for DataMoveError {
    fn from(error: std::io::Error) -> Self {
        Self::Io {
            detail: error.to_string(),
        }
    }
}

/// Plans a move of the data directory from `from` to `to`.
///
/// Returns [`DataMoveKind::Adopt`] if `to` holds a library and `from` holds none.
///
/// # Errors
///
/// Fails with [`DataMoveError::SameFolder`] if both name one folder, with
/// [`DataMoveError::InsideData`] if `to` is inside an entry that moves, with
/// [`DataMoveError::Occupied`] if `to` already holds an entry that moves, with
/// [`DataMoveError::NoSpace`] if the volume of `to` cannot hold the entries, and with
/// [`DataMoveError::Io`] if a folder cannot be read.
pub fn plan(from: &Path, to: &Path) -> Result<DataMovePlan, DataMoveError> {
    let (from_resolved, to_resolved) = (resolve(from)?, resolve(to)?);
    if from_resolved == to_resolved {
        return Err(DataMoveError::SameFolder);
    }

    let adopt = to.index_file().is_file() && !from.index_file().is_file();
    if adopt {
        return Ok(DataMovePlan {
            kind: DataMoveKind::Adopt,
            from: from.to_path_buf(),
            to: to.to_path_buf(),
            entries: Vec::new(),
        });
    }

    let names = data_entries(from)?;
    if names
        .iter()
        .any(|name| to_resolved.starts_with(from_resolved.join(name)))
    {
        return Err(DataMoveError::InsideData);
    }

    let occupied = data_entries(to)?;
    if !occupied.is_empty() {
        return Err(DataMoveError::Occupied { entries: occupied });
    }

    let entries = names
        .into_iter()
        .map(|name| {
            let bytes = size_of(&from.join(&name));
            DataEntry { name, bytes }
        })
        .collect();
    let plan = DataMovePlan {
        kind: DataMoveKind::Move,
        from: from.to_path_buf(),
        to: to.to_path_buf(),
        entries,
    };

    if !same_volume(&from_resolved, &to_resolved) {
        let needed = plan.bytes();
        let available = free_disk_bytes(nearest_existing(&plan.to));
        if let Some(available) = available.filter(|&available| available < needed) {
            return Err(DataMoveError::NoSpace { needed, available });
        }
    }

    Ok(plan)
}

/// How one entry reached the new folder, for the rollback and the cleanup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Moved {
    Renamed,
    Copied,
}

/// Moves the entries of `plan` into its new folder.
///
/// Renames each entry, and copies it if the rename fails, as it does across volumes.
/// `report` receives the name of the entry in flight and the bytes moved so far, once per file.
/// A copied entry is removed from the old folder only after every entry reached the new folder,
/// and a removal that fails is logged and skipped.
///
/// # Errors
///
/// Fails with [`DataMoveError::Io`] if an entry can be neither renamed nor copied. The entries
/// that already moved return to the old folder first.
pub fn run(plan: &DataMovePlan, mut report: impl FnMut(&str, u64)) -> Result<(), DataMoveError> {
    fs::create_dir_all(&plan.to)?;

    let mut moved_bytes = 0;
    let mut moved: Vec<(&DataEntry, Moved)> = Vec::with_capacity(plan.entries.len());

    for entry in &plan.entries {
        let source = plan.from.join(&entry.name);
        let target = plan.to.join(&entry.name);
        report(&entry.name, moved_bytes);

        if fs::rename(&source, &target).is_ok() {
            moved_bytes += entry.bytes;
            moved.push((entry, Moved::Renamed));
            continue;
        }

        let copied = copy_entry(&source, &target, |bytes| {
            moved_bytes += bytes;
            report(&entry.name, moved_bytes);
        });
        if let Err(error) = copied {
            remove_entry(&target);
            roll_back(plan, &moved);
            return Err(error);
        }
        moved.push((entry, Moved::Copied));
    }

    for (entry, how) in &moved {
        if *how == Moved::Copied {
            remove_entry(&plan.from.join(&entry.name));
        }
    }

    Ok(())
}

/// Returns the entries of the data directory under `dir`, sorted by name.
fn data_entries(dir: &Path) -> Result<Vec<String>, DataMoveError> {
    let read = match fs::read_dir(dir) {
        Ok(read) => read,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };

    let mut names = Vec::new();
    for entry in read {
        let name = entry?.file_name().to_string_lossy().into_owned();
        if is_library_entry(&name) || SHELL_ENTRIES.contains(&name.as_str()) {
            names.push(name);
        }
    }

    names.sort();
    Ok(names)
}

/// Resolves `path` to an absolute path with its links followed.
///
/// A folder that does not exist yet resolves through its nearest existing ancestor.
fn resolve(path: &Path) -> Result<PathBuf, DataMoveError> {
    let existing = nearest_existing(path);
    let rest = path.strip_prefix(existing).unwrap_or(Path::new(""));
    Ok(fs::canonicalize(existing)?.join(rest))
}

/// Returns `path`, or its nearest ancestor that exists.
fn nearest_existing(path: &Path) -> &Path {
    path.ancestors()
        .find(|ancestor| ancestor.exists())
        .unwrap_or(path)
}

/// Returns `true` if both paths start with the same drive or share.
fn same_volume(a: &Path, b: &Path) -> bool {
    let prefix = |path: &Path| match path.components().next() {
        Some(Component::Prefix(prefix)) => Some(prefix.as_os_str().to_ascii_lowercase()),
        _ => None,
    };
    prefix(a) == prefix(b)
}

/// Returns the bytes of the files under `path`. An unreadable file counts as empty.
pub(crate) fn size_of(path: &Path) -> u64 {
    walkdir::WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|metadata| metadata.len())
        .sum()
}

/// Copies the file or the directory at `source` to `target`, and reports the bytes of each file.
///
/// Symlinks are skipped. Fails if a copied file has another length than its source.
fn copy_entry(
    source: &Path,
    target: &Path,
    mut copied: impl FnMut(u64),
) -> Result<(), DataMoveError> {
    for entry in walkdir::WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(std::io::Error::from)?;
        let relative = entry.path().strip_prefix(source).unwrap_or(Path::new(""));
        let destination = target.join(relative);

        let file_type = entry.file_type();
        if file_type.is_dir() {
            fs::create_dir_all(&destination)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }

        let expected = entry.metadata().map_err(std::io::Error::from)?.len();
        let written = fs::copy(entry.path(), &destination)?;
        if written != expected {
            return Err(DataMoveError::Io {
                detail: format!(
                    "copied {written} of {expected} bytes of {}",
                    entry.path().display()
                ),
            });
        }
        copied(written);
    }

    Ok(())
}

/// Removes the file or the directory at `path`. A failure is logged and skipped.
fn remove_entry(path: &Path) {
    let removed = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };

    if let Err(error) = removed {
        if error.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(%error, "Could not remove a data entry after the move");
        }
    }
}

/// Returns each entry in `moved` to the old folder of `plan`. A failure is logged and skipped.
fn roll_back(plan: &DataMovePlan, moved: &[(&DataEntry, Moved)]) {
    for (entry, how) in moved.iter().rev() {
        let target = plan.to.join(&entry.name);
        match how {
            Moved::Renamed => {
                if let Err(error) = fs::rename(&target, plan.from.join(&entry.name)) {
                    tracing::error!(%error, "Could not return a data entry to the old folder");
                }
            }
            Moved::Copied => remove_entry(&target),
        }
    }
}

#[cfg(test)]
mod tests;
