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
mod game_index;
mod game_wads;
mod hashtables;
pub(crate) mod hotkeys;
pub(crate) mod launcher;
mod migration;
mod mods;
pub(crate) mod patcher;
mod platform;
mod profiles;
mod settings;
mod shell;
mod storage;
mod strings;
mod workshop;

pub use app::*;
pub use deep_link::*;
pub use diagnostics::*;
pub use folders::*;
pub use game_index::*;
pub use game_wads::*;
pub use hashtables::*;
pub use hotkeys::*;
pub use launcher::*;
pub use migration::*;
pub use mods::*;
pub use patcher::*;
pub use platform::*;
pub use profiles::*;
pub use settings::*;
pub use shell::*;
pub use storage::*;
pub use strings::*;
pub use workshop::*;
