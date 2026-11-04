use assert_matches::assert_matches;
use fs_err as fs;
use ltk_game_data::{EntryName, path_hash};
use ltk_meta::path::PropertyPath;

use crate::{Edit, Error, FILE_NAME, Manifest, ModuleChoice, Operation, ValueText};

const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";
const SPARK: &str = "Mods/jade-teemo/Particles/Spark";
const SOURCE: &str = "game-data/particles.yaml";
const POSITION: &str = "complexEmitterDefinitionData[0].EmitterPosition.constantValue";

const MANIFEST: &str = "\
version: 1
modules:
  - target: data/characters/teemo/skins/skin0.bin
    source: game-data/particles.yaml
";

/// A source document that creates `SPARK` with one emitter, with a comment beside a value.
const PARTICLES: &str = "\
version: 1

objects:
  Mods/jade-teemo/Particles/Spark:
    class: VfxSystemDefinitionData
    set:
      complexEmitterDefinitionData:
      - !pointer(VfxEmitterDefinitionData)
        rate: !embed(ValueFloat)
          constantValue: 200.0 # per second
        EmitterPosition: !embed(ValueVector3)
          constantValue: [0.0, 0.0, 10.0]
";

/// A layer holding `manifest` as its manifest and `PARTICLES` as its source document.
fn layer(manifest: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join(FILE_NAME), manifest).unwrap();
    fs::create_dir_all(dir.path().join("game-data")).unwrap();
    fs::write(dir.path().join(SOURCE), PARTICLES).unwrap();
    dir
}

fn set(path: &str, value: &str) -> Edit {
    Edit {
        chunk_hash: path_hash(CHUNK),
        entry: EntryName::try_from(SPARK).unwrap(),
        path: PropertyPath::new(path).unwrap(),
        operation: Operation::Set(ValueText::new(value).unwrap()),
        module: ModuleChoice::Auto,
    }
}

fn source_on_disk(dir: &tempfile::TempDir) -> String {
    fs::read_to_string(dir.path().join(SOURCE)).unwrap()
}

#[test]
fn edit_of_source_created_object_lands_in_source_where_value_stands() {
    let dir = layer(MANIFEST);
    let mut manifest = Manifest::read(dir.path()).unwrap();

    let module = manifest.edit(&set(POSITION, "[0, 0, 0]")).unwrap();
    manifest.write().unwrap();

    assert_eq!(module, Some(0));
    assert_eq!(manifest.text(), MANIFEST);
    assert_eq!(
        source_on_disk(&dir),
        PARTICLES.replace("[0.0, 0.0, 10.0]", "[0, 0, 0]")
    );
}

#[test]
fn set_inside_set_value_keeps_comment_beside_it() {
    let dir = layer(MANIFEST);
    let mut manifest = Manifest::read(dir.path()).unwrap();

    manifest
        .edit(&set(
            "complexEmitterDefinitionData[0].rate.constantValue",
            "50.0",
        ))
        .unwrap();
    manifest.write().unwrap();

    assert_eq!(
        source_on_disk(&dir),
        PARTICLES.replace("200.0 # per second", "50.0 # per second")
    );
}

#[test]
fn new_key_of_source_created_object_joins_its_set() {
    let dir = layer(MANIFEST);
    let mut manifest = Manifest::read(dir.path()).unwrap();

    manifest
        .edit(&set(
            "complexEmitterDefinitionData[0].emitterName",
            "Sparks",
        ))
        .unwrap();
    manifest.write().unwrap();

    assert_eq!(
        source_on_disk(&dir),
        format!("{PARTICLES}      complexEmitterDefinitionData[0]:\n        emitterName: Sparks\n")
    );
}

#[test]
fn edit_of_source_created_object_goes_to_later_manifest_key() {
    let later = format!(
        "{MANIFEST}  - target: data/characters/teemo/skins/skin0.bin
    Mods/jade-teemo/Particles/Spark:
      {POSITION}: [1, 1, 1]
"
    );
    let dir = layer(&later);
    let mut manifest = Manifest::read(dir.path()).unwrap();

    manifest.edit(&set(POSITION, "[0, 0, 0]")).unwrap();
    manifest.write().unwrap();

    assert_eq!(manifest.text(), later.replace("[1, 1, 1]", "[0, 0, 0]"));
    assert_eq!(source_on_disk(&dir), PARTICLES);
}

#[test]
fn replace_puts_back_source_text_edit_changed() {
    let dir = layer(MANIFEST);
    let mut manifest = Manifest::read(dir.path()).unwrap();
    manifest.edit(&set(POSITION, "[0, 0, 0]")).unwrap();
    let before = manifest.texts_on_disk();
    manifest.write().unwrap();
    let after = manifest.texts();

    let mut undo = Manifest::read(dir.path()).unwrap();
    undo.replace(&after, &before).unwrap();
    undo.write().unwrap();

    assert_eq!(before.sources.keys().collect::<Vec<_>>(), [SOURCE]);
    assert_eq!(source_on_disk(&dir), PARTICLES);
}

#[test]
fn write_over_source_changed_on_disk_is_refused_and_writes_nothing() {
    let dir = layer(MANIFEST);
    let mut manifest = Manifest::read(dir.path()).unwrap();
    manifest.edit(&set(POSITION, "[0, 0, 0]")).unwrap();
    let changed = PARTICLES.replace("200.0", "100.0");
    fs::write(dir.path().join(SOURCE), &changed).unwrap();

    assert_matches!(manifest.write(), Err(Error::ChangedOnDisk { .. }));
    assert_eq!(source_on_disk(&dir), changed);
}
