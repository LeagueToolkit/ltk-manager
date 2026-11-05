//! Getting mods into and out of the library.
//!
//! An archive the library already holds is not installed again: the import
//! reports the mod it was installed as instead. A newer version of a mod the
//! library holds replaces that mod in place, keeping its id and profile choices.
//!
//! Installing happens in two halves. Staging copies the archive to
//! `mods/.staging-<uuid>.<ext>` and extracts its metadata into
//! `mods/.staging-<uuid>/`, which is the slow part and holds no lock.
//! Registering assigns the slug, renames both into place, and does the index
//! bookkeeping under the index lock. Splitting them is what lets a bulk install
//! stage every file before taking the lock once.
//!
//! Uninstalling reverses both and scrubs the mod from every profile and folder.

use crate::mods::ModLibrary;
use crate::mods::StorageLayout as _;
use crate::mods::archive::metadata::{extract_metadata, load_mod_project, read_installed_mod};
use crate::mods::index::document::archive_path;
use crate::mods::index::{EmbeddedNames, LibraryIndex, LibraryModEntry, ModArchiveFormat};
use crate::mods::slug::{ModSlug, TakenSlugs};
use crate::mods::types::{
    BulkInstallError, BulkInstallResult, InstallOutcome, InstalledMod, ROOT_FOLDER_ID,
};
use camino::Utf8Path;
use chrono::{DateTime, Utc};
use fs_err as fs;
use ltk_manager_base::config::Config;
use ltk_manager_base::error::{AppError, AppResult, Utf8PathExt, io_context};
use ltk_manager_base::events::{BackendEvent, InstallProgress};
use ltk_wad::PathResolver;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

mod existing;
mod update;

use existing::{SourceDigest, installed_from, older_version_of, read_library_mod};
use update::Replacement;

/// Prefix an in-flight install's directory and archive copy share under `mods/`.
///
/// The leading dot keeps them out of directory discovery, which walks `mods/`
/// looking for mod projects to re-register, and it is what the startup sweep
/// matches on.
pub(crate) const STAGING_PREFIX: &str = ".staging-";

/// What an install needs that the index does not hold.
pub(crate) struct InstallContext<'a> {
    /// Names for a packed WAD's chunks. Best-effort — with no tables the
    /// chunks land under their hex names, which the overlay reads either way.
    pub(crate) resolver: &'a dyn PathResolver,
}

/// A mod staged beside the index, not yet in it.
#[derive(Debug)]
pub(crate) struct StagedMod {
    id: String,
    installed_at: DateTime<Utc>,
    format: ModArchiveFormat,
    staging_dir: PathBuf,
    /// The copy of the source archive, which is where the content stays.
    staged_archive: PathBuf,
    /// The project's `name`, which the slug is derived from. Not
    /// `display_name`: the directory should not move when a user renames a mod.
    project_name: String,
    /// The file this came from, so a register that fails names something the
    /// user recognizes rather than an empty row.
    source_path: String,
    /// The chunk names the import embedded. `None` for a modpkg.
    embedded_names: Option<EmbeddedNames>,
    /// The source archive's bytes, which is what tells a repeat import.
    digest: SourceDigest,
}

impl StagedMod {
    /// Delete what staging left behind, for a register that could not finish.
    fn discard(&self) {
        if self.staging_dir.exists()
            && let Err(e) = fs::remove_dir_all(&self.staging_dir)
        {
            tracing::warn!(
                "Failed to clean up staging directory {}: {}",
                self.staging_dir.display(),
                e
            );
        }

        if self.staged_archive.exists()
            && let Err(e) = fs::remove_file(&self.staged_archive)
        {
            tracing::warn!(
                "Failed to clean up staged archive {}: {}",
                self.staged_archive.display(),
                e
            );
        }
    }
}

/// What preparing one archive for registration produced.
enum Staging {
    New(StagedMod),
    /// The library already holds the archive, as this mod.
    AlreadyInstalled(Box<InstalledMod>),
}

/// What registering one staged mod did.
struct Registration {
    outcome: InstallOutcome,
    /// For an update, the old files held back until the index is saved.
    replacement: Option<Replacement>,
}

