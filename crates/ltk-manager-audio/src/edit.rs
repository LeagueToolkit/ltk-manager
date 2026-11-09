//! An event bank that takes edits: the bank, the media files it adds media to, its undo history
//! and the bytes that a save writes.
//!
//! "Editing" and "New objects" in `docs/ux/AUDIO.md`, and
//! `docs/adr/0071-an-event-bank-document-holds-its-media-files.md`. An edit changes, adds and
//! removes whole objects, so every other object keeps its bytes.

mod history;
mod ids;
mod media_file;
mod replace;
mod structure;

use std::collections::HashMap;

use ltk_manager_base::error::{AppError, DomainError, ErrorKind};
use ltk_wwise::bank::BankVersion;
use ltk_wwise::hierarchy::{
    Action, Container, ContainerFields, Object, ObjectKind, PlaylistItem, PropBundle, PropValue,
    PropertyId, Sound, StreamType, Typed,
};
use ltk_wwise::{Bank, BankId, ObjectId, SourceId};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use xxhash_rust::xxh64::xxh64;

use crate::bank_set::BankSet;
use crate::files::AudioFiles;
use crate::index::AudioIndex;
use history::{Change, Tx};

pub use media_file::MediaFile;
pub use replace::{MediaReplacement, ReplacedSound};

/// The most steps that the undo history keeps.
const HISTORY_DEPTH: usize = 100;

/// The weight of a playlist item that an added child takes, the Wwise default of 50.
const DEFAULT_WEIGHT: u32 = 50_000;

/// Bit 0 of the `bits` of a random or sequence container: a random pick reads the weights.
pub(crate) const USES_WEIGHTS: u8 = 1;

/// The milliseconds of a second, the unit of a Play action's `DelayTime`.
const MILLIS_PER_SECOND: f32 = 1000.0;

/// The highest value of the low-pass and the high-pass filters.
const FILTER_MAX: f32 = 100.0;

/// A property of a sound, a container or a Play action that an edit sets.
///
/// Each property is edited in the unit of Wwise's property table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum NodeProperty {
    /// `Volume`, in decibels.
    Volume,
    /// `Pitch`, in cents.
    Pitch,
    /// `LPF`, the low-pass filter from 0 to 100.
    Lpf,
    /// `HPF`, the high-pass filter from 0 to 100.
    Hpf,
    /// `MakeUpGain`, in decibels.
    MakeUpGain,
    /// The delay in seconds: `InitialDelay` of a node, `DelayTime` of a Play action.
    Delay,
    /// `Loop` of a sound: the number of plays, where zero loops forever.
    LoopCount,
}

impl NodeProperty {
    /// The properties that a sound takes.
    pub(crate) const SOUND: &[Self] = &[
        Self::Volume,
        Self::MakeUpGain,
        Self::Pitch,
        Self::Lpf,
        Self::Hpf,
        Self::Delay,
        Self::LoopCount,
    ];

    /// The properties that a container takes.
    pub(crate) const CONTAINER: &[Self] = &[
        Self::Volume,
        Self::MakeUpGain,
        Self::Pitch,
        Self::Lpf,
        Self::Hpf,
        Self::Delay,
    ];

    /// The properties that a Play action takes.
    pub(crate) const PLAY: &[Self] = &[Self::Delay];

    /// Returns the value that an object without the property plays with.
    fn default_value(self) -> f32 {
        match self {
            Self::LoopCount => 1.0,
            Self::Volume | Self::MakeUpGain | Self::Pitch | Self::Lpf | Self::Hpf | Self::Delay => {
                0.0
            }
        }
    }

    /// Returns the property ID of a node's bundle.
    fn node_id(self) -> PropertyId {
        match self {
            Self::Volume => PropertyId::VOLUME,
            Self::Pitch => PropertyId::PITCH,
            Self::Lpf => PropertyId::LPF,
            Self::Hpf => PropertyId::HPF,
            Self::MakeUpGain => PropertyId::MAKE_UP_GAIN,
            Self::Delay => PropertyId::INITIAL_DELAY,
            Self::LoopCount => PropertyId::LOOP,
        }
    }

    /// Returns the value of the property in `props` of a node, in the unit of the edit.
    pub(crate) fn of_node(self, props: &PropBundle) -> f32 {
        let id = self.node_id();
        let value = match self {
            #[expect(clippy::cast_precision_loss, reason = "a loop count is small")]
            Self::LoopCount => props.i32(id).map(|count| count as f32),
            Self::Volume | Self::MakeUpGain | Self::Pitch | Self::Lpf | Self::Hpf | Self::Delay => {
                props.f32(id)
            }
        };
        value.unwrap_or(self.default_value())
    }

    /// Returns the delay of a Play action's `props`, in seconds.
    #[expect(
        clippy::cast_precision_loss,
        reason = "a delay in milliseconds is small"
    )]
    pub(crate) fn action_delay(props: &PropBundle) -> f32 {
        props
            .i32(PropertyId::DELAY_TIME)
            .map_or(0.0, |millis| millis as f32 / MILLIS_PER_SECOND)
    }
}

