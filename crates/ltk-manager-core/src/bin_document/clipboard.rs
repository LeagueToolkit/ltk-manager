//! A value copied out of an open bin as clipboard text, and an item landed from a copy.
//!
//! The text is JSON under [`CLIPBOARD_FORMAT`], so a paste tells it from any other clipboard
//! text and reads every hash, class and link back exactly, in this document or another.

use std::collections::HashSet;

use ltk_hash::BinHash;
use ltk_meta::PropertyValueEnum;
use ltk_meta::property::values;
use serde::{Deserialize, Serialize};

use super::edit::{Edit, LeafValue};
use super::items::{declared_class, held_classes};
use super::properties::field_path;
use super::requests::parse_entry;
use super::{
    BinDocument, BinDocumentError, BinDocumentId, BinDocuments, EditRejection, Step, as_list,
    as_struct, hex, is_null, parse_steps,
};
use crate::error::AppResult;
use crate::meta_schema::SchemaAt;

/// The `format` the clipboard text of a copied value carries.
pub const CLIPBOARD_FORMAT: &str = "ltk-manager/bin-value";

/// The version of the clipboard text's shape.
const CLIPBOARD_VERSION: u32 = 1;

/// What a name made unique ends in, before its counter.
const COPY_SUFFIX: &str = "_copy";

/// The clipboard text of one copied value.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Copied {
    /// [`CLIPBOARD_FORMAT`].
    format: String,
    version: u32,
    /// The class of a struct value, where the schema names it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    class: Option<String>,
    /// The class of a struct value, `0x` and eight hex digits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    class_hash: Option<String>,
    value: PropertyValueEnum,
}

impl BinDocuments {
    /// The value at `path` under the object `entry` of the document under `id`, as
    /// clipboard text.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::ValidationFailed`] for an `entry` that is not an object hash,
    /// with [`BinDocumentError::NotOpen`] when `id` is closed, and with
    /// [`BinDocumentError::NodeNotFound`] where the path reaches no value.
    ///
    /// [`AppError::ValidationFailed`]: crate::error::AppError::ValidationFailed
    pub fn copy_value(
        &self,
        id: BinDocumentId,
        entry: &str,
        path: &str,
        schema: SchemaAt<'_>,
    ) -> AppResult<String> {
        let entry = parse_entry(entry)?;
        self.read(id, |open| Ok(open.copy_value(entry, path, schema)?))
    }
}

impl BinDocument {
    /// The value at `path` under `entry` as clipboard text.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches no value.
    pub fn copy_value(
        &self,
        entry: BinHash,
        path: &str,
        schema: SchemaAt<'_>,
    ) -> Result<String, BinDocumentError> {
        let value = self.property_value(entry, path)?;
        let class = as_struct(value).and_then(|inner| schema.class_name(inner.class_hash));

        Ok(clipboard_text(value, class))
    }

    /// Put a copy of the item at `from` into the list at `holder`, answering the copy's path.
    ///
    /// `unique` is a string field of the copy whose text [`BinDocument::unique_name`] makes
    /// unique. Both stacks are left alone, so the caller records the edit.
    pub(super) fn copy_item(
        &mut self,
        entry: BinHash,
        from: &str,
        holder: &str,
        index: Option<usize>,
        unique: Option<BinHash>,
    ) -> Result<String, BinDocumentError> {
        let value = self.property_value(entry, from)?.clone();
        self.land_item(entry, holder, index, value, unique)
    }

    /// Put the value clipboard `text` carries into the list at `holder`, answering its path.
    ///
    /// A struct value lands only where the holder takes its class: a class an item holds,
    /// the one `schema` declares for the holder, or one deriving from it. Both stacks are
    /// left alone, as in [`BinDocument::copy_item`].
    pub(super) fn paste_item(
        &mut self,
        entry: BinHash,
        holder: &str,
        index: Option<usize>,
        text: &str,
        unique: Option<BinHash>,
        schema: SchemaAt<'_>,
    ) -> Result<String, BinDocumentError> {
        let refuse = |rejection| BinDocumentError::EditRejected {
            address: format!("{}:{holder}", hex(entry)),
            rejection,
        };
        let value = parse_copied(text).map_err(refuse)?;
        if !self.takes_class(entry, holder, &value, schema)? {
            return Err(refuse(EditRejection::ForeignClass));
        }

        self.land_item(entry, holder, index, value, unique)
    }

