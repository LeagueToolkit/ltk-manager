//! The repair of `bin/skinhack`: removes the audio of another skin from a base skin.

use std::fmt;
use std::io::Cursor;

use ltk_hash::BinHash;
use ltk_meta::property::values::{Container, UnorderedContainer};
use ltk_meta::walk::{NodeRefMut, Visit, VisitorMut};
use ltk_meta::{BinDelta, BinKind, BinObject, BinStream, PropertyKind, PropertyValueEnum};
use ltk_wad::WadHash;

use super::{
    Markers, champion_of, embed, embed_mut, is_voice_over, items, list_mut, resolve_skin, skin_bin,
    skin_object, text, unit_name, unit_names_other_skin,
};
use crate::engine::parse_bin;
use crate::{FileHandle, FixFacts, FixPreview, ProjectFiles, SkinAudioRepair};
use ltk_manager_audio::{AudioIndex, BinAudio, EVENT_FIELDS};
use ltk_manager_base::hashing::named;

/// The class whose event field a clip plays.
const CLIP_EVENT: BinHash = named("SoundEventData");

/// The classes whose event fields a VFX system plays.
const VFX_EVENTS: [BinHash; 2] = [named("VfxSystemDefinitionData"), named("VfxEmitterAudio")];

/// Why a base skin is not repaired.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Refusal {
    /// The project has no installed game to read the base skin from.
    NoGame,
    /// `skin0.bin` does not declare the skin object with its audio properties.
    Elsewhere,
    /// The game's base skin has no SFX bank unit, and no base unit remains.
    BaseAudioMissing,
    /// `skin0.bin` changed since the check.
    Changed,
    /// The repaired bin would still be reported.
    StillReported,
    /// A bin does not read, parse or encode.
    Unreadable(String),
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoGame => f.write_str("The installed game is not available"),
            Self::Elsewhere => {
                f.write_str("skin0.bin does not declare the skin object with its audio properties")
            }
            Self::BaseAudioMissing => f.write_str(
                "Couldn't repair because the base audio is missing from the game's skin 0",
            ),
            Self::Changed => f.write_str("skin0.bin changed since the check"),
            Self::StillReported => f.write_str("The repaired bin still names another skin"),
            Self::Unreadable(message) => f.write_str(message),
        }
    }
}

/// One bin of the layer with the objects that the repair replaces.
#[derive(Debug)]
struct BinEdit {
    /// The path of the bin in its layer.
    path: String,
    /// The bin as the layer ships it.
    bytes: Vec<u8>,
    objects: Vec<BinObject>,
}

impl BinEdit {
    /// Returns the bytes of the bin with the objects replaced.
    ///
    /// A `PROP` bin is written through a delta, so the other objects keep their bytes. A
    /// `PTCH` bin, and a `PROP` bin that a delta refuses, is written whole.
    fn encoded(&self) -> Result<Vec<u8>, String> {
        if BinKind::identify_from_bytes(&self.bytes) == Some(BinKind::Prop)
            && let Ok(patched) = self.patched()
        {
            return Ok(patched);
        }

        let mut bin = parse_bin(&self.bytes)?;
        for object in &self.objects {
            bin.objects_mut().insert(object.path_hash, object.clone());
        }

        let mut out = Cursor::new(Vec::with_capacity(self.bytes.len()));
        bin.to_writer(&mut out).map_err(|error| error.to_string())?;
        Ok(out.into_inner())
    }

    fn patched(&self) -> Result<Vec<u8>, ltk_meta::Error> {
        let mut stream = BinStream::<_>::mount(Cursor::new(self.bytes.as_slice()))?;
        let mut delta = BinDelta::new();
        for object in &self.objects {
            delta.replace(object.clone());
        }

        let mut out = Vec::with_capacity(self.bytes.len());
        stream.write_patched(&delta, &mut out)?;
        Ok(out)
    }
}

/// How many event fields name another skin, by what the repair does with them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Events {
    /// Renamed to the base event.
    renamed: u32,
    /// Clip events kept, because no base event has the base name.
    silent_clips: u32,
    /// VFX events kept, for the same reason.
    silent_vfx: u32,
}

