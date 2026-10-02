//! One open bin: the tree the backend holds, and the rows it projects for a viewer.
//!
//! ADR-0026 puts the tree here and a window of rows in the frontend. ADR-0027 names a
//! node by the object's hash and the game's property path, every field a hash on the
//! wire and a name for a person.

use std::collections::{HashMap, VecDeque};
use std::fmt::{self, Write as _};
use std::io::Cursor;
use std::num::NonZeroUsize;
use std::sync::Arc;

use indexmap::{IndexMap, IndexSet};
use lru::LruCache;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::property::{Kind, values};
use ltk_meta::walk::{Leaf, TreeValue as _};
use ltk_meta::{ApplyReport, Bin, BinFile, BinObject, PropertyValueEnum};
use ltk_modpkg::Slug;
use parking_lot::{ArcRwLockReadGuard, Mutex, RawRwLock, RwLock};
use serde::{Deserialize, Serialize};
use thiserror::Error;

mod changes;
mod clipboard;
mod declared;
mod dependencies;
mod edit;
mod find;
mod items;
mod properties;
mod property_edit;
mod records;
mod requests;
pub(crate) mod resolve;
mod typed_names;

pub use changes::{BinChange, ChangeBaseline, ChangeKind, Originals};
pub use clipboard::{CLIPBOARD_FORMAT, clipboard_text, clipboard_value};
pub use declared::{
    BASE_LAYER, DeclareContext, DeclaredDiagnostic, DeclaredDiagnosticKind, DeclaredLinkMark,
    DeclaredMark, DeclaredModuleChoice, DeclaredModuleSummary, DeclaredObjectMark, DeclaredSign,
    DeclaredState, Declaring, GameCopy, LaidVariant, LayerOverride, LinkChange, NewObject,
    ObjectChange, ObjectSkip, ProjectDeclarations, RowDeclaration, SkipReason, VariantSource,
};
pub use edit::{EditRejection, HistoryStep, LeafValue, ReadOnly, Reshape, UNDO_DEPTH};
pub use find::{BinFindHit, BinFindResult, FIND_ROWS};
pub use items::{ClassChoice, NewItem};
pub use properties::{AddableField, AddableFields, NewProperty};
pub use property_edit::{PropertyEdit, ValueEdit};
pub use records::TARGET_PATH;
pub use requests::{BinEdit, ChoiceQuery, Choices, DependencyEdit, EditOutcome, ObjectEdit};

pub use resolve::{
    AssetLookup, Fields, Locator, NamedAsset, Namer, chunk_asset, fields_of, hex, items, leaf,
    link, object_at, owned, struct_of, text,
};

use crate::error::AppResult;
use crate::meta_schema::{Expected, KindShape, SchemaAt};
use crate::object_index::{CacheNames, ObjectDeclaration};
use crate::preview::AssetRef;
use crate::problems::rules::bin_property_type::table::TypeSpec;
use crate::problems::walk;
use crate::sandbox::SandboxRef;
use crate::workshop::{LayerChunks, ModuleAction};

/// How many assets the store keeps open at once. ADR-0026, counted per ADR-0028.
///
/// Above the tabs a user keeps open, so a tab's tree is evicted only past that many assets.
pub const CAPACITY: NonZeroUsize = NonZeroUsize::new(32).unwrap();

/// The id one open of a document is addressed by.
///
/// An id is never reused within a process. A call carrying a closed id fails as
/// [`BinDocumentError::NotOpen`] and reaches no other document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
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

    /// The asset is a League client chunk, which the game's bin documents never reach.
    #[error("a League client chunk is not a game bin")]
    LcuChunk,

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

    /// The document takes no edit.
    #[error("the bin is read-only as {0}")]
    ReadOnly(ReadOnly),

    /// An edit's value does not fit the node it addresses.
    #[error("the edit at {address} is refused: {rejection}")]
    EditRejected {
        address: String,
        rejection: EditRejection,
    },

    /// A later layer of the project declares the value a declared edit changes, so the build
    /// keeps that layer's value. ADR-0042.
    #[error("the edit at {address} is overridden by the layer {layer}")]
    Overridden { address: String, layer: String },

    /// The file on disk holds other bytes than the document opened.
    #[error("the bin changed on disk since it opened")]
    ChangedOnDisk,

    /// The edited tree does not encode.
    #[error("the bin does not encode: {0}")]
    Unwritable(#[source] ltk_meta::Error),

    /// A declared document's project, manifest or apply failed. ADR-0042.
    #[error("{0}")]
    Declaring(#[source] Box<crate::error::AppError>),
}

/// The open documents, one tree per asset in a sandbox, bounded, evicting the least
/// recently used.
///
/// A file tab and the object tabs over one asset each hold an id on the one tree
/// (ADR-0028). A declared chunk is held once per sandbox, and a layer file once whichever
/// sandbox opened it (ADR-0056). The bound counts trees. An eviction takes every id over
/// the tree.
pub struct BinDocuments {
    inner: Mutex<Store>,
}

struct Store {
    next: u32,
    /// The bound the store keeps to while every tree over it is clean.
    bound: NonZeroUsize,
    /// The tree each id is over. An id whose tree was evicted reads as not open.
    ids: HashMap<BinDocumentId, TreeKey>,
    trees: LruCache<TreeKey, OpenTree>,
}

/// The store's key for one tree: an asset and the sandbox that holds it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct TreeKey {
    sandbox: SandboxRef,
    asset: AssetRef,
}

impl TreeKey {
    /// The key for `asset` held in `sandbox`, refusing a League client chunk, which no
    /// tree of the game holds.
    fn new(sandbox: &SandboxRef, asset: AssetRef) -> Result<Self, BinDocumentError> {
        if matches!(asset, AssetRef::LcuChunk { .. }) {
            return Err(BinDocumentError::LcuChunk);
        }

        Ok(Self {
            sandbox: sandbox.holding(&asset),
            asset,
        })
    }

    /// Why the tree is read-only, or `None` where it takes edits: the file's own gate, else
    /// the game sandbox's.
    fn gate(&self, document: &BinDocument) -> Option<ReadOnly> {
        document
            .read_only(&self.asset)
            .or_else(|| self.sandbox.is_game().then_some(ReadOnly::GameSandbox))
    }

