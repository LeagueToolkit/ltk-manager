//! One open bin: the tree the backend holds, and the rows it projects for a viewer.
//!
//! ADR-0026 puts the tree here and a window of rows in the frontend. ADR-0027 names a
//! node by the object's hash and the game's property path, every field a hash on the
//! wire and a name for a person.

use std::collections::HashMap;
use std::fmt::{self, Write as _};
use std::io::Cursor;
use std::num::NonZeroUsize;
use std::sync::Arc;

use indexmap::IndexMap;
use lru::LruCache;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::property::{Kind, values};
use ltk_meta::walk::{Leaf, TreeValue as _};
use ltk_meta::{BinFile, BinObject, PropertyValueEnum};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub(crate) mod resolve;

pub use resolve::{AssetLookup, hex, owned};
pub(crate) use resolve::{EFFECT_KEY, Namer, chunk_asset, first_name, object_at, resolver_entries};

use crate::error::AppResult;
use crate::meta_schema::{Expected, KindShape, SchemaAt};
use crate::object_index::{CacheNames, ObjectDeclaration};
use crate::preview::AssetRef;
use crate::problems::rules::bin_property_type::table::TypeSpec;
use crate::problems::walk;
use crate::workshop::LayerChunks;

/// How many assets the store keeps open at once. ADR-0026, counted per ADR-0028.
pub const CAPACITY: NonZeroUsize = NonZeroUsize::new(8).unwrap();

/// The id one open of a document is addressed by.
///
/// An id is never reused within a process. A call carrying a closed id fails as
/// [`BinDocumentError::NotOpen`] and reaches no other document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct BinDocumentId(u32);

impl fmt::Display for BinDocumentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Why a document cannot be opened or read.
#[derive(Debug, Error)]
pub enum BinDocumentError {
    /// The bytes are not a bin the toolkit reads.
    #[error("not a readable bin: {0}")]
    Unreadable(#[from] ltk_meta::Error),

    /// No open document has this id. A close and an eviction both remove one.
    #[error("bin document {0} is not open")]
    NotOpen(BinDocumentId),

    /// No node of the document has this address.
    #[error("no node at {address}")]
    NodeNotFound { address: String },

    /// A projected read reached more rows than one call answers.
    #[error("a projected read of {rows} rows is over the cap of {cap}")]
    ReadTooWide { rows: usize, cap: usize },

    /// A resolved read reached more values than one call answers.
    #[error("a resolved read holds more values than one call answers")]
    ReadTooLarge,

    /// A resolved read nested deeper than one call answers.
    #[error("a resolved read nests deeper than one call answers")]
    ReadTooDeep,
}

/// The open documents, one tree per asset, bounded, evicting the least recently used.
///
/// A file tab and the object tabs over one asset each hold an id on the one tree
/// (ADR-0028). The bound counts assets. An eviction takes every id over the asset.
pub struct BinDocuments {
    inner: Mutex<Store>,
}

struct Store {
    next: u32,
    /// The asset each id is over. An id whose asset was evicted reads as not open.
    ids: HashMap<BinDocumentId, AssetRef>,
    held: LruCache<AssetRef, Held>,
}

/// One parsed asset, and how many ids hold it.
struct Held {
    /// Shared, so a read can walk the tree with the store unlocked.
    document: Arc<BinDocument>,
    /// The chunk paths this asset's project names, scanned once with the parse.
    chunks: Arc<LayerChunks>,
    holders: usize,
}

impl Store {
    /// A fresh id over `asset`.
    fn issue(&mut self, asset: AssetRef) -> BinDocumentId {
        let id = BinDocumentId(self.next);
        self.next = self.next.wrapping_add(1);
        self.ids.insert(id, asset);
        id
    }
}

impl Default for BinDocuments {
    fn default() -> Self {
        Self::new(CAPACITY)
    }
}

impl fmt::Debug for BinDocuments {
    /// The counts of held assets and of ids. A tree prints nothing.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let store = self.inner.lock();
        f.debug_struct("BinDocuments")
            .field("held", &store.held.len())
            .field("ids", &store.ids.len())
            .finish()
    }
}

impl BinDocuments {
    /// A store that keeps `capacity` assets open.
    #[must_use]
    pub fn new(capacity: NonZeroUsize) -> Self {
        Self {
            inner: Mutex::new(Store {
                next: 0,
                ids: HashMap::new(),
                held: LruCache::new(capacity),
            }),
        }
    }

    /// Hold `asset` open, answering a fresh id over its tree.
    ///
    /// `bytes` is read and parsed only while no id is over the asset. At capacity, the
    /// least recently used asset leaves the store with every id over it. The lock is
    /// not held over `bytes`. Two opens racing on one asset both parse, and one parse
    /// is kept.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Unreadable`] when the bytes are not a bin, and
    /// with whatever `bytes` raises.
    pub fn open(
        &self,
        asset: AssetRef,
        bytes: impl FnOnce() -> AppResult<Vec<u8>>,
    ) -> AppResult<BinDocumentId> {
        {
            let mut store = self.inner.lock();
            if let Some(held) = store.held.get_mut(&asset) {
                held.holders += 1;
                return Ok(store.issue(asset));
            }
        }

        let document = BinDocument::parse(&bytes()?)?;
        /* Scanned beside the parse, and outside the lock, because both read the disk. */
        let chunks = LayerChunks::of(&asset);

        let mut store = self.inner.lock();
        match store.held.get_mut(&asset) {
            Some(held) => held.holders += 1,
            None => {
                let held = Held {
                    document: Arc::new(document),
                    chunks: Arc::new(chunks),
                    holders: 1,
                };
                if let Some((evicted, _)) = store.held.push(asset.clone(), held) {
                    store.ids.retain(|_, over| *over != evicted);
                }
            }
        }
        Ok(store.issue(asset))
    }

