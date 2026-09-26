//! A leaf edit on an open bin, and the save that writes it. ADR-0040.

use std::collections::VecDeque;
use std::fmt;
use std::io::Cursor;
use std::mem;
use std::path::Path;
use std::str::FromStr;

use fs_err as fs;
use glam::{Mat4, Vec2, Vec3, Vec4};
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::property::{Kind, ValueMut, values};
use ltk_meta::{BinDelta, BinFile, BinObject, BinStream, PropertyValueEnum};
use serde::{Deserialize, Serialize};

use super::properties::field_path;
use super::{BinDocument, BinDocumentError, Declaring, PropertyKind, Step, hex, inlines, is_null};
use crate::error::AppResult;
use crate::preview::AssetRef;
use crate::utils::fs::atomic_write;

/// How many edits one tree reverts. "Undo" in docs/ux/BIN_EDITOR.md.
pub const UNDO_DEPTH: usize = 200;

/// One edit as an undo stack holds it. Applying one answers the edit that reverts it.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Edit {
    /// Replace an existing property's complete value.
    ReplaceProperty {
        entry: BinHash,
        path: String,
        value: PropertyValueEnum,
    },
    /// Set the leaf at `path` to `value`.
    Leaf {
        entry: BinHash,
        path: String,
        value: LeafValue,
    },
    /// Put `value` under `field` into the holder at `holder`, at `index`.
    InsertProperty {
        entry: BinHash,
        holder: String,
        field: BinHash,
        index: usize,
        value: PropertyValueEnum,
    },
    /// Take the property at `path` out of its holder.
    RemoveProperty { entry: BinHash, path: String },
    /// Put `value` into the list, map or option at `holder`, at `index`, under `key` in a map.
    InsertItem {
        entry: BinHash,
        holder: String,
        index: usize,
        key: Option<PropertyValueEnum>,
        value: PropertyValueEnum,
    },
    /// Take the item at `path` out of its list, map or option.
    RemoveItem { entry: BinHash, path: String },
    /// Move the item at `path` to `to` in its list.
    MoveItem {
        entry: BinHash,
        path: String,
        to: usize,
    },
    /// Set the key of the map entry at `path` to `key`.
    SetKey {
        entry: BinHash,
        path: String,
        key: PropertyValueEnum,
    },
    /// Set the pointer at `path` to `value`.
    SetPointer {
        entry: BinHash,
        path: String,
        value: values::Struct,
    },
    /// Set the header's dependency list to `paths`.
    Dependencies { paths: Vec<String> },
}

/// Which way a step through an edit history goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HistoryStep {
    /// Revert the latest edit.
    Undo,
    /// Apply the latest reverted edit again.
    Redo,
}

/// How an undo or a redo moved the rows of a tree, so a reader's expanded rows follow them.
///
/// Paths are relative to the object `entry` names, `0x` and eight hex digits, as a row's are.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum Reshape {
    /// Values or properties changed and no row moved.
    InPlace,
    /// An item went into the list, map or option at `holder`, at `index`.
    Inserted {
        entry: String,
        holder: String,
        index: usize,
    },
    /// The property or item at `path` went out.
    Removed { entry: String, path: String },
    /// The item at `path` moved to `to` in its list.
    Moved {
        entry: String,
        path: String,
        to: usize,
    },
    /// The map entry at `from` is now at `to`.
    Rekeyed {
        entry: String,
        from: String,
        to: String,
    },
    /// The pointer at `path` holds null, and no row under it stays.
    Nulled { entry: String, path: String },
}

