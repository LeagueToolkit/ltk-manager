//! A property added to a holder or taken out of one, and the value a new one starts at.
//!
//! "What an edit is" in docs/ux/BIN_EDITOR.md. A holder is an object, an embed, or a
//! pointer struct that is not null.

use glam::Mat4;
use indexmap::IndexMap;
use ltk_hash::{BinHash, WadHash};
use ltk_meta::property::{Kind, ValueMut, values};
use ltk_meta::{BinObject, PropertyValueEnum};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::edit::{Edit, bin_hash, edit_under};
use super::{BinDocument, BinDocumentError, EditRejection, Node, Step, descend, dot, hex, is_null};
use crate::meta_schema::{KindShape, SchemaAt, Shape};

/// A property Add property writes: a field the schema declares, or one the reader shapes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum NewProperty {
    /// A field the holder's class or one of its bases declares, at its published default.
    Declared {
        /// `0x` and eight hex digits.
        field: String,
    },
    /// Any field, at its kind's zero value.
    Custom {
        /// A field name, or `0x` and eight hex digits.
        field: String,
        shape: KindShape,
        /// The class an embed holds, as a name or `0x` and eight hex digits.
        class: Option<String>,
    },
}

/// One field Add property offers for a holder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct AddableField {
    /// `0x` and eight hex digits.
    pub hash: String,
    pub name: Option<String>,
    pub shape: KindShape,
    /// What an embed or a pointer holds, or what a list's items hold, as `0x` and hex.
    pub class_hash: Option<String>,
    pub class: Option<String>,
    /// The class declaring the field, where it is a base of the holder's class.
    pub inherited_from: Option<String>,
}

/// What Add property offers for one holder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct AddableFields {
    /// The holder's class, `0x` and eight hex digits.
    pub class_hash: String,
    pub class: Option<String>,
    /// The fields the class and its bases declare that the holder does not write. Empty
    /// for a class the schema does not describe.
    pub fields: Vec<AddableField>,
}

impl BinDocument {
    /// The fields the holder at `holder` under `entry` can take, out of `schema`.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing, and
    /// with [`BinDocumentError::EditRejected`] where it reaches no holder.
    pub fn addable_fields(
        &self,
        entry: BinHash,
        holder: &str,
        schema: SchemaAt<'_>,
    ) -> Result<AddableFields, BinDocumentError> {
        let (class, written) = self.holder(entry, holder)?;
        let fields = schema
            .declared_fields(class)
            .into_iter()
            .filter(|declared| !written.contains(&declared.field))
            .map(|declared| AddableField {
                hash: hex(declared.field),
                name: declared.name.map(str::to_owned),
                shape: declared.shape.into(),
                class_hash: declared.class.map(hex),
                class: declared
                    .class
                    .and_then(|class| schema.class_name(class))
                    .map(str::to_owned),
                inherited_from: (declared.owner != class).then(|| {
                    schema
                        .class_name(declared.owner)
                        .map_or_else(|| hex(declared.owner), str::to_owned)
                }),
            })
            .collect();
        Ok(AddableFields {
            class_hash: hex(class),
            class: schema.class_name(class).map(str::to_owned),
            fields,
        })
    }

    /// Add `property` to the end of the holder at `holder` under `entry`.
    ///
    /// The edit joins the undo stack and empties the redo stack.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing, and
    /// with [`BinDocumentError::EditRejected`] where it reaches no holder, where the holder
    /// writes the field already, where `schema` declares no such field, and where a
    /// custom shape builds no value.
    pub fn add_property(
        &mut self,
        entry: BinHash,
        holder: &str,
        property: NewProperty,
        schema: SchemaAt<'_>,
    ) -> Result<(), BinDocumentError> {
        let rejected = |rejection| BinDocumentError::EditRejected {
            address: format!("{}:{holder}", hex(entry)),
            rejection,
        };
        let (class, _) = self.holder(entry, holder)?;
        let (field, value) = match property {
            NewProperty::Declared { field } => {
                let field = bin_hash(&field).map_err(rejected)?;
                let declared = schema
                    .declared_field(class, field)
                    .ok_or(EditRejection::UndeclaredField)
                    .map_err(rejected)?;
                let value = starting_value(declared.shape, declared.class, declared.default)
                    .map_err(rejected)?;
                (field, value)
            }
            NewProperty::Custom {
                field,
                shape,
                class,
            } => {
                let field = bin_hash(&field).map_err(rejected)?;
                let class = class
                    .filter(|text| !text.trim().is_empty())
                    .map(|text| bin_hash(&text))
                    .transpose()
                    .map_err(rejected)?;
                let shape: Shape = shape.into();
                /* A typed pointer names its class, where a declared one starts at the schema's default. */
                let value = match (shape.kind, class) {
                    (Kind::Struct, Some(class)) => empty_struct(class).into(),
                    _ => starting_value(shape, class, None).map_err(rejected)?,
                };
                (field, value)
            }
        };

        self.insert_property(entry, holder, field, None, value)?;
        self.record(Edit::RemoveProperty {
            entry,
            path: field_path(holder, field),
        })?;
        Ok(())
    }

