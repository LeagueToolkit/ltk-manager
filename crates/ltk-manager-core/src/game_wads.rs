//! Read-only browsing of the game's WAD archives under `DATA/FINAL`.

use std::fs;
use std::io::BufReader;
use std::path::{Component, Path, PathBuf};

use ltk_hashdb::LayeredHashDb;
use ltk_wad::Wad;
use serde::Serialize;

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::utils::game::GameDir;

/// One WAD archive in a game install.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameWadSummary {
    /// Path relative to `DATA/FINAL` with forward slashes, e.g.
    /// `Champions/Aatrox.wad.client`.
    pub name: String,
    /// Archive file size on disk, or 0 when it cannot be read.
    pub size_bytes: u64,
}

/// One chunk of a WAD archive.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameWadEntry {
    /// Chunk path hash as 16 lowercase hex digits.
    pub path_hash: String,
    /// Resolved chunk path, or `None` when no hashtable knows the hash.
    pub path: Option<String>,
    /// Uncompressed chunk size.
    pub size_bytes: u64,
}

/// Read-only view of the WAD archives under a game's `DATA/FINAL` directory.
#[derive(Debug, Clone)]
pub struct GameArchives {
    final_dir: PathBuf,
}

impl GameArchives {
    /// Resolve from the configured League path.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::LeagueNotFound`] when no League path is
    /// configured, and with [`AppError::ValidationFailed`] when the configured
    /// path does not look like an install.
    pub fn resolve(config: &Config) -> AppResult<Self> {
        if config.league_path.is_none() {
            return Err(AppError::LeagueNotFound);
        }
        Ok(Self::at(GameDir::resolve(config)?.path()))
    }

    /// View an already-resolved game directory (the one containing `DATA`).
    pub fn at(game_dir: &Path) -> Self {
        Self {
            final_dir: game_dir.join("DATA").join("FINAL"),
        }
    }

