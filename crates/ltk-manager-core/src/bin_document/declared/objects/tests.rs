use std::path::Path;

use assert_matches::assert_matches;
use fs_err as fs;

use super::super::tests::{Game, SKIN, declared, h, manifest, project};
use super::super::{DeclaredDiagnosticKind, ObjectSkip};
use super::*;
use crate::bin_document::{BinValue, DeclaredSign, LeafValue};

const COPY: &str = "Mods/jade-teemo/Skin0Copy";
const CHUNK: &str = "data/characters/teemo/skins/skin0.bin";

/// The target a declared document spells its chunk by, which the test tables do not name. Its
/// hex holds letters, so YAML reads it unquoted as a string.
fn target() -> String {
    format!("{:016x}", ltk_game_data::path_hash(CHUNK))
}

fn has_manifest(dir: &Path, layer: &str) -> bool {
    dir.join("content")
        .join(layer)
        .join(ltk_declarations::FILE_NAME)
        .exists()
}

/// A clone of the object `source` names.
fn clone_of(source: &str) -> NewObject {
    NewObject::Clone {
        source: hex(h(source)),
    }
}

fn glow_path() -> String {
    format!(
        "{:08x}.{:08x}",
        *h("skinMeshProperties"),
        *h("selfIllumination")
    )
}

#[test]
fn a_clone_declares_a_copy_of_the_object_under_the_new_name() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    let source = document.object_at(h(SKIN)).unwrap().clone();

    let created = document.create_object(COPY, &clone_of(SKIN)).unwrap();

    assert_eq!(created, h(COPY));
    let copy = document.object_at(created).unwrap();
    assert_eq!(copy.class_hash, source.class_hash);
    assert_eq!(copy.properties, source.properties);
    assert_eq!(
        manifest(dir.path(), "base"),
        format!(
            "version: 1\nmodules:\n  - target: {}\n    objects:\n      {COPY}:\n        clone: {SKIN}\n",
            target()
        )
    );
}

#[test]
fn a_construction_declares_an_object_of_the_class_holding_no_property() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    let class = h("SkinCharacterDataProperties");

    let created = document
        .create_object(COPY, &NewObject::Class { class: hex(class) })
        .unwrap();

    assert_eq!(
        document.object_at(created),
        Some(&BinObject::new(h(COPY), class))
    );
    assert!(
        manifest(dir.path(), "base").contains(&format!("        class: '{}'\n", hex(class))),
        "a class no table names is spelled by its hash"
    );
}

#[test]
fn a_creation_refuses_a_held_name_and_a_name_that_is_no_entry() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    assert_matches!(
        document.create_object(SKIN, &clone_of(SKIN)),
        Err(BinDocumentError::EditRejected {
            rejection: EditRejection::ObjectExists,
            ..
        })
    );
    assert_matches!(
        document.create_object("", &clone_of(SKIN)),
        Err(BinDocumentError::EditRejected {
            rejection: EditRejection::MalformedHash,
            ..
        })
    );
    assert_matches!(
        document.create_object(COPY, &clone_of("Nowhere")),
        Err(BinDocumentError::NodeNotFound { .. })
    );
    assert!(!has_manifest(dir.path(), "base"));
}

#[test]
fn a_key_of_a_created_object_lands_in_its_set_and_applies() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    let created = document.create_object(COPY, &clone_of(SKIN)).unwrap();

    document
        .set_leaf(created, &glow_path(), LeafValue::Float { value: 0.5 })
        .unwrap();

    let text = manifest(dir.path(), "base");
    assert!(
        text.ends_with("        set:\n          skinMeshProperties.selfIllumination: 0.5\n"),
        "{text}"
    );
    assert!(!text.contains("entries"), "{text}");
    let marks = document.declared_state().unwrap().marks;
    assert!(marks.iter().any(|mark| mark.entry == hex(created)
        && mark.path == glow_path()
        && mark.sign == DeclaredSign::Set));
}

#[test]
fn a_removal_declares_remove_and_undo_puts_the_object_back() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    document.remove_object(h(SKIN)).unwrap();

    assert!(document.object_at(h(SKIN)).is_none());
    assert_eq!(
        manifest(dir.path(), "base"),
        format!(
            "version: 1\nmodules:\n  - target: {}\n    objects:\n      {SKIN}:\n        remove: true\n",
            target()
        )
    );

    assert!(document.undo().unwrap());
    assert!(document.object_at(h(SKIN)).is_some());
    assert!(!has_manifest(dir.path(), "base"));

    assert!(document.redo().unwrap());
    assert!(document.object_at(h(SKIN)).is_none());
}