    /// The key after `project`'s layer `from` became `to`, or `None` for a key of another
    /// layer.
    fn renamed(&self, project: &str, from: &str, to: &str) -> Option<Self> {
        let AssetRef::Layer {
            project: owner,
            layer,
            path,
        } = &self.asset
        else {
            return None;
        };
        if owner != project || layer != from {
            return None;
        }

        Some(Self {
            sandbox: self.sandbox.clone(),
            asset: AssetRef::Layer {
                project: owner.clone(),
                layer: to.to_owned(),
                path: path.clone(),
            },
        })
    }
}

/// A read of one document, held with the store unlocked. A patch waits for it.
pub type DocumentRead = ArcRwLockReadGuard<RawRwLock, BinDocument>;

/// One parsed asset, and how many ids hold it.
struct OpenTree {
    /// Shared, so a read can walk the tree with the store unlocked.
    document: Arc<RwLock<BinDocument>>,
    holders: usize,
}

impl OpenTree {
    /// Whether the tree has no unsaved edits. A tree a save holds for writing counts as dirty.
    fn is_clean(&self) -> bool {
        self.document
            .try_read()
            .is_some_and(|open| !open.is_dirty())
    }
}

impl Store {
    /// Leave room for one more asset, evicting the least recently used clean tree.
    ///
    /// A tree with unsaved edits is never evicted (ADR-0026). A store of dirty trees
    /// grows past its bound instead, and [`BinDocuments::close`] shrinks it back.
    fn make_room(&mut self) {
        if self.trees.len() < self.trees.cap().get() {
            return;
        }
        let clean = self
            .trees
            .iter()
            .rev()
            .find(|(_, tree)| tree.is_clean())
            .map(|(key, _)| key.clone());
        match clean {
            Some(key) => {
                self.trees.pop(&key);
                self.ids.retain(|_, over| *over != key);
            }
            None => self.trees.resize(self.trees.cap().saturating_add(1)),
        }
    }

    /// Bring a store grown past its bound by dirty trees back toward it.
    fn shrink(&mut self) {
        let (len, cap, bound) = (self.trees.len(), self.trees.cap(), self.bound);
        if cap > bound && len < cap.get() {
            self.trees
                .resize(NonZeroUsize::new(len).map_or(bound, |len| len.max(bound)));
        }
    }

