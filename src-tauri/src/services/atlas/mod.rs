//! The Atlas service: the UI editor's reads of a view controller, its writes into a project's
//! sheets and layers, and the programs it draws with.

mod programs;
mod sheets;
mod views;

pub use programs::*;
pub use sheets::*;
pub use views::*;

use tauri::plugin::TauriPlugin;
use tauri::Wry;

/// The Atlas service's row of `services/table.rs`.
pub struct Table;

/// The plugin answering the UI editor's commands.
pub fn plugin() -> TauriPlugin<Wry> {
    super::plugin::<Table>().build()
}
