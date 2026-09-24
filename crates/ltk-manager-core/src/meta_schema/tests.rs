//! What the schema answers, and what it declines to answer.

use ltk_game_data::Schema as _;

use super::*;

/// The build `FloatTextIconData.mIconFileName` was a `String` at.
const BEFORE_RETYPE: GameBuild = GameBuild::new(16, 16, 8_049_184);

/// The build it became a `File` at, which is 16.17.
const AFTER_RETYPE: GameBuild = GameBuild::new(16, 17, 8_104_348);

const FLOAT_TEXT_ICON_DATA: BinHash = BinHash(0x16d8_8f43);
const M_ICON_FILE_NAME: BinHash = BinHash(0x1053_7b0c);
const M_OFFSET: BinHash = BinHash(0x26db_cd4b);
/// An `Option` on both sides of the retype, so the kind alone cannot tell them apart.
const ICON_CIRCLE: BinHash = BinHash(0xe672_84f4);
const UNCENSORED_ICON_CIRCLES: BinHash = BinHash(0x8ce0_4c3d);
/// A `List` the schema fixes at seven items.
const M_VALUES: BinHash = BinHash(0x0a1b_2c3d);
/// An `Option` holding a type this build cannot map.
const M_HOLDS_SOMETHING_NEW: BinHash = BinHash(0x0bad_f00d);

/// The published shape, cut to the one class the case turns on.
fn published() -> String {
    String::from(
        r#"{
          "formatVersion": 1,
          "hashSource": { "fetchedAt": "2026-08-24T03:56:00Z" },
          "latest": 8104348,
          "versions": [
            { "patch": "16.16", "build": 8049184 },
            { "patch": "16.17", "build": 8104348 }
          ],
          "classes": {
            "0x16d88f43": {
              "name": "FloatTextIconData",
              "properties": {
                "0x10537b0c": {
                  "name": "mIconFileName",
                  "revisions": [
                    { "from": 5229820, "to": 8049184, "type": ["String", "0x0", "0x0", "0x0"] },
                    { "from": 8104348, "type": ["File", "0x0", "0x0", "0x0"] }
                  ]
                },
                "0x26dbcd4b": {
                  "name": "mOffset",
                  "revisions": [
                    { "from": 5229820, "type": ["Vec2", "0x0", "0x0", "0x0"] }
                  ]
                },
                "0xdeadbeef": {
                  "name": "mUnnameable",
                  "revisions": [
                    { "from": 5229820, "type": ["SomethingNew", "0x0", "0x0", "0x0"] }
                  ]
                },
                "0xe67284f4": {
                  "name": "iconCircle",
                  "revisions": [
                    { "from": 5229820, "to": 8049184, "type": ["Option", "0x0", "String", "0x0"] },
                    { "from": 8104348, "type": ["Option", "0x0", "File", "0x0"] }
                  ]
                },
                "0x8ce04c3d": {
                  "name": "uncensoredIconCircles",
                  "revisions": [
                    { "from": 5229820, "type": ["Map", "Hash", "File", "0x0"] }
                  ]
                },
                "0x0a1b2c3d": {
                  "name": "mValues",
                  "revisions": [
                    { "from": 5229820, "type": ["List", "0x7", "F32", "0x0"] }
                  ]
                },
                "0x0badf00d": {
                  "name": "mHoldsSomethingNew",
                  "revisions": [
                    { "from": 5229820, "type": ["Option", "0x0", "SomethingNew", "0x0"] }
                  ]
                }
              }
            }
          }
        }"#,
    )
}

fn schema() -> MetaSchema {
    MetaSchema::parse(published().as_bytes()).expect("the fixture is the published shape")
}

/// A class deriving from `FloatTextIconData` from `from` on, and declaring nothing.
const DERIVED: BinHash = BinHash(0x0000_0abc);

