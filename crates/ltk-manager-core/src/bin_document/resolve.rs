//! What every resolved read of a document shares.
//!
//! The names a read asks per hash, the resolver map an effect key looks up, and where a
//! file a bin names lives.
//!
//! A particle system's walk and a skin's field reads are the two resolved reads, and
//! neither is the other's business, so what they hold in common sits under the document.

use std::collections::HashMap;
use std::hash::Hash;

use indexmap::IndexMap;
use ltk_hash::{BinHash, WadHash};
use ltk_meta::property::values;
use ltk_meta::walk::{Leaf, TreeValue as _};
use ltk_meta::{BinObject, PropertyValueEnum};
use serde::Serialize;

use super::{BinDocument, BinDocumentError, RowNames};
use crate::preview::AssetRef;

/// A path a bin names, and where its bytes live.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct NamedAsset {
    /// The path as the bin spells it, or a chunk's sixteen hex digits where no table
    /// names it.
    pub path: String,
    /// Absent for a path nothing on this machine holds, which is not an error.
    pub asset: Option<AssetRef>,
}

/// `ResourceResolver.resourceMap`, a `Map<Hash, Link>` from an effect key to its system.
pub(crate) const RESOURCE_MAP: BinHash = BinHash(0xd2f5_8721);

/// `effectKey`, which a child identifier and a skin's idle effect both name a system by.
pub(crate) const EFFECT_KEY: BinHash = BinHash(0x9b03_00f3);

/// A hash as a row prints one, which is `0x` and eight digits.
#[must_use]
pub fn hex(hash: BinHash) -> String {
    format!("0x{:08x}", hash.0)
}

/// A tree read over the owned tree, which never fails.
///
/// # Panics
///
/// On a read the owned tree refused, which is a bug in the tree.
pub fn owned<T>(read: Result<T, ltk_meta::Error>) -> T {
    read.expect("the owned tree never fails")
}

/// Where the bytes behind a path a bin names live.
///
/// A read asks this rather than the game index, so resolving a document depends on
/// neither an install nor the shell's state.
pub trait AssetLookup {
    /// The asset at `path`, or `None` where nothing on this machine holds it.
    ///
    /// A bin spells a path as its author did, so an implementation matches without
    /// regard to case.
    fn locate(&self, path: &str) -> Option<AssetRef>;

    /// The chunk at `hash`, or `None` where nothing on this machine holds it.
    ///
    /// A `file` link is the path's hash whether or not a table names it, so a chunk no
    /// table names is still reached this way. Locates nothing unless implemented.
    fn locate_chunk(&self, hash: WadHash) -> Option<AssetRef> {
        let _ = hash;
        None
    }
}

/// Locates nothing. Every name resolves to its text alone.
impl AssetLookup for () {
    fn locate(&self, _path: &str) -> Option<AssetRef> {
        None
    }
}

/// The object `entry` names, or the error a read reports for none.
pub(crate) fn object_at(
    document: &BinDocument,
    entry: BinHash,
) -> Result<&BinObject, BinDocumentError> {
    document
        .object_at(entry)
        .ok_or_else(|| BinDocumentError::NodeNotFound {
            address: format!("{}:", hex(entry)),
        })
}

/// The effect keys `resolver`'s map holds, each with the object its link names.
///
/// The order is the map's own. A key mapped to a null link is kept, because a null link is a hit that suppresses the
/// effect rather than falling through, and the null target is no object of any document.
pub(crate) fn resolver_entries(resolver: &BinObject) -> impl Iterator<Item = (BinHash, BinHash)> {
    let entries = match resolver.properties.get(&RESOURCE_MAP) {
        Some(PropertyValueEnum::Map(map)) => map.entries(),
        _ => &[],
    };
    entries.iter().filter_map(
        |(key, value)| match (owned(key.leaf()), owned(value.leaf())) {
            (Some(Leaf::Hash(key)), Some(Leaf::Link(target))) => Some((key, target)),
            _ => None,
        },
    )
}

/// A chunk as the path `name` gives it, placed, or its sixteen hex digits placed by hash.
///
/// The digits are the whole of what the file says about a chunk no table names, and
/// the hash still reaches the chunk itself.
pub(crate) fn chunk_asset(
    hash: WadHash,
    name: Option<String>,
    assets: &dyn AssetLookup,
) -> (String, Option<AssetRef>) {
    match name {
        Some(path) => {
            let asset = assets.locate(&path);
            (path, asset)
        }
        None => (format!("{hash:016x}"), assets.locate_chunk(hash)),
    }
}

/// The name one lookup visits, where it visits one.
pub(crate) fn first_name(ask: impl FnOnce(&mut dyn FnMut(usize, &str))) -> Option<String> {
    let mut name = None;
    ask(&mut |_, text| name = Some(text.to_owned()));
    name
}

/// What a field read names hashes by and places paths through.
pub(crate) struct Locator<'a> {
    pub(crate) names: &'a dyn RowNames,
    pub(crate) assets: &'a dyn AssetLookup,
}

