//! The 260-character path limit, as it applies to unpacking a mod.
//!
//! A mod project spends its whole life as a directory tree, so the paths inside
//! it are far longer than the archive that used to hold them. On a Windows with
//! long paths disabled, that tree is one the user's own file manager and every
//! third-party tool can no longer open — Rust's std reaches it through verbatim
//! paths, so the manager itself would keep working while everything around it
//! stopped. The import is refused instead, pointing at the fix.
//!
//! Refusing it takes two passes, because the cheap one cannot be exact. A
//! preflight reads the archive's own answer for where its entries land and
//! stops an import before it spends minutes unpacking, but a Fantome archive
//! stores a packed WAD as one entry and what a resolver will name the chunks
//! inside it is not knowable without unpacking it. So the tree is measured
//! again once it exists, which is the only answer that can be trusted.
//!
//! Both passes measure a path where it will live rather than where it is
//! written. An unpack stages its tree under a uuid and renames it onto the
//! mod's own directory afterwards, so the staging path answers for a mod that
//! never has it.

use crate::diagnostics::{Severity, windows::check_long_paths_enabled};
use crate::error::{AppError, AppResult};
use crate::mods::archive::reader::open_fantome;
use fs_err as fs;
use ltk_mod_project::ProjectPaths;
use ltk_modpkg::Modpkg;
use std::io::{Read, Seek};
use std::path::Path;

/// The longest path Windows accepts without long-path support.
///
/// One less than `MAX_PATH`, which is 260 and counts the terminating NUL: the
/// documented maximum is `D:\` plus 256 characters plus that NUL, so the path
/// itself gets 259 of them.
const MAX_LEGACY_PATH: usize = 259;

/// What a packed WAD's chunk file name costs, once unpacked.
///
/// A chunk the hashtables name lands under its game asset path, which is not
/// knowable before the unpack. A hex name — `0123456789abcdef.bin` — is what a
/// chunk nothing names gets, and is the floor this estimate uses.
const HEX_CHUNK_NAME_LEN: usize = "0123456789abcdef.bin".len();

/// How many characters Windows counts `path` as.
///
/// Windows measures a path in UTF-16 code units where Rust holds it in UTF-8
/// bytes, so anything outside ASCII takes more bytes than the limit counts it
/// in. The conversion is lossy only for an unpaired surrogate, which the
/// replacement character standing in for it matches one code unit for one.
fn windows_len(path: &Path) -> usize {
    utf16_len(&path.to_string_lossy())
}

/// [`windows_len`] for a path already known to be UTF-8.
fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Whether this machine accepts paths past [`MAX_LEGACY_PATH`].
///
/// Always true off Windows, where the limit does not exist.
fn machine_allows_long_paths() -> bool {
    check_long_paths_enabled().severity != Severity::Warn
}

/// How long a path an import may write, or `None` where nothing is enforced.
///
/// Every guard below reads this rather than the machine directly, which is what
/// gives [`test_limit`] somewhere to stand: a real limit is 259 characters, and
/// a suite that had to build a path that long to cross one would be measuring
/// the filesystem rather than the guard.
fn enforced_limit() -> Option<usize> {
    #[cfg(test)]
    if let Some(max) = test_limit::current() {
        return Some(max);
    }

    (!machine_allows_long_paths()).then_some(MAX_LEGACY_PATH)
}

/// Holds every import on this thread to a limit the suite picks.
#[cfg(test)]
pub(crate) mod test_limit {
    use std::cell::Cell;

    thread_local! {
        static LIMIT: Cell<Option<usize>> = const { Cell::new(None) };
    }

    /// Hold imports to `max` characters until the returned guard drops.
    ///
    /// Thread-local rather than global because the suite runs its tests in
    /// parallel, and an import runs on the thread that asked for it.
    pub(crate) fn of(max: usize) -> Guard {
        LIMIT.with(|limit| limit.set(Some(max)));
        Guard(())
    }

    /// [`of`], `headroom` characters past `target_dir` itself.
    ///
    /// A limit written as a number would be one the suite's temporary
    /// directory is long enough to cross on one machine and not on another.
    /// Measuring from the directory the import writes into leaves `headroom`
    /// for the project's root files and refuses anything under `content/`.
    pub(crate) fn just_past(target_dir: &std::path::Path, headroom: usize) -> Guard {
        of(super::windows_len(target_dir) + headroom)
    }

    pub(super) fn current() -> Option<usize> {
        LIMIT.with(Cell::get)
    }

    /// Gives the thread back the machine's own answer when it drops.
    pub(crate) struct Guard(());

    impl Drop for Guard {
        fn drop(&mut self) {
            LIMIT.with(|limit| limit.set(None));
        }
    }
}

/// The directory an import writes into, as a refusal names it to the user.
///
/// Both are settings, and both are somewhere the user can move. Which one a
/// refusal points at is the only thing separating advice that helps from advice
/// that sends them to the wrong screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ImportRoot {
    /// `<storage>/mods/`, where the library installs and unpacks.
    ModStorage,
    /// The Creator Workshop's directory, which holds one folder per project.
    Workshop,
}

impl ImportRoot {
    /// The folder, as the second half of "move ___ closer to the drive root".
    fn as_prose(self) -> &'static str {
        match self {
            Self::ModStorage => "your mod storage",
            Self::Workshop => "your workshop directory",
        }
    }
}

