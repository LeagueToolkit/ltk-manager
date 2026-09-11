use std::io::Cursor;
use std::num::NonZeroU32;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder, RgbaImage};
use image_dds::ddsfile::Dds;
use image_dds::error::SurfaceError;
use ltk_texture::tex::{DecodeErr, Format};
use ltk_texture::{DecompressError, ReadError, Surface, Texture, ToImageError};
use serde::Serialize;

use super::{PreviewError, PreviewImage};

/// The faces a cube map holds.
const CUBE_FACES: u32 = 6;

/// What a texture file declares about itself.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TextureInfo {
    pub width: u32,
    pub height: u32,
    pub container: TextureContainer,
    /// The block format, where the container names one.
    ///
    /// `None` for a DDS, because `ltk_texture` keeps the header private.
    pub format: Option<String>,
    pub mip_count: u32,
    /// The size of the file itself, not of a decoded mipmap.
    pub size_bytes: u64,
}

/// The file format a texture arrives in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TextureContainer {
    /// League's own extended texture format.
    Tex,
    /// <https://en.wikipedia.org/wiki/DirectDraw_Surface>
    Dds,
}

/// Decode a texture into a PNG the webview can draw, at the smallest mipmap
/// at least `min_width` wide.
///
/// No width asks for level 0, the full resolution. A width the chain has no
/// mipmap for, and a texture with no chain, decode level 0 as well.
///
/// # Errors
///
/// Fails when `bytes` is not a texture either container recognizes, and when
/// the pixel data does not match what the header declares.
pub fn render(bytes: &[u8], min_width: Option<NonZeroU32>) -> Result<PreviewImage, PreviewError> {
    let texture = Texture::from_reader(&mut Cursor::new(bytes))?;

    let level = level_for(texture.width(), texture.mip_count(), min_width);
    let image = decode_mipmap(&texture, level)?.into_rgba_image()?;
    png_of(&image)
}

/// Decode a cube map's full-resolution faces into one PNG, stacked top to bottom.
///
/// The faces keep the order a DDS stores them in, `+X`, `-X`, `+Y`, `-Y`, `+Z` then `-Z`,
/// which is the order a WebGL cube map takes them in.
///
/// # Errors
///
/// Fails when `bytes` is not a DDS, with [`PreviewError::NotCube`] for one holding other
/// than six faces, and when the pixel data does not decode.
pub fn render_cube(bytes: &[u8]) -> Result<PreviewImage, PreviewError> {
    let dds = Dds::read(Cursor::new(bytes)).map_err(ReadError::from)?;
    let surface = image_dds::Surface::from_dds(&dds).map_err(undecoded)?;
    if surface.layers != CUBE_FACES {
        return Err(PreviewError::NotCube);
    }

    let faces = surface
        .decode_layers_mipmaps_rgba8(0..CUBE_FACES, 0..1)
        .map_err(undecoded)?
        .into_image()
        .map_err(ToImageError::from)?;
    png_of(&faces)
}

/// A DDS surface that would not decode, as the error a flat DDS reports it with.
fn undecoded(error: SurfaceError) -> PreviewError {
    DecompressError::from(ltk_texture::dds::DecodeErr::from(error)).into()
}

/// `image` as the PNG a preview answers with.
fn png_of(image: &RgbaImage) -> Result<PreviewImage, PreviewError> {
    /* Fast and unfiltered rather than compressed: this is a response to one
    `<img>` on the same machine, and nothing stores it. */
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::NoFilter)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )?;

    Ok(PreviewImage {
        bytes: png,
        mime: "image/png",
    })
}

/// Report what a texture declares, without decoding a mipmap.
///
/// # Errors
///
/// Fails when `bytes` is not a texture either container recognizes.
pub fn info(bytes: &[u8]) -> Result<TextureInfo, PreviewError> {
    let texture = Texture::from_reader(&mut Cursor::new(bytes))?;
    let size_bytes = bytes.len() as u64;

    Ok(match &texture {
        Texture::Tex(tex) => TextureInfo {
            width: tex.width.into(),
            height: tex.height.into(),
            container: TextureContainer::Tex,
            format: Some(format_name(tex.format).to_owned()),
            mip_count: tex.mip_count,
            size_bytes,
        },
        Texture::Dds(dds) => TextureInfo {
            width: dds.width(),
            height: dds.height(),
            container: TextureContainer::Dds,
            format: None,
            mip_count: dds.mip_count(),
            size_bytes,
        },
    })
}

/// The level of the smallest mipmap at least `min_width` wide, and 0 for no width.
///
/// Mip dimensions halve per level with a floor of 1, in both containers. A
/// `mip_count` past what the width halves into is the header's claim and the
/// decoder's to report.
fn level_for(width: u32, mip_count: u32, min_width: Option<NonZeroU32>) -> u32 {
    let Some(min_width) = min_width else {
        return 0;
    };
    let min_width = min_width.get();
    let mip_width = |level: u32| width.checked_shr(level).unwrap_or(0).max(1);
    (0..mip_count)
        .rev()
        .find(|&level| mip_width(level) >= min_width)
        .unwrap_or(0)
}

/// Decode one mipmap, reporting a half-written file as the condition it is.
///
/// A mip that runs past the data the file holds is a truncated file, which is
/// the user's rather than a bug in this program.
fn decode_mipmap(texture: &Texture, level: u32) -> Result<Surface<'_>, PreviewError> {
    match texture.decode_mipmap(level) {
        Ok(surface) => Ok(surface),
        Err(DecompressError::Tex(DecodeErr::MipOutOfBounds { .. })) => Err(PreviewError::Truncated),
        Err(e) => Err(PreviewError::from(e)),
    }
}

/// The block format's name, as `ltk_texture` spells it.
fn format_name(format: Format) -> &'static str {
    match format {
        Format::Etc1 => "ETC1",
        Format::Etc2Eac => "ETC2/EAC",
        Format::Bc1 => "BC1",
        Format::Bc3 => "BC3",
        Format::Bc7 => "BC7",
        Format::Bc5Snorm => "BC5",
        Format::Bgra8 => "BGRA8",
        Format::Rgba16Float => "RGBA16F",
        Format::Rgba32Float => "RGBA32F",
    }
}

#[cfg(test)]
mod tests;
