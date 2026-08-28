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
//! A command that walks the disk takes the same shape through [`off_thread`],
//! which keeps the work off the thread that draws the window:
//!
//! ```rust
//! #[tauri::command]
//! pub async fn my_command(args: String) -> IpcResult<ReturnType> {
//!     off_thread(move || my_command_inner(&args)).await
//! }
//! ```
//!
//! See `docs/ERROR_HANDLING.md` for details.

mod app;
mod deep_link;
mod diagnostics;
mod folders;
mod game_extract;
mod game_index;
mod game_wads;
mod hashtables;
mod health;
pub(crate) mod hotkeys;
pub(crate) mod launcher;
mod migration;
mod mods;
pub(crate) mod patcher;
mod platform;
mod preview;
mod problems;
mod profiles;
mod ritobin;
mod settings;
mod shell;
mod storage;
mod strings;
mod workshop;

pub use app::*;
pub use deep_link::*;
pub use diagnostics::*;
pub use folders::*;
pub use game_extract::*;
pub use game_index::*;
pub use game_wads::*;
pub use hashtables::*;
pub use health::*;
pub use hotkeys::*;
pub use launcher::*;
pub use migration::*;
pub use mods::*;
pub use patcher::*;
pub use platform::*;
pub use preview::*;
pub use problems::*;
pub use profiles::*;
pub use ritobin::*;
pub use settings::*;
pub use shell::*;
pub use storage::*;
pub use strings::*;
pub use workshop::*;

use crate::error::{AppError, AppResult, IpcResult};

/// Run one piece of work on a blocking thread, as an IPC answer.
///
/// The body of a sync `#[tauri::command]` runs on the thread that draws the
/// window, so anything that walks a directory, opens an archive or waits on
/// another thread answers through here instead.
///
/// A panic inside `work` comes back as `ErrorCode::Unknown` rather than
/// unwinding into the runtime.
// TODO: fold each caller's setup into `work` - nine of them read config or
// state up front and early-return through `IpcResult::from(Err::<T, _>(e))`,
// a turbofish that exists only because the read happens before the spawn.
// `config()` is a lock and a clone, so it is at home on a blocking thread. The
// ones to look at are `import_cslol_mods` and `rebuild_overlay`, whose setup
// also runs `reject_if_patcher_running` - moving that guard across the thread
// hop widens a window this refactor should not widen quietly.
pub(crate) async fn off_thread<T, F>(work: F) -> IpcResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .unwrap_or_else(|e| Err(AppError::Other(e.to_string())))
        .into()
}
