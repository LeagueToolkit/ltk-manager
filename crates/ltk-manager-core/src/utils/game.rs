//! Read-only utilities for resolving and inspecting a League game directory.

use crate::config::Config;
use crate::error::{AppError, AppResult};
use fs_err as fs;
use std::path::{Path, PathBuf};

/// A League game directory — the one containing `DATA`.
///
/// Resolving is what distinguishes an install root from the `Game` subdirectory,
/// so holding one of these means that question is already settled and the
/// readers below can just join onto it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameDir(PathBuf);

impl GameDir {
    /// Resolve the game directory from the configured League path.
    ///
    /// Users may configure either the install root (`…/League of Legends`) or the
    /// `Game` subdirectory directly; both are accepted.
    pub fn resolve(config: &Config) -> AppResult<Self> {
        let league_root = config.league_path.clone().ok_or_else(|| {
            AppError::ValidationFailed("League path is not configured".to_string())
        })?;

        let game_dir = league_root.join("Game");
        if game_dir.exists() {
            return Ok(Self(game_dir));
        }
        if league_root.join("DATA").exists() {
            return Ok(Self(league_root));
        }

        Err(AppError::ValidationFailed(format!(
            "League path does not look like an install root or a Game directory: {}",
            league_root.display()
        )))
    }

    /// Treat an already-resolved path as a game directory.
    pub fn from_path(path: impl Into<PathBuf>) -> Self {
        Self(path.into())
    }

    /// The directory itself.
    pub fn path(&self) -> &Path {
        &self.0
    }

    /// Take ownership of the underlying path.
    pub fn into_path(self) -> PathBuf {
        self.0
    }

