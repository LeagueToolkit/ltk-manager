use super::*;
use assert_matches::assert_matches;
use ltk_game_data::{BinHash, IndexMap, path_hash};

const SKIN0: &str = "Characters/Teemo/Skins/Skin0";
const RESOURCES: &str = "Characters/Teemo/Skins/Skin0/Resources";
const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";

/// A manifest with comments above and beside keys, a blank line between two
/// entries, both signed forms, and a hand-written `target` module in block
/// form.
const MANIFEST: &str = "\
# Jade Teemo's look on base Teemo.
version: 1
modules:
  # The skin and its resources.
  - entries:
      # The skin itself.
      Characters/Teemo/Skins/Skin0:
        # Glow.
        skinMeshProperties.selfIllumination: 0.37 # game 0.0
        iconCircle: assets/characters/jade_teemo/hud/jade_teemo_circle_301.tex # circle

      Characters/Teemo/Skins/Skin0/Resources:
        # Point the ult at Jade's missile.
        +resourceMap:
          Teemo_R_Mis: Characters/Jade_Teemo/Skins/Skin0/Particles/Jade_Teemo_Base_R_Mis # the missile
        -resourceMap: [Teemo_R_Firefly_GroundLight] # flow list
  # Hand-written target edit.
  - target: data/characters/teemo/skins/skin0.bin
    Characters/Teemo/Skins/Skin0:
      skinMeshProperties:
        texture: assets/x.tex # block form
";

/// A layer directory holding `manifest` as `game_data.yaml`, or nothing.
fn layer(manifest: Option<&str>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    if let Some(manifest) = manifest {
        fs::write(dir.path().join(FILE_NAME), manifest).unwrap();
    }
    dir
}

fn value(text: &str) -> ValueText {
    ValueText::new(text).unwrap()
}

fn edit_in(chunk: &str, entry: &str, path: &str, op: Operation) -> Edit {
    Edit {
        chunk_hash: path_hash(chunk),
        entry: EntryName::try_from(entry).unwrap(),
        path: PropertyPath::new(path).unwrap(),
        operation: op,
        module: ModuleChoice::Auto,
    }
}

fn edit(entry: &str, path: &str, op: Operation) -> Edit {
    edit_in(CHUNK, entry, path, op)
}

/// The text `edits` leave of `manifest`, each edit loading.
fn edited(manifest: Option<&str>, edits: &[Edit]) -> String {
    let dir = layer(manifest);
    let mut declarations = Manifest::read(dir.path()).unwrap();
    for edit in edits {
        declarations.edit(edit).unwrap();
    }
    assert!(declarations.declarations().unwrap().is_some());
    declarations.text().to_owned()
}

/// `MANIFEST` with each `(from, to)` replaced once.
fn manifest_with(replacements: &[(&str, &str)]) -> String {
    let mut text = MANIFEST.to_owned();
    for (from, to) in replacements {
        assert!(text.contains(from), "the manifest holds {from:?}");
        text = text.replacen(from, to, 1);
    }
    text
}

#[test]
fn an_untouched_manifest_loads_and_reads_back_as_it_was() {
    let dir = layer(Some(MANIFEST));

    let declarations = Manifest::read(dir.path()).unwrap();

    assert_eq!(declarations.text(), MANIFEST);
    assert!(declarations.declarations().unwrap().is_some());
}

#[test]
fn a_set_replaces_a_dotted_value_where_it_stands() {
    let text = edited(
        Some(MANIFEST),
        &[edit(
            SKIN0,
            "skinMeshProperties.selfIllumination",
            Operation::Set(value("0.5")),
        )],
    );

    assert_eq!(
        text,
        manifest_with(&[(
            "selfIllumination: 0.37 # game 0.0",
            "selfIllumination: 0.5 # game 0.0"
        )])
    );
}

#[test]
fn a_set_replaces_a_value_inside_a_target_modules_block() {
    let text = edited(
        Some(MANIFEST),
        &[edit(
            SKIN0,
            "skinMeshProperties.texture",
            Operation::Set(value("assets/y.tex")),
        )],
    );

    assert_eq!(
        text,
        manifest_with(&[(
            "texture: assets/x.tex # block form",
            "texture: assets/y.tex # block form"
        )])
    );
}

