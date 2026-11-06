//! The edits that add, copy, wrap and delete objects. "New objects" in `docs/ux/AUDIO.md`.
//!
//! Every container lists each child whose `parent` names it, and every child names the container
//! that lists it. A Play target is not a child, so a node that a Play action plays directly sits
//! under the actor-mixer above its template.

use ltk_wwise::hierarchy::{
    Action, Container, ContainerFields, ContainerMode, Event, NodeBase, ObjectKind, PlaylistItem,
    PropBundle, RandomSequenceFields, RangedPropBundle, Sound, StreamType, SwitchNodeParams,
    SwitchNodes, Typed,
};
use ltk_wwise::wem::{WemCodec, WemInfo};
use ltk_wwise::{ObjectId, SourceId};

use super::history::{Site, Tx};
use super::media_file::MediaFile;
use super::{
    BankEditError, CHILD_KINDS, ContainerKind, DEFAULT_WEIGHT, NewNode, NodeParent, PLAY_TARGETS,
};
use crate::bank_set::BankContent;
use crate::decode::decode;

/// The plugin ID of the Wwise Vorbis codec.
pub(super) const VORBIS_PLUGIN: u32 = 0x0004_0001;

/// The plugin ID of the Wwise Opus codec.
pub(super) const OPUS_PLUGIN: u32 = 0x0006_0001;

/// The plugin ID of the Wwise ADPCM codec.
pub(super) const ADPCM_PLUGIN: u32 = 0x0002_0002;

/// The plugin ID of the Wwise PCM codec.
pub(super) const PCM_PLUGIN: u32 = 0x0001_0001;

/// Returns the plugin ID that plays `codec`, or `None` if the codec is unsupported.
pub(super) fn plugin_id_for_codec(codec: WemCodec) -> Option<u32> {
    match codec {
        WemCodec::VORBIS => Some(VORBIS_PLUGIN),
        WemCodec::OPUS | WemCodec::WWISE_OPUS | WemCodec(0x0302) => Some(OPUS_PLUGIN),
        WemCodec::ADPCM => Some(ADPCM_PLUGIN),
        WemCodec::PCM | WemCodec::PCM_EXTENSIBLE => Some(PCM_PLUGIN),
        _ => None,
    }
}

/// Creates the event `name` with no action, or with a deep copy of the actions of `copy_of`.
pub(super) fn new_event(
    tx: &mut Tx<'_, '_>,
    name: &str,
    copy_of: Option<u32>,
) -> Result<(), BankEditError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(BankEditError::EventName);
    }

    let id = ObjectId::from_name(name);
    if tx.is_object_taken(id) {
        return Err(BankEditError::EventExists(name.to_owned()));
    }
    tx.drawn.insert(id.0);

    let mut actions = Vec::new();
    if let Some(original) = copy_of {
        for action in event(tx, ObjectId(original))?.actions {
            actions.push(copy_action(tx, action)?);
        }
    }

    tx.push(&Typed::Event(Event { id, actions }))?;
    tx.names.push(name.to_owned());
    Ok(())
}

/// Gives the event `event` the ID of `name`, in its place in the file, with its actions.
pub(super) fn rename_event(
    tx: &mut Tx<'_, '_>,
    event: u32,
    name: &str,
) -> Result<(), BankEditError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(BankEditError::EventName);
    }

    let old = ObjectId(event);
    let mut renamed = self::event(tx, old)?;
    let id = ObjectId::from_name(name);
    if id == old {
        return Ok(());
    }
    if tx.is_object_taken(id) {
        return Err(BankEditError::EventExists(name.to_owned()));
    }

    let at = tx.position(old).ok_or(BankEditError::NoObject(event))?;
    tx.remove(old);
    renamed.id = id;
    tx.insert(at, &Typed::Event(renamed))?;
    tx.names.push(name.to_owned());
    Ok(())
}

/// Adds `node` under `parent`, and returns the ID of the node that the parent then holds.
pub(super) fn add_node(
    tx: &mut Tx<'_, '_>,
    parent: &NodeParent,
    node: &NewNode,
) -> Result<ObjectId, BankEditError> {
    match (*parent, *node) {
        (NodeParent::Container { container }, NewNode::Existing { node }) => {
            move_into(tx, ObjectId(container), ObjectId(node))?;
            Ok(ObjectId(node))
        }
        (NodeParent::Event { event }, NewNode::Existing { node }) => {
            let target = ObjectId(node);
            match tx.locate(target) {
                Some((kind, _)) if PLAY_TARGETS.contains(&kind) => {}
                _ => return Err(BankEditError::NoNode(node)),
            }
            add_play(tx, ObjectId(event), target)?;
            Ok(target)
        }
        (_, NewNode::Sound { source }) => place(tx, parent, |tx, parent, near| {
            let template = template_sound(tx, near)?;
            let (stream, size) = media_of(tx, SourceId(source))?;
            let mut sound = new_sound(tx, &template, parent, SourceId(source), stream, size);
            sound.source.plugin_id =
                media_plugin_id(tx, SourceId(source)).unwrap_or(template.source.plugin_id);
            Ok(Typed::Sound(sound))
        }),
        (_, NewNode::Container { container }) => place(tx, parent, |tx, parent, near| {
            Ok(Typed::Container(new_container(
                tx, container, parent, near,
            )?))
        }),
    }
}

