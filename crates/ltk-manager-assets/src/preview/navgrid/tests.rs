use ltk_navgrid::{CellFlags, NavGridOverlayRect, RegionOverlayRect};

use super::*;

/// A chunk name, which carries no extension.
const CHUNK: &str = "0123456789abcdef";

/// Returns a grid of 3 x 1 cells, an odd count, with distinct values in every block.
fn grid() -> NavGrid {
    let bytes = nav_grid_file([3, 1], 50.0, [3, 2]);
    let mut grid = NavGrid::from_reader(&mut &bytes[..]).unwrap();

    for (at, cell) in grid.cells_mut().iter_mut().enumerate() {
        cell.flags = CellFlags::from_bits_retain(0x0080 | at as u16);
        cell.region_tags = 0x1000_0000 + at as u32;
        cell.height = 10.0 * at as f32;
    }
    for (at, sample) in grid.sampled_heights_mut().iter_mut().enumerate() {
        *sample = at as f32 + 0.5;
    }
    let groups = grid.region_tag_groups_mut();
    groups[1].name = 0xAAAA_0001;
    groups[7].tags[15].name = 0xBBBB_0002;

    grid
}

fn file_of(grid: &NavGrid) -> Vec<u8> {
    let mut bytes = Vec::new();
    grid.to_writer(&mut bytes).unwrap();
    bytes
}

fn word(buffer: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(buffer[at..at + 4].try_into().unwrap())
}

fn float(buffer: &[u8], at: usize) -> f32 {
    f32::from_le_bytes(buffer[at..at + 4].try_into().unwrap())
}

fn half(buffer: &[u8], at: usize) -> u16 {
    u16::from_le_bytes(buffer[at..at + 2].try_into().unwrap())
}

#[test]
fn grid_buffer_writes_header_and_blocks_with_padding_after_odd_flag_count() {
    let buffer = render("aipath.aimesh_ngrid", &file_of(&grid())).unwrap();

    assert_eq!(GRID_HEADER_BYTES, 604);
    assert_eq!(word(&buffer, 0), GRID_MAGIC);
    assert_eq!(word(&buffer, 4), VERSION);
    assert_eq!((word(&buffer, 8), word(&buffer, 12)), (3, 1));
    assert_eq!(float(&buffer, 16), 50.0);
    assert_eq!(float(&buffer, 32), 150.0, "max.x is the cell span");
    assert_eq!((word(&buffer, 44), word(&buffer, 48)), (3, 2));
    assert_eq!((float(&buffer, 52), float(&buffer, 56)), (75.0, 50.0));
    assert_eq!(word(&buffer, 60 + 4), 0xAAAA_0001, "group 1 name");
    assert_eq!(word(&buffer, 600), 0xBBBB_0002, "group 7 tag 15 name");

    let flags = GRID_HEADER_BYTES;
    assert_eq!(
        [half(&buffer, flags), half(&buffer, flags + 4)],
        [0x0080, 0x0082]
    );
    assert_eq!(half(&buffer, flags + 6), 0, "2 bytes pad 3 flags to 8");

    let region_tags = flags + 8;
    assert_eq!(word(&buffer, region_tags + 8), 0x1000_0002);
    let heights = region_tags + 12;
    assert_eq!(float(&buffer, heights + 4), 10.0);
    let samples = heights + 12;
    assert_eq!(float(&buffer, samples + 20), 5.5);
    assert_eq!(buffer.len(), samples + 6 * 4);
}

#[test]
fn grid_buffer_has_no_padding_after_even_flag_count() {
    let bytes = nav_grid_file([2, 2], 50.0, [2, 2]);

    let buffer = render("aipath.aimesh_ngrid", &bytes).unwrap();

    assert_eq!(buffer.len(), GRID_HEADER_BYTES + 4 * (2 + 4 + 4) + 4 * 4);
}

#[test]
fn overlay_buffer_of_empty_rg_overlay_has_no_rects() {
    let buffer = render("Regions_chemtech.rg_overlay", &[]).unwrap();

    assert_eq!(buffer.len(), 16);
    assert_eq!(word(&buffer, 0), OVERLAY_MAGIC);
    assert_eq!(word(&buffer, 4), VERSION);
    assert_eq!(word(&buffer, 8), REGIONS_KIND);
    assert_eq!(word(&buffer, 12), 0);
}

#[test]
fn overlay_buffer_pads_flag_rect_with_odd_value_count() {
    let overlay = NavGridOverlay {
        version: 1,
        rects: vec![
            NavGridOverlayRect {
                x: -1,
                y: 2,
                width: 3,
                height: 1,
                flags: vec![CellFlags::WALL, CellFlags::GRASS, CellFlags::empty()],
            },
            NavGridOverlayRect {
                x: 4,
                y: 5,
                width: 1,
                height: 1,
                flags: vec![CellFlags::TRANSPARENT_WALL],
            },
        ],
        trailing_byte: 1,
    };
    let mut bytes = Vec::new();
    overlay.to_writer(&mut bytes).unwrap();

    let buffer = render("NavGrid_Ocean_SEASONAL.ngrid_overlay", &bytes).unwrap();

    assert_eq!(word(&buffer, 8), FLAGS_KIND);
    assert_eq!(word(&buffer, 12), 2);
    assert_eq!(word(&buffer, 16) as i32, -1);
    assert_eq!(word(&buffer, 24), 3);
    assert_eq!([half(&buffer, 32), half(&buffer, 34)], [0x0002, 0x0001]);
    assert_eq!(half(&buffer, 38), 0, "2 bytes pad 3 values to 8");
    assert_eq!(word(&buffer, 40), 4, "the second rect starts aligned");
    assert_eq!(half(&buffer, 56), 0x0042);
    assert_eq!(buffer.len(), 60);
}

