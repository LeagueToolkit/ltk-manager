//! The project's news over IPC, as Home draws it.

use ltk_manager_core::news::announcements::{self, Announcement};
use ltk_manager_core::news::notices::{self, Notice};

use crate::error::{GitHubFeed, IpcResult};
use crate::running_version;
use crate::services::shared::github_feed;

/// Read the newest posts in the Announcements category.
#[tauri::command]
#[specta::specta]
pub async fn list_announcements() -> IpcResult<Vec<Announcement>> {
    github_feed(GitHubFeed::Announcements, || {
        announcements::fetch(&running_version())
    })
    .await
}

/// Read the notices that concern this build right now.
#[tauri::command]
#[specta::specta]
pub async fn list_notices() -> IpcResult<Vec<Notice>> {
    github_feed(GitHubFeed::Notices, || notices::fetch(&running_version())).await
}