/// Adds the WEM `wem` as a new media and a new sound that plays it under `parent`, and returns the
/// sound's ID and the media's source ID.
///
/// The media goes into the file that the template sound's stream type reads: the media bank for a
/// sound of a bank's media index, the package for a streamed one. If the set has no such file,
/// the other one takes it.
pub(super) fn import(
    tx: &mut Tx<'_, '_>,
    parent: &NodeParent,
    wem: Vec<u8>,
) -> Result<(ObjectId, SourceId), BankEditError> {
    let info = check_wem(&wem)?;
    let plugin_id = plugin_id_for_codec(info.codec).ok_or(BankEditError::Codec(info.codec.0))?;

    let mut added = SourceId(0);
    let sound = place(tx, parent, |tx, parent, near| {
        let template = template_sound(tx, near)?;
        let streamed = template.source.stream_type != StreamType::DATA_BANK;
        let (file, stream) = media_file(tx, streamed)?;

        let source = tx.fresh_source(&wem);
        let size = u32::try_from(wem.len()).unwrap_or(u32::MAX);
        tx.add_media(file, source, wem);
        added = source;

        let mut sound = new_sound(tx, &template, parent, source, stream, size);
        sound.source.plugin_id = plugin_id;
        Ok(Typed::Sound(sound))
    })?;
    Ok((sound, added))
}

/// Adds a copy of `object` beside it, with every object below it of the opened bank copied.
///
/// `parent` is the container that lists the object, the Play action that plays it, or the event
/// that runs the action `object`.
pub(super) fn duplicate(
    tx: &mut Tx<'_, '_>,
    object: u32,
    parent: u32,
) -> Result<(), BankEditError> {
    let id = ObjectId(object);
    let parent = ObjectId(parent);
    match tx.typed(parent)? {
        Typed::Container(container) => {
            let weight = playlist_weight(&container, id);
            if !container.children.contains(&id) {
                return Err(BankEditError::NotChild {
                    container: parent.0,
                    child: object,
                });
            }
            let copy = copy_subtree(tx, id)?;
            adopt(tx, parent, copy, weight)
        }
        Typed::Action(action) if action.target == id => {
            let copy = copy_subtree(tx, id)?;
            let play = copy_play(tx, &action, copy)?;
            insert_action_after(tx, action.id, play)
        }
        Typed::Event(event) if event.actions.contains(&id) => {
            let copy = copy_action(tx, id)?;
            let event = self::event(tx, event.id)?;
            insert_in_event(tx, event, id, copy)
        }
        _ => Err(BankEditError::NotChild {
            container: parent.0,
            child: object,
        }),
    }
}

/// Deletes `object` from under `parent`, and removes it if no other object references it.
///
/// `parent` is the container that lists the object, the Play action that plays it, or the event
/// that runs the action `object`. `None` deletes the event `object`. An object that is still
/// referenced is kept, and only the link to `parent` goes. Every object of the opened bank that
/// the delete leaves unreferenced is removed with it.
pub(super) fn delete(
    tx: &mut Tx<'_, '_>,
    object: u32,
    parent: Option<u32>,
) -> Result<(), BankEditError> {
    let id = ObjectId(object);
    if tx.object(id).is_none() {
        return Err(BankEditError::NoObject(object));
    }

    let Some(parent) = parent.map(ObjectId) else {
        let actions = event(tx, id)?.actions;
        tx.remove(id);
        for action in actions {
            prune(tx, action, None)?;
        }
        return Ok(());
    };

    match tx.typed(parent)? {
        Typed::Container(mut container) => {
            if !container.remove_child(id) {
                return Err(BankEditError::NotChild {
                    container: parent.0,
                    child: object,
                });
            }
            tx.put(&Typed::Container(container))?;
            prune(tx, id, Some(parent))
        }
        Typed::Action(action) if action.target == id => {
            unlink_action(tx, action.id)?;
            prune(tx, action.id, None)
        }
        Typed::Event(mut event) if event.actions.contains(&id) => {
            event.actions.retain(|&action| action != id);
            tx.put(&Typed::Event(event))?;
            prune(tx, id, None)
        }
        _ => Err(BankEditError::NotChild {
            container: parent.0,
            child: object,
        }),
    }
}

