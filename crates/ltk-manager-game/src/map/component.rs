//! A component of a map's `MapContainer`, and the scalars its fields state.

use ltk_hash::{BinHash, Hash as _};
use ltk_manager_core::hashing::named;
use ltk_meta::walk::Leaf;

use super::MapPath;
use ltk_manager_core::bin_document::{BinDocument, Fields, items, leaf, struct_of};

pub(super) const MAP_CONTAINER: BinHash = named("MapContainer");
/// `MapContainer.components`, a list of pointers to `MapComponent`.
pub(super) const COMPONENTS: BinHash = named("components");

/// The fields of the `class` component of `map`'s container, and none where it has none.
///
/// The container is the object at `map`'s entry path, else the file's first `MapContainer`.
pub(super) fn map_component<'a>(
    materials: &'a BinDocument,
    map: &MapPath,
    class: BinHash,
) -> Option<&'a Fields> {
    let container = materials
        .object_at(BinHash::hash_str(map.as_str()))
        .filter(|object| object.class_hash == MAP_CONTAINER)
        .or_else(|| {
            materials
                .entries()
                .filter_map(|entry| materials.object_at(entry))
                .find(|object| object.class_hash == MAP_CONTAINER)
        })?;
    items(container.properties.get(&COMPONENTS))
        .iter()
        .filter_map(|component| struct_of(Some(component)))
        .find(|(found, _)| *found == class)
        .map(|(_, fields)| fields)
}

pub(super) fn u32_of(fields: &Fields, field: BinHash) -> Option<u32> {
    match leaf(fields.get(&field))? {
        Leaf::U32(value) => Some(value),
        _ => None,
    }
}
