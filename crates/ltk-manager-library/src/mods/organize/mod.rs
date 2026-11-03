//! How the library is arranged: folders group mods, profiles switch between
//! whole configurations.
//!
//! Both are stored in the same index document and both are edited through
//! `mutate_index`, so they share the ordering invariants — a folder's `mod_ids`
//! and a profile's `mod_order` have to agree, which is why [`folders`] owns the
//! flatten/sync helpers that [`super::index::reconcile`] leans on.

pub(super) mod folders;
pub(super) mod kept_sort;
pub(super) mod profiles;