/// The fixture with `classes`, a comma-separated run of class entries, ahead of its own.
fn schema_with(classes: &str) -> MetaSchema {
    let json = published().replace(r#""classes": {"#, &format!(r#""classes": {{ {classes},"#));
    MetaSchema::parse(json.as_bytes()).expect("the fixture is the published shape")
}

/// A class entry at `hash` deriving from `bases` over the builds `from` to `to`.
fn class_entry(hash: &str, from: u32, to: Option<u32>, bases: &[&str], properties: &str) -> String {
    let to = to.map_or_else(String::new, |to| format!(r#", "to": {to}"#));
    let bases = bases
        .iter()
        .map(|base| format!("\"{base}\""))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        r#""{hash}": {{
          "name": "Class{hash}",
          "revisions": [{{ "from": {from}{to}, "bases": [{bases}], "interface": false, "value": false }}],
          "properties": {{ {properties} }}
        }}"#
    )
}

/// The fixture with [`DERIVED`] deriving from `FloatTextIconData` at every build.
fn derived_schema() -> MetaSchema {
    schema_with(&class_entry("0x00000abc", 1, None, &["0x16d88f43"], ""))
}

/// The field of `card` called `name`.
fn field<'a>(card: &'a ClassSchema, name: &str) -> &'a FieldSchema {
    card.fields
        .iter()
        .find(|field| field.name.as_deref() == Some(name))
        .unwrap_or_else(|| panic!("the class has a field named {name}"))
}

#[test]
fn class_cards_include_inherited_constructor_fields() {
    let schema = derived_schema();
    let card = schema.class_schema(DERIVED, Some(AFTER_RETYPE)).unwrap();

    assert_eq!(
        field(&card, "mOffset").declared,
        Some(KindShape::bare(PropertyKind::Vector2))
    );
}

#[test]
fn a_lineage_runs_from_the_class_to_its_bases() {
    let schema = derived_schema();

    assert_eq!(
        schema.lineage(DERIVED, Some(AFTER_RETYPE)),
        [DERIVED, FLOAT_TEXT_ICON_DATA]
    );
    assert_eq!(
        schema.lineage(BinHash(0x0bad_cafe), None),
        [BinHash(0x0bad_cafe)]
    );
}

