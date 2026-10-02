//! The release feed over IPC, as the changelog scrolls through it.

use ltk_manager_core::releases::{self, ReleasePage};

use crate::error::{GitHubFeed, IpcResult};
use crate::running_version;
use crate::services::shared::github_feed;

/// Read page `page` of the release feed, one-based as GitHub numbers it.
#[tauri::command]
#[specta::specta]
pub async fn list_releases(page: u32) -> IpcResult<ReleasePage> {
    github_feed(GitHubFeed::Releases, move || {
        releases::fetch_page(&running_version(), page)
    })
    .await
}
