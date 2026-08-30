//! Unit tests for the rule's findings, its severity, its previews and its fixes.

use super::*;
use crate::config::Config;
use ltk_meta::{Bin, BinObject};

/// `SkinCharacterDataProperties`, which 225 of 232 real project bins declare.
const SKIN: BinHash = BinHash(0x9b67_e9f6);
/// The object the fixtures hang their properties on.
const ENTRY: BinHash = BinHash(0x1234_5678);

/* The four `hash_value` shapes, all on the one class that matters. */
const ICON_AVATAR: BinHash = BinHash(0x089a_ff69);
const ALTERNATE_ICONS_CIRCLE: BinHash = BinHash(0x3c84_e8f5);
const ICON_CIRCLE: BinHash = BinHash(0xe672_84f4);
const UNCENSORED_ICON_CIRCLES: BinHash = BinHash(0x8ce0_4c3d);

const ICON: &str = "ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds";

fn text(value: &str) -> values::String {
    values::String::new(value.to_owned())
}

fn bytes_of(bin: &Bin) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    bin.to_writer(&mut out).unwrap();
    out.into_inner()
}

fn bin_with(field: BinHash, value: impl Into<PropertyValueEnum>) -> Bin {
    Bin::new(
        [BinObject::<NoMeta>::builder(ENTRY, SKIN)
            .property(field, value)
            .build()],
        std::iter::empty::<&str>(),
    )
}

/// A project holding one `.bin` at `content/base/data/skin0.bin`.
fn project(bin: &Bin) -> (tempfile::TempDir, ProjectFiles) {
    project_on(bin, None)
}

/// The same project, beside a game install on `installed`.
///
/// The install sits under the project's own temp directory rather than
/// inside it, so the walk that reads `content/` never sees it.
fn project_on(bin: &Bin, installed: Option<GameBuild>) -> (tempfile::TempDir, ProjectFiles) {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("content").join("base").join("data");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("skin0.bin"), bytes_of(bin)).unwrap();

    let mut config = Config::default();
    if let Some(build) = installed {
        let league = tmp.path().join("league");
        std::fs::create_dir_all(league.join("Game")).unwrap();
        std::fs::write(
            league.join("Game").join("content-metadata.json"),
            format!(r#"{{ "version": "{build}" }}"#),
        )
        .unwrap();
        config.league_path = Some(league);
    }

    let files = ProjectFiles::read(tmp.path(), &config, None).unwrap();
    (tmp, files)
}

/// Declare one hashtable of `category` on the project at `root`, naming
/// `paths`.
fn declare_table(root: &std::path::Path, category: ltk_hashtable::Category, paths: &[&str]) {
    let (file, algorithm, bits) = match &category {
        ltk_hashtable::Category::Game => ("game.hashes.txt", ltk_hashtable::Algorithm::Xxh64, 64),
        _ => ("binhashes.txt", ltk_hashtable::Algorithm::Fnv1a32, 32),
    };
    let config = ltk_mod_project::ModProject {
        hashtables: vec![ltk_mod_project::ModProjectHashtable {
            path: format!("hashes/{file}"),
            category,
            algorithm,
            bits,
        }],
        ..crate::mods::test_support::mod_project_named("rehash-fixture")
    };
    std::fs::write(
        root.join("mod.config.json"),
        config
            .to_config_string(ltk_mod_project::ConfigFormat::Json)
            .unwrap(),
    )
    .unwrap();
    std::fs::create_dir_all(root.join("hashes")).unwrap();
    std::fs::write(root.join("hashes").join(file), paths.join("\n") + "\n").unwrap();
}

/// Declare one `binhashes` table on the project at `root`, naming `paths`.
fn declare_binhashes(root: &std::path::Path, paths: &[&str]) {
    declare_table(root, ltk_hashtable::Category::BinHashes, paths);
}

/// A `BinNames` resolving exactly the `binhashes` names a fixture declares.
fn names_of(paths: &[&str]) -> (tempfile::TempDir, BinNames) {
    let tmp = tempfile::tempdir().unwrap();
    declare_binhashes(tmp.path(), paths);
    let names = BinNames::open(tmp.path());
    (tmp, names)
}

fn found(bin: &Bin) -> Vec<Problem> {
    let (_tmp, files) = project(bin);
    check_with(&files)
}

