//! The bank set: the files of a list of bank units, opened in the order the client reads them.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::io::Cursor;

use ltk_hash::BinHash;
use ltk_manager_assets::preview::AssetRef;
use ltk_manager_base::hashing::named;
use ltk_wwise::hierarchy::Object;
use ltk_wwise::package::{MountedEntry, PackageKey};
use ltk_wwise::path::{AudioFileKind, AudioPath};
use ltk_wwise::{Bank, MountedPackage, ObjectId, SourceId};

use crate::files::AudioFiles;
use crate::names::EventNames;
use crate::sound::package_key;

/// The class hash of `BankUnit`, the bin class that names the files of one unit of audio.
pub const BANK_UNIT: BinHash = named("BankUnit");

/// The field hash of `bankPath` on [`BANK_UNIT`], the list of those files.
pub const BANK_PATH: BinHash = named("bankPath");

/// The field hash of `name` on [`BANK_UNIT`].
pub const BANK_UNIT_NAME: BinHash = named("name");

/// The field hash of `events` on [`BANK_UNIT`], the event names that the unit registers.
pub const BANK_EVENTS: BinHash = named("events");

/// The field hash of `voiceOver` on [`BANK_UNIT`].
pub const BANK_VOICE_OVER: BinHash = named("voiceOver");

/// Each bin class whose string fields contain an event name, with the hashes of those fields.
pub const EVENT_FIELDS: &[(BinHash, &[BinHash])] = &[
    (named("SoundEventData"), &[named("mSoundName")]),
    (
        named("VfxSystemDefinitionData"),
        &[
            named("soundOnCreateDefault"),
            named("soundPersistentDefault"),
            named("voiceOverOnCreateDefault"),
            named("voiceOverPersistentDefault"),
        ],
    ),
    (
        named("VfxEmitterAudio"),
        &[named("SoundOnCreate"), named("SoundPersistent")],
    ),
    (named("UiComboBoxSoundEvents"), &[named("OnSelectionEvent")]),
    (
        named("UiElementGroupButtonSoundEvents"),
        &[
            named("MouseDownEvent"),
            named("MouseDownOnInactive"),
            named("MouseDownSelected"),
            named("MouseUpEvent"),
            named("MouseUpOnInactive"),
            named("MouseUpSelected"),
            named("RollOutEvent"),
            named("RollOverEvent"),
        ],
    ),
    (
        named("AnnouncementDefinition"),
        &[
            named("SoundKey"),
            named("SpectatorSoundKey"),
            named("mValue"),
        ],
    ),
    (
        named("AnnouncementDefinitionData"),
        &[
            named("SoundKey"),
            named("SpectatorSoundKey"),
            named("mValue"),
        ],
    ),
];

/// The field hash of `skinAudioProperties` on `SkinCharacterDataProperties`.
pub const SKIN_AUDIO_PROPERTIES: BinHash = named("skinAudioProperties");

/// The field hash of `tagEventList` on `SkinAudioProperties`, the tags of a skin's VO events.
pub const TAG_EVENT_LIST: BinHash = named("tagEventList");

/// The field hash of `mContextualActionData` on `SkinCharacterDataProperties`, a link.
pub const CONTEXTUAL_ACTION_LINK: BinHash = named("mContextualActionData");

/// The class hash of `ContextualActionData`, the voice-over rules of a skin.
pub const CONTEXTUAL_ACTION_DATA: BinHash = named("ContextualActionData");

/// The class hash of `ContextualRule`, one rule of a `ContextualSituation`.
pub const CONTEXTUAL_RULE: BinHash = named("ContextualRule");

/// The field hash of `mRuleName` on [`CONTEXTUAL_RULE`].
///
/// The shipped rules carry it, and the meta class does not declare it.
pub const RULE_NAME: BinHash = named("mRuleName");