impl Registration {
    fn done(outcome: InstallOutcome) -> Self {
        Self {
            outcome,
            replacement: None,
        }
    }

    /// The outcome, with an update's replacement made final.
    ///
    /// Called once the index holding the registration is saved.
    fn commit(self) -> InstallOutcome {
        if let Some(mut replacement) = self.replacement {
            replacement.commit();
        }

        self.outcome
    }
}

/// What materializing one archive into staging produced.
#[derive(Debug)]
struct StagedContent {
    /// The project's `name`, which the slug is derived from.
    project_name: String,
    /// The chunk names the import embedded. `None` for a modpkg.
    embedded_names: Option<EmbeddedNames>,
}

impl ModLibrary {
    /// Install one mod archive, update the older version of it the library
    /// holds, or report the mod the library already holds it as.
    ///
    /// # Errors
    ///
    /// Fails when the file is missing, the archive is malformed, or the mod
    /// cannot be moved into the library.
    pub fn install_mod_from_package(
        &self,
        config: &Config,
        file_path: &str,
    ) -> AppResult<InstallOutcome> {
        let storage_dir = self.storage_dir(config)?;
        let resolver = self.wad_resolver();
        let context = InstallContext {
            resolver: resolver.as_ref(),
        };

        let staged = match self.stage_new(config, &storage_dir, file_path, &context)? {
            Staging::New(staged) => staged,
            Staging::AlreadyInstalled(existing) => {
                return Ok(InstallOutcome::AlreadyInstalled(*existing));
            }
        };

        let registration = self.mutate_index(config, |storage_dir, index| {
            let mut taken = TakenSlugs::collect(index, &storage_dir.mods_dir());
            self.register_import(storage_dir, index, staged, &mut taken)
        })?;

        Ok(registration.commit())
    }

    /// Install multiple mods in a single batch operation.
    ///
    /// Stages every archive first, then takes the index lock once to register
    /// them all. Emits `"install-progress"` events per file.
    pub fn install_mods_from_packages(
        &self,
        config: &Config,
        file_paths: &[String],
    ) -> AppResult<BulkInstallResult> {
        if file_paths.is_empty() {
            return Ok(BulkInstallResult {
                installed: Vec::new(),
                updated: Vec::new(),
                already_installed: Vec::new(),
                failed: Vec::new(),
            });
        }

        let events = Arc::clone(self.events());
        let storage_dir = self.storage_dir(config)?;
        let resolver = self.wad_resolver();
        let context = InstallContext {
            resolver: resolver.as_ref(),
        };

        let total = file_paths.len();
        let mut staged = Vec::new();
        let mut already_installed = Vec::new();
        let mut failed = Vec::new();

        for (i, file_path) in file_paths.iter().enumerate() {
            let file_name = file_name_of(file_path);
            events.emit(BackendEvent::InstallProgress(InstallProgress {
                current: i + 1,
                total,
                current_file: file_name.clone(),
            }));

            match self.stage_new(config, &storage_dir, file_path, &context) {
                Ok(Staging::New(mod_package)) => staged.push(mod_package),
                Ok(Staging::AlreadyInstalled(existing)) => already_installed.push(*existing),
                Err(e) => {
                    tracing::warn!("Failed to install {}: {}", file_path, e);
                    failed.push(BulkInstallError {
                        file_path: file_path.clone(),
                        file_name,
                        message: e.to_string(),
                    });
                }
            }
        }

        let registrations = self.mutate_index(config, |storage_dir, index| {
            let mut taken = TakenSlugs::collect(index, &storage_dir.mods_dir());
            let mut registrations = Vec::new();
            for mod_package in staged {
                let source_path = mod_package.source_path.clone();
                match self.register_import(storage_dir, index, mod_package, &mut taken) {
                    Ok(registration) => registrations.push(registration),
                    Err(e) => {
                        tracing::warn!("Failed to register {}: {}", source_path, e);
                        failed.push(BulkInstallError {
                            file_name: file_name_of(&source_path),
                            file_path: source_path,
                            message: e.to_string(),
                        });
                    }
                }
            }
            Ok(registrations)
        })?;

        let mut installed = Vec::new();
        let mut updated = Vec::new();
        for registration in registrations {
            match registration.commit() {
                InstallOutcome::Installed(mod_info) => installed.push(mod_info),
                // A batch can carry two versions of one mod, so the second
                // updates a mod this batch already listed.
                InstallOutcome::Updated(mod_info) => {
                    match installed
                        .iter_mut()
                        .chain(updated.iter_mut())
                        .find(|listed| listed.id == mod_info.id)
                    {
                        Some(listed) => *listed = mod_info,
                        None => updated.push(mod_info),
                    }
                }
                InstallOutcome::AlreadyInstalled(existing) => already_installed.push(existing),
            }
        }

        Ok(BulkInstallResult {
            installed,
            updated,
            already_installed,
            failed,
        })
    }