    /// Enumerate every `*.wad.client` archive under `DATA/FINAL`, sorted by
    /// name.
    ///
    /// The extension match is case-insensitive. Unreadable subdirectories are
    /// logged and skipped.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::ValidationFailed`] when `DATA/FINAL` itself does
    /// not exist.
    pub fn list(&self) -> AppResult<Vec<GameWadSummary>> {
        if !self.final_dir.is_dir() {
            return Err(AppError::ValidationFailed(format!(
                "Game DATA/FINAL directory does not exist: {}",
                self.final_dir.display()
            )));
        }

        let mut out = Vec::new();
        for entry in walkdir::WalkDir::new(&self.final_dir).follow_links(false) {
            let entry = match entry {
                Ok(entry) => entry,
                Err(e) => {
                    tracing::warn!("Skipping unreadable game data entry: {e}");
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(relative) = entry.path().strip_prefix(&self.final_dir) else {
                continue;
            };
            let name = relative
                .components()
                .filter_map(|c| match c {
                    Component::Normal(part) => Some(part.to_string_lossy()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("/");
            if !name.to_ascii_lowercase().ends_with(".wad.client") {
                continue;
            }
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(GameWadSummary { name, size_bytes });
        }

        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    /// Read the chunk list of one archive, resolving path hashes via
    /// `resolver`.
    ///
    /// `wad_name` is a `DATA/FINAL`-relative name as returned by
    /// [`list`](Self::list). An empty resolver is fine: every path is then
    /// `None`. Entries come back in the archive's chunk order.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::InvalidPath`] when `wad_name` escapes
    /// `DATA/FINAL`, and with I/O or WAD errors when the archive cannot be
    /// read.
    pub fn read(&self, wad_name: &str, resolver: &LayeredHashDb) -> AppResult<Vec<GameWadEntry>> {
        let mut out = Vec::new();
        self.for_each_chunk(wad_name, resolver, |path_hash, path, size_bytes| {
            out.push(GameWadEntry {
                path_hash: format!("{path_hash:016x}"),
                path: path.map(str::to_owned),
                size_bytes,
            });
        })?;
        Ok(out)
    }

    /// Visit every chunk of one archive as `(path hash, resolved path, size)`.
    ///
    /// The same read as [`read`](Self::read) without the owned per-chunk shape,
    /// for callers that walk every archive of an install and keep only a part
    /// of what they see.
    ///
    /// # Errors
    ///
    /// The same conditions as [`read`](Self::read).
    pub fn for_each_chunk(
        &self,
        wad_name: &str,
        resolver: &LayeredHashDb,
        mut visit: impl FnMut(u64, Option<&str>, u64),
    ) -> AppResult<()> {
        let path = self.archive_path(wad_name)?;
        let file = fs::File::open(&path)?;
        let wad = Wad::mount(BufReader::new(file))?;

        let hashes: Vec<u64> = wad.chunks().iter().map(|c| c.path_hash()).collect();
        for ((path_hash, path), chunk) in resolver.get_batch(&hashes).zip(wad.chunks().iter()) {
            visit(path_hash, path.as_deref(), chunk.uncompressed_size() as u64);
        }
        Ok(())
    }

    /// Join `wad_name` under `DATA/FINAL`, rejecting anything that escapes it.
    fn archive_path(&self, wad_name: &str) -> AppResult<PathBuf> {
        let relative = Path::new(wad_name);
        let plain = relative
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
        if relative.is_absolute() || !plain {
            return Err(AppError::InvalidPath(format!(
                "WAD name escapes DATA/FINAL: {wad_name}"
            )));
        }

        // Canonicalize to also catch escapes through symlinks and junctions.
        let root = self.final_dir.canonicalize()?;
        let path = self.final_dir.join(relative).canonicalize()?;
        if !path.starts_with(&root) {
            return Err(AppError::InvalidPath(format!(
                "WAD name escapes DATA/FINAL: {wad_name}"
            )));
        }
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ltk_wad::{WadBuilder, WadChunkBuilder};
    use std::io::Write as _;
    use xxhash_rust::xxh64::xxh64;

    fn final_dir(root: &Path) -> PathBuf {
        let dir = root.join("DATA").join("FINAL");
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn build_test_wad(path: &Path, chunk_paths: &[&str]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut builder = WadBuilder::default();
        for chunk_path in chunk_paths {
            builder = builder.with_chunk(WadChunkBuilder::default().with_path(*chunk_path));
        }
        let mut file = fs::File::create(path).unwrap();
        builder
            .build_to_writer(&mut file, |_path_hash, cursor| {
                cursor.write_all(&[0xAA; 64])?;
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn list_reports_relative_names_sorted() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = final_dir(tmp.path());

        fs::write(dir.join("UI.wad.client"), [0u8; 5]).unwrap();
        fs::create_dir_all(dir.join("Champions")).unwrap();
        fs::write(dir.join("Champions").join("Aatrox.wad.client"), [0u8; 7]).unwrap();
        fs::write(dir.join("Champions").join("Ahri.WAD.CLIENT"), [0u8; 9]).unwrap();
        fs::write(dir.join("notes.txt"), b"decoy").unwrap();
        fs::write(dir.join("Legacy.wad"), b"decoy").unwrap();

        let wads = GameArchives::at(tmp.path()).list().unwrap();

        let names: Vec<&str> = wads.iter().map(|w| w.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Champions/Aatrox.wad.client",
                "Champions/Ahri.WAD.CLIENT",
                "UI.wad.client",
            ]
        );
        assert_eq!(wads[0].size_bytes, 7);
        assert_eq!(wads[1].size_bytes, 9);
        assert_eq!(wads[2].size_bytes, 5);
    }

    #[test]
    fn list_fails_without_a_final_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let err = GameArchives::at(tmp.path()).list().unwrap_err();
        assert!(matches!(err, AppError::ValidationFailed(_)));
    }

    #[test]
    fn read_rejects_names_that_escape_final_dir() {
        let tmp = tempfile::tempdir().unwrap();
        final_dir(tmp.path());
        let archives = GameArchives::at(tmp.path());
        let resolver = LayeredHashDb::new();

        for name in [
            "../evil.wad.client",
            "..",
            "Champions/../../evil.wad.client",
            "/evil.wad.client",
        ] {
            let err = archives.read(name, &resolver).unwrap_err();
            assert!(
                matches!(err, AppError::InvalidPath(_)),
                "{name:?} should be rejected as an invalid path"
            );
        }
    }

    #[test]
    fn read_of_a_missing_archive_is_an_io_error() {
        let tmp = tempfile::tempdir().unwrap();
        final_dir(tmp.path());
        let err = GameArchives::at(tmp.path())
            .read("Missing.wad.client", &LayeredHashDb::new())
            .unwrap_err();
        assert!(matches!(err, AppError::Io(_)));
    }

    #[test]
    fn read_resolves_known_chunks_and_leaves_the_rest_unresolved() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = final_dir(tmp.path());
        build_test_wad(
            &dir.join("Champions").join("Aatrox.wad.client"),
            &["assets/known.bin", "assets/unknown.bin"],
        );

        let known_hash = xxh64(b"assets/known.bin", 0);
        let mut resolver = LayeredHashDb::new();
        resolver.insert(known_hash, "assets/known.bin");

        let entries = GameArchives::at(tmp.path())
            .read("Champions/Aatrox.wad.client", &resolver)
            .unwrap();

        assert_eq!(entries.len(), 2);
        for entry in &entries {
            assert_eq!(entry.size_bytes, 64);
            assert_eq!(entry.path_hash.len(), 16);
        }
        let known = entries
            .iter()
            .find(|e| e.path_hash == format!("{known_hash:016x}"))
            .unwrap();
        assert_eq!(known.path.as_deref(), Some("assets/known.bin"));
        let unknown = entries.iter().find(|e| e.path.is_none()).unwrap();
        assert_eq!(
            unknown.path_hash,
            format!("{:016x}", xxh64(b"assets/unknown.bin", 0))
        );
    }
}