/// One change to an open event bank, which is one undo step.
///
/// Every ID is the decimal object ID or source ID, which the bank holds as a `u32`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BankEdit {
    /// Points the Play action `action` at the node `target`.
    Target { action: u32, target: u32 },
    /// Moves the node `child` of the opened bank from its parent into `container`.
    AddChild { container: u32, child: u32 },
    /// Moves the playlist item of `child` of the random container `container` to `index`.
    MoveChild {
        container: u32,
        child: u32,
        index: u32,
    },
    /// Sets the weight of the playlist item of `child`, and makes the random pick read weights.
    Weight {
        container: u32,
        child: u32,
        weight: u32,
    },
    /// Sets `property` of `object` to `value`. A default value removes the property.
    Property {
        object: u32,
        property: NodeProperty,
        value: f32,
    },
    /// Points the sound `sound` at the media `source`.
    Source { sound: u32, source: u32 },
    /// Creates the event `name`, whose ID is the hash of the name, with no action.
    NewEvent { name: String },
    /// Creates the event `name` with a copy of every action of `event` and of what they play.
    CopyEvent { event: u32, name: String },
    /// Creates the event `name` with shallow copies of the actions of `event` without duplicating their subtrees.
    AliasEvent { event: u32, name: String },
    /// Gives the event `event` the ID of `name`, with its actions.
    RenameEvent { event: u32, name: String },
    /// Adds `node` under `parent`.
    AddNode { parent: NodeParent, node: NewNode },
    /// Adds a copy of `object` and of every object below it beside `object` under `parent`.
    ///
    /// `parent` is the container that lists the object, the Play action that plays it, or the
    /// event that runs the action `object`.
    Duplicate { object: u32, parent: u32 },
    /// Unlinks `object` from `parent`, and removes it if nothing else references it.
    ///
    /// `parent` is as for [`BankEdit::Duplicate`]. `None` deletes the event `object`.
    Delete { object: u32, parent: Option<u32> },
    /// Puts `objects` into a new container of `container` that takes their place under `parent`.
    ///
    /// `parent` is the container that lists every object, or the Play action of the one object.
    Wrap {
        objects: Vec<u32>,
        parent: u32,
        container: ContainerKind,
    },
    /// Applies every edit of `edits`, in order, as one undo step.
    Batch { edits: Vec<BankEdit> },
    /// Upgrades the bank to version 145.
    Upgrade,
}

impl BankEdit {
    /// Returns the ID of the one object that the edit replaces, or `None` for an edit that adds,
    /// removes or replaces several objects.
    fn replaced(&self) -> Option<u32> {
        match *self {
            Self::MoveChild { container, .. } | Self::Weight { container, .. } => Some(container),
            Self::Property { object, .. } => Some(object),
            Self::Source { sound, .. } => Some(sound),
            Self::Target { .. }
            | Self::AddChild { .. }
            | Self::NewEvent { .. }
            | Self::CopyEvent { .. }
            | Self::AliasEvent { .. }
            | Self::RenameEvent { .. }
            | Self::AddNode { .. }
            | Self::Duplicate { .. }
            | Self::Delete { .. }
            | Self::Wrap { .. }
            | Self::Batch { .. }
            | Self::Upgrade => None,
        }
    }
}

/// The object that a new node joins: a container lists it, or an event plays it through a new
/// Play action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NodeParent {
    /// A container of the opened bank.
    Container { container: u32 },
    /// An event of the opened bank.
    Event { event: u32 },
}

/// The node that [`BankEdit::AddNode`] adds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NewNode {
    /// A new sound that plays the media `source` of the bank set.
    Sound { source: u32 },
    /// A new, empty container.
    Container { container: ContainerKind },
    /// The node `node`. Under a container it moves from its parent, and under an event a new
    /// Play action plays it.
    Existing { node: u32 },
}

/// The kind of a new container.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ContainerKind {
    /// A random container, which plays one child that the client picks.
    Random,
    /// A sequence container, which plays its children in playlist order.
    Sequence,
    /// A switch container, with the switch group and the default switch of a switch container
    /// of the set.
    Switch,
}

/// The sound that an import added, and the source ID of the media that it plays.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct ImportedSound {
    /// The object ID of the new sound.
    pub sound: u32,
    /// The source ID of the new media.
    pub source: u32,
}

/// What an edit checks its references against, and where it reads a media file from.
#[derive(Clone, Copy)]
pub struct EditContext<'a> {
    set: &'a BankSet,
    indexes: &'a [&'a AudioIndex],
    files: Option<&'a dyn AudioFiles>,
}

impl std::fmt::Debug for EditContext<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EditContext")
            .field("indexes", &self.indexes.len())
            .field("files", &self.files.is_some())
            .finish_non_exhaustive()
    }
}