/// The field hash of `mConditions` on [`CONTEXTUAL_RULE`].
pub const RULE_CONDITIONS: BinHash = named("mConditions");

/// The field hash of `mAudioAction` on [`CONTEXTUAL_RULE`], a `ContextualActionPlayAudio`.
pub const RULE_AUDIO_ACTION: BinHash = named("mAudioAction");

/// The class hash of `ContextualConditionSpellName`.
pub const CONDITION_SPELL_NAME: BinHash = named("ContextualConditionSpellName");

/// The field hash of `mSpell` on [`CONDITION_SPELL_NAME`], the hash of a spell object path.
pub const CONDITION_SPELL: BinHash = named("mSpell");

/// Each class and field whose value is a list of bank paths without a `BankUnit`.
pub const BANK_LISTS: &[(BinHash, BinHash)] = &[
    (named("SpellDataResource"), named("AudioBankPaths")),
    (named("ClientStateAudioDataProperties"), named("BankPaths")),
];

/// One `BankUnit` of a bin, as written.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BankUnit {
    /// The `name` of the unit, which the skin loader does not read.
    pub name: String,
    /// The `bankPath` list: event banks, media banks and packages.
    pub bank_path: Vec<String>,
    /// The `events` list: the event names that the unit registers.
    pub events: Vec<String>,
    /// The `voiceOver` flag. A voice-over path is read under the client's locale.
    pub voice_over: bool,
}

/// One file of a [`BankSet`].
#[derive(Debug)]
pub struct BankFile {
    path: String,
    unit: usize,
    asset: Option<AssetRef>,
    content: BankContent,
}

impl BankFile {
    /// Returns the game path that the file was read from.
    ///
    /// A voice-over path that a file answers under the client's locale is the localized path.
    #[must_use]
    pub fn path(&self) -> &str {
        &self.path
    }

    /// Returns the index of the bank unit that names the file.
    #[must_use]
    pub fn unit(&self) -> usize {
        self.unit
    }

    /// Returns the layer file or game chunk that contains the file, or `None` for a missing file.
    #[must_use]
    pub fn asset(&self) -> Option<&AssetRef> {
        self.asset.as_ref()
    }

    /// Returns what the file contains.
    #[must_use]
    pub fn content(&self) -> &BankContent {
        &self.content
    }
}

/// What one file of a [`BankSet`] contains.
#[derive(Debug)]
pub enum BankContent {
    /// An event bank or a media bank.
    Bank { bank: Bank },
    /// A package, mounted: the entry records. The media stay in the file.
    Package { entries: Vec<MountedEntry> },
    /// No layer and no game archive contains the path.
    Missing,
    /// The file cannot be read. `message` is the error of the read.
    Failed { message: String },
}

/// The files of a list of bank units, with their objects and media indexed by ID.
///
/// Every index keeps the first match: the first file of the set, then the first object of the
/// file. This is the order of `ltk_wwise::hierarchy::event_tree`.
#[derive(Debug)]
pub struct BankSet {
    units: Vec<BankUnit>,
    files: Vec<BankFile>,
    objects: HashMap<ObjectId, ObjectSite>,
    banked: HashMap<SourceId, usize>,
    packaged: HashMap<PackageKey, usize>,
}

/// The place of a hierarchy object in a [`BankSet`].
#[derive(Debug, Clone, Copy)]
struct ObjectSite {
    file: usize,
    object: usize,
}

impl BankSet {
    /// Opens the files of `units` through `files`.
    ///
    /// A `.wpk` path is mounted as a package, and every other path is read as a bank. A path of a
    /// voice-over unit is read under `locale` first, the client's locale such as `ko_kr`, and
    /// falls back to the path as written. A file that no store contains or that fails to read is
    /// kept in the set, and the other files still open.
    #[must_use]
    pub fn open(units: &[BankUnit], files: &dyn AudioFiles, locale: Option<&str>) -> Self {
        let mut set = Self {
            units: units.to_vec(),
            files: Vec::new(),
            objects: HashMap::new(),
            banked: HashMap::new(),
            packaged: HashMap::new(),
        };

        for (unit_index, unit) in units.iter().enumerate() {
            for path in &unit.bank_path {
                let localized = unit
                    .voice_over
                    .then(|| locale.and_then(|locale| localized(path, locale)))
                    .flatten();
                let file = open_file(files, localized.as_deref(), path, unit_index);
                set.push(file);
            }
        }
        set
    }

