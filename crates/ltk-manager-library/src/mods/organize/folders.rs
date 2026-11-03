use ltk_manager_base::config::Config;
use ltk_manager_base::error::{AppError, AppResult};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::mods::ModLibrary;
use crate::mods::index::LibraryIndex;
use crate::mods::types::{ClearedKeptSort, LibraryFolder, ROOT_FOLDER_ID, ReorderOutcome};

/// The folder-shaped view of the index: what groups a mod, and in what order.
///
/// `folder_order` and each folder's `mod_ids` are the record, and every
/// profile's `mod_order` is derived from them. Anything that edits one edits
/// both, which is why these sit together rather than beside their callers.
impl LibraryIndex {
    /// The mod IDs of every folder, in folder order, as one flat sequence.
    ///
    /// Iterates folders in `folder_order`, expanding each folder's `mod_ids` in
    /// place. This is the canonical derivation of `Profile.mod_order`.
    pub(crate) fn flattened_mod_order(&self) -> Vec<String> {
        let mut result = Vec::new();
        for folder_id in &self.folder_order {
            if let Some(folder) = self.folders.iter().find(|f| &f.id == folder_id) {
                result.extend(folder.mod_ids.iter().cloned());
            }
        }
        result
    }

    /// Reconcile folders and folder_order with the current mod set.
    ///
    /// - Removes orphaned mod IDs from all folders.
    /// - Removes folder_order entries referencing nonexistent folders.
    /// - Appends untracked mods to the root folder.
    /// - Ensures all folders appear in folder_order.
    pub(crate) fn sync_folders(&mut self) -> bool {
        let mut changed = false;
        let valid_ids: HashSet<&str> = self.mods.iter().map(|m| m.id.as_str()).collect();

        // Remove orphaned mods from all folders
        for folder in &mut self.folders {
            let before = folder.mod_ids.len();
            folder.mod_ids.retain(|id| valid_ids.contains(id.as_str()));
            if folder.mod_ids.len() != before {
                changed = true;
            }
        }

        // Remove folder_order entries for nonexistent folders
        let valid_folder_ids: HashSet<&str> = self.folders.iter().map(|f| f.id.as_str()).collect();
        let before = self.folder_order.len();
        self.folder_order
            .retain(|id| valid_folder_ids.contains(id.as_str()));
        if self.folder_order.len() != before {
            changed = true;
        }

        // Ensure all folders appear in folder_order
        for folder in &self.folders {
            if !self.folder_order.contains(&folder.id) {
                self.folder_order.push(folder.id.clone());
                changed = true;
            }
        }

        // Find mods not in any folder and add them to the root folder
        let tracked: HashSet<String> = self
            .folders
            .iter()
            .flat_map(|f| f.mod_ids.iter().cloned())
            .collect();

        let untracked: Vec<String> = self
            .mods
            .iter()
            .filter(|m| !tracked.contains(&m.id))
            .map(|m| m.id.clone())
            .collect();

        if !untracked.is_empty()
            && let Some(root) = self.folders.iter_mut().find(|f| f.id == ROOT_FOLDER_ID)
        {
            root.mod_ids.extend(untracked);
            changed = true;
        }

        changed
    }

    /// Write a flat mod order back into the folders it is derived from.
    ///
    /// [`flattened_mod_order`](Self::flattened_mod_order) is what
    /// `Profile.mod_order` is re-derived from, so an order saved only on the
    /// profile is dropped by the next sync. Each folder keeps its own mods,
    /// resequenced by where `mod_ids` puts them. A mod the list does not name
    /// sinks to the end of its folder. A folder whose order changed stops
    /// keeping its sort, and the cleared sorts are returned.
    pub(crate) fn apply_flat_mod_order(&mut self, mod_ids: &[String]) -> Vec<ClearedKeptSort> {
        let rank: HashMap<&str, usize> = mod_ids
            .iter()
            .enumerate()
            .map(|(position, id)| (id.as_str(), position))
            .collect();

        let mut resequenced = Vec::new();
        for folder in &mut self.folders {
            let before = folder.mod_ids.clone();
            folder
                .mod_ids
                .sort_by_key(|id| rank.get(id.as_str()).copied().unwrap_or(usize::MAX));
            if folder.mod_ids != before {
                resequenced.push(folder.id.clone());
            }
        }

        let cleared = resequenced
            .iter()
            .filter_map(|folder_id| self.clear_kept_sort(folder_id))
            .collect();

        self.sync_profile_orders();
        cleared
    }

