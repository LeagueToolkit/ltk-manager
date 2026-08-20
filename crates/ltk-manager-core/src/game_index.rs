//! Every archive of an install, folded into one directory tree.

use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex};

use ltk_hashdb::LayeredHashDb;
use serde::Serialize;

use crate::error::{AppResult, MutexResultExt};
use crate::game_wads::GameArchives;

/// The directory id of the group holding chunks no hash table names.
///
/// A resolved WAD path never holds `?`, so the group cannot collide with a
/// directory the game ships.
pub const UNKNOWN_DIR: &str = "?";

/// What one directory of the folded index holds.
#[derive(Debug, Clone, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameDirListing {
    /// Subdirectories, sorted by name.
    pub dirs: Vec<GameDirEntry>,
    /// Files directly under this directory, sorted by name.
    pub files: Vec<GameFileEntry>,
}

/// One subdirectory, folded through any chain of single-child directories.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameDirEntry {
    /// What [`GameIndex::read_dir`] takes to open this row, forward slashes.
    pub path: String,
    /// What the row reads: the folded chain of segments joined by `/`.
    pub name: String,
    /// Files at or below the directory.
    pub file_count: u32,
}

/// One file of the folded index, in the shape a single archive reads back.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameFileEntry {
    /// Chunk path hash as 16 lowercase hex digits.
    pub path_hash: String,
    /// Resolved chunk path, or `None` when no hash table names it.
    pub path: Option<String>,
    /// Uncompressed chunk size.
    pub size_bytes: u64,
    /// The `DATA/FINAL`-relative archive the chunk was read from.
    ///
    /// The fold drops every copy of a chunk after the first, so this names the
    /// archive that copy came from and not every archive that carries it.
    pub wad: String,
}

/// What a built index holds.
#[derive(Debug, Clone, Copy, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameIndexStats {
    /// Archives merged, including any that failed to read.
    pub archives: u32,
    /// Files after deduplication.
    pub files: u32,
    /// Directories, not counting the root.
    pub dirs: u32,
}

/// Every archive of an install merged into one deduplicated directory tree.
///
/// A chunk several archives carry is one file here. The game ships the same
/// copy of a shared chunk in every archive that needs it, so the first read
/// wins and the rest are dropped.
///
/// Built once and read many times. A build walks every archive of the install
/// and costs seconds, while [`read_dir`](Self::read_dir) is a lookup.
#[derive(Debug)]
pub struct GameIndex {
    /// Directory arena. Index 0 is the root.
    dirs: Vec<Dir>,
    /// Chunks no hash table names, which have no directory to sit in.
    unknown: Vec<File>,
    /// Archive names, in merge order. A file's `wad` indexes this.
    wads: Vec<String>,
}

#[derive(Debug, Default)]
struct Dir {
    /// Sorted by name, which is the order a listing wants.
    children: BTreeMap<String, usize>,
    files: Vec<File>,
    /// Files at or below this directory, filled once the whole tree is in.
    file_count: u32,
}

#[derive(Debug)]
struct File {
    name: String,
    path_hash: u64,
    size_bytes: u64,
    /// Index into [`GameIndex::wads`].
    wad: u32,
}

impl GameIndex {
    /// Merge every archive under `DATA/FINAL` into one tree.
    ///
    /// An archive that cannot be read is logged and skipped, because one
    /// corrupt file in an install is not a reason to show no tree at all.
    ///
    /// # Errors
    ///
    /// Fails when the archives cannot be enumerated, which is the condition
    /// [`GameArchives::list`] reports.
    pub fn build(archives: &GameArchives, resolver: &LayeredHashDb) -> AppResult<Self> {
        let wads = archives.list()?;

        let mut index = Self {
            dirs: vec![Dir::default()],
            unknown: Vec::new(),
            wads: wads.iter().map(|wad| wad.name.clone()).collect(),
        };

        /* By hash rather than by path: an unnamed chunk has no path to compare,
        and the hash is what makes two archives' copies the same file. */
        let mut seen: HashSet<u64> = HashSet::new();

        for (ordinal, wad) in wads.iter().enumerate() {
            let ordinal = ordinal as u32;
            let read = archives.for_each_chunk(&wad.name, resolver, |path_hash, path, size| {
                if seen.insert(path_hash) {
                    index.insert(path_hash, path, size, ordinal);
                }
            });
            if let Err(e) = read {
                tracing::warn!("Skipping unreadable game archive {}: {e}", wad.name);
            }
        }

        index.finalize(0);
        index.unknown.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(index)
    }