#[test]
fn constructor_defaults_distinguish_null_from_missing() {
    let null: PublishedRevision = serde_json::from_str(r#"{"from":1,"default":null}"#).unwrap();
    let missing: PublishedRevision = serde_json::from_str(r#"{"from":1}"#).unwrap();

    assert_eq!(null.default, Some(serde_json::Value::Null));
    assert_eq!(missing.default, None);
}

#[test]
fn emitter_scale_keeps_its_property_specific_constructor_default() {
    let schema = MetaSchema::shipped();
    let card = schema.class_schema(BinHash(0x09cd_e442), None).unwrap();
    let scale = field(&card, "birthScale0");
    let value: serde_json::Value =
        serde_json::from_str(scale.default_value.as_ref().unwrap()).unwrap();

    assert_eq!(scale.class_hash.as_deref(), Some("0x68dc32b6"));
    assert_eq!(value["constantValue"], serde_json::json!([1.0, 1.0, 1.0]));
    assert_eq!(value["dynamics"], serde_json::Value::Null);
}

#[test]
fn a_class_answers_its_fields_named_first_with_their_types_at_a_build() {
    let card = schema()
        .class_schema(FLOAT_TEXT_ICON_DATA, Some(AFTER_RETYPE))
        .expect("a class the database describes");

    assert_eq!(card.name.as_deref(), Some("FloatTextIconData"));
    assert_eq!(card.build, 8_104_348);
    let names: Vec<_> = card
        .fields
        .iter()
        .map(|field| field.name.as_deref().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "iconCircle",
            "mHoldsSomethingNew",
            "mIconFileName",
            "mOffset",
            "mUnnameable",
            "mValues",
            "uncensoredIconCircles",
        ]
    );

    let icon = field(&card, "mIconFileName");
    assert_eq!(icon.hash, "0x10537b0c");
    assert_eq!(
        icon.declared,
        Some(KindShape::bare(PropertyKind::WadChunkLink))
    );
    assert_eq!(
        icon.revisions,
        vec![
            FieldRevision {
                from: 5_229_820,
                to: Some(8_049_184),
                shape: Some(KindShape::bare(PropertyKind::String)),
            },
            FieldRevision {
                from: 8_104_348,
                to: None,
                shape: Some(KindShape::bare(PropertyKind::WadChunkLink)),
            },
        ]
    );
    assert_eq!(
        field(&card, "uncensoredIconCircles").declared,
        Some(KindShape {
            kind: PropertyKind::Map,
            key: Some(PropertyKind::Hash),
            value: Some(PropertyKind::WadChunkLink),
        })
    );
    assert_eq!(
        field(&card, "mValues").declared,
        Some(KindShape {
            kind: PropertyKind::Container,
            key: None,
            value: Some(PropertyKind::F32),
        })
    );
    assert_eq!(field(&card, "mUnnameable").declared, None);
    assert_eq!(
        field(&card, "mUnnameable").revisions,
        vec![FieldRevision {
            from: 5_229_820,
            to: None,
            shape: None,
        }]
    );
}

#[test]
fn a_class_without_a_build_answers_at_the_newest_the_database_names() {
    let card = schema().class_schema(FLOAT_TEXT_ICON_DATA, None).unwrap();

    assert_eq!(card.build, 8_104_348);
    assert_eq!(
        field(&card, "mIconFileName").declared,
        Some(KindShape::bare(PropertyKind::WadChunkLink))
    );
}

#[test]
fn a_build_past_the_database_answers_at_the_newest_it_names() {
    let card = schema()
        .class_schema(FLOAT_TEXT_ICON_DATA, Some(GameBuild::new(17, 1, 9_000_000)))
        .unwrap();

    assert_eq!(card.build, 8_104_348);
}

#[test]
fn a_field_no_revision_covers_has_no_type_at_that_build() {
    let between = GameBuild::new(16, 16, 8_060_000);
    let card = schema()
        .class_schema(FLOAT_TEXT_ICON_DATA, Some(between))
        .unwrap();

    assert_eq!(card.build, 8_060_000);
    assert_eq!(field(&card, "mIconFileName").declared, None);
    assert_eq!(
        field(&card, "mOffset").declared,
        Some(KindShape::bare(PropertyKind::Vector2))
    );
}

#[test]
fn a_class_the_database_does_not_describe_answers_nothing() {
    assert_eq!(schema().class_schema(BinHash(0x1), None), None);
}

#[test]
fn the_schema_at_a_build_declares_types_only_where_it_describes_the_build() {
    let schema = schema();

    let unbuilt = schema.at(None);
    assert_eq!(unbuilt.build(), None);
    assert!(
        unbuilt
            .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME)
            .is_none()
    );
    assert_eq!(
        schema.at(Some(GameBuild::new(17, 1, 9_000_000))).build(),
        None
    );

    let at = schema.at(Some(AFTER_RETYPE));
    assert_eq!(at.build(), Some(AFTER_RETYPE));
    assert_eq!(
        at.expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME)
            .unwrap()
            .shape,
        Some(Shape::bare(Kind::WadChunkLink))
    );
    assert!(at.expected(FLOAT_TEXT_ICON_DATA, BinHash(0x1)).is_none());
}

#[test]
fn a_patch_schema_types_an_edit_by_the_revision_at_its_build() {
    let schema = Arc::new(schema());
    let before = PatchSchema::new(Arc::clone(&schema), Some(BEFORE_RETYPE));
    let after = PatchSchema::new(schema, Some(AFTER_RETYPE));

    assert_eq!(
        before.expected(FLOAT_TEXT_ICON_DATA, ICON_CIRCLE),
        Some(ltk_game_data::Shape {
            kind: Kind::Optional,
            key: None,
            item: Some(Kind::String),
        })
    );
    assert_eq!(
        after.expected(FLOAT_TEXT_ICON_DATA, ICON_CIRCLE),
        Some(ltk_game_data::Shape {
            kind: Kind::Optional,
            key: None,
            item: Some(Kind::WadChunkLink),
        })
    );
    assert_eq!(
        after.expected(FLOAT_TEXT_ICON_DATA, UNCENSORED_ICON_CIRCLES),
        Some(ltk_game_data::Shape {
            kind: Kind::Map,
            key: Some(Kind::Hash),
            item: Some(Kind::WadChunkLink),
        })
    );
}