impl<'a> EditContext<'a> {
    /// Returns a context over `set`, the bank set of the document opened from its bytes.
    #[must_use]
    pub fn new(set: &'a BankSet) -> Self {
        Self {
            set,
            indexes: &[],
            files: None,
        }
    }

    /// Returns the context with `indexes`, whose event names and source IDs a new ID avoids.
    #[must_use]
    pub fn with_indexes(self, indexes: &'a [&'a AudioIndex]) -> Self {
        Self { indexes, ..self }
    }

    /// Returns the context with `files`, which an import reads a media file of the set from.
    #[must_use]
    pub fn with_files(self, files: &'a dyn AudioFiles) -> Self {
        Self {
            files: Some(files),
            ..self
        }
    }
}

/// Why an open event bank refused an edit or does not open.
#[derive(Debug, Error)]
pub enum BankEditError {
    /// The bytes are not a bank that `ltk_wwise` reads, or an object does not decode or encode.
    #[error(transparent)]
    Wwise(#[from] ltk_wwise::Error),

    /// The bank has no hierarchy, so it has no object to edit.
    #[error("The bank has no hierarchy, so it has no event to edit")]
    NoHierarchy,

    /// The bank is not version 145.
    #[error(
        "The bank is version {0}, and only a version 145 bank takes edits. Convert it with the \
         Convert repair of its Problems entry, then edit the converted bank."
    )]
    Legacy(u32),

    /// The bank holds no object with the ID.
    #[error(
        "The bank holds no object {0}. An object of another bank of the set is edited in that bank."
    )]
    NoObject(u32),

    /// The object is not of the kind that the edit changes.
    #[error("Object {id} is not {expected}")]
    Kind { id: u32, expected: &'static str },

    /// No bank of the set holds a node with the ID.
    #[error("No bank of the set holds a sound or a container {0}. Pick an object of the bank set.")]
    NoNode(u32),

    /// A child edit of a switch or a layer container, which names its children in its groups.
    #[error("Container {0} is a switch or a layer container, which takes no added or moved child")]
    Grouped(u32),

    /// The child is already a child of the container.
    #[error("Object {child} is already a child of container {container}")]
    AlreadyChild { container: u32, child: u32 },

    /// The child is the container itself.
    #[error("Container {0} cannot be a child of itself")]
    OwnChild(u32),

    /// The container has no child or playlist item with the ID.
    #[error("Container {container} has no child {child}")]
    NotChild { container: u32, child: u32 },

    /// The object does not take the property.
    #[error("Object {id} takes no {property:?} property")]
    Property { id: u32, property: NodeProperty },

    /// The value is outside the range of the property.
    #[error("{value} is not a valid {property:?} value")]
    Value { property: NodeProperty, value: f32 },

    /// No file of the set contains the media that a sound of its stream type plays.
    #[error("No {container} of the bank set contains the media {media}")]
    NoMedia { media: u32, container: &'static str },

    /// A prefetched sound plays its start from a bank and the rest from a package.
    #[error(
        "Sound {0} is prefetched, so its media is in two files and its source ID takes no edit"
    )]
    Prefetched(u32),

    /// A new event has an empty name.
    #[error("A new event needs a name")]
    EventName,

    /// The ID of a new event's name is the ID of an object of the set or of a named event.
    #[error(
        "An event or an object of the bank set already has the ID of \"{0}\". Pick another name."
    )]
    EventExists(String),

    /// The node is in another bank of the set, whose objects no edit of this bank changes.
    #[error(
        "Object {0} is in another bank of the set. Pick an object of this bank, or edit the other \
         bank."
    )]
    OtherBank(u32),

    /// The child holds the container, so the move would make a cycle.
    #[error("Object {child} contains container {container}, so it cannot move into it")]
    Cycle { container: u32, child: u32 },

    /// No bank of the set holds a switch container to take a switch group from.
    #[error(
        "No bank of the set holds a switch container, so a new one has no switch group to take"
    )]
    NoSwitch,

    /// No bank of the set holds a sound to copy the node base of a new node from.
    #[error("No bank of the set holds a sound for a new sound to copy. Pick another bank.")]
    NoTemplate,

    /// The set has no media bank and no package to take a new media.
    #[error("The bank set has no media bank and no package to add the media to")]
    NoMediaFile,

    /// The media file of the set cannot be read.
    #[error("The media file of the bank set cannot be read: {0}")]
    MediaRead(String),

    /// The file is not a WEM, or its media does not decode.
    #[error("The file is not a WEM that plays: {0}")]
    Wem(String),

    /// The WEM is of a codec that the game does not play.
    #[error(
        "The WEM is codec {0:#06x}, which is not supported. Convert it to Vorbis \
         in the Wwise authoring tool, then import the converted file."
    )]
    Codec(u16),

    /// The opened event bank holds the media in its own media index.
    #[error("The event bank holds media {0} itself, and its own media takes no replacement")]
    OpenedMedia(u32),

    /// A sound of another bank of the set plays the media and needs another size.
    #[error(
        "Sound {sound} of {path} plays the media from a bank, so a replacement changes its size. \
         Open that bank to replace the media."
    )]
    SharedSound { sound: u32, path: String },
}