fn check_with(files: &ProjectFiles) -> Vec<Problem> {
    let mut report = Report::default();
    BinPropertyType::new().check(files, &mut report);
    let (problems, failed) = report.finish();
    assert!(failed.is_empty(), "the fixture should read cleanly");
    problems
}

// ---- the four match cases --------------------------------------------

#[test]
fn a_property_that_matches_from_raises_one_problem() {
    let problems = found(&bin_with(ICON_AVATAR, text(ICON)));

    assert_eq!(problems.len(), 1);
    let problem = &problems[0];
    assert_eq!(problem.rule, ID);
    assert_eq!(problem.site.layer, "base");
    assert_eq!(problem.site.path, "data/skin0.bin");
    let node = problem.site.node.as_ref().unwrap();
    assert_eq!(node.entry, ENTRY);
    assert_eq!(node.path, "iconAvatar", "the table names this field");
}

/// A file already carrying the new type is a file the run must stay quiet
/// about, or a fix run offered twice would double up.
#[test]
fn a_property_that_matches_to_raises_nothing() {
    let problems = found(&bin_with(
        ICON_AVATAR,
        values::WadChunkLink::new(WadHash::hash_str(ICON)),
    ));
    assert!(problems.is_empty());
}

#[test]
fn a_property_that_matches_neither_raises_nothing() {
    let problems = found(&bin_with(ICON_AVATAR, values::I32::new(42)));
    assert!(problems.is_empty());
}

#[test]
fn a_property_the_object_does_not_declare_raises_nothing() {
    let problems = found(&bin_with(BinHash(0xdead_beef), text(ICON)));
    assert!(problems.is_empty());
}

#[test]
fn a_class_the_table_does_not_name_raises_nothing() {
    let bin = Bin::new(
        [BinObject::<NoMeta>::builder(ENTRY, BinHash(0x0bad_0bad))
            .property(ICON_AVATAR, text(ICON))
            .build()],
        std::iter::empty::<&str>(),
    );
    assert!(found(&bin).is_empty());
}

// ---- the preview ------------------------------------------------------

#[test]
fn a_leaf_preview_draws_the_value_and_the_hash_it_becomes() {
    let problems = found(&bin_with(ICON_AVATAR, text(ICON)));
    let fix = problems[0].fix.as_ref().unwrap();

    assert_eq!(
        problems[0].mismatch,
        Some(TypeMismatch {
            expected: "File".to_owned(),
            found: "String".to_owned(),
        })
    );
    assert_eq!(fix.note, None, "the values say it, so a note would repeat");
    assert_eq!(
        fix.before.as_deref(),
        Some("\"ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds\"")
    );
    assert_eq!(
        fix.after.as_deref(),
        Some(format!("0x{:016x}", WadHash::hash_str(ICON).0).as_str())
    );
}

/// The rule's title and the two types carry the ordinary retype between
/// them, so a note on top of that is a sentence on every row of the run.
#[test]
fn the_ordinary_retype_says_nothing_the_rule_has_not_already_said() {
    let problems = found(&bin_with(ICON_AVATAR, text(ICON)));
    assert_eq!(problems[0].message, None);
}

/// The `VfxAssetRemap:oldAsset` row, which is `Hash` to `File`.
fn rehash_migration() -> &'static Migration {
    let vfx = BinHash::hash_str("VfxAssetRemap");
    let old_asset = BinHash::hash_str("oldAsset");
    let migration = table::tables()
        .iter()
        .find_map(|table| table.migration(vfx, old_asset))
        .expect("VfxAssetRemap:oldAsset is a rehash row");
    assert_eq!(migration.conversion, Conversion::Rehash);
    migration
}

/// The `UiElementParticleSystemData:TextureOverrides` row, whose map keys go
/// from `Hash` to `File`.
fn hash_key_migration() -> &'static Migration {
    let class = BinHash::hash_str("UiElementParticleSystemData");
    let field = BinHash::hash_str("TextureOverrides");
    let migration = table::tables()
        .iter()
        .find_map(|table| table.migration(class, field))
        .expect("UiElementParticleSystemData:TextureOverrides is a hash_key row");
    assert_eq!(migration.conversion, Conversion::HashKey);
    migration
}

