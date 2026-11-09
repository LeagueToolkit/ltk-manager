//! The event bank viewer's model: the events of one opened bank, each with its play tree.
//!
//! "Event tree" in `docs/ux/AUDIO.md`.
//!
//! An ID crosses IPC as a `u32`, because the `ltk_wwise` ID types implement neither `Serialize`
//! nor `specta::Type`, and a serde adapter splits a specta type into two phases.

use std::collections::{HashMap, HashSet};
use std::io;

use ltk_manager_assets::preview::AssetRef;
use ltk_wwise::bank::BankVersion;
use ltk_wwise::hierarchy::{ContainerFields, ObjectKind, PropBundle, StreamType, Typed};
use ltk_wwise::{ObjectId, SourceId};
use serde::Serialize;

use crate::bank_set::{
    BANK_EVENTS, BankContent, BankSet, BankUnit, CONTEXTUAL_ACTION_DATA, localized, shipped,
};
use crate::bin_audio::{Audience, SiteStep};
use crate::contextual::{ContextualMatch, contextual_names};
use crate::edit::{CHILD_KINDS, NodeProperty, USES_WEIGHTS};
use crate::files::{AudioFile, AudioFiles, ReadSeek};
use crate::index::AudioIndex;
use crate::lookup::{
    ActionNode, LookupError, MediaSite, PlayMode, PlayNode, PlayTree, SoundLookup, SwitchPick,
};
use crate::names::EventNames;
use crate::references::{SiteNames, SiteRow, hex, ranked_units, site_row, unit_row};

/// The bank that a document opened, with the game path that the bank units name it by.
#[derive(Debug, Clone)]
pub struct OpenedBank {
    /// The game path of the bank. A file outside the game names itself by its file name.
    pub path: String,
    /// The bytes of the bank and the asset that contains them.
    pub file: AudioFile<Vec<u8>>,
    /// The media files that the document changed, which the set reads in place of their files.
    pub media: Vec<OpenedFile>,
    /// The names of the events that the document created, which name them in the list.
    pub names: Vec<String>,
}

/// A file of the bank set as a document holds it, by its game path.
#[derive(Debug, Clone)]
pub struct OpenedFile {
    /// The game path of the file.
    pub path: String,
    /// The bytes of the file and the asset that a save writes them to.
    pub file: AudioFile<Vec<u8>>,
}

/// Which files the bank set of an opened event bank contains beside the bank.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum BankSetOrigin {
    /// The files of every bank unit that names the bank.
    Units,
    /// No bank unit lists the bank. The set contains the `_audio` bank and package beside it.
    Siblings,
    /// No bank unit lists the bank, and its name has no `_events` stem. The set contains only
    /// the bank.
    Alone,
}

/// An event bank opened with its bank set, and the names of its events.
#[derive(Debug)]
pub struct EventBank {
    set: BankSet,
    names: EventNames,
    origin: BankSetOrigin,
    contexts: HashMap<ObjectId, Vec<EventContext>>,
    listed: HashMap<ObjectId, SiteRow>,
}

impl EventBank {
    /// Opens `opened` with the files that its bank units name.
    ///
    /// The bank units come from `indexes`, the first index first: the project's bins, then
    /// the game. The opened bank is the first file of the set, read from the opened bytes. If no
    /// unit names it, the set falls back to the sibling convention: the same directory, the stem
    /// with `_events` replaced by `_audio`, as a `.bnk` and a `.wpk`. An event takes its name
    /// from the first index that names its ID, and else from the contextual rules of the
    /// holders of the units, which [`contextual_names`] composes. `names` writes the rows.
    #[must_use]
    pub fn open(
        opened: OpenedBank,
        indexes: &[&AudioIndex],
        files: &dyn AudioFiles,
        locale: Option<&str>,
        names: &dyn SiteNames,
    ) -> Self {
        let (units, origin) = bank_units(&opened.path, indexes);
        let files = WithOpened {
            opened: &opened,
            rest: files,
        };
        let set = BankSet::open(&units, &files, locale);

        let ids: HashSet<ObjectId> = event_ids(&set).collect();
        let mut event_names = EventNames::new();
        for &id in &ids {
            if let Some(name) = indexes.iter().find_map(|index| index.name(id)) {
                event_names.insert(name);
            }
        }
        for name in &opened.names {
            let id = ObjectId::from_name(name);
            if ids.contains(&id) && event_names.get(id).is_none() {
                event_names.insert(name);
            }
        }

        let declared = ranked_units(&opened.path, indexes, Some(names));
        let mut contexts: HashMap<ObjectId, Vec<EventContext>> = HashMap::new();
        for found in contextual_names(&declared, indexes, &ids, names) {
            event_names.insert(&found.name);
            if let Some(context) = context_of(&found, indexes, names) {
                contexts.entry(found.event).or_default().push(context);
            }
        }

        let mut listed = HashMap::new();
        for &id in &ids {
            let Some(name) = event_names.get(id) else {
                continue;
            };
            let listing = declared.iter().find_map(|indexed| {
                let at = indexed
                    .unit
                    .events
                    .iter()
                    .position(|event| event.eq_ignore_ascii_case(name))?;
                Some(unit_row(
                    indexed,
                    Some(&[SiteStep::Field(BANK_EVENTS.0), SiteStep::Index(at)]),
                    names,
                ))
            });
            if let Some(row) = listing {
                listed.insert(id, row);
            }
        }

        Self {
            set,
            names: event_names,
            origin,
            contexts,
            listed,
        }
    }