    /// Returns the bank units of the set, in the order given to [`BankSet::open`].
    #[must_use]
    pub fn units(&self) -> &[BankUnit] {
        &self.units
    }

    /// Returns the files of the set, in unit order and then in `bankPath` order.
    #[must_use]
    pub fn files(&self) -> &[BankFile] {
        &self.files
    }

    /// Returns the event names that the bank units of the set register.
    #[must_use]
    pub fn event_names(&self) -> EventNames {
        let mut names = EventNames::new();
        names.extend(self.units.iter().flat_map(|unit| &unit.events));
        names
    }

    /// Returns the first hierarchy object `id` of the set, with the index of its file.
    pub(crate) fn object(&self, id: ObjectId) -> Option<(usize, &Bank, &Object)> {
        let site = self.objects.get(&id)?;
        let BankContent::Bank { bank } = &self.files[site.file].content else {
            return None;
        };
        let object = bank.hierarchy()?.objects().get(site.object)?;
        Some((site.file, bank, object))
    }

    /// Returns the banks of the set that have a hierarchy, in file order.
    pub(crate) fn hierarchy_banks(&self) -> Vec<&Bank> {
        self.files
            .iter()
            .filter_map(|file| match &file.content {
                BankContent::Bank { bank } if bank.hierarchy().is_some() => Some(bank),
                _ => None,
            })
            .collect()
    }

    /// Returns the index of the first file whose media index contains `source`.
    pub(crate) fn bank_with_media(&self, source: SourceId) -> Option<usize> {
        self.banked.get(&source).copied()
    }

    /// Returns the bytes of the media `source` in the first media index that contains it.
    pub(crate) fn banked_media(&self, source: SourceId) -> Option<&[u8]> {
        let file = self.bank_with_media(source)?;
        let BankContent::Bank { bank } = &self.files[file].content else {
            return None;
        };
        bank.media()?.get(source)
    }

    /// Returns the index of the first package that contains the media `source`.
    pub(crate) fn package_with_media(&self, source: SourceId) -> Option<usize> {
        self.packaged.get(&package_key(source)).copied()
    }

    /// Returns the size of the media `source` in the first package that contains it.
    pub(crate) fn packaged_size(&self, source: SourceId) -> Option<u32> {
        let file = self.package_with_media(source)?;
        let BankContent::Package { entries } = &self.files[file].content else {
            return None;
        };
        let key = package_key(source);
        entries
            .iter()
            .find(|entry| entry.key() == key)
            .map(MountedEntry::size)
    }

    fn push(&mut self, file: BankFile) {
        let index = self.files.len();
        match &file.content {
            BankContent::Bank { bank } => {
                if let Some(hierarchy) = bank.hierarchy() {
                    for (object, each) in hierarchy.objects().iter().enumerate() {
                        if let Entry::Vacant(slot) = self.objects.entry(each.id()) {
                            slot.insert(ObjectSite {
                                file: index,
                                object,
                            });
                        }
                    }
                }

                if let Some(media) = bank.media() {
                    for (source, _) in media.iter() {
                        self.banked.entry(source).or_insert(index);
                    }
                }
            }
            BankContent::Package { entries } => {
                for entry in entries {
                    self.packaged.entry(entry.key()).or_insert(index);
                }
            }
            BankContent::Missing | BankContent::Failed { .. } => {}
        }

        self.files.push(file);
    }
}

