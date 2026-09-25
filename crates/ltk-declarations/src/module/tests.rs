use assert_matches::assert_matches;
use fs_err as fs;
use ltk_game_data::{BinHash, EntryName, ModuleName, path_hash};
use ltk_meta::path::PropertyPath;

use crate::{Edit, Error, FILE_NAME, Manifest, ModuleChoice, Operation, Refusal, ValueText};

const SKIN0: &str = "Characters/Teemo/Skins/Skin0";
const RESOURCES: &str = "Characters/Teemo/Skins/Skin0/Resources";
const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";

/// Two `entries` modules, the first named, with comments above each and a blank line
/// between them.
const MODULES: &str = "\
version: 1
modules:
  # The base look.
  - name: Base look
    entries:
      Characters/Teemo/Skins/Skin0:
        iconCircle: a.tex # circle
        skinMeshProperties:
          selfIllumination: 0.5

  # The resources.
  - entries:
      Characters/Teemo/Skins/Skin0/Resources:
        foo: 1 # kept
";

fn layer(manifest: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join(FILE_NAME), manifest).unwrap();
    dir
}

fn manifest(text: &str) -> (tempfile::TempDir, Manifest) {
    let dir = layer(text);
    let manifest = Manifest::read(dir.path()).unwrap();
    (dir, manifest)
}

fn edit(entry: &str, path: &str, value: &str, module: ModuleChoice) -> Edit {
    Edit {
        chunk_hash: path_hash(CHUNK),
        entry: EntryName::try_from(entry).unwrap(),
        path: PropertyPath::new(path).unwrap(),
        operation: Operation::Set(ValueText::new(value).unwrap()),
        module,
    }
}

fn name(text: &str) -> ModuleName {
    ModuleName::try_from(text).unwrap()
}

fn hash(entry: &str) -> BinHash {
    EntryName::try_from(entry).unwrap().object_hash()
}

/// The names the text's modules load with.
fn names(manifest: &Manifest) -> Vec<Option<String>> {
    manifest
        .declarations()
        .unwrap()
        .unwrap()
        .modules
        .iter()
        .map(|module| module.name.as_ref().map(|name| name.as_str().to_owned()))
        .collect()
}

#[test]
fn a_new_key_joins_the_chosen_module_and_reports_it() {
    let (_dir, mut manifest) = manifest(MODULES);

    let module = manifest
        .edit(&edit(SKIN0, "iconSquare", "b.tex", ModuleChoice::Index(1)))
        .unwrap();

    assert_eq!(module, Some(1));
    assert_eq!(
        manifest.text(),
        MODULES.replace(
            "        foo: 1 # kept\n",
            "        foo: 1 # kept\n      Characters/Teemo/Skins/Skin0:\n        iconSquare: b.tex\n",
        )
    );
}

#[test]
fn a_key_another_module_declares_is_edited_where_it_stands() {
    let (_dir, mut manifest) = manifest(MODULES);

    let module = manifest
        .edit(&edit(SKIN0, "iconCircle", "c.tex", ModuleChoice::Index(1)))
        .unwrap();

    assert_eq!(module, Some(0));
    assert_eq!(
        manifest.text(),
        MODULES.replace("iconCircle: a.tex", "iconCircle: c.tex")
    );
}

#[test]
fn the_default_placement_reports_the_module_naming_the_entry() {
    let (_dir, mut manifest) = manifest(MODULES);

    let module = manifest
        .edit(&edit(RESOURCES, "bar", "2", ModuleChoice::Auto))
        .unwrap();

    assert_eq!(module, Some(1));
    assert!(
        manifest
            .text()
            .contains("        foo: 1 # kept\n        bar: 2\n")
    );
}

#[test]
fn a_new_named_module_takes_the_edit_at_the_end() {
    let (_dir, mut manifest) = manifest(MODULES);

    let module = manifest
        .edit(&edit(
            SKIN0,
            "iconSquare",
            "b.tex",
            ModuleChoice::New(Some(name("Glow: blue"))),
        ))
        .unwrap();

    assert_eq!(module, Some(2));
    assert_eq!(
        manifest.text(),
        format!(
            "{MODULES}  - name: 'Glow: blue'\n    entries:\n      Characters/Teemo/Skins/Skin0:\n        iconSquare: b.tex\n"
        )
    );
    assert_eq!(names(&manifest)[2].as_deref(), Some("Glow: blue"));
}

