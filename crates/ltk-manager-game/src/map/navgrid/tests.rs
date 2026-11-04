use std::path::PathBuf;

use ltk_hash::WadHash;
use ltk_meta::BinObject;
use ltk_meta::property::{Kind, values};

use super::*;
use crate::map::fixtures::{document_of, embedded, h, map_container, placeable};

const BASE_SRX: &str = "Maps/MapGeometry/Map11/Base_SRX";
const CONTAINER_GRID: &str = "ASSETS/Maps/NavGrid/Map11/AIPath_SRX_3.aimesh_ngrid";
const SKIN_GRID: &str = "ASSETS/Maps/NavGrid/Map11/AIPath.aimesh_ngrid";
const OCEAN_FLAGS: &str = "ASSETS/Maps/NavGrid/NavGrid_Ocean_SEASONAL.ngrid_overlay";
const OCEAN_REGIONS: &str = "ASSETS/Maps/NavGrid/Map90/Regions_ocean.rg_overlay";
const CUP_FLAGS: &str = "ASSETS/Maps/NavGrid/NavGrid_Cup_Base.ngrid_overlay";
const CONFIG: &str = "Maps/Shipping/Map11/NavGridConfig";
const TERRAIN: &str = "Maps/Shipping/Map11/NavGridTerrainConfig";
const OVERLAY_LIST: &str = "Maps/Shipping/Map11/NavGridOverlays";

/// Locates every path but the ones it holds, as a file named by the path's hash.
struct AllBut(&'static [&'static str]);

impl AssetLookup for AllBut {
    fn locate(&self, path: &str) -> Option<AssetRef> {
        (!self.0.contains(&path)).then(|| located(path))
    }
}

fn located(path: &str) -> AssetRef {
    AssetRef::File {
        path: format!("{:016x}", WadHash::hash_str(path).0),
    }
}

fn string(text: &str) -> PropertyValueEnum {
    values::String::from(text).into()
}

fn object_link(entry: &str) -> PropertyValueEnum {
    values::ObjectLink::new(h(entry)).into()
}

fn rgba(channels: [u8; 4]) -> PropertyValueEnum {
    let [r, g, b, a] = channels;
    values::Color::new(ltk_primitives::Color { r, g, b, a }).into()
}

fn list(items: Vec<PropertyValueEnum>) -> PropertyValueEnum {
    values::Container::new(Kind::Embedded, items)
        .unwrap()
        .into()
}

fn object(entry: &str, class: &str, properties: Vec<(BinHash, PropertyValueEnum)>) -> BinObject {
    properties
        .into_iter()
        .fold(
            BinObject::builder(h(entry), h(class)),
            |object, (field, value)| object.property(field, value),
        )
        .build()
}

fn container(grid: Option<&str>) -> BinObject {
    let mut nav_grid = vec![(NAV_GRID_CONFIG, object_link(CONFIG))];
    if let Some(grid) = grid {
        nav_grid.push((NAV_GRID_PATH, string(grid)));
    }
    map_container(
        BASE_SRX,
        vec![
            placeable("MapNavGrid", nav_grid),
            placeable(
                "MapNavGridOverlaysComponent",
                vec![(OVERLAYS, object_link(OVERLAY_LIST))],
            ),
        ],
    )
}

fn overlay_entry(name: &str, flags: &str, regions: &str) -> PropertyValueEnum {
    embedded(
        "MapNavGridOverlay",
        vec![
            (NAME, values::Hash::new(h(name)).into()),
            (FLAGS_FILE, string(flags)),
            (REGIONS_FILE, string(regions)),
        ],
    )
}

fn overlay_list() -> BinObject {
    object(
        OVERLAY_LIST,
        "MapNavGridOverlays",
        vec![(
            OVERLAYS,
            list(vec![
                overlay_entry("NavGrid_Ocean", OCEAN_FLAGS, OCEAN_REGIONS),
                overlay_entry("NavGrid_Cup", CUP_FLAGS, ""),
            ]),
        )],
    )
}

