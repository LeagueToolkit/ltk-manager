use fs_err as fs;
use ltk_game_data::{Selector, path_hash};

use crate::{FILE_NAME, LinkEdit, LinkOperation, LinkSign, Manifest};

const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";
const OTHER_CHUNK: &str = "data/characters/annie/skins/skin0.bin";
const SHARED: &str = "DATA/Characters/Teemo/Teemo.bin";
const GLOW: &str = "DATA/Mods/jade-teemo/Glow.bin";

/// A manifest whose last module is a hand-written `target` module of the chunk.
const TARGETED: &str = "\
version: 1
modules:
  - entries:
      Characters/Teemo/Skins/Skin0:
        iconCircle: a.tex
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

fn link(path: &str, operation: LinkOperation) -> LinkEdit {
    LinkEdit {
        target: CHUNK.try_into().unwrap(),
        path: path.try_into().unwrap(),
        operation,
    }
}

/// The text `edits` leave of `manifest`, each edit loading.
fn edited(manifest: Option<&str>, edits: &[LinkEdit]) -> String {
    let dir = layer(manifest);
    let mut declarations = Manifest::read(dir.path()).unwrap();
    for edit in edits {
        declarations.edit_link(edit).unwrap();
    }
    declarations.declarations().unwrap();
    declarations.text().to_owned()
}

#[test]
fn an_addition_in_a_layer_with_no_manifest_writes_a_target_module() {
    let text = edited(None, &[link(GLOW, LinkOperation::Add)]);

    assert_eq!(
        text,
        "\
version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    links:
      - DATA/Mods/jade-teemo/Glow.bin
"
    );
}

#[test]
fn additions_join_the_links_of_the_last_target_module_of_the_chunk() {
    let text = edited(
        Some(TARGETED),
        &[
            link(GLOW, LinkOperation::Add),
            link("DATA/Mods/jade-teemo/Spark.bin", LinkOperation::Add),
        ],
    );

    assert_eq!(
        text,
        format!(
            "{TARGETED}    links:
      - DATA/Mods/jade-teemo/Glow.bin
      - DATA/Mods/jade-teemo/Spark.bin
"
        )
    );

    let dir = layer(Some(&text));
    let declarations = Manifest::read(dir.path())
        .unwrap()
        .declarations()
        .unwrap()
        .unwrap();
    let Selector::Target { edits, .. } = &declarations.modules[1].selector else {
        panic!("expected a target module");
    };
    assert_eq!(edits[0].links.add.len(), 2);
}

#[test]
fn a_removal_writes_a_removal_list_beside_the_additions() {
    let text = edited(
        Some(TARGETED),
        &[
            link(GLOW, LinkOperation::Add),
            link(SHARED, LinkOperation::Remove),
        ],
    );

    assert_eq!(
        text,
        format!(
            "{TARGETED}    links:
      - DATA/Mods/jade-teemo/Glow.bin
    -links:
      - DATA/Characters/Teemo/Teemo.bin
"
        )
    );
}

#[test]
fn a_removal_of_an_own_addition_drops_the_item() {
    let added = edited(
        Some(TARGETED),
        &[
            link(GLOW, LinkOperation::Add),
            link("DATA/Mods/jade-teemo/Spark.bin", LinkOperation::Add),
        ],
    );

    let one = edited(
        Some(&added),
        &[link("data/mods/JADE-TEEMO/glow.bin", LinkOperation::Remove)],
    );
    assert_eq!(
        one,
        format!(
            "{TARGETED}    links:
      - DATA/Mods/jade-teemo/Spark.bin
"
        )
    );

    let none = edited(
        Some(&one),
        &[link(
            "DATA/Mods/jade-teemo/Spark.bin",
            LinkOperation::Remove,
        )],
    );
    assert_eq!(none, TARGETED);
}

#[test]
fn an_addition_of_an_own_removal_drops_the_item_and_the_module_it_empties() {
    let removed = edited(None, &[link(SHARED, LinkOperation::Remove)]);
    assert!(removed.contains("-links:\n      - DATA/Characters/Teemo/Teemo.bin\n"));

    let restored = edited(Some(&removed), &[link(SHARED, LinkOperation::Add)]);

    assert_eq!(restored, "version: 1\nmodules: []\n");
}

#[test]
fn a_listed_path_writes_nothing() {
    let added = edited(None, &[link(GLOW, LinkOperation::Add)]);

    assert_eq!(
        edited(Some(&added), &[link(GLOW, LinkOperation::Add)]),
        added
    );
}

#[test]
fn a_drop_of_nothing_changes_nothing() {
    assert_eq!(
        edited(
            Some(TARGETED),
            &[link(GLOW, LinkOperation::Drop(LinkSign::Add))]
        ),
        TARGETED
    );
    assert_eq!(
        edited(None, &[link(GLOW, LinkOperation::Drop(LinkSign::Remove))]),
        ""
    );
}

#[test]
fn a_flow_list_and_the_alias_take_the_item() {
    let manifest = "\
version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    +links: [DATA/Characters/Teemo/Teemo.bin]
";

    let text = edited(Some(manifest), &[link(GLOW, LinkOperation::Add)]);

    assert_eq!(
        text,
        "\
version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    +links: [DATA/Characters/Teemo/Teemo.bin, DATA/Mods/jade-teemo/Glow.bin]
"
    );
    assert_eq!(
        edited(Some(&text), &[link(SHARED, LinkOperation::Remove)]),
        "\
version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    +links: [DATA/Mods/jade-teemo/Glow.bin]
"
    );
}

#[test]
fn an_edit_for_another_chunk_writes_a_trailing_module() {
    let edit = LinkEdit {
        target: OTHER_CHUNK.try_into().unwrap(),
        ..link(GLOW, LinkOperation::Add)
    };

    let text = edited(Some(TARGETED), &[edit]);

    assert_eq!(
        text,
        format!(
            "{TARGETED}  - target: data/characters/annie/skins/skin0.bin
    links:
      - DATA/Mods/jade-teemo/Glow.bin
"
        )
    );
    assert_ne!(path_hash(OTHER_CHUNK), path_hash(CHUNK));
}
