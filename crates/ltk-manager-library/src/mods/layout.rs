//! Where a library's folders sit under its storage directory.

use std::path::{Path, PathBuf};

use crate::mods::advisory_mutes::ADVISORY_MUTES_FILENAME;
use crate::mods::analysis::wad_reports::WAD_REPORTS_FILENAME;
use crate::mods::health::{LEGACY_VERDICTS_FILENAME, MOD_HEALTH_VERDICTS_FILENAME};
use crate::mods::index::document::INDEX_FILE;
use crate::overlay::builtin_mods::DIR as BUILTIN_DIR;
use crate::overlay::{BUILD_RECORD_FILENAME, BUILD_VERSION_MARKER};

/// Names of the entries that a library writes at the root of its storage directory.
const ROOT_ENTRIES: [&str; 11] = [
    INDEX_FILE,
    "mods",
    "archives",
    "profiles",
    BUILTIN_DIR,
    WAD_REPORTS_FILENAME,
    MOD_HEALTH_VERDICTS_FILENAME,
    LEGACY_VERDICTS_FILENAME,
    BUILD_VERSION_MARKER,
    BUILD_RECORD_FILENAME,
    ADVISORY_MUTES_FILENAME,
];

/// The folders of the mod storage directory, read on the directory's path.
pub trait StorageLayout {
    /// `library.json`, the library index.
    fn index_file(&self) -> PathBuf;

    /// `mods/`, which holds each mod's directory and archive.
    fn mods_dir(&self) -> PathBuf;

    /// `archives/`, the legacy layout's one folder of archives keyed by id.
    fn archives_dir(&self) -> PathBuf;

    /// `profiles/`, which holds each profile's directory.
    fn profiles_dir(&self) -> PathBuf;

    /// `builtin/`, which holds the project of each built-in mod.
    fn builtin_dir(&self) -> PathBuf;

    /// `profiles/<slug>`, one profile's directory.
    fn profile_dir(&self, slug: &str) -> PathBuf {
        self.profiles_dir().join(slug)
    }
}

impl StorageLayout for Path {
    fn index_file(&self) -> PathBuf {
        self.join(INDEX_FILE)
    }

    fn mods_dir(&self) -> PathBuf {
        self.join("mods")
    }

    fn archives_dir(&self) -> PathBuf {
        self.join("archives")
    }

    fn profiles_dir(&self) -> PathBuf {
        self.join("profiles")
    }

    fn builtin_dir(&self) -> PathBuf {
        self.join(BUILTIN_DIR)
    }
}

/// Returns `true` if `name` is an entry that a library writes at the root of its storage directory.
///
/// The index backups `library.v<N>.json.bak` match too.
pub fn is_library_entry(name: &str) -> bool {
    if ROOT_ENTRIES.contains(&name) {
        return true;
    }

    name.strip_prefix("library.v")
        .and_then(|rest| rest.strip_suffix(".json.bak"))
        .is_some_and(|version| !version.is_empty() && version.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests;
