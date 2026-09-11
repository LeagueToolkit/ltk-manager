//! What the manager adds beside `ltk_meta::walk`: the address a finding names
//! a node by, and the shape questions a rule asks of a value that the tree
//! traits leave to the tree.
//!
//! Node, visitor, walk and trail are the toolkit's words, defined in
//! `league-toolkit/docs/design/value-walk.md` section 2. This module uses them
//! and defines none of its own.

use std::borrow::Cow;
use std::fmt::Write as _;

use ltk_hash::BinHash;
use ltk_meta::property::Kind;
use ltk_meta::stream::ValueView;
use ltk_meta::walk::{Leaf, Trail, TrailStep, TreeValue, Visitor, WalkOutcome};
use ltk_meta::{BinFile, PropertyValueEnum};

/// Walk a bin of either kind: a `PROP`'s objects, or the objects a `PTCH` carries.
///
/// Patch records are outside the walk (D17 in `docs/design/problems-pass.md`).
///
/// # Errors
///
/// Whatever the visitor raises. The owned tree never fails on its own.
pub fn bin<'a, W>(bin: &'a BinFile, visitor: &mut W) -> Result<WalkOutcome, W::Error>
where
    W: Visitor<'a, &'a PropertyValueEnum>,
{
    match bin {
        BinFile::Prop(prop) => prop.walk(visitor),
        BinFile::Override(patch) => patch.walk(visitor),
    }
}

/// The kinds a container, an optional or a map declares in its header.
///
/// `TreeValue` answers the walk's questions and no other. A rule about a
/// property's declared type asks these, and the answer is read off the header
/// over either tree.
pub trait Declared<'a>: TreeValue<'a> {
    /// The item kind of a container or an optional, and the value kind of a map.
    fn item_kind(&self) -> Option<Kind>;

    /// The key kind of a map.
    fn key_kind(&self) -> Option<Kind>;

    /// The class a `Struct` or `Embedded` carries, which is 0 for a null pointer.
    fn class_hash(&self) -> Option<BinHash>;

    /// Whether this is an option whose header says it holds nothing.
    ///
    /// An option writes its item kind and its count apart, so an empty one
    /// still declares the type it would hold. False for every other kind.
    fn is_empty_option(&self) -> bool;

    /// How many items a container or a map declares, and 1 or 0 for an
    /// optional. `None` for a leaf and for a node.
    fn item_count(&self) -> Option<usize>;
}

impl<'a, M> Declared<'a> for &'a PropertyValueEnum<M> {
    fn item_kind(&self) -> Option<Kind> {
        match self {
            PropertyValueEnum::Container(items) => Some(items.item_kind()),
            PropertyValueEnum::UnorderedContainer(items) => Some(items.0.item_kind()),
            PropertyValueEnum::Optional(optional) => Some(optional.item_kind()),
            PropertyValueEnum::Map(map) => Some(map.value_kind()),
            _ => None,
        }
    }

    fn key_kind(&self) -> Option<Kind> {
        match self {
            PropertyValueEnum::Map(map) => Some(map.key_kind()),
            _ => None,
        }
    }

    fn class_hash(&self) -> Option<BinHash> {
        match self {
            PropertyValueEnum::Struct(object) => Some(object.class_hash),
            PropertyValueEnum::Embedded(object) => Some(object.0.class_hash),
            _ => None,
        }
    }

    fn is_empty_option(&self) -> bool {
        matches!(self, PropertyValueEnum::Optional(optional) if optional.is_none())
    }

    fn item_count(&self) -> Option<usize> {
        match self {
            PropertyValueEnum::Container(items) => Some(items.len()),
            PropertyValueEnum::UnorderedContainer(items) => Some(items.0.len()),
            PropertyValueEnum::Optional(optional) => Some(usize::from(optional.is_some())),
            PropertyValueEnum::Map(map) => Some(map.entries().len()),
            _ => None,
        }
    }
}

