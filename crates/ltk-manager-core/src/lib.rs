//! UI-agnostic core for LTK Manager.
//!
//! Hosts the parts of the backend that don't depend on Tauri so they can be
//! shared with non-GUI frontends (e.g. a future CLI). UI-facing conditions are
//! reported through listener traits (see [`patcher::session::PatcherEvents`]);
//! the Tauri shell in `src-tauri` supplies the adapters.

pub mod bin_document;
mod bin_source;
pub mod config;
pub mod deep_link;
pub mod diagnostics;
pub mod error;
pub mod events;
pub mod game_extract;
pub mod game_index;
pub mod game_wads;
pub mod generation;
pub mod github;
pub mod hashing;
pub mod hashtables;
pub mod integrations;
pub mod launcher;
pub mod matcher;
pub mod meta_docs;
pub mod meta_schema;
pub mod mods;
pub mod news;
pub mod object_index;
pub mod overlay;
pub mod patcher;
pub mod platform;
pub mod preview;
pub mod problems;
pub mod releases;
pub mod ritobin;
pub mod sandbox;
pub mod storage;
pub mod strings;
pub mod utils;
pub mod vfx;
pub mod workshop;
