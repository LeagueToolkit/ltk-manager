//! Previewing one asset, whichever store its bytes live in.
//!
//! Two seams, kept apart because they vary independently. [`AssetRef`] answers
//! where the bytes come from, and [`Preview`] answers what to draw with them. A
//! new store is a variant on the first, and a new file type is a viewer behind
//! the second.

mod animation;
mod audio;
mod font;
mod light_grid;
mod map;
mod mesh;
mod mips;
mod skeleton;
mod source;
mod texture;
mod tga;
mod web;

use std::io::Cursor;
use std::num::NonZeroU32;

use serde::Serialize;
use thiserror::Error;

use crate::file_kind::WorkshopFileKind;
use crate::game_wads::WadCache;
use ltk_manager_base::config::Config;
use ltk_manager_base::error::{AppError, AppResult, DomainError, ErrorKind};

/// Re-exported because [`PreviewError::Unsupported`] carries one.
pub use animation::{ClipHeader, header as clip_header};
pub use audio::{AudioContainer, AudioInfo, BankFacts};
pub use ltk_file::LeagueFileKind;
pub use map::{encode_map, encode_map_meshes};
pub use skeleton::joint_names;
pub use source::AssetRef;
pub use texture::{TextureContainer, TextureInfo};
pub use web::WebImage;

/// What a preview request asks an asset for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewRequest {
    /// An image, at the smallest mipmap at least `min_width` wide.
    ///
    /// No width asks for full resolution.
    Image { min_width: Option<NonZeroU32> },
    /// The asset's geometry, as one vertex buffer.
    Geometry,
    /// A map's every mesh, baked into world space as one buffer.
    Map,
    /// A skeleton's joints, as one joint buffer.
    Skeleton,
    /// A clip's poses, baked into one pose buffer.
    Animation,
    /// A cube map's six faces at full resolution, stacked top to bottom as one image.
    Cube,
    /// A texture's own mip chain from the smallest mipmap at least `min_width` wide down,
    /// as one buffer. With `blocks`, a block-compressed texture answers its own blocks.
    Mips {
        min_width: Option<NonZeroU32>,
        blocks: bool,
    },
    /// A map's baked light grid, as one ambient buffer.
    LightGrid,
    /// An OpenType or TrueType font's own bytes.
    Font,
    /// The file's own bytes, under the media type a `<video>` or an `<audio>` plays them
    /// as where their signature names one.
    File,
}

/// A decoded preview of one asset, ready for a webview to draw.
#[derive(Debug)]
pub enum Preview {
    Image(PreviewImage),
    /// A buffer the webview decodes, in the layout the module that wrote it documents.
    Buffer(Vec<u8>),
    /// A font the webview loads through `FontFace`.
    Font(PreviewFont),
    /// A file's own bytes, which the webview plays or reads as text.
    File(PreviewFile),
}

/// A file's own bytes, under the MIME type their signature names.
#[derive(Debug)]
pub struct PreviewFile {
    pub bytes: Vec<u8>,
    /// A video or an audio type, or `application/octet-stream` for anything else.
    pub mime: &'static str,
}