/// Each conversion is a different problem, and a reader needs the
/// difference: a `rehash` no table can name says why nothing repairs it.
#[test]
fn an_unresolvable_rehash_notes_what_the_repair_is_missing() {
    let migration = rehash_migration();

    let value: PropertyValueEnum = values::Hash::new(BinHash(0x5ae4_1520)).into();
    let table_build = GameBuild::new(16, 17, 8_087_655);
    let bin = Bin::new([] as [BinObject<NoMeta>; 0], std::iter::empty::<&str>());
    let text = note(
        migration,
        &value,
        &BinNames::none(),
        None,
        table_build,
        &bin,
    )
    .expect("an unresolvable rehash speaks up");

    assert!(text.contains("0x5ae41520"), "{text}");
    assert!(text.contains("FNV1a Hash value"), "{text}");
    assert!(text.contains("64-bit xxHash"), "{text}");
    assert!(
        text.contains("neither the Mimir hashtables nor the mod's own"),
        "{text}"
    );
}

/// A hash the mod's own table names is an ordinary repair, and an ordinary
/// repair says nothing the rule has not already said.
#[test]
fn a_rehash_a_table_names_needs_no_note() {
    const PATH: &str = "assets/fixture/rehash_target.dds";
    let migration = rehash_migration();
    let (_tmp, names) = names_of(&[PATH]);

    let value: PropertyValueEnum = values::Hash::new(BinHash::hash_str(PATH)).into();
    let table_build = GameBuild::new(16, 17, 8_087_655);
    let bin = Bin::new([] as [BinObject<NoMeta>; 0], std::iter::empty::<&str>());

    assert_eq!(
        note(migration, &value, &names, None, table_build, &bin),
        None
    );
    let drawn = preview(migration, &value, &names).expect("a named hash has a repair");
    assert_eq!(
        drawn.before.as_deref(),
        Some("\"assets/fixture/rehash_target.dds\"")
    );
    assert_eq!(
        drawn.after,
        Some(format!("0x{:016x}", WadHash::hash_str(PATH).0))
    );
}

/// A list of two hundred paths is not a thing a row reads, so a container
/// draws one of them and how many more it holds. A count on its own says
/// nothing about what is in the file, which is what a reader came for.
#[test]
fn a_container_preview_draws_one_path_and_the_count_of_the_rest() {
    let items = values::Container::String {
        items: vec![text("a.dds"), text("b.dds"), text("c.dds")],
        meta: NoMeta,
    };
    let problems = found(&bin_with(ALTERNATE_ICONS_CIRCLE, items));

    let fix = problems[0].fix.as_ref().unwrap();
    assert_eq!(
        problems[0].mismatch,
        Some(TypeMismatch {
            expected: "List<File>".to_owned(),
            found: "List<String>".to_owned(),
        })
    );
    assert_eq!(fix.before.as_deref(), Some("\"a.dds\""));
    assert_eq!(fix.note.as_deref(), Some("and 2 more"));
    assert!(
        fix.after.is_none(),
        "a repaired hash is not what a row draws"
    );
}

/// The case that read `1 item` and said nothing: a container of one path
/// draws the path, and has nothing left to count.
#[test]
fn a_container_of_one_path_draws_the_path_alone() {
    let items = values::Container::String {
        items: vec![text("ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds")],
        meta: NoMeta,
    };
    let problems = found(&bin_with(ALTERNATE_ICONS_CIRCLE, items));

    let fix = problems[0].fix.as_ref().unwrap();
    assert_eq!(
        fix.before.as_deref(),
        Some("\"ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds\"")
    );
    assert_eq!(fix.note, None);
}

// ---- severity ---------------------------------------------------------

#[test]
fn severity_is_fatal_once_the_install_has_taken_the_change() {
    let table = GameBuild::new(16, 17, 8_087_655);
    assert_eq!(severity(Some(table), table), Severity::Fatal);
    assert_eq!(
        severity(Some(GameBuild::new(16, 18, 1)), table),
        Severity::Fatal
    );
}

/// A fix applied early breaks the mod on the client the user has, so an
/// older install reads as a warning rather than an error.
#[test]
fn severity_is_warning_on_an_older_or_unknown_install() {
    let table = GameBuild::new(16, 17, 8_087_655);
    assert_eq!(
        severity(Some(GameBuild::new(16, 16, 8_049_184)), table),
        Severity::Warning
    );
    assert_eq!(severity(None, table), Severity::Warning);
}

// ---- dormancy ---------------------------------------------------------

