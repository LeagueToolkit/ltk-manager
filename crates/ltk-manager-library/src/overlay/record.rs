//! The record of the last overlay build: `last-build.json` in the storage directory.
//!
//! The record says which mods the last build applied and which advisories it raised. The
//! frontend reads it for the session bar and the mod cards, and the support report reads it
//! for `overlay.json`. A build replaces the record of the build before it.

use std::path::Path;

use chrono::{DateTime, Utc};
use fs_err as fs;
use ltk_manager_base::{
    advisory::Advisories, error::AppResult, hashing::OverlayFingerprint, utils::fs::write_json,
};
use serde::{Deserialize, Serialize};

/// Name of the file that holds the record of the last build.
pub(crate) const BUILD_RECORD_FILENAME: &str = "last-build.json";

/// What one overlay build applied and which advisories it raised.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecord {
    pub built_at: DateTime<Utc>,
    /// The fingerprint of the overlay. `None` if the overlay state cannot be read.
    pub fingerprint: Option<OverlayFingerprint>,
    /// The ids of the mods that the build applied, in the order the builder got them: the
    /// built-in mods, the workshop projects under test, then the enabled mods.
    pub mods: Vec<String>,
    pub advisories: Advisories,
}

impl BuildRecord {
    /// Reads the record of the last build under `storage_dir`.
    ///
    /// Returns `None` if no build was recorded there, or if the file cannot be read.
    #[must_use]
    pub fn load(storage_dir: &Path) -> Option<Self> {
        let path = storage_dir.join(BUILD_RECORD_FILENAME);
        let bytes = fs::read(&path).ok()?;
        serde_json::from_slice(&bytes)
            .inspect_err(|e| {
                tracing::warn!("The build record {} is unreadable: {e}", path.display())
            })
            .ok()
    }

    /// Writes the record as the last build under `storage_dir`.
    ///
    /// # Errors
    ///
    /// Fails if the file cannot be written.
    pub fn save(&self, storage_dir: &Path) -> AppResult<()> {
        write_json(&storage_dir.join(BUILD_RECORD_FILENAME), self)
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use ltk_manager_base::advisory::{Advisory, AdvisoryCode, AdvisorySubject};

    use super::*;

    #[test]
    fn a_record_round_trips_and_a_missing_file_is_no_record() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(BuildRecord::load(dir.path()), None);

        let built_at = Utc.with_ymd_and_hms(2026, 11, 17, 12, 0, 0).unwrap();
        let mut advisories = Advisories::default();
        advisories.raise(
            Advisory::new(AdvisoryCode::ModMissing, built_at)
                .about(AdvisorySubject::mod_id("gone")),
        );
        let record = BuildRecord {
            built_at,
            fingerprint: None,
            mods: vec!["keep".to_owned()],
            advisories,
        };
        record.save(dir.path()).unwrap();

        assert_eq!(BuildRecord::load(dir.path()), Some(record));
    }

    #[test]
    fn load_returns_none_for_a_file_that_is_not_a_record() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(BUILD_RECORD_FILENAME), "{ not json").unwrap();

        assert_eq!(BuildRecord::load(dir.path()), None);
    }
}
