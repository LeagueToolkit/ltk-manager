//! The built-in mod that replaces the loading screen with the user's own image or video.
//!
//! An image becomes a static, full-screen element. A video becomes a sprite sheet that the game
//! plays as a flipbook. Either way the mod overrides two files in one game archive: the new `.tex`
//! texture and the loading screen bin, patched to hold one extra element.

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
use std::process::{Command, Stdio};

const ROOT_PATH: &str = "ClientStates/LoadingScreen/UX/LoadingScreenClassic/UIBase/LoadingScreen";
const ENTRY_NAME: &str = "CustomLoadingScreen";
const TEX_PATH: &str = "assets/ux/loadingscreen/custom/custom_loading_screen.tex";

/// The archive holding the stock loading screen bin.
const STOCK_ARCHIVE: &str = "DATA/FINAL/UI.wad.client";

/// The path of the stock loading screen bin inside [`STOCK_ARCHIVE`].
const STOCK_BIN_PATH: &str = "clientstates/loadingscreen/ux/loadingscreenclassic/uibase";

/// The reference space the element is laid out in, and the size it covers.
const SCREEN_W: u32 = 1920;
const SCREEN_H: u32 = 1080;
const MAX_SIDE: u32 = 16384;
const MAX_SHEET_BYTES: u64 = 64 * 1024 * 1024;
const MIN_FRAME_WIDTH: u32 = 64;
const TEX_HEADER: usize = 12;
const TEX_FORMAT_BC3: u8 = 12;

/// What the user chose to show while loading.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Settings {
    pub(super) source: PathBuf,
    pub(super) fps: u32,
    pub(super) max_frames: u32,
    pub(super) frame_width: u32,
    pub(super) frame_height: u32,
    pub(super) layer: u32,
    /// Where ffmpeg is located.
    pub(super) ffmpeg: PathBuf,
}

impl Settings {
    /// The defaults for `source`: small frames, so the sheet stays far below the limits.
    pub(super) fn new(source: PathBuf) -> Self {
        Self {
            source,
            fps: 30,
            max_frames: 120,
            frame_width: 640,
            frame_height: 360,
            layer: 70,
            ffmpeg: resolve_ffmpeg(),
        }
    }
}

/// Resolves the FFmpeg binary from managed integrations or system PATH.
fn resolve_ffmpeg() -> PathBuf {
    if let Ok(base) = std::env::var("LOCALAPPDATA")
        .or_else(|_| std::env::var("XDG_DATA_HOME"))
        .or_else(|_| std::env::var("HOME").map(|h| format!("{h}/.local/share")))
    {
        let managed = PathBuf::from(base).join("LeagueToolkit/Manager/integrations/ffmpeg");
        let exe = if cfg!(windows) {
            managed.join("ffmpeg.exe")
        } else {
            managed.join("ffmpeg")
        };
        if exe.is_file() {
            return exe;
        }
    }

    PathBuf::from(if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    })
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

    /// Generates the texture and the patched bin.
    fn generate(&self, cx: &mut Context<'_>) -> AppResult<Overrides> {
        let called_off = cx.called_off;
        let mut overrides = Overrides::default();

        let built = build_assets(&self.settings, cx.cache_dir, || {
            check_called_off(called_off)
        })?;
        check_called_off(called_off)?;

        let Some(stock) = read_game_file(cx.game_dir.path(), STOCK_ARCHIVE, STOCK_BIN_PATH) else {
            tracing::warn!("Built-in mods: {STOCK_BIN_PATH} could not be read");
            return Ok(overrides);
        };

        let object = entry_object(&Entry {
            texture_hash: WadHash::hash_str(TEX_PATH).0,
            texture_size: (built.width, built.height),
            anim: built.anim,
            layer: self.settings.layer,
        });
        let bin = patch_bin(&stock, object)?;

        overrides.insert(STOCK_ARCHIVE, TEX_PATH, built.tex);
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
        "mp4" | "webm" | "mov" | "mkv" | "avi" | "gif" => Some(Media::Video),
        _ => None,
    }
}

/// How the frames of a sprite sheet are laid out, left to right and then top to bottom.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Layout {
    frames: u32,
    cols: u32,
    rows: u32,
    frame_w: u32,
    frame_h: u32,
}