    /// Returns the bank set: the opened bank first, then the files of its bank units.
    #[must_use]
    pub fn set(&self) -> &BankSet {
        &self.set
    }

    /// Lists every event of the opened bank, in file order, with the status of its play tree.
    #[must_use]
    pub fn events(&self) -> AudioEventList {
        let lookup = SoundLookup::new(&self.set, &self.names);
        let events = event_ids(&self.set)
            .map(|id| {
                let (action_count, media_count, status, nodes) = match lookup.event(id) {
                    Ok(Some(tree)) => (
                        count(tree.actions.len()),
                        count(tree.actions.iter().map(sounds_of_action).sum()),
                        status_of(&tree),
                        reached_nodes(&tree),
                    ),
                    Ok(None) => (0, 0, EventStatus::ObjectMissing, Vec::new()),
                    Err(error) => (
                        0,
                        0,
                        EventStatus::DecodeError {
                            object: error.object.0,
                            bank: error.bank.clone(),
                            message: error.error.to_string(),
                        },
                        Vec::new(),
                    ),
                };

                AudioEvent {
                    id: id.0,
                    name: self.names.get(id).map(str::to_owned),
                    action_count,
                    media_count,
                    status,
                    contexts: self.contexts.get(&id).cloned().unwrap_or_default(),
                    listed: self.listed.get(&id).cloned(),
                    nodes,
                }
            })
            .collect();

        let files = self
            .set
            .files()
            .iter()
            .enumerate()
            .map(|(at, file)| SetFile {
                path: file.path().to_owned(),
                asset: file.asset().cloned(),
                state: match file.content() {
                    BankContent::Bank { .. } | BankContent::Package { .. } => SetFileState::Found,
                    BankContent::Missing => SetFileState::Missing,
                    BankContent::Failed { message } => SetFileState::Failed {
                        message: message.clone(),
                    },
                },
                opened: at == 0,
            })
            .collect();

        AudioEventList {
            events,
            files,
            origin: self.origin,
        }
    }

    /// Resolves the event `id` into its play tree.
    ///
    /// Returns `None` if the first object `id` of the set is not an event.
    ///
    /// # Errors
    ///
    /// Fails with a [`LookupError`] if an object of the tree cannot be decoded.
    pub fn event(&self, id: ObjectId) -> Result<Option<EventTree>, LookupError> {
        let lookup = SoundLookup::new(&self.set, &self.names);
        let Some(tree) = lookup.event(id)? else {
            return Ok(None);
        };

        Ok(Some(event_tree(&self.set, tree)))
    }

    /// Returns the editable properties of every action and node of `tree`, in tree order.
    ///
    /// An object whose bank is not the opened bank, an action of a class other than Play and an
    /// object that does not decode are left out.
    #[must_use]
    pub fn properties(&self, tree: &EventTree) -> Vec<ObjectProperties> {
        tree_properties(&self.set, tree)
    }

    /// Lists every sound and container of the bank set that a container takes as a child, the
    /// first object of each ID, in file order.
    #[must_use]
    pub fn nodes(&self) -> Vec<BankNode> {
        let mut seen = HashSet::new();
        let mut nodes = Vec::new();
        for file in self.set.files() {
            let BankContent::Bank { bank } = file.content() else {
                continue;
            };
            let Some(hierarchy) = bank.hierarchy() else {
                continue;
            };

            for object in hierarchy.objects() {
                if !CHILD_KINDS.contains(&object.kind()) || !seen.insert(object.id()) {
                    continue;
                }
                nodes.push(BankNode {
                    id: object.id().0,
                    object_kind: object.kind().0,
                    kind_name: object.kind().to_string(),
                    bank: file.path().to_owned(),
                });
            }
        }
        nodes
    }
}