    /// Move `mod_id` to the front of the folder holding it.
    ///
    /// The front of the folder, not of the library, is as far as enabling a mod
    /// can promote it without moving it out of the folder it was filed under.
    pub(crate) fn promote_mod_to_folder_front(&mut self, mod_id: &str) {
        if let Some(folder) = self
            .folders
            .iter_mut()
            .find(|f| f.mod_ids.iter().any(|id| id == mod_id))
        {
            folder.mod_ids.retain(|id| id != mod_id);
            folder.mod_ids.insert(0, mod_id.to_string());
        }

        self.sync_profile_orders();
    }

    /// Re-derive every profile's mod order from folder_order + folders.
    ///
    /// A mod no folder holds is one no profile can carry, so the flat order is
    /// what `enabled_mods` and `layer_states` are pruned against. Returns
    /// whether any profile moved, which is what tells reconciliation the index
    /// is worth writing back.
    pub(crate) fn sync_profile_orders(&mut self) -> bool {
        let flat = self.flattened_mod_order();
        let flat_set: HashSet<&str> = flat.iter().map(|s| s.as_str()).collect();
        let mut changed = false;

        for profile in &mut self.profiles {
            if profile.mod_order != flat {
                profile.mod_order = flat.clone();
                changed = true;
            }

            let enabled_set: HashSet<&str> =
                profile.enabled_mods.iter().map(|s| s.as_str()).collect();
            let enabled: Vec<String> = flat
                .iter()
                .filter(|id| enabled_set.contains(id.as_str()))
                .cloned()
                .collect();
            if profile.enabled_mods != enabled {
                profile.enabled_mods = enabled;
                changed = true;
            }

            let states = profile.layer_states.len();
            profile
                .layer_states
                .retain(|id, _| flat_set.contains(id.as_str()));
            changed |= profile.layer_states.len() != states;
        }

        changed
    }
}