impl Reshape {
    /// How applying `edit` moves the rows. A rekey's destination is filled by [`Self::landed`].
    fn of(edit: &Edit) -> Self {
        match edit {
            Edit::InsertItem {
                entry,
                holder,
                index,
                ..
            } => Self::Inserted {
                entry: hex(*entry),
                holder: holder.clone(),
                index: *index,
            },
            Edit::RemoveItem { entry, path } | Edit::RemoveProperty { entry, path } => {
                Self::Removed {
                    entry: hex(*entry),
                    path: path.clone(),
                }
            }
            Edit::MoveItem { entry, path, to } => Self::Moved {
                entry: hex(*entry),
                path: path.clone(),
                to: *to,
            },
            Edit::SetKey { entry, path, .. } => Self::Rekeyed {
                entry: hex(*entry),
                from: path.clone(),
                to: String::new(),
            },
            Edit::SetPointer { entry, path, value } if is_null(value) => Self::Nulled {
                entry: hex(*entry),
                path: path.clone(),
            },
            Edit::ReplaceProperty { .. }
            | Edit::Leaf { .. }
            | Edit::InsertProperty { .. }
            | Edit::SetPointer { .. }
            | Edit::Dependencies { .. } => Self::InPlace,
        }
    }

    /// The reshape with a rekey's destination read from `inverse`, the edit that reverts it.
    fn landed(self, inverse: &Edit) -> Self {
        match (self, inverse) {
            (Self::Rekeyed { entry, from, .. }, Edit::SetKey { path, .. }) => Self::Rekeyed {
                entry,
                from,
                to: path.clone(),
            },
            (reshape, _) => reshape,
        }
    }
}

/// The value a leaf edit sets, in the shape its widget holds.
///
/// A hash, a link and a file carry the text the reader typed: a name, or the hex the row
/// draws.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum LeafValue {
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
    /// A name, or `0x` and eight hex digits.
    Hash {
        text: String,
    },
    /// A chunk path, or sixteen hex digits.
    WadChunkLink {
        text: String,
    },
    /// An object path, or `0x` and eight hex digits.
    ObjectLink {
        text: String,
    },
}

/// Why a leaf edit's value does not fit the node it addresses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "reason",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum EditRejection {
    /// The node holds no value an edit sets: a container, a struct or an absent optional.
    NotALeaf,
    /// The value is of another kind than the leaf.
    WrongKind { kind: PropertyKind },
    /// An integer the leaf's kind does not hold.
    OutOfRange { kind: PropertyKind },
    /// A float that is NaN or an infinity.
    NotFinite,
    /// A vector or a matrix of another number of components than the leaf holds.
    WrongLength { expected: u8 },
    /// A hash text that is empty, or hex of another width.
    MalformedHash,
    /// The node holds no properties: a leaf, a container, or a null pointer.
    NotAHolder,
    /// The path ends in no property of a holder.
    NotAProperty,
    /// The holder writes the field already.
    PropertyExists,
    /// The schema declares no such field on the holder's class or its bases.
    UndeclaredField,
    /// An embed names no class.
    MissingClass,
    /// The kinds build no value: a container of nothing, or a kind a container cannot hold.
    InvalidShape,
    /// The node holds no items: it is no list, map or option.
    NotAList,
    /// The path ends in no item of a list, a map or an option.
    NotAnItem,
    /// The node is no pointer.
    NotAPointer,
    /// Another entry of the map holds the key.
    KeyExists,
    /// A map entry names no key.
    MissingKey,
    /// The option or the pointer holds a value already.
    ValueHeld,
    /// The list holds no such position.
    NoSuchIndex,
    /// A dependency path that is empty.
    EmptyPath,
    /// A dependency typed in brex that does not expand to one path.
    MalformedBrex,
    /// The list names the dependency already.
    DependencyExists,
    /// The path runs through a field no table names, or a key a map holds twice, which no
    /// declaration spells. ADR-0042.
    NamelessPath,
    /// No declaration expresses the edit. ADR-0042.
    Undeclarable,
    /// The schema gives no type for a property the game's copy omits, as at a game build
    /// newer than the meta database. ADR-0042.
    Untypable,
    /// The chunk holds an object of that name.
    ObjectExists,
}

