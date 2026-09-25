//! Unit tests for moving baked meshes under a controller.

use super::*;
use ltk_mapgeo::SceneGraphKey;

const CONTROLLER: u32 = 0x76c5_0391;

#[test]
fn bytes_that_are_no_mapgeo_are_refused() {
    assert!(move_under(b"PROP", CONTROLLER, |_| true).is_err());
}

#[test]
fn a_material_name_is_its_path_after_the_last_slash() {
    assert_eq!(
        material_name("Maps/KitPieces/SRS/Base/Materials/Default/HoL_TristanaStatue_A_MAT"),
        "HoL_TristanaStatue_A_MAT"
    );
    assert_eq!(material_name("Plain_MAT"), "Plain_MAT");
}

/// Story: `ltk_mapgeo` builds no asset outside itself, so this reads a shipped `.mapgeo` named
/// by `LTK_TEST_MAPGEO`, such as Summoner's Rift's `base_srx.mapgeo`.
#[test]
#[ignore = "reads a shipped .mapgeo named by LTK_TEST_MAPGEO"]
fn a_shipped_mesh_moves_under_the_controller_with_its_faces() {
    let path = std::env::var("LTK_TEST_MAPGEO").expect("LTK_TEST_MAPGEO names a .mapgeo");
    let source = fs_err::read(path).unwrap();
    let asset = EnvironmentAsset::from_reader(&mut Cursor::new(&source)).unwrap();
    let target = asset
        .meshes()
        .iter()
        .find(|mesh| mesh.visibility_controller_path_hash() == 0)
        .and_then(|mesh| mesh.submeshes().first())
        .map(|submesh| submesh.material().to_owned())
        .expect("a mesh with no controller");

    let moved = move_under(&source, CONTROLLER, |material| material == target)
        .unwrap()
        .unwrap();

    let moved = EnvironmentAsset::from_reader(&mut Cursor::new(&moved)).unwrap();
    let under: Vec<bool> = moved
        .meshes()
        .iter()
        .filter(|mesh| {
            mesh.submeshes()
                .iter()
                .any(|submesh| submesh.material() == target)
        })
        .map(|mesh| mesh.visibility_controller_path_hash() == CONTROLLER)
        .collect();
    assert!(!under.is_empty() && under.iter().all(|moved| *moved));
    assert!(
        moved
            .scene_graphs()
            .iter()
            .any(|graph| SceneGraphKey::of_graph(graph) == SceneGraphKey::new(CONTROLLER, 0)),
        "the controller's scene graph is baked"
    );
}

#[test]
#[ignore = "reads a shipped .mapgeo named by LTK_TEST_MAPGEO"]
fn a_shipped_mapgeo_with_nothing_to_move_is_left_alone() {
    let path = std::env::var("LTK_TEST_MAPGEO").expect("LTK_TEST_MAPGEO names a .mapgeo");
    let source = fs_err::read(path).unwrap();

    assert_eq!(move_under(&source, CONTROLLER, |_| false).unwrap(), None);
}
