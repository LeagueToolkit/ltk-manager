//! Applying the fixes a user chose, and the restore point that reverses them.
//!
//! A `File` does not name its path. Once a fix has written the hash, the string
//! is gone from the file and no reader can derive it back, so a run keeps every
//! path it hashes in the project's own tables first - `preserve`. Before it
//! writes anything it also copies every file it is about to touch under
//! `.ltk/restore/<stamp>/`.
//!
//! Each file lands through a temp file in its own directory and then a rename.
//! A run that dies mid-way leaves whole files on both sides of it, and the
//! restore point covers the ones it finished.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use chrono::{DateTime, Utc};
use ltk_wad::PathResolver;
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::error::{AppError, AppResult};

use super::preserve::PreservedNames;
use super::{ProblemId, Run, rules};

/// The last restore points a project keeps.
///
/// Three is what a user reaches back through by hand, and a run of a 60MB
/// project is 60MB on disk, so a fourth buys a depth nobody walks at a price
/// every project pays.
pub const KEPT_RESTORE_POINTS: usize = 3;

/// How a restore point stamps its directory, in UTC.
///
/// Hyphens where a clock writes colons, because a colon is not legal in a
/// Windows path. The shape also sorts lexicographically in time order, which is
/// what the prune and the newest-first listing both read.
const STAMP_FORMAT: &str = "%Y-%m-%dT%H-%M-%SZ";

/// The directory a project keeps its layers under.
const CONTENT_DIR: &str = "content";

/// What a restore point names its record of the run.
const RUN_FILE: &str = "run.json";

/// How many runs one second of the stamp can name.
///
/// A second is the finest a stamp reads, so a run that opens inside a second
/// another already claimed takes a suffix rather than the same directory.
const RUNS_IN_ONE_SECOND: u32 = 16;

/// One application of the fixes a user chose, and the writes it made.
///
/// A rule takes this and reads and writes through it, so staging into the
/// restore point happens on the way past rather than as a step a rule could
/// forget.
#[derive(Debug)]
pub struct FixRun<'a> {
    project_root: PathBuf,
    at: DateTime<Utc>,
    stamp: String,
    restore_dir: PathBuf,
    tables: Vec<String>,
    /// The files already copied into the restore point, by their source path.
    staged: HashSet<PathBuf>,
    files: Vec<FileOutcome>,
    kept: PreservedNames<'a>,
}

impl<'a> FixRun<'a> {
    /// Open a fix run, and make the restore point it will copy into.
    ///
    /// `exclusions` names what a reader resolves without the mod's help, in
    /// practice the community hashtables. A name it already holds is not
    /// embedded, and `None` embeds every name a fix hashes away.
    ///
    /// # Errors
    ///
    /// Reports a `.ltk/restore/` that cannot be created. Nothing is written
    /// when the restore point could not be made.
    pub fn open(
        project_root: &Path,
        tables: Vec<String>,
        exclusions: Option<&'a dyn PathResolver>,
    ) -> Result<Self, FixError> {
        let at = Utc::now();
        let (stamp, restore_dir) = make_restore_point(
            &restore_root(project_root),
            &at.format(STAMP_FORMAT).to_string(),
        )
        .map_err(FixError::RestorePoint)?;

        Ok(Self {
            project_root: project_root.to_path_buf(),
            at,
            stamp,
            restore_dir,
            tables,
            staged: HashSet::new(),
            files: Vec::new(),
            kept: PreservedNames::open(project_root, exclusions),
        })
    }

