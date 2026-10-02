//! A `ResourceResolver`, which maps the effect keys a skin and a particle system name to
//! the systems they play.

use ltk_hash::BinHash;
use ltk_manager_core::bin_document::owned;
use ltk_meta::walk::{Leaf, TreeValue as _};
use ltk_meta::{BinObject, PropertyValueEnum};

/// `ResourceResolver.resourceMap`, a `Map<Hash, Link>` from an effect key to its system.
pub(crate) const RESOURCE_MAP: BinHash = BinHash(0xd2f5_8721);

/// `effectKey`, which a child identifier and a skin's idle effect both name a system by.
pub(crate) const EFFECT_KEY: BinHash = BinHash(0x9b03_00f3);

/// The effect keys `resolver`'s map holds, each with the object its link names.
///
/// The order is the map's own. A key mapped to a null link is kept, because a null link is a hit
/// that suppresses the effect rather than falling through, and the null target is no object of
/// any document.
pub(crate) fn resolver_entries(resolver: &BinObject) -> impl Iterator<Item = (BinHash, BinHash)> {
    let entries = match resolver.properties.get(&RESOURCE_MAP) {
        Some(PropertyValueEnum::Map(map)) => map.entries(),
        _ => &[],
    };

    entries.iter().filter_map(
        |(key, value)| match (owned(key.as_leaf()), owned(value.as_leaf())) {
            (Some(Leaf::Hash(key)), Some(Leaf::Link(target))) => Some((key, target)),
            _ => None,
        },
    )
}