/// Puts `objects` into a new container of `kind`, which takes their place under `parent`.
///
/// `parent` is the container that lists every object, or the Play action that plays the one
/// object.
pub(super) fn wrap(
    tx: &mut Tx<'_, '_>,
    objects: &[u32],
    parent: u32,
    kind: ContainerKind,
) -> Result<(), BankEditError> {
    let parent = ObjectId(parent);
    let ids: Vec<ObjectId> = objects.iter().copied().map(ObjectId).collect();
    let Some(&first) = ids.first() else {
        return Ok(());
    };
    for &id in &ids {
        if tx.object(id).is_none() {
            return Err(BankEditError::NoObject(id.0));
        }
    }

    match tx.typed(parent)? {
        Typed::Container(mut holder) => {
            for &id in &ids {
                if !holder.children.contains(&id) {
                    return Err(BankEditError::NotChild {
                        container: parent.0,
                        child: id.0,
                    });
                }
            }
            let weights: Vec<u32> = ids
                .iter()
                .map(|&id| playlist_weight(&holder, id).unwrap_or(DEFAULT_WEIGHT))
                .collect();

            let wrapper = new_wrapper(tx, kind, parent, &ids, &weights)?;
            holder.replace_child(first, wrapper);
            for &id in &ids[1..] {
                holder.remove_child(id);
            }
            holder.children.sort_unstable();
            tx.put(&Typed::Container(holder))?;
            reparent(tx, &ids, wrapper)
        }
        Typed::Action(mut action) if action.action_type.is_play() && ids == [action.target] => {
            let above = node_parent(tx, first).unwrap_or_default();
            let wrapper = new_wrapper(tx, kind, above, &ids, &[DEFAULT_WEIGHT])?;
            action.target = wrapper;
            tx.put(&Typed::Action(action))?;

            if let Ok(Typed::Container(mut holder)) = tx.typed(above)
                && holder.replace_child(first, wrapper)
            {
                holder.children.sort_unstable();
                tx.put(&Typed::Container(holder))?;
            }
            reparent(tx, &ids, wrapper)
        }
        _ => Err(BankEditError::NotChild {
            container: parent.0,
            child: first.0,
        }),
    }
}

/// Moves `node` of the opened bank from its parent into `container`.
fn move_into(
    tx: &mut Tx<'_, '_>,
    container: ObjectId,
    node: ObjectId,
) -> Result<(), BankEditError> {
    let holder = typed_container(tx, container)?;
    if matches!(holder.fields, ContainerFields::Layer(_)) {
        return Err(BankEditError::Grouped(container.0));
    }
    if node == container {
        return Err(BankEditError::OwnChild(container.0));
    }
    if holder.children.contains(&node) {
        return Err(BankEditError::AlreadyChild {
            container: container.0,
            child: node.0,
        });
    }
    match tx.locate(node) {
        Some((kind, Site::Opened)) if CHILD_KINDS.contains(&kind) => {}
        Some((kind, Site::Other(_))) if CHILD_KINDS.contains(&kind) => {
            return Err(BankEditError::OtherBank(node.0));
        }
        _ => return Err(BankEditError::NoNode(node.0)),
    }
    if holds(tx, node, container) {
        return Err(BankEditError::Cycle {
            container: container.0,
            child: node.0,
        });
    }

    if let Some(old) = node_parent(tx, node).filter(|&old| old != container)
        && let Ok(Typed::Container(mut previous)) = tx.typed(old)
    {
        previous.remove_child(node);
        tx.put(&Typed::Container(previous))?;
    }

    adopt(tx, container, node, None)?;
    set_parent(tx, node, container)
}

/// Pushes the node that `build` returns and links it under `parent`.
///
/// `build` takes the `parent` field of the new node and the container to take a template from.
/// Under an event, the node's `parent` is the actor-mixer above its template, which lists it, and
/// a new Play action plays it.
fn place(
    tx: &mut Tx<'_, '_>,
    parent: &NodeParent,
    build: impl FnOnce(&mut Tx<'_, '_>, ObjectId, Option<ObjectId>) -> Result<Typed, BankEditError>,
) -> Result<ObjectId, BankEditError> {
    match *parent {
        NodeParent::Container { container } => {
            let container = ObjectId(container);
            let holder = typed_container(tx, container)?;
            if matches!(holder.fields, ContainerFields::Layer(_)) {
                return Err(BankEditError::Grouped(container.0));
            }

            let node = build(tx, container, Some(container))?;
            let id = node.id();
            if let Some(at) = tx.position(container) {
                tx.insert(at, &node)?;
            } else {
                tx.push(&node)?;
            }
            adopt(tx, container, id, None)?;
            Ok(id)
        }
        NodeParent::Event { event: owner } => {
            let owner = ObjectId(owner);
            event(tx, owner)?;

            let mixer = event_mixer(tx);
            let node = build(tx, mixer, None)?;
            let id = node.id();
            if let Some(at) = tx.position(mixer) {
                tx.insert(at, &node)?;
            } else {
                tx.push(&node)?;
            }
            if is_mixer_of_opened(tx, mixer) {
                adopt(tx, mixer, id, None)?;
            }
            add_play(tx, owner, id)?;
            Ok(id)
        }
    }
}

/// Appends a new Play action of `target` to the event `owner`.
fn add_play(tx: &mut Tx<'_, '_>, owner: ObjectId, target: ObjectId) -> Result<(), BankEditError> {
    let mut parent = event(tx, owner)?;
    let id = tx.fresh_object();
    let bank = tx.bank_of(target);
    tx.push(&Typed::Action(Action::play(id, target, bank)))?;

    parent.actions.push(id);
    tx.put(&Typed::Event(parent))
}