    fn land_item(
        &mut self,
        entry: BinHash,
        holder: &str,
        index: Option<usize>,
        value: PropertyValueEnum,
        unique: Option<BinHash>,
    ) -> Result<String, BinDocumentError> {
        let Edit::RemoveItem { path, .. } = self.put_item(entry, holder, index, None, value)?
        else {
            unreachable!("an insert is reverted by a removal");
        };
        if let Some(field) = unique {
            self.unique_name(entry, &path, field)?;
        }

        Ok(path)
    }

    /// Rename the string `field` of the struct at `item` apart from every other struct item
    /// of the object's lists that holds `field`.
    ///
    /// A text no other item holds stays. A taken one gains `_copy`, then `_copy2` and on,
    /// after any such suffix it carries. A struct without `field` keeps none.
    fn unique_name(
        &mut self,
        entry: BinHash,
        item: &str,
        field: BinHash,
    ) -> Result<(), BinDocumentError> {
        let path = field_path(item, field);
        let Ok(PropertyValueEnum::String(held)) = self.property_value(entry, &path) else {
            return Ok(());
        };
        let object = self
            .object_at(entry)
            .expect("the object holds the item just landed");
        let taken = names_beside(object, item, field);
        let name = unique_text(&held.value, &taken);
        if name == held.value {
            return Ok(());
        }

        self.apply_leaf(entry, &path, LeafValue::String { value: name })?;
        Ok(())
    }

    /// Whether the holder at `holder` takes an item of `value`'s class. A value that is no
    /// struct is left to the insert's own kind check.
    fn takes_class(
        &self,
        entry: BinHash,
        holder: &str,
        value: &PropertyValueEnum,
        schema: SchemaAt<'_>,
    ) -> Result<bool, BinDocumentError> {
        let Some(class) = as_struct(value).map(|inner| inner.class_hash) else {
            return Ok(true);
        };
        let held = held_classes(self.property_value(entry, holder)?);
        if held.contains(&class) {
            return Ok(true);
        }

        let object = self
            .object_at(entry)
            .expect("the holder was read from the object");
        let steps = parse_steps(holder).unwrap_or_default();
        Ok(match declared_class(object, &steps, schema) {
            Some(declared) => {
                declared == class || schema.derived_classes(declared).contains(&class)
            }
            None => held.is_empty(),
        })
    }
}

/// `value` as clipboard text, its struct's class named `class` where a name is known.
pub fn clipboard_text(value: &PropertyValueEnum, class: Option<&str>) -> String {
    let copied = Copied {
        format: CLIPBOARD_FORMAT.to_owned(),
        version: CLIPBOARD_VERSION,
        class: class.map(str::to_owned),
        class_hash: as_struct(value).map(|inner| hex(inner.class_hash)),
        value: value.clone(),
    };

    serde_json::to_string_pretty(&copied).expect("a bin value serializes with string keys only")
}

/// The value clipboard `text` carries, and `None` for text that is no sound copy.
pub fn clipboard_value(text: &str) -> Option<PropertyValueEnum> {
    parse_copied(text).ok()
}

/// The value clipboard `text` carries, rebuilt through the checked constructors.
fn parse_copied(text: &str) -> Result<PropertyValueEnum, EditRejection> {
    let copied: Copied = serde_json::from_str(text.trim()).map_err(|_| EditRejection::NotACopy)?;
    if copied.format != CLIPBOARD_FORMAT || copied.version != CLIPBOARD_VERSION {
        return Err(EditRejection::NotACopy);
    }

    checked(copied.value)
}

