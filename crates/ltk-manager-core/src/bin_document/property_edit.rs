//! Atomic edits inside one property, with schema defaults for missing fields.

use std::collections::VecDeque;

use indexmap::IndexSet;
use ltk_hash::BinHash;
use ltk_meta::{Bin, BinFile, PropertyValueEnum};
use serde::{Deserialize, Serialize};

use super::edit::Edit;
use super::properties::{field_path, with_holder};
use super::typed_names::TypedNames;
use super::{
    BinDocument, BinDocumentError, EditRejection, LeafValue, NewItem, NewProperty, Node, Step,
    descend, hex, parse_steps,
};
use crate::meta_schema::SchemaAt;
use crate::object_index::parse_hash;

/// The bound on staged operations in one document mutation.
const MAX_PROPERTY_EDITS: usize = 64;
/// The bound on properties one grouped edit changes.
const MAX_GROUPED_PROPERTIES: usize = 512;

/// One property's staged edits, as [`BinDocument::edit_properties`] groups them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct PropertyEdit {
    /// The object, as `0x` and eight hex digits.
    pub entry: String,
    pub holder: String,
    pub field: String,
    pub edits: Vec<ValueEdit>,
}

/// One staged edit, addressed relative to its enclosing property.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
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
    /// Insert a copy of the item at `from` into the list at `path`, at `index` or the end.
    /// `unique` names a string field whose text the copy makes unique among the object's
    /// list items.
    CopyItem {
        from: String,
        path: String,
        index: Option<usize>,
        unique: Option<String>,
    },
    /// Insert the value clipboard `text` carries into the list at `path`, at `index` or the
    /// end, with `unique` as for [`ValueEdit::CopyItem`].
    PasteItem {
        path: String,
        index: Option<usize>,
        text: String,
        unique: Option<String>,
    },
    /// Remove an item from a list, map or option.
    RemoveItem { path: String },
    /// Set an existing leaf, including one created by an earlier staged edit. An empty
    /// option takes an item first, so the edit writes an optional field whatever it holds.
    SetLeaf { path: String, value: LeafValue },
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
        let inverse = self.change_property(entry, holder, field, edits, schema)?;
        self.record(inverse)
    }

    /// Stage edits under several properties and record them as one undoable change. A
    /// declared document folds their declarations into one step. A refusal leaves none.
    ///
    /// # Errors
    ///
    /// As [`BinDocument::edit_property`], and an entry that is not an object hash.
    pub fn edit_properties(
        &mut self,
        edits: Vec<PropertyEdit>,
        schema: SchemaAt<'_>,
    ) -> Result<(), BinDocumentError> {
        if edits.is_empty() || edits.len() > MAX_GROUPED_PROPERTIES {
            return Err(BinDocumentError::EditRejected {
                address: String::new(),
                rejection: EditRejection::InvalidShape,
            });
        }

        if self.declares() {
            return self.declared_group(|document| {
                edits.into_iter().try_for_each(|edit| {
                    let entry = entry_of(&edit)?;
                    document.edit_property(entry, &edit.holder, &edit.field, edit.edits, schema)
                })
            });
        }

        let mut inverses = Vec::with_capacity(edits.len());
        for edit in edits {
            let changed = entry_of(&edit).and_then(|entry| {
                self.change_property(entry, &edit.holder, &edit.field, edit.edits, schema)
            });
            match changed {
                Ok(inverse) => inverses.push(inverse),
                Err(error) => {
                    for inverse in inverses.into_iter().rev() {
                        self.apply(inverse)?;
                    }
                    return Err(error);
                }
            }
        }

        inverses.reverse();
        self.record(Edit::Group { edits: inverses })
    }

    /// Apply the staged edits under one property, answering the edit that reverts them.
    fn change_property(
        &mut self,
        entry: BinHash,
        holder: &str,
        field: &str,
        edits: Vec<ValueEdit>,
        schema: SchemaAt<'_>,
    ) -> Result<Edit, BinDocumentError> {
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
            opened: Vec::new(),
            touched: IndexSet::new(),
            dependencies_touched: false,
            undo: VecDeque::new(),
            redo: Vec::new(),
            declared: None,
            typed: TypedNames::default(),
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
                ValueEdit::CopyItem {
                    from,
                    path,
                    index,
                    unique,
                } => {
                    let path = relative_path(&scope, &path);
                    let unique = unique_field(entry, &path, unique.as_deref())?;
                    staged.copy_item(entry, &relative_path(&scope, &from), &path, index, unique)?;
                }
                ValueEdit::PasteItem {
                    path,
                    index,
                    text,
                    unique,
                } => {
                    let path = relative_path(&scope, &path);
                    let unique = unique_field(entry, &path, unique.as_deref())?;
                    staged.paste_item(entry, &path, index, &text, unique, schema)?;
                }
                ValueEdit::RemoveItem { path } => {
                    staged.remove_item(entry, &relative_path(&scope, &path))?;
                }
                ValueEdit::SetLeaf { path, value } => {
                    let path = relative_path(&scope, &path);
                    if staged.holds_empty_option(entry, &path) {
                        staged.insert_item(entry, &path, NewItem::default(), schema)?;
                    }

                    staged.set_leaf(entry, &path, value)?;
                }
            }
        }

        let next = staged.property_value(entry, &scope)?.clone();
        if self.property_value(entry, &scope).is_ok() {
            return self.swap_property(entry, &scope, next);
        }

        self.insert_property(entry, holder, field, None, next)?;
        Ok(Edit::RemoveProperty { entry, path: scope })
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

    fn holds_empty_option(&self, entry: BinHash, path: &str) -> bool {
        matches!(
            self.property_value(entry, path),
            Ok(PropertyValueEnum::Optional(optional)) if optional.is_none()
        )
    }

    pub(super) fn property_value(
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

/// The field `unique` names as `0x` and eight hex digits.
fn unique_field(
    entry: BinHash,
    path: &str,
    unique: Option<&str>,
) -> Result<Option<BinHash>, BinDocumentError> {
    unique
        .map(|text| {
            parse_hash(text).ok_or_else(|| refused(entry, path, EditRejection::MalformedHash))
        })
        .transpose()
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

fn entry_of(edit: &PropertyEdit) -> Result<BinHash, BinDocumentError> {
    parse_hash(&edit.entry).ok_or_else(|| BinDocumentError::EditRejected {
        address: edit.entry.clone(),
        rejection: EditRejection::MalformedHash,
    })
}

fn refused(entry: BinHash, path: &str, rejection: EditRejection) -> BinDocumentError {
    BinDocumentError::EditRejected {
        address: format!("{}:{path}", hex(entry)),
        rejection,
    }
}
