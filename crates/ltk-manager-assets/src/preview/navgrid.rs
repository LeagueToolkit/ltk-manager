//! One navigation grid file as the buffer a viewport draws the navgrid guide from.
//!
//! `ltk_navgrid` reads the three files. A `.aimesh_ngrid` returns an `LTKN` buffer, and a
//! `.ngrid_overlay` or a `.rg_overlay` returns an `LTKO` buffer. The webview writes the overlays
//! into a copy of the grid's arrays (ADR-0079, docs/plans/navgrid-guides.md section 4).
//!
//! # The grid buffer
//!
//! Little-endian. Every block starts on a four-byte boundary.
//!
//! ```text
//! magic       u32   0x4E4B544C, `LTKN`
//! version     u32   1
//! xCells      u32
//! yCells      u32
//! cellSize    f32
//! min         3 * f32
//! max         3 * f32
//! xSamples    u32
//! ySamples    u32
//! xSpacing    f32
//! ySpacing    f32
//! groupNames  8 * u32        FNV-1, 0 for an unused group
//! tagNames    8 * 16 * u32   FNV-1, group-major
//! flags       xCells * yCells * u16, then 2 bytes of padding if the count is odd
//! regionTags  xCells * yCells * u32
//! heights     xCells * yCells * f32
//! samples     xSamples * ySamples * f32
//! ```
//!
//! Cell `(x, y)` is `x + y * xCells`. The buffer leaves out the pathfinding record, the second
//! word of each region tag and the hint grid, which the client skips.
//!
//! # The overlay buffer
//!
//! ```text
//! magic       u32   0x4F4B544C, `LTKO`
//! version     u32   1
//! kind        u32   1 flags, 2 region tags
//! rects       u32
//! per rect    x i32, y i32, width u32, height u32,
//!             then width * height values: u16 for flags, padded to 4 bytes, u32 for region tags
//! ```
//!
//! An empty `.rg_overlay` file is an overlay buffer with no rects.
//!
//! # The file kind
//!
//! The extension of the asset's name selects the file kind. A chunk that has only a path hash for
//! a name is read as the first kind that reads every byte: a grid if the first byte is version 6
//! or 7, then a flag overlay, then a region overlay. An empty file is a region overlay.
//!
//! The two overlay kinds cannot both read the same bytes. A flag overlay is 2 header bytes, a
//! 16-byte header and 2 bytes per value for each rect, and 1 trailing byte, which is an odd
//! length. A region overlay is 2 header bytes, and an 8-byte header and 4 bytes per value for each
//! rect, which is an even length.

use ltk_navgrid::{
    NavGrid, NavGridOverlay, REGION_TAG_GROUP_COUNT, REGION_TAGS_PER_GROUP, RegionOverlay,
};

use super::{PreviewError, count_of};

/// The word a grid buffer opens with, `LTKN` in the order the buffer is written in.
const GRID_MAGIC: u32 = 0x4E4B_544C;

/// The word an overlay buffer opens with, `LTKO` in the order the buffer is written in.
const OVERLAY_MAGIC: u32 = 0x4F4B_544C;

/// The layout this module writes, for both buffers.
const VERSION: u32 = 1;

/// The `kind` of an overlay buffer of cell flags.
const FLAGS_KIND: u32 = 1;

/// The `kind` of an overlay buffer of region tags.
const REGIONS_KIND: u32 = 2;

/// The bytes of the grid buffer before the `flags` block.
const GRID_HEADER_BYTES: usize = 60 + 4 * REGION_TAG_GROUP_COUNT * (1 + REGION_TAGS_PER_GROUP);

/// The grid versions that `ltk_navgrid` reads.
const GRID_VERSIONS: std::ops::RangeInclusive<u8> = 6..=7;

/// One navigation grid file, read.
enum NavGridFile {
    Grid(Box<NavGrid>),
    Flags(NavGridOverlay),
    Regions(RegionOverlay),
}