    /// Read the document under one id. The read marks its asset the most recently used.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed or its asset was
    /// evicted, and with whatever `read` raises.
    pub fn read<T>(
        &self,
        id: BinDocumentId,
        read: impl FnOnce(&BinDocument) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut store = self.inner.lock();
        let Store { ids, held, .. } = &mut *store;
        let held = ids
            .get(&id)
            .and_then(|asset| held.get(asset))
            .ok_or(BinDocumentError::NotOpen(id))?;
        read(&held.document)
    }

    /// The document under one id, for a read that runs with the store unlocked.
    ///
    /// A walk over a whole system is what asks, so that every other document command
    /// goes on answering while it runs. The ask marks its asset the most recently used.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed or its asset was
    /// evicted.
    pub fn document(&self, id: BinDocumentId) -> Result<Arc<BinDocument>, BinDocumentError> {
        let mut store = self.inner.lock();
        let Store { ids, held, .. } = &mut *store;
        ids.get(&id)
            .and_then(|asset| held.get(asset))
            .map(|held| Arc::clone(&held.document))
            .ok_or(BinDocumentError::NotOpen(id))
    }

    /// The chunk names the project behind `id`'s asset holds.
    ///
    /// Empty for a closed id and for an asset outside a project, which names nothing of
    /// its own. "A project names its own chunks" in docs/ux/BIN_EDITOR.md.
    #[must_use]
    pub fn chunks_of(&self, id: BinDocumentId) -> Arc<LayerChunks> {
        let mut store = self.inner.lock();
        let Store { ids, held, .. } = &mut *store;
        ids.get(&id).and_then(|asset| held.get(asset)).map_or_else(
            || Arc::new(LayerChunks::default()),
            |held| Arc::clone(&held.chunks),
        )
    }

    /// The asset under one id, or `None` where `id` is closed or its asset was evicted.
    #[must_use]
    pub fn asset_of(&self, id: BinDocumentId) -> Option<AssetRef> {
        let store = self.inner.lock();
        store
            .ids
            .get(&id)
            .filter(|asset| store.held.contains(asset))
            .cloned()
    }

    /// Drop one id. Its asset leaves the store with its last id. A closed id is left as it is.
    pub fn close(&self, id: BinDocumentId) {
        let mut store = self.inner.lock();
        let Some(asset) = store.ids.remove(&id) else {
            return;
        };
        let last = store.held.peek_mut(&asset).is_some_and(|held| {
            held.holders = held.holders.saturating_sub(1);
            held.holders == 0
        });
        if last {
            store.held.pop(&asset);
        }
    }

    /// Whether `id` reads. Asking does not touch the recency order.
    #[must_use]
    pub fn is_open(&self, id: BinDocumentId) -> bool {
        let store = self.inner.lock();
        store
            .ids
            .get(&id)
            .is_some_and(|asset| store.held.contains(asset))
    }
}

/// One parsed bin, of either kind.
#[derive(Debug)]
pub struct BinDocument {
    file: BinFile,
}

impl BinDocument {
    /// Parse `bytes` as a bin, by its magic.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Unreadable`] when the bytes are not a bin the
    /// toolkit reads.
    pub fn parse(bytes: &[u8]) -> Result<Self, BinDocumentError> {
        Ok(Self {
            file: BinFile::from_reader(&mut Cursor::new(bytes))?,
        })
    }

    /// The facts the header row draws.
    #[must_use]
    pub fn header(&self) -> BinHeader {
        match &self.file {
            BinFile::Prop(bin) => BinHeader {
                kind: BinFileKind::Prop,
                version: Some(bin.version),
                objects: bin.objects.len(),
                dependencies: bin.dependencies.clone(),
                patches: 0,
                deleted: 0,
            },
            BinFile::Override(patch) => BinHeader {
                kind: BinFileKind::Patch,
                version: None,
                objects: patch.objects.len(),
                dependencies: Vec::new(),
                patches: patch.patches.len(),
                deleted: patch.deleted.len(),
            },
        }
    }

    /// The facts an object tab's header draws for `entry`.
    ///
    /// `schema` names a class the tables miss.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] when `entry` is no object of the
    /// document.
    pub fn object(
        &self,
        entry: BinHash,
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
    ) -> Result<BinObjectHeader, BinDocumentError> {
        let object =
            self.file
                .objects()
                .get(&entry)
                .ok_or_else(|| BinDocumentError::NodeNotFound {
                    address: format!("{}:", hex(entry)),
                })?;
        let mut wanted = Wanted::default();
        wanted.entries.push(entry);
        wanted.classes.push(object.class_hash);
        let named = wanted.resolve(names, schema);
        let (name, unnamed) = named.entry(entry);
        Ok(BinObjectHeader {
            entry: hex(entry),
            name,
            unnamed,
            class_hash: hex(object.class_hash),
            class: named.classes.get(&object.class_hash).cloned(),
            properties: object.properties.len(),
        })
    }

