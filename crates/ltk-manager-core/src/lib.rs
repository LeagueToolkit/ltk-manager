//! UI-agnostic core for LTK Manager.
//!
//! Hosts the parts of the backend that don't depend on Tauri so they can be
//! shared with non-GUI frontends (e.g. a future CLI). UI-facing conditions are
//! reported through listener traits (see [`patcher::session::PatcherEvents`]);
//! the Tauri shell in `src-tauri` supplies the adapters.

pub mod bin_document;
pub mod config;
pub mod diagnostics;
pub mod error;
pub mod events;
pub mod game_extract;
pub mod game_index;
pub mod game_wads;
pub mod hashtables;
pub mod launcher;
pub mod matcher;
pub mod material;
pub mod meta_schema;
pub mod mods;
pub mod object_index;
pub mod overlay;
pub mod patcher;
pub mod preview;
pub mod problems;
pub mod ritobin;
pub mod skin;
pub mod storage;
pub mod strings;
pub mod utils;
pub mod vfx;
pub mod workshop;
