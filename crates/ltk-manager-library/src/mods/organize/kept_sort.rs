//! The sort a folder keeps its load order in.
//!
//! A folder's `mod_ids` is the load order record. A folder with a kept sort is re-sorted
//! after every write that adds a mod to it or changes a sort key, so an install, a move, a
//! rename and an enable all land the mod where the rule puts it. A reorder by hand clears
//! the rule, which `folders` reports through [`ReorderOutcome`].

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use chrono::{DateTime, Utc};
use ltk_manager_base::config::Config;
use ltk_manager_base::error::{AppError, AppResult};

use crate::mods::ModLibrary;
use crate::mods::archive::metadata::load_mod_project;
use crate::mods::index::LibraryIndex;
use crate::mods::types::{ClearedKeptSort, KeptSort, KeptSortField, SortDirection};

/// What a kept sort compares one mod by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SortKey {
    /// The display name, lowercased.
    pub(crate) name: String,
    /// The alphabetically first champion, lowercased. `None` for a mod naming none.
    pub(crate) champion: Option<String>,
    pub(crate) installed_at: DateTime<Utc>,
    /// Whether the active profile enables the mod.
    pub(crate) enabled: bool,
}

/// Orders `mod_ids` by `sort`. Mods that compare equal keep their order.
pub(crate) fn kept_order(
    mod_ids: &[String],
    sort: KeptSort,
    key_of: impl Fn(&str) -> SortKey,
) -> Vec<String> {
    let mut keyed: Vec<(String, SortKey)> =
        mod_ids.iter().map(|id| (id.clone(), key_of(id))).collect();
    keyed.sort_by(|(_, a), (_, b)| compare(sort, a, b));

    keyed.into_iter().map(|(id, _)| id).collect()
}

/// Compares two keys under `sort`. A mod with no champion sorts last in either direction,
/// and two mods of one champion, or of none, compare by name.
fn compare(sort: KeptSort, a: &SortKey, b: &SortKey) -> Ordering {
    let directed = |ordering: Ordering| match sort.direction {
        SortDirection::Asc => ordering,
        SortDirection::Desc => ordering.reverse(),
    };

    match sort.field {
        KeptSortField::Name => directed(a.name.cmp(&b.name)),
        KeptSortField::Champion => match (&a.champion, &b.champion) {
            (Some(x), Some(y)) => directed(x.cmp(y)).then_with(|| a.name.cmp(&b.name)),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => a.name.cmp(&b.name),
        },
        KeptSortField::InstalledAt => directed(a.installed_at.cmp(&b.installed_at)),
        KeptSortField::Enabled => b.enabled.cmp(&a.enabled),
    }
}

impl LibraryIndex {
    /// Writes `kept_order` of `folder_id` under `sort` and re-derives the profile orders.
    ///
    /// Returns `true` if the folder's order changed. Does nothing if no folder has `folder_id`.
    pub(crate) fn sort_folder(
        &mut self,
        folder_id: &str,
        sort: KeptSort,
        key_of: impl Fn(&str) -> SortKey,
    ) -> bool {
        let Some(folder) = self.folders.iter_mut().find(|f| f.id == folder_id) else {
            return false;
        };

        let sorted = kept_order(&folder.mod_ids, sort, key_of);
        if sorted == folder.mod_ids {
            return false;
        }

        folder.mod_ids = sorted;
        self.sync_profile_orders();
        true
    }

    /// Clears the kept sort of `folder_id`, returning what was cleared.
    ///
    /// Returns `None` if the folder kept no sort or no folder has `folder_id`.
    pub(crate) fn clear_kept_sort(&mut self, folder_id: &str) -> Option<ClearedKeptSort> {
        let folder = self.folders.iter_mut().find(|f| f.id == folder_id)?;
        let kept_sort = folder.kept_sort.take()?;

        Some(ClearedKeptSort {
            folder_id: folder.id.clone(),
            folder_name: folder.name.clone(),
            kept_sort,
        })
    }

    /// The kept sort of `folder_id`, or `None` for a folder ordered by hand.
    pub(crate) fn kept_sort_of(&self, folder_id: &str) -> Option<KeptSort> {
        self.folders
            .iter()
            .find(|f| f.id == folder_id)
            .and_then(|f| f.kept_sort)
    }

    /// The folder that holds `mod_id`, or `None` for a mod no folder holds.
    pub(crate) fn folder_of(&self, mod_id: &str) -> Option<String> {
        self.folders
            .iter()
            .find(|f| f.mod_ids.iter().any(|id| id == mod_id))
            .map(|f| f.id.clone())
    }
}