    /// The path hash of every object, in file order.
    pub fn entries(&self) -> impl Iterator<Item = BinHash> + '_ {
        self.file.objects().keys().copied()
    }

    /// The object `entry` names, or `None` where the file declares none under it.
    #[must_use]
    pub fn object_at(&self, entry: BinHash) -> Option<&BinObject> {
        self.file.objects().get(&entry)
    }

    /// The header's dependencies, as the archive paths the file writes them. A `PTCH`
    /// names none.
    #[must_use]
    pub fn dependencies(&self) -> &[String] {
        match &self.file {
            BinFile::Prop(bin) => &bin.dependencies,
            BinFile::Override(_) => &[],
        }
    }

    /// The header's dependencies, hashed as the WAD paths they name.
    ///
    /// A dependency is written as the archive path of the file it names, and the hash
    /// is the one the object index keys a declaring file on. A `PTCH` names none.
    #[must_use]
    pub fn dependency_hashes(&self) -> Vec<WadHash> {
        match &self.file {
            BinFile::Prop(bin) => bin.dependencies.iter().map(WadHash::hash_str).collect(),
            BinFile::Override(_) => Vec::new(),
        }
    }

    /// One row per object, in file order. `schema` names a class the tables miss.
    #[must_use]
    pub fn roots(&self, names: &dyn RowNames, schema: Option<SchemaAt<'_>>) -> Vec<BinRow> {
        let objects = self.file.objects();
        let mut wanted = Wanted::default();
        wanted.entries.extend(objects.keys().copied());
        wanted
            .classes
            .extend(objects.values().map(|object| object.class_hash));
        let named = wanted.resolve(names, schema);

        objects
            .values()
            .map(|object| {
                let (name, unnamed) = named.entry(object.path_hash);
                BinRow {
                    entry: hex(object.path_hash),
                    path: String::new(),
                    label: String::new(),
                    node: RowNode::Object,
                    name,
                    unnamed,
                    kind: None,
                    value: BinValue::Struct {
                        class_hash: hex(object.class_hash),
                        class: named.classes.get(&object.class_hash).cloned(),
                        len: object.properties.len(),
                    },
                    declared: None,
                }
            })
            .collect()
    }

    /// The rows under one node: `offset` in, at most `limit` of them, and the total.
    ///
    /// `path` is the wire form of ADR-0027, empty for the object itself. A leaf, a null
    /// struct and an absent optional have no rows under them. `schema` is the database
    /// at the install's build. `None` leaves every declared kind absent and every
    /// field the tables miss as hex.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] when `entry` is no object of the
    /// document or `path` reaches nothing inside it.
    pub fn children(
        &self,
        entry: BinHash,
        path: &str,
        offset: usize,
        limit: usize,
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
    ) -> Result<BinRows, BinDocumentError> {
        let not_found = || BinDocumentError::NodeNotFound {
            address: format!("{}:{path}", hex(entry)),
        };
        let object = self.file.objects().get(&entry).ok_or_else(not_found)?;
        let steps = parse_steps(path).ok_or_else(not_found)?;
        let (node, trace) = descend(object, &steps).ok_or_else(not_found)?;

        let children = children_of(node);
        let total = children.len();
        let window = children.get(offset..).unwrap_or(&[]).iter().take(limit);

        let mut wanted = Wanted::default();
        for step in &trace {
            match step {
                Trace::Field { field, .. } => wanted.fields.push(*field),
                Trace::Key(key) => wanted.key(key),
                Trace::Index(_) => {}
            }
        }
        for child in window.clone() {
            match child {
                Child::Field(field, value) => {
                    wanted.fields.push(*field);
                    wanted.value(value);
                }
                Child::Element(_, value) => wanted.value(value),
                Child::Entry(key, value) => {
                    wanted.key(key);
                    wanted.value(value);
                }
            }
        }
        let lens = Lens {
            named: wanted.resolve(names, schema),
            schema,
        };

        let class = node.class();
        let parent_label = label_of(&trace, &lens);
        let entry_hex = hex(entry);
        let rows = window
            .map(|child| {
                let segment = Segment::of(*child, path, &parent_label, &lens, class);
                let declared = match child {
                    Child::Field(field, value) => lens.declared(class, *field, value),
                    Child::Element(..) | Child::Entry(..) => None,
                };
                BinRow {
                    entry: entry_hex.clone(),
                    path: format!("{path}{}", segment.wire),
                    label: format!("{parent_label}{}", segment.readable),
                    node: segment.node,
                    name: segment.name,
                    unnamed: segment.unnamed,
                    kind: Some(segment.value.kind().into()),
                    value: lens.named.value_of(segment.value),
                    declared,
                }
            })
            .collect();

        Ok(BinRows { rows, total })
    }

    /// The rows under each of several nodes, one page each, in the order asked.
    ///
    /// The projected read of ADR-0026, which a layout and a value row use in place of
    /// one call per node. A path reaching nothing answers an empty page, because a
    /// layout names fields an object of its class need not hold.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] when `entry` is no object of the
    /// document, and with [`BinDocumentError::ReadTooWide`] when the paths together
    /// reach more than [`READ_ROW_CAP`] rows.
    pub fn children_each(
        &self,
        entry: BinHash,
        paths: &[String],
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
    ) -> Result<Vec<BinRows>, BinDocumentError> {
        let object =
            self.file
                .objects()
                .get(&entry)
                .ok_or_else(|| BinDocumentError::NodeNotFound {
                    address: format!("{}:", hex(entry)),
                })?;

        /* Counted before a row is built, so a call over the cap costs a walk rather
        than the whole answer it is about to be refused. */
        let mut rows = 0;
        for path in paths {
            let Some(steps) = parse_steps(path) else {
                continue;
            };
            let Some((node, _)) = descend(object, &steps) else {
                continue;
            };
            rows += children_of(node).len().min(READ_PAGE);
        }
        if rows > READ_ROW_CAP {
            return Err(BinDocumentError::ReadTooWide {
                rows,
                cap: READ_ROW_CAP,
            });
        }

        paths
            .iter()
            .map(
                |path| match self.children(entry, path, 0, READ_PAGE, names, schema) {
                    Err(BinDocumentError::NodeNotFound { .. }) => Ok(BinRows {
                        rows: Vec::new(),
                        total: 0,
                    }),
                    answer => answer,
                },
            )
            .collect()
    }
}

/// How many rows one path of a projected read answers, the frontend's `PAGE_SIZE`.
const READ_PAGE: usize = 500;

/// How many rows one projected read answers, past which it is refused.
///
/// Four pages. A layout batches its paths under it rather than reading a whole file in
/// one call, which is what keeps the answer a payload a viewport draws.
pub const READ_ROW_CAP: usize = 4 * READ_PAGE;

/// Which kind of bin file a document holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum BinFileKind {
    /// A `PROP`: the objects themselves.
    Prop,
    /// A `PTCH`: a layer over another bin.
    Patch,
}

/// What the header row says about an open bin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct BinHeader {
    pub kind: BinFileKind,
    /// The file version of a `PROP`. A `PTCH` carries none.
    pub version: Option<u32>,
    /// The objects the file declares. For a `PTCH`, the objects it adds.
    pub objects: usize,
    pub dependencies: Vec<String>,
    /// The patch records of a `PTCH`. Nothing draws them.
    pub patches: usize,
    /// The objects a `PTCH` deletes.
    pub deleted: usize,
}

