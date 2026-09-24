//! What an apply of a declared document reports, on the rows it names. "Declaring from a game
//! bin" in docs/ux/BIN_EDITOR.md.

use ltk_game_data::{
    ApplyDiagnostic, ApplyDiagnosticKind, Edit, EntryName, ObjectSkipReason, PropertyPath,
    PropertySkipReason, Sign,
};
use ltk_meta::Bin;
use serde::Serialize;

use super::super::hex;
use super::wire_path;

/// One diagnostic of the last apply, on the row it names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct DeclaredDiagnostic {
    /// The object's path hash, `0x` and eight hex digits. Empty where the diagnostic names no
    /// object of the chunk.
    pub entry: String,
    /// The row's path on the wire. Empty where the key reaches no row, which lists the
    /// diagnostic under its object.
    pub path: String,
    /// The layer whose declaration raised it.
    pub layer: String,
    /// The signed key, the link path or the override path the diagnostic is about.
    pub key: String,
    pub kind: DeclaredDiagnosticKind,
    /// Why a property edit was skipped. Absent for every other kind.
    pub reason: Option<SkipReason>,
    /// Why an object's creation or removal was skipped. Absent for every other kind.
    pub object: Option<ObjectSkip>,
    /// What a lower layer said, where it said something the codes do not carry.
    pub detail: Option<String>,
}

/// The category of a [`DeclaredDiagnostic`], as `ltk_game_data` names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum DeclaredDiagnosticKind {
    OverrideUnreadable,
    OverrideInvalid,
    OverrideRecordSkipped,
    LinkRemovalUnmatched,
    PropertyEditSkipped,
    /// A property typed from the game's copy, the schema saying nothing. Information.
    SchemaFallback,
    ReferenceUnreadable,
    /// An object's creation or removal that does not apply.
    ObjectSkipped,
    Unknown,
}

impl From<ApplyDiagnosticKind> for DeclaredDiagnosticKind {
    fn from(kind: ApplyDiagnosticKind) -> Self {
        match kind {
            ApplyDiagnosticKind::OverrideUnreadable => Self::OverrideUnreadable,
            ApplyDiagnosticKind::OverrideInvalid => Self::OverrideInvalid,
            ApplyDiagnosticKind::OverrideRecordSkipped => Self::OverrideRecordSkipped,
            ApplyDiagnosticKind::LinkRemovalUnmatched => Self::LinkRemovalUnmatched,
            ApplyDiagnosticKind::PropertyEditSkipped => Self::PropertyEditSkipped,
            ApplyDiagnosticKind::SchemaFallback => Self::SchemaFallback,
            ApplyDiagnosticKind::ReferenceUnreadable => Self::ReferenceUnreadable,
            ApplyDiagnosticKind::ObjectSkipped => Self::ObjectSkipped,
            _ => Self::Unknown,
        }
    }
}

/// Why a property edit does not apply, as `ltk_game_data` names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum SkipReason {
    MissingObject,
    MissingProperty,
    NullPointer,
    CannotDescend,
    NotIndexable,
    IndexOutOfRange,
    InvalidKey,
    KeyNotFound,
    TypeMismatch,
    InvalidPath,
    Untypable,
    UnknownClass,
    PinMismatch,
    SignOnScalar,
    ContainerAbsent,
    RemovalUnmatched,
    KindMismatch,
    OutOfRange,
    PrecisionLoss,
    ArityMismatch,
    ReferenceMissingEntry,
    ReferenceUnresolved,
    Unknown,
}