impl fmt::Display for EditRejection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotALeaf => f.write_str("the node holds no leaf"),
            Self::WrongKind { kind } => write!(f, "the leaf is a {}", kind.tag()),
            Self::OutOfRange { kind } => write!(f, "the value is no {}", kind.tag()),
            Self::NotFinite => f.write_str("the value is not finite"),
            Self::WrongLength { expected } => write!(f, "the leaf holds {expected} components"),
            Self::MalformedHash => f.write_str("the text is no name and no hash"),
            Self::NotAHolder => f.write_str("the node holds no properties"),
            Self::NotAProperty => f.write_str("the path ends in no property"),
            Self::PropertyExists => f.write_str("the holder writes the field already"),
            Self::UndeclaredField => f.write_str("the class declares no such field"),
            Self::MissingClass => f.write_str("the embed names no class"),
            Self::InvalidShape => f.write_str("the kinds build no value"),
            Self::NotAList => f.write_str("the node holds no items"),
            Self::NotAnItem => f.write_str("the path ends in no item"),
            Self::NotAPointer => f.write_str("the node is no pointer"),
            Self::KeyExists => f.write_str("the map holds the key already"),
            Self::MissingKey => f.write_str("the entry names no key"),
            Self::ValueHeld => f.write_str("the node holds a value already"),
            Self::NoSuchIndex => f.write_str("the list holds no such position"),
            Self::EmptyPath => f.write_str("the path is empty"),
            Self::MalformedBrex => f.write_str("the brex spelling expands to no path"),
            Self::DependencyExists => f.write_str("the list names the dependency already"),
            Self::NamelessPath => f.write_str("no declaration spells the path"),
            Self::Undeclarable => f.write_str("no declaration expresses the edit"),
            Self::Untypable => f.write_str("the schema types no such property at this build"),
            Self::ObjectExists => f.write_str("the chunk holds an object of that name"),
        }
    }
}

/// Why a document takes no edit. "Where editing is allowed" in docs/ux/BIN_EDITOR.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub enum ReadOnly {
    /// A chunk of the installed game.
    Install,
    /// A file outside every project.
    Loose,
    /// A `PTCH` layer. No edit writes a patch record.
    Patch,
    /// A game chunk inside a project whose game data declarations are off. ADR-0042.
    DeclarationsOff,
}

impl fmt::Display for ReadOnly {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Install => "a file of the installed game",
            Self::Loose => "a file outside every project",
            Self::Patch => "a patch layer",
            Self::DeclarationsOff => "a game file of a project with declarations off",
        })
    }
}

impl BinDocument {
    /// The gate `asset` stands behind, or `None` where the document takes edits.
    #[must_use]
    pub fn read_only(&self, asset: &AssetRef) -> Option<ReadOnly> {
        match (asset, &self.file) {
            (AssetRef::GameChunk { .. }, _) => match self.declaring() {
                Some(Declaring::On) => None,
                Some(Declaring::Off) => Some(ReadOnly::DeclarationsOff),
                None => Some(ReadOnly::Install),
            },
            (AssetRef::File { .. }, _) => Some(ReadOnly::Loose),
            (AssetRef::Layer { .. }, BinFile::Override(_)) => Some(ReadOnly::Patch),
            (AssetRef::Layer { .. }, BinFile::Prop(_)) => None,
        }
    }

    /// Whether an edit of the document lands as a declaration. ADR-0042.
    #[must_use]
    pub fn declares(&self) -> bool {
        self.declared.is_some()
    }

    /// Whether a patch touched the tree since the base was read.
    #[must_use]
    pub fn is_dirty(&self) -> bool {
        !self.touched.is_empty() || self.dependencies_touched
    }

    /// Set the leaf at `path` under `entry` to `value`, answering the value it held.
    ///
    /// `path` is the wire form of ADR-0027. A present optional that draws its value on
    /// its own row sets that value.
    ///
    /// The edit joins the undo stack and empties the redo stack.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::NodeNotFound`] where the path reaches nothing,
    /// and with [`BinDocumentError::EditRejected`] where `value` does not fit the leaf.
    /// A failed edit leaves the tree as it was.
    pub fn set_leaf(
        &mut self,
        entry: BinHash,
        path: &str,
        value: LeafValue,
    ) -> Result<LeafValue, BinDocumentError> {
        let held = self.apply_leaf(entry, path, value)?;
        self.record(Edit::Leaf {
            entry,
            path: path.to_owned(),
            value: held.clone(),
        })?;
        Ok(held)
    }

