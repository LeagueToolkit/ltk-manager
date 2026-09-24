use assert_matches::assert_matches;
use fs_err as fs;
use ltk_game_data::{ClassName, EntryName, ObjectEdit as Declared, Selector, Sign, path_hash};
use ltk_meta::path::PropertyPath;

use crate::{
    Edit, Error, FILE_NAME, Manifest, ModuleChoice, ObjectEdit, ObjectOperation, Operation,
    Refusal, ValueText,
};

const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";
const OTHER_CHUNK: &str = "data/characters/annie/skins/skin0.bin";
const SKIN0: &str = "Characters/Teemo/Skins/Skin0";
const GLOW: &str = "Mods/jade-teemo/Glow";
const SPARK: &str = "Mods/jade-teemo/Spark";

/// A manifest whose last module is a hand-written `target` module of the chunk, with
/// comments beside its keys.
const TARGETED: &str = "\
version: 1
modules:
  - entries:
      Characters/Teemo/Skins/Skin0:
        iconCircle: a.tex # circle
  # Hand-written target edit.
  - target: data/characters/teemo/skins/skin0.bin
    Characters/Teemo/Skins/Skin0:
      skinMeshProperties.texture: assets/x.tex # block form
";

fn layer(manifest: Option<&str>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    if let Some(manifest) = manifest {
        fs::write(dir.path().join(FILE_NAME), manifest).unwrap();
    }
    dir
}

fn name(text: &str) -> EntryName {
    EntryName::try_from(text).unwrap()
}

fn object(entry: &str, operation: ObjectOperation) -> ObjectEdit {
    ObjectEdit {
        target: CHUNK.try_into().unwrap(),
        entry: name(entry),
        operation,
    }
}

fn clone_of(source: &str) -> ObjectOperation {
    ObjectOperation::Clone(name(source))
}

fn class(text: &str) -> ObjectOperation {
    ObjectOperation::Construct(ClassName::try_from(text).unwrap())
}

fn set(entry: &str, path: &str, value: &str) -> Edit {
    Edit {
        chunk_hash: path_hash(CHUNK),
        entry: name(entry),
        path: PropertyPath::new(path).unwrap(),
        operation: Operation::Set(ValueText::new(value).unwrap()),
        module: ModuleChoice::Auto,
    }
}

/// One step of an edited manifest.
enum Step {
    Object(ObjectEdit),
    Key(Edit),
}

/// The text `steps` leave of `manifest`, each step loading.
fn edited(manifest: Option<&str>, steps: Vec<Step>) -> String {
    let dir = layer(manifest);
    let mut declarations = Manifest::read(dir.path()).unwrap();
    for step in steps {
        match step {
            Step::Object(edit) => declarations.edit_object(&edit).unwrap(),
            Step::Key(edit) => {
                declarations.edit(&edit).unwrap();
            }
        }
    }
    declarations.declarations().unwrap();
    declarations.text().to_owned()
}

#[test]
fn a_creation_in_a_layer_with_no_manifest_writes_a_target_module() {
    let text = edited(None, vec![Step::Object(object(GLOW, clone_of(SKIN0)))]);

    assert_eq!(
        text,
        "\
version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    objects:
      Mods/jade-teemo/Glow:
        clone: Characters/Teemo/Skins/Skin0
"
    );
}

#[test]
fn a_creation_joins_the_last_target_module_of_the_chunk_and_keeps_its_comments() {
    let text = edited(
        Some(TARGETED),
        vec![
            Step::Object(object(GLOW, class("StaticMaterialDef"))),
            Step::Object(object(SPARK, class("0x0a1b2c3d"))),
        ],
    );

    assert_eq!(
        text,
        format!(
            "{TARGETED}    objects:
      Mods/jade-teemo/Glow:
        class: StaticMaterialDef
      Mods/jade-teemo/Spark:
        class: '0x0a1b2c3d'
"
        )
    );
}

