//! Unit tests for the rule's findings, its severity, its previews and its fixes.

use super::*;
use crate::config::Config;
use fs_err as fs;
use ltk_meta::{Bin, BinFile, BinObject};

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
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("skin0.bin"), bytes_of(bin)).unwrap();

    let config = config_beside(tmp.path(), installed);
    let files = ProjectFiles::read(tmp.path(), &config, None).unwrap();
    (tmp, files)
}

/// The config a project at `root` runs under, naming a game install on
/// `installed` where there is one.
fn config_beside(root: &std::path::Path, installed: Option<GameBuild>) -> Config {
    let mut config = Config::default();
    if let Some(build) = installed {
        let league = root.join("league");
        fs::create_dir_all(league.join("Game")).unwrap();
        fs::write(
            league.join("Game").join("content-metadata.json"),
            format!(r#"{{ "version": "{build}" }}"#),
        )
        .unwrap();
        config.league_path = Some(league);
    }
    config
}

/// One object carrying the four `hash_value` shapes, each still holding a path.
fn every_shape() -> Bin {
    let mut map = values::Map::empty(Kind::Hash, Kind::String).expect("kinds a map can hold");
    map.push(values::Hash::new(BinHash(1)).into(), text(ICON).into())
        .unwrap();
    let object = BinObject::<NoMeta>::builder(ENTRY, SKIN)
        .property(ICON_AVATAR, text(ICON))
        .property(
            ALTERNATE_ICONS_CIRCLE,
            values::Container::from(vec![text("a.dds")]),
        )
        .property(ICON_CIRCLE, values::Optional::from(text(ICON)))
        .property(UNCENSORED_ICON_CIRCLES, map)
        .build();
    Bin::new([object], std::iter::empty::<&str>())
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
    fs::write(
        root.join("mod.config.json"),
        config
            .to_config_string(ltk_mod_project::ConfigFormat::Json)
            .unwrap(),
    )
    .unwrap();
    fs::create_dir_all(root.join("hashes")).unwrap();
    fs::write(root.join("hashes").join(file), paths.join("\n") + "\n").unwrap();
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
    let (problems, failed) = files.report(&[&BinPropertyType::new()]).finish();
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
    assert_eq!(
        node.path, "089aff69",
        "the hash form is what the file holds"
    );
    assert_eq!(
        node.label.as_deref(),
        Some("iconAvatar"),
        "the table names this field"
    );
}

/// The check is one visitor over either tree: mounted as a stream it reads
/// the same findings, at the same addresses, as it reads off the parsed tree.
#[test]
fn the_check_reads_a_stream_as_it_reads_the_tree() {
    let bytes = bytes_of(&every_shape());
    let nothing = BinNames::none();
    let lens = Lens {
        tables: table::tables(),
        schema: None,
        names: &nothing,
    };

    let parsed = BinFile::from_reader(&mut std::io::Cursor::new(&bytes)).unwrap();
    let owned: Vec<(BinHash, String, BinHash)> = check_bin(&parsed, lens)
        .into_iter()
        .map(|(entry, hit)| (entry, hit.address.into_hashes(), hit.migration.field))
        .collect();

    let mut stream = ltk_meta::BinStream::<_, NoMeta>::mount(std::io::Cursor::new(&bytes)).unwrap();
    let mut check = Check::new(lens);
    stream.walk::<ltk_meta::Error, _>(&mut check).unwrap();
    let viewed: Vec<(BinHash, String, BinHash)> = check
        .found
        .into_iter()
        .map(|(entry, hit)| (entry, hit.address.into_hashes(), hit.migration.field))
        .collect();

    assert_eq!(
        owned.len(),
        4,
        "every shape the fixture carries is a finding"
    );
    assert_eq!(viewed, owned);
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
            expected: "file".to_owned(),
            found: "string".to_owned(),
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
    let text = note(migration, &value, &BinNames::none(), None, table_build)
        .expect("an unresolvable rehash speaks up");

    assert!(text.contains("0x5ae41520"), "{text}");
    assert!(text.contains("FNV1a Hash value"), "{text}");
    assert!(text.contains("64-bit xxHash"), "{text}");
    assert!(
        text.contains("Mimir hashtables nor the mod's own"),
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

    assert_eq!(note(migration, &value, &names, None, table_build), None);
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
    let items: values::Container = vec![text("a.dds"), text("b.dds"), text("c.dds")].into();
    let problems = found(&bin_with(ALTERNATE_ICONS_CIRCLE, items));

    let fix = problems[0].fix.as_ref().unwrap();
    assert_eq!(
        problems[0].mismatch,
        Some(TypeMismatch {
            expected: "list[file]".to_owned(),
            found: "list[string]".to_owned(),
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
    let items: values::Container =
        vec![text("ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds")].into();
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
/// altogether, because the patches either side of the change are what they
/// read in Riot's notes.
#[test]
fn the_builds_it_compared_stay_out_of_the_sentence() {
    let (_tmp, files) = project_on(&bin_with(ICON_AVATAR, text(ICON)), Some(BEFORE_TABLE));

    let dormancy = BinPropertyType::new().dormant(&files).unwrap();
    assert!(!dormancy.reason.contains("8087655"), "{}", dormancy.reason);
    assert!(!dormancy.reason.contains("8049184"), "{}", dormancy.reason);
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
    let mut value: PropertyValueEnum =
        values::Container::from(vec![text("a.dds"), text("b.dds")]).into();
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
    let mut present: PropertyValueEnum = values::Optional::from(text(ICON)).into();
    assert!(convert(
        &mut present,
        migration_for(ICON_CIRCLE),
        &BinNames::none()
    ));
    let PropertyValueEnum::Optional(present) = &present else {
        panic!("expected an Optional");
    };
    assert_eq!(present.item_kind(), Kind::WadChunkLink);
    assert!(present.is_some());

    let mut absent: PropertyValueEnum = values::Optional::empty(Kind::String)
        .expect("a kind an optional can hold")
        .into();
    assert!(convert(
        &mut absent,
        migration_for(ICON_CIRCLE),
        &BinNames::none()
    ));
    let PropertyValueEnum::Optional(absent) = &absent else {
        panic!("expected an Optional");
    };
    assert_eq!(absent.item_kind(), Kind::WadChunkLink);
    assert!(absent.is_none());
}

#[test]
fn hash_value_rebuilds_a_map_and_leaves_its_keys_alone() {
    let key: PropertyValueEnum = values::Hash::new(BinHash(0xabcd_1234)).into();
    let mut map = values::Map::empty(Kind::Hash, Kind::String).expect("kinds a map can hold");
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

    let mut map = values::Map::empty(Kind::Hash, Kind::String).expect("kinds a map can hold");
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

    let mut map = values::Map::empty(Kind::Hash, Kind::String).expect("kinds a map can hold");
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

    let mut map = values::Map::empty(Kind::Hash, Kind::String).expect("kinds a map can hold");
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
            &values::Map::empty(Kind::Hash, Kind::String)
                .expect("kinds a map can hold")
                .into(),
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

    let mut map = values::Map::empty(Kind::Hash, Kind::String).expect("kinds a map can hold");
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

/// A hit under an index and under a map key: the address the check records
/// is the address the repair's own trail matches on.
#[test]
fn a_fix_reaches_a_property_under_an_index_and_a_key() {
    const NESTED: BinHash = BinHash(0x0000_1111);
    const KEYED: BinHash = BinHash(0x0000_2222);

    let skin = || values::Struct {
        class_hash: SKIN,
        properties: IndexMap::from([(ICON_AVATAR, text(ICON).into())]),
        meta: NoMeta,
    };
    let list = values::Container::new(Kind::Struct, vec![skin().into()])
        .expect("a struct is a kind a container holds");
    let mut map = values::Map::empty(Kind::String, Kind::Struct).expect("kinds a map can hold");
    map.push(text("k").into(), skin().into()).unwrap();
    let bin = Bin::new(
        [BinObject::<NoMeta>::builder(ENTRY, SKIN)
            .property(NESTED, list)
            .property(KEYED, map)
            .build()],
        std::iter::empty::<&str>(),
    );

    let mut paths: Vec<String> = found(&bin)
        .into_iter()
        .map(|problem| problem.site.node.unwrap().path)
        .collect();
    paths.sort();
    assert_eq!(paths, ["00001111[0].089aff69", r#"00002222{"k"}.089aff69"#]);

    let (applied, repaired) = fix_all(&bin);
    assert_eq!(
        applied,
        Applied {
            applied: 2,
            skipped: 0
        }
    );
    let nothing = BinNames::none();
    let lens = Lens {
        tables: table::tables(),
        schema: None,
        names: &nothing,
    };
    assert!(check_bin(&repaired, lens).is_empty());
}

/// Builds a project, runs the check, applies every problem, and hands back
/// what the run reported plus the bin that landed on disk.
fn fix_all(bin: &Bin) -> (Applied, BinFile) {
    fix_all_on(bin, None)
}

/// [`fix_all`], beside a game install on `installed`.
fn fix_all_on(bin: &Bin, installed: Option<GameBuild>) -> (Applied, BinFile) {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("content").join("base").join("data");
    fs::create_dir_all(&dir).unwrap();
    let file = dir.join("skin0.bin");
    fs::write(&file, bytes_of(bin)).unwrap();

    let config = config_beside(tmp.path(), installed);
    let files = ProjectFiles::read(tmp.path(), &config, None).unwrap();
    let rule = BinPropertyType::new();
    let (problems, _) = files.report(&[&rule]).finish();

    let borrowed: Vec<&Problem> = problems.iter().collect();
    let mut run = FixRun::open(
        tmp.path(),
        vec!["16.17.8087655".to_owned()],
        None,
        config,
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

    let value = &written.objects()[&ENTRY].properties[&ICON_AVATAR];
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
    assert!(found(written.as_prop().unwrap()).is_empty());
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
    fs::create_dir_all(&dir).unwrap();
    let file = dir.join("skin0.bin");
    fs::write(&file, bytes_of(&bin)).unwrap();

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
    let value = &written.objects()[&ENTRY].properties[&old_asset];
    let PropertyValueEnum::WadChunkLink(link) = value else {
        panic!("expected a WadChunkLink");
    };
    assert_eq!(link.value, WadHash::hash_str(PATH));

    let table = fs::read_to_string(tmp.path().join("hashes").join("game.hashes.txt")).unwrap();
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

    let value = &written.objects()[&ENTRY].properties[&old_asset];
    assert!(matches!(value, PropertyValueEnum::Hash(_)), "untouched");
}

#[test]
fn a_fix_repairs_every_shape_the_class_carries() {
    let bin = every_shape();

    assert_eq!(found(&bin).len(), 4);
    let (applied, written) = fix_all(&bin);
    assert_eq!(applied.applied, 4);
    assert_eq!(applied.skipped, 0);
    assert!(found(written.as_prop().unwrap()).is_empty());
}

#[test]
fn a_fix_leaves_a_property_the_rule_raised_nothing_for_alone() {
    let object = BinObject::<NoMeta>::builder(ENTRY, SKIN)
        .property(ICON_AVATAR, text(ICON))
        .property(BinHash(0xdead_beef), text("untouched.dds"))
        .build();
    let bin = Bin::new([object], std::iter::empty::<&str>());

    let (_, written) = fix_all(&bin);
    let value = &written.objects()[&ENTRY].properties[&BinHash(0xdead_beef)];
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
    fs::create_dir_all(&dir).unwrap();
    let file = dir.join("skin0.bin");
    fs::write(&file, bytes_of(&bin_with(ICON_AVATAR, text(ICON)))).unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let rule = BinPropertyType::new();
    let (problems, _) = files.report(&[&rule]).finish();

    fs::write(&file, bytes_of(&bin_with(ICON_AVATAR, values::I32::new(7)))).unwrap();

    let borrowed: Vec<&Problem> = problems.iter().collect();
    let mut run = FixRun::open(tmp.path(), Vec::new(), None, Config::default(), None);
    let applied = rule.fix(&borrowed, &mut run).unwrap();

    assert_eq!(applied.applied, 0);
    assert_eq!(applied.skipped, 1);

    let written = read_bin(&file).unwrap();
    let value = &written.objects()[&ENTRY].properties[&ICON_AVATAR];
    assert!(matches!(value, PropertyValueEnum::I32(_)));
}

// ---- reading ----------------------------------------------------------

#[test]
fn a_file_that_is_not_a_bin_is_a_failure_and_not_a_panic() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("content").join("base");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("broken.bin"), b"not a bin at all").unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();
    let (problems, failed) = files.report(&[&BinPropertyType::new()]).finish();

    assert!(problems.is_empty());
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].rule, ID);
    assert_eq!(failed[0].site.as_ref().unwrap().path, "broken.bin");
}

/* The schema-driven half. The shipped table carries 395 rows for one build,
and it covers that build's String -> File event completely. What the database
adds is the other 166 of the 525 properties Riot has retyped, every one of the
249 builds it knows rather than one, and a check over all 21,100 properties
instead of the ones somebody wrote down. */

/// `FloatTextIconData`, the class behind the icon on a floating combat text.
const FLOAT_TEXT_ICON_DATA: BinHash = BinHash(0x16d8_8f43);

/// `mIconFileName`, which Riot retyped `String` to `File` in 16.17.
const M_ICON_FILE_NAME: BinHash = BinHash(0x1053_7b0c);

/// The first build the database records that retype at.
const AFTER_RETYPE: GameBuild = GameBuild::new(16, 17, 8_104_348);

/// The last build it records the property as a `String` at.
const BEFORE_RETYPE: GameBuild = GameBuild::new(16, 16, 8_049_184);

const ICON_TEX: &str = "ASSETS/UX/FloatingText/GoldIcon.tex";

/// A property no shipped table row names, retyped `U32` to `F32` long before the
/// table's own build. It is here to check the database and nothing else.
const GOLD_VALUES: BinHash = BinHash(0x0e6f_0047);
const TURRET_GOLD_VALUE: BinHash = BinHash(0x0b97_305a);

/// A build inside the revision that made it an `F32`.
const AFTER_GOLD_RETYPE: GameBuild = GameBuild::new(13, 21, 5_876_777);

fn object_bin(class: BinHash, field: BinHash, value: impl Into<PropertyValueEnum>) -> Bin {
    Bin::new(
        [BinObject::<NoMeta>::builder(ENTRY, class)
            .property(field, value)
            .build()],
        std::iter::empty::<&str>(),
    )
}

/// Story: this is the shape of defect that reached a player. A mod writes a
/// texture reference as a `String`, the game on this build reads the field as a
/// `File`, and the value is discarded without a word - the member keeps its
/// constructor default, which for a retyped `File` field is `0` rather than an
/// empty string. What loads is a null resource, and the crash lands far away.
#[test]
fn a_string_where_the_schema_says_file_is_reported() {
    let bin = object_bin(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, text(ICON_TEX));
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].severity, Severity::Fatal);
    let mismatch = problems[0].mismatch.as_ref().expect("a type pair");
    assert_eq!(mismatch.expected, "file");
    assert_eq!(mismatch.found, "string");
}

/// Story: the same bytes are correct for the build they were authored against.
/// A mod is not wrong in the abstract, it is wrong for a game, so the database
/// is only ever asked about the build in front of it.
#[test]
fn the_same_string_is_correct_on_the_build_that_wanted_a_string() {
    let bin = object_bin(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, text(ICON_TEX));
    let (_tmp, files) = project_on(&bin, Some(BEFORE_RETYPE));

    let problems = check_with(&files);

    assert!(
        problems
            .iter()
            .all(|problem| problem.severity == Severity::Warning),
        "on this build the game reads a String, so anything said is about the change coming"
    );
}

/// The repair is the one the whole `String` -> `File` migration takes: the path
/// is in the file, so the fix is one hash and one tag.
#[test]
fn the_schema_finding_repairs_by_hashing_the_path_it_holds() {
    let bin = object_bin(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, text(ICON_TEX));
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);
    let fix = problems[0].fix.as_ref().expect("the path is in the file");

    assert_eq!(fix.before.as_deref(), Some(&*format!("\"{ICON_TEX}\"")));
    assert_eq!(
        fix.after.as_deref(),
        Some(&*format!("0x{:016x}", WadHash::hash_str(ICON_TEX).0))
    );
}

/// The premise the next tests rest on: no table row names this property, so
/// anything found is the database's doing.
#[test]
fn no_shipped_table_row_names_the_database_only_property() {
    assert!(
        table::tables()
            .iter()
            .all(|table| table.migration(GOLD_VALUES, TURRET_GOLD_VALUE).is_none())
    );
}

/// Story: the table is one build's worth of one migration. The database knows
/// every build it was dumped at, so a retype years older than the table - and a
/// kind pair the table never covered - is still caught.
#[test]
fn a_retype_no_table_row_covers_is_reported() {
    let bin = object_bin(GOLD_VALUES, TURRET_GOLD_VALUE, values::U32::new(500));
    let (_tmp, files) = project_on(&bin, Some(AFTER_GOLD_RETYPE));

    let problems = check_with(&files);

    assert_eq!(problems.len(), 1);
    let mismatch = problems[0].mismatch.as_ref().expect("a type pair");
    assert_eq!(mismatch.expected, "f32");
    assert_eq!(mismatch.found, "u32");
}

/// Nothing this build knows turns a `U32` into an `F32` that means the same, so
/// the finding stands and offers no repair rather than guessing at one.
#[test]
fn a_kind_pair_with_no_known_conversion_is_reported_without_a_repair() {
    let bin = object_bin(GOLD_VALUES, TURRET_GOLD_VALUE, values::U32::new(500));
    let (_tmp, files) = project_on(&bin, Some(AFTER_GOLD_RETYPE));

    let problems = check_with(&files);

    assert_eq!(problems[0].fix, None);
    let message = problems[0].message.as_deref().unwrap_or_default();
    assert!(message.contains("Nothing rewrites"), "{message}");
}

/// A property the database describes and is content about is silence, or the
/// rule would report every mod that is already correct.
#[test]
fn a_property_the_schema_is_content_about_reports_nothing() {
    let bin = object_bin(GOLD_VALUES, TURRET_GOLD_VALUE, values::F32::new(500.0));
    let (_tmp, files) = project_on(&bin, Some(AFTER_GOLD_RETYPE));

    assert!(check_with(&files).is_empty());
}

/// Without an install there is no build to judge against, and a revision is
/// keyed on one. Reporting anyway would pick a build the reader does not run.
#[test]
fn without_an_install_the_schema_is_asked_nothing() {
    let bin = object_bin(GOLD_VALUES, TURRET_GOLD_VALUE, values::U32::new(500));
    let (_tmp, files) = project(&bin);

    assert!(check_with(&files).is_empty());
}

/// Story: Riot ships property bins under a bare name, and a mod that replaces
/// one ships it the same way. `UX/FloatingText` is such a file, and until the
/// walk read its first bytes it was classified by an extension it does not have
/// so no bin rule ever opened it, and a mod carrying 27 wrong-typed properties
/// checked clean.
#[test]
fn a_bin_with_no_extension_is_read_like_any_other() {
    let bin = object_bin(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, text(ICON_TEX));

    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp
        .path()
        .join("content")
        .join("base")
        .join("UI.wad.client")
        .join("UX");
    fs::create_dir_all(&dir).unwrap();
    // No extension, which is how the game itself names this file.
    fs::write(dir.join("FloatingText"), bytes_of(&bin)).unwrap();

    let league = tmp.path().join("league");
    fs::create_dir_all(league.join("Game")).unwrap();
    fs::write(
        league.join("Game").join("content-metadata.json"),
        format!(r#"{{ "version": "{AFTER_RETYPE}" }}"#),
    )
    .unwrap();
    let config = Config {
        league_path: Some(league),
        ..Config::default()
    };

    let files = ProjectFiles::read(tmp.path(), &config, None).unwrap();
    let problems = check_with(&files);

    assert_eq!(problems.len(), 1, "the file is a bin whatever it is named");
    assert_eq!(problems[0].site.path, "UI.wad.client/UX/FloatingText");
}

/// A file whose extension names nothing is not content, and reading the first
/// bytes of every `.txt` and `.md` in a project would be work for no finding.
#[test]
fn a_file_with_an_unrecognised_extension_is_left_alone() {
    let bin = object_bin(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, text(ICON_TEX));

    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("content").join("base").join("data");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("notes.txt"), bytes_of(&bin)).unwrap();

    let files = ProjectFiles::read(tmp.path(), &Config::default(), None).unwrap();

    assert!(check_with(&files).is_empty());
}

/// Story: an archive-storage mod is checked where it lies, never unpacked, so
/// the archive scan has to identify a bare-named bin the same way the walk does
/// - by its first bytes. The mod that reached a player was exactly this shape.
#[test]
fn a_bin_with_no_extension_is_read_inside_an_archive_too() {
    use crate::mods::test_support::{make_loose_bin_fantome_zip_at, resolver_naming};
    use crate::problems::Budget;

    let bin = object_bin(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, text(ICON_TEX));
    let tmp = tempfile::tempdir().unwrap();
    let archive = tmp.path().join("mod.fantome");
    make_loose_bin_fantome_zip_at(&archive, "Mod", "UI.wad.client/UX/FloatingText", &bin);

    let league = tmp.path().join("league");
    fs::create_dir_all(league.join("Game")).unwrap();
    fs::write(
        league.join("Game").join("content-metadata.json"),
        format!(r#"{{ "version": "{AFTER_RETYPE}" }}"#),
    )
    .unwrap();
    let config = Config {
        league_path: Some(league),
        ..Config::default()
    };

    let files = ProjectFiles::in_archive(
        &archive,
        &config,
        Budget::repair(),
        &resolver_naming(&[]),
        None,
    )
    .unwrap();

    let problems = check_with(&files);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].site.path, "UI.wad.client/UX/FloatingText");
}

/// Story: the database names an `Option` on both sides of the retype, so the
/// kind alone agrees, and the table row that answer supersedes is never asked.
/// A complex property is judged on what it holds as well.
#[test]
fn a_complex_property_is_checked_on_its_subtypes_as_well() {
    let bin = every_shape();
    assert_eq!(
        found(&bin).len(),
        4,
        "without an install the table finds all four"
    );

    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));
    let problems = check_with(&files);

    let paths: Vec<_> = problems
        .iter()
        .map(|problem| problem.site.node.as_ref().unwrap().path.clone())
        .collect();
    assert_eq!(problems.len(), 4, "beside an install: {paths:?}");
}