#[test]
fn a_module_index_the_manifest_lacks_is_refused() {
    let (_dir, mut manifest) = manifest(MODULES);

    let refused = manifest.edit(&edit(SKIN0, "iconSquare", "b.tex", ModuleChoice::Index(5)));

    assert_matches!(
        refused,
        Err(Error::Uneditable {
            reason: Refusal::NoModule(5),
            ..
        })
    );
    assert_eq!(manifest.text(), MODULES);
}

#[test]
fn a_new_named_module_starts_the_manifest_of_an_empty_layer() {
    let dir = tempfile::tempdir().unwrap();
    let mut manifest = Manifest::read(dir.path()).unwrap();

    let module = manifest
        .edit(&edit(
            SKIN0,
            "iconSquare",
            "b.tex",
            ModuleChoice::New(Some(name("Glow"))),
        ))
        .unwrap();

    assert_eq!(module, Some(0));
    assert_eq!(
        manifest.text(),
        "version: 1\nmodules:\n  - name: Glow\n    entries:\n      Characters/Teemo/Skins/Skin0:\n        iconSquare: b.tex\n"
    );
}

#[test]
fn a_rename_sets_replaces_and_clears_a_name_and_keeps_the_comments() {
    let (_dir, mut manifest) = manifest(MODULES);

    manifest.rename_module(1, Some(&name("Resources"))).unwrap();
    assert_eq!(
        manifest.text(),
        MODULES.replace(
            "  - entries:\n      Characters/Teemo/Skins/Skin0/Resources:",
            "  - name: Resources\n    entries:\n      Characters/Teemo/Skins/Skin0/Resources:",
        )
    );
    assert_eq!(
        names(&manifest),
        [Some("Base look".to_owned()), Some("Resources".to_owned())]
    );

    manifest.rename_module(0, Some(&name("true"))).unwrap();
    assert!(manifest.text().contains("  - name: 'true'\n"));
    assert_eq!(names(&manifest)[0].as_deref(), Some("true"));

    manifest.rename_module(0, None).unwrap();
    manifest.rename_module(1, None).unwrap();
    assert_eq!(
        manifest.text(),
        MODULES.replace("  - name: Base look\n    entries:", "  - entries:")
    );
    assert_eq!(names(&manifest), [None, None]);
}

#[test]
fn an_empty_name_is_refused() {
    assert!(ModuleName::try_from("").is_err());

    let (_dir, manifest) = manifest(&MODULES.replace("name: Base look", "name: ''"));

    assert_matches!(manifest.declarations(), Err(Error::Invalid { .. }));
}

#[test]
fn removing_a_module_takes_its_comment_and_keeps_the_rest() {
    let (_dir, mut manifest) = manifest(MODULES);

    manifest.remove_module(0).unwrap();

    assert_eq!(
        manifest.text(),
        "\
version: 1
modules:

  # The resources.
  - entries:
      Characters/Teemo/Skins/Skin0/Resources:
        foo: 1 # kept
"
    );
}

#[test]
fn removing_the_last_module_leaves_an_empty_list() {
    let (_dir, mut manifest) = manifest(MODULES);

    manifest.remove_module(1).unwrap();
    manifest.remove_module(0).unwrap();

    assert_eq!(manifest.text(), "version: 1\nmodules: []\n\n");
}

#[test]
fn a_moved_module_carries_its_comment_and_leaves_the_blank_line() {
    let (_dir, mut manifest) = manifest(MODULES);

    manifest.move_module(1, 0).unwrap();

    assert_eq!(
        manifest.text(),
        "\
version: 1
modules:
  # The resources.
  - entries:
      Characters/Teemo/Skins/Skin0/Resources:
        foo: 1 # kept
  # The base look.
  - name: Base look
    entries:
      Characters/Teemo/Skins/Skin0:
        iconCircle: a.tex # circle
        skinMeshProperties:
          selfIllumination: 0.5

"
    );
    assert_eq!(names(&manifest), [None, Some("Base look".to_owned())]);

    manifest.move_module(1, 0).unwrap();
    assert_eq!(names(&manifest), [Some("Base look".to_owned()), None]);
}

#[test]
fn a_key_moves_to_another_module_out_of_its_block() {
    let (_dir, mut manifest) = manifest(MODULES);

    manifest
        .move_keys(
            0,
            hash(SKIN0),
            Some(&PropertyPath::new("skinMeshProperties.selfIllumination").unwrap()),
            1,
        )
        .unwrap();

    assert_eq!(
        manifest.text(),
        MODULES
            .replace(
                "        skinMeshProperties:\n          selfIllumination: 0.5\n",
                ""
            )
            .replace(
                "        foo: 1 # kept\n",
                "        foo: 1 # kept\n      Characters/Teemo/Skins/Skin0:\n        skinMeshProperties.selfIllumination: 0.5\n",
            )
    );
}

