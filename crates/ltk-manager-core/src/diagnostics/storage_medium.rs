//! Storage medium diagnostic — wraps `crate::storage::detect_path_storage_medium`.
//!
//! Builds on HDD can take 15–20 minutes for a large library; this surfaces
//! that explicitly so users see the same warning as the first-time setup
//! flow even after they dismiss the banner.

use super::{Category, Check, CheckCtx, CheckDetail, CheckSpec, Severity};
use crate::storage::{StorageMedium, detect_path_storage_medium};

const MEDIUM: CheckSpec = CheckSpec::new("storage.medium", "Storage medium", Category::Storage);

pub fn check_storage_medium(ctx: &CheckCtx) -> Check {
    let Some(p) = ctx.mod_storage_path.as_ref() else {
        return MEDIUM.result(Severity::Info, "No storage path resolved");
    };
    let medium = detect_path_storage_medium(&p.display().to_string());
    match medium {
        StorageMedium::Ssd => {
            let mut c = MEDIUM.ok("SSD");
            c.details
                .push(CheckDetail::new("path", p.display().to_string()));
            c
        }
        StorageMedium::Hdd => {
            let mut c = MEDIUM.result(Severity::Warn, "HDD — overlay builds will be slow");
            c.details
                .push(CheckDetail::new("path", p.display().to_string()));
            c.suggestion = Some(
                "Mod storage is on a spinning hard drive. Building the overlay involves rewriting many WAD files; on HDD this can take 10–20 minutes for large libraries. Move storage to an SSD if you have one available."
                    .into(),
            );
            c
        }
        StorageMedium::Unknown => {
            let mut c = MEDIUM.result(Severity::Info, "Unknown");
            c.details
                .push(CheckDetail::new("path", p.display().to_string()));
            c
        }
    }
}