/// The build the one shipped table is a claim about.
const TABLE: GameBuild = GameBuild::new(16, 17, 8_087_655);
/// A live build from before Riot deployed that change.
const BEFORE_TABLE: GameBuild = GameBuild::new(16, 16, 8_049_184);

/// A change Riot has not deployed is a change no mod is wrong about yet,
/// so the rule says which patch it is waiting on.
#[test]
fn an_install_older_than_the_table_names_the_patch_it_waits_for() {
    let (_tmp, files) = project_on(&bin_with(ICON_AVATAR, text(ICON)), Some(BEFORE_TABLE));

    let dormancy = BinPropertyType::new()
        .dormant(&files)
        .expect("a build before the table's leaves the rule dormant");
    assert_eq!(dormancy.waiting, "Patch 16.17");
    assert!(dormancy.reason.contains("16.17"), "{}", dormancy.reason);
    assert!(dormancy.reason.contains("16.16"), "{}", dormancy.reason);
}

/// The build numbers a modder does not recognise stay out of the sentence
/// and go under it, where somebody comparing two installs can find them.
#[test]
fn the_builds_it_compared_are_the_fine_print() {
    let (_tmp, files) = project_on(&bin_with(ICON_AVATAR, text(ICON)), Some(BEFORE_TABLE));

    let dormancy = BinPropertyType::new().dormant(&files).unwrap();
    assert!(!dormancy.reason.contains("8087655"), "{}", dormancy.reason);

    let detail = dormancy.detail.expect("the rule names both builds");
    assert!(detail.contains("16.17.8087655"), "{detail}");
    assert!(detail.contains("16.16.8049184"), "{detail}");
}

/// A modder wants to see what is coming, so waiting mutes the findings in
/// the panel rather than withholding them. The severity is what says the
/// game has not taken the change, and the fix is never withheld.
#[test]
fn a_waiting_rule_still_finds_everything_at_warning() {
    let (_tmp, files) = project_on(&bin_with(ICON_AVATAR, text(ICON)), Some(BEFORE_TABLE));

    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].severity, Severity::Warning);
    assert!(problems[0].fix.is_some());
}

/// The row that earns a message: this one is not the ordinary retype, it
/// is a retype the reader own game disagrees with.
#[test]
fn a_waiting_finding_names_the_installed_game() {
    let (_tmp, files) = project_on(&bin_with(ICON_AVATAR, text(ICON)), Some(BEFORE_TABLE));

    let problems = check_with(&files);
    assert_eq!(
        problems[0].message.as_deref(),
        Some("The installed game still wants the old type.")
    );
}

#[test]
fn an_install_that_has_taken_the_change_leaves_the_rule_active() {
    let (_tmp, files) = project_on(&bin_with(ICON_AVATAR, text(ICON)), Some(TABLE));

    assert_eq!(BinPropertyType::new().dormant(&files), None);
    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].severity, Severity::Fatal);
    assert_eq!(problems[0].message, None, "a landed change needs no note");
}

/// An unreadable install is not a claim that the change has not landed, so
/// the panel draws the findings the way it draws any other warning.
#[test]
fn an_install_that_could_not_be_read_leaves_the_rule_active() {
    let (_tmp, files) = project_on(&bin_with(ICON_AVATAR, text(ICON)), None);

    assert_eq!(BinPropertyType::new().dormant(&files), None);
    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].severity, Severity::Warning);
}

// ---- the conversions --------------------------------------------------

fn migration_for(field: BinHash) -> &'static Migration {
    table::tables()
        .iter()
        .find_map(|table| table.migration(SKIN, field))
        .expect("the fixture fields are all in the shipped table")
}

#[test]
fn hash_value_turns_a_string_into_the_link_of_the_same_path() {
    let mut value: PropertyValueEnum = text(ICON).into();
    assert!(convert(
        &mut value,
        migration_for(ICON_AVATAR),
        &BinNames::none()
    ));

    let PropertyValueEnum::WadChunkLink(link) = value else {
        panic!("expected a WadChunkLink");
    };
    assert_eq!(link.value, WadHash::hash_str(ICON));
}

/// The hash is case-insensitive, which is what lets a mod ship a path in
/// whatever casing its author typed.
#[test]
fn hash_value_lowercases_before_it_hashes() {
    let mut upper: PropertyValueEnum = text(&ICON.to_uppercase()).into();
    let mut lower: PropertyValueEnum = text(&ICON.to_lowercase()).into();
    assert!(convert(
        &mut upper,
        migration_for(ICON_AVATAR),
        &BinNames::none()
    ));
    assert!(convert(
        &mut lower,
        migration_for(ICON_AVATAR),
        &BinNames::none()
    ));
    assert_eq!(upper, lower);
}

