//! Applying the fixes a user chose.
//!
//! A `File` does not name its path. Once a fix has written the hash, the string
//! is gone from the file and no reader can derive it back, so a run keeps every
//! path it hashes in the project's own tables first - `preserve`. That is what
//! makes a repair keep every name, and it is why there is no restore point:
//! see ADR-0006. Fidelity is a separate promise, and a per-rule one - ADR-0011.
//!
//! A run over a tree lands each file through a temp file in its own directory
//! and then a rename. A run that dies mid-way leaves whole files on both sides
//! of it, and the ones it finished read the same as if it had finished. A run
//! over an archive lands nothing: it holds every write for the edit that puts
//! them back - ADR-0025.

use fs_err as fs;
use std::cell::OnceCell;
use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use ltk_hashtable::{Hashtable, HashtableEntry};
use ltk_wad::PathResolver;
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::utils::fs::atomic_write;

use super::game::GameContent;
use super::pass::Fact;
use super::preserve::{KeptTable, PreservedNames};
use super::{
    Applied, BinNames, NodeAddress, Problem, ProblemId, ProjectFiles, RuleId, Run, Site, rules,
};

/// The directory a project keeps its layers under.
const CONTENT_DIR: &str = "content";

/// Where a run's reads come from and its writes go.
#[derive(Debug)]
enum Target {
    /// A project tree on disk, read and written in place.
    Tree(PathBuf),
    /// The files a check read where they lie, with every write held for the
    /// edit that puts it back.
    Held {
        project: ProjectFiles,
        /// Each written file's bytes, by layer and path.
        written: BTreeMap<(String, String), Arc<[u8]>>,
    },
}

/// One application of the fixes a user chose, and the writes it made.
///
/// A rule takes this and reads and writes through it, so keeping the names it
/// is about to hash away happens on the way past rather than as a step a rule
/// could forget.
#[derive(Debug)]
pub struct FixRun<'a> {
    target: Target,
    /// The tree's files, read on the first ask, for a run over a tree.
    tree: OnceCell<ProjectFiles>,
    tables: Vec<String>,
    files: Vec<FileOutcome>,
    kept: PreservedNames<'a>,
    /// Problems the rule still saw once it had finished writing.
    left: Vec<ProblemId>,
    config: Config,
    game: Option<Arc<dyn GameContent>>,
}

impl<'a> FixRun<'a> {
    /// Open a fix run over `project_root`.
    ///
    /// `exclusions` names what a reader resolves without the mod's help, in
    /// practice the community hashtables. A name it already holds is not
    /// embedded, and `None` embeds every name a fix hashes away.
    ///
    /// `config` and `game` are what a rule re-derives against, because a repair
    /// derives its changes again rather than replaying what a check recorded,
    /// and one of them is a question about the installed game.
    #[must_use]
    pub fn open(
        project_root: &Path,
        tables: Vec<String>,
        exclusions: Option<&'a dyn PathResolver>,
        config: Config,
        game: Option<Arc<dyn GameContent>>,
    ) -> Self {
        Self {
            target: Target::Tree(project_root.to_path_buf()),
            tree: OnceCell::new(),
            tables,
            files: Vec::new(),
            kept: PreservedNames::open(project_root, exclusions),
            left: Vec::new(),
            config,
            game,
        }
    }

    /// Open a fix run over `project`, the files a check read where they lie.
    ///
    /// Nothing reaches the disk. Every write is held, and
    /// [`finish_held`](Self::finish_held) hands them back for the edit that
    /// puts them into the archive. `declared` is the mod's own tables, read out
    /// of the same archive, for the names the run keeps to merge into. The rest
    /// is as for [`open`](Self::open).
    #[must_use]
    pub fn held(
        project: ProjectFiles,
        declared: Vec<(HashtableEntry, Hashtable)>,
        tables: Vec<String>,
        exclusions: Option<&'a dyn PathResolver>,
        config: Config,
        game: Option<Arc<dyn GameContent>>,
    ) -> Self {
        Self {
            target: Target::Held {
                project,
                written: BTreeMap::new(),
            },
            tree: OnceCell::new(),
            tables,
            files: Vec::new(),
            kept: PreservedNames::over(declared, exclusions),
            left: Vec::new(),
            config,
            game,
        }
    }