/// Story: silence types the edit from the base bin. A game newer than the database
/// is typed that way rather than by the newest revision it names.
#[test]
fn a_patch_schema_says_nothing_where_the_database_is_silent() {
    let schema = Arc::new(schema());
    let past = PatchSchema::new(Arc::clone(&schema), Some(GameBuild::new(17, 1, 9_000_000)));
    let unbuilt = PatchSchema::new(Arc::clone(&schema), None);
    let at = PatchSchema::new(schema, Some(AFTER_RETYPE));

    assert_eq!(past.expected(FLOAT_TEXT_ICON_DATA, M_OFFSET), None);
    assert_eq!(unbuilt.expected(FLOAT_TEXT_ICON_DATA, M_OFFSET), None);
    assert_eq!(
        at.expected(FLOAT_TEXT_ICON_DATA, BinHash(0xdead_beef)),
        None,
        "a type this build cannot map"
    );
    assert_eq!(at.expected(FLOAT_TEXT_ICON_DATA, BinHash(0x1)), None);
    assert_eq!(at.expected(BinHash(0x1), M_OFFSET), None);
}

/// Story: a field the game's copy omits on a patch the database has not caught up with
/// takes the type the newest described build gives it.
#[test]
fn a_patch_schema_falls_back_to_the_newest_described_build() {
    let schema = Arc::new(schema());
    let newest = PatchSchema::new(
        Arc::clone(&schema),
        Some(GameBuild::new(16, 99, schema.latest())),
    );
    let past = PatchSchema::new(Arc::clone(&schema), Some(GameBuild::new(17, 1, 9_000_000)));
    let unbuilt = PatchSchema::new(schema, None);

    let at_newest = newest.expected(FLOAT_TEXT_ICON_DATA, M_OFFSET);
    assert!(at_newest.is_some());
    assert_eq!(past.fallback(FLOAT_TEXT_ICON_DATA, M_OFFSET), at_newest);
    assert_eq!(unbuilt.fallback(FLOAT_TEXT_ICON_DATA, M_OFFSET), at_newest);
    assert_eq!(past.fallback(FLOAT_TEXT_ICON_DATA, BinHash(0x1)), None);
}

/// Story: an edit names the class of the object it lands on, and most of that class's
/// fields are its bases'.
#[test]
fn a_patch_schema_types_a_field_a_base_declares() {
    let schema = Arc::new(derived_schema());
    let at = PatchSchema::new(Arc::clone(&schema), Some(AFTER_RETYPE));
    let past = PatchSchema::new(schema, Some(GameBuild::new(17, 1, 9_000_000)));

    assert_eq!(
        at.expected(DERIVED, ICON_CIRCLE),
        Some(ltk_game_data::Shape {
            kind: Kind::Optional,
            key: None,
            item: Some(Kind::WadChunkLink),
        })
    );
    assert_eq!(past.expected(DERIVED, ICON_CIRCLE), None);
}

