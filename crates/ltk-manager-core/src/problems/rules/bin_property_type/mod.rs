//! `bin/property-type` - a property whose declared type the game has changed.
//!
//! A property bin holds typed values. A `String` is a length and its bytes. A
//! `File` is a `u64`, the XXH64 of the lowercased path, and it is how the game
//! addresses a WAD chunk without carrying the path. Riot changed several
//! hundred properties from the first to the second, and a mod that ships the
//! old type is a mod the game rejects. The value is not wrong. Its type is.
//!
//! For each object the rule looks up the class hash, and for each property it
//! holds it looks up the migration by field hash. Then it compares the
//! property's actual kind.
//!
//! | The property's kind | The rule                                         |
//! | ------------------- | ------------------------------------------------ |
//! | Matches `from`      | Raises a problem                                 |
//! | Matches `to`        | Raises nothing. The file is fixed already        |
//! | Matches neither     | Raises nothing, and the file keeps what it holds |
//! | Absent              | Raises nothing. A bin declares what it declares  |
//!
//! Those four rows are the whole safety argument. A run is idempotent, a fix
//! run can be offered twice without doubling anything, and a file that disagrees
//! with both schemas is a file the rule refuses to guess about.
//!
//! The walk descends into `Struct` and `Embedded` values, because those carry a
//! class hash of their own and two rows of the table key on one.

pub mod kinds;
pub mod table;

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::PropertyValueEnum;
use ltk_meta::property::{Kind, NoMeta, values};

use crate::problems::names::{self, BinNames};
use crate::problems::{
    Applied, Detail, Dormancy, FixError, FixPreview, FixRun, GameBuild, NodeAddress, Preserved,
    PreservedNames, Problem, ProjectFiles, Report, Rule, RuleId, Severity, Site, TypeMismatch,
};
use crate::workshop::WorkshopFileKind;

use table::{Conversion, Migration, MigrationTable};

/// The id every row of this rule carries.
pub const ID: RuleId = RuleId("bin/property-type");

/// Repairs the properties Riot changed to `File`.
#[derive(Debug, Default)]
pub struct BinPropertyType;

impl BinPropertyType {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl Rule for BinPropertyType {
    fn id(&self) -> RuleId {
        ID
    }

    fn title(&self) -> &'static str {
        "Meta property type mismatch"
    }