fn config() -> BinObject {
    let tag = |name: &str, color: Option<[u8; 4]>| {
        let mut fields = vec![(NAME, string(name))];
        if let Some(color) = color {
            fields.push((COLOR, rgba(color)));
        }
        embedded("NavGridRegionTagDefinition", fields)
    };
    let group = embedded(
        "NavGridRegionGroupDefinition",
        vec![
            (GROUP_NAME, string("GameplayArea")),
            (IS_GAMEPLAY_GROUP, values::Bool::new(true).into()),
            (
                TAGS,
                list(vec![
                    tag("AREA_Platform", None),
                    tag("AREA_Base", Some([255, 255, 255, 255])),
                ]),
            ),
        ],
    );
    object(
        CONFIG,
        "NavGridConfig",
        vec![
            (TERRAIN_CONFIG, object_link(TERRAIN)),
            (REGION_GROUPS, list(vec![group])),
        ],
    )
}

fn terrain_config() -> BinObject {
    let tag = |name: &str, flags: Option<u16>, color: Option<[u8; 4]>| {
        let mut fields = vec![(NAME, values::Hash::new(h(name)).into())];
        if let Some(flags) = flags {
            fields.push((FLAGS, values::U16::new(flags).into()));
        }
        if let Some(color) = color {
            fields.push((COLOR, rgba(color)));
        }
        embedded("NavGridTerrainTagDefinition", fields)
    };
    object(
        TERRAIN,
        "NavGridTerrainConfig",
        vec![(
            TAGS,
            list(vec![
                tag("Walkable", None, Some([0, 255, 0, 255])),
                tag("Wall", Some(2), None),
                tag("Unknown", Some(0x80), None),
            ]),
        )],
    )
}

fn map_object(flags: &[(&str, u8)]) -> BinObject {
    let definitions = flags
        .iter()
        .map(|(name, bit)| {
            embedded(
                "MapVisibilityFlagDefinition",
                vec![
                    (named("PublicName"), string(name)),
                    (named("BitIndex"), values::U8::new(*bit).into()),
                ],
            )
        })
        .collect();
    let defines = embedded(
        "MapVisibilityFlagDefinitions",
        vec![(named("FlagDefinitions"), list(definitions))],
    );
    object(
        "Maps/Shipping/Map11",
        "Map",
        vec![(named("VisibilityFlagDefines"), defines)],
    )
}

fn skin(name: &str, link: &str, grid: &str) -> BinObject {
    object(
        &format!("Maps/Shipping/Map11/MapSkins/{name}"),
        "MapSkin",
        vec![
            (CONTAINER_LINK, string(link)),
            (NAVIGATION_MESH, string(grid)),
        ],
    )
}

/// Tables that name the hash of `Walkable`, and nothing else.
struct Tables;

impl RowNames for Tables {
    fn for_each_entry(&self, _: &[BinHash], _: &mut dyn FnMut(usize, &str)) {}

    fn for_each_class(&self, _: &[BinHash], _: &mut dyn FnMut(usize, &str)) {}

    fn for_each_field(&self, _: &[BinHash], _: &mut dyn FnMut(usize, &str)) {}

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if *hash == h("Walkable") {
                visit(at, "Walkable");
            }
        }
    }

    fn for_each_chunk(&self, _: &[WadHash], _: &mut dyn FnMut(usize, &str)) {}
}

#[test]
fn every_hash_is_its_name() {
    assert_eq!(OVERLAYS_COMPONENT, BinHash(0xcf4a_55da));
    assert_eq!(NAV_GRID_CONFIG, BinHash(0xbdc9_0544));
    assert_eq!(TERRAIN_CONFIG, BinHash(0x9a15_9fb8));
    assert_eq!(REGION_GROUPS, BinHash(0xc264_4f75));
    assert_eq!(IS_GAMEPLAY_GROUP, BinHash(0xec01_928c));
    assert_eq!(h("NavGrid_Ocean"), BinHash(0xf71b_8213));
}