#[test]
fn a_patch_schema_knows_every_class_the_database_holds_named_or_not() {
    let unnamed = published().replace(r#""name": "FloatTextIconData","#, "");
    let schema = MetaSchema::parse(unnamed.as_bytes()).unwrap();
    assert_eq!(schema.class_name(FLOAT_TEXT_ICON_DATA), None);
    let schema = PatchSchema::new(Arc::new(schema), Some(AFTER_RETYPE));

    assert!(schema.has_class(FLOAT_TEXT_ICON_DATA));
    assert!(!schema.has_class(BinHash(0x1)));
}

/// Story: a class new on patch day is one the database has not taken yet, and refusing
/// a pin to it is a refusal the database has no ground for.
#[test]
fn a_patch_schema_knows_every_class_at_a_build_the_database_does_not_describe() {
    let schema = Arc::new(schema());
    let past = PatchSchema::new(Arc::clone(&schema), Some(GameBuild::new(17, 1, 9_000_000)));
    let unbuilt = PatchSchema::new(schema, None);

    assert!(past.has_class(BinHash(0x1)));
    assert!(unbuilt.has_class(BinHash(0x1)));
}

/// Story: the database writes a field once, on the class that declares it. A derived
/// class holds the field all the same, and the game reads it at the base's type.
#[test]
fn a_field_a_base_declares_answers_on_the_derived_class() {
    let schema = derived_schema();

    let found = schema
        .expected(DERIVED, M_ICON_FILE_NAME, AFTER_RETYPE)
        .expect("the base declares it");

    assert_eq!(found.shape, Some(Shape::bare(Kind::WadChunkLink)));
    assert_eq!(
        found.class_name,
        Some("Class0x00000abc"),
        "the class asked about"
    );
    assert_eq!(found.field_name, Some("mIconFileName"));
}

#[test]
fn a_nearer_class_hides_the_field_on_its_base() {
    let schema = schema_with(&class_entry(
        "0x00000abc",
        1,
        None,
        &["0x16d88f43"],
        r#""0x10537b0c": { "name": "mIconFileName", "revisions": [{ "from": 1, "type": ["String", "0x0", "0x0", "0x0"] }] }"#,
    ));

    assert_eq!(
        schema
            .expected(DERIVED, M_ICON_FILE_NAME, AFTER_RETYPE)
            .unwrap()
            .shape,
        Some(Shape::bare(Kind::String))
    );
}

#[test]
fn a_base_the_class_takes_after_a_build_answers_nothing_at_it() {
    let schema = schema_with(&class_entry(
        "0x00000abc",
        8_104_348,
        None,
        &["0x16d88f43"],
        "",
    ));

    assert_eq!(schema.expected(DERIVED, M_OFFSET, BEFORE_RETYPE), None);
    assert!(schema.expected(DERIVED, M_OFFSET, AFTER_RETYPE).is_some());
}

#[test]
fn a_cycle_in_the_bases_ends_the_walk() {
    let schema = schema_with(&format!(
        "{}, {}",
        class_entry("0x00000abc", 1, None, &["0x00000abd"], ""),
        class_entry("0x00000abd", 1, None, &["0x00000abc"], ""),
    ));

    assert_eq!(schema.expected(DERIVED, M_OFFSET, AFTER_RETYPE), None);
    assert_eq!(schema.field_name(DERIVED, M_OFFSET), None);
}

/// A name is the database's at every build, so a base the class took only once still
/// names the field.
#[test]
fn a_field_a_base_declares_is_named_on_the_derived_class_at_any_build() {
    let schema = schema_with(&class_entry("0x00000abc", 1, Some(2), &["0x16d88f43"], ""));

    assert_eq!(schema.field_name(DERIVED, M_OFFSET), Some("mOffset"));
    assert_eq!(schema.field_name(DERIVED, BinHash(0x1)), None);
}

#[test]
fn the_schema_names_a_field_at_every_build() {
    let schema = schema();

    assert_eq!(
        schema
            .at(None)
            .field_name(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME),
        Some("mIconFileName")
    );
    assert_eq!(schema.field_name(FLOAT_TEXT_ICON_DATA, BinHash(0x1)), None);
    assert_eq!(schema.field_name(BinHash(0x1), M_ICON_FILE_NAME), None);
}

/// Story: this is the case the whole rule exists for. A mod writes the field as
/// a `String`, the game on 16.17 registers it as a `File`, and the game throws
/// the value away without a word.
#[test]
fn a_retyped_property_answers_per_build() {
    let schema = schema();

    let before = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, BEFORE_RETYPE)
        .expect("the database covers 16.16");
    let after = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, AFTER_RETYPE)
        .expect("the database covers 16.17");

    assert_eq!(before.shape, Some(Shape::bare(Kind::String)));
    assert_eq!(after.shape, Some(Shape::bare(Kind::WadChunkLink)));
    assert_eq!(after.class_name, Some("FloatTextIconData"));
    assert_eq!(after.field_name, Some("mIconFileName"));
}

