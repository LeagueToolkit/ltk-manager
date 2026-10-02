//! The store of open documents, one tree per asset in a sandbox.

use std::collections::HashMap;
use std::fmt;
use std::num::NonZeroUsize;
use std::sync::Arc;

use lru::LruCache;
use ltk_hash::BinHash;
use ltk_modpkg::Slug;
use parking_lot::{ArcRwLockReadGuard, Mutex, RawRwLock, RwLock};

use super::{
    BinChange, BinDocument, BinDocumentError, BinDocumentId, ChangeBaseline, DeclareContext,
    DeclaredModuleChoice, DeclaredState, Declaring, GameCopy, HistoryStep, ReadOnly, Reshape,
    VariantSource,
};
use crate::error::AppResult;
use crate::preview::AssetRef;
use crate::sandbox::SandboxRef;

/// How many assets the store keeps open at once. ADR-0026, counted per ADR-0028.
///
/// Above the tabs a user keeps open, so a tab's tree is evicted only past that many assets.
pub const CAPACITY: NonZeroUsize = NonZeroUsize::new(32).unwrap();

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
pub(super) struct TreeKey {
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
    pub(super) fn tree(
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

    /// Move the document under `id` one `step` through its history, answering how the rows
    /// moved, or `None` where that stack is empty.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NotOpen`] when `id` is closed, with
    /// [`BinDocumentError::ReadOnly`] when the document takes no edit, and with what
    /// [`BinDocument::step`] raises.
    pub fn step(
        &self,
        id: BinDocumentId,
        step: HistoryStep,
    ) -> Result<Option<Reshape>, BinDocumentError> {
        self.edit(id, |document| document.step(step))
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
    pub(super) fn edit<T>(
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