    fn description(&self) -> &'static str {
        "The type of a meta property in a bin file does not match what the game expects"
    }

    /// The oldest table this project's game has not reached, in a modder's words.
    ///
    /// A table is a claim about one build. Until the game is on that build the
    /// change has not happened, so the findings are about work that is coming
    /// rather than a mod that is broken - which is what [`Severity::Warning`]
    /// already says of each of them, and what the panel mutes them for.
    ///
    /// The sentence names the patch rather than the build, because a patch is
    /// the number a modder reads in Riot's notes. The builds both sides compare
    /// on are the fine print under it.
    fn dormant(&self, project: &ProjectFiles) -> Option<Dormancy> {
        let installed = project.build()?;
        let waiting = table::tables()
            .iter()
            .find(|table| table.build() > installed)?
            .build();
        let patch = waiting.patch();

        Some(
            Dormancy::new(
                format!("Patch {patch}"),
                format!(
                    "Riot changes how these values are stored in patch {patch}. Your game is on {}, so nothing here is broken yet, and repairing it now breaks the mod on the patch you play.",
                    installed.patch()
                ),
            )
            .with_detail(format!(
                "Your game is on {installed}, and the change lands in {waiting}"
            )),
        )
    }

    fn check(&self, project: &ProjectFiles, report: &mut Report) {
        let tables = table::tables();
        if tables.is_empty() {
            return;
        }
        let lens = Lens {
            tables,
            names: project.names(),
        };

        for (layer, file) in project
            .by_kind(WorkshopFileKind::PropertyBin)
            .chain(project.by_kind(WorkshopFileKind::PropertyBinOverride))
        {
            let site = Site::file(&layer.name, &file.path);
            let bin = match read_bin(&layer.absolute(file)) {
                Ok(bin) => bin,
                Err(e) => {
                    report.failure(ID, Some(site), e);
                    continue;
                }
            };

            for (entry, object) in &bin.objects {
                let mut found = Vec::new();
                walk(
                    object.class_hash,
                    &object.properties,
                    &Trail::default(),
                    lens,
                    &mut found,
                );

                for hit in found {
                    let severity = severity(project.build(), hit.table_build);
                    let fix = (!bin.is_override)
                        .then(|| preview(hit.migration, hit.value))
                        .flatten();
                    report.problem(
                        ID,
                        severity,
                        Site::node(
                            &layer.name,
                            &file.path,
                            NodeAddress {
                                entry: *entry,
                                label: hit.trail.label(),
                                path: hit.trail.hashes,
                            },
                        ),
                        Detail {
                            mismatch: Some(mismatch(hit.migration)),
                            message: note(
                                hit.migration,
                                hit.value,
                                project.build(),
                                hit.table_build,
                                &bin,
                            ),
                            fix,
                        },
                    );
                }
            }
        }
    }

    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        let tables = table::tables();
        /* A repair addresses a node by the hash form, which no table can move. */
        let nothing = BinNames::none();
        let lens = Lens {
            tables,
            names: &nothing,
        };
        let mut applied = Applied::default();

        for ((layer, path), wanted) in group_by_file(problems) {
            let bytes = run.read(&layer, &path)?;
            let mut bin = match read_bin_bytes(&bytes) {
                Ok(bin) => bin,
                Err(message) => {
                    return Err(FixError::Parse {
                        layer,
                        path,
                        message,
                    });
                }
            };

            // `Bin::to_writer` is `todo!()` for an override bin, so writing one
            // would panic rather than fail. The check raises these with no fix.
            if bin.is_override {
                let skipped = wanted.len() as u32;
                applied.skipped += skipped;
                run.skipped(&layer, &path, skipped);
                continue;
            }

            let mut file_applied = 0;
            for (entry, object) in &mut bin.objects {
                let addressed: HashSet<&str> = wanted
                    .iter()
                    .filter(|address| address.entry == *entry)
                    .map(|address| address.path.as_str())
                    .collect();
                if addressed.is_empty() {
                    continue;
                }
                file_applied += repair(
                    object.class_hash,
                    &mut object.properties,
                    &Trail::default(),
                    lens,
                    &addressed,
                    run.kept_names(),
                );
            }

            let file_skipped = wanted.len() as u32 - file_applied;
            applied.applied += file_applied;
            applied.skipped += file_skipped;

            if file_applied == 0 {
                run.skipped(&layer, &path, file_skipped);
                continue;
            }

            let mut out = std::io::Cursor::new(Vec::with_capacity(bytes.len()));
            bin.to_writer(&mut out).map_err(|e| FixError::File {
                layer: layer.clone(),
                path: path.clone(),
                source: e,
            })?;
            run.write(&layer, &path, &out.into_inner(), file_applied, file_skipped)?;
        }

        Ok(applied)
    }
}

/// The path to one node, in the two forms a row and a repair each need.
///
/// `hashes` is what the file itself holds, and a repair matches on it, so it
/// never moves with the hash tables. `named` is the same path for reading.
#[derive(Clone, Default)]
struct Trail {
    hashes: String,
    named: String,
    /// Whether a table named anything `hashes` left as a number.
    resolved: bool,
}

impl Trail {
    /// The label a row draws, or `None` where it would repeat `hashes`.
    fn label(&self) -> Option<String> {
        self.resolved.then(|| self.named.clone())
    }

    fn extend(&self, hashes: &str, named: &str, joiner: &str) -> Self {
        let sep = if self.hashes.is_empty() { "" } else { joiner };
        Self {
            hashes: format!("{}{sep}{hashes}", self.hashes),
            named: format!("{}{sep}{named}", self.named),
            resolved: self.resolved || hashes != named,
        }
    }

    /// Step into a property.
    ///
    /// The hash form takes the migration table's own name where a row carries
    /// one, because that table ships in the build and so reads the same on
    /// every machine. Only the label consults the cache.
    fn property(&self, field: BinHash, row: Option<&Migration>, names: &BinNames) -> Self {
        let hashes = row
            .and_then(|migration| migration.field_name.as_deref())
            .map_or_else(|| names::hex(field), str::to_owned);
        let named = names.field(field).unwrap_or_else(|| hashes.clone());
        self.extend(&hashes, &named, ".")
    }

