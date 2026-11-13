//! The audio that one bin names: its bank units with their sites, its bank lists, its
//! contextual voice-over rules and the event names of its sound fields.

use std::fmt::Write as _;
use std::io::Cursor;

use ltk_hash::BinHash;
use ltk_manager_assets::bin_source::BinSource;
use ltk_manager_base::hashing::named;
use ltk_meta::BinObject;
use ltk_meta::property::Kind;
use ltk_meta::walk::{Leaf, Node, TrailSegment, TreeNode as _, TreeValue, Visit, Visitor};
use serde::{Deserialize, Serialize};

use crate::bank_set::{
    BANK_EVENTS, BANK_LISTS, BANK_PATH, BANK_UNIT, BANK_UNIT_NAME, BANK_VOICE_OVER, BankUnit,
    CONDITION_SPELL, CONDITION_SPELL_NAME, CONTEXTUAL_ACTION_DATA, CONTEXTUAL_ACTION_LINK,
    CONTEXTUAL_RULE, EVENT_FIELDS, RULE_AUDIO_ACTION, RULE_CONDITIONS, RULE_NAME,
    SKIN_AUDIO_PROPERTIES, TAG_EVENT_LIST,
};

/// The bank units, bank lists, contextual rules and event names of one bin.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BinAudio {
    /// Every `BankUnit` node of the bin, in walk order.
    pub units: Vec<SitedUnit>,
    /// Every list of bank paths of a field in [`BANK_LISTS`], in walk order.
    pub lists: Vec<BankList>,
    /// The audio rules of every `ContextualActionData` object of the bin.
    pub contextual: Vec<ContextualRules>,
    /// Every non-empty string of a field in [`EVENT_FIELDS`], and every `BankUnit.events`
    /// entry.
    pub event_names: Vec<String>,
    /// Every field of [`SOUND_TARGETS`] that a holder of the bin takes, set or not, in walk order.
    pub sound_fields: Vec<SoundField>,
}

/// The classes whose string fields an event can be set in: a clip event, a VFX system and an
/// emitter's audio, with those fields.
pub const SOUND_TARGETS: &[(BinHash, &[BinHash])] = &[
    (named("SoundEventData"), &[named("mSoundName")]),
    (
        named("VfxSystemDefinitionData"),
        &[
            named("soundOnCreateDefault"),
            named("soundPersistentDefault"),
        ],
    ),
    (
        named("VfxEmitterAudio"),
        &[named("SoundOnCreate"), named("SoundPersistent")],
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

/// One field of a [`SOUND_TARGETS`] holder, and the event name it holds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SoundField {
    /// The row of the struct that holds the field.
    pub site: BankSite,
    /// The class hash of that struct.
    pub class: u32,
    /// The field hash.
    pub field: u32,
    /// The event name of the field. Empty if the field is missing or empty.
    pub value: String,
}

/// A list of bank paths without a `BankUnit`, such as `SpellDataResource.AudioBankPaths`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BankList {
    /// The bank paths, in list order.
    pub paths: Vec<String>,
    /// The row of the list in its bin.
    pub site: BankSite,
}

/// The rules of one `ContextualActionData` object that play a voice-over event.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextualRules {
    /// The path hash of the object.
    pub object: u32,
    /// The rules of the object, in list order.
    pub rules: Vec<ContextualRule>,
}

/// One `ContextualRule` of a `ContextualActionData` object.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextualRule {
    /// The hash of the `mSituations` key, such as `SpellCast`.
    pub situation: u32,
    /// `mRuleName`, such as `Basic 1`.
    pub name: Option<String>,
    /// The steps from the object's root to the rule.
    pub steps: Vec<SiteStep>,
    /// The `mSpell` hash of each `ContextualConditionSpellName` condition.
    pub spells: Vec<u32>,
    /// The `mPercentChanceToPlay` of the one `ContextualConditionChanceToPlay` condition, or
    /// `None` if the rule has none or several.
    pub chance: Option<u8>,
    /// The non-empty event names of `mAudioAction`, in field order.
    pub names: Vec<AudienceName>,
}