impl Locator<'_> {
    /// The file `value` names as a path or as a chunk, and none for an empty one.
    pub(crate) fn asset(&self, value: Option<&PropertyValueEnum>) -> Option<NamedAsset> {
        match leaf(value)? {
            Leaf::String(path) if !path.is_empty() => Some(self.placed(path.to_owned())),
            Leaf::File(hash) if hash.0 != 0 => Some(self.chunk(hash)),
            _ => None,
        }
    }

    /// The chunk `hash` names, placed where a table names it.
    pub(crate) fn chunk(&self, hash: WadHash) -> NamedAsset {
        let name = first_name(|visit| self.names.for_each_chunk(&[hash], visit));
        let (path, asset) = chunk_asset(hash, name, self.assets);
        NamedAsset { path, asset }
    }

    pub(crate) fn placed(&self, path: String) -> NamedAsset {
        NamedAsset {
            asset: self.assets.locate(&path),
            path,
        }
    }

    /// The string behind a `Hash` value, where a table names it.
    pub(crate) fn value_name(&self, hash: BinHash) -> Option<String> {
        first_name(|visit| self.names.for_each_value(&[hash], visit))
    }

    /// The path of the object a link names, where a table names it.
    pub(crate) fn entry_name(&self, hash: BinHash) -> Option<String> {
        first_name(|visit| self.names.for_each_entry(&[hash], visit))
    }
}

pub(crate) type Fields = IndexMap<BinHash, PropertyValueEnum>;

/// The class and the fields of the struct `value` holds, through an optional, and none
/// for a null one.
pub(crate) fn struct_of(value: Option<&PropertyValueEnum>) -> Option<(BinHash, &Fields)> {
    match value? {
        PropertyValueEnum::Struct(inner) | PropertyValueEnum::Embedded(values::Embedded(inner))
            if inner.class_hash.0 != 0 =>
        {
            Some((inner.class_hash, &inner.properties))
        }
        PropertyValueEnum::Optional(optional) => struct_of(optional.value()),
        _ => None,
    }
}

pub(crate) fn fields_of(value: Option<&PropertyValueEnum>) -> Option<&Fields> {
    struct_of(value).map(|(_, fields)| fields)
}

pub(crate) fn items(value: Option<&PropertyValueEnum>) -> &[PropertyValueEnum] {
    match value {
        Some(PropertyValueEnum::Container(items)) => items.items(),
        Some(PropertyValueEnum::UnorderedContainer(items)) => items.items(),
        _ => &[],
    }
}

pub(crate) fn leaf(value: Option<&PropertyValueEnum>) -> Option<Leaf<'_>> {
    owned(value?.leaf())
}

pub(crate) fn text(value: Option<&PropertyValueEnum>) -> Option<&str> {
    match leaf(value)? {
        Leaf::String(text) => Some(text),
        _ => None,
    }
}

/// The object `value` links to, and none for a null link.
pub(crate) fn link(value: Option<&PropertyValueEnum>) -> Option<BinHash> {
    match leaf(value)? {
        Leaf::Link(hash) if hash.0 != 0 => Some(hash),
        _ => None,
    }
}

/// The names one read asks, kept so a hash is asked for once.
///
/// A row projection knows every hash before it builds a row, so it asks in one batch. A
/// walk learns a hash where it reaches one, so it asks per hash and keeps the answer.
pub(crate) struct Namer<'a> {
    names: &'a dyn RowNames,
    entries: HashMap<BinHash, Option<String>>,
    classes: HashMap<BinHash, Option<String>>,
    fields: HashMap<BinHash, Option<String>>,
    values: HashMap<BinHash, Option<String>>,
    chunks: HashMap<WadHash, Option<String>>,
}

impl<'a> Namer<'a> {
    pub(crate) fn new(names: &'a dyn RowNames) -> Self {
        Self {
            names,
            entries: HashMap::new(),
            classes: HashMap::new(),
            fields: HashMap::new(),
            values: HashMap::new(),
            chunks: HashMap::new(),
        }
    }

    pub(crate) fn entry(&mut self, hash: BinHash) -> Option<String> {
        let Self { names, entries, .. } = self;
        kept(entries, hash, |hashes, visit| {
            names.for_each_entry(hashes, visit);
        })
    }

    pub(crate) fn class(&mut self, hash: BinHash) -> Option<String> {
        let Self { names, classes, .. } = self;
        kept(classes, hash, |hashes, visit| {
            names.for_each_class(hashes, visit);
        })
    }

    pub(crate) fn field(&mut self, hash: BinHash) -> Option<String> {
        let Self { names, fields, .. } = self;
        kept(fields, hash, |hashes, visit| {
            names.for_each_field(hashes, visit);
        })
    }

    pub(crate) fn value(&mut self, hash: BinHash) -> Option<String> {
        let Self { names, values, .. } = self;
        kept(values, hash, |hashes, visit| {
            names.for_each_value(hashes, visit);
        })
    }

    pub(crate) fn chunk(&mut self, hash: WadHash) -> Option<String> {
        let Self { names, chunks, .. } = self;
        kept(chunks, hash, |hashes, visit| {
            names.for_each_chunk(hashes, visit);
        })
    }
}

/// What `ask` names `hash`, out of `seen` where it was asked before.
fn kept<H: Copy + Eq + Hash>(
    seen: &mut HashMap<H, Option<String>>,
    hash: H,
    ask: impl FnOnce(&[H], &mut dyn FnMut(usize, &str)),
) -> Option<String> {
    seen.entry(hash)
        .or_insert_with(|| first_name(|visit| ask(&[hash], visit)))
        .clone()
}