    /// Step into one element of a container or a present optional.
    fn index(&self, index: usize) -> Self {
        let segment = format!("[{index}]");
        Self {
            hashes: format!("{}{segment}", self.hashes),
            named: format!("{}{segment}", self.named),
            resolved: self.resolved,
        }
    }

    /// Step into one entry of a map, subscripted by its key.
    fn key(&self, key: &PropertyValueEnum, names: &BinNames) -> Self {
        let hashes = format!("{{{}}}", subscript(key));
        let named = format!("{{{}}}", subscript_named(key, names));
        Self {
            hashes: format!("{}{hashes}", self.hashes),
            named: format!("{}{named}", self.named),
            resolved: self.resolved || hashes != named,
        }
    }
}

/// What the walk reads a bin with: the tables it checks and the names it draws.
#[derive(Clone, Copy)]
struct Lens<'a> {
    tables: &'a [MigrationTable],
    names: &'a BinNames,
}

/// One property a table objects to, and the row that objects.
struct Hit<'a> {
    migration: &'a Migration,
    value: &'a PropertyValueEnum,
    /// Where inside the object it sits.
    trail: Trail,
    table_build: GameBuild,
}

/// What the tables say about one property, in one pass over them.
struct Lookup<'a> {
    /// The first row naming this property, which is where its name comes from.
    named: Option<&'a Migration>,
    /// The first row whose `from` the value actually matches.
    hit: Option<(GameBuild, &'a Migration)>,
}

impl<'a> Lookup<'a> {
    /// Ask every table about one property.
    ///
    /// One pass rather than two, because this runs for every property of every
    /// node and a 23MB project holds millions of them.
    fn of(
        tables: &'a [MigrationTable],
        class: BinHash,
        field: BinHash,
        value: &PropertyValueEnum,
    ) -> Self {
        let mut found = Self {
            named: None,
            hit: None,
        };
        for table in tables {
            let Some(migration) = table.migration(class, field) else {
                continue;
            };
            if found.named.is_none() {
                found.named = Some(migration);
            }
            if found.hit.is_none() && migration.from.matches(value) {
                found.hit = Some((table.build(), migration));
            }
        }
        found
    }

    /// Whether any table said anything at all.
    fn is_silent(&self) -> bool {
        self.named.is_none()
    }
}

/// Whether this value can hold an object-like node worth descending into.
///
/// Most properties are leaves no table names, and skipping them here is what
/// keeps a run from building a path string for every value in the project.
fn descends(value: &PropertyValueEnum) -> bool {
    match value {
        PropertyValueEnum::Struct(_) | PropertyValueEnum::Embedded(_) => true,
        PropertyValueEnum::Container(items) => !items.item_kind().is_primitive(),
        PropertyValueEnum::UnorderedContainer(items) => !items.0.item_kind().is_primitive(),
        PropertyValueEnum::Optional(inner) => !inner.item_kind().is_primitive(),
        PropertyValueEnum::Map(map) => !map.value_kind().is_primitive(),
        _ => false,
    }
}

/// Find every property of one object-like node a table objects to.
///
/// Recurses into `Struct` and `Embedded` values, and through the containers and
/// maps that hold them, because each carries a class hash a row can key on.
fn walk<'a>(
    class: BinHash,
    properties: &'a IndexMap<BinHash, PropertyValueEnum>,
    trail: &Trail,
    lens: Lens<'a>,
    found: &mut Vec<Hit<'a>>,
) {
    for (field, value) in properties {
        let lookup = Lookup::of(lens.tables, class, *field, value);
        let descend_into = descends(value);
        if lookup.is_silent() && !descend_into {
            continue;
        }

        let here = trail.property(*field, lookup.named, lens.names);

        if let Some((table_build, migration)) = lookup.hit {
            found.push(Hit {
                migration,
                value,
                trail: here.clone(),
                table_build,
            });
        }

        if descend_into {
            descend(value, &here, lens, found);
        }
    }
}

