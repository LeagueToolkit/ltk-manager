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

use crate::problems::budget;
use crate::problems::names::{self, BinNames};
use crate::problems::{
    Applied, Detail, Dormancy, FixError, FixPreview, FixRun, GameBuild, NodeAddress, Preserved,
    PreservedNames, Problem, ProjectFiles, Report, Rule, RuleId, Severity, Site, TypeMismatch,
};

use table::{Conversion, Migration, MigrationTable};

/// The id every row of this rule carries.
pub const ID: RuleId = RuleId("bin/property-type");

/// How much of the budget one bin costs, as a multiple of its size on disk.
///
/// `ltk_meta` reads a bin into typed nodes, which is several times the bytes it
/// came from. Deliberately generous: an estimate that is too high costs the run
/// some concurrency, and one that is too low costs the machine its memory.
const BIN_EXPANSION: u64 = 8;

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

        // Each bin is read, parsed and checked on its own worker, and only
        // the findings come back - a `Hit` borrows the parse that made it, and
        // that parse is what the budget is holding.
        let handles: Vec<_> = project.bins().collect();
        let read = project.budget().map(
            &handles,
            budget::files_at_once(),
            |handle| handle.size_bytes().saturating_mul(BIN_EXPANSION),
            |handle| findings_of(handle, project, lens),
        );

        for (handle, found) in handles.iter().zip(read) {
            let site = || Site::file(handle.layer(), handle.path());
            match found {
                Some(Ok(findings)) => {
                    for finding in findings {
                        report.problem(
                            ID,
                            finding.severity,
                            Site::node(handle.layer(), handle.path(), finding.node),
                            finding.detail,
                        );
                    }
                }
                Some(Err(e)) => report.failure(ID, Some(site()), e),
                /* Cancelled before this file was reached. Saying nothing about
                it is what keeps a partial run from reading as a clean one. */
                None => report.failure(ID, Some(site()), "The check was cancelled"),
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

            let mut addressed: HashMap<BinHash, HashSet<&str>> = HashMap::new();
            for address in &wanted {
                addressed
                    .entry(address.entry)
                    .or_default()
                    .insert(address.path.as_str());
            }

            let file_applied = fix_bin(&mut bin, &addressed, lens, run.kept_names());

            // The mod as it now is, read off the tree in memory. A genuine
            // check rather than arithmetic over what the fix claimed, and it
            // costs a walk rather than a second parse.
            for (entry, hit) in check_bin(&bin, lens) {
                if addressed
                    .get(&entry)
                    .is_some_and(|paths| paths.contains(hit.address.hashes.as_str()))
                {
                    run.left(ID, &layer, &path, entry, hit.address.hashes);
                }
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

/// One step of the path to a node, kept as what it is rather than as text.
///
/// A walk descends far more nodes than it reports - a 25MB project is millions
/// of properties and a handful of hits - so a step costs a hash and a table row
/// on the way down, and becomes a string only where a hit is found.
#[derive(Clone)]
enum Step {
    /// A property, and the row naming it where a table holds one.
    Field(BinHash, Option<&'static Migration>),
    /// One element of a container, or a present optional.
    Index(usize),
    /// One entry of a map, subscripted by its key.
    ///
    /// Written out on the way down rather than on the way out, because a key
    /// borrows the map and a repair holds that map through a `&mut`.
    Key {
        hashes: String,
        named: Option<String>,
    },
}

/// The path to the node a walk is standing on, pushed and popped as it goes.
#[derive(Clone, Default)]
struct Trail(Vec<Step>);

impl Trail {
    /// Step into a property.
    fn field(&mut self, field: BinHash, row: Option<&'static Migration>) {
        self.0.push(Step::Field(field, row));
    }

    /// Step into one element of a container or a present optional.
    fn index(&mut self, index: usize) {
        self.0.push(Step::Index(index));
    }

    /// Step into one entry of a map, subscripted by its key.
    fn key(&mut self, key: &PropertyValueEnum, names: &BinNames) {
        let hashes = format!("{{{}}}", subscript(key));
        let named = format!("{{{}}}", subscript_named(key, names));
        let named = (named != hashes).then_some(named);
        self.0.push(Step::Key { hashes, named });
    }

    fn back(&mut self) {
        self.0.pop();
    }

    /// Write the path out, in the two forms a row and a repair each need.
    ///
    /// The hash form takes the migration table's own name where a row carries
    /// one, because that table ships in the build and so reads the same on
    /// every machine. Only the label consults the cache.
    fn address(&self, names: &BinNames) -> Address {
        let mut hashes = String::new();
        let mut named = String::new();
        let mut resolved = false;

        for step in &self.0 {
            match step {
                Step::Field(field, row) => {
                    if !hashes.is_empty() {
                        hashes.push('.');
                        named.push('.');
                    }
                    let hashed = row
                        .and_then(|migration| migration.field_name.as_deref())
                        .map_or_else(|| names::hex(*field), str::to_owned);
                    let readable = names.field(*field).unwrap_or_else(|| hashed.clone());
                    resolved |= hashed != readable;
                    hashes.push_str(&hashed);
                    named.push_str(&readable);
                }
                Step::Index(index) => {
                    let segment = format!("[{index}]");
                    hashes.push_str(&segment);
                    named.push_str(&segment);
                }
                Step::Key {
                    hashes: raw,
                    named: readable,
                } => {
                    hashes.push_str(raw);
                    named.push_str(readable.as_deref().unwrap_or(raw));
                    resolved |= readable.is_some();
                }
            }
        }

        Address {
            hashes,
            named,
            resolved,
        }
    }

    /// The hash form alone, for a repair matching against what a check recorded.
    ///
    /// A repair addresses a node by the hash form, which no table can move, so
    /// it never pays for the readable one.
    fn hashes(&self) -> String {
        self.address(&BinNames::none()).hashes
    }
}

/// One finding of one bin, owned so it can outlive the parse that found it.
struct Finding {
    node: NodeAddress,
    severity: Severity,
    detail: Detail,
}

/// Read one bin and report everything the tables object to in it.
fn findings_of(
    handle: &crate::problems::BinHandle<'_>,
    project: &ProjectFiles,
    lens: Lens<'_>,
) -> Result<Vec<Finding>, String> {
    let started = std::time::Instant::now();
    let bin = handle.read()?;
    let parsed = started.elapsed();

    let found = check_bin(&bin, lens)
        .into_iter()
        .map(|(entry, hit)| Finding {
            node: NodeAddress {
                entry,
                label: hit.address.label(),
                path: hit.address.hashes,
            },
            severity: severity(project.build(), hit.table_build),
            detail: Detail {
                mismatch: Some(mismatch(hit.migration)),
                message: note(
                    hit.migration,
                    hit.value,
                    project.build(),
                    hit.table_build,
                    &bin,
                ),
                fix: (!bin.is_override)
                    .then(|| preview(hit.migration, hit.value))
                    .flatten(),
            },
        })
        .collect::<Vec<_>>();

    tracing::trace!(
        "{}/{}: {} bytes parsed in {parsed:?}, {} findings in {:?}",
        handle.layer(),
        handle.path(),
        handle.size_bytes(),
        found.len(),
        started.elapsed() - parsed
    );
    Ok(found)
}

/// The path to one node, written out.
///
/// `hashes` is what the file itself holds, and a repair matches on it, so it
/// never moves with the hash tables. `named` is the same path for reading.
struct Address {
    hashes: String,
    named: String,
    /// Whether a table named anything `hashes` left as a number.
    resolved: bool,
}

impl Address {
    /// The label a row draws, or `None` where it would repeat `hashes`.
    fn label(&self) -> Option<String> {
        self.resolved.then(|| self.named.clone())
    }
}

/// What the walk reads a bin with: the tables it checks and the names it draws.
#[derive(Clone, Copy)]
struct Lens<'a> {
    tables: &'static [MigrationTable],
    names: &'a BinNames,
}

/// One property a table objects to, and the row that objects.
struct Hit<'a> {
    migration: &'static Migration,
    value: &'a PropertyValueEnum,
    /// Where inside the object it sits.
    address: Address,
    table_build: GameBuild,
}

/// What the tables say about one property, in one pass over them.
struct Lookup {
    /// The first row naming this property, which is where its name comes from.
    named: Option<&'static Migration>,
    /// The first row whose `from` the value actually matches.
    hit: Option<(GameBuild, &'static Migration)>,
}

impl Lookup {
    /// Ask every table about one property.
    ///
    /// One pass rather than two, because this runs for every property of every
    /// node and a 23MB project holds millions of them.
    fn of(
        tables: &'static [MigrationTable],
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
/// keeps a run from descending every value in the project.
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

/// Every property of one bin a table objects to.
///
/// The check and the repair's own verification are the same call, so a bin
/// repaired and then re-read is a tree walk rather than a second parse.
fn check_bin<'a>(bin: &'a ltk_meta::Bin, lens: Lens<'_>) -> Vec<(BinHash, Hit<'a>)> {
    let mut found = Vec::new();
    for (entry, object) in &bin.objects {
        let mut here = Vec::new();
        walk(
            object.class_hash,
            &object.properties,
            &mut Trail::default(),
            lens,
            &mut here,
        );
        found.extend(here.into_iter().map(|hit| (*entry, hit)));
    }
    found
}

/// Find every property of one object-like node a table objects to.
///
/// Recurses into `Struct` and `Embedded` values, and through the containers and
/// maps that hold them, because each carries a class hash a row can key on.
fn walk<'a>(
    class: BinHash,
    properties: &'a IndexMap<BinHash, PropertyValueEnum>,
    trail: &mut Trail,
    lens: Lens<'_>,
    found: &mut Vec<Hit<'a>>,
) {
    for (field, value) in properties {
        let lookup = Lookup::of(lens.tables, class, *field, value);
        let descend_into = descends(value);
        if lookup.is_silent() && !descend_into {
            continue;
        }

        trail.field(*field, lookup.named);

        if let Some((table_build, migration)) = lookup.hit {
            found.push(Hit {
                migration,
                value,
                address: trail.address(lens.names),
                table_build,
            });
        }

        if descend_into {
            descend(value, trail, lens, found);
        }

        trail.back();
    }
}

/// Walk into whatever object-like nodes `value` holds.
fn descend<'a>(
    value: &'a PropertyValueEnum,
    trail: &mut Trail,
    lens: Lens<'_>,
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
        PropertyValueEnum::Optional(inner) => {
            let held = match inner {
                values::Optional::Struct {
                    value: Some(held), ..
                } => Some((held.class_hash, &held.properties)),
                values::Optional::Embedded {
                    value: Some(held), ..
                } => Some((held.0.class_hash, &held.0.properties)),
                _ => None,
            };
            if let Some((class, properties)) = held {
                trail.index(0);
                walk(class, properties, trail, lens, found);
                trail.back();
            }
        }
        PropertyValueEnum::Map(map) => {
            for (key, held) in map.entries() {
                trail.key(key, lens.names);
                descend(held, trail, lens, found);
                trail.back();
            }
        }
        _ => {}
    }
}

fn descend_container<'a>(
    items: &'a values::Container,
    trail: &mut Trail,
    lens: Lens<'_>,
    found: &mut Vec<Hit<'a>>,
) {
    // Two loops rather than one over a collected list: this runs for every
    // container node of every bin, and the list would be an allocation each.
    match items {
        values::Container::Struct { items, .. } => {
            for (index, inner) in items.iter().enumerate() {
                trail.index(index);
                walk(inner.class_hash, &inner.properties, trail, lens, found);
                trail.back();
            }
        }
        values::Container::Embedded { items, .. } => {
            for (index, inner) in items.iter().enumerate() {
                trail.index(index);
                walk(inner.0.class_hash, &inner.0.properties, trail, lens, found);
                trail.back();
            }
        }
        _ => {}
    }
}