/// `MaxMaterialDriver`, whose `mDrivers` the schema types `List<Pointer>`.
const MAX_MATERIAL_DRIVER: BinHash = BinHash(0x0006_516a);
const M_DRIVERS: BinHash = BinHash(0x7ace_ca0f);
/// A `Pointer` on `SkinCharacterDataProperties`.
const SECONDARY_RESOURCE_HUD: BinHash = BinHash(0xe431_b198);
const DRIVER: BinHash = BinHash(0x2222_3333);

/// Story: a mod writes `list[none]` where the game reads `list[pointer]`, and
/// a `none` where it reads a `pointer`. Both point at nothing, and the format
/// has one spelling for that: a pointer with a zero class hash.
#[test]
fn a_none_where_the_schema_says_pointer_is_repaired_as_a_null_pointer() {
    let nones = values::Container::new(Kind::None, vec![Kind::None.default_value(); 2])
        .expect("a list of none");
    let skin = BinObject::<NoMeta>::builder(ENTRY, SKIN)
        .property(SECONDARY_RESOURCE_HUD, Kind::None.default_value())
        .build();
    let driver = BinObject::<NoMeta>::builder(DRIVER, MAX_MATERIAL_DRIVER)
        .property(M_DRIVERS, nones)
        .build();
    let bin = Bin::new([skin, driver], std::iter::empty::<&str>());
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));
    let problems = check_with(&files);
    assert_eq!(problems.len(), 2);
    assert!(
        problems.iter().all(|problem| problem.fix.is_some()),
        "each is repairable"
    );

    let (applied, written) = fix_all_on(&bin, Some(AFTER_RETYPE));

    assert_eq!(applied.applied, 2);
    assert_eq!(applied.skipped, 0);
    let PropertyValueEnum::Struct(pointer) =
        &written.objects()[&ENTRY].properties[&SECONDARY_RESOURCE_HUD]
    else {
        panic!("expected a Pointer");
    };
    assert_eq!(pointer.class_hash, BinHash(0), "a pointer to nothing");
    let PropertyValueEnum::Container(items) = &written.objects()[&DRIVER].properties[&M_DRIVERS]
    else {
        panic!("expected a List");
    };
    assert_eq!(items.item_kind(), Kind::Struct);
    assert_eq!(items.len(), 2, "each none became a pointer");
    assert!(items.items().iter().all(|item| matches!(
        item,
        PropertyValueEnum::Struct(inner) if inner.class_hash == BinHash(0)
    )));
}