/// Story: `iconCircle` is an `Option` before and after Riot retyped what it
/// holds, so the kind alone calls both sides equal. What a complex type holds
/// is part of the answer, or the retype is invisible.
#[test]
fn a_complex_type_answers_with_its_subtypes() {
    let schema = schema();

    let before = schema
        .expected(FLOAT_TEXT_ICON_DATA, ICON_CIRCLE, BEFORE_RETYPE)
        .unwrap();
    let after = schema
        .expected(FLOAT_TEXT_ICON_DATA, ICON_CIRCLE, AFTER_RETYPE)
        .unwrap();
    let map = schema
        .expected(FLOAT_TEXT_ICON_DATA, UNCENSORED_ICON_CIRCLES, AFTER_RETYPE)
        .unwrap();

    assert_eq!(
        before.shape,
        Some(Shape {
            kind: Kind::Optional,
            key: None,
            value: Some(Kind::String),
        })
    );
    assert_eq!(
        after.shape,
        Some(Shape {
            kind: Kind::Optional,
            key: None,
            value: Some(Kind::WadChunkLink),
        })
    );
    assert_eq!(
        map.shape,
        Some(Shape {
            kind: Kind::Map,
            key: Some(Kind::Hash),
            value: Some(Kind::WadChunkLink),
        })
    );
}

/// A list writes its fixed size where a map writes its key kind, and a count
/// is not a type name to refuse the whole revision over.
#[test]
fn a_fixed_size_list_answers_its_item_kind_and_no_key() {
    let schema = schema();

    let found = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_VALUES, AFTER_RETYPE)
        .unwrap();

    assert_eq!(
        found.shape,
        Some(Shape {
            kind: Kind::Container,
            key: None,
            value: Some(Kind::F32),
        })
    );
}

/// A subtype this build cannot map is as unreadable as a kind it cannot, so
/// the revision declines to answer rather than answering for the wrapper alone.
#[test]
fn an_unmappable_subtype_answers_without_a_type() {
    let schema = schema();

    let found = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_HOLDS_SOMETHING_NEW, AFTER_RETYPE)
        .expect("the revision is found");

    assert_eq!(found.shape, None);
    assert_eq!(found.field_name, Some("mHoldsSomethingNew"));
}

/// A revision's `to` is the last build it held for, not the first build after
/// it, so the two revisions must not both claim the build on the boundary.
#[test]
fn the_end_of_a_revision_is_inclusive() {
    let schema = schema();

    let at_boundary = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, BEFORE_RETYPE)
        .unwrap();

    assert_eq!(
        at_boundary.shape,
        Some(Shape::bare(Kind::String)),
        "8049184 is the last build of the String revision, not the first of the File one"
    );
}

/// A property that never changed answers the same at every build.
#[test]
fn a_property_with_one_revision_answers_everywhere() {
    let schema = schema();

    for build in [BEFORE_RETYPE, AFTER_RETYPE] {
        let found = schema
            .expected(FLOAT_TEXT_ICON_DATA, M_OFFSET, build)
            .unwrap();
        assert_eq!(found.shape, Some(Shape::bare(Kind::Vector2)));
    }
}

/// Story: a schema that says nothing is not evidence of anything, so an unknown
/// class, an unknown property and a build before the first revision are all
/// silence rather than a mismatch.
#[test]
fn what_the_database_does_not_describe_is_silence() {
    let schema = schema();

    assert_eq!(
        schema.expected(BinHash(0x0000_0001), M_ICON_FILE_NAME, AFTER_RETYPE),
        None,
        "a class it does not hold"
    );
    assert_eq!(
        schema.expected(FLOAT_TEXT_ICON_DATA, BinHash(0x0000_0001), AFTER_RETYPE),
        None,
        "a property it does not hold"
    );
    assert_eq!(
        schema.expected(
            FLOAT_TEXT_ICON_DATA,
            M_ICON_FILE_NAME,
            GameBuild::new(13, 14, 5_000_000)
        ),
        None,
        "a build older than every revision"
    );
}