/// Convert every addressed property of one bin, and count them.
///
/// Re-derives each change from the value in front of it rather than from what
/// the check recorded, so a property that no longer matches `from` is left
/// alone and counted as skipped.
///
/// It walks with the same [`Trail`] the check used - only the hash form is
/// compared, and building it through one shared step is what keeps the two
/// passes addressing the same node.
fn fix_bin(
    bin: &mut ltk_meta::Bin,
    addressed: &HashMap<BinHash, HashSet<&str>>,
    lens: Lens<'_>,
    kept: &mut PreservedNames<'_>,
) -> u32 {
    let mut applied = 0;
    for (entry, object) in &mut bin.objects {
        let Some(addressed) = addressed.get(entry) else {
            continue;
        };
        applied += repair(
            object.class_hash,
            &mut object.properties,
            &mut Trail::default(),
            lens,
            addressed,
            kept,
        );
    }
    applied
}

fn repair(
    class: BinHash,
    properties: &mut IndexMap<BinHash, PropertyValueEnum>,
    trail: &mut Trail,
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

        trail.field(*field, lookup.named);

        if let Some((_, migration)) = lookup.hit
            && addressed.contains(trail.hashes().as_str())
            && keep_names(value, migration, kept)
            && convert(value, migration)
        {
            applied += 1;
        }

        if descend_into {
            applied += repair_into(value, trail, lens, addressed, kept);
        }

        trail.back();
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
    trail: &mut Trail,
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
        PropertyValueEnum::Optional(inner) => {
            let held = match inner {
                values::Optional::Struct {
                    value: Some(held), ..
                } => Some((held.class_hash, &mut held.properties)),
                values::Optional::Embedded {
                    value: Some(held), ..
                } => Some((held.0.class_hash, &mut held.0.properties)),
                _ => None,
            };
            match held {
                Some((class, properties)) => {
                    trail.index(0);
                    let applied = repair(class, properties, trail, lens, addressed, kept);
                    trail.back();
                    applied
                }
                None => 0,
            }
        }
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
    trail: &mut Trail,
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
        trail.key(key, lens.names);
        applied += repair_into(held, trail, lens, addressed, kept);
        trail.back();
    }

    *map = values::Map::new(key_kind, value_kind, entries)
        .expect("repairing a property inside a map value never changes that value's kind");
    applied
}