/// The repair judges against the same install the check did, so what the
/// schema reports on a complex property it rewrites as well - by the same
/// road the table row takes, since only what the property holds crosses.
#[test]
fn a_complex_property_is_repaired_on_its_subtypes_as_well() {
    let bin = every_shape();
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));
    assert!(
        check_with(&files)
            .iter()
            .all(|problem| problem.fix.is_some()),
        "each shape is repairable"
    );

    let (applied, written) = fix_all_on(&bin, Some(AFTER_RETYPE));

    assert_eq!(applied.applied, 4);
    assert_eq!(applied.skipped, 0);
    let value = &written.objects()[&ENTRY].properties[&ICON_CIRCLE];
    let PropertyValueEnum::Optional(option) = value else {
        panic!("expected an Optional");
    };
    assert_eq!(option.item_kind(), Kind::WadChunkLink);
    let link = option
        .value()
        .and_then(|held| held.get::<values::WadChunkLink>())
        .expect("the path it held, hashed");
    assert_eq!(link.value, WadHash::hash_str(ICON));
}

// ---- the roads that move no value ---------------------------------------

/// `MatchmakingQueue`, whose `GameTypeConfigId` Riot widened from `U8` to `U32`.
const MATCHMAKING_QUEUE: BinHash = BinHash(0xd99f_f7e6);
const GAME_TYPE_CONFIG_ID: BinHash = BinHash(0x0ecb_2d58);