#[test]
fn a_new_path_never_lands_in_a_target_module() {
    let text = edited(
        Some(MANIFEST),
        &[edit(
            SKIN0,
            "skinMeshProperties.simpleSkin",
            Operation::Set(value("assets/a.skn")),
        )],
    );

    assert_eq!(
        text,
        manifest_with(&[(
            "jade_teemo_circle_301.tex # circle\n",
            "jade_teemo_circle_301.tex # circle\n        skinMeshProperties.simpleSkin: assets/a.skn\n"
        )])
    );
}

#[test]
fn a_target_module_of_another_chunk_is_left_alone() {
    let text = edited(
        Some(MANIFEST),
        &[edit_in(
            "data/characters/teemo/skins/skin1.bin",
            SKIN0,
            "skinMeshProperties.texture",
            Operation::Set(value("assets/y.tex")),
        )],
    );

    assert_eq!(
        text,
        manifest_with(&[(
            "jade_teemo_circle_301.tex # circle\n",
            "jade_teemo_circle_301.tex # circle\n        skinMeshProperties.texture: assets/y.tex\n"
        )])
    );
}

const BLOCK_MANIFEST: &str = "\
version: 1
modules:
  - entries:
      'Characters/Teemo/Skins/Skin0':
        # Mesh.
        skinMeshProperties:
          # Texture swap.
          texture: assets/x.tex
          selfIllumination: 1.0 # glow
          materialOverride[0]:
            texture: assets/m.tex
        # Health bar.
        healthBarData:
          unitHealthBarStyle: !u8 12 # pinned
";

#[test]
fn a_set_of_a_path_a_block_declares_replaces_it_inside_the_block() {
    let text = edited(
        Some(BLOCK_MANIFEST),
        &[edit(
            SKIN0,
            "skinMeshProperties.selfIllumination",
            Operation::Set(value("0.2")),
        )],
    );

    assert_eq!(
        text,
        BLOCK_MANIFEST.replace(
            "selfIllumination: 1.0 # glow",
            "selfIllumination: 0.2 # glow"
        )
    );
    assert!(!text.contains("skinMeshProperties.selfIllumination"));
}

#[test]
fn a_new_path_joins_the_deepest_block_it_runs_through() {
    let text = edited(
        Some(BLOCK_MANIFEST),
        &[
            edit(
                SKIN0,
                "skinMeshProperties.simpleSkin",
                Operation::Set(value("assets/a.skn")),
            ),
            edit(
                SKIN0,
                "skinMeshProperties.materialOverride[0].submesh",
                Operation::Set(value("Hat")),
            ),
        ],
    );

    assert_eq!(
        text,
        BLOCK_MANIFEST.replace(
            "            texture: assets/m.tex\n",
            "            texture: assets/m.tex\n            submesh: Hat\n          simpleSkin: assets/a.skn\n"
        )
    );
}

#[test]
fn a_set_lays_a_block_value_out_under_its_key() {
    let text = edited(
        Some(BLOCK_MANIFEST),
        &[edit(
            SKIN0,
            "healthBarData.unitHealthBarStyle",
            Operation::Set(value("!embed\nclass: HealthBarStyle\nset:\n  width: 2")),
        )],
    );

    assert_eq!(
        text,
        BLOCK_MANIFEST.replace(
            "          unitHealthBarStyle: !u8 12 # pinned\n",
            "          unitHealthBarStyle: !embed # pinned\n            class: HealthBarStyle\n            set:\n              width: 2\n"
        )
    );
}

#[test]
fn an_addition_joins_the_map_an_addition_already_declares() {
    let text = edited(
        Some(MANIFEST),
        &[
            edit(
                RESOURCES,
                "resourceMap",
                Operation::Add(value(
                    "Teemo_R_Pickup: Characters/Jade_Teemo/Skins/Skin0/Particles/Pickup",
                )),
            ),
            edit(
                RESOURCES,
                "resourceMap",
                Operation::Add(value("{Teemo_R_Mis: Characters/Other/Missile}")),
            ),
        ],
    );

    assert_eq!(
        text,
        manifest_with(&[(
            "Teemo_R_Mis: Characters/Jade_Teemo/Skins/Skin0/Particles/Jade_Teemo_Base_R_Mis # the missile\n",
            "Teemo_R_Mis: Characters/Other/Missile # the missile\n          Teemo_R_Pickup: Characters/Jade_Teemo/Skins/Skin0/Particles/Pickup\n"
        )])
    );
}

