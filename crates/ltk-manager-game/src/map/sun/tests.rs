use glam::{Vec2, Vec3, Vec4};
use ltk_meta::PropertyValueEnum;
use ltk_meta::property::values;

use super::*;
use crate::map::fixtures::{document_of, h, map_container as container, placeable};

const BASE_SRX: &str = "Maps/MapGeometry/Map11/Base_SRX";

fn sun(properties: Vec<(BinHash, PropertyValueEnum)>) -> PropertyValueEnum {
    placeable("MapSunProperties", properties)
}

#[test]
fn the_sun_properties_class_hash_is_its_name() {
    assert_eq!(h("MapSunProperties"), SUN_PROPERTIES);
}

#[test]
fn the_fog_and_the_horizon_read_off_the_component_with_the_class_defaults() {
    let document = document_of(vec![container(
        BASE_SRX,
        vec![sun(vec![
            (
                HORIZON_COLOR,
                values::Vector4::new(Vec4::new(0.9, 0.8, 0.7, 1.0)).into(),
            ),
            (
                FOG_START_AND_END,
                values::Vector2::new(Vec2::new(0.0, -19000.0)).into(),
            ),
            (
                FOG_COLOR,
                values::Vector4::new(Vec4::new(0.447, 0.737, 0.78, 1.0)).into(),
            ),
            (FOG_ENABLED, values::Bool::new(false).into()),
        ])],
    )]);

    let sun = map_sun(&document, &MapPath::from(BASE_SRX)).expect("a sun");

    assert_eq!(sun.horizon_color, [0.9, 0.8, 0.7, 1.0]);
    assert_eq!(sun.fog_start_end, [0.0, -19000.0]);
    assert_eq!(sun.fog_color, [0.447, 0.737, 0.78, 1.0]);
    assert!(!sun.fog_enabled);
    assert_eq!(
        sun.fog_alternate_color,
        MapSun::default().fog_alternate_color
    );
    assert_eq!(sun.fog_emissive_remap, 1.9);
    assert_eq!(sun.light_map_color_scale, 1.0);
}

#[test]
fn a_container_answers_the_sun_its_component_states() {
    let document = document_of(vec![container(
        BASE_SRX,
        vec![
            placeable("MapNavGrid", vec![]),
            sun(vec![
                (
                    SUN_DIRECTION,
                    values::Vector3::new(Vec3::new(-0.25, 0.75, -0.05)).into(),
                ),
                (
                    SUN_COLOR,
                    values::Vector4::new(Vec4::new(0.5, 0.4, 0.3, 1.0)).into(),
                ),
                (SUN_INTENSITY, values::F32::new(0.9).into()),
                (SKY_SCALE, values::F32::new(1.5).into()),
            ]),
        ],
    )]);

    let sun = map_sun(&document, &MapPath::from(BASE_SRX)).expect("the container states a sun");

    assert_eq!(sun.direction, [-0.25, 0.75, -0.05]);
    assert_eq!(sun.color, [0.5, 0.4, 0.3, 1.0]);
    assert_eq!(sun.intensity, 0.9);
    assert_eq!(sun.sky_scale, 1.5);
    assert_eq!(
        sun.ground_color,
        MapSun::default().ground_color,
        "a field the map leaves out reads as the class default"
    );
}

#[test]
fn a_file_whose_container_sits_elsewhere_answers_its_first_container() {
    let document = document_of(vec![container(
        "Maps/MapGeometry/Map11/Elsewhere",
        vec![sun(vec![(SUN_INTENSITY, values::F32::new(0.5).into())])],
    )]);

    let sun = map_sun(&document, &MapPath::from(BASE_SRX)).expect("the file contains a container");

    assert_eq!(sun.intensity, 0.5);
}

#[test]
fn a_container_with_no_sun_component_answers_none() {
    let document = document_of(vec![container(
        BASE_SRX,
        vec![placeable("MapNavGrid", vec![])],
    )]);

    assert_eq!(map_sun(&document, &MapPath::from(BASE_SRX)), None);
}

#[test]
fn a_file_with_no_container_answers_none() {
    let document = document_of(vec![]);

    assert_eq!(map_sun(&document, &MapPath::from(BASE_SRX)), None);
}
