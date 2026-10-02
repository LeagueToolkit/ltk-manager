//! What League's own classes mean, read out of a document core holds open.
//!
//! Core owns the document, the names and where an asset lives. This crate sits above it
//! and owns the classes, so core never learns what a `MapContainer` is.

mod linked;
pub mod map;
pub mod material;
pub mod program;
mod resolver;
pub mod skin;
pub mod spell;
pub mod vfx;