    /// Record a problem the rule still saw after it had applied what it could.
    ///
    /// The rule re-checks what it wrote, in memory, before the bytes leave it.
    /// What that check still objects to is what the mod is, so a caller
    /// summarizing the repair reads this rather than analyzing the project
    /// again.
    pub fn left(
        &mut self,
        rule: RuleId,
        layer: &str,
        path: &str,
        entry: ltk_hash::BinHash,
        node: String,
    ) {
        let site = Site::node(
            layer,
            path,
            NodeAddress {
                entry,
                path: node,
                label: None,
            },
        );
        self.left.push(ProblemId::new(rule, &site));
    }

    /// Where the mod is: a tree's root, or the archive it is stored as.
    #[must_use]
    pub fn root(&self) -> &Path {
        match &self.target {
            Target::Tree(root) => root,
            Target::Held { project, .. } => project.root(),
        }
    }

    /// The mod as this run has left it so far.
    ///
    /// A rule re-derives a claim about the rest of the mod from this rather
    /// than from what the check recorded, and reads here what an earlier rule
    /// of the same run wrote. A tree is read on the first ask.
    ///
    /// # Errors
    ///
    /// Reports a tree whose content directory cannot be read.
    pub fn project(&self) -> AppResult<&ProjectFiles> {
        match &self.target {
            Target::Held { project, .. } => Ok(project),
            Target::Tree(root) => {
                if let Some(files) = self.tree.get() {
                    return Ok(files);
                }
                let files = ProjectFiles::read(root, &self.config, self.game.clone())?;
                Ok(self.tree.get_or_init(|| files))
            }
        }
    }

    /// One fact over the mod as this run has left it, in a bin round of its
    /// own.
    ///
    /// # Errors
    ///
    /// The same as [`project`](Self::project).
    pub fn fact<F: Fact>(&self) -> AppResult<F> {
        Ok(self.project()?.fact::<F>())
    }

    /// The names a row can give the hashes the mod's bins hold.
    ///
    /// Shared rather than borrowed, so a rule holds them across its writes.
    #[must_use]
    pub fn names(&self) -> Arc<BinNames> {
        match &self.target {
            Target::Held { project, .. } => project.names_shared(),
            Target::Tree(root) => match self.project() {
                Ok(project) => project.names_shared(),
                Err(e) => {
                    tracing::debug!(
                        "Naming {}'s hashes from its tables alone, since its content would not read: {e}",
                        root.display()
                    );
                    Arc::new(BinNames::open(root))
                }
            },
        }
    }

    /// The settings this run was started under.
    #[must_use]
    pub fn config(&self) -> &Config {
        &self.config
    }

    /// What the installed game holds, where there is an install to ask.
    ///
    /// See [`ProjectFiles::game`](crate::problems::ProjectFiles::game) for the
    /// `None`.
    #[must_use]
    pub fn game(&self) -> Option<Arc<dyn GameContent>> {
        self.game.clone()
    }