    /// List one directory, or `None` when nothing in the index has that path.
    ///
    /// The root is `""` and the group of unnamed chunks is [`UNKNOWN_DIR`].
    pub fn read_dir(&self, path: &str) -> Option<GameDirListing> {
        if path == UNKNOWN_DIR {
            return Some(GameDirListing {
                dirs: Vec::new(),
                files: self
                    .unknown
                    .iter()
                    .map(|file| file.unnamed_entry(self.wad_name(file)))
                    .collect(),
            });
        }

        let index = self.resolve(path)?;
        let dir = &self.dirs[index];

        let mut dirs: Vec<GameDirEntry> = dir
            .children
            .iter()
            .map(|(name, &child)| self.fold(path, name, child))
            .collect();

        /* Last, and only at the root, so the junk drawer never pushes named
        paths down the tree. */
        if path.is_empty() && !self.unknown.is_empty() {
            dirs.push(GameDirEntry {
                path: UNKNOWN_DIR.to_owned(),
                name: "unknown".to_owned(),
                file_count: self.unknown.len() as u32,
            });
        }

        Some(GameDirListing {
            dirs,
            files: dir
                .files
                .iter()
                .map(|file| file.entry(path, self.wad_name(file)))
                .collect(),
        })
    }

    /// What the index holds, for a caller that reports its size.
    pub fn stats(&self) -> GameIndexStats {
        GameIndexStats {
            archives: self.wads.len() as u32,
            files: self.dirs[0].file_count + self.unknown.len() as u32,
            dirs: (self.dirs.len() - 1) as u32,
        }
    }

    /// Add one chunk under its resolved path, or to the unnamed group.
    ///
    /// `wad` is the ordinal of the archive the chunk was read from, which
    /// indexes [`Self::wads`].
    fn insert(&mut self, path_hash: u64, path: Option<&str>, size_bytes: u64, wad: u32) {
        let Some(path) = path else {
            self.unknown.push(File {
                name: format!("{path_hash:016x}"),
                path_hash,
                size_bytes,
                wad,
            });
            return;
        };

        let mut segments = path.split('/').filter(|s| !s.is_empty()).peekable();
        let mut cursor = 0usize;
        let mut name = None;

        while let Some(segment) = segments.next() {
            if segments.peek().is_none() {
                name = Some(segment);
                break;
            }
            cursor = match self.dirs[cursor].children.get(segment) {
                Some(&child) => child,
                None => {
                    let child = self.dirs.len();
                    self.dirs.push(Dir::default());
                    self.dirs[cursor].children.insert(segment.to_owned(), child);
                    child
                }
            };
        }

        // A path of nothing but separators names no file.
        let Some(name) = name else { return };
        self.dirs[cursor].files.push(File {
            name: name.to_owned(),
            path_hash,
            size_bytes,
            wad,
        });
    }

    /// The archive a file was read from.
    ///
    /// # Panics
    ///
    /// Panics when the file's ordinal is not one this index handed out, which
    /// is a bug in the build rather than a condition a caller can hit.
    fn wad_name(&self, file: &File) -> &str {
        &self.wads[file.wad as usize]
    }

    /// Sort each directory's files and fill in its recursive file count.
    fn finalize(&mut self, index: usize) -> u32 {
        let children: Vec<usize> = self.dirs[index].children.values().copied().collect();
        let mut total = self.dirs[index].files.len() as u32;
        for child in children {
            total += self.finalize(child);
        }

        let dir = &mut self.dirs[index];
        dir.files.sort_by(|a, b| a.name.cmp(&b.name));
        dir.file_count = total;
        total
    }

    /// The arena index of `path`, where `""` is the root.
    fn resolve(&self, path: &str) -> Option<usize> {
        let mut cursor = 0usize;
        for segment in path.split('/').filter(|s| !s.is_empty()) {
            cursor = *self.dirs[cursor].children.get(segment)?;
        }
        Some(cursor)
    }

    /// One child row, walked down its chain of single-child directories.
    ///
    /// A run of directories that each hold nothing but the next one is one row,
    /// so a modder scanning a tree of asset paths spends no rows on chains that
    /// carry no choice.
    fn fold(&self, parent: &str, name: &str, child: usize) -> GameDirEntry {
        let mut path = if parent.is_empty() {
            name.to_owned()
        } else {
            format!("{parent}/{name}")
        };
        let mut display = name.to_owned();
        let mut cursor = child;

        loop {
            let dir = &self.dirs[cursor];
            if !dir.files.is_empty() || dir.children.len() != 1 {
                break;
            }
            let Some((next_name, &next)) = dir.children.iter().next() else {
                break;
            };
            path.push('/');
            path.push_str(next_name);
            display.push('/');
            display.push_str(next_name);
            cursor = next;
        }

        GameDirEntry {
            path,
            name: display,
            file_count: self.dirs[cursor].file_count,
        }
    }
}

