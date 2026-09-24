//! Atomic edits inside one property, with schema defaults for missing fields.

use std::collections::VecDeque;

use indexmap::IndexSet;
use ltk_hash::BinHash;
use ltk_meta::{Bin, BinFile, PropertyValueEnum};
use serde::{Deserialize, Serialize};

use super::edit::Edit;
use super::properties::{field_path, with_holder};
use super::{
    BinDocument, BinDocumentError, BinDocumentId, BinDocuments, EditRejection, LeafValue, NewItem,
    NewProperty, Node, Step, descend, hex, parse_steps,
};
use crate::meta_schema::SchemaAt;
use crate::object_index::parse_hash;

/// The bound on staged operations in one document mutation.
const MAX_PROPERTY_EDITS: usize = 64;

/// One staged edit, addressed relative to its enclosing property.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS, specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ValueEdit {
    /// Add a missing schema field at its published default.
    EnsureProperty { path: String, field: String },
    /// Give a null pointer its class. A non-null pointer retains its fields.
    EnsurePointer { path: String, class: String },
    /// Swap a pointer's class, keeping the fields both classes declare with one type. A
    /// null class clears the pointer.
    ReplacePointer { path: String, class: Option<String> },
    /// Insert an item into a list, map or option.
    InsertItem { path: String, item: NewItem },
    /// Remove an item from a list, map or option.
    RemoveItem { path: String },
    /// Set an existing leaf, including one created by an earlier staged edit.
    SetLeaf { path: String, value: LeafValue },
}

impl BinDocuments {
    /// Edit one property atomically, creating it from the schema when absent.
    ///
    /// # Errors
    ///
    /// Refuses closed or read-only documents, invalid edits, and declaration write failures.
    pub fn edit_property(
        &self,
        id: BinDocumentId,
        entry: BinHash,
        holder: &str,
        field: &str,
        edits: Vec<ValueEdit>,
        schema: SchemaAt<'_>,
    ) -> Result<(), BinDocumentError> {
        self.edit(id, |document| {
            document.edit_property(entry, holder, field, edits, schema)
        })
    }
}

impl BinDocument {
    /// Stage edits under one property and record the result as one undoable change.
    ///
    /// # Errors
    ///
    /// Invalid paths, missing schema fields, incompatible values, or failed declarations leave no edit.
    pub fn edit_property(
        &mut self,
        entry: BinHash,
        holder: &str,
        field: &str,
        edits: Vec<ValueEdit>,
        schema: SchemaAt<'_>,
    ) -> Result<(), BinDocumentError> {
        let field = parse_hash(field)
            .ok_or_else(|| refused(entry, holder, EditRejection::MalformedHash))?;
        let scope = field_path(holder, field);
        if edits.is_empty() || edits.len() > MAX_PROPERTY_EDITS {
            return Err(refused(entry, &scope, EditRejection::InvalidShape));
        }

        let object = self
            .object_at(entry)
            .ok_or_else(|| missing(entry, holder))?
            .clone();
        let mut staged = Self {
            file: BinFile::Prop(Bin::new([object], std::iter::empty::<&str>())),
            base: Vec::new(),
            touched: IndexSet::new(),
            dependencies_touched: false,
            undo: VecDeque::new(),
            redo: Vec::new(),
            declared: None,
        };
        staged.ensure_property(entry, holder, field, schema)?;

        for edit in edits {
            match edit {
                ValueEdit::EnsureProperty { path, field } => {
                    let path = relative_path(&scope, &path);
                    let field = parse_hash(&field)
                        .ok_or_else(|| refused(entry, &path, EditRejection::MalformedHash))?;
                    staged.ensure_property(entry, &path, field, schema)?;
                }
                ValueEdit::EnsurePointer { path, class } => {
                    let path = relative_path(&scope, &path);
                    let class_hash =
                        super::edit::bin_hash(&class).map_err(|why| refused(entry, &path, why))?;
                    match staged.property_value(entry, &path)? {
                        PropertyValueEnum::Struct(value) if value.class_hash.0 == 0 => {
                            staged.set_pointer(entry, &path, Some(&class))?
                        }
                        PropertyValueEnum::Struct(value) if value.class_hash == class_hash => {}
                        _ => return Err(refused(entry, &path, EditRejection::NotAPointer)),
                    }
                }
                ValueEdit::ReplacePointer { path, class } => {
                    let path = relative_path(&scope, &path);
                    staged.replace_pointer(entry, &path, class.as_deref(), schema)?;
                }
                ValueEdit::InsertItem { path, item } => {
                    staged.insert_item(entry, &relative_path(&scope, &path), item, schema)?;
                }
                ValueEdit::RemoveItem { path } => {
                    staged.remove_item(entry, &relative_path(&scope, &path))?;
                }
                ValueEdit::SetLeaf { path, value } => {
                    staged.set_leaf(entry, &relative_path(&scope, &path), value)?;
                }
            }
        }

        let next = staged.property_value(entry, &scope)?.clone();
        let inverse = if self.property_value(entry, &scope).is_ok() {
            self.swap_property(entry, &scope, next)?
        } else {
            self.insert_property(entry, holder, field, None, next)?;
            Edit::RemoveProperty { entry, path: scope }
        };
        self.record(inverse)
    }

    fn ensure_property(
        &mut self,
        entry: BinHash,
        holder: &str,
        field: BinHash,
        schema: SchemaAt<'_>,
    ) -> Result<(), BinDocumentError> {
        if self
            .property_value(entry, &field_path(holder, field))
            .is_err()
        {
            self.add_property(
                entry,
                holder,
                NewProperty::Declared { field: hex(field) },
                schema,
            )?;
        }

        Ok(())
    }

    fn property_value(
        &self,
        entry: BinHash,
        path: &str,
    ) -> Result<&PropertyValueEnum, BinDocumentError> {
        let steps = parse_steps(path).ok_or_else(|| missing(entry, path))?;
        let object = self.object_at(entry).ok_or_else(|| missing(entry, path))?;
        match descend(object, &steps) {
            Some((Node::Value(value), _)) => Ok(value),
            _ => Err(missing(entry, path)),
        }
    }

    pub(super) fn swap_property(
        &mut self,
        entry: BinHash,
        path: &str,
        value: PropertyValueEnum,
    ) -> Result<Edit, BinDocumentError> {
        let mut steps = parse_steps(path).ok_or_else(|| missing(entry, path))?;
        let Some(Step::Field(field)) = steps.pop() else {
            return Err(refused(entry, path, EditRejection::NotAProperty));
        };
        let object = self
            .file
            .objects_mut()
            .get_mut(&entry)
            .ok_or_else(|| missing(entry, path))?;
        let previous = with_holder(object, &steps, |properties| {
            properties
                .get_mut(&field)
                .map(|held| std::mem::replace(held, value))
        })
        .flatten()
        .ok_or_else(|| missing(entry, path))?;
        self.touched.insert(entry);

        Ok(Edit::ReplaceProperty {
            entry,
            path: path.to_owned(),
            value: previous,
        })
    }
}

fn relative_path(scope: &str, path: &str) -> String {
    if path.is_empty() || path.starts_with(['[', '{']) {
        return format!("{scope}{path}");
    }

    format!("{scope}.{path}")
}

fn missing(entry: BinHash, path: &str) -> BinDocumentError {
    BinDocumentError::NodeNotFound {
        address: format!("{}:{path}", hex(entry)),
    }
}

fn refused(entry: BinHash, path: &str, rejection: EditRejection) -> BinDocumentError {
    BinDocumentError::EditRejected {
        address: format!("{}:{path}", hex(entry)),
        rejection,
    }
}
