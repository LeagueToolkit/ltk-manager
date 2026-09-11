//! `bin/property-type` - a property whose declared type the game has changed.
//!
//! A property bin holds typed values. A `String` is a length and its bytes. A
//! `File` is a `u64`, the XXH64 of the lowercased path, and it is how the game
//! addresses a WAD chunk without carrying the path. Riot changed several
//! hundred properties from the first to the second, and a mod that ships the
//! old type is a mod the game rejects. The value is not wrong. Its type is.
//!
//! Two sources answer, and they answer different questions - `Lens::objection`
//! holds which one wins where. For each object the rule looks up the class hash, and
//! for each property it holds it looks up the field hash. What counts as a
//! mismatch then depends on which source answered.
//!
//! A table names both the type a property had and the type it has now:
//!
//! | The property's kind | The rule                                         |
//! | ------------------- | ------------------------------------------------ |
//! | Matches `from`      | Raises a problem                                 |
//! | Matches `to`        | Raises nothing. The file is fixed already        |
//! | Matches neither     | Raises nothing, and the file keeps what it holds |
//! | Absent              | Raises nothing. A bin declares what it declares  |
//!
//! Those four rows are what keep a run against a table idempotent, so a fix run
//! can be offered twice without doubling anything.
//!
//! The schema names only what a property should be, so it has no `from` side to
//! miss and raises whatever the old type was. The `from` side of such a finding
//! is read back off the value in `derived`, and a pair with no conversion
//! between them reports without offering a repair.
//!
//! A property whose old value is already a hash - a `Hash`, which is FNV1a32
//! of a path - has no arithmetic road to the XXH64 the game wants, so its
//! repair goes through the path: `binhashes` and the game hashtables, mimir's
//! and the mod's own, resolve the hash back to its path, and the path is
//! rehashed under the new function. A hash no table resolves is the one
//! finding this rule cannot repair.
//!
//! Several roads move no value at all. An integer crosses to any type that
//! holds every number it could hold, so `U8` reaches `U64` and nothing reaches
//! a type that would drop a bit. An option holding nothing is re-declared under
//! the item type the game reads, whatever the two item types are, because there
//! is no value under it to cross.
//!
//! And three pairs are one encoding under two tags, so either of each becomes
//! the other: `Embed` and `Pointer`, `List` and `List2`, `Bool` and `Flag`. The
//! first is exact only for the class the field itself names, because a
//! `Pointer` also holds a class derived from it and an `Embed` does not, and
//! the schema names no class to check against.
//!
//! A type has halves that move independently, and Riot moves both at once. A
//! list's ordering tag and its item type are one such pair, and a map's keys
//! and its values are another, so two roads take both halves in turn. Either
//! the whole property crosses or none of it does: a value left between the two
//! types declares neither, which is worse than the type it had.
//!
//! The check is a visitor over `ltk_meta::walk`, riding the pass's one walk of
//! each bin. Every node carries a class hash of its own, and two rows of the
//! table key on one.

pub mod kinds;
pub mod table;

#[cfg(test)]
use fs_err as fs;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use indexmap::IndexMap;
use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::PropertyValueEnum;
use ltk_meta::property::{Kind, NoMeta, ValueMut, values};
use ltk_meta::walk::{Node, TreeValue as _, Visit, Visitor};

use crate::bin_document::{PropertyKind, hex, owned};
use crate::meta_schema::{self, MetaSchema};
use crate::problems::names::BinNames;
use crate::problems::walk::{self, Address, Declared, FieldNames};
use crate::problems::{
    Applied, BinVisitor, Detail, Dormancy, FixError, FixPreview, FixRun, GameBuild, NodeAddress,
    Pass, Preserved, PreservedNames, Problem, ProjectFiles, Rule, RuleId, Severity, Sink,
    TypeMismatch, Walk,
};