/// Lazily-built, app-managed [`GameIndex`].
#[derive(Debug, Default)]
pub struct GameIndexState(Mutex<Option<Arc<GameIndex>>>);

impl GameIndexState {
    /// Return the index, building it on first use.
    ///
    /// `resolver` is called only when a build happens, because opening the
    /// hash tables costs more than every directory read that follows it. The
    /// lock is held across the build, so concurrent callers wait rather than
    /// each walking the whole install.
    ///
    /// # Errors
    ///
    /// Fails when the build fails, or when a previous holder of the lock
    /// panicked.
    pub fn get_or_build(
        &self,
        archives: &GameArchives,
        resolver: impl FnOnce() -> LayeredHashDb,
    ) -> AppResult<Arc<GameIndex>> {
        let mut slot = self.0.lock().mutex_err()?;
        if let Some(index) = slot.as_ref() {
            return Ok(Arc::clone(index));
        }

        let index = Arc::new(GameIndex::build(archives, &resolver())?);
        *slot = Some(Arc::clone(&index));
        Ok(index)
    }

    /// Drop the built index, so the next read walks the install again.
    ///
    /// # Errors
    ///
    /// Fails when a previous holder of the lock panicked.
    pub fn clear(&self) -> AppResult<()> {
        *self.0.lock().mutex_err()? = None;
        Ok(())
    }
}

impl File {
    /// The wire shape, with the path this file's directory gives it.
    fn entry(&self, dir: &str, wad: &str) -> GameFileEntry {
        let path = if dir.is_empty() {
            self.name.clone()
        } else {
            format!("{dir}/{}", self.name)
        };
        GameFileEntry {
            path_hash: format!("{:016x}", self.path_hash),
            path: Some(path),
            size_bytes: self.size_bytes,
            wad: wad.to_owned(),
        }
    }