/// Who hears the event that a contextual rule plays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum Audience {
    /// `mSelfEventName`: the champion that the skin is on.
    Owner,
    /// `mAllyEventName`.
    Ally,
    /// `mEnemyEventName`.
    Enemy,
    /// `mSpectatorEventName`.
    Spectator,
}

/// The short event name of one audience of a contextual rule, such as `cast3D`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AudienceName {
    /// The audience that the name plays for.
    pub audience: Audience,
    /// The short event name, such as `cast3D`.
    pub name: String,
}

impl AudienceName {
    /// Returns the name `name` of `audience`.
    #[must_use]
    pub fn new(audience: Audience, name: impl Into<String>) -> Self {
        Self {
            audience,
            name: name.into(),
        }
    }
}

/// The fields of `ContextualActionPlayAudio` that contain a short event name, by audience.
const AUDIENCE_FIELDS: [(Audience, BinHash); 4] = [
    (Audience::Owner, named("mSelfEventName")),
    (Audience::Ally, named("mAllyEventName")),
    (Audience::Enemy, named("mEnemyEventName")),
    (Audience::Spectator, named("mSpectatorEventName")),
];

/// One step from an object's root to a node of it, in the grammar of a hash path.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SiteStep {
    /// A property, by its field hash.
    Field(u32),
    /// An item of a list.
    Index(usize),
    /// A map entry, by its key as a hash path writes it.
    Key(String),
}

/// Where a bank unit, a bank list or a rule sits in its bin.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct BankSite {
    /// The path hash of the object that contains it.
    pub object: u32,
    /// The class hash of that object.
    pub class: u32,
    /// The steps from the object's root.
    pub steps: Vec<SiteStep>,
}

impl BankSite {
    /// Returns the hash path of the site: eight hex digits per field, `[i]` and `{key}`.
    #[must_use]
    pub fn hash_path(&self) -> String {
        hash_path(&self.steps)
    }
}

/// Returns the hash path that `steps` write.
pub(crate) fn hash_path(steps: &[SiteStep]) -> String {
    let mut path = String::new();
    for step in steps {
        match step {
            SiteStep::Field(field) => {
                if !path.is_empty() {
                    path.push('.');
                }
                let _ = write!(path, "{field:08x}");
            }
            SiteStep::Index(index) => {
                let _ = write!(path, "[{index}]");
            }
            SiteStep::Key(key) => {
                let _ = write!(path, "{{{key}}}");
            }
        }
    }
    path
}

/// The audio fields of the object that contains a bank unit.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct HolderAudio {
    /// The path hash of the `ContextualActionData` object that `mContextualActionData` links.
    pub contextual: Option<u32>,
    /// `skinAudioProperties.tagEventList`.
    pub tags: Vec<String>,
}

/// One `BankUnit` with its site and the audio fields of its holder.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SitedUnit {
    /// The unit as written.
    pub unit: BankUnit,
    /// The row of the unit in its bin.
    pub site: BankSite,
    /// The audio fields of the object that declares the unit.
    pub holder: HolderAudio,
}

impl From<BankUnit> for SitedUnit {
    fn from(unit: BankUnit) -> Self {
        Self {
            unit,
            ..Self::default()
        }
    }
}

impl BinAudio {
    /// Reads the audio of the bin `bytes`, a `PROP` or a `PTCH`.
    ///
    /// # Errors
    ///
    /// Fails if the bytes are not a bin or a node does not decode.
    pub fn read(bytes: &[u8]) -> Result<Self, ltk_meta::Error> {
        let mut found = Found::default();
        match BinSource::open(Cursor::new(bytes))? {
            BinSource::Stream(mut stream) => {
                stream.walk::<ltk_meta::Error, _>(&mut found)?;
            }
            BinSource::Patch(patch) => {
                patch.walk(&mut found)?;
            }
        }
        Ok(found.audio)
    }

    /// Reads the audio of `objects`, an open bin's objects in file order.
    ///
    /// # Errors
    ///
    /// Fails if a node does not decode.
    pub fn of_objects<'a>(
        objects: impl IntoIterator<Item = &'a BinObject>,
    ) -> Result<Self, ltk_meta::Error> {
        let mut found = Found::default();
        for object in objects {
            object.walk(&mut found)?;
        }
        Ok(found.audio)
    }
}

