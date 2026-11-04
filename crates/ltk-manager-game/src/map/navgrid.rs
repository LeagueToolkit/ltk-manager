//! The navigation grid of a map, its overlays and the colors that the map's `NavGridConfig`
//! gives its cells. docs/plans/navgrid-guides.md, sections 1.2 and 3.1.

use bitflags::Flags as _;
use ltk_hash::{BinHash, Hash as _, fnv1};
use ltk_manager_assets::preview::{AssetRef, PreviewError};
use ltk_manager_base::error::{AppError, AppResult};
use ltk_manager_base::hashing::named;
use ltk_navgrid::{CellFlags, NavGrid, NavGridOverlay, RegionOverlay};
use serde::{Deserialize, Serialize};

use super::MapPath;
use super::component::map_component;
use super::flags::{MapFlag, map_flags};
use super::variants::{CONTAINER_LINK, MAP_SKIN};
use ltk_manager_bin::bin_document::{
    AssetLookup, BinDocument, Fields, RowNames, boolean, color, fields_of, hex, items, leaf, link,
    text, unsigned,
};
use ltk_meta::PropertyValueEnum;
use ltk_meta::walk::Leaf;

const MAP_NAV_GRID: BinHash = named("MapNavGrid");
/// `MapNavGrid.NavGridPath`, an `ASSETS/` file path.
const NAV_GRID_PATH: BinHash = named("NavGridPath");
/// `MapNavGrid.NavGridConfig`, a link to a `NavGridConfig`.
const NAV_GRID_CONFIG: BinHash = named("NavGridConfig");
/// `MapNavGridOverlaysComponent`, `0xcf4a55da`.
const OVERLAYS_COMPONENT: BinHash = named("MapNavGridOverlaysComponent");
/// `MapNavGridOverlaysComponent.overlays`, a link to a `MapNavGridOverlays`, and
/// `MapNavGridOverlays.overlays`, the list of `MapNavGridOverlay`.
const OVERLAYS: BinHash = named("overlays");
/// `MapNavGridOverlay.name`, `NavGridTerrainTagDefinition.name` and
/// `NavGridRegionTagDefinition.name`.
const NAME: BinHash = named("name");
/// `MapNavGridOverlay.navGridFileName`, the `.ngrid_overlay` of the overlay.
const FLAGS_FILE: BinHash = named("navGridFileName");
/// `MapNavGridOverlay.regionsFilename`, the `.rg_overlay` of the overlay.
const REGIONS_FILE: BinHash = named("regionsFilename");
/// `NavGridConfig.TerrainConfig`, a link to a `NavGridTerrainConfig`.
const TERRAIN_CONFIG: BinHash = named("TerrainConfig");
/// `NavGridTerrainConfig.tags` and `NavGridRegionGroupDefinition.tags`.
const TAGS: BinHash = named("tags");
/// `NavGridTerrainTagDefinition.flags`, a `u16`.
const FLAGS: BinHash = named("flags");
const COLOR: BinHash = named("Color");
/// `NavGridConfig.RegionGroups`, a list of `NavGridRegionGroupDefinition`.
const REGION_GROUPS: BinHash = named("RegionGroups");
const GROUP_NAME: BinHash = named("groupName");
const IS_GAMEPLAY_GROUP: BinHash = named("IsGameplayGroup");
const ERROR_COLOR: BinHash = named("ErrorColor");
/// `MapSkin.mNavigationMesh`, an `ASSETS/` file path.
const NAVIGATION_MESH: BinHash = named("mNavigationMesh");

/// The color of a tag that omits `Color`.
const DEFAULT_COLOR: [u8; 4] = [0, 0, 0, 255];
/// The `ErrorColor` of a config that omits it.
const DEFAULT_ERROR_COLOR: [u8; 4] = [0, 0, 255, 255];
/// The prefix of the visibility flag name whose FNV-1a an overlay's `name` is.
const OVERLAY_NAME_PREFIX: &str = "NavGrid_";