/// A type name this build cannot map is a revision that answers `None` rather
/// than one that answers wrongly. The revision is still found, so the property
/// is not mistaken for one the database does not describe.
#[test]
fn an_unmappable_type_name_answers_without_a_kind() {
    let schema = schema();

    let found = schema
        .expected(FLOAT_TEXT_ICON_DATA, BinHash(0xdead_beef), AFTER_RETYPE)
        .expect("the revision is found");

    assert_eq!(found.shape, None);
    assert_eq!(found.field_name, Some("mUnnameable"));
}

/// Story: a game newer than the database is one the database cannot speak
/// about, and checking against a stale schema would report a mod as broken for
/// a change the schema has not taken yet.
#[test]
fn a_build_past_the_database_is_one_it_does_not_describe() {
    let schema = schema();

    assert!(schema.describes(AFTER_RETYPE));
    assert!(schema.describes(BEFORE_RETYPE));
    assert!(!schema.describes(GameBuild::new(16, 18, 8_200_000)));
}

#[test]
fn a_database_at_another_layout_is_refused() {
    let json = published().replace("\"formatVersion\": 1", "\"formatVersion\": 2");

    let error = MetaSchema::parse(json.as_bytes()).expect_err("a layout this build does not read");

    assert!(
        matches!(error, MetaSchemaError::Format { found: 2 }),
        "{error:?}"
    );
}

#[test]
fn bytes_that_are_not_the_database_are_refused() {
    let error = MetaSchema::parse(b"not json").expect_err("not the published shape");

    assert!(matches!(error, MetaSchemaError::Parse(_)), "{error:?}");
}

#[test]
fn the_generation_is_the_publishers_own_stamp() {
    assert_eq!(schema().generation(), "2026-08-24T03:56:00Z");
}

/// Story: the Settings card says which database is held, and the reader knows
/// the patch. The generation is the stamp on the hash tables behind it, which
/// the publisher moves on a schedule of its own, so a database that has gained
/// two patches can still carry the stamp it was first published under.
#[test]
fn the_version_names_the_patch_of_the_newest_build_described() {
    let version = schema().version();

    assert_eq!(version.patch.as_deref(), Some("16.17"));
    assert_eq!(version.build, 8_104_348);
    assert_eq!(version.generation, "2026-08-24T03:56:00Z");
}

/// Story: a stored verdict names the database it was a claim about. The wiki
/// publishes a patch without rereading the hash tables behind it, so the stamp
/// the database carries is the same one it was first published under, and a
/// sweep comparing stamps would leave every verdict standing.
#[test]
fn a_database_that_gained_a_patch_under_one_stamp_is_another_database() {
    let gained = published().replace(
        r#"{ "patch": "16.17", "build": 8104348 }"#,
        r#"{ "patch": "16.17", "build": 8104348 },
            { "patch": "16.18", "build": 8200000 }"#,
    );

    let before = schema();
    let after = MetaSchema::parse(gained.as_bytes()).expect("the published shape");

    assert_eq!(
        before.generation(),
        after.generation(),
        "the publisher's stamp did not move"
    );
    assert_ne!(before.digest(), after.digest());
}

#[test]
fn a_patch_past_the_newest_build_does_not_name_the_database() {
    let json = published().replace(
        r#"{ "patch": "16.17", "build": 8104348 }"#,
        r#"{ "patch": "16.17", "build": 8104348 },
            { "patch": "16.18", "build": 8200000 }"#,
    );

    let version = MetaSchema::parse(json.as_bytes())
        .expect("the published shape")
        .version();

    assert_eq!(
        version.patch.as_deref(),
        Some("16.17"),
        "a patch no revision describes is not one the database reaches"
    );
}

