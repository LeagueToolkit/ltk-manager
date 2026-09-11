//! The migration table, and the rows it holds.
//!
//! One JSONL file for each game build, in `problems/tables/`. A table is a
//! claim about one game build: it is right or wrong forever for that build, and
//! it never drifts the way a live feed does. That is why it ships in the build
//! rather than being fetched - and why a wrong hash, which is not recoverable
//! from the file it was written into, is a thing to review before it ships.
//!
//! Both `class` and `field` are a name or a hash. A name hashes to the other
//! form with `FNV1a32(lowercase)`, which is what the format itself does, so the
//! loader hashes every name once and the table becomes one lookup.

use std::collections::HashMap;
use std::sync::LazyLock;

use ltk_hash::{BinHash, Hash as _};
use ltk_meta::property::Kind;
use serde::Deserialize;

use super::kinds;
use crate::bin_document::PropertyKind;
use crate::meta_schema::Shape;
use crate::problems::GameBuild;
use crate::problems::walk::Declared;

/// The first table, and the one the deadline names.
const TABLE_16_17: &str = include_str!("../../tables/binfile_migration_16.17.8087655.jsonl");

/// The build `TABLE_16_17` is a claim about, which its filename also carries.
const BUILD_16_17: GameBuild = GameBuild::new(16, 17, 8_087_655);

/// How a value crosses from the old type to the new one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Conversion {
    /// Each `String` becomes `XXH64(lowercase)` under `File`.
    ///
    /// The string is in the file, so the fix is one hash and one tag. This is
    /// 385 of the 395 rows, and the whole of the problem.
    HashValue,
    /// A `Hash` becomes the `File` of the same path.
    ///
    /// A `Hash` is already `FNV1a32` of a path and there is no arithmetic from
    /// that to `XXH64` of the same path, so the manager has to name the hash
    /// first. Where no table names it there is no fix.
    Rehash,
    /// A `Map` key goes the way [`Rehash`](Self::Rehash) does.
    HashKey,
    /// A type tag or an embedded class hash changes, and no value moves.
    ///
    /// Three pairs encode identically and differ only in the tag: `Embed` and
    /// `Pointer`, `List` and `List2`, `Bool` and `Flag`.
    None,
    /// Each `None` becomes the null `Pointer`, a zero class hash and nothing
    /// behind it, which is the one `Pointer` a `None` can mean.
    NullPointer,
    /// An integer becomes a wider one holding the same number.
    ///
    /// Admitted only for a pair every value of the old type crosses whole,
    /// which is `Range::fits_in`: a `U8` reaches `U64` and an `I32` does not
    /// reach `U32`.
    Widen,
    /// An option holding nothing is re-declared under the item type the game
    /// reads.
    ///
    /// The wire writes an option's item type and its count apart, so an empty
    /// option declares a type it holds no value of. There is nothing to cross,
    /// whatever the two item types are.
    EmptyOption,
    /// A container's items go the way [`HashValue`](Self::HashValue) does, and
    /// its ordering tag flips.
    ///
    /// `List` and `List2` are one vector under two tags, so the two halves are
    /// independent: the items cross whatever the tag does.
    RetagHashValue,
    /// A `Map`'s keys go the way [`HashKey`](Self::HashKey) does, and its values
    /// the way [`HashValue`](Self::HashValue) does.
    ///
    /// The keys are the half that can fail, since only a key a table names back
    /// to its path crosses to `File`.
    HashKeyValue,
    /// Nothing this build knows turns the value into the type it should be.
    Unknown,
}

impl Conversion {
    /// How a value of `from` becomes one of `to`, where anything does.
    ///
    /// Derived from the pair rather than written per property, since the schema
    /// names a type and not a recipe. A pair with no road between them is
    /// [`Unknown`](Self::Unknown), which reports and offers no repair.
    ///
    /// A list, an option or a map crosses on what it holds, and a map keyed
    /// by `Hash` on its keys, which are the roads the tables take.
    #[must_use]
    pub fn between(from: &TypeSpec, to: &TypeSpec) -> Self {
        match (from.kind, to.kind) {
            (Kind::String, Kind::WadChunkLink) => Self::HashValue,
            (Kind::Hash, Kind::WadChunkLink) => Self::Rehash,
            (Kind::None, Kind::Struct) => Self::NullPointer,
            /* Three pairs are one encoding under two tags. `Embed` is a
            `Pointer`'s class hash and body, `List2` is a `List`'s vector, and a
            `Flag` is a `Bool`'s byte, so each crosses on the tag alone. A
            container also has to agree on what it holds, since only the tag
            moves and the items stay as they are. */
            (Kind::Embedded, Kind::Struct) | (Kind::Struct, Kind::Embedded) => Self::None,
            (Kind::Bool, Kind::BitBool) | (Kind::BitBool, Kind::Bool) => Self::None,
            (Kind::Container, Kind::UnorderedContainer)
            | (Kind::UnorderedContainer, Kind::Container)
                if to.value.is_none_or(|item| from.value == Some(item)) =>
            {
                Self::None
            }
            /* The tag crosses on its own, so the items decide the rest. */
            (Kind::Container, Kind::UnorderedContainer)
            | (Kind::UnorderedContainer, Kind::Container) => {
                match Self::held(from.value, to.value) {
                    Self::HashValue => Self::RetagHashValue,
                    _ => Self::Unknown,
                }
            }
            (Kind::Container | Kind::UnorderedContainer | Kind::Optional, same)
                if same == from.kind =>
            {
                Self::held(from.value, to.value)
            }
            (Kind::Map, Kind::Map) if from.key == to.key => Self::held(from.value, to.value),
            (Kind::Map, Kind::Map) => {
                match (Self::keys(from.key, to.key), from.value == to.value) {
                    (Self::HashKey, true) => Self::HashKey,
                    (Self::HashKey, false) => match Self::held(from.value, to.value) {
                        Self::HashValue => Self::HashKeyValue,
                        _ => Self::Unknown,
                    },
                    _ => Self::Unknown,
                }
            }
            (narrow, wide) => Self::widening(narrow, wide),
        }
    }