    /// A fresh id over `key`.
    fn issue(&mut self, key: TreeKey) -> BinDocumentId {
        let id = BinDocumentId(self.next);
        self.next = self.next.wrapping_add(1);
        self.ids.insert(id, key);
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
            .field("trees", &store.trees.len())
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
                bound: capacity,
                ids: HashMap::new(),
                trees: LruCache::new(capacity),
            }),
        }
    }

    /// Hold `asset` open in `sandbox`, answering a fresh id over its tree.
    ///
    /// `bytes` is read and parsed only while no id is over the tree. At capacity, the
    /// least recently used clean tree leaves the store with every id over it. The lock is
    /// not held over `bytes`. Two opens racing on one tree both parse, and one parse
    /// is kept.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Unreadable`] when the bytes are not a bin, and
    /// with whatever `bytes` raises.
    pub fn open(
        &self,
        sandbox: &SandboxRef,
        asset: AssetRef,
        bytes: impl FnOnce() -> AppResult<Vec<u8>>,
    ) -> AppResult<BinDocumentId> {
        self.hold(TreeKey::new(sandbox, asset)?, || {
            Ok(BinDocument::parse(bytes()?)?)
        })
    }

    /// Hold the game chunk `asset` open in `sandbox` as a declared document of `context`'s
    /// project, answering a fresh id over its tree. ADR-0042.
    ///
    /// As [`BinDocuments::open`], with the tree the game's copy under the project's
    /// declarations. `chunk_hash` is the chunk's path hash.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::open`], and with what [`BinDocument::declare`] raises.
    pub fn open_declared(
        &self,
        sandbox: &SandboxRef,
        asset: AssetRef,
        chunk_hash: u64,
        open: impl FnOnce() -> AppResult<(Vec<u8>, DeclareContext)>,
    ) -> AppResult<BinDocumentId> {
        self.hold(TreeKey::new(sandbox, asset)?, || {
            let (bytes, context) = open()?;
            Ok(BinDocument::declare(bytes, chunk_hash, context)?)
        })
    }

    /// Hold the game variant `asset` open in `sandbox` as a declared document laid over its
    /// base scene bin, answering a fresh id over its tree.
    ///
    /// As [`BinDocuments::open_declared`], with the tree [`BinDocument::declare_variant`]
    /// builds. `chunk_hash` is the variant chunk's path hash.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::open`], and with what [`BinDocument::declare_variant`] raises.
    pub fn open_declared_variant(
        &self,
        sandbox: &SandboxRef,
        asset: AssetRef,
        chunk_hash: u64,
        open: impl FnOnce() -> AppResult<VariantSource>,
    ) -> AppResult<BinDocumentId> {
        self.hold(TreeKey::new(sandbox, asset)?, || {
            Ok(BinDocument::declare_variant(open()?, chunk_hash)?)
        })
    }

    /// Hold `key` open over the tree `parse` answers, which runs only while no id is
    /// over the tree.
    fn hold(
        &self,
        key: TreeKey,
        parse: impl FnOnce() -> AppResult<BinDocument>,
    ) -> AppResult<BinDocumentId> {
        {
            let mut store = self.inner.lock();
            if let Some(tree) = store.trees.get_mut(&key) {
                tree.holders += 1;
                return Ok(store.issue(key));
            }
        }

        let document = parse()?;

        let mut store = self.inner.lock();
        match store.trees.get_mut(&key) {
            Some(tree) => tree.holders += 1,
            None => {
                let tree = OpenTree {
                    document: Arc::new(RwLock::new(document)),
                    holders: 1,
                };
                store.make_room();
                store.trees.push(key.clone(), tree);
            }
        }
        Ok(store.issue(key))
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
        let document = self.document(id)?;
        read(&document)
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
    pub fn document(&self, id: BinDocumentId) -> Result<DocumentRead, BinDocumentError> {
        Ok(self.tree(id)?.1.read_arc())
    }

    /// The key under one id and its tree. The ask marks the tree the most recently used.
    fn tree(
        &self,
        id: BinDocumentId,
    ) -> Result<(TreeKey, Arc<RwLock<BinDocument>>), BinDocumentError> {
        let mut store = self.inner.lock();
        let Store { ids, trees, .. } = &mut *store;
        let key = ids.get(&id).ok_or(BinDocumentError::NotOpen(id))?;
        let document = trees
            .get(key)
            .map(|tree| Arc::clone(&tree.document))
            .ok_or(BinDocumentError::NotOpen(id))?;
        Ok((key.clone(), document))
    }

    /// Why the document under one id is read-only, or `None` where it takes edits.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed or its asset was
    /// evicted.
    pub fn read_only(&self, id: BinDocumentId) -> Result<Option<ReadOnly>, BinDocumentError> {
        let (key, document) = self.tree(id)?;
        Ok(key.gate(&document.read()))
    }

    /// Set one leaf of the document under `id`, answering the value it held.
    ///
    /// Every id over the asset reads the edit. [`BinDocument::set_leaf`] has the rules.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, with
    /// [`BinDocumentError::ReadOnly`] when the document takes no edit, and with what
    /// [`BinDocument::set_leaf`] raises.
    pub fn patch(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        path: &str,
        value: LeafValue,
    ) -> Result<LeafValue, BinDocumentError> {
        self.edit(id, |document| document.set_leaf(entry, path, value))
    }

    /// Add a property to the holder at `holder` of the document under `id`.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, with
    /// [`BinDocumentError::ReadOnly`] when the document takes no edit, and with what
    /// [`BinDocument::add_property`] raises.
    pub fn add_property(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        holder: &str,
        property: NewProperty,
        schema: SchemaAt<'_>,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| {
            document.add_property(entry, holder, property, schema)
        })
    }

    /// Take the property at `path` out of its holder in the document under `id`.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::remove_property`]
    /// raises.
    pub fn remove_property(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        path: &str,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| document.remove_property(entry, path))
    }

    /// Put an item into the list, map or option at `holder` of the document under `id`,
    /// answering the new item's path.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::insert_item`] raises.
    pub fn insert_item(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        holder: &str,
        item: NewItem,
        schema: SchemaAt<'_>,
    ) -> Result<String, BinDocumentError> {
        self.edit(id, |document| {
            document.insert_item(entry, holder, item, schema)
        })
    }

    /// Take the item at `path` out of its holder in the document under `id`.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::remove_item`] raises.
    pub fn remove_item(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        path: &str,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| document.remove_item(entry, path))
    }

    /// Move the item at `path` to `to` in its list in the document under `id`, answering its
    /// new path.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::move_item`] raises.
    pub fn move_item(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        path: &str,
        to: usize,
    ) -> Result<String, BinDocumentError> {
        self.edit(id, |document| document.move_item(entry, path, to))
    }

    /// Set the key of the map entry at `path` in the document under `id`, answering the
    /// entry's new path.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::set_key`] raises.
    pub fn set_key(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        path: &str,
        key: &str,
    ) -> Result<String, BinDocumentError> {
        self.edit(id, |document| document.set_key(entry, path, key))
    }

    /// Give the null pointer at `path` of the document under `id` a class, or set a pointer
    /// to null.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::set_pointer`] raises.
    pub fn set_pointer(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        path: &str,
        class: Option<&str>,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| document.set_pointer(entry, path, class))
    }

    /// Declare a new object named `name` in the document under `id`, answering its path hash.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::create_object`] raises.
    pub fn create_object(
        &self,
        id: BinDocumentId,
        name: &str,
        origin: &NewObject,
    ) -> Result<BinHash, BinDocumentError> {
        self.edit(id, |document| document.create_object(name, origin))
    }

    /// Declare the removal of the object `entry` in the document under `id`.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::remove_object`] raises.
    pub fn remove_object(&self, id: BinDocumentId, entry: BinHash) -> Result<(), BinDocumentError> {
        self.edit(id, |document| document.remove_object(entry))
    }

    /// Take back the removal of the object `entry` in the document under `id`.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::restore_object`] raises.
    pub fn restore_object(
        &self,
        id: BinDocumentId,
        entry: BinHash,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| document.restore_object(entry))
    }

    /// Put the dependency `text` names into the list of the document under `id` at `index`,
    /// the end where `index` is `None`, answering its position.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::insert_dependency`] raises.
    pub fn insert_dependency(
        &self,
        id: BinDocumentId,
        index: Option<usize>,
        text: &str,
    ) -> Result<usize, BinDocumentError> {
        self.edit(id, |document| document.insert_dependency(index, text))
    }

    /// Take the dependency at `index` out of the list of the document under `id`.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::remove_dependency`] raises.
    pub fn remove_dependency(
        &self,
        id: BinDocumentId,
        index: usize,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| document.remove_dependency(index))
    }

    /// Move the dependency at `from` to `to` in the list of the document under `id`.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::move_dependency`] raises.
    pub fn move_dependency(
        &self,
        id: BinDocumentId,
        from: usize,
        to: usize,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| document.move_dependency(from, to))
    }

    /// Replace the dependency at `index` of the document under `id` with the one `text` names.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::set_dependency`] raises.
    pub fn set_dependency(
        &self,
        id: BinDocumentId,
        index: usize,
        text: &str,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| document.set_dependency(index, text))
    }

    /// Take back the chosen layer's removal of the dependency `path` of the document under `id`.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::add_property`], with what [`BinDocument::restore_dependency`] raises.
    pub fn restore_dependency(
        &self,
        id: BinDocumentId,
        path: &str,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| document.restore_dependency(path))
    }

    /// What the document under `id` says beside its rows, or `None` for one that declares
    /// nothing.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed.
    pub fn declared_state(
        &self,
        id: BinDocumentId,
    ) -> Result<Option<DeclaredState>, BinDocumentError> {
        Ok(self.tree(id)?.1.read().declared_state())
    }

    /// Write the edits that follow on the document under `id` to `module` of `layer`.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, and with what
    /// [`BinDocument::declare_into`] raises.
    pub fn declare_into(
        &self,
        id: BinDocumentId,
        layer: &str,
        module: DeclaredModuleChoice,
    ) -> Result<DeclaredState, BinDocumentError> {
        self.tree(id)?.1.write().declare_into(layer, module)
    }

    /// Apply `action` to the manifest of `layer` through the document under `id`, whose
    /// undo reverts it.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, with
    /// [`BinDocumentError::ReadOnly`] when the document takes no edit, and with what
    /// [`BinDocument::declared_module_action`] raises.
    pub fn declared_module_action(
        &self,
        id: BinDocumentId,
        layer: &str,
        action: &ModuleAction,
    ) -> Result<DeclaredState, BinDocumentError> {
        self.edit(id, |document| {
            document.declared_module_action(layer, action)
        })
    }

    /// Declare the row at `path` under `entry` of the document under `id` as the game-copy
    /// reference `reference`, or with `merge` add it to the row's list or map.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, with
    /// [`BinDocumentError::ReadOnly`] when the document takes no edit, and with what
    /// [`BinDocument::declare_reference`] raises.
    pub fn declare_reference(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        path: &str,
        reference: &str,
        merge: bool,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| {
            document.declare_reference(entry, path, reference, merge)
        })
    }

    /// Take edits on the document under `id` as declarations, or refuse them, answering the
    /// gate it then stands behind. Every id over the asset reads the change.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, and with
    /// [`BinDocumentError::Declaring`] for a document that declares nothing.
    pub fn set_declaring(
        &self,
        id: BinDocumentId,
        declaring: Declaring,
    ) -> Result<Option<ReadOnly>, BinDocumentError> {
        let (key, document) = self.tree(id)?;
        let mut document = document.write();
        document.set_declaring(declaring)?;
        Ok(key.gate(&document))
    }

    /// Revert the latest edit of the document under `id`, answering how the rows moved, or
    /// `None` where the undo stack is empty.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, with
    /// [`BinDocumentError::ReadOnly`] when the document takes no edit, and with what
    /// [`BinDocument::undo`] raises.
    pub fn undo(&self, id: BinDocumentId) -> Result<Option<Reshape>, BinDocumentError> {
        self.step(id, HistoryStep::Undo)
    }

    /// Move the document under `id` one `step` through its history, answering how the rows
    /// moved, or `None` where that stack is empty.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::undo`].
    pub fn step(
        &self,
        id: BinDocumentId,
        step: HistoryStep,
    ) -> Result<Option<Reshape>, BinDocumentError> {
        self.edit(id, |document| document.step(step))
    }

    /// Apply the latest undone edit of the document under `id` again, answering how the
    /// rows moved, or `None` where the redo stack is empty.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::undo`].
    pub fn redo(&self, id: BinDocumentId) -> Result<Option<Reshape>, BinDocumentError> {
        self.step(id, HistoryStep::Redo)
    }

    /// Every property and object of the document under `id` that differs from the
    /// baseline, the file as it was opened or `game`'s copy of each object. A declared
    /// document reports none, since its declarations mark what it changes (ADR-0042).
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, and with what
    /// `game` raises for a chunk it could not read.
    pub fn changes(
        &self,
        id: BinDocumentId,
        baseline: ChangeBaseline,
        game: &dyn GameCopy,
    ) -> AppResult<Vec<BinChange>> {
        let (_, document) = self.tree(id)?;
        let document = document.read();
        if document.declares() {
            return Ok(Vec::new());
        }
        let originals = document.originals(baseline, game, None)?;
        Ok(document.changes_from(&originals))
    }

    /// Put the property at `path` under `entry` of the document under `id` back to the
    /// baseline's, as one undoable edit.
    ///
    /// # Errors
    ///
    /// As [`BinDocuments::changes`], and with what [`BinDocument::revert_property`] raises.
    pub fn revert(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        path: &str,
        baseline: ChangeBaseline,
        game: &dyn GameCopy,
    ) -> AppResult<()> {
        let originals = self
            .tree(id)?
            .1
            .read()
            .originals(baseline, game, Some(entry))?;
        Ok(self.edit(id, |document| {
            document.revert_property(entry, path, originals.get(&entry))
        })?)
    }

    /// Run `edit` on the document under `id`, behind its gate.
    fn edit<T>(
        &self,
        id: BinDocumentId,
        edit: impl FnOnce(&mut BinDocument) -> Result<T, BinDocumentError>,
    ) -> Result<T, BinDocumentError> {
        let (key, document) = self.tree(id)?;
        let mut document = document.write();
        if let Some(gate) = key.gate(&document) {
            return Err(BinDocumentError::ReadOnly(gate));
        }
        edit(&mut document)
    }

    /// Read the asset under `id` again, replacing the tree every id over it reads.
    ///
    /// The edits the tree held are dropped.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, with
    /// [`BinDocumentError::Unreadable`] when the bytes are not a bin, and with whatever
    /// `bytes` raises. A failed reload leaves the tree as it was.
    pub fn reload(
        &self,
        id: BinDocumentId,
        bytes: impl FnOnce(&AssetRef) -> AppResult<Vec<u8>>,
    ) -> AppResult<()> {
        let (key, document) = self.tree(id)?;
        let mut document = document.write();
        if document.declares() {
            return Ok(document.reapply()?);
        }
        *document = BinDocument::parse(bytes(&key.asset)?)?;
        Ok(())
    }

    /// Write the document under `id` back to its layer file. ADR-0040.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, with
    /// [`BinDocumentError::ReadOnly`] when the document takes no edit, and with what
    /// [`BinDocument::save_to`] raises.
    pub fn save(&self, id: BinDocumentId) -> AppResult<()> {
        let (key, document) = self.tree(id)?;
        let mut document = document.write();
        if let Some(gate) = key.gate(&document) {
            return Err(BinDocumentError::ReadOnly(gate).into());
        }
        /* An edit of a declared document is on disk once it answers. */
        if document.declares() {
            return Ok(());
        }
        let Some(path) = key.asset.layer_file() else {
            return Err(BinDocumentError::ReadOnly(ReadOnly::Loose).into());
        };
        document.save_to(&path?)
    }

    /// The sandbox the document under one id is held in, or `None` where `id` is closed or
    /// its tree was evicted.
    ///
    /// A layer file is held in its project's sandbox, and a loose file in the game's.
    #[must_use]
    pub fn sandbox_of(&self, id: BinDocumentId) -> Option<SandboxRef> {
        self.key_of(id).map(|key| key.sandbox)
    }

    /// The asset under one id, or `None` where `id` is closed or its tree was evicted.
    #[must_use]
    pub fn asset_of(&self, id: BinDocumentId) -> Option<AssetRef> {
        self.key_of(id).map(|key| key.asset)
    }

    fn key_of(&self, id: BinDocumentId) -> Option<TreeKey> {
        let store = self.inner.lock();
        store
            .ids
            .get(&id)
            .filter(|key| store.trees.contains(key))
            .cloned()
    }

    /// Update the open documents after `project`'s layer `from` is renamed to `to`.
    ///
    /// The trees of the layer's files are stored under the new name, and a declared document
    /// that wrote to `from` writes to `to`. `from` is a `&str` rather than a [`Slug`]: a
    /// project's existing layer name is not always a valid slug.
    pub fn rename_layer(&self, project: &str, from: &str, to: &Slug) {
        let to = to.as_str();
        let mut store = self.inner.lock();
        let Store { ids, trees, .. } = &mut *store;

        let moving: Vec<TreeKey> = trees
            .iter()
            .filter(|(key, _)| key.renamed(project, from, to).is_some())
            .map(|(key, _)| key.clone())
            .collect();
        for key in moving {
            let fresh = key
                .renamed(project, from, to)
                .expect("the key names the layer");
            if let Some(tree) = trees.pop(&key) {
                trees.push(fresh, tree);
            }
        }

        for key in ids.values_mut() {
            if let Some(fresh) = key.renamed(project, from, to) {
                *key = fresh;
            }
        }

        for (key, tree) in trees.iter() {
            if key.sandbox.project() == Some(project) {
                tree.document.write().rename_layer(from, to);
            }
        }
    }

    /// Drop one id. Its asset leaves the store with its last id. A closed id is left as it is.
    pub fn close(&self, id: BinDocumentId) {
        let mut store = self.inner.lock();
        let Some(key) = store.ids.remove(&id) else {
            return;
        };
        let last = store.trees.peek_mut(&key).is_some_and(|tree| {
            tree.holders = tree.holders.saturating_sub(1);
            tree.holders == 0
        });
        if last {
            store.trees.pop(&key);
            store.shrink();
        }
    }

    /// Drop every id, as a frontend that reloaded has lost every handle it held.
    ///
    /// A clean tree leaves the store. A tree with unsaved edits stays with no holder, so
    /// the next open over its asset takes it up with the edits in it.
    pub fn close_all(&self) {
        let mut store = self.inner.lock();
        store.ids.clear();

        let clean: Vec<TreeKey> = store
            .trees
            .iter()
            .filter(|(_, tree)| tree.is_clean())
            .map(|(key, _)| key.clone())
            .collect();
        for key in &clean {
            store.trees.pop(key);
        }
        for (_, tree) in store.trees.iter_mut() {
            tree.holders = 0;
        }

        store.shrink();
    }

    /// Whether `id` reads. Asking does not touch the recency order.
    #[must_use]
    pub fn is_open(&self, id: BinDocumentId) -> bool {
        let store = self.inner.lock();
        store
            .ids
            .get(&id)
            .is_some_and(|key| store.trees.contains(key))
    }
}