    /// The wire shape of a chunk no hash table names, which has no path.
    fn unnamed_entry(&self, wad: &str) -> GameFileEntry {
        GameFileEntry {
            path_hash: format!("{:016x}", self.path_hash),
            path: None,
            size_bytes: self.size_bytes,
            wad: wad.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ltk_wad::{WadBuilder, WadChunkBuilder};
    use std::fs;
    use std::io::Write as _;
    use std::path::Path;
    use tempfile::TempDir;
    use xxhash_rust::xxh64::xxh64;

    /// A game directory holding `wads`, each named by its chunk paths.
    fn game_with(wads: &[(&str, &[&str])]) -> TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("DATA").join("FINAL");
        fs::create_dir_all(&dir).unwrap();

        for (name, chunk_paths) in wads {
            let path = dir.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            let mut builder = WadBuilder::default();
            for chunk_path in *chunk_paths {
                builder = builder.with_chunk(WadChunkBuilder::default().with_path(*chunk_path));
            }
            let mut file = fs::File::create(&path).unwrap();
            builder
                .build_to_writer(&mut file, |_path_hash, cursor| {
                    cursor.write_all(&[0xAA; 64])?;
                    Ok(())
                })
                .unwrap();
        }
        tmp
    }

    fn resolver_for(paths: &[&str]) -> LayeredHashDb {
        let mut resolver = LayeredHashDb::new();
        for path in paths {
            resolver.insert(xxh64(path.as_bytes(), 0), *path);
        }
        resolver
    }

    fn build(game: &Path, paths: &[&str]) -> GameIndex {
        GameIndex::build(&GameArchives::at(game), &resolver_for(paths)).unwrap()
    }

    #[test]
    fn merges_archives_into_one_tree() {
        let paths = ["assets/shared.bin", "assets/aatrox/skin0.bin"];
        let game = game_with(&[
            ("Aatrox.wad.client", &paths),
            (
                "Ahri.wad.client",
                &["assets/shared.bin", "assets/ahri/skin0.bin"],
            ),
        ]);

        let index = build(
            game.path(),
            &[
                "assets/shared.bin",
                "assets/aatrox/skin0.bin",
                "assets/ahri/skin0.bin",
            ],
        );

        let root = index.read_dir("").unwrap();
        assert_eq!(root.dirs.len(), 1, "one tree, not one row per archive");
        assert_eq!(root.dirs[0].name, "assets");
        assert_eq!(root.dirs[0].file_count, 3, "the shared chunk counts once");

        let assets = index.read_dir("assets").unwrap();
        let dirs: Vec<&str> = assets.dirs.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(
            dirs,
            ["aatrox", "ahri"],
            "both archives' paths, side by side"
        );
        let files: Vec<&str> = assets
            .files
            .iter()
            .filter_map(|f| f.path.as_deref())
            .collect();
        assert_eq!(files, ["assets/shared.bin"]);
    }

    #[test]
    fn a_shared_chunk_is_one_file() {
        let game = game_with(&[
            ("A.wad.client", &["assets/shared.bin"]),
            ("B.wad.client", &["assets/shared.bin"]),
            ("C.wad.client", &["assets/shared.bin"]),
        ]);

        let index = build(game.path(), &["assets/shared.bin"]);

        let files = index.read_dir("assets").unwrap().files;
        assert_eq!(files.len(), 1);
        assert_eq!(
            files[0].wad, "A.wad.client",
            "the copy that survives the fold names the archive it came from"
        );
        let stats = index.stats();
        assert_eq!(stats.archives, 3);
        assert_eq!(stats.files, 1);
    }

    #[test]
    fn every_file_names_the_archive_it_came_from() {
        let game = game_with(&[
            ("A.wad.client", &["assets/one.bin"]),
            ("Champions/B.wad.client", &["assets/two.bin"]),
        ]);

        let index = build(game.path(), &["assets/one.bin", "assets/two.bin"]);

        let files = index.read_dir("assets").unwrap().files;
        let wads: Vec<(&str, &str)> = files
            .iter()
            .map(|file| (file.path.as_deref().unwrap(), file.wad.as_str()))
            .collect();
        assert_eq!(
            wads,
            [
                ("assets/one.bin", "A.wad.client"),
                ("assets/two.bin", "Champions/B.wad.client"),
            ]
        );
    }

    #[test]
    fn an_unnamed_chunk_names_its_archive_too() {
        let game = game_with(&[("A.wad.client", &["assets/hidden.bin"])]);

        let index = build(game.path(), &[]);

        let files = index.read_dir(UNKNOWN_DIR).unwrap().files;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].wad, "A.wad.client");
    }

    #[test]
    fn folds_a_chain_of_single_child_directories() {
        let game = game_with(&[("A.wad.client", &["assets/characters/aatrox/hud/icon.dds"])]);
        let index = build(game.path(), &["assets/characters/aatrox/hud/icon.dds"]);

        let root = index.read_dir("").unwrap();
        assert_eq!(root.dirs[0].name, "assets/characters/aatrox/hud");
        assert_eq!(
            root.dirs[0].path, "assets/characters/aatrox/hud",
            "the row opens the directory that holds the files"
        );

        let folded = index.read_dir(&root.dirs[0].path).unwrap();
        assert_eq!(folded.files.len(), 1);
        assert_eq!(
            folded.files[0].path.as_deref(),
            Some("assets/characters/aatrox/hud/icon.dds"),
            "a file carries the whole path, folded rows included"
        );
    }

    #[test]
    fn a_chain_stops_folding_where_it_branches() {
        let game = game_with(&[(
            "A.wad.client",
            &[
                "assets/characters/aatrox/a.bin",
                "assets/characters/ahri/b.bin",
            ],
        )]);
        let index = build(
            game.path(),
            &[
                "assets/characters/aatrox/a.bin",
                "assets/characters/ahri/b.bin",
            ],
        );

        let root = index.read_dir("").unwrap();
        assert_eq!(root.dirs[0].name, "assets/characters");
        assert_eq!(root.dirs[0].file_count, 2);
    }

    #[test]
    fn unnamed_chunks_gather_under_one_group() {
        let game = game_with(&[("A.wad.client", &["assets/known.bin", "assets/mystery.bin"])]);
        let index = build(game.path(), &["assets/known.bin"]);

        let root = index.read_dir("").unwrap();
        let names: Vec<&str> = root.dirs.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(
            names,
            ["assets", "unknown"],
            "the group sits after named paths"
        );

        let unknown = index.read_dir(UNKNOWN_DIR).unwrap();
        assert_eq!(unknown.files.len(), 1);
        assert_eq!(
            unknown.files[0].path, None,
            "nothing names an unnamed chunk"
        );
        assert_eq!(
            unknown.files[0].path_hash,
            format!("{:016x}", xxh64(b"assets/mystery.bin", 0))
        );
        assert_eq!(index.stats().files, 2, "unnamed chunks count as files");
    }

    #[test]
    fn a_path_outside_the_index_lists_nothing() {
        let game = game_with(&[("A.wad.client", &["assets/known.bin"])]);
        let index = build(game.path(), &["assets/known.bin"]);

        assert!(index.read_dir("assets/nope").is_none());
        assert!(index.read_dir("nope").is_none());
    }

    #[test]
    fn an_install_with_no_archives_builds_an_empty_tree() {
        let game = game_with(&[]);
        let index = build(game.path(), &[]);

        let root = index.read_dir("").unwrap();
        assert!(root.dirs.is_empty());
        assert!(root.files.is_empty());
        assert_eq!(index.stats().files, 0);
    }
}
