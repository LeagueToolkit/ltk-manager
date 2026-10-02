//! The particle systems a map stands in its scene, read out of its `.materials.bin`.
//!
//! A map's `MapPlaceableContainer` chunks hold them beside the materials, and each links
//! a `VfxSystemDefinitionData` of the same file, so one open document answers both the
//! placements and the systems they play.

use ltk_hash::BinHash;
use ltk_manager_core::hashing::named;
use ltk_meta::walk::Leaf;
use serde::Serialize;

use super::placeable::{Placed, controller, name, placeables, transform, visibility};
use ltk_manager_core::bin_document::{BinDocument, hex, leaf, link};

pub(super) const PARTICLE: BinHash = named("MapParticle");
/// `MapParticle.system`.
const SYSTEM: BinHash = named("system");
/// `MapParticle.Transitional`.
const TRANSITIONAL: BinHash = named("Transitional");
/// `MapParticle.startDisabled`.
const START_DISABLED: BinHash = named("startDisabled");
/// One particle system a map stands in its scene.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapParticle {
    /// The chunk that holds it, a `MapPlaceableContainer`, as `0x` and eight digits.
    pub chunk: String,
    /// The key it sits under in that chunk, as `0x` and eight digits.
    pub key: String,
    /// The placeable's own name, which is unique within a map.
    pub name: String,
    /// The system it plays, an object of the same document, as `0x` and eight digits.
    pub system: String,
    /// Where it stands in the map's space, column major with the translation last.
    pub transform: [f32; 16],
    /// The layer mask, one bit per visibility layer, as a map mesh carries one.
    pub visibility: u8,
    /// The controller that shows and hides it, which no layer mask expresses.
    pub controller: Option<String>,
    /// The game plays it once as the map changes rather than for as long as it stands.
    pub transitional: bool,
    /// The game leaves it off until a script turns it on.
    pub start_disabled: bool,
}

/// Every particle `materials` stands in its map, in file order.
///
/// A placeable of another class, and a particle linking no system, is passed over.
#[must_use]
pub fn map_particles(materials: &BinDocument) -> Vec<MapParticle> {
    placeables(materials)
        .filter(|placed| placed.class == PARTICLE)
        .filter_map(|placed| particle(&placed))
        .collect()
}

fn particle(placed: &Placed<'_>) -> Option<MapParticle> {
    let fields = placed.fields;
    let flag = |field| {
        matches!(
            leaf(fields.get(&field)),
            Some(Leaf::Bool(true) | Leaf::Flag(true))
        )
    };
    Some(MapParticle {
        chunk: hex(placed.chunk),
        key: hex(placed.key),
        name: name(fields),
        system: hex(link(fields.get(&SYSTEM))?),
        transform: transform(fields),
        visibility: visibility(fields),
        controller: controller(fields),
        transitional: flag(TRANSITIONAL),
        start_disabled: flag(START_DISABLED),
    })
}

#[cfg(test)]
mod tests;