    /// Push the edit that reverts the latest one, and empty the redo stack. A declared
    /// document declares the edit instead (ADR-0042).
    ///
    /// # Errors
    ///
    /// What [`BinDocument::declare_edit`] raises, which leaves the tree as it was.
    pub(super) fn record(&mut self, inverse: Edit) -> Result<(), BinDocumentError> {
        if self.declares() {
            return self.declare_edit(&inverse);
        }
        push_bounded(&mut self.undo, inverse);
        self.redo.clear();
        Ok(())
    }

    /// Revert the latest edit, answering whether one was held. The revert joins the redo
    /// stack.
    ///
    /// # Errors
    ///
    /// Fails as [`BinDocument::set_leaf`] does, which no edit the stack took can.
    pub fn undo(&mut self) -> Result<bool, BinDocumentError> {
        self.step(HistoryStep::Undo)
            .map(|reshape| reshape.is_some())
    }

    /// Apply the latest undone edit again, answering whether one was held.
    ///
    /// # Errors
    ///
    /// As [`BinDocument::undo`].
    pub fn redo(&mut self) -> Result<bool, BinDocumentError> {
        self.step(HistoryStep::Redo)
            .map(|reshape| reshape.is_some())
    }

    /// Take one step through the history, answering how the rows moved, or `None` where the
    /// stack held nothing. A declared document restores manifest text, and its rows stay.
    ///
    /// # Errors
    ///
    /// As [`BinDocument::undo`].
    pub fn step(&mut self, step: HistoryStep) -> Result<Option<Reshape>, BinDocumentError> {
        if self.declares() {
            let held = match step {
                HistoryStep::Undo => self.undo_declared()?,
                HistoryStep::Redo => self.redo_declared()?,
            };
            return Ok(held.then_some(Reshape::InPlace));
        }

        let popped = match step {
            HistoryStep::Undo => self.undo.pop_back(),
            HistoryStep::Redo => self.redo.pop(),
        };
        let Some(edit) = popped else {
            return Ok(None);
        };

        let reshape = Reshape::of(&edit);
        let inverse = self.apply(edit)?;
        let reshape = reshape.landed(&inverse);

        match step {
            HistoryStep::Undo => self.redo.push(inverse),
            HistoryStep::Redo => push_bounded(&mut self.undo, inverse),
        }
        Ok(Some(reshape))
    }

    /// Apply `edit` and mark its object touched, answering the edit that reverts it. Both
    /// stacks are left alone.
    fn apply(&mut self, edit: Edit) -> Result<Edit, BinDocumentError> {
        match edit {
            Edit::ReplaceProperty { entry, path, value } => self.swap_property(entry, &path, value),
            Edit::Leaf { entry, path, value } => {
                let held = self.apply_leaf(entry, &path, value)?;
                Ok(Edit::Leaf {
                    entry,
                    path,
                    value: held,
                })
            }
            Edit::InsertProperty {
                entry,
                holder,
                field,
                index,
                value,
            } => {
                self.insert_property(entry, &holder, field, Some(index), value)?;
                Ok(Edit::RemoveProperty {
                    entry,
                    path: field_path(&holder, field),
                })
            }
            Edit::RemoveProperty { entry, path } => self.take_property(entry, &path),
            Edit::InsertItem {
                entry,
                holder,
                index,
                key,
                value,
            } => self.put_item(entry, &holder, Some(index), key, value),
            Edit::RemoveItem { entry, path } => self.take_item(entry, &path),
            Edit::MoveItem { entry, path, to } => self.shift_item(entry, &path, to),
            Edit::SetKey { entry, path, key } => self.swap_key(entry, &path, key),
            Edit::SetPointer { entry, path, value } => self.swap_pointer(entry, &path, value),
            Edit::Dependencies { paths } => self.swap_dependencies(paths),
        }
    }