/// Opens `path`, or `localized` first if it is given and a store contains it.
///
/// A read error of `localized` falls back to `path`, and a read error of `path` keeps the file
/// as failed.
fn open_file(files: &dyn AudioFiles, localized: Option<&str>, path: &str, unit: usize) -> BankFile {
    let file = |path: &str, asset, content| BankFile {
        path: path.to_owned(),
        unit,
        asset,
        content,
    };
    let failed =
        |path: &str, asset, message: String| file(path, asset, BankContent::Failed { message });

    for candidate in localized.into_iter().chain([path]) {
        match AudioPath::new(candidate).kind() {
            AudioFileKind::Package => match files.open(candidate) {
                Ok(Some(opened)) => {
                    return match MountedPackage::mount(opened.contents) {
                        Ok(package) => file(
                            candidate,
                            Some(opened.asset),
                            BankContent::Package {
                                entries: package.entries().to_vec(),
                            },
                        ),
                        Err(e) => failed(candidate, Some(opened.asset), e.to_string()),
                    };
                }
                Ok(None) => {}
                Err(e) if candidate == path => return failed(candidate, None, e.to_string()),
                Err(e) => tracing::debug!("Failed to read {candidate}, reading {path}: {e}"),
            },
            AudioFileKind::Bank => match files.read(candidate) {
                Ok(Some(opened)) => {
                    return match Bank::from_reader(&mut Cursor::new(opened.contents)) {
                        Ok(bank) => file(candidate, Some(opened.asset), BankContent::Bank { bank }),
                        Err(e) => failed(candidate, Some(opened.asset), e.to_string()),
                    };
                }
                Ok(None) => {}
                Err(e) if candidate == path => return failed(candidate, None, e.to_string()),
                Err(e) => tracing::debug!("Failed to read {candidate}, reading {path}: {e}"),
            },
        }
    }

    file(path, None, BankContent::Missing)
}

/// Returns `path` with each `en_US` segment replaced by `locale`, or `None` if nothing changes.
///
/// `locale` is written as `ll_RR`, the spelling of the shipped paths.
pub(crate) fn localized(path: &str, locale: &str) -> Option<String> {
    let (language, region) = locale.split_once('_')?;
    let locale = format!(
        "{}_{}",
        language.to_ascii_lowercase(),
        region.to_ascii_uppercase()
    );
    if locale.eq_ignore_ascii_case(SHIPPED_LOCALE) {
        return None;
    }

    let mut changed = false;
    let segments: Vec<&str> = path
        .split('/')
        .map(|segment| {
            if segment.eq_ignore_ascii_case(SHIPPED_LOCALE) {
                changed = true;
                locale.as_str()
            } else {
                segment
            }
        })
        .collect();

    changed.then(|| segments.join("/"))
}

/// Returns `path` with its locale segment replaced by `en_US`, and the segment it replaced.
///
/// A locale segment is two letters, an underscore and two letters, such as `ko_KR`. Returns
/// `None` if `path` has no locale segment, or only `en_US`.
pub(crate) fn shipped(path: &str) -> Option<(String, &str)> {
    let locale = path.split('/').find(|segment| is_locale(segment))?;
    if locale.eq_ignore_ascii_case(SHIPPED_LOCALE) {
        return None;
    }

    let segments: Vec<&str> = path
        .split('/')
        .map(|segment| {
            if segment == locale {
                SHIPPED_LOCALE
            } else {
                segment
            }
        })
        .collect();
    Some((segments.join("/"), locale))
}

/// Returns `true` if `segment` is spelled as a locale: two letters, `_` and two letters.
fn is_locale(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    bytes.len() == 5
        && bytes[2] == b'_'
        && [0, 1, 3, 4]
            .iter()
            .all(|&at| bytes[at].is_ascii_alphabetic())
}

/// The locale segment that every shipped voice-over path spells.
const SHIPPED_LOCALE: &str = "en_US";