/// A `fontWeight` Riot moved the other way, from `U32` down to `U8`.
const TEXT_STYLE_DATA: BinHash = BinHash(0x92c8_c778);
const FONT_WEIGHT: BinHash = BinHash(0x2bf7_7ed0);

/// `TftScoreboardViewController`, whose `PlayerSelfTemplate` was an `Embed` and
/// is a `Pointer`, beside the class it holds.
const TFT_SCOREBOARD: BinHash = BinHash(0x4934_0fba);
const PLAYER_SELF_TEMPLATE: BinHash = BinHash(0x9ad5_b45c);
const PLAYER_TEMPLATE_CLASS: BinHash = BinHash(0x9034_7ed8);

/// A `particleLifetime` that went the other way, from `Pointer` to `Embed`,
/// beside the class it holds.
const VFX_EMITTER: BinHash = BinHash(0x287a_50ff);
const PARTICLE_LIFETIME: BinHash = BinHash(0x2a55_2694);
const LIFETIME_CLASS: BinHash = BinHash(0xafe1_d569);

/// A migration the way [`derived`] builds one, for a pair no table names.
fn crossing(from: TypeSpec, to: TypeSpec) -> Migration {
    Migration {
        class: SKIN,
        field: ICON_AVATAR,
        class_name: None,
        field_name: None,
        conversion: Conversion::between(&from, &to),
        from,
        to,
    }
}