/// The navigation grid of a map and the data that colors it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapNavGridModel {
    /// The grid that the guide draws. The container's grid comes first, else the skin's.
    pub grid: AssetRef,
    /// The component that names `grid`.
    pub source: NavGridSource,
    /// The skin's grid, if it is a file other than `grid`.
    pub skin_grid: Option<AssetRef>,
    /// The overlays of the container, in list order.
    pub overlays: Vec<MapNavGridOverlay>,
    /// The terrain tags of the `NavGridConfig`, in list order.
    pub terrain_tags: Vec<NavTerrainTag>,
    /// The region groups of the `NavGridConfig`, in list order.
    pub region_groups: Vec<NavRegionGroup>,
    /// The color of a cell that no tag matches.
    pub error_color: [u8; 4],
}

/// The component of a map that names a navigation grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum NavGridSource {
    /// `MapNavGrid.NavGridPath` of the `MapContainer`.
    Container,
    /// `mNavigationMesh` of a `MapSkin` that links the container.
    Skin,
}

impl std::fmt::Display for NavGridSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Container => "container",
            Self::Skin => "skin",
        })
    }
}

/// One overlay of a map: a flag overlay file and a region overlay file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct MapNavGridOverlay {
    /// The file stem of `navGridFileName`, such as `NavGrid_Ocean_SEASONAL`, else the file stem
    /// of `regionsFilename`, else the hash of the overlay's `name` in hex. Empty if the overlay
    /// has none of the three.
    pub label: String,
    /// The visibility flag bit whose `NavGrid_` name the overlay's `name` is.
    pub flag_bit: Option<u8>,
    /// The `.ngrid_overlay`. `None` if the path is empty or resolves no file.
    pub flags: Option<AssetRef>,
    /// The `.rg_overlay`. `None` if the path is empty or resolves no file.
    pub regions: Option<AssetRef>,
}

/// One terrain tag of a `NavGridConfig`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct NavTerrainTag {
    /// The resolved tag name, else the `CellFlags` constant for `flags`, else the hash in hex.
    pub name: String,
    /// The cell flag bits that the tag matches.
    pub flags: u16,
    /// Red, green, blue and alpha.
    pub color: [u8; 4],
}

/// One region group of a `NavGridConfig`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NavRegionGroup {
    /// `groupName`.
    pub name: String,
    /// FNV-1 of the lowercased name, as the grid stores it.
    pub name_hash: u32,
    /// `IsGameplayGroup`.
    pub gameplay: bool,
    /// The tags of the group, in list order.
    pub tags: Vec<NavRegionTag>,
}

/// One region tag of a region group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NavRegionTag {
    /// `name` of the `NavGridRegionTagDefinition`.
    pub name: String,
    /// FNV-1 of the lowercased name, as the grid stores it.
    pub name_hash: u32,
    /// Red, green, blue and alpha.
    pub color: [u8; 4],
}

