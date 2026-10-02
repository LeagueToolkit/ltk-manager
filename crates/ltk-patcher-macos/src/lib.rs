//! macOS injection host for LTK Manager.
//!
//! Ported from LeagueToolkit's `cslol-manager` macOS patcher (GPL-3.0): parse
//! the game's Mach-O, neutralize its `wad_verify` in memory, and redirect the
//! `fopen` import stub through a shellcode trampoline that rewrites `.client`
//! paths under the overlay prefix. See `README.md` for attribution.
//!
//! The host speaks the same stdin/stdout line protocol as the Windows
//! `ltk_patcher_host.exe`, so `ltk-manager-core`'s injector, session, and event
//! machinery drive it unchanged.

#[cfg(target_os = "macos")]
pub mod macho;

#[cfg(target_os = "macos")]
pub mod process;

#[cfg(target_os = "macos")]
pub mod patch;

#[cfg(target_os = "macos")]
pub mod protocol;

#[cfg(target_os = "macos")]
pub mod host;

#[cfg(target_os = "macos")]
pub mod elevate;
