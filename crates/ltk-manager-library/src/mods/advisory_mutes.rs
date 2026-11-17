//! Muted advisories: `advisory-mutes.json` in the storage directory.
//!
//! Some advisories describe a state that the user chose. A mute hides one advisory code of
//! one mod from the session bar and the mod card. It does not hide the advisory from the
//! support report. A mute holds the content and the priority of the mod at the time of the
//! mute, and applies while both are unchanged.

use std::path::Path;

use ltk_manager_base::{
    advisory::AdvisoryCode,
    config::Config,
    error::{AppError, AppResult},
    events::BackendEvent,
    utils::fs::{read_json_or_default, write_json},
};
use serde::{Deserialize, Serialize};

use super::ModLibrary;

/// Name of the file that holds the muted advisories.
pub(crate) const ADVISORY_MUTES_FILENAME: &str = "advisory-mutes.json";

/// The content and the priority of a mod, which a change of either clears a mute of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModState {
    /// The fingerprint of the content of the mod, from its archive report. `None` if the
    /// mod has no report.
    content: Option<u64>,
    /// The position of the mod among the enabled mods of the active profile. `None` if
    /// the mod is not enabled.
    priority: Option<usize>,
}

/// One muted advisory code of one mod.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mute {
    code: AdvisoryCode,
    mod_id: String,
    /// The state of the mod at the time of the mute.
    state: ModState,
}

/// The mutes of a library, as the file holds them.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(transparent)]
struct Mutes(Vec<Mute>);

impl Mutes {
    fn load(storage_dir: &Path) -> Self {
        read_json_or_default(&storage_dir.join(ADVISORY_MUTES_FILENAME))
    }

    fn save(&self, storage_dir: &Path) -> AppResult<()> {
        write_json(&storage_dir.join(ADVISORY_MUTES_FILENAME), self)
    }
}

/// The advisory codes that are muted for each mod, with the mutes that no longer apply
/// left out.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MutedAdvisories(Vec<(AdvisoryCode, String)>);

impl MutedAdvisories {
    /// Returns whether `code` is muted for the mod `mod_id`.
    #[must_use]
    pub fn holds(&self, code: AdvisoryCode, mod_id: &str) -> bool {
        self.0
            .iter()
            .any(|(muted, id)| *muted == code && id == mod_id)
    }
}

impl ModLibrary {
    /// Mutes the advisory `code` for the mod `mod_id`, and tells the frontend that the
    /// advisories changed.
    ///
    /// The mute applies while the content and the priority of the mod stay as they are
    /// now. Removes the mutes that no longer apply.
    ///
    /// # Errors
    ///
    /// Fails if the index cannot be read or the mutes cannot be written.
    pub fn mute_advisory(
        &self,
        config: &Config,
        code: AdvisoryCode,
        mod_id: &str,
    ) -> AppResult<()> {
        let storage_dir = self.storage_dir(config)?;
        let mut mutes = Mutes::load(&storage_dir);
        let mut kept = Vec::with_capacity(mutes.0.len() + 1);
        for mute in mutes.0.drain(..) {
            let replaced = mute.code == code && mute.mod_id == mod_id;
            if !replaced && self.mod_state(config, &mute.mod_id)? == mute.state {
                kept.push(mute);
            }
        }
        kept.push(Mute {
            code,
            mod_id: mod_id.to_owned(),
            state: self.mod_state(config, mod_id)?,
        });
        Mutes(kept).save(&storage_dir)?;
        self.events().emit(BackendEvent::AdvisoriesUpdated);
        Ok(())
    }

    /// Returns the muted advisories that still apply: the mutes of a mod whose content and
    /// priority are the ones at the time of the mute.
    ///
    /// # Errors
    ///
    /// Fails if the index cannot be read.
    pub fn muted_advisories(&self, config: &Config) -> AppResult<MutedAdvisories> {
        let storage_dir = self.storage_dir(config)?;
        let mut muted = Vec::new();
        for mute in Mutes::load(&storage_dir).0 {
            if self.mod_state(config, &mute.mod_id)? == mute.state {
                muted.push((mute.code, mute.mod_id));
            }
        }
        Ok(MutedAdvisories(muted))
    }

    /// Returns the content and the priority of the mod `mod_id` in the active profile.
    fn mod_state(&self, config: &Config, mod_id: &str) -> AppResult<ModState> {
        let priority = self.with_index(config, |_, index| {
            let profile = index
                .profiles
                .iter()
                .find(|profile| profile.id == index.active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;
            Ok(profile.enabled_mods.iter().position(|id| id == mod_id))
        })?;
        let content = self
            .wad_reports()
            .0
            .lock()
            .get(mod_id)
            .and_then(|report| report.content_fingerprint);
        Ok(ModState { content, priority })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mods::index::LibraryIndex;
    use crate::mods::test_support::{
        RecordingEventSink, make_library_with_events, make_test_library, make_test_profile,
        make_unpacked_entry,
    };
    use crate::mods::types::{LibraryFolder, ROOT_FOLDER_ID};

    /// Saves an index with the mods `enabled`, enabled in that order.
    fn save_index(storage: &Path, enabled: &[&str]) {
        let index = LibraryIndex {
            version: 0,
            mods: enabled
                .iter()
                .map(|id| make_unpacked_entry(id, id))
                .collect(),
            profiles: vec![make_test_profile(
                "p1",
                "Default",
                enabled.to_vec(),
                enabled.to_vec(),
            )],
            active_profile_id: "p1".to_string(),
            folders: vec![LibraryFolder {
                id: ROOT_FOLDER_ID.to_string(),
                name: String::new(),
                mod_ids: enabled.iter().map(|id| (*id).to_string()).collect(),
                kept_sort: None,
            }],
            folder_order: vec![ROOT_FOLDER_ID.to_string()],
        };
        crate::mods::index::document::save_library_index(storage, &index).unwrap();
    }

    #[test]
    fn a_mute_holds_for_its_code_and_its_mod_only() {
        let storage = tempfile::tempdir().unwrap();
        let (library, config) = make_test_library(storage.path());
        save_index(storage.path(), &["a", "b"]);

        library
            .mute_advisory(&config, AdvisoryCode::LayersUnset, "a")
            .unwrap();

        let muted = library.muted_advisories(&config).unwrap();
        assert!(muted.holds(AdvisoryCode::LayersUnset, "a"));
        assert!(!muted.holds(AdvisoryCode::LayersUnset, "b"));
        assert!(!muted.holds(AdvisoryCode::ModContentMissing, "a"));
    }

    #[test]
    fn a_change_of_the_priority_clears_the_mute() {
        let storage = tempfile::tempdir().unwrap();
        let (library, config) = make_test_library(storage.path());
        save_index(storage.path(), &["a", "b"]);
        library
            .mute_advisory(&config, AdvisoryCode::LayersUnset, "b")
            .unwrap();

        save_index(storage.path(), &["b", "a"]);

        let muted = library.muted_advisories(&config).unwrap();
        assert!(!muted.holds(AdvisoryCode::LayersUnset, "b"));
    }

    #[test]
    fn mute_advisory_announces_the_change() {
        let storage = tempfile::tempdir().unwrap();
        let sink = std::sync::Arc::new(RecordingEventSink::default());
        let (library, config) = make_library_with_events(storage.path(), sink.clone());
        save_index(storage.path(), &["a"]);

        library
            .mute_advisory(&config, AdvisoryCode::LayersUnset, "a")
            .unwrap();

        assert_eq!(sink.names(), ["advisories-updated"]);
    }
}