/// The facts an object tab's header draws. "The object tab" in docs/ux/BIN_EDITOR.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct BinObjectHeader {
    /// The object's path hash, `0x` and eight hex digits.
    pub entry: String,
    /// The object's path, or its hex where no table names it.
    pub name: String,
    /// The name is a hash no table names.
    pub unnamed: bool,
    /// `0x` and eight hex digits.
    pub class_hash: String,
    /// The class as the tables name it. Absent where no table does.
    pub class: Option<String>,
    /// How many properties the object holds.
    pub properties: usize,
}

impl BinObjectHeader {
    /// The object as a declaration of `asset`, the file the tab names `file`.
    ///
    /// A class no table names reads as its hex.
    #[must_use]
    pub fn declared_in(&self, asset: &AssetRef, file: &str) -> ObjectDeclaration {
        ObjectDeclaration {
            asset: asset.clone(),
            file: file.to_owned(),
            class: self
                .class
                .clone()
                .unwrap_or_else(|| self.class_hash.clone()),
            class_hash: self.class_hash.clone(),
        }
    }
}

/// What an open answers: the id, the header, and the rows at depth zero.
///
/// A file open answers one row per object. An open with an entry answers that object's
/// properties and its header facts (ADR-0028).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct BinDocumentHandle {
    pub document: BinDocumentId,
    pub header: BinHeader,
    pub rows: Vec<BinRow>,
    /// The object the open is over. Absent for a file open.
    pub object: Option<BinObjectHeader>,
}

/// A window of rows under one node, and how many there are in all.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct BinRows {
    pub rows: Vec<BinRow>,
    pub total: usize,
}

/// Where a row sits in the tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum RowNode {
    /// An object of the file.
    Object,
    /// A property of an object, a struct or an embedded.
    Property,
    /// One element of a container, or the value of a present optional.
    Element,
    /// One entry of a map.
    Entry,
}

/// One row of the viewer, flat.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct BinRow {
    /// The object's path hash, `0x` and eight hex digits.
    pub entry: String,
    /// The property path on the wire, every field a hash. Empty for the object itself.
    pub path: String,
    /// The same path for a person. Empty for the object itself.
    pub label: String,
    pub node: RowNode,
    /// What the row is called: the object's path, the property's name, `[i]` or the key.
    pub name: String,
    /// The name is a hash no table names.
    pub unnamed: bool,
    /// The value's kind. An object row has none.
    pub kind: Option<PropertyKind>,
    pub value: BinValue,
    /// What the schema declares for the field at the install's build. Absent for an
    /// object, an element, an entry, and a field the schema has no line for.
    pub declared: Option<DeclaredKind>,
}

/// What the schema declares for a field, beside whether the file's kind is that.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct DeclaredKind {
    pub shape: KindShape,
    /// The file's kind is not the declared one, as the Problems rule for a property
    /// type reads the two.
    pub mismatch: bool,
}

/// The 27 kinds `ltk_meta` reads, as they cross IPC.
///
/// A mirror of [`Kind`], spelled in ritobin's words. The spelling is the tag a row
/// draws and the word a Problems finding writes. An upstream rename or addition is a
/// compile error here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum PropertyKind {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "bool")]
    Bool,
    #[serde(rename = "i8")]
    I8,
    #[serde(rename = "u8")]
    U8,
    #[serde(rename = "i16")]
    I16,
    #[serde(rename = "u16")]
    U16,
    #[serde(rename = "i32")]
    I32,
    #[serde(rename = "u32")]
    U32,
    #[serde(rename = "i64")]
    I64,
    #[serde(rename = "u64")]
    U64,
    #[serde(rename = "f32")]
    F32,
    #[serde(rename = "vec2")]
    Vector2,
    #[serde(rename = "vec3")]
    Vector3,
    #[serde(rename = "vec4")]
    Vector4,
    #[serde(rename = "mtx44")]
    Matrix44,
    #[serde(rename = "rgba")]
    Color,
    #[serde(rename = "string")]
    String,
    #[serde(rename = "hash")]
    Hash,
    #[serde(rename = "file")]
    WadChunkLink,
    #[serde(rename = "list")]
    Container,
    #[serde(rename = "list2")]
    UnorderedContainer,
    #[serde(rename = "pointer")]
    Struct,
    #[serde(rename = "embed")]
    Embedded,
    #[serde(rename = "link")]
    ObjectLink,
    #[serde(rename = "option")]
    Optional,
    #[serde(rename = "map")]
    Map,
    #[serde(rename = "flag")]
    BitBool,
}

impl PropertyKind {
    /// The kind in ritobin's word, which is its spelling on the wire.
    ///
    /// The serde renames above spell the same words. A test holds the two lists equal.
    #[must_use]
    pub const fn tag(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Bool => "bool",
            Self::I8 => "i8",
            Self::U8 => "u8",
            Self::I16 => "i16",
            Self::U16 => "u16",
            Self::I32 => "i32",
            Self::U32 => "u32",
            Self::I64 => "i64",
            Self::U64 => "u64",
            Self::F32 => "f32",
            Self::Vector2 => "vec2",
            Self::Vector3 => "vec3",
            Self::Vector4 => "vec4",
            Self::Matrix44 => "mtx44",
            Self::Color => "rgba",
            Self::String => "string",
            Self::Hash => "hash",
            Self::WadChunkLink => "file",
            Self::Container => "list",
            Self::UnorderedContainer => "list2",
            Self::Struct => "pointer",
            Self::Embedded => "embed",
            Self::ObjectLink => "link",
            Self::Optional => "option",
            Self::Map => "map",
            Self::BitBool => "flag",
        }
    }
}

