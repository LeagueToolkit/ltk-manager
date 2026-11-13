//! Path checks for the readers that take a relative path from a caller, and
//! the one spelling a path is written in for a reader.

use fs_err as fs;
use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

/// `path` as a reader sees it: forward slashes, without the `\\?\` prefix.
///
/// A setting holds what the picker gave it and the product registry writes
/// forward slashes, so a surface naming both would otherwise spell one install
/// two ways.
pub fn slashed(path: impl AsRef<Path>) -> String {
    let text = path.as_ref().to_string_lossy();
    let text = text.strip_prefix(r"\\?\").unwrap_or(&text);
    text.replace('\\', "/")
}

/// Join `relative` onto `root`, rejecting anything that escapes it.
///
/// The check runs twice on purpose. Reading the components rejects `..` and a
/// rooted path before any I/O happens, and comparing the canonicalized paths
/// after it catches an escape through a symlink or a junction, which no reading
/// of the components can see.
///
/// Both paths have to exist, because canonicalizing is what makes the second
/// check possible.
///
/// # Errors
///
/// Fails with [`AppError::InvalidPath`] when `relative` escapes `root`, and
/// with [`AppError::Io`] when either path cannot be canonicalized, which is
/// what a missing file reports.
pub fn resolve_within(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let escaped = || AppError::InvalidPath(format!("Path escapes {}: {relative}", root.display()));

    let candidate = Path::new(relative);
    let plain = candidate
        .components()
        .all(|c| matches!(c, Component::Normal(_)));
    if candidate.is_absolute() || !plain {
        return Err(escaped());
    }

    let root = fs::canonicalize(root)?;
    let path = fs::canonicalize(root.join(candidate))?;
    if !path.starts_with(&root) {
        return Err(escaped());
    }
    Ok(path)
}

/// Joins `relative` onto `root`, rejecting anything that escapes it.
///
/// Plain component checks reject `..` and rooted paths. The nearest existing ancestor is
/// canonicalized and checked to start with the canonicalized `root`, catching symlink escapes
/// even when `relative` does not exist yet.
///
/// # Errors
///
/// Fails with [`AppError::InvalidPath`] when `relative` escapes `root` or contains non-normal
/// components, and with [`AppError::Io`] when `root` or its existing ancestor cannot be canonicalized.
pub fn resolve_target_within(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let escaped = || AppError::InvalidPath(format!("Path escapes {}: {relative}", root.display()));

    let candidate = Path::new(relative);
    let plain = candidate
        .components()
        .all(|c| matches!(c, Component::Normal(_)));
    if candidate.is_absolute() || !plain {
        return Err(escaped());
    }

    let root = fs::canonicalize(root)?;
    let full = root.join(candidate);
    let existing = full.ancestors().find(|a| a.exists()).unwrap_or(&root);
    let canonical_existing = fs::canonicalize(existing)?;
    if !canonical_existing.starts_with(&root) {
        return Err(escaped());
    }
    let rest = full.strip_prefix(existing).unwrap_or(Path::new(""));
    let path = if rest.as_os_str().is_empty() {
        canonical_existing
    } else {
        canonical_existing.join(rest)
    };
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slashed_spells_a_path_with_forward_slashes_and_no_verbatim_prefix() {
        assert_eq!(
            slashed(r"\\?\C:\Riot Games\League of Legends (PBE)"),
            "C:/Riot Games/League of Legends (PBE)"
        );
        assert_eq!(
            slashed(Path::new("C:/Riot Games/League of Legends")),
            "C:/Riot Games/League of Legends"
        );
    }

    #[test]
    fn resolves_a_plain_relative_path() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("assets")).unwrap();
        fs::write(tmp.path().join("assets").join("icon.tex"), b"x").unwrap();

        let path = resolve_within(tmp.path(), "assets/icon.tex").unwrap();

        assert!(path.ends_with("assets/icon.tex") || path.ends_with(r"assets\icon.tex"));
    }

    #[test]
    fn rejects_a_path_that_escapes_the_root() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("secret"), b"x").unwrap();
        let root = tmp.path().join("root");
        fs::create_dir_all(&root).unwrap();

        for relative in [
            "../secret",
            "..",
            "assets/../../secret",
            "/secret",
            "./secret",
        ] {
            let err = resolve_within(&root, relative).unwrap_err();
            assert!(
                matches!(err, AppError::InvalidPath(_)),
                "{relative:?} should be rejected as an invalid path"
            );
        }
    }

    #[test]
    fn a_missing_file_is_an_io_error() {
        let tmp = tempfile::tempdir().unwrap();
        let err = resolve_within(tmp.path(), "nothing.tex").unwrap_err();
        assert!(matches!(err, AppError::Io(_)));
    }

    #[test]
    fn resolve_target_within_resolves_nonexistent_path() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("base")).unwrap();

        let path = resolve_target_within(tmp.path(), "base/new_folder/file.bnk").unwrap();

        assert!(
            path.ends_with(Path::new("base").join("new_folder").join("file.bnk")),
            "path was {path:?}"
        );
    }

    #[test]
    fn resolve_target_within_omits_trailing_slash_on_existing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let target_file = tmp.path().join("file.bnk");
        fs::write(&target_file, b"test").unwrap();

        let path = resolve_target_within(tmp.path(), "file.bnk").unwrap();
        let path_str = path.to_string_lossy();
        assert!(!path_str.ends_with('\\') && !path_str.ends_with('/'));
        assert_eq!(path, fs::canonicalize(&target_file).unwrap());
    }

    #[test]
    fn resolve_target_within_rejects_escaping_path() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        fs::create_dir_all(&root).unwrap();

        for relative in [
            "../secret",
            "..",
            "assets/../../secret",
            "/secret",
            "./secret",
        ] {
            let err = resolve_target_within(&root, relative).unwrap_err();
            assert!(
                matches!(err, AppError::InvalidPath(_)),
                "{relative:?} should be rejected as an invalid path"
            );
        }
    }
}