/// One parsed bin, of either kind, and the bytes it parsed from.
#[derive(Debug)]
pub struct BinDocument {
    file: BinFile,
    /// The bytes `file` parsed from, which a save writes the touched objects over.
    base: Vec<u8>,
    /// The bytes the document was read from, which a save leaves as they are, for
    /// [`BinDocument::changes_from`] against the file as it was opened.
    opened: Vec<u8>,
    /// Every object a patch touched since the base was read.
    touched: IndexSet<BinHash>,
    /// A patch changed the header's dependency list since the base was read.
    dependencies_touched: bool,
    /// The edits an undo reverts, the latest last, at most [`UNDO_DEPTH`].
    undo: VecDeque<edit::Edit>,
    /// The edits a redo applies again, the latest undone last.
    redo: Vec<edit::Edit>,
    /// The project the document declares into. Absent for every document but a game chunk
    /// opened from a project's game tree (ADR-0042).
    declared: Option<declared::Declared>,
    /// The names typed into an edit, which draw where no table names their hash.
    typed: typed_names::TypedNames,
}

impl BinDocument {
    /// Parse `bytes` as a bin, by its magic.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Unreadable`] when the bytes are not a bin the
    /// toolkit reads.
    pub fn parse(bytes: impl Into<Vec<u8>>) -> Result<Self, BinDocumentError> {
        let base = bytes.into();
        Ok(Self {
            file: BinFile::from_reader(&mut Cursor::new(&base))?,
            opened: base.clone(),
            base,
            touched: IndexSet::new(),
            dependencies_touched: false,
            undo: VecDeque::new(),
            redo: Vec::new(),
            declared: None,
            typed: typed_names::TypedNames::default(),
        })
    }