    /// Take the property at `path` under `entry` out of its holder.
    ///
    /// The edit joins the undo stack, which puts the property back at its position.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing, and
    /// with [`BinDocumentError::EditRejected`] where it reaches no property of a holder.
    pub fn remove_property(&mut self, entry: BinHash, path: &str) -> Result<(), BinDocumentError> {
        self.refuse_undeclarable(entry, path)?;
        let inverse = self.take_property(entry, path)?;
        self.record(inverse)?;
        Ok(())
    }

    /// Put `value` under `field` into the holder at `holder`, at `index` or at the end.
    pub(super) fn insert_property(
        &mut self,
        entry: BinHash,
        holder: &str,
        field: BinHash,
        index: Option<usize>,
        value: PropertyValueEnum,
    ) -> Result<(), BinDocumentError> {
        let address = format!("{}:{holder}", hex(entry));
        let steps = super::parse_steps(holder).ok_or_else(|| BinDocumentError::NodeNotFound {
            address: address.clone(),
        })?;
        let object = self.file.objects_mut().get_mut(&entry).ok_or_else(|| {
            BinDocumentError::NodeNotFound {
                address: address.clone(),
            }
        })?;

        let inserted = with_holder(object, &steps, |properties| {
            if properties.contains_key(&field) {
                return false;
            }
            match index {
                Some(index) if index <= properties.len() => {
                    properties.shift_insert(index, field, value);
                }
                _ => {
                    properties.insert(field, value);
                }
            }
            true
        })
        .ok_or_else(|| BinDocumentError::NodeNotFound {
            address: address.clone(),
        })?;
        if !inserted {
            return Err(BinDocumentError::EditRejected {
                address,
                rejection: EditRejection::PropertyExists,
            });
        }
        self.touched.insert(entry);
        Ok(())
    }

    /// Take the property at `path` out of its holder, answering the edit that puts it back.
    pub(super) fn take_property(
        &mut self,
        entry: BinHash,
        path: &str,
    ) -> Result<Edit, BinDocumentError> {
        let address = || format!("{}:{path}", hex(entry));
        let not_found = || BinDocumentError::NodeNotFound { address: address() };
        let (holder, field) = split_field(path).ok_or_else(|| BinDocumentError::EditRejected {
            address: address(),
            rejection: EditRejection::NotAProperty,
        })?;
        let steps = super::parse_steps(holder).ok_or_else(not_found)?;
        let object = self
            .file
            .objects_mut()
            .get_mut(&entry)
            .ok_or_else(not_found)?;

        let (index, _, value) = with_holder(object, &steps, |properties| {
            properties.shift_remove_full(&field)
        })
        .flatten()
        .ok_or_else(not_found)?;
        self.touched.insert(entry);
        Ok(Edit::InsertProperty {
            entry,
            holder: holder.to_owned(),
            field,
            index,
            value,
        })
    }

