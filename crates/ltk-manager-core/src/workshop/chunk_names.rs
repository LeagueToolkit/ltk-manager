//! The chunk paths a workshop project's own content names.
//!
//! The shared mimir tables are a crawl of the retail game, so a path a mod author
//! invents is in none of them. A project's layers hold those paths literally, and the
//! tables its manifest declares list the ones its archives no longer carry.

use std::collections::HashMap;
use std::path::Path;

use camino::Utf8Path;
use fs_err as fs;
use ltk_hash::{Hash as _, WadHash};
use ltk_hashtable::Hashtable;
use ltk_mod_project::{CONTENT_DIR_NAME, ModProject};
use walkdir::WalkDir;

use crate::preview::AssetRef;

use super::layer;

/// The chunk paths one project names, by the hash a `file` value addresses them with.
#[derive(Debug, Default)]
pub struct LayerChunks {
    by_hash: HashMap<WadHash, String>,
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
        let mut chunks = Self::default();
        chunks.read_layers(&project_dir.join(CONTENT_DIR_NAME));
        chunks.read_declared_tables(project_dir);
        chunks
    }

    /// The path `hash` addresses, or `None` for one this project does not name.
    #[must_use]
    pub fn get(&self, hash: WadHash) -> Option<&str> {
        self.by_hash.get(&hash).map(String::as_str)
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
    fn read_layers(&mut self, content_dir: &Path) {
        let Ok(layers) = layer::dirs_in(content_dir) else {
            return;
        };
        for layer_dir in layers {
            let Ok(archives) = fs::read_dir(&layer_dir) else {
                continue;
            };
            for archive in archives.flatten().map(|entry| entry.path()) {
                if archive.is_dir() {
                    self.read_archive(&archive);
                }
            }
        }
    }

    fn read_archive(&mut self, archive_dir: &Path) {
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
            if !path.is_empty() {
                self.insert(path);
            }
        }
    }

    /// The tables the project's manifest declares, read where each one says it lives.
    ///
    /// A declaration reaches a path whose chunk the project's archives no longer hold,
    /// which a layer walk cannot see.
    fn read_declared_tables(&mut self, project_dir: &Path) {
        let Some(root) = Utf8Path::from_path(project_dir) else {
            return;
        };
        let Ok(project) = ModProject::load(root) else {
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

#[cfg(test)]
mod tests;
