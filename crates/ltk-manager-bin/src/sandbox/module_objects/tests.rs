use fs_err as fs;
use ltk_hash::{BinHash, Hash as _, WadHash};

use super::*;
use crate::sandbox::SandboxRef;

const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";
const SKIN: &str = "Characters/Teemo/Skins/Skin0";
const SKIN_CLASS: &str = "SkinCharacterDataProperties";

/// Every chunk sits in `Teemo.wad.client`.
struct InTeemo;

impl AssetLookup for InTeemo {
    fn locate(&self, _path: &str) -> Option<AssetRef> {
        None
    }

    fn locate_chunk(&self, hash: WadHash) -> Option<AssetRef> {
        Some(AssetRef::GameChunk {
            wad: "Champions/Teemo.wad.client".to_owned(),
            path_hash: format!("{:016x}", hash.0),
        })
    }
}

/// The objects of a one-layer project whose `base` manifest is `manifest`.
fn module_objects(manifest: &str, assets: &dyn AssetLookup) -> Vec<ModuleObject> {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("content/base")).unwrap();
    fs::write(dir.path().join("content/base/game_data.yaml"), manifest).unwrap();
    let config = serde_json::json!({
        "name": "probe",
        "display_name": "Probe",
        "version": "1.0.0",
        "description": "",
        "authors": [],
        "layers": [{ "name": "base", "priority": 0 }],
    });
    fs::write(dir.path().join("mod.config.json"), config.to_string()).unwrap();

    let sandbox = Sandbox::open(SandboxRef::Project {
        project: dir.path().to_string_lossy().into_owned(),
    });
    let skin = BinHash::from(SKIN);
    let skin_class = BinHash::from(SKIN_CLASS);
    sandbox.module_objects(&(), assets, &|object| {
        (object == skin).then_some(skin_class)
    })
}

#[test]
fn module_objects_lists_a_clone_with_the_class_of_its_source() {
    let objects = module_objects(
        &format!(
            "version: 1\nmodules:\n  - name: glow\n    target: {CHUNK}\n    objects:\n      Mods/jade/Clone:\n        clone: {SKIN}\n"
        ),
        &InTeemo,
    );

    assert_eq!(objects.len(), 1);
    let object = &objects[0];
    assert_eq!(object.path, "Mods/jade/Clone");
    assert_eq!(object.layer, "base");
    assert_eq!(object.module_name.as_deref(), Some("glow"));
    let ModuleObjectAction::Create { declaration } = &object.action else {
        panic!("the clone is {:?}", object.action);
    };
    assert_eq!(declaration.class_hash, hex(BinHash::from(SKIN_CLASS)));
    assert_eq!(declaration.file, CHUNK);
}

#[test]
fn module_objects_resolves_a_clone_of_an_earlier_creation() {
    let objects = module_objects(
        &format!(
            "version: 1
modules:
  - target: {CHUNK}
    objects:
      Mods/jade/Made:
        class: VfxSystemDefinitionData
  - target: {CHUNK}
    objects:
      Mods/jade/Copy:
        clone: Mods/jade/Made
"
        ),
        &InTeemo,
    );

    let classes: Vec<_> = objects
        .iter()
        .map(|object| match &object.action {
            ModuleObjectAction::Create { declaration } => declaration.class.as_str(),
            other => panic!("{} is {other:?}", object.path),
        })
        .collect();
    assert_eq!(
        classes,
        ["VfxSystemDefinitionData", "VfxSystemDefinitionData"]
    );
    assert_eq!(objects[1].module, 1);
}

#[test]
fn module_objects_marks_removals_and_edits() {
    let objects = module_objects(
        &format!(
            "version: 1
modules:
  - entries:
      {SKIN}:
        championSkinName: Jade
  - target: {CHUNK}
    objects:
      {SKIN}/Resources:
        remove: true
"
        ),
        &InTeemo,
    );

    let actions: Vec<_> = objects
        .iter()
        .map(|object| (object.path.as_str(), &object.action))
        .collect();
    assert_eq!(
        actions,
        [
            (SKIN, &ModuleObjectAction::Edit),
            (
                "Characters/Teemo/Skins/Skin0/Resources",
                &ModuleObjectAction::Remove
            ),
        ]
    );
}

/// An install whose index reaches a chunk the tables name by its path alone, as `GameIndex` does.
struct NamedInInstall;

impl AssetLookup for NamedInInstall {
    fn locate(&self, path: &str) -> Option<AssetRef> {
        (path == CHUNK).then(|| AssetRef::GameChunk {
            wad: "Champions/Teemo.wad.client".to_owned(),
            path_hash: format!("{:016x}", WadHash::hash_str(path).0),
        })
    }
}

#[test]
fn module_objects_lists_a_creation_in_a_chunk_the_tables_name() {
    let objects = module_objects(
        &format!(
            "version: 1\nmodules:\n  - target: {CHUNK}\n    objects:\n      Mods/jade/Clone:\n        clone: {SKIN}\n"
        ),
        &NamedInInstall,
    );

    assert_eq!(objects.len(), 1);
    assert_eq!(objects[0].path, "Mods/jade/Clone");
    assert!(matches!(
        objects[0].action,
        ModuleObjectAction::Create { .. }
    ));
}

#[test]
fn module_objects_skips_a_creation_in_a_missing_chunk() {
    let objects = module_objects(
        &format!(
            "version: 1\nmodules:\n  - target: {CHUNK}\n    objects:\n      Mods/jade/Clone:\n        clone: {SKIN}\n"
        ),
        &(),
    );

    assert!(objects.is_empty());
}