    /// The class of the holder at `holder` under `entry`, and the fields it writes.
    fn holder(
        &self,
        entry: BinHash,
        holder: &str,
    ) -> Result<(BinHash, Vec<BinHash>), BinDocumentError> {
        let address = || format!("{}:{holder}", hex(entry));
        let not_found = || BinDocumentError::NodeNotFound { address: address() };
        let object = self.file.objects().get(&entry).ok_or_else(not_found)?;
        let steps = super::parse_steps(holder).ok_or_else(not_found)?;
        let (node, _) = descend(object, &steps).ok_or_else(not_found)?;
        let not_holder = || BinDocumentError::EditRejected {
            address: address(),
            rejection: EditRejection::NotAHolder,
        };
        let properties = node.properties().ok_or_else(not_holder)?;
        let class = Node::class(node).ok_or_else(not_holder)?;
        Ok((class, properties.keys().copied().collect()))
    }
}

/// The wire path of `field` under the holder at `holder`.
pub(super) fn field_path(holder: &str, field: BinHash) -> String {
    format!("{holder}{}{:08x}", dot(holder), field.0)
}

/// The holder's path and the field of a property's path, or `None` where the last step
/// is no field.
fn split_field(path: &str) -> Option<(&str, BinHash)> {
    let steps = super::parse_steps(path)?;
    let Some(Step::Field(field)) = steps.last() else {
        return None;
    };
    let holder = path.get(..path.len().checked_sub(8)?)?;
    let holder = holder.strip_suffix('.').unwrap_or(holder);
    Some((holder, *field))
}

/// Run `edit` on the properties of the holder `steps` reach under `object`, or `None`
/// where the steps reach no holder.
pub(super) fn with_holder<R>(
    object: &mut BinObject,
    steps: &[Step],
    edit: impl FnOnce(&mut IndexMap<BinHash, PropertyValueEnum>) -> R,
) -> Option<R> {
    let Some((first, rest)) = steps.split_first() else {
        return Some(edit(&mut object.properties));
    };
    let Step::Field(field) = first else {
        return None;
    };
    edit_under(
        object.properties.get_mut(field)?.as_mut(),
        rest,
        |node| match node {
            ValueMut::Embedded(values::Embedded(inner)) => Some(edit(&mut inner.properties)),
            ValueMut::Struct(inner) if !is_null(inner) => Some(edit(&mut inner.properties)),
            _ => None,
        },
    )
    .flatten()
}