#[test]
fn a_removal_joins_the_list_a_removal_already_declares_once() {
    let text = edited(
        Some(MANIFEST),
        &[
            edit(
                RESOURCES,
                "resourceMap",
                Operation::Remove(value("[Teemo_R_Light]")),
            ),
            edit(
                RESOURCES,
                "resourceMap",
                Operation::Remove(value("[Teemo_R_Firefly_GroundLight]")),
            ),
        ],
    );

    assert_eq!(
        text,
        manifest_with(&[(
            "[Teemo_R_Firefly_GroundLight] # flow list",
            "[Teemo_R_Firefly_GroundLight, Teemo_R_Light] # flow list"
        )])
    );
}

#[test]
fn a_new_signed_key_lands_in_the_entry_body() {
    let text = edited(
        Some(MANIFEST),
        &[edit(
            SKIN0,
            "skinAudioProperties.tagEventList",
            Operation::Add(value("[Jade_Teemo]")),
        )],
    );

    assert_eq!(
        text,
        manifest_with(&[(
            "jade_teemo_circle_301.tex # circle\n",
            "jade_teemo_circle_301.tex # circle\n        +skinAudioProperties.tagEventList: [Jade_Teemo]\n"
        )])
    );
}

#[test]
fn a_drop_takes_the_key_and_leaves_the_comments_around_it() {
    let text = edited(
        Some(MANIFEST),
        &[edit(SKIN0, "iconCircle", Operation::Drop(Sign::Set))],
    );

    assert_eq!(
        text,
        manifest_with(&[(
            "        iconCircle: assets/characters/jade_teemo/hud/jade_teemo_circle_301.tex # circle\n",
            ""
        )])
    );
}

#[test]
fn a_drop_takes_the_body_block_and_module_it_leaves_empty() {
    let text = edited(
        Some(MANIFEST),
        &[
            edit(
                SKIN0,
                "skinMeshProperties.texture",
                Operation::Drop(Sign::Set),
            ),
            edit(RESOURCES, "resourceMap", Operation::Drop(Sign::Add)),
            edit(RESOURCES, "resourceMap", Operation::Drop(Sign::Remove)),
        ],
    );

    assert_eq!(
        text,
        "\
# Jade Teemo's look on base Teemo.
version: 1
modules:
  # The skin and its resources.
  - entries:
      # The skin itself.
      Characters/Teemo/Skins/Skin0:
        # Glow.
        skinMeshProperties.selfIllumination: 0.37 # game 0.0
        iconCircle: assets/characters/jade_teemo/hud/jade_teemo_circle_301.tex # circle

"
    );
}

#[test]
fn dropping_the_last_module_leaves_an_empty_list() {
    let text = edited(
        Some("version: 1\nmodules:\n  - entries:\n      A:\n        q: 3\n"),
        &[edit("A", "q", Operation::Drop(Sign::Set))],
    );

    assert_eq!(text, "version: 1\nmodules: []\n");
}

#[test]
fn dropping_a_key_nothing_declares_changes_nothing() {
    let text = edited(
        Some(MANIFEST),
        &[edit(SKIN0, "iconAvatar", Operation::Drop(Sign::Set))],
    );

    assert_eq!(text, MANIFEST);
}

#[test]
fn two_edits_to_one_entry_of_an_empty_layer_land_in_one_body() {
    let text = edited(
        None,
        &[
            edit(
                SKIN0,
                "skinMeshProperties.selfIllumination",
                Operation::Set(value("0.37")),
            ),
            edit(SKIN0, "iconCircle", Operation::Set(value("assets/c.tex"))),
        ],
    );

    assert_eq!(
        text,
        "\
version: 1
modules:
  - entries:
      Characters/Teemo/Skins/Skin0:
        skinMeshProperties.selfIllumination: 0.37
        iconCircle: assets/c.tex
"
    );
}

#[test]
fn a_new_entry_joins_a_trailing_entries_module_else_a_new_one() {
    let text = edited(
        Some(MANIFEST),
        &[
            edit(
                "Characters/Teemo/Skins/Skin1",
                "iconCircle",
                Operation::Set(value("assets/c.tex")),
            ),
            edit(
                "Characters/Teemo/Skins/Skin2",
                "iconCircle",
                Operation::Set(value("assets/d.tex")),
            ),
        ],
    );

    assert_eq!(
        text,
        format!(
            "{MANIFEST}  - entries:\n      Characters/Teemo/Skins/Skin1:\n        iconCircle: assets/c.tex\n      Characters/Teemo/Skins/Skin2:\n        iconCircle: assets/d.tex\n"
        )
    );
}

