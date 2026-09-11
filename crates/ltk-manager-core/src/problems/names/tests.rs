//! Unit tests for the four bin name tables, and for a cache that holds none.

use super::*;
use crate::bin_document::hex;

/// Every lookup has to miss rather than answer out of another table's
/// universe, which is the whole reason the four are kept apart.
#[test]
fn a_cache_that_is_not_there_names_nothing() {
    let names = BinNames::none();
    let hash = BinHash(0x0032_9f1d);

    assert_eq!(names.field(hash), None);
    assert_eq!(names.value(hash), None);
    assert_eq!(names.entry(hash), None);
    assert_eq!(names.class(hash), None);
}

#[test]
fn a_hash_with_no_name_prints_as_eight_digits() {
    assert_eq!(hex(BinHash(0x0032_9f1d)), "0x00329f1d");
    assert_eq!(hex(BinHash(0xffff_ffff)), "0xffffffff");
}