/// Walk into whatever object-like nodes `value` holds.
fn descend<'a>(
    value: &'a PropertyValueEnum,
    trail: &Trail,
    lens: Lens<'a>,
    found: &mut Vec<Hit<'a>>,
) {
    match value {
        PropertyValueEnum::Struct(inner) => {
            walk(inner.class_hash, &inner.properties, trail, lens, found);
        }
        PropertyValueEnum::Embedded(inner) => {
            walk(inner.0.class_hash, &inner.0.properties, trail, lens, found);
        }
        PropertyValueEnum::Container(items) => descend_container(items, trail, lens, found),
        PropertyValueEnum::UnorderedContainer(items) => {
            descend_container(&items.0, trail, lens, found);
        }
        /* An `Optional` is indexed rather than descended: BIN_EDITOR.md. */
        PropertyValueEnum::Optional(inner) => match inner {
            values::Optional::Struct {
                value: Some(held), ..
            } => walk(
                held.class_hash,
                &held.properties,
                &trail.index(0),
                lens,
                found,
            ),
            values::Optional::Embedded {
                value: Some(held), ..
            } => walk(
                held.0.class_hash,
                &held.0.properties,
                &trail.index(0),
                lens,
                found,
            ),
            _ => {}
        },
        PropertyValueEnum::Map(map) => {
            for (key, held) in map.entries() {
                descend(held, &trail.key(key, lens.names), lens, found);
            }
        }
        _ => {}
    }
}

fn descend_container<'a>(
    items: &'a values::Container,
    trail: &Trail,
    lens: Lens<'a>,
    found: &mut Vec<Hit<'a>>,
) {
    match items {
        values::Container::Struct { items, .. } => {
            for (index, inner) in items.iter().enumerate() {
                walk(
                    inner.class_hash,
                    &inner.properties,
                    &trail.index(index),
                    lens,
                    found,
                );
            }
        }
        values::Container::Embedded { items, .. } => {
            for (index, inner) in items.iter().enumerate() {
                walk(
                    inner.0.class_hash,
                    &inner.0.properties,
                    &trail.index(index),
                    lens,
                    found,
                );
            }
        }
        _ => {}
    }
}

/// Convert every addressed property of one object-like node, and count them.
///
/// Re-derives each change from the value in front of it rather than from what
/// the check recorded, so a property that no longer matches `from` is left
/// alone and counted as skipped.
///
/// It walks with the same [`Trail`] the check used, under a [`BinNames`] that
/// names nothing - only the hash form is compared, and building it through one
/// shared step is what keeps the two passes addressing the same node.
fn repair(
    class: BinHash,
    properties: &mut IndexMap<BinHash, PropertyValueEnum>,
    trail: &Trail,
    lens: Lens<'_>,
    addressed: &HashSet<&str>,
    kept: &mut PreservedNames<'_>,
) -> u32 {
    let mut applied = 0;

    for (field, value) in properties.iter_mut() {
        let lookup = Lookup::of(lens.tables, class, *field, value);
        let descend_into = descends(value);
        if lookup.is_silent() && !descend_into {
            continue;
        }

        let here = trail.property(*field, lookup.named, lens.names);

        if addressed.contains(here.hashes.as_str())
            && let Some((_, migration)) = lookup.hit
            && keep_names(value, migration, kept)
            && convert(value, migration)
        {
            applied += 1;
        }

        if descend_into {
            applied += repair_into(value, &here, lens, addressed, kept);
        }
    }

    applied
}

/// Keep every path this conversion is about to hash away. Reports whether the
/// conversion may go ahead.
///
/// A property is repaired only when every path under it survives the hashing,
/// because a partly-kept container would leave the mod holding a hash no table
/// names. Refusing it leaves the property as it is, which the next check still
/// reports and the badge still calls repairable.
fn keep_names(
    value: &PropertyValueEnum,
    migration: &Migration,
    kept: &mut PreservedNames<'_>,
) -> bool {
    if migration.conversion != Conversion::HashValue {
        return true;
    }
    strings(value)
        .into_iter()
        .all(|path| kept.keep(path) == Preserved::Kept)
}

