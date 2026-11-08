//! The built-in mod that replaces the loading screen with the user's own image or video.
//!
//! An image becomes a static texture. A WebM video is copied into the archive and played by the
//! game through `AtlasDataVideo`. Either way the mod overrides the loading screen bin, patched to
//! hold one extra element.

use super::overrides::Overrides;
use super::{BuiltinMod, Context, check_called_off};
use image::imageops::FilterType;
use image::{DynamicImage, RgbaImage};
use indexmap::IndexMap;
use ltk_hash::{BinHash, Hash as _};
use ltk_manager_base::config::LoadingScreenSettings;
use ltk_manager_base::error::{AppError, AppResult};
use ltk_meta::property::values;
use ltk_meta::{Bin, BinObject, PropertyValueEnum};
use ltk_texture::Tex;
use ltk_texture::tex::{EncodeFormat, EncodeOptions};
use ltk_wad::{Wad, WadHash};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

const ROOT_PATH: &str = "ClientStates/LoadingScreen/UX/LoadingScreenClassic/UIBase/LoadingScreen";
const ENTRY_NAME: &str = "CustomLoadingScreen";
const TEX_PATH: &str = "assets/ux/loadingscreen/custom/custom_loading_screen.tex";
const VIDEO_PATH: &str = "assets/ux/loadingscreen/custom/custom_loading_screen.webm";

/// The archive holding the stock loading screen bin.
const STOCK_ARCHIVE: &str = "DATA/FINAL/UI.wad.client";

/// The path of the stock loading screen bin inside [`STOCK_ARCHIVE`].
const STOCK_BIN_PATH: &str = "clientstates/loadingscreen/ux/loadingscreenclassic/uibase";

/// The reference space the image is laid out in, and the size it covers.
const SCREEN_W: u32 = 1920;
const SCREEN_H: u32 = 1080;

const TEX_HEADER: usize = 12;
const TEX_FORMAT_BC3: u8 = 12;

/// The EBML header every WebM file starts with.
const WEBM_MAGIC: [u8; 4] = [0x1A, 0x45, 0xDF, 0xA3];

/// What the user chose to show while loading.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Settings {
    pub(super) source: PathBuf,
    pub(super) layer: u32,
}

impl Settings {
    /// The settings for `source`.
    pub(super) fn new(source: PathBuf) -> Self {
        Self { source, layer: 70 }
    }
}

/// The built-in mod itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct LoadingScreen {
    settings: Settings,
}

impl LoadingScreen {
    /// Turns on when enabled and an asset path is configured.
    pub(super) fn of(settings: &LoadingScreenSettings) -> Option<Self> {
        if !settings.enabled {
            return None;
        }

        let source = settings.assets.as_ref()?;
        if source.as_os_str().is_empty() {
            return None;
        }

        Some(Self {
            settings: Settings::new(source.clone()),
        })
    }
}

impl BuiltinMod for LoadingScreen {
    fn slug(&self) -> &'static str {
        "custom-loading-screen"
    }

    fn display_name(&self) -> &'static str {
        "Custom loading screen"
    }

    /// Generates the texture or copies the video, then the patched bin.
    fn generate(&self, cx: &mut Context<'_>) -> AppResult<Overrides> {
        let called_off = cx.called_off;
        let mut overrides = Overrides::default();

        let media = media_kind(&self.settings.source)
            .ok_or_else(|| fail("the file is not a supported image or WebM video"))?;
        check_called_off(called_off)?;

        let kind = match media {
            Media::Image => {
                let built = build_image(&self.settings.source, cx.cache_dir, || {
                    check_called_off(called_off)
                })?;
                check_called_off(called_off)?;
                overrides.insert(STOCK_ARCHIVE, TEX_PATH, built.tex);
                Kind::Image {
                    texture_hash: WadHash::hash_str(TEX_PATH).0,
                    texture_size: (built.width, built.height),
                }
            }
            Media::Video => {
                validate_webm(&self.settings.source)?;
                check_called_off(called_off)?;
                register_video(&mut overrides, &self.settings.source);
                Kind::Video { file: VIDEO_PATH }
            }
        };

        let Some(stock) = read_game_file(cx.game_dir.path(), STOCK_ARCHIVE, STOCK_BIN_PATH) else {
            tracing::warn!("Built-in mods: {STOCK_BIN_PATH} could not be read");
            return Ok(overrides);
        };

        let object = entry_object(&Entry {
            kind,
            layer: self.settings.layer,
        });
        let bin = patch_bin(&stock, object)?;

        overrides.insert(STOCK_ARCHIVE, STOCK_BIN_PATH, bin);
        Ok(overrides)
    }
}

/// Builds an application error with `message`.
fn fail(message: impl Into<String>) -> AppError {
    AppError::Other(message.into())
}

/// Reads the decompressed bytes of `path` from the archive `archive` in `game_dir`.
fn read_game_file(game_dir: &Path, archive: &str, path: &str) -> Option<Vec<u8>> {
    let file = fs_err::File::open(game_dir.join(archive)).ok()?;
    let mut wad = Wad::mount(file).ok()?;
    let chunk = *wad.chunks().get(WadHash::hash_str(path))?;
    let data = wad.load_chunk_decompressed(&chunk).ok()?;
    Some(data.to_vec())
}