#[test]
fn hash_value_rebuilds_a_container_under_the_new_item_type() {
    let mut value: PropertyValueEnum = values::Container::String {
        items: vec![text("a.dds"), text("b.dds")],
        meta: NoMeta,
    }
    .into();
    assert!(convert(
        &mut value,
        migration_for(ALTERNATE_ICONS_CIRCLE),
        &BinNames::none()
    ));

    let PropertyValueEnum::Container(items) = &value else {
        panic!("expected a Container");
    };
    assert_eq!(items.item_kind(), Kind::WadChunkLink);
    assert_eq!(container_len(items), 2);
}

#[test]
fn hash_value_rebuilds_an_optional_and_keeps_it_empty_when_it_was() {
    let mut present: PropertyValueEnum = values::Optional::String {
        value: Some(text(ICON)),
        meta: NoMeta,
    }
    .into();
    assert!(convert(
        &mut present,
        migration_for(ICON_CIRCLE),
        &BinNames::none()
    ));
    assert!(matches!(
        present,
        PropertyValueEnum::Optional(values::Optional::WadChunkLink { value: Some(_), .. })
    ));

    let mut absent: PropertyValueEnum = values::Optional::String {
        value: None,
        meta: NoMeta,
    }
    .into();
    assert!(convert(
        &mut absent,
        migration_for(ICON_CIRCLE),
        &BinNames::none()
    ));
    assert!(matches!(
        absent,
        PropertyValueEnum::Optional(values::Optional::WadChunkLink { value: None, .. })
    ));
}

#[test]
fn hash_value_rebuilds_a_map_and_leaves_its_keys_alone() {
    let key: PropertyValueEnum = values::Hash::new(BinHash(0xabcd_1234)).into();
    let mut map = values::Map::empty(Kind::Hash, Kind::String);
    map.push(key.clone(), text(ICON).into()).unwrap();
    let mut value: PropertyValueEnum = map.into();

    assert!(convert(
        &mut value,
        migration_for(UNCENSORED_ICON_CIRCLES),
        &BinNames::none()
    ));

    let PropertyValueEnum::Map(map) = &value else {
        panic!("expected a Map");
    };
    assert_eq!(map.key_kind(), Kind::Hash);
    assert_eq!(map.value_kind(), Kind::WadChunkLink);
    assert_eq!(map.entries()[0].0, key, "the key is untouched");
}

/// A `Hash` is FNV1a32 of a path and a `File` is XXH64 of it, and there is
/// no arithmetic between them - only the path crosses. A hash no table
/// names has no path, so this must write nothing at all.
#[test]
fn a_rehash_no_table_names_makes_no_change_and_offers_no_fix() {
    let migration = rehash_migration();

    let mut value: PropertyValueEnum = values::Hash::new(BinHash(0x1111_2222)).into();
    let before = value.clone();
    assert!(!convert(&mut value, migration, &BinNames::none()));
    assert_eq!(value, before);
    assert!(preview(migration, &value, &BinNames::none()).is_none());
}

/// The game hashtables key their names by XXH64, and the name itself is the
/// path - so a `Hash` resolves through them too, by hashing every name under
/// FNV1a32.
#[test]
fn a_rehash_resolves_through_the_game_hashes_under_fnv() {
    const PATH: &str = "assets/fixture/game_table_target.dds";
    let migration = rehash_migration();

    let tmp = tempfile::tempdir().unwrap();
    declare_table(tmp.path(), ltk_hashtable::Category::Game, &[PATH]);
    let names = BinNames::open(tmp.path());

    let mut value: PropertyValueEnum = values::Hash::new(BinHash::hash_str(PATH)).into();
    assert!(convert(&mut value, migration, &names));

    let PropertyValueEnum::WadChunkLink(link) = &value else {
        panic!("expected a WadChunkLink");
    };
    assert_eq!(link.value, WadHash::hash_str(PATH));
}

