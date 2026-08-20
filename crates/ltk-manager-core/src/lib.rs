//! UI-agnostic core for LTK Manager.
//!
//! Hosts the parts of the backend that don't depend on Tauri so they can be
//! shared with non-GUI frontends (e.g. a future CLI). UI-facing conditions are
//! reported through listener traits (see [`patcher::session::PatcherEvents`]);
//! the Tauri shell in `src-tauri` supplies the adapters.

pub mod config;
pub mod diagnostics;
pub mod error;
pub mod events;
pub mod game_index;
pub mod game_wads;
pub mod hashtables;
pub mod launcher;
pub mod mods;
pub mod overlay;
pub mod patcher;
pub mod preview;
pub mod storage;
pub mod strings;
pub mod utils;
pub mod workshop;