/// Links `child` under `container`: the children in ID order, the end of a playlist at `weight`
/// or the default weight, or the default switch's nodes.
fn adopt(
    tx: &mut Tx<'_, '_>,
    container: ObjectId,
    child: ObjectId,
    weight: Option<u32>,
) -> Result<(), BankEditError> {
    let mut holder = typed_container(tx, container)?;
    if holder.children.contains(&child) {
        return Ok(());
    }

    let at = holder
        .children
        .partition_point(|existing| *existing < child);
    holder.children.insert(at, child);
    match &mut holder.fields {
        ContainerFields::RandomSequence(fields) => fields.playlist.push(PlaylistItem {
            child,
            weight: weight.unwrap_or(DEFAULT_WEIGHT),
        }),
        ContainerFields::Switch(fields) => {
            let switch = fields.default_switch;
            match fields
                .switches
                .iter_mut()
                .find(|each| each.switch == switch)
            {
                Some(entry) => entry.nodes.push(child),
                None => fields.switches.push(SwitchNodes {
                    switch,
                    nodes: vec![child],
                }),
            }
            fields.params.push(SwitchNodeParams {
                node: child,
                ..SwitchNodeParams::default()
            });
        }
        ContainerFields::ActorMixer => {}
        ContainerFields::Layer(_) => return Err(BankEditError::Grouped(container.0)),
    }
    tx.put(&Typed::Container(holder))
}

/// Removes `id` if nothing references it any more, and the objects below it that it leaves
/// unreferenced.
///
/// A kept node whose `parent` names `from`, the container it left, takes the container that
/// still lists it, or the parent of `from`.
fn prune(tx: &mut Tx<'_, '_>, id: ObjectId, from: Option<ObjectId>) -> Result<(), BankEditError> {
    if tx.object(id).is_none() {
        return Ok(());
    }

    if is_referenced(tx, id) {
        if let Some(from) = from {
            keep_parent(tx, id, from)?;
        }
        return Ok(());
    }

    let below = match tx.typed(id) {
        Ok(Typed::Container(container)) if container.kind() == ObjectKind::ACTOR_MIXER => {
            return Ok(());
        }
        Ok(Typed::Container(container)) => container.children,
        Ok(Typed::Action(action)) => vec![action.target],
        Ok(Typed::Sound(sound)) => {
            drop_unused_media(tx, sound.id, sound.source.source_id);
            Vec::new()
        }
        Ok(Typed::Event(_)) => return Ok(()),
        Ok(_) | Err(_) => Vec::new(),
    };

    for holder in holders(tx, id) {
        if let Ok(Typed::Container(mut container)) = tx.typed(holder) {
            container.remove_child(id);
            tx.put(&Typed::Container(container))?;
        }
    }
    tx.remove(id);

    for child in below {
        prune(tx, child, None)?;
    }
    Ok(())
}

/// Points the `parent` of the kept node `id` at a container that lists it, if it named `from`.
fn keep_parent(tx: &mut Tx<'_, '_>, id: ObjectId, from: ObjectId) -> Result<(), BankEditError> {
    if node_parent(tx, id) != Some(from) {
        return Ok(());
    }

    if let Some(&holder) = holders(tx, id).first() {
        return set_parent(tx, id, holder);
    }

    let above = node_parent(tx, from).unwrap_or_default();
    if tx
        .typed(above)
        .is_ok_and(|typed| matches!(typed, Typed::Container(_)))
    {
        adopt(tx, above, id, None)?;
    }
    set_parent(tx, id, above)
}

/// Returns `true` if an object of the set plays `id`: a container that is not an actor-mixer
/// lists it, an action targets it, or an event runs it.
fn is_referenced(tx: &Tx<'_, '_>, id: ObjectId) -> bool {
    let references = |typed: Typed| match typed {
        Typed::Container(container) => {
            container.kind() != ObjectKind::ACTOR_MIXER && container.children.contains(&id)
        }
        Typed::Action(action) => action.target == id,
        Typed::Event(event) => event.actions.contains(&id),
        _ => false,
    };

    let opened = tx
        .objects()
        .iter()
        .filter(|object| object.id() != id && is_holder_kind(object.kind()))
        .filter_map(|object| object.decode(tx.version).ok().flatten())
        .any(references);
    if opened {
        return true;
    }

    tx.context
        .set
        .files()
        .iter()
        .skip(1)
        .filter_map(|file| match file.content() {
            BankContent::Bank { bank } => bank.hierarchy().map(|h| (bank, h)),
            _ => None,
        })
        .any(|(bank, hierarchy)| {
            hierarchy
                .objects()
                .iter()
                .filter(|object| is_holder_kind(object.kind()))
                .filter_map(|object| object.decode(bank.header().version).ok().flatten())
                .any(references)
        })
}

fn is_holder_kind(kind: ObjectKind) -> bool {
    kind == ObjectKind::ACTION || kind == ObjectKind::EVENT || CHILD_KINDS.contains(&kind)
}

/// Returns the containers of the opened bank that list `id`, in file order.
fn holders(tx: &Tx<'_, '_>, id: ObjectId) -> Vec<ObjectId> {
    tx.objects()
        .iter()
        .filter(|object| CHILD_KINDS.contains(&object.kind()) && object.id() != id)
        .filter_map(|object| match object.decode(tx.version).ok().flatten() {
            Some(Typed::Container(container)) if container.children.contains(&id) => {
                Some(container.id)
            }
            _ => None,
        })
        .collect()
}

