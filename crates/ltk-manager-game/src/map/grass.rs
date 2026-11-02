//! Reads the grass tint that each skin of a map multiplies its brush by, and the rectangle that
//! the tint covers.

use ltk_hash::BinHash;
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_base::hashing::named;
use serde::Serialize;

use super::MapPath;
use super::component::container_fields;
use super::flags::flag_bits;
use super::variants::{CONTAINER_LINK, MAP_SKIN, SKIN_NAME};
use ltk_manager_bin::bin_document::{
    AssetLookup, BinDocument, Fields, Locator, RowNames, fields_of, items, leaf, text, vector2,
};
use ltk_meta::walk::Leaf;

/// `MapSkin.mGrassTintTexture`.
const GRASS_TINT: BinHash = named("mGrassTintTexture");
/// `MapSkin.mAlternateAssets`, an embedded `MapAlternateAssets`, and the list inside it.
const ALTERNATE_ASSETS: BinHash = named("mAlternateAssets");
/// `MapAlternateAsset.mGrassTintTextureName`.
const ALTERNATE_TINT: BinHash = named("mGrassTintTextureName");
/// `MapAlternateAsset.mVisibilityFlagName`, the `name` hash of a flag definition.
const ALTERNATE_FLAG: BinHash = named("mVisibilityFlagName");
/// `MapContainer.boundsMin`. A bin leaves it out at its class default of zero.
const BOUNDS_MIN: BinHash = named("boundsMin");
/// `MapContainer.boundsMax`.
const BOUNDS_MAX: BinHash = named("boundsMax");

/// The grass tint texture of one `MapSkin`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapGrassTint {
    /// The `MapSkin`'s `name`.
    pub skin: String,
    pub texture: AssetRef,
    /// The skin's alternate tints, in file order. The first one whose flag is on replaces
    /// `texture`.
    pub alternates: Vec<MapGrassAlternate>,
}

/// The grass tint of one `MapAlternateAsset`, and the visibility flag that turns it on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapGrassAlternate {
    /// The layer bit of the flag, 0 to 7.
    pub bit: u8,
    pub texture: AssetRef,
}

/// The world rectangle on X and Z that a map-wide texture covers, in engine units.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapBounds {
    pub min: [f32; 2],
    pub max: [f32; 2],
}

/// Returns the grass tint of every `MapSkin` of `map_bin` that links `map`, in file order.
///
/// A link matches `map` in any case, because a path read off a WAD listing is lowercase
/// while the bin writes `Maps/MapGeometry/Map11/Base_SRX`. Skips a skin that states no tint
/// and a skin whose texture `assets` cannot locate.
#[must_use]
pub fn map_grass_tints(
    map_bin: &BinDocument,
    map: &MapPath,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
) -> Vec<MapGrassTint> {
    let locator = Locator { names, assets };
    let bits = flag_bits(map_bin);
    map_bin
        .entries()
        .filter_map(|entry| map_bin.object_at(entry))
        .filter(|object| object.class_hash == MAP_SKIN)
        .filter(|object| {
            text(object.properties.get(&CONTAINER_LINK))
                .is_some_and(|link| link.eq_ignore_ascii_case(map.as_str()))
        })
        .filter_map(|object| {
            let fields = &object.properties;
            let texture = locator.asset(fields.get(&GRASS_TINT))?.asset?;
            Some(MapGrassTint {
                skin: text(fields.get(&SKIN_NAME)).unwrap_or_default().to_owned(),
                texture,
                alternates: alternates(fields, &bits, &locator),
            })
        })
        .collect()
}

/// Returns the alternate tints of the skin `fields`. Skips an alternate whose flag `bits` does
/// not name or whose texture `locator` cannot locate.
fn alternates(
    fields: &Fields,
    bits: &[(BinHash, u8)],
    locator: &Locator,
) -> Vec<MapGrassAlternate> {
    let listed = fields_of(fields.get(&ALTERNATE_ASSETS))
        .map(|assets| items(assets.get(&ALTERNATE_ASSETS)))
        .unwrap_or_default();

    listed
        .iter()
        .filter_map(|alternate| {
            let fields = fields_of(Some(alternate))?;
            let Leaf::Hash(flag) = leaf(fields.get(&ALTERNATE_FLAG))? else {
                return None;
            };
            let flag = flag.try_as_bin_hash()?;
            let bit = bits.iter().find(|(name, _)| *name == flag)?.1;

            Some(MapGrassAlternate {
                bit,
                texture: locator.asset(fields.get(&ALTERNATE_TINT))?.asset?,
            })
        })
        .collect()
}

/// Returns `MapContainer.boundsMin` and `boundsMax` of `map`'s container.
///
/// Returns `None` if the file declares no container or the container states no `boundsMax`.
#[must_use]
pub fn map_bounds(materials: &BinDocument, map: &MapPath) -> Option<MapBounds> {
    let fields = container_fields(materials, map)?;
    Some(MapBounds {
        min: vector2(fields.get(&BOUNDS_MIN)).unwrap_or_default(),
        max: vector2(fields.get(&BOUNDS_MAX))?,
    })
}

#[cfg(test)]
mod tests;
