//! Per "Ignore rules" in docs/ux/PROJECT_EDITOR.md.

use super::{ProjectDir, WorkshopError};
use crate::error::{AppError, AppResult, Utf8PathExt, Utf8PathRefExt};
use camino::{Utf8Path, Utf8PathBuf};
use chrono::NaiveDate;
use fs_err as fs;
use ltk_mod_project::{MODIGNORE_FILE_NAME, ModIgnore, ModIgnoreError};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

/// The starter rules a new project and an archive import are given.
///
/// Every entry is a source format or an editor file no game path uses, which
/// section 5 of `docs/research/modignore-in-project-editor.md` proves per
/// entry. The header is the teaching material, so it travels with the rules.
pub const RECOMMENDED_IGNORE_RULES: &str = include_str!("default.modignore");

/// One `.modignore` of a project, as the editor reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct IgnoreRules {
    /// Absolute path of the file, whether or not one exists.
    pub path: String,
    /// The file's text, null when the file does not exist.
    pub text: Option<String>,
    /// Recommended patterns the file lacks, in the order the default lists them.
    ///
    /// Empty for anything but the root file, whose anchor the default assumes.
    pub missing_recommended: Vec<String>,
}

/// The line of a `.modignore` buffer the matcher cannot compile.
///
/// Reaches the frontend as [`WorkshopError::IgnoreRulePattern`] rather than in
/// its own right, because the only buffer it answers for is one a save
/// refused.
#[derive(Debug, Clone, PartialEq, Eq)]
struct IgnoreRuleProblem {
    /// One-based line number, as the gutter counts.
    line: u32,
    /// What the matcher says is wrong with the pattern.
    message: String,
}

impl ProjectDir {
    /// The project's root `.modignore`, whether or not it exists.
    pub fn ignore_file(&self) -> PathBuf {
        self.path().join(MODIGNORE_FILE_NAME)
    }

    /// The `.modignore` at project-relative `at`, or the root file for `None`.
    ///
    /// # Errors
    ///
    /// [`AppError::InvalidPath`] for anything that is not a `.modignore`
    /// inside the project, which is what an editor can ask for by path.
    fn ignore_file_at(&self, at: Option<&str>) -> AppResult<PathBuf> {
        let Some(at) = at else {
            return Ok(self.ignore_file());
        };

        let inside = contained_ignore_path(at)
            .ok_or_else(|| AppError::InvalidPath(format!("{at} is not a {MODIGNORE_FILE_NAME}")))?;
        Ok(self.path().join(inside))
    }

    /// Read one of the project's `.modignore` files.
    ///
    /// # Errors
    ///
    /// [`AppError::Io`] when the file exists and cannot be read, and whatever
    /// `ignore_file_at` refuses. A file that does not exist is not an error.
    pub fn ignore_rules(&self, at: Option<&str>) -> AppResult<IgnoreRules> {
        let path = self.ignore_file_at(at)?;
        let text = match fs::read_to_string(&path) {
            Ok(text) => Some(text),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };

        Ok(IgnoreRules {
            path: path.display().to_string(),
            missing_recommended: match at {
                None => missing_recommended_rules(text.as_deref().unwrap_or_default()),
                Some(_) => Vec::new(),
            },
            text,
        })
    }

    /// Write `text` over one of the project's `.modignore` files.
    ///
    /// # Errors
    ///
    /// [`WorkshopError::IgnoreRulePattern`] when a line does not compile, in
    /// which case nothing is written: one bad pattern fails the whole pack, so
    /// it must not reach disk.
    pub fn write_ignore_rules(&self, at: Option<&str>, text: &str) -> AppResult<IgnoreRules> {
        let path = self.ignore_file_at(at)?;
        if let Some(problem) = ignore_rule_problem(text) {
            return Err(WorkshopError::IgnoreRulePattern {
                line: problem.line,
                message: problem.message,
            }
            .into());
        }

        fs::write(path, text)?;
        self.ignore_rules(at)
    }

    /// The rules a pack of this project filters through.
    ///
    /// # Errors
    ///
    /// Whatever the pack itself would raise: [`AppError::InvalidPath`] for a
    /// project path no archive format stores,
    /// [`WorkshopError::PackIgnorePattern`] for a pattern the matcher refuses,
    /// and [`AppError::PackFailed`] for a `.modignore` that cannot be read.
    pub(crate) fn ignore_filter(&self) -> AppResult<ModIgnore> {
        let root = self.path().try_as_utf8("project path")?;
        ModIgnore::load(root).map_err(|error| ignore_error(error, root))
    }

    /// Append the recommended patterns the file lacks, dated `today`.
    ///
    /// A project with no file gets the whole default instead, so the action
    /// reads the same either way.
    ///
    /// # Errors
    ///
    /// Whatever [`write_ignore_rules`](Self::write_ignore_rules) fails on,
    /// which a file the creator has already broken reaches.
    pub fn add_recommended_ignore_rules(&self, today: NaiveDate) -> AppResult<IgnoreRules> {
        let current = self.ignore_rules(None)?;
        let Some(text) = current.text else {
            return self.write_ignore_rules(None, RECOMMENDED_IGNORE_RULES);
        };

        self.write_ignore_rules(None, &with_recommended_rules(&text, today))
    }

