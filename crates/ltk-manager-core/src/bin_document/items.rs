//! An item put into a list, a map or an option, or taken out, moved and rekeyed, and the
//! class a pointer holds.
//!
//! "Editing a list, a map, an option and a pointer" in docs/ux/BIN_EDITOR.md. `ltk_meta`
//! hands out no insert or remove on a list or a map, so an edit rebuilds the one it changes.

use std::fmt::Write as _;
use std::mem;

use indexmap::IndexMap;
use ltk_hash::BinHash;
use ltk_meta::property::{Kind, ValueMut, values};
use ltk_meta::{BinObject, PropertyValueEnum};
use serde::{Deserialize, Serialize};

use super::edit::{Edit, LeafValue, bin_hash, edit_node, set};
use super::properties::empty_struct;
use super::{
    BinDocument, BinDocumentError, EditRejection, EntryKey, Node, Step, descend, dot, hex, is_null,
    parse_steps, wire_key,
};
use crate::meta_schema::{DeclaredField, SchemaAt};

/// An item Add item writes into a list, a map or an option.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct NewItem {
    /// Where the item lands in a list or a map, or `None` for the end.
    pub index: Option<usize>,
    /// A map entry's key as a person types one: digits, the text of a `string`, or a name
    /// or `0x` and eight hex digits for a `hash`.
    pub key: Option<String>,
    /// The class an embed or a pointer item holds, as a name or `0x` and eight hex digits.
    /// A pointer item without one starts null.
    pub class: Option<String>,
}

/// One class a class line offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ClassChoice {
    /// `0x` and eight hex digits.
    pub hash: String,
    pub name: Option<String>,
    /// An item of the holder holds the class already.
    pub held: bool,
    /// The class the schema declares for the holder, where this one derives from it.
    pub derives_from: Option<String>,
}

impl BinDocument {
    /// The classes an item of the holder at `holder` under `entry` can hold, out of `schema`.
    ///
    /// The holder is a list, a map or an option, or a pointer. The classes its items hold
    /// come first, then the class the schema declares for it, then the classes deriving from
    /// that one.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing, and
    /// with [`BinDocumentError::EditRejected`] where it reaches a leaf.
    pub fn item_classes(
        &self,
        entry: BinHash,
        holder: &str,
        schema: SchemaAt<'_>,
    ) -> Result<Vec<ClassChoice>, BinDocumentError> {
        let object = self.object_or_missing(entry, holder)?;
        let steps = parse_steps(holder).ok_or_else(|| missing(entry, holder))?;
        let (node, _) = descend(object, &steps).ok_or_else(|| missing(entry, holder))?;
        let held = match node {
            Node::Value(PropertyValueEnum::Struct(_) | PropertyValueEnum::Embedded(_)) => {
                Vec::new()
            }
            Node::Value(
                value @ (PropertyValueEnum::Container(_)
                | PropertyValueEnum::UnorderedContainer(_)
                | PropertyValueEnum::Map(_)
                | PropertyValueEnum::Optional(_)),
            ) => held_classes(value),
            _ => return Err(rejected(entry, holder, EditRejection::NotAList)),
        };

        let declared = declared_class(object, &steps, schema);
        let derived = declared
            .map(|class| schema.derived_classes(class))
            .unwrap_or_default();
        let name = |class: BinHash| schema.class_name(class).map(str::to_owned);
        let derives_from = |class: BinHash| {
            declared
                .filter(|_| derived.contains(&class))
                .map(|declared| name(declared).unwrap_or_else(|| hex(declared)))
        };

        let mut choices: Vec<ClassChoice> = held
            .iter()
            .map(|class| ClassChoice {
                hash: hex(*class),
                name: name(*class),
                held: true,
                derives_from: derives_from(*class),
            })
            .collect();
        for class in declared.into_iter().chain(derived.iter().copied()) {
            if held.contains(&class) {
                continue;
            }
            choices.push(ClassChoice {
                hash: hex(class),
                name: name(class),
                held: false,
                derives_from: derives_from(class),
            });
        }
        Ok(choices)
    }