/// A font file, under the MIME type its `sfnt` version names.
#[derive(Debug)]
pub struct PreviewFont {
    pub bytes: Vec<u8>,
    /// `font/otf` or `font/ttf`.
    pub mime: &'static str,
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
#[cfg_attr(feature = "ts", derive(specta::Type))]
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
        file_kind: WorkshopFileKind,
    },
    /// An image the webview decodes from the file's own bytes, which draws at whatever size
    /// the `<img>` reports.
    #[serde(rename_all = "camelCase")]
    Web { format: WebImage, size_bytes: u64 },
    /// A Wwise package, bank or WEM, which the audio file document lists.
    Audio(AudioInfo),
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

    /// A cube map was asked of a texture holding other than six faces.
    #[error("The texture is not a cube map")]
    NotCube,

    /// A font was asked of a file that is not an OpenType or TrueType font.
    #[error("The file is not an OpenType or TrueType font")]
    NotFont,

    /// The pixel data would not decode.
    #[error("Could not decode the texture: {0}")]
    Decompress(#[from] ltk_texture::DecompressError),

    /// The decoded surface does not form an image.
    #[error("Could not read the texture as an image: {0}")]
    ToImage(#[from] ltk_texture::ToImageError),

    /// The preview would not encode for the webview.
    #[error("Could not encode the preview: {0}")]
    Encode(#[from] image::ImageError),

    /// The bytes are not an image of the format the file's kind names.
    #[error("Not a readable image: {0}")]
    Image(image::ImageError),

    /// The bytes are not a mesh `ltk_mesh` reads.
    #[error("Not a readable mesh: {0}")]
    MeshRead(#[from] ltk_mesh::error::ParseError),

    /// Tangents could not be generated for the mesh's geometry.
    #[error("Could not bake mesh tangents: {0}")]
    TangentBake(#[from] ltk_mesh::error::BakeTangentsError),

    /// A face names a vertex the mesh does not hold.
    #[error("The mesh's faces reach past its vertices")]
    MeshOutOfBounds,

    /// The asset holds more of something than one preview buffer counts.
    #[error("The asset is larger than one preview buffer holds")]
    BufferTooLarge,

    /// The bytes are not a map `ltk_mapgeo` reads.
    #[error("Not a readable map: {0}")]
    MapRead(#[from] ltk_mapgeo::ParseError),

    /// A map mesh declares no positions in a layout this build decodes.
    #[error("A map mesh has no readable positions")]
    MapVertexLayout,

    /// The bytes are not a skeleton `ltk_anim` reads.
    #[error("Not a readable skeleton: {0}")]
    SkeletonRead(#[from] ltk_anim::ParseError),

    /// A parent or an influence names a joint the skeleton does not hold.
    #[error("The skeleton names a joint it does not hold")]
    SkeletonOutOfBounds,

    /// The bytes are not an animation `ltk_anim` reads.
    #[error("Not a readable animation: {0}")]
    AnimationRead(#[from] ltk_anim::AssetParseError),

    /// The clip's length or frame rate is no number of frames.
    #[error("The animation's length or frame rate is not a number of frames")]
    AnimationTiming,

    /// The clip bakes to more poses than one buffer holds.
    #[error("The animation is longer than one preview bakes")]
    AnimationTooLong,

    /// The bytes are not a light grid the game reads.
    #[error("Not a readable light grid: {0}")]
    LightGridRead(&'static str),
}

impl From<PreviewError> for AppError {
    fn from(error: PreviewError) -> Self {
        Self::Domain(DomainError::new(ErrorKind::Preview, error))
    }
}

impl AssetRef {
    /// Read the asset and render what `request` asks of it.
    ///
    /// An image is whatever the file kind has a viewer for, at the width a thumbnail or
    /// a swatch asked for. Geometry, a skeleton, an animation and a cube map read the bytes
    /// as their format whatever the asset is named, because a chunk carries a path hash for
    /// a name.
    ///
    /// # Errors
    ///
    /// Fails when the asset cannot be read, and with
    /// [`PreviewError::Unsupported`] when nothing here answers the request for
    /// its kind. Reporting rather than returning nothing is what lets the caller
    /// answer with a status, which [`info`](Self::info) does not need.
    pub fn preview(
        &self,
        request: PreviewRequest,
        config: &Config,
        wads: &WadCache,
    ) -> AppResult<Preview> {
        let bytes = self.read(config, wads)?;

        let min_width = match request {
            PreviewRequest::Image { min_width } => min_width,
            PreviewRequest::Geometry => return Ok(Preview::Buffer(mesh::render(&bytes)?)),
            PreviewRequest::Map => return Ok(Preview::Buffer(map::render(&bytes)?)),
            PreviewRequest::Skeleton => return Ok(Preview::Buffer(skeleton::render(&bytes)?)),
            PreviewRequest::Animation => return Ok(Preview::Buffer(animation::render(&bytes)?)),
            PreviewRequest::Cube => return Ok(Preview::Image(texture::render_cube(&bytes)?)),
            PreviewRequest::Mips { min_width, blocks } => {
                return Ok(Preview::Buffer(mips::render(&bytes, min_width, blocks)?));
            }
            PreviewRequest::LightGrid => return Ok(Preview::Buffer(light_grid::render(&bytes)?)),
            PreviewRequest::Font => return Ok(Preview::Font(font::render(bytes)?)),
            PreviewRequest::File => {
                let mime = web::media_mime(&bytes).unwrap_or("application/octet-stream");
                return Ok(Preview::File(PreviewFile { bytes, mime }));
            }
        };

        let image = match self.file_kind(&bytes) {
            LeagueFileKind::Texture | LeagueFileKind::TextureDds => {
                texture::render(&bytes, min_width)?
            }
            LeagueFileKind::Tga => tga::render(&bytes, min_width)?,
            LeagueFileKind::Png => PreviewImage {
                bytes,
                mime: "image/png",
            },
            LeagueFileKind::Jpeg => PreviewImage {
                bytes,
                mime: "image/jpeg",
            },
            kind => match web_image(kind, &bytes) {
                Some(format) => PreviewImage {
                    bytes,
                    mime: format.mime(),
                },
                None => return Err(PreviewError::Unsupported(kind).into()),
            },
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
        self.info_from(&self.read(config, wads)?)
    }

    /// Reports what the asset contains from its bytes `bytes`, as [`info`](Self::info) does.
    ///
    /// No kind reports [`AssetInfo::Audio`] here. The shell reads the info of a Wwise file itself
    /// and does not call this for one.
    ///
    /// # Errors
    ///
    /// Fails when the header of the asset does not parse.
    pub fn info_from(&self, bytes: &[u8]) -> AppResult<AssetInfo> {
        Ok(match self.file_kind(bytes) {
            LeagueFileKind::Texture | LeagueFileKind::TextureDds => {
                AssetInfo::Texture(texture::info(bytes)?)
            }
            kind @ (LeagueFileKind::Png | LeagueFileKind::Jpeg | LeagueFileKind::Tga) => {
                /* A TGA has no magic to guess from, so the kind's format stands
                wherever the bytes name none. */
                let format = match kind {
                    LeagueFileKind::Png => image::ImageFormat::Png,
                    LeagueFileKind::Jpeg => image::ImageFormat::Jpeg,
                    _ => image::ImageFormat::Tga,
                };
                let (width, height) = image::ImageReader::with_format(Cursor::new(bytes), format)
                    .with_guessed_format()?
                    .into_dimensions()
                    .map_err(PreviewError::Image)?;
                AssetInfo::Image {
                    width,
                    height,
                    size_bytes: bytes.len() as u64,
                    file_kind: kind.into(),
                }
            }
            kind => match web_image(kind, bytes) {
                Some(format) => AssetInfo::Web {
                    format,
                    size_bytes: bytes.len() as u64,
                },
                None => AssetInfo::Unsupported {
                    file_kind: WorkshopFileKind::or_signature(kind.into(), bytes),
                },
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
    ///
    /// [`LeagueFileKind::Tga`] comes from a name only. Its pattern is a
    /// three-byte heuristic that any binary can satisfy, so a nameless chunk
    /// the pattern matches stays unknown.
    fn file_kind(&self, bytes: &[u8]) -> LeagueFileKind {
        let named = self
            .name()
            .rsplit_once('.')
            .map_or(LeagueFileKind::Unknown, |(_, extension)| {
                LeagueFileKind::from_extension(extension)
            });

        match named {
            LeagueFileKind::Unknown => match LeagueFileKind::identify_from_bytes(bytes) {
                LeagueFileKind::Tga => LeagueFileKind::Unknown,
                kind => kind,
            },
            kind => kind,
        }
    }
}

/// The web image a file of `kind` is, where it is one.
///
/// An SVG named as one is taken at its name, and a file of no kind `ltk_file` knows is read
/// off its bytes. Every other kind is a League format.
fn web_image(kind: LeagueFileKind, bytes: &[u8]) -> Option<WebImage> {
    match kind {
        LeagueFileKind::Svg => Some(WebImage::Svg),
        LeagueFileKind::Unknown => WebImage::sniff(bytes),
        _ => None,
    }
}

/// `value` as one of a preview buffer's counts.
fn count_of(value: usize) -> Result<u32, PreviewError> {
    u32::try_from(value).map_err(|_| PreviewError::BufferTooLarge)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_err as fs;

    /// The whole of what a caller asked for before geometry was a second answer.
    const FULL_IMAGE: PreviewRequest = PreviewRequest::Image { min_width: None };

    /// A reference to one file written into a temporary directory.
    fn loose(dir: &tempfile::TempDir, name: &str, bytes: &[u8]) -> AssetRef {
        let path = dir.path().join(name);
        fs::write(&path, bytes).unwrap();
        AssetRef::File {
            path: path.to_string_lossy().into_owned(),
        }
    }

    /// The image a preview holds, and a failure for anything else.
    fn drawn(preview: Preview) -> PreviewImage {
        match preview {
            Preview::Image(image) => image,
            other => panic!("expected an image: {other:?}"),
        }
    }

    #[test]
    fn a_kind_with_no_viewer_reports_unsupported() {
        let tmp = tempfile::tempdir().unwrap();
        let asset = loose(&tmp, "data.bin", b"PROP\x00\x00\x00\x00");

        let err = asset
            .preview(FULL_IMAGE, &Config::default(), &WadCache::default())
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

        let preview = drawn(
            asset
                .preview(FULL_IMAGE, &Config::default(), &WadCache::default())
                .unwrap(),
        );

        assert_eq!(preview.mime, "image/png");
        assert_eq!(preview.bytes, png, "the bytes are the file's own");
        assert!(matches!(
            asset
                .info(&Config::default(), &WadCache::default())
                .unwrap(),
            AssetInfo::Image {
                width: 8,
                height: 4,
                file_kind: WorkshopFileKind::Png,
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
            .preview(FULL_IMAGE, &Config::default(), &WadCache::default())
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

        let preview = drawn(
            asset
                .preview(FULL_IMAGE, &Config::default(), &WadCache::default())
                .unwrap(),
        );

        assert_eq!(preview.mime, "image/png");
    }

    /// The webview has no TGA decoder, so a TGA arrives as a PNG.
    #[test]
    fn a_tga_renders_as_a_png_and_reports_its_dimensions() {
        let tmp = tempfile::tempdir().unwrap();
        let mut tga = Vec::new();
        image::RgbaImage::new(8, 4)
            .write_to(&mut Cursor::new(&mut tga), image::ImageFormat::Tga)
            .unwrap();
        let asset = loose(&tmp, "icon.tga", &tga);

        let preview = drawn(
            asset
                .preview(FULL_IMAGE, &Config::default(), &WadCache::default())
                .unwrap(),
        );

        assert_eq!(preview.mime, "image/png");
        assert!(matches!(
            asset
                .info(&Config::default(), &WadCache::default())
                .unwrap(),
            AssetInfo::Image {
                width: 8,
                height: 4,
                file_kind: WorkshopFileKind::Tga,
                ..
            }
        ));
    }

    /// The TGA pattern is a heuristic, so bytes alone never make a TGA.
    #[test]
    fn bytes_that_only_match_the_tga_pattern_have_no_viewer() {
        let tmp = tempfile::tempdir().unwrap();
        let asset = loose(&tmp, "0123456789abcdef", b"\x00\x01\x02\x03");

        let info = asset
            .info(&Config::default(), &WadCache::default())
            .unwrap();

        assert!(matches!(
            info,
            AssetInfo::Unsupported {
                file_kind: WorkshopFileKind::Unknown
            }
        ));
    }

    #[test]
    fn info_reads_nameless_riff_wave_as_wwise_media() {
        let tmp = tempfile::tempdir().unwrap();
        let asset = loose(&tmp, "0123456789abcdef", b"RIFF\x24\x00\x00\x00WAVEfmt ");

        let info = asset
            .info(&Config::default(), &WadCache::default())
            .unwrap();

        assert!(matches!(
            info,
            AssetInfo::Unsupported {
                file_kind: WorkshopFileKind::WwiseMedia
            }
        ));
    }

    /// A caller who asks a texture for geometry has asked the wrong asset, and hears so
    /// rather than being handed an image it did not ask for.
    #[test]
    fn geometry_asked_of_a_texture_reports_unsupported() {
        let tmp = tempfile::tempdir().unwrap();
        let mut png = Vec::new();
        image::RgbaImage::new(2, 2)
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let asset = loose(&tmp, "icon.png", &png);

        let err = asset
            .preview(
                PreviewRequest::Geometry,
                &Config::default(),
                &WadCache::default(),
            )
            .unwrap_err();

        assert!(
            format!("{err}").contains("No preview for a png file"),
            "unexpected error: {err}"
        );
    }

    /// A skeleton and an animation are answered by their bytes, and a texture is neither.
    #[test]
    fn a_skeleton_or_an_animation_asked_of_a_texture_reports_unsupported() {
        let tmp = tempfile::tempdir().unwrap();
        let mut png = Vec::new();
        image::RgbaImage::new(2, 2)
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let asset = loose(&tmp, "icon.png", &png);

        for request in [PreviewRequest::Skeleton, PreviewRequest::Animation] {
            let err = asset
                .preview(request, &Config::default(), &WadCache::default())
                .unwrap_err();

            assert!(
                format!("{err}").contains("No preview for a png file"),
                "unexpected error for {request:?}: {err}"
            );
        }
    }

    /// A width asks for an image, and a mesh has none.
    #[test]
    fn a_width_asked_of_a_mesh_reports_unsupported() {
        let tmp = tempfile::tempdir().unwrap();
        let asset = loose(&tmp, "emitter.skn", b"\x33\x22\x11\x00");

        let err = asset
            .preview(
                PreviewRequest::Image {
                    min_width: NonZeroU32::new(64),
                },
                &Config::default(),
                &WadCache::default(),
            )
            .unwrap_err();

        assert!(
            format!("{err}").contains("No preview for a skn file"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn an_svg_passes_through_under_its_own_type() {
        let tmp = tempfile::tempdir().unwrap();
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"/>"#;
        let asset = loose(&tmp, "icon.svg", svg);

        let Preview::Image(image) = asset
            .preview(FULL_IMAGE, &Config::default(), &WadCache::default())
            .unwrap()
        else {
            panic!("an SVG previews as an image");
        };
        let info = asset
            .info(&Config::default(), &WadCache::default())
            .unwrap();

        assert_eq!(image.mime, "image/svg+xml");
        assert_eq!(image.bytes, svg);
        assert!(matches!(
            info,
            AssetInfo::Web {
                format: WebImage::Svg,
                size_bytes
            } if size_bytes == svg.len() as u64
        ));
    }

    /* A chunk's name is its hash, so the bytes are what say it is a GIF. */
    #[test]
    fn a_nameless_gif_is_read_off_its_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let asset = loose(&tmp, "0123456789abcdef", b"GIF89a\x01\x00\x01\x00");

        let info = asset
            .info(&Config::default(), &WadCache::default())
            .unwrap();

        assert!(matches!(
            info,
            AssetInfo::Web {
                format: WebImage::Gif,
                ..
            }
        ));
    }

    #[test]
    fn a_file_form_answers_the_bytes_under_their_media_type() {
        let tmp = tempfile::tempdir().unwrap();
        let webm = loose(&tmp, "intro.webm", &[0x1a, 0x45, 0xdf, 0xa3, 0x9f]);
        let json = loose(&tmp, "data.json", b"{\"a\": 1}");

        let file_of = |asset: &AssetRef| match asset
            .preview(
                PreviewRequest::File,
                &Config::default(),
                &WadCache::default(),
            )
            .unwrap()
        {
            Preview::File(file) => file,
            other => panic!("a file form answers a file, got {other:?}"),
        };

        assert_eq!(file_of(&webm).mime, "video/webm");
        let text = file_of(&json);
        assert_eq!(text.mime, "application/octet-stream");
        assert_eq!(text.bytes, b"{\"a\": 1}");
    }
}
