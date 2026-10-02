//! The edits and the choice reads a frontend sends an open document, as one serialized type each.
//!
//! [`BinDocuments::apply`] routes a [`BinEdit`] to the document method of its variant behind
//! the store's one gate. ADR-0051.

use ltk_hash::BinHash;
use serde::{Deserialize, Serialize};

use super::{
    AddableFields, BinDocumentId, BinDocuments, ClassChoice, DeclaredState, LeafValue, NewItem,
    NewObject, NewProperty, PropertyEdit, ValueEdit, hex,
};
use crate::error::{AppError, AppResult};
use crate::meta_schema::SchemaAt;
use crate::object_index::parse_hash;
use crate::workshop::ModuleAction;

/// One edit of an open document, one variant per document method.
///
/// `entry` is an object's hash as `0x` and eight hex digits, and `path` a hash path (ADR-0027),
/// empty for the object itself.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum BinEdit {
    /// Set one leaf, answering [`EditOutcome::Previous`]. [`BinDocument::set_leaf`].
    Patch {
        entry: String,
        path: String,
        value: LeafValue,
    },
    /// Edit one property's subtree as one undoable change. [`BinDocument::edit_property`].
    EditProperty {
        entry: String,
        holder: String,
        field: String,
        edits: Vec<ValueEdit>,
    },
    /// Edit several properties, of one object or several, as one undoable change.
    /// [`BinDocument::edit_properties`].
    EditProperties { edits: Vec<PropertyEdit> },
    /// Add a property to the end of the holder at `path`. [`BinDocument::add_property`].
    AddProperty {
        entry: String,
        path: String,
        property: NewProperty,
    },
    /// Take the property at `path` out of its holder. [`BinDocument::remove_property`].
    RemoveProperty { entry: String, path: String },
    /// Put an item into the list, map or option at `path`, answering
    /// [`EditOutcome::Path`]. [`BinDocument::insert_item`].
    InsertItem {
        entry: String,
        path: String,
        item: NewItem,
    },
    /// Take the item at `path` out of its holder. [`BinDocument::remove_item`].
    RemoveItem { entry: String, path: String },
    /// Move the item at `path` to `to`, answering [`EditOutcome::Path`].
    /// [`BinDocument::move_item`].
    MoveItem {
        entry: String,
        path: String,
        to: usize,
    },
    /// Set the key of the map entry at `path`, answering [`EditOutcome::Path`].
    /// [`BinDocument::set_key`].
    SetKey {
        entry: String,
        path: String,
        key: String,
    },
    /// Give the null pointer at `path` a class, or set it to null where `class_name` is
    /// absent. [`BinDocument::set_pointer`].
    SetPointer {
        entry: String,
        path: String,
        class_name: Option<String>,
    },
    /// Declare the row at `path` as a game-copy reference, or with `merge` add it to the
    /// row's list or map. [`BinDocument::declare_reference`].
    DeclareReference {
        entry: String,
        path: String,
        reference: String,
        merge: bool,
    },
    /// Create, remove or restore an object of a declared document. ADR-0049.
    Object { edit: ObjectEdit },
    /// Edit the header's dependency list. ADR-0050.
    Dependency { edit: DependencyEdit },
    /// Apply a module action to the manifest of `layer`, answering [`EditOutcome::Declared`].
    /// [`BinDocument::declared_module_action`].
    ModuleAction { layer: String, action: ModuleAction },
}

/// An object edit of a declared document. ADR-0049.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum ObjectEdit {
    /// Declare a new object named `name`, answering [`EditOutcome::Object`].
    /// [`BinDocument::create_object`].
    Create { name: String, origin: NewObject },
    /// Declare the removal of `entry`. [`BinDocument::remove_object`].
    Remove { entry: String },
    /// Take back the removal of `entry`. [`BinDocument::restore_object`].
    Restore { entry: String },
}

