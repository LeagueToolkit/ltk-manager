//! What the commands of more than one service share: the blocking thread they answer from, and
//! what a read of a document or the installed game resolves against.

mod arguments;
mod assets;
mod blocking;
pub(crate) mod document_assets;
mod in_flight;
pub(crate) mod installed;

pub(crate) use arguments::{Library, Workshop};
pub(crate) use assets::{asset_reader, linked_assets, linked_reader, read_asset, read_bin};
pub(crate) use blocking::{github_feed, integration, off_thread};
pub(crate) use in_flight::{overtaken, InFlight};
