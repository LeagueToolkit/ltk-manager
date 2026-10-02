//! The shapes a document's header and rows take for the frontend.

use ltk_meta::property::Kind;
use serde::{Deserialize, Serialize};

use super::{BinDocumentId, DeclaredState, ReadOnly};
use crate::meta_schema::KindShape;
use crate::object_index::ObjectDeclaration;
use crate::preview::AssetRef;
use crate::sandbox::SandboxRef;

/// How many rows one path of a projected read answers, the frontend's `PAGE_SIZE`.
pub(super) const READ_PAGE: usize = 500;

/// How many rows one projected read answers, past which it is refused.
///
/// Four pages. A layout batches its paths under it rather than reading a whole file in
/// one call, which is what keeps the answer a payload a viewport draws.
pub const READ_ROW_CAP: usize = 4 * READ_PAGE;

/// Which kind of bin file a document holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum BinFileKind {
    /// A `PROP`: the objects themselves.
    Prop,
    /// A `PTCH`: a layer over another bin.
    Patch,
}

/// What the header row says about an open bin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinHeader {
    pub kind: BinFileKind,
    /// The file version of a `PROP`. A `PTCH` carries none.
    pub version: Option<u32>,
    /// The objects the file declares. For a `PTCH`, the objects it adds.
    pub objects: usize,
    pub dependencies: Vec<Dependency>,
    /// The patch records of a `PTCH`.
    pub patches: usize,
    /// The objects a `PTCH` deletes, in file order.
    pub deleted: Vec<ObjectName>,
}

/// One dependency a `PROP` names, as its path and its brex spelling.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct Dependency {
    /// The archive path as the file writes it.
    pub path: String,
    /// The path in brex, which folds the repeated terms of a packed bin name. Absent where
    /// the path repeats nothing.
    pub packed: Option<String>,
}

impl Dependency {
    /// The dependency at `path`, with its brex spelling where that folds anything.
    #[must_use]
    pub fn new(path: String) -> Self {
        let packed = brex::encode(&path).ok().filter(|packed| *packed != path);

        Self { path, packed }
    }
}

/// One object by hash, and by path where a table names it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct ObjectName {
    /// The object's path hash, `0x` and eight hex digits.
    pub hash: String,
    /// The object's path. Absent where no table names it.
    pub name: Option<String>,
}

/// The facts an object tab's header draws. "The object tab" in docs/ux/BIN_EDITOR.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinObjectHeader {
    /// The object's path hash, `0x` and eight hex digits.
    pub entry: String,
    /// The object's path, or its hex where no table names it.
    pub name: String,
    /// The name is a hash no table names.
    pub unnamed: bool,
    /// `0x` and eight hex digits.
    pub class_hash: String,
    /// The class as the tables name it. Absent where no table does.
    pub class: Option<String>,
    /// How many properties the object holds.
    pub properties: usize,
}

impl BinObjectHeader {
    /// The object as a declaration of `asset`, the file the tab names `file`.
    ///
    /// A class no table names reads as its hex.
    #[must_use]
    pub fn declared_in(&self, asset: &AssetRef, file: &str) -> ObjectDeclaration {
        ObjectDeclaration {
            asset: asset.clone(),
            file: file.to_owned(),
            class: self
                .class
                .clone()
                .unwrap_or_else(|| self.class_hash.clone()),
            class_hash: self.class_hash.clone(),
        }
    }
}

/// What an open answers: the id, the header, and the rows at depth zero.
///
/// A file open answers one row per object. An open with an entry answers that object's
/// properties and its header facts (ADR-0028).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinDocumentHandle {
    pub document: BinDocumentId,
    /// The sandbox the document is held in. ADR-0056.
    pub sandbox: SandboxRef,
    /// The file the document was read from, and the file a save writes.
    ///
    /// Usually the asset the open asked for. When the open asked for a game chunk that a
    /// layer of the sandbox ships, this is that layer's file instead. ADR-0056.
    pub asset: AssetRef,
    pub header: BinHeader,
    pub rows: Vec<BinRow>,
    /// The object the open is over. Absent for a file open.
    pub object: Option<BinObjectHeader>,
    /// The gate a read-only document stands behind. Absent where it takes edits.
    pub read_only: Option<ReadOnly>,
    /// What a declared document says beside its rows. Absent for every other document.
    pub declared: Option<DeclaredState>,
}

/// A window of rows under one node, and how many there are in all.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinRows {
    pub rows: Vec<BinRow>,
    pub total: usize,
}