/// What kind of file the user dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Media {
    Image,
    Video,
}

/// The kind of `path`, by its extension.
fn media_kind(path: &Path) -> Option<Media> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" => Some(Media::Image),
        "webm" => Some(Media::Video),
        _ => None,
    }
}

/// Registers `source` as the video the loading screen plays.
fn register_video(overrides: &mut Overrides, source: &Path) {
    overrides.insert_copy(STOCK_ARCHIVE, VIDEO_PATH, source.to_path_buf());
}

/// Fails unless `path` starts with the EBML header a WebM file must have.
fn validate_webm(path: &Path) -> AppResult<()> {
    let mut magic = [0u8; 4];
    fs_err::File::open(path)
        .and_then(|mut file| file.read_exact(&mut magic))
        .map_err(|error| fail(format!("the video could not be read: {error}")))?;

    if magic == WEBM_MAGIC {
        Ok(())
    } else {
        Err(fail("the video is not a WebM file"))
    }
}

/// `img` as the bytes of a BC3 `.tex` without mipmaps.
fn encode_tex(img: &RgbaImage) -> AppResult<Vec<u8>> {
    let format = EncodeFormat::Bc3 {
        weigh_colour_by_alpha: false,
    };
    let tex = Tex::encode_rgba_image(img, EncodeOptions::new(format))
        .map_err(|error| fail(format!("the texture could not be encoded: {error}")))?;
    let mut bytes = Vec::new();
    tex.write(&mut bytes)
        .map_err(|error| fail(format!("the texture could not be written: {error}")))?;
    validate_tex(&bytes, img.width(), img.height())?;
    Ok(bytes)
}

/// Whether `bytes` is a BC3 `.tex` of `width` by `height` without mipmaps and of the right length.
fn validate_tex(bytes: &[u8], width: u32, height: u32) -> AppResult<()> {
    let blocks = u64::from(width.div_ceil(4)) * u64::from(height.div_ceil(4));
    let expected = TEX_HEADER as u64 + blocks * 16;
    let header_ok = bytes.len() >= TEX_HEADER
        && &bytes[..4] == b"TEX\0"
        && u32::from(u16::from_le_bytes([bytes[4], bytes[5]])) == width
        && u32::from(u16::from_le_bytes([bytes[6], bytes[7]])) == height
        && bytes[9] == TEX_FORMAT_BC3
        && bytes[11] & 1 == 0;
    if header_ok && bytes.len() as u64 == expected {
        Ok(())
    } else {
        Err(fail(
            "the encoded texture does not have the expected layout",
        ))
    }
}

/// The texture and its size.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Built {
    tex: Vec<u8>,
    width: u32,
    height: u32,
}

/// The `.tex` of `source` scaled to the screen, from the cache when the file is unchanged.
fn build_image<F>(source: &Path, cache_dir: &Path, check: F) -> AppResult<Built>
where
    F: Fn() -> AppResult<()>,
{
    let key = cache_key(source);
    let tex_path = cache_dir.join(format!("loading-screen-{key}.tex"));
    let meta_path = cache_dir.join(format!("loading-screen-{key}.meta"));
    if let Some(built) = read_cache(&tex_path, &meta_path) {
        return Ok(built);
    }

    let image = image::open(source)
        .map_err(|error| fail(format!("the image could not be read: {error}")))?;
    let sheet =
        DynamicImage::resize_to_fill(&image, SCREEN_W, SCREEN_H, FilterType::Lanczos3).to_rgba8();
    check()?;
    let built = Built {
        tex: encode_tex(&sheet)?,
        width: sheet.width(),
        height: sheet.height(),
    };

    write_cache(cache_dir, &tex_path, &meta_path, &built);
    Ok(built)
}

/// A key that changes with the file's size and modification time.
fn cache_key(source: &Path) -> String {
    let (len, modified) = fs_err::metadata(source)
        .map(|meta| {
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_secs());
            (meta.len(), modified)
        })
        .unwrap_or((0, 0));
    let text = format!("{}|{len}|{modified}", source.display());
    format!("{:016x}", WadHash::hash_str(text).0)
}

/// The cached texture and its size, when both are there and agree.
fn read_cache(tex_path: &Path, meta_path: &Path) -> Option<Built> {
    let tex = fs_err::read(tex_path).ok()?;
    let meta = fs_err::read_to_string(meta_path).ok()?;
    let mut values = [0u32; 2];
    for line in meta.lines() {
        let (name, value) = line.split_once('=')?;
        let slot = ["width", "height"]
            .iter()
            .position(|known| *known == name)?;
        values[slot] = value.parse().ok()?;
    }
    let [width, height] = values;
    validate_tex(&tex, width, height).ok()?;
    Some(Built { tex, width, height })
}

