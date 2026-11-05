//! A repair's changes, as an edit to the archive the repaired files came from.
//!
//! A fix run rewrites a few files in an archive of hundreds of megabytes. As an
//! [`ArchiveDelta`], [`apply_delta`] writes and removes only those files and
//! raw-copies the rest. Packing the staged project again would re-encode every
//! chunk the mod holds.

use camino::Utf8Path;
use fs_err as fs;
use ltk_fantome::{
    ArchiveDelta, DeltaReport, FantomeHashtable, FantomeReader, apply_delta, is_layer_name,
    wad_entry_name,
};
use ltk_hashtable::Category;
use ltk_manager_base::error::{AppError, AppResult, Utf8PathRefExt};
use ltk_manager_problems::{FileChange, FileOutcome, FixReport, HeldWrites, KeptTable};
use ltk_mod_project::{HASHES_DIR_NAME, ModProject, ModProjectLayer};
use ltk_wad::{WadHash, chunk_hash_of};
use std::path::{Path, PathBuf};

/// The suffix that makes a layer directory one of the mod's WADs.
const WAD_DIR_SUFFIX: &str = ".wad.client";

/// Where an unpack writes the archive's `RAW/` entries, under the base layer.
const RAW_DIR: &str = "raw";

/// Where an archive keeps the hashtable files its metadata declares.
const ARCHIVE_HASHES_DIR: &str = "META/hashes";

/// The entry that holds an archive's metadata.
const ARCHIVE_INFO: &str = "META/info.json";

/// A repair's changes, ready to write into the archive the repaired files came
/// from.
#[derive(Debug)]
pub(super) struct RepairEdit(ArchiveDelta<'static>);

impl RepairEdit {
    /// Read what `report` applied out of the repaired tree at `staging`.
    ///
    /// [`FixRun::write`](ltk_manager_problems::FixRun::write) keeps none of the bytes
    /// it writes, so every fixed file is read back here. That is a few KB per
    /// file, where a repack reads everything the mod holds. `archive` is read
    /// for the metadata a kept name has to be declared in, and is not written
    /// to.
    ///
    /// # Errors
    ///
    /// Reports a repaired file or archive metadata that could not be read, and
    /// a fix the Fantome format has no place for. In either case the repack
    /// writes the repair instead.
    pub(super) fn read(staging: &Path, archive: &Utf8Path, report: &FixReport) -> AppResult<Self> {
        let mut delta = assemble(report, |file| {
            Ok(fs::read(content_path(staging, &file.layer, &file.path))?)
        })?;

        if report.names_kept > 0 {
            declare_kept_names(&mut delta, staging, archive)?;
        }

        Ok(Self(delta))
    }

    /// Read what `report` applied out of `held`, a run that wrote nothing to
    /// disk.
    ///
    /// The bytes come from the run, so nothing is read back, and the kept names
    /// come as the one merged table instead of a project's `hashes/`. `archive`
    /// is read for the metadata that table has to be declared in, and is not
    /// written to.
    ///
    /// # Errors
    ///
    /// Reports a fix the Fantome format has no place for, and a file the run
    /// reports written but holds no bytes for. In either case the unpack and
    /// the repack write the repair instead.
    pub(super) fn held(
        held: &HeldWrites,
        archive: &Utf8Path,
        report: &FixReport,
    ) -> AppResult<Self> {
        let mut delta = assemble(report, |file| {
            held.bytes(&file.layer, &file.path)
                .map(<[u8]>::to_vec)
                .ok_or_else(|| {
                    AppError::Other(format!(
                        "The run holds no bytes for {}/{}",
                        file.layer, file.path
                    ))
                })
        })?;

        if let Some(table) = held.table() {
            declare_held_table(&mut delta, table, archive)?;
        }

        Ok(Self(delta))
    }

    /// Write the edit over `archive`.
    ///
    /// # Errors
    ///
    /// Reports an archive `ltk_fantome` will not edit, most often one that
    /// stores its WADs as loose files, which have no packed bytes to rebase.
    /// Nothing is written to `archive` when it refuses.
    pub(super) fn apply(&self, archive: &Utf8Path) -> AppResult<DeltaReport> {
        apply_delta(archive, archive, &self.0, None)
            .map_err(|e| AppError::Other(format!("Failed to edit {archive}: {e}")))
    }
}

/// The delta for `report`, with `bytes_of` supplying each written file's bytes.
///
/// # Errors
///
/// Reports a fix the Fantome format has no place for, and whatever `bytes_of`
/// reports.
fn assemble(
    report: &FixReport,
    bytes_of: impl Fn(&FileOutcome) -> AppResult<Vec<u8>>,
) -> AppResult<ArchiveDelta<'static>> {
    let mut delta = ArchiveDelta::new();

    for file in &report.files {
        // A file a rule read but did not change was never written. Its bytes
        // are the archive's, and re-encoding them would change the mod.
        if file.change == FileChange::Unchanged {
            continue;
        }

        let target = DeltaTarget::of(&file.layer, &file.path).ok_or_else(|| {
            AppError::Other(format!(
                "A Fantome archive has no place for {}/{}",
                file.layer, file.path
            ))
        })?;

        match file.change {
            FileChange::Removed => match target {
                DeltaTarget::Chunk { wad, hash } => delta.remove_chunk(&file.layer, &wad, hash),
                DeltaTarget::Entry { path } => delta.remove_entry(&path),
            },
            FileChange::Unchanged => continue,
            FileChange::Written => {
                let bytes = bytes_of(file)?;
                match target {
                    DeltaTarget::Chunk { wad, hash } => delta.chunk(&file.layer, &wad, hash, bytes),
                    DeltaTarget::Entry { path } => delta.entry(&path, bytes),
                }
            }
        };
    }

    Ok(delta)
}

