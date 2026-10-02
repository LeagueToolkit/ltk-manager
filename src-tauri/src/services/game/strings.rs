use crate::error::IpcResult;
use crate::services::shared::off_thread;
use crate::state::SettingsState;
use ltk_manager_core::strings::{StringKeyIndexState, StringKeySearchResult};
use std::collections::HashMap;
use tauri::{AppHandle, Manager, State};

/// Search known stringtable field names for the workshop strings editor.
///
/// The first call builds the suggestion index, reading the shared cache's
/// `rst-xxh3` table and the game stringtable for value previews, so it can take
/// a moment. Subsequent calls are instant.
#[tauri::command]
#[specta::specta]
pub fn search_string_keys(
    query: String,
    limit: Option<u32>,
    settings: State<SettingsState>,
    index: State<StringKeyIndexState>,
) -> IpcResult<StringKeySearchResult> {
    let index = index.get_or_build(&settings.config());
    let limit = limit.unwrap_or(50).min(200) as usize;
    IpcResult::ok(index.search(&query, limit))
}

/// Current in-game text for string-table keys, for the override editor and the bin editor.
///
/// Shares the suggestion index with [`search_string_keys`], first-call build
/// cost included, on a blocking thread because a bin opening asks for it. A key
/// the game does not resolve is absent from the map.
#[tauri::command]
#[specta::specta]
pub async fn lookup_string_values(
    keys: Vec<String>,
    app_handle: AppHandle,
) -> IpcResult<HashMap<String, String>> {
    off_thread(move || {
        let config = app_handle.state::<SettingsState>().config();
        let index = app_handle
            .state::<StringKeyIndexState>()
            .get_or_build(&config);
        Ok(index.lookup(&keys))
    })
    .await
}
