use glam::{Mat4, vec3};
use ltk_meta::property::values;

use super::*;
use crate::map::fixtures::{container, document_of, h, placeable};
use crate::map::placeable::{
    EVERY_LAYER, NAME, TRANSFORM, VISIBILITY_CONTROLLER, VISIBILITY_FLAGS,
};

const SYSTEM_PATH: &str = "Maps/Particles/SRX/Base/SRX_Mountain_DragonPit_Sandfall";

#[test]
fn a_particle_answers_where_it_stands_with_the_translation_last() {
    /* Transposed, which is how the reader holds a matrix whose file rows end in the
    translation. */
    let placement = Mat4::from_translation(vec3(10145.0, -73.0, 3866.0)).transpose();
    let document = document_of(vec![container(
        "Maps/MapGeometry/Map11/Base_SRX/Chunks/Plants",
        vec![(
            "Sandfall1",
            placeable(
                "MapParticle",
                vec![
                    (TRANSFORM, values::Matrix44::new(placement).into()),
                    (NAME, values::String::from("Sandfall1").into()),
                    (VISIBILITY_FLAGS, values::U8::new(4).into()),
                    (SYSTEM, values::ObjectLink::new(h(SYSTEM_PATH)).into()),
                    (
                        VISIBILITY_CONTROLLER,
                        values::ObjectLink::new(BinHash(0x4810_6271)).into(),
                    ),
                ],
            ),
        )],
    )]);

    let particles = map_particles(&document);

    assert_eq!(particles.len(), 1);
    let particle = &particles[0];
    assert_eq!(particle.name, "Sandfall1");
    assert_eq!(particle.system, hex(h(SYSTEM_PATH)));
    assert_eq!(&particle.transform[12..15], &[10145.0, -73.0, 3866.0]);
    assert_eq!(particle.visibility, 4);
    assert_eq!(particle.controller.as_deref(), Some("0x48106271"));
    assert!(!particle.transitional && !particle.start_disabled);
}

#[test]
fn a_particle_writing_no_mask_stands_in_every_layer() {
    let document = document_of(vec![container(
        "Chunks/Base",
        vec![(
            "Brazier",
            placeable(
                "MapParticle",
                vec![
                    (SYSTEM, values::ObjectLink::new(h(SYSTEM_PATH)).into()),
                    (TRANSITIONAL, values::Bool::new(true).into()),
                ],
            ),
        )],
    )]);

    let particles = map_particles(&document);

    assert_eq!(particles[0].visibility, EVERY_LAYER);
    assert_eq!(particles[0].transform, Mat4::IDENTITY.to_cols_array());
    assert!(particles[0].transitional);
}

#[test]
fn a_placeable_of_another_class_and_a_particle_linking_nothing_are_passed_over() {
    let document = document_of(vec![
        container(
            "Chunks/Base",
            vec![
                ("Locator", placeable("MapLocator", vec![])),
                ("Unlinked", placeable("MapParticle", vec![])),
            ],
        ),
        ltk_meta::BinObject::builder(h(SYSTEM_PATH), h("VfxSystemDefinitionData")).build(),
    ]);

    assert!(map_particles(&document).is_empty());
}

#[test]
#[ignore = "reads a shipped materials bin, and needs LTK_LIVE_MATERIALS"]
fn a_shipped_map_stands_particles() {
    let path = std::env::var("LTK_LIVE_MATERIALS").unwrap();
    let document = BinDocument::parse(fs_err::read(path).unwrap()).unwrap();
    let particles = map_particles(&document);
    let drawn = particles
        .iter()
        .filter(|p| p.visibility & 1 != 0 && p.controller.is_none() && !p.transitional)
        .count();
    println!("{} particles, {drawn} on layer 0", particles.len());
    assert!(
        particles.iter().any(|p| p.transform[12] != 0.0),
        "a shipped map stands its particles away from the origin"
    );
}