/// What one repaired file of a staged project addresses in the archive it came
/// from.
#[derive(Debug, Clone, PartialEq, Eq)]
enum DeltaTarget {
    /// A chunk of a packed WAD in the file's layer, keyed by its path hash.
    Chunk { wad: String, hash: WadHash },
    /// A whole archive entry, by its entry name.
    Entry { path: String },
}

impl DeltaTarget {
    /// What the repaired `path` of `layer` addresses.
    ///
    /// This reverses the unpack's placement: a layer's WAD directory unpacks
    /// into that layer, and `RAW/` into the base layer's `raw` directory. A
    /// `.wad.client` directory is a WAD whose chunks are addressed by hash, and
    /// every other path is an entry.
    ///
    /// The hash comes from [`chunk_hash_of`] instead of hashing the path as
    /// written, because a lossless unpack writes an unnamed chunk as bare hex
    /// and adds `.ltk` to a path two chunks share.
    ///
    /// `None` for a layer name no WAD directory can hold.
    fn of(layer: &str, path: &str) -> Option<Self> {
        if !is_layer_name(layer) {
            return None;
        }

        Some(match path.split_once('/') {
            Some((dir, rest)) if dir.to_ascii_lowercase().ends_with(WAD_DIR_SUFFIX) => {
                Self::Chunk {
                    wad: dir.to_owned(),
                    hash: chunk_hash_of(Utf8Path::new(rest)),
                }
            }
            Some((RAW_DIR, rest)) if layer == ModProjectLayer::BASE_NAME => Self::Entry {
                path: format!("RAW/{rest}"),
            },
            _ => Self::Entry {
                path: wad_entry_name(layer, path),
            },
        })
    }
}

