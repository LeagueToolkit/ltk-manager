//! Fixture builders shared by the `mods` unit tests.
//!
//! Index-shaped fixtures are verbose enough that duplicating them per test
//! module invites them to drift apart, which would quietly weaken whichever
//! copy stopped matching the real defaults.

use crate::mods::index::{LibraryModEntry, ModArchiveFormat};
use crate::mods::types::{Profile, ProfileSlug};
use chrono::Utc;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

pub(crate) fn make_test_entry(id: &str, format: ModArchiveFormat) -> LibraryModEntry {
    LibraryModEntry {
        id: id.to_string(),
        installed_at: Utc::now(),
        format,
    }
}

pub(crate) fn make_test_profile(
    id: &str,
    name: &str,
    mod_order: Vec<&str>,
    enabled: Vec<&str>,
) -> Profile {
    Profile {
        id: id.to_string(),
        name: name.to_string(),
        slug: ProfileSlug::from_name(name).unwrap_or_else(|| ProfileSlug("default".to_string())),
        mod_order: mod_order.into_iter().map(String::from).collect(),
        enabled_mods: enabled.into_iter().map(String::from).collect(),
        layer_states: HashMap::new(),
        created_at: Utc::now(),
        last_used: Utc::now(),
    }
}

/// Place the required metadata + archive files on disk so the mod is considered valid.
pub(crate) fn place_mod_files(storage_dir: &Path, id: &str, format: ModArchiveFormat) {
    let meta_dir = storage_dir.join("mods").join(id);
    fs::create_dir_all(&meta_dir).unwrap();
    fs::write(meta_dir.join("mod.config.json"), "{}").unwrap();

    let archive_dir = storage_dir.join("archives");
    fs::create_dir_all(&archive_dir).unwrap();
    fs::write(
        archive_dir.join(format!("{}.{}", id, format.extension())),
        b"fake",
    )
    .unwrap();
}

/// Build a minimal but valid fantome archive: a zip whose only entry is
/// `META/info.json`.
pub(crate) fn make_fantome_zip(path: &Path) {
    use std::io::Write;
    let info = ltk_fantome::FantomeInfo {
        name: "Test Mod".to_string(),
        author: "Author".to_string(),
        version: "1.0.0".to_string(),
        description: "Description".to_string(),
        license: None,
        tags: Vec::new(),
        champions: Vec::new(),
        maps: Vec::new(),
        layers: std::collections::HashMap::new(),
    };
    let file = std::fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("META/info.json", options).unwrap();
    zip.write_all(serde_json::to_string_pretty(&info).unwrap().as_bytes())
        .unwrap();
    zip.finish().unwrap();
}