#[test]
fn map_nav_grid_reads_container_grid_overlays_and_config() {
    let materials = document_of(vec![
        container(Some(CONTAINER_GRID)),
        overlay_list(),
        config(),
    ]);
    let map_bin = document_of(vec![
        map_object(&[("Infernal", 1), ("Ocean", 3)]),
        skin("Other", "Maps/MapGeometry/Map11/Arcade", CONTAINER_GRID),
        skin("Default", BASE_SRX, SKIN_GRID),
        terrain_config(),
    ]);

    let model = map_nav_grid(
        &materials,
        Some(&map_bin),
        &MapPath::from(BASE_SRX),
        &Tables,
        &AllBut(&[]),
    )
    .unwrap();

    assert_eq!(model.grid, located(CONTAINER_GRID));
    assert_eq!(model.source, NavGridSource::Container);
    assert_eq!(model.skin_grid, Some(located(SKIN_GRID)));
    assert_eq!(
        model.overlays,
        [
            MapNavGridOverlay {
                label: "NavGrid_Ocean_SEASONAL".to_owned(),
                flag_bit: Some(3),
                flags: Some(located(OCEAN_FLAGS)),
                regions: Some(located(OCEAN_REGIONS)),
            },
            MapNavGridOverlay {
                label: "NavGrid_Cup_Base".to_owned(),
                flag_bit: None,
                flags: Some(located(CUP_FLAGS)),
                regions: None,
            },
        ]
    );
    assert_eq!(
        model.terrain_tags,
        [
            NavTerrainTag {
                name: "Walkable".to_owned(),
                flags: 0,
                color: [0, 255, 0, 255],
            },
            NavTerrainTag {
                name: "WALL".to_owned(),
                flags: 2,
                color: DEFAULT_COLOR,
            },
            NavTerrainTag {
                name: hex(h("Unknown")),
                flags: 0x80,
                color: DEFAULT_COLOR,
            },
        ]
    );
    assert_eq!(
        model.region_groups,
        [NavRegionGroup {
            name: "GameplayArea".to_owned(),
            name_hash: fnv1::hash_lower("gameplayarea"),
            gameplay: true,
            tags: vec![
                NavRegionTag {
                    name: "AREA_Platform".to_owned(),
                    name_hash: fnv1::hash_lower("area_platform"),
                    color: DEFAULT_COLOR,
                },
                NavRegionTag {
                    name: "AREA_Base".to_owned(),
                    name_hash: fnv1::hash_lower("AREA_BASE"),
                    color: [255, 255, 255, 255],
                },
            ],
        }]
    );
    assert_eq!(model.error_color, DEFAULT_ERROR_COLOR);
}

#[test]
fn map_nav_grid_without_map_bin_reads_container_side_only() {
    let materials = document_of(vec![
        container(Some(CONTAINER_GRID)),
        overlay_list(),
        config(),
    ]);

    let model = map_nav_grid(
        &materials,
        None,
        &MapPath::from(BASE_SRX),
        &(),
        &AllBut(&[]),
    )
    .unwrap();

    assert_eq!(model.skin_grid, None);
    assert!(
        model
            .overlays
            .iter()
            .all(|overlay| overlay.flag_bit.is_none())
    );
    assert!(
        model.terrain_tags.is_empty(),
        "the terrain config is in no bin"
    );
    assert_eq!(model.region_groups.len(), 1);
}

#[test]
fn map_nav_grid_falls_back_to_skin_grid_without_container_grid() {
    let materials = document_of(vec![container(None)]);
    let map_bin = document_of(vec![skin("Default", BASE_SRX, SKIN_GRID)]);

    let model = map_nav_grid(
        &materials,
        Some(&map_bin),
        &MapPath::from(BASE_SRX),
        &(),
        &AllBut(&[]),
    )
    .unwrap();

    assert_eq!(model.grid, located(SKIN_GRID));
    assert_eq!(model.source, NavGridSource::Skin);
    assert_eq!(model.skin_grid, None);
}

#[test]
fn map_nav_grid_has_no_skin_grid_if_skin_names_container_grid() {
    let materials = document_of(vec![container(Some(CONTAINER_GRID))]);
    let map_bin = document_of(vec![skin("Default", BASE_SRX, CONTAINER_GRID)]);

    let model = map_nav_grid(
        &materials,
        Some(&map_bin),
        &MapPath::from(BASE_SRX),
        &(),
        &AllBut(&[]),
    )
    .unwrap();

    assert_eq!(model.skin_grid, None);
}

