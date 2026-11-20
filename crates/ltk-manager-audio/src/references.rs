//! The back-references of an audio file: the bank units and bank lists that name it, as rows
//! that a bin document opens at.
//!
//! "Bank units" in `docs/ux/AUDIO.md`.

use std::fmt::Write as _;

use ltk_manager_assets::preview::AssetRef;
use serde::Serialize;

use crate::bank_set::{CONTEXTUAL_ACTION_DATA, shipped};
use crate::bin_audio::{BankSite, SiteStep, hash_path, json_string};
use crate::events::{SetFile, SetFileState};
use crate::index::{AudioIndex, IndexedUnit};

/// The names and the assets that turn a site of the audio index into a [`SiteRow`].
///
/// The shell implements it over the sandbox and the hash tables.
pub trait SiteNames {
    /// Returns the layer file or game chunk at the game path `path`, the project layer first.
    fn locate(&self, path: &str) -> Option<AssetRef>;
    /// Returns the path of the object `hash`.
    fn object_name(&self, hash: u32) -> Option<String>;
    /// Returns the name of the class `hash`.
    fn class_name(&self, hash: u32) -> Option<String>;
    /// Returns the name of the field `hash`.
    fn field_name(&self, hash: u32) -> Option<String>;
    /// Returns the string behind the `hash` value `hash`, such as a situation key or a spell.
    fn hash_name(&self, hash: u32) -> Option<String>;
}

/// An object of a bin, and optionally a row of it, with what an open of its tab reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SiteRow {
    /// The bin, the project layer first. `None` if no layer and no archive contains it.
    pub asset: Option<AssetRef>,
    /// The game path of the bin.
    pub bin: String,
    /// The object's path hash, as `0x` and eight hex digits.
    pub object_hash: String,
    /// The object's path, or its hash if no table names it.
    pub object: String,
    /// The class hash, as `0x` and eight hex digits.
    pub class_hash: String,
    /// The class's name, or its hash if no table names it.
    pub class: String,
    /// The row inside the object. `None` for the object itself.
    pub property: Option<RowPath>,
}

/// The row inside an object, in the two forms that a row carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RowPath {
    /// The hash path, every field a hash (ADR-0027).
    pub path: String,
    /// The same path for a person, every hash that a table names spelled.
    pub label: String,
}

/// One bin that declares a bank unit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BankDeclaration {
    /// The `BankUnit` row.
    pub row: SiteRow,
    /// The `ContextualActionData` object that the holder links, if an index declares it.
    pub contextual: Option<SiteRow>,
}

/// The bank units with one name, one list of paths and one voice-over flag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BankUnitGroup {
    /// The `name` of the units.
    pub name: String,
    /// The `voiceOver` flag of the units.
    pub voice_over: bool,
    /// The `bankPath` files, in the unit's order. The opened file is marked.
    pub files: Vec<SetFile>,
    /// The bins that declare the unit, ranked.
    pub declarations: Vec<BankDeclaration>,
}

/// The bank units and the bank lists that name one audio file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BankReferences {
    /// The groups, in the order of their first declaration.
    pub units: Vec<BankUnitGroup>,
    /// The `AudioBankPaths` and `BankPaths` rows that list the file.
    pub lists: Vec<SiteRow>,
}

impl BankReferences {
    /// Returns the bank units and bank lists of `indexes` that name `path`.
    ///
    /// `indexes` is the project's index first, then the game. Units with the same name, the same
    /// paths without ASCII case and the same voice-over flag are one group. A group's
    /// declarations are ranked: the earlier index first, then the skin bin whose number matches
    /// the `Skins/SkinNN` segment of `path` (`Base` is skin 0), then `skins/root.bin`, then the
    /// rest in index order.
    #[must_use]
    pub fn of(path: &str, indexes: &[&AudioIndex], names: &dyn SiteNames) -> Self {
        let shipped = shipped(path);
        let opened = |file: &str| {
            file.eq_ignore_ascii_case(path)
                || shipped
                    .as_ref()
                    .is_some_and(|(shipped, _)| file.eq_ignore_ascii_case(shipped))
        };

        let mut groups: Vec<(GroupKey, Vec<&IndexedUnit>)> = Vec::new();
        for indexed in ranked_units(path, indexes, Some(names)) {
            let key = GroupKey::of(indexed);
            match groups.iter_mut().find(|(grouped, _)| *grouped == key) {
                Some((_, declarations)) => declarations.push(indexed),
                None => groups.push((key, vec![indexed])),
            }
        }

        let units = groups
            .into_iter()
            .map(|(_, declared)| {
                let first = declared[0];
                BankUnitGroup {
                    name: first.unit.name.clone(),
                    voice_over: first.unit.voice_over,
                    files: first
                        .unit
                        .bank_path
                        .iter()
                        .map(|file| {
                            let asset = names.locate(file);
                            SetFile {
                                path: file.clone(),
                                state: match asset {
                                    Some(_) => SetFileState::Found,
                                    None => SetFileState::Missing,
                                },
                                asset,
                                opened: opened(file),
                            }
                        })
                        .collect(),
                    declarations: declared
                        .into_iter()
                        .map(|indexed| BankDeclaration {
                            row: unit_row(indexed, None, names),
                            contextual: indexed
                                .holder
                                .contextual
                                .and_then(|object| contextual_row(object, indexes, names)),
                        })
                        .collect(),
                }
            })
            .collect();

        let lists = indexes
            .iter()
            .flat_map(|index| index.lists_naming(path))
            .map(|indexed| {
                let site = &indexed.list.site;
                site_row(
                    &indexed.bin,
                    site.object,
                    site.class,
                    Some(&site.steps),
                    names,
                )
            })
            .collect();

        Self { units, lists }
    }
}

