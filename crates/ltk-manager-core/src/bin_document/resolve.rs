//! What every resolved read of a document shares.
//!
//! The names a read asks per hash and where a file a bin names lives.
//!
//! A particle system's walk and a skin's field reads are the two resolved reads, and
//! neither is the other's business, so what they hold in common sits under the document.

use std::collections::HashMap;
use std::hash::Hash;

use indexmap::IndexMap;
use ltk_hash::{BinHash, WadHash};
use ltk_meta::walk::{Leaf, TreeValue as _};
use ltk_meta::{BinObject, PropertyValueEnum};
use serde::Serialize;

use super::{BinDocument, BinDocumentError, RowNames, as_list, as_struct};
use crate::preview::AssetRef;

/// A path a bin names, and where its bytes live.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct NamedAsset {
    /// The path as the bin spells it, or a chunk's sixteen hex digits where no table
    /// names it.
    pub path: String,
    /// Absent for a path nothing on this machine holds, which is not an error.
    pub asset: Option<AssetRef>,
}

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
pub fn object_at(document: &BinDocument, entry: BinHash) -> Result<&BinObject, BinDocumentError> {
    document
        .object_at(entry)
        .ok_or_else(|| BinDocumentError::NodeNotFound {
            address: format!("{}:", hex(entry)),
        })
}

/// A chunk as the path `name` gives it, placed, or its sixteen hex digits placed by hash.
///
/// The digits are the whole of what the file says about a chunk no table names, and
/// the hash still reaches the chunk itself.
pub fn chunk_asset(
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

/// What a field read names hashes by and places paths through.
pub struct Locator<'a> {
    pub names: &'a dyn RowNames,
    pub assets: &'a dyn AssetLookup,
}

impl Locator<'_> {
    /// The file `value` names as a path or as a chunk, and none for an empty one.
    pub fn asset(&self, value: Option<&PropertyValueEnum>) -> Option<NamedAsset> {
        match leaf(value)? {
            Leaf::String(path) if !path.is_empty() => Some(self.placed(path.to_owned())),
            Leaf::File(hash) if hash.0 != 0 => Some(self.chunk(hash)),
            _ => None,
        }
    }

    /// The chunk `hash` names, placed where a table names it.
    pub fn chunk(&self, hash: WadHash) -> NamedAsset {
        let name = self.names.chunk_name(hash);
        let (path, asset) = chunk_asset(hash, name, self.assets);
        NamedAsset { path, asset }
    }

    /// `path`, placed where something on this machine holds it.
    pub fn placed(&self, path: String) -> NamedAsset {
        NamedAsset {
            asset: self.assets.locate(&path),
            path,
        }
    }
}

/// The properties of one struct, by field hash and in the file's order.
pub type Fields = IndexMap<BinHash, PropertyValueEnum>;

/// The class and the fields of the struct `value` holds, through an optional, and none
/// for a null one.
pub fn struct_of(value: Option<&PropertyValueEnum>) -> Option<(BinHash, &Fields)> {
    match value? {
        PropertyValueEnum::Optional(optional) => struct_of(optional.value()),
        value => as_struct(value).map(|inner| (inner.class_hash, &inner.properties)),
    }
}

/// The fields of the struct `value` holds, whatever its class.
pub fn fields_of(value: Option<&PropertyValueEnum>) -> Option<&Fields> {
    struct_of(value).map(|(_, fields)| fields)
}

/// What a container holds, and nothing for any other value.
pub fn items(value: Option<&PropertyValueEnum>) -> &[PropertyValueEnum] {
    value.and_then(as_list).unwrap_or_default()
}

/// The value an optional holds, and any other value as it is.
pub fn optional(value: Option<&PropertyValueEnum>) -> Option<&PropertyValueEnum> {
    match value? {
        PropertyValueEnum::Optional(optional) => optional.value(),
        value => Some(value),
    }
}

/// What a map holds, in the file's order, and nothing for any other value.
pub fn entries(value: Option<&PropertyValueEnum>) -> &[(PropertyValueEnum, PropertyValueEnum)] {
    match value {
        Some(PropertyValueEnum::Map(map)) => map.entries(),
        _ => &[],
    }
}

/// The entries of a `Map<Hash, Struct>`, each as its key, its class and its fields.
///
/// An entry keyed by anything but a hash, or holding no struct, is passed over.
pub fn struct_entries(
    value: Option<&PropertyValueEnum>,
) -> impl Iterator<Item = (BinHash, BinHash, &Fields)> {
    entries(value).iter().filter_map(|(key, value)| {
        let Some(Leaf::Hash(hash)) = leaf(Some(key)) else {
            return None;
        };
        let (class, fields) = struct_of(Some(value))?;

        Some((hash, class, fields))
    })
}

/// The entries of a `Map<String, String>`, and none for any other value.
pub fn string_map(value: Option<&PropertyValueEnum>) -> HashMap<String, String> {
    entries(value)
        .iter()
        .filter_map(|(key, value)| {
            Some((text(Some(key))?.to_owned(), text(Some(value))?.to_owned()))
        })
        .collect()
}