impl<'a, M: Default> Declared<'a> for ValueView<'a, M> {
    fn item_kind(&self) -> Option<Kind> {
        match self {
            ValueView::Container(items) | ValueView::UnorderedContainer(items) => {
                Some(items.item_kind())
            }
            ValueView::Optional(optional) => Some(optional.item_kind()),
            ValueView::Map(map) => Some(map.value_kind()),
            _ => None,
        }
    }

    fn key_kind(&self) -> Option<Kind> {
        match self {
            ValueView::Map(map) => Some(map.key_kind()),
            _ => None,
        }
    }

    fn class_hash(&self) -> Option<BinHash> {
        match self {
            ValueView::Struct(object) | ValueView::Embedded(object) => Some(object.class_hash()),
            _ => None,
        }
    }

    fn is_empty_option(&self) -> bool {
        matches!(self, ValueView::Optional(optional) if optional.is_none())
    }

    fn item_count(&self) -> Option<usize> {
        match self {
            ValueView::Container(items) | ValueView::UnorderedContainer(items) => {
                Some(items.len() as usize)
            }
            ValueView::Optional(optional) => Some(usize::from(!optional.is_none())),
            ValueView::Map(map) => Some(map.len() as usize),
            _ => None,
        }
    }
}

/// Plaintext for the hashes an address carries.
///
/// The shape `ltk_meta::path::FieldNames` takes (league-toolkit #219). An
/// implementation moves over unchanged.
pub trait FieldNames {
    /// The plaintext of `field`, given the class of the node it was read on.
    ///
    /// A table keyed by field alone ignores `class`. A table keyed by class
    /// answers nothing for `None`.
    fn field(&self, field: BinHash, class: Option<BinHash>) -> Option<Cow<'_, str>>;

    /// The plaintext behind a `Hash`-kind map key. Read for the named form only.
    fn hash(&self, hash: BinHash) -> Option<Cow<'_, str>> {
        let _ = hash;
        None
    }
}

/// Names nothing: every hash renders as hex.
impl FieldNames for () {
    fn field(&self, _field: BinHash, _class: Option<BinHash>) -> Option<Cow<'_, str>> {
        None
    }
}

/// The path to one node, written out in the two forms a row and a repair each
/// need.
///
/// A walk descends far more nodes than it reports, so an address is rendered
/// only for a node a visitor reports on, and never on the way down.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Address {
    hashes: String,
    named: String,
    resolved: bool,
}

impl Address {
    /// What the file holds, in the grammar of `value-walk.md` section 4.2: `.`
    /// between fields, `[i]` for an index, `{key}` for a map entry, every hash
    /// as lowercase hex. A repair matches on it, and no table moves it.
    #[must_use]
    pub fn hashes(&self) -> &str {
        &self.hashes
    }

    /// The hash form, owned.
    #[must_use]
    pub fn into_hashes(self) -> String {
        self.hashes
    }

    /// The same path for reading, every hash a table spells spelled.
    #[must_use]
    pub fn named(&self) -> &str {
        &self.named
    }

    /// The label a row draws, or `None` where it would repeat the hash form.
    #[must_use]
    pub fn label(&self) -> Option<String> {
        self.resolved.then(|| self.named.clone())
    }

    /// The address of `field` on the node `trail` stands on, whose class is
    /// `class`.
    #[must_use]
    pub fn of<'a, V: TreeValue<'a>>(
        trail: &Trail<V>,
        field: BinHash,
        class: BinHash,
        names: &dyn FieldNames,
    ) -> Self {
        let mut address = Self::default();
        let mut classes = trail.classes().iter();
        for step in trail.steps() {
            match step {
                TrailStep::Field(field) => {
                    let class = classes
                        .next()
                        .expect("a trail records one class per field step");
                    address.push_field(*field, *class, names);
                }
                TrailStep::Index(index) => address.push_index(*index),
                TrailStep::Key(key) => address.push_key(*key, names),
            }
        }
        address.push_field(field, class, names);
        address
    }