    /// The bytes the document parsed from, before any patch.
    #[must_use]
    pub fn base(&self) -> &[u8] {
        &self.base
    }

    /// The facts the header row draws. `names` names the objects a `PTCH` deletes.
    #[must_use]
    pub fn header(&self, names: &dyn RowNames) -> BinHeader {
        match &self.file {
            BinFile::Prop(bin) => BinHeader {
                kind: BinFileKind::Prop,
                version: Some(bin.version),
                objects: bin.objects.len(),
                dependencies: self.dependency_rows(),
                patches: 0,
                deleted: Vec::new(),
            },
            BinFile::Override(patch) => {
                let wanted = Wanted {
                    entries: patch.deleted.clone(),
                    ..Wanted::default()
                };
                let named = wanted.resolve(&self.typed.over(names), None);
                BinHeader {
                    kind: BinFileKind::Patch,
                    version: None,
                    objects: patch.objects.len(),
                    dependencies: Vec::new(),
                    patches: patch.patches.len(),
                    deleted: patch
                        .deleted
                        .iter()
                        .map(|&hash| ObjectName {
                            hash: hex(hash),
                            name: named.entries.get(&hash).cloned(),
                        })
                        .collect(),
                }
            }
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
        let named = wanted.resolve(&self.typed.over(names), schema);
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

    /// This `PROP` with the `PTCH` `variant` laid over a copy of it in the client's order, and
    /// what laying it did. `None` where this is no `PROP` or `variant` is no `PTCH`.
    #[must_use]
    pub fn with_variant(&self, variant: &BinDocument) -> Option<(Bin, ApplyReport)> {
        let (BinFile::Prop(bin), BinFile::Override(patch)) = (&self.file, &variant.file) else {
            return None;
        };

        let mut merged = bin.clone();
        let report = patch.clone().apply(&mut merged);
        Some((merged, report))
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

    /// One row per object in file order, then one per object the patch records target.
    ///
    /// A target keeps the order of its first record (ADR-0041). `schema` names a class the
    /// tables miss.
    #[must_use]
    pub fn roots(&self, names: &dyn RowNames, schema: Option<SchemaAt<'_>>) -> Vec<BinRow> {
        /* A declared document keeps the rows of the objects its layer removes, which draw
        struck through and hold no rows under them. ADR-0049. */
        let removed: Vec<&BinObject> = self
            .declared
            .as_ref()
            .map(|declared| declared.removed().collect())
            .unwrap_or_default();
        let objects = self.file.objects();
        let targets = self.targets();
        let mut wanted = Wanted::default();
        wanted.entries.extend(objects.keys().copied());
        wanted
            .entries
            .extend(removed.iter().map(|object| object.path_hash));
        wanted.entries.extend(targets.keys().copied());
        wanted.classes.extend(
            objects
                .values()
                .chain(removed.iter().copied())
                .map(|object| object.class_hash),
        );
        let named = wanted.resolve(&self.typed.over(names), schema);

        let targets = targets
            .iter()
            .map(|(&target, records)| records::target_row(target, records.len(), &named));
        let removed = removed
            .into_iter()
            .map(|object| (object.path_hash, object.class_hash, 0));
        objects
            .values()
            .map(|object| (object.path_hash, object.class_hash, object.properties.len()))
            .chain(removed)
            .map(|(entry, class_hash, len)| {
                let (name, unnamed) = named.entry(entry);
                BinRow {
                    entry: hex(entry),
                    path: String::new(),
                    label: String::new(),
                    node: RowNode::Object,
                    name,
                    unnamed,
                    kind: None,
                    value: BinValue::Struct {
                        class_hash: hex(class_hash),
                        class: named.classes.get(&class_hash).cloned(),
                        len,
                    },
                    declared: None,
                }
            })
            .chain(targets)
            .collect()
    }

    /// The rows under one node: `offset` in, at most `limit` of them, and the total.
    ///
    /// `path` is the wire form of ADR-0027, empty for the object itself. [`TARGET_PATH`]
    /// answers the patch records `entry` takes, and a record's own path what its value
    /// holds (ADR-0041). A leaf, a null struct and an absent optional have no rows under
    /// them. `schema` is the database at the install's build. `None` leaves every declared
    /// kind absent and every field the tables miss as hex.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] when `entry` is no object and no
    /// target of the document, or `path` reaches nothing under it.
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
        if path == TARGET_PATH {
            return self
                .records_of(entry, offset, limit, names, schema)
                .ok_or_else(not_found);
        }
        let (node, trace, base) = self.locate(entry, path).ok_or_else(not_found)?;

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
                Child::Entry(key, value, _) => {
                    wanted.key(key);
                    wanted.value(value);
                }
            }
        }
        let lens = Lens {
            named: wanted.resolve(&self.typed.over(names), schema),
            schema,
        };

        let class = node.class();
        let parent_label = label_of(base, &trace, &lens);
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
    /// Fails with [`BinDocumentError::NodeNotFound`] when `entry` is no object and no
    /// target of the document, and with [`BinDocumentError::ReadTooWide`] when the paths
    /// together reach more than [`READ_ROW_CAP`] rows.
    pub fn children_each(
        &self,
        entry: BinHash,
        paths: &[String],
        names: &dyn RowNames,
        schema: Option<SchemaAt<'_>>,
    ) -> Result<Vec<BinRows>, BinDocumentError> {
        let targets = self.targets();
        if !self.file.objects().contains_key(&entry) && !targets.contains_key(&entry) {
            return Err(BinDocumentError::NodeNotFound {
                address: format!("{}:", hex(entry)),
            });
        }

        /* Counted before a row is built, so a call over the cap costs a walk rather
        than the whole answer it is about to be refused. */
        let mut rows = 0;
        for path in paths {
            let under = if path == TARGET_PATH {
                targets.get(&entry).map_or(0, Vec::len)
            } else {
                match self.locate(entry, path) {
                    Some((node, ..)) => children_of(node).len(),
                    None => continue,
                }
            };
            rows += under.min(READ_PAGE);
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

    /// The properties of the struct or embed the property path `path` under `entry` reaches.
    ///
    /// `None` where the path reaches no node, a leaf, a container or a null struct.
    #[must_use]
    pub fn properties_at(
        &self,
        entry: BinHash,
        path: &str,
    ) -> Option<&IndexMap<BinHash, PropertyValueEnum>> {
        self.locate(entry, path)?.0.properties()
    }

    /// The node a wire address reaches, the trace down to it, and the readable path above.
    ///
    /// Under an object the readable path starts empty. Under a record it starts with the
    /// record's own path, and the record has to target `entry`.
    fn locate(&self, entry: BinHash, path: &str) -> Option<(Node<'_>, Vec<Trace<'_>>, &str)> {
        if let Some((index, rest)) = records::record_address(path) {
            let record = self
                .records()
                .get(index)
                .filter(|record| record.object_hash == entry)?;
            let steps = records::steps_under(rest)?;
            let (node, trace) = descend_from(Node::Value(&record.value), &steps)?;
            return Some((node, trace, record.path.as_str()));
        }
        let object = self.file.objects().get(&entry)?;
        let (node, trace) = descend(object, &parse_steps(path)?)?;
        Some((node, trace, ""))
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
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum BinFileKind {
    /// A `PROP`: the objects themselves.
    Prop,
    /// A `PTCH`: a layer over another bin.
    Patch,
}

/// What the header row says about an open bin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinHeader {
    pub kind: BinFileKind,
    /// The file version of a `PROP`. A `PTCH` carries none.
    pub version: Option<u32>,
    /// The objects the file declares. For a `PTCH`, the objects it adds.
    pub objects: usize,
    pub dependencies: Vec<Dependency>,
    /// The patch records of a `PTCH`.
    pub patches: usize,
    /// The objects a `PTCH` deletes, in file order.
    pub deleted: Vec<ObjectName>,
}

/// One dependency a `PROP` names, as its path and its brex spelling.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct Dependency {
    /// The archive path as the file writes it.
    pub path: String,
    /// The path in brex, which folds the repeated terms of a packed bin name. Absent where
    /// the path repeats nothing.
    pub packed: Option<String>,
}

impl Dependency {
    /// The dependency at `path`, with its brex spelling where that folds anything.
    #[must_use]
    pub fn new(path: String) -> Self {
        let packed = brex::encode(&path).ok().filter(|packed| *packed != path);

        Self { path, packed }
    }
}

/// One object by hash, and by path where a table names it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct ObjectName {
    /// The object's path hash, `0x` and eight hex digits.
    pub hash: String,
    /// The object's path. Absent where no table names it.
    pub name: Option<String>,
}

/// The facts an object tab's header draws. "The object tab" in docs/ux/BIN_EDITOR.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
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
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinDocumentHandle {
    pub document: BinDocumentId,
    /// The sandbox the document is held in. ADR-0056.
    pub sandbox: SandboxRef,
    /// The file the document was read from, and the file a save writes.
    ///
    /// Usually the asset the open asked for. When the open asked for a game chunk that a
    /// layer of the sandbox ships, this is that layer's file instead. ADR-0056.
    pub asset: AssetRef,
    pub header: BinHeader,
    pub rows: Vec<BinRow>,
    /// The object the open is over. Absent for a file open.
    pub object: Option<BinObjectHeader>,
    /// The gate a read-only document stands behind. Absent where it takes edits.
    pub read_only: Option<ReadOnly>,
    /// What a declared document says beside its rows. Absent for every other document.
    pub declared: Option<DeclaredState>,
}

/// A window of rows under one node, and how many there are in all.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinRows {
    pub rows: Vec<BinRow>,
    pub total: usize,
}

/// Where a row sits in the tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum RowNode {
    /// An object of the file.
    Object,
    /// A property of an object, a struct or an embedded.
    Property,
    /// One element of a container, or the value of a present optional.
    Element,
    /// One entry of a map.
    Entry,
    /// An object the patch records of a `PTCH` target, holding those records (ADR-0041).
    Target,
    /// One patch record of a `PTCH`.
    Record,
}

