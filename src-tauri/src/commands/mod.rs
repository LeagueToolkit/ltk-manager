//! Tauri IPC command handlers.
//! ## Pattern
//!
//! ```rust
//! use crate::error::{AppResult, IpcResult};
//!
//! #[tauri::command]
//! pub fn my_command(args: String) -> IpcResult<ReturnType> {
//!     my_command_inner(&args).into()
//! }
//!
//! fn my_command_inner(args: &str) -> AppResult<ReturnType> {
//!     Ok(value)
//! }
//! ```
//!
//! See `docs/ERROR_HANDLING.md` for details.

mod app;
mod deep_link;
mod diagnostics;
mod folders;
pub(crate) mod hotkeys;
mod migration;
mod mods;
pub(crate) mod patcher;
mod platform;
mod profiles;
mod settings;
mod shell;
mod storage;
mod workshop;

pub use app::*;
pub use deep_link::*;
pub use diagnostics::*;
pub use folders::*;
pub use hotkeys::*;
pub use migration::*;
pub use mods::*;
pub use patcher::*;
pub use platform::*;
pub use profiles::*;
pub use settings::*;
pub use shell::*;
pub use storage::*;
pub use workshop::*;
