//! What one answer of the index looks like to the frontend.
//!
//! Every shape a Tauri command hands the frontend, and the statistics a build
//! measured. `ts-rs` exports each one under the `ts` feature.

use std::time::Duration;

use ltk_wad::WadHash;
use serde::Serialize;

use crate::matcher::Range;
use crate::preview::AssetRef;
use crate::sandbox::layer_chunk_hash;

/// One row a search matched, with the runs its path marks.
///
/// The object's whole path is the row's title, so `ranges` are byte offsets
/// into `path`. An object or a class no table names reads as its hex.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObjectSearchHit {
    /// The object's path hash, as `0x` and eight hex digits.
    pub object_hash: String,
    /// The object's path, or its hash when no table names it.
    pub path: String,
    pub ranges: Vec<Range>,
    /// The class the object declares, or its hash when no table names it.
    pub class: String,
    /// The declaring chunk's path hash as 16 lowercase hex digits.
    pub file_hash: String,
    /// The declaring chunk's path.
    pub file: String,
    /// The `DATA/FINAL`-relative archive the declaring chunk was read from.
    pub wad: String,
    /// 0 is a name the query opens, 1 a name holding it, 2 a match reaching the path.
    pub band: u8,
    pub score: f64,
}

/// One class an ambiguous `class:` term matched, offered as a completion.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObjectClassHit {
    /// The class hash, as `0x` and eight hex digits.
    pub class_hash: String,
    /// The class's name, or its hash when no table names it.
    pub class: String,
    /// How many declarations carry the class.
    pub rows: u32,
}

/// What one search of the object index found.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObjectSearchResult {
    /// The best rows, best first, capped at `SEARCH_LIMIT`.
    pub hits: Vec<ObjectSearchHit>,
    /// How many rows matched in all, which the cap trimmed.
    pub total: u32,
    /// A newer search started before this one finished, so it gave up early.
    pub superseded: bool,
    /// No table named a single object, so only a hash can match.
    pub unnamed: bool,
    /// The classes an ambiguous `class:` term matched, in place of rows.
    pub classes: Vec<ObjectClassHit>,
}

impl ObjectSearchResult {
    /// A search that found nothing.
    pub(super) fn empty(unnamed: bool) -> Self {
        Self {
            hits: Vec::new(),
            total: 0,
            superseded: false,
            unnamed,
            classes: Vec::new(),
        }
    }
}

/// One declaration of an object: the file that declares it and the class it carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObjectDeclaration {
    /// The declaring file, as an open reads it.
    pub asset: AssetRef,
    /// The declaring file's path, or its hash when no table names it.
    pub file: String,
    /// The class hash, as `0x` and eight hex digits.
    pub class_hash: String,
    /// The class's name, or its hash when no table names it.
    pub class: String,
}

/// Every declaration of one object, with the path they share.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DeclaredObject {
    /// The object's path, or its hash when no table names it.
    pub path: String,
    /// In archive order, and in the game index's tree order within one archive.
    pub declarations: Vec<ObjectDeclaration>,
}

impl ObjectDeclaration {
    /// Where the declaration sits in a link's resolution order: 0 in `this` file, 1 in a
    /// file among `dependencies`, 2 anywhere else.
    fn rank(&self, this: &AssetRef, dependencies: &[WadHash]) -> u8 {
        if self.asset == *this {
            return 0;
        }
        let chunk = match &self.asset {
            AssetRef::GameChunk { .. } => self.asset.chunk_hash(),
            AssetRef::Layer { .. } => layer_chunk_hash(&self.asset).map(WadHash),
            AssetRef::File { .. } => None,
            AssetRef::LcuChunk { .. } => {
                unreachable!("the game declares no object in a client chunk")
            }
        };
        match chunk {
            Some(hash) if dependencies.contains(&hash) => 1,
            _ => 2,
        }
    }
}

impl DeclaredObject {
    /// Order the declarations as a link resolves them (ADR-0028): one in `this` file,
    /// then one in a file among `dependencies`, then the rest in archive order.
    pub fn resolve_for(&mut self, this: &AssetRef, dependencies: &[WadHash]) {
        self.declarations
            .sort_by_key(|declaration| declaration.rank(this, dependencies));
    }
}

/// One prefix under a listed one, folded through any run of single-child prefixes.
///
/// A node an object bears is an [`ObjectNodeEntry`] and not one of these.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObjectPrefixEntry {
    /// What `ObjectIndex::object_dir` takes to open this row: the folded node's path.
    pub path: String,
    /// What the row reads: the folded run of segments joined by `/`.
    pub name: String,
    /// Objects below the prefix.
    pub count: u32,
}