/// Returns the properties of every action and node of `tree` that `set` holds, in tree order.
///
/// An action of a class other than Play, an object that no bank holds and an object that does
/// not decode are left out.
pub(crate) fn tree_properties(set: &BankSet, tree: &EventTree) -> Vec<ObjectProperties> {
    fn walk(set: &BankSet, node: &EventNode, out: &mut Vec<ObjectProperties>) {
        let (id, children) = match node {
            EventNode::Sound { id, .. } => (*id, &[][..]),
            EventNode::Random { id, children, .. }
            | EventNode::Switch { id, children, .. }
            | EventNode::Layer { id, children }
            | EventNode::Mixer { id, children } => (*id, &children[..]),
            EventNode::Unsupported { .. } | EventNode::Missing { .. } => return,
        };
        out.extend(object_properties(set, id));
        for child in children {
            walk(set, child, out);
        }
    }

    let mut out = Vec::new();
    for action in &tree.actions {
        out.extend(object_properties(set, action.id));
        if let Some(node) = &action.node {
            walk(set, node, &mut out);
        }
    }
    out
}

/// Returns the editable properties of the object `id` of `set`, or `None` for an object that no
/// edit changes.
fn object_properties(set: &BankSet, id: u32) -> Option<ObjectProperties> {
    let (file, bank, object) = set.object(ObjectId(id))?;
    let typed = object.decode(bank.header().version).ok()??;
    let editable = file == 0 && bank.header().version == BankVersion::CURRENT;

    let (values, weights) = match typed {
        Typed::Action(action) if action.action_type.is_play() => {
            let delay = PropertyValue {
                property: NodeProperty::Delay,
                value: NodeProperty::action_delay(&action.props),
            };
            (vec![delay], None)
        }
        Typed::Sound(sound) => (node_values(NodeProperty::SOUND, &sound.node.props), None),
        Typed::Container(container) => {
            let weights = match &container.fields {
                ContainerFields::RandomSequence(fields) => Some(PlaylistWeights {
                    weighted: fields.bits & USES_WEIGHTS != 0,
                    items: fields
                        .playlist
                        .iter()
                        .map(|item| PlaylistWeight {
                            child: item.child.0,
                            weight: item.weight,
                        })
                        .collect(),
                }),
                _ => None,
            };
            let values = node_values(NodeProperty::CONTAINER, &container.node.props);
            (values, weights)
        }
        _ => return None,
    };

    Some(ObjectProperties {
        id,
        editable,
        values,
        weights,
    })
}

fn node_values(properties: &[NodeProperty], props: &PropBundle) -> Vec<PropertyValue> {
    properties
        .iter()
        .map(|&property| PropertyValue {
            property,
            value: property.of_node(props),
        })
        .collect()
}

/// Returns `tree` as the event tree draws it, with each media placed in a file of `set`.
pub(crate) fn event_tree(set: &BankSet, tree: PlayTree) -> EventTree {
    EventTree {
        event: tree.event.0,
        name: tree.name,
        actions: tree
            .actions
            .into_iter()
            .map(|action| event_action(set, action))
            .collect(),
    }
}

fn event_action(set: &BankSet, action: ActionNode) -> EventAction {
    EventAction {
        id: action.id.0,
        class: action.class,
        label: action.class.map(action_label),
        target: action_target(set, action.id),
        node: action.target.map(|node| event_node(set, node)),
        delay: u32::try_from(action.delay.as_millis()).unwrap_or(u32::MAX),
    }
}

/// Returns the object ID that the action `id` targets, the `u32` after its type.
fn action_target(set: &BankSet, id: ObjectId) -> Option<u32> {
    let (_, _, object) = set.object(id)?;
    if object.kind() != ObjectKind::ACTION {
        return None;
    }
    let bytes = object
        .payload()
        .get(ACTION_TARGET_OFFSET..)?
        .first_chunk()?;
    Some(u32::from_le_bytes(*bytes))
}

