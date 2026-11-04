use std::path::PathBuf;
use std::time::Instant;

use glam::Mat4;
use ltk_hash::BinHash;
use ltk_manager_assets::preview::nav_grid_file;
use ltk_mapgeo::{EnvironmentMesh, EnvironmentSubmesh, EnvironmentVisibility};
use ltk_mesh::mem::{
    IndexBuffer, VertexBuffer, VertexBufferDescription, VertexBufferUsage, VertexElement,
};
use ltk_navgrid::NavGridOverlay;

use super::*;

const THRESHOLD: f32 = 20.0;
const CELL: f32 = 50.0;

/// Returns a flat grid of 4 x 4 cells of 50 units at height 0, with cell `(0, 0)` a wall.
fn grid() -> NavGrid {
    let bytes = nav_grid_file([4, 4], CELL, [5, 5]);
    let mut grid = NavGrid::from_reader(&mut &bytes[..]).unwrap();
    grid.cells_mut()[0].flags = CellFlags::WALL;
    grid
}

/// Returns the two triangles of the square from `min` to `max` on `x` and `z`, at `height`.
fn square(min: [f32; 2], max: [f32; 2], height: f32) -> [([Vec3; 3], Vec3); 2] {
    let corner = |x: f32, z: f32| Vec3::new(x, height, z);
    let (a, b) = (corner(min[0], min[1]), corner(max[0], min[1]));
    let (c, d) = (corner(max[0], max[1]), corner(min[0], max[1]));
    [([a, b, c], Vec3::Y), ([a, c, d], Vec3::Y)]
}

/// Returns a plane at `height` that covers the grid and its border.
fn plane(height: f32) -> Ground {
    Ground::from_triangles(square([-10.0, -10.0], [210.0, 210.0], height))
}

