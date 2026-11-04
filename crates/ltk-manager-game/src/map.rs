//! What a map gives a preview: the materials its submeshes name, the visibility
//! controllers it declares, the particles and characters it stands, and which map an
//! object of a map's own classes draws.
//!
//! A map's geometry rides the `ltk-asset` scheme as one `LTKM` buffer and never crosses
//! IPC, so this module answers only the other half, which is the `StaticMaterialDef`
//! behind each material path that buffer carries. Both of a map's files derive from one
//! [`MapPath`] (ADR-0044).

use std::fmt;

use serde::{Deserialize, Serialize};

use ltk_hash::{BinHash, Hash as _};
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_bin::bin_document::{AssetLookup, BinDocument, RowNames};

use crate::material::{MaterialPreview, resolve_material};

mod characters;
mod component;
mod conformance;
mod controllers;
mod custom_skin;
#[cfg(test)]
mod fixtures;
mod flags;
mod grass;
mod lighting;
mod navgrid;
mod outline;
mod particles;
mod placeable;
mod post_effects;
mod references;
mod ssao;
mod sun;
mod variants;

pub use characters::{MapCharacter, map_characters};
pub use conformance::{ConformanceArea, ConformanceKind, Ground, ShownMeshes, conformance_areas};
pub use controllers::{MapController, MapControllerRule, MapParentMode, map_controllers};
pub use custom_skin::{
    MapSkinContainer, custom_skin_path, map_skin_containers, moved_container, shipping_bin_path,
    skin_link_declarations, state_meshes,
};
pub use flags::{MapFlag, map_bin_path, map_flags};
pub use grass::{MapBounds, MapGrassAlternate, MapGrassTint, map_bounds, map_grass_tints};
pub use lighting::light_grid_path;
pub use navgrid::{
    MapNavGridModel, MapNavGridOverlay, NavGridSource, NavRegionGroup, NavRegionTag, NavTerrainTag,
    compose_nav_grid, map_nav_grid,
};
pub use outline::{MapChunk, MapChunkItem, MapItemKind, MapItemShape, map_outline};
pub use particles::{MapParticle, map_particles};
pub use post_effects::{MapDepthOfField, MapFog, MapPostEffects, map_post_effects};
pub use references::{MapNameReference, map_name_references};
pub use ssao::{MapSsao, map_ssao};
pub use sun::{MapSun, map_sun};
pub use variants::{MapVariant, map_variants};

/// Where the game reads a map's files from, under the entry path its container names.
const DATA_PREFIX: &str = "data/";
/// The suffix a map's materials live under.
const MATERIALS_SUFFIX: &str = ".materials.bin";
/// The suffix a map's geometry lives under.
const GEOMETRY_SUFFIX: &str = ".mapgeo";

/// Where a map lives, as `MapContainer.mapPath` states it.
///
/// An entry path rather than a file path, such as `Maps/MapGeometry/Map11/Base_SRX`. It
/// names no file of its own: each of a map's files is this path lowercased under the
/// data prefix with that file's suffix, which is the one spelling a resolved WAD path
/// has.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapPath(String);

impl MapPath {
    /// The file this map's materials live in.
    #[must_use]
    pub fn materials(&self) -> String {
        self.file(MATERIALS_SUFFIX)
    }

    /// The file this map's geometry lives in, which the scheme answers as one buffer.
    #[must_use]
    pub fn geometry(&self) -> String {
        self.file(GEOMETRY_SUFFIX)
    }

    /// The entry path as it was given, in the spelling a bin carries.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn file(&self, suffix: &str) -> String {
        format!("{DATA_PREFIX}{}{suffix}", self.0.to_lowercase())
    }
}

impl From<String> for MapPath {
    fn from(path: String) -> Self {
        Self(path)
    }
}

impl From<&str> for MapPath {
    fn from(path: &str) -> Self {
        Self(path.to_owned())
    }
}

impl fmt::Display for MapPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Where the two files of one map live, each none where nothing holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapFiles {
    /// The `.mapgeo`, which the scheme answers as one buffer.
    pub geometry: Option<AssetRef>,
    /// The `.materials.bin`, which declares the materials and the chunks.
    pub materials: Option<AssetRef>,
}

/// One map's materials, one per path asked for and in that order, its visibility controllers, and
/// its lighting and screen effects.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapModel {
    /// Null where the map's own bin declares no object at that path, which a backdrop
    /// draws flat rather than not at all.
    pub materials: Vec<Option<MaterialPreview>>,
    /// Every visibility controller that the map's `.materials.bin` declares. A mesh of the
    /// `LTKM` buffer and a placeable reference a controller by its path hash.
    pub controllers: Vec<MapController>,
    /// The visibility flags that the map's `Map` object names. Empty if nothing holds that
    /// object or it names none.
    pub flags: Vec<MapFlag>,
    /// Null where the map's container states no sun, which a backdrop lights with a default.
    pub sun: Option<MapSun>,
    /// Null where the map's container states no post effects, which no shipped map does.
    pub post_effects: Option<MapPostEffects>,
    /// Null where the map's container states no ambient occlusion, as all but one shipped map.
    pub ssao: Option<MapSsao>,
    /// The `LightGrid.dat` the map lights its characters with, and null where it bakes
    /// none or nothing holds it.
    pub light_grid: Option<AssetRef>,
    /// The grass tint of each skin that links the map, in file order. Empty until the caller
    /// reads the map's own bin, which holds the skins.
    pub grass_tints: Vec<MapGrassTint>,
    /// Null where the map's container states no bounds.
    pub bounds: Option<MapBounds>,
    /// Null where neither the map's container nor a skin names a navigation grid that resolves.
    /// The skin grid and the overlay flag bits stay empty until the caller reads the map's own
    /// bin.
    pub nav_grid: Option<MapNavGridModel>,
}

/// The materials `paths` name, the visibility controllers, the lighting and screen effects and the
/// navigation grid of `map`, read out of its own `.materials.bin`.
///
/// `paths` are the entry paths an `LTKM` buffer's string table carries, so the two sides
/// join on the string itself and neither hashes on the other's behalf. `shaders` is
/// `data/shaders/shaders.bin`, without which every slot is read off the material's own
/// fields.
#[must_use]
pub fn resolve_map(
    materials: &BinDocument,
    map: &MapPath,
    paths: &[String],
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
    shaders: Option<&BinDocument>,
) -> MapModel {
    MapModel {
        materials: paths
            .iter()
            .map(|path| {
                resolve_material(materials, BinHash::hash_str(path), names, assets, shaders).ok()
            })
            .collect(),
        controllers: map_controllers(materials, names),
        flags: Vec::new(),
        sun: map_sun(materials, map),
        post_effects: map_post_effects(materials, map),
        ssao: map_ssao(materials, map),
        light_grid: light_grid_path(materials, map).and_then(|path| assets.locate(path)),
        grass_tints: Vec::new(),
        bounds: map_bounds(materials, map),
        nav_grid: map_nav_grid(materials, None, map, names, assets),
    }
}

/// A map with every material unresolved and no controllers, lighting or screen effects, drawn
/// flat.
#[must_use]
pub fn unresolved_map(paths: &[String]) -> MapModel {
    MapModel {
        materials: paths.iter().map(|_| None).collect(),
        controllers: Vec::new(),
        flags: Vec::new(),
        sun: None,
        post_effects: None,
        ssao: None,
        light_grid: None,
        grass_tints: Vec::new(),
        bounds: None,
        nav_grid: None,
    }
}

#[cfg(test)]
mod tests;
