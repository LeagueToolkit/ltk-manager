//! A modpkg's files, read for the rules without unpacking it.
//!
//! A package stores each chunk under the path that it was packed from, so the
//! scan lists a file under the path that an import writes, `{wad}/{path}`
//! inside its layer, and no resolver names a chunk. Nothing is written to
//! disk.
//!
//! The package's decoder borrows the package mutably, so the mounted package
//! is held in a mutex and the reads of a run are serialized through it. A bin
//! is parsed on the pool after its read, outside the lock, so a run still
//! parses in parallel.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use fs_err as fs;
use ltk_file::LeagueFileKind;
use ltk_hashtable::{Hashtable, HashtableEntry};
use ltk_modpkg::{BASE_LAYER_NAME, ChunkDestination, Modpkg, ModpkgChunk};
use parking_lot::Mutex;

use ltk_manager_assets::file_kind::WorkshopFileKind;
use ltk_manager_assets::mod_archive::open_modpkg;
use ltk_manager_base::error::{AppError, AppResult};
use ltk_manager_base::utils::natural_order::compare_names;

use super::archive::{has_extension, kind_of_path};
use super::{LayerFiles, ProjectFile};

/// One layer of a modpkg, and the bytes of the files inside it when a rule
/// reads them.
#[derive(Debug)]
pub(super) struct ModpkgFiles {
    archive: PathBuf,
    /// The package, mounted once by the scan and shared by every layer.
    modpkg: Arc<Mutex<Modpkg<fs::File>>>,
    /// The chunk record of each file of the layer, keyed by the file's path.
    chunks: HashMap<String, ModpkgChunk>,
}

/// What one scan of a package found.
#[derive(Debug)]
pub(super) struct ModpkgScan {
    /// Every layer the package declares, base first and the rest by name.
    pub layers: Vec<LayerFiles>,
    /// The hashtables the package declares.
    pub tables: Vec<(HashtableEntry, Hashtable)>,
}

/// The files of one layer, as the package's extraction plan lists them.
#[derive(Default)]
struct LayerChunks {
    files: Vec<ProjectFile>,
    chunks: HashMap<String, ModpkgChunk>,
}

impl ModpkgFiles {
    /// Every file of `archive` a rule can read, by layer, and the hashtables it
    /// declares.
    ///
    /// A file's kind comes from its extension. A chunk with no extension has
    /// its bytes decoded once, to read its magic.
    ///
    /// # Errors
    ///
    /// Reports a package that cannot be mounted, whose metadata cannot be read
    /// or whose declared tables cannot be loaded.
    pub(super) fn scan(archive: &Path) -> AppResult<ModpkgScan> {
        let mut modpkg = open_modpkg(archive)?;
        let declared = modpkg.load_hashtables()?;

        let mut layers: Vec<(String, LayerChunks)> = modpkg
            .layers()
            .values()
            .map(|layer| (layer.name.clone(), LayerChunks::default()))
            .collect();
        let mut nameless: Vec<(usize, usize)> = Vec::new();
        for planned in &modpkg.extraction_plan() {
            let ChunkDestination::Content { layer, .. } = planned.destination else {
                continue;
            };
            let Some(path) = planned
                .destination
                .compose()
                .strip_prefix(layer)
                .and_then(|rest| rest.strip_prefix('/'))
                .map(str::to_owned)
            else {
                continue;
            };
            let Some(at) = layers.iter().position(|(name, _)| name == layer) else {
                continue;
            };

            let held = &mut layers[at].1;
            if !has_extension(&path) {
                nameless.push((at, held.files.len()));
            }
            held.chunks.insert(path.clone(), planned.chunk);
            held.files.push(ProjectFile {
                kind: kind_of_path(&path),
                path,
                size_bytes: planned.chunk.uncompressed_size,
                chunk: None,
            });
        }

        /* A second pass, because this one decodes and the first reads only
        the package's tables. */
        for (at, slot) in nameless {
            let path = layers[at].1.files[slot].path.clone();
            let chunk = layers[at].1.chunks[&path];
            let kind = match modpkg.decoder().load_chunk_decompressed(&chunk) {
                Ok(bytes) => WorkshopFileKind::from(LeagueFileKind::identify_from_bytes(&bytes)),
                Err(e) => {
                    tracing::debug!(
                        "Could not read {path} of {} to identify it: {e}",
                        archive.display()
                    );
                    WorkshopFileKind::Unknown
                }
            };
            layers[at].1.files[slot].kind = kind;
        }

        // The order `layer::dirs_in` reads a tree's layers in.
        layers.sort_by(|(a, _), (b, _)| {
            (b == BASE_LAYER_NAME)
                .cmp(&(a == BASE_LAYER_NAME))
                .then_with(|| compare_names(a, b))
        });

        let modpkg = Arc::new(Mutex::new(modpkg));
        let layers = layers
            .into_iter()
            .map(|(name, mut held)| {
                // The panel draws sites in file order, and the tree walk sorts
                // each layer, so the package's files are sorted the same way.
                held.files.sort_by(|a, b| a.path.cmp(&b.path));

                let source = Self {
                    archive: archive.to_path_buf(),
                    modpkg: Arc::clone(&modpkg),
                    chunks: held.chunks,
                };
                LayerFiles::in_modpkg(&name, held.files, source)
            })
            .collect();

        Ok(ModpkgScan {
            layers,
            tables: declared,
        })
    }

    /// The bytes of one file the scan listed.
    ///
    /// # Errors
    ///
    /// Reports the file it could not read, as a one-line message for the panel.
    pub(super) fn read(&self, file: &ProjectFile) -> Result<Vec<u8>, String> {
        self.bytes_of(file)
            .map_err(|e| format!("{}: {e}", self.archive.display()))
    }

    /// At most `limit` bytes from the start of one file the scan listed.
    ///
    /// Decodes the chunk whole, because zstd decodes a frame whole, and drops
    /// the bytes past `limit`.
    ///
    /// # Errors
    ///
    /// Reports the file it could not read, as a one-line message for the panel.
    pub(super) fn head(&self, file: &ProjectFile, limit: usize) -> Result<Vec<u8>, String> {
        let mut bytes = self.read(file)?;
        bytes.truncate(limit);
        Ok(bytes)
    }

    /// One file the scan listed, decoded whole.
    fn bytes_of(&self, file: &ProjectFile) -> AppResult<Vec<u8>> {
        let chunk = self
            .chunks
            .get(&file.path)
            .ok_or_else(|| AppError::Other(format!("{} is not in the package", file.path)))?;
        let bytes = self
            .modpkg
            .lock()
            .decoder()
            .load_chunk_decompressed(chunk)?;
        Ok(bytes.into_vec())
    }
}