    /// The names this run keeps, for a rule about to hash one away.
    ///
    /// A rule asks before it converts, and leaves the property alone where the
    /// answer is [`Preserved::Collides`](super::preserve::Preserved::Collides).
    pub fn kept_names(&mut self) -> &mut PreservedNames<'a> {
        &mut self.kept
    }

    /// The bytes of one file, as they are on disk now.
    ///
    /// A rule re-derives every change from this rather than from what the check
    /// recorded, so a file changed in another tool cannot be written wrong.
    ///
    /// # Errors
    ///
    /// Reports a file that cannot be read, or a path that escapes the layer.
    pub fn read(&self, layer: &str, path: &str) -> Result<Vec<u8>, FixError> {
        let source = self.resolve(layer, path)?;
        fs::read(&source).map_err(|error| file_error(layer, path, error))
    }

    /// Copy the file into the restore point, then write `bytes` over it.
    ///
    /// # Errors
    ///
    /// Reports a file that could not be copied or written. The copy happens
    /// first, so a failed write leaves a restore point that still covers it.
    pub fn write(
        &mut self,
        layer: &str,
        path: &str,
        bytes: &[u8],
        applied: u32,
        skipped: u32,
    ) -> Result<(), FixError> {
        let destination = self.resolve(layer, path)?;
        self.stage(layer, path, &destination)?;

        let dir = destination
            .parent()
            .expect("a path resolved inside a layer always has a parent");
        let name = destination
            .file_name()
            .expect("a path resolved inside a layer always names a file");
        let temp = dir.join(format!(".{}.tmp", name.to_string_lossy()));

        fs::write(&temp, bytes).map_err(|error| file_error(layer, path, error))?;
        if let Err(error) = fs::rename(&temp, &destination) {
            let _ = fs::remove_file(&temp);
            return Err(file_error(layer, path, error));
        }

        self.record(layer, path, applied, skipped);
        Ok(())
    }

    /// Record a file the rule read and left alone.
    pub fn skipped(&mut self, layer: &str, path: &str, skipped: u32) {
        self.record(layer, path, 0, skipped);
    }

    /// The restore point's stamp, which an Undo names.
    #[must_use]
    pub fn stamp(&self) -> &str {
        &self.stamp
    }

    /// Write the kept names, `run.json`, and prune to [`KEPT_RESTORE_POINTS`].
    ///
    /// # Errors
    ///
    /// Reports a `run.json` that could not be written. A prune that fails is
    /// logged rather than reported, because the fix itself has landed.
    pub fn finish(self) -> Result<FixReport, FixError> {
        let applied: u32 = self.files.iter().map(|file| file.applied).sum();
        let skipped: u32 = self.files.iter().map(|file| file.skipped).sum();

        // Best-effort, and after the bins: a table that could not be written
        // costs the mod its names, and refusing the repair over it would leave
        // the mod broken as well as unnamed.
        let names_kept = match self.kept.write() {
            Ok(kept) => kept,
            Err(error) => {
                tracing::warn!(
                    "Repaired {} but could not keep its names: {error}",
                    self.project_root.display()
                );
                0
            }
        };

        let run = RunFile {
            stamp: self.stamp,
            at: self.at,
            manager: env!("CARGO_PKG_VERSION").to_owned(),
            tables: self.tables,
            files: self.files,
        };
        let json = serde_json::to_vec_pretty(&run)
            .map_err(|error| FixError::RestorePoint(io::Error::other(error)))?;
        fs::write(self.restore_dir.join(RUN_FILE), json).map_err(FixError::RestorePoint)?;

        if let Err(error) = prune(&restore_root(&self.project_root)) {
            tracing::warn!(
                "Could not prune the restore points of {}: {error}",
                self.project_root.display()
            );
        }

        Ok(FixReport {
            stamp: run.stamp,
            applied,
            skipped,
            names_kept: names_kept as u32,
            files: run.files,
            failed: Vec::new(),
        })
    }

    /// Resolve a layer-relative path to somewhere the layer genuinely holds.
    ///
    /// The same check as `workshop::layers::resolve_in_layer`, which is private
    /// to its own module. Every segment has to be one plain name, which rejects
    /// `..` and an absolute segment before anything reaches the disk, and the
    /// directory the file sits in is then canonicalized and checked against the
    /// layer - which is what a symlink partway down the path cannot get past.
    fn resolve(&self, layer: &str, path: &str) -> Result<PathBuf, FixError> {
        let escapes = || FixError::Escapes(format!("{layer}/{path}"));

        let layer_dir = self
            .project_root
            .join(CONTENT_DIR)
            .join(normal_segment(layer).ok_or_else(escapes)?);

        let mut target = layer_dir.clone();
        let mut depth = 0usize;
        for segment in path.split('/').filter(|segment| !segment.is_empty()) {
            target.push(normal_segment(segment).ok_or_else(escapes)?);
            depth += 1;
        }

        // The layer itself is not one of its own files.
        if depth == 0 {
            return Err(escapes());
        }

        let parent = target.parent().ok_or_else(escapes)?;
        let parent = fs::canonicalize(parent).map_err(|error| file_error(layer, path, error))?;
        let layer_dir =
            fs::canonicalize(&layer_dir).map_err(|error| file_error(layer, path, error))?;
        if !parent.starts_with(layer_dir) {
            return Err(escapes());
        }

        Ok(target)
    }

    /// Copy one file into the restore point, once for the whole run.
    ///
    /// A rule that writes the same file twice must not lose the pristine copy
    /// under the bytes of its own first pass.
    fn stage(&mut self, layer: &str, path: &str, source: &Path) -> Result<(), FixError> {
        if self.staged.contains(source) {
            return Ok(());
        }

        let copy = self
            .restore_dir
            .join(CONTENT_DIR)
            .join(layer)
            .join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let parent = copy
            .parent()
            .expect("a restore copy always sits under the restore point");
        fs::create_dir_all(parent).map_err(|error| file_error(layer, path, error))?;
        fs::copy(source, &copy).map_err(|error| file_error(layer, path, error))?;

        self.staged.insert(source.to_path_buf());
        Ok(())
    }

    /// Add to what this run has done to one file.
    ///
    /// One row for each file, so a rule that comes back to a file twice still
    /// reads as the one file it changed.
    fn record(&mut self, layer: &str, path: &str, applied: u32, skipped: u32) {
        if let Some(outcome) = self
            .files
            .iter_mut()
            .find(|outcome| outcome.layer == layer && outcome.path == path)
        {
            outcome.applied += applied;
            outcome.skipped += skipped;
            return;
        }

        self.files.push(FileOutcome {
            layer: layer.to_owned(),
            path: path.to_owned(),
            applied,
            skipped,
        });
    }
}

