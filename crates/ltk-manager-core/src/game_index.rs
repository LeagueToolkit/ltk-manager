//! Every archive of an install, folded into one directory tree.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};

use ltk_hashdb::LayeredHashDb;
use ltk_wad::{WadHash, hex_name};
use serde::Serialize;

use crate::error::{AppResult, MutexResultExt};
use crate::game_wads::GameArchives;
use crate::matcher::{FindQuery, Query, Range, letter_mask, mask_covers};
use crate::utils::natural_order::compare_names;

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

/// One row a search matched, with the runs its two lines mark.
///
/// Marked runs are byte offsets into `name` and `path`, which the palette
/// slices to lift the matched characters out of the rest.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameSearchHit {
    /// Chunk path hash as 16 lowercase hex digits.
    pub path_hash: String,
    /// The path's basename, or the hash when no hash table names the chunk.
    pub name: String,
    /// The directory holding it, empty at the root and for an unnamed chunk.
    pub path: String,
    /// The `DATA/FINAL`-relative archive the chunk was read from.
    pub wad: String,
    /// 0 is a name the query opens, 1 a name holding it, 2 a match reaching the directory.
    pub band: u8,
    pub score: f64,
    pub name_ranges: Vec<Range>,
    pub path_ranges: Vec<Range>,
}

/// What one search of the folded index found.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameSearchResult {
    /// The best rows, best first, capped at [`SEARCH_LIMIT`].
    pub hits: Vec<GameSearchHit>,
    /// How many files matched in all, which the cap trimmed.
    pub total: u32,
    /// A newer search started before this one finished, so it gave up early.
    ///
    /// Its rows are whatever it had found, which is not the whole answer. The
    /// caller is expected to be showing the newer query by now.
    pub superseded: bool,
    /// No hash table named a single chunk, so only a hash can match.
    ///
    /// An install whose names never resolved answers every path query with
    /// nothing, which reads exactly like an install that holds no match. The
    /// caller says which of the two it is.
    pub unnamed: bool,
}

/// How many rows a search returns. Nothing sorts a million of them.
pub const SEARCH_LIMIT: usize = 100;

/// One file the full search matched, shaped as an entry a file tree can hold.
///
/// The pattern is matched over the full path, and the marked runs arrive
/// split at the basename: `name_ranges` are byte offsets into `name`, and
/// `path_ranges` are byte offsets into the directory prefix of `path`.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameFindHit {
    /// Chunk path hash as 16 lowercase hex digits.
    pub path_hash: String,
    /// Resolved path with forward slashes, or `None` when no hash table names the chunk.
    pub path: Option<String>,
    /// The path's basename, or the hash when no hash table names the chunk.
    pub name: String,
    /// The `DATA/FINAL`-relative archive the chunk was read from.
    pub wad: String,
    /// Uncompressed chunk size.
    pub size_bytes: u64,
    pub name_ranges: Vec<Range>,
    pub path_ranges: Vec<Range>,
}

/// What one full search of the folded index found.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameFindResult {
    /// Every matching row in tree order, capped at [`FIND_LIMIT`].
    pub hits: Vec<GameFindHit>,
    /// How many files matched in all, counted on past the cap.
    pub total: u32,
    /// A newer search started before this one finished, so it gave up early.
    ///
    /// Its rows are whatever it had found, which is not the whole answer. The
    /// caller is expected to be showing the newer pattern by now.
    pub superseded: bool,
    /// No hash table named a single chunk, so only a hash can match.
    pub unnamed: bool,
}

/// How many rows a full search returns.
///
/// The figure VS Code's own search stops at. A broader answer is not one a
/// reader scrolls, and past it the fix is a narrower pattern.
pub const FIND_LIMIT: usize = 20_000;

/// How many files a scan reads between two tests of the generation.
const STALE_CHECK_INTERVAL: u32 = 4096;

/// The newest search asked for, so a scan can see it has been overtaken.
///
/// Without this, a ten-character query runs ten full scans of the install and
/// only the last of them is one anybody wants.
#[derive(Debug, Default)]
pub struct SearchGeneration(AtomicU64);

impl SearchGeneration {
    /// Take the newest ticket, which every scan already running is now behind.
    pub fn claim(&self) -> u64 {
        self.0.fetch_add(1, AtomicOrdering::Relaxed) + 1
    }

    /// Whether a later search has claimed a ticket since this one.
    #[must_use]
    pub fn overtook(&self, ticket: u64) -> bool {
        self.0.load(AtomicOrdering::Relaxed) > ticket
    }
}

