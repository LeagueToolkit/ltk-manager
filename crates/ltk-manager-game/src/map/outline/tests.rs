use glam::{Mat4, vec3};
use ltk_hash::WadHash;
use ltk_meta::BinObject;
use ltk_meta::property::{Kind, values};

use super::*;
use crate::map::fixtures::{container, document_of, h, placeable};
use crate::map::placeable::TRANSFORM;

const PLANTS: &str = "Maps/MapGeometry/Map11/Chunks/Plants";

/// Tables that name one chunk, one class and one listing key, and nothing else.
struct Tables;

impl RowNames for Tables {
    fn for_each_entry(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if *hash == h(PLANTS) {
                visit(at, PLANTS);
            }
        }
    }

    fn for_each_class(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if *hash == PARTICLE {
                visit(at, "MapParticle");
            }
        }
    }

    fn for_each_field(&self, _hashes: &[BinHash], _visit: &mut dyn FnMut(usize, &str)) {}

    fn for_each_value(&self, hashes: &[BinHash], visit: &mut dyn FnMut(usize, &str)) {
        for (at, hash) in hashes.iter().enumerate() {
            if *hash == h("SRX_Audio") {
                visit(at, "SRX_Audio");
            }
        }
    }

    fn for_each_chunk(&self, _hashes: &[WadHash], _visit: &mut dyn FnMut(usize, &str)) {}
}

#[test]
fn a_chunk_answers_what_it_holds_under_the_path_it_is_declared_at() {
    /* Transposed, which is how the reader holds a matrix whose file rows end in the
    translation. */
    let placement = Mat4::from_translation(vec3(10145.0, -73.0, 3866.0)).transpose();
    let document = document_of(vec![container(
        PLANTS,
        vec![
            (
                "Sandfall1",
                placeable(
                    "MapParticle",
                    vec![
                        (TRANSFORM, values::Matrix44::new(placement).into()),
                        (NAME, values::String::from("Sandfall1").into()),
                    ],
                ),
            ),
            ("Spawn", placeable("MapLocator", vec![])),
        ],
    )]);

    let chunks = map_outline(&document, &Tables);

    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].entry, hex(h(PLANTS)));
    assert_eq!(chunks[0].name.as_deref(), Some(PLANTS));
    let particle = &chunks[0].items[0];
    assert_eq!(particle.key, hex(h("Sandfall1")));
    assert_eq!(particle.name, "Sandfall1");
    assert_eq!(particle.class, "MapParticle");
    assert_eq!(particle.kind, MapItemKind::Particle);
    assert_eq!(particle.position, [10145.0, -73.0, 3866.0]);
    let locator = &chunks[0].items[1];
    assert_eq!(locator.kind, MapItemKind::Locator);
    assert_eq!(locator.name, hex(h("Spawn")));
    assert_eq!(locator.class, hex(h("MapLocator")));
}

#[test]
fn map_outline_reads_shapes_of_lights_probes_and_paths() {
    let region = values::Struct {
        class_hash: h("MapCubemapRegion"),
        properties: [
            (MIN, values::Vector3::new(vec3(-1.0, -2.0, -3.0)).into()),
            (MAX, values::Vector3::new(vec3(1.0, 2.0, 3.0)).into()),
        ]
        .into_iter()
        .collect(),
    };
    let segment = values::Struct {
        class_hash: h("MapPathLineSegment"),
        properties: [(
            END_POSITION,
            values::Vector3::new(vec3(5.0, 0.0, 5.0)).into(),
        )]
        .into_iter()
        .collect(),
    };
    let segments = values::Container::new(Kind::Struct, vec![segment.into()]).unwrap();
    let document = document_of(vec![container(
        PLANTS,
        vec![
            (
                "Bulb",
                placeable(
                    "MapDynamicPointLight",
                    vec![(RADIUS, values::F32::new(300.0).into())],
                ),
            ),
            (
                "Spot",
                placeable(
                    "MapDynamicSpotlight",
                    vec![(FAR.0, values::F32::new(800.0).into())],
                ),
            ),
            (
                "Probe",
                placeable("MapCubemapProbe", vec![(CUBEMAP_REGION, region.into())]),
            ),
            (
                "Path",
                placeable("MapMotionPath", vec![(SEGMENTS, segments.into())]),
            ),
        ],
    )]);

    let items = &map_outline(&document, &Tables)[0].items;

    assert_eq!(items[0].kind, MapItemKind::Light);
    assert_eq!(items[0].shape, Some(MapItemShape::Sphere { radius: 300.0 }));
    assert_eq!(
        items[1].shape,
        Some(MapItemShape::Frustum {
            fov: 60.0,
            aspect: 1.0,
            near: 10.0,
            far: 800.0,
            orthographic: false,
            ortho_height: 200.0,
        })
    );
    assert_eq!(items[2].kind, MapItemKind::Probe);
    assert_eq!(
        items[2].shape,
        Some(MapItemShape::Box {
            min: [-1.0, -2.0, -3.0],
            max: [1.0, 2.0, 3.0],
        })
    );
    assert_eq!(items[3].kind, MapItemKind::Path);
    assert_eq!(
        items[3].shape,
        Some(MapItemShape::Path {
            points: vec![[0.0, 0.0, 0.0], [5.0, 0.0, 5.0]],
        })
    );
    assert_eq!(items[3].transform, Mat4::IDENTITY.to_cols_array());
}

