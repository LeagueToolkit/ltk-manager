//! The baked light grid a map lights its characters with: the `MapBakeProperties`
//! component of its `MapContainer`.

use ltk_hash::BinHash;

use super::MapPath;
use super::component::map_component;
use ltk_manager_core::bin_document::{BinDocument, text};

/// `MapBakeProperties`.
const BAKE_PROPERTIES: BinHash = BinHash(0x6a4a_3409);
/// `MapBakeProperties.lightGridFileName`, an `ASSETS/` file path.
const LIGHT_GRID_FILE_NAME: BinHash = BinHash(0x7561_b09e);

/// The `LightGrid.dat` `map`'s container bakes, as the bin spells its path.
///
/// None where the container sets no grid, which every container of Summoner's Rift does.
#[must_use]
pub fn light_grid_path<'a>(materials: &'a BinDocument, map: &MapPath) -> Option<&'a str> {
    map_component(materials, map, BAKE_PROPERTIES)
        .and_then(|fields| text(fields.get(&LIGHT_GRID_FILE_NAME)))
        .filter(|path| !path.is_empty())
}

#[cfg(test)]
mod tests;