    /// How a map's keys cross, which only the rehashing road does.
    ///
    /// A key is a primitive the entries are ordered by, so nothing widens one:
    /// a pair that is not `Hash` to `File` leaves the map where it is.
    fn keys(from: Option<Kind>, to: Option<Kind>) -> Self {
        match (from, to) {
            (Some(Kind::Hash), Some(Kind::WadChunkLink)) => Self::HashKey,
            _ => Self::Unknown,
        }
    }

    /// How what a container holds crosses, item by item.
    fn held(from: Option<Kind>, to: Option<Kind>) -> Self {
        match (from, to) {
            (Some(Kind::String), Some(Kind::WadChunkLink)) => Self::HashValue,
            (Some(Kind::None), Some(Kind::Struct)) => Self::NullPointer,
            (Some(narrow), Some(wide)) => Self::widening(narrow, wide),
            _ => Self::Unknown,
        }
    }

    /// The road a wider integer opens, where the pair is one.
    fn widening(from: Kind, to: Kind) -> Self {
        match (Range::of(from), Range::of(to)) {
            (Some(narrow), Some(wide)) if narrow.fits_in(wide) => Self::Widen,
            _ => Self::Unknown,
        }
    }
}

/// What an integer kind holds: its width in bits, and whether it carries a sign.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Range {
    bits: u32,
    signed: bool,
}

impl Range {
    /// The range of an integer kind, or `None` for a kind that is not one.
    fn of(kind: Kind) -> Option<Self> {
        let (bits, signed) = match kind {
            Kind::I8 => (8, true),
            Kind::U8 => (8, false),
            Kind::I16 => (16, true),
            Kind::U16 => (16, false),
            Kind::I32 => (32, true),
            Kind::U32 => (32, false),
            Kind::I64 => (64, true),
            Kind::U64 => (64, false),
            _ => return None,
        };
        Some(Self { bits, signed })
    }

    /// Whether every value of this range is a value of `wider`.
    ///
    /// A sign costs a bit, so an unsigned type reaches a signed one only by
    /// growing: `U32` fits in `I64` and not in `I32`.
    fn fits_in(self, wider: Self) -> bool {
        wider.bits > self.bits && (wider.signed || !self.signed)
    }
}

/// A declared type, as one row of the table writes it.
///
/// Flat rather than recursive, because the file is: a container names its item
/// type as a bare word and carries the class beside it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeSpec {
    /// The type itself, such as `Map` or `String`.
    pub kind: Kind,
    /// A `Map`'s key type.
    pub key: Option<Kind>,
    /// A container's item type.
    pub value: Option<Kind>,
    /// An `Embed` or `Pointer`'s class, or the class of a container's items.
    pub class: Option<BinHash>,
    /// The item count a schema fixes a `List` at.
    pub size: Option<u32>,
}

impl TypeSpec {
    /// The type naming nothing but a kind, which is all the schema gives.
    #[must_use]
    pub const fn bare(kind: Kind) -> Self {
        Self {
            kind,
            key: None,
            value: None,
            class: None,
            size: None,
        }
    }