/// An edit of the header's dependency list. ADR-0050.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum DependencyEdit {
    /// Put the dependency `text` names at `index`, the end where it is absent, answering
    /// [`EditOutcome::Index`]. [`BinDocument::insert_dependency`].
    Insert { index: Option<usize>, text: String },
    /// Take the dependency at `index` out. [`BinDocument::remove_dependency`].
    Remove { index: usize },
    /// Move the dependency at `from` to `to`. [`BinDocument::move_dependency`].
    Move { from: usize, to: usize },
    /// Replace the dependency at `index` with the one `text` names.
    /// [`BinDocument::set_dependency`].
    Set { index: usize, text: String },
    /// Take back the chosen layer's removal of `path`. [`BinDocument::restore_dependency`].
    Restore { path: String },
}

/// What a landed [`BinEdit`] answers beside the change itself.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum EditOutcome {
    /// Nothing beyond the change.
    Done,
    /// The value a patched leaf held.
    Previous { value: LeafValue },
    /// A created object's path hash, `0x` and eight hex digits.
    Object { entry: String },
    /// The path of an inserted or moved item, or of a rekeyed map entry.
    Path { path: String },
    /// The position of an inserted dependency.
    Index { index: usize },
    /// The declared state after a module action.
    Declared { state: DeclaredState },
}

/// A read of what an add line of an open document offers.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum ChoiceQuery {
    /// The fields the holder at `path` can take, answering [`Choices::Fields`].
    AddableFields { entry: String, path: String },
    /// The classes a new object can take, answering [`Choices::Classes`].
    ObjectClasses,
    /// The classes an item of the holder at `path`, or the pointer at it, can take,
    /// answering [`Choices::Classes`].
    ItemClasses { entry: String, path: String },
}

/// The answer to a [`ChoiceQuery`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum Choices {
    /// The fields a holder's class and bases declare that it does not write.
    Fields { fields: AddableFields },
    /// Classes, the ones the document holds first.
    Classes { classes: Vec<ClassChoice> },
}

/// The names an edit's reader typed, which the document draws again where no table names them.
#[derive(Debug, Default)]
struct TypedTexts {
    /// Names of objects, classes, fields and `hash` values.
    hashes: Vec<String>,
    /// Paths of chunks.
    chunks: Vec<String>,
}

impl TypedTexts {
    fn of(edit: &BinEdit) -> Self {
        let mut typed = Self::default();
        match edit {
            BinEdit::Patch { value, .. } => typed.leaf(value),
            BinEdit::EditProperty { field, edits, .. } => typed.property(field, edits),
            BinEdit::EditProperties { edits } => {
                for edit in edits {
                    typed.property(&edit.field, &edit.edits);
                }
            }
            BinEdit::AddProperty {
                property: NewProperty::Custom { field, class, .. },
                ..
            } => {
                typed.hashes.push(field.clone());
                typed.hashes.extend(class.iter().cloned());
            }
            BinEdit::InsertItem { item, .. } => {
                typed.hashes.extend(item.key.iter().cloned());
                typed.hashes.extend(item.class.iter().cloned());
            }
            BinEdit::SetKey { key, .. } => typed.hashes.push(key.clone()),
            BinEdit::SetPointer {
                class_name: Some(class),
                ..
            } => typed.hashes.push(class.clone()),
            BinEdit::Object {
                edit: ObjectEdit::Create { name, .. },
            } => typed.hashes.push(name.clone()),
            BinEdit::AddProperty { .. }
            | BinEdit::RemoveProperty { .. }
            | BinEdit::RemoveItem { .. }
            | BinEdit::MoveItem { .. }
            | BinEdit::SetPointer { .. }
            | BinEdit::DeclareReference { .. }
            | BinEdit::Object { .. }
            | BinEdit::Dependency { .. }
            | BinEdit::ModuleAction { .. } => {}
        }
        typed
    }

    fn property(&mut self, field: &str, edits: &[ValueEdit]) {
        self.hashes.push(field.to_owned());
        for each in edits {
            if let ValueEdit::SetLeaf { value, .. } = each {
                self.leaf(value);
            }
        }
    }