    /// Set a leaf and mark its object touched, leaving both stacks alone.
    pub(super) fn apply_leaf(
        &mut self,
        entry: BinHash,
        path: &str,
        value: LeafValue,
    ) -> Result<LeafValue, BinDocumentError> {
        let address = || format!("{}:{path}", hex(entry));
        let not_found = || BinDocumentError::NodeNotFound { address: address() };
        let steps = super::parse_steps(path).ok_or_else(not_found)?;
        let object = self
            .file
            .objects_mut()
            .get_mut(&entry)
            .ok_or_else(not_found)?;

        let held = edit_node(object, &steps, |leaf| set(leaf, value))
            .ok_or_else(not_found)?
            .map_err(|rejection| BinDocumentError::EditRejected {
                address: address(),
                rejection,
            })?;
        self.touched.insert(entry);
        Ok(held)
    }

    /// Write the tree to `path`, the file the document opened. ADR-0040.
    ///
    /// Nothing is written while no patch touched the tree. The written bytes become the
    /// base.
    ///
    /// # Errors
    ///
    /// Fails with [`BinDocumentError::ChangedOnDisk`] where the file holds other bytes
    /// than the base, with [`BinDocumentError::Unwritable`] where the tree does not
    /// encode, and with I/O errors from the read and the write. A failed save keeps the
    /// edits.
    pub fn save_to(&mut self, path: &Path) -> AppResult<()> {
        if !self.is_dirty() {
            return Ok(());
        }
        if fs::read(path)? != self.base {
            return Err(BinDocumentError::ChangedOnDisk.into());
        }
        let bytes = self.encode()?;
        atomic_write(path, &bytes)?;
        self.base = bytes;
        self.touched.clear();
        self.dependencies_touched = false;
        Ok(())
    }

    /// The file as a save writes it: every touched object over the base.
    fn encode(&self) -> Result<Vec<u8>, BinDocumentError> {
        let BinFile::Prop(bin) = &self.file else {
            return Err(BinDocumentError::ReadOnly(ReadOnly::Patch));
        };
        let unwritable = BinDocumentError::Unwritable;

        let mut stream =
            BinStream::<_>::mount(Cursor::new(self.base.as_slice())).map_err(unwritable)?;
        let mut out = Vec::with_capacity(self.base.len());
        let mut delta = BinDelta::new();
        for object in self.touched.iter().filter_map(|hash| bin.objects.get(hash)) {
            delta.replace(object.clone());
        }
        if self.dependencies_touched {
            delta.set_dependencies(bin.dependencies.iter().cloned());
        }
        stream.write_patched(&delta, &mut out).map_err(unwritable)?;
        Ok(out)
    }
}

/// Push `edit` onto `stack`, dropping the oldest past [`UNDO_DEPTH`].
fn push_bounded(stack: &mut VecDeque<Edit>, edit: Edit) {
    if stack.len() == UNDO_DEPTH {
        stack.pop_front();
    }
    stack.push_back(edit);
}