impl Layout {
    fn sheet_w(self) -> u32 {
        self.cols * self.frame_w
    }

    fn sheet_h(self) -> u32 {
        self.rows * self.frame_h
    }

    /// The bytes of the `.tex` pixels, at one byte a pixel.
    fn tex_bytes(self) -> u64 {
        u64::from(self.sheet_w()) * u64::from(self.sheet_h())
    }

    fn fits(self) -> bool {
        self.sheet_w() <= MAX_SIDE
            && self.sheet_h() <= MAX_SIDE
            && self.tex_bytes() <= MAX_SHEET_BYTES
    }
}

/// `value` rounded down to a multiple of 4, which BC3 blocks need, and at least 4.
fn round4(value: u32) -> u32 {
    (value / 4 * 4).max(4)
}

/// The layout of `frames` frames of `frame_w` by `frame_h` that is closest to a square.
fn near_square(frames: u32, frame_w: u32, frame_h: u32) -> Layout {
    let frames = frames.max(1);
    let ideal = (f64::from(frames) * f64::from(frame_h) / f64::from(frame_w)).sqrt();
    let cols = (ideal.ceil() as u32).clamp(1, frames);
    Layout {
        frames,
        cols,
        rows: frames.div_ceil(cols),
        frame_w,
        frame_h,
    }
}

/// The layout of `frames` frames, with the frame shrunk until the sheet is within the limits.
fn fit_layout(frames: u32, frame_w: u32, frame_h: u32) -> Option<Layout> {
    let (mut frame_w, mut frame_h) = (round4(frame_w), round4(frame_h));
    loop {
        let layout = near_square(frames, frame_w, frame_h);
        if layout.fits() {
            return Some(layout);
        }
        let next = (round4(frame_w * 85 / 100), round4(frame_h * 85 / 100));
        if next.0 < MIN_FRAME_WIDTH || next == (frame_w, frame_h) {
            return None;
        }
        (frame_w, frame_h) = next;
    }
}

/// The raw RGBA frames of the video, back to back, scaled to cover and cropped to `layout`.
fn decode_frames<F>(settings: &Settings, layout: Layout, check: F) -> AppResult<Vec<u8>>
where
    F: Fn() -> AppResult<()>,
{
    check()?;
    let (w, h) = (layout.frame_w, layout.frame_h);
    let filter = format!(
        "fps={},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}",
        settings.fps
    );
    let mut child = Command::new(&settings.ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(&settings.source)
        .args(["-vf", &filter, "-an", "-frames:v"])
        .arg(layout.frames.to_string())
        .args(["-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                fail("FFmpeg is not installed. Please install FFmpeg via Integrations.")
            } else {
                fail(format!("ffmpeg could not start: {error}"))
            }
        })?;

    let mut raw = Vec::new();
    if let Some(mut stdout) = child.stdout.take() {
        stdout
            .read_to_end(&mut raw)
            .map_err(|error| fail(format!("ffmpeg output could not be read: {error}")))?;
    }
    let status = child
        .wait()
        .map_err(|error| fail(format!("ffmpeg did not finish: {error}")))?;
    if !status.success() {
        return Err(fail("ffmpeg could not read the video"));
    }
    check()?;
    Ok(raw)
}

/// The sprite sheet of `raw` frames, with the layout that holds the frames actually decoded.
fn build_sheet(raw: &[u8], plan: Layout) -> AppResult<(RgbaImage, Layout)> {
    let frame_bytes = plan.frame_w as usize * plan.frame_h as usize * 4;
    let frames = (raw.len() / frame_bytes) as u32;
    if frames == 0 {
        return Err(fail("the video holds no frames"));
    }
    let layout = Layout {
        frames,
        rows: frames.div_ceil(plan.cols),
        ..plan
    };

    let mut sheet = RgbaImage::new(layout.sheet_w(), layout.sheet_h());
    let stride = layout.sheet_w() as usize * 4;
    let row_bytes = layout.frame_w as usize * 4;
    let pixels: &mut [u8] = &mut sheet;
    for (index, frame) in raw.chunks_exact(frame_bytes).enumerate() {
        let col = index as u32 % layout.cols;
        let row = index as u32 / layout.cols;
        let origin = row as usize * layout.frame_h as usize * stride + col as usize * row_bytes;
        for (line, source) in frame.chunks_exact(row_bytes).enumerate() {
            let at = origin + line * stride;
            pixels[at..at + row_bytes].copy_from_slice(source);
        }
    }
    Ok((sheet, layout))
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

/// What is known of a sprite sheet beyond its pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Anim {
    frames: u32,
    cols: u32,
    frame_w: u32,
    frame_h: u32,
    fps: u32,
}

