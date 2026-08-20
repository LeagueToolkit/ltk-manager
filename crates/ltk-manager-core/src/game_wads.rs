//! Read-only browsing of the game's WAD archives under `DATA/FINAL`.

use std::fmt;
use std::fs;
use std::io::BufReader;
use std::num::NonZeroUsize;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use lru::LruCache;
use ltk_hashdb::LayeredHashDb;
use ltk_wad::Wad;
use serde::Serialize;

use crate::config::Config;
use crate::error::{AppError, AppResult, MutexResultExt};
use crate::utils::game::GameDir;
use crate::utils::path::resolve_within;

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
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::InvalidPath`] when the name is absolute, or
    /// climbs out of `DATA/FINAL`, and with an I/O error when neither it nor
    /// the directory it sits in can be resolved.
    pub fn archive_path(&self, wad_name: &str) -> AppResult<PathBuf> {
        resolve_within(&self.final_dir, wad_name)
    }
}

/// One mounted archive, shared by every reader the cache handed it to.
///
/// The mount carries its own lock rather than sitting under the cache's. A
/// chunk read seeks and decompresses, so holding the cache across one would
/// queue every other archive's readers behind a single slow file.
type MountedWad = Arc<Mutex<Wad<BufReader<fs::File>>>>;

/// How many archives stay mounted at once.
///
/// A mount holds an open handle and the archive's whole chunk table, so the
/// cache trades memory for not re-reading that table. Four covers what a modder
/// moves between while working - a champion, its VFX, `UI` and one more - and
/// bounds the resident tables at the same time.
const MOUNT_CAPACITY: NonZeroUsize = NonZeroUsize::new(4).unwrap();

/// A bounded cache of mounted WAD archives.
///
/// [`Wad::mount`] reads an archive's chunk table end to end, which a browser
/// opening one preview after another out of the same archive would otherwise
/// pay on every chunk. Keyed on the resolved archive path, so pointing the app
/// at another install cannot serve a chunk out of the old one's mount.
///
/// Least-recently-used eviction is what bounds it. Releasing a mount with the
/// tab that wanted it would need the webview to report every close, and would
/// still drop the archive the next tab is about to ask for.
pub struct WadCache {
    mounted: Mutex<LruCache<PathBuf, MountedWad>>,
}

impl Default for WadCache {
    fn default() -> Self {
        Self::new(MOUNT_CAPACITY)
    }
}

impl fmt::Debug for WadCache {
    /// Reports how many archives are mounted, a mount being a file handle and a
    /// chunk table rather than anything worth printing.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut out = f.debug_struct("WadCache");
        match self.mounted.lock() {
            Ok(cache) => out.field("mounted", &cache.len()).finish(),
            Err(_) => out.finish_non_exhaustive(),
        }
    }
}

impl WadCache {
    /// A cache that keeps `capacity` archives mounted.
    #[must_use]
    pub fn new(capacity: NonZeroUsize) -> Self {
        Self {
            mounted: Mutex::new(LruCache::new(capacity)),
        }
    }

    /// Read one chunk of one archive, decompressed, mounting it if it is not.
    ///
    /// `wad_name` is a `DATA/FINAL`-relative name as returned by
    /// [`GameArchives::list`], and `path_hash` names one of its chunks.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::InvalidPath`] when `wad_name` escapes
    /// `DATA/FINAL` or when the archive holds no such chunk, with I/O or WAD
    /// errors when the archive cannot be read, and with
    /// [`AppError::MutexLockFailed`] when a previous holder of a lock panicked.
    pub fn read_chunk(
        &self,
        archives: &GameArchives,
        wad_name: &str,
        path_hash: u64,
    ) -> AppResult<Vec<u8>> {
        let mounted = self.mount(archives.archive_path(wad_name)?)?;
        let mut wad = mounted.lock().mutex_err()?;

        let chunk = *wad.chunks().get(path_hash).ok_or_else(|| {
            AppError::InvalidPath(format!("No chunk {path_hash:016x} in {wad_name}"))
        })?;
        Ok(wad.load_chunk_decompressed(&chunk)?.into_vec())
    }

    /// How many archives are mounted right now.
    ///
    /// # Errors
    ///
    /// Fails when a previous holder of the lock panicked.
    pub fn mounted(&self) -> AppResult<usize> {
        Ok(self.mounted.lock().mutex_err()?.len())
    }

    /// Unmount everything, so the next read opens the archive again.
    ///
    /// # Errors
    ///
    /// Fails when a previous holder of the lock panicked.
    pub fn clear(&self) -> AppResult<()> {
        self.mounted.lock().mutex_err()?.clear();
        Ok(())
    }

    /// The mount for `path`, opening the archive when the cache lacks one.
    ///
    /// The cache lock is dropped before the file is opened, so two callers
    /// racing for one archive can both mount it. That costs a duplicate read
    /// and settles on whichever landed last, which is cheaper than holding the
    /// whole cache across an open.
    fn mount(&self, path: PathBuf) -> AppResult<MountedWad> {
        if let Some(mounted) = self.mounted.lock().mutex_err()?.get(&path) {
            return Ok(Arc::clone(mounted));
        }

        let wad = Wad::mount(BufReader::new(fs::File::open(&path)?))?;
        let mounted = Arc::new(Mutex::new(wad));
        self.mounted
            .lock()
            .mutex_err()?
            .put(path, Arc::clone(&mounted));
        Ok(mounted)
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
    fn read_chunk_returns_the_chunk_data() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = final_dir(tmp.path());
        build_test_wad(
            &dir.join("Champions").join("Aatrox.wad.client"),
            &["assets/known.bin"],
        );
        let archives = GameArchives::at(tmp.path());

        let data = WadCache::default()
            .read_chunk(
                &archives,
                "Champions/Aatrox.wad.client",
                xxh64(b"assets/known.bin", 0),
            )
            .unwrap();

        assert_eq!(data, [0xAA; 64]);
    }

    #[test]
    fn read_chunk_of_a_hash_the_archive_lacks_is_an_invalid_path() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = final_dir(tmp.path());
        build_test_wad(
            &dir.join("Champions").join("Aatrox.wad.client"),
            &["assets/known.bin"],
        );

        let err = WadCache::default()
            .read_chunk(
                &GameArchives::at(tmp.path()),
                "Champions/Aatrox.wad.client",
                1,
            )
            .unwrap_err();

        assert!(matches!(err, AppError::InvalidPath(_)));
    }

    #[test]
    fn read_chunk_rejects_names_that_escape_final_dir() {
        let tmp = tempfile::tempdir().unwrap();
        final_dir(tmp.path());
        let archives = GameArchives::at(tmp.path());
        let cache = WadCache::default();

        let err = cache
            .read_chunk(&archives, "../evil.wad.client", 1)
            .unwrap_err();

        assert!(matches!(err, AppError::InvalidPath(_)));
        assert_eq!(
            cache.mounted().unwrap(),
            0,
            "a rejected name mounts nothing"
        );
    }

    #[test]
    fn every_chunk_of_one_archive_shares_a_single_mount() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = final_dir(tmp.path());
        build_test_wad(
            &dir.join("Champions").join("Aatrox.wad.client"),
            &["assets/first.bin", "assets/second.bin"],
        );
        let archives = GameArchives::at(tmp.path());
        let cache = WadCache::default();

        for path in [b"assets/first.bin".as_slice(), b"assets/second.bin"] {
            cache
                .read_chunk(&archives, "Champions/Aatrox.wad.client", xxh64(path, 0))
                .unwrap();
        }

        assert_eq!(cache.mounted().unwrap(), 1);
    }

    #[test]
    fn an_archive_past_the_capacity_pushes_the_oldest_one_out() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = final_dir(tmp.path());
        let names = ["One.wad.client", "Two.wad.client", "Three.wad.client"];
        for name in names {
            build_test_wad(&dir.join(name), &["assets/known.bin"]);
        }
        let archives = GameArchives::at(tmp.path());
        let cache = WadCache::new(NonZeroUsize::new(2).unwrap());

        for name in names {
            cache
                .read_chunk(&archives, name, xxh64(b"assets/known.bin", 0))
                .unwrap();
        }

        assert_eq!(cache.mounted().unwrap(), 2);
    }

    #[test]
    fn clearing_unmounts_everything() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = final_dir(tmp.path());
        build_test_wad(&dir.join("One.wad.client"), &["assets/known.bin"]);
        let cache = WadCache::default();
        cache
            .read_chunk(
                &GameArchives::at(tmp.path()),
                "One.wad.client",
                xxh64(b"assets/known.bin", 0),
            )
            .unwrap();

        cache.clear().unwrap();

        assert_eq!(cache.mounted().unwrap(), 0);
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