/// Story: a mod authored before Riot widened the field writes the number in one
/// byte, and the game now reads four. Every value of the narrow type is a value
/// of the wide one, so the number crosses whole and only the tag changes.
#[test]
fn an_integer_the_game_widened_is_rewritten_at_the_wider_type() {
    let bin = object_bin(MATCHMAKING_QUEUE, GAME_TYPE_CONFIG_ID, values::U8::new(42));
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    let mismatch = problems[0].mismatch.as_ref().expect("a type pair");
    assert_eq!(mismatch.expected, "u32");
    assert_eq!(mismatch.found, "u8");
    assert!(problems[0].fix.is_some(), "the number crosses whole");

    let (applied, written) = fix_all_on(&bin, Some(AFTER_RETYPE));

    assert_eq!(applied.applied, 1);
    assert_eq!(applied.skipped, 0);
    assert_eq!(
        written.objects()[&ENTRY].properties[&GAME_TYPE_CONFIG_ID],
        values::U32::new(42).into()
    );
}

/// The other direction drops the top of the number, so there is nothing to
/// offer and the row stands without a repair rather than guessing at one.
#[test]
fn an_integer_the_game_narrowed_is_reported_without_a_repair() {
    let bin = object_bin(TEXT_STYLE_DATA, FONT_WEIGHT, values::U32::new(700));
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].fix, None);
}

/// A container crosses on what it holds, so a list of narrow integers is
/// rebuilt item by item. No shipped revision retypes one, and a mod that
/// declared the wrong item type reaches the same road.
#[test]
fn widening_rebuilds_a_container_under_the_wider_item_type() {
    let list_of = |item| TypeSpec {
        value: Some(item),
        ..TypeSpec::bare(Kind::Container)
    };
    let migration = crossing(list_of(Kind::U8), list_of(Kind::U32));
    let mut value: PropertyValueEnum = values::Container::new(
        Kind::U8,
        vec![values::U8::new(1).into(), values::U8::new(255).into()],
    )
    .expect("a list of bytes")
    .into();

    assert!(convert(&mut value, &migration, &BinNames::none()));

    let PropertyValueEnum::Container(items) = &value else {
        panic!("expected a List");
    };
    assert_eq!(items.item_kind(), Kind::U32);
    assert_eq!(
        items.items(),
        [values::U32::new(1).into(), values::U32::new(255).into()]
    );
}

