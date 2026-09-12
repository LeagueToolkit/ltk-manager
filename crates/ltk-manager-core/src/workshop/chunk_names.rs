//! The chunk paths a workshop project's own content names.
//!
//! The shared mimir tables are a crawl of the retail game, so a path a mod author
//! invents is in none of them. A project's layers hold those paths literally, and the
//! tables its manifest declares list the ones its archives no longer carry.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use camino::Utf8Path;
use fs_err as fs;
use ltk_hash::{Hash as _, WadHash};
use ltk_hashtable::Hashtable;
use ltk_mod_project::{CONTENT_DIR_NAME, ModProject};
use walkdir::WalkDir;

use crate::preview::AssetRef;

use super::layer::{self, Layer};
use crate::utils::natural_order::compare_names;

/// The chunk paths one project names, by the hash a `file` value addresses them with.
#[derive(Debug, Default)]
pub struct LayerChunks {
    by_hash: HashMap<WadHash, String>,
    /// The layer file behind each walked path, keyed by that path lowercased. A path a
    /// declared table names alone has no file, so it is absent here. Where two layers
    /// hold one path, the file kept is the higher-priority layer's.
    by_path: HashMap<String, AssetRef>,
}

impl LayerChunks {
    /// The names the project behind `asset` holds, and none for an asset outside one.
    #[must_use]
    pub fn of(asset: &AssetRef) -> Self {
        match asset {
            AssetRef::Layer { project, .. } => Self::scan(Path::new(project)),
            _ => Self::default(),
        }
    }

    /// Every chunk path `project_dir`'s layers hold and its declared tables list.
    ///
    /// Best-effort: a project that loads no manifest still has its layers walked, and
    /// an unreadable table is skipped rather than failing the scan.
    #[must_use]
    pub fn scan(project_dir: &Path) -> Self {
        let project = Utf8Path::from_path(project_dir).and_then(|root| ModProject::load(root).ok());

        let mut chunks = Self::default();
        chunks.read_layers(project_dir, project.as_ref());
        chunks.read_declared_tables(project_dir, project.as_ref());
        chunks
    }

    /// The path `hash` addresses, or `None` for one this project does not name.
    #[must_use]
    pub fn get(&self, hash: WadHash) -> Option<&str> {
        self.by_hash.get(&hash).map(String::as_str)
    }

    /// The layer file holding `path`, or `None` for a path no layer of this project has.
    ///
    /// Matched without regard to case: a layer spells a path as its author does, and the
    /// tables spell it lowercase.
    #[must_use]
    pub fn asset_at(&self, path: &str) -> Option<&AssetRef> {
        self.by_path.get(&path.to_lowercase())
    }

    /// How many paths the scan named.
    #[must_use]
    pub fn len(&self) -> usize {
        self.by_hash.len()
    }