fn event_node(set: &BankSet, node: PlayNode) -> EventNode {
    let nodes = |children: Vec<PlayNode>| -> Vec<EventNode> {
        children
            .into_iter()
            .map(|child| event_node(set, child))
            .collect()
    };

    match node {
        PlayNode::Sound {
            id,
            source,
            stream,
            media,
        } => EventNode::Sound {
            id: id.0,
            source: source.0,
            stream: SoundStream::from(stream),
            media: media_location(set, media, source),
        },
        PlayNode::Random {
            id,
            children,
            mode,
            playlist,
        } => EventNode::Random {
            id: id.0,
            children: nodes(children),
            mode,
            playlist: playlist
                .into_iter()
                .map(|entry| EventPlaylistItem {
                    child: count(entry.child),
                    weight: entry.weight,
                })
                .collect(),
        },
        PlayNode::Switch {
            id,
            children,
            group,
            default_switch,
            pick,
        } => EventNode::Switch {
            id: id.0,
            children: nodes(children),
            group,
            default_switch,
            pick: match pick {
                SwitchPick::Default { nodes } => EventSwitchPick::Default {
                    nodes: nodes.into_iter().map(count).collect(),
                },
                SwitchPick::FirstChild => EventSwitchPick::FirstChild,
            },
        },
        PlayNode::Layer { id, children } => EventNode::Layer {
            id: id.0,
            children: nodes(children),
        },
        PlayNode::Mixer { id, children } => EventNode::Mixer {
            id: id.0,
            children: nodes(children),
        },
        PlayNode::Unsupported { id, kind } => EventNode::Unsupported {
            id: id.0,
            object_kind: kind.0,
            kind_name: kind.to_string(),
            music: MUSIC_KINDS.contains(&kind),
        },
        PlayNode::Missing { id } => EventNode::Missing { id: id.0 },
    }
}

fn media_location(set: &BankSet, site: MediaSite, source: SourceId) -> Option<MediaLocation> {
    let (file, container) = match site {
        MediaSite::InBank { file } => (file, MediaContainer::Bank),
        MediaSite::InPackage { file } => (file, MediaContainer::Package),
        MediaSite::Missing => return None,
    };
    let file = &set.files()[file];

    Some(MediaLocation {
        asset: file.asset()?.clone(),
        path: file.path().to_owned(),
        source: source.0,
        container,
    })
}

/// Returns the bank units of the set of the bank at `path`, and where they come from.
///
/// A unit names a voice-over bank by its `en_US` path. A bank at another locale also takes the
/// units that name its `en_US` path, with their paths read under the locale of `path`.
fn bank_units(path: &str, indexes: &[&AudioIndex]) -> (Vec<BankUnit>, BankSetOrigin) {
    let mut units = vec![BankUnit {
        bank_path: vec![path.to_owned()],
        ..BankUnit::default()
    }];
    let mut listed = HashSet::from([path.to_ascii_lowercase()]);
    let shipped = shipped(path);

    for index in indexes {
        let named = index.units_naming(path).map(|indexed| (indexed, None));
        let localized_units = shipped.iter().flat_map(|(shipped, locale)| {
            index
                .units_naming(shipped)
                .map(move |indexed| (indexed, Some(*locale)))
        });

        for (indexed, locale) in named.chain(localized_units) {
            let bank_path = indexed
                .unit
                .bank_path
                .iter()
                .map(|unit_path| {
                    locale
                        .and_then(|locale| localized(unit_path, locale))
                        .unwrap_or_else(|| unit_path.clone())
                })
                .filter(|unit_path| listed.insert(unit_path.to_ascii_lowercase()))
                .collect();
            units.push(BankUnit {
                bank_path,
                ..indexed.unit.clone()
            });
        }
    }
    if units.len() > 1 {
        return (units, BankSetOrigin::Units);
    }

    let Some(stem) = sibling_stem(path) else {
        return (units, BankSetOrigin::Alone);
    };
    units.push(BankUnit {
        bank_path: vec![format!("{stem}.bnk"), format!("{stem}.wpk")],
        ..BankUnit::default()
    });
    (units, BankSetOrigin::Siblings)
}

/// Returns the path of `path` without its extension, with the `_events` suffix of the stem
/// replaced by `_audio`. Returns `None` if the stem has no `_events` suffix.
fn sibling_stem(path: &str) -> Option<String> {
    let (stem, _) = path.rsplit_once('.')?;
    let cut = stem.len().checked_sub(EVENTS_SUFFIX.len())?;
    let suffix = stem.get(cut..)?;
    if !suffix.eq_ignore_ascii_case(EVENTS_SUFFIX) || stem[..cut].is_empty() {
        return None;
    }
    Some(format!("{}{AUDIO_SUFFIX}", &stem[..cut]))
}

/// Returns the IDs of the events of the first file of `set`, in file order.
fn event_ids(set: &BankSet) -> impl Iterator<Item = ObjectId> + '_ {
    let hierarchy = match set.files().first().map(|file| file.content()) {
        Some(BankContent::Bank { bank }) => bank.hierarchy(),
        _ => None,
    };
    hierarchy
        .into_iter()
        .flat_map(|hierarchy| hierarchy.of_kind(ObjectKind::EVENT))
        .map(|object| object.id())
}