/// Apply the fixes of the named problems, and write a restore point first.
///
/// Every scope is this one call. Fix on a row, Fix on a group and Fix on the
/// panel differ only in the list they pass.
///
/// # Errors
///
/// Reports a project that cannot be opened, or a restore point that cannot be
/// made. A rule that fails on one file is reported inside the [`FixReport`].
pub fn apply(
    project_root: &Path,
    run: &Run,
    problems: &[ProblemId],
    config: &Config,
    exclusions: Option<&dyn PathResolver>,
) -> AppResult<FixReport> {
    let _ = config;

    let chosen = run.by_rule(problems);

    let tables = rules::bin_property_type::table::tables()
        .iter()
        .map(|table| table.build().to_string())
        .collect();
    let mut fix_run = FixRun::open(project_root, tables, exclusions).map_err(into_app_error)?;

    let mut failed = Vec::new();
    for rule in rules::all() {
        let Some(problems) = chosen.get(&rule.id()) else {
            continue;
        };
        // A rule that stops does not take the others with it, and the restore
        // point covers whatever the run had written by then.
        if let Err(error) = rule.fix(problems, &mut fix_run) {
            failed.push(error.to_string());
        }
    }

    let mut report = fix_run.finish().map_err(into_app_error)?;
    report.failed = failed;
    Ok(report)
}