impl From<BankEditError> for AppError {
    fn from(error: BankEditError) -> Self {
        Self::Domain(DomainError::new(ErrorKind::Preview, error))
    }
}

/// An open event bank, the media files it adds media to, its undo history and the bytes that a
/// save writes.
///
/// One edit is one undo step over the bank and its media files together. A media file joins the
/// document on its first import and stays in it until the document closes.
#[derive(Debug)]
pub struct EventBankDocument {
    bank: Bank,
    /// The objects of the bank as it was opened, by ID.
    opened: HashMap<ObjectId, Object>,
    /// The bank as it now is, written out.
    bytes: Vec<u8>,
    /// The xxh64 of the bytes that the document was read from or last saved as.
    base: u64,
    /// The media banks and packages of the set that an import added media to.
    media: Vec<MediaFile>,
    /// The names of the events that an edit created.
    names: Vec<String>,
    /// The changes of each edit, the last edit last.
    undo: Vec<Vec<Change>>,
    /// The changes that redo each undone edit, the last undo last.
    redo: Vec<Vec<Change>>,
    /// Counts every change.
    revision: u64,
    /// The revision that the bytes at `base` hold.
    saved: u64,
}

impl EventBankDocument {
    /// Reads `bytes` as a bank that takes edits.
    ///
    /// # Errors
    ///
    /// Fails if the bytes are not a bank that `ltk_wwise` reads.
    pub fn parse(bytes: Vec<u8>) -> Result<Self, BankEditError> {
        let bank = Bank::from_reader(&mut bytes.as_slice())?;
        let opened = bank
            .hierarchy()
            .map(|hierarchy| {
                hierarchy
                    .objects()
                    .iter()
                    .map(|object| (object.id(), object.clone()))
                    .collect()
            })
            .unwrap_or_default();

        Ok(Self {
            bank,
            opened,
            base: xxh64(&bytes, 0),
            bytes,
            media: Vec::new(),
            names: Vec::new(),
            undo: Vec::new(),
            redo: Vec::new(),
            revision: 0,
            saved: 0,
        })
    }

    /// Returns the bank as it now is, written out.
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Returns the version of the bank.
    #[must_use]
    pub fn version(&self) -> u32 {
        self.bank.header().version.0
    }

    /// Returns `true` if the bank is older than version 145 and can be upgraded.
    #[must_use]
    pub fn can_upgrade(&self) -> bool {
        self.bank.header().version < BankVersion::CURRENT && self.bank.upgrade().is_ok()
    }

    /// Upgrades the bank to version 145.
    pub fn upgrade(&mut self) -> Result<(), BankEditError> {
        if self.bank.header().version >= BankVersion::CURRENT {
            return Ok(());
        }

        let upgraded = self.bank.upgrade()?;
        let mut bytes = Vec::new();
        upgraded.to_writer(&mut bytes)?;

        self.bank = upgraded;
        self.bytes = bytes;
        self.opened = self
            .bank
            .hierarchy()
            .map(|hierarchy| {
                hierarchy
                    .objects()
                    .iter()
                    .map(|object| (object.id(), object.clone()))
                    .collect()
            })
            .unwrap_or_default();
        self.revision += 1;
        Ok(())
    }

    /// Returns `true` if the bank takes edits: a version 145 bank with a hierarchy.
    #[must_use]
    pub fn is_editable(&self) -> bool {
        self.check().is_ok()
    }

    /// Returns the count of changes applied, undone and redone since the open.
    #[must_use]
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Returns `true` if the document holds changes that no save wrote.
    #[must_use]
    pub fn is_dirty(&self) -> bool {
        self.revision != self.saved
    }

    /// Returns `true` if `bytes` are the bytes that the document was read from or last saved as.
    #[must_use]
    pub fn is_base(&self, bytes: &[u8]) -> bool {
        xxh64(bytes, 0) == self.base
    }

    /// Returns `true` if the document holds an edit since it was opened, saved or not.
    #[must_use]
    pub fn is_edited(&self) -> bool {
        !self.edited().is_empty()
    }

    /// Returns the IDs of the objects whose bytes differ from the bank as it was opened, in file
    /// order.
    #[must_use]
    pub fn edited(&self) -> Vec<ObjectId> {
        self.bank
            .hierarchy()
            .into_iter()
            .flat_map(|hierarchy| hierarchy.objects())
            .filter(|object| self.opened.get(&object.id()) != Some(*object))
            .map(Object::id)
            .collect()
    }

    /// Returns the media files that an import added media to, in the order they joined.
    #[must_use]
    pub fn media(&self) -> &[MediaFile] {
        &self.media
    }

