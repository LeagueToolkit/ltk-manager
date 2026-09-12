//! Every bin object the install declares, and the file that declares it.
//!
//! The locations half of the palette's object search. The names half is the
//! `binentries` table, resolved once the rows are built and held beside them.
//!
//! Per "The bin object index" in `docs/ux/PROJECT_EDITOR.md`, and section 10 of
//! `docs/research/bin-object-index.md`.

use std::collections::HashMap;
use std::sync::Arc;

use ltk_hash::BinHash;
use ltk_wad::{WadHash, hex_name};

use crate::bin_document::hex;
use crate::preview::AssetRef;

mod browse;
mod build;
mod find;
mod names;
mod references;
mod search;
mod state;
mod wire;

pub use build::{Declaration, for_each_declaration};
pub use names::{CacheNames, ObjectNames};
pub use state::{
    BuildTicket, ObjectFindGeneration, ObjectIndexSnapshot, ObjectIndexState,
    ObjectReferenceGeneration, ObjectSearchGeneration,
};
pub use wire::{
    DeclaredObject, ObjectClassHit, ObjectDeclaration, ObjectDirListing, ObjectFindHit,
    ObjectFindResult, ObjectIndexStats, ObjectNodeEntry, ObjectPrefixEntry, ObjectSearchHit,
    ObjectSearchResult, ReferenceGroup, ReferenceHit, ReferenceResult,
};

/// How many rows a scan reads between two tests of the generation.
const STALE_CHECK_INTERVAL: u32 = 4096;

/// The prefix of the group holding the objects no table names.
///
/// A resolved object path never holds `?`. The group collides with no path the
/// game ships.
pub const UNNAMED_PREFIX: &str = "?";

/// One declaration: an object, its class, and the chunk that declares it.
///
/// The chunk is its WAD path hash, which survives a rebuild of the game index.
#[derive(Debug, Clone, Copy)]
struct Row {
    object: BinHash,
    class: BinHash,
    file: WadHash,
}

/// One bin chunk the build read, which a row's file hash resolves to.
#[derive(Debug)]
struct DeclaringFile {
    path_hash: WadHash,
    /// The path the game index named it by, or `None` for a sniffed chunk.
    path: Option<Box<str>>,
    /// Index into [`Declarations::wads`].
    wad: u32,
}

/// What a build fills, and what a renaming shares untouched.
#[derive(Debug, Default)]
struct Declarations {
    /// In archive order, and in the game index's tree order within one, the
    /// sniffed chunks after the named.
    rows: Vec<Row>,
    /// Every distinct object hash, sorted, for a lookup by hash.
    objects: Box<[BinHash]>,
    /// Every index into `rows`, sorted by object and then by row, for the rows of one hash.
    by_object: Box<[u32]>,
    files: Vec<DeclaringFile>,
    /// A declaring chunk's index in `files`, by its path hash.
    by_file: HashMap<WadHash, u32>,
    /// Archive names, in the game index's order.
    wads: Vec<String>,
    stats: ObjectIndexStats,
}

/// One object a table names: its path, with its letters for the mask to reject on.
#[derive(Debug)]
struct NamedObject {
    hash: BinHash,
    name: Box<str>,
    mask: u32,
}

/// The names resolved for one index, resident while it is.
#[derive(Debug, Default)]
struct Names {
    /// Every object a table names, in the order of [`compare_paths`], which the
    /// objects browser reads one prefix at a time.
    named: Vec<NamedObject>,
    /// The index into `named` of each object a table names.
    objects: HashMap<BinHash, u32>,
    classes: HashMap<BinHash, Box<str>>,
    /// The declaring chunks the build sniffed that a table names after all.
    files: HashMap<WadHash, Box<str>>,
}

/// Every bin object the install declares, searchable by path or by hash.
///
/// Built once a session behind the Objects switch, and renamed in place when
/// the hash tables move, because the rows are the install's and the names
/// are the tables'.
#[derive(Debug)]
pub struct ObjectIndex {
    declared: Arc<Declarations>,
    names: Names,
}