/// The visitor that collects a [`BinAudio`].
#[derive(Default)]
struct Found {
    audio: BinAudio,
    /// The holder fields of the object that the walk is in.
    holder: HolderAudio,
}

impl<'a, V: TreeValue<'a>> Visitor<'a, V> for Found {
    type Error = ltk_meta::Error;

    fn enter_node(&mut self, node: &Node<'_, 'a, V>) -> Result<Visit, ltk_meta::Error> {
        let class = node.class_hash();
        let inner = node.inner();

        if node.is_root() {
            self.holder = holder_of::<V>(inner)?;
        }

        if class == CONTEXTUAL_RULE && root_class(node) == CONTEXTUAL_ACTION_DATA {
            let rule = rule_of(node)?;
            let object = node.object_hash().0;
            match self.audio.contextual.last_mut() {
                Some(rules) if rules.object == object => rules.rules.push(rule),
                _ => self.audio.contextual.push(ContextualRules {
                    object,
                    rules: vec![rule],
                }),
            }
            return Ok(Visit::Skip);
        }

        if class == BANK_UNIT {
            let unit = BankUnit {
                name: text(inner.get(BANK_UNIT_NAME)?)?.unwrap_or_default(),
                bank_path: texts(inner.get(BANK_PATH)?)?,
                events: texts(inner.get(BANK_EVENTS)?)?,
                voice_over: matches!(
                    leaf(inner.get(BANK_VOICE_OVER)?)?,
                    Some(Leaf::Bool(true) | Leaf::Flag(true))
                ),
            };
            self.audio.event_names.extend(unit.events.iter().cloned());
            self.audio.units.push(SitedUnit {
                unit,
                site: site_of(node, &[])?,
                holder: self.holder.clone(),
            });
            return Ok(Visit::Continue);
        }

        if let Some((_, fields)) = SOUND_TARGETS.iter().find(|(named, _)| *named == class) {
            let site = site_of(node, &[])?;
            for &field in *fields {
                self.audio.sound_fields.push(SoundField {
                    site: site.clone(),
                    class: class.0,
                    field: field.0,
                    value: text(inner.get(field)?)?.unwrap_or_default(),
                });
            }
        }

        let Some((_, fields)) = EVENT_FIELDS.iter().find(|(named, _)| *named == class) else {
            return Ok(Visit::Continue);
        };
        for &field in *fields {
            if let Some(name) = text(inner.get(field)?)?
                && !name.is_empty()
            {
                if name.contains('@') {
                    for expanded in expand_announcement_template(&name) {
                        self.audio.event_names.push(expanded);
                    }
                }
                self.audio.event_names.push(name);
            }
        }
        Ok(Visit::Continue)
    }

    fn enter_property(
        &mut self,
        field: BinHash,
        value: V,
        node: &Node<'_, 'a, V>,
    ) -> Result<Visit, ltk_meta::Error> {
        let class = node.class_hash();
        if BANK_LISTS.contains(&(class, field)) {
            self.audio.lists.push(BankList {
                paths: texts(Some(value))?,
                site: site_of(node, &[SiteStep::Field(field.0)])?,
            });
        }
        Ok(Visit::Continue)
    }
}

/// Returns the class hash of the object that `node` is in.
fn root_class<'a, V: TreeValue<'a>>(node: &Node<'_, 'a, V>) -> BinHash {
    node.trail()
        .classes()
        .first()
        .copied()
        .unwrap_or_else(|| node.class_hash())
}

