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
//! than up, so no pixel is invented, and resampled rather than cropped, because
//! texture coordinates are normalized and an image that stops covering its
//! surface slides against the mesh it is painted on. It is the first repair the
//! manager ships that loses fidelity - see ADR-0011.

use std::io::Cursor;

use image::imageops::FilterType;
use ltk_texture::Tex;
use ltk_texture::tex::{EncodeFormat, EncodeOptions, Format, MipmapFilter, ResourceType};

use crate::problems::budget;
use crate::problems::{
    Applied, Detail, FixError, FixPreview, FixRun, Problem, ProjectFiles, Report, Rule, RuleId,
    Severity, Site,
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

impl Rule for TexBlockAlignment {
    fn id(&self) -> RuleId {
        ID
    }

    fn title(&self) -> &'static str {
        "Texture size the format cannot hold"
    }

    fn description(&self) -> &'static str {
        // The code is on the rule rather than on each row, because it is the
        // same on every one of them.
        "A block-compressed texture whose width or height is not a whole number of blocks. The game fails to create it and crashes, which a crash log records as ALE-D0D00020"
    }

    fn unfixable_description(&self) -> &'static str {
        "Couldn't resample because the texture cannot be written back as it is"
    }

    fn check(&self, project: &ProjectFiles, report: &mut Report) {
        let handles: Vec<_> = project.of_kind(WorkshopFileKind::Texture).collect();
        let read = project.budget().map(
            &handles,
            budget::files_at_once(),
            |_| HEADER_BYTES as u64,
            |handle| {
                handle
                    .head(HEADER_BYTES)
                    .and_then(|head| read_header(&head))
                    .map(|tex| Ragged::of(&tex))
            },
        );

        for (handle, found) in handles.iter().zip(read) {
            let site = || Site::file(handle.layer(), handle.path());
            match found {
                Some(Ok(Some(ragged))) => {
                    report.problem(ID, Severity::Fatal, site(), ragged.detail());
                }
                Some(Ok(None)) => {}
                Some(Err(e)) => report.failure(ID, Some(site()), e),
                /* Cancelled before this file was reached. Saying nothing about
                it is what keeps a partial run from reading as a clean one. */
                None => report.failure(ID, Some(site()), "The check was cancelled"),
            }
        }
    }

    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        let mut applied = Applied::default();

        for problem in problems {
            let (layer, path) = (problem.site.layer.clone(), problem.site.path.clone());
            let bytes = run.read(&layer, &path)?;
            let parse = |message: String| FixError::Parse {
                layer: layer.clone(),
                path: path.clone(),
                message,
            };

            let tex =
                Tex::from_reader(&mut Cursor::new(&bytes)).map_err(|e| parse(e.to_string()))?;
            // Re-derived from the file rather than from what the check
            // recorded, so a texture re-exported since the run is left alone.
            let Some(size) = Ragged::of(&tex).and_then(|ragged| ragged.repair().ok()) else {
                applied.skipped += 1;
                run.skipped(&layer, &path, 1);
                continue;
            };

            let repaired = resampled(&tex, size).map_err(parse)?;
            let mut out = Vec::with_capacity(bytes.len());
            repaired.write(&mut out).map_err(|source| FixError::File {
                layer: layer.clone(),
                path: path.clone(),
                source,
            })?;

            run.write(&layer, &path, &out, 1, 0)?;
            applied.applied += 1;
        }

        Ok(applied)
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
    /// Whether the file is the plain 2D texture the repair knows how to write.
    plain: bool,
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
            plain: tex.resource_type == ResourceType::Texture && tex.depth <= 1,
        })
    }

    /// The size a repair would resample to, or why there is no repair.
    fn repair(&self) -> Result<(u32, u32), String> {
        if !self.plain {
            return Err(String::from(
                "This is a cubemap or a volume texture, and the manager can only write a plain one back",
            ));
        }
        if EncodeFormat::try_from(self.format).is_err() {
            return Err(format!(
                "The manager can read {:?} and cannot write it, so this one has to be re-exported at a size the format holds",
                self.format
            ));
        }

        let (width, height) = (
            self.width - self.width % self.block.0,
            self.height - self.height % self.block.1,
        );
        if width == 0 || height == 0 {
            return Err(format!(
                "{}x{} is smaller than one {}x{} block, so there is nothing to round down to",
                self.width, self.height, self.block.0, self.block.1
            ));
        }
        Ok((width, height))
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

/// Read a `.tex` header out of the first bytes of the file.
fn read_header(head: &[u8]) -> Result<Tex, String> {
    Tex::from_reader(&mut Cursor::new(head)).map_err(|e| e.to_string())
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
    let smaller = image::imageops::resize(&pixels, size.0, size.1, FilterType::Lanczos3);

    let format = EncodeFormat::try_from(tex.format).map_err(|e| e.to_string())?;
    let mut options = EncodeOptions::new(format);
    if tex.has_mipmaps() {
        options = options
            .with_mipmaps()
            .with_mipmap_filter(MipmapFilter::Lanczos3);
    }

    Tex::encode_rgba_image(&smaller, options).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