#[test]
fn map_nav_grid_is_none_if_no_grid_resolves() {
    let materials = document_of(vec![container(Some(CONTAINER_GRID))]);

    let model = map_nav_grid(
        &materials,
        None,
        &MapPath::from(BASE_SRX),
        &(),
        &AllBut(&[CONTAINER_GRID]),
    );

    assert_eq!(model, None);
}

#[test]
fn terrain_tag_is_skipped_if_flags_do_not_fit_u16() {
    let tag = |flags: PropertyValueEnum| {
        embedded(
            "NavGridTerrainTagDefinition",
            vec![(NAME, values::Hash::new(h("Wide")).into()), (FLAGS, flags)],
        )
    };
    let terrain = object(
        TERRAIN,
        "NavGridTerrainConfig",
        vec![(
            TAGS,
            list(vec![
                tag(values::U32::new(0x1_0000).into()),
                tag(values::I32::new(-1).into()),
                tag(values::U32::new(0x0002).into()),
            ]),
        )],
    );
    let materials = document_of(vec![container(Some(CONTAINER_GRID)), config(), terrain]);

    let model = map_nav_grid(
        &materials,
        None,
        &MapPath::from(BASE_SRX),
        &(),
        &AllBut(&[]),
    )
    .unwrap();

    assert_eq!(
        model
            .terrain_tags
            .iter()
            .map(|tag| tag.flags)
            .collect::<Vec<_>>(),
        [0x0002]
    );
}

/// Returns a model of the grid `CONTAINER_GRID` with an overlay per entry of `overlays`, each a
/// flag overlay path and a region overlay path.
fn composed_model(overlays: &[(&str, Option<&str>)]) -> MapNavGridModel {
    MapNavGridModel {
        grid: located(CONTAINER_GRID),
        source: NavGridSource::Container,
        skin_grid: None,
        overlays: overlays
            .iter()
            .map(|(flags, regions)| MapNavGridOverlay {
                label: file_stem(flags).to_owned(),
                flag_bit: None,
                flags: Some(located(flags)),
                regions: regions.map(located),
            })
            .collect(),
        terrain_tags: Vec::new(),
        region_groups: Vec::new(),
        error_color: DEFAULT_ERROR_COLOR,
    }
}

/// Returns the bytes of a flag overlay that sets cell `(0, 0)` to `flags`.
fn flag_overlay(flags: CellFlags) -> Vec<u8> {
    let overlay = NavGridOverlay {
        version: 1,
        rects: vec![ltk_navgrid::NavGridOverlayRect {
            width: 1,
            height: 1,
            flags: vec![flags],
            ..Default::default()
        }],
        trailing_byte: 0,
    };
    let mut bytes = Vec::new();
    overlay.to_writer(&mut bytes).unwrap();
    bytes
}