/// Walk `repair` into the object-like items a container holds.
fn repair_container(
    items: &mut values::Container,
    trail: &mut Trail,
    lens: Lens<'_>,
    addressed: &HashSet<&str>,
    kept: &mut PreservedNames<'_>,
) -> u32 {
    let mut applied = 0;
    match items {
        values::Container::Struct { items, .. } => {
            for (index, inner) in items.iter_mut().enumerate() {
                trail.index(index);
                applied += repair(
                    inner.class_hash,
                    &mut inner.properties,
                    trail,
                    lens,
                    addressed,
                    kept,
                );
                trail.back();
            }
        }
        values::Container::Embedded { items, .. } => {
            for (index, inner) in items.iter_mut().enumerate() {
                trail.index(index);
                applied += repair(
                    inner.0.class_hash,
                    &mut inner.0.properties,
                    trail,
                    lens,
                    addressed,
                    kept,
                );
                trail.back();
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
/// The check goes through [`BinHandle::read`] instead. This is for a test that
/// holds a path, and for the fix, which reads through the run.
///
/// # Errors
///
/// Reports the file it could not open or parse, as one sentence for the panel.
#[cfg(test)]
fn read_bin(path: &std::path::Path) -> Result<ltk_meta::Bin, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    read_bin_bytes(&bytes)
}

fn read_bin_bytes(bytes: &[u8]) -> Result<ltk_meta::Bin, String> {
    ltk_meta::Bin::from_reader(&mut std::io::Cursor::new(bytes)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
