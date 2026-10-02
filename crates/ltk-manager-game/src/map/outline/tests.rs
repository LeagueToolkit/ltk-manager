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