/// Removes the media `source` if no sound but `sound` plays it.
fn drop_unused_media(tx: &mut Tx<'_, '_>, sound: ObjectId, source: SourceId) {
    let used_in_opened = tx.objects().iter().any(|object| {
        object.id() != sound
            && object.kind() == ObjectKind::SOUND
            && matches!(
                object.decode(tx.version),
                Ok(Some(Typed::Sound(other))) if other.source.source_id == source
            )
    });
    if used_in_opened {
        return;
    }

    let used_in_set = tx
        .context
        .set
        .files()
        .iter()
        .skip(1)
        .filter_map(|file| match file.content() {
            BankContent::Bank { bank } => bank.hierarchy().map(|h| (bank, h)),
            _ => None,
        })
        .any(|(bank, hierarchy)| {
            hierarchy
                .objects()
                .iter()
                .filter(|object| object.kind() == ObjectKind::SOUND)
                .filter_map(|object| object.decode(bank.header().version).ok().flatten())
                .any(|typed| {
                    matches!(typed, Typed::Sound(other) if other.source.source_id == source)
                })
        });
    if used_in_set {
        return;
    }

    if let Some(pkg_idx) = tx.context.set.package_with_media(source) {
        let path = tx.context.set.files()[pkg_idx].path().to_owned();
        let _ = read_media_file(tx, &path, true);
    }
    if let Some(bank_idx) = tx.context.set.bank_with_media(source) {
        if bank_idx != 0 {
            let path = tx.context.set.files()[bank_idx].path().to_owned();
            let _ = read_media_file(tx, &path, false);
        }
    }

    for file in 0..tx.media.len() {
        if tx.media[file].contains(source) {
            tx.remove_media(file, source);
        }
    }
}

/// Removes the action `action` from every event of the opened bank that runs it.
fn unlink_action(tx: &mut Tx<'_, '_>, action: ObjectId) -> Result<(), BankEditError> {
    let owners: Vec<ObjectId> = tx
        .objects()
        .iter()
        .filter(|object| object.kind() == ObjectKind::EVENT)
        .map(|object| object.id())
        .collect();
    for owner in owners {
        let mut event = event(tx, owner)?;
        if event.actions.contains(&action) {
            event.actions.retain(|&each| each != action);
            tx.put(&Typed::Event(event))?;
        }
    }
    Ok(())
}

/// Returns a copy of the action `action` with a fresh ID, its target copied if it is a node of the
/// opened bank.
fn copy_action(tx: &mut Tx<'_, '_>, action: ObjectId) -> Result<ObjectId, BankEditError> {
    let Typed::Action(original) = tx.typed(action)? else {
        return Err(BankEditError::Kind {
            id: action.0,
            expected: "an action",
        });
    };

    let target = match tx.locate(original.target) {
        Some((kind, Site::Opened)) if CHILD_KINDS.contains(&kind) => {
            copy_subtree(tx, original.target)?
        }
        _ => original.target,
    };
    copy_play(tx, &original, target)
}

/// Pushes a copy of `action` with a fresh ID that targets `target`, and returns its ID.
fn copy_play(
    tx: &mut Tx<'_, '_>,
    action: &Action,
    target: ObjectId,
) -> Result<ObjectId, BankEditError> {
    let mut copy = action.clone();
    copy.id = tx.fresh_object();
    copy.target = target;
    tx.push(&Typed::Action(copy.clone()))?;
    Ok(copy.id)
}

/// Inserts the action `copy` after `after` in the first event of the opened bank that runs it.
fn insert_action_after(
    tx: &mut Tx<'_, '_>,
    after: ObjectId,
    copy: ObjectId,
) -> Result<(), BankEditError> {
    let owner = tx
        .objects()
        .iter()
        .filter(|object| object.kind() == ObjectKind::EVENT)
        .map(|object| object.id())
        .find(|&owner| event(tx, owner).is_ok_and(|event| event.actions.contains(&after)))
        .ok_or(BankEditError::NoObject(after.0))?;
    let owner = event(tx, owner)?;
    insert_in_event(tx, owner, after, copy)
}

fn insert_in_event(
    tx: &mut Tx<'_, '_>,
    mut owner: Event,
    after: ObjectId,
    copy: ObjectId,
) -> Result<(), BankEditError> {
    let at = owner
        .actions
        .iter()
        .position(|&action| action == after)
        .map_or(owner.actions.len(), |at| at + 1);
    owner.actions.insert(at, copy);
    tx.put(&Typed::Event(owner))
}

/// Pushes a copy of the node `id` and of every node below it of the opened bank, each with a
/// fresh ID, and returns the copy's ID.
///
/// The copy's `parent` is that of `id`. An actor-mixer parent lists the copy, and a container
/// parent lists it only when the caller adopts it.
fn copy_subtree(tx: &mut Tx<'_, '_>, id: ObjectId) -> Result<ObjectId, BankEditError> {
    let copy = copy_node(tx, id, None)?;
    if let Some(parent) = node_parent(tx, copy).filter(|&parent| is_mixer_of_opened(tx, parent)) {
        adopt(tx, parent, copy, None)?;
    }
    Ok(copy)
}

