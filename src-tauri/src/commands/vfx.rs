//! The particle renderer's read: one system's whole value tree in one call.
//!
//! The tree is the open document's (ADR-0026), and this answers a subtree of it with
//! every reference resolved rather than a window of rows.

use super::document_assets::{parse_entry, read_resolved};
use super::off_thread;
use crate::error::IpcResult;
use ltk_manager_core::bin_document::BinDocumentId;
use ltk_manager_core::vfx::{resolve_system, VfxSystem};
use tauri::AppHandle;

/// One particle system of an open document, with every reference resolved.
///
/// `entry` is the object's hash as `0x` and eight hex digits.
#[tauri::command]
#[specta::specta]
pub async fn read_vfx_system(
    document: BinDocumentId,
    entry: String,
    app_handle: AppHandle,
) -> IpcResult<VfxSystem> {
    off_thread(move || {
        let entry = parse_entry(&entry)?;
        read_resolved(&app_handle, document, |open, names, assets| {
            Ok(resolve_system(open, entry, names, assets)?)
        })
    })
    .await
}
