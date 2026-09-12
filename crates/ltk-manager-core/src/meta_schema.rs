//! The meta schema: what type the game expects every bin property to hold.
//!
//! A bin writes one type tag per value, and the game compares it against its
//! own registrar by exact byte equality - no coercion, no widening. A tag that
//! does not match is thrown away, the member keeps its constructor default, and
//! the load reports success, so a mistyped property is silent data loss.
//!
//! **A revision is keyed on a build, so a lookup needs one.** A field is
//! `String` before a build and `File` after it, and neither is wrong in itself.

use std::collections::HashMap;
use std::io::Read as _;
use std::sync::Arc;

use ltk_hash::BinHash;
use ltk_meta::property::Kind;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::bin_document::PropertyKind;
use crate::bin_document::hex;
use crate::problems::GameBuild;

#[cfg(test)]
mod tests;

/// The database as the LTK Meta Wiki publishes it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Published {
    /// The database layout, which this build knows one of.
    format_version: u32,
    hash_source: HashSource,
    /// The newest build any revision names.
    latest: u32,
    classes: HashMap<String, PublishedClass>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HashSource {
    /// When the upstream hash tables behind this database were read.
    fetched_at: String,
}

#[derive(Debug, Deserialize)]
struct PublishedClass {
    name: Option<String>,
    #[serde(default)]
    properties: HashMap<String, PublishedProperty>,
}

#[derive(Debug, Deserialize)]
struct PublishedProperty {
    name: Option<String>,
    #[serde(default)]
    revisions: Vec<PublishedRevision>,
}

#[derive(Debug, Deserialize)]
struct PublishedRevision {
    /// The first build this revision describes.
    from: u32,
    /// The last build it describes, absent while it is the current one.
    to: Option<u32>,
    /// Field type, key type, value type and class hash, in that order. What
    /// [`Shape`] reads.
    #[serde(default)]
    r#type: Vec<String>,
}

/// The database this build ships, so a check works offline and before a sync.
///
/// Gzipped because the JSON is 3.7 MB.
const SNAPSHOT: &[u8] = include_bytes!("meta_schema/schema-snapshot.json.gz");

/// The layout this build reads.
///
/// A database published at any other layout is refused rather than guessed at,
/// because a silently misread schema reports mismatches that are not there.
const FORMAT_VERSION: u32 = 1;

/// The published database, parsed into what a lookup asks of it.
#[derive(Debug)]
pub struct MetaSchema {
    generation: String,
    latest: u32,
    classes: HashMap<BinHash, ParsedClass>,
}

#[derive(Debug)]
struct ParsedClass {
    name: Option<String>,
    properties: HashMap<BinHash, ParsedProperty>,
}

#[derive(Debug)]
struct ParsedProperty {
    name: Option<String>,
    /// In the order the publisher wrote them, which is oldest first.
    revisions: Vec<Revision>,
}

impl ParsedProperty {
    /// The revision describing `build`.
    fn at(&self, build: u32) -> Option<&Revision> {
        self.revisions
            .iter()
            .find(|revision| revision.covers(build))
    }
}

/// One property's type over one span of builds.
#[derive(Debug, Clone, Copy)]
struct Revision {
    from: u32,
    to: Option<u32>,
    /// `None` for a type name this build does not map, which is a revision the
    /// lookup declines to answer rather than one it answers wrongly.
    shape: Option<Shape>,
}

impl Revision {
    /// Whether this revision is the one describing `build`.
    ///
    /// `to` is inclusive: the publisher writes the last build a revision held
    /// for, not the first build after it.
    fn covers(&self, build: u32) -> bool {
        build >= self.from && self.to.is_none_or(|last| build <= last)
    }
}

/// What the database writes in a slot the type leaves empty.
const EMPTY_SLOT: &str = "0x0";

/// The type of one property, as the database writes it.
///
/// Flat, the way the file is: `[kind, key, value, class]`, with `EMPTY_SLOT`
/// where the type has nothing to say. The class is not read, because a
/// `Pointer` names a base class and holds any class derived from it, so the
/// class a bin declares is no evidence of a mismatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape {
    /// The type itself, such as `Option` or `File`.
    pub kind: Kind,
    /// A `Map`'s key type.
    pub key: Option<Kind>,
    /// What an `Option`, a list or a `Map` holds.
    pub value: Option<Kind>,
}

impl Shape {
    /// The type naming nothing but a kind, as a leaf writes it.
    #[must_use]
    pub const fn bare(kind: Kind) -> Self {
        Self {
            kind,
            key: None,
            value: None,
        }
    }