    fn leaf(&mut self, value: &LeafValue) {
        match value {
            LeafValue::Hash { text } | LeafValue::ObjectLink { text } => {
                self.hashes.push(text.clone());
            }
            LeafValue::WadChunkLink { text } => self.chunks.push(text.clone()),
            LeafValue::Bool { .. }
            | LeafValue::Integer { .. }
            | LeafValue::Float { .. }
            | LeafValue::Vector { .. }
            | LeafValue::Matrix { .. }
            | LeafValue::Color { .. }
            | LeafValue::String { .. } => {}
        }
    }

    fn is_empty(&self) -> bool {
        self.hashes.is_empty() && self.chunks.is_empty()
    }
}

impl BinDocuments {
    /// Apply `edit` to the document under `id` through the document method of its variant.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::ValidationFailed`] for an `entry` that is not an object hash,
    /// with [`BinDocumentError::NotOpen`] and [`BinDocumentError::ReadOnly`] from the
    /// store, and with what the variant's document method raises.
    ///
    /// [`BinDocumentError::NotOpen`]: super::BinDocumentError::NotOpen
    /// [`BinDocumentError::ReadOnly`]: super::BinDocumentError::ReadOnly
    pub fn apply(
        &self,
        id: BinDocumentId,
        edit: BinEdit,
        schema: SchemaAt<'_>,
    ) -> AppResult<EditOutcome> {
        let typed = TypedTexts::of(&edit);
        let outcome = match edit {
            BinEdit::Patch { entry, path, value } => {
                let entry = parse_entry(&entry)?;
                let value = self.edit(id, |open| open.set_leaf(entry, &path, value))?;
                EditOutcome::Previous { value }
            }
            BinEdit::EditProperty {
                entry,
                holder,
                field,
                edits,
            } => {
                let entry = parse_entry(&entry)?;
                self.edit(id, |open| {
                    open.edit_property(entry, &holder, &field, edits, schema)
                })?;
                EditOutcome::Done
            }
            BinEdit::EditProperties { edits } => {
                self.edit(id, |open| open.edit_properties(edits, schema))?;
                EditOutcome::Done
            }
            BinEdit::AddProperty {
                entry,
                path,
                property,
            } => {
                let entry = parse_entry(&entry)?;
                self.edit(id, |open| open.add_property(entry, &path, property, schema))?;
                EditOutcome::Done
            }
            BinEdit::RemoveProperty { entry, path } => {
                let entry = parse_entry(&entry)?;
                self.edit(id, |open| open.remove_property(entry, &path))?;
                EditOutcome::Done
            }
            BinEdit::InsertItem { entry, path, item } => {
                let entry = parse_entry(&entry)?;
                let path = self.edit(id, |open| open.insert_item(entry, &path, item, schema))?;
                EditOutcome::Path { path }
            }
            BinEdit::RemoveItem { entry, path } => {
                let entry = parse_entry(&entry)?;
                self.edit(id, |open| open.remove_item(entry, &path))?;
                EditOutcome::Done
            }
            BinEdit::MoveItem { entry, path, to } => {
                let entry = parse_entry(&entry)?;
                let path = self.edit(id, |open| open.move_item(entry, &path, to))?;
                EditOutcome::Path { path }
            }
            BinEdit::SetKey { entry, path, key } => {
                let entry = parse_entry(&entry)?;
                let path = self.edit(id, |open| open.set_key(entry, &path, &key))?;
                EditOutcome::Path { path }
            }
            BinEdit::SetPointer {
                entry,
                path,
                class_name,
            } => {
                let entry = parse_entry(&entry)?;
                self.edit(id, |open| {
                    open.set_pointer(entry, &path, class_name.as_deref())
                })?;
                EditOutcome::Done
            }
            BinEdit::DeclareReference {
                entry,
                path,
                reference,
                merge,
            } => {
                let entry = parse_entry(&entry)?;
                self.edit(id, |open| {
                    open.declare_reference(entry, &path, &reference, merge)
                })?;
                EditOutcome::Done
            }
            BinEdit::Object { edit } => self.apply_object(id, edit)?,
            BinEdit::Dependency { edit } => self.apply_dependency(id, edit)?,
            BinEdit::ModuleAction { layer, action } => {
                let state = self.edit(id, |open| open.declared_module_action(&layer, &action))?;
                EditOutcome::Declared { state }
            }
        };

        if !typed.is_empty() {
            let (_, document) = self.tree(id)?;
            let mut document = document.write();
            for text in &typed.hashes {
                document.typed.learn_hash(text);
            }
            for text in &typed.chunks {
                document.typed.learn_chunk(text);
            }
        }
        Ok(outcome)
    }

