//! A `ResourceResolver`, which maps the effect keys a skin and a particle system name to
//! the systems they play.

use ltk_hash::BinHash;
use ltk_manager_core::bin_document::{entries, owned};
use ltk_manager_core::hashing::named;
use ltk_meta::BinObject;
use ltk_meta::walk::{Leaf, TreeValue as _};

/// `ResourceResolver.resourceMap`, a `Map<Hash, Link>` from an effect key to its system.
pub(crate) const RESOURCE_MAP: BinHash = named("resourceMap");

/// `effectKey`, which a child identifier and a skin's idle effect both name a system by.
pub(crate) const EFFECT_KEY: BinHash = named("effectKey");

/// The effect keys `resolver`'s map holds, each with the object its link names.
///
/// The order is the map's own. A key mapped to a null link is kept, because a null link is a hit
/// that suppresses the effect rather than falling through, and the null target is no object of
/// any document.
pub(crate) fn resolver_entries(resolver: &BinObject) -> impl Iterator<Item = (BinHash, BinHash)> {
    entries(resolver.properties.get(&RESOURCE_MAP))
        .iter()
        .filter_map(
            |(key, value)| match (owned(key.as_leaf()), owned(value.as_leaf())) {
                (Some(Leaf::Hash(key)), Some(Leaf::Link(target))) => Some((key, target)),
                _ => None,
            },
        )
}