impl ModLibrary {
    /// Re-sorts `folder_id` by the sort it keeps, if it keeps one.
    ///
    /// Reads each mod's config for a name or champion sort, so a caller runs it once per
    /// write rather than once per mod. A mod whose config does not read sorts as a mod with
    /// an empty name and no champion. Returns `true` if the folder's order changed.
    pub(crate) fn place_by_kept_sort(
        &self,
        storage_dir: &Path,
        index: &mut LibraryIndex,
        folder_id: &str,
    ) -> bool {
        let Some(sort) = index.kept_sort_of(folder_id) else {
            return false;
        };

        let enabled: HashSet<String> = index
            .profiles
            .iter()
            .find(|p| p.id == index.active_profile_id)
            .map(|p| p.enabled_mods.iter().cloned().collect())
            .unwrap_or_default();
        let reads_config = matches!(sort.field, KeptSortField::Name | KeptSortField::Champion);
        let derived = if sort.field == KeptSortField::Champion {
            self.derived_champions()
        } else {
            HashMap::new()
        };

        let keys: HashMap<String, SortKey> = index
            .folders
            .iter()
            .find(|f| f.id == folder_id)
            .map(|folder| {
                folder
                    .mod_ids
                    .iter()
                    .map(|id| {
                        let key =
                            sort_key(storage_dir, index, id, reads_config, &derived, &enabled);
                        (id.clone(), key)
                    })
                    .collect()
            })
            .unwrap_or_default();

        index.sort_folder(folder_id, sort, |id| {
            keys.get(id).cloned().unwrap_or_else(|| SortKey {
                name: String::new(),
                champion: None,
                installed_at: DateTime::<Utc>::MIN_UTC,
                enabled: false,
            })
        })
    }

    /// Re-sorts `folder_id` if it keeps the enabled-first sort, which is the one an enable moves.
    pub(crate) fn place_enabled_by_kept_sort(
        &self,
        storage_dir: &Path,
        index: &mut LibraryIndex,
        folder_id: &str,
    ) -> bool {
        let keeps_enabled = index
            .kept_sort_of(folder_id)
            .is_some_and(|sort| sort.field == KeptSortField::Enabled);
        if !keeps_enabled {
            return false;
        }

        self.place_by_kept_sort(storage_dir, index, folder_id)
    }

    /// Re-sorts the folder that holds `mod_id`, if that folder keeps the enabled-first sort.
    pub(crate) fn place_mod_enabled_by_kept_sort(
        &self,
        storage_dir: &Path,
        index: &mut LibraryIndex,
        mod_id: &str,
    ) -> bool {
        match index.folder_of(mod_id) {
            Some(folder_id) => self.place_enabled_by_kept_sort(storage_dir, index, &folder_id),
            None => false,
        }
    }

    /// Re-sorts the folder that holds `mod_id`, if that folder keeps a sort.
    pub(crate) fn place_mod_by_kept_sort(
        &self,
        storage_dir: &Path,
        index: &mut LibraryIndex,
        mod_id: &str,
    ) -> bool {
        match index.folder_of(mod_id) {
            Some(folder_id) => self.place_by_kept_sort(storage_dir, index, &folder_id),
            None => false,
        }
    }

    /// Sets the kept sort of each of `folder_ids`, and sorts each by it.
    ///
    /// `None` clears the sort and leaves the order as it is.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::ValidationFailed`] if any of `folder_ids` names no folder.
    pub fn set_kept_sort(
        &self,
        config: &Config,
        folder_ids: &[String],
        kept_sort: Option<KeptSort>,
    ) -> AppResult<()> {
        self.mutate_index(config, |storage_dir, index| {
            for folder_id in folder_ids {
                let folder = index
                    .folders
                    .iter_mut()
                    .find(|f| &f.id == folder_id)
                    .ok_or_else(|| {
                        AppError::ValidationFailed(format!("Folder {} not found", folder_id))
                    })?;
                folder.kept_sort = kept_sort;
            }

            if kept_sort.is_some() {
                for folder_id in folder_ids {
                    self.place_by_kept_sort(storage_dir, index, folder_id);
                }
            }

            Ok(())
        })
    }

    /// The champions each mod's footprint analysis derived, by mod id.
    fn derived_champions(&self) -> HashMap<String, Vec<String>> {
        self.wad_reports
            .0
            .lock()
            .get_all()
            .into_iter()
            .map(|(id, report)| (id, report.derived.champions))
            .collect()
    }
}

/// The sort key of `mod_id`, reading its config only where `reads_config` asks for it.
fn sort_key(
    storage_dir: &Path,
    index: &LibraryIndex,
    mod_id: &str,
    reads_config: bool,
    derived: &HashMap<String, Vec<String>>,
    enabled: &HashSet<String>,
) -> SortKey {
    let entry = index.mods.iter().find(|m| m.id == mod_id);
    let project = entry
        .filter(|_| reads_config)
        .and_then(|entry| load_mod_project(&entry.mod_dir(storage_dir)).ok());

    let name = project
        .as_ref()
        .map(|project| project.display_name.to_lowercase())
        .unwrap_or_default();

    let champion = project
        .iter()
        .flat_map(|project| project.champions.iter())
        .chain(derived.get(mod_id).into_iter().flatten())
        .map(|champion| champion.to_lowercase())
        .min();

    SortKey {
        name,
        champion,
        installed_at: entry.map_or(DateTime::<Utc>::MIN_UTC, |entry| entry.installed_at),
        enabled: enabled.contains(mod_id),
    }
}

#[cfg(test)]
mod tests;