    /// Apply an object edit to the document under `id`.
    fn apply_object(&self, id: BinDocumentId, edit: ObjectEdit) -> AppResult<EditOutcome> {
        match edit {
            ObjectEdit::Create { name, origin } => {
                let entry = self.edit(id, |open| open.create_object(&name, &origin))?;
                Ok(EditOutcome::Object { entry: hex(entry) })
            }
            ObjectEdit::Remove { entry } => {
                let entry = parse_entry(&entry)?;
                self.edit(id, |open| open.remove_object(entry))?;
                Ok(EditOutcome::Done)
            }
            ObjectEdit::Restore { entry } => {
                let entry = parse_entry(&entry)?;
                self.edit(id, |open| open.restore_object(entry))?;
                Ok(EditOutcome::Done)
            }
        }
    }

    /// Apply a dependency edit to the document under `id`.
    fn apply_dependency(&self, id: BinDocumentId, edit: DependencyEdit) -> AppResult<EditOutcome> {
        let index = self.edit(id, |open| match edit {
            DependencyEdit::Insert { index, text } => {
                open.insert_dependency(index, &text).map(Some)
            }
            DependencyEdit::Remove { index } => open.remove_dependency(index).map(|()| None),
            DependencyEdit::Move { from, to } => open.move_dependency(from, to).map(|()| None),
            DependencyEdit::Set { index, text } => open.set_dependency(index, &text).map(|()| None),
            DependencyEdit::Restore { path } => open.restore_dependency(&path).map(|()| None),
        })?;

        Ok(index.map_or(EditOutcome::Done, |index| EditOutcome::Index { index }))
    }

    /// Answer `query` over the document under `id`, out of the meta schema at `schema`.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::ValidationFailed`] for an `entry` that is not an object hash,
    /// with [`BinDocumentError::NotOpen`] when `id` is closed, and with what the read raises.
    ///
    /// [`BinDocumentError::NotOpen`]: super::BinDocumentError::NotOpen
    pub fn choices(
        &self,
        id: BinDocumentId,
        query: ChoiceQuery,
        schema: SchemaAt<'_>,
    ) -> AppResult<Choices> {
        match query {
            ChoiceQuery::AddableFields { entry, path } => {
                let entry = parse_entry(&entry)?;
                self.read(id, |open| {
                    Ok(Choices::Fields {
                        fields: open.addable_fields(entry, &path, schema)?,
                    })
                })
            }
            ChoiceQuery::ObjectClasses => self.read(id, |open| {
                Ok(Choices::Classes {
                    classes: open.object_classes(schema),
                })
            }),
            ChoiceQuery::ItemClasses { entry, path } => {
                let entry = parse_entry(&entry)?;
                self.read(id, |open| {
                    Ok(Choices::Classes {
                        classes: open.item_classes(entry, &path, schema)?,
                    })
                })
            }
        }
    }
}

/// An object hash as `0x` and eight hex digits, or the validation failure naming the text.
pub(super) fn parse_entry(text: &str) -> AppResult<BinHash> {
    parse_hash(text)
        .ok_or_else(|| AppError::ValidationFailed(format!("Not an object hash: {text}")))
}

#[cfg(test)]
mod tests;