/// Reads the navigation grid file `bytes` named `name` into the buffer of its kind.
///
/// # Errors
///
/// Fails with [`PreviewError::NavGridRead`] if `ltk_navgrid` cannot read the file of the kind
/// that the extension of `name` selects, or if `name` has no navigation grid extension, the
/// first byte is 6 or 7 and the bytes do not read as a grid. Fails with
/// [`PreviewError::NotNavGrid`] if `name` has no navigation grid extension and the bytes read
/// as no kind. Fails with
/// [`PreviewError::BufferTooLarge`] if a count does not fit a `u32`.
pub fn render(name: &str, bytes: &[u8]) -> Result<Vec<u8>, PreviewError> {
    match read(name, bytes)? {
        NavGridFile::Grid(grid) => grid_buffer(&grid),
        NavGridFile::Flags(overlay) => flags_buffer(&overlay),
        NavGridFile::Regions(overlay) => regions_buffer(&overlay),
    }
}

/// Reads `bytes` as the kind that the extension of `name` selects, else as the first kind that
/// reads every byte.
fn read(name: &str, bytes: &[u8]) -> Result<NavGridFile, PreviewError> {
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    let reader = &mut &*bytes;
    match extension.as_deref() {
        Some("aimesh_ngrid") => {
            return Ok(NavGridFile::Grid(Box::new(NavGrid::from_reader(reader)?)));
        }
        Some("ngrid_overlay") => {
            return Ok(NavGridFile::Flags(NavGridOverlay::from_reader(reader)?));
        }
        Some("rg_overlay") => return Ok(NavGridFile::Regions(RegionOverlay::from_reader(reader)?)),
        _ => {}
    }

    /* Shipped overlays store version 1, so a first byte of 6 or 7 is a grid, and its read error
    is the one to report. */
    if bytes
        .first()
        .is_some_and(|version| GRID_VERSIONS.contains(version))
        && let Some(grid) = read_whole(bytes, NavGrid::from_reader)?
    {
        return Ok(NavGridFile::Grid(Box::new(grid)));
    }

    /* The order of the two overlay reads does not change the result, see "The file kind". */
    if let Ok(Some(overlay)) = read_whole(bytes, NavGridOverlay::from_reader) {
        return Ok(NavGridFile::Flags(overlay));
    }
    read_whole(bytes, RegionOverlay::from_reader)
        .ok()
        .flatten()
        .map(NavGridFile::Regions)
        .ok_or(PreviewError::NotNavGrid)
}

/// Returns what `parse` reads from `bytes`. Returns `None` if the read leaves a byte.
///
/// # Errors
///
/// Fails with [`PreviewError::NavGridRead`] if `parse` fails.
fn read_whole<'a, T>(
    bytes: &'a [u8],
    parse: impl FnOnce(&mut &'a [u8]) -> ltk_navgrid::Result<T>,
) -> Result<Option<T>, PreviewError> {
    let mut rest = bytes;
    let value = parse(&mut rest)?;

    Ok(rest.is_empty().then_some(value))
}

/// Writes `grid` as the grid buffer.
fn grid_buffer(grid: &NavGrid) -> Result<Vec<u8>, PreviewError> {
    let cells = grid.cells();
    let samples = grid.sampled_heights();
    let padding = cells.len() % 2 * 2;
    let mut out = Vec::with_capacity(
        GRID_HEADER_BYTES + cells.len() * (2 + 4 + 4) + padding + samples.len() * 4,
    );

    for word in [
        GRID_MAGIC,
        VERSION,
        grid.x_cell_count(),
        grid.y_cell_count(),
    ] {
        out.extend(word.to_le_bytes());
    }
    out.extend(grid.cell_size().to_le_bytes());
    for value in grid
        .min_position()
        .to_array()
        .into_iter()
        .chain(grid.max_position().to_array())
    {
        out.extend(value.to_le_bytes());
    }
    for word in [grid.x_sample_count(), grid.y_sample_count()] {
        out.extend(word.to_le_bytes());
    }
    for value in [grid.x_sample_spacing(), grid.y_sample_spacing()] {
        out.extend(value.to_le_bytes());
    }

    let groups = grid.region_tag_groups();
    for group in groups {
        out.extend(group.name.to_le_bytes());
    }
    for tag in groups.iter().flat_map(|group| &group.tags) {
        out.extend(tag.name.to_le_bytes());
    }

    for cell in cells {
        out.extend(cell.flags.bits().to_le_bytes());
    }
    out.resize(out.len() + padding, 0);
    for cell in cells {
        out.extend(cell.region_tags.to_le_bytes());
    }
    for cell in cells {
        out.extend(cell.height.to_le_bytes());
    }
    for sample in samples {
        out.extend(sample.to_le_bytes());
    }

    Ok(out)
}