/// The newest full search asked for, on its own line apart from the palette's.
///
/// Separate from [`SearchGeneration`] so a keystroke in one box never gives up
/// a scan the other box is waiting on.
#[derive(Debug, Default)]
pub struct FindGeneration(SearchGeneration);

impl FindGeneration {
    /// Take the newest ticket, which every scan already running is now behind.
    pub fn claim(&self) -> u64 {
        self.0.claim()
    }

    /// Whether a later search has claimed a ticket since this one.
    #[must_use]
    pub fn overtook(&self, ticket: u64) -> bool {
        self.0.overtook(ticket)
    }
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
    /// Keyed by name. A listing re-sorts them, since it wants natural order.
    children: BTreeMap<String, usize>,
    files: Vec<File>,
    /// Files at or below this directory, filled once the whole tree is in.
    file_count: u32,
    /// Every letter below this directory: its files' names and its descendants'.
    ///
    /// A query whose letters this does not cover cannot match anything under
    /// here, so one `AND` skips the whole subtree. The letters of the path
    /// *down to* this directory are not in it - the walk carries those, which
    /// is what keeps this to one word per directory.
    subtree_mask: u32,
}

#[derive(Debug)]
struct File {
    name: String,
    path_hash: u64,
    size_bytes: u64,
    /// Index into [`GameIndex::wads`].
    wad: u32,
    /// The letters of `name`, which fills the padding this struct already had.
    mask: u32,
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
        /* Byte order rather than natural: these are 16 hex digits, and reading
        the leading digit run of each as a number interleaves them by it. */
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
        /* The map keyed them by byte order, and a folded row is named for the
        whole run rather than the key. */
        dirs.sort_by(|a, b| compare_names(&a.name, &b.name));

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

    /// The best rows of the whole install for one query, best first.
    ///
    /// `is_overtaken` is tested every few thousand files. A scan that has been
    /// overtaken returns what it has rather than finishing a walk nobody is
    /// waiting for, and says so through [`GameSearchResult::superseded`].
    ///
    /// An empty query matches nothing here. The install is not a list anybody
    /// wants handed to them unasked, and the palette only reaches this source
    /// once something is typed.
    pub fn search(&self, query: &str, is_overtaken: impl Fn() -> bool) -> GameSearchResult {
        let unnamed = self.dirs[0].file_count == 0 && !self.unknown.is_empty();

        let Some(query) = Query::parse(query) else {
            return GameSearchResult {
                hits: Vec::new(),
                total: 0,
                superseded: false,
                unnamed,
            };
        };

        let mut scan = Scan {
            index: self,
            mask: query.mask(),
            query,
            heap: BinaryHeap::with_capacity(SEARCH_LIMIT + 1),
            total: 0,
            path: String::with_capacity(128),
            full: String::with_capacity(160),
            since_check: 0,
            overtaken: false,
        };

        scan.walk(0, 0, &is_overtaken);
        scan.unknown(&is_overtaken);

        GameSearchResult {
            total: scan.total,
            superseded: scan.overtaken,
            unnamed,
            hits: scan
                .heap
                .into_sorted_vec()
                .into_iter()
                .map(|hit| hit.row)
                .collect(),
        }
    }

    /// Every file of the install the pattern matches, in tree order.
    ///
    /// Where [`search`](Self::search) ranks a bounded best-of for the palette,
    /// this returns the whole answer: each match in depth-first tree order,
    /// capped at [`FIND_LIMIT`] rows while the total counts on past it. The
    /// chunks no hash table names come last, matched by their hash.
    ///
    /// `is_overtaken` is tested every few thousand files, the contract
    /// [`search`](Self::search) sets.
    pub fn find(&self, query: &FindQuery, is_overtaken: impl Fn() -> bool) -> GameFindResult {
        self.find_capped(query, FIND_LIMIT, is_overtaken)
    }