/// Carry the mod's own hashtables into the edit, and declare them.
///
/// A repair writes every path it hashes into the mod's own table instead of
/// keeping a restore point (ADR-0006). An edit with only the fixed files would
/// leave the mod with hashes no table names. Every declared table is carried,
/// not only the one this run merged into, because only the fix run knows which
/// one that was.
fn declare_kept_names(
    delta: &mut ArchiveDelta<'static>,
    staging: &Path,
    archive: &Utf8Path,
) -> AppResult<()> {
    let root = staging.try_as_utf8("staging directory")?;
    let project = ModProject::load(root)
        .map_err(|e| AppError::Other(format!("Could not read the repaired mod project: {e}")))?;

    let mut info = FantomeReader::new(fs::File::open(archive)?)
        .and_then(|mut reader| reader.read_info())
        .map_err(|e| AppError::Other(format!("Could not read {archive}'s metadata: {e}")))?;

    let declared = info.hashtables.len();
    for manifest in &project.hashtables {
        let path = archive_table_path(&manifest.path).ok_or_else(|| {
            AppError::Other(format!(
                "A Fantome archive has no place for {}",
                manifest.path
            ))
        })?;

        delta.entry(&path, fs::read(root.join(&manifest.path))?);
        if !info
            .hashtables
            .iter()
            .any(|held| held.path.eq_ignore_ascii_case(&path))
        {
            info.hashtables.push(FantomeHashtable {
                path,
                category: manifest.category.clone(),
                algorithm: manifest.algorithm.clone(),
                bits: manifest.bits,
            });
        }
    }

    if info.hashtables.len() != declared {
        let written = serde_json::to_vec_pretty(&info)
            .map_err(|e| AppError::Other(format!("Could not write {archive}'s metadata: {e}")))?;
        delta.entry(ARCHIVE_INFO, written);
    }

    Ok(())
}

/// Carry the merged table into the edit, and declare it if the archive does
/// not.
///
/// Only one table is carried. A held run merges into the table it names, and
/// the edit raw-copies the archive's other tables.
fn declare_held_table(
    delta: &mut ArchiveDelta<'static>,
    table: &KeptTable,
    archive: &Utf8Path,
) -> AppResult<()> {
    let mut info = FantomeReader::new(fs::File::open(archive)?)
        .and_then(|mut reader| reader.read_info())
        .map_err(|e| AppError::Other(format!("Could not read {archive}'s metadata: {e}")))?;

    let path = match &table.into {
        Some(entry) => entry.path().to_string(),
        None => free_archive_table_path(&info.hashtables),
    };
    delta.entry(&path, table.bytes.clone());

    if !info
        .hashtables
        .iter()
        .any(|held| held.path.eq_ignore_ascii_case(&path))
    {
        let (algorithm, width) = &table.shape;
        info.hashtables.push(FantomeHashtable {
            path,
            category: Category::Game,
            algorithm: algorithm.clone(),
            bits: width.bits(),
        });
        let written = serde_json::to_vec_pretty(&info)
            .map_err(|e| AppError::Other(format!("Could not write {archive}'s metadata: {e}")))?;
        delta.entry(ARCHIVE_INFO, written);
    }

    Ok(())
}

/// A conventional table path under the archive's `META/hashes/` that no
/// manifest entry uses.
///
/// It follows the naming sequence of a project's `hashes/`.
fn free_archive_table_path(manifests: &[FantomeHashtable]) -> String {
    let taken: Vec<String> = manifests
        .iter()
        .map(|manifest| manifest.path.to_ascii_lowercase())
        .collect();
    std::iter::once(format!("{ARCHIVE_HASHES_DIR}/game.hashes.txt"))
        .chain((2..).map(|n| format!("{ARCHIVE_HASHES_DIR}/game{n}.hashes.txt")))
        .find(|candidate| !taken.contains(&candidate.to_ascii_lowercase()))
        .expect("the candidate sequence is unbounded")
}

/// Where the archive keeps the table a project declares at `declared`.
///
/// `None` for anything but a plain name directly under `hashes/`. A pack routes
/// other paths by rules in `ltk_mod_project`, and the edit leaves those to the
/// repack instead of copying the rules.
fn archive_table_path(declared: &str) -> Option<String> {
    let name = declared
        .strip_prefix(HASHES_DIR_NAME)
        .and_then(|rest| rest.strip_prefix('/'))
        .filter(|name| !name.is_empty() && !name.contains(['/', '\\', ':']))?;
    Some(format!("{ARCHIVE_HASHES_DIR}/{name}"))
}

/// Where `layer`'s file `path` sits under a staged project.
fn content_path(staging: &Path, layer: &str, path: &str) -> PathBuf {
    staging
        .join("content")
        .join(layer)
        .join(path.replace('/', std::path::MAIN_SEPARATOR_STR))
}

#[cfg(test)]
mod tests;