/// `value` with every list, map and option rebuilt, which refuses one whose items do not
/// match the kinds it declares. Deserializing trusts the text's kinds.
fn checked(value: PropertyValueEnum) -> Result<PropertyValueEnum, EditRejection> {
    let shape = |_| EditRejection::InvalidShape;
    Ok(match value {
        PropertyValueEnum::Container(items) => checked_list(items)?.into(),
        PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(items)) => {
            values::UnorderedContainer(checked_list(items)?).into()
        }
        PropertyValueEnum::Map(map) => {
            let (key_kind, value_kind) = (map.key_kind(), map.value_kind());
            let entries = map
                .into_entries()
                .into_iter()
                .map(|(key, value)| Ok((checked(key)?, checked(value)?)))
                .collect::<Result<_, EditRejection>>()?;
            values::Map::new(key_kind, value_kind, entries)
                .map_err(shape)?
                .into()
        }
        PropertyValueEnum::Optional(optional) => {
            let kind = optional.item_kind();
            let value = optional.into_inner().map(checked).transpose()?;
            values::Optional::new(kind, value).map_err(shape)?.into()
        }
        PropertyValueEnum::Struct(inner) => checked_struct(inner)?.into(),
        PropertyValueEnum::Embedded(values::Embedded(inner)) => {
            values::Embedded(checked_struct(inner)?).into()
        }
        leaf => leaf,
    })
}

fn checked_list(items: values::Container) -> Result<values::Container, EditRejection> {
    let kind = items.item_kind();
    let items = items
        .into_items()
        .into_iter()
        .map(checked)
        .collect::<Result<_, _>>()?;
    values::Container::new(kind, items).map_err(|_| EditRejection::InvalidShape)
}

fn checked_struct(inner: values::Struct) -> Result<values::Struct, EditRejection> {
    if is_null(&inner) && !inner.properties.is_empty() {
        return Err(EditRejection::InvalidShape);
    }

    let properties = inner
        .properties
        .into_iter()
        .map(|(field, value)| Ok((field, checked(value)?)))
        .collect::<Result<_, EditRejection>>()?;
    Ok(values::Struct {
        class_hash: inner.class_hash,
        properties,
    })
}

/// The texts every struct item of the object's lists holds under `field`, but the one at
/// the hash path `item`.
fn names_beside<'a>(
    object: &'a ltk_meta::BinObject,
    item: &str,
    field: BinHash,
) -> HashSet<&'a str> {
    let own = match parse_steps(item).as_deref() {
        Some([Step::Field(list), Step::Index(at)]) => Some((*list, *at)),
        _ => None,
    };

    let mut taken = HashSet::new();
    for (list, value) in &object.properties {
        let Some(items) = as_list(value) else {
            continue;
        };
        for (at, each) in items.iter().enumerate() {
            if own == Some((*list, at)) {
                continue;
            }
            let Some(inner) = as_struct(each) else {
                continue;
            };
            if let Some(PropertyValueEnum::String(text)) = inner.properties.get(&field) {
                taken.insert(text.value.as_str());
            }
        }
    }
    taken
}

/// `text`, or the first of `stem_copy`, `stem_copy2` and on that `taken` lacks, where
/// `stem` is `text` without a copy suffix.
fn unique_text(text: &str, taken: &HashSet<&str>) -> String {
    if !taken.contains(text) {
        return text.to_owned();
    }

    let stem = copy_stem(text);
    let mut counter = 1_usize;
    loop {
        let candidate = if counter == 1 {
            format!("{stem}{COPY_SUFFIX}")
        } else {
            format!("{stem}{COPY_SUFFIX}{counter}")
        };
        if !taken.contains(candidate.as_str()) {
            return candidate;
        }
        counter += 1;
    }
}

/// `text` without a trailing `_copy` or `_copy` and digits.
fn copy_stem(text: &str) -> &str {
    let Some(at) = text.rfind(COPY_SUFFIX) else {
        return text;
    };
    let counter = &text[at + COPY_SUFFIX.len()..];
    if counter.bytes().all(|byte| byte.is_ascii_digit()) {
        &text[..at]
    } else {
        text
    }
}

#[cfg(test)]
mod tests;