    /// The type `value` is written as, which is the `from` side of a
    /// schema-derived row.
    #[must_use]
    pub fn of<'a>(value: impl Declared<'a>) -> Self {
        let mut spec = Self::bare(value.kind());
        spec.key = value.key_kind();
        spec.value = value.item_kind();
        spec
    }

    /// Whether `value` is declared as this type, over either tree.
    ///
    /// Detection reads the value's own kind rather than a version, so a table
    /// whose `from` no longer matches contributes nothing and costs one lookup.
    ///
    /// # Errors
    ///
    /// Over a view, a header that does not decode. The owned tree never fails.
    pub fn matches<'a>(&self, value: impl Declared<'a>) -> Result<bool, ltk_meta::Error> {
        if value.kind() != self.kind {
            return Ok(false);
        }
        Ok(match value.kind() {
            Kind::Container | Kind::UnorderedContainer => self.matches_items(value)?,
            Kind::Optional => self
                .value
                .is_none_or(|item| value.item_kind() == Some(item)),
            Kind::Map => {
                self.key.is_none_or(|key| value.key_kind() == Some(key))
                    && self
                        .value
                        .is_none_or(|item| value.item_kind() == Some(item))
            }
            Kind::Struct | Kind::Embedded => value
                .class_hash()
                .is_some_and(|class| self.matches_class(class)),
            _ => true,
        })
    }

    /// Whether a container holds the item type, and the class, this names.
    ///
    /// An empty container matches, because a container holding nothing holds
    /// nothing of the wrong class.
    fn matches_items<'a>(&self, container: impl Declared<'a>) -> Result<bool, ltk_meta::Error> {
        if self
            .value
            .is_some_and(|item| container.item_kind() != Some(item))
        {
            return Ok(false);
        }
        let Some(class) = self.class else {
            return Ok(true);
        };
        if !matches!(container.item_kind(), Some(Kind::Struct | Kind::Embedded)) {
            return Ok(false);
        }
        for held in container.children()? {
            let (_, item) = held?;
            if item.class_hash() != Some(class) {
                return Ok(false);
            }
        }
        Ok(true)
    }

    fn matches_class(&self, class: BinHash) -> bool {
        self.class.is_none_or(|named| named == class)
    }

    /// The type as a row draws it, in the words a bin row's tag uses: `list2[string]`
    /// or `map[hash,string]`.
    #[must_use]
    pub fn label(&self) -> String {
        let kind = tag(self.kind);
        match (self.key, self.value) {
            (Some(key), Some(value)) => format!("{kind}[{},{}]", tag(key), tag(value)),
            (None, Some(value)) => format!("{kind}[{}]", tag(value)),
            _ => kind.to_owned(),
        }
    }
}

impl From<Shape> for TypeSpec {
    /// The type the schema holds, which names no class and no size.
    fn from(shape: Shape) -> Self {
        Self {
            kind: shape.kind,
            key: shape.key,
            value: shape.value,
            class: None,
            size: None,
        }
    }
}

/// The word a bin row's tag draws for a kind, which a finding shares.
fn tag(kind: Kind) -> &'static str {
    PropertyKind::from(kind).tag()
}

/// One row of the table: a class, a field, the old type, and the new one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Migration {
    pub class: BinHash,
    pub field: BinHash,
    /// The class as the row wrote it, where the row wrote a name.
    pub class_name: Option<String>,
    /// The field as the row wrote it, where the row wrote a name.
    pub field_name: Option<String>,
    /// The type the property had. What the rule matches against.
    pub from: TypeSpec,
    /// The type it has now. What the fix writes.
    pub to: TypeSpec,
    pub conversion: Conversion,
}

/// The migrations of one game build, keyed the way a bin addresses them.
#[derive(Debug)]
pub struct MigrationTable {
    build: GameBuild,
    rows: HashMap<(BinHash, BinHash), Migration>,
}

impl MigrationTable {
    /// Read one table's JSONL.
    ///
    /// A row this cannot read is skipped and logged, because a row it cannot
    /// read is a row it must not act on. A type name the mapping does not hold
    /// goes the same way.
    #[must_use]
    pub fn parse(build: GameBuild, jsonl: &str) -> Self {
        let mut rows = HashMap::new();
        for (index, line) in jsonl.lines().enumerate() {
            let number = index + 1;
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let row: Row = match serde_json::from_str(line) {
                Ok(row) => row,
                Err(error) => {
                    tracing::warn!("Migration table {build}, line {number}: {error}");
                    continue;
                }
            };
            let Some(migration) = row.migration() else {
                tracing::warn!(
                    "Migration table {build}, line {number}: a type or a hash it cannot read"
                );
                continue;
            };

            let key = (migration.class, migration.field);
            if let Some(shadowed) = rows.insert(key, migration) {
                tracing::warn!(
                    "Migration table {build}, line {number}: a second row for {:#010x}:{:#010x}, dropping {shadowed:?}",
                    key.0,
                    key.1
                );
            }
        }
        Self { build, rows }
    }

    /// The game build this table is a claim about.
    #[must_use]
    pub fn build(&self) -> GameBuild {
        self.build
    }

    /// How many rows the table holds.
    #[must_use]
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// The migration of one property, if the table names it.
    #[must_use]
    pub fn migration(&self, class: BinHash, field: BinHash) -> Option<&Migration> {
        self.rows.get(&(class, field))
    }
}

/// One line of the JSONL, in the shape the file writes it.
#[derive(Debug, Deserialize)]
struct Row {
    class: String,
    field: String,
    from: RowType,
    to: RowType,
    conversion: RowConversion,
}