/// Reads the `ContextualRule` at `node`.
fn rule_of<'a, V: TreeValue<'a>>(
    node: &Node<'_, 'a, V>,
) -> Result<ContextualRule, ltk_meta::Error> {
    let inner = node.inner();

    let mut situation = 0;
    for segment in node.trail().segments() {
        if let TrailSegment::Key(key) = segment {
            if let Some(Leaf::Hash(hash)) = key.as_leaf()? {
                situation = hash.as_u32();
            }
            break;
        }
    }

    let mut spells = Vec::new();
    let mut chances = Vec::new();
    if let Some(conditions) = inner.get(RULE_CONDITIONS)?
        && matches!(
            conditions.kind(),
            Kind::Container | Kind::UnorderedContainer
        )
    {
        for item in conditions.children()? {
            let (_, item) = item?;
            let Some(condition) = item.as_node()? else {
                continue;
            };

            if condition.class_hash() == CONDITION_CHANCE {
                chances.push(match leaf(condition.get(CHANCE_PERCENT)?)? {
                    Some(Leaf::U8(percent)) => percent,
                    _ => 0,
                });
                continue;
            }
            if condition.class_hash() != CONDITION_SPELL_NAME {
                continue;
            }
            if let Some(Leaf::Hash(spell)) = leaf(condition.get(CONDITION_SPELL)?)? {
                spells.push(spell.as_u32());
            }
        }
    }

    let mut names = Vec::new();
    let action = match inner.get(RULE_AUDIO_ACTION)? {
        Some(action) => action.as_node()?,
        None => None,
    };
    if let Some(action) = action {
        for (audience, field) in AUDIENCE_FIELDS {
            if let Some(name) = text(action.get(field)?)?
                && !name.is_empty()
            {
                names.push(AudienceName { audience, name });
            }
        }
    }

    Ok(ContextualRule {
        situation,
        name: text(inner.get(RULE_NAME)?)?.filter(|name| !name.is_empty()),
        steps: site_of(node, &[])?.steps,
        spells,
        chance: match chances.as_slice() {
            [percent] => Some(*percent),
            _ => None,
        },
        names,
    })
}

/// The class hash of `ContextualConditionChanceToPlay`.
const CONDITION_CHANCE: BinHash = named("ContextualConditionChanceToPlay");

/// The field hash of `mPercentChanceToPlay` on [`CONDITION_CHANCE`].
const CHANCE_PERCENT: BinHash = named("mPercentChanceToPlay");

/// Reads the holder fields of the object root `root`. Both are empty on a class without them.
fn holder_of<'a, V: TreeValue<'a>>(root: V::Node) -> Result<HolderAudio, ltk_meta::Error> {
    let contextual = match leaf(root.get(CONTEXTUAL_ACTION_LINK)?)? {
        Some(Leaf::Link(link)) if link.0 != 0 => Some(link.0),
        _ => None,
    };

    let skin_audio = match root.get(SKIN_AUDIO_PROPERTIES)? {
        Some(value) => value.as_node()?,
        None => None,
    };
    let tags = match skin_audio {
        Some(skin_audio) => texts(skin_audio.get(TAG_EVENT_LIST)?)?,
        None => Vec::new(),
    };

    Ok(HolderAudio { contextual, tags })
}

/// Returns the site of `node`, with `extra` after the steps of its trail.
fn site_of<'a, V: TreeValue<'a>>(
    node: &Node<'_, 'a, V>,
    extra: &[SiteStep],
) -> Result<BankSite, ltk_meta::Error> {
    let trail = node.trail();
    let mut steps = Vec::with_capacity(trail.len() + extra.len());
    for segment in trail.segments() {
        steps.push(match segment {
            TrailSegment::Field(field) => SiteStep::Field(field.0),
            TrailSegment::Index(index) => SiteStep::Index(*index),
            TrailSegment::Key(key) => SiteStep::Key(key_text(key.as_leaf()?)),
        });
    }
    steps.extend_from_slice(extra);

    Ok(BankSite {
        object: node.object_hash().0,
        class: root_class(node).0,
        steps,
    })
}

/// Returns the text of a map key as a hash path writes it. A key of another kind is `?`.
fn key_text(key: Option<Leaf<'_>>) -> String {
    match key {
        Some(Leaf::Hash(hash)) => hash.to_string(),
        Some(Leaf::String(text)) => json_string(text),
        Some(Leaf::U32(value)) => value.to_string(),
        Some(Leaf::U8(value)) => value.to_string(),
        Some(Leaf::I32(value)) => value.to_string(),
        Some(Leaf::Link(link)) => format!("{:08x}", link.0),
        _ => "?".to_owned(),
    }
}

