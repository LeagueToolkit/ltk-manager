//! The names a workshop project's own content holds.
//!
//! The shared mimir tables are a crawl of the retail game, so a path or an object a mod
//! author invents is in none of them. A project's layers hold its chunk paths literally,
//! and the tables its manifest declares list the chunk paths its archives no longer carry,
//! the object paths of what its bins add, and the strings behind their `Hash` values.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use camino::Utf8Path;
use fs_err as fs;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_hashtable::{Category, Hashtable};
use ltk_mod_project::{CONTENT_DIR_NAME, ModProject, ModProjectLayer};
use ltk_wad::is_hex_chunk_path;
use walkdir::WalkDir;

use crate::preview::AssetRef;

use super::layer;

/// The names one project holds: chunk paths by the hash a `file` value addresses them
/// with, object paths by their entry hash, and the strings behind `Hash` values.
#[derive(Debug, Default)]
pub struct LayerChunks {
    by_hash: HashMap<WadHash, String>,
    /// The layer file behind each walked path, keyed by that path lowercased. A path a
    /// declared table names alone has no file, so it is absent here. Where two layers
    /// hold one path, the file kept is the higher-priority layer's.
    by_path: HashMap<String, AssetRef>,
    /// The layer file an unpack named by its chunk's hash, which no table had a path for.
    /// The hash is all such a file says of where the game reads it.
    by_chunk: HashMap<WadHash, AssetRef>,
    /// The object paths a declared `binentries` table lists, by entry hash.
    entries: HashMap<BinHash, String>,
    /// The strings a declared `binhashes` table lists, by the hash a `Hash` value carries.
    values: HashMap<BinHash, String>,
    /// The scanned layers, lowest first, in the order the overlay applies them.
    stack: Vec<String>,
}

impl LayerChunks {
    /// Every chunk path `project_dir`'s layers hold and every name its declared tables list.
    ///
    /// Best-effort: a project that loads no manifest still has its layers walked, and
    /// an unreadable table is skipped rather than failing the scan.
    #[must_use]
    pub fn scan(project_dir: &Path) -> Self {
        Self::scan_where(project_dir, |_| true)
    }

    /// The chunk paths the one layer `layer` of `project_dir` holds, and every name the
    /// project's declared tables list.
    #[must_use]
    pub fn scan_layer(project_dir: &Path, layer: &str) -> Self {
        Self::scan_where(project_dir, |name| name == layer)
    }

    fn scan_where(project_dir: &Path, walks: impl Fn(&str) -> bool) -> Self {
        let project = Utf8Path::from_path(project_dir).and_then(|root| ModProject::load(root).ok());

        let mut chunks = Self::default();
        chunks.read_layers(project_dir, project.as_ref(), walks);
        chunks.read_declared_tables(project_dir, project.as_ref());
        chunks
    }

    /// The path `hash` addresses, or `None` for one this project does not name.
    #[must_use]
    pub fn get(&self, hash: WadHash) -> Option<&str> {
        self.by_hash.get(&hash).map(String::as_str)
    }

    /// The object path `hash` names, or `None` for one no declared table lists.
    #[must_use]
    pub fn entry(&self, hash: BinHash) -> Option<&str> {
        self.entries.get(&hash).map(String::as_str)
    }

    /// The string behind the `Hash` value `hash`, or `None` for one no declared table lists.
    #[must_use]
    pub fn value(&self, hash: BinHash) -> Option<&str> {
        self.values.get(&hash).map(String::as_str)
    }

    /// The layer file holding `path`, or `None` for a path no layer of this project has.
    ///
    /// Matched without regard to case: a layer spells a path as its author does, and the
    /// tables spell it lowercase. A file an unpack named by its hash answers the path that
    /// hashes to it, as the game itself would reach it.
    #[must_use]
    pub fn asset_at(&self, path: &str) -> Option<&AssetRef> {
        let spelled = path.to_lowercase();
        self.by_path
            .get(&spelled)
            .or_else(|| self.by_chunk.get(&WadHash::hash_str(&spelled)))
    }

    /// The layer file of the chunk `hash` addresses, whether a layer names it by its path or
    /// an unpack named it by the hash, or `None` where no layer holds it.
    #[must_use]
    pub fn asset_of_chunk(&self, hash: WadHash) -> Option<&AssetRef> {
        self.by_chunk
            .get(&hash)
            .or_else(|| self.by_path.get(&self.by_hash.get(&hash)?.to_lowercase()))
    }

