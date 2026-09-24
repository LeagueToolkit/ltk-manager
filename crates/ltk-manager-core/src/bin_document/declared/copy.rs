//! A row as the declaration and the reference an author would write for it, and a reference
//! declared in its place. "Declaring from a game bin" in docs/ux/BIN_EDITOR.md.

use indexmap::IndexMap;
use ltk_declarations::{Edit as ManifestEdit, ModuleChoice, Operation, ValueText};
use ltk_game_data::{Reference, Value};
use ltk_hash::BinHash;
use ltk_meta::PropertyValueEnum;
use ltk_meta::path::{FieldNames as _, MapKey, PropertyPath, ValuePath};
use ltk_meta::property::values;
use ltk_meta::walk::TreeValue as _;
use serde::Serialize;

use super::super::{
    BinDocument, BinDocumentError, EditRejection, EntryKey, Node, RowNames, Step, descend, hex,
    parse_steps,
};
use super::{RenderNames, declaring, entry_name, not_declared, value_path};
use crate::error::AppError;

/// What a row copies as. Each half is absent where the row has no spelling for it: a path
/// through a field no table names, a value nothing under which is named, and the reference of
/// an object, which names no path.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct RowDeclaration {
    /// An `entries` module setting the row to its value, as it stands under `modules`.
    pub declaration: Option<String>,
    /// The row as a game-copy reference, `<entry>:<property path>`.
    pub reference: Option<String>,
    /// How many fields and items the declaration leaves out because it cannot spell them. An
    /// apply leaves each as the game has it.
    pub skipped: u32,
}

impl BinDocument {
    /// The row at `path` under `entry` as a declaration and as a reference. An empty path is
    /// the object itself.
    ///
    /// A struct and an object copy as a block of their fields, which an apply sets one by one
    /// on the game's own struct. "Declaring from a game bin" in docs/ux/BIN_EDITOR.md.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing.
    pub fn row_declaration(
        &self,
        entry: BinHash,
        path: &str,
        names: &dyn RowNames,
    ) -> Result<RowDeclaration, BinDocumentError> {
        let address = || format!("{}:{path}", hex(entry));
        let not_found = || BinDocumentError::NodeNotFound { address: address() };
        let steps = parse_steps(path).ok_or_else(not_found)?;
        let object = self.object_at(entry).ok_or_else(not_found)?;
        let (node, trace) = descend(object, &steps).ok_or_else(not_found)?;
        let names = RenderNames(names);
        let name = entry_name(entry, &names);
        let mut spelling = Spelling {
            names: &names,
            skipped: 0,
        };

        let (body, reference) = match node {
            Node::Object(object) => (spelling.fields(object.class_hash, &object.properties), None),
            Node::Value(value) => {
                let Some(property) = spelled_path(&steps, &trace, &names) else {
                    return Ok(RowDeclaration::default());
                };
                let at = value_path(&trace).ok_or_else(not_found)?;
                let mut body = IndexMap::new();
                spelling.place(&mut body, property.as_str().to_owned(), &at, value);
                (
                    body,
                    Some(format!("{}:{}", name.as_str(), property.as_str())),
                )
            }
        };

        let edits: Option<Vec<ManifestEdit>> = body
            .into_iter()
            .map(|(key, value)| {
                Some(ManifestEdit {
                    chunk_hash: 0,
                    entry: name.clone(),
                    path: PropertyPath::new(key).ok()?,
                    operation: Operation::Set(ValueText::try_from(&value).ok()?),
                    module: ModuleChoice::Auto,
                })
            })
            .collect();
        Ok(RowDeclaration {
            declaration: edits.and_then(|edits| ltk_declarations::module_text(&edits)),
            reference,
            skipped: u32::try_from(spelling.skipped).unwrap_or(u32::MAX),
        })
    }

    /// Declare the row at `path` under `entry` as the game-copy reference `reference` in the
    /// chosen layer: a set of the row, or with `merge` an addition to its list or map.
    ///
    /// The apply reports a reference the game does not answer on the row, so one is written
    /// all the same.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Declaring`] for a document that declares nothing and for
    /// text that is no reference, and with [`BinDocumentError::EditRejected`] for a path no
    /// declaration spells.
    pub fn declare_reference(
        &mut self,
        entry: BinHash,
        path: &str,
        reference: &str,
        merge: bool,
    ) -> Result<(), BinDocumentError> {
        let nameless = || BinDocumentError::EditRejected {
            address: format!("{}:{path}", hex(entry)),
            rejection: EditRejection::NamelessPath,
        };
        let reference = Reference::parse(reference).map_err(|error| {
            declaring(AppError::ValidationFailed(format!(
                "Not a reference: {error}"
            )))
        })?;
        /* Quoted, so a path holding a bracket or a brace stays one scalar. */
        let quoted = serde_json::to_string(&reference.to_string())
            .map_err(|error| declaring(AppError::Other(error.to_string())))?;
        let text = ValueText::new(format!("!ref {quoted}"))
            .map_err(|error| declaring(AppError::from(error)))?;

        let steps = parse_steps(path).ok_or_else(nameless)?;
        let object = self.object_at(entry).ok_or_else(nameless)?;
        let (_, trace) = descend(object, &steps).ok_or_else(nameless)?;
        let declared = self.declared.as_ref().ok_or_else(not_declared)?;

        let mut edit = None;
        declared.context.game.with_names(&mut |names| {
            let names = RenderNames(names);
            edit = spelled_path(&steps, &trace, &names).map(|property| ManifestEdit {
                chunk_hash: declared.chunk_hash,
                entry: entry_name(entry, &names),
                path: property,
                operation: if merge {
                    Operation::Add(text.clone())
                } else {
                    Operation::Set(text.clone())
                },
                module: ModuleChoice::Auto,
            });
        });
        let edit = edit.ok_or_else(nameless)?;

        let written = declared.write(&[edit]).map_err(declaring)?;
        if let Some(written) = written {
            self.declared
                .as_mut()
                .ok_or_else(not_declared)?
                .remember(written);
        }
        self.reapply()
    }
}