    /// Returns the media files that an import added media to, to point one at its layer copy.
    pub fn media_mut(&mut self) -> &mut [MediaFile] {
        &mut self.media
    }

    /// Returns the names of the events that an edit created, in the order of the edits.
    #[must_use]
    pub fn created_names(&self) -> &[String] {
        &self.names
    }

    /// Returns the IDs of the events of the bank, in file order.
    #[must_use]
    pub fn events(&self) -> Vec<u32> {
        self.bank
            .hierarchy()
            .into_iter()
            .flat_map(|hierarchy| hierarchy.of_kind(ObjectKind::EVENT))
            .map(|object| object.id().0)
            .collect()
    }

    /// Returns the source IDs of the media that a replacement changed, in the order of the media
    /// files.
    #[must_use]
    pub fn replaced(&self) -> Vec<u32> {
        self.media
            .iter()
            .flat_map(MediaFile::replaced)
            .map(|source| source.0)
            .collect()
    }

    /// Returns what replacing the media `source` of the set with the WEM `wem` writes: the media
    /// before and after, and the sounds that play it.
    ///
    /// # Errors
    ///
    /// Fails for the reasons of [`EventBankDocument::replace`].
    pub fn replacement(
        &self,
        source: u32,
        wem: &[u8],
        context: &EditContext<'_>,
    ) -> Result<MediaReplacement, BankEditError> {
        self.check()?;
        structure::check_wem(wem)?;
        let hierarchy = self.bank.hierarchy().ok_or(BankEditError::NoHierarchy)?;
        let plan = replace::plan(
            hierarchy.objects(),
            self.bank.header().version,
            context,
            &self.media,
            SourceId(source),
            wem,
        )?;
        Ok(plan.replacement)
    }

    /// Replaces the media `source` of the set with the WEM `wem` at the same source ID, as one
    /// undo step.
    ///
    /// The media file that holds it joins the document. Each sound of the opened bank that plays
    /// it takes the new `in_memory_size`: the WEM length for a sound of a bank's media index, and
    /// the prefetched start for a prefetched sound, whose start in its bank is replaced too.
    /// "Replacing media" in `docs/ux/AUDIO.md`.
    ///
    /// # Errors
    ///
    /// Fails if `wem` is not a WEM that decodes or has an unsupported codec, if no media file of the set holds
    /// the media, if the opened bank holds it itself, if a sound of another bank would need
    /// another size, and for the reasons of [`EventBankDocument::edit`].
    pub fn replace(
        &mut self,
        source: u32,
        wem: Vec<u8>,
        context: &EditContext<'_>,
    ) -> Result<(), BankEditError> {
        structure::check_wem(&wem)?;
        self.transact(context, |tx| replace::replace(tx, SourceId(source), wem))
    }

    /// Applies `edit` as one undo step, with the references checked against `context`.
    ///
    /// The set of `context` is the bank set of the document, opened from
    /// [`EventBankDocument::bytes`] and its media files. An edit that leaves the bank unchanged
    /// takes no step.
    ///
    /// # Errors
    ///
    /// Fails if the bank is not version 145, if an object is not in the bank or not of the kind
    /// the edit changes, if a new target, child or source is not in the set, if a new event's name
    /// is taken, or if an object does not decode or encode. A refused edit leaves the document
    /// unchanged.
    pub fn edit(
        &mut self,
        edit: &BankEdit,
        context: &EditContext<'_>,
    ) -> Result<(), BankEditError> {
        if matches!(edit, BankEdit::Upgrade) {
            return self.upgrade();
        }
        self.transact(context, |tx| apply(tx, edit))
    }

    /// Adds the WEM `wem` as a new media of the set and a new sound under `parent` that plays it,
    /// as one undo step, and returns the IDs of the sound and the media.
    ///
    /// The media goes into the media bank of the set if the template sound plays from a bank,
    /// and into the package if it streams. The file is read through the files of `context` the
    /// first time it takes a media. "New objects" in `docs/ux/AUDIO.md`.
    ///
    /// # Errors
    ///
    /// Fails if `wem` is not a WEM that decodes or has an unsupported codec, if the set has no sound to copy or
    /// no media file to add the media to, and for the reasons of [`EventBankDocument::edit`].
    pub fn import(
        &mut self,
        parent: &NodeParent,
        wem: Vec<u8>,
        context: &EditContext<'_>,
    ) -> Result<ImportedSound, BankEditError> {
        let mut imported = ImportedSound::default();
        self.transact(context, |tx| {
            let (sound, source) = structure::import(tx, parent, wem)?;
            imported = ImportedSound {
                sound: sound.0,
                source: source.0,
            };
            Ok(())
        })?;
        Ok(imported)
    }

    /// Reverts the last edit. Returns `false` if there is no edit to revert.
    ///
    /// # Errors
    ///
    /// Fails if the bank does not write.
    pub fn undo(&mut self) -> Result<bool, BankEditError> {
        let Some(changes) = self.undo.pop() else {
            return Ok(false);
        };
        let inverse = self.revert(changes)?;
        self.redo.push(inverse);
        self.changed()?;
        Ok(true)
    }

