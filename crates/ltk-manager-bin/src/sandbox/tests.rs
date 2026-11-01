use std::io::Cursor;

use fs_err as fs;
use ltk_meta::{Bin, BinObject};

use super::*;
use crate::bin_document::hex;
use crate::object_index::{DeclaredObject, ObjectDeclaration};

const SKIN_BIN: &str = "data/characters/teemo/skins/skin0.bin";

/// A project whose manifest declares `layers` by name and priority, holding `files` under
/// `content`.
fn project(files: &[&str], layers: &[(&str, i32)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for file in files {
        let full = dir.path().join("content").join(file);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(&full, b"x").unwrap();
    }

    let layers: Vec<_> = layers
        .iter()
        .map(|(name, priority)| serde_json::json!({ "name": name, "priority": priority }))
        .collect();
    let config = serde_json::json!({
        "name": "probe",
        "display_name": "Probe",
        "version": "1.0.0",
        "description": "",
        "authors": [],
        "layers": layers,
    });
    fs::write(dir.path().join("mod.config.json"), config.to_string()).unwrap();

    dir
}

fn in_project(dir: &tempfile::TempDir) -> SandboxRef {
    SandboxRef::Project {
        project: owner(dir),
    }
}

fn owner(dir: &tempfile::TempDir) -> String {
    dir.path().display().to_string()
}

fn chunk(path: &str) -> AssetRef {
    AssetRef::GameChunk {
        wad: "Champions/Teemo.wad.client".to_owned(),
        path_hash: format!("{:016x}", WadHash::hash_str(path).0),
    }
}

fn layer_file(dir: &tempfile::TempDir, layer: &str, path: &str) -> AssetRef {
    AssetRef::Layer {
        project: owner(dir),
        layer: layer.to_owned(),
        path: path.to_owned(),
    }
}

/// Acceptance test 1 of docs/plans/sandbox.md, through the sandbox's own lookup.
#[test]
fn a_layer_of_a_negative_priority_resolves_to_the_file_the_overlay_routes() {
    let dir = project(
        &[
            "base/W.wad.client/assets/x.tex",
            "under/W.wad.client/assets/x.tex",
        ],
        &[("base", 0), ("under", -1)],
    );

    let sandbox = Sandbox::open(in_project(&dir));

    assert_eq!(
        sandbox.assets(None).locate("assets/x.tex"),
        Some(layer_file(&dir, "under", "W.wad.client/assets/x.tex"))
    );
    assert_eq!(sandbox.layers(), ["base", "under"]);
}

/// Acceptance test 4 of docs/plans/sandbox.md, its first half. The declared tests check the
/// marks, in `a_layer_file_marks_each_row_a_declaration_overrides`.
#[test]
fn a_game_chunk_a_layer_ships_opens_as_the_layer_file() {
    let dir = project(
        &[&format!("chroma/Teemo.wad.client/{SKIN_BIN}")],
        &[("base", 0), ("chroma", 1)],
    );

    let opening = Sandbox::open(in_project(&dir))
        .opening(chunk(SKIN_BIN))
        .unwrap();

    assert_eq!(
        opening,
        Opening::File(layer_file(
            &dir,
            "chroma",
            &format!("Teemo.wad.client/{SKIN_BIN}")
        ))
    );
}

#[test]
fn a_game_chunk_no_layer_ships_opens_declared() {
    let dir = project(&[], &[("base", 0)]);

    let opening = Sandbox::open(in_project(&dir))
        .opening(chunk(SKIN_BIN))
        .unwrap();

    assert_eq!(
        opening,
        Opening::Declared {
            asset: chunk(SKIN_BIN),
            chunk_hash: WadHash::hash_str(SKIN_BIN).0,
        }
    );
}

#[test]
fn the_game_opens_a_chunk_as_it_is() {
    let opening = Sandbox::game().opening(chunk(SKIN_BIN)).unwrap();

    assert_eq!(opening, Opening::File(chunk(SKIN_BIN)));
}

#[test]
fn a_chunk_hash_that_is_not_hex_does_not_open() {
    let dir = project(&[], &[("base", 0)]);
    let asset = AssetRef::GameChunk {
        wad: "Champions/Teemo.wad.client".to_owned(),
        path_hash: "not a hash".to_owned(),
    };

    let error = Sandbox::open(in_project(&dir)).opening(asset).unwrap_err();

    assert!(matches!(error, AppError::InvalidPath(_)));
}

#[test]
fn a_client_chunk_opens_in_no_sandbox() {
    let dir = project(&[], &[("base", 0)]);
    let asset = AssetRef::LcuChunk {
        wad: "rcp-fe-lol-loot/assets.wad".to_owned(),
        path_hash: "0000000000000001".to_owned(),
    };

    for sandbox in [Sandbox::game(), Sandbox::open(in_project(&dir))] {
        let error = sandbox.opening(asset.clone()).unwrap_err();
        assert!(matches!(
            error.domain::<BinDocumentError>(),
            Some(BinDocumentError::LcuChunk)
        ));
    }
}

#[test]
fn a_layer_file_belongs_to_its_project_whichever_sandbox_opens_it() {
    let dir = project(&[], &[("base", 0)]);
    let file = layer_file(&dir, "base", "W.wad.client/assets/x.bin");

    for sandbox in [
        SandboxRef::Game,
        in_project(&dir),
        SandboxRef::Layers {
            project: owner(&dir),
            layers: vec!["base".to_owned()],
        },
    ] {
        assert_eq!(sandbox.holding(&file), in_project(&dir), "{sandbox}");
    }
    assert_eq!(in_project(&dir).holding(&chunk(SKIN_BIN)), in_project(&dir));
    assert_eq!(
        in_project(&dir).holding(&AssetRef::File {
            path: "C:/loose.bin".to_owned()
        }),
        SandboxRef::Game
    );
}

#[test]
fn a_layer_subset_stacks_the_chosen_layers_alone() {
    let dir = project(
        &[
            "base/W.wad.client/a.tex",
            "extra/W.wad.client/b.tex",
            "last/W.wad.client/c.tex",
        ],
        &[("base", 0), ("extra", 1), ("last", 2)],
    );

    let sandbox = Sandbox::open(SandboxRef::Layers {
        project: owner(&dir),
        layers: vec!["base".to_owned(), "last".to_owned()],
    });

    assert_eq!(sandbox.layers(), ["base", "last"]);
    assert!(sandbox.assets(None).locate("a.tex").is_some());
    assert_eq!(sandbox.assets(None).locate("b.tex"), None);
    assert!(sandbox.assets(None).locate("c.tex").is_some());
}

#[test]
fn a_layer_subset_opens_a_chunk_no_chosen_layer_ships_as_a_subset() {
    let dir = project(
        &[&format!("extra/W.wad.client/{SKIN_BIN}")],
        &[("base", 0), ("extra", 1)],
    );
    let sandbox = Sandbox::open(SandboxRef::Layers {
        project: owner(&dir),
        layers: vec!["base".to_owned()],
    });

    assert_eq!(
        sandbox.opening(chunk(SKIN_BIN)).unwrap(),
        Opening::Subset(chunk(SKIN_BIN))
    );
}

#[test]
fn a_snapshot_read_while_its_project_changed_is_not_kept() {
    let dir = project(&["base/W.wad.client/a.tex"], &[("base", 0)]);
    let sandboxes = SandboxState::default();

    let stale = sandboxes.get_with(&in_project(&dir), || {
        let read = Sandbox::open(in_project(&dir));
        fs::write(dir.path().join("content/base/W.wad.client/b.tex"), b"x").unwrap();
        sandboxes.invalidate(&owner(&dir));
        read
    });

    assert_eq!(stale.assets(None).locate("b.tex"), None);
    assert!(
        sandboxes
            .get(&in_project(&dir))
            .assets(None)
            .locate("b.tex")
            .is_some()
    );
}

#[test]
fn a_snapshot_is_kept_until_its_project_changes() {
    let dir = project(&["base/W.wad.client/a.tex"], &[("base", 0)]);
    let sandboxes = SandboxState::default();

    let first = sandboxes.get(&in_project(&dir));
    fs::write(dir.path().join("content/base/W.wad.client/b.tex"), b"x").unwrap();
    assert!(Arc::ptr_eq(&first, &sandboxes.get(&in_project(&dir))));
    assert_eq!(first.assets(None).locate("b.tex"), None);

    sandboxes.invalidate(&owner(&dir));

    let fresh = sandboxes.get(&in_project(&dir));
    assert!(!Arc::ptr_eq(&first, &fresh));
    assert!(fresh.assets(None).locate("b.tex").is_some());
}

#[test]
fn a_layer_file_packs_as_its_path_inside_the_archive_or_its_hex_name() {
    let dir = project(&[], &[("base", 0)]);

    assert_eq!(
        layer_chunk_hash(&layer_file(
            &dir,
            "base",
            &format!("Teemo.wad.client/{}", SKIN_BIN.to_uppercase())
        )),
        Some(WadHash::hash_str(SKIN_BIN).0)
    );
    assert_eq!(
        layer_chunk_hash(&layer_file(
            &dir,
            "base",
            "Teemo.wad.client/0123456789abcdef.bin"
        )),
        Some(0x0123_4567_89ab_cdef)
    );
    assert_eq!(layer_chunk_hash(&chunk(SKIN_BIN)), None);
}

#[test]
fn a_sandbox_ref_crosses_the_wire_tagged_by_kind() {
    let wire = serde_json::to_value(SandboxRef::Layers {
        project: "C:/mods/teemo".to_owned(),
        layers: vec!["chroma".to_owned()],
    })
    .unwrap();

    assert_eq!(
        wire,
        serde_json::json!({ "kind": "layers", "project": "C:/mods/teemo", "layers": ["chroma"] })
    );
    assert_eq!(
        serde_json::to_value(SandboxRef::Game).unwrap(),
        serde_json::json!({ "kind": "game" })
    );
}

/// A bin declaring `objects`, each of class `Probe`.
fn bin_of(objects: &[&str]) -> Vec<u8> {
    let mut bin = Bin::builder();
    for name in objects {
        bin = bin.object(
            BinObject::builder(BinHash::hash_str(name), BinHash::hash_str("Probe")).build(),
        );
    }
    let mut bytes = Cursor::new(Vec::new());
    bin.build().to_writer(&mut bytes).unwrap();
    bytes.into_inner()
}

#[test]
fn a_layer_bin_declares_its_objects_and_a_higher_copy_hides_a_lower_one() {
    let dir = project(&[], &[("base", 0), ("chroma", 1)]);
    let write = |layer: &str, path: &str, objects: &[&str]| {
        let full = dir.path().join("content").join(layer).join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, bin_of(objects)).unwrap();
    };
    write("base", "W.wad.client/data/a.bin", &["Lower"]);
    write("chroma", "W.wad.client/data/a.bin", &["Upper"]);
    write("base", "W.wad.client/data/b.bin", &["Other"]);

    let sandbox = Sandbox::open(in_project(&dir));
    let objects = sandbox.objects();

    assert_eq!(objects.get(&BinHash::hash_str("Lower")), None);
    assert_eq!(
        objects[&BinHash::hash_str("Upper")],
        [LayerObject {
            asset: layer_file(&dir, "chroma", "W.wad.client/data/a.bin"),
            class: BinHash::hash_str("Probe"),
        }]
    );
    assert_eq!(
        objects[&BinHash::hash_str("Other")][0].asset,
        layer_file(&dir, "base", "W.wad.client/data/b.bin")
    );
}