/// A map crosses on its values and an option on what it holds. An option
/// holding nothing crosses too, because it declares an item type either way.
#[test]
fn widening_reaches_a_map_value_and_an_option_that_holds_nothing() {
    let map_of = |value| TypeSpec {
        key: Some(Kind::String),
        value: Some(value),
        ..TypeSpec::bare(Kind::Map)
    };
    let mut map = values::Map::empty(Kind::String, Kind::U16).expect("kinds a map can hold");
    map.push(text("small").into(), values::U16::new(9).into())
        .unwrap();
    let mut value: PropertyValueEnum = map.into();

    assert!(convert(
        &mut value,
        &crossing(map_of(Kind::U16), map_of(Kind::U32)),
        &BinNames::none()
    ));

    let PropertyValueEnum::Map(map) = &value else {
        panic!("expected a Map");
    };
    assert_eq!(map.key_kind(), Kind::String, "the keys are untouched");
    assert_eq!(map.value_kind(), Kind::U32);
    assert_eq!(map.entries()[0].1, values::U32::new(9).into());

    let option_of = |item| TypeSpec {
        value: Some(item),
        ..TypeSpec::bare(Kind::Optional)
    };
    let mut value: PropertyValueEnum = values::Optional::empty(Kind::I8)
        .expect("an option of bytes")
        .into();

    assert!(convert(
        &mut value,
        &crossing(option_of(Kind::I8), option_of(Kind::I32)),
        &BinNames::none()
    ));

    let PropertyValueEnum::Optional(option) = &value else {
        panic!("expected an Optional");
    };
    assert_eq!(option.item_kind(), Kind::I32);
    assert!(option.is_none());
}

/// Story: an option holding nothing still declares what it would hold, and this
/// mod declares the type the game read a patch ago. There is no value under it
/// to carry across, so the declaration is the whole repair - and it is one even
/// where the two item types have no road between them, which `Hash` and `File`
/// do not.
#[test]
fn an_empty_option_is_re_declared_under_the_item_type_the_game_reads() {
    let empty = values::Optional::empty(Kind::Hash).expect("an option of hashes");
    let bin = object_bin(SKIN, ICON_CIRCLE, empty);
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    assert!(problems[0].fix.is_some(), "nothing under it has to cross");

    let (applied, written) = fix_all_on(&bin, Some(AFTER_RETYPE));

    assert_eq!(applied.applied, 1);
    assert_eq!(applied.skipped, 0);
    let PropertyValueEnum::Optional(option) = &written.objects()[&ENTRY].properties[&ICON_CIRCLE]
    else {
        panic!("expected an Optional");
    };
    assert_eq!(option.item_kind(), Kind::WadChunkLink);
    assert!(option.is_none(), "it held nothing and still holds nothing");
}

/// The same option holding a value is the one this cannot repair: a `Hash` is
/// FNV1a32 of a path where a `File` is XXH64 of it, and inside an option
/// neither the table nor the schema opens that road.
#[test]
fn an_option_that_holds_a_value_still_needs_a_road_for_it() {
    let held = values::Optional::from(values::Hash::new(BinHash(0x5ae4_1520)));
    let bin = object_bin(SKIN, ICON_CIRCLE, held);
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].fix, None);
}

/// Story: Riot has moved fields between `Embed` and `Pointer` 28 times in three
/// years, and `PlayerSelfTemplate` is one of them. The two are one encoding
/// under two tags, so the class hash and the body stay put.
#[test]
fn an_embed_the_game_reads_as_a_pointer_is_retagged() {
    let embed = values::Embedded(values::Struct {
        class_hash: PLAYER_TEMPLATE_CLASS,
        properties: IndexMap::new(),
        meta: NoMeta,
    });
    let bin = object_bin(TFT_SCOREBOARD, PLAYER_SELF_TEMPLATE, embed);
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    assert!(problems[0].fix.is_some());

    let (applied, written) = fix_all_on(&bin, Some(AFTER_RETYPE));

    assert_eq!(applied.applied, 1);
    assert_eq!(applied.skipped, 0);
    let PropertyValueEnum::Struct(pointer) =
        &written.objects()[&ENTRY].properties[&PLAYER_SELF_TEMPLATE]
    else {
        panic!("expected a Pointer");
    };
    assert_eq!(
        pointer.class_hash, PLAYER_TEMPLATE_CLASS,
        "the class is kept"
    );
}

/// And the same road the other way, which is the direction Riot took more
/// often.
#[test]
fn a_pointer_the_game_reads_as_an_embed_is_retagged() {
    let pointer = values::Struct {
        class_hash: LIFETIME_CLASS,
        properties: IndexMap::new(),
        meta: NoMeta,
    };
    let bin = object_bin(VFX_EMITTER, PARTICLE_LIFETIME, pointer);
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    assert!(problems[0].fix.is_some());

    let (applied, written) = fix_all_on(&bin, Some(AFTER_RETYPE));

    assert_eq!(applied.applied, 1);
    assert_eq!(applied.skipped, 0);
    let PropertyValueEnum::Embedded(embed) =
        &written.objects()[&ENTRY].properties[&PARTICLE_LIFETIME]
    else {
        panic!("expected an Embed");
    };
    assert_eq!(embed.0.class_hash, LIFETIME_CLASS, "the class is kept");
}

/// A repaired file is one the next run says nothing about, which is what lets
/// the panel offer a fix twice.
#[test]
fn a_second_run_over_the_new_roads_finds_nothing() {
    let bin = object_bin(MATCHMAKING_QUEUE, GAME_TYPE_CONFIG_ID, values::U8::new(42));
    let (_, written) = fix_all_on(&bin, Some(AFTER_RETYPE));
    let (_tmp, files) = project_on(written.as_prop().unwrap(), Some(AFTER_RETYPE));

    assert!(check_with(&files).is_empty());
}

/// `TFTModeData`, whose `ItemTagOptions` Riot moved from `List` to `List2`.
const TFT_MODE_DATA: BinHash = BinHash(0x01d7_548e);
const ITEM_TAG_OPTIONS: BinHash = BinHash(0x12aa_f1d8);

/// `VfxEmissionCylinder`, whose `IncludeCaps` Riot moved from `Bool` to `Flag`.
const VFX_EMISSION_CYLINDER: BinHash = BinHash(0x0eea_aebe);
const INCLUDE_CAPS: BinHash = BinHash(0xfb40_f022);

/// A `FaceTarget` the schema has typed `Bool` throughout.
const PERSISTENT_VFX_DATA: BinHash = BinHash(0x00fa_43e4);
const FACE_TARGET: BinHash = BinHash(0x945b_0ec5);

