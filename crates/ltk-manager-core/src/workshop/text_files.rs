//! Per "The readme" in docs/ux/PROJECT_EDITOR.md.

use super::{ProjectDir, WorkshopError};
use crate::error::{AppResult, Utf8PathRefExt};
use fs_err as fs;
use ltk_mod_project::{LICENSE_FILE_NAMES, find_license_file};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The file name a project's readme is written under.
pub const README_FILE_NAME: &str = "README.md";

/// A text file a project keeps at its root, beside `content/`.
///
/// Naming the files rather than taking a path is what keeps a command that
/// writes into a project from being addressable at an arbitrary one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum ProjectTextFile {
    /// The long description a package carries, in Markdown.
    Readme,
    /// The terms the mod is shared under, which both pack formats ship.
    License,
}

/// One of a project's root text files, as the editor reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ProjectText {
    /// Absolute path of the file, whether or not one exists.
    pub path: String,
    /// The file's text, null where no file exists or its bytes are not UTF-8.
    pub text: Option<String>,
    /// Whether a file that exists decoded. A file that did not is read-only.
    pub readable: bool,
    /// What the file was when it was read, null where no file exists.
    pub revision: Option<Revision>,
}

/// What a file was when it was read, so a save can tell it has not moved.
///
/// Modification time and size rather than a hash of the bytes: one `stat`
/// answers it, and prose a person typed does not change back into the same
/// length within the same millisecond.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    /// Milliseconds since the Unix epoch, or 0 where the platform has no time.
    pub modified_ms: i64,
    pub size: u64,
}

/// How a file separates its lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LineEnding {
    Lf,
    CrLf,
}

impl LineEnding {
    /// The ending most of `bytes` already uses, defaulting to `\n`.
    fn of(bytes: &[u8]) -> Self {
        let lines = bytes.iter().filter(|byte| **byte == b'\n').count();
        let carried = bytes.windows(2).filter(|pair| pair == b"\r\n").count();

        /* A file mixing both keeps the ending it mostly has, so one stray line
        from another editor does not rewrite every other line. */
        if carried * 2 >= lines && carried > 0 {
            Self::CrLf
        } else {
            Self::Lf
        }
    }

    /// `text`, whose lines end in `\n`, written the way this ending spells it.
    fn apply(self, text: &str) -> String {
        let flat = text.replace("\r\n", "\n");
        match self {
            Self::Lf => flat,
            Self::CrLf => flat.replace('\n', "\r\n"),
        }
    }
}

impl ProjectDir {
    /// Where one of the project's root text files lives, existing or not.
    ///
    /// A license is matched the way the packer matches it, so `license.txt`
    /// written on Windows is the file the editor opens on Linux. A project
    /// with none is offered the first of [`LICENSE_FILE_NAMES`].
    pub fn text_file_path(&self, file: ProjectTextFile) -> PathBuf {
        match file {
            ProjectTextFile::Readme => self.path().join(README_FILE_NAME),
            ProjectTextFile::License => self
                .path()
                .try_as_utf8("project path")
                .ok()
                .and_then(|root| find_license_file(root))
                .map(|found| found.into_std_path_buf())
                .unwrap_or_else(|| self.path().join(LICENSE_FILE_NAMES[0])),
        }
    }

    /// Read one of the project's root text files.
    ///
    /// # Errors
    ///
    /// [`AppError::Io`] when the file exists and cannot be read. A file that
    /// does not exist is not an error, and neither is one whose bytes are not
    /// UTF-8, which reports `readable: false` for a document to refuse to edit.
    ///
    /// [`AppError::Io`]: crate::error::AppError::Io
    pub fn project_text(&self, file: ProjectTextFile) -> AppResult<ProjectText> {
        let path = self.text_file_path(file);
        let bytes = match fs::read(&path) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };

        let (text, readable) = match &bytes {
            None => (None, true),
            Some(bytes) => match std::str::from_utf8(bytes) {
                Ok(text) => (Some(text.to_owned()), true),
                Err(_) => (None, false),
            },
        };

        Ok(ProjectText {
            path: path.display().to_string(),
            text,
            readable,
            revision: revision_of(&path),
        })
    }

    /// Write `text` over one of the project's root text files.
    ///
    /// `expected` is what the caller last read the file as, and a file that no
    /// longer matches it is refused rather than overwritten. `None` writes
    /// whatever is there, which is how a caller that has resolved a conflict,
    /// or one writing a file that did not exist, asks.
    ///
    /// The file's own line ending survives, because a buffer arrives with the
    /// `\n` a textarea gives it and rewriting every line of a CRLF file is a
    /// diff its author did not make.
    ///
    /// # Errors
    ///
    /// [`WorkshopError::TextFileChanged`] when the file moved under the
    /// caller, and [`AppError::Io`] when the write fails.
    ///
    /// [`AppError::Io`]: crate::error::AppError::Io
    pub fn write_project_text(
        &self,
        file: ProjectTextFile,
        text: &str,
        expected: Option<Revision>,
    ) -> AppResult<ProjectText> {
        let path = self.text_file_path(file);

        if let Some(expected) = expected
            && revision_of(&path) != Some(expected)
        {
            return Err(WorkshopError::TextFileChanged {
                path: path.display().to_string(),
            }
            .into());
        }

        let ending = match fs::read(&path) {
            Ok(bytes) => LineEnding::of(&bytes),
            Err(_) => LineEnding::Lf,
        };

        write_atomically(&path, ending.apply(text).as_bytes())?;
        self.project_text(file)
    }
}

/// Write the readme a new project starts with, leaving any file alone.
///
/// The display name under a heading and nothing else. A skeleton of empty
/// sections would ship to every player of a mod whose author never opened the
/// document, and the description is a field of its own rather than the first
/// line of this one.
///
/// # Errors
///
/// [`AppError::Io`] when the file cannot be written.
///
/// [`AppError::Io`]: crate::error::AppError::Io
pub(crate) fn write_default_readme(project_root: &Path, display_name: &str) -> AppResult<()> {
    let path = project_root.join(README_FILE_NAME);
    if path.exists() {
        return Ok(());
    }

    fs::write(path, format!("# {display_name}\n"))?;
    Ok(())
}

/// What `path` is right now, or `None` where nothing is there.
fn revision_of(path: &Path) -> Option<Revision> {
    let metadata = fs::metadata(path).ok()?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| i64::try_from(since.as_millis()).unwrap_or(0));

    Some(Revision {
        modified_ms,
        size: metadata.len(),
    })
}

/// Write `bytes` to `path` through a temporary file beside it.
fn write_atomically(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let temporary = path.with_extension("ltk-tmp");
    fs::write(&temporary, bytes)?;
    fs::rename(&temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests;