    /// Register `staged` as a new mod, as an update of the older version the
    /// library holds, or not at all when the library already holds its archive.
    ///
    /// The archive check repeats under the index lock because one batch can
    /// carry the same archive twice.
    ///
    /// # Errors
    ///
    /// Whatever [`register_staged_mod`] or the update report, or a failure to
    /// read the mod the library already holds.
    fn register_import(
        &self,
        storage_dir: &Path,
        index: &mut LibraryIndex,
        staged: StagedMod,
        taken: &mut TakenSlugs,
    ) -> AppResult<Registration> {
        if let Some(existing) = installed_from(storage_dir, index, &staged.digest) {
            staged.discard();
            return read_library_mod(storage_dir, index, existing)
                .map(|existing| Registration::done(InstallOutcome::AlreadyInstalled(existing)));
        }

        let older = load_mod_project(&staged.staging_dir)
            .ok()
            .and_then(|project| older_version_of(storage_dir, index, &project))
            .map(|entry| entry.id.clone());

        if let Some(older) = older {
            let result = self.replace_with_staged(storage_dir, index, &older, &staged);
            staged.discard();
            let (replacement, updated) = result?;
            return Ok(Registration {
                outcome: InstallOutcome::Updated(updated),
                replacement: Some(replacement),
            });
        }

        let (_entry, installed) = register_staged_mod(storage_dir, index, staged, taken)?;
        self.place_by_kept_sort(storage_dir, index, ROOT_FOLDER_ID);
        Ok(Registration::done(InstallOutcome::Installed(installed)))
    }

    /// Stage `file_path`, or find the mod the library already installed it as.
    ///
    /// Checked before staging, which is the slow half, and again at
    /// registration by [`register_import`](Self::register_import).
    fn stage_new(
        &self,
        config: &Config,
        storage_dir: &Path,
        file_path: &str,
        context: &InstallContext<'_>,
    ) -> AppResult<Staging> {
        let digest = source_digest(Path::new(file_path))?;
        let existing = self.with_index(config, |storage_dir, index| {
            installed_from(storage_dir, index, &digest)
                .map(|entry| read_library_mod(storage_dir, index, entry))
                .transpose()
        })?;

        if let Some(existing) = existing {
            return Ok(Staging::AlreadyInstalled(Box::new(existing)));
        }

        stage_digested(storage_dir, file_path, digest, context).map(Staging::New)
    }

    pub fn uninstall_mod_by_id(&self, config: &Config, mod_id: &str) -> AppResult<()> {
        self.mutate_index(config, |storage_dir, index| {
            let Some(pos) = index.mods.iter().position(|m| m.id == mod_id) else {
                return Err(AppError::ModNotFound(mod_id.to_string()));
            };

            let entry = index.mods.remove(pos);

            for folder in &mut index.folders {
                folder.mod_ids.retain(|id| id != mod_id);
            }

            for profile in &mut index.profiles {
                profile.mod_order.retain(|id| id != mod_id);
                profile.enabled_mods.retain(|id| id != mod_id);
                profile.layer_states.remove(mod_id);
            }

            entry.remove_files(storage_dir)
        })
    }
}

/// Stage `file_path` as `mods/.staging-<uuid>.<ext>`, with its metadata beside it.
///
/// Holds no lock, so a bulk install does this per file before taking one.
///
/// # Errors
///
/// Fails when the file is missing or the archive is malformed.
pub(crate) fn stage_mod_package(
    storage_dir: &Path,
    file_path: &str,
    context: &InstallContext<'_>,
) -> AppResult<StagedMod> {
    let digest = source_digest(Path::new(file_path))?;
    stage_digested(storage_dir, file_path, digest, context)
}