/// Where a row sits in the tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum RowNode {
    /// An object of the file.
    Object,
    /// A property of an object, a struct or an embedded.
    Property,
    /// One element of a container, or the value of a present optional.
    Element,
    /// One entry of a map.
    Entry,
    /// An object the patch records of a `PTCH` target, holding those records (ADR-0041).
    Target,
    /// One patch record of a `PTCH`.
    Record,
}

/// One row of the viewer, flat.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinRow {
    /// The object's path hash, `0x` and eight hex digits.
    pub entry: String,
    /// The hash path, every field a hash. Empty for the object itself,
    /// and `#` then the record's position under a patch target (ADR-0041).
    pub path: String,
    /// The same path for a person. Empty for the object itself, and the record's own path
    /// first under a patch record.
    pub label: String,
    pub node: RowNode,
    /// What the row is called: the object's path, the property's name, `[i]` or the key.
    pub name: String,
    /// The name is a hash no table names.
    pub unnamed: bool,
    /// The value's kind. An object row and a target row have none.
    pub kind: Option<PropertyKind>,
    pub value: BinValue,
    /// What the schema declares for the field at the install's build. Absent for an
    /// object, an element, an entry, and a field the schema has no line for.
    pub declared: Option<DeclaredKind>,
}

/// What the schema declares for a field, beside whether the file's kind is that.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct DeclaredKind {
    pub shape: KindShape,
    /// The file's kind is not the declared one, as the Problems rule for a property
    /// type reads the two.
    pub mismatch: bool,
}

/// The 27 kinds `ltk_meta` reads, as they cross IPC.
///
/// A mirror of [`Kind`], spelled in ritobin's words. The spelling is the tag a row
/// draws and the word a Problems finding writes. An upstream rename or addition is a
/// compile error here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum PropertyKind {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "bool")]
    Bool,
    #[serde(rename = "i8")]
    I8,
    #[serde(rename = "u8")]
    U8,
    #[serde(rename = "i16")]
    I16,
    #[serde(rename = "u16")]
    U16,
    #[serde(rename = "i32")]
    I32,
    #[serde(rename = "u32")]
    U32,
    #[serde(rename = "i64")]
    I64,
    #[serde(rename = "u64")]
    U64,
    #[serde(rename = "f32")]
    F32,
    #[serde(rename = "vec2")]
    Vector2,
    #[serde(rename = "vec3")]
    Vector3,
    #[serde(rename = "vec4")]
    Vector4,
    #[serde(rename = "mtx44")]
    Matrix44,
    #[serde(rename = "rgba")]
    Color,
    #[serde(rename = "string")]
    String,
    #[serde(rename = "hash")]
    Hash,
    #[serde(rename = "file")]
    WadChunkLink,
    #[serde(rename = "list")]
    Container,
    #[serde(rename = "list2")]
    UnorderedContainer,
    #[serde(rename = "pointer")]
    Struct,
    #[serde(rename = "embed")]
    Embedded,
    #[serde(rename = "link")]
    ObjectLink,
    #[serde(rename = "option")]
    Optional,
    #[serde(rename = "map")]
    Map,
    #[serde(rename = "flag")]
    BitBool,
}

impl PropertyKind {
    /// The kind in ritobin's word, which is its serialized spelling.
    ///
    /// The serde renames above spell the same words. A test holds the two lists equal.
    #[must_use]
    pub const fn tag(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Bool => "bool",
            Self::I8 => "i8",
            Self::U8 => "u8",
            Self::I16 => "i16",
            Self::U16 => "u16",
            Self::I32 => "i32",
            Self::U32 => "u32",
            Self::I64 => "i64",
            Self::U64 => "u64",
            Self::F32 => "f32",
            Self::Vector2 => "vec2",
            Self::Vector3 => "vec3",
            Self::Vector4 => "vec4",
            Self::Matrix44 => "mtx44",
            Self::Color => "rgba",
            Self::String => "string",
            Self::Hash => "hash",
            Self::WadChunkLink => "file",
            Self::Container => "list",
            Self::UnorderedContainer => "list2",
            Self::Struct => "pointer",
            Self::Embedded => "embed",
            Self::ObjectLink => "link",
            Self::Optional => "option",
            Self::Map => "map",
            Self::BitBool => "flag",
        }
    }
}