#[test]
fn an_entry_matches_by_hash_whichever_way_it_is_spelled() {
    let hash = format!("0x{:08x}", BinHash::from(SKIN0).0);
    let manifest =
        format!("version: 1\nmodules:\n  - entries:\n      '{hash}':\n        iconCircle: a.tex\n");

    let text = edited(
        Some(&manifest),
        &[edit(SKIN0, "iconCircle", Operation::Set(value("b.tex")))],
    );

    assert_eq!(text, manifest.replace("a.tex", "b.tex"));
}

#[test]
fn a_new_hash_named_entry_is_quoted() {
    let text = edited(
        None,
        &[edit(
            "0x71ad094e",
            "someValue",
            Operation::Set(value("!f32 1.0")),
        )],
    );

    assert_eq!(
        text,
        "version: 1\nmodules:\n  - entries:\n      '0x71ad094e':\n        someValue: !f32 1.0\n"
    );
}

#[test]
fn a_flow_body_takes_a_one_line_key() {
    let text = edited(
        Some("version: 1\nmodules:\n  - entries:\n      A: {q: 3}\n"),
        &[edit("A", "r", Operation::Set(value("4")))],
    );

    assert_eq!(
        text,
        "version: 1\nmodules:\n  - entries:\n      A: {q: 3, r: 4}\n"
    );
}

#[test]
fn a_key_joins_a_body_whose_last_line_is_a_comment() {
    let text = edited(
        Some(
            "version: 1\nmodules:\n  - entries:\n      A:\n        q: 3\n        # trailing note\n      B:\n        q: 1\n",
        ),
        &[edit("A", "r", Operation::Set(value("4")))],
    );

    assert_eq!(
        text,
        "version: 1\nmodules:\n  - entries:\n      A:\n        q: 3\n        r: 4\n        # trailing note\n      B:\n        q: 1\n"
    );
}

#[test]
fn a_manifest_that_does_not_load_refuses_every_edit() {
    let dir = layer(Some("version: 1\nmodules:\n  - entries:\n      A: {}\n"));
    let mut declarations = Manifest::read(dir.path()).unwrap();

    let result = declarations.edit(&edit("A", "q", Operation::Set(value("1"))));

    assert_matches!(result, Err(Error::Invalid { .. }));
}

#[test]
fn a_json_manifest_is_refused_by_name() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("game_data.json"),
        "{\"version\": 1, \"modules\": []}",
    )
    .unwrap();

    let result = Manifest::read(dir.path());

    assert_matches!(
        result,
        Err(Error::NotYaml { path }) if path.ends_with("game_data.json")
    );
}

#[test]
fn a_write_creates_the_manifest_of_a_layer_with_none() {
    let dir = tempfile::tempdir().unwrap();
    let layer_dir = dir.path().join("base");
    let mut declarations = Manifest::read(&layer_dir).unwrap();
    declarations
        .edit(&edit(SKIN0, "iconCircle", Operation::Set(value("a.tex"))))
        .unwrap();

    declarations.write().unwrap();

    assert_eq!(
        fs::read_to_string(layer_dir.join(FILE_NAME)).unwrap(),
        declarations.text()
    );
}

#[test]
fn a_write_over_a_file_changed_on_disk_is_refused_and_writes_nothing() {
    let dir = layer(Some(MANIFEST));
    let mut declarations = Manifest::read(dir.path()).unwrap();
    declarations
        .edit(&edit(SKIN0, "iconCircle", Operation::Set(value("a.tex"))))
        .unwrap();
    let changed = MANIFEST.replace("0.37", "0.4");
    fs::write(dir.path().join(FILE_NAME), &changed).unwrap();

    let result = declarations.write();

    assert_matches!(result, Err(Error::ChangedOnDisk { .. }));
    assert_eq!(
        fs::read_to_string(dir.path().join(FILE_NAME)).unwrap(),
        changed
    );
}

#[test]
fn a_crlf_manifest_is_written_back_in_crlf() {
    let crlf = MANIFEST.replace('\n', "\r\n");
    let dir = layer(Some(&crlf));
    let mut declarations = Manifest::read(dir.path()).unwrap();
    declarations
        .edit(&edit(SKIN0, "iconAvatar", Operation::Set(value("a.tex"))))
        .unwrap();

    declarations.write().unwrap();

    let written = fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
    assert!(written.contains("iconAvatar: a.tex\r\n"));
    assert_eq!(
        written.matches('\n').count(),
        written.matches("\r\n").count()
    );
}