    /// The names this run keeps, for a rule about to hash one away.
    ///
    /// A rule asks before it converts, and leaves the property alone where the
    /// answer is [`Preserved::Collides`](super::preserve::Preserved::Collides).
    pub fn kept_names(&mut self) -> &mut PreservedNames<'a> {
        &mut self.kept
    }

    /// The bytes of one file, as the run has left it.
    ///
    /// Off the disk for a tree, and off the archive, or off what an earlier
    /// rule of this run wrote, for a run that holds its writes. A rule
    /// re-derives every change from this rather than from what the check
    /// recorded, so a file changed in another tool cannot be written wrong.
    ///
    /// # Errors
    ///
    /// Reports a file that cannot be read, or a path that escapes the layer.
    pub fn read(&self, layer: &str, path: &str) -> Result<Vec<u8>, FixError> {
        match &self.target {
            Target::Tree(root) => {
                let source = resolve_in(root, layer, path)?;
                fs::read(&source).map_err(|error| file_error(layer, path, error))
            }
            Target::Held { project, .. } => {
                let handle = project
                    .file(layer, path)
                    .ok_or_else(|| file_error(layer, path, io::ErrorKind::NotFound.into()))?;
                handle
                    .bytes()
                    .map_err(|message| file_error(layer, path, io::Error::other(message)))
            }
        }
    }

    /// Write `bytes` over one of the project's files.
    ///
    /// # Errors
    ///
    /// Reports a file that could not be written. Over a tree the bytes land
    /// through a temp file and a rename, so a failure leaves the file as it
    /// was. A run that holds its writes refuses a file the mod does not list.
    pub fn write(
        &mut self,
        layer: &str,
        path: &str,
        bytes: &[u8],
        applied: u32,
        skipped: u32,
    ) -> Result<(), FixError> {
        match &mut self.target {
            Target::Tree(root) => {
                let destination = resolve_in(root, layer, path)?;
                atomic_write(&destination, bytes)
                    .map_err(|error| file_error(layer, path, error))?;
            }
            Target::Held { project, written } => {
                let bytes: Arc<[u8]> = Arc::from(bytes);
                if !project.wrote(layer, path, Arc::clone(&bytes)) {
                    return Err(file_error(layer, path, io::ErrorKind::NotFound.into()));
                }
                written.insert((layer.to_owned(), path.to_owned()), bytes);
            }
        }

        self.record(layer, path, applied, skipped, FileChange::Written);
        Ok(())
    }

    /// Delete one of the project's files.
    ///
    /// Through the same check a write goes through, so a removal cannot leave
    /// its layer either.
    ///
    /// # Errors
    ///
    /// Reports a file that could not be deleted, or a path that escapes the
    /// layer.
    pub fn remove(&mut self, layer: &str, path: &str, applied: u32) -> Result<(), FixError> {
        match &mut self.target {
            Target::Tree(root) => {
                let target = resolve_in(root, layer, path)?;
                fs::remove_file(&target).map_err(|error| file_error(layer, path, error))?;
                if let Some(files) = self.tree.get_mut() {
                    files.dropped(layer, path);
                }
            }
            Target::Held { project, written } => {
                if !project.dropped(layer, path) {
                    return Err(file_error(layer, path, io::ErrorKind::NotFound.into()));
                }
                written.remove(&(layer.to_owned(), path.to_owned()));
            }
        }

        self.record(layer, path, applied, 0, FileChange::Removed);
        Ok(())
    }

    /// Record a file the rule read and left alone.
    pub fn skipped(&mut self, layer: &str, path: &str, skipped: u32) {
        self.record(layer, path, 0, skipped, FileChange::Written);
    }

    /// Record every one of `problems` as skipped, for a rule that derives no repair for them.
    pub fn skip_all(&mut self, problems: &[&Problem]) -> Applied {
        for problem in problems {
            self.skipped(&problem.site.layer, &problem.site.path, 1);
        }

        Applied {
            applied: 0,
            skipped: u32::try_from(problems.len()).unwrap_or(u32::MAX),
        }
    }

    /// Repair each of `problems` in its own file through `repair`, which writes or removes
    /// that file and answers whether it did. A file it leaves alone is recorded as skipped.
    ///
    /// # Errors
    ///
    /// Stops at the first error `repair` reports.
    pub fn per_file(
        &mut self,
        problems: &[&Problem],
        mut repair: impl FnMut(&mut Self, &str, &str) -> Result<bool, FixError>,
    ) -> Result<Applied, FixError> {
        let mut applied = Applied::default();

        for problem in problems {
            let (layer, path) = (&problem.site.layer, &problem.site.path);
            if repair(self, layer, path)? {
                applied.applied += 1;
            } else {
                applied.skipped += 1;
                self.skipped(layer, path, 1);
            }
        }

        Ok(applied)
    }

    /// Write the kept names and report what the run did.
    ///
    /// For a run over a tree. A run that holds its writes finishes through
    /// [`finish_held`](Self::finish_held).
    ///
    /// # Errors
    ///
    /// Never fails. The result stays a `Result` because every caller already
    /// threads one, and because a rule's own failure arrives the same way.
    pub fn finish(self) -> Result<FixReport, FixError> {
        // Best-effort, and after the bins: a table that could not be written
        // costs the mod its names, and refusing the repair over it would leave
        // the mod broken as well as unnamed.
        let names_kept = match self.kept.write() {
            Ok(kept) => kept,
            Err(error) => {
                tracing::warn!(
                    "Repaired {} but could not keep its names: {error}",
                    self.root().display()
                );
                0
            }
        };

        let Self {
            tables,
            files,
            left,
            ..
        } = self;
        Ok(report(files, tables, left, names_kept))
    }

    /// Report what the run did, and hand back what it holds for the edit.
    ///
    /// For a run opened by [`held`](Self::held). The kept names come back
    /// merged into the mod's own table rather than written anywhere.
    ///
    /// # Errors
    ///
    /// Reports a run opened over a tree, whose writes have already landed, and
    /// a kept name the table grammar refuses.
    pub fn finish_held(self) -> AppResult<(FixReport, HeldWrites)> {
        let table = self.kept.merged()?;
        let names_kept = table.as_ref().map_or(0, |_| self.kept.added());

        let Self {
            target,
            tables,
            files,
            left,
            ..
        } = self;
        let written = match target {
            Target::Held { written, .. } => written,
            Target::Tree(root) => {
                return Err(AppError::Other(format!(
                    "{} was repaired in its tree, so there is nothing held to hand back",
                    root.display()
                )));
            }
        };

        Ok((
            report(files, tables, left, names_kept),
            HeldWrites {
                files: written,
                table,
            },
        ))
    }

    /// Add to what this run has done to one file.
    ///
    /// One row for each file, so a rule that comes back to a file twice still
    /// reads as the one file it changed.
    fn record(&mut self, layer: &str, path: &str, applied: u32, skipped: u32, change: FileChange) {
        if let Some(outcome) = self
            .files
            .iter_mut()
            .find(|outcome| outcome.layer == layer && outcome.path == path)
        {
            outcome.applied += applied;
            outcome.skipped += skipped;
            // A removal is the last thing that can happen to a file, so it is
            // what the row says however it was reached.
            if change == FileChange::Removed {
                outcome.change = FileChange::Removed;
            }
            return;
        }

        self.files.push(FileOutcome {
            layer: layer.to_owned(),
            path: path.to_owned(),
            applied,
            skipped,
            change,
        });
    }
}