/// What makes two bank units one group.
#[derive(PartialEq, Eq)]
struct GroupKey {
    name: String,
    paths: Vec<String>,
    voice_over: bool,
}

impl GroupKey {
    fn of(indexed: &IndexedUnit) -> Self {
        Self {
            name: indexed.unit.name.clone(),
            paths: indexed
                .unit
                .bank_path
                .iter()
                .map(|path| path.to_ascii_lowercase())
                .collect(),
            voice_over: indexed.unit.voice_over,
        }
    }
}

/// Returns the bank units of `indexes` that name `path`, ranked as [`BankReferences::of`]
/// ranks the declarations of a group.
///
/// A bank at a locale other than `en_US` also takes the units that name its `en_US` path.
pub(crate) fn ranked_units<'a>(
    path: &str,
    indexes: &[&'a AudioIndex],
    names: Option<&dyn SiteNames>,
) -> Vec<&'a IndexedUnit> {
    let bank_skin = bank_skin(path);
    let bank_map = map_number(path);
    let is_announcer = is_announcer_bank(path);
    let shipped = shipped(path);

    let mut units: Vec<(usize, u8, &'a IndexedUnit)> = indexes
        .iter()
        .enumerate()
        .flat_map(|(position, index)| {
            let localized = shipped
                .iter()
                .flat_map(|(shipped, _)| index.units_naming(shipped));
            let direct = index.units_naming(path);

            let extra: Vec<&'a IndexedUnit> = if position == 0 && is_announcer {
                index
                    .units_listing("announcer")
                    .chain(index.units_naming("announcer"))
                    .collect()
            } else {
                Vec::new()
            };

            direct.chain(localized).chain(extra).map(move |indexed| {
                let in_layer = names.is_some_and(|names| {
                    matches!(names.locate(&indexed.bin), Some(AssetRef::Layer { .. }))
                });
                let r = rank(&indexed.bin, bank_skin, bank_map, is_announcer, in_layer);
                (position, r, indexed)
            })
        })
        .collect();

    units.sort_by_key(|(position, rank, indexed)| (*position, *rank, indexed.bin.clone()));
    units.dedup_by(|a, b| a.0 == b.0 && a.2 == b.2);
    units.into_iter().map(|(_, _, indexed)| indexed).collect()
}

/// Returns the rank of the bin `bin` among candidate declarations for a bank.
fn rank(
    bin: &str,
    bank_skin: Option<u32>,
    bank_map: Option<u32>,
    is_announcer: bool,
    in_layer: bool,
) -> u8 {
    let file = bin.rsplit('/').next().unwrap_or(bin);
    let stem = file.split_once('.').map_or(file, |(stem, _)| stem);
    let bin_map = map_number(bin);

    if bank_skin.is_some() && skin_number(stem) == bank_skin {
        return if in_layer { 0 } else { 1 };
    }

    if bank_map.is_some() && bin_map == bank_map {
        return if in_layer { 0 } else { 1 };
    }

    if in_layer {
        if is_announcer && (bin_map.is_some() || stem.to_ascii_lowercase().contains("announcer")) {
            return 0;
        }
        return 2;
    }

    if stem.eq_ignore_ascii_case("root") {
        return 3;
    }

    if is_announcer && bin_map.is_some() {
        return 4;
    }

    5
}