/// One object at a listed prefix, with what sits below it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObjectNodeEntry {
    /// The object's path hash, as `0x` and eight hex digits.
    pub object_hash: String,
    /// The object's path, or its hash when no table names it.
    pub path: String,
    /// The last segment of the path, or the hash.
    pub name: String,
    /// Every declaration of the object, in archive order.
    pub declarations: Vec<ObjectDeclaration>,
    /// Objects below the node, 0 for a leaf.
    pub count: u32,
}

/// What one prefix of the object tree holds.
///
/// "Objects browser" in `docs/ux/PROJECT_EDITOR.md`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObjectDirListing {
    /// The prefixes no object bears, in natural name order, the unnamed group last at the root.
    pub prefixes: Vec<ObjectPrefixEntry>,
    /// The objects at the prefix, in natural name order.
    pub objects: Vec<ObjectNodeEntry>,
}

/// One object the full search matched, with the runs its path marks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObjectFindHit {
    /// The object's path hash, as `0x` and eight hex digits.
    pub object_hash: String,
    /// The object's path, or its hash when no table names it.
    pub path: String,
    /// Byte offsets into `path`. Empty where a class term alone matched.
    pub ranges: Vec<Range>,
    /// Every declaration of the object, in archive order.
    pub declarations: Vec<ObjectDeclaration>,
}

/// What one full search of the object index found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObjectFindResult {
    /// Every matching object in path order, capped at `FIND_LIMIT`, the unnamed last.
    pub hits: Vec<ObjectFindHit>,
    /// How many objects matched in all, counted on past the cap.
    pub total: u32,
    /// A newer search overtook this one. The hits are a part of the answer.
    pub superseded: bool,
    /// No table named a single object. Only a hash can match.
    pub unnamed: bool,
}

impl ObjectFindResult {
    /// A search that found nothing.
    pub(super) fn empty(unnamed: bool) -> Self {
        Self {
            hits: Vec::new(),
            total: 0,
            superseded: false,
            unnamed,
        }
    }
}

/// One object a reference query found, in the file that declares it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReferenceHit {
    /// The object's path hash, as `0x` and eight hex digits.
    pub object_hash: String,
    /// The object's path, or its hash when no table names it.
    pub path: String,
    /// The class hash, as `0x` and eight hex digits.
    pub class_hash: String,
    /// The class's name, or its hash when no table names it.
    pub class: String,
    /// Where in the object the walk found the reference. Absent for an answer of the index.
    pub property: Option<ReferenceProperty>,
}

/// The row inside an object that holds a reference, in the two forms a row carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReferenceProperty {
    /// The hash path, every field a hash (ADR-0027).
    pub path: String,
    /// The same path for a person, every hash a table names spelled.
    pub label: String,
}

/// The objects one file declares, as a reference query groups them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReferenceGroup {
    /// The declaring file, as an open reads it.
    pub asset: AssetRef,
    /// The declaring file's path, or its hash when no table names it.
    pub file: String,
    /// The objects in natural path order, the ones no table names last.
    pub objects: Vec<ReferenceHit>,
}

/// What one reference query found.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReferenceResult {
    /// The declaring files in archive order, holding at most `FIND_LIMIT` objects in all.
    pub groups: Vec<ReferenceGroup>,
    /// How many objects matched in all, counted on past the cap.
    pub total: u32,
    /// A newer query overtook this one. The groups are a part of the answer.
    pub superseded: bool,
    /// The walk was cancelled before it read every bin. The groups are what it found.
    pub cancelled: bool,
}

/// How far one walk has read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReferenceWalkProgress {
    /// Bins read, or passed over because they would not read.
    pub walked: u32,
    /// Bins the walk reads in all: the project's layers and the install's.
    pub total: u32,
    /// References found so far, past any cap.
    pub hits: u32,
}

/// What a build measured.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ObjectIndexStats {
    /// Archives holding at least one chunk the build read or sniffed.
    pub archives: u32,
    /// Bin chunks the build read, named or sniffed, whether or not they read.
    pub files: u32,
    /// Chunks no table names, each decoded far enough to read its magic.
    pub sniffed: u32,
    /// Of the sniffed, the ones whose magic was a bin's, and so were read.
    pub unnamed_bins: u32,
    /// Declarations, one per object per declaring file.
    pub rows: u32,
    /// Chunks that would not read, which never fail the build.
    pub skipped: u32,
    /// Decompressed bytes read.
    pub bytes: u64,
    pub elapsed: Duration,
    /// Threads the build ran on.
    pub workers: u32,
}