    /// Whether the scan named nothing.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.by_hash.is_empty()
    }

    /// A file inside a layer's archive directory, whose chunk path is its own position.
    ///
    /// The shape is `content/<layer>/<archive>/<chunk path>`, so what a `file` value
    /// addresses is the walk under one archive directory.
    ///
    /// The stack is walked from the bottom, so the file left at a path two layers both
    /// hold is the one the higher-priority layer holds.
    fn read_layers(&mut self, project_dir: &Path, project: Option<&ModProject>) {
        let owner = project_dir.display().to_string();
        let Ok(dirs) = layer::dirs_in(&project_dir.join(CONTENT_DIR_NAME)) else {
            return;
        };

        let mut layers: Vec<LayerDir> = dirs
            .into_iter()
            .filter_map(|dir| LayerDir::of(dir, project))
            .collect();
        layers.sort_by(|a, b| a.cmp_for_stacking(b));

        for layer in &layers {
            let Ok(archives) = fs::read_dir(&layer.dir) else {
                continue;
            };
            for archive in archives.flatten().map(|entry| entry.path()) {
                if archive.is_dir() {
                    self.read_archive(&owner, &layer.name, &archive);
                }
            }
        }
    }

    fn read_archive(&mut self, project: &str, layer: &str, archive_dir: &Path) {
        let Some(archive) = dir_name(archive_dir) else {
            return;
        };
        let files = WalkDir::new(archive_dir)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file());

        for entry in files {
            let Ok(relative) = entry.path().strip_prefix(archive_dir) else {
                continue;
            };
            let path = relative
                .components()
                .filter_map(|part| part.as_os_str().to_str())
                .collect::<Vec<_>>()
                .join("/");
            if path.is_empty() {
                continue;
            }
            /* Overwritten rather than kept, so the spelling `get` answers with is the
            spelling of the same layer whose file `asset_at` answers with. */
            self.by_hash.insert(WadHash::hash_str(&path), path.clone());
            self.by_path.insert(
                path.to_lowercase(),
                AssetRef::Layer {
                    project: project.to_owned(),
                    layer: layer.to_owned(),
                    path: format!("{archive}/{path}"),
                },
            );
        }
    }

    /// The tables the project's manifest declares, read where each one says it lives.
    ///
    /// A declaration reaches a path whose chunk the project's archives no longer hold,
    /// which a layer walk cannot see.
    fn read_declared_tables(&mut self, project_dir: &Path, project: Option<&ModProject>) {
        let Some(project) = project else {
            return;
        };
        for declared in &project.hashtables {
            let path = project_dir.join(&declared.path);
            let file = match fs::File::open(&path) {
                Ok(file) => file,
                Err(e) => {
                    tracing::debug!("Project hash table unreadable: {e}");
                    continue;
                }
            };
            match Hashtable::from_reader(file) {
                Ok(table) => {
                    for name in table.names() {
                        self.insert(name.to_owned());
                    }
                }
                Err(e) => tracing::debug!("Project hash table {} unreadable: {e}", declared.path),
            }
        }
    }

    /// Hashing is `ltk_hash`'s own, which is the function a `file` value was written by.
    fn insert(&mut self, path: String) {
        self.by_hash.entry(WadHash::hash_str(&path)).or_insert(path);
    }
}

/// The priority a layer directory the manifest does not declare is stacked at.
///
/// `base` is written at zero, so an undeclared layer ties with it and `cmp_for_display`
/// puts it directly above.
const UNDECLARED_PRIORITY: i32 = 0;

/// One layer directory, under whatever priority the manifest gives its name.
///
/// A directory carries no priority of its own, which is why `layer::dirs_in` orders by
/// name, and the stack this walks needs the manifest's.
struct LayerDir {
    dir: PathBuf,
    name: String,
    priority: i32,
}

impl LayerDir {
    fn of(dir: PathBuf, project: Option<&ModProject>) -> Option<Self> {
        let name = dir_name(&dir)?.to_owned();
        let priority = project
            .and_then(|project| project.layers.iter().find(|held| held.name == name))
            .map_or(UNDECLARED_PRIORITY, |held| held.priority);

        Some(Self {
            dir,
            name,
            priority,
        })
    }
}

impl LayerDir {
    /// Order against `other` bottom of the stack first, which is what a walk overwrites in.
    ///
    /// Priority leads, because [`Layer::priority`] is what decides the file a path resolves
    /// to. `base` breaks a tie by sitting under its siblings, which is the one thing
    /// [`Layer::cmp_for_display`] settles the same way. A listing's own order is that
    /// comparator and not this one: it leads with `base` whatever its priority, which would
    /// resolve a negative-priority sibling backwards.
    fn cmp_for_stacking(&self, other: &Self) -> Ordering {
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.is_base().cmp(&self.is_base()))
            .then_with(|| compare_names(&self.name, &other.name))
    }
}

impl Layer for LayerDir {
    fn name(&self) -> &str {
        &self.name
    }

    fn priority(&self) -> i32 {
        self.priority
    }
}

/// The last component of `path`, where it is one the platform spells in UTF-8.
fn dir_name(path: &Path) -> Option<&str> {
    path.file_name().and_then(|name| name.to_str())
}

#[cfg(test)]
mod tests;