/// Story: a `List` and a `List2` are one vector under two tags - the ordering
/// is a promise about the reader, not a difference in the bytes - and Riot has
/// retagged 43 fields between them. Nothing under the tag moves.
#[test]
fn a_list_the_game_reads_as_a_list2_is_retagged() {
    let hashes = values::Container::new(
        Kind::Hash,
        vec![
            values::Hash::new(BinHash(0x1111_2222)).into(),
            values::Hash::new(BinHash(0x3333_4444)).into(),
        ],
    )
    .expect("a list of hashes");
    let bin = object_bin(TFT_MODE_DATA, ITEM_TAG_OPTIONS, hashes.clone());
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    let mismatch = problems[0].mismatch.as_ref().expect("a type pair");
    assert_eq!(mismatch.expected, "list2[hash]");
    assert_eq!(mismatch.found, "list[hash]");
    assert!(problems[0].fix.is_some());

    let (applied, written) = fix_all_on(&bin, Some(AFTER_RETYPE));

    assert_eq!(applied.applied, 1);
    assert_eq!(applied.skipped, 0);
    let PropertyValueEnum::UnorderedContainer(items) =
        &written.objects()[&ENTRY].properties[&ITEM_TAG_OPTIONS]
    else {
        panic!("expected a List2");
    };
    assert_eq!(items.0, hashes, "every item is where it was");
}

/// And the same road the other way, on a field the schema types `List`.
#[test]
fn a_list2_the_game_reads_as_a_list_is_retagged() {
    let drivers = values::UnorderedContainer(
        values::Container::new(
            Kind::Struct,
            vec![
                values::Struct {
                    class_hash: MAX_MATERIAL_DRIVER,
                    properties: IndexMap::new(),
                    meta: NoMeta,
                }
                .into(),
            ],
        )
        .expect("a list of pointers"),
    );
    let bin = object_bin(MAX_MATERIAL_DRIVER, M_DRIVERS, drivers);
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    assert!(problems[0].fix.is_some());

    let (applied, written) = fix_all_on(&bin, Some(AFTER_RETYPE));

    assert_eq!(applied.applied, 1);
    assert_eq!(applied.skipped, 0);
    let PropertyValueEnum::Container(items) = &written.objects()[&ENTRY].properties[&M_DRIVERS]
    else {
        panic!("expected a List");
    };
    assert_eq!(items.item_kind(), Kind::Struct);
    assert_eq!(items.len(), 1);
}

/// `HeroFloatingInfoCharacterStateIndicatorList`, whose `StateIndicatorList`
/// changed its ordering and its item type in one go.
const STATE_INDICATOR_LIST_CLASS: BinHash = BinHash(0x47c7_ce74);
const STATE_INDICATOR_LIST: BinHash = BinHash(0xfd81_566b);

/// Only the tag moves on this road, so a list whose items also disagree is one
/// it cannot finish. `List<Hash>` to `List2<Embed>` would have to build the
/// objects as well, and nothing does that.
#[test]
fn a_list_whose_items_also_disagree_is_reported_without_a_repair() {
    let hashes = values::Container::new(
        Kind::Hash,
        vec![values::Hash::new(BinHash(0x1111_2222)).into()],
    )
    .expect("a list of hashes");
    let bin = object_bin(STATE_INDICATOR_LIST_CLASS, STATE_INDICATOR_LIST, hashes);
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);

    assert_eq!(problems.len(), 1);
    let mismatch = problems[0].mismatch.as_ref().expect("a type pair");
    assert_eq!(mismatch.expected, "list2[embed]");
    assert_eq!(mismatch.found, "list[hash]");
    assert_eq!(problems[0].fix, None);
}

/// Story: a `Flag` is one bit of a byte the game packs several of into one
/// member, and a `Bool` is that byte on its own. On the wire both are one byte,
/// zero or not, so the value the mod wrote survives the retag whole.
#[test]
fn a_bool_the_game_reads_as_a_flag_is_retagged() {
    let bin = object_bin(VFX_EMISSION_CYLINDER, INCLUDE_CAPS, values::Bool::new(true));
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    let mismatch = problems[0].mismatch.as_ref().expect("a type pair");
    assert_eq!(mismatch.expected, "flag", "the word ritobin uses");
    assert_eq!(mismatch.found, "bool");
    assert!(problems[0].fix.is_some());

    let (applied, written) = fix_all_on(&bin, Some(AFTER_RETYPE));

    assert_eq!(applied.applied, 1);
    assert_eq!(applied.skipped, 0);
    assert_eq!(
        written.objects()[&ENTRY].properties[&INCLUDE_CAPS],
        values::BitBool::new(true).into(),
        "true stays true"
    );
}

/// And the same road the other way, on a field the schema types `Bool`.
#[test]
fn a_flag_the_game_reads_as_a_bool_is_retagged() {
    let bin = object_bin(PERSISTENT_VFX_DATA, FACE_TARGET, values::BitBool::new(true));
    let (_tmp, files) = project_on(&bin, Some(AFTER_RETYPE));

    let problems = check_with(&files);
    assert_eq!(problems.len(), 1);
    assert!(problems[0].fix.is_some());

    let (applied, written) = fix_all_on(&bin, Some(AFTER_RETYPE));

    assert_eq!(applied.applied, 1);
    assert_eq!(applied.skipped, 0);
    assert_eq!(
        written.objects()[&ENTRY].properties[&FACE_TARGET],
        values::Bool::new(true).into()
    );
}

/// The check over a project, which the pass mounts as a stream, reports what
/// it reports over the same bytes parsed whole, at the same addresses.
#[test]
fn the_check_over_a_stream_matches_the_check_over_the_owned_tree() {
    let bin = every_shape();
    let mut streamed: Vec<String> = found(&bin)
        .into_iter()
        .map(|problem| problem.site.node.unwrap().path)
        .collect();
    streamed.sort();

    let nothing = BinNames::none();
    let lens = Lens {
        tables: table::tables(),
        schema: None,
        names: &nothing,
    };
    let mut owned: Vec<String> = check_bin(&BinFile::Prop(bin), lens)
        .into_iter()
        .map(|(_, hit)| hit.address.into_hashes())
        .collect();
    owned.sort();

    assert!(!owned.is_empty());
    assert_eq!(streamed, owned);
}