    /// Put `item` into the list, map or option at `holder` under `entry`, answering the new
    /// item's path.
    ///
    /// A leaf item starts at its kind's zero, and an embed or a pointer item as its class with
    /// no fields. An embed naming no class takes the first class the holder holds, else the
    /// one `schema` declares for it. The edit joins the undo stack and empties the redo stack.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing, and
    /// with [`BinDocumentError::EditRejected`] where it reaches no list, map or option, where
    /// a map's key is missing, malformed or held already, where an option holds a value,
    /// where the index is past the end, and where an embed item has no class to take.
    pub fn insert_item(
        &mut self,
        entry: BinHash,
        holder: &str,
        item: NewItem,
        schema: SchemaAt<'_>,
    ) -> Result<String, BinDocumentError> {
        let refuse = |rejection| rejected(entry, holder, rejection);
        let (item_kind, key_kind) = match self.node(entry, holder)? {
            Node::Value(PropertyValueEnum::Container(items)) => (items.item_kind(), None),
            Node::Value(PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(
                items,
            ))) => (items.item_kind(), None),
            Node::Value(PropertyValueEnum::Map(map)) => (map.value_kind(), Some(map.key_kind())),
            Node::Value(PropertyValueEnum::Optional(optional)) => (optional.item_kind(), None),
            _ => return Err(refuse(EditRejection::NotAList)),
        };
        let key = key_kind
            .map(|kind| {
                let text = item.key.as_deref().ok_or(EditRejection::MissingKey)?;
                key_value(kind, text)
            })
            .transpose()
            .map_err(refuse)?;
        let class = item
            .class
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(bin_hash)
            .transpose()
            .map_err(refuse)?
            .or_else(|| {
                (item_kind == Kind::Embedded)
                    .then(|| self.default_class(entry, holder, schema))
                    .flatten()
            });
        let value = item_start(item_kind, class).map_err(refuse)?;
        if let (Some(key), Node::Value(PropertyValueEnum::Map(map))) =
            (&key, self.node(entry, holder)?)
            && holds_key(map, key)
        {
            return Err(refuse(EditRejection::KeyExists));
        }

