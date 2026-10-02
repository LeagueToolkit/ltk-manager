//! Tauri's view of the workshop service.
//!
//! The service itself lives in core. All that belongs here is the managed-state
//! newtype Tauri needs for `.manage()` / `State<T>` extraction, the rebuild the watch on a
//! project's Atlas sources runs, and a re-export so command handlers keep addressing
//! everything as `crate::workshop::*`.

mod sheet_sources;

pub use ltk_manager_core::workshop::*;
pub use sheet_sources::source_rebuild;

/// Tauri managed state wrapper for [`Workshop`].
pub struct WorkshopState(pub Workshop);