/// Returns the status of `tree`: an object missing outranks a media missing.
fn status_of(tree: &PlayTree) -> EventStatus {
    fn walk(node: &PlayNode, missing: &mut Missing) {
        match node {
            PlayNode::Sound { media, .. } => {
                missing.media |= *media == MediaSite::Missing;
            }
            PlayNode::Random { children, .. }
            | PlayNode::Switch { children, .. }
            | PlayNode::Layer { children, .. }
            | PlayNode::Mixer { children, .. } => {
                for child in children {
                    walk(child, missing);
                }
            }
            PlayNode::Missing { .. } => missing.object = true,
            PlayNode::Unsupported { .. } => {}
        }
    }

    let mut missing = Missing::default();
    for action in &tree.actions {
        missing.object |= action.class.is_none();
        if let Some(node) = &action.target {
            walk(node, &mut missing);
        }
    }

    if missing.object {
        EventStatus::ObjectMissing
    } else if missing.media {
        EventStatus::MediaMissing
    } else {
        EventStatus::Resolved
    }
}

#[derive(Default)]
struct Missing {
    object: bool,
    media: bool,
}

/// Returns the number of sounds under `action`.
fn sounds_of_action(action: &ActionNode) -> usize {
    fn sounds(node: &PlayNode) -> usize {
        match node {
            PlayNode::Sound { .. } => 1,
            PlayNode::Random { children, .. }
            | PlayNode::Switch { children, .. }
            | PlayNode::Layer { children, .. }
            | PlayNode::Mixer { children, .. } => children.iter().map(sounds).sum(),
            PlayNode::Unsupported { .. } | PlayNode::Missing { .. } => 0,
        }
    }

    action.target.as_ref().map_or(0, sounds)
}

/// Returns the sounds and containers that the Play actions of `tree` reach, each once, in the
/// order that the event tree draws them.
fn reached_nodes(tree: &PlayTree) -> Vec<ReachedNode> {
    fn reach(node: &PlayNode, seen: &mut HashSet<ObjectId>, out: &mut Vec<ReachedNode>) {
        let (role, source, children) = match node {
            PlayNode::Sound { source, .. } => (NodeRole::Sound, Some(source.0), &[][..]),
            PlayNode::Random { children, mode, .. } => {
                let role = match mode {
                    PlayMode::Random => NodeRole::Random,
                    PlayMode::Sequence => NodeRole::Sequence,
                };
                (role, None, &children[..])
            }
            PlayNode::Switch { children, .. } => (NodeRole::Switch, None, &children[..]),
            PlayNode::Layer { children, .. } => (NodeRole::Layer, None, &children[..]),
            PlayNode::Mixer { children, .. } => (NodeRole::Mixer, None, &children[..]),
            PlayNode::Unsupported { .. } | PlayNode::Missing { .. } => return,
        };
        if !seen.insert(node.id()) {
            return;
        }

        out.push(ReachedNode {
            id: node.id().0,
            role,
            source,
        });
        for at in drawn_order(node) {
            if let Some(child) = children.get(at) {
                reach(child, seen, out);
            }
        }
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for action in &tree.actions {
        if let Some(node) = &action.target {
            reach(node, &mut seen, &mut out);
        }
    }
    out
}

/// Returns the indexes of the children of `node` in the order that the event tree draws them.
///
/// A random or sequence container draws its playlist items in playlist order, then the children
/// outside the playlist. Every other node draws its children in file order.
fn drawn_order(node: &PlayNode) -> Vec<usize> {
    let (children, playlist) = match node {
        PlayNode::Random {
            children, playlist, ..
        } => (children.len(), &playlist[..]),
        PlayNode::Switch { children, .. }
        | PlayNode::Layer { children, .. }
        | PlayNode::Mixer { children, .. } => (children.len(), &[][..]),
        PlayNode::Sound { .. } | PlayNode::Unsupported { .. } | PlayNode::Missing { .. } => {
            return Vec::new();
        }
    };

    let mut order: Vec<usize> = Vec::with_capacity(children);
    for item in playlist {
        if !order.contains(&item.child) {
            order.push(item.child);
        }
    }
    for at in 0..children {
        if !order.contains(&at) {
            order.push(at);
        }
    }
    order
}

fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// Returns the name of the action class `class`, or `0x` and four hex digits for a class that
/// the table does not name.
#[must_use]
pub fn action_label(class: u16) -> String {
    ACTION_CLASSES
        .iter()
        .find(|(known, _)| *known == class)
        .map_or_else(|| format!("{class:#06x}"), |(_, name)| (*name).to_owned())
}

/// The Wwise action classes, the high byte of the action type, with their names.
const ACTION_CLASSES: &[(u16, &str)] = &[
    (0x0100, "Stop"),
    (0x0200, "Pause"),
    (0x0300, "Resume"),
    (0x0400, "Play"),
    (0x0500, "PlayAndContinue"),
    (0x0600, "Mute"),
    (0x0700, "Unmute"),
    (0x0800, "SetPitch"),
    (0x0900, "ResetPitch"),
    (0x0A00, "SetVolume"),
    (0x0B00, "ResetVolume"),
    (0x0C00, "SetBusVolume"),
    (0x0D00, "ResetBusVolume"),
    (0x0E00, "SetLPF"),
    (0x0F00, "ResetLPF"),
    (0x1000, "UseState"),
    (0x1100, "UnuseState"),
    (0x1200, "SetState"),
    (0x1300, "SetGameParameter"),
    (0x1400, "ResetGameParameter"),
    (0x1900, "SetSwitch"),
    (0x1A00, "BypassFX"),
    (0x1B00, "ResetBypassFX"),
    (0x1C00, "Break"),
    (0x1D00, "Trigger"),
    (0x1E00, "Seek"),
    (0x1F00, "Release"),
    (0x2000, "SetHPF"),
    (0x2100, "PlayEvent"),
    (0x2200, "ResetPlaylist"),
    (0x3000, "ResetHPF"),
    (0x3100, "SetFX"),
    (0x3200, "ResetSetFX"),
];

/// The offset of the target ID in an action payload: after the object ID and the `u16` type.
const ACTION_TARGET_OFFSET: usize = 6;

/// The music object kinds, which the lookup does not play.
const MUSIC_KINDS: [ObjectKind; 4] = [
    ObjectKind::MUSIC_SEGMENT,
    ObjectKind::MUSIC_TRACK,
    ObjectKind::MUSIC_SWITCH_CONTAINER,
    ObjectKind::MUSIC_RANDOM_SEQUENCE_CONTAINER,
];

const EVENTS_SUFFIX: &str = "_events";
const AUDIO_SUFFIX: &str = "_audio";

/// [`AudioFiles`] that return the bytes of the opened bank for its path, and read every other
/// path through `rest`.
struct WithOpened<'a> {
    opened: &'a OpenedBank,
    rest: &'a dyn AudioFiles,
}