        let inverse = self.put_item(entry, holder, item.index, key, value)?;
        let path = landing(&inverse).to_owned();
        self.record(inverse)?;
        Ok(path)
    }

    /// Take the item at `path` under `entry` out of its list, map or option.
    ///
    /// The edit joins the undo stack, which puts the item back at its index.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing, and
    /// with [`BinDocumentError::EditRejected`] where it ends in no item.
    pub fn remove_item(&mut self, entry: BinHash, path: &str) -> Result<(), BinDocumentError> {
        let inverse = self.take_item(entry, path)?;
        self.record(inverse)?;
        Ok(())
    }

    /// Move the item at `path` under `entry` to `to` in its list, answering its new path.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing, and
    /// with [`BinDocumentError::EditRejected`] where it ends in no item of a list and where
    /// `to` is past the last item.
    pub fn move_item(
        &mut self,
        entry: BinHash,
        path: &str,
        to: usize,
    ) -> Result<String, BinDocumentError> {
        self.node(entry, path)?;
        let Some((_, Step::Index(from))) = split_item(path) else {
            return Err(rejected(entry, path, EditRejection::NotAnItem));
        };
        if from == to {
            return Ok(path.to_owned());
        }
        let inverse = self.shift_item(entry, path, to)?;
        let moved = landing(&inverse).to_owned();
        self.record(inverse)?;
        Ok(moved)
    }

    /// Set the key of the map entry at `path` under `entry` to `text`, answering the entry's
    /// new path.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing, and
    /// with [`BinDocumentError::EditRejected`] where it ends in no map entry, where `text`
    /// is no key of the map's kind, and where another entry holds the key.
    pub fn set_key(
        &mut self,
        entry: BinHash,
        path: &str,
        text: &str,
    ) -> Result<String, BinDocumentError> {
        let refuse = |rejection| rejected(entry, path, rejection);
        self.node(entry, path)?;
        let Some((holder, Step::Key(held))) = split_item(path) else {
            return Err(refuse(EditRejection::NotAnItem));
        };
        let Node::Value(PropertyValueEnum::Map(map)) = self.node(entry, &holder)? else {
            return Err(refuse(EditRejection::NotAnItem));
        };
        let key = key_value(map.key_kind(), text).map_err(refuse)?;
        if wire_key(&key) == held.text {
            return Ok(path.to_owned());
        }
        if holds_key(map, &key) {
            return Err(refuse(EditRejection::KeyExists));
        }

        let inverse = self.swap_key(entry, path, key)?;
        let rekeyed = landing(&inverse).to_owned();
        self.record(inverse)?;
        Ok(rekeyed)
    }

    /// Give the null pointer at `path` under `entry` the class `class` names with no fields,
    /// or set a pointer to null where `class` is `None`.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing, and
    /// with [`BinDocumentError::EditRejected`] where it reaches no pointer, where a class is
    /// given to a pointer holding one, and where the class text is malformed.
    pub fn set_pointer(
        &mut self,
        entry: BinHash,
        path: &str,
        class: Option<&str>,
    ) -> Result<(), BinDocumentError> {
        let refuse = |rejection| rejected(entry, path, rejection);
        let class = class
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(bin_hash)
            .transpose()
            .map_err(refuse)?;
        let Node::Value(PropertyValueEnum::Struct(pointer)) = self.node(entry, path)? else {
            return Err(refuse(EditRejection::NotAPointer));
        };
        match (class, is_null(pointer)) {
            (None, true) => return Ok(()),
            (Some(_), false) => return Err(refuse(EditRejection::ValueHeld)),
            _ => {}
        }

        let value = class.map_or_else(values::Struct::default, empty_struct);
        let inverse = self.swap_pointer(entry, path, value)?;
        self.record(inverse)?;
        Ok(())
    }

    /// Swap the pointer at `path` under `entry` to the class `class` names, or to null
    /// where `class` is `None`.
    ///
    /// A property stays where the held class and the new one declare its field with one
    /// type, and every other property is dropped. A pointer holding `class` already is left
    /// as it is.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing, and
    /// with [`BinDocumentError::EditRejected`] where it reaches no pointer and where the
    /// class text is malformed.
    pub fn replace_pointer(
        &mut self,
        entry: BinHash,
        path: &str,
        class: Option<&str>,
        schema: SchemaAt<'_>,
    ) -> Result<(), BinDocumentError> {
        let refuse = |rejection| rejected(entry, path, rejection);
        let class = class
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(bin_hash)
            .transpose()
            .map_err(refuse)?;
        let Node::Value(PropertyValueEnum::Struct(pointer)) = self.node(entry, path)? else {
            return Err(refuse(EditRejection::NotAPointer));
        };
        let held = (!is_null(pointer)).then_some(pointer.class_hash);
        if held == class {
            return Ok(());
        }

        let value = match class {
            Some(class) => values::Struct {
                class_hash: class,
                properties: shared_properties(pointer, class, schema),
            },
            None => values::Struct::default(),
        };
        let inverse = self.swap_pointer(entry, path, value)?;
        self.record(inverse)?;
        Ok(())
    }

    /// Put `value` into the holder at `holder`, answering the edit that takes it out.
    pub(super) fn put_item(
        &mut self,
        entry: BinHash,
        holder: &str,
        index: Option<usize>,
        key: Option<PropertyValueEnum>,
        value: PropertyValueEnum,
    ) -> Result<Edit, BinDocumentError> {
        let segment =
            self.edit_value(entry, holder, |node| insert_into(node, index, key, value))?;
        Ok(Edit::RemoveItem {
            entry,
            path: format!("{holder}{segment}"),
        })
    }

    /// Take the item at `path` out of its holder, answering the edit that puts it back.
    pub(super) fn take_item(
        &mut self,
        entry: BinHash,
        path: &str,
    ) -> Result<Edit, BinDocumentError> {
        self.node(entry, path)?;
        let (holder, step) =
            split_item(path).ok_or_else(|| rejected(entry, path, EditRejection::NotAnItem))?;
        let (index, key, value) = self.edit_value(entry, &holder, |node| take_from(node, &step))?;
        Ok(Edit::InsertItem {
            entry,
            holder,
            index,
            key,
            value,
        })
    }

    /// Move the item at `path` to `to`, answering the edit that moves it back.
    pub(super) fn shift_item(
        &mut self,
        entry: BinHash,
        path: &str,
        to: usize,
    ) -> Result<Edit, BinDocumentError> {
        self.node(entry, path)?;
        let Some((holder, Step::Index(from))) = split_item(path) else {
            return Err(rejected(entry, path, EditRejection::NotAnItem));
        };
        self.edit_value(entry, &holder, |node| match node {
            ValueMut::Container(items)
            | ValueMut::UnorderedContainer(values::UnorderedContainer(items)) => {
                if from >= items.len() || to >= items.len() {
                    return Err(EditRejection::NoSuchIndex);
                }
                rebuild_list(items, |all| {
                    let item = all.remove(from);
                    all.insert(to, item);
                });
                Ok(())
            }
            _ => Err(EditRejection::NotAnItem),
        })?;
        Ok(Edit::MoveItem {
            entry,
            path: format!("{holder}[{to}]"),
            to: from,
        })
    }

    /// Set the key of the entry at `path` to `key`, answering the edit that sets it back.
    ///
    /// A key another entry holds is taken as a repeat, which is how an undo puts one back.
    pub(super) fn swap_key(
        &mut self,
        entry: BinHash,
        path: &str,
        key: PropertyValueEnum,
    ) -> Result<Edit, BinDocumentError> {
        self.node(entry, path)?;
        let Some((holder, Step::Key(held))) = split_item(path) else {
            return Err(rejected(entry, path, EditRejection::NotAnItem));
        };
        let (old, landed) = self.edit_value(entry, &holder, |node| {
            let ValueMut::Map(map) = node else {
                return Err(EditRejection::NotAnItem);
            };
            if key.kind() != map.key_kind() {
                return Err(EditRejection::InvalidShape);
            }
            let at = held
                .position(map.entries())
                .ok_or(EditRejection::NotAnItem)?;
            let old = rebuild_map(map, |all| mem::replace(&mut all[at].0, key));
            Ok((old, EntryKey::of(map.entries(), at)))
        })?;
        Ok(Edit::SetKey {
            entry,
            path: format!("{holder}{landed}"),
            key: old,
        })
    }

    /// Set the pointer at `path` to `value`, answering the edit that sets it back.
    pub(super) fn swap_pointer(
        &mut self,
        entry: BinHash,
        path: &str,
        value: values::Struct,
    ) -> Result<Edit, BinDocumentError> {
        let held = self.edit_value(entry, path, |node| match node {
            ValueMut::Struct(pointer) => Ok(mem::replace(pointer, value)),
            _ => Err(EditRejection::NotAPointer),
        })?;
        Ok(Edit::SetPointer {
            entry,
            path: path.to_owned(),
            value: held,
        })
    }

    /// Run `edit` on the value at `path` under `entry` and mark the object touched where it
    /// succeeds. Both stacks are left alone.
    fn edit_value<R>(
        &mut self,
        entry: BinHash,
        path: &str,
        edit: impl FnOnce(ValueMut<'_>) -> Result<R, EditRejection>,
    ) -> Result<R, BinDocumentError> {
        let steps = parse_steps(path).ok_or_else(|| missing(entry, path))?;
        let object = self
            .file
            .objects_mut()
            .get_mut(&entry)
            .ok_or_else(|| missing(entry, path))?;
        let out = edit_node(object, &steps, edit)
            .ok_or_else(|| missing(entry, path))?
            .map_err(|rejection| rejected(entry, path, rejection))?;
        self.touched.insert(entry);
        Ok(out)
    }

    /// The class a new embed item of the holder at `holder` takes: the first one the holder
    /// holds, else the one `schema` declares for it.
    fn default_class(&self, entry: BinHash, holder: &str, schema: SchemaAt<'_>) -> Option<BinHash> {
        let object = self.file.objects().get(&entry)?;
        let steps = parse_steps(holder)?;
        let (Node::Value(value), _) = descend(object, &steps)? else {
            return None;
        };
        held_classes(value)
            .first()
            .copied()
            .or_else(|| declared_class(object, &steps, schema))
    }

    /// The node at `path` under `entry`.
    fn node(&self, entry: BinHash, path: &str) -> Result<Node<'_>, BinDocumentError> {
        let object = self.object_or_missing(entry, path)?;
        let steps = parse_steps(path).ok_or_else(|| missing(entry, path))?;
        descend(object, &steps)
            .map(|(node, _)| node)
            .ok_or_else(|| missing(entry, path))
    }

    fn object_or_missing(
        &self,
        entry: BinHash,
        path: &str,
    ) -> Result<&BinObject, BinDocumentError> {
        self.file
            .objects()
            .get(&entry)
            .ok_or_else(|| missing(entry, path))
    }
}