/// What a run over an archive wrote, held for the edit that puts it back.
#[derive(Debug, Default)]
pub struct HeldWrites {
    /// Each written file's bytes, by layer and path.
    files: BTreeMap<(String, String), Arc<[u8]>>,
    /// The mod's game table with the kept names merged in, where the run kept
    /// any.
    table: Option<KeptTable>,
}

impl HeldWrites {
    /// The bytes the run wrote over `path` of `layer`, or `None` where it
    /// wrote none.
    #[must_use]
    pub fn bytes(&self, layer: &str, path: &str) -> Option<&[u8]> {
        self.files
            .get(&(layer.to_owned(), path.to_owned()))
            .map(|bytes| &bytes[..])
    }

    /// The mod's game table with the kept names merged in, where the run kept
    /// any.
    #[must_use]
    pub fn table(&self) -> Option<&KeptTable> {
        self.table.as_ref()
    }
}

/// What the run did, summed over its files.
fn report(
    files: Vec<FileOutcome>,
    tables: Vec<String>,
    remaining: Vec<ProblemId>,
    names_kept: usize,
) -> FixReport {
    FixReport {
        applied: files.iter().map(|file| file.applied).sum(),
        skipped: files.iter().map(|file| file.skipped).sum(),
        names_kept: names_kept as u32,
        tables,
        remaining,
        files,
        failed: Vec::new(),
    }
}

/// Resolve a layer-relative path to somewhere the layer under `root` genuinely
/// holds.
///
/// The same check as `workshop::layers::resolve_in_layer`, which is private
/// to its own module. Every segment has to be one plain name, which rejects
/// `..` and an absolute segment before anything reaches the disk, and the
/// directory the file sits in is then canonicalized and checked against the
/// layer - which is what a symlink partway down the path cannot get past.
fn resolve_in(root: &Path, layer: &str, path: &str) -> Result<PathBuf, FixError> {
    let escapes = || FixError::Escapes(format!("{layer}/{path}"));

    let layer_dir = root
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
    let layer_dir = fs::canonicalize(&layer_dir).map_err(|error| file_error(layer, path, error))?;
    if !parent.starts_with(layer_dir) {
        return Err(escapes());
    }

    Ok(target)
}

