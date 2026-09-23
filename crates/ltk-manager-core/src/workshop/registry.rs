//! The project folders the workshop knows about outside its own folder.

use crate::error::AppResult;
use chrono::{DateTime, Utc};
use fs_err as fs;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};

/// A project folder's identity, the same whichever spelling of its path reached it.
///
/// Windows paths compare without case, so the key lowercases there, and a
/// trailing separator or a forward slash never makes a second key.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectKey(String);

impl ProjectKey {
    /// The key for the folder at `path`.
    pub fn of(path: &Path) -> Self {
        let text = path.to_string_lossy();
        let text = match cfg!(windows) {
            true => text.replace('/', "\\").to_lowercase(),
            false => text.into_owned(),
        };
        let trimmed = text.trim_end_matches(std::path::MAIN_SEPARATOR);
        let trimmed = match trimmed.is_empty() {
            true => text.as_str(),
            false => trimmed,
        };

        Self(trimmed.to_string())
    }

    /// The short id a route names the project by.
    pub fn id(&self) -> String {
        let digest = Sha256::digest(self.0.as_bytes());
        digest[..8]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// Whether this folder sits anywhere below `root`.
    pub fn is_within(&self, root: &ProjectKey) -> bool {
        Path::new(&self.0).starts_with(&root.0) && self != root
    }
}

impl fmt::Display for ProjectKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A folder opened from outside the workshop folder, as the list stores it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenedEntry {
    path: PathBuf,
    /// The name the folder's config gave last time it loaded, for a card whose folder is gone.
    display_name: String,
    added: DateTime<Utc>,
}

/// The document `workshop-projects.json` holds.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryDocument {
    #[serde(default)]
    opened: Vec<OpenedEntry>,
    #[serde(default)]
    last_opened: HashMap<ProjectKey, DateTime<Utc>>,
}

/// An opened folder as the frontend lists it, whether or not it is still on disk.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct OpenedProjectFolder {
    /// The id the project's route names it by.
    pub id: String,
    pub path: String,
    pub display_name: String,
    /// Whether the folder or its config is gone.
    pub missing: bool,
    pub last_opened: Option<DateTime<Utc>>,
}

/// The opened folders and every project's last-opened time, saved beside `settings.json`.
///
/// A registry with no file keeps its state in memory, which is what tests and a
/// build without an app data directory get.
#[derive(Debug, Default)]
pub struct ProjectRegistry {
    file: Option<PathBuf>,
    document: Mutex<RegistryDocument>,
}

impl ProjectRegistry {
    /// File name of the registry inside the app data directory.
    pub const FILE_NAME: &str = "workshop-projects.json";

    /// Load the registry at `file`, starting empty when it is absent or unreadable.
    pub fn load(file: PathBuf) -> Self {
        let document = match fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|error| {
                tracing::warn!(%error, file = %file.display(), "Unreadable project registry, starting empty");
                RegistryDocument::default()
            }),
            Err(_) => RegistryDocument::default(),
        };

        Self {
            file: Some(file),
            document: Mutex::new(document),
        }
    }

    /// The opened folders, in the order they were added.
    pub(crate) fn opened_paths(&self) -> Vec<PathBuf> {
        self.document
            .lock()
            .opened
            .iter()
            .map(|entry| entry.path.clone())
            .collect()
    }

    /// Whether `key` is one of the opened folders.
    pub(crate) fn is_opened(&self, key: &ProjectKey) -> bool {
        self.document
            .lock()
            .opened
            .iter()
            .any(|entry| ProjectKey::of(&entry.path) == *key)
    }

    /// When the project at `key` was last opened.
    pub(crate) fn last_opened(&self, key: &ProjectKey) -> Option<DateTime<Utc>> {
        self.document.lock().last_opened.get(key).copied()
    }

    /// The opened folders as the frontend lists them.
    pub fn opened_folders(&self) -> Vec<OpenedProjectFolder> {
        let document = self.document.lock();

        document
            .opened
            .iter()
            .map(|entry| {
                let key = ProjectKey::of(&entry.path);
                let missing = super::find_config_file(&entry.path).is_none();

                OpenedProjectFolder {
                    id: key.id(),
                    path: entry.path.display().to_string(),
                    display_name: entry.display_name.clone(),
                    missing,
                    last_opened: document.last_opened.get(&key).copied(),
                }
            })
            .collect()
    }

    /// Add the folder at `path` to the list, or refresh its stored name.
    ///
    /// # Errors
    ///
    /// Returns an error if the registry file cannot be written.
    pub(crate) fn add(&self, path: &Path, display_name: &str) -> AppResult<()> {
        let key = ProjectKey::of(path);
        let mut document = self.document.lock();

        match document
            .opened
            .iter_mut()
            .find(|entry| ProjectKey::of(&entry.path) == key)
        {
            Some(entry) => entry.display_name = display_name.to_string(),
            None => document.opened.push(OpenedEntry {
                path: path.to_path_buf(),
                display_name: display_name.to_string(),
                added: Utc::now(),
            }),
        }

        self.save(&document)
    }

    /// Record that the project at `path` was opened now.
    ///
    /// # Errors
    ///
    /// Returns an error if the registry file cannot be written.
    pub(crate) fn touch(&self, path: &Path) -> AppResult<()> {
        let mut document = self.document.lock();
        document
            .last_opened
            .insert(ProjectKey::of(path), Utc::now());

        self.save(&document)
    }

    /// Drop the folder at `path` from the list and forget when it was opened.
    ///
    /// # Errors
    ///
    /// Returns an error if the registry file cannot be written.
    pub(crate) fn forget(&self, path: &Path) -> AppResult<()> {
        let key = ProjectKey::of(path);
        let mut document = self.document.lock();
        document
            .opened
            .retain(|entry| ProjectKey::of(&entry.path) != key);
        document.last_opened.remove(&key);

        self.save(&document)
    }

    /// Point the entry for `from` at `to`, keeping its history.
    ///
    /// # Errors
    ///
    /// Returns an error if the registry file cannot be written.
    pub(crate) fn relocate(&self, from: &Path, to: &Path, display_name: &str) -> AppResult<()> {
        let from_key = ProjectKey::of(from);
        let to_key = ProjectKey::of(to);
        let mut document = self.document.lock();

        document
            .opened
            .retain(|entry| ProjectKey::of(&entry.path) != to_key);
        if let Some(entry) = document
            .opened
            .iter_mut()
            .find(|entry| ProjectKey::of(&entry.path) == from_key)
        {
            entry.path = to.to_path_buf();
            entry.display_name = display_name.to_string();
        }

        if let Some(opened) = document.last_opened.remove(&from_key) {
            document.last_opened.insert(to_key, opened);
        }

        self.save(&document)
    }

    fn save(&self, document: &RegistryDocument) -> AppResult<()> {
        let Some(file) = &self.file else {
            return Ok(());
        };

        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent)?;
        }

        let temp = file.with_extension("json.tmp");
        fs::write(&temp, serde_json::to_string_pretty(document)?)?;
        fs::rename(&temp, file)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests;
