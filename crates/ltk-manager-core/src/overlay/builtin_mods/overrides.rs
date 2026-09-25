//! The chunks a built-in mod overrides and the properties it declares, written as a mod project
//! for the overlay to read.

use crate::error::AppResult;
use camino::{Utf8Path, Utf8PathBuf};
use filetime::FileTime;
use fs_err as fs;
use ltk_mod_project::{ModProject, ModProjectAuthor, ModProjectLayer};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// The chunks a built-in mod overrides, by game archive and chunk path, and the properties it
/// declares.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct Overrides {
    files: BTreeMap<Utf8PathBuf, Cow<'static, [u8]>>,
    /// Overrides too large to hold in memory, by the file on disk each is a copy of.
    copies: BTreeMap<Utf8PathBuf, PathBuf>,
    /// Each property's value as YAML text, by target chunk path, entry and property.
    declared: BTreeMap<String, BTreeMap<String, BTreeMap<String, String>>>,
}

impl Overrides {
    /// Override `chunk_path` in the game archive named `wad` with `bytes`.
    pub(super) fn insert(
        &mut self,
        wad: &str,
        chunk_path: &str,
        bytes: impl Into<Cow<'static, [u8]>>,
    ) {
        self.files
            .insert(Utf8Path::new(wad).join(chunk_path), bytes.into());
    }

    /// Override `chunk_path` in the game archive named `wad` with a copy of the file at `source`.
    pub(super) fn insert_copy(&mut self, wad: &str, chunk_path: &str, source: PathBuf) {
        self.copies
            .insert(Utf8Path::new(wad).join(chunk_path), source);
    }

    /// Each override copied from a file, by its path below the layer, with the file.
    pub(super) fn copies(&self) -> impl Iterator<Item = (&Utf8Path, &Path)> {
        self.copies
            .iter()
            .map(|(path, source)| (path.as_path(), source.as_path()))
    }

    /// Declare `property` of `entry` in the chunk at `target` as `value`, a YAML node on one line.
    pub(super) fn declare(&mut self, target: &str, entry: &str, property: &str, value: String) {
        self.declared
            .entry(target.to_owned())
            .or_default()
            .entry(entry.to_owned())
            .or_default()
            .insert(property.to_owned(), value);
    }

    /// The layer's `game_data.yaml`, one `target` module per chunk, and none with nothing declared.
    pub(super) fn declarations(&self) -> Option<String> {
        if self.declared.is_empty() {
            return None;
        }
        let mut text = String::from("version: 1\nmodules:\n");
        for (target, entries) in &self.declared {
            text.push_str(&format!("  - target: {}\n", quoted(target)));
            for (entry, properties) in entries {
                text.push_str(&format!("    {}:\n", quoted(entry)));
                for (property, value) in properties {
                    text.push_str(&format!("      {property}: {value}\n"));
                }
            }
        }
        Some(text)
    }

    /// Each override by its path below the layer, `<wad>/<chunk path>`, in path order.
    pub(super) fn iter(&self) -> impl Iterator<Item = (&Utf8Path, &[u8])> {
        self.files
            .iter()
            .map(|(path, bytes)| (path.as_path(), bytes.as_ref()))
    }

    /// Write the overrides to `dir` as the `base` layer of the mod project `name`.
    ///
    /// Only a file whose bytes differ is rewritten, since an unchanged file keeps the
    /// modification time the overlay's content fingerprint reads. A copy is a hard link to its
    /// source where the volume allows, and is refreshed when its length or modification time
    /// differs from the source's. A file an earlier write left
    /// that the overrides no longer hold is removed, and nothing outside the layer is touched.
    ///
    /// # Errors
    ///
    /// Fails when a file cannot be read, written or removed.
    pub(super) fn write(&self, dir: &Path, name: &str, display_name: &str) -> AppResult<()> {
        let layer_dir = dir.join("content").join(ModProjectLayer::BASE_NAME);
        fs::create_dir_all(&layer_dir)?;
        write_if_changed(
            &dir.join("mod.config.json"),
            &serde_json::to_vec_pretty(&mod_project(name, display_name))?,
        )?;

        let mut kept = BTreeSet::new();
        for (path, bytes) in self.iter() {
            let path = layer_dir.join(path);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            write_if_changed(&path, bytes)?;
            kept.insert(path);
        }
        for (path, source) in self.copies() {
            let path = layer_dir.join(path);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            copy_if_changed(source, &path)?;
            kept.insert(path);
        }
        if let Some(text) = self.declarations() {
            let path = layer_dir.join(ltk_declarations::FILE_NAME);
            write_if_changed(&path, text.as_bytes())?;
            kept.insert(path);
        }
        remove_all_but(&layer_dir, &kept)
    }
}

fn mod_project(name: &str, display_name: &str) -> ModProject {
    ModProject {
        name: name.to_owned(),
        display_name: display_name.to_owned(),
        version: "1.0.0".to_owned(),
        description: "Generated by LTK Manager.".to_owned(),
        authors: vec![ModProjectAuthor::Name("LTK Manager".to_owned())],
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        transformers: Vec::new(),
        layers: ModProjectLayer::default_table(),
        thumbnail: None,
        hashtables: Vec::new(),
    }
}

/// `text` as a double-quoted YAML scalar.
pub(super) fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if fs::read(path).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    fs::write(path, bytes)?;
    Ok(())
}

fn copy_if_changed(source: &Path, path: &Path) -> AppResult<()> {
    let from = fs::metadata(source)?;
    let modified = FileTime::from_last_modification_time(&from);
    let current = fs::metadata(path).ok();
    if current.as_ref().is_some_and(|current| {
        current.len() == from.len() && FileTime::from_last_modification_time(current) == modified
    }) {
        return Ok(());
    }

    // A hard link costs no space for a file of about 90 MB. A copy covers a cache on another
    // volume, and takes the source's time so the check above holds next build.
    if current.is_some() {
        fs::remove_file(path)?;
    }
    if fs::hard_link(source, path).is_err() {
        fs::copy(source, path)?;
        filetime::set_file_mtime(path, modified)?;
    }
    Ok(())
}

/// Remove every file under `dir` outside `kept`, and each directory that leaves empty.
fn remove_all_but(dir: &Path, kept: &BTreeSet<PathBuf>) -> AppResult<()> {
    for entry in WalkDir::new(dir).min_depth(1).contents_first(true) {
        let entry = entry.map_err(io::Error::from)?;
        if entry.file_type().is_dir() {
            if fs::read_dir(entry.path())?.next().is_none() {
                fs::remove_dir(entry.path())?;
            }
        } else if !kept.contains(entry.path()) {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}
