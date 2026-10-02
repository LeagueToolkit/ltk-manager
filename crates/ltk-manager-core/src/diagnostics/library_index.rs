//! Library index integrity check.
//!
//! Parses `mod_library_index.json` (without going through the full schema
//! migration that the live `ModLibrary` does) and reports a hard error if it
//! is unparseable. This catches the corruption case fixed in commit e96dff9
//! before the user hits a broken library that won't load at all.

use fs_err as fs;

use super::{Category, Check, CheckCtx, CheckDetail, CheckSpec, Severity};

const INDEX: CheckSpec = CheckSpec::new("library.index", "Mod library index", Category::Library);

const INDEX_FILENAME: &str = "mod_library_index.json";

pub fn check_library_index(ctx: &CheckCtx) -> Check {
    let Some(storage) = ctx.mod_storage_path.as_ref() else {
        return INDEX.result(Severity::Info, "No storage path resolved");
    };
    let path = storage.join(INDEX_FILENAME);
    if !path.exists() {
        let mut c = INDEX.ok("No index yet (fresh install)");
        c.details
            .push(CheckDetail::new("path", path.display().to_string()));
        return c;
    }
    let raw = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            let mut c = INDEX.result(Severity::Bad, "Could not read library index");
            c.details
                .push(CheckDetail::new("path", path.display().to_string()));
            c.details.push(CheckDetail::new("error", e.to_string()));
            return c;
        }
    };
    let size = raw.len();
    match serde_json::from_slice::<serde_json::Value>(&raw) {
        Ok(v) => {
            let mut c = INDEX.ok("Index parses successfully");
            c.details
                .push(CheckDetail::new("path", path.display().to_string()));
            c.details
                .push(CheckDetail::new("size_bytes", size.to_string()));
            if let Some(version) = v.get("version").and_then(|x| x.as_u64()) {
                c.details
                    .push(CheckDetail::new("schema_version", version.to_string()));
            }
            if let Some(mods) = v.get("mods").and_then(|x| x.as_object()) {
                c.details
                    .push(CheckDetail::new("mod_count", mods.len().to_string()));
            } else if let Some(mods) = v.get("mods").and_then(|x| x.as_array()) {
                c.details
                    .push(CheckDetail::new("mod_count", mods.len().to_string()));
            }
            c
        }
        Err(e) => {
            let mut c = INDEX.result(Severity::Bad, "Index file is corrupted (JSON parse failed)");
            c.details
                .push(CheckDetail::new("path", path.display().to_string()));
            c.details
                .push(CheckDetail::new("size_bytes", size.to_string()));
            c.details.push(CheckDetail::new("error", e.to_string()));
            c.suggestion = Some(
                "Your library index is corrupted. The latest version of LTK Manager will skip a corrupt index and let you re-import mods, but if you're stuck on an older version, delete or rename the file shown above and re-launch."
                    .into(),
            );
            c
        }
    }
}