impl From<Kind> for PropertyKind {
    fn from(kind: Kind) -> Self {
        match kind {
            Kind::None => Self::None,
            Kind::Bool => Self::Bool,
            Kind::I8 => Self::I8,
            Kind::U8 => Self::U8,
            Kind::I16 => Self::I16,
            Kind::U16 => Self::U16,
            Kind::I32 => Self::I32,
            Kind::U32 => Self::U32,
            Kind::I64 => Self::I64,
            Kind::U64 => Self::U64,
            Kind::F32 => Self::F32,
            Kind::Vector2 => Self::Vector2,
            Kind::Vector3 => Self::Vector3,
            Kind::Vector4 => Self::Vector4,
            Kind::Matrix44 => Self::Matrix44,
            Kind::Color => Self::Color,
            Kind::String => Self::String,
            Kind::Hash => Self::Hash,
            Kind::WadChunkLink => Self::WadChunkLink,
            Kind::Container => Self::Container,
            Kind::UnorderedContainer => Self::UnorderedContainer,
            Kind::Struct => Self::Struct,
            Kind::Embedded => Self::Embedded,
            Kind::ObjectLink => Self::ObjectLink,
            Kind::Optional => Self::Optional,
            Kind::Map => Self::Map,
            Kind::BitBool => Self::BitBool,
        }
    }
}

/// A row's value, in the shape its widget draws.
///
/// A hash rides beside the name a table gave it. A person reads the name and a Copy
/// takes the hash.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum BinValue {
    None,
    /// A `Bool` or a `BitBool`.
    Bool {
        value: bool,
    },
    /// Any integer kind, as text. A `U64` does not fit a JSON number.
    Integer {
        text: String,
    },
    Float {
        value: f32,
    },
    /// Two, three or four components.
    Vector {
        values: Vec<f32>,
    },
    /// Sixteen cells, row-major.
    Matrix {
        values: Vec<f32>,
    },
    Color {
        r: u8,
        g: u8,
        b: u8,
        a: u8,
    },
    String {
        value: String,
    },
    /// `0x` and eight hex digits, and the string behind it where a table names one.
    Hash {
        hash: String,
        name: Option<String>,
    },
    /// Sixteen hex digits, and the chunk's path where a table names one.
    WadChunkLink {
        hash: String,
        path: Option<String>,
    },
    /// `0x` and eight hex digits, and the object's path where a table names one.
    ObjectLink {
        hash: String,
        name: Option<String>,
    },
    /// A `Container` or an `UnorderedContainer`, and the kind of every item.
    Container {
        len: usize,
        item_kind: PropertyKind,
    },
    /// A `Struct` with a class, or an `Embedded`.
    Struct {
        class_hash: String,
        class: Option<String>,
        len: usize,
    },
    /// A `Struct` with a class hash of zero.
    Null,
    /// Whether a value is held, and the kind it is or would be.
    Optional {
        present: bool,
        item_kind: PropertyKind,
    },
    /// The entries, and the kinds the map declares for its keys and its values.
    Map {
        len: usize,
        key_kind: PropertyKind,
        value_kind: PropertyKind,
    },
    /// A leaf this build has no widget for.
    Undrawn,
}

/// The names a row projection reads, one batch per table.
///
/// `visit` takes the index of the hash in `hashes` and its name. A hash no table names is
/// not visited.
pub trait RowNames {
    /// The paths of objects, out of `binentries`.
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str));
    /// The names of classes, out of `bintypes`.
    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str));
    /// The names of properties, out of `binfields`.
    fn for_each_field(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str));
    /// The strings behind `Hash` values, out of `binhashes`.
    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str));
    /// The paths of chunks, out of the WAD tables.
    fn for_each_chunk(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str));
}

/// A project's own chunk names over another source's.
///
/// The shared tables are a crawl of the retail game. A path a mod author invents is in
/// none of them, and the project holding that path is what names it.
#[derive(Debug)]
pub struct ProjectNames<'a, N> {
    inner: &'a N,
    chunks: &'a crate::workshop::LayerChunks,
}

impl<'a, N> ProjectNames<'a, N> {
    /// `chunks` answers a chunk first, and `inner` answers the rest.
    pub fn new(inner: &'a N, chunks: &'a crate::workshop::LayerChunks) -> Self {
        Self { inner, chunks }
    }
}

impl<N: RowNames> RowNames for ProjectNames<'_, N> {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.inner.for_each_entry(hashes, visit);
    }

    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.inner.for_each_class(hashes, visit);
    }

    fn for_each_field(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.inner.for_each_field(hashes, visit);
    }

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.inner.for_each_value(hashes, visit);
    }

    /// The project answers first, and only what it does not name reaches the tables.
    fn for_each_chunk(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str)) {
        let mut residue = Vec::new();
        let mut at_of = Vec::new();
        for (at, hash) in hashes.iter().enumerate() {
            match self.chunks.get(*hash) {
                Some(path) => visit(at, path),
                None => {
                    residue.push(*hash);
                    at_of.push(at);
                }
            }
        }
        if residue.is_empty() {
            return;
        }
        self.inner.for_each_chunk(&residue, &mut |at, path| {
            visit(at_of[at], path);
        });
    }
}

/// Names nothing. Every hash draws as hex.
impl RowNames for () {
    fn for_each_entry(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}
    fn for_each_class(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}
    fn for_each_field(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}
    fn for_each_value(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}
    fn for_each_chunk(&self, _hashes: &[WadHash], _visit: &mut dyn FnMut(usize, &str)) {}
}

impl RowNames for CacheNames<'_> {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.bin().for_each_entry(hashes, visit);
    }

    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.bin().for_each_class(hashes, visit);
    }

    fn for_each_field(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.bin().for_each_field(hashes, visit);
    }

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.bin().for_each_value(hashes, visit);
    }

    fn for_each_chunk(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str)) {
        self.wad().resolve_each(hashes, |at, path| {
            if let Some(path) = path {
                visit(at, path);
            }
        });
    }
}

/// Whether an optional draws what it holds in place of a row of its own.
///
/// An optional is one value or none, so a leaf inside one is a row the reader has to open
/// to learn nothing the option row did not already say. What holds rows of its own keeps
/// its `[0]`, because those rows have to hang off something.
fn inlines(value: &PropertyValueEnum) -> bool {
    !matches!(
        value,
        PropertyValueEnum::Container(_)
            | PropertyValueEnum::UnorderedContainer(_)
            | PropertyValueEnum::Map(_)
            | PropertyValueEnum::Optional(_)
            | PropertyValueEnum::Struct(_)
            | PropertyValueEnum::Embedded(_)
    )
}

