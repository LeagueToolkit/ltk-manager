//! A repair's changes, written as a new package built from the repaired one.
//!
//! A modpkg has no in-place edit, so a repair writes the whole package again:
//! every chunk the package holds, with the files the fix run wrote in place
//! of the chunks they replace, and a removed file left out. The metadata
//! chunk, the readme, the license, the thumbnail and every declared table
//! are carried from the package's own chunks, so a distributor stamp and a
//! layer's declarations survive the rewrite.

use std::collections::HashMap;
use std::io::BufWriter;
use std::path::Path;

use fs_err as fs;
use ltk_hashtable::Category;
use ltk_manager_assets::mod_archive::open_modpkg;
use ltk_manager_base::error::{AppError, AppResult};
use ltk_manager_problems::{FileChange, FixReport, HeldWrites, KeptTable};
use ltk_modpkg::builder::{ModpkgBuilder, ModpkgChunkBuilder, ModpkgLayerBuilder};
use ltk_modpkg::{
    ChunkDestination, ChunkKey, ChunkPath, HASHTABLES_CHUNK_DIR, LICENSE_CHUNK_PATH, LayerHash,
    Modpkg, ModpkgChunk, ModpkgHashtable, README_CHUNK_PATH, THUMBNAIL_CHUNK_PATH, WadNameHash,
};

/// Where each content chunk of the new package takes its bytes from, by the
/// builder's storage key.
type Sources = HashMap<(ChunkKey, WadNameHash), Source>;

/// Where one content chunk of the new package takes its bytes from.
#[derive(Debug)]
enum Source {
    /// The fix run wrote the file, so the run's bytes replace the chunk.
    Held(Vec<u8>),
    /// The run left the file alone, so the chunk is decoded from the package.
    Original(ModpkgChunk),
}

/// Write `archive` again at `into`, with what `held` wrote in place of the
/// chunks that `report` names.
///
/// # Errors
///
/// Fails if the package does not mount, a declared table or a meta chunk does
/// not read, a layer name is not a slug, a file the run reports written has no
/// bytes in `held`, or the new package cannot be written.
pub(super) fn rewrite(
    archive: &Path,
    into: &Path,
    held: &HeldWrites,
    report: &FixReport,
) -> AppResult<()> {
    let mut modpkg = open_modpkg(archive)?;
    let metadata = modpkg.load_metadata()?;

    let mut builder = ModpkgBuilder::default().with_metadata(metadata.clone());
    for layer in modpkg.layers().values() {
        let planned = ModpkgLayerBuilder::new(&layer.name)
            .map_err(|e| {
                AppError::Other(format!(
                    "Layer {} of {}: {e}",
                    layer.name,
                    archive.display()
                ))
            })?
            .with_priority(layer.priority);
        builder = builder.with_layer(planned);
    }

    let (builder, sources) = content_chunks(builder, &modpkg, held, report)?;
    let builder = meta_chunks(builder, &mut modpkg, &metadata, held.table())?;

    let writer = fs::File::create(into)?;
    let mut writer = BufWriter::new(writer);
    builder
        .build_to_writer(&mut writer, |chunk| {
            let source = sources
                .get(&chunk.full_key())
                .ok_or_else(|| ltk_modpkg::ModpkgError::MissingChunk(chunk.path_hash()))?;
            match source {
                Source::Held(bytes) => Ok(bytes.clone()),
                Source::Original(original) => Ok(modpkg
                    .decoder()
                    .load_chunk_decompressed(original)?
                    .into_vec()),
            }
        })
        .map_err(|e| AppError::PackFailed(format!("Failed to write {}: {e}", into.display())))
}

/// Register every content chunk of `modpkg` on `builder`, and answer where
/// each takes its bytes from.
///
/// A file that `report` lists as removed is left out. A file it lists as
/// written takes the bytes `held` holds for it.
fn content_chunks(
    mut builder: ModpkgBuilder,
    modpkg: &Modpkg<fs::File>,
    held: &HeldWrites,
    report: &FixReport,
) -> AppResult<(ModpkgBuilder, Sources)> {
    let changes: HashMap<(&str, &str), FileChange> = report
        .files
        .iter()
        .map(|file| ((file.layer.as_str(), file.path.as_str()), file.change))
        .collect();

    let mut sources = HashMap::new();
    for planned in &modpkg.extraction_plan() {
        let ChunkDestination::Content { layer, wad, path } = planned.destination else {
            continue;
        };
        let in_layer = match wad {
            Some(wad) => format!("{wad}/{path}"),
            None => path.to_owned(),
        };

        let source = match changes.get(&(layer, in_layer.as_str())) {
            Some(FileChange::Removed) => continue,
            Some(FileChange::Written) => Source::Held(
                held.bytes(layer, &in_layer)
                    .map(<[u8]>::to_vec)
                    .ok_or_else(|| {
                        AppError::Other(format!("The run holds no bytes for {layer}/{in_layer}"))
                    })?,
            ),
            Some(FileChange::Unchanged) | None => Source::Original(planned.chunk),
        };

        let mut chunk = chunk_named(path, planned.chunk)?
            .with_layer(layer)
            .with_compression(planned.chunk.compression);
        if let Some(wad) = wad {
            chunk = chunk.with_wad(wad);
        }
        sources.insert(chunk.full_key(), source);
        builder = builder.with_chunk(chunk);
    }

    Ok((builder, sources))
}

