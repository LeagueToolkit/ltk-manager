//! `tex/block-alignment` - a texture whose size the format cannot express.
//!
//! A block-compressed format stores pixels in blocks rather than one at a time,
//! so a width or height that is not a whole number of blocks is a size the
//! format has no way to hold. The game does not round it off. It fails to
//! create the texture and crashes, which is the event a crash log records as
//! `ALE-D0D00020`.
//!
//! The check is the header and nothing else: the size and the format are in the
//! first twelve bytes, and which formats work in blocks is `ltk_texture`'s
//! question to answer rather than a list kept here. An uncompressed format
//! reports a 1x1 block, so it can never be ragged and never reports.
//!
//! The repair decodes, resamples down to the nearest whole block in each
//! dimension, and re-encodes to the format the file already had. Down rather
//! than up, so no pixel is invented. A dimension under one block has no whole
//! block below it and grows to one, repeating its texels. Resampled rather than
//! cropped, because texture coordinates are normalized and an image that stops
//! covering its surface slides against the mesh it is painted on. It is the
//! first repair the manager ships that loses fidelity - see ADR-0011.
//!
//! **The rule reads `.tex` and nothing else.** What a `.tex` can be beyond a
//! plain 2D image is a volume, which its `depth` field is what declares. It
//! cannot usefully be a cubemap: the game has no direct support for one in this
//! container and asserts on the format, so a cubemap ships as a `.dds` in Bc1
//! carrying `DDSCAPS2_CUBEMAP`. That is a separate file kind, no rule scans it,
//! and the format constraint on it is unchecked.
//!
//! A `.tex` that contains DDS data, such as a renamed `.dds`, is skipped. The
//! game detects the container from the magic bytes, so the file is valid.

use std::io::Cursor;

use image::imageops::FilterType;
use ltk_texture::tex::{EncodeFormat, EncodeOptions, Format, MipmapFilter, ResourceType};
use ltk_texture::{Dds, Tex};

use crate::problems::{
    Applied, Detail, FixError, FixPreview, FixRun, Pass, Problem, ProblemSeverity, Rule, RuleId,
    RuleMeta, Site,
};
use crate::workshop::WorkshopFileKind;

/// The id every row of this rule carries.
pub const ID: RuleId = RuleId("tex/block-alignment");

/// The header a `.tex` opens with, magic through flags.
///
/// Everything the check reads. The pixels behind it are the repair's business,
/// and a texture runs to megabytes.
const HEADER_BYTES: usize = 12;

/// Reports a block-compressed texture the game cannot create.
#[derive(Debug, Default)]
pub struct TexBlockAlignment;

impl TexBlockAlignment {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// The rule as the catalogue lists it.
const META: RuleMeta = RuleMeta {
    id: ID,
    title: "Block-unaligned texture size",
    // The code is on the rule rather than on each row, because it is the
    // same on every one of them.
    description: "A block-compressed texture whose size is not a whole number of blocks, which crashes the game with ALE-D0D00020",
    unfixable: "Couldn't resample because the manager cannot write this texture back",
    severity: Some(ProblemSeverity::Fatal),
};

impl Rule for TexBlockAlignment {
    fn meta(&self) -> &RuleMeta {
        &META
    }

    fn subscribe(&self, pass: &mut Pass<'_>) {
        let headers = pass
            .files(WorkshopFileKind::Texture)
            .head(HEADER_BYTES)
            .collect(|head| ragged_header(head.bytes()));
        pass.finish(move |finish| {
            for (handle, ragged) in finish.take(headers) {
                if let Some(ragged) = ragged {
                    finish.problem(
                        ProblemSeverity::Fatal,
                        Site::file(handle.layer(), handle.path()),
                        ragged.detail(),
                    );
                }
            }
        });
    }

    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        run.per_file(problems, |run, layer, path| {
            let bytes = run.read(layer, path)?;
            let parse = |message: String| FixError::Parse {
                layer: layer.to_owned(),
                path: path.to_owned(),
                message,
            };

            let tex =
                Tex::from_reader(&mut Cursor::new(&bytes)).map_err(|e| parse(e.to_string()))?;
            // Re-derived from the file rather than from what the check
            // recorded, so a texture re-exported since the run is left alone.
            let Some(size) = Ragged::of(&tex).and_then(|ragged| ragged.repair().ok()) else {
                return Ok(false);
            };

            let repaired = resampled(&tex, size).map_err(parse)?;
            let mut out = Vec::with_capacity(bytes.len());
            repaired.write(&mut out).map_err(|source| FixError::File {
                layer: layer.to_owned(),
                path: path.to_owned(),
                source,
            })?;

            run.write(layer, path, &out, 1, 0)?;
            Ok(true)
        })
    }
}