/// The repair of one base skin.
#[derive(Debug)]
pub(super) struct Plan {
    removed_units: Vec<String>,
    removed_tags: Vec<String>,
    added_units: Vec<String>,
    /// The entries that the preview draws before the repair: the tags if any tag is removed,
    /// the unit names otherwise.
    before: Vec<String>,
    /// The same entries after the repair.
    after: Vec<String>,
    events: Events,
    /// `skin0.bin` first, then each other bin with a renamed event.
    edits: Vec<BinEdit>,
    /// The bank paths that the removed units list.
    dropped: Vec<String>,
}

impl Plan {
    /// Returns the preview that a row draws for the repair.
    pub(super) fn preview(&self) -> FixPreview {
        let facts = SkinAudioRepair {
            removed_units: self.removed_units.clone(),
            removed_tags: self.removed_tags.clone(),
            added_units: self.added_units.clone(),
            renamed_events: self.events.renamed,
            silent_clip_events: self.events.silent_clips,
            silent_vfx_events: self.events.silent_vfx,
        };

        FixPreview {
            facts: Some(FixFacts::SkinAudio(facts)),
            ..FixPreview::value(self.before.join(", "), self.after.join(", "))
        }
    }

    /// Returns the path and the repaired bytes of each bin to write, `skin0.bin` first.
    ///
    /// # Errors
    ///
    /// Fails if a bin does not encode.
    pub(super) fn encoded(&self) -> Result<Vec<(String, Vec<u8>)>, String> {
        self.edits
            .iter()
            .map(|edit| Ok((edit.path.clone(), edit.encoded()?)))
            .collect()
    }

    /// Returns the bank paths that the removed units list.
    pub(super) fn dropped(&self) -> &[String] {
        &self.dropped
    }
}

/// Derives the repair of the base skin `handle` from the files of `project`.
///
/// Removes every `BankUnits` entry and every `TagEventList` entry that names another skin. If
/// no remaining unit lists a path of an SFX unit of the game's base skin, adds those units.
/// Renames an event field of a clip or a VFX system in the layer's bins of the champion to the
/// base event, if a unit of the game's base skin lists the base event.
///
/// # Errors
///
/// Returns the refusal if the game or the skin object is missing, if no base SFX unit can be
/// restored, or if `handle` does not read or parse.
pub(super) fn plan(project: &ProjectFiles, handle: &FileHandle<'_>) -> Result<Plan, Refusal> {
    let champion = champion_of(handle).ok_or(Refusal::Elsewhere)?;
    let game = project.game().ok_or(Refusal::NoGame)?;
    let markers = Markers::of(&champion);

    let root = skin_bin(&champion, 0);
    let entry = skin_object(&champion, 0);
    let base = resolve_skin(&mut |path| game.read(WadHash::from(path)), &root, entry)
        .map_err(Refusal::Unreadable)?;
    let index = base_index(&root, base.as_ref())?;
    let base_units = base.as_ref().map(base_sfx_units).unwrap_or_default();

    let bytes = handle.bytes().map_err(Refusal::Unreadable)?;
    let mut bin = parse_bin(&bytes).map_err(Refusal::Unreadable)?;
    let skin = bin
        .objects_mut()
        .get_mut(&entry)
        .filter(|object| object.class_hash == named("SkinCharacterDataProperties"))
        .ok_or(Refusal::Elsewhere)?;
    let audio = embed_mut(skin.properties.get_mut(&named("SkinAudioProperties")))
        .ok_or(Refusal::Elsewhere)?;

    let tags_before = texts(items(audio.properties.get(&named("TagEventList"))));
    let units_before = names(items(audio.properties.get(&named("BankUnits"))));

    let removed_tags = match list_mut(audio.properties.get_mut(&named("TagEventList"))) {
        Some(tags) => retain(tags, |tag| {
            !text(Some(tag)).is_some_and(|tag| markers.names(tag))
        })?,
        None => Vec::new(),
    };
    let removed_units = match list_mut(audio.properties.get_mut(&named("BankUnits"))) {
        Some(units) => retain(units, |unit| !unit_names_other_skin(unit, &markers))?,
        None => Vec::new(),
    };
    if removed_tags.is_empty() && removed_units.is_empty() {
        return Err(Refusal::Elsewhere);
    }

    let restores_base = items(audio.properties.get(&named("BankUnits")))
        .iter()
        .flat_map(|unit| texts(unit_paths(unit)))
        .any(|path| index.units_naming(&path).any(|base| !base.unit.voice_over));
    let mut added_units = Vec::new();
    if !restores_base {
        if base_units.is_empty() {
            return Err(Refusal::BaseAudioMissing);
        }
        added_units = names(&base_units);
        push_units(audio, base_units)?;
    }

    let tags_after = texts(items(audio.properties.get(&named("TagEventList"))));
    let units_after = names(items(audio.properties.get(&named("BankUnits"))));
    let (before, after) = if removed_tags.is_empty() {
        (units_before, units_after)
    } else {
        (tags_before, tags_after)
    };
    let dropped = removed_units
        .iter()
        .flat_map(|unit| texts(unit_paths(unit)))
        .collect();

    let mut events = Events::default();
    let mut renamer = Renamer {
        markers: &markers,
        index: &index,
        events: &mut events,
        changed: false,
    };
    let mut objects = Vec::new();
    for object in bin.objects_mut().values_mut() {
        renamer.changed = object.path_hash == entry;
        object
            .walk_mut(&mut renamer)
            .map_err(|error| Refusal::Unreadable(error.to_string()))?;
        if renamer.changed {
            objects.push(object.clone());
        }
    }

    let mut edits = vec![BinEdit {
        path: handle.path().to_owned(),
        bytes,
        objects,
    }];
    edits.extend(renamed_bins(project, handle, &mut renamer));

    Ok(Plan {
        removed_units: names(&removed_units),
        removed_tags: texts(&removed_tags),
        added_units,
        before,
        after,
        events,
        edits,
        dropped,
    })
}

