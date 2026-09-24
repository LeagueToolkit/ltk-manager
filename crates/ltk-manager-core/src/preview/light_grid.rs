//! One `LightGrid.dat` as the ambient buffer a viewport lights its characters from.
//!
//! A map bakes one ambient cube per cell of a grid laid over its ground, and the game
//! lights a character with the cube of the cell under the centre of its bounds. The file
//! reads the way `LightGrid::LoadImpl` reads it.
//!
//! # The file
//!
//! ```text
//! version     u32   3, and the game ignores any other
//! dataOffset  u32   where the cells start
//! width       i32   cells along X, at least 1
//! height      i32   cells along Z, at least 1
//! extentX     f32   world units the grid covers along X, at least 1
//! extentZ     f32   world units the grid covers along Z, at least 1
//! scale       f32   the ambient's scale over four
//! fullBright  f32   `lightGridCharacterFullBrightIntensity`
//! cells       width * height * 6 * u32 at dataOffset, each B G R and an unused byte
//! ```
//!
//! # The buffer
//!
//! Little-endian, with no padding between blocks.
//!
//! ```text
//! magic       u32   0x4C4B544C, `LTKL`
//! version     u32   1
//! width       u32
//! height      u32
//! extentX     f32
//! extentZ     f32
//! scale       f32   what the cube is multiplied by, four times the file's
//! fullBright  f32
//! cells       width * height * 6 * { r u8, g u8, b u8, a u8 }
//! ```
//!
//! A cell is `x + z * width`, from the grid's corner at the world origin. Its six colours
//! face +X, -X, +Y, -Y, +Z, -Z in the engine's space, with alpha always 255.

use super::PreviewError;

/// The word a light grid buffer opens with, `LTKL` in the order the buffer is written in.
const MAGIC: u32 = 0x4C4B_544C;

/// The layout this module writes.
const VERSION: u32 = 1;

/// The only file version the game reads.
const FILE_VERSION: u32 = 3;

/// The header's size, which is also the least a file with no cells can be.
const HEADER_BYTES: usize = 32;

/// The faces of one cell's ambient cube.
const FACES: usize = 6;

/// What `LightGrid::LoadImpl` multiplies the file's scale by on its way to the shader.
const SCALE_FACTOR: f32 = 4.0;

/// Read a light grid into the buffer a viewport lights its characters from.
///
/// # Errors
///
/// Fails with [`PreviewError::LightGridRead`] where the bytes are no version 3 grid, or
/// hold fewer cells than the header declares.
pub fn render(bytes: &[u8]) -> Result<Vec<u8>, PreviewError> {
    let grid = parse(bytes)?;
    let mut out = Vec::with_capacity(HEADER_BYTES + grid.cells.len());
    for word in [MAGIC, VERSION, grid.width, grid.height] {
        out.extend_from_slice(&word.to_le_bytes());
    }
    for value in [
        grid.extent_x,
        grid.extent_z,
        grid.scale * SCALE_FACTOR,
        grid.full_bright,
    ] {
        out.extend_from_slice(&value.to_le_bytes());
    }
    let (texels, _) = grid.cells.as_chunks::<4>();
    for [b, g, r, _] in texels {
        out.extend_from_slice(&[*r, *g, *b, u8::MAX]);
    }
    Ok(out)
}

/// A grid as the file holds it, its cells still `B G R x`.
struct LightGrid<'a> {
    width: u32,
    height: u32,
    extent_x: f32,
    extent_z: f32,
    scale: f32,
    full_bright: f32,
    cells: &'a [u8],
}

fn parse(bytes: &[u8]) -> Result<LightGrid<'_>, PreviewError> {
    let word = |at: usize| -> Result<[u8; 4], PreviewError> {
        bytes
            .get(at..at + 4)
            .and_then(|slice| slice.try_into().ok())
            .ok_or(PreviewError::LightGridRead("the header is truncated"))
    };
    let unsigned = |at| word(at).map(u32::from_le_bytes);
    let float = |at| word(at).map(f32::from_le_bytes);

    if unsigned(0)? != FILE_VERSION {
        return Err(PreviewError::LightGridRead("not a version 3 light grid"));
    }
    let offset = unsigned(4)? as usize;
    let (width, height) = (unsigned(8)?, unsigned(12)?);
    let (extent_x, extent_z) = (float(16)?, float(20)?);
    /* The same bounds the game checks, where it keeps the grid it had rather than read
    this one. Signed there, so a count past i32 fails here as it does in the game. */
    if !(1..=i32::MAX as u32).contains(&width) || !(1..=i32::MAX as u32).contains(&height) {
        return Err(PreviewError::LightGridRead("the grid has no cells"));
    }
    if !(extent_x >= 1.0 && extent_z >= 1.0) {
        return Err(PreviewError::LightGridRead("the grid covers no ground"));
    }

    let length = (width as usize)
        .checked_mul(height as usize)
        .and_then(|cells| cells.checked_mul(FACES * 4))
        .ok_or(PreviewError::BufferTooLarge)?;
    let cells = offset
        .checked_add(length)
        .and_then(|end| bytes.get(offset..end))
        .ok_or(PreviewError::LightGridRead("the cells are truncated"))?;

    Ok(LightGrid {
        width,
        height,
        extent_x,
        extent_z,
        scale: float(24)?,
        full_bright: float(28)?,
        cells,
    })
}

#[cfg(test)]
mod tests;