#[test]
fn conformance_areas_is_empty_for_flat_plane_over_flat_grid() {
    assert!(
        conformance_areas(&grid(), &plane(0.0), THRESHOLD)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn conformance_areas_fails_every_walkable_cell_under_plane_raised_past_threshold() {
    let areas = conformance_areas(&grid(), &plane(THRESHOLD + 1.0), THRESHOLD).unwrap();

    assert_eq!(areas.len(), 1);
    assert_eq!(areas[0].kind, ConformanceKind::OffGround);
    assert_eq!(areas[0].cells, 15, "the wall cell is skipped");
    assert!((areas[0].max_delta - (THRESHOLD + 1.0)).abs() < 1e-3);
}

#[test]
fn conformance_areas_reports_uncovered_cells_of_hole() {
    let quads = (0..4u8)
        .flat_map(|y| (0..4u8).map(move |x| (f32::from(x), f32::from(y))))
        .filter(|&(x, y)| (x, y) != (2.0, 1.0))
        .flat_map(|(x, y)| {
            square(
                [x * CELL, y * CELL],
                [(x + 1.0) * CELL, (y + 1.0) * CELL],
                0.0,
            )
        });

    let areas = conformance_areas(&grid(), &Ground::from_triangles(quads), THRESHOLD).unwrap();

    assert_eq!(
        areas,
        [ConformanceArea {
            kind: ConformanceKind::Uncovered,
            cells: 1,
            max_delta: 0.0,
            center: [125.0, 75.0],
        }]
    );
}

#[test]
fn conformance_areas_keeps_ground_nearest_to_grid() {
    let mut triangles = square([-10.0, -10.0], [210.0, 210.0], 0.0).to_vec();
    triangles.extend(square([-10.0, -10.0], [210.0, 210.0], 300.0));

    let ground = Ground::from_triangles(triangles);

    assert_eq!(ground.len(), 4);
    assert!(
        conformance_areas(&grid(), &ground, THRESHOLD)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn conformance_areas_splits_areas_by_kind_and_connection() {
    let mut triangles = square([-10.0, -10.0], [100.0, 210.0], 0.0).to_vec();
    triangles.extend(square([100.0, -10.0], [150.0, 100.0], -50.0));

    let mut areas =
        conformance_areas(&grid(), &Ground::from_triangles(triangles), THRESHOLD).unwrap();
    areas.sort_by_key(|area| area.cells);

    assert_eq!(areas.len(), 2);
    assert_eq!(
        (areas[0].kind, areas[0].cells, areas[0].max_delta),
        (ConformanceKind::OffGround, 2, -50.0)
    );
    assert_eq!(areas[0].center, [125.0, 50.0]);
    assert_eq!(
        (areas[1].kind, areas[1].cells),
        (ConformanceKind::Uncovered, 6)
    );
}

#[test]
fn conformance_areas_reads_walls_of_composed_grid() {
    let mut grid = grid();
    grid.apply_overlay(&NavGridOverlay {
        version: 1,
        rects: vec![ltk_navgrid::NavGridOverlayRect {
            x: 1,
            y: 0,
            width: 3,
            height: 4,
            flags: vec![CellFlags::WALL; 12],
        }],
        trailing_byte: 0,
    });

    let areas = conformance_areas(&grid, &plane(THRESHOLD + 1.0), THRESHOLD).unwrap();

    assert_eq!(areas.len(), 1);
    assert_eq!(areas[0].cells, 3);
}

#[test]
fn ground_from_triangles_skips_steep_and_degenerate_triangles() {
    let wall = [
        Vec3::ZERO,
        Vec3::new(10.0, 0.0, 0.0),
        Vec3::new(0.0, 10.0, 0.0),
    ];
    let line = [Vec3::ZERO, Vec3::X, Vec3::X * 2.0];
    let flipped = [
        Vec3::ZERO,
        Vec3::new(10.0, 0.0, 0.0),
        Vec3::new(0.0, 0.0, 10.0),
    ];

    let ground = Ground::from_triangles([(wall, Vec3::Z), (line, Vec3::Y), (flipped, Vec3::Y)]);

    assert_eq!(ground.len(), 1, "the winding does not decide the side");
}

#[test]
fn shown_meshes_uses_controller_state_before_layer_mask() {
    let shown = ShownMeshes {
        flags: 0b0000_0001,
        controllers: HashMap::from([
            (HexBinHash::from(BinHash(7)), false),
            (HexBinHash::from(BinHash(8)), true),
        ]),
    };

    assert!(shown.shows(0b0000_0001, 0));
    assert!(!shown.shows(0b0000_0010, 0));
    assert!(shown.shows(EVERY_LAYER, 0));
    assert!(!shown.shows(0b0000_0001, 7));
    assert!(shown.shows(0b0000_0010, 8));
    assert!(
        shown.shows(0b0000_0001, 9),
        "an unknown controller falls back to the mask"
    );
}

/// Returns the bytes of a version 18 `.mapgeo` that holds no mesh, buffer or scene graph.
fn empty_mapgeo() -> Vec<u8> {
    let mut bytes = ltk_mapgeo::MAGIC.to_vec();
    for value in [18u32, 0, 0, 0, 0, 0, 0, 0] {
        bytes.extend(value.to_le_bytes());
    }
    bytes
}

/// One mesh of [`map`]: a square from -10 to 210 on `x` and `z` at height 0 before
/// `transform`, with its vertex normals up.
struct SquareMesh {
    layers: u8,
    controller: u32,
    transform: Mat4,
    region: u32,
}

impl SquareMesh {
    fn on(layers: u8) -> Self {
        Self {
            layers,
            controller: 0,
            transform: Mat4::IDENTITY,
            region: 0,
        }
    }
}

/// Returns a map of `meshes`, in that order.
fn map(meshes: &[SquareMesh]) -> EnvironmentAsset {
    let mut asset = EnvironmentAsset::from_reader(&mut Cursor::new(empty_mapgeo())).unwrap();

    for (at, square) in meshes.iter().enumerate() {
        let description = VertexBufferDescription::new(
            VertexBufferUsage::Static,
            vec![VertexElement::POSITION, VertexElement::NORMAL],
        );
        let mut vertices = Vec::new();
        for (x, z) in [
            (-10.0, -10.0),
            (210.0, -10.0),
            (210.0, 210.0),
            (-10.0, 210.0),
        ] {
            for value in [x, 0.0, z, 0.0, 1.0, 0.0] {
                vertices.extend(f32::to_le_bytes(value));
            }
        }
        let indices = [0u16, 1, 2, 0, 2, 3]
            .into_iter()
            .flat_map(u16::to_le_bytes)
            .collect();

        let mut mesh = EnvironmentMesh::new(vec![EnvironmentSubmesh::new(
            "Maps/Test/Ground".to_owned(),
            0,
            6,
            0,
            3,
        )]);
        mesh.set_visibility(EnvironmentVisibility::from_bits_retain(square.layers));
        mesh.set_visibility_controller_path_hash(square.controller);
        asset
            .insert_mesh(
                at,
                mesh,
                vec![VertexBuffer::new(description, vertices)],
                IndexBuffer::new(indices),
            )
            .unwrap();
        asset.set_mesh_transform(at, square.transform).unwrap();
        asset.set_mesh_region_path_hash(at, square.region).unwrap();
    }

    asset
}

fn layer(flags: u8) -> ShownMeshes {
    ShownMeshes {
        flags,
        ..ShownMeshes::default()
    }
}

#[test]
fn ground_from_map_reads_shown_meshes_only() {
    let asset = map(&[SquareMesh::on(1), SquareMesh::on(2)]);

    assert_eq!(Ground::from_map(&asset, &layer(1)).unwrap().len(), 2);
    assert_eq!(Ground::from_map(&asset, &layer(3)).unwrap().len(), 4);
    assert!(Ground::from_map(&asset, &layer(4)).unwrap().is_empty());
}

#[test]
fn ground_from_map_uses_controller_state_of_mesh() {
    let asset = map(&[SquareMesh {
        controller: 7,
        ..SquareMesh::on(1)
    }]);
    let hidden = ShownMeshes {
        flags: 1,
        controllers: HashMap::from([(HexBinHash::from(BinHash(7)), false)]),
    };

    assert!(Ground::from_map(&asset, &hidden).unwrap().is_empty());
}

#[test]
fn ground_from_map_skips_region_anchored_mesh() {
    let asset = map(&[
        SquareMesh::on(1),
        SquareMesh {
            region: 0x1234_5678,
            ..SquareMesh::on(1)
        },
    ]);

    assert_eq!(Ground::from_map(&asset, &layer(1)).unwrap().len(), 2);
}

#[test]
fn ground_from_map_bakes_mesh_transform() {
    let raised = THRESHOLD + 10.0;
    let asset = map(&[SquareMesh {
        transform: Mat4::from_translation(Vec3::new(0.0, raised, 0.0)),
        ..SquareMesh::on(1)
    }]);

    let ground = Ground::from_map(&asset, &layer(1)).unwrap();
    let areas = conformance_areas(&grid(), &ground, THRESHOLD).unwrap();

    assert_eq!(areas.len(), 1);
    assert_eq!(areas[0].cells, 15);
    assert!((areas[0].max_delta - raised).abs() < 1e-3);
}

#[test]
fn ground_read_fails_on_bytes_that_are_no_mapgeo() {
    let bytes = empty_mapgeo();

    assert!(Ground::read(&bytes[..10], &ShownMeshes::default()).is_err());
    assert!(Ground::read(&[0; 36], &ShownMeshes::default()).is_err());
    assert!(
        Ground::read(&bytes, &ShownMeshes::default())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn conformance_areas_fails_if_buckets_exceed_limit() {
    let bytes = nav_grid_file([64, 64], 1.0, [2, 2]);
    let grid = NavGrid::from_reader(&mut &bytes[..]).unwrap();
    let cells = 64 * 64;
    let squares = MAX_BUCKET_ENTRIES / cells / 2;
    let under =
        Ground::from_triangles((0..squares).flat_map(|_| square([0.0, 0.0], [64.0, 64.0], 0.0)));
    let over =
        Ground::from_triangles((0..=squares).flat_map(|_| square([0.0, 0.0], [64.0, 64.0], 0.0)));

    assert!(conformance_areas(&grid, &under, THRESHOLD).is_ok());
    assert!(conformance_areas(&grid, &over, THRESHOLD).is_err());
}

/// Measures the check on the Summoner's Rift files under the directory that
/// `LTK_NAVGRID_DATA` names: `navgrid/assets/maps/navgrid/map11/aipath_srx_3.aimesh_ngrid` and
/// `mapgeo/data/maps/mapgeometry/map11/base_srx.mapgeo`.
#[test]
#[ignore = "reads the extracted Summoner's Rift files that LTK_NAVGRID_DATA names"]
fn conformance_areas_runs_on_summoners_rift() {
    let root = PathBuf::from(std::env::var_os("LTK_NAVGRID_DATA").expect("LTK_NAVGRID_DATA"));
    let grid_bytes =
        fs_err::read(root.join("navgrid/assets/maps/navgrid/map11/aipath_srx_3.aimesh_ngrid"))
            .unwrap();
    let mapgeo_bytes =
        fs_err::read(root.join("mapgeo/data/maps/mapgeometry/map11/base_srx.mapgeo")).unwrap();

    let started = Instant::now();
    let grid = NavGrid::from_reader(&mut &grid_bytes[..]).unwrap();
    let read_grid = started.elapsed();
    let ground = Ground::read(&mapgeo_bytes, &layer(1)).unwrap();
    let read_ground = started.elapsed();
    let areas = conformance_areas(&grid, &ground, THRESHOLD).unwrap();
    let checked = started.elapsed();

    let failing: u32 = areas.iter().map(|area| area.cells).sum();
    eprintln!(
        "grid read {read_grid:?}, ground {:?} ({} triangles), check {:?}, total {checked:?}, \
         {} areas of {failing} cells",
        read_ground - read_grid,
        ground.len(),
        checked - read_ground,
        areas.len(),
    );
    for area in areas.iter().take(5) {
        eprintln!("{area:?}");
    }
    assert!(!ground.is_empty());
}