/// The digest of the archive an import names.
///
/// # Errors
///
/// Fails with [`AppError::InvalidPath`] when the file is missing.
fn source_digest(file_path: &Path) -> AppResult<SourceDigest> {
    if !file_path.exists() {
        return Err(AppError::InvalidPath(file_path.display().to_string()));
    }

    SourceDigest::of(file_path)
}

/// [`stage_mod_package`], for an archive whose digest is already known.
fn stage_digested(
    storage_dir: &Path,
    file_path: &str,
    digest: SourceDigest,
    context: &InstallContext<'_>,
) -> AppResult<StagedMod> {
    let file_path = PathBuf::from(file_path);

    // A fantome is a zip, which is what an archive arriving under a name
    // nothing recognizes most often turns out to be. Guessing modpkg instead
    // would hand the file to the modpkg provider, and a modpkg is not
    // convertible, so nothing afterwards could undo the guess.
    let format = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .and_then(ModArchiveFormat::from_extension)
        .unwrap_or(ModArchiveFormat::Fantome);

    let id = Uuid::new_v4().to_string();
    let mods_dir = storage_dir.mods_dir();
    let staging_dir = mods_dir.join(format!("{STAGING_PREFIX}{id}"));
    let staged_archive = mods_dir.join(format!("{STAGING_PREFIX}{id}.{}", format.extension()));
    fs::create_dir_all(&staging_dir)?;

    let staged = stage_into(&staging_dir, &staged_archive, &file_path, format, context)
        .inspect_err(|_| {
            let _ = fs::remove_dir_all(&staging_dir);
            let _ = fs::remove_file(&staged_archive);
        })?;

    Ok(StagedMod {
        id,
        installed_at: Utc::now(),
        format,
        staging_dir,
        staged_archive,
        project_name: staged.project_name,
        source_path: file_path.display().to_string(),
        embedded_names: staged.embedded_names,
        digest,
    })
}

/// Copy one archive to `staged_archive` and write its metadata into
/// `staging_dir`.
///
/// The archive is the mod: every install keeps it, and the content provider
/// reads out of it. A fantome's copy is made by embedding its chunk names, so the
/// names its packed WADs carry survive into the library with it.
fn stage_into(
    staging_dir: &Path,
    staged_archive: &Path,
    file_path: &Path,
    format: ModArchiveFormat,
    context: &InstallContext<'_>,
) -> AppResult<StagedContent> {
    match format {
        // `Unknown` never reaches here — it is what a discovered directory
        // records, and nothing installs one.
        ModArchiveFormat::Fantome | ModArchiveFormat::Unknown => {
            let source = file_path.to_path_buf().try_into_utf8("archive path")?;
            let dest = staged_archive
                .to_path_buf()
                .try_into_utf8("staged archive")?;
            let embedded_names = Some(embed_names(&source, &dest, context)?);

            let outcome = ltk_fantome::normalize_archive(&dest, &dest)
                .map_err(|e| AppError::Other(format!("Failed to normalize the archive: {e}")))?;
            tracing::info!(archive = %dest, outcome = ?outcome, "Normalized the mod's archive");

            extract_metadata(staged_archive, ModArchiveFormat::Fantome, staging_dir)?;

            Ok(StagedContent {
                project_name: load_mod_project(staging_dir)?.name,
                embedded_names,
            })
        }
        ModArchiveFormat::Modpkg => {
            fs::copy(file_path, staged_archive)?;
            extract_metadata(staged_archive, ModArchiveFormat::Modpkg, staging_dir)?;

            Ok(StagedContent {
                project_name: load_mod_project(staging_dir)?.name,
                embedded_names: None,
            })
        }
    }
}