/// Walk `repair` into whatever object-like nodes `value` holds.
fn repair_into(
    value: &mut PropertyValueEnum,
    trail: &Trail,
    lens: Lens<'_>,
    addressed: &HashSet<&str>,
    kept: &mut PreservedNames<'_>,
) -> u32 {
    match value {
        PropertyValueEnum::Struct(inner) => repair(
            inner.class_hash,
            &mut inner.properties,
            trail,
            lens,
            addressed,
            kept,
        ),
        PropertyValueEnum::Embedded(inner) => repair(
            inner.0.class_hash,
            &mut inner.0.properties,
            trail,
            lens,
            addressed,
            kept,
        ),
        PropertyValueEnum::Container(items) => {
            repair_container(items, trail, lens, addressed, kept)
        }
        PropertyValueEnum::UnorderedContainer(items) => {
            repair_container(&mut items.0, trail, lens, addressed, kept)
        }
        PropertyValueEnum::Optional(inner) => match inner {
            values::Optional::Struct {
                value: Some(held), ..
            } => repair(
                held.class_hash,
                &mut held.properties,
                &trail.index(0),
                lens,
                addressed,
                kept,
            ),
            values::Optional::Embedded {
                value: Some(held), ..
            } => repair(
                held.0.class_hash,
                &mut held.0.properties,
                &trail.index(0),
                lens,
                addressed,
                kept,
            ),
            _ => 0,
        },
        PropertyValueEnum::Map(map) => repair_map(map, trail, lens, addressed, kept),
        _ => 0,
    }
}

/// Walk `repair` into a map's values.
///
/// `Map` hands out its entries by value or by shared reference and never by
/// mutable one, so reaching inside means taking the entries and putting them
/// back. Only a map whose values are not primitive gets here, and repairing a
/// property inside one never changes that value's own kind, so the rebuild
/// cannot be rejected.
fn repair_map(
    map: &mut values::Map,
    trail: &Trail,
    lens: Lens<'_>,
    addressed: &HashSet<&str>,
    kept: &mut PreservedNames<'_>,
) -> u32 {
    let key_kind = map.key_kind();
    let value_kind = map.value_kind();

    let mut entries =
        std::mem::replace(map, values::Map::empty(key_kind, value_kind)).into_entries();
    let mut applied = 0;
    for (key, held) in entries.iter_mut() {
        applied += repair_into(held, &trail.key(key, lens.names), lens, addressed, kept);
    }

    *map = values::Map::new(key_kind, value_kind, entries)
        .expect("repairing a property inside a map value never changes that value's kind");
    applied
}

/// Walk `repair` into the object-like items a container holds.
fn repair_container(
    items: &mut values::Container,
    trail: &Trail,
    lens: Lens<'_>,
    addressed: &HashSet<&str>,
    kept: &mut PreservedNames<'_>,
) -> u32 {
    let mut applied = 0;
    match items {
        values::Container::Struct { items, .. } => {
            for (index, inner) in items.iter_mut().enumerate() {
                applied += repair(
                    inner.class_hash,
                    &mut inner.properties,
                    &trail.index(index),
                    lens,
                    addressed,
                    kept,
                );
            }
        }
        values::Container::Embedded { items, .. } => {
            for (index, inner) in items.iter_mut().enumerate() {
                applied += repair(
                    inner.0.class_hash,
                    &mut inner.0.properties,
                    &trail.index(index),
                    lens,
                    addressed,
                    kept,
                );
            }
        }
        _ => {}
    }
    applied
}

/// Rewrite one property under its new type. Reports whether it changed.
fn convert(value: &mut PropertyValueEnum, migration: &Migration) -> bool {
    match migration.conversion {
        Conversion::HashValue => hash_value(value),
        Conversion::None => retag(value, migration),
        /* A `Hash` is FNV1a32 of a path and a `File` is XXH64 of the same path,
        and there is no arithmetic between them. Naming the hash needs the
        mimir `binhashes` table, which nothing opens yet. */
        Conversion::Rehash | Conversion::HashKey => false,
    }
}

/// Turn every `String` under this property into the `File` of the same path.
///
/// Takes the value out first and puts one back, because a container is an enum
/// over its item type: converting is a construction and not a mutation, and the
/// old value has to be owned to be consumed.
fn hash_value(value: &mut PropertyValueEnum) -> bool {
    let taken = std::mem::replace(value, Kind::None.default_value());
    match hashed(taken) {
        Ok(converted) => {
            *value = converted;
            true
        }
        Err(unchanged) => {
            *value = unchanged;
            false
        }
    }
}

