//! The particle renderer's read: one system's whole value tree in one call.
//!
//! The tree is the open document's (ADR-0026), and this answers a subtree of it with
//! every reference resolved rather than a window of rows.

use super::material::shader_defs;
use crate::error::IpcResult;
use crate::services::shared::document_assets::{parse_entry, read_resolved};
use crate::services::shared::installed::installed_schema;
use crate::services::shared::off_thread;
use crate::services::shared::{linked_assets, linked_reader};
use ltk_manager_core::bin_document::BinDocumentId;
use ltk_manager_core::meta_schema::SchemaNames;
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::vfx::{vfx_templates as catalog, VfxTemplate};
use ltk_manager_game::vfx::{resolve_system, search_linked_materials, VfxSystem};
use tauri::AppHandle;

/// One particle system of an open document, with every reference resolved.
///
/// `entry` is the object's hash as `0x` and eight hex digits. A class or field the hash
/// tables leave unnamed takes the meta schema's name. A custom material the document does
/// not declare is looked for through the files it links, and a linked file that cannot be
/// read is passed over.
#[tauri::command]
#[specta::specta]
pub async fn read_vfx_system(
    document: BinDocumentId,
    entry: String,
    app_handle: AppHandle,
) -> IpcResult<VfxSystem> {
    off_thread(move || {
        let entry = parse_entry(&entry)?;
        let (schema, _) = installed_schema(&app_handle);
        read_resolved(&app_handle, document, |open, names, assets| {
            let mut read = linked_reader(&app_handle);
            let shaders = shader_defs(&app_handle, assets);
            let names = SchemaNames::new(names, &schema);
            let mut system = resolve_system(open, entry, &names, assets, shaders.as_deref())?;
            let linked: Vec<AssetRef> = linked_assets(open, assets);
            search_linked_materials(
                &mut system,
                linked,
                &names,
                assets,
                shaders.as_deref(),
                &mut read,
            );
            Ok(system)
        })
    })
    .await
}

/// Every VFX template of the catalog, which the Graph pane and the inspector offer. ADR-0058.
#[tauri::command]
#[specta::specta]
pub async fn vfx_templates() -> IpcResult<Vec<VfxTemplate>> {
    off_thread(|| Ok(catalog())).await
}