#[test]
fn a_creation_joins_the_last_item_of_an_edits_list() {
    let manifest = "\
version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    edits:
      - Characters/Teemo/Skins/Skin0:
          iconCircle: a.tex
      - Characters/Teemo/Skins/Skin0:
          iconSquare: b.tex
";

    let text = edited(
        Some(manifest),
        vec![Step::Object(object(GLOW, ObjectOperation::Remove))],
    );

    assert_eq!(
        text,
        format!(
            "{manifest}        objects:
          Mods/jade-teemo/Glow:
            remove: true
"
        )
    );
}

#[test]
fn a_creation_for_another_chunk_writes_a_trailing_module() {
    let edit = ObjectEdit {
        target: OTHER_CHUNK.try_into().unwrap(),
        ..object(GLOW, class("StaticMaterialDef"))
    };

    let text = edited(Some(TARGETED), vec![Step::Object(edit)]);

    assert_eq!(
        text,
        format!(
            "{TARGETED}  - target: data/characters/annie/skins/skin0.bin
    objects:
      Mods/jade-teemo/Glow:
        class: StaticMaterialDef
"
        )
    );
}

#[test]
fn a_clone_of_an_entry_the_trailing_module_edits_writes_a_module_after_it() {
    let text = edited(
        Some(TARGETED),
        vec![Step::Object(object(GLOW, clone_of(SKIN0)))],
    );

    assert_eq!(
        text,
        format!(
            "{TARGETED}  - target: data/characters/teemo/skins/skin0.bin
    objects:
      Mods/jade-teemo/Glow:
        clone: Characters/Teemo/Skins/Skin0
"
        )
    );

    let chained = edited(
        None,
        vec![
            Step::Object(object(GLOW, clone_of(SKIN0))),
            Step::Object(object(SPARK, clone_of(GLOW))),
        ],
    );
    assert_eq!(
        chained.matches("- target:").count(),
        2,
        "a clone of an object its module creates reads nothing: {chained}"
    );
}

#[test]
fn a_hash_named_object_and_target_are_quoted() {
    let edit = ObjectEdit {
        target: "0000000000001234".try_into().unwrap(),
        ..object("0x0000abcd", ObjectOperation::Remove)
    };

    let text = edited(None, vec![Step::Object(edit)]);

    assert_eq!(
        text,
        "\
version: 1
modules:
  - target: '0000000000001234'
    objects:
      '0x0000abcd':
        remove: true
"
    );
}

#[test]
fn a_key_of_a_created_object_joins_its_set() {
    let text = edited(
        None,
        vec![
            Step::Object(object(GLOW, clone_of(SKIN0))),
            Step::Key(set(GLOW, "skinMeshProperties.texture", "a.tex")),
            Step::Key(set(GLOW, "iconCircle", "b.tex")),
            Step::Key(set(GLOW, "skinMeshProperties.texture", "c.tex")),
        ],
    );

    assert_eq!(
        text,
        "\
version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    objects:
      Mods/jade-teemo/Glow:
        clone: Characters/Teemo/Skins/Skin0
        set:
          skinMeshProperties.texture: c.tex
          iconCircle: b.tex
"
    );

    let dir = layer(Some(&text));
    let declarations = Manifest::read(dir.path())
        .unwrap()
        .declarations()
        .unwrap()
        .unwrap();
    let Selector::Target { edits, .. } = &declarations.modules[0].selector else {
        panic!("expected a target module");
    };
    let Declared::Clone { properties, .. } = &edits[0].objects[&name(GLOW)] else {
        panic!("expected a clone");
    };
    assert_eq!(properties.len(), 2);
    assert_eq!(properties[0].sign, Sign::Set);
}