#[test]
fn a_whole_entry_moves_and_a_nameless_module_it_empties_goes() {
    let (_dir, mut manifest) = manifest(MODULES);

    manifest.move_keys(1, hash(RESOURCES), None, 0).unwrap();

    assert_eq!(
        manifest.text(),
        "\
version: 1
modules:
  # The base look.
  - name: Base look
    entries:
      Characters/Teemo/Skins/Skin0:
        iconCircle: a.tex # circle
        skinMeshProperties:
          selfIllumination: 0.5
      Characters/Teemo/Skins/Skin0/Resources:
        foo: 1 # kept

"
    );
}

#[test]
fn a_move_onto_a_key_the_destination_declares_is_refused() {
    let text = MODULES.replace(
        "        foo: 1 # kept\n",
        "        foo: 1 # kept\n      Characters/Teemo/Skins/Skin0:\n        iconCircle: b.tex\n",
    );
    let (_dir, mut manifest) = manifest(&text);

    let refused = manifest.move_keys(
        0,
        hash(SKIN0),
        Some(&PropertyPath::new("iconCircle").unwrap()),
        1,
    );

    assert_matches!(
        refused,
        Err(Error::Uneditable {
            reason: Refusal::DeclaredInDestination,
            ..
        })
    );
    assert_eq!(manifest.text(), text);
}

#[test]
fn a_crlf_manifest_keeps_crlf_through_module_actions() {
    let dir = layer(&MODULES.replace('\n', "\r\n"));
    let mut manifest = Manifest::read(dir.path()).unwrap();

    manifest.rename_module(1, Some(&name("Resources"))).unwrap();
    manifest.move_module(1, 0).unwrap();
    manifest.write().unwrap();

    let written = fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
    assert_eq!(
        written.matches('\n').count(),
        written.matches("\r\n").count()
    );
    assert!(written.contains("  - name: Resources\r\n    entries:\r\n"));
}

#[test]
fn a_moved_tagged_block_keeps_its_nesting() {
    let text = "\
version: 1
modules:
  - entries:
      Characters/Teemo/Skins/Skin0:
        dynamicMaterial: !pointer(DynamicMaterialDef)
          parameters:
            - !embed(DynamicMaterialParameterDef)
              name: Outline_FinalAlphaMult
  - entries:
      Characters/Teemo/Skins/Skin0/Resources:
        foo: 1
";
    let (_dir, mut manifest) = manifest(text);

    manifest.move_keys(0, hash(SKIN0), None, 1).unwrap();

    assert_eq!(
        manifest.text(),
        "\
version: 1
modules:
  - entries:
      Characters/Teemo/Skins/Skin0/Resources:
        foo: 1
      Characters/Teemo/Skins/Skin0:
        dynamicMaterial: !pointer(DynamicMaterialDef)
          parameters:
            - !embed(DynamicMaterialParameterDef)
              name: Outline_FinalAlphaMult
"
    );
}

#[test]
fn a_created_module_takes_its_name_and_no_entry_at_the_end() {
    let (_dir, mut manifest) = manifest(MODULES);

    let index = manifest.create_module(Some(&name("Particles"))).unwrap();

    assert_eq!(index, 2);
    assert_eq!(
        manifest.text(),
        format!("{MODULES}  - name: Particles\n    entries: {{}}\n")
    );
    assert_eq!(
        names(&manifest),
        [
            Some("Base look".to_owned()),
            None,
            Some("Particles".to_owned())
        ]
    );
}

#[test]
fn a_created_module_starts_the_manifest_of_an_empty_layer() {
    let dir = tempfile::tempdir().unwrap();
    let mut manifest = Manifest::read(dir.path()).unwrap();

    let index = manifest.create_module(None).unwrap();

    assert_eq!(index, 0);
    assert_eq!(manifest.text(), "version: 1\nmodules:\n  - entries: {}\n");
}

#[test]
fn a_named_module_a_move_empties_stays_with_no_entry() {
    let (_dir, mut manifest) = manifest(MODULES);

    manifest.move_keys(0, hash(SKIN0), None, 1).unwrap();

    assert_eq!(
        names(&manifest),
        [Some("Base look".to_owned()), None],
        "{}",
        manifest.text()
    );
    assert!(
        manifest
            .text()
            .contains("  - name: Base look\n    entries: {}\n"),
        "{}",
        manifest.text()
    );
}
