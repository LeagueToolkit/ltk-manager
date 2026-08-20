//! Previewing one asset, whichever store its bytes live in.
//!
//! Two seams, kept apart because they vary independently. [`AssetRef`] answers
//! where the bytes come from, and [`Preview`] answers what to draw with them. A
//! new store is a variant on the first, and a new file type is a viewer behind
//! the second.

mod source;
mod texture;

use std::io::Cursor;

use serde::Serialize;
use thiserror::Error;

use crate::config::Config;
use crate::error::AppResult;
use crate::game_wads::WadCache;
use crate::workshop::WorkshopFileKind;

/// Re-exported because [`PreviewError::Unsupported`] carries one.
pub use ltk_file::LeagueFileKind;
pub use source::AssetRef;
pub use texture::{TextureContainer, TextureInfo};

/// A decoded preview of one asset, ready for a webview to draw.
#[derive(Debug)]
pub enum Preview {
    Image(PreviewImage),
}

/// A preview the webview draws as an image.
#[derive(Debug)]
pub struct PreviewImage {
    pub bytes: Vec<u8>,
    /// The MIME type the bytes are in, for the response that carries them.
    pub mime: &'static str,
}

/// What an asset holds, for a viewer that reports it beside the preview.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AssetInfo {
    /// A texture, in whichever container holds it.
    Texture(TextureInfo),
    /// An image the webview decodes itself, such as a PNG.
    #[serde(rename_all = "camelCase")]
    Image {
        width: u32,
        height: u32,
        size_bytes: u64,
    },
    /// Nothing here has a viewer.
    #[serde(rename_all = "camelCase")]
    Unsupported { file_kind: WorkshopFileKind },
}

/// Why an asset has no preview.
#[derive(Debug, Error)]
pub enum PreviewError {
    /// No viewer handles the asset's file kind.
    #[error("No preview for a {} file", .0.extension().unwrap_or("file of unknown kind"))]
    Unsupported(LeagueFileKind),