/// Returns the audio index of the game's base skin object `base`, which `root` declares.
fn base_index(root: &str, base: Option<&BinObject>) -> Result<AudioIndex, Refusal> {
    let mut builder = AudioIndex::builder();
    if let Some(base) = base {
        let audio =
            BinAudio::of_objects([base]).map_err(|error| Refusal::Unreadable(error.to_string()))?;
        builder.add_bin(root, audio);
    }
    Ok(builder.build())
}

/// Returns the bank units of the skin object `base` that are not voice-over.
fn base_sfx_units(base: &BinObject) -> Vec<PropertyValueEnum> {
    let Some(audio) = embed(base.properties.get(&named("SkinAudioProperties"))) else {
        return Vec::new();
    };

    items(audio.properties.get(&named("BankUnits")))
        .iter()
        .filter(|unit| !is_voice_over(unit))
        .cloned()
        .collect()
}

/// Appends `units` to the `BankUnits` of `audio`, and adds the list if `audio` has none.
fn push_units(
    audio: &mut ltk_meta::property::values::Struct,
    units: Vec<PropertyValueEnum>,
) -> Result<(), Refusal> {
    let unreadable = |error: ltk_meta::Error| Refusal::Unreadable(error.to_string());

    if let Some(list) = list_mut(audio.properties.get_mut(&named("BankUnits"))) {
        for unit in units {
            list.push(unit).map_err(unreadable)?;
        }
        return Ok(());
    }

    let list = Container::new(PropertyKind::Embedded, units).map_err(unreadable)?;
    audio.properties.insert(
        named("bankUnits"),
        PropertyValueEnum::UnorderedContainer(UnorderedContainer(list)),
    );
    Ok(())
}

/// Removes every item of `list` that `keep` rejects, and returns the removed items.
fn retain(
    list: &mut Container,
    mut keep: impl FnMut(&PropertyValueEnum) -> bool,
) -> Result<Vec<PropertyValueEnum>, Refusal> {
    let unreadable = |error: ltk_meta::Error| Refusal::Unreadable(error.to_string());
    let kind = list.item_kind();
    let items = std::mem::replace(list, Container::empty(kind).map_err(unreadable)?).into_items();

    let (kept, removed): (Vec<_>, Vec<_>) = items.into_iter().partition(|item| keep(item));
    *list = Container::new(kind, kept).map_err(unreadable)?;
    Ok(removed)
}

/// Returns the `bankPath` entries of the bank unit `unit`.
fn unit_paths(unit: &PropertyValueEnum) -> &[PropertyValueEnum] {
    embed(Some(unit)).map_or(&[], |unit| items(unit.properties.get(&named("bankPath"))))
}

fn texts(values: &[PropertyValueEnum]) -> Vec<String> {
    values
        .iter()
        .filter_map(|value| text(Some(value)).map(str::to_owned))
        .collect()
}

fn names(units: &[PropertyValueEnum]) -> Vec<String> {
    units
        .iter()
        .filter_map(unit_name)
        .map(str::to_owned)
        .collect()
}