impl Row {
    /// The migration this row means, or `None` where it names something unreadable.
    fn migration(self) -> Option<Migration> {
        let (class, class_name) = token(&self.class)?;
        let (field, field_name) = token(&self.field)?;
        Some(Migration {
            class,
            field,
            class_name,
            field_name,
            from: self.from.spec()?,
            to: self.to.spec()?,
            conversion: self.conversion.into(),
        })
    }
}

/// A `from` or a `to` object, in the shape the file writes it.
#[derive(Debug, Deserialize)]
struct RowType {
    #[serde(rename = "type")]
    kind: String,
    key: Option<String>,
    value: Option<String>,
    class: Option<String>,
    size: Option<u32>,
}

impl RowType {
    /// The type this names, or `None` where the mapping holds no such name.
    fn spec(&self) -> Option<TypeSpec> {
        let key = match self.key.as_deref() {
            Some(written) => Some(kinds::kind(written)?),
            None => None,
        };
        let value = match self.value.as_deref() {
            Some(written) => Some(kinds::kind(written)?),
            None => None,
        };
        let class = match self.class.as_deref() {
            Some(written) => Some(token(written)?.0),
            None => None,
        };
        Some(TypeSpec {
            kind: kinds::kind(&self.kind)?,
            key,
            value,
            class,
            size: self.size,
        })
    }
}

/// The `conversion` column, in the spelling the file writes.
///
/// A mirror of [`Conversion`] rather than a derive on it, so the file's own
/// spelling stays out of this crate's public contract.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RowConversion {
    HashValue,
    Rehash,
    HashKey,
    None,
    Widen,
    EmptyOption,
}

impl From<RowConversion> for Conversion {
    fn from(row: RowConversion) -> Self {
        match row {
            RowConversion::HashValue => Self::HashValue,
            RowConversion::Rehash => Self::Rehash,
            RowConversion::HashKey => Self::HashKey,
            RowConversion::None => Self::None,
            RowConversion::Widen => Self::Widen,
            RowConversion::EmptyOption => Self::EmptyOption,
        }
    }
}

/// Read a `class` or a `field`, which the file writes as a name or a hash.
///
/// The name comes back beside the hash where the row wrote one, because nothing
/// else in the manager can name a bin hash today. Hex digits are not padded, so
/// `0xe31300f` is seven of them and still a whole hash.
fn token(written: &str) -> Option<(BinHash, Option<String>)> {
    match written.strip_prefix("0x") {
        Some(digits) => BinHash::from_str_radix(digits, 16)
            .ok()
            .map(|hash| (hash, None)),
        None => Some((BinHash::hash_str(written), Some(written.to_owned()))),
    }
}

/// Built at first use, because a run that names no table pays nothing for one.
static TABLES: LazyLock<Vec<MigrationTable>> = LazyLock::new(|| {
    let mut tables = vec![MigrationTable::parse(BUILD_16_17, TABLE_16_17)];
    tables.sort_by_key(MigrationTable::build);
    tables
});

/// Every table the manager ships, in build order.
///
/// A run applies each in turn, so a mod authored two builds ago comes out at
/// the newest schema without anybody tracking what it was authored against.
#[must_use]
pub fn tables() -> &'static [MigrationTable] {
    &TABLES
}

#[cfg(test)]
mod tests {
    use ltk_meta::property::values;

    use super::*;
    use ltk_meta::PropertyValueEnum;
    use ltk_meta::property::values::Container;