/// Copies the fantome at `source` to `dest` with the names of its chunks embedded.
///
/// # Errors
///
/// Fails if the archive or a packed WAD in it cannot be read, or `dest` cannot be written.
fn embed_names(
    source: &Utf8Path,
    dest: &Utf8Path,
    context: &InstallContext<'_>,
) -> AppResult<EmbeddedNames> {
    let report = ltk_mod_project::embed_archive_names(source, dest, Some(context.resolver))
        .map_err(|e| AppError::Other(format!("Failed to read the mod's chunk names: {e}")))?;

    for skipped in &report.skipped {
        tracing::warn!(archive = %source, "{skipped}");
    }
    tracing::info!(
        archive = %source,
        outcome = ?report.outcome,
        unnamed = report.unnamed,
        "Embedded the mod's chunk names on import"
    );

    Ok(EmbeddedNames::from(&report))
}

/// Assign a slug, move the staged files into place, and record the mod.
///
/// Runs under the index lock. On any failure everything staging wrote is
/// removed, so a half-registered mod never outlives the call.
///
/// # Errors
///
/// Fails when the staged directory or its archive cannot be moved into place,
/// or when the config cannot be read back.
pub(crate) fn register_staged_mod(
    storage_dir: &Path,
    index: &mut LibraryIndex,
    staged: StagedMod,
    taken: &mut TakenSlugs,
) -> AppResult<(LibraryModEntry, InstalledMod)> {
    let slug = ModSlug::assign(&staged.project_name, taken);
    let mod_dir = storage_dir.mods_dir().join(slug.as_str());

    if let Err(e) = fs::rename(&staged.staging_dir, &mod_dir) {
        staged.discard();
        return Err(io_context(
            e,
            format!("Failed to move staged mod into {}", mod_dir.display()),
        ));
    }

    let destination = archive_path(storage_dir, &slug, staged.format);
    if let Err(e) = fs::rename(&staged.staged_archive, &destination) {
        // A mod without its archive is not a mod: the content provider reads
        // out of it.
        let _ = fs::remove_dir_all(&mod_dir);
        staged.discard();
        return Err(io_context(
            e,
            format!(
                "Failed to move staged archive into {}",
                destination.display()
            ),
        ));
    }

    taken.insert(&slug);

    let entry = LibraryModEntry {
        id: staged.id,
        installed_at: staged.installed_at,
        format: staged.format,
        storage: staged.format.installed_storage(),
        slug: Some(slug),
        embedded_names: staged.embedded_names,
        source_sha256: Some(staged.digest.sha256),
        origin: None,
    };
    let id = entry.id.clone();
    index.mods.push(entry.clone());

    if let Some(root) = index.folders.iter_mut().find(|f| f.id == ROOT_FOLDER_ID) {
        root.mod_ids.insert(0, id.clone());
    }

    let active_profile_id = index.active_profile_id.clone();
    if let Some(profile) = index
        .profiles
        .iter_mut()
        .find(|p| p.id == active_profile_id)
    {
        profile.enabled_mods.insert(0, id.clone());
        profile.mod_order.insert(0, id.clone());
    }

    // A re-installed mod can carry a different layer set, which would otherwise
    // leave states for layers it no longer has.
    if let Ok(project) = load_mod_project(&mod_dir) {
        let new_layer_names: std::collections::HashSet<&str> =
            project.layers.iter().map(|l| l.name.as_str()).collect();
        for profile in &mut index.profiles {
            if let Some(states) = profile.layer_states.get_mut(&id) {
                states.retain(|name, _| new_layer_names.contains(name.as_str()));
            }
        }
    }

    let installed_mod = read_installed_mod(&entry, true, storage_dir, None)?;
    Ok((entry, installed_mod))
}

/// Stage and register one mod in a single step, for callers already holding
/// the index lock — reconciliation's drop-folder discovery.
///
/// # Errors
///
/// Whatever [`stage_mod_package`] or [`register_staged_mod`] report.
pub(crate) fn install_single_mod_to_index(
    storage_dir: &Path,
    index: &mut LibraryIndex,
    file_path: &str,
    context: &InstallContext<'_>,
    taken: &mut TakenSlugs,
) -> AppResult<(LibraryModEntry, InstalledMod)> {
    let staged = stage_mod_package(storage_dir, file_path, context)?;
    register_staged_mod(storage_dir, index, staged, taken)
}

fn file_name_of(file_path: &str) -> String {
    Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(file_path)
        .to_string()
}

#[cfg(test)]
mod tests;