fn install_declaration(path: &str) -> ObjectDeclaration {
    ObjectDeclaration {
        asset: chunk(path),
        file: path.to_owned(),
        class_hash: hex(BinHash::hash_str("Probe")),
        class: "Probe".to_owned(),
    }
}

#[test]
fn a_layer_declaration_joins_in_front_of_the_install_and_replaces_the_chunk_it_ships() {
    let dir = project(&[], &[("base", 0)]);
    let shipped = "data/shipped.bin";
    let full = dir.path().join("content/base/W.wad.client").join(shipped);
    fs::create_dir_all(full.parent().unwrap()).unwrap();
    fs::write(full, bin_of(&["Skin", "Added"])).unwrap();
    let skin = hex(BinHash::hash_str("Skin"));
    let added = hex(BinHash::hash_str("Added"));
    let mut objects = HashMap::from([(
        skin.clone(),
        DeclaredObject {
            path: "Skin".to_owned(),
            declarations: vec![
                install_declaration(shipped),
                install_declaration("data/elsewhere.bin"),
            ],
        },
    )]);

    Sandbox::open(in_project(&dir)).join_declared(
        &[skin.clone(), added.clone()],
        &(),
        &mut objects,
    );

    let layer = layer_file(&dir, "base", &format!("W.wad.client/{shipped}"));
    let assets = |hash: &str| -> Vec<AssetRef> {
        objects[hash]
            .declarations
            .iter()
            .map(|declaration| declaration.asset.clone())
            .collect()
    };
    assert_eq!(assets(&skin), [layer.clone(), chunk("data/elsewhere.bin")]);
    assert_eq!(assets(&added), [layer]);
    assert_eq!(objects[&added].path, added);
}

#[test]
fn the_game_sandbox_joins_no_layer_declaration() {
    let skin = hex(BinHash::hash_str("Skin"));
    let before = HashMap::from([(
        skin.clone(),
        DeclaredObject {
            path: "Skin".to_owned(),
            declarations: vec![install_declaration("data/a.bin")],
        },
    )]);
    let mut objects = before.clone();

    Sandbox::game().join_declared(&[skin], &(), &mut objects);

    assert_eq!(objects, before);
}
