//! Where a library's folders sit under its storage directory.

use std::path::{Path, PathBuf};

/// The folders of the mod storage directory, read on the directory's path.
pub trait StorageLayout {
    /// `mods/`, which holds each mod's directory and archive.
    fn mods_dir(&self) -> PathBuf;

    /// `archives/`, the legacy layout's one folder of archives keyed by id.
    fn archives_dir(&self) -> PathBuf;

    /// `profiles/`, which holds each profile's directory.
    fn profiles_dir(&self) -> PathBuf;

    /// `profiles/<slug>`, one profile's directory.
    fn profile_dir(&self, slug: &str) -> PathBuf {
        self.profiles_dir().join(slug)
    }
}

impl StorageLayout for Path {
    fn mods_dir(&self) -> PathBuf {
        self.join("mods")
    }

    fn archives_dir(&self) -> PathBuf {
        self.join("archives")
    }

    fn profiles_dir(&self) -> PathBuf {
        self.join("profiles")
    }
}