/// One row of the viewer, flat.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinRow {
    /// The object's path hash, `0x` and eight hex digits.
    pub entry: String,
    /// The property path on the wire, every field a hash. Empty for the object itself,
    /// and `#` then the record's position under a patch target (ADR-0041).
    pub path: String,
    /// The same path for a person. Empty for the object itself, and the record's own path
    /// first under a patch record.
    pub label: String,
    pub node: RowNode,
    /// What the row is called: the object's path, the property's name, `[i]` or the key.
    pub name: String,
    /// The name is a hash no table names.
    pub unnamed: bool,
    /// The value's kind. An object row and a target row have none.
    pub kind: Option<PropertyKind>,
    pub value: BinValue,
    /// What the schema declares for the field at the install's build. Absent for an
    /// object, an element, an entry, and a field the schema has no line for.
    pub declared: Option<DeclaredKind>,
}

/// What the schema declares for a field, beside whether the file's kind is that.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
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
#[cfg_attr(feature = "ts", derive(specta::Type))]
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

impl From<PropertyKind> for Kind {
    fn from(kind: PropertyKind) -> Self {
        match kind {
            PropertyKind::None => Self::None,
            PropertyKind::Bool => Self::Bool,
            PropertyKind::I8 => Self::I8,
            PropertyKind::U8 => Self::U8,
            PropertyKind::I16 => Self::I16,
            PropertyKind::U16 => Self::U16,
            PropertyKind::I32 => Self::I32,
            PropertyKind::U32 => Self::U32,
            PropertyKind::I64 => Self::I64,
            PropertyKind::U64 => Self::U64,
            PropertyKind::F32 => Self::F32,
            PropertyKind::Vector2 => Self::Vector2,
            PropertyKind::Vector3 => Self::Vector3,
            PropertyKind::Vector4 => Self::Vector4,
            PropertyKind::Matrix44 => Self::Matrix44,
            PropertyKind::Color => Self::Color,
            PropertyKind::String => Self::String,
            PropertyKind::Hash => Self::Hash,
            PropertyKind::WadChunkLink => Self::WadChunkLink,
            PropertyKind::Container => Self::Container,
            PropertyKind::UnorderedContainer => Self::UnorderedContainer,
            PropertyKind::Struct => Self::Struct,
            PropertyKind::Embedded => Self::Embedded,
            PropertyKind::ObjectLink => Self::ObjectLink,
            PropertyKind::Optional => Self::Optional,
            PropertyKind::Map => Self::Map,
            PropertyKind::BitBool => Self::BitBool,
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
#[cfg_attr(feature = "ts", derive(specta::Type))]
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
    /// The patch records a `PTCH` writes to one object.
    Records {
        len: usize,
    },
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

/// A project's own names over another source's.
///
/// The shared tables are a crawl of the retail game. A path, an object or a `Hash` string
/// a mod author invents is in none of them, and the project holding it is what names it.
/// Classes and properties are the game's own, so those stay with the tables.
#[derive(Debug)]
pub struct ProjectNames<'a, N> {
    inner: &'a N,
    chunks: &'a LayerChunks,
}

impl<'a, N> ProjectNames<'a, N> {
    /// `chunks` answers a chunk, an object or a `Hash` value first, and `inner` the rest.
    pub fn new(inner: &'a N, chunks: &'a LayerChunks) -> Self {
        Self { inner, chunks }
    }
}

impl<N: RowNames> ProjectNames<'_, N> {
    /// The project answers first, and only what it does not name reaches `inner`.
    ///
    /// `own` is the project's table for the batch, and `rest` is `inner`'s, asked once for
    /// the residue and answered under the caller's own indices.
    fn project_first<H: Copy>(
        &self,
        hashes: &[H],
        own: impl Fn(&LayerChunks, H) -> Option<&str>,
        rest: impl FnOnce(&N, &[H], &mut dyn FnMut(usize, &str)),
        visit: &mut dyn FnMut(usize, &str),
    ) {
        let mut residue = Vec::new();
        let mut at_of = Vec::new();
        for (at, hash) in hashes.iter().enumerate() {
            match own(self.chunks, *hash) {
                Some(name) => visit(at, name),
                None => {
                    residue.push(*hash);
                    at_of.push(at);
                }
            }
        }

        if residue.is_empty() {
            return;
        }
        rest(self.inner, &residue, &mut |at, name| {
            visit(at_of[at], name);
        });
    }
}

impl<N: RowNames> RowNames for ProjectNames<'_, N> {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.project_first(hashes, LayerChunks::entry, N::for_each_entry, visit);
    }

    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.inner.for_each_class(hashes, visit);
    }

    fn for_each_field(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.inner.for_each_field(hashes, visit);
    }

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.project_first(hashes, LayerChunks::value, N::for_each_value, visit);
    }

    fn for_each_chunk(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str)) {
        self.project_first(hashes, LayerChunks::get, N::for_each_chunk, visit);
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
    Key(EntryKey),
}