/// Reverse one fix run.
///
/// Copies each file of the restore point back over its source and drops the
/// directory. An Undo does not re-run the rules: the panel's list is a fact
/// about files that just changed, so it goes stale and the next run refills it.
///
/// # Errors
///
/// Reports a stamp the project holds no restore point for, or a file that
/// could not be copied back.
pub fn undo_fix_run(project_root: &Path, stamp: &str) -> AppResult<UndoReport> {
    let name = normal_segment(stamp)
        .ok_or_else(|| AppError::ValidationFailed(format!("'{stamp}' is not a restore point")))?;
    let restore_dir = restore_root(project_root).join(name);
    if !restore_dir.is_dir() {
        return Err(AppError::ValidationFailed(format!(
            "This project holds no restore point '{stamp}'"
        )));
    }

    let copies = restore_dir.join(CONTENT_DIR);
    let mut restored = 0u32;
    if copies.is_dir() {
        for entry in walkdir::WalkDir::new(&copies).follow_links(false) {
            let entry = entry.map_err(|error| AppError::Io(io::Error::other(error.to_string())))?;
            if !entry.file_type().is_file() {
                continue;
            }

            let relative = entry
                .path()
                .strip_prefix(&copies)
                .map_err(|error| AppError::Other(error.to_string()))?;
            let destination = project_root.join(CONTENT_DIR).join(relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(entry.path(), &destination)?;
            restored += 1;
        }
    }

    fs::remove_dir_all(&restore_dir)?;
    Ok(UndoReport {
        stamp: stamp.to_owned(),
        restored,
    })
}

/// The restore points a project holds, newest first.
///
/// # Errors
///
/// Reports a `.ltk/restore/` that exists and cannot be read. A project with no
/// restore directory reports an empty list.
pub fn fix_runs(project_root: &Path) -> AppResult<Vec<FixRunSummary>> {
    let entries = match fs::read_dir(restore_root(project_root)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(AppError::Io(error)),
    };

    let mut runs = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }

        // The directory name is what an Undo joins, so it wins over the field.
        let stamp = entry.file_name().to_string_lossy().into_owned();
        match read_run_file(&entry.path()) {
            Ok(run) => runs.push(FixRunSummary {
                stamp,
                at: run.at,
                manager: run.manager,
                tables: run.tables,
                files: run.files.len() as u32,
                applied: run.files.iter().map(|file| file.applied).sum(),
            }),
            Err(error) => {
                tracing::warn!("Skipping a restore point that did not read, {stamp}: {error}");
            }
        }
    }

    runs.sort_by(|a, b| b.stamp.cmp(&a.stamp));
    Ok(runs)
}

/// Where a project keeps its restore points.
fn restore_root(project_root: &Path) -> PathBuf {
    project_root.join(".ltk").join("restore")
}

/// Make `<root>/<stamp>/`, and the `.gitignore` that keeps it out of a commit.
///
/// A run that opens inside a second another already claimed takes a suffix,
/// because two runs sharing one directory would let the second copy the first's
/// already-fixed bytes over the pristine ones.
fn make_restore_point(root: &Path, stamp: &str) -> io::Result<(String, PathBuf)> {
    fs::create_dir_all(root)?;

    let gitignore = root.join(".gitignore");
    if !gitignore.exists() {
        fs::write(&gitignore, "*\n")?;
    }

    let mut name = stamp.to_owned();
    let mut attempt = 1u32;
    loop {
        let dir = root.join(&name);
        match fs::create_dir(&dir) {
            Ok(()) => return Ok((name, dir)),
            Err(error)
                if error.kind() == io::ErrorKind::AlreadyExists && attempt < RUNS_IN_ONE_SECOND =>
            {
                attempt += 1;
                name = format!("{stamp}-{attempt}");
            }
            Err(error) => return Err(error),
        }
    }
}

/// Drop every restore point past [`KEPT_RESTORE_POINTS`], oldest first.
///
/// The stamp sorts lexicographically in time order, which is the whole reason
/// its format is shaped the way it is.
fn prune(restore_root: &Path) -> io::Result<()> {
    let mut stamps: Vec<PathBuf> = fs::read_dir(restore_root)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect();
    stamps.sort();

    let extra = stamps.len().saturating_sub(KEPT_RESTORE_POINTS);
    for old in stamps.iter().take(extra) {
        fs::remove_dir_all(old)?;
    }
    Ok(())
}

/// Read the `run.json` of one restore point.
fn read_run_file(restore_dir: &Path) -> AppResult<RunFile> {
    let bytes = fs::read(restore_dir.join(RUN_FILE))?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// One path segment as a plain name, or `None` for anything else.
///
/// Empty, `.`, `..` and anything naming a root or a drive all fail to be one
/// [`Component::Normal`].
fn normal_segment(segment: &str) -> Option<&OsStr> {
    let mut parts = Path::new(segment).components();
    match (parts.next(), parts.next()) {
        (Some(Component::Normal(name)), None) => Some(name),
        _ => None,
    }
}

fn file_error(layer: &str, path: &str, source: io::Error) -> FixError {
    FixError::File {
        layer: layer.to_owned(),
        path: path.to_owned(),
        source,
    }
}

/// The domain error a [`FixError`] reports as.
///
/// A restore point that could not be made keeps its `io` kind, because a
/// read-only project and a full disk are what a caller acts on differently.
fn into_app_error(error: FixError) -> AppError {
    match error {
        FixError::RestorePoint(ref source) => {
            AppError::Io(io::Error::new(source.kind(), error.to_string()))
        }
        other => AppError::Other(other.to_string()),
    }
}

/// The `run.json` one restore point holds.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunFile {
    stamp: String,
    at: DateTime<Utc>,
    /// The manager version that wrote it.
    manager: String,
    tables: Vec<String>,
    files: Vec<FileOutcome>,
}