fn copy_node(
    tx: &mut Tx<'_, '_>,
    id: ObjectId,
    parent: Option<ObjectId>,
) -> Result<ObjectId, BankEditError> {
    let fresh = tx.fresh_object();
    let copy = match tx.typed(id)? {
        Typed::Sound(mut sound) => {
            sound.id = fresh;
            if let Some(parent) = parent {
                sound.node.parent = parent;
            }
            Typed::Sound(sound)
        }
        Typed::Container(mut container) => {
            container.id = fresh;
            if let Some(parent) = parent {
                container.node.parent = parent;
            }
            for child in container.children.clone() {
                if matches!(tx.locate(child), Some((_, Site::Opened))) {
                    let copied = copy_node(tx, child, Some(fresh))?;
                    container.replace_child(child, copied);
                }
            }
            container.children.sort_unstable();
            Typed::Container(container)
        }
        _ => {
            return Err(BankEditError::Kind {
                id: id.0,
                expected: "a sound or a container",
            });
        }
    };
    if let Some(at) = parent.and_then(|p| tx.position(p)) {
        tx.insert(at, &copy)?;
    } else {
        tx.push(&copy)?;
    }
    Ok(fresh)
}

/// Pushes a new container of `kind` under `parent` that lists `ids` at `weights`.
fn new_wrapper(
    tx: &mut Tx<'_, '_>,
    kind: ContainerKind,
    parent: ObjectId,
    ids: &[ObjectId],
    weights: &[u32],
) -> Result<ObjectId, BankEditError> {
    let mut wrapper = new_container(tx, kind, parent, None)?;
    let mut children = ids.to_vec();
    children.sort_unstable();
    wrapper.children = children;

    match &mut wrapper.fields {
        ContainerFields::RandomSequence(fields) => {
            fields.playlist = ids
                .iter()
                .zip(weights)
                .map(|(&child, &weight)| PlaylistItem { child, weight })
                .collect();
        }
        ContainerFields::Switch(fields) => {
            let switch = fields.default_switch;
            fields.switches = vec![SwitchNodes {
                switch,
                nodes: ids.to_vec(),
            }];
            fields.params = ids
                .iter()
                .map(|&node| SwitchNodeParams {
                    node,
                    ..SwitchNodeParams::default()
                })
                .collect();
        }
        ContainerFields::ActorMixer | ContainerFields::Layer(_) => {}
    }

    let id = wrapper.id;
    tx.push(&Typed::Container(wrapper))?;
    Ok(id)
}

/// Points the `parent` of every one of `ids` at `parent`.
fn reparent(tx: &mut Tx<'_, '_>, ids: &[ObjectId], parent: ObjectId) -> Result<(), BankEditError> {
    for &id in ids {
        set_parent(tx, id, parent)?;
    }
    Ok(())
}

/// Returns a new, empty container of `kind` under `parent`, with a fresh ID.
///
/// The node base comes from a container of the same kind in the opened bank, then in the set,
/// else from a sound. Its properties are dropped, so the container changes nothing that its
/// children play. A switch container takes the group and the default switch of its template, and
/// refuses if the set has no switch container.
fn new_container(
    tx: &mut Tx<'_, '_>,
    kind: ContainerKind,
    parent: ObjectId,
    near: Option<ObjectId>,
) -> Result<Container, BankEditError> {
    let wanted = match kind {
        ContainerKind::Random | ContainerKind::Sequence => ObjectKind::RANDOM_SEQUENCE_CONTAINER,
        ContainerKind::Switch => ObjectKind::SWITCH_CONTAINER,
    };

    let template = template_container(tx, wanted);
    let (mut node, fields) = match (template, kind) {
        (Some(container), ContainerKind::Switch) => {
            let ContainerFields::Switch(mut fields) = container.fields else {
                unreachable!("a template of kind 6 is a switch container");
            };
            fields.switches.clear();
            fields.params.clear();
            (container.node, ContainerFields::Switch(fields))
        }
        (None, ContainerKind::Switch) => return Err(BankEditError::NoSwitch),
        (template, ContainerKind::Random | ContainerKind::Sequence) => {
            let (node, mut fields) = match template {
                Some(Container {
                    node,
                    fields: ContainerFields::RandomSequence(fields),
                    ..
                }) => (node, fields),
                _ => (
                    template_sound(tx, near)?.node,
                    RandomSequenceFields {
                        loop_count: 1,
                        ..RandomSequenceFields::default()
                    },
                ),
            };
            fields.playlist.clear();
            fields.mode = if kind == ContainerKind::Sequence {
                ContainerMode::SEQUENCE
            } else {
                ContainerMode::RANDOM
            };
            (node, ContainerFields::RandomSequence(fields))
        }
    };

    clear_props(&mut node);
    node.parent = parent;
    Ok(Container {
        id: tx.fresh_object(),
        node,
        children: Vec::new(),
        fields,
    })
}

fn clear_props(node: &mut NodeBase) {
    node.props = PropBundle::new();
    node.ranged_props = RangedPropBundle::new();
}

/// Returns a copy of `template` with a fresh ID under `parent`, which plays `source`.
fn new_sound(
    tx: &mut Tx<'_, '_>,
    template: &Sound,
    parent: ObjectId,
    source: SourceId,
    stream: StreamType,
    size: u32,
) -> Sound {
    let mut sound = template.clone();
    sound.id = tx.fresh_object();
    sound.node.parent = parent;
    sound.source.source_id = source;
    sound.source.stream_type = stream;
    sound.source.in_memory_size = match stream {
        StreamType::DATA_BANK => size,
        StreamType::PREFETCH => template.source.in_memory_size.min(size),
        _ => 0,
    };
    sound
}

