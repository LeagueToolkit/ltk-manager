//! The news service: the project's announcements and notices, and its release feed, each read
//! from GitHub.

mod posts;
mod releases;

pub use posts::*;
pub use releases::*;

use tauri::plugin::TauriPlugin;
use tauri::Wry;

/// The news service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the news commands.
pub fn plugin() -> TauriPlugin<Wry> {
    super::plugin::<Table>().build()
}