/// Writes the flag overlay `overlay` as an overlay buffer.
fn flags_buffer(overlay: &NavGridOverlay) -> Result<Vec<u8>, PreviewError> {
    let mut out = overlay_header(FLAGS_KIND, overlay.rects.len())?;

    for rect in &overlay.rects {
        rect_header(&mut out, rect.x, rect.y, rect.width, rect.height);
        for flags in &rect.flags {
            out.extend(flags.bits().to_le_bytes());
        }
        out.resize(out.len() + rect.flags.len() % 2 * 2, 0);
    }

    Ok(out)
}

/// Writes the region tag overlay `overlay` as an overlay buffer.
fn regions_buffer(overlay: &RegionOverlay) -> Result<Vec<u8>, PreviewError> {
    let mut out = overlay_header(REGIONS_KIND, overlay.rects.len())?;

    for rect in &overlay.rects {
        rect_header(
            &mut out,
            rect.x.into(),
            rect.y.into(),
            rect.width.into(),
            rect.height.into(),
        );
        for tags in &rect.region_tags {
            out.extend(tags.to_le_bytes());
        }
    }

    Ok(out)
}

/// Returns the header of an overlay buffer of `kind` with `rects` rects.
fn overlay_header(kind: u32, rects: usize) -> Result<Vec<u8>, PreviewError> {
    let mut out = Vec::new();
    for word in [OVERLAY_MAGIC, VERSION, kind, count_of(rects)?] {
        out.extend(word.to_le_bytes());
    }

    Ok(out)
}

/// Writes the position and the size of one overlay rect.
fn rect_header(out: &mut Vec<u8>, x: i32, y: i32, width: u32, height: u32) {
    out.extend(x.to_le_bytes());
    out.extend(y.to_le_bytes());
    out.extend(width.to_le_bytes());
    out.extend(height.to_le_bytes());
}

/// Returns the bytes of a version 7 `.aimesh_ngrid` with every value zero but its size.
///
/// The grid has `cells` cells of `cell_size` units from the world origin, and `samples` height
/// samples that span the same area. Read it with [`NavGrid::from_reader`] and set the values
/// that a test needs through the mutable accessors.
///
/// # Panics
///
/// Panics if a count of `samples` is under 2, because the sample spacing is then undefined.
#[cfg(any(test, feature = "test-util"))]
#[must_use]
pub fn nav_grid_file(cells: [u32; 2], cell_size: f32, samples: [u32; 2]) -> Vec<u8> {
    assert!(
        samples.iter().all(|count| *count >= 2),
        "a grid needs at least 2 samples per axis, got {samples:?}"
    );

    let cell_count = (cells[0] * cells[1]) as usize;
    let extent = cells.map(|count| count as f32 * cell_size);
    let mut out = vec![7];
    out.extend(0u16.to_le_bytes());
    for value in [0.0, 0.0, 0.0, extent[0], 0.0, extent[1], cell_size] {
        out.extend(f32::to_le_bytes(value));
    }
    out.extend(cells[0].to_le_bytes());
    out.extend(cells[1].to_le_bytes());

    /* The 48-byte pathfinding record, then a `u16` of flags and a `u32` of region tags. */
    out.resize(out.len() + cell_count * (48 + 2 + 4), 0);
    out.resize(
        out.len() + REGION_TAG_GROUP_COUNT * (4 + REGION_TAGS_PER_GROUP * 8),
        0,
    );

    out.extend(samples[0].to_le_bytes());
    out.extend(samples[1].to_le_bytes());
    out.extend((extent[0] / (samples[0] - 1) as f32).to_le_bytes());
    out.extend((extent[1] / (samples[1] - 1) as f32).to_le_bytes());
    out.resize(
        out.len() + (samples[0] * samples[1]) as usize * 4 + ltk_navgrid::HINT_GRID_SIZE,
        0,
    );

    out
}

#[cfg(test)]
mod tests;
