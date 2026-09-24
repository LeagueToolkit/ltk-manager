//! A shader's two stages picked out of the shader cache by define list and translated.
//!
//! The TOC of each stage names the permutation a define list selects, its record is cut
//! out of the bundle chunk that holds it, and the blob is translated through the
//! [`TranslationCache`]. A [`ShaderCache`] reads each TOC and bundle once and each stage
//! once, since the materials of one read share a handful of shaders.

use std::collections::HashMap;
use std::fmt;

use serde::Serialize;
use thiserror::Error;

use crate::bundle::{self, BundleError, ShaderToc};
use crate::{Defines, Sidecar, Stage, TranslateError, TranslationCache};

/// Where the chunks of `ShaderCache.dx11.wad.client` come from.
pub trait ShaderSource {
    /// The bytes of the chunk at `path`, which [`bundle::chunk_hash`] hashes.
    ///
    /// # Errors
    ///
    /// Fails when nothing holds the chunk or it does not read.
    fn chunk(&mut self, path: &str) -> Result<Vec<u8>, SourceError>;
}

/// Why a [`ShaderSource`] has no bytes for a chunk.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SourceError {
    #[error("nothing holds the chunk")]
    Missing,
    #[error("{0}")]
    Unreadable(String),
}

/// Why a shader has no program for a define list.
///
/// The messages name the chunk or shader at fault, because the viewport shows them as
/// they are.
#[derive(Debug, Error)]
pub enum ProgramError {
    #[error("Nothing on this machine holds {path}")]
    Missing { path: String },
    #[error("{path} does not read: {reason}")]
    Unreadable { path: String, reason: String },
    #[error("The {stage} TOC {path} does not read: {error}")]
    Toc {
        stage: Stage,
        path: String,
        error: ltk_shader::ShaderError,
    },
    #[error("No {stage} permutation of {shader} for {defines}")]
    NoPermutation {
        stage: Stage,
        shader: String,
        defines: Defines,
    },
    #[error("The {stage} bundle {path} has no record {id}: {error}")]
    NoRecord {
        stage: Stage,
        path: String,
        id: u32,
        error: BundleError,
    },
    #[error("The {stage} shader {shader} id {id} does not translate: {error}")]
    Translate {
        stage: Stage,
        shader: String,
        id: u32,
        error: TranslateError,
    },
}

/// Where a shader's two stages are compiled in the shader cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ShaderPath<'a> {
    /// A `CustomShaderDef`'s object path, `Shaders/SkinnedMesh/Diffuse_Bloom`, compiled
    /// under `ASSETS/Shaders/Generated/`.
    Generated(&'a str),
    /// An engine shader's HLSL file per stage, such as
    /// `ASSETS/Shaders/HLSL/SkinnedMesh/LIT_UBER_VS.vs` and `LIT_UBER_PS.ps`.
    Hlsl { vertex: &'a str, pixel: &'a str },
}

impl<'a> ShaderPath<'a> {
    /// The chunk path of the `TOC3.0` of `stage`.
    #[must_use]
    pub fn toc_path(self, stage: Stage) -> String {
        match self {
            Self::Generated(object_path) => bundle::toc_path(object_path, stage),
            Self::Hlsl { vertex, pixel } => bundle::hlsl_toc_path(match stage {
                Stage::Vertex => vertex,
                Stage::Pixel => pixel,
            }),
        }
    }

    /// The name an error gives the shader of `stage`.
    fn name(self, stage: Stage) -> &'a str {
        match (self, stage) {
            (Self::Generated(object_path), _) => object_path,
            (Self::Hlsl { vertex, .. }, Stage::Vertex) => vertex,
            (Self::Hlsl { pixel, .. }, Stage::Pixel) => pixel,
        }
    }
}

/// A shader's two stages for one define list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Program {
    pub vertex: StageProgram,
    pub pixel: StageProgram,
}

/// One translated stage of a program.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS, specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct StageProgram {
    /// The shader id the TOC lists the permutation under.
    pub id: u32,
    pub glsl: String,
    pub sidecar: Sidecar,
    /// The translation came off the disk cache rather than being made now.
    pub cached: bool,
}

