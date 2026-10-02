//! One open bin: the tree the backend holds, and the rows it projects for a viewer.
//!
//! ADR-0026 puts the tree here and a window of rows in the frontend. ADR-0027 names a
//! node by the object's hash and the game's property path, every field a hash in the
//! hash path and a name for a person.

use std::fmt;

use serde::{Deserialize, Serialize};
use thiserror::Error;

mod changes;
mod clipboard;
mod declared;
mod dependencies;
mod document;
mod edit;
mod find;
mod items;
mod names;
mod path;
mod properties;
mod property_edit;
mod records;
mod requests;
pub(crate) mod resolve;
mod rows;
mod store;
mod typed_names;
mod types;

pub use changes::{BinChange, ChangeBaseline, ChangeKind, Originals};
pub use clipboard::{CLIPBOARD_FORMAT, clipboard_text, clipboard_value};
pub use declared::{
    BASE_LAYER, DeclareContext, DeclaredDiagnostic, DeclaredDiagnosticKind, DeclaredLinkMark,
    DeclaredMark, DeclaredModuleChoice, DeclaredModuleSummary, DeclaredObjectMark, DeclaredSign,
    DeclaredState, Declaring, GameCopy, LaidVariant, LayerOverride, LinkChange, NewObject,
    ObjectChange, ObjectSkip, ProjectDeclarations, RowDeclaration, SkipReason, VariantSource,
};
pub use edit::{EditRejection, HistoryStep, LeafValue, ReadOnly, Reshape, UNDO_DEPTH};
pub use find::{BinFindHit, BinFindResult, FIND_ROWS};
pub use items::{ClassChoice, NewItem};
pub use properties::{AddableField, AddableFields, NewProperty};
pub use property_edit::{PropertyEdit, ValueEdit};
pub use records::TARGET_PATH;
pub use requests::{BinEdit, ChoiceQuery, Choices, DependencyEdit, EditOutcome, ObjectEdit};

pub use document::BinDocument;
pub use names::{ProjectNames, RowNames};
pub use resolve::{
    AssetLookup, Fields, Locator, NamedAsset, Namer, boolean, chunk_asset, entries, fields_of,
    float, hex, items, leaf, link, object_at, optional, owned, string_map, struct_entries,
    struct_of, text, unsigned, vector2, vector3, vector4,
};
pub use store::{BinDocuments, CAPACITY, DocumentRead};
pub use types::{
    BinDocumentHandle, BinFileKind, BinHeader, BinObjectHeader, BinRow, BinRows, BinValue,
    DeclaredKind, Dependency, ObjectName, PropertyKind, READ_ROW_CAP, RowNode,
};

use names::own_first;
pub(crate) use names::{Named, Wanted};
pub(crate) use path::{EntryKey, HashPath};
use path::{
    Node, Step, Trace, as_list, as_struct, descend, descend_from, dot, inlines, is_null, key_text,
    parse_steps,
};
pub(crate) use rows::Lens;
use rows::{Child, Segment, children_of, label_of};
use types::READ_PAGE;

/// The id one open of a document is addressed by.
///
/// An id is never reused within a process. A call carrying a closed id fails as
/// [`BinDocumentError::NotOpen`] and reaches no other document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
pub struct BinDocumentId(u32);

impl fmt::Display for BinDocumentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Why a document cannot be opened or read.
#[derive(Debug, Error)]
pub enum BinDocumentError {
    /// The bytes are not a bin the toolkit reads.
    #[error("not a readable bin: {0}")]
    Unreadable(#[from] ltk_meta::Error),

    /// The asset is a League client chunk, which the game's bin documents never reach.
    #[error("a League client chunk is not a game bin")]
    LcuChunk,

    /// No open document has this id. A close and an eviction both remove one.
    #[error("bin document {0} is not open")]
    NotOpen(BinDocumentId),

    /// No node of the document has this address.
    #[error("no node at {address}")]
    NodeNotFound { address: String },

    /// A projected read reached more rows than one call answers.
    #[error("a projected read of {rows} rows is over the cap of {cap}")]
    ReadTooWide { rows: usize, cap: usize },

    /// A resolved read reached more values than one call answers.
    #[error("a resolved read holds more values than one call answers")]
    ReadTooLarge,

    /// A resolved read nested deeper than one call answers.
    #[error("a resolved read nests deeper than one call answers")]
    ReadTooDeep,

    /// The document takes no edit.
    #[error("the bin is read-only as {0}")]
    ReadOnly(ReadOnly),

    /// An edit's value does not fit the node it addresses.
    #[error("the edit at {address} is refused: {rejection}")]
    EditRejected {
        address: String,
        rejection: EditRejection,
    },

    /// A later layer of the project declares the value a declared edit changes, so the build
    /// keeps that layer's value. ADR-0042.
    #[error("the edit at {address} is overridden by the layer {layer}")]
    Overridden { address: String, layer: String },

    /// The file on disk holds other bytes than the document opened.
    #[error("the bin changed on disk since it opened")]
    ChangedOnDisk,

    /// The edited tree does not encode.
    #[error("the bin does not encode: {0}")]
    Unwritable(#[source] ltk_meta::Error),

    /// A declared document's project, manifest or apply failed. ADR-0042.
    #[error("{0}")]
    Declaring(#[source] Box<crate::error::AppError>),
}

#[cfg(test)]
mod tests;