/// Whether a `Struct` is the null pointer, which the format writes as a class hash of zero.
fn is_null(inner: &values::Struct) -> bool {
    inner.class_hash.0 == 0
}

/// The separator before a field segment: none at the start of a path.
fn dot(prefix: &str) -> &'static str {
    if prefix.is_empty() { "" } else { "." }
}

/// One step of a wire path.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Step {
    Field(BinHash),
    Index(usize),
    /// The text inside `{}`, as [`wire_key`] writes it.
    Key(String),
}

/// The steps of a wire path, or `None` where the text is not one.
///
/// The grammar is the one a Problems finding writes: `.` before every field but the
/// first, eight hex digits per field, `[i]` for an index and `{key}` for a map entry.
fn parse_steps(path: &str) -> Option<Vec<Step>> {
    let mut steps = Vec::new();
    let mut rest = path;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('[') {
            let (digits, tail) = after.split_once(']')?;
            steps.push(Step::Index(digits.parse().ok()?));
            rest = tail;
        } else if let Some(after) = rest.strip_prefix('{') {
            let (key, tail) = split_key(after)?;
            steps.push(Step::Key(key.to_owned()));
            rest = tail;
        } else {
            let after = match (rest.strip_prefix('.'), steps.is_empty()) {
                (Some(after), false) => after,
                (None, true) => rest,
                _ => return None,
            };
            let (digits, tail) = after.split_at_checked(8)?;
            if !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return None;
            }
            steps.push(Step::Field(BinHash(u32::from_str_radix(digits, 16).ok()?)));
            rest = tail;
        }
    }
    Some(steps)
}

/// The key text inside `{...}`, and what follows the closing brace.
///
/// A string key is a JSON string and may hold a brace. Its closing quote ends the key.
fn split_key(text: &str) -> Option<(&str, &str)> {
    if !text.starts_with('"') {
        return text.split_once('}');
    }
    let mut escaped = false;
    for (at, character) in text.char_indices().skip(1) {
        match character {
            '\\' if !escaped => escaped = true,
            '"' if !escaped => {
                let end = at + 1;
                let tail = text[end..].strip_prefix('}')?;
                return Some((&text[..end], tail));
            }
            _ => escaped = false,
        }
    }
    None
}

/// A node a path resolves to.
#[derive(Clone, Copy)]
enum Node<'a> {
    Object(&'a BinObject),
    Value(&'a PropertyValueEnum),
}

impl<'a> Node<'a> {
    /// The properties a field step reads. `None` for a leaf, a container and a null struct.
    fn properties(self) -> Option<&'a IndexMap<BinHash, PropertyValueEnum>> {
        match self {
            Self::Object(object) => Some(&object.properties),
            Self::Value(PropertyValueEnum::Embedded(values::Embedded(inner))) => {
                Some(&inner.properties)
            }
            Self::Value(PropertyValueEnum::Struct(inner)) if !is_null(inner) => {
                Some(&inner.properties)
            }
            Self::Value(_) => None,
        }
    }

    /// The class the node's properties are declared on. `None` where it has none.
    fn class(self) -> Option<BinHash> {
        match self {
            Self::Object(object) => Some(object.class_hash),
            Self::Value(PropertyValueEnum::Embedded(values::Embedded(inner))) => {
                Some(inner.class_hash)
            }
            Self::Value(PropertyValueEnum::Struct(inner)) if !is_null(inner) => {
                Some(inner.class_hash)
            }
            Self::Value(_) => None,
        }
    }
}

/// What a step passed through, for the readable path of the node it reached.
enum Trace<'a> {
    /// A field, and the class of the node it was read on.
    Field {
        class: Option<BinHash>,
        field: BinHash,
    },
    Index(usize),
    Key(&'a PropertyValueEnum),
}

/// Walk `steps` down from `object`, or `None` where a step reaches nothing.
fn descend<'a>(object: &'a BinObject, steps: &[Step]) -> Option<(Node<'a>, Vec<Trace<'a>>)> {
    let mut node = Node::Object(object);
    let mut trace = Vec::with_capacity(steps.len());
    for step in steps {
        node = match (step, node) {
            (Step::Field(field), node) => {
                let class = node.class();
                let value = node.properties()?.get(field)?;
                trace.push(Trace::Field {
                    class,
                    field: *field,
                });
                Node::Value(value)
            }
            (Step::Index(index), Node::Value(value)) => {
                let item = element(value, *index)?;
                trace.push(Trace::Index(*index));
                Node::Value(item)
            }
            (Step::Key(text), Node::Value(PropertyValueEnum::Map(map))) => {
                let (key, value) = map
                    .entries()
                    .iter()
                    .find(|(key, _)| wire_key(key) == *text)?;
                trace.push(Trace::Key(key));
                Node::Value(value)
            }
            _ => return None,
        };
    }
    Some((node, trace))
}

/// The element `[index]` of a container, or the value of a present optional at `[0]`.
fn element(value: &PropertyValueEnum, index: usize) -> Option<&PropertyValueEnum> {
    match value {
        PropertyValueEnum::Container(items) => items.get(index),
        PropertyValueEnum::UnorderedContainer(items) => items.get(index),
        PropertyValueEnum::Optional(optional) if index == 0 => optional.value(),
        _ => None,
    }
}

/// A child of a node, with the segment that reaches it.
#[derive(Clone, Copy)]
enum Child<'a> {
    Field(BinHash, &'a PropertyValueEnum),
    Element(usize, &'a PropertyValueEnum),
    Entry(&'a PropertyValueEnum, &'a PropertyValueEnum),
}

/// One child as its row names it: the segment that reaches it, in both forms.
struct Segment<'a> {
    value: &'a PropertyValueEnum,
    node: RowNode,
    name: String,
    unnamed: bool,
    /// The segment on the wire, with its separator.
    wire: String,
    /// The segment for a person, with its separator.
    readable: String,
}

