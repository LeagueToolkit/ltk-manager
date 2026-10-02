//! What a document holds apart from a baseline copy of its objects, and the revert of one
//! property to that copy. "What changed" in docs/ux/BIN_EDITOR.md.

use std::collections::HashSet;
use std::io::Cursor;

use indexmap::IndexMap;
use ltk_hash::BinHash;
use ltk_meta::property::values;
use ltk_meta::{BinFile, BinObject, PropertyValueEnum};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

use super::declared::GameCopy;
use super::edit::Edit;
use super::properties::{field_path, split_field};
use super::{
    BinDocument, BinDocumentError, EditRejection, EntryKey, HashPath, Node, as_list, as_struct,
    descend, hex, key_text, parse_steps,
};

/// What a document's rows are compared with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum ChangeBaseline {
    /// The file as the document read it, before any edit since.
    Opened,
    /// The installed game's copy of each object.
    Game,
}

/// How an address differs from the baseline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum ChangeKind {
    /// The document holds it and the baseline does not.
    Added,
    /// The baseline holds it and the document does not.
    Removed,
    /// Both hold it, with different values.
    Changed,
}

/// One property or object that differs from the baseline.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinChange {
    /// The object's path hash, `0x` and eight hex digits.
    pub entry: String,
    /// The property's hash path under the object, and empty for the object itself.
    pub path: String,
    pub kind: ChangeKind,
}

/// The baseline objects a comparison reads, by path hash.
pub type Originals = IndexMap<BinHash, BinObject>;

impl BinDocument {
    /// The objects of the file as the document read it.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::Unreadable`] when the bytes no longer parse, which
    /// they did once.
    pub fn opened_objects(&self) -> Result<Originals, BinDocumentError> {
        let file = BinFile::from_reader(&mut Cursor::new(&self.opened))?;
        Ok(file.objects().clone())
    }

    /// The baseline's objects: the file as it was opened, or the game's copy of each of
    /// the document's objects, or of `only` alone. An object the game lacks is left out.
    ///
    /// # Errors
    ///
    /// Fails where the opened bytes or a game chunk no longer parse, and with what `game`
    /// raises for a chunk it could not read.
    pub(super) fn originals(
        &self,
        baseline: ChangeBaseline,
        game: &dyn GameCopy,
        only: Option<BinHash>,
    ) -> AppResult<Originals> {
        if baseline == ChangeBaseline::Opened {
            return Ok(self.opened_objects()?);
        }

        let wanted: Vec<BinHash> =
            only.map_or_else(|| self.entries().collect(), |entry| vec![entry]);
        let mut out = Originals::new();
        for entry in &wanted {
            if out.contains_key(entry) {
                continue;
            }
            let Some(bytes) = game.declaring_chunk(*entry)? else {
                continue;
            };

            /* One chunk declares many of a file's objects, so each read takes every one it holds. */
            let chunk =
                BinFile::from_reader(&mut Cursor::new(&bytes)).map_err(BinDocumentError::from)?;
            for (held, object) in chunk.objects() {
                if wanted.contains(held) && !out.contains_key(held) {
                    out.insert(*held, object.clone());
                }
            }
        }
        Ok(out)
    }

    /// Every property and object that differs from `originals`.
    ///
    /// An object `originals` lacks is added. One only `originals` holds is removed, so a
    /// baseline read for the document's own objects reports no removal. A struct or a list of
    /// structs of the same class is compared field by field, and any other value whole.
    #[must_use]
    pub fn changes_from(&self, originals: &Originals) -> Vec<BinChange> {
        let objects = self.file.objects();
        let mut out = Vec::new();
        for (entry, object) in objects {
            let mut changed = |path: String, kind| {
                out.push(BinChange {
                    entry: hex(*entry),
                    path,
                    kind,
                });
            };
            match originals.get(entry) {
                None => changed(String::new(), ChangeKind::Added),
                Some(original) => {
                    diff_properties(&object.properties, &original.properties, "", &mut changed);
                }
            }
        }
        for entry in originals
            .keys()
            .filter(|entry| !objects.contains_key(*entry))
        {
            out.push(BinChange {
                entry: hex(*entry),
                path: String::new(),
                kind: ChangeKind::Removed,
            });
        }
        out
    }