#[test]
fn a_key_of_a_created_object_joins_its_set_whatever_module_is_chosen() {
    let manifest = "version: 1
modules:
  - entries:
      Characters/Teemo/Skins/Skin0:
        iconCircle: a.tex
";
    let chosen = Edit {
        module: ModuleChoice::Index(0),
        ..set(GLOW, "iconSquare", "b.tex")
    };

    let text = edited(
        Some(manifest),
        vec![
            Step::Object(object(GLOW, clone_of(SKIN0))),
            Step::Key(chosen),
        ],
    );

    assert_eq!(
        text,
        format!(
            "{manifest}  - target: data/characters/teemo/skins/skin0.bin
    objects:
      Mods/jade-teemo/Glow:
        clone: Characters/Teemo/Skins/Skin0
        set:
          iconSquare: b.tex
"
        )
    );
}

#[test]
fn a_key_of_an_object_the_layer_does_not_create_stays_in_an_entries_module() {
    let text = edited(
        None,
        vec![
            Step::Object(object(GLOW, ObjectOperation::Remove)),
            Step::Key(set(GLOW, "iconCircle", "b.tex")),
        ],
    );

    assert!(
        text.contains("  - entries:\n      Mods/jade-teemo/Glow:\n        iconCircle: b.tex\n")
    );
}

#[test]
fn an_object_edit_replaces_the_body_that_names_the_object() {
    let created = edited(
        None,
        vec![
            Step::Object(object(GLOW, clone_of(SKIN0))),
            Step::Key(set(GLOW, "iconCircle", "b.tex")),
        ],
    );

    let text = edited(
        Some(&created),
        vec![Step::Object(object(GLOW, ObjectOperation::Remove))],
    );

    assert_eq!(
        text,
        "\
version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    objects:
      Mods/jade-teemo/Glow:
        remove: true
"
    );
}

#[test]
fn a_drop_takes_the_object_and_the_module_it_leaves_empty() {
    let created = edited(
        Some(TARGETED),
        vec![
            Step::Object(object(GLOW, class("StaticMaterialDef"))),
            Step::Object(object(SPARK, class("StaticMaterialDef"))),
        ],
    );

    let one = edited(
        Some(&created),
        vec![Step::Object(object(GLOW, ObjectOperation::Drop))],
    );
    assert_eq!(
        one,
        format!(
            "{TARGETED}    objects:
      Mods/jade-teemo/Spark:
        class: StaticMaterialDef
"
        )
    );

    let both = edited(
        Some(&one),
        vec![Step::Object(object(SPARK, ObjectOperation::Drop))],
    );
    assert_eq!(both, TARGETED);

    let alone = edited(None, vec![Step::Object(object(GLOW, clone_of(SKIN0)))]);
    let emptied = edited(
        Some(&alone),
        vec![Step::Object(object(GLOW, ObjectOperation::Drop))],
    );
    assert_eq!(emptied, "version: 1\nmodules: []\n");

    assert_eq!(
        edited(
            Some(TARGETED),
            vec![Step::Object(object(GLOW, ObjectOperation::Drop))]
        ),
        TARGETED
    );
}

#[test]
fn a_restore_puts_back_the_text_an_object_edit_replaced() {
    let dir = layer(Some(TARGETED));
    let mut manifest = Manifest::read(dir.path()).unwrap();
    manifest
        .edit_object(&object(GLOW, clone_of(SKIN0)))
        .unwrap();
    manifest.write().unwrap();
    assert_ne!(manifest.text(), TARGETED);

    manifest.restore(TARGETED).unwrap();
    manifest.write().unwrap();

    assert_eq!(
        fs::read_to_string(dir.path().join(FILE_NAME)).unwrap(),
        TARGETED
    );
}

#[test]
fn a_flow_objects_mapping_refuses_a_block_body() {
    let manifest = "\
version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    objects: {Mods/jade-teemo/Spark: {remove: true}}
";
    let dir = layer(Some(manifest));
    let mut declarations = Manifest::read(dir.path()).unwrap();

    assert_matches!(
        declarations.edit_object(&object(GLOW, ObjectOperation::Remove)),
        Err(Error::Uneditable {
            reason: Refusal::FlowValue,
            ..
        })
    );
    assert_eq!(declarations.text(), manifest);
}