impl<'a> Segment<'a> {
    /// The segment of `child` under the node at `path`, whose readable path is
    /// `parent_label` and whose class is `class`.
    fn of(
        child: Child<'a>,
        path: &str,
        parent_label: &str,
        lens: &Lens<'_>,
        class: Option<BinHash>,
    ) -> Self {
        match child {
            Child::Field(field, value) => {
                let (name, unnamed) = lens.field(class, field);
                Self {
                    value,
                    node: RowNode::Property,
                    wire: format!("{}{field:08x}", dot(path)),
                    readable: format!("{}{name}", dot(parent_label)),
                    name,
                    unnamed,
                }
            }
            Child::Element(index, value) => {
                let text = format!("[{index}]");
                Self {
                    value,
                    node: RowNode::Element,
                    name: text.clone(),
                    unnamed: false,
                    wire: text.clone(),
                    readable: text,
                }
            }
            Child::Entry(key, value) => {
                let (text, unnamed) = key_label(key, &lens.named);
                Self {
                    value,
                    node: RowNode::Entry,
                    wire: format!("{{{}}}", wire_key(key)),
                    readable: format!("{{{text}}}"),
                    name: text,
                    unnamed,
                }
            }
        }
    }
}

/// The children of `node`, in file order.
fn children_of(node: Node<'_>) -> Vec<Child<'_>> {
    if let Some(properties) = node.properties() {
        return properties
            .iter()
            .map(|(field, value)| Child::Field(*field, value))
            .collect();
    }
    let Node::Value(value) = node else {
        return Vec::new();
    };
    match value {
        PropertyValueEnum::Container(items) => elements(items.items()),
        PropertyValueEnum::UnorderedContainer(items) => elements(items.items()),
        PropertyValueEnum::Optional(optional) => optional
            .value()
            .filter(|value| !inlines(value))
            .map(|value| Child::Element(0, value))
            .into_iter()
            .collect(),
        PropertyValueEnum::Map(map) => map
            .entries()
            .iter()
            .map(|(key, value)| Child::Entry(key, value))
            .collect(),
        _ => Vec::new(),
    }
}

fn elements(items: &[PropertyValueEnum]) -> Vec<Child<'_>> {
    items
        .iter()
        .enumerate()
        .map(|(index, value)| Child::Element(index, value))
        .collect()
}

/// The text inside `{}` on the wire, the way a Problems finding writes it.
fn wire_key(key: &PropertyValueEnum) -> String {
    let mut out = String::new();
    walk::write_key(&mut out, owned(key.leaf()));
    out
}

/// The text inside `{}` for a person, and whether it is a hash no table names.
///
/// A named `Hash` key is its string as a JSON literal. An unnamed one is `0x` and eight
/// hex digits. Every other kind reads as it does on the wire.
fn key_label(key: &PropertyValueEnum, named: &Named) -> (String, bool) {
    match owned(key.leaf()) {
        Some(Leaf::Hash(hash)) => match named.values.get(&hash) {
            Some(name) => {
                let mut out = String::new();
                walk::write_json_string(&mut out, name);
                (out, false)
            }
            None => (hex(hash), true),
        },
        leaf => {
            let mut out = String::new();
            walk::write_key(&mut out, leaf);
            (out, false)
        }
    }
}

/// The readable path of the node `trace` reached.
fn label_of(trace: &[Trace<'_>], lens: &Lens<'_>) -> String {
    let mut label = String::new();
    for step in trace {
        match step {
            Trace::Field { class, field } => {
                label.push_str(dot(&label));
                label.push_str(&lens.field(*class, *field).0);
            }
            Trace::Index(index) => {
                let _ = write!(label, "[{index}]");
            }
            Trace::Key(key) => {
                let _ = write!(label, "{{{}}}", key_label(key, &lens.named).0);
            }
        }
    }
    label
}

/// What a projection reads a row's name and declared kind from: the tables, and the
/// schema at the install's build.
struct Lens<'a> {
    named: Named,
    schema: Option<SchemaAt<'a>>,
}

impl<'a> Lens<'a> {
    /// A property's name, or its hex and the flag that says so.
    ///
    /// The tables answer first and the schema second. A field neither names is hex.
    fn field(&self, class: Option<BinHash>, field: BinHash) -> (String, bool) {
        if let Some(name) = self.named.fields.get(&field) {
            return (name.clone(), false);
        }
        match self
            .schema
            .and_then(|schema| schema.field_name(class?, field))
        {
            Some(name) => (name.to_owned(), false),
            None => (hex(field), true),
        }
    }

    /// What the schema declares for `field` of `class`, beside whether `value` is that.
    fn declared(
        &self,
        class: Option<BinHash>,
        field: BinHash,
        value: &PropertyValueEnum,
    ) -> Option<DeclaredKind> {
        let shape = self.expected(class, field)?.shape?;
        let mismatch = matches!(TypeSpec::from(shape).matches(value), Ok(false));
        Some(DeclaredKind {
            shape: shape.into(),
            mismatch,
        })
    }

    fn expected(&self, class: Option<BinHash>, field: BinHash) -> Option<Expected<'a>> {
        self.schema?.expected(class?, field)
    }
}

/// The hashes one projection needs named.
#[derive(Debug, Default)]
struct Wanted {
    entries: Vec<BinHash>,
    classes: Vec<BinHash>,
    fields: Vec<BinHash>,
    values: Vec<BinHash>,
    chunks: Vec<WadHash>,
}

impl Wanted {
    /// The hashes a row's value column names.
    fn value(&mut self, value: &PropertyValueEnum) {
        match value {
            PropertyValueEnum::Hash(hash) => self.values.push(hash.value),
            PropertyValueEnum::ObjectLink(link) => self.entries.push(link.value),
            PropertyValueEnum::WadChunkLink(link) => self.chunks.push(link.value),
            PropertyValueEnum::Optional(optional) => {
                if let Some(inner) = optional.value().filter(|inner| inlines(inner)) {
                    self.value(inner);
                }
            }
            PropertyValueEnum::Struct(inner) if !is_null(inner) => {
                self.classes.push(inner.class_hash);
            }
            PropertyValueEnum::Embedded(values::Embedded(inner)) => {
                self.classes.push(inner.class_hash);
            }
            _ => {}
        }
    }