    /// The bytes are not a texture either container recognizes.
    #[error("Not a readable texture: {0}")]
    Read(#[from] ltk_texture::ReadError),

    /// The file holds less pixel data than its header declares.
    #[error("The texture is truncated")]
    Truncated,

    /// The pixel data would not decode.
    #[error("Could not decode the texture: {0}")]
    Decompress(#[from] ltk_texture::DecompressError),

    /// The decoded surface does not form an image.
    #[error("Could not read the texture as an image: {0}")]
    ToImage(#[from] ltk_texture::ToImageError),

    /// The preview would not encode for the webview.
    #[error("Could not encode the preview: {0}")]
    Encode(#[from] image::ImageError),
}

impl AssetRef {
    /// Read the asset and render whatever its file kind has a viewer for.
    ///
    /// # Errors
    ///
    /// Fails when the asset cannot be read, and with
    /// [`PreviewError::Unsupported`] when no viewer handles its kind. Reporting
    /// rather than returning nothing is what lets the caller answer with a
    /// status, which [`info`](Self::info) does not need.
    pub fn preview(&self, config: &Config, wads: &WadCache) -> AppResult<Preview> {
        let bytes = self.read(config, wads)?;

        let image = match self.file_kind(&bytes) {
            LeagueFileKind::Texture | LeagueFileKind::TextureDds => texture::render(&bytes)?,
            LeagueFileKind::Png => PreviewImage {
                bytes,
                mime: "image/png",
            },
            LeagueFileKind::Jpeg => PreviewImage {
                bytes,
                mime: "image/jpeg",
            },
            kind => return Err(PreviewError::Unsupported(kind).into()),
        };
        Ok(Preview::Image(image))
    }

    /// Report what the asset holds, without decoding a mipmap.
    ///
    /// A kind with no viewer is [`AssetInfo::Unsupported`] rather than an
    /// error, because the viewer draws it as a state and a modder clicking
    /// through a tree meets it constantly.
    ///
    /// # Errors
    ///
    /// Fails when the asset cannot be read, and when its header does not parse.
    pub fn info(&self, config: &Config, wads: &WadCache) -> AppResult<AssetInfo> {
        let bytes = self.read(config, wads)?;

        Ok(match self.file_kind(&bytes) {
            LeagueFileKind::Texture | LeagueFileKind::TextureDds => {
                AssetInfo::Texture(texture::info(&bytes)?)
            }
            LeagueFileKind::Png | LeagueFileKind::Jpeg => {
                let (width, height) = image::ImageReader::new(Cursor::new(&bytes))
                    .with_guessed_format()?
                    .into_dimensions()
                    .map_err(PreviewError::Encode)?;
                AssetInfo::Image {
                    width,
                    height,
                    size_bytes: bytes.len() as u64,
                }
            }
            kind => AssetInfo::Unsupported {
                file_kind: kind.into(),
            },
        })
    }

    /// The asset's file kind, from its name and then from its magic bytes.
    ///
    /// The name wins because the two stores fail in opposite directions. A
    /// layer file is named by the hash table that extracted it, so its
    /// extension is reliable, and a truncated one still reaches the viewer
    /// that can say what is wrong with it. A chunk under the index's `unknown`
    /// group has a hash for a name and no extension at all, so it falls
    /// through to the magic bytes, which is what it has.
    ///
    /// Nothing is lost to a misleading extension: the two texture kinds share
    /// one viewer, and `ltk_texture` reads the container off the magic anyway.
    /// Reading the name first also sidesteps [`LeagueFileKind::Tga`], whose
    /// pattern is a three-byte heuristic that any binary can satisfy.
    fn file_kind(&self, bytes: &[u8]) -> LeagueFileKind {
        let named = self
            .name()
            .rsplit_once('.')
            .map_or(LeagueFileKind::Unknown, |(_, extension)| {
                LeagueFileKind::from_extension(extension)
            });

        match named {
            LeagueFileKind::Unknown => LeagueFileKind::identify_from_bytes(bytes),
            kind => kind,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A reference to one file written into a temporary directory.
    fn loose(dir: &tempfile::TempDir, name: &str, bytes: &[u8]) -> AssetRef {
        let path = dir.path().join(name);
        fs::write(&path, bytes).unwrap();
        AssetRef::File {
            path: path.to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn a_kind_with_no_viewer_reports_unsupported() {
        let tmp = tempfile::tempdir().unwrap();
        let asset = loose(&tmp, "data.bin", b"PROP\x00\x00\x00\x00");

        let err = asset
            .preview(&Config::default(), &WadCache::default())
            .unwrap_err();

        assert!(
            format!("{err}").contains("No preview"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn a_kind_with_no_viewer_is_a_state_and_not_an_error_for_info() {
        let tmp = tempfile::tempdir().unwrap();
        let asset = loose(&tmp, "data.bin", b"PROP\x00\x00\x00\x00");

        let info = asset
            .info(&Config::default(), &WadCache::default())
            .unwrap();

        assert!(matches!(info, AssetInfo::Unsupported { .. }));
    }

    #[test]
    fn a_png_passes_through_without_a_decode() {
        let tmp = tempfile::tempdir().unwrap();
        let mut png = Vec::new();
        image::RgbaImage::new(8, 4)
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let asset = loose(&tmp, "icon.png", &png);

        let Preview::Image(preview) = asset
            .preview(&Config::default(), &WadCache::default())
            .unwrap();

        assert_eq!(preview.mime, "image/png");
        assert_eq!(preview.bytes, png, "the bytes are the file's own");
        assert!(matches!(
            asset
                .info(&Config::default(), &WadCache::default())
                .unwrap(),
            AssetInfo::Image {
                width: 8,
                height: 4,
                ..
            }
        ));
    }

    /// A broken texture reaches the viewer that can say what is wrong with it,
    /// rather than a heuristic's guess at what the bytes might be.
    #[test]
    fn a_name_routes_a_file_whose_header_is_broken() {
        let tmp = tempfile::tempdir().unwrap();
        /* These bytes satisfy the TGA pattern, which is a three-byte heuristic
        rather than a magic. Reading the name first is what steps around it. */
        let asset = loose(&tmp, "broken.dds", b"\x00\x01\x02\x03");

        let err = asset
            .preview(&Config::default(), &WadCache::default())
            .unwrap_err();

        assert!(
            format!("{err}").contains("Not a readable texture"),
            "the name should have routed this to the texture viewer: {err}"
        );
    }

    /// A chunk the hash tables do not name has only its bytes to go on.
    #[test]
    fn magic_bytes_name_a_file_that_has_no_extension() {
        let tmp = tempfile::tempdir().unwrap();
        let mut png = Vec::new();
        image::RgbaImage::new(2, 2)
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let asset = loose(&tmp, "0123456789abcdef", &png);

        let Preview::Image(preview) = asset
            .preview(&Config::default(), &WadCache::default())
            .unwrap();

        assert_eq!(preview.mime, "image/png");
    }
}