    /// Read the slots a revision writes, or `None` where the dumper could not
    /// name one of them.
    ///
    /// A list writes its fixed size in the key slot, which is a count and not
    /// a kind, so the key is read for a `Map` alone.
    fn written(slots: &[String]) -> Option<Self> {
        let slot = |index: usize| {
            slots
                .get(index)
                .map(String::as_str)
                .filter(|written| *written != EMPTY_SLOT)
        };
        let kind = kind_named(slot(0)?)?;
        let key = match (kind, slot(1)) {
            (Kind::Map, Some(written)) => Some(kind_named(written)?),
            _ => None,
        };
        let value = match slot(2) {
            Some(written) => Some(kind_named(written)?),
            None => None,
        };
        Some(Self { kind, key, value })
    }
}

/// A type as the tag composes it: the kind, a `Map`'s key, and what a container holds.
///
/// The wire form of [`Shape`]. A row's tag and a card's field draw it as `list[embed]`
/// or `map[hash,string]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct KindShape {
    pub kind: PropertyKind,
    /// A `Map`'s key kind.
    pub key: Option<PropertyKind>,
    /// What an `Option`, a list or a `Map` holds.
    pub value: Option<PropertyKind>,
}

impl KindShape {
    /// The shape naming nothing but a kind, as a leaf writes it.
    #[must_use]
    pub const fn bare(kind: PropertyKind) -> Self {
        Self {
            kind,
            key: None,
            value: None,
        }
    }
}

impl From<Shape> for KindShape {
    fn from(shape: Shape) -> Self {
        Self {
            kind: shape.kind.into(),
            key: shape.key.map(PropertyKind::from),
            value: shape.value.map(PropertyKind::from),
        }
    }
}

/// One class as the class card draws it: its name, and its fields typed at one build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct ClassSchema {
    /// The class as the database names it.
    pub name: Option<String>,
    /// The content build `declared` is read at: the install's, or the newest the
    /// database names where the install has none it describes.
    pub build: u32,
    /// The patch a player names, where the install's own build is what was read.
    ///
    /// Absent where the database describes no build the install has and the newest it
    /// names stood in, because that build belongs to no patch this install knows.
    pub patch: Option<String>,
    /// The named fields first, by name, and the unnamed after them by hash.
    pub fields: Vec<FieldSchema>,
}

/// One field of a class: its name, its type at the card's build, and every revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct FieldSchema {
    /// `0x` and eight hex digits.
    pub hash: String,
    /// The field as the database names it.
    pub name: Option<String>,
    /// The type at the card's build. Absent where no revision covers the build, and
    /// where the revision names a type this build cannot map.
    pub declared: Option<KindShape>,
    /// Oldest first.
    pub revisions: Vec<FieldRevision>,
}

/// One field's type over one span of builds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[cfg_attr(feature = "ts", ts(export))]
pub struct FieldRevision {
    /// The first content build the revision holds for.
    pub from: u32,
    /// The last content build it holds for, inclusive. Open where absent.
    pub to: Option<u32>,
    /// Absent for a type this build cannot map.
    pub shape: Option<KindShape>,
}

impl From<&Revision> for FieldRevision {
    fn from(revision: &Revision) -> Self {
        Self {
            from: revision.from,
            to: revision.to,
            shape: revision.shape.map(KindShape::from),
        }
    }
}

/// The database read at the install's build, where it describes one.
///
/// A declared type is a revision, and a revision is keyed on a build. A name is the
/// database's at every build.
#[derive(Debug, Clone, Copy)]
pub struct SchemaAt<'a> {
    schema: &'a MetaSchema,
    build: Option<GameBuild>,
}

impl<'a> SchemaAt<'a> {
    /// The build a declared type is read at. `None` without an install, and for a
    /// build past what the database reaches.
    #[must_use]
    pub const fn build(self) -> Option<GameBuild> {
        self.build
    }

    /// What the game expects `field` of `class` to hold. See [`MetaSchema::expected`].
    ///
    /// `None` without a build.
    #[must_use]
    pub fn expected(self, class: BinHash, field: BinHash) -> Option<Expected<'a>> {
        self.schema.expected(class, field, self.build?)
    }

    /// The field as the database names it, at any build.
    #[must_use]
    pub fn field_name(self, class: BinHash, field: BinHash) -> Option<&'a str> {
        self.schema.field_name(class, field)
    }

    /// The class as the database names it, at any build.
    #[must_use]
    pub fn class_name(self, class: BinHash) -> Option<&'a str> {
        self.schema.class_name(class)
    }
}

/// What one property is, at one build.
///
/// Borrowed rather than cloned: a walk asks this of every property of every
/// object of every bin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Expected<'a> {
    /// The type the game's registrar holds, absent where the database names a
    /// type this build cannot map.
    pub shape: Option<Shape>,
    /// The class as the database names it.
    pub class_name: Option<&'a str>,
    /// The property as the database names it.
    pub field_name: Option<&'a str>,
}