impl WithOpened<'_> {
    /// Returns the document's copy of the file at `path`: the bank or one of its media files.
    fn held(&self, path: &str) -> Option<&AudioFile<Vec<u8>>> {
        if path.eq_ignore_ascii_case(&self.opened.path) {
            return Some(&self.opened.file);
        }
        self.opened
            .media
            .iter()
            .find(|media| path.eq_ignore_ascii_case(&media.path))
            .map(|media| &media.file)
    }
}

impl AudioFiles for WithOpened<'_> {
    fn read(&self, path: &str) -> io::Result<Option<AudioFile<Vec<u8>>>> {
        if let Some(file) = self.held(path) {
            return Ok(Some(file.clone()));
        }
        self.rest.read(path)
    }

    fn open(&self, path: &str) -> io::Result<Option<AudioFile<Box<dyn ReadSeek>>>> {
        if let Some(file) = self.held(path) {
            let file = file.clone();
            return Ok(Some(AudioFile {
                asset: file.asset,
                contents: Box::new(io::Cursor::new(file.contents)) as Box<dyn ReadSeek>,
            }));
        }
        self.rest.open(path)
    }
}

/// The events of an opened event bank, and the files of its bank set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AudioEventList {
    /// Every event of the opened bank, in file order.
    pub events: Vec<AudioEvent>,
    /// The files of the bank set, the opened bank first.
    pub files: Vec<SetFile>,
    /// Where the files of the set beside the opened bank come from.
    pub origin: BankSetOrigin,
}

/// One event of an event bank, without its tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AudioEvent {
    /// The object ID of the event.
    pub id: u32,
    /// The name that hashes to the ID, or `None` if no index names it.
    pub name: Option<String>,
    /// The number of actions of the event.
    pub action_count: u32,
    /// The number of sounds under the event's Play actions.
    pub media_count: u32,
    /// Whether every object and media of the tree resolves.
    pub status: EventStatus,
    /// The contextual rules that play the event.
    pub contexts: Vec<EventContext>,
    /// The `events[i]` row of the first ranked bank unit that lists the event's name.
    pub listed: Option<SiteRow>,
    /// The sounds and containers that the event's Play actions reach, each once, in the order
    /// that the event tree draws them. The frontend derives their names from it.
    pub nodes: Vec<ReachedNode>,
}