    /// Step into a property of a node of `class`.
    pub fn push_field(&mut self, field: BinHash, class: BinHash, names: &dyn FieldNames) {
        if !self.hashes.is_empty() {
            self.hashes.push('.');
            self.named.push('.');
        }
        let _ = write!(self.hashes, "{field:08x}");
        match names.field(field, Some(class)) {
            Some(name) => {
                self.named.push_str(&name);
                self.resolved = true;
            }
            None => {
                let _ = write!(self.named, "{field:08x}");
            }
        }
    }

    /// Step into one element of a container, or the value of a present optional.
    pub fn push_index(&mut self, index: usize) {
        let _ = write!(self.hashes, "[{index}]");
        let _ = write!(self.named, "[{index}]");
    }

    /// Step into one entry of a map, subscripted by its key.
    ///
    /// A key that is not a leaf, or does not decode, is written as `{?}`.
    pub fn push_key<'a>(&mut self, key: impl TreeValue<'a>, names: &dyn FieldNames) {
        let leaf = key.leaf().ok().flatten();
        self.hashes.push('{');
        self.named.push('{');
        match leaf {
            Some(Leaf::Hash(hash)) => {
                let _ = write!(self.hashes, "{hash:08x}");
                match names.hash(hash) {
                    Some(name) => {
                        write_json_string(&mut self.named, &name);
                        self.resolved = true;
                    }
                    None => {
                        let _ = write!(self.named, "{hash:08x}");
                    }
                }
            }
            leaf => {
                let at = self.hashes.len();
                write_key(&mut self.hashes, leaf);
                let text = self.hashes[at..].to_owned();
                self.named.push_str(&text);
            }
        }
        self.hashes.push('}');
        self.named.push('}');
    }
}

/// The text inside a `{key}` step, as `value-walk.md` section 4.2 writes it.
///
/// `Leaf` is non-exhaustive (W22), and a kind this build does not know renders
/// as `?`, the same as a key that does not decode.
pub(crate) fn write_key(out: &mut String, leaf: Option<Leaf<'_>>) {
    let _ = match leaf {
        None => out.write_str("?"),
        Some(Leaf::None) => Ok(()),
        Some(Leaf::Bool(v) | Leaf::Flag(v)) => write!(out, "{v}"),
        Some(Leaf::I8(v)) => write!(out, "{v}"),
        Some(Leaf::U8(v)) => write!(out, "{v}"),
        Some(Leaf::I16(v)) => write!(out, "{v}"),
        Some(Leaf::U16(v)) => write!(out, "{v}"),
        Some(Leaf::I32(v)) => write!(out, "{v}"),
        Some(Leaf::U32(v)) => write!(out, "{v}"),
        Some(Leaf::I64(v)) => write!(out, "{v}"),
        Some(Leaf::U64(v)) => write!(out, "{v}"),
        Some(Leaf::F32(v)) => write!(out, "{v}"),
        Some(Leaf::Vector2(v)) => write_tuple(out, &v.to_array()),
        Some(Leaf::Vector3(v)) => write_tuple(out, &v.to_array()),
        Some(Leaf::Vector4(v)) => write_tuple(out, &v.to_array()),
        Some(Leaf::Matrix44(v)) => write_tuple(out, &v.transpose().to_cols_array()),
        Some(Leaf::Color(c)) => write_tuple(out, &[c.r, c.g, c.b, c.a]),
        Some(Leaf::String(s)) => {
            write_json_string(out, s);
            Ok(())
        }
        Some(Leaf::Hash(h) | Leaf::Link(h)) => write!(out, "{h:08x}"),
        Some(Leaf::File(h)) => write!(out, "{h:016x}"),
        Some(_) => out.write_str("?"),
    };
}

/// `(a, b, c)`.
fn write_tuple<T: std::fmt::Display>(out: &mut String, items: &[T]) -> std::fmt::Result {
    out.push('(');
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        write!(out, "{item}")?;
    }
    out.push(')');
    Ok(())
}

/// A JSON string literal, which is how the toolkit writes a string key.
pub(crate) fn write_json_string(out: &mut String, text: &str) {
    let _ = write!(out, "{}", serde_json::Value::String(text.to_owned()));
}

#[cfg(test)]
mod tests;