/// Apply the fixes of the named problems.
///
/// Every scope is this one call. Fix on a row, Fix on a group and Fix on the
/// panel differ only in the list they pass.
///
/// # Errors
///
/// Reports a project that cannot be opened. A rule that fails on one file is
/// reported inside the [`FixReport`].
pub fn apply(
    project_root: &Path,
    run: &Run,
    problems: &[ProblemId],
    config: &Config,
    exclusions: Option<&dyn PathResolver>,
    game: Option<Arc<dyn GameContent>>,
) -> AppResult<FixReport> {
    let mut fix_run = FixRun::open(
        project_root,
        migration_tables(),
        exclusions,
        config.clone(),
        game,
    );
    let failed = fix_each(&mut fix_run, run, problems);
    let mut report = fix_run
        .finish()
        .map_err(|error| AppError::Other(error.to_string()))?;
    report.failed = failed;
    Ok(report)
}

/// [`apply`] over the files a check read where they lie, with every write held
/// for the edit that puts it back.
///
/// `declared` is the mod's own tables, read out of the same archive, for the
/// names the run keeps to merge into - ADR-0006.
///
/// # Errors
///
/// Reports a kept name the table grammar refuses. A rule that fails on one
/// file is reported inside the [`FixReport`].
pub fn apply_held(
    project: ProjectFiles,
    declared: Vec<(HashtableEntry, Hashtable)>,
    run: &Run,
    problems: &[ProblemId],
    config: &Config,
    exclusions: Option<&dyn PathResolver>,
    game: Option<Arc<dyn GameContent>>,
) -> AppResult<(FixReport, HeldWrites)> {
    let mut fix_run = FixRun::held(
        project,
        declared,
        migration_tables(),
        exclusions,
        config.clone(),
        game,
    );
    let failed = fix_each(&mut fix_run, run, problems);
    let (mut report, held) = fix_run.finish_held()?;
    report.failed = failed;
    Ok((report, held))
}

/// The migration tables a run applies, by name.
fn migration_tables() -> Vec<String> {
    rules::bin_property_type::table::tables()
        .iter()
        .map(|table| table.build().to_string())
        .collect()
}

/// Run every rule's fix over its share of `problems`, and name the rules that
/// stopped.
fn fix_each(fix_run: &mut FixRun<'_>, run: &Run, problems: &[ProblemId]) -> Vec<String> {
    let chosen = run.by_rule(problems);

    let mut failed = Vec::new();
    for rule in rules::all() {
        let Some(problems) = chosen.get(&rule.id()) else {
            continue;
        };
        // A rule that stops does not take the others with it. What it had
        // already written stays written, and `FixReport::failed` is what tells
        // a caller its `remaining` does not cover the whole run.
        if let Err(error) = rule.fix(problems, fix_run) {
            failed.push(error.to_string());
        }
    }
    failed
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

/// What one fix run applied, skipped and wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct FixReport {
    pub applied: u32,
    /// Problems the file no longer matched, which the rules left alone.
    pub skipped: u32,
    /// Paths this run wrote into the mod's own tables before hashing them.
    pub names_kept: u32,
    /// The migration tables the run applied.
    pub tables: Vec<String>,
    /// The named problems a re-check still saw once the run had written.
    ///
    /// Read off the repaired tree in memory rather than by analyzing the
    /// project a second time. Empty is the ordinary outcome.
    pub remaining: Vec<ProblemId>,
    pub files: Vec<FileOutcome>,
    /// A file a rule could not finish, and why.
    pub failed: Vec<String>,
}

/// What one fix run did to one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct FileOutcome {
    pub layer: String,
    /// POSIX-style and relative to the layer root.
    pub path: String,
    pub applied: u32,
    pub skipped: u32,
    /// Whether the file is still there.
    ///
    /// Defaulted for a report recorded before a repair could delete anything,
    /// which is every report written before this field existed.
    #[serde(default)]
    pub change: FileChange,
}

/// What one fix run did to a file, as against how much of it.
///
/// The counts beside this say how much a rule changed. This says whether the
/// file survived, which is what an archive edit has to know before it can state
/// the repair as a chunk write.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum FileChange {
    #[default]
    Written,
    Removed,
}

/// What stopped a fix.
#[derive(Debug, thiserror::Error)]
pub enum FixError {
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
mod tests;