/// What one fix run applied, skipped and wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct FixReport {
    /// The restore point this run wrote, which Undo names.
    pub stamp: String,
    pub applied: u32,
    /// Problems the file no longer matched, which the rules left alone.
    pub skipped: u32,
    /// Paths this run wrote into the mod's own tables before hashing them.
    pub names_kept: u32,
    pub files: Vec<FileOutcome>,
    /// A file a rule could not finish, and why.
    pub failed: Vec<String>,
}

/// What one fix run did to one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct FileOutcome {
    pub layer: String,
    /// POSIX-style and relative to the layer root.
    pub path: String,
    pub applied: u32,
    pub skipped: u32,
}

/// What one Undo restored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct UndoReport {
    pub stamp: String,
    pub restored: u32,
}

/// One restore point a project holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct FixRunSummary {
    pub stamp: String,
    #[cfg_attr(feature = "ts", ts(type = "string"))]
    pub at: DateTime<Utc>,
    /// The manager version that wrote it.
    pub manager: String,
    /// The migration tables the run applied.
    pub tables: Vec<String>,
    pub files: u32,
    pub applied: u32,
}

/// What stopped a fix.
#[derive(Debug, thiserror::Error)]
pub enum FixError {
    /// The restore point could not be made, so nothing was written.
    #[error("could not make a restore point: {0}")]
    RestorePoint(std::io::Error),

    /// One file could not be read or written.
    #[error("{layer}/{path}: {source}")]
    File {
        layer: String,
        path: String,
        source: std::io::Error,
    },

    /// A path that would leave the layer it names.
    #[error("{0} is not inside its layer")]
    Escapes(String),

    /// The rule could not read the file as the format it expects.
    #[error("{layer}/{path}: {message}")]
    Parse {
        layer: String,
        path: String,
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    use assert_matches::assert_matches;

    const BASE: &str = "base";
    const SKIN: &str = "data/characters/smolder/skins/skin0.bin";

    /// A project holding one layer file, which every test writes through.
    fn project(bytes: &[u8]) -> tempfile::TempDir {
        let project = tempfile::tempdir().expect("a temp dir");
        let file = source(project.path());
        fs::create_dir_all(file.parent().expect("a layer directory")).expect("the layer");
        fs::write(&file, bytes).expect("the file");
        project
    }

    fn source(project_root: &Path) -> PathBuf {
        project_root.join(CONTENT_DIR).join(BASE).join(SKIN)
    }

    fn open(project_root: &Path) -> FixRun<'static> {
        FixRun::open(project_root, vec!["16.17.8087655".to_owned()], None).expect("a restore point")
    }

    fn restore_point(project_root: &Path, stamp: &str) -> PathBuf {
        restore_root(project_root).join(stamp)
    }

    fn staged_copy(project_root: &Path, stamp: &str) -> PathBuf {
        restore_point(project_root, stamp)
            .join(CONTENT_DIR)
            .join(BASE)
            .join(SKIN)
    }

    #[test]
    fn opening_a_fix_run_makes_the_stamp_directory_and_a_gitignore() {
        let project = project(b"before");
        let run = open(project.path());

        assert!(restore_point(project.path(), run.stamp()).is_dir());
        assert_eq!(
            fs::read_to_string(restore_root(project.path()).join(".gitignore"))
                .expect("a .gitignore")
                .trim(),
            "*"
        );
    }

    #[test]
    fn a_read_reports_the_bytes_on_disk() {
        let project = project(b"before");
        let run = open(project.path());

        assert_eq!(run.read(BASE, SKIN).expect("the file"), b"before");
    }