/// Returns the sound that a new sound copies its node base from: the first sound below `near`,
/// else the first sound of the opened bank, else of the set.
fn template_sound(tx: &Tx<'_, '_>, near: Option<ObjectId>) -> Result<Sound, BankEditError> {
    if let Some(sound) = near.and_then(|near| sound_below(tx, near, 0)) {
        return Ok(sound);
    }

    let opened = tx
        .objects()
        .iter()
        .filter(|object| object.kind() == ObjectKind::SOUND)
        .find_map(|object| match object.decode(tx.version) {
            Ok(Some(Typed::Sound(sound))) => Some(sound),
            _ => None,
        });
    if let Some(sound) = opened {
        return Ok(sound);
    }

    tx.context
        .set
        .files()
        .iter()
        .skip(1)
        .filter_map(|file| match file.content() {
            BankContent::Bank { bank } => bank.hierarchy().map(|h| (bank, h)),
            _ => None,
        })
        .find_map(|(bank, hierarchy)| {
            hierarchy.of_kind(ObjectKind::SOUND).find_map(|object| {
                match object.decode(bank.header().version) {
                    Ok(Some(Typed::Sound(sound))) => Some(sound),
                    _ => None,
                }
            })
        })
        .ok_or(BankEditError::NoTemplate)
}

/// The deepest that [`sound_below`] walks, against a cycle of containers.
const TEMPLATE_DEPTH: usize = 16;

fn sound_below(tx: &Tx<'_, '_>, id: ObjectId, depth: usize) -> Option<Sound> {
    if depth > TEMPLATE_DEPTH {
        return None;
    }

    match tx.typed_anywhere(id)? {
        Typed::Sound(sound) => Some(sound),
        Typed::Container(container) => container
            .children
            .iter()
            .find_map(|&child| sound_below(tx, child, depth + 1)),
        _ => None,
    }
}

/// Returns the first container of `kind` of the opened bank, else of the set.
fn template_container(tx: &Tx<'_, '_>, kind: ObjectKind) -> Option<Container> {
    let decoded = |object: &ltk_wwise::hierarchy::Object, version| match object.decode(version) {
        Ok(Some(Typed::Container(container))) => Some(container),
        _ => None,
    };

    tx.objects()
        .iter()
        .filter(|object| object.kind() == kind)
        .find_map(|object| decoded(object, tx.version))
        .or_else(|| {
            tx.context
                .set
                .files()
                .iter()
                .skip(1)
                .filter_map(|file| match file.content() {
                    BankContent::Bank { bank } => bank.hierarchy().map(|h| (bank, h)),
                    _ => None,
                })
                .find_map(|(bank, hierarchy)| {
                    hierarchy
                        .of_kind(kind)
                        .find_map(|object| decoded(object, bank.header().version))
                })
        })
}

/// Returns the actor-mixer that a node under an event sits in: the first actor-mixer above the
/// template sound, or zero.
fn event_mixer(tx: &Tx<'_, '_>) -> ObjectId {
    let Ok(template) = template_sound(tx, None) else {
        return ObjectId::default();
    };

    let mut current = template.node.parent;
    for _ in 0..TEMPLATE_DEPTH {
        match tx.typed_anywhere(current) {
            Some(Typed::Container(container)) if container.kind() == ObjectKind::ACTOR_MIXER => {
                return current;
            }
            Some(Typed::Container(container)) => current = container.node.parent,
            _ => break,
        }
    }
    ObjectId::default()
}

fn is_mixer_of_opened(tx: &Tx<'_, '_>, id: ObjectId) -> bool {
    matches!(tx.locate(id), Some((ObjectKind::ACTOR_MIXER, Site::Opened)))
}

/// Returns the stream type and the size of the media `source` of the set or the document.
fn media_of(tx: &Tx<'_, '_>, source: SourceId) -> Result<(StreamType, u32), BankEditError> {
    let size = |len: usize| u32::try_from(len).unwrap_or(u32::MAX);

    if let Some(media) = tx.context.set.banked_media(source) {
        return Ok((StreamType::DATA_BANK, size(media.len())));
    }
    if let Some(entry_size) = tx.context.set.packaged_size(source) {
        return Ok((StreamType::STREAMING, entry_size));
    }
    if let Some(file) = tx.media.iter().find(|file| file.contains(source)) {
        let stream = if file.is_package() {
            StreamType::STREAMING
        } else {
            StreamType::DATA_BANK
        };
        return Ok((stream, size(file.media(source).map_or(0, <[u8]>::len))));
    }
    Err(BankEditError::NoMedia {
        media: source.0,
        container: "media index or package",
    })
}

