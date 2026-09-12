//! One particle system as a resolved value tree: every reference chased, every asset
//! path located, and nothing else read.
//!
//! Reference resolution is Rust's and evaluation is TypeScript's, per "Rust resolves
//! references. TypeScript evaluates them" in docs/plans/vfx-particle-renderer.md. The
//! tree is generic for that reason: no field name is mapped and no value is interpreted.

mod resolve;

pub use resolve::{MAX_DEPTH, MAX_NODES, resolve_system};

use serde::Serialize;

use crate::preview::AssetRef;

/// One particle system, as the renderer reads it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct VfxSystem {
    /// The object's path hash, `0x` and eight hex digits.
    pub entry: String,
    /// The object's path. Absent where no table names it.
    pub name: Option<String>,
    /// `0x` and eight hex digits.
    pub class_hash: String,
    /// The class as the tables name it. Absent where no table does.
    pub class: Option<String>,
    /// The object's own properties, resolved. Always a [`VfxValue::Struct`].
    pub root: VfxValue,
}

/// A value of a resolved system's tree.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum VfxValue {
    /// A `Bool` or a `BitBool`.
    Bool { value: bool },
    /// Every integer kind and every float, as one number, because the consumer does
    /// arithmetic on them.
    Number { value: f64 },
    /// Two, three or four components. A `Color` is four channels as fractions.
    Vector { values: Vec<f32> },
    /// Sixteen cells, row-major.
    Matrix { values: Vec<f32> },
    /// A `String`, held as the file spells it.
    String { value: String },
    /// `0x` and eight hex digits, and the string behind it where a table names one.
    Hash { hash: String, name: Option<String> },
    /// A name field resolved to where its bytes live.
    ///
    /// `path` keeps the spelling the bin holds. `asset` is absent for a path nothing on
    /// this machine holds, which is not an error.
    Asset {
        path: String,
        asset: Option<AssetRef>,
    },
    /// A `Link` whose target is not an object of this document.
    Link { hash: String, name: Option<String> },
    /// A `Struct` with a class, an `Embedded`, or the object a `Link` reached.
    Struct {
        class_hash: String,
        class: Option<String>,
        fields: Vec<VfxField>,
        /// The object whose properties these are, absent for an embedded struct.
        object: Option<VfxObject>,
    },
    /// A `Container` or an `UnorderedContainer`.
    Container { items: Vec<VfxValue> },
    /// A `Map`, its entries in the order the file holds them.
    Map { entries: Vec<VfxMapEntry> },
    /// A `Struct` with a class hash of zero.
    Null,
    /// A `None` leaf, or an optional holding nothing.
    None,
    /// A leaf this build has no reading for.
    Undrawn,
}

/// The object a resolved struct holds the properties of, where a walk reached one.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct VfxObject {
    /// The object's path hash, `0x` and eight hex digits.
    pub entry: String,
    /// The object's path. Absent where no table names it.
    pub name: Option<String>,
}

/// One property of a resolved struct.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct VfxField {
    /// `0x` and eight hex digits.
    pub hash: String,
    /// The property as the tables name it. Absent where no table does.
    pub name: Option<String>,
    /// What the property holds, resolved.
    pub value: VfxValue,
}

/// One entry of a resolved map.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct VfxMapEntry {
    /// A named hash key by its name, an unnamed one as hex, and every other kind as the
    /// wire form writes it.
    pub key: String,
    /// What the entry holds, resolved.
    pub value: VfxValue,
}