#[test]
fn keys_are_quoted_only_where_yaml_would_read_them_otherwise() {
    assert_eq!(
        syntax::spell_key("skinMeshProperties.selfIllumination"),
        "skinMeshProperties.selfIllumination"
    );
    assert_eq!(syntax::spell_key("+resourceMap"), "+resourceMap");
    assert_eq!(syntax::spell_key("-tagEventList"), "-tagEventList");
    assert_eq!(
        syntax::spell_key("materialOverride[0].texture"),
        "materialOverride[0].texture"
    );
    assert_eq!(syntax::spell_key("0x71ad094e"), "'0x71ad094e'");
    assert_eq!(syntax::spell_key("true"), "'true'");
    assert_eq!(syntax::spell_key("12"), "'12'");
    assert_eq!(
        syntax::spell_key("resourceMap{\"Teemo_R_Mis\"}"),
        "'resourceMap{\"Teemo_R_Mis\"}'"
    );
    assert_eq!(syntax::spell_key("it's"), "'it''s'");
}

#[test]
fn a_drop_in_a_flow_body_takes_one_separating_comma() {
    let manifest = "version: 1\nmodules:\n  - entries:\n      A: {p: 1, q: 2, r: 3}\n";

    let middle = edited(
        Some(manifest),
        &[edit("A", "q", Operation::Drop(Sign::Set))],
    );
    let last = edited(
        Some(manifest),
        &[edit("A", "r", Operation::Drop(Sign::Set))],
    );

    assert_eq!(
        middle,
        "version: 1\nmodules:\n  - entries:\n      A: {p: 1, r: 3}\n"
    );
    assert_eq!(
        last,
        "version: 1\nmodules:\n  - entries:\n      A: {p: 1, q: 2}\n"
    );
}

#[test]
fn a_flow_body_refuses_a_block_value() {
    let dir = layer(Some(
        "version: 1\nmodules:\n  - entries:\n      A: {q: 3}\n",
    ));
    let mut manifest = Manifest::read(dir.path()).unwrap();

    let result = manifest.edit(&edit("A", "r", Operation::Set(value("x: 1\ny: 2"))));

    assert_matches!(
        result,
        Err(Error::Uneditable {
            reason: Refusal::FlowValue,
            ..
        })
    );
    assert_eq!(
        manifest.text(),
        "version: 1\nmodules:\n  - entries:\n      A: {q: 3}\n"
    );
}

#[test]
fn a_block_list_takes_an_addition_under_its_last_element() {
    let manifest = "version: 1\nmodules:\n  - entries:\n      A:\n        +tags:\n          - a # first\n          - b\n\n      B:\n        q: 1\n";

    let text = edited(
        Some(manifest),
        &[edit("A", "tags", Operation::Add(value("[c]")))],
    );

    assert_eq!(
        text,
        "version: 1\nmodules:\n  - entries:\n      A:\n        +tags:\n          - a # first\n          - b\n          - c\n\n      B:\n        q: 1\n"
    );
}

#[test]
fn a_one_line_value_turned_block_keeps_its_comment_on_the_key_line() {
    let text = edited(
        Some(MANIFEST),
        &[edit(
            SKIN0,
            "iconCircle",
            Operation::Set(value("- a.tex\n- b.tex")),
        )],
    );

    assert_eq!(
        text,
        manifest_with(&[(
            "        iconCircle: assets/characters/jade_teemo/hud/jade_teemo_circle_301.tex # circle\n",
            "        iconCircle: # circle\n          - a.tex\n          - b.tex\n"
        )])
    );
}