/// Returns each other bin of the champion's WAD in the layer of `handle` that has an event to
/// rename, with the objects renamed.
///
/// Skips a bin that does not read or parse.
fn renamed_bins(
    project: &ProjectFiles,
    handle: &FileHandle<'_>,
    renamer: &mut Renamer<'_>,
) -> Vec<BinEdit> {
    let Some((wad, _)) = handle.path().split_once('/') else {
        return Vec::new();
    };
    let prefix = format!("{}/", wad.to_ascii_lowercase());

    let mut edits = Vec::new();
    for other in project.bins() {
        let in_wad = other.path().to_ascii_lowercase().starts_with(&prefix);
        if other.layer() != handle.layer() || other.path() == handle.path() || !in_wad {
            continue;
        }

        let read = other
            .bytes()
            .and_then(|bytes| Ok((parse_bin(&bytes)?, bytes)));
        let (mut bin, bytes) = match read {
            Ok(read) => read,
            Err(e) => {
                tracing::debug!("Skipped {} in the skinhack repair: {e}", other.path());
                continue;
            }
        };

        let mut objects = Vec::new();
        for object in bin.objects_mut().values_mut() {
            renamer.changed = false;
            if object.walk_mut(renamer).is_ok() && renamer.changed {
                objects.push(object.clone());
            }
        }
        if !objects.is_empty() {
            edits.push(BinEdit {
                path: other.path().to_owned(),
                bytes,
                objects,
            });
        }
    }
    edits
}

/// The walk that renames each event of another skin to its base event.
struct Renamer<'r> {
    markers: &'r Markers,
    /// The audio index of the game's base skin.
    index: &'r AudioIndex,
    events: &'r mut Events,
    /// `true` once the walk changed the object.
    changed: bool,
}

impl VisitorMut for Renamer<'_> {
    type Error = ltk_meta::Error;

    fn enter_node(&mut self, node: &mut NodeRefMut<'_>) -> Result<Visit, ltk_meta::Error> {
        let class = node.class_hash();
        let is_clip = class == CLIP_EVENT;
        if !is_clip && !VFX_EVENTS.contains(&class) {
            return Ok(Visit::Continue);
        }
        let Some((_, fields)) = EVENT_FIELDS.iter().find(|(held, _)| *held == class) else {
            return Ok(Visit::Continue);
        };

        for field in *fields {
            let Some(PropertyValueEnum::String(event)) = node.properties_mut().get_mut(field)
            else {
                continue;
            };
            if !self.markers.names(&event.value) {
                continue;
            }

            match base_event(self.index, self.markers, &event.value) {
                Some(base) => {
                    event.value = base;
                    self.events.renamed += 1;
                    self.changed = true;
                }
                None if is_clip => self.events.silent_clips += 1,
                None => self.events.silent_vfx += 1,
            }
        }
        Ok(Visit::Continue)
    }
}

/// Returns the base event of the event `name` of another skin, as a unit of `index` lists it.
///
/// The base name drops `Skin<N>` after the champion, so `Play_sfx_AhriSkin07_Cast` becomes
/// `Play_sfx_Ahri_Cast`. Returns `None` if no unit of `index` lists the base name.
fn base_event(index: &AudioIndex, markers: &Markers, name: &str) -> Option<String> {
    let base = without_skin(name, &markers.name);
    index
        .units_listing(&base)
        .flat_map(|unit| unit.unit.events.iter())
        .find(|event| event.eq_ignore_ascii_case(&base))
        .cloned()
}

/// Returns `value` without the `skin<N>` that follows the champion, for every `N` but 0.
///
/// `marker` is `<champion>skin` in lowercase. ASCII lowercasing keeps every byte offset, so
/// the offsets found in the lowercase copy apply to `value`.
fn without_skin(value: &str, marker: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let champion = marker.len() - "skin".len();

    let mut out = String::with_capacity(value.len());
    let mut copied = 0;
    let mut from = 0;
    while let Some(found) = lower[from..].find(marker) {
        let at = from + found;
        let digits_at = at + marker.len();
        let digits = lower[digits_at..]
            .bytes()
            .take_while(u8::is_ascii_digit)
            .count();

        let number = &lower[digits_at..digits_at + digits];
        if number.parse::<u32>().is_ok_and(|skin| skin != 0) {
            out.push_str(&value[copied..at + champion]);
            copied = digits_at + digits;
        }
        from = digits_at;
    }

    out.push_str(&value[copied..]);
    out
}