/// Run `edit` on the value `steps` reach under `object`, or `None` where a step reaches
/// nothing. The object itself is no value, so an empty path reaches nothing.
pub(super) fn edit_node<R>(
    object: &mut BinObject,
    steps: &[Step],
    edit: impl FnOnce(ValueMut<'_>) -> R,
) -> Option<R> {
    let (Step::Field(field), rest) = steps.split_first()? else {
        return None;
    };
    edit_under(object.properties.get_mut(field)?.as_mut(), rest, edit)
}

/// [`edit_node`] from one value down.
///
/// A container, a map and an optional hand out a slot pinned to their item kind rather
/// than a plain borrow, so the walk recurses through each slot it takes.
pub(super) fn edit_under<R>(
    value: ValueMut<'_>,
    steps: &[Step],
    edit: impl FnOnce(ValueMut<'_>) -> R,
) -> Option<R> {
    let Some((step, rest)) = steps.split_first() else {
        return Some(edit(value));
    };
    match (step, value) {
        (Step::Field(field), ValueMut::Embedded(values::Embedded(inner))) => {
            edit_under(inner.properties.get_mut(field)?.as_mut(), rest, edit)
        }
        (Step::Field(field), ValueMut::Struct(inner)) if !is_null(inner) => {
            edit_under(inner.properties.get_mut(field)?.as_mut(), rest, edit)
        }
        (Step::Index(index), ValueMut::Container(items))
        | (Step::Index(index), ValueMut::UnorderedContainer(values::UnorderedContainer(items))) => {
            edit_under(items.slot(*index)?.as_mut(), rest, edit)
        }
        (Step::Index(0), ValueMut::Optional(optional)) => {
            edit_under(optional.slot()?.as_mut(), rest, edit)
        }
        (Step::Key(held), ValueMut::Map(map)) => {
            let at = held.position(map.entries())?;
            edit_under(map.slot(at)?.as_mut(), rest, edit)
        }
        _ => None,
    }
}

/// Set `leaf` to `value`, answering the value it held.
pub(super) fn set(leaf: ValueMut<'_>, value: LeafValue) -> Result<LeafValue, EditRejection> {
    use LeafValue as V;
    match (leaf, value) {
        (ValueMut::Optional(optional), value) => {
            let inline = optional.value().is_some_and(inlines);
            match optional.slot() {
                Some(mut slot) if inline => set(slot.as_mut(), value),
                _ => Err(EditRejection::NotALeaf),
            }
        }
        (ValueMut::Bool(leaf), V::Bool { value }) => Ok(V::Bool {
            value: mem::replace(&mut leaf.value, value),
        }),
        (ValueMut::BitBool(leaf), V::Bool { value }) => Ok(V::Bool {
            value: mem::replace(&mut leaf.value, value),
        }),
        (ValueMut::I8(leaf), V::Integer { text }) => integer(&mut leaf.value, &text, Kind::I8),
        (ValueMut::U8(leaf), V::Integer { text }) => integer(&mut leaf.value, &text, Kind::U8),
        (ValueMut::I16(leaf), V::Integer { text }) => integer(&mut leaf.value, &text, Kind::I16),
        (ValueMut::U16(leaf), V::Integer { text }) => integer(&mut leaf.value, &text, Kind::U16),
        (ValueMut::I32(leaf), V::Integer { text }) => integer(&mut leaf.value, &text, Kind::I32),
        (ValueMut::U32(leaf), V::Integer { text }) => integer(&mut leaf.value, &text, Kind::U32),
        (ValueMut::I64(leaf), V::Integer { text }) => integer(&mut leaf.value, &text, Kind::I64),
        (ValueMut::U64(leaf), V::Integer { text }) => integer(&mut leaf.value, &text, Kind::U64),
        (ValueMut::F32(leaf), V::Float { value }) => {
            let [value] = components(&[value])?;
            Ok(V::Float {
                value: mem::replace(&mut leaf.value, value),
            })
        }
        (ValueMut::Vector2(leaf), V::Vector { values }) => {
            let next = Vec2::from_array(components(&values)?);
            Ok(vector(mem::replace(&mut leaf.value, next).to_array()))
        }
        (ValueMut::Vector3(leaf), V::Vector { values }) => {
            let next = Vec3::from_array(components(&values)?);
            Ok(vector(mem::replace(&mut leaf.value, next).to_array()))
        }
        (ValueMut::Vector4(leaf), V::Vector { values }) => {
            let next = Vec4::from_array(components(&values)?);
            Ok(vector(mem::replace(&mut leaf.value, next).to_array()))
        }
        (ValueMut::Matrix44(leaf), V::Matrix { values }) => {
            /* Row-major on the wire, as the row projection writes a matrix. */
            let next = Mat4::from_cols_array(&components(&values)?).transpose();
            let held = mem::replace(&mut leaf.value, next);
            Ok(V::Matrix {
                values: held.transpose().to_cols_array().to_vec(),
            })
        }
        (ValueMut::Color(leaf), V::Color { r, g, b, a }) => {
            let color = &mut leaf.value;
            Ok(V::Color {
                r: mem::replace(&mut color.r, r),
                g: mem::replace(&mut color.g, g),
                b: mem::replace(&mut color.b, b),
                a: mem::replace(&mut color.a, a),
            })
        }
        (ValueMut::String(leaf), V::String { value }) => Ok(V::String {
            value: mem::replace(&mut leaf.value, value),
        }),
        (ValueMut::Hash(leaf), V::Hash { text }) => Ok(V::Hash {
            text: hex(mem::replace(&mut leaf.value, bin_hash(&text)?)),
        }),
        (ValueMut::ObjectLink(leaf), V::ObjectLink { text }) => Ok(V::ObjectLink {
            text: hex(mem::replace(&mut leaf.value, bin_hash(&text)?)),
        }),
        (ValueMut::WadChunkLink(leaf), V::WadChunkLink { text }) => {
            let held = mem::replace(&mut leaf.value, wad_hash(&text)?);
            Ok(V::WadChunkLink {
                text: format!("{:016x}", held.0),
            })
        }
        (leaf, _) => Err(match leaf.kind() {
            Kind::None
            | Kind::Container
            | Kind::UnorderedContainer
            | Kind::Struct
            | Kind::Embedded
            | Kind::Map
            | Kind::Optional => EditRejection::NotALeaf,
            kind => EditRejection::WrongKind { kind: kind.into() },
        }),
    }
}

/// Parse `text` into the integer `slot` holds, answering what it held.
fn integer<T: FromStr + fmt::Display>(
    slot: &mut T,
    text: &str,
    kind: Kind,
) -> Result<LeafValue, EditRejection> {
    let next = text
        .trim()
        .parse()
        .map_err(|_| EditRejection::OutOfRange { kind: kind.into() })?;
    Ok(LeafValue::Integer {
        text: mem::replace(slot, next).to_string(),
    })
}

/// `values` as `N` finite components.
fn components<const N: usize>(values: &[f32]) -> Result<[f32; N], EditRejection> {
    let cells = <[f32; N]>::try_from(values).map_err(|_| EditRejection::WrongLength {
        expected: u8::try_from(N).expect("a leaf holds at most sixteen components"),
    })?;
    if cells.iter().all(|cell| cell.is_finite()) {
        Ok(cells)
    } else {
        Err(EditRejection::NotFinite)
    }
}

fn vector<const N: usize>(values: [f32; N]) -> LeafValue {
    LeafValue::Vector {
        values: values.to_vec(),
    }
}

/// The hash `0x` and eight hex digits write, or the hash of a name.
pub(super) fn bin_hash(text: &str) -> Result<BinHash, EditRejection> {
    let text = text.trim();
    if let Some(digits) = text.strip_prefix("0x") {
        return hex_digits(digits, 8)
            .map(|hash| BinHash(u32::try_from(hash).expect("eight hex digits fit a u32")));
    }
    if text.is_empty() {
        return Err(EditRejection::MalformedHash);
    }
    Ok(BinHash::hash_str(text))
}

/// The hash sixteen hex digits write, or the hash of a chunk path.
fn wad_hash(text: &str) -> Result<WadHash, EditRejection> {
    let text = text.trim();
    if text.len() == 16 && text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return hex_digits(text, 16).map(WadHash);
    }
    if text.is_empty() {
        return Err(EditRejection::MalformedHash);
    }
    Ok(WadHash::hash_str(text))
}

fn hex_digits(digits: &str, width: usize) -> Result<u64, EditRejection> {
    if digits.len() != width || !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(EditRejection::MalformedHash);
    }
    u64::from_str_radix(digits, 16).map_err(|_| EditRejection::MalformedHash)
}

#[cfg(test)]
mod tests;
