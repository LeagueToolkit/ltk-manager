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
mod integrations;
mod news;
mod platform;
mod releases;
pub(crate) mod shell;
mod storage;

pub use app::*;
pub use deep_link::*;
pub use integrations::*;
pub use news::*;
pub use platform::*;
pub use releases::*;
pub use shell::*;
pub use storage::*;