/// A sound or container that a Play action of an event reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReachedNode {
    /// The object ID of the node.
    pub id: u32,
    /// The kind of the node.
    pub role: NodeRole,
    /// The source ID of a sound's media, and `None` for a container.
    pub source: Option<u32>,
}

/// What a node does in a play tree: a sound, or a container of one kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum NodeRole {
    /// A sound, kind 2.
    Sound,
    /// A random container, kind 5, whose pick is random.
    Random,
    /// A random container, kind 5, that plays its playlist in order.
    Sequence,
    /// A switch container, kind 6.
    Switch,
    /// A layer container, kind 9.
    Layer,
    /// An actor-mixer, kind 7.
    Mixer,
}

/// One contextual rule that plays an event, matched by a composed name.
///
/// The composition is observed in shipped data, so the match is an inference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct EventContext {
    /// The situation's name, such as `SpellCast`, or its hash if no table names it.
    pub situation: String,
    /// The `mSituations` key of the situation.
    pub situation_key: u32,
    /// `mRuleName`, such as `Basic 1`.
    pub rule: Option<String>,
    /// The percent of the rule's one `ContextualConditionChanceToPlay`, or `None` if it has none
    /// or several.
    pub chance: Option<u8>,
    /// The audience whose event name matched.
    pub audience: Audience,
    /// `true` if another composition of the rule is an event of the bank too.
    pub ambiguous: bool,
    /// The rule row of the `ContextualActionData` object.
    pub row: SiteRow,
}

/// Returns the context of `found`, from the first index that declares its object.
fn context_of(
    found: &ContextualMatch,
    indexes: &[&AudioIndex],
    names: &dyn SiteNames,
) -> Option<EventContext> {
    let rules = indexes
        .iter()
        .find_map(|index| index.contextual(found.object))?;
    let rule = rules.rules.get(found.rule)?;

    Some(EventContext {
        situation: names
            .hash_name(rule.situation)
            .unwrap_or_else(|| hex(rule.situation)),
        situation_key: rule.situation,
        rule: rule.name.clone(),
        chance: rule.chance,
        audience: found.audience,
        ambiguous: found.ambiguous,
        row: site_row(
            &rules.bin,
            found.object,
            CONTEXTUAL_ACTION_DATA.0,
            Some(&rule.steps),
            names,
        ),
    })
}

/// Whether every object and media of an event's tree resolves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EventStatus {
    /// Every object and every media resolves.
    Resolved,
    /// A sound names a media that no file of the set contains.
    MediaMissing,
    /// An action or a node names an object that no bank of the set contains.
    ObjectMissing,
    /// An object of the tree cannot be decoded.
    DecodeError {
        /// The ID of the object that does not decode.
        object: u32,
        /// The game path of the bank that contains the object.
        bank: String,
        /// The error of the decode.
        message: String,
    },
}

/// One file of the bank set of an event bank.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SetFile {
    /// The game path of the file, localized for a voice-over file that was read so.
    pub path: String,
    /// The layer file or game chunk that contains the file, or `None` if no store contains it.
    pub asset: Option<AssetRef>,
    /// Whether the file was read.
    pub state: SetFileState,
    /// `true` for the file that the document opened.
    pub opened: bool,
}

/// Whether a file of a bank set was read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SetFileState {
    /// The file was read as a bank or mounted as a package.
    Found,
    /// No layer and no game archive contains the path.
    Missing,
    /// The file does not read, with the error of the read.
    Failed { message: String },
}

/// The play tree of one event, as the event tree draws it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct EventTree {
    /// The object ID of the event.
    pub event: u32,
    /// The name that hashes to the ID, or `None` if no index names it.
    pub name: Option<String>,
    /// The actions of the event, in the order that the client runs them.
    pub actions: Vec<EventAction>,
}

/// One action of an event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct EventAction {
    /// The object ID of the action.
    pub id: u32,
    /// The class of the action, `0x0400` for Play. `None` if no bank contains the action.
    pub class: Option<u16>,
    /// The name of the class, or `0x` and four hex digits for a class without a name.
    pub label: Option<String>,
    /// The object ID that the action targets.
    pub target: Option<u32>,
    /// The tree under a Play action. `None` for another class, and for a target that the walk
    /// visited before.
    pub node: Option<EventNode>,
    /// The milliseconds that the client waits before it runs the action.
    pub delay: u32,
}

