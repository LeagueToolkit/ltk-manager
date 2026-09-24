//! A new object or a removed one, as the `objects` entry of a `target` module that expresses
//! it. ADR-0049.
//!
//! Each plan is checked the way a property edit's is: the declarations apply again, and the
//! object has to come out as the edit asked. A plan that does not is taken back.

use ltk_declarations::{ObjectEdit as ManifestObjectEdit, ObjectOperation};
use ltk_game_data::{ClassName, EntryName, Names as _, Target};
use ltk_hash::BinHash;
use ltk_meta::{BinObject, PropertyValueEnum};
use serde::{Deserialize, Serialize};

use super::super::edit::bin_hash;
use super::super::{BinDocument, BinDocumentError, ClassChoice, EditRejection, hex};
use super::{RenderNames, declaring, entry_name, not_declared};
use crate::meta_schema::SchemaAt;

/// Where a new object of a declared document starts.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum NewObject {
    /// A copy of an object the document holds: `clone`.
    Clone {
        /// The object copied, `0x` and eight hex digits.
        source: String,
    },
    /// An object of a class holding no property: `class`.
    Class {
        /// The class, as a name or `0x` and eight hex digits.
        class: String,
    },
}

/// What a declaration of the chosen layer does to one object of the chunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct DeclaredObjectMark {
    /// The object's path hash, `0x` and eight hex digits.
    pub entry: String,
    pub change: ObjectChange,
}

/// Whether a declaration creates an object or removes one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ObjectChange {
    /// A `clone` or a `class` the applied copy holds.
    Created,
    /// A `remove: true` the applied copy no longer holds, of an object of the game's copy.
    Removed,
}

impl BinDocument {
    /// Declare a new object named `name` in the chosen layer, answering its path hash.
    ///
    /// The name is the author's. The game-data reference suggests `Mods/<mod id>/` ahead of
    /// it, and nothing checks that.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Declaring`] for a document that declares nothing, with
    /// [`BinDocumentError::EditRejected`] for a name that is no entry name
    /// ([`EditRejection::MalformedHash`]), one the chunk holds
    /// ([`EditRejection::ObjectExists`]), and a creation no declaration expresses
    /// ([`EditRejection::Undeclarable`]), a source or a class that is no name and no hash
    /// ([`EditRejection::MalformedHash`]), and with [`BinDocumentError::NodeNotFound`] for a
    /// clone of an object the document does not hold. A refused edit leaves the tree and the
    /// manifest as they were.
    pub fn create_object(
        &mut self,
        name: &str,
        origin: &NewObject,
    ) -> Result<BinHash, BinDocumentError> {
        let declared = self.declared.as_ref().ok_or_else(not_declared)?;
        let rejected = |rejection| BinDocumentError::EditRejected {
            address: name.to_owned(),
            rejection,
        };
        let name =
            EntryName::try_from(name.trim()).map_err(|_| rejected(EditRejection::MalformedHash))?;
        let entry = name.object_hash();
        if self.object_at(entry).is_some() || declared.game_tree.objects.contains_key(&entry) {
            return Err(rejected(EditRejection::ObjectExists));
        }

        let (operation, expected) = match origin {
            NewObject::Clone { source } => {
                let source = bin_hash(source).map_err(rejected)?;
                let held =
                    self.object_at(source)
                        .ok_or_else(|| BinDocumentError::NodeNotFound {
                            address: hex(source),
                        })?;
                let spelled = self.spelled(|names| entry_name(source, names))?;
                let expected = clone_as(held, &spelled, &name);
                (ObjectOperation::Clone(spelled), expected)
            }
            NewObject::Class { class: typed } => {
                let class = bin_hash(typed).map_err(rejected)?;
                /* A typed name is the spelling the author chose. A hash is spelled by the
                tables where they name it. */
                let spelled = match ClassName::try_from(typed.trim()) {
                    Ok(named) if !is_hash_text(typed) => named,
                    _ => self.spelled(|names| class_name(class, names))?,
                };
                let expected = BinObject::new(entry, spelled.class_hash());
                (ObjectOperation::Construct(spelled), expected)
            }
        };

        let plan = self.object_edit(name, operation)?;
        self.declare_object(&[plan], entry, |document| {
            document.object_at(entry) == Some(&expected)
        })?;
        Ok(entry)
    }