/// Returns the navigation grid of `map` and the data that colors it.
///
/// Reads the `MapNavGrid` and `MapNavGridOverlaysComponent` of the container in `materials`.
/// Resolves each link in `materials`, else in `map_bin`, the bin of the map's `Map` object.
/// `map_bin` also holds the skins and the visibility flags, so without it no skin grid is read
/// and no overlay has a `flag_bit`. The skin grid is the grid of the first `MapSkin` of `map_bin`
/// that links `map`. Returns `None` if neither the container nor a skin names a grid that
/// `assets` locates.
#[must_use]
pub fn map_nav_grid(
    materials: &BinDocument,
    map_bin: Option<&BinDocument>,
    map: &MapPath,
    names: &dyn RowNames,
    assets: &dyn AssetLookup,
) -> Option<MapNavGridModel> {
    let bins: Vec<&BinDocument> = std::iter::once(materials).chain(map_bin).collect();
    let component = map_component(materials, map, MAP_NAV_GRID);

    let container_grid = component
        .and_then(|fields| text(fields.get(&NAV_GRID_PATH)))
        .filter(|path| !path.is_empty())
        .and_then(|path| assets.locate(path));
    let skin_grid = map_bin
        .and_then(|bin| skin_grid_path(bin, map))
        .and_then(|path| assets.locate(path));
    let (grid, source, skin_grid) = match (container_grid, skin_grid) {
        (Some(grid), skin) => {
            let skin = skin.filter(|skin| *skin != grid);
            (grid, NavGridSource::Container, skin)
        }
        (None, Some(skin)) => (skin, NavGridSource::Skin, None),
        (None, None) => return None,
    };

    let flags = map_bin.map(map_flags).unwrap_or_default();
    let overlays = map_component(materials, map, OVERLAYS_COMPONENT)
        .and_then(|fields| linked(&bins, fields.get(&OVERLAYS)))
        .map(|list| {
            items(list.get(&OVERLAYS))
                .iter()
                .filter_map(|overlay| fields_of(Some(overlay)))
                .map(|fields| overlay(fields, &flags, assets))
                .collect()
        })
        .unwrap_or_default();

    let config = component.and_then(|fields| linked(&bins, fields.get(&NAV_GRID_CONFIG)));
    let terrain_tags = config
        .and_then(|config| linked(&bins, config.get(&TERRAIN_CONFIG)))
        .map(|terrain| {
            items(terrain.get(&TAGS))
                .iter()
                .filter_map(|tag| fields_of(Some(tag)))
                .filter_map(|fields| terrain_tag(fields, names))
                .collect()
        })
        .unwrap_or_default();
    let region_groups = config
        .map(|config| {
            items(config.get(&REGION_GROUPS))
                .iter()
                .filter_map(|group| fields_of(Some(group)))
                .map(region_group)
                .collect()
        })
        .unwrap_or_default();
    let error_color = config
        .and_then(|config| color(config.get(&ERROR_COLOR)))
        .unwrap_or(DEFAULT_ERROR_COLOR);

    Some(MapNavGridModel {
        grid,
        source,
        skin_grid,
        overlays,
        terrain_tags,
        region_groups,
        error_color,
    })
}

/// Reads the grid of `source` of `model` and applies the overlays at the indices `overlays_on`
/// of `model.overlays`.
///
/// The overlays apply in the order of `model.overlays`, the flag overlay of each before its
/// region overlay (docs/plans/navgrid-guides.md, section 3.4). `read` returns the bytes of a file.
///
/// # Errors
///
/// Fails if `model` has no grid of `source`, if an index of `overlays_on` is not an index of
/// `model.overlays`, if `read` fails, or if a file does not read as its kind.
pub fn compose_nav_grid(
    model: &MapNavGridModel,
    source: NavGridSource,
    overlays_on: &[u32],
    mut read: impl FnMut(&AssetRef) -> AppResult<Vec<u8>>,
) -> AppResult<NavGrid> {
    let grid = if source == model.source {
        &model.grid
    } else {
        model.skin_grid.as_ref().ok_or_else(|| {
            AppError::ValidationFailed(format!("The map has no {source} navigation grid"))
        })?
    };

    let count = model.overlays.len();
    if let Some(index) = overlays_on
        .iter()
        .find(|index| !usize::try_from(**index).is_ok_and(|at| at < count))
    {
        return Err(AppError::ValidationFailed(format!(
            "Overlay {index} is not an overlay of the map, which has {count} overlays"
        )));
    }

    let mut composed = NavGrid::from_reader(&mut &read(grid)?[..]).map_err(PreviewError::from)?;
    for (index, overlay) in (0u32..).zip(&model.overlays) {
        if !overlays_on.contains(&index) {
            continue;
        }

        if let Some(flags) = &overlay.flags {
            let flags =
                NavGridOverlay::from_reader(&mut &read(flags)?[..]).map_err(PreviewError::from)?;
            composed.apply_overlay(&flags);
        }
        if let Some(regions) = &overlay.regions {
            let regions =
                RegionOverlay::from_reader(&mut &read(regions)?[..]).map_err(PreviewError::from)?;
            composed.apply_region_overlay(&regions);
        }
    }

    Ok(composed)
}

/// Returns `mNavigationMesh` of the first `MapSkin` of `map_bin` that links `map` and names a
/// grid, in file order.
fn skin_grid_path<'a>(map_bin: &'a BinDocument, map: &MapPath) -> Option<&'a str> {
    map_bin
        .entries()
        .filter_map(|entry| map_bin.object_at(entry))
        .filter(|object| object.class_hash == MAP_SKIN)
        .filter(|object| {
            text(object.properties.get(&CONTAINER_LINK))
                .is_some_and(|link| link.eq_ignore_ascii_case(map.as_str()))
        })
        .find_map(|object| {
            text(object.properties.get(&NAVIGATION_MESH)).filter(|path| !path.is_empty())
        })
}