/// One object under a Play action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EventNode {
    /// A sound: one media that plays.
    Sound {
        /// The object ID of the sound.
        id: u32,
        /// The source ID of the media.
        source: u32,
        /// Where the media of the sound is stored.
        stream: SoundStream,
        /// The file that contains the media, or `None` if no file of the set contains it.
        media: Option<MediaLocation>,
    },
    /// A random or sequence container: one item of `playlist` plays.
    Random {
        id: u32,
        children: Vec<EventNode>,
        mode: PlayMode,
        /// The items of the playlist that name a child of `children`, in playlist order.
        playlist: Vec<EventPlaylistItem>,
    },
    /// A switch container: the children of `pick` play.
    Switch {
        id: u32,
        children: Vec<EventNode>,
        /// The ID of the switch group or the state group, the FNV-1 hash of its name.
        group: u32,
        /// The switch that plays when the game sets no switch of the group.
        default_switch: u32,
        pick: EventSwitchPick,
    },
    /// A layer container: every child plays.
    Layer { id: u32, children: Vec<EventNode> },
    /// An actor-mixer: every child plays.
    Mixer { id: u32, children: Vec<EventNode> },
    /// An object of a kind that does not play.
    Unsupported {
        id: u32,
        /// The object kind, the `HIRC` type byte.
        object_kind: u8,
        /// The kind's name, such as `MusicSegment`.
        kind_name: String,
        /// `true` for a music object.
        music: bool,
    },
    /// No bank of the set contains the ID.
    Missing { id: u32 },
}

/// One item of the playlist of a random or sequence container.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct EventPlaylistItem {
    /// The index of the child in the `children` of the container.
    pub child: u32,
    /// The weight of the item in a random pick, relative to the other items.
    pub weight: u32,
}

/// The children of a switch container that play.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EventSwitchPick {
    /// The nodes of the default switch, as indexes into the `children` of the container.
    Default { nodes: Vec<u32> },
    /// The default switch names no child of the container, so the first child plays.
    FirstChild,
}

/// Where the media of a sound is stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum SoundStream {
    /// In the media index of a bank.
    DataBank,
    /// Its start in a bank, the whole media in a package.
    Prefetch,
    /// In a package.
    Streaming,
    /// A stream type that `ltk_wwise` does not name.
    Other,
}

impl From<StreamType> for SoundStream {
    fn from(stream: StreamType) -> Self {
        match stream {
            StreamType::DATA_BANK => Self::DataBank,
            StreamType::PREFETCH => Self::Prefetch,
            StreamType::STREAMING => Self::Streaming,
            _ => Self::Other,
        }
    }
}

/// The file that contains the media of a sound, and the source ID that a preview URL reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MediaLocation {
    /// The layer file or game chunk that contains the media.
    pub asset: AssetRef,
    /// The game path of the file.
    pub path: String,
    /// The source ID of the media.
    pub source: u32,
    /// The kind of file that contains the media.
    pub container: MediaContainer,
}

/// The properties of one action or node of an event tree that an edit sets.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObjectProperties {
    /// The object ID.
    pub id: u32,
    /// `true` for an object of the opened bank at version 145, which an edit changes.
    pub editable: bool,
    /// Every property that the object takes, in the unit of [`NodeProperty`].
    pub values: Vec<PropertyValue>,
    /// The playlist weights of a random or sequence container.
    pub weights: Option<PlaylistWeights>,
}

/// The value of one property, in the unit of [`NodeProperty`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PropertyValue {
    pub property: NodeProperty,
    pub value: f32,
}

/// The weights of the playlist of a random or sequence container, as the bank holds them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PlaylistWeights {
    /// `true` if a random pick reads the weights.
    pub weighted: bool,
    /// The items of the playlist, in playlist order.
    pub items: Vec<PlaylistWeight>,
}

/// The weight of one playlist item. Wwise shows the weight divided by 1000.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PlaylistWeight {
    /// The object ID of the child.
    pub child: u32,
    pub weight: u32,
}

/// One sound or container of a bank set, which an edit adds as a child or a Play target.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BankNode {
    /// The object ID.
    pub id: u32,
    /// The object kind, the `HIRC` type byte.
    pub object_kind: u8,
    /// The kind's name, such as `Sound`.
    pub kind_name: String,
    /// The game path of the bank that holds the object.
    pub bank: String,
}

/// The kind of file that contains a media.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum MediaContainer {
    /// A media bank or an event bank, in its media index.
    Bank,
    /// A package, in one of its entries.
    Package,
}