/// The path an edit addresses: the node it acts on, and the holder of an insert. Empty for
/// the header.
fn landing(edit: &Edit) -> &str {
    match edit {
        Edit::RemoveItem { path, .. }
        | Edit::MoveItem { path, .. }
        | Edit::SetKey { path, .. }
        | Edit::SetPointer { path, .. }
        | Edit::Leaf { path, .. }
        | Edit::ReplaceProperty { path, .. }
        | Edit::RemoveProperty { path, .. } => path,
        Edit::InsertItem { holder, .. } | Edit::InsertProperty { holder, .. } => holder,
        Edit::Dependencies { .. } => "",
    }
}

fn missing(entry: BinHash, path: &str) -> BinDocumentError {
    BinDocumentError::NodeNotFound {
        address: format!("{}:{path}", hex(entry)),
    }
}

fn rejected(entry: BinHash, path: &str, rejection: EditRejection) -> BinDocumentError {
    BinDocumentError::EditRejected {
        address: format!("{}:{path}", hex(entry)),
        rejection,
    }
}

/// The properties of `pointer` whose field `class` declares with the type its own class does.
fn shared_properties(
    pointer: &values::Struct,
    class: BinHash,
    schema: SchemaAt<'_>,
) -> IndexMap<BinHash, PropertyValueEnum> {
    let held = schema.declared_fields(pointer.class_hash);
    let next = schema.declared_fields(class);
    let declared = |fields: &[DeclaredField<'_>], field: BinHash| {
        fields
            .iter()
            .find(|declared| declared.field == field)
            .map(|declared| (declared.shape, declared.class))
    };

    pointer
        .properties
        .iter()
        .filter(|(field, _)| {
            let before = declared(&held, **field);
            before.is_some() && before == declared(&next, **field)
        })
        .map(|(field, value)| (*field, value.clone()))
        .collect()
}