/// The texture and what the bin needs to know of it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Built {
    tex: Vec<u8>,
    width: u32,
    height: u32,
    /// None for a still image.
    anim: Option<Anim>,
}

/// The `.tex` and its animation, from the cache when the file and settings are unchanged.
fn build_assets<F>(settings: &Settings, cache_dir: &Path, check: F) -> AppResult<Built>
where
    F: Fn() -> AppResult<()>,
{
    let media = media_kind(&settings.source)
        .ok_or_else(|| fail("the file is not a supported image or video"))?;

    let key = cache_key(settings);
    let tex_path = cache_dir.join(format!("loading-screen-{key}.tex"));
    let meta_path = cache_dir.join(format!("loading-screen-{key}.meta"));
    if let Some(built) = read_cache(&tex_path, &meta_path) {
        return Ok(built);
    }

    let built = match media {
        Media::Image => {
            let image = image::open(&settings.source)
                .map_err(|error| fail(format!("the image could not be read: {error}")))?;
            let sheet =
                DynamicImage::resize_to_fill(&image, SCREEN_W, SCREEN_H, FilterType::Lanczos3)
                    .to_rgba8();
            Built {
                tex: encode_tex(&sheet)?,
                width: sheet.width(),
                height: sheet.height(),
                anim: None,
            }
        }
        Media::Video => {
            let fps = settings.fps.clamp(1, 60);
            let plan = fit_layout(
                settings.max_frames.max(1),
                settings.frame_width,
                settings.frame_height,
            )
            .ok_or_else(|| {
                fail("the video does not fit a sprite sheet, even at the smallest size")
            })?;
            let plan_settings = Settings {
                fps,
                ..settings.clone()
            };
            let raw = decode_frames(&plan_settings, plan, &check)?;
            let (sheet, layout) = build_sheet(&raw, plan)?;
            check()?;
            Built {
                tex: encode_tex(&sheet)?,
                width: sheet.width(),
                height: sheet.height(),
                anim: Some(Anim {
                    frames: layout.frames,
                    cols: layout.cols,
                    frame_w: layout.frame_w,
                    frame_h: layout.frame_h,
                    fps,
                }),
            }
        }
    };

    write_cache(cache_dir, &tex_path, &meta_path, &built);
    Ok(built)
}

/// A key that changes with the file's size and time and with every setting that shapes the output.
fn cache_key(settings: &Settings) -> String {
    let (len, modified) = fs_err::metadata(&settings.source)
        .map(|meta| {
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_secs());
            (meta.len(), modified)
        })
        .unwrap_or((0, 0));
    let text = format!(
        "{}|{len}|{modified}|{}|{}|{}|{}",
        settings.source.display(),
        settings.fps,
        settings.max_frames,
        settings.frame_width,
        settings.frame_height,
    );
    format!("{:016x}", WadHash::hash_str(text).0)
}

/// The cached texture and its details, when both are there and agree.
fn read_cache(tex_path: &Path, meta_path: &Path) -> Option<Built> {
    let tex = fs_err::read(tex_path).ok()?;
    let meta = fs_err::read_to_string(meta_path).ok()?;
    let mut values = [0u32; 7];
    for line in meta.lines() {
        let (name, value) = line.split_once('=')?;
        let slot = [
            "width", "height", "frames", "cols", "frame_w", "frame_h", "fps",
        ]
        .iter()
        .position(|known| *known == name)?;
        values[slot] = value.parse().ok()?;
    }
    let [width, height, frames, cols, frame_w, frame_h, fps] = values;
    validate_tex(&tex, width, height).ok()?;
    let anim = (frames > 0).then_some(Anim {
        frames,
        cols,
        frame_w,
        frame_h,
        fps,
    });
    Some(Built {
        tex,
        width,
        height,
        anim,
    })
}