/// The value under its new type, or the value back where it does not apply.
fn hashed(value: PropertyValueEnum) -> Result<PropertyValueEnum, PropertyValueEnum> {
    match value {
        PropertyValueEnum::String(text) => Ok(link(&text.value).into()),
        PropertyValueEnum::Container(items) => {
            hashed_container(items).map(Into::into).map_err(Into::into)
        }
        PropertyValueEnum::UnorderedContainer(items) => match hashed_container(items.0) {
            Ok(items) => Ok(values::UnorderedContainer(items).into()),
            Err(items) => Err(values::UnorderedContainer(items).into()),
        },
        PropertyValueEnum::Optional(values::Optional::String { value: text, meta }) => {
            Ok(values::Optional::WadChunkLink {
                value: text.map(|text| link(&text.value)),
                meta,
            }
            .into())
        }
        PropertyValueEnum::Map(map) => {
            let key_kind = map.key_kind();
            if map.value_kind() != Kind::String {
                return Err(map.into());
            }
            let mut rebuilt = values::Map::empty(key_kind, Kind::WadChunkLink);
            for (key, item) in map.into_entries() {
                let PropertyValueEnum::String(text) = item else {
                    /* `value_kind` already said String, so this cannot happen
                    unless the file disagrees with its own header. */
                    return Err(Kind::None.default_value());
                };
                if rebuilt.push(key, link(&text.value).into()).is_err() {
                    return Err(Kind::None.default_value());
                }
            }
            Ok(rebuilt.into())
        }
        other => Err(other),
    }
}

/// Rebuild a container of `String` as a container of `File`.
fn hashed_container(items: values::Container) -> Result<values::Container, values::Container> {
    let values::Container::String { items: texts, meta } = items else {
        return Err(items);
    };
    Ok(values::Container::WadChunkLink {
        items: texts.iter().map(|text| link(&text.value)).collect(),
        meta,
    })
}

/// Change a type tag or an embedded class hash, moving no value.
///
/// `Embedded` is a newtype over `Struct` in `ltk_meta` with the same encoding,
/// so `Embed → Pointer` is a tag. The other row renames the class of each
/// element of an `UnorderedContainer`.
fn retag(value: &mut PropertyValueEnum, migration: &Migration) -> bool {
    match (migration.from.kind, migration.to.kind) {
        (Kind::Embedded, Kind::Struct) => {
            let taken = std::mem::replace(value, Kind::None.default_value());
            let PropertyValueEnum::Embedded(inner) = taken else {
                *value = taken;
                return false;
            };
            *value = PropertyValueEnum::Struct(inner.0);
            true
        }
        (Kind::Struct, Kind::Embedded) => {
            let taken = std::mem::replace(value, Kind::None.default_value());
            let PropertyValueEnum::Struct(inner) = taken else {
                *value = taken;
                return false;
            };
            *value = values::Embedded(inner).into();
            true
        }
        _ => match migration.to.class {
            Some(class) => reclass(value, class),
            None => false,
        },
    }
}

/// Point every element of a container at a renamed class.
fn reclass(value: &mut PropertyValueEnum, class: BinHash) -> bool {
    let items = match value {
        PropertyValueEnum::Container(items) => items,
        PropertyValueEnum::UnorderedContainer(items) => &mut items.0,
        _ => return false,
    };
    match items {
        values::Container::Embedded { items, .. } => {
            for inner in items.iter_mut() {
                inner.0.class_hash = class;
            }
            true
        }
        values::Container::Struct { items, .. } => {
            for inner in items.iter_mut() {
                inner.class_hash = class;
            }
            true
        }
        _ => false,
    }
}

/// The `File` of a path, which is XXH64 of it lowercased.
fn link(path: &str) -> values::WadChunkLink<NoMeta> {
    values::WadChunkLink::new(WadHash::hash_str(path))
}

/// A map key, as a subscript reads, in the form the file holds.
fn subscript(key: &PropertyValueEnum) -> String {
    match key {
        PropertyValueEnum::String(text) => text.value.clone(),
        PropertyValueEnum::Hash(hash) => names::hex(hash.value),
        PropertyValueEnum::WadChunkLink(hash) => format!("0x{:016x}", hash.value.0),
        PropertyValueEnum::U8(v) => v.value.to_string(),
        PropertyValueEnum::U32(v) => v.value.to_string(),
        PropertyValueEnum::I32(v) => v.value.to_string(),
        other => format!("{:?}", other.kind()),
    }
}