/// The step to one map entry: its key as [`wire_key`] writes it, and which entry of that key.
///
/// A map the file writes with one key twice holds two entries a key alone cannot tell apart.
/// The first is `{key}`, which every address of a map without repeats keeps, and the later
/// ones are `{key}#1`, `{key}#2` and on.
#[derive(Debug, Clone, PartialEq, Eq)]
struct EntryKey {
    text: String,
    /// How many earlier entries of the map hold the same key.
    occurrence: usize,
}

impl EntryKey {
    /// The key of the entry at `at` of `entries`.
    fn of(entries: &[(PropertyValueEnum, PropertyValueEnum)], at: usize) -> Self {
        let text = wire_key(&entries[at].0);
        let occurrence = entries[..at]
            .iter()
            .filter(|(key, _)| wire_key(key) == text)
            .count();
        Self { text, occurrence }
    }

    /// Where in `entries` the entry this names sits, or `None` where no entry is it.
    fn position(&self, entries: &[(PropertyValueEnum, PropertyValueEnum)]) -> Option<usize> {
        entries
            .iter()
            .enumerate()
            .filter(|(_, (key, _))| wire_key(key) == self.text)
            .nth(self.occurrence)
            .map(|(at, _)| at)
    }
}

/// The step on the wire: `{key}`, then `#n` for a repeat.
impl fmt::Display for EntryKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{{{}}}", self.text)?;
        if self.occurrence > 0 {
            write!(f, "#{}", self.occurrence)?;
        }
        Ok(())
    }
}