/// Why a database could not be read.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum MetaSchemaError {
    /// The bytes are not the JSON this reads.
    #[error("meta schema database: {0}")]
    Parse(#[from] serde_json::Error),
    /// The database is published at a layout this build does not know.
    #[error(
        "meta schema database is format version {found}, and this build reads {FORMAT_VERSION}"
    )]
    Format { found: u32 },
}

impl MetaSchema {
    /// The database this build ships, decompressed and parsed.
    ///
    /// # Panics
    ///
    /// Panics when the shipped snapshot is not a database this build reads,
    /// which is a broken build rather than a condition a caller can handle.
    #[must_use]
    pub fn shipped() -> Self {
        let mut json = Vec::new();
        flate2::read::GzDecoder::new(SNAPSHOT)
            .read_to_end(&mut json)
            .expect("the shipped meta schema snapshot decompresses");
        Self::parse(&json).expect("the shipped meta schema snapshot parses")
    }

    /// Parse a published database.
    ///
    /// # Errors
    ///
    /// Fails when the bytes are not the published JSON, and when they are a
    /// layout this build does not read - see [`MetaSchemaError`].
    pub fn parse(json: &[u8]) -> Result<Self, MetaSchemaError> {
        let published: Published = serde_json::from_slice(json)?;
        if published.format_version != FORMAT_VERSION {
            return Err(MetaSchemaError::Format {
                found: published.format_version,
            });
        }

        let classes = published
            .classes
            .into_iter()
            .filter_map(|(hash, class)| {
                let hash = parse_hash(&hash)?;
                let properties = class
                    .properties
                    .into_iter()
                    .filter_map(|(field, property)| {
                        Some((parse_hash(&field)?, ParsedProperty::from(property)))
                    })
                    .collect();
                Some((
                    hash,
                    ParsedClass {
                        name: class.name,
                        properties,
                    },
                ))
            })
            .collect();

        Ok(Self {
            generation: published.hash_source.fetched_at,
            latest: published.latest,
            classes,
        })
    }

    /// What the game expects `field` of `class` to hold at `build`.
    ///
    /// `None` for a class, property or build it does not describe - silence
    /// rather than a mismatch, since a schema that says nothing is not evidence.
    #[must_use]
    pub fn expected(
        &self,
        class: BinHash,
        field: BinHash,
        build: GameBuild,
    ) -> Option<Expected<'_>> {
        let parsed = self.classes.get(&class)?;
        let property = parsed.properties.get(&field)?;
        let revision = property.at(build.content())?;

        Some(Expected {
            shape: revision.shape,
            class_name: parsed.name.as_deref(),
            field_name: property.name.as_deref(),
        })
    }

    /// This database read at `build`, where it describes one.
    #[must_use]
    pub fn at(&self, build: Option<GameBuild>) -> SchemaAt<'_> {
        SchemaAt {
            schema: self,
            build: build.filter(|build| self.describes(*build)),
        }
    }

    /// The field as the database names it, at any build.
    #[must_use]
    pub fn field_name(&self, class: BinHash, field: BinHash) -> Option<&str> {
        self.classes
            .get(&class)?
            .properties
            .get(&field)?
            .name
            .as_deref()
    }

    /// The class as the database names it, at any build.
    #[must_use]
    pub fn class_name(&self, class: BinHash) -> Option<&str> {
        self.classes.get(&class)?.name.as_deref()
    }

    /// One class as the class card draws it, or `None` for a class it does not describe.
    ///
    /// The fields are typed at `build` where the database describes it, and at the
    /// newest build it names otherwise.
    #[must_use]
    pub fn class_schema(&self, class: BinHash, build: Option<GameBuild>) -> Option<ClassSchema> {
        let parsed = self.classes.get(&class)?;
        let described = build.filter(|build| self.describes(*build));
        let patch = described.as_ref().map(GameBuild::patch);
        let build = described.map_or(self.latest, |build| build.content());

        let mut fields: Vec<FieldSchema> = parsed
            .properties
            .iter()
            .map(|(hash, property)| FieldSchema {
                hash: hex(*hash),
                name: property.name.clone(),
                declared: property
                    .at(build)
                    .and_then(|revision| revision.shape)
                    .map(KindShape::from),
                revisions: property.revisions.iter().map(FieldRevision::from).collect(),
            })
            .collect();
        fields.sort_by_cached_key(|field| {
            (
                field.name.is_none(),
                field.name.as_deref().map(str::to_lowercase),
                field.hash.clone(),
            )
        });

        Some(ClassSchema {
            name: parsed.name.clone(),
            build,
            patch,
            fields,
        })
    }

    /// Whether this database describes `build` at all.
    ///
    /// A build past its newest revision is one it cannot speak about.
    #[must_use]
    pub fn describes(&self, build: GameBuild) -> bool {
        build.content() <= self.latest
    }

    /// The newest build any revision names.
    #[must_use]
    pub const fn latest(&self) -> u32 {
        self.latest
    }

    /// The publisher's own stamp, which is what makes one check comparable
    /// with another.
    #[must_use]
    pub fn generation(&self) -> &str {
        &self.generation
    }

    /// How many classes it describes.
    #[must_use]
    pub fn class_count(&self) -> usize {
        self.classes.len()
    }
}