/// Returns the index of the document's media file that takes a new media, and the stream type
/// that a sound of it reads with.
///
/// The file is a package if `streamed`, else a media bank, and the other kind if the set has
/// none. A file of the set is read through the files of the context on its first media.
fn media_file(tx: &mut Tx<'_, '_>, streamed: bool) -> Result<(usize, StreamType), BankEditError> {
    let stream = |package: bool| {
        if package {
            StreamType::STREAMING
        } else {
            StreamType::DATA_BANK
        }
    };

    for package in [streamed, !streamed] {
        if let Some(at) = tx
            .media
            .iter()
            .position(|file| file.is_package() == package)
        {
            return Ok((at, stream(package)));
        }

        let found = tx
            .context
            .set
            .files()
            .iter()
            .skip(1)
            .find(|file| match file.content() {
                BankContent::Package { .. } => package,
                BankContent::Bank { bank } => !package && bank.media().is_some(),
                BankContent::Missing | BankContent::Failed { .. } => false,
            });
        let Some(found) = found else {
            continue;
        };

        let path = found.path().to_owned();
        return Ok((read_media_file(tx, &path, package)?, stream(package)));
    }
    Err(BankEditError::NoMediaFile)
}

/// Returns the index of the document's media file of the set file `path`, read through the files
/// of the context if the document does not hold it yet.
pub(super) fn read_media_file(
    tx: &mut Tx<'_, '_>,
    path: &str,
    package: bool,
) -> Result<usize, BankEditError> {
    if let Some(at) = tx.media.iter().position(|file| file.path() == path) {
        return Ok(at);
    }

    let files = tx.context.files.ok_or(BankEditError::NoMediaFile)?;
    let read = files
        .read(path)
        .map_err(|error| BankEditError::MediaRead(error.to_string()))?
        .ok_or(BankEditError::NoMediaFile)?;
    let file = MediaFile::read(path, read.asset, read.contents, package)?;
    tx.media.push(file);
    Ok(tx.media.len() - 1)
}

/// Returns the plugin ID of the media `source`, read from the document's media files or the set.
fn media_plugin_id(tx: &Tx<'_, '_>, source: SourceId) -> Option<u32> {
    let media = tx
        .media
        .iter()
        .find_map(|file| file.media(source))
        .or_else(|| tx.context.set.banked_media(source))?;
    let info = WemInfo::from_bytes(media).ok()?;
    plugin_id_for_codec(info.codec)
}

/// Fails if `wem` is not a WEM that decodes or has an unsupported codec.
pub(super) fn check_wem(wem: &[u8]) -> Result<WemInfo, BankEditError> {
    let info = WemInfo::from_bytes(wem).map_err(|error| BankEditError::Wem(error.to_string()))?;
    if plugin_id_for_codec(info.codec).is_none() {
        return Err(BankEditError::Codec(info.codec.0));
    }
    if matches!(info.codec, WemCodec::VORBIS | WemCodec::PCM | WemCodec::PCM_EXTENSIBLE) {
        decode(SourceId(0), wem).map_err(|error| BankEditError::Wem(error.reason.to_string()))?;
    }
    Ok(info)
}

/// Returns the event `id` of the opened bank.
fn event(tx: &Tx<'_, '_>, id: ObjectId) -> Result<Event, BankEditError> {
    match tx.typed(id)? {
        Typed::Event(event) => Ok(event),
        _ => Err(BankEditError::Kind {
            id: id.0,
            expected: "an event",
        }),
    }
}

fn typed_container(tx: &Tx<'_, '_>, id: ObjectId) -> Result<Container, BankEditError> {
    match tx.typed(id)? {
        Typed::Container(container) => Ok(container),
        _ => Err(BankEditError::Kind {
            id: id.0,
            expected: "a container",
        }),
    }
}

/// Returns the `parent` field of the node `id` of the opened bank.
fn node_parent(tx: &Tx<'_, '_>, id: ObjectId) -> Option<ObjectId> {
    match tx.typed(id).ok()? {
        Typed::Sound(sound) => Some(sound.node.parent),
        Typed::Container(container) => Some(container.node.parent),
        _ => None,
    }
}

fn set_parent(tx: &mut Tx<'_, '_>, id: ObjectId, parent: ObjectId) -> Result<(), BankEditError> {
    match tx.typed(id)? {
        Typed::Sound(mut sound) => {
            sound.node.parent = parent;
            tx.put(&Typed::Sound(sound))
        }
        Typed::Container(mut container) => {
            container.node.parent = parent;
            tx.put(&Typed::Container(container))
        }
        _ => Ok(()),
    }
}

/// Returns `true` if `target` is `node` or a node below it in the opened bank.
fn holds(tx: &Tx<'_, '_>, node: ObjectId, target: ObjectId) -> bool {
    fn walk(tx: &Tx<'_, '_>, node: ObjectId, target: ObjectId, depth: usize) -> bool {
        if node == target {
            return true;
        }
        if depth > TEMPLATE_DEPTH {
            return false;
        }
        match tx.typed(node) {
            Ok(Typed::Container(container)) => container
                .children
                .iter()
                .any(|&child| walk(tx, child, target, depth + 1)),
            _ => false,
        }
    }

    walk(tx, node, target, 0)
}

/// Returns the weight of the playlist item of `child` in a random container.
fn playlist_weight(container: &Container, child: ObjectId) -> Option<u32> {
    match &container.fields {
        ContainerFields::RandomSequence(fields) => fields
            .playlist
            .iter()
            .find(|item| item.child == child)
            .map(|item| item.weight),
        _ => None,
    }
}