impl ModLibrary {
    /// Create a new named folder.
    pub fn create_folder(&self, config: &Config, name: &str) -> AppResult<LibraryFolder> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(AppError::ValidationFailed(
                "Folder name cannot be empty".to_string(),
            ));
        }

        self.mutate_index(config, |_storage_dir, index| {
            let folder = LibraryFolder {
                id: Uuid::new_v4().to_string(),
                name,
                mod_ids: Vec::new(),
                kept_sort: None,
            };
            index.folder_order.push(folder.id.clone());
            index.folders.push(folder.clone());
            Ok(folder)
        })
    }

    /// Rename an existing folder. Cannot rename the root folder.
    pub fn rename_folder(&self, config: &Config, folder_id: &str, new_name: &str) -> AppResult<()> {
        if folder_id == ROOT_FOLDER_ID {
            return Err(AppError::ValidationFailed(
                "Cannot rename the root folder".to_string(),
            ));
        }
        let new_name = new_name.trim().to_string();
        if new_name.is_empty() {
            return Err(AppError::ValidationFailed(
                "Folder name cannot be empty".to_string(),
            ));
        }

        self.mutate_index(config, |_storage_dir, index| {
            let folder = index
                .folders
                .iter_mut()
                .find(|f| f.id == folder_id)
                .ok_or_else(|| {
                    AppError::ValidationFailed(format!("Folder {} not found", folder_id))
                })?;
            folder.name = new_name;
            Ok(())
        })
    }

    /// Delete a folder, moving its mods to the root folder. Cannot delete root.
    pub fn delete_folder(&self, config: &Config, folder_id: &str) -> AppResult<()> {
        if folder_id == ROOT_FOLDER_ID {
            return Err(AppError::ValidationFailed(
                "Cannot delete the root folder".to_string(),
            ));
        }

        self.mutate_index(config, |storage_dir, index| {
            let folder_idx = index
                .folders
                .iter()
                .position(|f| f.id == folder_id)
                .ok_or_else(|| {
                    AppError::ValidationFailed(format!("Folder {} not found", folder_id))
                })?;

            let folder = index.folders.remove(folder_idx);
            index.folder_order.retain(|id| id != folder_id);

            // Move contained mods to the root folder
            if let Some(root) = index.folders.iter_mut().find(|f| f.id == ROOT_FOLDER_ID) {
                root.mod_ids.extend(folder.mod_ids);
            }

            index.sync_profile_orders();
            self.place_by_kept_sort(storage_dir, index, ROOT_FOLDER_ID);
            Ok(())
        })
    }

    /// Move a mod into a folder (from any folder, including root).
    pub fn move_mod_to_folder(
        &self,
        config: &Config,
        mod_id: &str,
        folder_id: &str,
    ) -> AppResult<()> {
        self.mutate_index(config, |storage_dir, index| {
            if !index.mods.iter().any(|m| m.id == mod_id) {
                return Err(AppError::ModNotFound(mod_id.to_string()));
            }

            if !index.folders.iter().any(|f| f.id == folder_id) {
                return Err(AppError::ValidationFailed(format!(
                    "Folder {} not found",
                    folder_id
                )));
            }

            // Check if already in target folder
            if index
                .folders
                .iter()
                .find(|f| f.id == folder_id)
                .is_some_and(|f| f.mod_ids.iter().any(|id| id == mod_id))
            {
                return Err(AppError::ValidationFailed(
                    "Mod is already in the target folder".to_string(),
                ));
            }

            // Remove from current folder
            for folder in &mut index.folders {
                folder.mod_ids.retain(|id| id != mod_id);
            }

            // Add to target folder
            let target = index
                .folders
                .iter_mut()
                .find(|f| f.id == folder_id)
                .unwrap();
            target.mod_ids.push(mod_id.to_string());

            index.sync_profile_orders();
            self.place_by_kept_sort(storage_dir, index, folder_id);
            Ok(())
        })
    }

    /// Enable or disable all mods in a folder for the active profile.
    pub fn toggle_folder(&self, config: &Config, folder_id: &str, enabled: bool) -> AppResult<()> {
        self.mutate_index(config, |storage_dir, index| {
            let folder = index
                .folders
                .iter()
                .find(|f| f.id == folder_id)
                .ok_or_else(|| {
                    AppError::ValidationFailed(format!("Folder {} not found", folder_id))
                })?;

            if folder.mod_ids.is_empty() {
                return Err(AppError::ValidationFailed(
                    "Cannot toggle an empty folder".to_string(),
                ));
            }

            let mod_ids: Vec<String> = folder.mod_ids.clone();
            let active_profile_id = index.active_profile_id.clone();
            let profile = index
                .profiles
                .iter_mut()
                .find(|p| p.id == active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;

            if enabled {
                let already_enabled: HashSet<String> =
                    profile.enabled_mods.iter().cloned().collect();
                let to_add: Vec<String> = mod_ids
                    .iter()
                    .filter(|id| !already_enabled.contains(id.as_str()))
                    .cloned()
                    .collect();
                for id in to_add {
                    let pos = profile
                        .mod_order
                        .iter()
                        .position(|m| m == &id)
                        .unwrap_or(profile.enabled_mods.len());
                    let insert_at = profile
                        .enabled_mods
                        .iter()
                        .position(|m| {
                            profile.mod_order.iter().position(|o| o == m).unwrap_or(0) > pos
                        })
                        .unwrap_or(profile.enabled_mods.len());
                    profile.enabled_mods.insert(insert_at, id);
                }
            } else {
                let remove_set: HashSet<&str> = mod_ids.iter().map(|s| s.as_str()).collect();
                profile
                    .enabled_mods
                    .retain(|id| !remove_set.contains(id.as_str()));
            }

            self.place_enabled_by_kept_sort(storage_dir, index, folder_id);
            Ok(())
        })
    }

    /// Reorder mods within a folder. A changed order clears the folder's kept sort.
    pub fn reorder_folder_mods(
        &self,
        config: &Config,
        folder_id: &str,
        mod_ids: Vec<String>,
    ) -> AppResult<ReorderOutcome> {
        self.mutate_index(config, |_storage_dir, index| {
            let folder = index
                .folders
                .iter_mut()
                .find(|f| f.id == folder_id)
                .ok_or_else(|| {
                    AppError::ValidationFailed(format!("Folder {} not found", folder_id))
                })?;

            let mut expected: Vec<&str> = folder.mod_ids.iter().map(|s| s.as_str()).collect();
            expected.sort();
            let mut provided: Vec<&str> = mod_ids.iter().map(|s| s.as_str()).collect();
            provided.sort();

            if expected != provided {
                return Err(AppError::ValidationFailed(
                    "Provided mod IDs do not match the folder's contents".to_string(),
                ));
            }

            let changed = folder.mod_ids != mod_ids;
            folder.mod_ids = mod_ids;

            let cleared = if changed {
                index.clear_kept_sort(folder_id)
            } else {
                None
            };

            index.sync_profile_orders();
            Ok(ReorderOutcome {
                cleared_kept_sorts: cleared.into_iter().collect(),
            })
        })
    }

    /// Reorder top-level folders.
    pub fn reorder_folders(&self, config: &Config, folder_order: Vec<String>) -> AppResult<()> {
        self.mutate_index(config, |_storage_dir, index| {
            let mut expected: Vec<&str> = index.folder_order.iter().map(|s| s.as_str()).collect();
            expected.sort();
            let mut provided: Vec<&str> = folder_order.iter().map(|s| s.as_str()).collect();
            provided.sort();

            if expected != provided {
                return Err(AppError::ValidationFailed(
                    "Provided folder IDs do not match the current folder order".to_string(),
                ));
            }

            index.folder_order = folder_order;
            index.sync_profile_orders();
            Ok(())
        })
    }

    /// Get all folders (including root).
    pub fn get_folders(&self, config: &Config) -> AppResult<Vec<LibraryFolder>> {
        self.with_index(config, |_storage_dir, index| Ok(index.folders.clone()))
    }

    /// Get the current folder ordering.
    pub fn get_folder_order(&self, config: &Config) -> AppResult<Vec<String>> {
        self.with_index(config, |_storage_dir, index| Ok(index.folder_order.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mods::index::{LibraryModEntry, ModArchiveFormat};
    use crate::mods::test_support::make_test_entry;
    use crate::mods::types::{Profile, ProfileSlug};
    use chrono::Utc;
    use std::collections::HashMap;

    fn make_mod_entry(id: &str) -> LibraryModEntry {
        make_test_entry(id, ModArchiveFormat::Fantome)
    }

    fn make_folder(id: &str, name: &str, mod_ids: Vec<&str>) -> LibraryFolder {
        LibraryFolder {
            id: id.to_string(),
            name: name.to_string(),
            mod_ids: mod_ids.into_iter().map(String::from).collect(),
            kept_sort: None,
        }
    }

    fn make_profile(id: &str, mod_order: Vec<&str>, enabled: Vec<&str>) -> Profile {
        Profile {
            id: id.to_string(),
            name: id.to_string(),
            slug: ProfileSlug::from(id.to_string()),
            enabled_mods: enabled.into_iter().map(String::from).collect(),
            mod_order: mod_order.into_iter().map(String::from).collect(),
            layer_states: HashMap::new(),
            created_at: Utc::now(),
            last_used: Utc::now(),
        }
    }

    fn make_index(
        mods: Vec<&str>,
        folders: Vec<LibraryFolder>,
        folder_order: Vec<&str>,
    ) -> LibraryIndex {
        LibraryIndex {
            version: 0,
            mods: mods.into_iter().map(make_mod_entry).collect(),
            profiles: vec![make_profile("default", vec![], vec![])],
            active_profile_id: "default".to_string(),
            folders,
            folder_order: folder_order.into_iter().map(String::from).collect(),
        }
    }

    #[test]
    fn flatten_folder_order_empty_index() {
        let index = make_index(vec![], vec![], vec![]);
        assert!(index.flattened_mod_order().is_empty());
    }

    #[test]
    fn flatten_folder_order_preserves_folder_then_mod_order() {
        let index = make_index(
            vec!["m1", "m2", "m3"],
            vec![
                make_folder(ROOT_FOLDER_ID, "Root", vec!["m3"]),
                make_folder("f1", "Folder 1", vec!["m1", "m2"]),
            ],
            vec![ROOT_FOLDER_ID, "f1"],
        );
        assert_eq!(index.flattened_mod_order(), vec!["m3", "m1", "m2"]);
    }

    #[test]
    fn flatten_folder_order_skips_missing_folder() {
        let index = make_index(
            vec!["m1"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1"])],
            vec![ROOT_FOLDER_ID, "nonexistent"],
        );
        assert_eq!(index.flattened_mod_order(), vec!["m1"]);
    }

    #[test]
    fn sync_folders_removes_orphaned_mods() {
        let mut index = make_index(
            vec!["m1"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1", "m_gone"])],
            vec![ROOT_FOLDER_ID],
        );
        let changed = index.sync_folders();
        assert!(changed);
        assert_eq!(index.folders[0].mod_ids, vec!["m1"]);
    }

    #[test]
    fn sync_folders_removes_orphaned_folder_order_entries() {
        let mut index = make_index(
            vec![],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec![])],
            vec![ROOT_FOLDER_ID, "gone_folder"],
        );
        let changed = index.sync_folders();
        assert!(changed);
        assert_eq!(index.folder_order, vec![ROOT_FOLDER_ID]);
    }

    #[test]
    fn sync_folders_appends_untracked_mods_to_root() {
        let mut index = make_index(
            vec!["m1", "m2"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1"])],
            vec![ROOT_FOLDER_ID],
        );
        let changed = index.sync_folders();
        assert!(changed);
        assert_eq!(index.folders[0].mod_ids, vec!["m1", "m2"]);
    }

    #[test]
    fn sync_folders_ensures_all_folders_in_order() {
        let mut index = make_index(
            vec![],
            vec![
                make_folder(ROOT_FOLDER_ID, "Root", vec![]),
                make_folder("f1", "Folder 1", vec![]),
            ],
            vec![ROOT_FOLDER_ID],
        );
        let changed = index.sync_folders();
        assert!(changed);
        assert_eq!(index.folder_order, vec![ROOT_FOLDER_ID, "f1"]);
    }

    #[test]
    fn apply_flat_mod_order_resequences_each_folder() {
        let mut index = make_index(
            vec!["m1", "m2", "m3", "m4"],
            vec![
                make_folder(ROOT_FOLDER_ID, "Root", vec!["m1", "m2"]),
                make_folder("f1", "Folder 1", vec!["m3", "m4"]),
            ],
            vec![ROOT_FOLDER_ID, "f1"],
        );

        let order: Vec<String> = ["m2", "m1", "m4", "m3"]
            .into_iter()
            .map(String::from)
            .collect();
        index.apply_flat_mod_order(&order);

        assert_eq!(index.folders[0].mod_ids, vec!["m2", "m1"]);
        assert_eq!(index.folders[1].mod_ids, vec!["m4", "m3"]);
        assert_eq!(index.profiles[0].mod_order, order);
    }

    #[test]
    fn apply_flat_mod_order_survives_a_later_sync() {
        let mut index = make_index(
            vec!["m1", "m2", "m3"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1", "m2", "m3"])],
            vec![ROOT_FOLDER_ID],
        );

        let order: Vec<String> = ["m3", "m1", "m2"].into_iter().map(String::from).collect();
        index.apply_flat_mod_order(&order);
        index.sync_profile_orders();

        assert_eq!(index.flattened_mod_order(), order);
        assert_eq!(index.profiles[0].mod_order, order);
    }

    #[test]
    fn apply_flat_mod_order_rederives_enabled_order() {
        let mut index = make_index(
            vec!["m1", "m2", "m3"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1", "m2", "m3"])],
            vec![ROOT_FOLDER_ID],
        );
        index.profiles[0].enabled_mods = vec!["m1".to_string(), "m3".to_string()];

        let order: Vec<String> = ["m3", "m2", "m1"].into_iter().map(String::from).collect();
        index.apply_flat_mod_order(&order);

        assert_eq!(index.profiles[0].enabled_mods, vec!["m3", "m1"]);
    }

    #[test]
    fn apply_flat_mod_order_sinks_an_unnamed_mod() {
        let mut index = make_index(
            vec!["m1", "m2", "m3"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1", "m2", "m3"])],
            vec![ROOT_FOLDER_ID],
        );

        let order: Vec<String> = ["m3", "m1"].into_iter().map(String::from).collect();
        index.apply_flat_mod_order(&order);

        assert_eq!(index.folders[0].mod_ids, vec!["m3", "m1", "m2"]);
    }

    #[test]
    fn promote_mod_to_folder_front_leads_its_own_folder() {
        let mut index = make_index(
            vec!["m1", "m2", "m3", "m4"],
            vec![
                make_folder(ROOT_FOLDER_ID, "Root", vec!["m1", "m2"]),
                make_folder("f1", "Folder 1", vec!["m3", "m4"]),
            ],
            vec![ROOT_FOLDER_ID, "f1"],
        );

        index.promote_mod_to_folder_front("m4");

        assert_eq!(index.folders[1].mod_ids, vec!["m4", "m3"]);
        assert_eq!(index.folders[0].mod_ids, vec!["m1", "m2"]);
        assert_eq!(index.profiles[0].mod_order, vec!["m1", "m2", "m4", "m3"]);
    }

    #[test]
    fn promote_mod_to_folder_front_raises_it_among_the_enabled() {
        let mut index = make_index(
            vec!["m1", "m2", "m3"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1", "m2", "m3"])],
            vec![ROOT_FOLDER_ID],
        );
        index.profiles[0].enabled_mods = vec!["m1".to_string(), "m3".to_string()];

        index.promote_mod_to_folder_front("m3");

        assert_eq!(index.profiles[0].enabled_mods, vec!["m3", "m1"]);
    }

    #[test]
    fn promote_mod_to_folder_front_ignores_a_mod_in_no_folder() {
        let mut index = make_index(
            vec!["m1", "m2"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1", "m2"])],
            vec![ROOT_FOLDER_ID],
        );

        index.promote_mod_to_folder_front("m_gone");

        assert_eq!(index.folders[0].mod_ids, vec!["m1", "m2"]);
        assert_eq!(index.profiles[0].mod_order, vec!["m1", "m2"]);
    }

    #[test]
    fn sync_profile_orders_reports_a_profile_that_moved() {
        let mut index = make_index(
            vec!["m1", "m2"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m2", "m1"])],
            vec![ROOT_FOLDER_ID],
        );
        index.profiles[0].mod_order = vec!["m1".to_string(), "m2".to_string()];

        assert!(index.sync_profile_orders());
        assert_eq!(index.profiles[0].mod_order, vec!["m2", "m1"]);
    }

    #[test]
    fn sync_profile_orders_reports_nothing_when_settled() {
        let mut index = make_index(
            vec!["m1", "m2"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1", "m2"])],
            vec![ROOT_FOLDER_ID],
        );
        index.profiles[0].mod_order = vec!["m1".to_string(), "m2".to_string()];
        index.profiles[0].enabled_mods = vec!["m1".to_string()];

        assert!(!index.sync_profile_orders());
    }

    #[test]
    fn sync_profile_orders_drops_layer_states_no_folder_holds() {
        let mut index = make_index(
            vec!["m1", "m2"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1"])],
            vec![ROOT_FOLDER_ID],
        );
        index.profiles[0].layer_states = HashMap::from([
            ("m1".to_string(), HashMap::new()),
            ("m2".to_string(), HashMap::new()),
        ]);

        assert!(index.sync_profile_orders());
        assert_eq!(
            index.profiles[0].layer_states.keys().collect::<Vec<_>>(),
            vec!["m1"]
        );
    }

    #[test]
    fn sync_folders_returns_false_when_clean() {
        let mut index = make_index(
            vec!["m1"],
            vec![make_folder(ROOT_FOLDER_ID, "Root", vec!["m1"])],
            vec![ROOT_FOLDER_ID],
        );
        let changed = index.sync_folders();
        assert!(!changed);
    }
}