/// Returns `text` as a JSON string, the form a hash path writes a string key in.
pub(crate) fn json_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            character if (character as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", character as u32);
            }
            character => out.push(character),
        }
    }
    out.push('"');
    out
}

fn leaf<'a, V: TreeValue<'a>>(value: Option<V>) -> Result<Option<Leaf<'a>>, ltk_meta::Error> {
    match value {
        Some(value) => value.as_leaf(),
        None => Ok(None),
    }
}

/// Returns the string of `value`, or `None` for a missing field or a field of another kind.
fn text<'a, V: TreeValue<'a>>(value: Option<V>) -> Result<Option<String>, ltk_meta::Error> {
    Ok(match leaf(value)? {
        Some(Leaf::String(text)) => Some(text.to_owned()),
        _ => None,
    })
}

/// Returns the strings of the list `value`. A missing field or a field of another kind is empty.
fn texts<'a, V: TreeValue<'a>>(value: Option<V>) -> Result<Vec<String>, ltk_meta::Error> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    if !matches!(value.kind(), Kind::Container | Kind::UnorderedContainer) {
        return Ok(Vec::new());
    }

    let mut items = Vec::new();
    for item in value.children()? {
        let (_, item) = item?;
        if let Some(Leaf::String(text)) = item.as_leaf()? {
            items.push(text.to_owned());
        }
    }
    Ok(items)
}

/// Expands placeholders of an announcement template into concrete event names.
#[must_use]
pub fn expand_announcement_template(template: &str) -> Vec<String> {
    if !template.contains('@') {
        return vec![template.to_owned()];
    }

    let mut results = vec![template.to_owned()];
    let replacements: &[(&[&str], &[&str])] = &[
        (&["@voice@", "@Voice@"], &["GlobalFemale1", "GlobalMale1"]),
        (
            &["@MapNumber@", "@mapnumber@", "@map@"],
            &["11", "12", "21", "22", "30"],
        ),
        (&["@Team@", "@team@"], &["Order", "Chaos"]),
    ];

    for (tokens, values) in replacements {
        let mut next = Vec::new();
        for text in results {
            let matching_token = tokens.iter().find(|&&tok| {
                text.to_ascii_lowercase()
                    .contains(&tok.to_ascii_lowercase())
            });
            if let Some(&token) = matching_token {
                let token_lower = token.to_ascii_lowercase();
                for value in *values {
                    let mut replaced = text.clone();
                    while let Some(pos) = replaced.to_ascii_lowercase().find(&token_lower) {
                        replaced.replace_range(pos..pos + token.len(), value);
                    }
                    next.push(replaced);
                }
            } else {
                next.push(text);
            }
        }
        results = next;
    }

    results.sort();
    results.dedup();
    results
}

/// Returns `true` if `template` matches `event_name`.
#[must_use]
pub fn announcement_template_matches(template: &str, event_name: &str) -> bool {
    if template.eq_ignore_ascii_case(event_name) {
        return true;
    }
    if !template.contains('@') {
        return false;
    }

    let parts: Vec<&str> = template.split('@').collect();
    if parts.len() < 3 {
        return false;
    }

    let mut remainder = event_name;
    for (i, part) in parts.iter().enumerate() {
        if i % 2 == 0 {
            if part.is_empty() {
                continue;
            }
            if i == 0 {
                if !remainder
                    .to_ascii_lowercase()
                    .starts_with(&part.to_ascii_lowercase())
                {
                    return false;
                }
                remainder = &remainder[part.len()..];
            } else if i == parts.len() - 1 {
                return remainder
                    .to_ascii_lowercase()
                    .ends_with(&part.to_ascii_lowercase());
            } else {
                let pos = match remainder
                    .to_ascii_lowercase()
                    .find(&part.to_ascii_lowercase())
                {
                    Some(p) => p,
                    None => return false,
                };
                remainder = &remainder[pos + part.len()..];
            }
        }
    }
    true
}