    /// Applies the last reverted edit again. Returns `false` if there is none.
    ///
    /// # Errors
    ///
    /// Fails if the bank does not write.
    pub fn redo(&mut self) -> Result<bool, BankEditError> {
        let Some(changes) = self.redo.pop() else {
            return Ok(false);
        };
        let inverse = self.revert(changes)?;
        self.undo.push(inverse);
        self.changed()?;
        Ok(true)
    }

    /// Records that [`EventBankDocument::bytes`] and the bytes of every media file are on disk.
    pub fn mark_saved(&mut self) {
        self.base = xxh64(&self.bytes, 0);
        self.saved = self.revision;
        for file in &mut self.media {
            file.mark_saved();
        }
    }

    /// Runs `body` as one edit, and keeps its changes as one undo step.
    fn transact(
        &mut self,
        context: &EditContext<'_>,
        body: impl FnOnce(&mut Tx<'_, '_>) -> Result<(), BankEditError>,
    ) -> Result<(), BankEditError> {
        if self.bank.header().version < BankVersion::CURRENT && self.can_upgrade() {
            self.upgrade()?;
        }
        self.check()?;
        let mut tx = Tx::new(&mut self.bank, &mut self.media, &mut self.names, context)?;
        let result = body(&mut tx);
        let changes = tx.into_changes();

        if let Err(error) = result {
            self.revert(changes)?;
            self.refresh_media()?;
            return Err(error);
        }
        if changes.is_empty() {
            return Ok(());
        }

        self.undo.push(changes);
        if self.undo.len() > HISTORY_DEPTH {
            self.undo.remove(0);
        }
        self.redo.clear();
        self.changed()
    }

    fn revert(&mut self, changes: Vec<Change>) -> Result<Vec<Change>, BankEditError> {
        let hierarchy = self
            .bank
            .hierarchy_mut()
            .ok_or(BankEditError::NoHierarchy)?;
        history::revert(hierarchy, &mut self.media, changes)
    }

    /// Returns the version of the bank if it takes edits.
    fn check(&self) -> Result<BankVersion, BankEditError> {
        let version = self.bank.header().version;
        if version != BankVersion::CURRENT && !self.can_upgrade() {
            return Err(BankEditError::Legacy(version.0));
        }
        if self.bank.hierarchy().is_none() {
            return Err(BankEditError::NoHierarchy);
        }
        Ok(version)
    }

    fn refresh_media(&mut self) -> Result<(), BankEditError> {
        for file in &mut self.media {
            file.refresh()?;
        }
        Ok(())
    }

    /// Writes the bank and the changed media files out again and counts the change.
    fn changed(&mut self) -> Result<(), BankEditError> {
        let mut bytes = Vec::with_capacity(self.bytes.len());
        self.bank.to_writer(&mut bytes)?;
        self.bytes = bytes;
        self.refresh_media()?;
        self.revision += 1;
        Ok(())
    }
}

/// Applies `edit` in `tx`.
fn apply(tx: &mut Tx<'_, '_>, edit: &BankEdit) -> Result<(), BankEditError> {
    match edit {
        BankEdit::Batch { edits } => {
            for each in edits {
                apply(tx, each)?;
            }
            Ok(())
        }
        BankEdit::Target { action, target } => retarget(tx, *action, *target),
        BankEdit::NewEvent { name } => structure::new_event(tx, name, None),
        BankEdit::CopyEvent { event, name } => structure::new_event(tx, name, Some(*event)),
        BankEdit::AliasEvent { event, name } => structure::alias_event(tx, *event, name),
        BankEdit::RenameEvent { event, name } => structure::rename_event(tx, *event, name),
        BankEdit::Upgrade => Ok(()),
        BankEdit::AddNode { parent, node } => structure::add_node(tx, parent, node).map(drop),
        BankEdit::AddChild { container, child } => {
            let parent = NodeParent::Container {
                container: *container,
            };
            structure::add_node(tx, &parent, &NewNode::Existing { node: *child }).map(drop)
        }
        BankEdit::Duplicate { object, parent } => structure::duplicate(tx, *object, *parent),
        BankEdit::Delete { object, parent } => structure::delete(tx, *object, *parent),
        BankEdit::Wrap {
            objects,
            parent,
            container,
        } => structure::wrap(tx, objects, *parent, *container),
        single => {
            let id = single
                .replaced()
                .expect("every other edit replaces one object");
            let typed = tx.typed(ObjectId(id))?;
            let changed = apply_one(single, id, typed, tx)?;
            tx.put(&changed)
        }
    }
}