/// A texture the game cannot create, and what its header says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Ragged {
    width: u32,
    height: u32,
    format: Format,
    /// The blocks the format stores pixels in.
    block: (u32, u32),
    /// The z-slices the header declares, which is what makes a `.tex` a volume.
    depth: u8,
    /// What the header calls itself, which the repair can only write one of.
    resource_type: ResourceType,
}

impl Ragged {
    /// What the game will not create about `tex`, or `None` for one it will.
    ///
    /// An uncompressed format reports a 1x1 block and so is never ragged, which
    /// is the whole of "any dimension is valid there".
    fn of(tex: &Tex) -> Option<Self> {
        let (block_width, block_height) = tex.format.block_size();
        let block = (block_width as u32, block_height as u32);
        let (width, height) = (u32::from(tex.width), u32::from(tex.height));

        if width % block.0 == 0 && height % block.1 == 0 {
            return None;
        }

        Some(Self {
            width,
            height,
            format: tex.format,
            block,
            depth: tex.depth,
            resource_type: tex.resource_type,
        })
    }

    /// The size a repair would resample to, or why there is no repair.
    fn repair(&self) -> Result<(u32, u32), String> {
        if self.depth > 1 {
            return Err(format!(
                "This is a volume texture of {} slices, and the manager writes back plain 2D ones only",
                self.depth
            ));
        }
        if self.resource_type != ResourceType::Texture {
            return Err(format!(
                "The header calls this a {:?}, and the manager writes back plain 2D textures only",
                self.resource_type
            ));
        }
        if EncodeFormat::try_from(self.format).is_err() {
            return Err(format!(
                "The manager reads {:?} and cannot write it, so re-export this at a size the format holds",
                self.format
            ));
        }

        if self.width == 0 || self.height == 0 {
            return Err(format!(
                "{}x{} holds no pixels to resample",
                self.width, self.height
            ));
        }
        Ok((
            on_grid(self.width, self.block.0),
            on_grid(self.height, self.block.1),
        ))
    }

    /// What this one finding says, and what a repair would change.
    fn detail(&self) -> Detail {
        match self.repair() {
            Ok((width, height)) => Detail {
                mismatch: None,
                message: None,
                fix: Some(FixPreview::value(
                    format!("{} × {}", self.width, self.height),
                    format!("{width} × {height}"),
                )),
            },
            Err(reason) => Detail::new(reason),
        }
    }
}

/// `size` rounded down to whole `block`s, and never below one block.
fn on_grid(size: u32, block: u32) -> u32 {
    (size - size % block).max(block)
}

/// What the first bytes of a `.tex` say the game will not create, where the
/// file holds a TEX header at all.
fn ragged_header(head: &[u8]) -> Result<Option<Ragged>, String> {
    if head
        .first_chunk::<4>()
        .is_some_and(|magic| u32::from_le_bytes(*magic) == Dds::MAGIC)
    {
        return Ok(None);
    }

    let tex = Tex::from_reader(&mut Cursor::new(head)).map_err(|e| e.to_string())?;
    Ok(Ragged::of(&tex))
}

/// `tex` resampled to `size` and re-encoded to the format it already had.
///
/// Every block is re-quantized rather than only the ragged edge, and the mipmap
/// chain is regenerated with our filter rather than the author's, because a
/// block-compressed texture cannot be edited in place.
fn resampled(tex: &Tex, size: (u32, u32)) -> Result<Tex, String> {
    let pixels = tex
        .decode_mipmap(0)
        .map_err(|e| e.to_string())?
        .into_rgba_image()
        .map_err(|e| e.to_string())?;
    let (width, height) = pixels.dimensions();
    let across = image::imageops::resize(&pixels, size.0, height, filter(width, size.0));
    let resized = image::imageops::resize(&across, size.0, size.1, filter(height, size.1));

    let format = EncodeFormat::try_from(tex.format).map_err(|e| e.to_string())?;
    let mut options = EncodeOptions::new(format);
    if tex.has_mipmaps() {
        options = options
            .with_mipmaps()
            .with_mipmap_filter(MipmapFilter::Lanczos3);
    }

    Tex::encode_rgba_image(&resized, options).map_err(|e| e.to_string())
}

/// The filter that takes one axis from `from` texels to `to`.
///
/// An axis that grows repeats its texels, which invents no colour the author
/// did not paint.
fn filter(from: u32, to: u32) -> FilterType {
    if to > from {
        FilterType::Nearest
    } else {
        FilterType::Lanczos3
    }
}

#[cfg(test)]
mod tests;