/// The property path `steps` walk, or `None` where a declaration does not spell it.
fn spelled_path(
    steps: &[Step],
    trace: &[super::super::Trace<'_>],
    names: &RenderNames<'_>,
) -> Option<PropertyPath> {
    if steps.is_empty()
        || steps
            .iter()
            .any(|step| matches!(step, Step::Key(EntryKey { occurrence, .. }) if *occurrence > 0))
    {
        return None;
    }
    value_path(trace)?.to_property_path(names).ok()
}

/// A value spelled as declaration keys, counting what it leaves out.
struct Spelling<'a> {
    names: &'a RenderNames<'a>,
    skipped: usize,
}

impl Spelling<'_> {
    /// The fields of a struct of `class` as a block, each under its name. A field no table
    /// names is left out.
    fn fields(
        &mut self,
        class: BinHash,
        properties: &IndexMap<BinHash, PropertyValueEnum>,
    ) -> IndexMap<String, Value> {
        let mut block = IndexMap::new();
        for (&field, value) in properties {
            let Some(name) = self
                .names
                .field(field, Some(class))
                .filter(|name| names_field(name, field))
            else {
                self.skipped += 1;
                continue;
            };
            let mut at = ValuePath::new();
            at.push_field(field, class);
            self.place(&mut block, name.into_owned(), &at, value);
        }
        block
    }

    /// Put `value`, which `at` addresses, under `key` in `block`.
    ///
    /// A struct is a block of its own fields. Any other value is the literal it renders as. A
    /// list, map or option that renders as none, because it holds a map key with no spelling,
    /// is a key per item, subscripted as `at` is.
    fn place(
        &mut self,
        block: &mut IndexMap<String, Value>,
        key: String,
        at: &ValuePath,
        value: &PropertyValueEnum,
    ) {
        if let Some((class, properties)) = struct_of(value) {
            let fields = self.fields(class, properties);
            if !fields.is_empty() {
                block.insert(key, Value::Mapping(fields));
            }
            return;
        }
        if let Ok(rendered) = Value::render(value, self.names) {
            block.insert(key, rendered);
            return;
        }
        let items = items_of(value);
        if items.is_empty() {
            self.skipped += 1;
            return;
        }
        for (segment, item) in items {
            let mut path = at.clone();
            match segment {
                Item::Index(index) => path.push_index(index),
                Item::Key(key) => match key.as_leaf().ok().flatten().and_then(MapKey::from_leaf) {
                    Some(key) => path.push_key(key),
                    None => {
                        self.skipped += 1;
                        continue;
                    }
                },
            }
            match path.to_property_path(self.names) {
                Ok(spelled) => self.place(block, spelled.as_str().to_owned(), &path, item),
                Err(_) => self.skipped += 1,
            }
        }
    }
}

/// One item of a list, map or option, by the segment that reaches it.
enum Item<'a> {
    Index(usize),
    Key(&'a PropertyValueEnum),
}

/// The items of a list, a map or a present option, and none for any other value.
fn items_of(value: &PropertyValueEnum) -> Vec<(Item<'_>, &PropertyValueEnum)> {
    match value {
        PropertyValueEnum::Container(items) => indexed(items.items()),
        PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(items)) => {
            indexed(items.items())
        }
        PropertyValueEnum::Optional(option) => option
            .value()
            .map(|item| vec![(Item::Index(0), item)])
            .unwrap_or_default(),
        PropertyValueEnum::Map(map) => map
            .entries()
            .iter()
            .map(|(key, item)| (Item::Key(key), item))
            .collect(),
        _ => Vec::new(),
    }
}

fn indexed(items: &[PropertyValueEnum]) -> Vec<(Item<'_>, &PropertyValueEnum)> {
    items
        .iter()
        .enumerate()
        .map(|(index, item)| (Item::Index(index), item))
        .collect()
}

/// The class and the fields of a struct or an embed, and none for a null pointer.
fn struct_of(
    value: &PropertyValueEnum,
) -> Option<(BinHash, &IndexMap<BinHash, PropertyValueEnum>)> {
    match value {
        PropertyValueEnum::Struct(pointer) if *pointer.class_hash != 0 => {
            Some((pointer.class_hash, &pointer.properties))
        }
        PropertyValueEnum::Embedded(values::Embedded(embed)) => {
            Some((embed.class_hash, &embed.properties))
        }
        _ => None,
    }
}

/// Whether `name` is one field name a key spells, hashing to `field`.
fn names_field(name: &str, field: BinHash) -> bool {
    let Ok(path) = PropertyPath::new(name) else {
        return false;
    };
    let mut segments = path.segments();
    matches!(
        (segments.next(), segments.next()),
        (Some(segment), None) if segment.subscript.is_none() && segment.name_hash() == field
    )
}

#[cfg(test)]
mod tests;