/// The value a field of `shape` starts at: `default` where it converts, and the kind's
/// zero value where it does not.
///
/// An embed and a pointer start as their class with no fields, which the game reads as
/// every field at its default. A fixed-size list of embeds starts as that many.
pub(super) fn starting_value(
    shape: Shape,
    class: Option<BinHash>,
    default: Option<&Value>,
) -> Result<PropertyValueEnum, EditRejection> {
    let default = default.filter(|value| !value.is_null());
    match shape.kind {
        Kind::Embedded => {
            let class = class.ok_or(EditRejection::MissingClass)?;
            Ok(values::Embedded(empty_struct(class)).into())
        }
        Kind::Struct => Ok(match (class, default) {
            (Some(class), Some(Value::Object(_))) => empty_struct(class).into(),
            _ => values::Struct::default().into(),
        }),
        Kind::Container | Kind::UnorderedContainer => {
            let item = shape.value.ok_or(EditRejection::InvalidShape)?;
            let items = match default {
                Some(Value::Array(items)) => items
                    .iter()
                    .map(|each| item_value(item, class, each))
                    .collect::<Option<Vec<_>>>()
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            let items =
                values::Container::new(item, items).map_err(|_| EditRejection::InvalidShape)?;
            Ok(if shape.kind == Kind::Container {
                items.into()
            } else {
                values::UnorderedContainer(items).into()
            })
        }
        Kind::Optional => {
            let item = shape.value.ok_or(EditRejection::InvalidShape)?;
            let held = default.and_then(|value| leaf_value(item, value));
            Ok(values::Optional::new(item, held)
                .map_err(|_| EditRejection::InvalidShape)?
                .into())
        }
        Kind::Map => {
            let (key, value) = shape
                .key
                .zip(shape.value)
                .ok_or(EditRejection::InvalidShape)?;
            let entries = match default {
                Some(Value::Object(entries)) => entries
                    .iter()
                    .map(|(each, held)| {
                        Some((
                            leaf_value(key, &Value::String(each.clone()))?,
                            item_value(value, class, held)?,
                        ))
                    })
                    .collect::<Option<Vec<_>>>()
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            Ok(values::Map::new(key, value, entries)
                .map_err(|_| EditRejection::InvalidShape)?
                .into())
        }
        leaf => Ok(default
            .and_then(|value| leaf_value(leaf, value))
            .unwrap_or_else(|| leaf.default_value())),
    }
}

/// An item of a container or a map as `value` writes it, or `None` where it does not
/// convert.
fn item_value(kind: Kind, class: Option<BinHash>, value: &Value) -> Option<PropertyValueEnum> {
    match kind {
        Kind::Embedded | Kind::Struct => starting_value(Shape::bare(kind), class, Some(value)).ok(),
        _ => leaf_value(kind, value),
    }
}

pub(super) fn empty_struct(class: BinHash) -> values::Struct {
    values::Struct {
        class_hash: class,
        properties: IndexMap::new(),
    }
}

/// A leaf of `kind` as the database writes its default, or `None` where it does not
/// convert.
fn leaf_value(kind: Kind, value: &Value) -> Option<PropertyValueEnum> {
    let number = |value: &Value| value.as_f64().filter(|number| number.is_finite());
    let floats = |value: &Value| -> Option<Vec<f32>> {
        value
            .as_array()?
            .iter()
            .map(|each| number(each).map(|number| number as f32))
            .collect()
    };
    let hash = |value: &Value| -> Option<u64> {
        let digits = value.as_str()?.strip_prefix("0x")?;
        u64::from_str_radix(digits, 16).ok()
    };

    Some(match kind {
        Kind::None => values::None.into(),
        Kind::Bool => values::Bool::new(value.as_bool()?).into(),
        Kind::BitBool => values::BitBool::new(value.as_bool()?).into(),
        Kind::I8 => values::I8::new(i8::try_from(value.as_i64()?).ok()?).into(),
        Kind::U8 => values::U8::new(u8::try_from(value.as_u64()?).ok()?).into(),
        Kind::I16 => values::I16::new(i16::try_from(value.as_i64()?).ok()?).into(),
        Kind::U16 => values::U16::new(u16::try_from(value.as_u64()?).ok()?).into(),
        Kind::I32 => values::I32::new(i32::try_from(value.as_i64()?).ok()?).into(),
        Kind::U32 => values::U32::new(u32::try_from(value.as_u64()?).ok()?).into(),
        Kind::I64 => values::I64::new(value.as_i64()?).into(),
        Kind::U64 => values::U64::new(value.as_u64()?).into(),
        Kind::F32 => values::F32::new(number(value)? as f32).into(),
        Kind::Vector2 => {
            values::Vector2::new(glam::Vec2::from_slice(floats(value)?.get(..2)?)).into()
        }
        Kind::Vector3 => {
            values::Vector3::new(glam::Vec3::from_slice(floats(value)?.get(..3)?)).into()
        }
        Kind::Vector4 => {
            values::Vector4::new(glam::Vec4::from_slice(floats(value)?.get(..4)?)).into()
        }
        Kind::Matrix44 => {
            let rows = value.as_array()?;
            let mut cells = Vec::with_capacity(16);
            for row in rows {
                cells.extend(floats(row)?);
            }
            let cells: [f32; 16] = cells.try_into().ok()?;
            /* Row-major, as the row projection writes a matrix. */
            values::Matrix44::new(Mat4::from_cols_array(&cells).transpose()).into()
        }
        Kind::Color => {
            let channels = value
                .as_array()?
                .iter()
                .map(|each| u8::try_from(each.as_u64()?).ok())
                .collect::<Option<Vec<_>>>()?;
            let [r, g, b, a] = channels[..] else {
                return None;
            };
            let mut color = values::Color::default();
            color.value.r = r;
            color.value.g = g;
            color.value.b = b;
            color.value.a = a;
            color.into()
        }
        Kind::String => values::String::new(value.as_str()?.to_owned()).into(),
        Kind::Hash => values::Hash::new(BinHash(u32::try_from(hash(value)?).ok()?)).into(),
        Kind::ObjectLink => {
            values::ObjectLink::new(BinHash(u32::try_from(hash(value)?).ok()?)).into()
        }
        Kind::WadChunkLink => values::WadChunkLink::new(WadHash(hash(value)?)).into(),
        _ => return None,
    })
}

#[cfg(test)]
mod tests;
