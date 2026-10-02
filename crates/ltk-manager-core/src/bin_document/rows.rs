//! A node's children, as the rows a viewer draws.

use std::collections::HashMap;
use std::fmt::Write as _;

use ltk_hash::BinHash;
use ltk_meta::PropertyValueEnum;
use ltk_meta::walk::{Leaf, TreeValue as _};

use super::{
    DeclaredKind, EntryKey, HashPath, Named, Node, RowNode, Trace, as_list, dot, hex, inlines,
    key_text, owned,
};
use crate::meta_schema::{Expected, SchemaAt};
use crate::problems::rules::bin_property_type::table::TypeSpec;
use crate::problems::walk;

/// A child of a node, with the segment that reaches it.
#[derive(Clone, Copy)]
pub(super) enum Child<'a> {
    Field(BinHash, &'a PropertyValueEnum),
    Element(usize, &'a PropertyValueEnum),
    /// A key, its value, and how many earlier entries of the map hold the same key.
    Entry(&'a PropertyValueEnum, &'a PropertyValueEnum, usize),
}

/// One child as its row names it: the segment that reaches it, in both forms.
pub(super) struct Segment<'a> {
    pub(super) value: &'a PropertyValueEnum,
    pub(super) node: RowNode,
    pub(super) name: String,
    pub(super) unnamed: bool,
    /// The child's hash path.
    pub(super) path: String,
    /// The segment for a person, with its separator.
    pub(super) readable: String,
}

impl<'a> Segment<'a> {
    /// The segment of `child` under the node at `path`, whose readable path is
    /// `parent_label` and whose class is `class`.
    pub(super) fn of(
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
                    path: HashPath::under(path).field(field).into(),
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
                    path: HashPath::under(path).index(index).into(),
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
                    path: HashPath::under(path)
                        .key(&EntryKey::new(key_text(key), occurrence))
                        .into(),
                    readable: format!("{{{text}}}{repeat}"),
                    name: text,
                    unnamed,
                }
            }
        }
    }
}

/// The children of `node`, in file order.
pub(super) fn children_of(node: Node<'_>) -> Vec<Child<'_>> {
    if let Some(properties) = node.properties() {
        return properties
            .iter()
            .map(|(field, value)| Child::Field(*field, value))
            .collect();
    }
    let Node::Value(value) = node else {
        return Vec::new();
    };
    if let Some(items) = as_list(value) {
        return elements(items);
    }

    match value {
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
                    let count = seen.entry(key_text(key)).or_default();
                    let occurrence = *count;
                    *count += 1;
                    Child::Entry(key, value, occurrence)
                })
                .collect()
        }
        _ => Vec::new(),
    }
}

pub(super) fn elements(items: &[PropertyValueEnum]) -> Vec<Child<'_>> {
    items
        .iter()
        .enumerate()
        .map(|(index, value)| Child::Element(index, value))
        .collect()
}

/// The text inside `{}` for a person, and whether it is a hash no table names.
///
/// A named `Hash` key is its string as a JSON literal. An unnamed one is `0x` and eight
/// hex digits. Every other kind reads as it does in the hash path.
pub(super) fn key_label(key: &PropertyValueEnum, named: &Named) -> (String, bool) {
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
pub(super) fn label_of(base: &str, trace: &[Trace<'_>], lens: &Lens<'_>) -> String {
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
pub(crate) struct Lens<'a> {
    pub(crate) named: Named,
    pub(crate) schema: Option<SchemaAt<'a>>,
}

impl<'a> Lens<'a> {
    /// A property's name, or its hex and the flag that says so.
    ///
    /// The tables answer first and the schema second. A field neither names is hex.
    pub(crate) fn field(&self, class: Option<BinHash>, field: BinHash) -> (String, bool) {
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
    pub(super) fn declared(
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

    pub(super) fn expected(&self, class: Option<BinHash>, field: BinHash) -> Option<Expected<'a>> {
        self.schema?.expected(class?, field)
    }
}