impl From<PropertyKind> for Kind {
    fn from(kind: PropertyKind) -> Self {
        match kind {
            PropertyKind::None => Self::None,
            PropertyKind::Bool => Self::Bool,
            PropertyKind::I8 => Self::I8,
            PropertyKind::U8 => Self::U8,
            PropertyKind::I16 => Self::I16,
            PropertyKind::U16 => Self::U16,
            PropertyKind::I32 => Self::I32,
            PropertyKind::U32 => Self::U32,
            PropertyKind::I64 => Self::I64,
            PropertyKind::U64 => Self::U64,
            PropertyKind::F32 => Self::F32,
            PropertyKind::Vector2 => Self::Vector2,
            PropertyKind::Vector3 => Self::Vector3,
            PropertyKind::Vector4 => Self::Vector4,
            PropertyKind::Matrix44 => Self::Matrix44,
            PropertyKind::Color => Self::Color,
            PropertyKind::String => Self::String,
            PropertyKind::Hash => Self::Hash,
            PropertyKind::WadChunkLink => Self::WadChunkLink,
            PropertyKind::Container => Self::Container,
            PropertyKind::UnorderedContainer => Self::UnorderedContainer,
            PropertyKind::Struct => Self::Struct,
            PropertyKind::Embedded => Self::Embedded,
            PropertyKind::ObjectLink => Self::ObjectLink,
            PropertyKind::Optional => Self::Optional,
            PropertyKind::Map => Self::Map,
            PropertyKind::BitBool => Self::BitBool,
        }
    }
}

impl From<Kind> for PropertyKind {
    fn from(kind: Kind) -> Self {
        match kind {
            Kind::None => Self::None,
            Kind::Bool => Self::Bool,
            Kind::I8 => Self::I8,
            Kind::U8 => Self::U8,
            Kind::I16 => Self::I16,
            Kind::U16 => Self::U16,
            Kind::I32 => Self::I32,
            Kind::U32 => Self::U32,
            Kind::I64 => Self::I64,
            Kind::U64 => Self::U64,
            Kind::F32 => Self::F32,
            Kind::Vector2 => Self::Vector2,
            Kind::Vector3 => Self::Vector3,
            Kind::Vector4 => Self::Vector4,
            Kind::Matrix44 => Self::Matrix44,
            Kind::Color => Self::Color,
            Kind::String => Self::String,
            Kind::Hash => Self::Hash,
            Kind::WadChunkLink => Self::WadChunkLink,
            Kind::Container => Self::Container,
            Kind::UnorderedContainer => Self::UnorderedContainer,
            Kind::Struct => Self::Struct,
            Kind::Embedded => Self::Embedded,
            Kind::ObjectLink => Self::ObjectLink,
            Kind::Optional => Self::Optional,
            Kind::Map => Self::Map,
            Kind::BitBool => Self::BitBool,
        }
    }
}

/// A row's value, in the shape its widget draws.
///
/// A hash rides beside the name a table gave it. A person reads the name and a Copy
/// takes the hash.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub enum BinValue {
    None,
    /// A `Bool` or a `BitBool`.
    Bool {
        value: bool,
    },
    /// Any integer kind, as text. A `U64` does not fit a JSON number.
    Integer {
        text: String,
    },
    Float {
        value: f32,
    },
    /// Two, three or four components.
    Vector {
        values: Vec<f32>,
    },
    /// Sixteen cells, row-major.
    Matrix {
        values: Vec<f32>,
    },
    Color {
        r: u8,
        g: u8,
        b: u8,
        a: u8,
    },
    String {
        value: String,
    },
    /// `0x` and eight hex digits, and the string behind it where a table names one.
    Hash {
        hash: String,
        name: Option<String>,
    },
    /// Sixteen hex digits, and the chunk's path where a table names one.
    WadChunkLink {
        hash: String,
        path: Option<String>,
    },
    /// `0x` and eight hex digits, and the object's path where a table names one.
    ObjectLink {
        hash: String,
        name: Option<String>,
    },
    /// A `Container` or an `UnorderedContainer`, and the kind of every item.
    Container {
        len: usize,
        item_kind: PropertyKind,
    },
    /// A `Struct` with a class, or an `Embedded`.
    Struct {
        class_hash: String,
        class: Option<String>,
        len: usize,
    },
    /// A `Struct` with a class hash of zero.
    Null,
    /// Whether a value is held, and the kind it is or would be.
    Optional {
        present: bool,
        item_kind: PropertyKind,
    },
    /// The entries, and the kinds the map declares for its keys and its values.
    Map {
        len: usize,
        key_kind: PropertyKind,
        value_kind: PropertyKind,
    },
    /// A leaf this build has no widget for.
    Undrawn,
    /// The patch records a `PTCH` writes to one object.
    Records {
        len: usize,
    },
}