use table::{Conversion, Migration, MigrationTable, TypeSpec};

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
        "A meta property at a type the game no longer reads, so its value is dropped"
    }

    fn unfixable_description(&self) -> &'static str {
        "Couldn't rehash because the original path is unknown"
    }

    /// The one rule whose findings answer for themselves - see [`severity`].
    ///
    /// What a mismatch costs is a question about the install, so two machines
    /// reading one mod are entitled to two answers and neither is this build's
    /// to give.
    fn severity(&self) -> Option<Severity> {
        None
    }

    /// The oldest table this project's game has not reached, in a modder's words.
    ///
    /// A table is a claim about one build. Until the game is on that build the
    /// change has not happened, so the findings are about work that is coming
    /// rather than a mod that is broken - which is what [`Severity::Warning`]
    /// already says of each of them, and what the panel mutes them for.
    ///
    /// The sentence names the patches rather than the builds both sides compare
    /// on, because a patch is the number a modder reads in Riot's notes.
    fn dormant(&self, project: &ProjectFiles) -> Option<Dormancy> {
        let installed = project.build()?;
        let patch = table::tables()
            .iter()
            .find(|table| table.build() > installed)?
            .build()
            .patch();

        Some(Dormancy::new(
            format!("Patch {patch}"),
            format!(
                "Riot changes how these values are stored in patch {patch}, and your game is on {}, so repairing now breaks the mod on the patch you play.",
                installed.patch()
            ),
        ))
    }

    fn subscribe(&self, pass: &mut Pass<'_>) {
        let project = pass.project();
        let tables = table::tables();
        let judge = Judge::opened(project.build());
        if tables.is_empty() && judge.lens().is_none() {
            return;
        }
        pass.bins().visit(TypeCheck {
            tables,
            judge,
            names: project.names(),
            build: project.build(),
        });
    }

    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError> {
        let tables = table::tables();
        /* A repair addresses a node by the hash form, which no table can move.
        The names ride along for one thing only: the rehashing conversions
        rewrite a value from the path behind its hash, and this is where that
        path comes from. */
        let names = run.names();
        /* The repair derives its changes again rather than replaying the check,
        so it has to judge against the same build the check did. */
        let judge = Judge::opened(GameBuild::installed(run.config()));
        let lens = Lens {
            tables,
            schema: judge.lens(),
            names: &names,
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
                    .is_some_and(|paths| paths.contains(hit.address.hashes()))
                {
                    run.left(ID, &layer, &path, entry, hit.address.into_hashes());
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

/// One step of the repair's path to a node, kept as what it is rather than as
/// text.
///
/// The check's trail is the walk's own. The repair walks mutably and keeps this
/// one, rendered through the same [`Address`] as the check's, which is what
/// keeps the two addressing the same node.
#[derive(Clone)]
enum Step {
    /// A property of the node.
    Field(BinHash),
    /// One element of a container, or a present optional.
    Index(usize),
    /// One entry of a map, subscripted by a copy of its key.
    ///
    /// Copied on the way down rather than borrowed, because a repair holds the
    /// map through a `&mut`.
    Key(PropertyValueEnum),
}

/// The path to the node a repair is standing on, pushed and popped as it goes.
#[derive(Clone, Default)]
struct Trail(Vec<Step>);

impl Trail {
    /// Step into a property.
    fn field(&mut self, field: BinHash) {
        self.0.push(Step::Field(field));
    }

    /// Step into one element of a container or a present optional.
    fn index(&mut self, index: usize) {
        self.0.push(Step::Index(index));
    }

    /// Step into one entry of a map, subscripted by its key.
    fn key(&mut self, key: &PropertyValueEnum) {
        self.0.push(Step::Key(key.clone()));
    }

    fn back(&mut self) {
        self.0.pop();
    }

    /// The hash form, for a repair matching against what a check recorded.
    ///
    /// A repair addresses a node by the hash form, which no table can move, so
    /// nothing is named.
    fn hashes(&self) -> String {
        let mut address = Address::default();
        for step in &self.0 {
            match step {
                /* Nothing is named, so no class is asked with. 0 is the unknown
                class (W15). */
                Step::Field(field) => address.push_field(*field, BinHash(0), &()),
                Step::Index(index) => address.push_index(*index),
                Step::Key(key) => address.push_key(key, &()),
            }
        }
        address.into_hashes()
    }
}

/// The check as the pass runs it: what every bin is read with.
struct TypeCheck<'p> {
    tables: &'static [MigrationTable],
    judge: Judge,
    names: &'p BinNames,
    build: Option<GameBuild>,
}

impl BinVisitor for TypeCheck<'_> {
    fn begin<'r, 'f: 'r>(&'r self, sink: Sink<'f>) -> Box<dyn Walk<'f> + 'r> {
        Box::new(Reporting {
            check: Check::new(Lens {
                tables: self.tables,
                schema: self.judge.lens(),
                names: self.names,
            }),
            build: self.build,
            sink,
        })
    }
}

/// One bin's [`Check`], wording each hit as a finding as it lands.
struct Reporting<'l, 'f> {
    check: Check<'l>,
    build: Option<GameBuild>,
    sink: Sink<'f>,
}

impl<'a, V: Declared<'a>> Visitor<'a, V> for Reporting<'_, '_> {
    type Error = ltk_meta::Error;

    fn enter_property(
        &mut self,
        field: BinHash,
        value: V,
        node: &Node<'_, 'a, V>,
    ) -> Result<Visit, ltk_meta::Error> {
        let visit = self.check.enter_property(field, value, node)?;
        let names = self.check.lens.names;
        for (entry, hit) in self.check.found.drain(..) {
            self.sink.problem(
                severity(self.build, hit.table_build),
                Some(NodeAddress {
                    entry,
                    label: hit.address.label(),
                    path: hit.address.into_hashes(),
                }),
                Detail {
                    mismatch: Some(mismatch(&hit.migration)),
                    message: note(
                        &hit.migration,
                        &hit.value,
                        names,
                        self.build,
                        hit.table_build,
                    ),
                    fix: preview(&hit.migration, &hit.value, names),
                },
            );
        }
        Ok(visit)
    }
}

impl<'f> Walk<'f> for Reporting<'_, 'f> {
    fn end(self: Box<Self>) -> Sink<'f> {
        self.sink
    }
}

/// What the walk reads a bin with: what it checks against, and the names it
/// draws.
///
/// Two sources answering different questions - see [`Lens::objection`].
#[derive(Clone, Copy)]
struct Lens<'a> {
    tables: &'static [MigrationTable],
    /// Absent without an install to judge against.
    schema: Option<(&'a MetaSchema, GameBuild)>,
    names: &'a BinNames,
}

/// One property that is not the type it should be, and what says so.
struct Hit {
    /// Borrowed for a table row, owned for one derived from the schema, which
    /// names a type rather than a migration.
    migration: Cow<'static, Migration>,
    /// The value, read out of the tree once for the finding's wording.
    value: PropertyValueEnum,
    /// Where inside the object it sits.
    address: Address,
    /// The build the objection is a claim about.
    ///
    /// The installed build from the schema, so the finding is live. A future
    /// build from a table row, which mutes it until the game gets there.
    table_build: GameBuild,
}

/// The objection to one property, and the build it is a claim about.
struct Objection {
    migration: Cow<'static, Migration>,
    /// The installed build from the schema, so the finding is live. A future
    /// build from a table row, which mutes it until the game gets there.
    build: GameBuild,
}