#[test]
fn a_rehash_writes_the_link_of_the_path_a_table_names() {
    const PATH: &str = "assets/fixture/rehash_target.dds";
    let migration = rehash_migration();
    let (_tmp, names) = names_of(&[PATH]);

    let mut value: PropertyValueEnum = values::Hash::new(BinHash::hash_str(PATH)).into();
    assert!(convert(&mut value, migration, &names));

    let PropertyValueEnum::WadChunkLink(link) = &value else {
        panic!("expected a WadChunkLink");
    };
    assert_eq!(link.value, WadHash::hash_str(PATH));
}

#[test]
fn a_hash_key_map_is_rekeyed_and_keeps_its_values() {
    const A: &str = "assets/fixture/override_a.dds";
    const B: &str = "assets/fixture/override_b.dds";
    let migration = hash_key_migration();
    let (_tmp, names) = names_of(&[A, B]);

    let mut map = values::Map::empty(Kind::Hash, Kind::String);
    map.push(
        values::Hash::new(BinHash::hash_str(A)).into(),
        text("a").into(),
    )
    .unwrap();
    map.push(
        values::Hash::new(BinHash::hash_str(B)).into(),
        text("b").into(),
    )
    .unwrap();
    let mut value: PropertyValueEnum = map.into();

    assert!(convert(&mut value, migration, &names));

    let PropertyValueEnum::Map(rekeyed) = &value else {
        panic!("expected a Map");
    };
    assert_eq!(rekeyed.key_kind(), Kind::WadChunkLink);
    let entries = rekeyed.entries();
    assert_eq!(
        entries[0].0,
        values::WadChunkLink::new(WadHash::hash_str(A)).into()
    );
    assert_eq!(entries[0].1, text("a").into(), "the value is untouched");
    assert_eq!(
        entries[1].0,
        values::WadChunkLink::new(WadHash::hash_str(B)).into()
    );
}

/// One unnamed key refuses the whole map, because a map read under two hash
/// functions is broken in a way the old one is not.
#[test]
fn a_map_with_one_unnamed_key_stays_as_it_is() {
    const A: &str = "assets/fixture/override_a.dds";
    let migration = hash_key_migration();
    let (_tmp, names) = names_of(&[A]);

    let mut map = values::Map::empty(Kind::Hash, Kind::String);
    map.push(
        values::Hash::new(BinHash::hash_str(A)).into(),
        text("a").into(),
    )
    .unwrap();
    map.push(
        values::Hash::new(BinHash(0x1111_2222)).into(),
        text("b").into(),
    )
    .unwrap();
    let mut value: PropertyValueEnum = map.into();
    let before = value.clone();

    assert!(!convert(&mut value, migration, &names));
    assert_eq!(value, before);
    assert!(preview(migration, &value, &names).is_none());
}

#[test]
fn none_moves_no_bytes_and_only_changes_the_tag() {
    let embed = values::Embedded(values::Struct {
        class_hash: BinHash(0x73b4_a2eb),
        properties: IndexMap::new(),
        meta: NoMeta,
    });
    let migration = table::tables()
        .iter()
        .find_map(|table| table.migration(BinHash(0x3b09_052f), BinHash::hash_str("value")))
        .expect("0x3b09052f:value is the Embed to Pointer row");
    assert_eq!(migration.conversion, Conversion::None);

    let mut value: PropertyValueEnum = embed.into();
    assert!(convert(&mut value, migration, &BinNames::none()));

    let PropertyValueEnum::Struct(inner) = &value else {
        panic!("expected a Struct");
    };
    assert_eq!(inner.class_hash, BinHash(0x73b4_a2eb), "the class is kept");
}

/// The row has to print the hashes the repair is missing, not the hash of
/// the field naming them - they are what a person takes away to go and find
/// the paths by hand.
#[test]
fn an_unrepairable_row_prints_the_hashes_no_table_names() {
    let nothing = BinNames::none();
    assert_eq!(
        unresolved(&values::Hash::new(BinHash(0x5ae4_1520)).into(), &nothing),
        "0x5ae41520"
    );

    let mut map = values::Map::empty(Kind::Hash, Kind::String);
    map.push(
        values::Hash::new(BinHash(0x0000_00aa)).into(),
        text("a").into(),
    )
    .unwrap();
    map.push(
        values::Hash::new(BinHash(0x0000_00bb)).into(),
        text("b").into(),
    )
    .unwrap();
    assert_eq!(unresolved(&map.into(), &nothing), "0x000000aa and 1 more");

    assert_eq!(
        unresolved(
            &values::Map::empty(Kind::Hash, Kind::String).into(),
            &nothing
        ),
        "its keys"
    );
}