/// The same subscript for reading, with a `Hash` key named where one is known.
///
/// A map key is usually the only thing telling two rows of a big animation
/// graph apart, so naming it is what makes the list readable at all.
fn subscript_named(key: &PropertyValueEnum, names: &BinNames) -> String {
    match key {
        PropertyValueEnum::Hash(hash) => names
            .value(hash.value)
            .unwrap_or_else(|| names::hex(hash.value)),
        other => subscript(other),
    }
}

/// How much this costs the mod, which is a question about the installed game.
///
/// A property the running game reads under the other type crashes it, so on an
/// install that has taken the change this is [`Severity::Fatal`]. A fix applied
/// early breaks the mod the same way round, so an install that has not taken it
/// is a warning about what is coming rather than a crash today.
fn severity(installed: Option<GameBuild>, table: GameBuild) -> Severity {
    match installed {
        Some(installed) if installed >= table => Severity::Fatal,
        /* An install older than the table has not taken the change yet, and an
        install we could not read is not a claim either way. */
        _ => Severity::Warning,
    }
}

/// The type the game reads here, against the one the file declares.
fn mismatch(migration: &Migration) -> TypeMismatch {
    TypeMismatch {
        expected: migration.to.label(),
        found: migration.from.label(),
    }
}

/// What this one property needs said that the rule's description does not.
///
/// The ordinary retype is the whole of what this rule is for, so it says
/// nothing: a sentence repeated on seven thousand rows is noise, and the title
/// and the two types already carry it. What earns a note is a row that is
/// unusual - one nothing can repair, or one the installed game disagrees with.
fn note(
    migration: &Migration,
    value: &PropertyValueEnum,
    installed: Option<GameBuild>,
    table: GameBuild,
    bin: &ltk_meta::Bin,
) -> Option<String> {
    let mut parts = Vec::new();

    /* The sentence prints the hash the file holds, because that hash is the
    whole of what a person needs to go and find the path themselves. */
    match migration.conversion {
        Conversion::Rehash => parts.push(format!(
            "The game reads a chunk hash here and the file holds a name hash. Both hash the same path under a different function, so only the path itself crosses between them, and {} is all the file carries. There is no repair.",
            unnamed(value)
        )),
        Conversion::HashKey => parts.push(format!(
            "The game keys this map by chunk hash now and the file keys it by name hash. Both hash the same path under a different function, so only the path itself crosses between them, and {} is all the file carries. There is no repair.",
            unnamed(value)
        )),
        Conversion::HashValue | Conversion::None => {}
    }

    if bin.is_override {
        parts.push("An override bin cannot be repaired here.".to_owned());
    } else if installed.is_some_and(|installed| installed < table) {
        parts.push("The installed game still wants the old type.".to_owned());
    }

    (!parts.is_empty()).then(|| parts.join(" "))
}

/// The hash a repair would have to name, as a row prints it.
///
/// A `rehash` row holds one, and a `hash_key` row holds one for each entry, so
/// a map names the first and says how many followed.
fn unnamed(value: &PropertyValueEnum) -> String {
    match value {
        PropertyValueEnum::Hash(hash) => names::hex(hash.value),
        PropertyValueEnum::Map(map) => match map.entries() {
            [] => "its keys".to_owned(),
            [(key, _)] => subscript(key),
            [(key, _), rest @ ..] => format!("{} and {} more", subscript(key), rest.len()),
        },
        other => format!("this {}", word_of(other)),
    }
}

/// A value's kind, in the table's vocabulary where it has one.
fn word_of(value: &PropertyValueEnum) -> String {
    kinds::name(value.kind()).map_or_else(|| format!("{:?}", value.kind()), str::to_owned)
}

/// What a repair would change, for a problem that has one.
fn preview(migration: &Migration, value: &PropertyValueEnum) -> Option<FixPreview> {
    match migration.conversion {
        Conversion::Rehash | Conversion::HashKey => None,
        /* Nothing to draw beside the annotation: the type is the whole change. */
        Conversion::None => Some(FixPreview::default()),
        Conversion::HashValue => Some(value_preview(value)),
    }
}