impl Lens<'_> {
    /// Ask the schema and every table about one property.
    ///
    /// One pass, because this runs for every property of every node and a 23MB
    /// project holds millions.
    ///
    /// **The two answer different questions.** The database decides the
    /// installed build outright. A table says what a later build will expect,
    /// which survives the database being content about today.
    ///
    /// Where the database cannot answer, the tables cover the whole question. A
    /// revision names the builds it was dumped at, so a build between two dumps
    /// is silence rather than a property that is fine.
    ///
    /// # Errors
    ///
    /// Over a view, a header that does not decode. The owned tree never fails.
    fn objection<'a>(
        self,
        class: BinHash,
        field: BinHash,
        value: impl Declared<'a>,
    ) -> Result<Option<Objection>, ltk_meta::Error> {
        let mut answered = None;
        if let Some((schema, build)) = self.schema
            && let Some(expected) = schema.expected(class, field, build)
            && let Some(shape) = expected.shape
        {
            answered = Some(build);
            if !TypeSpec::from(shape).matches(value)? {
                return Ok(Some(Objection {
                    migration: Cow::Owned(derived(class, field, expected, value)),
                    build,
                }));
            }
        }

        for table in self.tables {
            /* A row about the build the database answered for, or an older
            one, is one it has already superseded. */
            if answered.is_some_and(|installed| table.build() <= installed) {
                continue;
            }
            let Some(migration) = table.migration(class, field) else {
                continue;
            };
            if migration.from.matches(value)? {
                return Ok(Some(Objection {
                    migration: Cow::Borrowed(migration),
                    build: table.build(),
                }));
            }
        }
        Ok(None)
    }

    /// The field's name, from whichever of the rule's own sources holds one.
    fn field_name(&self, class: BinHash, field: BinHash) -> Option<&str> {
        if let Some((schema, build)) = self.schema
            && let Some(name) = schema
                .expected(class, field, build)
                .and_then(|expected| expected.field_name)
        {
            return Some(name);
        }
        self.tables
            .iter()
            .find_map(|table| table.migration(class, field)?.field_name.as_deref())
    }
}

/// The mod's and mimir's tables first, and the rule's own second, which ship
/// with the build.
impl FieldNames for Lens<'_> {
    fn field(&self, field: BinHash, class: Option<BinHash>) -> Option<Cow<'_, str>> {
        if let Some(name) = BinNames::field(self.names, field) {
            return Some(Cow::Owned(name));
        }
        self.field_name(class?, field).map(Cow::Borrowed)
    }

    fn hash(&self, hash: BinHash) -> Option<Cow<'_, str>> {
        self.names.value(hash).map(Cow::Owned)
    }
}

/// The database a run judges by, held open for as long as the run reads it.
///
/// One share for the whole walk, so a sync mid-sweep replaces what the *next*
/// run opens rather than one partway through.
struct Judge {
    schema: Arc<MetaSchema>,
    build: Option<GameBuild>,
}

impl Judge {
    /// Open the database to judge an install by.
    fn opened(build: Option<GameBuild>) -> Self {
        Self {
            schema: meta_schema::shared(build),
            build,
        }
    }

    /// The schema to judge by, and the build to judge at.
    ///
    /// `None` without an install, since a revision is keyed on a build, and
    /// `None` past what the database reaches, which would judge against a
    /// change it has not taken yet.
    fn lens(&self) -> Option<(&MetaSchema, GameBuild)> {
        let build = self.build?;
        self.schema
            .describes(build)
            .then_some((self.schema.as_ref(), build))
    }
}

/// The row the schema's answer amounts to, for a value that is not that type.
///
/// The `from` side is read off the value, since the schema names only the type
/// a property should be.
fn derived<'a>(
    class: BinHash,
    field: BinHash,
    expected: meta_schema::Expected<'_>,
    value: impl Declared<'a>,
) -> Migration {
    let to = TypeSpec::from(
        expected
            .shape
            .expect("a mismatch needs a type to disagree with"),
    );
    let from = TypeSpec::of(value);
    let conversion = match Conversion::between(&from, &to) {
        Conversion::Unknown if retags_an_empty_option(&to, value) => Conversion::EmptyOption,
        crossed => crossed,
    };
    Migration {
        class,
        field,
        class_name: expected.class_name.map(str::to_owned),
        field_name: expected.field_name.map(str::to_owned),
        conversion,
        from,
        to,
    }
}

/// Whether the whole of this repair is the item type an empty option declares.
///
/// A question about the value and not about the pair, which is why it is asked
/// here rather than in [`Conversion::between`]: two item types with no road
/// between them still cross when there is no value under them to carry. The new
/// item type has to be named for there to be anything to write.
fn retags_an_empty_option<'a>(to: &TypeSpec, value: impl Declared<'a>) -> bool {
    to.kind == Kind::Optional && to.value.is_some() && value.is_empty_option()
}

/// Every property of one bin a table objects to.
///
/// The check and the repair's own verification are the same call, so a bin
/// repaired and then re-read is a tree walk rather than a second parse.
fn check_bin(bin: &ltk_meta::BinFile, lens: Lens<'_>) -> Vec<(BinHash, Hit)> {
    let mut check = Check::new(lens);
    owned(walk::bin(bin, &mut check));
    check.found
}

/// The check as a visitor: every property a table objects to, and where it
/// sits, over either tree.
struct Check<'l> {
    lens: Lens<'l>,
    found: Vec<(BinHash, Hit)>,
}

impl<'l> Check<'l> {
    fn new(lens: Lens<'l>) -> Self {
        Self {
            lens,
            found: Vec::new(),
        }
    }
}

