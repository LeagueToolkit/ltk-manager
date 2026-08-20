use std::io::Cursor;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};
use ltk_texture::tex::{DecodeErr, Format};
use ltk_texture::{DecompressError, Surface, Texture};
use serde::Serialize;

use super::{PreviewError, PreviewImage};

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

/// Decode a texture's largest mipmap into a PNG the webview can draw.
///
/// # Errors
///
/// Fails when `bytes` is not a texture either container recognizes, and when
/// the pixel data does not match what the header declares.
pub fn render(bytes: &[u8]) -> Result<PreviewImage, PreviewError> {
    let texture = Texture::from_reader(&mut Cursor::new(bytes))?;

    // Level 0 is the full resolution level in both containers.
    let image = decode_mipmap(&texture, 0)?.into_rgba_image()?;

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
mod tests {
    use super::*;
    use image::RgbaImage;
    use ltk_texture::Tex;
    use ltk_texture::tex::{EncodeFormat, EncodeOptions};

    /// A `.tex` of `width` by `height`, encoded the way the game ships one.
    fn tex_bytes(width: u32, height: u32, mipmaps: bool) -> Vec<u8> {
        let mut image = RgbaImage::new(width, height);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            *pixel = image::Rgba([x as u8, y as u8, 0x40, 0xFF]);
        }

        let options = EncodeOptions::new(EncodeFormat::Bc3 {
            weigh_colour_by_alpha: false,
        });
        let options = if mipmaps {
            options.with_mipmaps()
        } else {
            options
        };
        let tex = Tex::encode_rgba_image(&image, options).unwrap();

        let mut bytes = Vec::new();
        tex.write(&mut bytes).unwrap();
        bytes
    }

    #[test]
    fn renders_a_tex_at_its_full_resolution() {
        let bytes = tex_bytes(64, 32, true);

        let preview = render(&bytes).unwrap();

        assert_eq!(preview.mime, "image/png");
        let decoded = image::load_from_memory(&preview.bytes).unwrap();
        assert_eq!(
            (decoded.width(), decoded.height()),
            (64, 32),
            "the largest mipmap is the one that renders"
        );
    }

    #[test]
    fn reports_what_a_tex_declares() {
        let info = info(&tex_bytes(64, 32, true)).unwrap();

        assert_eq!(info.width, 64);
        assert_eq!(info.height, 32);
        assert_eq!(info.container, TextureContainer::Tex);
        assert_eq!(info.format.as_deref(), Some("BC3"));
        assert!(info.mip_count > 1, "a mipmapped tex declares its chain");
    }

    #[test]
    fn a_tex_without_mipmaps_still_renders() {
        let bytes = tex_bytes(16, 16, false);

        let decoded = image::load_from_memory(&render(&bytes).unwrap().bytes).unwrap();

        assert_eq!((decoded.width(), decoded.height()), (16, 16));
    }

    #[test]
    fn bytes_that_are_not_a_texture_report_a_read_error() {
        let err = render(b"not a texture at all").unwrap_err();
        assert!(matches!(err, PreviewError::Read(_)));
    }

    #[test]
    fn a_truncated_tex_reports_rather_than_panicking() {
        let bytes = tex_bytes(64, 32, true);

        let err = render(&bytes[..bytes.len() / 2]).unwrap_err();

        assert!(matches!(err, PreviewError::Truncated));
    }
}