    /// Every layer file a build packs: for each path, the copy of the highest layer.
    pub fn files(&self) -> impl Iterator<Item = &AssetRef> + '_ {
        self.by_path.values()
    }

    /// The scanned layers, lowest first, in the order the overlay applies them.
    #[must_use]
    pub fn layers(&self) -> &[String] {
        &self.stack
    }

    /// How many chunk paths the scan named.
    #[must_use]
    pub fn len(&self) -> usize {
        self.by_hash.len()
    }

    /// Whether the scan named no chunk path.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.by_hash.is_empty()
    }

    /// A file inside a layer's archive directory, whose chunk path is its own position.
    ///
    /// The shape is `content/<layer>/<archive>/<chunk path>`, so what a `file` value
    /// addresses is the walk under one archive directory.
    ///
    /// The layers are scanned in [`ModProjectLayer::apply_order`], the overlay's order, so
    /// when two layers hold the same path, the file kept is the one a build packs.
    fn read_layers(
        &mut self,
        project_dir: &Path,
        project: Option<&ModProject>,
        walks: impl Fn(&str) -> bool,
    ) {
        let owner = project_dir.display().to_string();
        let Ok(dirs) = layer::dirs_in(&project_dir.join(CONTENT_DIR_NAME)) else {
            return;
        };

        let mut layers: Vec<LayerDir> = dirs
            .into_iter()
            .filter_map(|dir| LayerDir::of(dir, project))
            .filter(|dir| walks(&dir.layer.name))
            .collect();
        layers.sort_by(|a, b| ModProjectLayer::apply_order(&a.layer, &b.layer));

        for layer in &layers {
            self.stack.push(layer.layer.name.clone());

            let Ok(archives) = fs::read_dir(&layer.dir) else {
                continue;
            };
            for archive in archives.flatten().map(|entry| entry.path()) {
                if archive.is_dir() {
                    self.read_archive(&owner, &layer.layer.name, &archive);
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
            let asset = AssetRef::Layer {
                project: project.to_owned(),
                layer: layer.to_owned(),
                path: format!("{archive}/{path}"),
            };
            if let Some(chunk) = hex_chunk(&path) {
                self.by_chunk.insert(chunk, asset.clone());
            }
            /* Overwritten rather than kept, so the spelling `get` answers with is the
            spelling of the same layer whose file `asset_at` answers with. */
            self.by_hash.insert(WadHash::hash_str(&path), path.clone());
            self.by_path.insert(path.to_lowercase(), asset);
        }
    }

    /// The tables the project's manifest declares, read where each one says it lives and
    /// into the hash space its category names.
    ///
    /// A declaration reaches a path whose chunk the project's archives no longer hold,
    /// which a layer walk cannot see, and the objects and `Hash` strings no walk names.
    fn read_declared_tables(&mut self, project_dir: &Path, project: Option<&ModProject>) {
        let Some(project) = project else {
            return;
        };

        for declared in &project.hashtables {
            let insert: fn(&mut Self, &str) = match &declared.category {
                Category::Game => Self::insert_chunk,
                Category::BinEntries => Self::insert_entry,
                Category::BinHashes => Self::insert_value,
                Category::Unknown(spelling) => {
                    tracing::debug!(
                        "Project hash table {} skipped: unknown category {spelling}",
                        declared.path
                    );
                    continue;
                }
            };

            let Some(table) = read_table(project_dir, &declared.path) else {
                continue;
            };
            for name in table.names() {
                insert(self, name);
            }
        }
    }

    /// Hashing is `ltk_hash`'s own, which is the function a `file` value was written by.
    fn insert_chunk(&mut self, path: &str) {
        self.by_hash
            .entry(WadHash::hash_str(path))
            .or_insert_with(|| path.to_owned());
    }

    fn insert_entry(&mut self, path: &str) {
        self.entries
            .entry(BinHash::hash_str(path))
            .or_insert_with(|| path.to_owned());
    }

    fn insert_value(&mut self, text: &str) {
        self.values
            .entry(BinHash::hash_str(text))
            .or_insert_with(|| text.to_owned());
    }
}

/// The table at `path` under `project_dir`, or `None` for one that cannot be read.
fn read_table(project_dir: &Path, path: &str) -> Option<Hashtable> {
    let file = match fs::File::open(project_dir.join(path)) {
        Ok(file) => file,
        Err(e) => {
            tracing::debug!("Project hash table unreadable: {e}");
            return None;
        }
    };

    match Hashtable::from_reader(file) {
        Ok(table) => Some(table),
        Err(e) => {
            tracing::debug!("Project hash table {path} unreadable: {e}");
            None
        }
    }
}

/// The priority of a layer directory the manifest does not list, which equals `base`'s.
const UNDECLARED_PRIORITY: i32 = 0;

/// One layer directory, under whatever priority the manifest gives its name.
///
/// A directory carries no priority of its own, which is why `layer::dirs_in` orders by
/// name, and the stack this walks needs the manifest's.
struct LayerDir {
    dir: PathBuf,
    layer: ModProjectLayer,
}

impl LayerDir {
    fn of(dir: PathBuf, project: Option<&ModProject>) -> Option<Self> {
        let name = dir_name(&dir)?.to_owned();
        let priority = project
            .and_then(|project| project.layers.iter().find(|held| held.name == name))
            .map_or(UNDECLARED_PRIORITY, |held| held.priority);

        Some(Self {
            dir,
            layer: ModProjectLayer {
                name,
                priority,
                ..ModProjectLayer::default()
            },
        })
    }
}

/// The chunk a file is named by, where an unpack wrote it as the hex of its hash.
fn hex_chunk(path: &str) -> Option<WadHash> {
    let path = Utf8Path::new(path);
    if !is_hex_chunk_path(path) {
        return None;
    }
    path.file_stem()?.parse().ok()
}

/// The last component of `path`, where it is one the platform spells in UTF-8.
fn dir_name(path: &Path) -> Option<&str> {
    path.file_name().and_then(|name| name.to_str())
}

#[cfg(test)]
mod tests;
