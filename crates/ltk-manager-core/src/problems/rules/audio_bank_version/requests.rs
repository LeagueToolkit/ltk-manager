//! Which audio files this mod's own bins ask for.
//!
//! A bank is asked for by name. A skin's audio properties hold a list of bank
//! units, and each unit carries the paths of the files it needs - the media
//! bank, the events bank and any media package. That list is where a request
//! for a bank comes from, so it is what a removal has to answer to.
//!
//! The class rather than the class that holds it, because six classes hold bank
//! units and they all ask the same way.

use std::collections::HashSet;

use indexmap::IndexMap;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::PropertyValueEnum;
use ltk_meta::property::values;

use crate::problems::{ProjectFiles, budget};

/// `BankUnit`, the class naming the files one unit of a skin's audio needs.
const BANK_UNIT: BinHash = BinHash(0xa441_6515);

/// `bankPath` on that class, which is the list of those files.
const BANK_PATH: BinHash = BinHash(0x2a21_ad00);

/// Every file this mod's bank units name, by the hash a WAD addresses it by.
#[derive(Debug, Default)]
pub(super) struct BankRequests {
    asked: HashSet<WadHash>,
    /// Whether every bin was read.
    complete: bool,
}

impl BankRequests {
    /// Read every bank unit of every bin of `project`.
    ///
    /// The second parse of every bin a run makes, so it is worth doing only
    /// once something has been found worth asking about.
    pub(super) fn of(project: &ProjectFiles) -> Self {
        let handles: Vec<_> = project.bins().collect();
        let read = project.budget().map(
            &handles,
            budget::files_at_once(),
            |handle| handle.size_bytes().saturating_mul(budget::BIN_EXPANSION),
            |handle| match handle.bin() {
                Ok(bin) => Some(asked_in(&bin)),
                Err(e) => {
                    tracing::debug!(
                        "{} names no bank units it can be read for: {e}",
                        handle.path()
                    );
                    None
                }
            },
        );

        let mut requests = Self {
            asked: HashSet::new(),
            complete: true,
        };
        for found in read {
            match found.flatten() {
                Some(paths) => requests.asked.extend(paths),
                None => requests.complete = false,
            }
        }
        requests
    }

    /// Whether anything in the mod asks for the file at `chunk`.
    ///
    /// A bin that would not parse, or a read the budget called off, might hold
    /// a request nothing here records - so an incomplete read answers yes to
    /// everything. The cost of a wrong yes is a repair not offered, and the
    /// cost of a wrong no is a file deleted out from under something asking.
    pub(super) fn asks_for(&self, chunk: WadHash) -> bool {
        !self.complete || self.asked.contains(&chunk)
    }
}

/// Every path the bank units of one bin name.
fn asked_in(bin: &ltk_meta::Bin) -> Vec<WadHash> {
    let mut found = Vec::new();
    for object in bin.objects.values() {
        walk(object.class_hash, &object.properties, &mut found);
    }
    found
}

/// Read one object-like node, and descend into whatever it holds.
fn walk(
    class: BinHash,
    properties: &IndexMap<BinHash, PropertyValueEnum>,
    found: &mut Vec<WadHash>,
) {
    if class == BANK_UNIT
        && let Some(paths) = properties.get(&BANK_PATH)
    {
        found.extend(strings_in(paths).map(WadHash::hash_str));
    }

    for value in properties.values() {
        descend(value, found);
    }
}

/// The strings a list property holds, ordered or not.
fn strings_in(value: &PropertyValueEnum) -> impl Iterator<Item = &str> {
    let items = match value {
        PropertyValueEnum::Container(values::Container::String { items, .. }) => Some(items),
        PropertyValueEnum::UnorderedContainer(items) => match &items.0 {
            values::Container::String { items, .. } => Some(items),
            _ => None,
        },
        _ => None,
    };
    items.into_iter().flatten().map(|held| held.value.as_str())
}

/// Walk into whatever object-like nodes `value` holds.
fn descend(value: &PropertyValueEnum, found: &mut Vec<WadHash>) {
    match value {
        PropertyValueEnum::Struct(inner) => walk(inner.class_hash, &inner.properties, found),
        PropertyValueEnum::Embedded(inner) => walk(inner.0.class_hash, &inner.0.properties, found),
        PropertyValueEnum::Container(items) => descend_container(items, found),
        PropertyValueEnum::UnorderedContainer(items) => descend_container(&items.0, found),
        PropertyValueEnum::Optional(inner) => match inner {
            values::Optional::Struct {
                value: Some(held), ..
            } => walk(held.class_hash, &held.properties, found),
            values::Optional::Embedded {
                value: Some(held), ..
            } => walk(held.0.class_hash, &held.0.properties, found),
            _ => {}
        },
        PropertyValueEnum::Map(map) => {
            for (_, held) in map.entries() {
                descend(held, found);
            }
        }
        _ => {}
    }
}

fn descend_container(items: &values::Container, found: &mut Vec<WadHash>) {
    match items {
        values::Container::Struct { items, .. } => {
            for inner in items {
                walk(inner.class_hash, &inner.properties, found);
            }
        }
        values::Container::Embedded { items, .. } => {
            for inner in items {
                walk(inner.0.class_hash, &inner.0.properties, found);
            }
        }
        _ => {}
    }
}
