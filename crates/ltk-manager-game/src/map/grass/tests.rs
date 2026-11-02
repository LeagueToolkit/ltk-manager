use glam::Vec2;
use ltk_hash::{Hash as _, WadHash};
use ltk_meta::property::{Kind, values};
use ltk_meta::{BinObject, PropertyValueEnum};

use super::*;
use crate::map::component::MAP_CONTAINER;
use crate::map::fixtures::{document_of, embedded, h};

const BASE_SRX: &str = "Maps/MapGeometry/Map11/Base_SRX";
const DEFAULT_TINT: &str = "assets/maps/info/map11/grasstint_srx.tex";
const BLOOM_TINT: &str = "assets/maps/info/map11/grasstint_srx_bloom_env.tex";

/// Locates every chunk, as a file named by its hash.
struct Everything;

impl AssetLookup for Everything {
    fn locate(&self, path: &str) -> Option<AssetRef> {
        self.locate_chunk(WadHash::hash_str(path))
    }

    fn locate_chunk(&self, hash: WadHash) -> Option<AssetRef> {
        Some(AssetRef::File {
            path: format!("{:016x}", hash.0),
        })
    }
}

fn located(path: &str) -> AssetRef {
    Everything.locate(path).unwrap()
}

fn skin(name: &str, container: &str, tint: Option<&str>) -> BinObject {
    let mut object =
        BinObject::builder(h(&format!("Maps/Shipping/Map11/MapSkins/{name}")), MAP_SKIN)
            .property(SKIN_NAME, values::String::from(name))
            .property(CONTAINER_LINK, values::String::from(container));
    if let Some(tint) = tint {
        object = object.property(
            GRASS_TINT,
            values::WadChunkLink::new(WadHash::hash_str(tint)),
        );
    }
    object.build()
}

#[test]
fn map_grass_tints_lists_skins_that_link_map_in_file_order() {
    let document = document_of(vec![
        skin("Default", BASE_SRX, Some(DEFAULT_TINT)),
        skin(
            "Arcade",
            "Maps/MapGeometry/Map11/Arcade",
            Some(DEFAULT_TINT),
        ),
        skin("Bloom", BASE_SRX, Some(BLOOM_TINT)),
        skin("Untinted", BASE_SRX, None),
    ]);

    let tints = map_grass_tints(&document, &MapPath::from(BASE_SRX), &(), &Everything);

    assert_eq!(
        tints,
        vec![
            MapGrassTint {
                skin: "Default".to_owned(),
                texture: located(DEFAULT_TINT),
                alternates: Vec::new(),
            },
            MapGrassTint {
                skin: "Bloom".to_owned(),
                texture: located(BLOOM_TINT),
                alternates: Vec::new(),
            },
        ]
    );
}

#[test]
fn map_grass_tints_matches_link_in_any_case() {
    let document = document_of(vec![skin("Default", BASE_SRX, Some(DEFAULT_TINT))]);
    let listed = MapPath::from(BASE_SRX.to_lowercase());

    let tints = map_grass_tints(&document, &listed, &(), &Everything);

    assert_eq!(tints.len(), 1);
    assert_eq!(tints[0].skin, "Default");
}

fn flag(name: &str, bit: u8) -> PropertyValueEnum {
    embedded(
        "MapVisibilityFlagDefinition",
        vec![
            (h("name"), values::Hash::new(h(name)).into()),
            (h("BitIndex"), values::U8::new(bit).into()),
        ],
    )
}

fn alternate(flag: &str, tint: &str) -> PropertyValueEnum {
    embedded(
        "MapAlternateAsset",
        vec![
            (
                ALTERNATE_TINT,
                values::WadChunkLink::new(WadHash::hash_str(tint)).into(),
            ),
            (ALTERNATE_FLAG, values::Hash::new(h(flag)).into()),
        ],
    )
}

#[test]
fn map_grass_tints_resolves_alternates_to_flag_bits() {
    const INFERNAL_TINT: &str = "assets/maps/info/map11/grasstint_srx_infernal.tex";
    const OCEAN_TINT: &str = "assets/maps/info/map11/grasstint_srx_ocean.tex";
    let flags = values::Container::new(Kind::Embedded, vec![flag("Fire", 1), flag("Ocean", 3)]);
    let map = BinObject::builder(h("Maps/Shipping/Map11"), h("Map"))
        .property(
            h("VisibilityFlagDefines"),
            embedded(
                "MapVisibilityFlagDefinitions",
                vec![(h("FlagDefinitions"), flags.unwrap().into())],
            ),
        )
        .build();
    let listed = values::Container::new(
        Kind::Embedded,
        vec![
            alternate("Fire", INFERNAL_TINT),
            alternate("Unknown", DEFAULT_TINT),
            alternate("Ocean", OCEAN_TINT),
        ],
    );
    let skin = BinObject::builder(h("Maps/Shipping/Map11/MapSkins/Default"), MAP_SKIN)
        .property(SKIN_NAME, values::String::from("Default"))
        .property(CONTAINER_LINK, values::String::from(BASE_SRX))
        .property(
            GRASS_TINT,
            values::WadChunkLink::new(WadHash::hash_str(DEFAULT_TINT)),
        )
        .property(
            ALTERNATE_ASSETS,
            embedded(
                "MapAlternateAssets",
                vec![(ALTERNATE_ASSETS, listed.unwrap().into())],
            ),
        )
        .build();
    let document = document_of(vec![map, skin]);

    let tints = map_grass_tints(&document, &MapPath::from(BASE_SRX), &(), &Everything);

    assert_eq!(
        tints[0].alternates,
        vec![
            MapGrassAlternate {
                bit: 1,
                texture: located(INFERNAL_TINT),
            },
            MapGrassAlternate {
                bit: 3,
                texture: located(OCEAN_TINT),
            },
        ]
    );
}

#[test]
fn map_bounds_reads_container_bounds() {
    let document = document_of(vec![
        BinObject::builder(h(BASE_SRX), MAP_CONTAINER)
            .property(BOUNDS_MIN, values::Vector2::new(Vec2::new(-10.0, -20.0)))
            .property(
                BOUNDS_MAX,
                values::Vector2::new(Vec2::new(14_800.0, 14_900.0)),
            )
            .build(),
    ]);

    assert_eq!(
        map_bounds(&document, &MapPath::from(BASE_SRX)),
        Some(MapBounds {
            min: [-10.0, -20.0],
            max: [14_800.0, 14_900.0],
        })
    );
}

#[test]
fn map_bounds_defaults_min_to_zero() {
    let document = document_of(vec![
        BinObject::builder(h(BASE_SRX), MAP_CONTAINER)
            .property(
                BOUNDS_MAX,
                values::Vector2::new(Vec2::new(14_820.0, 14_881.0)),
            )
            .build(),
    ]);

    assert_eq!(
        map_bounds(&document, &MapPath::from(BASE_SRX)),
        Some(MapBounds {
            min: [0.0, 0.0],
            max: [14_820.0, 14_881.0],
        })
    );
}

#[test]
fn map_bounds_returns_none_without_bounds() {
    let document = document_of(vec![BinObject::builder(h(BASE_SRX), MAP_CONTAINER).build()]);

    assert_eq!(map_bounds(&document, &MapPath::from(BASE_SRX)), None);
}