/// A map missing one name prints that one, not the keys a table already
/// answered for.
#[test]
fn a_half_named_map_prints_only_what_is_missing() {
    const A: &str = "assets/fixture/override_a.dds";
    let (_tmp, names) = names_of(&[A]);

    let mut map = values::Map::empty(Kind::Hash, Kind::String);
    map.push(
        values::Hash::new(BinHash::hash_str(A)).into(),
        text("a").into(),
    )
    .unwrap();
    map.push(
        values::Hash::new(BinHash(0x0000_00bb)).into(),
        text("b").into(),
    )
    .unwrap();
    assert_eq!(unresolved(&map.into(), &names), "0x000000bb");
}

// ---- the fix, end to end ---------------------------------------------

/// Builds a project, runs the check, applies every problem, and hands back
/// what the run reported plus the bin that landed on disk.
fn fix_all(bin: &Bin) -> (Applied, Bin) {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("content").join("base").join("data");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("skin0.bin");
    std::fs::write(&file, bytes_of(bin)).unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let mut report = Report::default();
    let rule = BinPropertyType::new();
    rule.check(&files, &mut report);
    let (problems, _) = report.finish();

    let borrowed: Vec<&Problem> = problems.iter().collect();
    let mut run = FixRun::open(
        tmp.path(),
        vec!["16.17.8087655".to_owned()],
        None,
        Config::default(),
        None,
    );
    let applied = rule.fix(&borrowed, &mut run).unwrap();
    run.finish().unwrap();

    let written = read_bin(&file).unwrap();
    (applied, written)
}

#[test]
fn a_fix_writes_the_link_and_the_run_reports_it() {
    let (applied, written) = fix_all(&bin_with(ICON_AVATAR, text(ICON)));

    assert_eq!(applied.applied, 1);
    assert_eq!(applied.skipped, 0);

    let value = &written.objects[&ENTRY].properties[&ICON_AVATAR];
    let PropertyValueEnum::WadChunkLink(link) = value else {
        panic!("expected a WadChunkLink");
    };
    assert_eq!(link.value, WadHash::hash_str(ICON));
}

/// A fix run offered twice applies once, because the second pass matches
/// `to` and raises nothing at all.
#[test]
fn a_second_run_over_a_repaired_file_finds_nothing() {
    let (_, written) = fix_all(&bin_with(ICON_AVATAR, text(ICON)));
    assert!(found(&written).is_empty());
}

/// The whole road end to end: the mod's own table names the hash, the check
/// calls the finding repairable, the fix writes the link, and the path
/// survives in the project's game table under the new hash.
#[test]
fn a_fix_rehashes_a_hash_the_mods_own_table_names() {
    const PATH: &str = "assets/fixture/rehash_target.dds";
    let vfx = BinHash::hash_str("VfxAssetRemap");
    let old_asset = BinHash::hash_str("oldAsset");
    let bin = Bin::new(
        [BinObject::<NoMeta>::builder(ENTRY, vfx)
            .property(old_asset, values::Hash::new(BinHash::hash_str(PATH)))
            .build()],
        std::iter::empty::<&str>(),
    );

    let tmp = tempfile::tempdir().unwrap();
    declare_binhashes(tmp.path(), &[PATH]);
    let dir = tmp.path().join("content").join("base").join("data");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("skin0.bin");
    std::fs::write(&file, bytes_of(&bin)).unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    assert!(problems[0].fix.is_some(), "a named hash is repairable");

    let borrowed: Vec<&Problem> = problems.iter().collect();
    let mut run = FixRun::open(
        tmp.path(),
        vec!["16.17.8087655".to_owned()],
        None,
        Config::default(),
        None,
    );
    let applied = BinPropertyType::new().fix(&borrowed, &mut run).unwrap();
    run.finish().unwrap();
    assert_eq!(applied.applied, 1);
    assert_eq!(applied.skipped, 0);

    let written = read_bin(&file).unwrap();
    let value = &written.objects[&ENTRY].properties[&old_asset];
    let PropertyValueEnum::WadChunkLink(link) = value else {
        panic!("expected a WadChunkLink");
    };
    assert_eq!(link.value, WadHash::hash_str(PATH));

    let table = std::fs::read_to_string(tmp.path().join("hashes").join("game.hashes.txt")).unwrap();
    assert!(table.contains(PATH), "{table}");
}