impl From<PropertySkipReason> for SkipReason {
    fn from(reason: PropertySkipReason) -> Self {
        use PropertySkipReason as R;
        match reason {
            R::MissingObject => Self::MissingObject,
            R::MissingProperty => Self::MissingProperty,
            R::NullPointer => Self::NullPointer,
            R::CannotDescend => Self::CannotDescend,
            R::NotIndexable => Self::NotIndexable,
            R::IndexOutOfRange => Self::IndexOutOfRange,
            R::InvalidKey => Self::InvalidKey,
            R::KeyNotFound => Self::KeyNotFound,
            R::TypeMismatch => Self::TypeMismatch,
            R::InvalidPath => Self::InvalidPath,
            R::Untypable => Self::Untypable,
            R::UnknownClass => Self::UnknownClass,
            R::PinMismatch => Self::PinMismatch,
            R::SignOnScalar => Self::SignOnScalar,
            R::ContainerAbsent => Self::ContainerAbsent,
            R::RemovalUnmatched => Self::RemovalUnmatched,
            R::KindMismatch => Self::KindMismatch,
            R::OutOfRange => Self::OutOfRange,
            R::PrecisionLoss => Self::PrecisionLoss,
            R::ArityMismatch => Self::ArityMismatch,
            R::ReferenceMissingEntry => Self::ReferenceMissingEntry,
            R::ReferenceUnresolved => Self::ReferenceUnresolved,
            _ => Self::Unknown,
        }
    }
}

/// Why an object edit does not apply, as `ltk_game_data` names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ObjectSkip {
    ObjectExists,
    SourceMissing,
    UnknownClass,
    RemovalUnmatched,
    Unknown,
}

impl From<ObjectSkipReason> for ObjectSkip {
    fn from(reason: ObjectSkipReason) -> Self {
        match reason {
            ObjectSkipReason::ObjectExists => Self::ObjectExists,
            ObjectSkipReason::SourceMissing => Self::SourceMissing,
            ObjectSkipReason::UnknownClass => Self::UnknownClass,
            ObjectSkipReason::RemovalUnmatched => Self::RemovalUnmatched,
            _ => Self::Unknown,
        }
    }
}

/// A diagnostic as an apply raised it, with what places it: its layer, and the entries of the
/// edit it counts from.
#[derive(Debug, Clone)]
pub(super) struct Raised {
    pub(super) layer: String,
    pub(super) entries: Vec<EntryName>,
    pub(super) diagnostic: ApplyDiagnostic,
}

impl Raised {
    /// The diagnostics of one apply over `edits`, each beside the entries of its edit.
    pub(super) fn of(layer: &str, edits: &[Edit], diagnostics: Vec<ApplyDiagnostic>) -> Vec<Self> {
        diagnostics
            .into_iter()
            .map(|diagnostic| Self {
                layer: layer.to_owned(),
                entries: edits
                    .get(diagnostic.edit_index)
                    .map(|edit| edit.entries.keys().cloned().collect())
                    .unwrap_or_default(),
                diagnostic,
            })
            .collect()
    }

    /// The diagnostic on the row of `applied` it names.
    pub(super) fn place(&self, applied: &Bin) -> DeclaredDiagnostic {
        let diagnostic = &self.diagnostic;
        let path = PropertyPath::new(Sign::of(&diagnostic.path).1).ok();
        let reaches = |name: &EntryName| -> Option<String> {
            let object = applied.objects.get(&name.object_hash())?;
            wire_path(object, path.as_ref()?)
        };

        /* A skipped key names its entry, and a skipped object edit its object. Any other
        diagnostic counts from an edit, which an `entries` module lowers to one entry. */
        let named = diagnostic
            .property
            .as_ref()
            .map(|property| &property.entry)
            .or_else(|| diagnostic.object.as_ref().map(|object| &object.name));
        let (entry, row) = match named {
            Some(name) => (Some(name), reaches(name)),
            None => self
                .entries
                .iter()
                .find_map(|name| reaches(name).map(|row| (Some(name), Some(row))))
                .unwrap_or((self.entries.first(), None)),
        };

        DeclaredDiagnostic {
            entry: entry
                .filter(|name| applied.objects.contains_key(&name.object_hash()))
                .map(|name| hex(name.object_hash()))
                .unwrap_or_default(),
            path: row.unwrap_or_default(),
            layer: self.layer.clone(),
            key: diagnostic.path.clone(),
            kind: diagnostic.kind.into(),
            reason: diagnostic
                .property
                .as_ref()
                .map(|property| property.reason.into()),
            object: diagnostic
                .object
                .as_ref()
                .map(|object| object.reason.into()),
            detail: diagnostic.detail.clone(),
        }
    }
}

#[cfg(test)]
mod tests;
