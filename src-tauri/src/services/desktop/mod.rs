//! The desktop service: what the app and the machine it runs on are, the main window and the
//! tray, and the file explorer.

mod app;
mod platform;
pub(crate) mod shell;
mod storage;

pub use app::*;
pub use platform::*;
pub use shell::*;
pub use storage::*;

use tauri::plugin::TauriPlugin;
use tauri::Wry;

/// The desktop service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the desktop commands.
pub fn plugin() -> TauriPlugin<Wry> {
    super::plugin::<Table>().build()
}