#[test]
fn a_rendered_value_sets_as_the_text_it_writes() {
    let pin = Value::Mapping(IndexMap::from([(
        "embed".to_owned(),
        Value::Mapping(IndexMap::from([
            (
                "class".to_owned(),
                Value::String("SkinMeshDataProperties".to_owned()),
            ),
            (
                "set".to_owned(),
                Value::Mapping(IndexMap::from([
                    (
                        "texture".to_owned(),
                        Value::String("assets/x.tex".to_owned()),
                    ),
                    (
                        "brushAlphaOverride".to_owned(),
                        Value::List(vec![Value::Float(0.5), Value::Integer(1)]),
                    ),
                ])),
            ),
        ])),
    )]));
    let text = edited(
        None,
        &[
            edit(
                SKIN0,
                "skinMeshProperties",
                Operation::Set(ValueText::try_from(&pin).unwrap()),
            ),
            edit(
                SKIN0,
                "championSkinName",
                Operation::Set(ValueText::try_from(&Value::String("true".to_owned())).unwrap()),
            ),
        ],
    );
    assert_eq!(
        text,
        "\
version: 1
modules:
  - entries:
      Characters/Teemo/Skins/Skin0:
        skinMeshProperties: !embed(SkinMeshDataProperties)
          texture: assets/x.tex
          brushAlphaOverride: [0.5, 1]
        championSkinName: \"true\"
",
    );

    let dir = layer(Some(&text));
    let declarations = Manifest::read(dir.path())
        .unwrap()
        .declarations()
        .unwrap()
        .unwrap();
    let ltk_game_data::Selector::Entries(entries) = &declarations.modules[0].selector else {
        panic!("expected an entries module");
    };
    assert_eq!(entries[0].properties[0].value, pin);
    assert_eq!(
        entries[0].properties[1].value,
        Value::String("true".to_owned())
    );
}

#[test]
fn a_restore_puts_back_the_text_an_edit_replaced() {
    let dir = layer(Some(MANIFEST));
    let mut manifest = Manifest::read(dir.path()).unwrap();
    manifest
        .edit(&edit(SKIN0, "iconCircle", Operation::Set(value("x.tex"))))
        .unwrap();
    manifest.write().unwrap();

    manifest.restore(MANIFEST).unwrap();
    manifest.write().unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join(FILE_NAME)).unwrap(),
        MANIFEST
    );

    assert_matches!(
        manifest.restore("version: 9\n"),
        Err(Error::Uneditable {
            reason: Refusal::DoesNotLoad(_),
            ..
        })
    );
    assert_eq!(manifest.text(), MANIFEST);
}

#[test]
fn a_restore_to_no_text_removes_the_manifest_an_edit_created() {
    let dir = layer(None);
    let mut manifest = Manifest::read(dir.path()).unwrap();
    manifest
        .edit(&edit(SKIN0, "iconCircle", Operation::Set(value("x.tex"))))
        .unwrap();
    manifest.write().unwrap();
    assert!(dir.path().join(FILE_NAME).exists());

    manifest.restore("").unwrap();
    manifest.write().unwrap();
    assert!(!dir.path().join(FILE_NAME).exists());

    manifest
        .edit(&edit(SKIN0, "iconCircle", Operation::Set(value("y.tex"))))
        .unwrap();
    manifest.write().unwrap();
    assert!(dir.path().join(FILE_NAME).exists());
}

#[test]
fn an_edit_spells_the_module_a_clipboard_takes() {
    let set = edit(
        SKIN0,
        "skinMeshProperties.selfIllumination",
        Operation::Set(value("0.37")),
    );
    assert_eq!(
        set.module_text().as_deref(),
        Some(
            "- entries:
    Characters/Teemo/Skins/Skin0:
      skinMeshProperties.selfIllumination: 0.37"
        ),
    );

    let block = edit(
        RESOURCES,
        "resourceMap",
        Operation::Add(value(
            "Teemo_E: x
Teemo_W: y",
        )),
    );
    assert_eq!(
        block.module_text().as_deref(),
        Some(
            "- entries:
    Characters/Teemo/Skins/Skin0/Resources:
      +resourceMap:
        Teemo_E: x
        Teemo_W: y"
        ),
    );

    assert_eq!(
        edit(SKIN0, "iconCircle", Operation::Drop(Sign::Set)).module_text(),
        None
    );
}

#[test]
fn several_edits_of_one_entry_spell_one_module() {
    let edits = [
        edit(SKIN0, "championSkinName", Operation::Set(value("Jade"))),
        edit(
            SKIN0,
            "skinMeshProperties",
            Operation::Set(value("texture: x.tex\nselfIllumination: 0.5")),
        ),
        edit(SKIN0, "tags[0]", Operation::Set(value("a"))),
    ];
    assert_eq!(
        module_text(&edits).as_deref(),
        Some(
            "- entries:\n    Characters/Teemo/Skins/Skin0:\n      championSkinName: Jade\n      \
             skinMeshProperties:\n        texture: x.tex\n        selfIllumination: 0.5\n      \
             tags[0]: a"
        ),
    );
    assert_eq!(module_text(&[]), None);
}