impl From<PublishedProperty> for ParsedProperty {
    fn from(property: PublishedProperty) -> Self {
        Self {
            name: property.name,
            revisions: property
                .revisions
                .into_iter()
                .map(|revision| Revision {
                    from: revision.from,
                    to: revision.to,
                    shape: Shape::written(&revision.r#type),
                })
                .collect(),
        }
    }
}

/// The hash a database key writes, which is unpadded hex under `0x`.
fn parse_hash(key: &str) -> Option<BinHash> {
    let digits = key.strip_prefix("0x").unwrap_or(key);
    u32::from_str_radix(digits, 16).ok().map(BinHash)
}

/// Every type name the database writes, beside the kind `ltk_meta` calls it.
///
/// One list rather than two matches, so the two vocabularies cannot disagree.
/// The publisher writes the meta dumper's names, which differ from the reader's
/// for the five complex types and agree everywhere else.
const NAMES: &[(&str, Kind)] = &[
    ("None", Kind::None),
    ("Bool", Kind::Bool),
    ("I8", Kind::I8),
    ("U8", Kind::U8),
    ("I16", Kind::I16),
    ("U16", Kind::U16),
    ("I32", Kind::I32),
    ("U32", Kind::U32),
    ("I64", Kind::I64),
    ("U64", Kind::U64),
    ("F32", Kind::F32),
    ("Vec2", Kind::Vector2),
    ("Vec3", Kind::Vector3),
    ("Vec4", Kind::Vector4),
    ("Mtx44", Kind::Matrix44),
    ("Color", Kind::Color),
    ("String", Kind::String),
    ("Hash", Kind::Hash),
    ("File", Kind::WadChunkLink),
    ("List", Kind::Container),
    ("List2", Kind::UnorderedContainer),
    ("Pointer", Kind::Struct),
    ("Embed", Kind::Embedded),
    ("Link", Kind::ObjectLink),
    ("Option", Kind::Optional),
    ("Map", Kind::Map),
    ("Flag", Kind::BitBool),
];

/// The kind a database type name means.
///
/// `None` for a name this build does not hold, which the publisher writes where
/// its own dumper could not name the type.
#[must_use]
pub fn kind_named(name: &str) -> Option<Kind> {
    NAMES
        .iter()
        .find(|(written, _)| *written == name)
        .map(|&(_, kind)| kind)
}

/// The name the database writes for a kind, for a finding a person reads.
#[must_use]
pub fn name_of(kind: Kind) -> Option<&'static str> {
    NAMES
        .iter()
        .find(|(_, held)| *held == kind)
        .map(|&(name, _)| name)
}

/// The one database this process reads.
static HELD: Slot = Slot(Mutex::new(None));

/// A place one database is kept open, keyed on the build it was chosen for.
#[derive(Debug)]
struct Slot(Mutex<Option<Held>>);

impl Slot {
    /// The schema for `build`, opened here when what is open is for another.
    fn schema(&self, build: Option<GameBuild>) -> Arc<MetaSchema> {
        let mut held = self.0.lock();
        if let Some(open) = held.as_ref()
            && open.build == build
        {
            return Arc::clone(&open.schema);
        }

        let schema = Arc::new(match cache::MetaSchemaCache::discover() {
            Ok(cache) => cache.load(build),
            Err(e) => {
                tracing::debug!("No meta schema cache, reading the shipped database: {e}");
                MetaSchema::shipped()
            }
        });
        *held = Some(Held {
            build,
            schema: Arc::clone(&schema),
        });
        schema
    }

    /// Drop what is open, so the next ask reads what a sync installed.
    fn clear(&self) {
        *self.0.lock() = None;
    }
}

/// The open database, beside the install it was opened against.
///
/// The build is kept because [`cache::MetaSchemaCache::load`] chooses by it, so
/// a copy held for one install is not an answer for another.
#[derive(Debug)]
struct Held {
    build: Option<GameBuild>,
    schema: Arc<MetaSchema>,
}

/// The schema every check in this process reads, opened on first use.
///
/// Held rather than parsed per bin: the database is 3.7 MB of JSON and a sweep
/// asks the same questions of it for every mod.
#[must_use]
pub fn shared(build: Option<GameBuild>) -> Arc<MetaSchema> {
    HELD.schema(build)
}

/// Drop the open database, so the next check reads what a sync just installed.
pub fn invalidate() {
    HELD.clear();
}

/// The cached copy of the published database, and the sync that fills it.
pub mod cache;