/// Put `value` into the list, map or option `node` is, answering the segment that reaches it.
fn insert_into(
    node: ValueMut<'_>,
    index: Option<usize>,
    key: Option<PropertyValueEnum>,
    value: PropertyValueEnum,
) -> Result<String, EditRejection> {
    match node {
        ValueMut::Container(items)
        | ValueMut::UnorderedContainer(values::UnorderedContainer(items)) => {
            let at = index.unwrap_or(items.len());
            if at > items.len() {
                return Err(EditRejection::NoSuchIndex);
            }
            if value.kind() != items.item_kind() {
                return Err(EditRejection::InvalidShape);
            }
            rebuild_list(items, |all| all.insert(at, value));
            Ok(format!("[{at}]"))
        }
        ValueMut::Map(map) => {
            let key = key.ok_or(EditRejection::MissingKey)?;
            if key.kind() != map.key_kind() || value.kind() != map.value_kind() {
                return Err(EditRejection::InvalidShape);
            }
            let at = index.unwrap_or(map.entries().len());
            if at > map.entries().len() {
                return Err(EditRejection::NoSuchIndex);
            }
            rebuild_map(map, |all| all.insert(at, (key, value)));
            Ok(EntryKey::of(map.entries(), at).to_string())
        }
        ValueMut::Optional(optional) => {
            if optional.is_some() {
                return Err(EditRejection::ValueHeld);
            }
            optional
                .set(Some(value))
                .map_err(|_| EditRejection::InvalidShape)?;
            Ok("[0]".to_owned())
        }
        _ => Err(EditRejection::NotAList),
    }
}