    /// [`find`](Self::find) with the cap a test can afford to fill.
    fn find_capped(
        &self,
        query: &FindQuery,
        limit: usize,
        is_overtaken: impl Fn() -> bool,
    ) -> GameFindResult {
        let mut scan = FindScan {
            index: self,
            query,
            hits: Vec::new(),
            limit,
            total: 0,
            path: String::with_capacity(160),
            since_check: 0,
            overtaken: false,
        };

        scan.walk(0, &is_overtaken);
        scan.unknown(&is_overtaken);

        GameFindResult {
            hits: scan.hits,
            total: scan.total,
            superseded: scan.overtaken,
            unnamed: self.dirs[0].file_count == 0 && !self.unknown.is_empty(),
        }
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
            let name = hex_name(WadHash(path_hash));
            self.unknown.push(File {
                mask: letter_mask(&name),
                name,
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
            mask: letter_mask(name),
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

    /// Sort each directory's files and fill in what the whole subtree holds.
    ///
    /// Returns the recursive file count and the union of every letter below
    /// this directory, which is what lets a search skip a subtree whole.
    fn finalize(&mut self, index: usize) -> (u32, u32) {
        let children: Vec<(String, usize)> = self.dirs[index]
            .children
            .iter()
            .map(|(name, &child)| (name.clone(), child))
            .collect();

        let mut total = self.dirs[index].files.len() as u32;
        let mut mask = self.dirs[index]
            .files
            .iter()
            .fold(0, |mask, file| mask | file.mask);

        for (name, child) in children {
            let (count, subtree) = self.finalize(child);
            total += count;
            mask |= letter_mask(&name) | subtree;
        }

        let dir = &mut self.dirs[index];
        dir.files.sort_by(|a, b| compare_names(&a.name, &b.name));
        dir.file_count = total;
        dir.subtree_mask = mask;
        (total, mask)
    }

    /// Every file at or below one directory, in tree order.
    ///
    /// `path` is what a listing gave, so a folded chain addresses the
    /// directory that holds the files rather than the first link of the
    /// chain. [`UNKNOWN_DIR`] gives the group of chunks no hash table names,
    /// and the root gives its named files plus that group, which is what the
    /// tree shows below the root row.
    ///
    /// Returns `None` when nothing in the index has that path.
    pub fn files_under(&self, path: &str) -> Option<Vec<GameFileEntry>> {
        if path == UNKNOWN_DIR {
            return Some(self.unnamed_entries());
        }

        let root = self.resolve(path)?;
        let mut out = Vec::new();
        self.collect_files(root, path, &mut out);
        if path.is_empty() {
            out.extend(self.unnamed_entries());
        }
        Some(out)
    }

    /// The wire shape of every chunk no hash table names.
    fn unnamed_entries(&self) -> Vec<GameFileEntry> {
        self.unknown
            .iter()
            .map(|file| file.unnamed_entry(self.wad_name(file)))
            .collect()
    }

    /// Append this directory's files and every descendant's, depth first.
    fn collect_files(&self, index: usize, path: &str, out: &mut Vec<GameFileEntry>) {
        let dir = &self.dirs[index];
        for file in &dir.files {
            out.push(file.entry(path, self.wad_name(file)));
        }
        for (name, &child) in &dir.children {
            let child_path = if path.is_empty() {
                name.clone()
            } else {
                format!("{path}/{name}")
            };
            self.collect_files(child, &child_path, out);
        }
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

/// One walk of the index for one query.
///
/// Depth first, pushing and popping a segment on a single `String`, so a path
/// that survives the mask is built without allocating one per file.
struct Scan<'a> {
    index: &'a GameIndex,
    /// Split and lowercased once for every candidate that follows.
    query: Query,
    mask: u32,
    /// The best rows so far, worst at the root so the cap knows what to drop.
    heap: BinaryHeap<Hit>,
    total: u32,
    /// The directory the walk stands in, without a trailing separator.
    path: String,
    /// `path/name`, rebuilt in place for a candidate whose name did not match.
    full: String,
    since_check: u32,
    overtaken: bool,
}

impl Scan<'_> {
    /// Walk one directory, its files first and then its children.
    ///
    /// `path_mask` is every letter of the path down to here. Held on the stack
    /// rather than in each directory, which is what keeps the index's own cost
    /// to one word per directory.
    fn walk(&mut self, dir: usize, path_mask: u32, is_overtaken: &impl Fn() -> bool) {
        if self.overtaken {
            return;
        }

        /* The index outlives the scan, so a directory borrowed from it does not
        borrow the scan and the walk can still take itself mutably. */
        let index = self.index;
        let node = &index.dirs[dir];
        if !mask_covers(path_mask | node.subtree_mask, self.mask) {
            return;
        }

        for file in &node.files {
            if self.tick(is_overtaken) {
                return;
            }
            if !mask_covers(path_mask | file.mask, self.mask) {
                continue;
            }
            self.consider(file);
        }

        for (name, &child) in &node.children {
            let restore = self.path.len();
            if !self.path.is_empty() {
                self.path.push('/');
            }
            self.path.push_str(name);

            self.walk(child, path_mask | letter_mask(name), is_overtaken);

            self.path.truncate(restore);
            if self.overtaken {
                return;
            }
        }
    }

    /// The chunks no hash table names, which sit under no directory.
    ///
    /// Searchable by their hash, because reading one out of a log and asking
    /// the manager where it lives is the reason anybody types sixteen hex
    /// digits.
    fn unknown(&mut self, is_overtaken: &impl Fn() -> bool) {
        let index = self.index;
        self.path.clear();

        for file in &index.unknown {
            if self.tick(is_overtaken) {
                return;
            }
            if mask_covers(file.mask, self.mask) {
                self.consider(file);
            }
        }
    }

    /// Test the generation every so often, and report whether to stop.
    fn tick(&mut self, is_overtaken: &impl Fn() -> bool) -> bool {
        self.since_check += 1;
        if self.since_check >= STALE_CHECK_INTERVAL {
            self.since_check = 0;
            self.overtaken = is_overtaken();
        }
        self.overtaken
    }

    /// Score one file, and keep it when it beats the worst row held.
    ///
    /// The bands are the ranking rule the palette's own matcher obeys: a name
    /// the query opens, then a name that holds it, then a match reaching into
    /// the directory. A name match marks no part of the path, because it never
    /// read one.
    fn consider(&mut self, file: &File) {
        let hit = match self.query.matches(&file.name) {
            Some(matched) => {
                let band = u8::from(!self.query.starts(&file.name));
                self.hit(file, band, matched.score, matched.ranges, Vec::new())
            }
            /* A name holding only some of the terms still gets its path read,
            because the rest of them may be in a directory above it. */
            None if self.path.is_empty() => return,
            None => {
                self.full.clear();
                self.full.push_str(&self.path);
                self.full.push('/');
                self.full.push_str(&file.name);

                let Some(matched) = self.query.matches(&self.full) else {
                    return;
                };
                let boundary = self.path.len() as u32;
                let (path_ranges, name_ranges) = split_ranges(&matched.ranges, boundary);
                self.hit(file, 2, matched.score, name_ranges, path_ranges)
            }
        };

        self.total += 1;
        self.push(hit);
    }

    fn hit(
        &self,
        file: &File,
        band: u8,
        score: f64,
        name_ranges: Vec<Range>,
        path_ranges: Vec<Range>,
    ) -> Hit {
        Hit {
            band,
            score,
            length: (self.path.len() + file.name.len()) as u32,
            row: GameSearchHit {
                path_hash: hex_name(WadHash(file.path_hash)),
                name: file.name.clone(),
                path: self.path.clone(),
                wad: self.index.wad_name(file).to_owned(),
                band,
                score,
                name_ranges,
                path_ranges,
            },
        }
    }

    /// Keep the row while the cap has room, and past that only when it beats
    /// the worst one held.
    fn push(&mut self, hit: Hit) {
        if self.heap.len() < SEARCH_LIMIT {
            self.heap.push(hit);
            return;
        }
        // `Hit` orders worst first, so the root is the row to drop.
        if self.heap.peek().is_some_and(|worst| hit < *worst) {
            self.heap.pop();
            self.heap.push(hit);
        }
    }
}

/// One walk of the index for one full-search pattern.
///
/// Depth first like [`Scan`], but yes-or-no over the full path rather than
/// ranked, so the rows land in tree order and nothing sorts them. The walk
/// pushes and pops each segment on a single `String`, and a candidate's name
/// rides the same buffer, so a path is never allocated to be rejected.
struct FindScan<'a> {
    index: &'a GameIndex,
    query: &'a FindQuery,
    /// Matching rows in the order the walk met them, full at `limit`.
    hits: Vec<GameFindHit>,
    limit: usize,
    total: u32,
    /// The path the walk stands in, without a trailing separator.
    path: String,
    since_check: u32,
    overtaken: bool,
}

impl FindScan<'_> {
    /// Walk one directory, its files first and then its children.
    fn walk(&mut self, dir: usize, is_overtaken: &impl Fn() -> bool) {
        if self.overtaken {
            return;
        }

        let index = self.index;
        let node = &index.dirs[dir];

        for file in &node.files {
            if self.tick(is_overtaken) {
                return;
            }
            self.consider(file, true);
        }

        for (name, &child) in &node.children {
            let restore = self.path.len();
            if !self.path.is_empty() {
                self.path.push('/');
            }
            self.path.push_str(name);

            self.walk(child, is_overtaken);

            self.path.truncate(restore);
            if self.overtaken {
                return;
            }
        }
    }

    /// The chunks no hash table names, matched by their hash.
    fn unknown(&mut self, is_overtaken: &impl Fn() -> bool) {
        let index = self.index;
        self.path.clear();

        for file in &index.unknown {
            if self.tick(is_overtaken) {
                return;
            }
            self.consider(file, false);
        }
    }

    /// Match one file over its full path, and keep it while the cap has room.
    ///
    /// `named` says a hash table resolved the file, so an unnamed chunk's hash
    /// never masquerades as a path.
    fn consider(&mut self, file: &File, named: bool) {
        let restore = self.path.len();
        if !self.path.is_empty() {
            self.path.push('/');
        }
        self.path.push_str(&file.name);

        if let Some(ranges) = self.query.matches(&self.path) {
            self.total += 1;
            if self.hits.len() < self.limit {
                /* At the root the whole match is the name, and `split_ranges`
                cannot say so - it assumes a separator sits at the boundary. */
                let (path_ranges, name_ranges) = if restore == 0 {
                    (Vec::new(), ranges)
                } else {
                    split_ranges(&ranges, restore as u32)
                };
                self.hits.push(GameFindHit {
                    path_hash: hex_name(WadHash(file.path_hash)),
                    path: named.then(|| self.path.clone()),
                    name: file.name.clone(),
                    wad: self.index.wad_name(file).to_owned(),
                    size_bytes: file.size_bytes,
                    name_ranges,
                    path_ranges,
                });
            }
        }

        self.path.truncate(restore);
    }

    /// Test the generation every so often, and report whether to stop.
    fn tick(&mut self, is_overtaken: &impl Fn() -> bool) -> bool {
        self.since_check += 1;
        if self.since_check >= STALE_CHECK_INTERVAL {
            self.since_check = 0;
            self.overtaken = is_overtaken();
        }
        self.overtaken
    }
}

/// One kept row, ordered worst first so a bounded heap drops the right one.
#[derive(Debug)]
struct Hit {
    band: u8,
    score: f64,
    /// The length of `path/name`, so the shorter path wins a tie.
    length: u32,
    row: GameSearchHit,
}

impl Ord for Hit {
    /// Greater is worse: a higher band, then a lower score, then a longer path.
    fn cmp(&self, other: &Self) -> Ordering {
        self.band
            .cmp(&other.band)
            .then_with(|| other.score.total_cmp(&self.score))
            .then_with(|| self.length.cmp(&other.length))
            .then_with(|| self.row.path.cmp(&other.row.path))
            .then_with(|| self.row.name.cmp(&other.row.name))
    }
}

impl PartialOrd for Hit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Hit {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Hit {}

/// Cut one match over `path/name` into the runs each of the two lines marks.
fn split_ranges(ranges: &[Range], boundary: u32) -> (Vec<Range>, Vec<Range>) {
    let mut path = Vec::new();
    let mut name = Vec::new();

    for &(start, end) in ranges {
        if end <= boundary {
            path.push((start, end));
        } else if start > boundary {
            name.push((start - boundary - 1, end - boundary - 1));
        } else {
            if start < boundary {
                path.push((start, boundary));
            }
            if end > boundary + 1 {
                name.push((0, end - boundary - 1));
            }
        }
    }
    (path, name)
}

/// Lazily-built, app-managed [`GameIndex`].
#[derive(Debug, Default)]
pub struct GameIndexState(Mutex<Option<Arc<GameIndex>>>);

impl GameIndexState {
    /// Return the index, building it on first use.
    ///
    /// `resolver` is read only when a build happens. The lock is held across
    /// the build, so concurrent callers wait rather than each walking the whole
    /// install.
    ///
    /// # Errors
    ///
    /// Fails when the build fails, or when a previous holder of the lock
    /// panicked.
    pub fn get_or_build(
        &self,
        archives: &GameArchives,
        resolver: &LayeredHashDb,
    ) -> AppResult<Arc<GameIndex>> {
        let mut slot = self.0.lock().mutex_err()?;
        if let Some(index) = slot.as_ref() {
            return Ok(Arc::clone(index));
        }

        let index = Arc::new(GameIndex::build(archives, resolver)?);
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
            path_hash: hex_name(WadHash(self.path_hash)),
            path: Some(path),
            size_bytes: self.size_bytes,
            wad: wad.to_owned(),
        }
    }

    /// The wire shape of a chunk no hash table names, which has no path.
    fn unnamed_entry(&self, wad: &str) -> GameFileEntry {
        GameFileEntry {
            path_hash: hex_name(WadHash(self.path_hash)),
            path: None,
            size_bytes: self.size_bytes,
            wad: wad.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests;
