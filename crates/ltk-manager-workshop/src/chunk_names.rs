//! The names a workshop project's own content holds.
//!
//! The shared mimir tables are a crawl of the retail game, so a path or an object a mod
//! author invents is in none of them. A project's layers hold its chunk paths literally,
//! and the tables its manifest declares list the chunk paths its archives no longer carry,
//! the object paths of what its bins add, and the strings behind their `Hash` values.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use camino::Utf8Path;
use fs_err as fs;
use ltk_game_data::{Declarations, EntryName, ObjectEdit, PropertyEdit, Selector, Value};
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_hashtable::{Category, Hashtable};
use ltk_meta::path::{KeyLiteral, Subscript};
use ltk_mod_project::game_data::load_layer;
use ltk_mod_project::{
    CONTENT_DIR_NAME, HASHES_DIR_NAME, ModProject, ModProjectHashtable, ModProjectLayer,
};
use ltk_wad::is_hex_chunk_path;
use walkdir::WalkDir;

use ltk_manager_assets::preview::{AssetRef, joint_names};
use ltk_manager_base::error::{AppError, AppResult};
use ltk_manager_base::utils::fs::atomic_write;

use super::{ProjectDir, layer};

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
    /// The object paths a declared `binentries` table lists, then the ones the layers' game data
    /// declarations write, by entry hash.
    entries: HashMap<BinHash, String>,
    /// The strings a declared `binhashes` table lists, then the ones the layers' game data
    /// declarations write, then the joint names of their skeletons, by the hash a `Hash` value
    /// carries.
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

    /// The chunk paths the chosen `layers` of `project_dir` hold, and every name the project's
    /// declared tables list.
    #[must_use]
    pub fn scan_layers(project_dir: &Path, layers: &[String]) -> Self {
        Self::scan_where(project_dir, |name| layers.iter().any(|layer| layer == name))
    }

    fn scan_where(project_dir: &Path, walks: impl Fn(&str) -> bool) -> Self {
        let project = Utf8Path::from_path(project_dir).and_then(|root| ModProject::load(root).ok());

        let mut chunks = Self::default();
        chunks.read_layers(project_dir, project.as_ref(), walks);
        chunks.read_declared_tables(project_dir, project.as_ref());
        chunks.read_declaration_names(project_dir);
        chunks.read_skeleton_names(project_dir);
        chunks
    }

    /// The path `hash` addresses, or `None` for one this project does not name.
    #[must_use]
    pub fn get(&self, hash: WadHash) -> Option<&str> {
        self.by_hash.get(&hash).map(String::as_str)
    }

    /// The object path `hash` names, or `None` for one that no declared table lists and no
    /// declaration spells.
    #[must_use]
    pub fn entry(&self, hash: BinHash) -> Option<&str> {
        self.entries.get(&hash).map(String::as_str)
    }

    /// The string behind the `Hash` value `hash`, or `None` for one that no declared table lists,
    /// no declaration writes and no layer skeleton names.
    #[must_use]
    pub fn value(&self, hash: BinHash) -> Option<&str> {
        self.values.get(&hash).map(String::as_str)
    }

    /// The layer file holding `path`, or `None` for a path no layer of this project has.
    ///
    /// Matched without regard to case: a layer writes a path as its author does, and the
    /// tables write it lowercase. A file an unpack named by its hash answers the path that
    /// hashes to it, as the game itself would reach it.
    #[must_use]
    pub fn asset_at(&self, path: &str) -> Option<&AssetRef> {
        let lowered = path.to_lowercase();
        self.by_path
            .get(&lowered)
            .or_else(|| self.by_chunk.get(&WadHash::hash_str(&lowered)))
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
            /* Overwritten rather than kept, so the text `get` answers with is the
            text of the same layer whose file `asset_at` answers with. */
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
                Category::Unknown(category) => {
                    tracing::debug!(
                        "Project hash table {} skipped: unknown category {category}",
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

    /// Learns the object paths and `Hash` strings that the game data declarations of every layer
    /// write.
    ///
    /// Every layer answers, because a bin of one layer can name what another layer declares. A
    /// name a declared table lists keeps that table's text. A layer whose declarations do not load
    /// adds nothing.
    fn read_declaration_names(&mut self, project_dir: &Path) {
        let Some(root) = Utf8Path::from_path(project_dir) else {
            return;
        };
        let Ok(ignore) = ProjectDir::open(project_dir).and_then(|dir| dir.ignore_filter()) else {
            return;
        };
        let Ok(dirs) = layer::dirs_in(&project_dir.join(CONTENT_DIR_NAME)) else {
            return;
        };

        for layer in dirs.iter().filter_map(|dir| dir_name(dir)) {
            if let Ok(Some(declarations)) = load_layer(root, layer, &ignore).declarations {
                for name in written_entries(&declarations) {
                    self.insert_entry(name.as_str());
                }
                for edit in property_edits(&declarations) {
                    self.read_written_values(edit);
                }
            }
        }
    }

    /// Learns the strings of `edit`'s map subscripts and its literal.
    ///
    /// A declaration carries no type, so every string is kept. A string that is no `Hash` value
    /// is never asked for, since a read asks by a hash that a `Hash` value carries.
    fn read_written_values(&mut self, edit: &PropertyEdit) {
        for segment in edit.path.segments() {
            if let Some(Subscript::Key(KeyLiteral::String(key))) = &segment.subscript {
                self.insert_written_value(key);
            }
        }
        self.read_literal(&edit.value);
    }

    fn read_literal(&mut self, value: &Value) {
        match value {
            Value::String(text) => self.insert_written_value(text),
            Value::List(items) => {
                for item in items {
                    self.read_literal(item);
                }
            }
            Value::Mapping(fields) => {
                for (key, field) in fields {
                    self.insert_written_value(key);
                    self.read_literal(field);
                }
            }
            _ => {}
        }
    }

    /// Learns `text` as a `Hash` string. Hex names nothing.
    fn insert_written_value(&mut self, text: &str) {
        if !text.is_empty() && !text.starts_with("0x") {
            self.insert_value(text);
        }
    }

    /// Learns the joint names of every `.skl` of every layer as `Hash` strings.
    ///
    /// A bin names a joint by the hash of its name, as `mBoneName` and `ParentJoint` do, so the
    /// skeleton is what names a joint that a mod adds. A file that does not read adds nothing.
    fn read_skeleton_names(&mut self, project_dir: &Path) {
        let skeletons = WalkDir::new(project_dir.join(CONTENT_DIR_NAME))
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file() && is_skeleton(entry.path()));

        for skeleton in skeletons {
            let names = fs::read(skeleton.path())
                .map_err(AppError::from)
                .and_then(|bytes| joint_names(&bytes).map_err(|e| AppError::Other(e.to_string())));

            match names {
                Ok(names) => names.iter().for_each(|name| self.insert_value(name)),
                Err(e) => {
                    tracing::debug!("Skeleton {} unreadable: {e}", skeleton.path().display());
                }
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

/// The path of the `binentries` table that is created if the manifest declares none.
/// Every object path that `declarations` writes: a created, cloned, removed or edited object.
fn written_entries(declarations: &Declarations) -> Vec<&EntryName> {
    let mut names = Vec::new();
    for module in &declarations.modules {
        match &module.selector {
            Selector::Target { edits, .. } => {
                for edit in edits {
                    for (name, object) in &edit.objects {
                        names.push(name);
                        if let ObjectEdit::Clone { source, .. } = object {
                            names.push(source);
                        }
                    }
                    names.extend(edit.entries.keys());
                }
            }
            Selector::Entries(entries) => names.extend(entries.keys()),
            _ => {}
        }
    }

    names.retain(|name| !name.is_hash());
    names
}

/// Every property edit of `declarations`: of a created or cloned object, and of an entry.
fn property_edits(declarations: &Declarations) -> Vec<&PropertyEdit> {
    let mut found = Vec::new();
    for module in &declarations.modules {
        match &module.selector {
            Selector::Target { edits, .. } => {
                for edit in edits {
                    found.extend(edit.objects.values().flat_map(ObjectEdit::properties));
                    found.extend(edit.entries.values().flatten());
                }
            }
            Selector::Entries(entries) => {
                found.extend(entries.values().flat_map(|entry| &entry.properties));
            }
            _ => {}
        }
    }

    found
}

const ENTRIES_TABLE: &str = "binentries.hashes.txt";

impl ProjectDir {
    /// Adds `names` to the project's `binentries` hash table. Declares the table in the manifest
    /// if the manifest declares none.
    ///
    /// # Errors
    ///
    /// Fails if the manifest does not load, a name is not a valid table name, or a file cannot
    /// be written.
    pub fn declare_entry_names(&self, names: &[&str]) -> AppResult<()> {
        let mut config = self.config()?;
        let declared = config
            .hashtables
            .iter()
            .find(|table| table.category == Category::BinEntries)
            .cloned();
        let table = match &declared {
            Some(table) => table.clone(),
            None => {
                let (algorithm, width) = Category::BinEntries.default_shape().ok_or_else(|| {
                    AppError::Other("The binentries category has no key shape".to_owned())
                })?;
                ModProjectHashtable {
                    path: format!("{HASHES_DIR_NAME}/{ENTRIES_TABLE}"),
                    category: Category::BinEntries,
                    algorithm,
                    bits: width.bits(),
                }
            }
        };

        let existing = read_table(self.path(), &table.path);
        let listed: BTreeSet<&str> = existing
            .iter()
            .flat_map(Hashtable::names)
            .chain(names.iter().copied())
            .collect();
        let mut merged = Hashtable::from_names(listed).map_err(|e| {
            AppError::Other(format!("Could not build the project's hash table: {e}"))
        })?;
        merged.sort();
        let mut bytes = Vec::new();
        merged.write_to(&mut bytes)?;

        let path = self.path().join(&table.path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        atomic_write(&path, &bytes)?;

        if declared.is_none() {
            config.hashtables.push(table);
            self.write_config(&config)?;
        }
        Ok(())
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

/// Whether `path` has the extension of a skeleton, in any case.
fn is_skeleton(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("skl"))
}

/// The last component of `path`, where the platform writes it in UTF-8.
fn dir_name(path: &Path) -> Option<&str> {
    path.file_name().and_then(|name| name.to_str())
}

#[cfg(test)]
mod tests;