/// Take the item `step` reaches out of the list, map or option `node` is, answering its
/// index, its key in a map, and the item.
fn take_from(
    node: ValueMut<'_>,
    step: &Step,
) -> Result<(usize, Option<PropertyValueEnum>, PropertyValueEnum), EditRejection> {
    match (node, step) {
        (
            ValueMut::Container(items)
            | ValueMut::UnorderedContainer(values::UnorderedContainer(items)),
            Step::Index(at),
        ) => {
            if *at >= items.len() {
                return Err(EditRejection::NoSuchIndex);
            }
            Ok((*at, None, rebuild_list(items, |all| all.remove(*at))))
        }
        (ValueMut::Map(map), Step::Key(held)) => {
            let at = held
                .position(map.entries())
                .ok_or(EditRejection::NotAnItem)?;
            let (key, value) = rebuild_map(map, |all| all.remove(at));
            Ok((at, Some(key), value))
        }
        (ValueMut::Optional(optional), Step::Index(0)) => {
            let held = optional
                .set(None)
                .map_err(|_| EditRejection::InvalidShape)?
                .ok_or(EditRejection::NotAnItem)?;
            Ok((0, None, held))
        }
        _ => Err(EditRejection::NotAnItem),
    }
}

/// Whether an entry of `map` holds `key` already.
fn holds_key(map: &values::Map, key: &PropertyValueEnum) -> bool {
    let text = wire_key(key);
    map.entries().iter().any(|(held, _)| wire_key(held) == text)
}

/// Rebuild `items` around `change`, which keeps every item the list's own kind.
fn rebuild_list<R>(
    items: &mut values::Container,
    change: impl FnOnce(&mut Vec<PropertyValueEnum>) -> R,
) -> R {
    let kind = items.item_kind();
    let mut all = mem::take(items).into_items();
    let out = change(&mut all);
    *items =
        values::Container::new(kind, all).expect("items of the list's own kind rebuild the list");
    out
}

/// Rebuild `map` around `change`, which keeps every entry the map's own kinds.
fn rebuild_map<R>(
    map: &mut values::Map,
    change: impl FnOnce(&mut Vec<(PropertyValueEnum, PropertyValueEnum)>) -> R,
) -> R {
    let (key_kind, value_kind) = (map.key_kind(), map.value_kind());
    let mut all = mem::take(map).into_entries();
    let out = change(&mut all);
    *map = values::Map::new(key_kind, value_kind, all)
        .expect("entries of the map's own kinds rebuild the map");
    out
}

/// The holder's path and the item step a path ends in, or `None` where it ends in a field
/// or reads as no path.
pub(super) fn split_item(path: &str) -> Option<(String, Step)> {
    let mut steps = parse_steps(path)?;
    match steps.pop()? {
        step @ (Step::Index(_) | Step::Key(_)) => Some((wire_path(&steps), step)),
        Step::Field(_) => None,
    }
}

