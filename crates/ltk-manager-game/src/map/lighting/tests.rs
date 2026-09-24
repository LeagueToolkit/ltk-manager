use ltk_meta::property::values;

use super::*;
use crate::map::fixtures::{document_of, h, map_container as container, placeable};

const BASE: &str = "Maps/MapGeometry/Map12/Base";
const GRID: &str = "ASSETS/Maps/Lightmaps/Maps/MapGeometry/Map12/Base/LightGrid.dat";

fn bake(grid: &str) -> ltk_meta::PropertyValueEnum {
    placeable(
        "MapBakeProperties",
        vec![(LIGHT_GRID_FILE_NAME, values::String::from(grid).into())],
    )
}

#[test]
fn every_hash_is_its_name() {
    assert_eq!(h("MapBakeProperties"), BAKE_PROPERTIES);
    assert_eq!(h("lightGridFileName"), LIGHT_GRID_FILE_NAME);
}

#[test]
fn a_container_answers_the_grid_its_bake_component_names() {
    let document = document_of(vec![container(
        BASE,
        vec![placeable("MapSunProperties", vec![]), bake(GRID)],
    )]);

    assert_eq!(light_grid_path(&document, &MapPath::from(BASE)), Some(GRID));
}

#[test]
fn a_container_baking_no_grid_answers_none() {
    let empty = document_of(vec![container(BASE, vec![bake("")])]);
    let none = document_of(vec![container(
        BASE,
        vec![placeable("MapSunProperties", vec![])],
    )]);

    assert_eq!(light_grid_path(&empty, &MapPath::from(BASE)), None);
    assert_eq!(light_grid_path(&none, &MapPath::from(BASE)), None);
}