    /// Enumerate every `.wad` / `.wad.client` filename under `DATA`.
    ///
    /// Returns lowercased, deduplicated filenames (not paths) sorted alphabetically.
    /// The WAD filename space is effectively flat from the overlay's perspective —
    /// `OverlayBuilder::with_blocked_wads` matches by filename only — so we discard
    /// the directory part.
    pub fn wads(&self) -> AppResult<Vec<String>> {
        let data_dir = self.0.join("DATA");
        if !data_dir.exists() {
            return Err(AppError::ValidationFailed(format!(
                "Game DATA directory does not exist: {}",
                data_dir.display()
            )));
        }

        let mut out: Vec<String> = Vec::new();
        let mut stack: Vec<PathBuf> = vec![data_dir];
        while let Some(dir) = stack.pop() {
            let read = match fs::read_dir(&dir) {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!("Failed to read {}: {}", dir.display(), e);
                    continue;
                }
            };
            for entry in read.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                let lower = name.to_ascii_lowercase();
                if lower.ends_with(".wad") || lower.ends_with(".wad.client") {
                    out.push(lower);
                }
            }
        }

        out.sort();
        out.dedup();
        Ok(out)
    }

    /// Read champion internal names (WAD stems, e.g. `"Aatrox"`, `"MonkeyKing"`)
    /// from `DATA/FINAL/Champions`. Returns an empty list (logged at debug) when
    /// the directory can't be read — the resulting roster then matches no
    /// champion and the coarse WAD footprint still applies.
    pub fn champion_names(&self) -> Vec<String> {
        let champ_dir = self.0.join("DATA").join("FINAL").join("Champions");
        let entries = match fs::read_dir(&champ_dir) {
            Ok(entries) => entries,
            Err(e) => {
                tracing::debug!(
                    "Champion roster unavailable at {}: {}",
                    champ_dir.display(),
                    e
                );
                return Vec::new();
            }
        };
        entries
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                name.to_ascii_lowercase()
                    .ends_with(".wad.client")
                    .then(|| name.split('.').next().unwrap_or(name.as_str()).to_string())
            })
            .collect()
    }

    /// The League client's configured locale, e.g. `"en_us"`.
    pub fn locale(&self) -> Option<String> {
        super::locale::detect_league_locale(self)
    }

    /// Locales with a `Global.{locale}.wad.client`, lowercased and sorted.
    pub fn installed_locales(&self) -> Vec<String> {
        let Ok(entries) = fs::read_dir(self.localized_dir()) else {
            return Vec::new();
        };

        let mut locales: Vec<String> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_str()?.to_ascii_lowercase();
                let locale = name
                    .strip_prefix("global.")?
                    .strip_suffix(".wad.client")?
                    .to_string();
                if locale.is_empty() || locale.contains('.') {
                    return None;
                }
                Some(locale)
            })
            .collect();
        locales.sort();
        locales.dedup();
        locales
    }

    /// `Global.{locale}.wad.client`, matched case-insensitively.
    pub fn localized_global_wad(&self, locale: &str) -> Option<PathBuf> {
        let wanted = format!("global.{}.wad.client", locale.to_lowercase());
        fs::read_dir(self.localized_dir()).ok()?.find_map(|entry| {
            let entry = entry.ok()?;
            if entry.file_name().to_str()?.eq_ignore_ascii_case(&wanted) {
                Some(entry.path())
            } else {
                None
            }
        })
    }

    /// The directory holding the game's localized WADs.
    fn localized_dir(&self) -> PathBuf {
        self.0.join("DATA").join("FINAL").join("Localized")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use assert_matches::assert_matches;

    #[test]
    fn resolve_game_dir_no_league_path() {
        let config = Config::default();
        assert_matches!(
            GameDir::resolve(&config),
            Err(AppError::ValidationFailed(_))
        );
    }

    #[test]
    fn resolve_game_dir_with_game_subdir() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Game")).unwrap();

        let config = Config {
            league_path: Some(dir.path().to_path_buf()),
            ..Config::default()
        };
        let result = GameDir::resolve(&config).unwrap();
        assert!(result.path().ends_with("Game"));
    }

    #[test]
    fn resolve_game_dir_with_data_dir() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("DATA")).unwrap();

        let config = Config {
            league_path: Some(dir.path().to_path_buf()),
            ..Config::default()
        };
        let result = GameDir::resolve(&config).unwrap();
        assert_eq!(result.path(), dir.path());
    }

    #[test]
    fn resolve_game_dir_neither_dir() {
        let dir = tempfile::tempdir().unwrap();
        let config = Config {
            league_path: Some(dir.path().to_path_buf()),
            ..Config::default()
        };
        assert_matches!(
            GameDir::resolve(&config),
            Err(AppError::ValidationFailed(_))
        );
    }

    #[test]
    fn list_game_wads_finds_nested_wads_and_lowercases() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("DATA");
        let final_dir = data.join("FINAL").join("Champions");
        fs::create_dir_all(&final_dir).unwrap();
        fs::write(final_dir.join("Aatrox.wad.client"), b"").unwrap();
        fs::write(final_dir.join("Ahri.wad.client"), b"").unwrap();
        fs::write(data.join("Shared.wad"), b"").unwrap();
        fs::write(final_dir.join("not-a-wad.txt"), b"").unwrap();

        let wads = GameDir::from_path(dir.path()).wads().unwrap();
        assert!(wads.contains(&"aatrox.wad.client".to_string()));
        assert!(wads.contains(&"ahri.wad.client".to_string()));
        assert!(wads.contains(&"shared.wad".to_string()));
        assert_eq!(wads.len(), 3);
    }

    #[test]
    fn list_game_wads_errors_when_data_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert_matches!(
            GameDir::from_path(dir.path()).wads(),
            Err(AppError::ValidationFailed(_))
        );
    }

    #[test]
    fn read_champion_names_reads_wad_stems() {
        let dir = tempfile::tempdir().unwrap();
        let champ_dir = dir.path().join("DATA").join("FINAL").join("Champions");
        fs::create_dir_all(&champ_dir).unwrap();
        fs::write(champ_dir.join("Aatrox.wad.client"), b"").unwrap();
        fs::write(champ_dir.join("MonkeyKing.wad.client"), b"").unwrap();
        fs::write(champ_dir.join("readme.txt"), b"").unwrap();

        let mut names = GameDir::from_path(dir.path()).champion_names();
        names.sort();
        assert_eq!(names, vec!["Aatrox", "MonkeyKing"]);
    }

    #[test]
    fn read_champion_names_missing_dir_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(GameDir::from_path(dir.path()).champion_names().is_empty());
    }
}