/// Saves `built` in the cache. A failure only costs the next run its speed.
fn write_cache(cache_dir: &Path, tex_path: &Path, meta_path: &Path, built: &Built) {
    let anim = built.anim.unwrap_or(Anim {
        frames: 0,
        cols: 0,
        frame_w: 0,
        frame_h: 0,
        fps: 0,
    });
    let meta = format!(
        "width={}\nheight={}\nframes={}\ncols={}\nframe_w={}\nframe_h={}\nfps={}\n",
        built.width, built.height, anim.frames, anim.cols, anim.frame_w, anim.frame_h, anim.fps
    );
    let saved = fs_err::create_dir_all(cache_dir)
        .and_then(|()| fs_err::write(tex_path, &built.tex))
        .and_then(|()| fs_err::write(meta_path, meta));
    if let Err(error) = saved {
        tracing::warn!("Built-in mods: the loading screen cache could not be saved: {error}");
    }
}

/// What the added element shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Entry {
    texture_hash: u64,
    texture_size: (u32, u32),
    /// None for a still image.
    anim: Option<Anim>,
    layer: u32,
}

/// The element as a [`BinObject`] to add into the loading screen bin.
fn entry_object(entry: &Entry) -> BinObject {
    let path = format!("{ROOT_PATH}/{ENTRY_NAME}");
    let key = BinHash::hash_str(&path);
    let parent = BinHash::hash_str(ROOT_PATH);
    let class_hash = if entry.anim.is_some() {
        BinHash(0xa742_684a)
    } else {
        BinHash(0x1a65_e950)
    };
    let (atlas_w, atlas_h) = entry.texture_size;
    let (crop_w, crop_h) = entry
        .anim
        .map_or((atlas_w, atlas_h), |anim| (anim.frame_w, anim.frame_h));

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

    let layout_ptr = values::Struct {
        class_hash: BinHash(0x4460_0fb6),
        properties: [
            (BinHash(0x3a8b_fbed), values::Embedded(layout_embed).into()),
            (BinHash(0x487f_cd1a), values::Bool::new(true).into()),
        ]
        .into_iter()
        .collect(),
    };

    let texture_ptr = values::Struct {
        class_hash: BinHash(0x719f_1a94),
        properties: [
            (
                BinHash(0xf972_1a78),
                values::WadChunkLink::new(WadHash(entry.texture_hash)).into(),
            ),
            (BinHash(0xabb7_9fd0), values::U32::new(atlas_w).into()),
            (BinHash(0x9f97_05c7), values::U32::new(atlas_h).into()),
            (
                BinHash(0x257c_e80c),
                values::Vector4::new(glam::Vec4::new(
                    0.0,
                    0.0,
                    (crop_w - 1) as f32,
                    (crop_h - 1) as f32,
                ))
                .into(),
            ),
        ]
        .into_iter()
        .collect(),
    };

    let mut properties: IndexMap<BinHash, PropertyValueEnum> = [
        (BinHash(0x8d39_bde6), values::String::new(path).into()),
        (BinHash(0x2063_cb13), values::ObjectLink::new(parent).into()),
        (BinHash(0x02f3_b39e), values::Bool::new(true).into()),
        (BinHash(0x07a6_40f6), values::U32::new(entry.layer).into()),
        (BinHash(0x934f_4e0a), PropertyValueEnum::Struct(layout_ptr)),
        (BinHash(0xe502_c1dc), PropertyValueEnum::Struct(texture_ptr)),
    ]
    .into_iter()
    .collect();

    if let Some(anim) = entry.anim {
        properties.insert(
            BinHash(0xff72_f56a),
            values::F32::new(anim.fps as f32).into(),
        );
        properties.insert(
            BinHash(0xa651_7bab),
            values::F32::new(anim.frames as f32).into(),
        );
        properties.insert(
            BinHash(0x9e17_f690),
            values::F32::new(anim.cols as f32).into(),
        );
        properties.insert(BinHash(0xee3c_0711), values::U8::new(1).into());
    }

    BinObject {
        path_hash: key,
        class_hash,
        properties,
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