#[test]
fn removing_an_object_the_layer_created_drops_the_creation() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    let created = document.create_object(COPY, &clone_of(SKIN)).unwrap();

    document.remove_object(created).unwrap();

    assert!(document.object_at(created).is_none());
    let text = manifest(dir.path(), "base");
    assert!(!text.contains("remove"), "{text}");
    assert!(!text.contains(COPY), "{text}");
}

#[test]
fn a_removal_below_the_layer_that_creates_the_object_is_refused_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    let chroma = format!(
        "version: 1\nmodules:\n  - target: {}\n    objects:\n      {COPY}:\n        clone: {SKIN}\n",
        target()
    );
    fs::write(dir.path().join("content/chroma/game_data.yaml"), &chroma).unwrap();
    let mut document = declared(project);
    assert!(document.object_at(h(COPY)).is_some());

    assert_matches!(
        document.remove_object(h(COPY)),
        Err(BinDocumentError::EditRejected {
            rejection: EditRejection::Undeclarable,
            ..
        })
    );

    assert!(document.object_at(h(COPY)).is_some());
    assert!(!has_manifest(dir.path(), "base"));
    assert_eq!(manifest(dir.path(), "chroma"), chroma);
}

#[test]
fn a_removed_object_keeps_its_row_and_a_restore_brings_it_back() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    let names = Game::naming(&[SKIN]);

    document.remove_object(h(SKIN)).unwrap();

    let state = document.declared_state().unwrap();
    assert_eq!(
        state.objects,
        [DeclaredObjectMark {
            entry: hex(h(SKIN)),
            change: ObjectChange::Removed,
        }]
    );
    let roots = document.roots(names.as_ref(), None);
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].entry, hex(h(SKIN)));
    assert_matches!(roots[0].value, BinValue::Struct { len: 0, .. });

    document.restore_object(h(SKIN)).unwrap();

    assert!(document.object_at(h(SKIN)).is_some());
    assert!(document.declared_state().unwrap().objects.is_empty());
    assert!(!manifest(dir.path(), "base").contains("remove"));
    assert!(document.undo().unwrap());
    assert!(document.object_at(h(SKIN)).is_none());
}

#[test]
fn a_created_object_is_listed_as_created() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    let created = document.create_object(COPY, &clone_of(SKIN)).unwrap();

    assert_eq!(
        document.declared_state().unwrap().objects,
        [DeclaredObjectMark {
            entry: hex(created),
            change: ObjectChange::Created,
        }]
    );
}

#[test]
fn a_class_typed_by_name_is_written_as_typed() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    document
        .create_object(
            COPY,
            &NewObject::Class {
                class: "VfxSystemDefinitionData".to_owned(),
            },
        )
        .unwrap();

    assert!(manifest(dir.path(), "base").ends_with("        class: VfxSystemDefinitionData\n"));
}

#[test]
fn the_classes_a_new_object_takes_start_with_the_held_ones() {
    let dir = tempfile::tempdir().unwrap();
    let document = declared(project(dir.path()));
    let schema = crate::meta_schema::shared(None);

    let choices = document.object_classes(schema.at(None));

    assert_eq!(choices[0].hash, hex(h("SkinCharacterDataProperties")));
    assert!(choices[0].held);
    assert!(choices.len() > 1);
    assert!(choices[1..].iter().all(|choice| !choice.held));
}

#[test]
fn an_object_edit_that_does_not_apply_is_reported() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    fs::write(
        dir.path().join("content/base/game_data.yaml"),
        format!(
            "version: 1\nmodules:\n  - target: {}\n    objects:\n      {SKIN}:\n        clone: {SKIN}\n      Mods/jade-teemo/Gone:\n        remove: true\n",
            target()
        ),
    )
    .unwrap();

    let diagnostics = declared(project).declared_state().unwrap().diagnostics;

    let skipped: Vec<_> = diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.kind == DeclaredDiagnosticKind::ObjectSkipped)
        .collect();
    assert_eq!(skipped.len(), 2, "{diagnostics:?}");
    assert_eq!(skipped[0].object, Some(ObjectSkip::ObjectExists));
    assert_eq!(skipped[0].entry, hex(h(SKIN)));
    assert_eq!(skipped[1].object, Some(ObjectSkip::RemovalUnmatched));
    assert_eq!(skipped[1].entry, "");
}