/// The wire path `steps` write, as `parse_steps` reads one.
fn wire_path(steps: &[Step]) -> String {
    let mut path = String::new();
    for step in steps {
        let _ = match step {
            Step::Field(field) => write!(path, "{}{:08x}", dot(&path), field.0),
            Step::Index(index) => write!(path, "[{index}]"),
            Step::Key(held) => write!(path, "{held}"),
        };
    }
    path
}

/// A map key of `kind` as a person types it.
fn key_value(kind: Kind, text: &str) -> Result<PropertyValueEnum, EditRejection> {
    let out_of_range = EditRejection::OutOfRange { kind: kind.into() };
    let leaf = match kind {
        Kind::I8
        | Kind::U8
        | Kind::I16
        | Kind::U16
        | Kind::I32
        | Kind::U32
        | Kind::I64
        | Kind::U64 => LeafValue::Integer {
            text: text.to_owned(),
        },
        Kind::F32 => LeafValue::Float {
            value: text.trim().parse().map_err(|_| out_of_range)?,
        },
        Kind::Bool => LeafValue::Bool {
            value: text.trim().parse().map_err(|_| out_of_range)?,
        },
        Kind::String => LeafValue::String {
            value: text.to_owned(),
        },
        Kind::Hash => LeafValue::Hash {
            text: text.to_owned(),
        },
        Kind::WadChunkLink => LeafValue::WadChunkLink {
            text: text.to_owned(),
        },
        _ => return Err(EditRejection::InvalidShape),
    };
    let mut key = kind.default_value();
    set(key.as_mut(), leaf)?;
    Ok(key)
}

/// The value a new item of `kind` starts at: its class with no fields for an embed or a
/// pointer, and the kind's zero otherwise.
fn item_start(kind: Kind, class: Option<BinHash>) -> Result<PropertyValueEnum, EditRejection> {
    match kind {
        Kind::Embedded => {
            Ok(values::Embedded(empty_struct(class.ok_or(EditRejection::MissingClass)?)).into())
        }
        Kind::Struct => Ok(class
            .map_or_else(values::Struct::default, empty_struct)
            .into()),
        kind if kind.is_container() => Err(EditRejection::InvalidShape),
        kind => Ok(kind.default_value()),
    }
}

/// The classes the struct items of a list, a map or an option hold, in first-seen order.
fn held_classes(value: &PropertyValueEnum) -> Vec<BinHash> {
    let items: Box<dyn Iterator<Item = &PropertyValueEnum>> = match value {
        PropertyValueEnum::Container(items)
        | PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(items)) => {
            Box::new(items.items().iter())
        }
        PropertyValueEnum::Map(map) => Box::new(map.entries().iter().map(|(_, value)| value)),
        PropertyValueEnum::Optional(optional) => Box::new(optional.value().into_iter()),
        _ => return Vec::new(),
    };
    let mut classes = Vec::new();
    for item in items {
        let class = match item {
            PropertyValueEnum::Struct(inner) if !is_null(inner) => inner.class_hash,
            PropertyValueEnum::Embedded(values::Embedded(inner)) => inner.class_hash,
            _ => continue,
        };
        if !classes.contains(&class) {
            classes.push(class);
        }
    }
    classes
}

/// The class the schema declares for the value `steps` reach: what the field its last field
/// step names holds.
fn declared_class(object: &BinObject, steps: &[Step], schema: SchemaAt<'_>) -> Option<BinHash> {
    let at = steps
        .iter()
        .rposition(|step| matches!(step, Step::Field(_)))?;
    let Step::Field(field) = steps[at] else {
        return None;
    };
    let (owner, _) = descend(object, &steps[..at])?;
    schema.declared_field(owner.class()?, field)?.class
}

#[cfg(test)]
mod tests;