#[test]
fn overlay_buffer_widens_region_rect_position_and_size() {
    let overlay = RegionOverlay {
        version: 1,
        rects: vec![RegionOverlayRect {
            x: 7,
            y: 8,
            width: 2,
            height: 1,
            region_tags: vec![0x1234_5678, 9],
        }],
    };
    let mut bytes = Vec::new();
    overlay.to_writer(&mut bytes).unwrap();

    let buffer = render("Regions_ocean.rg_overlay", &bytes).unwrap();

    assert_eq!(word(&buffer, 8), REGIONS_KIND);
    assert_eq!([word(&buffer, 16), word(&buffer, 20)], [7, 8]);
    assert_eq!([word(&buffer, 24), word(&buffer, 28)], [2, 1]);
    assert_eq!([word(&buffer, 32), word(&buffer, 36)], [0x1234_5678, 9]);
}

#[test]
fn render_reads_chunk_without_extension_by_its_bytes() {
    let flags = NavGridOverlay {
        version: 1,
        rects: vec![NavGridOverlayRect {
            width: 1,
            height: 1,
            flags: vec![CellFlags::WALL],
            ..Default::default()
        }],
        trailing_byte: 0,
    };
    let mut flag_bytes = Vec::new();
    flags.to_writer(&mut flag_bytes).unwrap();

    assert_eq!(
        word(&render(CHUNK, &file_of(&grid())).unwrap(), 0),
        GRID_MAGIC
    );
    assert_eq!(word(&render(CHUNK, &flag_bytes).unwrap(), 8), FLAGS_KIND);
    assert_eq!(word(&render(CHUNK, &[]).unwrap(), 8), REGIONS_KIND);
}

#[test]
fn render_fails_on_chunk_that_reads_as_no_kind() {
    assert!(matches!(
        render(CHUNK, &[9, 1, 2, 3]),
        Err(PreviewError::NotNavGrid)
    ));
}

#[test]
fn render_fails_with_grid_error_on_chunk_with_grid_version_that_reads_as_no_grid() {
    let bytes = file_of(&grid());

    assert!(matches!(
        render(CHUNK, &bytes[..bytes.len() - 1]),
        Err(PreviewError::NavGridRead(_))
    ));
}

/// Returns the bytes of a region overlay with rects of `sizes` cells, each of 1 row.
fn region_file(sizes: &[u16]) -> Vec<u8> {
    let overlay = RegionOverlay {
        version: 1,
        rects: sizes
            .iter()
            .map(|&width| RegionOverlayRect {
                x: 1,
                y: 2,
                width,
                height: 1,
                region_tags: vec![0x0001_0203; usize::from(width)],
            })
            .collect(),
    };
    let mut bytes = Vec::new();
    overlay.to_writer(&mut bytes).unwrap();
    bytes
}

#[test]
fn region_overlay_file_does_not_read_whole_as_flag_overlay() {
    for sizes in [&[][..], &[0], &[1], &[2, 3], &[0, 0, 0]] {
        let bytes = region_file(sizes);

        assert!(
            !matches!(read_whole(&bytes, NavGridOverlay::from_reader), Ok(Some(_))),
            "a region overlay of rects {sizes:?} reads as a flag overlay"
        );
        assert!(matches!(
            read(CHUNK, &bytes),
            Ok(NavGridFile::Regions(overlay)) if overlay.rects.len() == sizes.len()
        ));
    }
}

#[test]
fn render_fails_on_truncated_grid_named_as_grid() {
    let bytes = file_of(&grid());

    assert!(matches!(
        render("aipath.aimesh_ngrid", &bytes[..bytes.len() - 1]),
        Err(PreviewError::NavGridRead(_))
    ));
}

/// Renders every Map11 navigation grid file under `navgrid/assets/maps/navgrid` of the
/// directory that `LTK_NAVGRID_DATA` names.
#[test]
#[ignore = "reads the extracted Map11 navigation grid files that LTK_NAVGRID_DATA names"]
fn render_reads_every_map11_navgrid_file() {
    let root =
        std::path::PathBuf::from(std::env::var_os("LTK_NAVGRID_DATA").expect("LTK_NAVGRID_DATA"))
            .join("navgrid/assets/maps/navgrid");
    let grid = fs_err::read(root.join("map11/aipath.aimesh_ngrid")).unwrap();

    assert_eq!(
        render("aipath.aimesh_ngrid", &grid).unwrap().len(),
        2_275_656
    );
    assert_eq!(word(&render(CHUNK, &grid).unwrap(), 0), GRID_MAGIC);
    for entry in walkdir::WalkDir::new(&root) {
        let path = entry.unwrap().into_path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if !name.ends_with("_overlay") {
            continue;
        }

        let bytes = fs_err::read(&path).unwrap();
        let named = render(&name, &bytes).unwrap();
        assert_eq!(
            render(CHUNK, &bytes).unwrap(),
            named,
            "{name} reads by its bytes"
        );
    }
}
