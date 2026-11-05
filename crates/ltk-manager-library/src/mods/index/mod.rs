//! `library.json` — its shape, its versioning, and keeping it true to disk.
//!
//! One document holds every mod entry, profile, and folder, which is why
//! [`document`] serializes all access through a lock: each write rewrites the
//! whole file, so two concurrent commands would clobber each other. The other
//! modules exist because that document, and the directories it names, outlive
//! the code that wrote them — [`schema_migration`] carries old files forward,
//! [`layout_migration`] moves the directories themselves onto the current
//! layout, and [`reconcile`] repairs the drift that accumulates when the
//! filesystem changes behind the app's back. [`startup`] is the order those
//! last three run in.

pub(super) mod document;
pub(super) mod layout_migration;
pub(super) mod reconcile;
pub(super) mod schema_migration;
pub(super) mod startup;

pub(crate) use document::{
    EmbeddedNames, LibraryIndex, LibraryModEntry, ModArchiveFormat, get_active_profile,
    get_profile_by_id, library_index_path, resolve_profile_dirs,
};