/// Returns the fields of the object that `value` links to, from the first of `bins` that
/// declares it.
fn linked<'a>(bins: &[&'a BinDocument], value: Option<&PropertyValueEnum>) -> Option<&'a Fields> {
    let entry = link(value)?;
    bins.iter()
        .find_map(|bin| bin.object_at(entry))
        .map(|object| &object.properties)
}

/// Reads one `MapNavGridOverlay`.
fn overlay(fields: &Fields, flags: &[MapFlag], assets: &dyn AssetLookup) -> MapNavGridOverlay {
    let path = |field: BinHash| text(fields.get(&field)).filter(|path| !path.is_empty());
    let name = hash_of(fields.get(&NAME));
    let flag_bit = name.and_then(|name| {
        flags
            .iter()
            .find(|flag| BinHash::hash_str(format!("{OVERLAY_NAME_PREFIX}{}", flag.name)) == name)
            .map(|flag| flag.bit)
    });
    let label = path(FLAGS_FILE)
        .or_else(|| path(REGIONS_FILE))
        .map(|path| file_stem(path).to_owned())
        .or_else(|| name.map(hex))
        .unwrap_or_default();

    MapNavGridOverlay {
        label,
        flag_bit,
        flags: path(FLAGS_FILE).and_then(|path| assets.locate(path)),
        regions: path(REGIONS_FILE).and_then(|path| assets.locate(path)),
    }
}

/// Reads one `NavGridTerrainTagDefinition`. A tag without `flags` has the flags 0.
///
/// Returns `None` if `flags` is not an integer that fits a `u16`, because the tag then matches
/// no cell that the grid can store.
fn terrain_tag(fields: &Fields, names: &dyn RowNames) -> Option<NavTerrainTag> {
    let flags = match fields.get(&FLAGS) {
        None => 0,
        Some(value) => u16::try_from(unsigned(Some(value))?).ok()?,
    };
    let hash = hash_of(fields.get(&NAME));
    let name = hash
        .and_then(|hash| names.value_name(hash))
        .or_else(|| flags_name(flags).map(str::to_owned))
        .or_else(|| hash.map(hex))
        .unwrap_or_default();

    Some(NavTerrainTag {
        name,
        flags,
        color: color(fields.get(&COLOR)).unwrap_or(DEFAULT_COLOR),
    })
}

/// Reads one `NavGridRegionGroupDefinition`.
fn region_group(fields: &Fields) -> NavRegionGroup {
    let name = text(fields.get(&GROUP_NAME)).unwrap_or_default();
    let tags = items(fields.get(&TAGS))
        .iter()
        .filter_map(|tag| fields_of(Some(tag)))
        .map(|tag| {
            let name = text(tag.get(&NAME)).unwrap_or_default();
            NavRegionTag {
                name: name.to_owned(),
                name_hash: fnv1::hash_lower(name),
                color: color(tag.get(&COLOR)).unwrap_or(DEFAULT_COLOR),
            }
        })
        .collect();

    NavRegionGroup {
        name: name.to_owned(),
        name_hash: fnv1::hash_lower(name),
        gameplay: boolean(fields.get(&IS_GAMEPLAY_GROUP)).unwrap_or(false),
        tags,
    }
}

/// Returns the name of the `CellFlags` constant whose value is `flags`.
fn flags_name(flags: u16) -> Option<&'static str> {
    CellFlags::FLAGS
        .iter()
        .find(|flag| !flag.name().is_empty() && flag.value().bits() == flags)
        .map(|flag| flag.name())
}

/// Returns the `Hash` that `value` holds as a bin hash.
fn hash_of(value: Option<&PropertyValueEnum>) -> Option<BinHash> {
    match leaf(value)? {
        Leaf::Hash(hash) => hash.try_as_bin_hash(),
        _ => None,
    }
}

/// Returns the file name of `path` without its directory and its last extension.
fn file_stem(path: &str) -> &str {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

#[cfg(test)]
mod tests;