/// Returns `true` if `path` is an announcer bank.
fn is_announcer_bank(path: &str) -> bool {
    path.to_ascii_lowercase().contains("announcer")
}

/// Returns the map number from `text` if it names a map.
fn map_number(text: &str) -> Option<u32> {
    let lower = text.to_ascii_lowercase();
    let file = lower.rsplit('/').next().unwrap_or(&lower);
    let stem = file.split_once('.').map_or(file, |(stem, _)| stem);

    if let Some(rest) = stem.strip_prefix("map")
        && let Ok(num) = rest.parse::<u32>()
    {
        return Some(num);
    }

    for segment in lower.split('/') {
        if let Some(rest) = segment.strip_prefix("map")
            && let Ok(num) = rest.parse::<u32>()
        {
            return Some(num);
        }
    }
    None
}

/// Returns the skin number of the `Skins/<skin>` segment of the bank path `path`.
fn bank_skin(path: &str) -> Option<u32> {
    let mut segments = path.split('/');
    segments.find(|segment| segment.eq_ignore_ascii_case("skins"))?;
    let skin = segments.next()?;
    if skin.eq_ignore_ascii_case("base") {
        return Some(0);
    }
    skin_number(skin)
}

/// Returns `NN` of `SkinNN`, compared without ASCII case.
fn skin_number(segment: &str) -> Option<u32> {
    let prefix = segment.get(..SKIN_PREFIX.len())?;
    if !prefix.eq_ignore_ascii_case(SKIN_PREFIX) {
        return None;
    }
    segment[SKIN_PREFIX.len()..].parse().ok()
}

const SKIN_PREFIX: &str = "skin";

/// Returns the row of the bank unit `indexed`, with `extra` steps after the steps of the unit.
#[must_use]
pub fn unit_row(
    indexed: &IndexedUnit,
    extra: Option<&[SiteStep]>,
    names: &dyn SiteNames,
) -> SiteRow {
    let site: &BankSite = &indexed.site;
    let mut steps = site.steps.clone();
    steps.extend_from_slice(extra.unwrap_or_default());
    site_row(&indexed.bin, site.object, site.class, Some(&steps), names)
}

/// Returns the row of the `ContextualActionData` object `object`, from the first index that
/// declares it.
pub(crate) fn contextual_row(
    object: u32,
    indexes: &[&AudioIndex],
    names: &dyn SiteNames,
) -> Option<SiteRow> {
    let rules = indexes.iter().find_map(|index| index.contextual(object))?;
    Some(site_row(
        &rules.bin,
        object,
        CONTEXTUAL_ACTION_DATA.0,
        None,
        names,
    ))
}

/// Returns the row at `steps` of the object `object` of class `class` in the bin `bin`.
pub(crate) fn site_row(
    bin: &str,
    object: u32,
    class: u32,
    steps: Option<&[SiteStep]>,
    names: &dyn SiteNames,
) -> SiteRow {
    SiteRow {
        asset: names.locate(bin),
        bin: bin.to_owned(),
        object_hash: hex(object),
        object: names.object_name(object).unwrap_or_else(|| hex(object)),
        class_hash: hex(class),
        class: names.class_name(class).unwrap_or_else(|| hex(class)),
        property: steps.map(|steps| RowPath {
            path: hash_path(steps),
            label: label(steps, names),
        }),
    }
}

/// Returns the readable path of `steps`: each field and each hash key that a table names
/// spelled.
fn label(steps: &[SiteStep], names: &dyn SiteNames) -> String {
    let mut label = String::new();
    for step in steps {
        match step {
            SiteStep::Field(field) => {
                if !label.is_empty() {
                    label.push('.');
                }
                label.push_str(&names.field_name(*field).unwrap_or_else(|| hex(*field)));
            }
            SiteStep::Index(index) => {
                let _ = write!(label, "[{index}]");
            }
            SiteStep::Key(key) => {
                label.push('{');
                let named = (key.len() == HASH_DIGITS)
                    .then(|| u32::from_str_radix(key, 16).ok())
                    .flatten()
                    .and_then(|hash| names.hash_name(hash));
                match named {
                    Some(name) => label.push_str(&json_string(&name)),
                    None => label.push_str(key),
                }
                label.push('}');
            }
        }
    }
    label
}

/// Returns `0x` and the eight hex digits of `hash`.
pub(crate) fn hex(hash: u32) -> String {
    format!("{hash:#010x}")
}

/// The number of hex digits of a hash key.
const HASH_DIGITS: usize = 8;