/// The steps of a wire path, or `None` where the text is not one.
///
/// The grammar is the one a Problems finding writes: `.` before every field but the
/// first, eight hex digits per field, `[i]` for an index and `{key}` for a map entry. A
/// repeated key takes `#n` after its braces, which [`EntryKey`] describes.
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
            let (occurrence, tail) = match tail.strip_prefix('#') {
                Some(count) => {
                    let end = count
                        .find(|character: char| !character.is_ascii_digit())
                        .unwrap_or(count.len());
                    (count[..end].parse().ok()?, &count[end..])
                }
                None => (0, tail),
            };
            steps.push(Step::Key(EntryKey {
                text: key.to_owned(),
                occurrence,
            }));
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
    descend_from(Node::Object(object), steps)
}

/// Walk `steps` down from `node`, or `None` where a step reaches nothing.
fn descend_from<'a>(mut node: Node<'a>, steps: &[Step]) -> Option<(Node<'a>, Vec<Trace<'a>>)> {
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
            (Step::Key(wanted), Node::Value(PropertyValueEnum::Map(map))) => {
                let (key, value) = &map.entries()[wanted.position(map.entries())?];
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
    /// A key, its value, and how many earlier entries of the map hold the same key.
    Entry(&'a PropertyValueEnum, &'a PropertyValueEnum, usize),
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
            Child::Entry(key, value, occurrence) => {
                let (text, unnamed) = key_label(key, &lens.named);
                let repeat = if occurrence > 0 {
                    format!("#{occurrence}")
                } else {
                    String::new()
                };
                Self {
                    value,
                    node: RowNode::Entry,
                    wire: EntryKey {
                        text: wire_key(key),
                        occurrence,
                    }
                    .to_string(),
                    readable: format!("{{{text}}}{repeat}"),
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
        PropertyValueEnum::Map(map) => {
            let mut seen: HashMap<String, usize> = HashMap::new();
            map.entries()
                .iter()
                .map(|(key, value)| {
                    let count = seen.entry(wire_key(key)).or_default();
                    let occurrence = *count;
                    *count += 1;
                    Child::Entry(key, value, occurrence)
                })
                .collect()
        }
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
    walk::write_key(&mut out, owned(key.as_leaf()));
    out
}

/// The text inside `{}` for a person, and whether it is a hash no table names.
///
/// A named `Hash` key is its string as a JSON literal. An unnamed one is `0x` and eight
/// hex digits. Every other kind reads as it does on the wire.
fn key_label(key: &PropertyValueEnum, named: &Named) -> (String, bool) {
    match owned(key.as_leaf()) {
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

/// The readable path of the node `trace` reached from a node whose readable path is `base`.
fn label_of(base: &str, trace: &[Trace<'_>], lens: &Lens<'_>) -> String {
    let mut label = base.to_owned();
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
            leaf => self.leaf_of(owned(leaf.as_leaf())),
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
