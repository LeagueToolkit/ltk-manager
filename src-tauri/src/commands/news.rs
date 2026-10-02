//! The project's news over IPC, as Home draws it.

use crate::error::{GitHubFeed, IpcResult};
use crate::news::announcements::{self, Announcement};
use crate::news::notices::{self, Notice};

use crate::services::shared::github_feed;

/// Read the newest posts in the Announcements category.
#[tauri::command]
#[specta::specta]
pub async fn list_announcements() -> IpcResult<Vec<Announcement>> {
    github_feed(GitHubFeed::Announcements, announcements::fetch).await
}

/// Read the notices that concern this build right now.
#[tauri::command]
#[specta::specta]
pub async fn list_notices() -> IpcResult<Vec<Notice>> {
    github_feed(GitHubFeed::Notices, notices::fetch).await
}