#[test]
fn map_outline_reads_shapes_of_lighting_volumes_and_light_regions() {
    let points = values::Container::new(
        Kind::Vector3,
        vec![
            values::Vector3::new(vec3(-1.0, 0.0, -1.0)).into(),
            values::Vector3::new(vec3(1.0, 0.0, -1.0)).into(),
            values::Vector3::new(vec3(0.0, 0.0, 1.0)).into(),
        ],
    )
    .unwrap();
    let region = values::Struct {
        class_hash: h("LightRegion"),
        properties: [(POLYGON, points.into())].into_iter().collect(),
    };
    let document = document_of(vec![container(
        PLANTS,
        vec![
            ("Volume", placeable("MapLightingVolume", vec![])),
            (
                "Region",
                placeable(
                    "LightRegionEntityTemplate",
                    vec![(LIGHT_REGION_FIELD, values::Embedded(region).into())],
                ),
            ),
        ],
    )]);

    let items = &map_outline(&document, &Tables)[0].items;

    assert_eq!(items[0].shape, Some(MapItemShape::Volume));
    assert_eq!(
        items[1].shape,
        Some(MapItemShape::Polygon {
            points: vec![[-1.0, 0.0, -1.0], [1.0, 0.0, -1.0], [0.0, 0.0, 1.0]],
        })
    );
}

#[test]
fn map_outline_reads_region_boundaries_and_vertex_regions() {
    let vertices = values::Container::new(
        Kind::Vector3,
        vec![
            values::Vector3::new(vec3(-1.0, 0.0, -1.0)).into(),
            values::Vector3::new(vec3(1.0, 0.0, -1.0)).into(),
            values::Vector3::new(vec3(0.0, 0.0, 1.0)).into(),
        ],
    )
    .unwrap();
    let document = document_of(vec![container(
        PLANTS,
        vec![
            (
                "Wall",
                placeable(
                    "RegionBoundary",
                    vec![
                        (VERTICES, vertices.clone().into()),
                        (DRAW_HEIGHT.0, values::U32::new(200).into()),
                        (
                            LINE_COLOR.0,
                            values::Color::new(ltk_primitives::Color {
                                r: 1,
                                g: 2,
                                b: 3,
                                a: 4,
                            })
                            .into(),
                        ),
                    ],
                ),
            ),
            ("Bare", placeable("RegionBoundary", vec![])),
            (
                "Zone",
                values::Struct {
                    class_hash: VERTEX_REGION,
                    properties: [(VERTICES, vertices.into())].into_iter().collect(),
                }
                .into(),
            ),
        ],
    )]);

    let items = &map_outline(&document, &Tables)[0].items;

    assert_eq!(items[0].kind, MapItemKind::Region);
    assert_eq!(
        items[0].shape,
        Some(MapItemShape::Region {
            points: vec![[-1.0, 0.0, -1.0], [1.0, 0.0, -1.0], [0.0, 0.0, 1.0]],
            height: 200.0,
            line_color: [1, 2, 3, 4],
            fill_color: [255, 255, 0, 255],
        })
    );
    assert_eq!(
        items[1].shape,
        Some(MapItemShape::Region {
            points: vec![],
            height: 100.0,
            line_color: [255, 0, 0, 255],
            fill_color: [255, 255, 0, 255],
        })
    );
    assert_eq!(items[2].kind, MapItemKind::Region);
    assert_eq!(
        items[2].shape,
        Some(MapItemShape::Polygon {
            points: vec![[-1.0, 0.0, -1.0], [1.0, 0.0, -1.0], [0.0, 0.0, 1.0]],
        })
    );
}

#[test]
fn a_chunk_no_table_names_reads_as_the_key_its_container_lists_it_under() {
    let listing = values::Map::new(
        Kind::Hash,
        Kind::ObjectLink,
        vec![(
            values::Hash::new(h("SRX_Audio")).into(),
            values::ObjectLink::new(h("Some/Unnamed/Chunk")).into(),
        )],
    )
    .unwrap();
    let document = document_of(vec![
        BinObject::builder(h("Maps/MapGeometry/Map11/Base_SRX"), MAP_CONTAINER)
            .property(CHUNKS, listing)
            .build(),
        container(
            "Some/Unnamed/Chunk",
            vec![("Hum", placeable("MapAudio", vec![]))],
        ),
        container("Some/Empty/Chunk", vec![]),
    ]);

    let chunks = map_outline(&document, &Tables);

    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].name.as_deref(), Some("SRX_Audio"));
    assert_eq!(chunks[0].items[0].kind, MapItemKind::Audio);
}