    #[test]
    fn a_write_copies_the_original_into_the_restore_point_and_lands_the_new_bytes() {
        let project = project(b"before");
        let mut run = open(project.path());
        let stamp = run.stamp().to_owned();

        run.write(BASE, SKIN, b"after", 14, 0).expect("the write");

        assert_eq!(
            fs::read(source(project.path())).expect("the file"),
            b"after"
        );
        assert_eq!(
            fs::read(staged_copy(project.path(), &stamp)).expect("the copy"),
            b"before"
        );
    }

    /// The pristine copy is the only way back. A `File` does not name its path,
    /// so a restore point holding already-fixed bytes restores nothing.
    #[test]
    fn two_writes_to_one_file_keep_the_first_copy() {
        let project = project(b"before");
        let mut run = open(project.path());
        let stamp = run.stamp().to_owned();

        run.write(BASE, SKIN, b"once", 1, 0).expect("the write");
        run.write(BASE, SKIN, b"twice", 1, 0).expect("the write");

        assert_eq!(
            fs::read(source(project.path())).expect("the file"),
            b"twice"
        );
        assert_eq!(
            fs::read(staged_copy(project.path(), &stamp)).expect("the copy"),
            b"before"
        );
    }

    #[test]
    fn two_writes_to_one_file_read_as_one_row() {
        let project = project(b"before");
        let mut run = open(project.path());

        run.write(BASE, SKIN, b"once", 4, 1).expect("the write");
        run.write(BASE, SKIN, b"twice", 3, 2).expect("the write");
        let report = run.finish().expect("a report");

        assert_eq!(report.files.len(), 1);
        assert_eq!(report.applied, 7);
        assert_eq!(report.skipped, 3);
    }

    #[test]
    fn a_path_that_leaves_the_layer_is_rejected_and_writes_nothing() {
        let project = project(b"before");
        let mut run = open(project.path());

        assert_matches!(
            run.write(BASE, "../../escaped.bin", b"owned", 1, 0),
            Err(FixError::Escapes(_))
        );

        assert!(!project.path().join("escaped.bin").exists());
        assert!(
            !restore_point(project.path(), run.stamp())
                .join(CONTENT_DIR)
                .exists()
        );
        assert_eq!(
            fs::read(source(project.path())).expect("the file"),
            b"before"
        );
    }

    #[test]
    fn a_path_holding_a_current_directory_segment_is_rejected() {
        let project = project(b"before");
        let run = open(project.path());

        assert_matches!(
            run.read(BASE, "data/./characters/smolder/skins/skin0.bin"),
            Err(FixError::Escapes(_))
        );
    }

    /// Only a Windows path can name a root inside one segment. Splitting on
    /// `/` leaves a POSIX absolute path no segment to be absolute in.
    #[test]
    #[cfg(windows)]
    fn a_path_holding_an_absolute_segment_is_rejected() {
        let project = project(b"before");
        let mut run = open(project.path());

        assert_matches!(
            run.write(
                BASE,
                r"C:\Windows\System32\drivers\etc\hosts",
                b"owned",
                1,
                0
            ),
            Err(FixError::Escapes(_))
        );
        assert_matches!(
            run.read(BASE, r"\\server\share\skin0.bin"),
            Err(FixError::Escapes(_))
        );
    }

    #[test]
    fn a_layer_that_leaves_the_content_directory_is_rejected() {
        let project = project(b"before");
        let run = open(project.path());

        assert_matches!(run.read("..", SKIN), Err(FixError::Escapes(_)));
    }

    #[test]
    fn a_skipped_file_is_recorded_and_never_copied() {
        let project = project(b"before");
        let mut run = open(project.path());
        let stamp = run.stamp().to_owned();

        run.skipped(BASE, SKIN, 3);
        let report = run.finish().expect("a report");

        assert_eq!(
            report.files,
            vec![FileOutcome {
                layer: BASE.to_owned(),
                path: SKIN.to_owned(),
                applied: 0,
                skipped: 3,
            }]
        );
        assert_eq!(report.applied, 0);
        assert!(
            !restore_point(project.path(), &stamp)
                .join(CONTENT_DIR)
                .exists()
        );
    }