    /// Write the recommended rules, leaving a file that already exists alone.
    ///
    /// A project that predates the feature is offered the default in the
    /// document rather than written to behind its author's back, so only a
    /// project this side just created reaches here.
    pub(crate) fn write_default_ignore_rules(&self) -> AppResult<()> {
        let path = self.ignore_file();
        if path.exists() {
            return Ok(());
        }

        fs::write(path, RECOMMENDED_IGNORE_RULES)?;
        Ok(())
    }
}

/// `relative` as a path under a project root, or `None` for anything else.
///
/// A path reaching here came off the wire, so it is rebuilt from its ordinary
/// components alone: `..`, a root and a drive prefix all answer `None`, and so
/// does a name the project's tooling does not read as rules.
fn contained_ignore_path(relative: &str) -> Option<PathBuf> {
    let mut inside = PathBuf::new();
    for component in Path::new(relative).components() {
        let Component::Normal(part) = component else {
            return None;
        };
        inside.push(part);
    }

    (inside.file_name()? == MODIGNORE_FILE_NAME).then_some(inside)
}

/// A refused `.modignore` pattern as the frontend reads it, with its line.
///
/// The file is named relative to `project_root`, the form the creator knows it
/// by. Every other failure keeps the crate's own rendering.
pub(super) fn ignore_error(error: ModIgnoreError, project_root: &Utf8Path) -> AppError {
    let ModIgnoreError::Pattern { path, source } = &error else {
        return AppError::PackFailed(error.to_string());
    };

    let rendered = source.to_string();
    let (line, message) = split_line_prefix(&rendered).unwrap_or((1, rendered.as_str()));

    WorkshopError::PackIgnorePattern {
        path: project_relative(path, project_root),
        line,
        message: message.to_string(),
    }
    .into()
}

/// `path` under `base`, forward-slashed so both platforms read alike.
pub(super) fn project_relative(path: &Utf8Path, base: &Utf8Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .as_str()
        .replace('\\', "/")
}

/// The first line of `text` the matcher cannot compile.
///
/// Reads the buffer alone. [`ModIgnore::parse`] also discovers the nested
/// files under `content/`, which an editor of the root file is not editing and
/// must not be held up by, so the buffer is compiled against a root that is
/// not on disk.
fn ignore_rule_problem(text: &str) -> Option<IgnoreRuleProblem> {
    let Err(error) = ModIgnore::parse(&unwritten_root(), text) else {
        return None;
    };

    let rendered = match &error {
        ModIgnoreError::Pattern { source, .. } => source.to_string(),
        /* The root does not exist, so nothing is read and no other variant can
        arise. Reported rather than dropped, because a swallowed error would
        pass a buffer the pack then refuses. */
        other => other.to_string(),
    };

    let (line, message) = split_line_prefix(&rendered).unwrap_or((1, rendered.as_str()));

    Some(IgnoreRuleProblem {
        line,
        message: message.to_string(),
    })
}

/// The recommended patterns `text` does not already hold, comments aside.
fn missing_recommended_rules(text: &str) -> Vec<String> {
    let held: Vec<&str> = patterns_of(text).collect();

    patterns_of(RECOMMENDED_IGNORE_RULES)
        .filter(|pattern| !held.contains(pattern))
        .map(ToOwned::to_owned)
        .collect()
}

/// `text` with the recommended patterns it lacks appended, dated `today`.
fn with_recommended_rules(text: &str, today: NaiveDate) -> String {
    let missing = missing_recommended_rules(text);
    if missing.is_empty() {
        return text.to_string();
    }

    let mut out = text.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if !out.is_empty() {
        out.push('\n');
    }

    out.push_str(&format!("# Added {today}\n"));
    for pattern in missing {
        out.push_str(&pattern);
        out.push('\n');
    }

    out
}

/// The pattern lines of `text`, without its comments or its blank lines.
fn patterns_of(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
}

/// `line {n}: {message}`, as `ignore::Error::WithLineNumber` renders itself.
///
/// The rendering is the only place the line is: `ignore::Error` implements no
/// `source`. The line travels in its own field, so the prefix is dropped rather
/// than shown twice.
pub(super) fn split_line_prefix(rendered: &str) -> Option<(u32, &str)> {
    let (number, message) = rendered.strip_prefix("line ")?.split_once(": ")?;
    Some((number.parse().ok()?, message))
}

/// A project root that is not on disk, so no nested `.modignore` is read.
///
/// Named freshly each call rather than fixed, because a fixed name under a
/// world-writable temporary directory is a name something else can create, and
/// a stray file under it would block every save citing a file no creator has.
fn unwritten_root() -> Utf8PathBuf {
    std::env::temp_dir()
        .try_into_utf8("temporary directory")
        .unwrap_or_else(|_| Utf8PathBuf::from("."))
        .join(format!("ltk-manager-unwritten-{}", uuid::Uuid::new_v4()))
}

#[cfg(test)]
mod tests;