    /// Declare the removal of the object `entry` in the chosen layer.
    ///
    /// An object the layer creates loses its creation, and any other object gains a
    /// `remove: true` entry.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Declaring`] for a document that declares nothing, with
    /// [`BinDocumentError::NodeNotFound`] for an object the document does not hold, and with
    /// [`BinDocumentError::EditRejected`] for a removal no declaration expresses. A refused
    /// edit leaves the tree and the manifest as they were.
    pub fn remove_object(&mut self, entry: BinHash) -> Result<(), BinDocumentError> {
        if !self.declares() {
            return Err(not_declared());
        }
        if self.object_at(entry).is_none() {
            return Err(BinDocumentError::NodeNotFound {
                address: hex(entry),
            });
        }

        let name = self.spelled(|names| entry_name(entry, names))?;

        /* A drop of a creation the layer does not hold writes nothing and leaves the object,
        so the removal is the next attempt. */
        let plans = [
            self.object_edit(name.clone(), ObjectOperation::Drop)?,
            self.object_edit(name, ObjectOperation::Remove)?,
        ];
        self.declare_object(&plans, entry, |document| {
            document.object_at(entry).is_none()
        })
    }

    /// Take back the chosen layer's removal of the object `entry` of the game's copy.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Declaring`] for a document that declares nothing, with
    /// [`BinDocumentError::NodeNotFound`] for an object the game's copy does not hold, and
    /// with [`BinDocumentError::EditRejected`] where dropping the layer's removal does not
    /// bring the object back. A refused edit leaves the tree and the manifest as they were.
    pub fn restore_object(&mut self, entry: BinHash) -> Result<(), BinDocumentError> {
        let declared = self.declared.as_ref().ok_or_else(not_declared)?;
        if !declared.game_tree.objects.contains_key(&entry) {
            return Err(BinDocumentError::NodeNotFound {
                address: hex(entry),
            });
        }
        if self.object_at(entry).is_some() {
            return Ok(());
        }

        let name = self.spelled(|names| entry_name(entry, names))?;
        let plan = self.object_edit(name, ObjectOperation::Drop)?;
        self.declare_object(&[plan], entry, |document| {
            document.object_at(entry).is_some()
        })
    }

    /// The classes a new object can take, out of `schema`: the classes the document's objects
    /// hold first, then every class the schema knows, by name.
    #[must_use]
    pub fn object_classes(&self, schema: SchemaAt<'_>) -> Vec<ClassChoice> {
        let mut held: Vec<BinHash> = Vec::new();
        for object in self.file.objects().values() {
            if !held.contains(&object.class_hash) {
                held.push(object.class_hash);
            }
        }
        let name = |class: BinHash| schema.class_name(class).map(str::to_owned);
        let choice = |class: BinHash, held: bool| ClassChoice {
            hash: hex(class),
            name: name(class),
            held,
            derives_from: None,
        };

        let mut choices: Vec<ClassChoice> = held.iter().map(|class| choice(*class, true)).collect();
        choices.extend(
            schema
                .classes()
                .into_iter()
                .filter(|class| !held.contains(class))
                .map(|class| choice(class, false)),
        );
        choices
    }

