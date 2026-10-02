//! The names an index resolves its hashes through, and the pass that installs them.
//!
//! The rows are the install's and the names are the tables', so a hashtable sync
//! renames an index in place rather than building a second one.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use ltk_hash::BinHash;
use ltk_wad::WadHash;

use crate::hashtables::{BinHashTables, WadPathResolver};
use crate::matcher::letter_mask;

use super::browse::compare_paths;
use super::{NamedObject, Names, ObjectIndex};

/// The names the index resolves its hashes through.
///
/// The mimir tables in the app, and whatever a test hands in.
pub trait ObjectNames {
    /// Visit the path of every object in `hashes` a table names, with its index.
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str));

    /// The name of a class, or `None` when no table names it.
    fn class(&self, hash: BinHash) -> Option<String>;

    /// Visit the path of every chunk in `hashes` a table names, with its index.
    ///
    /// For the declaring files the build sniffed unnamed, which a later table
    /// may name.
    fn for_each_file(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str));
}

/// The shared cache's names: the bin tables for objects and classes, the WAD
/// tables for declaring files.
#[derive(Debug)]
pub struct CacheNames<'a> {
    bin: &'a BinHashTables,
    wad: &'a WadPathResolver,
}

impl<'a> CacheNames<'a> {
    /// Names out of `bin` and `wad`, both already opened by the caller.
    #[must_use]
    pub fn new(bin: &'a BinHashTables, wad: &'a WadPathResolver) -> Self {
        Self { bin, wad }
    }

    /// The four bin tables.
    #[must_use]
    pub fn bin(&self) -> &'a BinHashTables {
        self.bin
    }

    /// The WAD path tables.
    #[must_use]
    pub fn wad(&self) -> &'a WadPathResolver {
        self.wad
    }
}

impl ObjectNames for CacheNames<'_> {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        self.bin.for_each_entry(hashes, visit);
    }

    fn class(&self, hash: BinHash) -> Option<String> {
        self.bin.class(hash)
    }

    fn for_each_file(&self, hashes: &[WadHash], visit: &mut dyn FnMut(usize, &str)) {
        self.wad.resolve_each(hashes, |at, path| {
            if let Some(path) = path {
                visit(at, path);
            }
        });
    }
}

impl ObjectIndex {
    /// This index with its names resolved through `names`, rows untouched.
    ///
    /// Every distinct object and class hash is looked up once, and so is every
    /// declaring chunk the build sniffed, and the answers stay resident with
    /// the index. Called at warm, and again when a hashtable sync replaces the
    /// tables.
    pub fn named(&self, names: &impl ObjectNames) -> Self {
        let started = Instant::now();
        let rows = &self.declared.rows;

        let objects = &self.declared.objects;
        let mut named: Vec<NamedObject> = Vec::with_capacity(objects.len());
        names.for_each_entry(objects, &mut |at, name| {
            named.push(NamedObject {
                hash: objects[at],
                mask: letter_mask(name),
                name: name.into(),
            });
        });
        named.sort_unstable_by(|a, b| compare_paths(&a.name, &b.name));
        let resolved: HashMap<BinHash, u32> = named
            .iter()
            .enumerate()
            .map(|(at, object)| (object.hash, at as u32))
            .collect();

        let mut classes: Vec<BinHash> = rows.iter().map(|row| row.class).collect();
        classes.sort_unstable();
        classes.dedup();
        let classes: HashMap<BinHash, Box<str>> = classes
            .into_iter()
            .filter_map(|class| Some((class, names.class(class)?.into_boxed_str())))
            .collect();

        let sniffed: Vec<WadHash> = self
            .declared
            .files
            .iter()
            .filter(|file| file.path.is_none())
            .map(|file| file.path_hash)
            .collect();
        let mut files: HashMap<WadHash, Box<str>> = HashMap::new();
        names.for_each_file(&sniffed, &mut |at, path| {
            files.insert(sniffed[at], path.into());
        });

        tracing::debug!(
            objects = objects.len(),
            named = resolved.len(),
            classes = classes.len(),
            sniffed_files = sniffed.len(),
            named_files = files.len(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "Resolved the bin object index's names"
        );

        Self {
            declared: Arc::clone(&self.declared),
            names: Names {
                named,
                objects: resolved,
                classes,
                files,
            },
        }
    }

    /// The object a table names under `object`, or `None` where none does.
    pub(super) fn named_object(&self, object: BinHash) -> Option<&NamedObject> {
        self.names
            .objects
            .get(&object)
            .map(|&at| &self.names.named[at as usize])
    }

    /// The objects no table names, by hash.
    pub fn unnamed_objects(&self) -> impl Iterator<Item = BinHash> + '_ {
        self.declared
            .objects
            .iter()
            .copied()
            .filter(|object| !self.names.objects.contains_key(object))
    }
}