/// The game's shader cache as one read reaches it, with each TOC, bundle and stage read
/// once.
pub struct ShaderCache<'a> {
    source: &'a mut dyn ShaderSource,
    translations: &'a TranslationCache,
    tocs: HashMap<String, ShaderToc>,
    bundles: HashMap<String, Vec<u8>>,
    /// Each stage by its TOC path and shader id.
    stages: HashMap<(String, u32), StageProgram>,
}

impl fmt::Debug for ShaderCache<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ShaderCache")
            .field("translations", self.translations)
            .field("tocs", &self.tocs.len())
            .field("bundles", &self.bundles.len())
            .field("stages", &self.stages.len())
            .finish_non_exhaustive()
    }
}

impl<'a> ShaderCache<'a> {
    #[must_use]
    pub fn new(source: &'a mut dyn ShaderSource, translations: &'a TranslationCache) -> Self {
        Self {
            source,
            translations,
            tocs: HashMap::new(),
            bundles: HashMap::new(),
            stages: HashMap::new(),
        }
    }

    /// The program of `shader` for the permutation `defines` select.
    ///
    /// # Errors
    ///
    /// Fails when a chunk is missing or unreadable, when the TOC names no permutation for
    /// `defines`, or when a blob does not translate. Never a guess.
    pub fn program(
        &mut self,
        shader: ShaderPath<'_>,
        defines: &Defines,
    ) -> Result<Program, ProgramError> {
        Ok(Program {
            vertex: self.stage(shader, Stage::Vertex, defines)?,
            pixel: self.stage(shader, Stage::Pixel, defines)?,
        })
    }

    fn stage(
        &mut self,
        shader: ShaderPath<'_>,
        stage: Stage,
        defines: &Defines,
    ) -> Result<StageProgram, ProgramError> {
        let toc_path = shader.toc_path(stage);
        let id = bundle::permutation(self.toc(&toc_path, stage)?, defines).ok_or_else(|| {
            ProgramError::NoPermutation {
                stage,
                shader: shader.name(stage).to_owned(),
                defines: defines.clone(),
            }
        })?;

        let key = (toc_path, id);
        if let Some(program) = self.stages.get(&key) {
            return Ok(program.clone());
        }

        let bundle_path = bundle::bundle_path(&key.0, id);
        let translations = self.translations;
        let bundle = self.bundle(&bundle_path)?;
        let blob = bundle::record(bundle, bundle::index_in_bundle(id)).map_err(|error| {
            ProgramError::NoRecord {
                stage,
                path: bundle_path.clone(),
                id,
                error,
            }
        })?;
        let (translated, cached) =
            translations
                .translated(blob, stage)
                .map_err(|error| ProgramError::Translate {
                    stage,
                    shader: shader.name(stage).to_owned(),
                    id,
                    error,
                })?;

        let program = StageProgram {
            id,
            glsl: translated.glsl,
            sidecar: translated.sidecar,
            cached,
        };
        self.stages.insert(key, program.clone());
        Ok(program)
    }

    fn toc(&mut self, path: &str, stage: Stage) -> Result<&ShaderToc, ProgramError> {
        if !self.tocs.contains_key(path) {
            let bytes = self.chunk(path)?;
            let toc = bundle::read_toc(&bytes).map_err(|error| ProgramError::Toc {
                stage,
                path: path.to_owned(),
                error,
            })?;
            self.tocs.insert(path.to_owned(), toc);
        }
        Ok(&self.tocs[path])
    }

    fn bundle(&mut self, path: &str) -> Result<&[u8], ProgramError> {
        if !self.bundles.contains_key(path) {
            let bytes = self.chunk(path)?;
            self.bundles.insert(path.to_owned(), bytes);
        }
        Ok(&self.bundles[path])
    }

    fn chunk(&mut self, path: &str) -> Result<Vec<u8>, ProgramError> {
        self.source.chunk(path).map_err(|error| match error {
            SourceError::Missing => ProgramError::Missing {
                path: path.to_owned(),
            },
            SourceError::Unreadable(reason) => ProgramError::Unreadable {
                path: path.to_owned(),
                reason,
            },
        })
    }
}

#[cfg(test)]
mod tests;
