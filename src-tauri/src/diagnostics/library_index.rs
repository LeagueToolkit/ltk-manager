//! Library index integrity check.
//!
//! Parses `mod_library_index.json` (without going through the full schema
//! migration that the live `ModLibrary` does) and reports a hard error if it
//! is unparseable. This catches the corruption case fixed in commit e96dff9
//! before the user hits a broken library that won't load at all.

use super::{check, check_ok, Category, Check, CheckCtx, CheckDetail, Severity};

const INDEX_FILENAME: &str = "mod_library_index.json";

pub fn check_library_index(ctx: &CheckCtx) -> Check {
    let Some(storage) = ctx.mod_storage_path.as_ref() else {
        return check(
            "library.index",
            "Mod library index",
            Category::Library,
            Severity::Info,
            "No storage path resolved",
        );
    };
    let path = storage.join(INDEX_FILENAME);
    if !path.exists() {
        let mut c = check_ok(
            "library.index",
            "Mod library index",
            Category::Library,
            "No index yet (fresh install)",
        );
        c.details
            .push(CheckDetail::new("path", path.display().to_string()));
        return c;
    }
    let raw = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            let mut c = check(
                "library.index",
                "Mod library index",
                Category::Library,
                Severity::Bad,
                "Could not read library index",
            );
            c.details
                .push(CheckDetail::new("path", path.display().to_string()));
            c.details.push(CheckDetail::new("error", e.to_string()));
            return c;
        }
    };
    let size = raw.len();
    match serde_json::from_slice::<serde_json::Value>(&raw) {
        Ok(v) => {
            let mut c = check_ok(
                "library.index",
                "Mod library index",
                Category::Library,
                "Index parses successfully",
            );
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
            let mut c = check(
                "library.index",
                "Mod library index",
                Category::Library,
                Severity::Bad,
                "Index file is corrupted (JSON parse failed)",
            );
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