#[test]
fn a_database_naming_no_patches_is_named_by_its_build() {
    let json = published().replace(r#""versions""#, r#""unreadVersions""#);

    let version = MetaSchema::parse(json.as_bytes())
        .expect("the patches are not the schema")
        .version();

    assert_eq!(version.patch, None);
    assert_eq!(version.build, 8_104_348);
}

/// The two vocabularies are exact inverses, which is what keeps a finding's
/// words and the kind it matched on from disagreeing.
#[test]
fn every_type_name_round_trips() {
    for &(name, kind) in NAMES {
        assert_eq!(kind_named(name), Some(kind), "{name}");
        assert_eq!(name_of(kind), Some(name), "{kind:?}");
    }
}

/// The hash keys are unpadded hex under `0x`, which is what the publisher
/// writes and what a leading-zero class would otherwise be lost by.
#[test]
fn a_short_hash_key_parses() {
    assert_eq!(parse_hash("0x6516a"), Some(BinHash(0x0006_516a)));
    assert_eq!(parse_hash("0x16d88f43"), Some(BinHash(0x16d8_8f43)));
    assert_eq!(parse_hash("not a hash"), None);
}

/// Story: the shipped snapshot is the real published database, not a fixture,
/// and every check stands on it before any sync. If it stops parsing, or stops
/// answering the case the rule was built for, the rule is silently blind again.
#[test]
fn the_shipped_snapshot_answers_the_case_the_rule_exists_for() {
    let schema = MetaSchema::shipped();

    assert!(
        schema.class_count() > 5_000,
        "the published database describes thousands of classes, found {}",
        schema.class_count()
    );

    let after = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, AFTER_RETYPE)
        .expect("FloatTextIconData.mIconFileName is in the published database");
    assert_eq!(after.shape, Some(Shape::bare(Kind::WadChunkLink)));
    assert_eq!(after.class_name, Some("FloatTextIconData"));
    assert_eq!(after.field_name, Some("mIconFileName"));

    let before = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, BEFORE_RETYPE)
        .expect("the same property before Riot retyped it");
    assert_eq!(
        before.shape,
        Some(Shape::bare(Kind::String)),
        "the mod's String is right for 16.16 and wrong for 16.17, which is the whole point"
    );
}

/// Every type name the published database actually writes has to map, or the
/// rule goes quiet on those properties without anyone noticing.
#[test]
fn the_shipped_snapshot_writes_no_type_name_this_build_cannot_map() {
    let schema = MetaSchema::shipped();

    let unmapped = schema
        .classes
        .values()
        .flat_map(|class| class.properties.values())
        .flat_map(|property| property.revisions.iter())
        .filter(|revision| revision.shape.is_none())
        .count();

    assert_eq!(
        unmapped, 0,
        "every revision in the published database names a type this build maps"
    );
}

/// Story: every rule of every mod in a sweep asks the same database, so it is
/// opened once and held. A sync installs a newer one, and the sweep that runs
/// behind that sync must not still be reading the copy the app started with.
#[test]
fn the_shared_schema_is_held_open_and_reopened_after_a_sync() {
    let held = Slot(Mutex::new(None));
    let first = held.schema(None);
    assert!(
        Arc::ptr_eq(&first, &held.schema(None)),
        "asked twice, opened once"
    );

    held.clear();

    assert!(
        !Arc::ptr_eq(&first, &held.schema(None)),
        "a sync installed a database, so the next ask opens it"
    );
}

/// A revision is keyed on a build, and which copy covers the install is decided
/// when it is opened - so an ask about another build cannot be served the
/// choice made for the first.
#[test]
fn the_shared_schema_reopens_for_another_build() {
    let held = Slot(Mutex::new(None));
    let installed = held.schema(Some(GameBuild::new(16, 17, 8_104_348)));

    assert!(
        !Arc::ptr_eq(
            &installed,
            &held.schema(Some(GameBuild::new(13, 15, 5_229_820)))
        ),
        "a different install is a different choice of database"
    );
}
