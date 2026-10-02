//! What every placeable of a map states, whatever it places.

use ltk_hash::BinHash;
use ltk_manager_core::hashing::named;
use ltk_meta::walk::Leaf;

use ltk_manager_core::bin_document::{BinDocument, Fields, hex, leaf, link, struct_entries};

pub(super) const PLACEABLE_CONTAINER: BinHash = named("MapPlaceableContainer");
/// `MapPlaceableContainer.items`, a `Map<Hash, Pointer<MapPlaceableBase>>`.
pub(super) const ITEMS: BinHash = named("items");
/// `MapPlaceable.transform`.
pub(super) const TRANSFORM: BinHash = named("transform");
/// `MapPlaceable.name`.
pub(super) const NAME: BinHash = named("name");
/// `MapPlaceable.mVisibilityFlags`.
pub(super) const VISIBILITY_FLAGS: BinHash = named("mVisibilityFlags");
/// `VisibilityController`, which each placeable class declares for itself under one name.
pub(super) const VISIBILITY_CONTROLLER: BinHash = named("VisibilityController");

/// The mask a placeable that writes none is drawn under, which is every layer.
pub(super) const EVERY_LAYER: u8 = 255;

/// One placeable, as the container that holds it states it.
pub(super) struct Placed<'a> {
    /// The `MapPlaceableContainer` that holds it, which is one chunk of the map.
    pub chunk: BinHash,
    /// The key it sits under in that container's items.
    pub key: BinHash,
    pub class: BinHash,
    pub fields: &'a Fields,
}

/// Every placeable of every container in `materials`, in file order.
pub(super) fn placeables(materials: &BinDocument) -> impl Iterator<Item = Placed<'_>> {
    materials
        .entries()
        .filter_map(|entry| Some((entry, materials.object_at(entry)?)))
        .filter(|(_, object)| object.class_hash == PLACEABLE_CONTAINER)
        .flat_map(|(chunk, container)| {
            struct_entries(container.properties.get(&ITEMS)).map(move |(key, class, fields)| {
                Placed {
                    chunk,
                    key,
                    class,
                    fields,
                }
            })
        })
}

/// The placeable's own name, which a gameplay object states as a hash.
pub(super) fn name(fields: &Fields) -> String {
    match leaf(fields.get(&NAME)) {
        Some(Leaf::String(text)) => text.to_owned(),
        Some(Leaf::Hash(hash)) => hex(hash),
        _ => String::new(),
    }
}

/// Where the placeable stands, column major with the translation last.
pub(super) fn transform(fields: &Fields) -> [f32; 16] {
    match leaf(fields.get(&TRANSFORM)) {
        /* A bin matrix is held as its rows, so the transpose is what puts the
        translation last, as `vfx::resolve` reads one. */
        Some(Leaf::Matrix44(matrix)) => matrix.transpose().to_cols_array(),
        _ => glam::Mat4::IDENTITY.to_cols_array(),
    }
}

/// The layer mask, one bit per visibility layer.
pub(super) fn visibility(fields: &Fields) -> u8 {
    match leaf(fields.get(&VISIBILITY_FLAGS)) {
        Some(Leaf::U8(mask)) => mask,
        _ => EVERY_LAYER,
    }
}

/// The controller that shows and hides the placeable, as `0x` and eight digits.
pub(super) fn controller(fields: &Fields) -> Option<String> {
    link(fields.get(&VISIBILITY_CONTROLLER)).map(hex)
}
