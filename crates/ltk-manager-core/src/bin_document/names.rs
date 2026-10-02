//! The names a row projection asks for, and the tables that answer them.

use std::collections::HashMap;
use std::fmt;

use ltk_hash::{BinHash, WadHash};
use ltk_meta::PropertyValueEnum;
use ltk_meta::property::values;
use ltk_meta::walk::{Leaf, TreeValue as _};

use super::{BinValue, as_struct, hex, inlines, is_null, owned};
use crate::meta_schema::SchemaAt;
use crate::object_index::CacheNames;
use crate::workshop::LayerChunks;

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

    /// The path of one object, where a table names it.
    fn entry_name(&self, hash: BinHash) -> Option<String> {
        first(|visit| self.for_each_entry(&[hash], visit))
    }

    /// The name of one class, where a table names it.
    fn class_name(&self, hash: BinHash) -> Option<String> {
        first(|visit| self.for_each_class(&[hash], visit))
    }

    /// The name of one property, where a table names it.
    fn field_name(&self, hash: BinHash) -> Option<String> {
        first(|visit| self.for_each_field(&[hash], visit))
    }

    /// The string behind one `Hash` value, where a table names it.
    fn value_name(&self, hash: BinHash) -> Option<String> {
        first(|visit| self.for_each_value(&[hash], visit))
    }

    /// The path of one chunk, where a table names it.
    fn chunk_name(&self, hash: WadHash) -> Option<String> {
        first(|visit| self.for_each_chunk(&[hash], visit))
    }
}

/// The name a one-hash ask visits, or `None` where it visits none.
fn first(ask: impl FnOnce(&mut dyn FnMut(usize, &str))) -> Option<String> {
    let mut name = None;
    ask(&mut |_, text| name = Some(text.to_owned()));
    name
}

/// Visit what `own` names, and hand the rest to `rest` under the caller's own indices.
pub(super) fn own_first<'a, H: Copy>(
    hashes: &[H],
    own: impl Fn(H) -> Option<&'a str>,
    visit: &mut dyn FnMut(usize, &str),
    rest: impl FnOnce(&[H], &mut dyn FnMut(usize, &str)),
) {
    let mut residue = Vec::new();
    let mut at_of = Vec::new();
    for (at, hash) in hashes.iter().enumerate() {
        match own(*hash) {
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
    rest(&residue, &mut |at, name| visit(at_of[at], name));
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
    /// the residue.
    fn project_first<H: Copy>(
        &self,
        hashes: &[H],
        own: impl Fn(&LayerChunks, H) -> Option<&str>,
        rest: impl FnOnce(&N, &[H], &mut dyn FnMut(usize, &str)),
        visit: &mut dyn FnMut(usize, &str),
    ) {
        own_first(
            hashes,
            |hash| own(self.chunks, hash),
            visit,
            |residue, visit| {
                rest(self.inner, residue, visit);
            },
        );
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

/// The hashes one projection needs named.
#[derive(Debug, Default)]
pub(crate) struct Wanted {
    pub(crate) entries: Vec<BinHash>,
    pub(crate) classes: Vec<BinHash>,
    pub(crate) fields: Vec<BinHash>,
    pub(crate) values: Vec<BinHash>,
    pub(crate) chunks: Vec<WadHash>,
}

impl Wanted {
    /// The hashes a row's value column names.
    pub(crate) fn value(&mut self, value: &PropertyValueEnum) {
        match value {
            PropertyValueEnum::Hash(hash) => self.values.push(hash.value),
            PropertyValueEnum::ObjectLink(link) => self.entries.push(link.value),
            PropertyValueEnum::WadChunkLink(link) => self.chunks.push(link.value),
            PropertyValueEnum::Optional(optional) => {
                if let Some(inner) = optional.value().filter(|inner| inlines(inner)) {
                    self.value(inner);
                }
            }
            value => {
                if let Some(inner) = as_struct(value) {
                    self.classes.push(inner.class_hash);
                }
            }
        }
    }

    /// The hash a map key names.
    pub(crate) fn key(&mut self, key: &PropertyValueEnum) {
        if let PropertyValueEnum::Hash(hash) = key {
            self.values.push(hash.value);
        }
    }

    /// Ask every table once for what it names, and `schema` for a class they miss.
    pub(crate) fn resolve(mut self, names: &dyn RowNames, schema: Option<SchemaAt<'_>>) -> Named {
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
pub(crate) struct Named {
    pub(crate) entries: HashMap<BinHash, String>,
    pub(crate) classes: HashMap<BinHash, String>,
    pub(crate) fields: HashMap<BinHash, String>,
    pub(crate) values: HashMap<BinHash, String>,
    pub(crate) chunks: HashMap<WadHash, String>,
}

impl Named {
    /// An object's path, or its hex and the flag that says so.
    pub(crate) fn entry(&self, hash: BinHash) -> (String, bool) {
        match self.entries.get(&hash) {
            Some(name) => (name.clone(), false),
            None => (hex(hash), true),
        }
    }

    /// `value` in the shape its widget draws.
    pub(crate) fn value_of(&self, value: &PropertyValueEnum) -> BinValue {
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

    pub(crate) fn leaf_of(&self, leaf: Option<Leaf<'_>>) -> BinValue {
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

pub(super) fn integer(value: impl fmt::Display) -> BinValue {
    BinValue::Integer {
        text: value.to_string(),
    }
}