/// Returns `typed`, the object `id`, with the one-object `edit` applied, checked against `tx`.
fn apply_one(
    edit: &BankEdit,
    id: u32,
    typed: Typed,
    tx: &Tx<'_, '_>,
) -> Result<Typed, BankEditError> {
    match *edit {
        BankEdit::MoveChild { child, index, .. } => {
            let mut container = container(typed, id)?;
            let playlist = &mut playlist(&mut container)?.playlist;
            let from = item_of(playlist, id, child)?;
            let item = playlist.remove(from);
            let to = usize::try_from(index).map_or(playlist.len(), |to| to.min(playlist.len()));
            playlist.insert(to, item);
            Ok(Typed::Container(container))
        }
        BankEdit::Weight { child, weight, .. } => {
            let mut container = container(typed, id)?;
            let fields = playlist(&mut container)?;
            let at = item_of(&fields.playlist, id, child)?;
            fields.playlist[at].weight = weight;
            fields.bits |= USES_WEIGHTS;
            Ok(Typed::Container(container))
        }
        BankEdit::Property {
            property, value, ..
        } => set_property(typed, id, property, value),
        BankEdit::Source { source, .. } => {
            let Typed::Sound(mut sound) = typed else {
                return Err(BankEditError::Kind {
                    id,
                    expected: "a sound",
                });
            };
            set_source(&mut sound, source, tx.context.set)?;
            Ok(Typed::Sound(sound))
        }
        _ => unreachable!("apply sends every edit of several objects to the structure module"),
    }
}

/// The kinds that a Play action plays.
const PLAY_TARGETS: &[ObjectKind] = &[
    ObjectKind::SOUND,
    ObjectKind::RANDOM_SEQUENCE_CONTAINER,
    ObjectKind::SWITCH_CONTAINER,
    ObjectKind::ACTOR_MIXER,
    ObjectKind::LAYER_CONTAINER,
    ObjectKind::MUSIC_SEGMENT,
    ObjectKind::MUSIC_TRACK,
    ObjectKind::MUSIC_SWITCH_CONTAINER,
    ObjectKind::MUSIC_RANDOM_SEQUENCE_CONTAINER,
];

/// The kinds that a random container or an actor-mixer takes as a child.
pub(crate) const CHILD_KINDS: &[ObjectKind] = &[
    ObjectKind::SOUND,
    ObjectKind::RANDOM_SEQUENCE_CONTAINER,
    ObjectKind::SWITCH_CONTAINER,
    ObjectKind::ACTOR_MIXER,
    ObjectKind::LAYER_CONTAINER,
];

/// Points the Play action `action` at `target`. A target in another file of the set than the old
/// target sets the action's bank ID to the bank of that file.
fn retarget(tx: &mut Tx<'_, '_>, action: u32, target: u32) -> Result<(), BankEditError> {
    let mut play = play_action(tx.typed(ObjectId(action))?, action)?;
    check_node(tx, target, PLAY_TARGETS)?;

    let old_bank = tx.bank_of(play.target);
    let new_bank = tx.bank_of(ObjectId(target));
    play.target = ObjectId(target);
    let object = Typed::Action(play).encode(tx.version)?;
    if old_bank == new_bank {
        return tx.put_object(object);
    }
    tx.put_object(with_play_bank(object, new_bank, tx.version)?)
}

/// The bytes at the end of a version 145 Play action after its bank ID: the `u32` of the current
/// generation that `Action::write` of `ltk_wwise` 0.2.0 writes last.
const PLAY_TAIL: usize = 4;

/// The length of a Play action's bank ID.
const BANK_ID_LEN: usize = 4;

/// Returns the Play action `object` with the bank ID `bank`.
///
/// `ltk_wwise` 0.2.0 keeps the bank ID in a private field, so this writes the four bytes before
/// [`PLAY_TAIL`] and decodes the result to check that `Action::play_bank` reads `bank`.
fn with_play_bank(
    object: Object,
    bank: BankId,
    version: BankVersion,
) -> Result<Object, BankEditError> {
    let id = object.id().0;
    let refused = BankEditError::Kind {
        id,
        expected: "a Play action that ends in its bank ID",
    };
    let kind = object.kind();
    let mut payload = object.into_payload();
    let Some(end) = payload
        .len()
        .checked_sub(PLAY_TAIL)
        .filter(|end| *end >= BANK_ID_LEN)
    else {
        return Err(refused);
    };
    payload[end - BANK_ID_LEN..end].copy_from_slice(&bank.0.to_le_bytes());

    let patched = Object::new(kind, payload)?;
    match patched.decode(version)? {
        Some(Typed::Action(action)) if action.play_bank() == Some(bank) => Ok(patched),
        _ => Err(refused),
    }
}

/// Fails if neither the opened bank nor another bank of the set holds an object `id` of one of
/// `kinds`.
fn check_node(tx: &Tx<'_, '_>, id: u32, kinds: &[ObjectKind]) -> Result<(), BankEditError> {
    match tx.locate(ObjectId(id)) {
        Some((kind, _)) if kinds.contains(&kind) => Ok(()),
        _ => Err(BankEditError::NoNode(id)),
    }
}