/// The value a panel draws for one property, and what drawing it leaves out.
///
/// A container holds its paths rather than one, and a count of them says
/// nothing about what is in the file - which is the whole of what a reader
/// opened the problem to see. So one path is drawn as the example and the rest
/// becomes the note beside it.
fn value_preview(value: &PropertyValueEnum) -> FixPreview {
    if let PropertyValueEnum::String(text) = value {
        return FixPreview::value(
            quoted(&text.value),
            format!("0x{:016x}", WadHash::hash_str(&text.value).0),
        );
    }

    let held = strings(value);
    let Some(first) = held.first() else {
        /* Structs and embedded objects have no path to draw, so a count is all
        there is to say about them. */
        return FixPreview::note(items(count(value)));
    };

    FixPreview::sample(
        quoted(first),
        (held.len() > 1).then(|| more(held.len() - 1)),
    )
}

/// A path as a row reads it, quoted and escaped the way the file holds it.
fn quoted(path: &str) -> String {
    format!("{path:?}")
}

/// How many values a property holds past the one drawn.
fn more(rest: usize) -> String {
    match rest {
        1 => "and 1 more".to_owned(),
        many => format!("and {many} more"),
    }
}

/// Every path a property holds, in the order the file holds them.
///
/// Empty for a property whose values are not paths at all, such as a container
/// of structs, which a count describes and a sample cannot.
fn strings(value: &PropertyValueEnum) -> Vec<&str> {
    match value {
        PropertyValueEnum::String(text) => vec![text.value.as_str()],
        PropertyValueEnum::Container(items) => container_strings(items),
        PropertyValueEnum::UnorderedContainer(items) => container_strings(&items.0),
        PropertyValueEnum::Optional(values::Optional::String { value: text, .. }) => {
            text.iter().map(|text| text.value.as_str()).collect()
        }
        PropertyValueEnum::Map(map) => map
            .entries()
            .iter()
            .filter_map(|(_, held)| match held {
                PropertyValueEnum::String(text) => Some(text.value.as_str()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn container_strings(items: &values::Container) -> Vec<&str> {
    match items {
        values::Container::String { items, .. } => {
            items.iter().map(|text| text.value.as_str()).collect()
        }
        _ => Vec::new(),
    }
}

/// How many values a repair rewrites, as a row says it.
fn items(count: usize) -> String {
    match count {
        1 => "1 item".to_owned(),
        many => format!("{many} items"),
    }
}

/// How many values a repair would rewrite under one property.
fn count(value: &PropertyValueEnum) -> usize {
    match value {
        PropertyValueEnum::Container(items) => container_len(items),
        PropertyValueEnum::UnorderedContainer(items) => container_len(&items.0),
        PropertyValueEnum::Map(map) => map.entries().len(),
        PropertyValueEnum::Optional(values::Optional::String { value: text, .. }) => {
            usize::from(text.is_some())
        }
        _ => 1,
    }
}

fn container_len(items: &values::Container) -> usize {
    match items {
        values::Container::String { items, .. } => items.len(),
        values::Container::WadChunkLink { items, .. } => items.len(),
        values::Container::Hash { items, .. } => items.len(),
        values::Container::Struct { items, .. } => items.len(),
        values::Container::Embedded { items, .. } => items.len(),
        _ => 0,
    }
}

/// The problems of one fix, grouped so each file is read and written once.
///
/// 312 problems in 14 files is 14 reads and 14 writes, and never 312 of either.
fn group_by_file<'a>(problems: &[&'a Problem]) -> Vec<((String, String), Vec<&'a NodeAddress>)> {
    let mut grouped: HashMap<(String, String), Vec<&NodeAddress>> = HashMap::new();
    for problem in problems {
        let Some(node) = &problem.site.node else {
            continue;
        };
        grouped
            .entry((problem.site.layer.clone(), problem.site.path.clone()))
            .or_default()
            .push(node);
    }

    let mut grouped: Vec<_> = grouped.into_iter().collect();
    grouped.sort_by(|(a, _), (b, _)| a.cmp(b));
    grouped
}

/// Read one property bin off disk.
///
/// # Errors
///
/// Reports the file it could not open or parse, as one sentence for the panel.
fn read_bin(path: &std::path::Path) -> Result<ltk_meta::Bin, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    read_bin_bytes(&bytes)
}

fn read_bin_bytes(bytes: &[u8]) -> Result<ltk_meta::Bin, String> {
    ltk_meta::Bin::from_reader(&mut std::io::Cursor::new(bytes)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
