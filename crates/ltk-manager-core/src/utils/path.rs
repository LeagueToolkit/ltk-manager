//! Path checks for the readers that take a relative path from a caller.

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

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

    let root = root.canonicalize()?;
    let path = root.join(candidate).canonicalize()?;
    if !path.starts_with(&root) {
        return Err(escaped());
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
}