impl<'a, V: Declared<'a>> Visitor<'a, V> for Check<'_> {
    type Error = ltk_meta::Error;

    /// Asked for every property of every node, so what it does per call is
    /// what the whole run costs. The value is read out of the tree for a hit
    /// and for nothing else.
    fn enter_property(
        &mut self,
        field: BinHash,
        value: V,
        node: &Node<'_, 'a, V>,
    ) -> Result<Visit, ltk_meta::Error> {
        let class = node.class_hash();
        if let Some(objection) = self.lens.objection(class, field, value)? {
            let hit = Hit {
                migration: objection.migration,
                value: value.to_value()?,
                address: Address::of(node.trail(), field, class, &self.lens),
                table_build: objection.build,
            };
            self.found.push((node.object_hash(), hit));
        }
        Ok(Visit::Continue)
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
    bin: &mut ltk_meta::BinFile,
    addressed: &HashMap<BinHash, HashSet<&str>>,
    lens: Lens<'_>,
    kept: &mut PreservedNames<'_>,
) -> u32 {
    let mut applied = 0;
    for (entry, object) in bin.objects_mut() {
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
        let objection = owned(lens.objection(class, *field, &*value));
        let holds_node = owned((&*value).holds_node());
        if objection.is_none() && !holds_node {
            continue;
        }

        trail.field(*field);

        if let Some(objection) = objection
            && addressed.contains(trail.hashes().as_str())
            && keep_names(value, &objection.migration, lens.names, kept)
            && convert(value, &objection.migration, lens.names)
        {
            applied += 1;
        }

        if holds_node {
            applied += repair_into(value.as_mut(), trail, lens, addressed, kept);
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
    names: &BinNames,
    kept: &mut PreservedNames<'_>,
) -> bool {
    match migration.conversion {
        Conversion::HashValue | Conversion::RetagHashValue => keeps(strings(value), kept),
        /* The paths a rehash writes from came out of a table, and keeping them
        under the new hash is what lets a reader name the `File` it left. */
        Conversion::Rehash | Conversion::HashKey => resolved_paths(value, migration, names)
            .is_some_and(|paths| keeps(paths.iter().map(String::as_str), kept)),
        /* Both halves of the map, since a key or a value losing its path leaves
        the mod holding a hash it can no longer name. */
        Conversion::HashKeyValue => {
            resolved_paths(value, migration, names)
                .is_some_and(|paths| keeps(paths.iter().map(String::as_str), kept))
                && keeps(strings(value), kept)
        }
        Conversion::None
        | Conversion::NullPointer
        | Conversion::Widen
        | Conversion::EmptyOption => true,
        /* Nothing is written, so there is no path to keep. */
        Conversion::Unknown => false,
    }
}

/// Keep every one of `paths`. Reports whether all of them survived.
fn keeps<'p>(paths: impl IntoIterator<Item = &'p str>, kept: &mut PreservedNames<'_>) -> bool {
    paths
        .into_iter()
        .all(|path| kept.keep(path) == Preserved::Kept)
}

/// Walk `repair` into whatever object-like nodes `value` holds.
///
/// Takes the borrow that cannot change a value's kind, because a container, an
/// option and a map each declare their item kind once and hand out no other.
/// A repair only ever edits properties further down, so that is all it needs.
fn repair_into(
    value: ValueMut<'_>,
    trail: &mut Trail,
    lens: Lens<'_>,
    addressed: &HashSet<&str>,
    kept: &mut PreservedNames<'_>,
) -> u32 {
    match value {
        ValueMut::Struct(inner) => repair(
            inner.class_hash,
            &mut inner.properties,
            trail,
            lens,
            addressed,
            kept,
        ),
        ValueMut::Embedded(inner) => repair(
            inner.0.class_hash,
            &mut inner.0.properties,
            trail,
            lens,
            addressed,
            kept,
        ),
        ValueMut::Container(items) => repair_container(items, trail, lens, addressed, kept),
        ValueMut::UnorderedContainer(items) => {
            repair_container(&mut items.0, trail, lens, addressed, kept)
        }
        ValueMut::Optional(inner) => match inner.slot() {
            Some(mut slot) => {
                trail.index(0);
                let applied = repair_into(slot.as_mut(), trail, lens, addressed, kept);
                trail.back();
                applied
            }
            None => 0,
        },
        ValueMut::Map(map) => repair_map(map, trail, lens, addressed, kept),
        _ => 0,
    }
}

/// Walk `repair` into a map's values.
///
/// The key is written into the trail before the slot is taken, because a map
/// lends its keys and its values apart and never both at once.
fn repair_map(
    map: &mut values::Map,
    trail: &mut Trail,
    lens: Lens<'_>,
    addressed: &HashSet<&str>,
    kept: &mut PreservedNames<'_>,
) -> u32 {
    let mut applied = 0;
    for index in 0..map.entries().len() {
        trail.key(&map.entries()[index].0);
        if let Some(mut slot) = map.slot(index) {
            applied += repair_into(slot.as_mut(), trail, lens, addressed, kept);
        }
        trail.back();
    }
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
    for index in 0..items.len() {
        let Some(mut slot) = items.slot(index) else {
            continue;
        };
        trail.index(index);
        applied += repair_into(slot.as_mut(), trail, lens, addressed, kept);
        trail.back();
    }
    applied
}

/// Rewrite one property under its new type. Reports whether it changed.
///
/// A `Hash` is FNV1a32 of a path and a `File` is XXH64 of the same path, and
/// there is no arithmetic between them - only the path crosses. So the two
/// rehashing conversions look the path up in `names` first, and a hash no
/// table names leaves the property as it is.
fn convert(value: &mut PropertyValueEnum, migration: &Migration, names: &BinNames) -> bool {
    match migration.conversion {
        Conversion::HashValue => hash_value(value),
        Conversion::None => retag(value, migration),
        Conversion::Rehash => rehash(value, names),
        Conversion::HashKey => rehash_keys(value, names),
        Conversion::NullPointer => null_pointers(value),
        Conversion::Widen => widen(value, &migration.to),
        Conversion::EmptyOption => retag_option(value, migration.to.value),
        Conversion::RetagHashValue => {
            crossing(value, |held| hash_value(held) && retag(held, migration))
        }
        Conversion::HashKeyValue => {
            crossing(value, |held| rehash_keys(held, names) && hash_value(held))
        }
        /* No road from what it holds to what it should be. */
        Conversion::Unknown => false,
    }
}

/// Take a road of two steps, or leave the value as it was. Reports whether it
/// changed.
///
/// Both steps or neither: a property left halfway across declares a type that
/// is neither the one it had nor the one the game reads, which is worse than
/// the one it had. The copy is what makes that cheap to abandon, and a repair
/// pays it only for a property it is already rewriting.
fn crossing(
    value: &mut PropertyValueEnum,
    steps: impl FnOnce(&mut PropertyValueEnum) -> bool,
) -> bool {
    let mut held = value.clone();
    if !steps(&mut held) {
        return false;
    }
    *value = held;
    true
}

/// Rewrite a `Hash` as the `File` of the path behind it. Reports whether it
/// changed, which needs a table naming the hash.
fn rehash(value: &mut PropertyValueEnum, names: &BinNames) -> bool {
    let PropertyValueEnum::Hash(hash) = value else {
        return false;
    };
    let Some(path) = names.path_value(hash.value) else {
        return false;
    };
    *value = link(&path).into();
    true
}

/// Rebuild a map keyed by `Hash` under `File` keys, values untouched.
///
/// All or nothing, the way [`resolved_paths`] promises: one unnamed key
/// leaves the whole map as it is, because a map read under two hash functions
/// is broken in a way the old one is not.
fn rehash_keys(value: &mut PropertyValueEnum, names: &BinNames) -> bool {
    let PropertyValueEnum::Map(map) = value else {
        return false;
    };
    if map.key_kind() != Kind::Hash {
        return false;
    }
    let Some(paths) = map
        .entries()
        .iter()
        .map(|(key, _)| key_path(key, names))
        .collect::<Option<Vec<String>>>()
    else {
        return false;
    };

    let value_kind = map.value_kind();
    let entries = std::mem::take(map).into_entries();
    let rekeyed = entries
        .into_iter()
        .zip(&paths)
        .map(|((_, held), path)| (link(path).into(), held));
    *value = values::Map::new(Kind::WadChunkLink, value_kind, rekeyed.collect())
        .expect("rekeying a map moves no value, so the kinds it declared still hold")
        .into();
    true
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
        PropertyValueEnum::Optional(option) if option.item_kind() == Kind::String => {
            /* The outer `None` is an option holding a value that is not the kind
            it declared. That goes back untouched, the way `hashed_container`
            hands its container back, rather than being dropped and counted as a
            repair - the value is read before the option is consumed for that. */
            let linked = match option.value() {
                None => Some(None),
                Some(held) => held
                    .get::<values::String>()
                    .map(|text| Some(link(&text.value))),
            };
            match linked {
                Some(linked) => Ok(values::Optional::from(linked).into()),
                None => Err(option.into()),
            }
        }
        PropertyValueEnum::Map(map) => {
            let key_kind = map.key_kind();
            if map.value_kind() != Kind::String {
                return Err(map.into());
            }
            let Ok(mut rebuilt) = values::Map::empty(key_kind, Kind::WadChunkLink) else {
                return Err(map.into());
            };
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
    if items.item_kind() != Kind::String {
        return Err(items);
    }
    let linked: Option<Vec<_>> = items
        .items()
        .iter()
        .map(|item| Some(link(&item.get::<values::String>()?.value)))
        .collect();
    match linked {
        Some(linked) => Ok(linked.into_iter().collect()),
        /* The container disagrees with the item kind it declared. */
        None => Err(items),
    }
}

/// Write the null `Pointer` over every `None` under this property. Reports
/// whether it changed.
///
/// A `None` carries nothing to read, so a wrapper keeps its count and each
/// slot takes a pointer with a zero class hash, which is how the format spells
/// a pointer to nothing.
fn null_pointers(value: &mut PropertyValueEnum) -> bool {
    let taken = std::mem::replace(value, Kind::None.default_value());
    match nulled(taken) {
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

/// The value with each `None` a null pointer, or the value back where it
/// holds anything else.
fn nulled(value: PropertyValueEnum) -> Result<PropertyValueEnum, PropertyValueEnum> {
    match value {
        PropertyValueEnum::None(_) => Ok(null_pointer()),
        PropertyValueEnum::Container(items) if items.item_kind() == Kind::None => {
            Ok(nulled_container(items.len()).into())
        }
        PropertyValueEnum::UnorderedContainer(items) if items.0.item_kind() == Kind::None => {
            Ok(values::UnorderedContainer(nulled_container(items.0.len())).into())
        }
        PropertyValueEnum::Optional(option) if option.item_kind() == Kind::None => {
            let held = option.is_some().then(null_pointer);
            Ok(values::Optional::new(Kind::Struct, held)
                .expect("a pointer is a kind an optional holds")
                .into())
        }
        PropertyValueEnum::Map(map) if map.value_kind() == Kind::None => {
            let key_kind = map.key_kind();
            let entries = map
                .into_entries()
                .into_iter()
                .map(|(key, _)| (key, null_pointer()))
                .collect();
            Ok(values::Map::new(key_kind, Kind::Struct, entries)
                .expect("a pointer is a kind a map holds, and the keys are the ones it held")
                .into())
        }
        other => Err(other),
    }
}

/// A pointer to nothing, which is a `Pointer` with a zero class hash.
fn null_pointer() -> PropertyValueEnum {
    PropertyValueEnum::Struct(values::Struct::default())
}

/// A container of `count` null pointers.
fn nulled_container(count: usize) -> values::Container {
    values::Container::new(Kind::Struct, (0..count).map(|_| null_pointer()).collect())
        .expect("a pointer is a kind a container holds")
}

/// Change a type tag or an embedded class hash, moving no value. Reports
/// whether it changed.
///
/// A row may do both - swap the tag of a container and rename the class of each
/// element - so neither half is asked to stand for the other.
fn retag(value: &mut PropertyValueEnum, migration: &Migration) -> bool {
    let tagged = swap_tag(value, migration.from.kind, migration.to.kind);
    let reclassed = migration
        .to
        .class
        .is_some_and(|class| reclass(value, class));
    tagged || reclassed
}

/// Write `to`'s tag over a value the two kinds encode identically. Reports
/// whether it changed.
fn swap_tag(value: &mut PropertyValueEnum, from: Kind, to: Kind) -> bool {
    let taken = std::mem::replace(value, Kind::None.default_value());
    match retagged(taken, from, to) {
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

/// The value under the other tag, or the value back where the pair is not one
/// of the three.
///
/// `Embedded` is a newtype over `Struct` and `UnorderedContainer` one over
/// `Container`, so those two are the wrapper alone. `BitBool` is a `bool` and a
/// byte on the wire, exactly as `Bool` is.
fn retagged(
    value: PropertyValueEnum,
    from: Kind,
    to: Kind,
) -> Result<PropertyValueEnum, PropertyValueEnum> {
    match (from, to, value) {
        (Kind::Embedded, Kind::Struct, PropertyValueEnum::Embedded(inner)) => {
            Ok(PropertyValueEnum::Struct(inner.0))
        }
        (Kind::Struct, Kind::Embedded, PropertyValueEnum::Struct(inner)) => {
            Ok(values::Embedded(inner).into())
        }
        (Kind::Container, Kind::UnorderedContainer, PropertyValueEnum::Container(items)) => {
            Ok(values::UnorderedContainer(items).into())
        }
        (
            Kind::UnorderedContainer,
            Kind::Container,
            PropertyValueEnum::UnorderedContainer(items),
        ) => Ok(items.0.into()),
        (Kind::Bool, Kind::BitBool, PropertyValueEnum::Bool(flag)) => Ok(values::BitBool {
            value: flag.value,
            meta: flag.meta,
        }
        .into()),
        (Kind::BitBool, Kind::Bool, PropertyValueEnum::BitBool(flag)) => Ok(values::Bool {
            value: flag.value,
            meta: flag.meta,
        }
        .into()),
        (_, _, other) => Err(other),
    }
}

/// Re-declare an empty option under `item`. Reports whether it changed.
///
/// The count byte is already 0, so the item type is the only byte that moves.
fn retag_option(value: &mut PropertyValueEnum, item: Option<Kind>) -> bool {
    let Some(item) = item else {
        return false;
    };
    let PropertyValueEnum::Optional(option) = value else {
        return false;
    };
    if option.is_some() || option.item_kind() == item {
        return false;
    }
    let Ok(retagged) = values::Optional::empty(item) else {
        return false;
    };
    *value = retagged.into();
    true
}

/// Rewrite an integer under the wider type `to` names. Reports whether it
/// changed.
///
/// The number itself is untouched: [`Conversion::Widen`] admits no pair that
/// could lose a bit of it, and a container crosses on the item type `to` names
/// rather than on its own.
fn widen(value: &mut PropertyValueEnum, to: &TypeSpec) -> bool {
    let taken = std::mem::replace(value, Kind::None.default_value());
    match widened(taken, to) {
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

/// The value under its wider type, or the value back where it does not apply.
fn widened(
    value: PropertyValueEnum,
    to: &TypeSpec,
) -> Result<PropertyValueEnum, PropertyValueEnum> {
    match value {
        PropertyValueEnum::Container(items) => widened_container(items, to.value)
            .map(Into::into)
            .map_err(Into::into),
        PropertyValueEnum::UnorderedContainer(items) => {
            match widened_container(items.0, to.value) {
                Ok(items) => Ok(values::UnorderedContainer(items).into()),
                Err(items) => Err(values::UnorderedContainer(items).into()),
            }
        }
        PropertyValueEnum::Optional(option) => widened_option(option, to.value),
        PropertyValueEnum::Map(map) => widened_map(map, to.value),
        leaf => match wider(&leaf, to.kind) {
            Some(widened) => Ok(widened),
            None => Err(leaf),
        },
    }
}

/// Rebuild a container of integers under a wider item type.
///
/// An empty one crosses too, since a container declares its item type whether
/// or not it holds anything of it.
fn widened_container(
    items: values::Container,
    to: Option<Kind>,
) -> Result<values::Container, values::Container> {
    let Some(to) = to else {
        return Err(items);
    };
    let widened: Option<Vec<_>> = items.items().iter().map(|item| wider(item, to)).collect();
    match widened.and_then(|widened| values::Container::new(to, widened).ok()) {
        Some(widened) => Ok(widened),
        None => Err(items),
    }
}

/// Rebuild an option of an integer under a wider item type, present or not.
fn widened_option(
    option: values::Optional,
    to: Option<Kind>,
) -> Result<PropertyValueEnum, PropertyValueEnum> {
    let Some(to) = to else {
        return Err(option.into());
    };
    let widened = match option.value() {
        None => Some(None),
        Some(held) => wider(held, to).map(Some),
    };
    match widened.and_then(|held| values::Optional::new(to, held).ok()) {
        Some(widened) => Ok(widened.into()),
        None => Err(option.into()),
    }
}

/// Rebuild a map's values under a wider type, keys untouched.
fn widened_map(map: values::Map, to: Option<Kind>) -> Result<PropertyValueEnum, PropertyValueEnum> {
    let Some(to) = to else {
        return Err(map.into());
    };
    let key_kind = map.key_kind();
    let widened: Option<Vec<_>> = map
        .entries()
        .iter()
        .map(|(key, held)| Some((key.clone(), wider(held, to)?)))
        .collect();
    match widened.and_then(|entries| values::Map::new(key_kind, to, entries).ok()) {
        Some(widened) => Ok(widened.into()),
        None => Err(map.into()),
    }
}

/// One integer as a value of `kind`, or `None` where either side is not an
/// integer or `kind` does not hold the number.
fn wider(value: &PropertyValueEnum, kind: Kind) -> Option<PropertyValueEnum> {
    integer_of(kind, whole(value)?)
}

/// The number an integer property holds, in the type that holds them all.
fn whole(value: &PropertyValueEnum) -> Option<i128> {
    Some(match value {
        PropertyValueEnum::I8(v) => i128::from(v.value),
        PropertyValueEnum::U8(v) => i128::from(v.value),
        PropertyValueEnum::I16(v) => i128::from(v.value),
        PropertyValueEnum::U16(v) => i128::from(v.value),
        PropertyValueEnum::I32(v) => i128::from(v.value),
        PropertyValueEnum::U32(v) => i128::from(v.value),
        PropertyValueEnum::I64(v) => i128::from(v.value),
        PropertyValueEnum::U64(v) => i128::from(v.value),
        _ => return None,
    })
}

/// `number` written as an integer of `kind`, or `None` where the kind is not an
/// integer or does not hold it.
///
/// A pair reaches here only through [`Conversion::Widen`], which promises the
/// number crosses. Checking rather than casting is what keeps that promise a
/// promise instead of a silent truncation.
fn integer_of(kind: Kind, number: i128) -> Option<PropertyValueEnum> {
    Some(match kind {
        Kind::I8 => values::I8::new(i8::try_from(number).ok()?).into(),
        Kind::U8 => values::U8::new(u8::try_from(number).ok()?).into(),
        Kind::I16 => values::I16::new(i16::try_from(number).ok()?).into(),
        Kind::U16 => values::U16::new(u16::try_from(number).ok()?).into(),
        Kind::I32 => values::I32::new(i32::try_from(number).ok()?).into(),
        Kind::U32 => values::U32::new(u32::try_from(number).ok()?).into(),
        Kind::I64 => values::I64::new(i64::try_from(number).ok()?).into(),
        Kind::U64 => values::U64::new(u64::try_from(number).ok()?).into(),
        _ => return None,
    })
}

/// Point every element of a container at a renamed class.
fn reclass(value: &mut PropertyValueEnum, class: BinHash) -> bool {
    let items = match value {
        PropertyValueEnum::Container(items) => items,
        PropertyValueEnum::UnorderedContainer(items) => &mut items.0,
        _ => return false,
    };
    if !matches!(items.item_kind(), Kind::Struct | Kind::Embedded) {
        return false;
    }

    for index in 0..items.len() {
        let Some(mut slot) = items.slot(index) else {
            continue;
        };
        match slot.as_mut() {
            ValueMut::Struct(inner) => inner.class_hash = class,
            ValueMut::Embedded(inner) => inner.0.class_hash = class,
            _ => {}
        }
    }
    true
}

/// The `File` of a path, which is XXH64 of it lowercased.
fn link(path: &str) -> values::WadChunkLink<NoMeta> {
    values::WadChunkLink::new(WadHash::hash_str(path))
}

/// A map key, as a subscript reads, in the form the file holds.
fn subscript(key: &PropertyValueEnum) -> String {
    match key {
        PropertyValueEnum::String(text) => text.value.clone(),
        PropertyValueEnum::Hash(hash) => hex(hash.value),
        PropertyValueEnum::WadChunkLink(hash) => format!("0x{:016x}", hash.value.0),
        PropertyValueEnum::U8(v) => v.value.to_string(),
        PropertyValueEnum::U32(v) => v.value.to_string(),
        PropertyValueEnum::I32(v) => v.value.to_string(),
        other => format!("{:?}", other.kind()),
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
    names: &BinNames,
    installed: Option<GameBuild>,
    table: GameBuild,
) -> Option<String> {
    let mut parts = Vec::new();

    /* The sentence prints the hash the file holds, because that hash is the
    whole of what a person needs to go and find the path themselves. */
    match migration.conversion {
        Conversion::Rehash if resolved_paths(value, migration, names).is_none() => {
            parts.push(format!(
                "Neither the Mimir hashtables nor the mod's own resolve the FNV1a Hash value {} back to its path, and only that path crosses to File, the 64-bit xxHash. Adding the path to the mod's hashtables makes this repairable.",
                unresolved(value, names)
            ));
        }
        Conversion::HashKey | Conversion::HashKeyValue
            if resolved_paths(value, migration, names).is_none() =>
        {
            parts.push(format!(
                "Neither the Mimir hashtables nor the mod's own resolve {} back to its path, and only those paths cross to File keys, the 64-bit xxHash. Adding the paths to the mod's hashtables makes this repairable.",
                unresolved(value, names)
            ));
        }
        Conversion::Unknown => {
            parts.push(format!(
                "The game reads this property as {} and drops a value of any other type. Nothing rewrites a {} into one, so the mod has to be rebuilt against the current game.",
                migration.to.label(),
                migration.from.label()
            ));
        }
        Conversion::Rehash
        | Conversion::HashKey
        | Conversion::HashKeyValue
        | Conversion::HashValue
        | Conversion::RetagHashValue
        | Conversion::None
        | Conversion::NullPointer
        | Conversion::Widen
        | Conversion::EmptyOption => {}
    }

    if installed.is_some_and(|installed| installed < table) {
        parts.push("The installed game still wants the old type.".to_owned());
    }

    (!parts.is_empty()).then(|| parts.join(" "))
}

/// The hashes no table names, as a row prints them.
///
/// A `rehash` row holds one, and a `hash_key` row holds one for each entry, so
/// a map names the first unresolved one and says how many more went unnamed.
fn unresolved(value: &PropertyValueEnum, names: &BinNames) -> String {
    match value {
        PropertyValueEnum::Hash(hash) => hex(hash.value),
        PropertyValueEnum::Map(map) => {
            let missing: Vec<&PropertyValueEnum> = map
                .entries()
                .iter()
                .map(|(key, _)| key)
                .filter(|key| key_path(key, names).is_none())
                .collect();
            match missing.as_slice() {
                [] => "its keys".to_owned(),
                [key] => subscript(key),
                [key, rest @ ..] => format!("{} and {} more", subscript(key), rest.len()),
            }
        }
        other => format!("this {}", word_of(other)),
    }
}

/// The path behind one map key, where a table names it.
fn key_path(key: &PropertyValueEnum, names: &BinNames) -> Option<String> {
    let PropertyValueEnum::Hash(hash) = key else {
        return None;
    };
    names.path_value(hash.value)
}

/// The paths a `rehash` or `hash_key` repair would write from, or `None`
/// where any of them goes unnamed.
///
/// All or nothing, because a map half of whose keys convert would leave the
/// game reading two hash functions out of one property. `None` is what makes
/// the finding unrepairable, and the note names the hashes it is missing.
fn resolved_paths(
    value: &PropertyValueEnum,
    migration: &Migration,
    names: &BinNames,
) -> Option<Vec<String>> {
    match (migration.conversion, value) {
        (Conversion::Rehash, PropertyValueEnum::Hash(hash)) => {
            Some(vec![names.path_value(hash.value)?])
        }
        (Conversion::HashKey | Conversion::HashKeyValue, PropertyValueEnum::Map(map)) => map
            .entries()
            .iter()
            .map(|(key, _)| key_path(key, names))
            .collect(),
        _ => None,
    }
}

/// A value's kind, in the word a bin row's tag draws.
fn word_of(value: &PropertyValueEnum) -> &'static str {
    PropertyKind::from(value.kind()).tag()
}

/// What a repair would change, for a problem that has one.
///
/// A `rehash` or `hash_key` row has a repair exactly where every hash it holds
/// resolves to its path, and the preview draws those paths - they are what the
/// new value is computed from, and what a reader can check.
fn preview(
    migration: &Migration,
    value: &PropertyValueEnum,
    names: &BinNames,
) -> Option<FixPreview> {
    match migration.conversion {
        /* The keys are the half a `HashKeyValue` can fail on, so they are the
        half worth drawing. */
        Conversion::Rehash | Conversion::HashKey | Conversion::HashKeyValue => {
            let paths = resolved_paths(value, migration, names)?;
            Some(match paths.as_slice() {
                [] => FixPreview::default(),
                [path] => FixPreview::value(
                    quoted(path),
                    format!("0x{:016x}", WadHash::hash_str(path).0),
                ),
                [first, rest @ ..] => FixPreview::sample(quoted(first), Some(more(rest.len()))),
            })
        }
        /* Nothing to draw beside the annotation: the type is the whole change. */
        Conversion::None
        | Conversion::NullPointer
        | Conversion::Widen
        | Conversion::EmptyOption => Some(FixPreview::default()),
        Conversion::HashValue | Conversion::RetagHashValue => Some(value_preview(value)),
        /* No repair, so nothing to preview. */
        Conversion::Unknown => None,
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
        PropertyValueEnum::Optional(option) => option
            .value()
            .and_then(|held| held.get::<values::String>())
            .map(|text| text.value.as_str())
            .into_iter()
            .collect(),
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
    items
        .items()
        .iter()
        .filter_map(|item| Some(item.get::<values::String>()?.value.as_str()))
        .collect()
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
        PropertyValueEnum::Optional(option) if option.item_kind() == Kind::String => {
            usize::from(option.is_some())
        }
        _ => 1,
    }
}

fn container_len(items: &values::Container) -> usize {
    match items.item_kind() {
        Kind::String | Kind::WadChunkLink | Kind::Hash | Kind::Struct | Kind::Embedded => {
            items.len()
        }
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
/// The check goes through [`FileHandle::bin`] instead. This is for a test that
/// holds a path, and for the fix, which reads through the run.
///
/// # Errors
///
/// Reports the file it could not open or parse, as one sentence for the panel.
#[cfg(test)]
fn read_bin(path: &std::path::Path) -> Result<ltk_meta::BinFile, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    read_bin_bytes(&bytes)
}

fn read_bin_bytes(bytes: &[u8]) -> Result<ltk_meta::BinFile, String> {
    ltk_meta::BinFile::from_reader(&mut std::io::Cursor::new(bytes)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