    /// The hash a map key names.
    fn key(&mut self, key: &PropertyValueEnum) {
        if let PropertyValueEnum::Hash(hash) = key {
            self.values.push(hash.value);
        }
    }

    /// Ask every table once for what it names, and `schema` for a class they miss.
    fn resolve(mut self, names: &dyn RowNames, schema: Option<SchemaAt<'_>>) -> Named {
        for list in [
            &mut self.entries,
            &mut self.classes,
            &mut self.fields,
            &mut self.values,
        ] {
            list.sort_unstable();
            list.dedup();
        }
        self.chunks.sort_unstable();
        self.chunks.dedup();

        let mut named = Named::default();
        names.for_each_entry(&self.entries, &mut |at, name| {
            named.entries.insert(self.entries[at], name.to_owned());
        });
        names.for_each_class(&self.classes, &mut |at, name| {
            named.classes.insert(self.classes[at], name.to_owned());
        });
        if let Some(schema) = schema {
            for &class in &self.classes {
                if let Some(name) = schema.class_name(class) {
                    named
                        .classes
                        .entry(class)
                        .or_insert_with(|| name.to_owned());
                }
            }
        }
        names.for_each_field(&self.fields, &mut |at, name| {
            named.fields.insert(self.fields[at], name.to_owned());
        });
        names.for_each_value(&self.values, &mut |at, name| {
            named.values.insert(self.values[at], name.to_owned());
        });
        names.for_each_chunk(&self.chunks, &mut |at, path| {
            named.chunks.insert(self.chunks[at], path.to_owned());
        });
        named
    }
}

/// What the tables named, for one projection.
#[derive(Debug, Default)]
struct Named {
    entries: HashMap<BinHash, String>,
    classes: HashMap<BinHash, String>,
    fields: HashMap<BinHash, String>,
    values: HashMap<BinHash, String>,
    chunks: HashMap<WadHash, String>,
}

impl Named {
    /// An object's path, or its hex and the flag that says so.
    fn entry(&self, hash: BinHash) -> (String, bool) {
        match self.entries.get(&hash) {
            Some(name) => (name.clone(), false),
            None => (hex(hash), true),
        }
    }

    /// `value` in the shape its widget draws.
    fn value_of(&self, value: &PropertyValueEnum) -> BinValue {
        match value {
            PropertyValueEnum::Container(items) => BinValue::Container {
                len: items.len(),
                item_kind: items.item_kind().into(),
            },
            PropertyValueEnum::UnorderedContainer(items) => BinValue::Container {
                len: items.len(),
                item_kind: items.item_kind().into(),
            },
            PropertyValueEnum::Optional(optional) => match optional.value() {
                Some(inner) if inlines(inner) => self.value_of(inner),
                _ => BinValue::Optional {
                    present: optional.is_some(),
                    item_kind: optional.item_kind().into(),
                },
            },
            PropertyValueEnum::Map(map) => BinValue::Map {
                len: map.entries().len(),
                key_kind: map.key_kind().into(),
                value_kind: map.value_kind().into(),
            },
            PropertyValueEnum::Struct(inner) if is_null(inner) => BinValue::Null,
            PropertyValueEnum::Struct(inner)
            | PropertyValueEnum::Embedded(values::Embedded(inner)) => BinValue::Struct {
                class_hash: hex(inner.class_hash),
                class: self.classes.get(&inner.class_hash).cloned(),
                len: inner.properties.len(),
            },
            leaf => self.leaf_of(owned(leaf.leaf())),
        }
    }

    fn leaf_of(&self, leaf: Option<Leaf<'_>>) -> BinValue {
        match leaf {
            None | Some(Leaf::None) => BinValue::None,
            Some(Leaf::Bool(value) | Leaf::Flag(value)) => BinValue::Bool { value },
            Some(Leaf::I8(value)) => integer(value),
            Some(Leaf::U8(value)) => integer(value),
            Some(Leaf::I16(value)) => integer(value),
            Some(Leaf::U16(value)) => integer(value),
            Some(Leaf::I32(value)) => integer(value),
            Some(Leaf::U32(value)) => integer(value),
            Some(Leaf::I64(value)) => integer(value),
            Some(Leaf::U64(value)) => integer(value),
            Some(Leaf::F32(value)) => BinValue::Float { value },
            Some(Leaf::Vector2(vector)) => BinValue::Vector {
                values: vector.to_array().to_vec(),
            },
            Some(Leaf::Vector3(vector)) => BinValue::Vector {
                values: vector.to_array().to_vec(),
            },
            Some(Leaf::Vector4(vector)) => BinValue::Vector {
                values: vector.to_array().to_vec(),
            },
            Some(Leaf::Matrix44(matrix)) => BinValue::Matrix {
                values: matrix.transpose().to_cols_array().to_vec(),
            },
            Some(Leaf::Color(color)) => BinValue::Color {
                r: color.r,
                g: color.g,
                b: color.b,
                a: color.a,
            },
            Some(Leaf::String(text)) => BinValue::String {
                value: text.to_owned(),
            },
            Some(Leaf::Hash(hash)) => BinValue::Hash {
                hash: hex(hash),
                name: self.values.get(&hash).cloned(),
            },
            Some(Leaf::File(hash)) => BinValue::WadChunkLink {
                hash: format!("{hash:016x}"),
                path: self.chunks.get(&hash).cloned(),
            },
            Some(Leaf::Link(hash)) => BinValue::ObjectLink {
                hash: hex(hash),
                name: self.entries.get(&hash).cloned(),
            },
            Some(_) => BinValue::Undrawn,
        }
    }
}

fn integer(value: impl fmt::Display) -> BinValue {
    BinValue::Integer {
        text: value.to_string(),
    }
}

#[cfg(test)]
mod tests;
