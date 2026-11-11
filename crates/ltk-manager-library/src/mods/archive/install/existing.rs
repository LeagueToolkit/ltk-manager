//! What the library already holds of an import: the same archive, or an older
//! version of the same mod.

use super::*;
use ltk_mod_project::{ModProject, ModProjectAuthor};
use semver::Version;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::BufReader;

/// The read size of [`SourceDigest::of`]. `io::copy` reads a bare `File` 8 KiB at a time.
const HASH_BUFFER_SIZE: usize = 1024 * 1024;

/// An archive's bytes, as the SHA-256 an import is compared by and their length.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceDigest {
    /// Lowercase hex.
    pub(crate) sha256: String,
    pub(crate) len: u64,
}

impl SourceDigest {
    /// The digest of the file at `path`.
    ///
    /// # Errors
    ///
    /// Fails when the file cannot be read.
    pub(crate) fn of(path: &Path) -> AppResult<Self> {
        let file = fs::File::open(path)?;
        let mut reader = BufReader::with_capacity(HASH_BUFFER_SIZE, file);
        let mut hasher = Sha256::new();
        let len = std::io::copy(&mut reader, &mut hasher)?;

        Ok(Self {
            sha256: format!("{:x}", hasher.finalize()),
            len,
        })
    }
}

/// The mod an archive with `digest` was installed as, if the library holds one.
///
/// An entry installed before digests were recorded is matched by its stored
/// archive, which is the source's bytes whenever the import rewrote nothing.
pub(crate) fn installed_from<'a>(
    storage_dir: &Path,
    index: &'a LibraryIndex,
    digest: &SourceDigest,
) -> Option<&'a LibraryModEntry> {
    index
        .mods
        .iter()
        .filter(|entry| entry.is_present(storage_dir))
        .find(|entry| match &entry.source_sha256 {
            Some(sha256) => *sha256 == digest.sha256,
            None => {
                entry.is_packed()
                    && stored_archive_matches(&entry.archive_path(storage_dir), digest)
            }
        })
}

/// Whether the archive at `archive` has `digest`, hashing it only when the lengths agree.
fn stored_archive_matches(archive: &Path, digest: &SourceDigest) -> bool {
    let same_len = fs::metadata(archive).is_ok_and(|meta| meta.len() == digest.len);

    same_len && SourceDigest::of(archive).is_ok_and(|stored| stored == *digest)
}

/// The mod `project` is a newer version of, if the library holds one.
///
/// The same mod has the same project name and the same authors. Only a greater
/// semver precedence is newer, and of several matches the highest version wins.
pub(crate) fn older_version_of<'a>(
    storage_dir: &Path,
    index: &'a LibraryIndex,
    project: &ModProject,
) -> Option<&'a LibraryModEntry> {
    let version = Version::parse(&project.version).ok()?;
    let authors = author_names(project);

    index
        .mods
        .iter()
        .filter(|entry| entry.is_present(storage_dir))
        .filter_map(|entry| {
            let installed = load_mod_project(&entry.mod_dir(storage_dir)).ok()?;
            let installed_version = Version::parse(&installed.version).ok()?;
            let same_mod = installed.name == project.name && author_names(&installed) == authors;
            let older = installed_version.cmp_precedence(&version).is_lt();

            (same_mod && older).then_some((installed_version, entry))
        })
        .max_by(|(a, _), (b, _)| a.cmp_precedence(b))
        .map(|(_, entry)| entry)
}

/// A project's author names, compared without case or surrounding whitespace.
fn author_names(project: &ModProject) -> BTreeSet<String> {
    project
        .authors
        .iter()
        .map(|author| match author {
            ModProjectAuthor::Name(name) | ModProjectAuthor::Role { name, .. } => {
                name.trim().to_lowercase()
            }
        })
        .collect()
}

/// `entry` as the library lists it, with the active profile's state and its folder.
///
/// # Errors
///
/// Fails when the mod's config cannot be read.
pub(crate) fn read_library_mod(
    storage_dir: &Path,
    index: &LibraryIndex,
    entry: &LibraryModEntry,
) -> AppResult<InstalledMod> {
    let (enabled, layers) = index.profile_state(&entry.id);
    let mut installed = read_installed_mod(entry, enabled, storage_dir, layers)?;
    installed.folder_id = index
        .folders
        .iter()
        .find(|folder| folder.mod_ids.contains(&entry.id))
        .map(|folder| folder.id.clone());

    Ok(installed)
}