/// Saves `built` in the cache. A failure only costs the next run its speed.
fn write_cache(cache_dir: &Path, tex_path: &Path, meta_path: &Path, built: &Built) {
    let meta = format!("width={}\nheight={}\n", built.width, built.height);
    let saved = fs_err::create_dir_all(cache_dir)
        .and_then(|()| fs_err::write(tex_path, &built.tex))
        .and_then(|()| fs_err::write(meta_path, meta));
    if let Err(error) = saved {
        tracing::warn!("Built-in mods: the loading screen cache could not be saved: {error}");
    }
}

/// What the added element shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Image {
        texture_hash: u64,
        texture_size: (u32, u32),
    },
    Video {
        file: &'static str,
    },
}

/// What the added element shows and where it sits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Entry {
    kind: Kind,
    layer: u32,
}

/// The element as a [`BinObject`] to add into the loading screen bin.
fn entry_object(entry: &Entry) -> BinObject {
    let path = format!("{ROOT_PATH}/{ENTRY_NAME}");
    let key = BinHash::hash_str(&path);
    let parent = BinHash::hash_str(ROOT_PATH);

    let position = match entry.kind {
        Kind::Image { .. } => image_position(),
        Kind::Video { .. } => values::Struct {
            class_hash: BinHash(0xc931_f1b9),
            properties: IndexMap::new(),
        },
    };

    let texture = match entry.kind {
        Kind::Image {
            texture_hash,
            texture_size,
        } => image_texture(texture_hash, texture_size),
        Kind::Video { file } => video_texture(file),
    };

    let properties: IndexMap<BinHash, PropertyValueEnum> = [
        (BinHash(0x8d39_bde6), values::String::new(path).into()),
        (BinHash(0x2063_cb13), values::ObjectLink::new(parent).into()),
        (BinHash(0x02f3_b39e), values::Bool::new(true).into()),
        (BinHash(0x07a6_40f6), values::U32::new(entry.layer).into()),
        (BinHash(0x934f_4e0a), PropertyValueEnum::Struct(position)),
        (BinHash(0xe502_c1dc), PropertyValueEnum::Struct(texture)),
    ]
    .into_iter()
    .collect();

    BinObject {
        path_hash: key,
        class_hash: BinHash(0x1a65_e950),
        properties,
    }
}

/// The position of the image: the whole reference screen.
fn image_position() -> values::Struct {
    let layout_embed = values::Struct {
        class_hash: BinHash(0x4eb9_ba4f),
        properties: [
            (
                BinHash(0x934f_4e0a),
                values::Vector2::new(glam::Vec2::new(0.0, 0.0)).into(),
            ),
            (
                BinHash(0x23a0_d95c),
                values::Vector2::new(glam::Vec2::new(SCREEN_W as f32, SCREEN_H as f32)).into(),
            ),
            (
                BinHash(0xf664_7cd6),
                values::U16::new(SCREEN_W as u16).into(),
            ),
            (
                BinHash(0xa19b_2e69),
                values::U16::new(SCREEN_H as u16).into(),
            ),
        ]
        .into_iter()
        .collect(),
    };

    values::Struct {
        class_hash: BinHash(0x4460_0fb6),
        properties: [
            (BinHash(0x3a8b_fbed), values::Embedded(layout_embed).into()),
            (BinHash(0x487f_cd1a), values::Bool::new(true).into()),
        ]
        .into_iter()
        .collect(),
    }
}

/// The texture of the image, a link to its chunk.
fn image_texture(texture_hash: u64, texture_size: (u32, u32)) -> values::Struct {
    let (width, height) = texture_size;
    values::Struct {
        class_hash: BinHash(0x719f_1a94),
        properties: [
            (
                BinHash(0xf972_1a78),
                values::WadChunkLink::new(WadHash(texture_hash)).into(),
            ),
            (BinHash(0xabb7_9fd0), values::U32::new(width).into()),
            (BinHash(0x9f97_05c7), values::U32::new(height).into()),
            (
                BinHash(0x257c_e80c),
                values::Vector4::new(glam::Vec4::new(
                    0.0,
                    0.0,
                    (width - 1) as f32,
                    (height - 1) as f32,
                ))
                .into(),
            ),
        ]
        .into_iter()
        .collect(),
    }
}

/// The texture of the video, played by the game on a loop.
fn video_texture(file: &str) -> values::Struct {
    values::Struct {
        class_hash: BinHash(0x48b5_25af),
        properties: [
            (
                BinHash(0xaaea_5743),
                values::String::new(file.to_owned()).into(),
            ),
            (BinHash(0xddef_486b), values::Bool::new(true).into()),
        ]
        .into_iter()
        .collect(),
    }
}

/// Patches `stock` bin with `object`.
fn patch_bin(stock: &[u8], object: BinObject) -> AppResult<Vec<u8>> {
    let mut bin = Bin::from_reader(&mut Cursor::new(stock))
        .map_err(|error| fail(format!("the loading screen bin could not be read: {error}")))?;
    bin.add_object(object);

    let mut out = Cursor::new(Vec::new());
    bin.to_writer(&mut out).map_err(|error| {
        fail(format!(
            "the loading screen bin could not be written: {error}"
        ))
    })?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests;
