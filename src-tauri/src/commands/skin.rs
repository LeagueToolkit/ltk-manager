//! The skin preview's reads: one skin with its files and effects placed, and one
//! animation graph's clips.

use super::document_assets::{parse_entry, read_resolved, with_resolution};
use super::off_thread;
use crate::error::IpcResult;
use crate::state::SettingsState;
use ltk_manager_core::bin_document::{BinDocument, BinDocumentId, BinDocuments};
use ltk_manager_core::game_wads::WadCache;
use ltk_manager_core::preview::AssetRef;
use ltk_manager_core::skin::{
    graph_clips, resolve_skin, search_linked, AnimationClip, GraphClips, SkinModel,
};
use tauri::{AppHandle, Manager};

/// One skin of an open document, as a viewport draws it.
///
/// `entry` is the `SkinCharacterDataProperties` object's hash as `0x` and eight hex
/// digits.
#[tauri::command]
#[specta::specta]
pub async fn read_skin(
    document: BinDocumentId,
    entry: String,
    app_handle: AppHandle,
) -> IpcResult<SkinModel> {
    off_thread(move || {
        let entry = parse_entry(&entry)?;
        read_resolved(&app_handle, document, |open, names, assets| {
            Ok(resolve_skin(open, entry, names, assets)?)
        })
    })
    .await
}

/// The clips an animation graph plays, each with its `.anm` placed.
///
/// `entry` is the `AnimationGraphData` object's hash as `0x` and eight hex digits. A
/// graph the open document does not declare is looked for through the files it links,
/// and a linked file that cannot be read is passed over.
#[tauri::command]
#[specta::specta]
pub async fn read_animation_clips(
    document: BinDocumentId,
    entry: String,
    app_handle: AppHandle,
) -> IpcResult<Vec<AnimationClip>> {
    off_thread(move || {
        let entry = parse_entry(&entry)?;
        let config = app_handle.state::<SettingsState>().config();
        with_resolution(&app_handle, document, |names, assets| {
            let open = app_handle.state::<BinDocuments>().document(document)?;
            let linked = match graph_clips(&open, entry, names, assets)? {
                GraphClips::Found(clips) => return Ok(clips),
                GraphClips::Linked(linked) => linked,
            };

            let wads = app_handle.state::<WadCache>();
            let mut read = |asset: &AssetRef| match asset
                .read(&config, &wads)
                .and_then(|bytes| Ok(BinDocument::parse(&bytes)?))
            {
                Ok(bin) => Some(bin),
                Err(e) => {
                    tracing::debug!(?asset, "Passed over a linked bin: {e}");
                    None
                }
            };
            Ok(search_linked(linked, entry, names, assets, &mut read)?)
        })
    })
    .await
}