/// The scalar `value` holds, and none for a value that holds others.
pub fn leaf(value: Option<&PropertyValueEnum>) -> Option<Leaf<'_>> {
    owned(value?.as_leaf())
}

/// The string `value` holds.
pub fn text(value: Option<&PropertyValueEnum>) -> Option<&str> {
    match leaf(value)? {
        Leaf::String(text) => Some(text),
        _ => None,
    }
}

/// The `Bool` or `BitBool` `value` holds.
pub fn boolean(value: Option<&PropertyValueEnum>) -> Option<bool> {
    match leaf(value)? {
        Leaf::Bool(on) | Leaf::Flag(on) => Some(on),
        _ => None,
    }
}

/// The `F32` `value` holds.
pub fn float(value: Option<&PropertyValueEnum>) -> Option<f32> {
    match leaf(value)? {
        Leaf::F32(float) => Some(float),
        _ => None,
    }
}

/// The integer `value` holds, of any width, and none for a negative one.
pub fn unsigned(value: Option<&PropertyValueEnum>) -> Option<u64> {
    match leaf(value)? {
        Leaf::U8(n) => Some(n.into()),
        Leaf::U16(n) => Some(n.into()),
        Leaf::U32(n) => Some(n.into()),
        Leaf::U64(n) => Some(n),
        Leaf::I8(n) => u64::try_from(n).ok(),
        Leaf::I16(n) => u64::try_from(n).ok(),
        Leaf::I32(n) => u64::try_from(n).ok(),
        Leaf::I64(n) => u64::try_from(n).ok(),
        _ => None,
    }
}

/// The `Vec2` `value` holds.
pub fn vector2(value: Option<&PropertyValueEnum>) -> Option<[f32; 2]> {
    match leaf(value)? {
        Leaf::Vector2(vector) => Some(vector.to_array()),
        _ => None,
    }
}

/// The `Vec3` `value` holds.
pub fn vector3(value: Option<&PropertyValueEnum>) -> Option<[f32; 3]> {
    match leaf(value)? {
        Leaf::Vector3(vector) => Some(vector.to_array()),
        _ => None,
    }
}

/// The `Vec4` `value` holds.
pub fn vector4(value: Option<&PropertyValueEnum>) -> Option<[f32; 4]> {
    match leaf(value)? {
        Leaf::Vector4(vector) => Some(vector.to_array()),
        _ => None,
    }
}

/// The object `value` links to, and none for a null link.
pub fn link(value: Option<&PropertyValueEnum>) -> Option<BinHash> {
    match leaf(value)? {
        Leaf::Link(hash) if hash.0 != 0 => Some(hash),
        _ => None,
    }
}

/// The names one read asks, kept so a hash is asked for once.
///
/// A row projection knows every hash before it builds a row, so it asks in one batch. A
/// walk learns a hash where it reaches one, so it asks per hash and keeps the answer.
pub struct Namer<'a> {
    names: &'a dyn RowNames,
    entries: HashMap<BinHash, Option<String>>,
    classes: HashMap<BinHash, Option<String>>,
    fields: HashMap<BinHash, Option<String>>,
    values: HashMap<BinHash, Option<String>>,
    chunks: HashMap<WadHash, Option<String>>,
}

impl<'a> Namer<'a> {
    /// A namer that has asked `names` nothing yet.
    #[must_use]
    pub fn new(names: &'a dyn RowNames) -> Self {
        Self {
            names,
            entries: HashMap::new(),
            classes: HashMap::new(),
            fields: HashMap::new(),
            values: HashMap::new(),
            chunks: HashMap::new(),
        }
    }

    /// The path of the object `hash` names.
    pub fn entry(&mut self, hash: BinHash) -> Option<String> {
        let Self { names, entries, .. } = self;
        kept(entries, hash, || names.entry_name(hash))
    }

    /// The name of the class `hash` is.
    pub fn class(&mut self, hash: BinHash) -> Option<String> {
        let Self { names, classes, .. } = self;
        kept(classes, hash, || names.class_name(hash))
    }

    /// The name of the property `hash` is.
    pub fn field(&mut self, hash: BinHash) -> Option<String> {
        let Self { names, fields, .. } = self;
        kept(fields, hash, || names.field_name(hash))
    }

    /// The string behind the `Hash` value `hash`.
    pub fn value(&mut self, hash: BinHash) -> Option<String> {
        let Self { names, values, .. } = self;
        kept(values, hash, || names.value_name(hash))
    }

    /// The path of the chunk `hash` names.
    pub fn chunk(&mut self, hash: WadHash) -> Option<String> {
        let Self { names, chunks, .. } = self;
        kept(chunks, hash, || names.chunk_name(hash))
    }
}

/// What `ask` names `hash`, out of `seen` where it was asked before.
fn kept<H: Eq + Hash>(
    seen: &mut HashMap<H, Option<String>>,
    hash: H,
    ask: impl FnOnce() -> Option<String>,
) -> Option<String> {
    seen.entry(hash).or_insert_with(ask).clone()
}
