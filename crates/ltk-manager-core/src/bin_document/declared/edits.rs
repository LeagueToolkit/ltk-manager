//! A row edit as the declarations that express it. "Declaring from a game bin" in
//! docs/ux/BIN_EDITOR.md.
//!
//! An edit is applied to the tree first, and the edit that reverts it says what happened.
//! The plan written for it is checked: the declarations apply again, and the value under the
//! edit has to come out as the edited tree holds it. A plan that does not is replaced by a set
//! of the whole value, which drops the signed keys beside it.

use ltk_declarations::{Edit as ManifestEdit, ModuleChoice, Operation, ValueText};
use ltk_game_data::{PropertySkipReason, Sign, Value};
use ltk_hash::BinHash;
use ltk_meta::PropertyValueEnum;
use ltk_meta::property::{Kind, values};

use super::super::edit::Edit;
use super::super::items::split_item;
use super::super::{
    BinDocument, BinDocumentError, EditRejection, EntryKey, Node, Step, descend, hex, parse_steps,
};
use super::{DeclaredSign, RenderNames, TextEdit, declaring, entry_name, not_declared, value_path};

/// What an edit did to the tree, read off the edit that reverts it.
enum Change<'a> {
    /// The value at `path` is another value: a leaf, a pointer, or a property that was added.
    Value { path: &'a str },
    /// The item at `path` joined its list, map or option.
    Inserted { path: &'a str },
    /// An item left the list, map or option at `holder`.
    Removed {
        holder: &'a str,
        index: usize,
        key: Option<&'a PropertyValueEnum>,
        value: &'a PropertyValueEnum,
    },
    /// The item at `path` sits at another position of its list.
    Moved { path: &'a str },
    /// The map entry at `path` held `old` as its key.
    Rekeyed {
        path: &'a str,
        old: &'a PropertyValueEnum,
    },
}

/// The declarations an edit lands as: the keys that express it, where some do, and the set
/// of the whole value under it.
struct Plans {
    /// The wire path of the value a plan has to reproduce.
    scope: String,
    keys: Option<Vec<ManifestEdit>>,
    /// Absent where the value holds a field no table names.
    whole: Option<Vec<ManifestEdit>>,
}

impl BinDocument {
    /// Declare the edit `inverse` reverts in the chosen layer, leaving the tree as the
    /// declarations apply. A refused edit leaves the tree and the manifest as they were.
    pub(in super::super) fn declare_edit(
        &mut self,
        inverse: &Edit,
    ) -> Result<(), BinDocumentError> {
        let outcome = self.declare_change(inverse);
        if outcome.is_err() {
            /* The tree is the apply's and never the edit's, so a refused edit leaves no trace. */
            self.reapply()?;
        }
        outcome
    }

    fn declare_change(&mut self, inverse: &Edit) -> Result<(), BinDocumentError> {
        let (entry, change) = change_of(inverse)?;
        let plans = self.plans(entry, &change)?;
        let expected = self
            .value_at(entry, &plans.scope)
            .cloned()
            .ok_or_else(|| undeclarable(entry, &plans.scope))?;

        let declared = self.declared.as_ref().ok_or_else(not_declared)?;
        let replaced = declared.marks.iter().any(|mark| {
            mark.sign == DeclaredSign::Set && mark.entry == hex(entry) && mark.path == plans.scope
        });
        /* An edit under a whole value the layer already sets joins that set. */
        let keys = plans.keys.filter(|_| !replaced || plans.whole.is_none());
        let mut attempts: Vec<_> = keys.into_iter().chain(plans.whole).collect();
        attempts.dedup();

        let untyped_before = self.untypable_keys(entry);
        let mut untyped = false;
        for plan in attempts {
            let written = self.write_plan(&plan)?;
            self.reapply()?;
            untyped |= self.untypable_keys(entry) > untyped_before;
            if self
                .value_at(entry, &plans.scope)
                .is_some_and(|applied| same_value(applied, &expected))
            {
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
        if untyped {
            return Err(BinDocumentError::EditRejected {
                address: format!("{}:{}", hex(entry), plans.scope),
                rejection: EditRejection::Untypable,
            });
        }
        Err(undeclarable(entry, &plans.scope))
    }

    /// The count of keys on `entry` the last apply skipped for want of a type.
    fn untypable_keys(&self, entry: BinHash) -> usize {
        self.declared.as_ref().map_or(0, |declared| {
            declared
                .raised
                .iter()
                .filter_map(|raised| raised.diagnostic.property.as_ref())
                .filter(|property| {
                    matches!(property.reason, PropertySkipReason::Untypable)
                        && property.entry.object_hash() == entry
                })
                .count()
        })
    }

    /// Write every edit of `plan` to the chosen layer's manifest as one text change.
    fn write_plan(&self, plan: &[ManifestEdit]) -> Result<Option<TextEdit>, BinDocumentError> {
        let declared = self.declared.as_ref().ok_or_else(not_declared)?;
        declared.write(plan).map_err(declaring)
    }

    /// The value at the wire path `path` under `entry`.
    fn value_at(&self, entry: BinHash, path: &str) -> Option<&PropertyValueEnum> {
        let steps = parse_steps(path)?;
        match descend(self.object_at(entry)?, &steps)?.0 {
            Node::Value(value) => Some(value),
            Node::Object(_) => None,
        }
    }

    /// The plans that express `change`, spelled with the game's names.
    fn plans(&self, entry: BinHash, change: &Change<'_>) -> Result<Plans, BinDocumentError> {
        let scope = match change {
            Change::Value { path } => (*path).to_owned(),
            Change::Removed { holder, .. } => (*holder).to_owned(),
            Change::Inserted { path } | Change::Moved { path } | Change::Rekeyed { path, .. } => {
                split_item(path).ok_or_else(|| undeclarable(entry, path))?.0
            }
        };
        let declared = self.declared.as_ref().ok_or_else(not_declared)?;
        let ancestor = declared
            .marks
            .iter()
            .filter(|mark| {
                mark.sign == DeclaredSign::Set
                    && mark.entry == hex(entry)
                    && !mark.path.is_empty()
                    && scope
                        .strip_prefix(&mark.path)
                        .is_some_and(|tail| tail.starts_with(['.', '[', '{']))
            })
            .min_by_key(|mark| mark.path.len());
        if let Some(ancestor) = ancestor {
            // An enclosing set would overwrite a separately declared descendant.
            return self.plans(
                entry,
                &Change::Value {
                    path: &ancestor.path,
                },
            );
        }

        let nameless = || BinDocumentError::EditRejected {
            address: format!("{}:{scope}", hex(entry)),
            rejection: EditRejection::NamelessPath,
        };

        let steps = parse_steps(&scope).ok_or_else(nameless)?;
        if steps
            .iter()
            .any(|step| matches!(step, Step::Key(EntryKey { occurrence, .. }) if *occurrence > 0))
        {
            return Err(nameless());
        }
        let object = self.object_at(entry).ok_or_else(nameless)?;
        let (Node::Value(held), trace) = descend(object, &steps).ok_or_else(nameless)? else {
            return Err(nameless());
        };
        let walked = value_path(&trace).ok_or_else(nameless)?;
        let declared = self.declared.as_ref().ok_or_else(not_declared)?;

        let mut plans = None;
        declared.context.game.with_names(&mut |names| {
            let names = RenderNames(names);
            plans = (|| {
                let path = walked.to_property_path(&names).ok()?;
                let edit = |operation| ManifestEdit {
                    chunk_hash: declared.chunk_hash,
                    entry: entry_name(entry, &names),
                    path: path.clone(),
                    operation,
                    module: ModuleChoice::Auto,
                };
                let set = Value::render(held, &names)
                    .ok()
                    .and_then(|value| text_of(&value))
                    .map(|text| edit(Operation::Set(text)));
                let plans = match change {
                    Change::Value { .. } => (set.map(|set| vec![set]), None),
                    _ => (
                        key_operations(held, change, &names)
                            .map(|operations| operations.into_iter().map(&edit).collect()),
                        set.map(|set| {
                            vec![
                                edit(Operation::Drop(Sign::Add)),
                                edit(Operation::Drop(Sign::Remove)),
                                set,
                            ]
                        }),
                    ),
                };
                Some(plans)
            })();
        });
        match plans {
            Some((None, None)) | None => Err(nameless()),
            Some((keys, whole)) => Ok(Plans { scope, keys, whole }),
        }
    }
}

/// The signed keys that express `change` on `holder`, the list, map or option as the edit
/// left it. `None` where only the whole value does.
fn key_operations(
    holder: &PropertyValueEnum,
    change: &Change<'_>,
    names: &RenderNames<'_>,
) -> Option<Vec<Operation>> {
    use PropertyValueEnum as V;

    let items = match holder {
        V::Container(items) => Some(items),
        V::UnorderedContainer(values::UnorderedContainer(items)) => Some(items),
        _ => None,
    };
    let set = || {
        Some(vec![Operation::Set(text_of(
            &Value::render(holder, names).ok()?,
        )?)])
    };
    /* One item or one entry, rendered as the list or the map it sits in renders it. */
    let item_of = |kind: Kind, item: &V| {
        let alone = values::Container::new(kind, vec![item.clone()]).ok()?;
        Value::render(&alone.into(), names).ok()
    };
    let entry_of = |map: &values::Map, key: &V, value: &V| {
        let alone = values::Map::new(
            map.key_kind(),
            map.value_kind(),
            vec![(key.clone(), value.clone())],
        )
        .ok()?;
        match Value::render(&alone.into(), names).ok()? {
            Value::Mapping(entry) => Some(entry),
            _ => None,
        }
    };
    let key_list = |map: &values::Map, key: &V, value: &V| {
        let text = entry_of(map, key, value)?.into_keys().next()?;
        text_of(&Value::List(vec![Value::String(text)]))
    };

    match (change, holder) {
        (Change::Inserted { .. } | Change::Removed { .. }, V::Optional(_)) => set(),
        (Change::Inserted { path }, V::Map(map)) => {
            let (_, Step::Key(held)) = split_item(path)? else {
                return None;
            };
            let (key, value) = &map.entries()[held.position(map.entries())?];
            let added = text_of(&Value::Mapping(entry_of(map, key, value)?))?;
            Some(vec![Operation::Add(added)])
        }
        (Change::Inserted { path }, _) => {
            let items = items?;
            let (_, Step::Index(index)) = split_item(path)? else {
                return None;
            };
            /* A declaration adds at the end of a list and nowhere else. */
            if index + 1 != items.len() {
                return None;
            }
            let added = text_of(&item_of(items.item_kind(), items.get(index)?)?)?;
            Some(vec![Operation::Add(added)])
        }
        (
            Change::Removed {
                key: Some(key),
                value,
                ..
            },
            V::Map(map),
        ) => Some(vec![Operation::Remove(key_list(map, key, value)?)]),
        (Change::Removed { index, value, .. }, _) => {
            let items = items?;
            let removed = match items.item_kind() {
                /* A struct has no value to match, so it is removed by where it stood. */
                Kind::Struct | Kind::Embedded => {
                    Value::List(vec![Value::Integer(i128::try_from(*index).ok()?)])
                }
                kind => item_of(kind, value)?,
            };
            Some(vec![Operation::Remove(text_of(&removed)?)])
        }
        (Change::Rekeyed { path, old }, V::Map(map)) => {
            let (_, Step::Key(held)) = split_item(path)? else {
                return None;
            };
            let (key, value) = &map.entries()[held.position(map.entries())?];
            Some(vec![
                Operation::Remove(key_list(map, old, value)?),
                Operation::Add(text_of(&Value::Mapping(entry_of(map, key, value)?))?),
            ])
        }
        _ => None,
    }
}

/// Whether `applied` is the value `edited` is. A map is its entries in any order, because an
/// addition lands at the end of one and the file's order says nothing.
fn same_value(applied: &PropertyValueEnum, edited: &PropertyValueEnum) -> bool {
    match (applied, edited) {
        (PropertyValueEnum::Map(applied), PropertyValueEnum::Map(edited)) => {
            applied.key_kind() == edited.key_kind()
                && applied.value_kind() == edited.value_kind()
                && applied.entries().len() == edited.entries().len()
                && edited
                    .entries()
                    .iter()
                    .all(|entry| applied.entries().contains(entry))
        }
        _ => applied == edited,
    }
}

/// What the edit `inverse` reverts did, and the object it did it to.
fn change_of(inverse: &Edit) -> Result<(BinHash, Change<'_>), BinDocumentError> {
    Ok(match inverse {
        Edit::Leaf { entry, path, .. }
        | Edit::ReplaceProperty { entry, path, .. }
        | Edit::SetPointer { entry, path, .. }
        | Edit::RemoveProperty { entry, path } => (*entry, Change::Value { path }),
        Edit::RemoveItem { entry, path } => (*entry, Change::Inserted { path }),
        Edit::InsertItem {
            entry,
            holder,
            index,
            key,
            value,
        } => (
            *entry,
            Change::Removed {
                holder,
                index: *index,
                key: key.as_ref(),
                value,
            },
        ),
        Edit::MoveItem { entry, path, .. } => (*entry, Change::Moved { path }),
        Edit::SetKey { entry, path, key } => (*entry, Change::Rekeyed { path, old: key }),
        /* No declaration takes a property away. */
        Edit::InsertProperty { entry, holder, .. } => return Err(undeclarable(*entry, holder)),
        /* A declared document takes a dependency edit as a link edit, never through here. */
        Edit::Dependencies { .. } => {
            return Err(BinDocumentError::EditRejected {
                address: super::super::dependencies::ADDRESS.to_owned(),
                rejection: EditRejection::Undeclarable,
            });
        }
    })
}

fn text_of(value: &Value) -> Option<ValueText> {
    ValueText::try_from(value).ok()
}

fn undeclarable(entry: BinHash, path: &str) -> BinDocumentError {
    BinDocumentError::EditRejected {
        address: format!("{}:{path}", hex(entry)),
        rejection: EditRejection::Undeclarable,
    }
}

#[cfg(test)]
mod tests;