    /// What `spell` answers over the names a declaration spells its hashes by.
    fn spelled<T>(&self, spell: impl Fn(&RenderNames<'_>) -> T) -> Result<T, BinDocumentError> {
        let declared = self.declared.as_ref().ok_or_else(not_declared)?;
        let mut spelled = None;
        declared.context.game.with_names(&mut |names| {
            spelled = Some(spell(&RenderNames(names)));
        });
        spelled.ok_or_else(not_declared)
    }

    /// The object edit of the document's chunk that `operation` makes on `entry`.
    fn object_edit(
        &self,
        entry: EntryName,
        operation: ObjectOperation,
    ) -> Result<ManifestObjectEdit, BinDocumentError> {
        Ok(ManifestObjectEdit {
            target: self.chunk_target()?,
            entry,
            operation,
        })
    }

    /// The document's chunk as a `target` module names it: by its path where the tables hold
    /// one, else by its hash.
    pub(super) fn chunk_target(&self) -> Result<Target, BinDocumentError> {
        let chunk_hash = self.declared.as_ref().ok_or_else(not_declared)?.chunk_hash;
        let hashed = || {
            Target::try_from(format!("{chunk_hash:016x}")).expect("sixteen hex digits are a target")
        };
        Ok(self
            .spelled(|names| names.file(chunk_hash).map(String::from))?
            .and_then(|path| Target::try_from(path).ok())
            .filter(|target| target.chunk_hash() == chunk_hash)
            .unwrap_or_else(hashed))
    }

    /// Write the first of `plans` after which `landed` holds, one at a time, each taken back
    /// when it does not. The tree is the apply's again whatever the outcome.
    fn declare_object(
        &mut self,
        plans: &[ManifestObjectEdit],
        entry: BinHash,
        landed: impl Fn(&Self) -> bool,
    ) -> Result<(), BinDocumentError> {
        let outcome = self.try_object_plans(plans, entry, landed);
        if outcome.is_err() {
            self.reapply()?;
        }
        outcome
    }

    fn try_object_plans(
        &mut self,
        plans: &[ManifestObjectEdit],
        entry: BinHash,
        landed: impl Fn(&Self) -> bool,
    ) -> Result<(), BinDocumentError> {
        for plan in plans {
            let declared = self.declared.as_ref().ok_or_else(not_declared)?;
            let written = declared
                .write_with(|manifest| manifest.edit_object(plan).map(|()| None))
                .map_err(declaring)?;
            self.reapply()?;

            if landed(self) {
                if let Some(written) = written {
                    self.declared
                        .as_mut()
                        .ok_or_else(not_declared)?
                        .remember(written);
                }
                return Ok(());
            }

            if let Some(written) = written {
                let declared = self.declared.as_ref().ok_or_else(not_declared)?;
                declared
                    .put(&written.layer, &written.after, &written.before)
                    .map_err(declaring)?;
            }
        }

        Err(BinDocumentError::EditRejected {
            address: hex(entry),
            rejection: EditRejection::Undeclarable,
        })
    }
}

/// Whether a typed class or entry is spelled as a hash rather than a name.
fn is_hash_text(text: &str) -> bool {
    text.trim().starts_with("0x")
}

/// The class as a declaration names it: its name where the tables hold one, else its hash.
fn class_name(class: BinHash, names: &RenderNames<'_>) -> ClassName {
    names
        .class(class)
        .and_then(|name| ClassName::try_from(name.as_ref()).ok())
        .filter(|name| name.class_hash() == class)
        .unwrap_or_else(|| {
            ClassName::try_from(hex(class).as_str()).expect("a spelled hash is a class name")
        })
}

/// The object a clone of `object`, spelled `source`, makes under `name`. league-mod
/// ADR-0030 rewrites the copy's own path.
fn clone_as(object: &BinObject, source: &EntryName, name: &EntryName) -> BinObject {
    let mut copy = object.clone();
    copy.path_hash = name.object_hash();
    let spelled = !source.is_hash() && !name.is_hash();
    for value in copy.properties.values_mut() {
        match value {
            PropertyValueEnum::Hash(hash) if hash.value == source.object_hash() => {
                hash.value = name.object_hash();
            }
            PropertyValueEnum::String(text)
                if spelled && text.value.eq_ignore_ascii_case(source.as_str()) =>
            {
                name.as_str().clone_into(&mut text.value);
            }
            _ => {}
        }
    }
    copy
}

#[cfg(test)]
mod tests;