    #[test]
    fn a_write_leaves_no_temp_file_beside_the_file_it_wrote() {
        let project = project(b"before");
        let mut run = open(project.path());

        run.write(BASE, SKIN, b"after", 1, 0).expect("the write");

        let dir = source(project.path());
        let dir = dir.parent().expect("a layer directory");
        let names: Vec<_> = fs::read_dir(dir)
            .expect("the directory")
            .map(|entry| entry.expect("an entry").file_name())
            .collect();
        assert_eq!(names, vec![OsStr::new("skin0.bin")]);
    }

    #[test]
    fn finish_writes_a_run_json_that_fix_runs_reads_back() {
        let project = project(b"before");
        let mut run = open(project.path());

        run.write(BASE, SKIN, b"after", 14, 0).expect("the write");
        run.skipped(BASE, "data/characters/smolder/smolder.bin", 2);
        let report = run.finish().expect("a report");

        let runs = fix_runs(project.path()).expect("the restore points");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].stamp, report.stamp);
        assert_eq!(runs[0].manager, env!("CARGO_PKG_VERSION"));
        assert_eq!(runs[0].tables, vec!["16.17.8087655".to_owned()]);
        assert_eq!(runs[0].files, 2);
        assert_eq!(runs[0].applied, 14);
        assert!(runs[0].at <= Utc::now());
    }

    #[test]
    fn a_fourth_fix_run_prunes_the_oldest_and_leaves_three() {
        let project = project(b"before");

        let mut stamps = Vec::new();
        for _ in 0..4 {
            let run = open(project.path());
            stamps.push(run.stamp().to_owned());
            run.finish().expect("a report");
        }

        let kept = fix_runs(project.path()).expect("the restore points");
        assert_eq!(kept.len(), KEPT_RESTORE_POINTS);
        assert_eq!(kept[0].stamp, stamps[3]);
        assert!(!kept.iter().any(|run| run.stamp == stamps[0]));
        assert!(!restore_point(project.path(), &stamps[0]).exists());
    }

    #[test]
    fn a_project_with_no_restore_directory_holds_no_fix_runs() {
        let project = project(b"before");

        assert!(fix_runs(project.path()).expect("an empty list").is_empty());
    }

    #[test]
    fn fix_runs_skips_a_restore_point_that_does_not_read() {
        let project = project(b"before");
        open(project.path()).finish().expect("a report");

        let malformed = restore_point(project.path(), "2020-01-01T00-00-00Z");
        fs::create_dir_all(&malformed).expect("the directory");
        fs::write(malformed.join(RUN_FILE), "{ not json").expect("the file");
        fs::create_dir_all(restore_point(project.path(), "2020-01-02T00-00-00Z"))
            .expect("the directory");

        assert_eq!(
            fix_runs(project.path()).expect("the restore points").len(),
            1
        );
    }

    #[test]
    fn undo_puts_the_original_bytes_back_and_drops_the_restore_point() {
        let project = project(b"before");
        let mut run = open(project.path());
        run.write(BASE, SKIN, b"after", 1, 0).expect("the write");
        let report = run.finish().expect("a report");

        let undo = undo_fix_run(project.path(), &report.stamp).expect("the undo");

        assert_eq!(undo.restored, 1);
        assert_eq!(
            fs::read(source(project.path())).expect("the file"),
            b"before"
        );
        assert!(!restore_point(project.path(), &report.stamp).exists());
        assert!(
            fix_runs(project.path())
                .expect("the restore points")
                .is_empty()
        );
    }

    #[test]
    fn undo_of_a_stamp_the_project_does_not_hold_is_an_error() {
        let project = project(b"before");

        assert_matches!(
            undo_fix_run(project.path(), "2020-01-01T00-00-00Z"),
            Err(AppError::ValidationFailed(_))
        );
    }

    #[test]
    fn undo_of_a_stamp_that_leaves_the_restore_directory_is_an_error() {
        let project = project(b"before");
        let mut run = open(project.path());
        run.write(BASE, SKIN, b"after", 1, 0).expect("the write");
        let report = run.finish().expect("a report");

        for stamp in ["..", "../..", ".", ""] {
            assert_matches!(
                undo_fix_run(project.path(), stamp),
                Err(AppError::ValidationFailed(_))
            );
        }

        assert!(restore_point(project.path(), &report.stamp).is_dir());
        assert!(project.path().join(".ltk").is_dir());
        assert_eq!(
            fs::read(source(project.path())).expect("the file"),
            b"after"
        );
    }
}
