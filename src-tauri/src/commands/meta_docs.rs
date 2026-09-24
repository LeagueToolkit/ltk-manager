//! The LoL Meta Wiki's documentation, for the class and field cards.

use super::bin::installed_schema;
use super::off_thread;
use crate::error::{AppError, IpcResult};
use ltk_manager_core::meta_docs::{self, ClassDocs};
use ltk_manager_core::object_index::parse_hash;
use tauri::AppHandle;

/// User agent sent with documentation requests, as the publisher asks of every client.
const USER_AGENT: &str = concat!("ltk-manager/", env!("CARGO_PKG_VERSION"));

/// The wiki's prose for one class and every property it or a base of it declares.
///
/// Read from the cache, never the network. `None` where nothing is documented.
/// `class_hash` is `0x` and eight hex digits.
#[tauri::command]
#[specta::specta]
pub async fn class_docs(class_hash: String, app_handle: AppHandle) -> IpcResult<Option<ClassDocs>> {
    off_thread(move || {
        let class = parse_hash(&class_hash)
            .ok_or_else(|| AppError::ValidationFailed(format!("Not a class hash: {class_hash}")))?;
        let (schema, build) = installed_schema(&app_handle);
        Ok(meta_docs::class_docs(&schema, class, build))
    })
    .await
}

/// Refresh the cached documentation once per session, and answer the session's revision.
///
/// The revision moves when a newer copy lands. A publisher that cannot be reached leaves the
/// cached copy and the revision as they were.
#[tauri::command]
#[specta::specta]
pub async fn sync_meta_docs() -> IpcResult<u32> {
    off_thread(|| Ok(meta_docs::sync(USER_AGENT))).await
}
