//! Tauri IPC command handlers.
//! ## Pattern
//!
//! ```rust
//! use crate::error::{AppResult, IpcResult};
//!
//! #[tauri::command]
//! #[specta::specta]
//! pub fn my_command(args: String) -> IpcResult<ReturnType> {
//!     my_command_inner(&args).into()
//! }
//!
//! fn my_command_inner(args: &str) -> AppResult<ReturnType> {
//!     Ok(value)
//! }
//! ```
//!
//! A command that walks the disk takes the same shape through
//! [`off_thread`](crate::services::shared::off_thread),
//! which keeps the work off the thread that draws the window:
//!
//! ```rust
//! #[tauri::command]
//! #[specta::specta]
//! pub async fn my_command(args: String) -> IpcResult<ReturnType> {
//!     off_thread(move || my_command_inner(&args)).await
//! }
//! ```
//!
//! See `docs/ERROR_HANDLING.md` for details.

mod app;
mod deep_link;
mod diagnostics;
pub(crate) mod hotkeys;
mod integrations;
pub(crate) mod launcher;
mod news;
pub(crate) mod patcher;
mod platform;
mod releases;
mod settings;
mod shell;
mod storage;
mod ui;

pub use app::*;
pub use deep_link::*;
pub use diagnostics::*;
pub use hotkeys::*;
pub use integrations::*;
pub use launcher::*;
pub use news::*;
pub use patcher::*;
pub use platform::*;
pub use releases::*;
pub use settings::*;
pub use shell::*;
pub use storage::*;
pub use ui::*;