/// A hash nothing names stays a problem, and the run counts it skipped
/// rather than pretending at it.
#[test]
fn a_fix_leaves_an_unnamed_hash_alone_and_counts_it_skipped() {
    let vfx = BinHash::hash_str("VfxAssetRemap");
    let old_asset = BinHash::hash_str("oldAsset");
    let bin = Bin::new(
        [BinObject::<NoMeta>::builder(ENTRY, vfx)
            .property(old_asset, values::Hash::new(BinHash(0x1111_2222)))
            .build()],
        std::iter::empty::<&str>(),
    );

    let (applied, written) = fix_all(&bin);
    assert_eq!(applied.applied, 0);
    assert_eq!(applied.skipped, 1);

    let value = &written.objects[&ENTRY].properties[&old_asset];
    assert!(matches!(value, PropertyValueEnum::Hash(_)), "untouched");
}

#[test]
fn a_fix_repairs_every_shape_the_class_carries() {
    let mut map = values::Map::empty(Kind::Hash, Kind::String);
    map.push(values::Hash::new(BinHash(1)).into(), text(ICON).into())
        .unwrap();

    let object = BinObject::<NoMeta>::builder(ENTRY, SKIN)
        .property(ICON_AVATAR, text(ICON))
        .property(
            ALTERNATE_ICONS_CIRCLE,
            values::Container::String {
                items: vec![text("a.dds")],
                meta: NoMeta,
            },
        )
        .property(
            ICON_CIRCLE,
            values::Optional::String {
                value: Some(text(ICON)),
                meta: NoMeta,
            },
        )
        .property(UNCENSORED_ICON_CIRCLES, map)
        .build();
    let bin = Bin::new([object], std::iter::empty::<&str>());

    assert_eq!(found(&bin).len(), 4);
    let (applied, written) = fix_all(&bin);
    assert_eq!(applied.applied, 4);
    assert_eq!(applied.skipped, 0);
    assert!(found(&written).is_empty());
}

#[test]
fn a_fix_leaves_a_property_the_rule_raised_nothing_for_alone() {
    let object = BinObject::<NoMeta>::builder(ENTRY, SKIN)
        .property(ICON_AVATAR, text(ICON))
        .property(BinHash(0xdead_beef), text("untouched.dds"))
        .build();
    let bin = Bin::new([object], std::iter::empty::<&str>());

    let (_, written) = fix_all(&bin);
    let value = &written.objects[&ENTRY].properties[&BinHash(0xdead_beef)];
    let PropertyValueEnum::String(kept) = value else {
        panic!("expected a String");
    };
    assert_eq!(kept.value, "untouched.dds");
}

/// The user changed the file in another tool between the run and the fix.
/// The rule re-derives from disk, so it must not write a hash over a
/// property that no longer holds a string.
#[test]
fn a_problem_the_file_no_longer_matches_is_counted_as_skipped() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("content").join("base").join("data");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("skin0.bin");
    std::fs::write(&file, bytes_of(&bin_with(ICON_AVATAR, text(ICON)))).unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let mut report = Report::default();
    let rule = BinPropertyType::new();
    rule.check(&files, &mut report);
    let (problems, _) = report.finish();

    std::fs::write(&file, bytes_of(&bin_with(ICON_AVATAR, values::I32::new(7)))).unwrap();

    let borrowed: Vec<&Problem> = problems.iter().collect();
    let mut run = FixRun::open(tmp.path(), Vec::new(), None, Config::default(), None);
    let applied = rule.fix(&borrowed, &mut run).unwrap();

    assert_eq!(applied.applied, 0);
    assert_eq!(applied.skipped, 1);

    let value = &read_bin(&file).unwrap().objects[&ENTRY].properties[&ICON_AVATAR];
    assert!(matches!(value, PropertyValueEnum::I32(_)));
}

// ---- reading ----------------------------------------------------------

#[test]
fn a_file_that_is_not_a_bin_is_a_failure_and_not_a_panic() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("content").join("base");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("broken.bin"), b"not a bin at all").unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let mut report = Report::default();
    BinPropertyType::new().check(&files, &mut report);
    let (problems, failed) = report.finish();

    assert!(problems.is_empty());
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].rule, ID);
    assert_eq!(failed[0].site.as_ref().unwrap().path, "broken.bin");
}
