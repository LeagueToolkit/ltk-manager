//! Where a shader's bytecode sits in `ShaderCache.dx11.wad.client`, and which record is
//! which permutation.
//!
//! `ltk_shader` reads the `TOC3.0` chunk and hashes a define, and both are used here. Its
//! own path builder writes the pre-16.15 `.dx11` separator and its bundle reader keeps the
//! byte past each container, so the paths and the record trim are this module's.

use std::io::Cursor;

pub use ltk_shader::defines::ShaderMacroDefinition;
pub use ltk_shader::toc::ShaderToc;
use thiserror::Error;
use xxhash_rust::xxh64::xxh64;

use crate::dxbc::{ContainerError, trimmed};
use crate::{Defines, Stage};

/// How many records one bundle chunk holds.
const RECORDS_PER_BUNDLE: u32 = 100;

/// A bundle that ends before the record asked for.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum BundleError {
    #[error("shader bundle ends before record {index}")]
    NoRecord { index: u32 },
    #[error(transparent)]
    Container(#[from] ContainerError),
}

/// The chunk path of a shader's `TOC3.0` for `stage`.
///
/// `object_path` is the `CustomShaderDef`'s, `Shaders/SkinnedMesh/Diffuse_Bloom`. The engine
/// formats `ASSETS/Shaders/Generated/%s.vs` and appends `-dx11`, then hashes lowercase.
#[must_use]
pub fn toc_path(object_path: &str, stage: Stage) -> String {
    format!(
        "assets/shaders/generated/{}.{}-dx11",
        object_path.to_lowercase(),
        stage.abbreviation()
    )
}

/// The chunk path of an engine shader's `TOC3.0`, from the stage's HLSL file.
///
/// `file` is `ASSETS/Shaders/HLSL/SkinnedMesh/LIT_UBER_VS.vs`, which the engine appends
/// `-dx11` to and hashes lowercase, as it does a generated one.
#[must_use]
pub fn hlsl_toc_path(file: &str) -> String {
    format!("{}-dx11", file.to_lowercase())
}

/// The chunk path of the bundle holding record `shader_id` of the TOC at `toc_path`.
#[must_use]
pub fn bundle_path(toc_path: &str, shader_id: u32) -> String {
    format!(
        "{toc_path}_{}",
        RECORDS_PER_BUNDLE * (shader_id / RECORDS_PER_BUNDLE)
    )
}

/// The record's index within its bundle.
#[must_use]
pub fn index_in_bundle(shader_id: u32) -> u32 {
    shader_id % RECORDS_PER_BUNDLE
}

/// The chunk hash of a path, which is `xxh64` of the lowercase path.
#[must_use]
pub fn chunk_hash(path: &str) -> u64 {
    xxh64(path.to_lowercase().as_bytes(), 0)
}

/// The TOC in `bytes`.
///
/// # Errors
///
/// Fails as `ltk_shader` does: on a magic or section header that is not a TOC's.
pub fn read_toc(bytes: &[u8]) -> Result<ShaderToc, ltk_shader::ShaderError> {
    ShaderToc::read(&mut Cursor::new(bytes))
}

/// The shader id of the permutation `defines` select, or `None` where the TOC has none.
///
/// Defines the TOC does not declare are dropped, as the engine drops them, so a caller
/// passes its whole define list.
#[must_use]
pub fn permutation(toc: &ShaderToc, defines: &Defines) -> Option<u32> {
    let mut kept: Vec<ShaderMacroDefinition> = defines
        .iter()
        .map(|(name, value)| ShaderMacroDefinition::new(name.to_owned(), value.to_owned()))
        .filter(|define| toc.base_defines.iter().any(|base| base.hash == define.hash))
        .collect();
    kept.sort_by(|a, b| a.name.cmp(&b.name));
    let key: String = kept.iter().map(ToString::to_string).collect();
    let hash = xxh64(key.as_bytes(), 0);
    toc.shader_hashes
        .iter()
        .position(|&candidate| candidate == hash)
        .map(|at| toc.shader_ids[at])
}

/// The container at `index` of a bundle chunk, trimmed to the bytes its size field counts.
///
/// # Errors
///
/// Fails when the bundle ends before record `index`, or when the record is no DXBC
/// container.
pub fn record(bundle: &[u8], index: u32) -> Result<&[u8], BundleError> {
    let mut at = 0usize;
    for _ in 0..index {
        let size = record_size(bundle, at).ok_or(BundleError::NoRecord { index })?;
        at += 4 + size;
    }
    let size = record_size(bundle, at).ok_or(BundleError::NoRecord { index })?;
    let bytes = bundle
        .get(at + 4..at + 4 + size)
        .ok_or(BundleError::NoRecord { index })?;
    Ok(trimmed(bytes)?)
}

fn record_size(bundle: &[u8], at: usize) -> Option<usize> {
    let size = bundle.get(at..at + 4)?;
    Some(u32::from_le_bytes(size.try_into().expect("four bytes were taken")) as usize)
}

#[cfg(test)]
mod tests;