/// A chunk builder under the path `stored` names.
///
/// A chunk whose name is the hex of its hash carries that hash, not the hash
/// of the name as written, so it is registered by its hashed name.
fn chunk_named(stored: &str, chunk: ModpkgChunk) -> AppResult<ModpkgChunkBuilder> {
    if ChunkPath::new(stored).hash() == chunk.path_hash {
        return Ok(ModpkgChunkBuilder::new().with_path(stored));
    }
    ModpkgChunkBuilder::new()
        .with_hashed_chunk_name(stored)
        .map_err(|e| AppError::Other(format!("Chunk {stored}: {e}")))
}

/// Carry the readme, the license, the thumbnail and every declared table of
/// `modpkg` onto `builder`, with `kept` in place of the table it merged into.
///
/// A repair writes every path it hashes into the mod's own table instead of
/// keeping a restore point (ADR-0006). A kept table that merged into no
/// declared table is declared afresh.
fn meta_chunks(
    mut builder: ModpkgBuilder,
    modpkg: &mut Modpkg<fs::File>,
    metadata: &ltk_modpkg::ModpkgMetadata,
    kept: Option<&KeptTable>,
) -> AppResult<ModpkgBuilder> {
    if let Some(readme) = meta_chunk(modpkg, README_CHUNK_PATH)? {
        builder = builder.with_readme(readme);
    }
    if let Some(license) = meta_chunk(modpkg, LICENSE_CHUNK_PATH)? {
        builder = builder.with_license_text(license);
    }
    if let Some(thumbnail) = meta_chunk(modpkg, THUMBNAIL_CHUNK_PATH)? {
        builder = builder.with_thumbnail(thumbnail);
    }

    let kept_path = kept.map(|table| match &table.into {
        Some(entry) => entry.path().to_string(),
        None => free_table_path(&metadata.hashtables),
    });
    let mut declared_kept = false;
    for manifest in &metadata.hashtables {
        let replaces = kept_path
            .as_deref()
            .is_some_and(|path| manifest.path.eq_ignore_ascii_case(path));
        let bytes = match (replaces, kept) {
            (true, Some(table)) => {
                declared_kept = true;
                table.bytes.clone()
            }
            _ => meta_chunk(modpkg, &manifest.path)?.ok_or_else(|| {
                AppError::Other(format!(
                    "The package declares {} and holds no such chunk",
                    manifest.path
                ))
            })?,
        };
        builder = builder
            .with_hashtable(manifest.clone(), bytes)
            .map_err(|e| AppError::Other(format!("Table {}: {e}", manifest.path)))?;
    }

    if let (Some(table), Some(path), false) = (kept, kept_path, declared_kept) {
        let (algorithm, width) = &table.shape;
        let manifest = ModpkgHashtable {
            path: path.clone(),
            category: Category::Game,
            algorithm: algorithm.clone(),
            bits: width.bits(),
        };
        builder = builder
            .with_hashtable(manifest, table.bytes.clone())
            .map_err(|e| AppError::Other(format!("Table {path}: {e}")))?;
    }

    Ok(builder)
}

/// The decoded bytes of the meta chunk at `path`, or `None` if the package
/// holds none.
fn meta_chunk(modpkg: &mut Modpkg<fs::File>, path: &str) -> AppResult<Option<Vec<u8>>> {
    let key = ChunkKey::new(ChunkPath::new(path).hash(), LayerHash::NONE);
    let Some(chunk) = modpkg.chunks().get(&key).copied() else {
        return Ok(None);
    };
    Ok(Some(
        modpkg.decoder().load_chunk_decompressed(&chunk)?.into_vec(),
    ))
}

/// A conventional table path under `_meta_/hashes/` that no manifest entry
/// uses.
///
/// It follows the naming sequence of a project's `hashes/`.
fn free_table_path(manifests: &[ModpkgHashtable]) -> String {
    let taken: Vec<String> = manifests
        .iter()
        .map(|manifest| manifest.path.to_ascii_lowercase())
        .collect();
    std::iter::once(format!("{HASHTABLES_CHUNK_DIR}/game.hashes.txt"))
        .chain(
            (1..)
                .map(|attempt| format!("{HASHTABLES_CHUNK_DIR}/game.repaired{attempt}.hashes.txt")),
        )
        .find(|candidate| !taken.contains(&candidate.to_ascii_lowercase()))
        .expect("the candidate sequence is unbounded")
}