    fn shipped() -> &'static MigrationTable {
        &tables()[0]
    }

    /// A row of the shipped table, addressed the way the file writes it.
    fn row(class: &str, field: &str) -> &'static Migration {
        let (class_hash, _) = token(class).expect("a class token");
        let (field_hash, _) = token(field).expect("a field token");
        shipped()
            .migration(class_hash, field_hash)
            .unwrap_or_else(|| panic!("the shipped table names {class}:{field}"))
    }

    fn string(text: &str) -> PropertyValueEnum {
        PropertyValueEnum::String(values::String::new(text.to_owned()))
    }

    fn file(hash: u64) -> PropertyValueEnum {
        PropertyValueEnum::WadChunkLink(values::WadChunkLink::new(hash))
    }

    fn embedded(class: u32) -> PropertyValueEnum {
        PropertyValueEnum::Embedded(values::Embedded(values::Struct {
            class_hash: BinHash(class),
            ..Default::default()
        }))
    }

    fn container(item: Kind, items: Vec<PropertyValueEnum>) -> Container {
        let mut container = Container::empty(item).expect("a kind a container can hold");
        for value in items {
            container
                .push(value)
                .expect("an item of the container's kind");
        }
        container
    }

    #[test]
    fn the_shipped_table_holds_every_row() {
        assert_eq!(shipped().len(), 395);
        assert!(!shipped().is_empty());
    }

    #[test]
    fn the_manager_ships_the_one_table_the_deadline_names() {
        assert_eq!(tables().len(), 1);
        assert_eq!(shipped().build(), GameBuild::new(16, 17, 8_087_655));
        assert!(tables().windows(2).all(|w| w[0].build() <= w[1].build()));
    }

    #[test]
    fn the_four_conversions_come_out_at_the_counts_the_table_ships() {
        let count = |wanted| {
            shipped()
                .rows
                .values()
                .filter(|row| row.conversion == wanted)
                .count()
        };
        assert_eq!(count(Conversion::HashValue), 385);
        assert_eq!(count(Conversion::Rehash), 7);
        assert_eq!(count(Conversion::HashKey), 1);
        assert_eq!(count(Conversion::None), 2);
    }

    /// The two hashes the document tabulates, which are `FNV1a32(lowercase)` -
    /// the same hash the format itself keys a class and a field by.
    #[test]
    fn a_named_class_hashes_the_way_the_format_does() {
        assert_eq!(
            BinHash::hash_str("AnimationResourceData"),
            BinHash(0x9a4b_299d)
        );
        assert_eq!(
            BinHash::hash_str("mAnimationFilePath"),
            BinHash(0x0329_f1d7)
        );

        let migration = shipped()
            .migration(BinHash(0x9a4b_299d), BinHash(0x0329_f1d7))
            .expect("the animation row");
        assert_eq!(migration.conversion, Conversion::HashValue);
        assert_eq!(
            migration.class_name.as_deref(),
            Some("AnimationResourceData")
        );
        assert_eq!(migration.field_name.as_deref(), Some("mAnimationFilePath"));
    }

    /// The file writes hex unpadded, so `0xe31300f` is seven digits.
    #[test]
    fn a_hex_token_shorter_than_eight_digits_parses() {
        let migration = shipped()
            .migration(
                BinHash::hash_str("TFTLobbyViewController"),
                BinHash(0x0e31_300f),
            )
            .expect("the seven-digit row");
        assert_eq!(migration.conversion, Conversion::Rehash);
        assert_eq!(migration.from.kind, Kind::Hash);
        assert_eq!(migration.to.kind, Kind::WadChunkLink);
    }

    #[test]
    fn a_row_keeps_the_names_it_was_written_with_and_no_others() {
        let migration = shipped()
            .migration(
                BinHash::hash_str("TFTLobbyViewController"),
                BinHash(0x354d_2b95),
            )
            .expect("a named class with a hex field");
        assert_eq!(
            migration.class_name.as_deref(),
            Some("TFTLobbyViewController")
        );
        assert_eq!(migration.field_name, None);

        let hex_class = shipped()
            .migration(BinHash(0x13f5_0786), BinHash::hash_str("imagePath"))
            .expect("a hex class with a named field");
        assert_eq!(hex_class.class_name, None);
        assert_eq!(hex_class.field_name.as_deref(), Some("imagePath"));
    }

    /// The `binhashes` table is not wired up yet, so these are every hash the
    /// rule can name today.
    #[test]
    fn the_table_names_the_classes_and_fields_the_file_wrote_out() {
        let rows = shipped().rows.values();
        let (classes, fields) = rows.fold((0, 0), |(classes, fields), row| {
            (
                classes + usize::from(row.class_name.is_some()),
                fields + usize::from(row.field_name.is_some()),
            )
        });
        assert_eq!(classes, 216);
        assert_eq!(fields, 232);
    }

    #[test]
    fn a_property_the_table_does_not_name_has_no_migration() {
        assert!(
            shipped()
                .migration(
                    BinHash::hash_str("NoSuchClass"),
                    BinHash::hash_str("noSuchField")
                )
                .is_none()
        );
        assert!(
            shipped()
                .migration(
                    BinHash::hash_str("AnimationResourceData"),
                    BinHash::hash_str("noSuchField")
                )
                .is_none()
        );
    }

    /// The whole safety argument: a file at `from` is a problem, a file at `to`
    /// is fixed already, and a file at neither is one the rule leaves alone.
    #[test]
    fn a_leaf_matches_its_from_and_never_its_to() {
        let migration = row("AnimationResourceData", "mAnimationFilePath");
        let path = string("ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds");
        let hashed = file(0xabe0_3fa5_cfa7_e5c0);

        assert!(migration.from.matches(&path).unwrap());
        assert!(!migration.from.matches(&hashed).unwrap());
        assert!(migration.to.matches(&hashed).unwrap());
        assert!(!migration.to.matches(&path).unwrap());

        let neither: PropertyValueEnum = PropertyValueEnum::Hash(values::Hash::new(1u32));
        assert!(!migration.from.matches(&neither).unwrap());
        assert!(!migration.to.matches(&neither).unwrap());
    }

    #[test]
    fn a_map_matches_on_its_key_and_its_value() {
        let migration = row("UiElementParticleSystemData", "TextureOverrides");
        assert_eq!(migration.conversion, Conversion::HashKey);

        let mut hashed =
            values::Map::empty(Kind::Hash, Kind::String).expect("kinds a map can hold");
        hashed
            .push(
                PropertyValueEnum::Hash(values::Hash::new(7u32)),
                string("a"),
            )
            .expect("a key and a value of the map's kinds");
        let hashed: PropertyValueEnum = PropertyValueEnum::Map(hashed);
        assert!(migration.from.matches(&hashed).unwrap());
        assert!(!migration.to.matches(&hashed).unwrap());

        let linked: PropertyValueEnum = PropertyValueEnum::Map(
            values::Map::empty(Kind::WadChunkLink, Kind::String).expect("kinds a map can hold"),
        );
        assert!(migration.to.matches(&linked).unwrap());
        assert!(!migration.from.matches(&linked).unwrap());

        let wrong_value: PropertyValueEnum = PropertyValueEnum::Map(
            values::Map::empty(Kind::Hash, Kind::I32).expect("kinds a map can hold"),
        );
        assert!(!migration.from.matches(&wrong_value).unwrap());
    }

    /// An empty `Optional` still carries its variant, so the item kind reads
    /// either way and an unset property is matched as firmly as a set one.
    #[test]
    fn an_optional_matches_on_its_item_kind_whether_or_not_it_holds_one() {
        let migration = row("SkinCharacterDataProperties", "iconCircle");

        let empty: PropertyValueEnum = PropertyValueEnum::Optional(
            values::Optional::empty(Kind::String).expect("a kind an optional can hold"),
        );
        assert!(migration.from.matches(&empty).unwrap());
        assert!(!migration.to.matches(&empty).unwrap());

        let held: PropertyValueEnum = PropertyValueEnum::Optional(
            values::Optional::new(Kind::String, Some(string("ASSETS/x.dds"))).expect("a string"),
        );
        assert!(migration.from.matches(&held).unwrap());

        let linked: PropertyValueEnum = PropertyValueEnum::Optional(
            values::Optional::empty(Kind::WadChunkLink).expect("a kind an optional can hold"),
        );
        assert!(migration.to.matches(&linked).unwrap());
        assert!(!migration.from.matches(&linked).unwrap());
    }

    #[test]
    fn a_container_matches_on_its_item_kind() {
        let migration = row("AugmentLevelTextureData", "0x8c2ded48");
        assert_eq!(migration.from.kind, Kind::UnorderedContainer);

        let paths = PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(container(
            Kind::String,
            vec![string("ASSETS/a.dds"), string("ASSETS/b.dds")],
        )));
        assert!(migration.from.matches(&paths).unwrap());
        assert!(!migration.to.matches(&paths).unwrap());

        let links = PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(container(
            Kind::WadChunkLink,
            vec![file(1)],
        )));
        assert!(migration.to.matches(&links).unwrap());

        // An ordered container is a different tag, so it is neither shape.
        let ordered = PropertyValueEnum::Container(container(Kind::String, vec![string("a")]));
        assert!(!migration.from.matches(&ordered).unwrap());
    }

    #[test]
    fn a_container_of_embeds_matches_on_the_class_its_items_declare() {
        let migration = row("0x73b4a2eb", "items");
        assert_eq!(migration.conversion, Conversion::None);

        let old = PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(container(
            Kind::Embedded,
            vec![embedded(0x0a7c_a72c), embedded(0x0a7c_a72c)],
        )));
        assert!(migration.from.matches(&old).unwrap());
        assert!(!migration.to.matches(&old).unwrap());

        let renamed = PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(container(
            Kind::Embedded,
            vec![embedded(0x3b8d_8b3f)],
        )));
        assert!(migration.to.matches(&renamed).unwrap());

        let empty = PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(container(
            Kind::Embedded,
            vec![],
        )));
        assert!(migration.from.matches(&empty).unwrap());
        assert!(migration.to.matches(&empty).unwrap());
    }

    #[test]
    fn an_embed_matches_on_the_class_it_declares() {
        let migration = row("0x3b09052f", "value");
        assert_eq!(migration.conversion, Conversion::None);

        assert!(migration.from.matches(&embedded(0x73b4_a2eb)).unwrap());
        assert!(!migration.from.matches(&embedded(0x0a7c_a72c)).unwrap());

        let pointer: PropertyValueEnum = PropertyValueEnum::Struct(values::Struct {
            class_hash: BinHash(0x73b4_a2eb),
            ..Default::default()
        });
        assert!(migration.to.matches(&pointer).unwrap());
        assert!(!migration.from.matches(&pointer).unwrap());
    }

    /// The finding and a bin row's tag are one vocabulary, ritobin's, composed the way
    /// the meta wiki writes a container.
    #[test]
    fn a_label_reads_in_the_words_a_bin_rows_tag_draws() {
        let leaf = row("AnimationResourceData", "mAnimationFilePath");
        assert_eq!(leaf.from.label(), "string");
        assert_eq!(leaf.to.label(), "file");

        let list2 = row("AugmentLevelTextureData", "0x8c2ded48");
        assert_eq!(list2.from.label(), "list2[string]");
        assert_eq!(list2.to.label(), "list2[file]");

        let map = row("UiElementParticleSystemData", "TextureOverrides");
        assert_eq!(map.from.label(), "map[hash,string]");
        assert_eq!(map.to.label(), "map[file,string]");

        let optional = row("SkinCharacterDataProperties", "iconCircle");
        assert_eq!(optional.from.label(), "option[string]");

        let sized = row(
            "TftTrovesCelebrationViewControllerV2",
            "StandardItemStarLevelTexturePaths",
        );
        assert_eq!(sized.from.size, Some(3));
        assert_eq!(sized.from.label(), "list[string]");

        let embed = row("0x3b09052f", "value");
        assert_eq!(embed.from.label(), "embed");
        assert_eq!(embed.to.label(), "pointer");

        assert_eq!(
            TypeSpec::bare(Kind::Color).label(),
            PropertyKind::Color.tag()
        );
    }

    /// A row it cannot read is a row it must not act on, so a bad line costs
    /// the rows around it nothing.
    #[test]
    fn a_line_it_cannot_read_is_skipped_rather_than_fatal() {
        let jsonl = r#"
{"class": "AnimationResourceData", "field": "mAnimationFilePath", "from": {"type": "String"}, "to": {"type": "File"}, "conversion": "hash_value"}

not json at all
{"class": "A", "field": "b", "from": {"type": "String"}}
{"class": "C", "field": "d", "from": {"type": "Nonesuch"}, "to": {"type": "File"}, "conversion": "hash_value"}
{"class": "E", "field": "f", "from": {"type": "Map", "key": "Vector3", "value": "String"}, "to": {"type": "File"}, "conversion": "hash_value"}
{"class": "G", "field": "h", "from": {"type": "String"}, "to": {"type": "File"}, "conversion": "teleport"}
{"class": "0xzz", "field": "j", "from": {"type": "String"}, "to": {"type": "File"}, "conversion": "hash_value"}
"#;
        let table = MigrationTable::parse(GameBuild::new(1, 2, 3), jsonl);

        assert_eq!(table.len(), 1);
        assert_eq!(table.build(), GameBuild::new(1, 2, 3));
        assert!(
            table
                .migration(BinHash(0x9a4b_299d), BinHash(0x0329_f1d7))
                .is_some()
        );
    }

    #[test]
    fn a_table_of_nothing_holds_nothing() {
        let table = MigrationTable::parse(GameBuild::new(1, 2, 3), "\n\n   \n");
        assert!(table.is_empty());
        assert_eq!(table.len(), 0);
    }

    /// A `None` where the game wants a `Pointer` is a pointer to nothing,
    /// which the format writes as a zero class hash, so that is the road.
    #[test]
    fn a_none_crosses_to_a_pointer_as_a_null_pointer() {
        assert_eq!(
            Conversion::between(&TypeSpec::bare(Kind::None), &TypeSpec::bare(Kind::Struct)),
            Conversion::NullPointer
        );

        let list_of = |item| TypeSpec {
            value: Some(item),
            ..TypeSpec::bare(Kind::Container)
        };
        assert_eq!(
            Conversion::between(&list_of(Kind::None), &list_of(Kind::Struct)),
            Conversion::NullPointer
        );
    }

    /// Every value of the narrow type is a value of the wide one, so the number
    /// crosses whole and the tag is the only thing that moves.
    #[test]
    fn an_integer_crosses_to_any_type_that_holds_every_value_it_had() {
        let crossings = [
            (Kind::U8, Kind::U16),
            (Kind::U8, Kind::U64),
            (Kind::U16, Kind::U32),
            (Kind::U32, Kind::U64),
            (Kind::I8, Kind::I64),
            (Kind::I16, Kind::I32),
            (Kind::I32, Kind::I64),
            /* A sign costs a bit, so an unsigned type reaches a signed one
            only by growing. */
            (Kind::U8, Kind::I16),
            (Kind::U32, Kind::I64),
        ];
        for (from, to) in crossings {
            assert_eq!(
                Conversion::between(&TypeSpec::bare(from), &TypeSpec::bare(to)),
                Conversion::Widen,
                "{from:?} to {to:?}"
            );
        }
    }

    /// A pair that could drop a bit of the number is not a repair, whatever the
    /// two widths are.
    #[test]
    fn an_integer_does_not_cross_to_a_type_that_would_lose_it() {
        let refused = [
            (Kind::U32, Kind::U8),
            (Kind::I64, Kind::I32),
            (Kind::U32, Kind::I32),
            (Kind::I32, Kind::U32),
            (Kind::I8, Kind::U64),
            (Kind::U8, Kind::U8),
            (Kind::U32, Kind::F32),
        ];
        for (from, to) in refused {
            assert_eq!(
                Conversion::between(&TypeSpec::bare(from), &TypeSpec::bare(to)),
                Conversion::Unknown,
                "{from:?} to {to:?}"
            );
        }
    }

    /// A container crosses on what it holds, so a list of narrow integers takes
    /// the same road one of them does.
    #[test]
    fn a_container_of_integers_crosses_on_its_item_type() {
        let list_of = |item| TypeSpec {
            value: Some(item),
            ..TypeSpec::bare(Kind::Container)
        };
        assert_eq!(
            Conversion::between(&list_of(Kind::U8), &list_of(Kind::U32)),
            Conversion::Widen
        );
        assert_eq!(
            Conversion::between(&list_of(Kind::U32), &list_of(Kind::U8)),
            Conversion::Unknown
        );
    }

    /// Three pairs are one encoding under two tags, and Riot has moved fields
    /// both ways across each, so every direction is a retype and no move.
    #[test]
    fn the_pairs_that_share_an_encoding_cross_on_the_tag_either_way() {
        let pairs = [
            (Kind::Embedded, Kind::Struct),
            (Kind::Struct, Kind::Embedded),
            (Kind::Bool, Kind::BitBool),
            (Kind::BitBool, Kind::Bool),
        ];
        for (from, to) in pairs {
            assert_eq!(
                Conversion::between(&TypeSpec::bare(from), &TypeSpec::bare(to)),
                Conversion::None,
                "{from:?} to {to:?}"
            );
        }
    }

    /// A `List` and a `List2` are the same vector, so the ordering tag crosses
    /// on its own - but only where both sides hold the same item type, because
    /// nothing under the tag moves.
    #[test]
    fn a_list_and_a_list2_cross_where_they_hold_the_same_item() {
        let list_of = |kind, item| TypeSpec {
            value: Some(item),
            ..TypeSpec::bare(kind)
        };
        assert_eq!(
            Conversion::between(
                &list_of(Kind::Container, Kind::Hash),
                &list_of(Kind::UnorderedContainer, Kind::Hash)
            ),
            Conversion::None
        );
        assert_eq!(
            Conversion::between(
                &list_of(Kind::UnorderedContainer, Kind::Struct),
                &list_of(Kind::Container, Kind::Struct)
            ),
            Conversion::None
        );
    }

    /// The tag and the items are independent, so a pair that moves both takes
    /// the road that does both.
    #[test]
    fn a_list_of_paths_the_game_reads_as_a_list2_of_files_crosses_on_both() {
        let list_of = |kind, item| TypeSpec {
            value: Some(item),
            ..TypeSpec::bare(kind)
        };
        assert_eq!(
            Conversion::between(
                &list_of(Kind::Container, Kind::String),
                &list_of(Kind::UnorderedContainer, Kind::WadChunkLink)
            ),
            Conversion::RetagHashValue
        );
        assert_eq!(
            Conversion::between(
                &list_of(Kind::UnorderedContainer, Kind::String),
                &list_of(Kind::Container, Kind::WadChunkLink)
            ),
            Conversion::RetagHashValue
        );
    }

    /// A tag that flips over items with no road between them is still no road,
    /// because the items are what the property holds.
    #[test]
    fn a_retag_over_items_that_cannot_cross_is_unknown() {
        let list_of = |kind, item| TypeSpec {
            value: Some(item),
            ..TypeSpec::bare(kind)
        };
        assert_eq!(
            Conversion::between(
                &list_of(Kind::Container, Kind::U32),
                &list_of(Kind::UnorderedContainer, Kind::U8)
            ),
            Conversion::Unknown
        );
    }

    /// A map's two halves are independent the way a container's tag and items
    /// are, and 16.18 moved both at once on `UiElementParticleSystemData`.
    #[test]
    fn a_map_that_moves_its_keys_and_its_values_crosses_on_both() {
        let map_of = |key, value| TypeSpec {
            key: Some(key),
            value: Some(value),
            ..TypeSpec::bare(Kind::Map)
        };
        assert_eq!(
            Conversion::between(
                &map_of(Kind::Hash, Kind::String),
                &map_of(Kind::WadChunkLink, Kind::WadChunkLink)
            ),
            Conversion::HashKeyValue
        );
        assert_eq!(
            Conversion::between(
                &map_of(Kind::Hash, Kind::String),
                &map_of(Kind::WadChunkLink, Kind::String)
            ),
            Conversion::HashKey,
            "the values stay as they are, so the keys are the whole road"
        );
        assert_eq!(
            Conversion::between(
                &map_of(Kind::Hash, Kind::Struct),
                &map_of(Kind::WadChunkLink, Kind::Embedded)
            ),
            Conversion::Unknown,
            "a pointer becoming an embed is a road, but not one a map's values take"
        );
        assert_eq!(
            Conversion::between(
                &map_of(Kind::U32, Kind::String),
                &map_of(Kind::WadChunkLink, Kind::WadChunkLink)
            ),
            Conversion::Unknown,
            "only a Hash key crosses to a File key"
        );
    }

    /// A schema that names no item type is a claim about the ordering alone,
    /// which is the same claim `TypeSpec::matches` reads it as.
    #[test]
    fn a_list_crosses_where_the_other_side_names_no_item() {
        let list = TypeSpec {
            value: Some(Kind::Hash),
            ..TypeSpec::bare(Kind::Container)
        };
        assert_eq!(
            Conversion::between(&list, &TypeSpec::bare(Kind::UnorderedContainer)),
            Conversion::None
        );
    }
}