/// Refuse an import whose longest file would land past the legacy limit.
///
/// `target_dir` is the directory the project is written into, and `root` the
/// folder holding it, which is what a refusal tells the user to move. A no-op
/// when the machine has long paths enabled.
///
/// # Errors
///
/// [`AppError::ValidationFailed`] naming the offending length and the setting
/// to change, so the caller can show it verbatim.
pub(crate) fn preflight_fantome_import(
    archive: &Path,
    target_dir: &Path,
    root: ImportRoot,
) -> AppResult<()> {
    let Some(max) = enforced_limit() else {
        return Ok(());
    };

    refuse_if_too_long(longest_fantome_import_path(archive, target_dir)?, max, root)
}

/// Refuse a tree that landed with a path past the limit.
///
/// [`preflight_fantome_import`] is a floor, and for a packed WAD a distant one:
/// its chunks are counted at a hex name, where a resolver that names them
/// writes game asset paths several times longer. Knowing those before the
/// unpack would cost the unpack itself, so the tree is measured once it exists
/// and the caller removes it on a refusal as it does on any other failure.
///
/// A no-op when the machine has long paths enabled.
///
/// # Errors
///
/// As [`preflight_fantome_import`], except that this one is exact.
pub(crate) fn verify_unpacked(dir: &Path, root: ImportRoot) -> AppResult<()> {
    verify_staged(dir, dir, root)
}

/// [`verify_unpacked`] for a tree still standing in a staging directory.
///
/// A staging directory is named for a uuid, so measuring the tree where it
/// stands answers for a path the mod never has — too long by however much the
/// uuid beats the slug, and too short whenever the slug beats the uuid.
/// `destination` is the directory the tree is about to be renamed onto, which
/// is the one whose length counts.
///
/// # Errors
///
/// As [`verify_unpacked`].
pub(crate) fn verify_staged(staged: &Path, destination: &Path, root: ImportRoot) -> AppResult<()> {
    let Some(max) = enforced_limit() else {
        return Ok(());
    };

    refuse_if_too_long(longest_path_at(staged, destination), max, root)
}

/// Refuse an import of `modpkg` whose longest file would land past the limit.
///
/// Takes the package already mounted, because the caller reads its metadata to
/// know where the project goes and mounting it a second time here would decode
/// the same tables again.
///
/// # Errors
///
/// As [`preflight_fantome_import`], except that a package names every chunk it
/// holds, so what this measures is the length itself rather than a floor.
pub(crate) fn preflight_modpkg_import<R: Read + Seek>(
    modpkg: &Modpkg<R>,
    target_dir: &Path,
    root: ImportRoot,
) -> AppResult<()> {
    let Some(max) = enforced_limit() else {
        return Ok(());
    };

    refuse_if_too_long(longest_modpkg_import_path(modpkg, target_dir), max, root)
}

/// Refuse a `longest` past `max`, pointing at the folder to move.
fn refuse_if_too_long(longest: usize, max: usize, root: ImportRoot) -> AppResult<()> {
    if longest <= max {
        return Ok(());
    }

    let relocatable = root.as_prose();
    Err(AppError::ValidationFailed(format!(
        "Unpacking this mod would write a {longest}-character path, past the {max}-character \
         limit Windows enforces while long paths are disabled. Enable long-path support (Diagnostics \
         lists the registry fix), or move {relocatable} closer to the drive root, then try again."
    )))
}

/// The longest path a fantome import would write under `target_dir`.
///
/// An estimate, and deliberately a floor: a packed WAD's chunks are counted at
/// their hex names because nothing knows the resolved ones before the unpack.
/// [`ProjectPath::is_unpacked_wad`](ltk_mod_project::ProjectPath::is_unpacked_wad)
/// is what says which paths those are.
///
/// Where an entry lands is the archive's own answer rather than a second copy
/// of the layout rules, which is what keeps the estimate and the import in step
/// when either moves.
///
/// # Errors
///
/// Fails when the archive cannot be opened or its entry table cannot be read.
pub(crate) fn longest_fantome_import_path(archive: &Path, target_dir: &Path) -> AppResult<usize> {
    let reader = open_fantome(archive)?;

    let prefix = windows_len(target_dir) + 1;

    let longest = reader
        .iter_project_paths()
        .map(|path| match path.is_unpacked_wad() {
            true => prefix + utf16_len(path.as_str()) + 1 + HEX_CHUNK_NAME_LEN,
            false => prefix + utf16_len(path.as_str()),
        })
        .max()
        .unwrap_or(0);

    Ok(longest)
}

/// The longest path a modpkg import would write under `target_dir`.
///
/// Exact, where [`longest_fantome_import_path`] is a floor: a package stores
/// its chunks individually and names every one of them, so nothing lands that
/// the plan did not already name.
fn longest_modpkg_import_path<R: Read + Seek>(modpkg: &Modpkg<R>, target_dir: &Path) -> usize {
    let prefix = windows_len(target_dir) + 1;

    modpkg
        .extraction_plan()
        .iter_project_paths()
        .map(|path| prefix + utf16_len(path.as_str()))
        .max()
        .unwrap_or(0)
}

/// The longest path the tree under `staged` will have once it sits at
/// `destination`, as Windows counts it.
///
/// Directories count alongside files, because one nothing landed in is still a
/// path on disk. A directory that cannot be read is skipped rather than
/// failing the measurement: this runs after a successful import, so the answer
/// being a little short is better than refusing a tree that is already written.
fn longest_path_at(staged: &Path, destination: &Path) -> usize {
    let prefix = windows_len(destination) + 1;
    let mut longest = 0;
    let mut pending = vec![staged.to_path_buf()];

    while let Some(current) = pending.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(relative) = path.strip_prefix(staged) {
                longest = longest.max(prefix + windows_len(relative));
            }

            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                pending.push(path);
            }
        }
    }

    longest
}

#[cfg(test)]
mod tests;
