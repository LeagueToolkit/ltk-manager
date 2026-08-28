//! Applying the fixes a user chose.
//!
//! A `File` does not name its path. Once a fix has written the hash, the string
//! is gone from the file and no reader can derive it back, so a run keeps every
//! path it hashes in the project's own tables first - `preserve`. That is what
//! makes a repair lossless, and it is why there is no restore point: see
//! ADR-0006.
//!
//! Each file lands through a temp file in its own directory and then a rename.
//! A run that dies mid-way leaves whole files on both sides of it, and the ones
//! it finished read the same as if it had finished.

use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use ltk_wad::PathResolver;
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::error::{AppError, AppResult};

use super::preserve::PreservedNames;
use super::{NodeAddress, ProblemId, RuleId, Run, Site, rules};

/// The directory a project keeps its layers under.
const CONTENT_DIR: &str = "content";

/// One application of the fixes a user chose, and the writes it made.
///
/// A rule takes this and reads and writes through it, so keeping the names it
/// is about to hash away happens on the way past rather than as a step a rule
/// could forget.
#[derive(Debug)]
pub struct FixRun<'a> {
    project_root: PathBuf,
    tables: Vec<String>,
    files: Vec<FileOutcome>,
    kept: PreservedNames<'a>,
    /// Problems the rule still saw once it had finished writing.
    left: Vec<ProblemId>,
}

impl<'a> FixRun<'a> {
    /// Open a fix run over `project_root`.
    ///
    /// `exclusions` names what a reader resolves without the mod's help, in
    /// practice the community hashtables. A name it already holds is not
    /// embedded, and `None` embeds every name a fix hashes away.
    #[must_use]
    pub fn open(
        project_root: &Path,
        tables: Vec<String>,
        exclusions: Option<&'a dyn PathResolver>,
    ) -> Self {
        Self {
            project_root: project_root.to_path_buf(),
            tables,
            files: Vec::new(),
            kept: PreservedNames::open(project_root, exclusions),
            left: Vec::new(),
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

    /// Write `bytes` over one of the project's files.
    ///
    /// # Errors
    ///
    /// Reports a file that could not be written. The bytes land through a temp
    /// file and a rename, so a failure leaves the file as it was.
    pub fn write(
        &mut self,
        layer: &str,
        path: &str,
        bytes: &[u8],
        applied: u32,
        skipped: u32,
    ) -> Result<(), FixError> {
        let destination = self.resolve(layer, path)?;

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

    /// Write the kept names and report what the run did.
    ///
    /// # Errors
    ///
    /// Never fails. The result stays a `Result` because every caller already
    /// threads one, and because a rule's own failure arrives the same way.
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

        Ok(FixReport {
            applied,
            skipped,
            names_kept: names_kept as u32,
            tables: self.tables,
            files: self.files,
            remaining: self.left,
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
) -> AppResult<FixReport> {
    let _ = config;

    let chosen = run.by_rule(problems);

    let tables = rules::bin_property_type::table::tables()
        .iter()
        .map(|table| table.build().to_string())
        .collect();
    let mut fix_run = FixRun::open(project_root, tables, exclusions);

    let mut failed = Vec::new();
    for rule in rules::all() {
        let Some(problems) = chosen.get(&rule.id()) else {
            continue;
        };
        // A rule that stops does not take the others with it. What it had
        // already written stays written, and `FixReport::failed` is what tells
        // a caller its `remaining` does not cover the whole run.
        if let Err(error) = rule.fix(problems, &mut fix_run) {
            failed.push(error.to_string());
        }
    }

    let mut report = fix_run
        .finish()
        .map_err(|error| AppError::Other(error.to_string()))?;
    report.failed = failed;
    Ok(report)
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct FileOutcome {
    pub layer: String,
    /// POSIX-style and relative to the layer root.
    pub path: String,
    pub applied: u32,
    pub skipped: u32,
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