/// Returns a reader of the files of `files`, by path.
fn files(files: Vec<(&'static str, Vec<u8>)>) -> impl FnMut(&AssetRef) -> AppResult<Vec<u8>> {
    move |asset| {
        files
            .iter()
            .find(|(path, _)| located(path) == *asset)
            .map(|(_, bytes)| bytes.clone())
            .ok_or_else(|| AppError::ValidationFailed(format!("no file {asset:?}")))
    }
}

#[test]
fn compose_nav_grid_applies_overlays_on_in_list_order() {
    let model = composed_model(&[(OCEAN_FLAGS, Some(OCEAN_REGIONS)), (CUP_FLAGS, None)]);
    let regions = RegionOverlay {
        version: 1,
        rects: vec![ltk_navgrid::RegionOverlayRect {
            x: 1,
            y: 0,
            width: 1,
            height: 1,
            region_tags: vec![0x0000_0005],
        }],
    };
    let mut region_bytes = Vec::new();
    regions.to_writer(&mut region_bytes).unwrap();
    let read = files(vec![
        (
            CONTAINER_GRID,
            ltk_manager_assets::preview::nav_grid_file([2, 2], 50.0, [2, 2]),
        ),
        (OCEAN_FLAGS, flag_overlay(CellFlags::WALL)),
        (OCEAN_REGIONS, region_bytes),
        (CUP_FLAGS, flag_overlay(CellFlags::GRASS)),
    ]);

    let grid = compose_nav_grid(&model, NavGridSource::Container, &[1, 0], read).unwrap();

    assert_eq!(
        grid.cells()[0].flags,
        CellFlags::GRASS,
        "the later overlay wins"
    );
    assert_eq!(grid.cells()[1].region_tags, 5);
}

#[test]
fn compose_nav_grid_fails_on_overlay_index_outside_overlays() {
    let model = composed_model(&[(OCEAN_FLAGS, None)]);
    let read = files(vec![(
        CONTAINER_GRID,
        ltk_manager_assets::preview::nav_grid_file([2, 2], 50.0, [2, 2]),
    )]);

    let error = compose_nav_grid(&model, NavGridSource::Container, &[0, 1], read).unwrap_err();

    assert!(
        matches!(&error, AppError::ValidationFailed(message) if message.starts_with("Overlay 1 ")),
        "{error:?}"
    );
}

#[test]
fn compose_nav_grid_fails_with_source_name_if_source_has_no_grid() {
    let model = composed_model(&[]);

    let error = compose_nav_grid(&model, NavGridSource::Skin, &[], files(Vec::new())).unwrap_err();

    assert!(
        matches!(&error, AppError::ValidationFailed(message) if message.contains("skin")),
        "{error:?}"
    );
}

#[test]
fn flags_name_matches_whole_constant_only() {
    assert_eq!(flags_name(0x0003), Some("GRASS_WALL"));
    assert_eq!(flags_name(0x0042), Some("TRANSPARENT_WALL"));
    assert_eq!(
        flags_name(0x1840),
        Some("ONLY_PASSABLE_BY_TEAM_CHAOS_NEUTRAL_ZONE_VISIBILITY")
    );
    assert_eq!(flags_name(0), None);
    assert_eq!(flags_name(0x0080), None);
}

/// Returns the extracted game file at `relative` under the directory that `LTK_NAVGRID_DATA`
/// names. Returns `None` if the variable is not set.
fn game_file(relative: &str) -> Option<Vec<u8>> {
    let root = PathBuf::from(std::env::var_os("LTK_NAVGRID_DATA")?);
    Some(fs_err::read(root.join(relative)).unwrap())
}

/// Reads the Summoner's Rift bins that `LTK_NAVGRID_DATA` holds: `mapbin/data/...` as the
/// client extracts them.
#[test]
#[ignore = "reads the extracted Map11 bins that LTK_NAVGRID_DATA names"]
fn map_nav_grid_reads_base_srx_of_installed_client() {
    let (Some(materials), Some(map_bin)) = (
        game_file("mapbin/data/maps/mapgeometry/map11/base_srx.materials.bin"),
        game_file("mapbin/data/maps/shipping/map11/map11.bin"),
    ) else {
        panic!("LTK_NAVGRID_DATA is not set");
    };
    let materials = BinDocument::parse(materials).unwrap();
    let map_bin = BinDocument::parse(map_bin).unwrap();

    let model = map_nav_grid(
        &materials,
        Some(&map_bin),
        &MapPath::from(BASE_SRX),
        &(),
        &AllBut(&[]),
    )
    .unwrap();

    assert_eq!(model.grid, located(CONTAINER_GRID));
    assert_eq!(model.source, NavGridSource::Container);
    assert!(model.skin_grid.is_some());
    assert_eq!(model.overlays.len(), 8);
    let bits: Vec<_> = model
        .overlays
        .iter()
        .map(|overlay| (overlay.label.as_str(), overlay.flag_bit))
        .collect();
    assert_eq!(
        bits[..4],
        [
            ("NavGrid_Chemtech", Some(6)),
            ("NavGrid_Infernal_SEASONAL", Some(1)),
            ("NavGrid_Mountain_SEASONAL", Some(2)),
            ("NavGrid_Ocean_SEASONAL", Some(3)),
        ]
    );
    assert!(bits[4..].iter().all(|(_, bit)| bit.is_none()));
    assert_eq!(model.terrain_tags.len(), 14);
    assert_eq!(model.terrain_tags[2].name, "TRANSPARENT_WALL");
    assert_eq!(model.terrain_tags[2].color, [250, 250, 250, 255]);
    assert_eq!(model.region_groups.len(), 7);
    assert_eq!(model.region_groups[0].name, "Music");
    assert!(model.region_groups[1].gameplay);
}