    /// Put the property at `path` under `entry` back to what `original` holds there, as one
    /// undoable edit. A property `original` lacks is removed, and one only it holds is
    /// written back.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::EditRejected`] where `path` ends in no field, and with
    /// [`BinDocumentError::NodeNotFound`] where its holder is in neither copy.
    pub fn revert_property(
        &mut self,
        entry: BinHash,
        path: &str,
        original: Option<&BinObject>,
    ) -> Result<(), BinDocumentError> {
        let (holder, field) = split_field(path).ok_or_else(|| BinDocumentError::EditRejected {
            address: format!("{}:{path}", hex(entry)),
            rejection: EditRejection::NotAProperty,
        })?;
        let was = original
            .and_then(|object| property_at(object, path))
            .cloned();
        let held = self
            .object_at(entry)
            .and_then(|object| property_at(object, path))
            .is_some();

        let inverse = match (held.then_some(()), was) {
            (Some(_), Some(was)) => self.swap_property(entry, path, was)?,
            (Some(_), None) => self.take_property(entry, path)?,
            (None, Some(was)) => {
                let holder = holder.to_owned();
                self.insert_property(entry, &holder, field, None, was)?;
                Edit::RemoveProperty {
                    entry,
                    path: field_path(&holder, field),
                }
            }
            (None, None) => return Ok(()),
        };
        self.record(inverse)
    }
}

/// The property at the hash path `path` under `object`, or `None` where the path reaches none.
fn property_at<'a>(object: &'a BinObject, path: &str) -> Option<&'a PropertyValueEnum> {
    match descend(object, &parse_steps(path)?)? {
        (Node::Value(value), _) => Some(value),
        _ => None,
    }
}

/// Report every field of `now` that differs from `was`, under the holder at `holder`.
fn diff_properties(
    now: &IndexMap<BinHash, PropertyValueEnum>,
    was: &IndexMap<BinHash, PropertyValueEnum>,
    holder: &str,
    changed: &mut impl FnMut(String, ChangeKind),
) {
    for (field, value) in now {
        let path = field_path(holder, *field);
        match was.get(field) {
            None => changed(path, ChangeKind::Added),
            Some(old) => diff_value(value, old, &path, changed),
        }
    }
    for field in was.keys().filter(|field| !now.contains_key(*field)) {
        changed(field_path(holder, *field), ChangeKind::Removed);
    }
}

/// Report where `now` differs from `was` at `path`: field by field under two structs of one
/// class, item by item under two lists of such structs, and the value whole otherwise.
fn diff_value(
    now: &PropertyValueEnum,
    was: &PropertyValueEnum,
    path: &str,
    changed: &mut impl FnMut(String, ChangeKind),
) {
    if now == was {
        return;
    }
    if let (Some(a), Some(b)) = (as_struct(now), as_struct(was))
        && a.class_hash == b.class_hash
    {
        diff_properties(&a.properties, &b.properties, path, changed);
        return;
    }
    if let (Some(a), Some(b)) = (as_list(now), as_list(was))
        && a.len() == b.len()
        && a.iter().zip(b).all(|(a, b)| same_class(a, b))
    {
        for (at, (a, b)) in a.iter().zip(b).enumerate() {
            let item = String::from(HashPath::under(path).index(at));
            diff_value(a, b, &item, changed);
        }
        return;
    }
    if let (PropertyValueEnum::Map(a), PropertyValueEnum::Map(b)) = (now, was)
        && same_keys(a, b)
    {
        for ((key, a), (_, b)) in a.entries().iter().zip(b.entries()) {
            let entry = String::from(HashPath::under(path).key(&EntryKey::new(key_text(key), 0)));
            diff_value(a, b, &entry, changed);
        }
        return;
    }
    changed(path.to_owned(), ChangeKind::Changed);
}

/// Two items a comparison walks into: structs of one non-null class.
fn same_class(a: &PropertyValueEnum, b: &PropertyValueEnum) -> bool {
    matches!(
        (as_struct(a), as_struct(b)),
        (Some(a), Some(b)) if a.class_hash == b.class_hash
    )
}

/// Two maps with the same keys in the same order, none repeated, whose entries a comparison
/// walks one by one.
fn same_keys(a: &values::Map, b: &values::Map) -> bool {
    let keys = |map: &values::Map| {
        map.entries()
            .iter()
            .map(|(key, _)| key_text(key))
            .collect::<Vec<_>>()
    };
    let (a, b) = (keys(a), keys(b));
    a == b && a.iter().collect::<HashSet<_>>().len() == a.len()
}

#[cfg(test)]
mod tests;