// ---- the two roads that cross on both halves -------------------------

/// Patch 16.18, which retyped `EvolutionDescription:mIconNames` and
/// `UiElementParticleSystemData:TextureOverrides` on both halves at once.
const AFTER_16_18: GameBuild = GameBuild::new(16, 18, 8_159_717);

/// The row the database's answer at `build` amounts to, for a value of this
/// shape. What [`derived`] builds when a check hits one.
fn schema_migration(
    class: &str,
    field: &str,
    build: GameBuild,
    value: &PropertyValueEnum,
) -> Migration {
    let class = BinHash::hash_str(class);
    let field = BinHash::hash_str(field);
    let schema = meta_schema::MetaSchema::shipped();
    let expected = schema
        .expected(class, field, build)
        .unwrap_or_else(|| panic!("the shipped database names {class:#010x}:{field:#010x}"));
    derived(class, field, expected, value)
}

/// Story: a mod holds its icons as a `List2` of paths and 16.18 reads a `List`
/// of `File`. The ordering tag and the item type are independent - the vector
/// is the same bytes either way - so one road takes both.
#[test]
fn a_list2_of_paths_the_game_reads_as_a_list_of_files_crosses_on_both() {
    const PATH: &str = "assets/fixture/evolution_icon.dds";
    let mut value: PropertyValueEnum =
        values::UnorderedContainer(values::Container::from(vec![text(PATH)])).into();
    let migration = schema_migration("EvolutionDescription", "mIconNames", AFTER_16_18, &value);

    assert_eq!(migration.from.label(), "list2[string]");
    assert_eq!(migration.to.label(), "list[file]");
    assert_eq!(migration.conversion, Conversion::RetagHashValue);
    assert!(preview(&migration, &value, &BinNames::none()).is_some());

    assert!(convert(&mut value, &migration, &BinNames::none()));

    let PropertyValueEnum::Container(items) = &value else {
        panic!("expected a List");
    };
    assert_eq!(items.item_kind(), Kind::WadChunkLink);
    assert_eq!(
        items.items()[0]
            .get::<values::WadChunkLink>()
            .unwrap()
            .value,
        WadHash::hash_str(PATH)
    );
}

/// Story: 16.18 moved `TextureOverrides` to `File` on both sides of the map.
/// The keys go the way a rehash does, through the path behind each one, and
/// the values go the way every other path does.
#[test]
fn a_map_that_moves_its_keys_and_its_values_is_rekeyed_and_rehashed() {
    const KEY: &str = "assets/fixture/override_key.dds";
    const HELD: &str = "assets/fixture/override_value.dds";
    let (_tmp, names) = names_of(&[KEY]);

    let mut map = values::Map::empty(Kind::Hash, Kind::String).expect("kinds a map can hold");
    map.push(
        values::Hash::new(BinHash::hash_str(KEY)).into(),
        text(HELD).into(),
    )
    .unwrap();
    let mut value: PropertyValueEnum = map.into();
    let migration = schema_migration(
        "UiElementParticleSystemData",
        "TextureOverrides",
        AFTER_16_18,
        &value,
    );

    assert_eq!(migration.from.label(), "map[hash,string]");
    assert_eq!(migration.to.label(), "map[file,file]");
    assert_eq!(migration.conversion, Conversion::HashKeyValue);
    assert!(preview(&migration, &value, &names).is_some());

    assert!(convert(&mut value, &migration, &names));

    let PropertyValueEnum::Map(map) = &value else {
        panic!("expected a Map");
    };
    assert_eq!(map.key_kind(), Kind::WadChunkLink);
    assert_eq!(map.value_kind(), Kind::WadChunkLink);
    let (key, held) = &map.entries()[0];
    assert_eq!(
        key.get::<values::WadChunkLink>().unwrap().value,
        WadHash::hash_str(KEY)
    );
    assert_eq!(
        held.get::<values::WadChunkLink>().unwrap().value,
        WadHash::hash_str(HELD)
    );
}

/// The keys are the half that can fail. A key no table names back to its path
/// has no road to `File`, and the values crossing anyway would leave the map
/// read under two hash functions.
#[test]
fn a_map_with_an_unnamed_key_crosses_neither_half() {
    const HELD: &str = "assets/fixture/override_value.dds";
    let mut map = values::Map::empty(Kind::Hash, Kind::String).expect("kinds a map can hold");
    map.push(
        values::Hash::new(BinHash(0x1111_2222)).into(),
        text(HELD).into(),
    )
    .unwrap();
    let mut value: PropertyValueEnum = map.into();
    let migration = schema_migration(
        "UiElementParticleSystemData",
        "TextureOverrides",
        AFTER_16_18,
        &value,
    );
    let before = value.clone();

    assert_eq!(migration.conversion, Conversion::HashKeyValue);
    assert!(preview(&migration, &value, &BinNames::none()).is_none());
    assert!(!convert(&mut value, &migration, &BinNames::none()));
    assert_eq!(value, before, "not even the values moved");

    let message = note(
        &migration,
        &value,
        &BinNames::none(),
        Some(AFTER_16_18),
        AFTER_16_18,
    )
    .expect("a note naming the key it is missing");
    assert!(message.contains("0x11112222"), "{message}");
}

/// The whole point of the two roads: a 16.18 install is offered a repair where
/// it used to be told to rebuild the mod.
#[test]
fn the_16_18_both_halves_retypes_are_reported_repairable() {
    const PATH: &str = "assets/fixture/evolution_icon.dds";
    let icons = values::UnorderedContainer(values::Container::from(vec![text(PATH)]));
    let bin = object_bin(
        BinHash::hash_str("EvolutionDescription"),
        BinHash::hash_str("mIconNames"),
        icons,
    );
    let (_tmp, files) = project_on(&bin, Some(AFTER_16_18));

    let problems = check_with(&files);

    assert_eq!(problems.len(), 1);
    let mismatch = problems[0].mismatch.as_ref().expect("a type pair");
    assert_eq!(mismatch.expected, "list[file]");
    assert_eq!(mismatch.found, "list2[string]");
    assert!(problems[0].fix.is_some());
    assert_eq!(problems[0].message, None, "no rebuild-the-mod sentence");
}