impl ObjectIndex {
    /// Every declaration of `object` in archive order, on the wire.
    fn declarations_of(&self, object: BinHash) -> Vec<ObjectDeclaration> {
        self.declared
            .rows_of(object)
            .iter()
            .map(|at| self.declaration(*at))
            .collect()
    }

    /// What the build measured.
    pub fn stats(&self) -> ObjectIndexStats {
        self.declared.stats
    }

    /// Whether any file of the install declares `object`.
    #[must_use]
    pub fn declares(&self, object: BinHash) -> bool {
        self.declared.objects.binary_search(&object).is_ok()
    }

    /// Every declaration of `object` in archive order, or `None` where nothing declares it.
    #[must_use]
    pub fn declared(&self, object: BinHash) -> Option<DeclaredObject> {
        let declarations = self.declarations_of(object);
        if declarations.is_empty() {
            return None;
        }
        Some(DeclaredObject {
            path: self.object_name(object),
            declarations,
        })
    }

    /// The row at `at` as a declaration on the wire.
    fn declaration(&self, at: u32) -> ObjectDeclaration {
        let row = &self.declared.rows[at as usize];
        let (file, wad) = self.declared.file(row.file).map_or_else(
            || (hex_name(row.file), String::new()),
            |file| {
                (
                    self.file_name(file),
                    self.declared.wads[file.wad as usize].clone(),
                )
            },
        );
        ObjectDeclaration {
            asset: AssetRef::GameChunk {
                wad,
                path_hash: hex_name(row.file),
            },
            file,
            class_hash: hex(row.class),
            class: self.class_name(row.class),
        }
    }

    /// The object's path, or its hex when no table names it.
    fn object_name(&self, object: BinHash) -> String {
        self.named_object(object)
            .map_or_else(|| hex(object), |named| named.name.to_string())
    }

    /// The class's name, or its hex when no table names it.
    fn class_name(&self, class: BinHash) -> String {
        self.names
            .classes
            .get(&class)
            .map_or_else(|| hex(class), ToString::to_string)
    }

    /// The name a declaring chunk reads as: the game index's, else a table's
    /// resolved since, else its hex.
    fn file_name(&self, file: &DeclaringFile) -> String {
        file.path
            .as_deref()
            .or_else(|| self.names.files.get(&file.path_hash).map(|path| &**path))
            .map_or_else(|| hex_name(file.path_hash), str::to_owned)
    }

    /// Every row as `(object, class, declaring file name)`, in row order.
    #[cfg(test)]
    fn rows(&self) -> impl Iterator<Item = (BinHash, BinHash, String)> {
        self.declared.rows.iter().map(|row| {
            let file = self
                .declared
                .file(row.file)
                .map_or_else(|| hex_name(row.file), |file| self.file_name(file));
            (row.object, row.class, file)
        })
    }
}

impl Declarations {
    fn file(&self, path_hash: WadHash) -> Option<&DeclaringFile> {
        self.by_file
            .get(&path_hash)
            .map(|&at| &self.files[at as usize])
    }

    /// The indices of every row declaring `object`, in row order.
    fn rows_of(&self, object: BinHash) -> &[u32] {
        let key = |at: &u32| self.rows[*at as usize].object;
        let start = self.by_object.partition_point(|at| key(at) < object);
        let end = start + self.by_object[start..].partition_point(|at| key(at) == object);
        &self.by_object[start..end]
    }
}

/// The object hash a query of eight hex digits names, `0x` or not.
#[must_use]
pub fn parse_hash(query: &str) -> Option<BinHash> {
    let digits = query.trim();
    let digits = digits
        .strip_prefix("0x")
        .or_else(|| digits.strip_prefix("0X"))
        .unwrap_or(digits);
    if digits.len() != 8 || !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    u32::from_str_radix(digits, 16).ok().map(BinHash)
}

#[cfg(test)]
mod tests;
