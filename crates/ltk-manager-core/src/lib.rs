//! What sits above the mod library: a patching session, install links, the release feeds and
//! the support report.
//!
//! Tauri-free, like every crate below it. UI-facing conditions are reported through listener
//! traits, and the Tauri shell in `src-tauri` supplies the adapters.

pub mod deep_link;
pub mod github;
pub mod log_dir;
pub mod news;
pub mod patching;
pub mod releases;
pub mod support_report;