fn play_action(typed: Typed, id: u32) -> Result<Action, BankEditError> {
    match typed {
        Typed::Action(action) if action.action_type.is_play() => Ok(action),
        _ => Err(BankEditError::Kind {
            id,
            expected: "a Play action",
        }),
    }
}

fn container(typed: Typed, id: u32) -> Result<Container, BankEditError> {
    match typed {
        Typed::Container(container) => Ok(container),
        _ => Err(BankEditError::Kind {
            id,
            expected: "a container",
        }),
    }
}

/// Returns the fields of a random container, the kind whose playlist an edit orders and weighs.
fn playlist(
    container: &mut Container,
) -> Result<&mut ltk_wwise::hierarchy::RandomSequenceFields, BankEditError> {
    let id = container.id.0;
    match &mut container.fields {
        ContainerFields::RandomSequence(fields) => Ok(fields),
        _ => Err(BankEditError::Kind {
            id,
            expected: "a random container",
        }),
    }
}

/// Returns the position of the playlist item of `child`.
fn item_of(playlist: &[PlaylistItem], container: u32, child: u32) -> Result<usize, BankEditError> {
    playlist
        .iter()
        .position(|item| item.child == ObjectId(child))
        .ok_or(BankEditError::NotChild { container, child })
}

fn set_property(
    typed: Typed,
    id: u32,
    property: NodeProperty,
    value: f32,
) -> Result<Typed, BankEditError> {
    check_value(property, value)?;
    let refused = BankEditError::Property { id, property };

    match typed {
        Typed::Sound(mut sound) => {
            set_node_prop(&mut sound.node.props, property, value);
            Ok(Typed::Sound(sound))
        }
        Typed::Container(mut container) if NodeProperty::CONTAINER.contains(&property) => {
            set_node_prop(&mut container.node.props, property, value);
            Ok(Typed::Container(container))
        }
        Typed::Action(mut action)
            if action.action_type.is_play() && NodeProperty::PLAY.contains(&property) =>
        {
            set_delay(&mut action.props, value);
            Ok(Typed::Action(action))
        }
        _ => Err(refused),
    }
}

/// Fails if `value` is outside the range of `property`.
fn check_value(property: NodeProperty, value: f32) -> Result<(), BankEditError> {
    let valid = value.is_finite()
        && match property {
            NodeProperty::Volume | NodeProperty::MakeUpGain | NodeProperty::Pitch => true,
            NodeProperty::Lpf | NodeProperty::Hpf => (0.0..=FILTER_MAX).contains(&value),
            NodeProperty::Delay => value >= 0.0,
            NodeProperty::LoopCount => value >= 0.0 && value.fract() == 0.0,
        };
    if valid {
        Ok(())
    } else {
        Err(BankEditError::Value { property, value })
    }
}

/// Sets `property` of a node's bundle, and removes it at its default value.
fn set_node_prop(props: &mut PropBundle, property: NodeProperty, value: f32) {
    let id = property.node_id();
    if value == property.default_value() {
        props.remove(id);
        return;
    }

    let bits = match property {
        #[expect(
            clippy::cast_possible_truncation,
            reason = "check_value admits a whole loop count only"
        )]
        NodeProperty::LoopCount => PropValue::from_i32(value as i32),
        NodeProperty::Volume
        | NodeProperty::MakeUpGain
        | NodeProperty::Pitch
        | NodeProperty::Lpf
        | NodeProperty::Hpf
        | NodeProperty::Delay => PropValue::from_f32(value),
    };
    props.set(id, bits);
}

/// Sets the `DelayTime` of a Play action to `seconds`, and removes it at zero.
fn set_delay(props: &mut PropBundle, seconds: f32) {
    #[expect(
        clippy::cast_possible_truncation,
        reason = "a delay in milliseconds fits an i32"
    )]
    let millis = (seconds * MILLIS_PER_SECOND).round() as i32;
    if millis == 0 {
        props.remove(PropertyId::DELAY_TIME);
        return;
    }
    props.set(PropertyId::DELAY_TIME, PropValue::from_i32(millis));
}

/// Points `sound` at `source`, a media that a file of `set` of the sound's stream type contains.
fn set_source(sound: &mut Sound, source: u32, set: &BankSet) -> Result<(), BankEditError> {
    let id = SourceId(source);
    match sound.source.stream_type {
        StreamType::DATA_BANK => {
            let media = set.banked_media(id).ok_or(BankEditError::NoMedia {
                media: source,
                container: "media index",
            })?;
            sound.source.in_memory_size = u32::try_from(media.len()).unwrap_or(u32::MAX);
        }
        StreamType::STREAMING => {
            set.package_with_media(id).ok_or(BankEditError::NoMedia {
                media: source,
                container: "package",
            })?;
            sound.source.in_memory_size = 0;
        }
        _ => return Err(BankEditError::Prefetched(sound.id.0)),
    }
    sound.source.source_id = id;
    Ok(())
}
