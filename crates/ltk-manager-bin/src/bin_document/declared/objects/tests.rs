use std::path::Path;

use assert_matches::assert_matches;
use fs_err as fs;

use super::super::tests::{Game, SKIN, declared, h, manifest, project};
use super::super::{DeclaredDiagnosticKind, ObjectSkip};
use super::*;
use crate::bin_document::{BinValue, LeafValue, ObjectCreation, PropertyEdit};
use ltk_manager_workshop::DeclaredSign;

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
fn a_key_of_a_class_tag_object_is_edited_in_its_body() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    fs::write(
        dir.path()
            .join("content/base")
            .join(ltk_declarations::FILE_NAME),
        format!(
            "version: 1\nmodules:\n  - target: {}\n    objects:\n      \
             {COPY}: !SkinCharacterDataProperties\n        championSkinName: Jade\n",
            target()
        ),
    )
    .unwrap();
    let mut document = declared(project);

    document
        .set_leaf(
            h(COPY),
            &format!("{:08x}", *h("championSkinName")),
            LeafValue::String {
                value: "Teemo".to_owned(),
            },
        )
        .unwrap();

    let text = manifest(dir.path(), "base");
    assert!(
        text.ends_with(": !SkinCharacterDataProperties\n        championSkinName: Teemo\n"),
        "{text}"
    );
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
        manifest(dir.path(), "base")
            .contains("      Mods/jade-teemo/Skin0Copy: !SkinCharacterDataProperties {}\n"),
        "a class only the schema names is spelled by the schema's name"
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
        text.ends_with(
            "        set:\n          skinMeshProperties:\n            selfIllumination: 0.5\n"
        ),
        "{text}"
    );
    assert!(!text.contains("entries"), "{text}");
    let marks = document.declared_state().unwrap().marks;
    assert!(marks.iter().any(|mark| mark.entry == hex(created)
        && mark.path == glow_path()
        && mark.sign == DeclaredSign::Set));
}

#[test]
fn key_of_source_created_object_lands_in_source_and_undoes() {
    let dir = tempfile::tempdir().unwrap();
    let project = project(dir.path());
    let layer = dir.path().join("content/base");
    let manifest_text = format!(
        "version: 1\nmodules:\n  - target: {}\n    source: copy.yaml\n",
        target()
    );
    let source_text = format!(
        "version: 1\nobjects:\n  {COPY}:\n    clone: {SKIN}\n    set:\n      skinMeshProperties.selfIllumination: 0.25\n"
    );
    fs::write(layer.join(ltk_declarations::FILE_NAME), &manifest_text).unwrap();
    fs::write(layer.join("copy.yaml"), &source_text).unwrap();
    let mut document = declared(project);
    let glow = |document: &BinDocument| {
        let path = ltk_meta::path::PropertyPath::new("skinMeshProperties.selfIllumination");
        match document.object_at(h(COPY))?.resolve(&path.ok()?).ok()? {
            ltk_meta::PropertyValueEnum::F32(value) => Some(value.value),
            _ => None,
        }
    };

    document
        .set_leaf(h(COPY), &glow_path(), LeafValue::Float { value: 0.5 })
        .unwrap();

    assert_eq!(manifest(dir.path(), "base"), manifest_text);
    assert_eq!(
        fs::read_to_string(layer.join("copy.yaml")).unwrap(),
        source_text.replace("0.25", "0.5")
    );
    assert_eq!(glow(&document), Some(0.5));

    assert!(document.undo().unwrap());
    assert_eq!(
        fs::read_to_string(layer.join("copy.yaml")).unwrap(),
        source_text
    );
    assert_eq!(glow(&document), Some(0.25));
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

    assert!(manifest(dir.path(), "base").ends_with(": !VfxSystemDefinitionData {}\n"));
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

const EXPLOSION: &str = "Mods/jade-teemo/Particles/Explosion";

fn template(id: &str) -> NewObject {
    NewObject::Template {
        template: id.to_owned(),
    }
}

fn text_of(object: &BinObject, field: &str) -> String {
    match &object.properties[&h(field)] {
        PropertyValueEnum::String(text) => text.value.clone(),
        other => panic!("{field} is no string: {other:?}"),
    }
}

#[test]
fn a_template_declares_a_system_of_its_value_under_its_own_name() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    let created = document
        .create_object(EXPLOSION, &template("explosion"))
        .unwrap();

    let object = document.object_at(created).unwrap();
    assert_eq!(object.class_hash, h("VfxSystemDefinitionData"));
    assert_eq!(text_of(object, "particleName"), "Explosion");
    assert_eq!(text_of(object, "particlePath"), EXPLOSION);
    assert_matches!(
        &object.properties[&h("complexEmitterDefinitionData")],
        PropertyValueEnum::Container(list) if list.len() == 7
    );
    let text = manifest(dir.path(), "base");
    assert!(text.contains(": !VfxSystemDefinitionData"), "{text}");
    assert!(text.contains("complexEmitterDefinitionData"), "{text}");
}

#[test]
fn a_template_is_one_undo_step() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    let created = document
        .create_object(EXPLOSION, &template("aura"))
        .unwrap();

    assert!(document.undo().unwrap());

    assert!(document.object_at(created).is_none());
    assert!(!document.undo().unwrap());
}

#[test]
fn a_template_no_catalog_holds_is_refused_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    assert_matches!(
        document.create_object(EXPLOSION, &template("glow")),
        Err(BinDocumentError::NodeNotFound { .. })
    );
    assert!(!has_manifest(dir.path(), "base"));
}

const FONT: &str = "UX/Fonts/Body";

/// A declared document whose game declares `FONT` in a chunk of its own.
fn declared_beside_a_font(dir: &Path) -> BinDocument {
    let font = BinObject::builder(h(FONT), h("GameFontDescription"))
        .property(h("name"), values::String::new("Body".to_owned()))
        .property(
            h("typeData"),
            values::ObjectLink::new(h("UX/Fonts/Types/Body")),
        )
        .build();
    let mut bytes = std::io::Cursor::new(Vec::new());
    ltk_meta::Bin::builder()
        .object(font)
        .build()
        .to_writer(&mut bytes)
        .unwrap();

    let context = super::super::DeclareContext {
        project: project(dir),
        schema: crate::meta_schema::PatchSchema::new(crate::meta_schema::shared(None), None),
        game: Game::declaring(
            &[SKIN, FONT, "GameFontDescription", "name", "typeData"],
            std::collections::HashMap::from([(h(FONT), bytes.into_inner())]),
        ),
    };
    BinDocument::declare(
        super::super::tests::game_bin(),
        ltk_game_data::path_hash(CHUNK),
        context,
    )
    .unwrap()
}

#[test]
fn a_copy_declares_an_object_another_chunk_holds_and_undoes_as_one_step() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared_beside_a_font(dir.path());

    let created = document
        .create_object(
            COPY,
            &NewObject::Copy {
                source: hex(h(FONT)),
            },
        )
        .unwrap();

    let copy = document.object_at(created).unwrap();
    assert_eq!(copy.class_hash, h("GameFontDescription"));
    assert_eq!(
        copy.properties.get(&h("typeData")),
        Some(&values::ObjectLink::new(h("UX/Fonts/Types/Body")).into())
    );
    assert!(manifest(dir.path(), "base").contains(": !GameFontDescription"));

    assert!(document.undo().unwrap());
    assert!(document.object_at(created).is_none());
    assert!(!document.undo().unwrap());
}

#[test]
fn create_and_edit_declares_pasted_object_as_one_step() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared_beside_a_font(dir.path());
    let font = values::Struct {
        class_hash: h("GameFontDescription"),
        properties: [(h("name"), values::String::from("Body").into())]
            .into_iter()
            .collect(),
    };
    let pasted = ObjectCreation {
        name: COPY.to_owned(),
        origin: NewObject::Paste {
            text: crate::bin_document::clipboard_text(&font.clone().into(), None),
        },
    };
    let schema = crate::meta_schema::shared(None);

    document
        .create_and_edit(&[pasted], Vec::new(), schema.at(None))
        .unwrap();

    assert_eq!(
        document.object_at(h(COPY)).unwrap().properties,
        font.properties
    );
    assert!(manifest(dir.path(), "base").contains(": !GameFontDescription"));
    assert!(document.undo().unwrap());
    assert!(document.object_at(h(COPY)).is_none());
    assert!(!document.undo().unwrap());
}

#[test]
fn a_copy_of_an_object_the_game_declares_nowhere_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));

    let outcome = document.create_object(
        COPY,
        &NewObject::Copy {
            source: hex(h(FONT)),
        },
    );

    assert_matches!(outcome, Err(BinDocumentError::NodeNotFound { .. }));
    assert!(!has_manifest(dir.path(), "base"));
}

const IMAGE: &str = "Mods/jade-teemo/Hud/Image";

/// What the Atlas components pane sends to fill the image it just created: `newElementEdits` in
/// `src/modules/workshop/bin/atlas/engine/edit/newElement.ts`.
fn image_fill(entry: &str) -> Vec<PropertyEdit> {
    let field = |name: &str| hex(h(name));
    let step = |name: &str| format!("{:08x}", *h(name));
    let rect = step("UIRect");
    let anchors = step("Anchors");
    let leaf = |name: &str, value: serde_json::Value| {
        serde_json::json!({
            "entry": entry,
            "holder": "",
            "field": field(name),
            "edits": [{ "type": "setLeaf", "path": "", "value": value }],
        })
    };
    let rect_leaf = |name: &str, value: serde_json::Value| {
        serde_json::json!([
            { "type": "ensureProperty", "path": rect, "field": field(name) },
            { "type": "setLeaf", "path": format!("{rect}.{}", step(name)), "value": value },
        ])
    };

    let mut position = vec![
        serde_json::json!({ "type": "replacePointer", "path": "", "class": "UiPositionRect" }),
        serde_json::json!({ "type": "ensureProperty", "path": "", "field": field("UIRect") }),
    ];
    for staged in [
        rect_leaf(
            "Position",
            serde_json::json!({ "type": "vector", "values": [736, 536] }),
        ),
        rect_leaf(
            "Size",
            serde_json::json!({ "type": "vector", "values": [128, 128] }),
        ),
        rect_leaf(
            "SourceResolutionWidth",
            serde_json::json!({ "type": "integer", "text": "1600" }),
        ),
        rect_leaf(
            "SourceResolutionHeight",
            serde_json::json!({ "type": "integer", "text": "1200" }),
        ),
        serde_json::json!([
            { "type": "ensureProperty", "path": "", "field": field("Anchors") },
            { "type": "replacePointer", "path": anchors, "class": "AnchorSingle" },
            { "type": "ensureProperty", "path": anchors, "field": field("Anchor") },
            {
                "type": "setLeaf",
                "path": format!("{anchors}.{}", step("Anchor")),
                "value": { "type": "vector", "values": [0.5, 0.5] },
            },
        ]),
    ] {
        position.extend(staged.as_array().unwrap().iter().cloned());
    }

    serde_json::from_value(serde_json::json!([
        leaf("name", serde_json::json!({ "type": "string", "value": IMAGE })),
        leaf(
            "Scene",
            serde_json::json!({ "type": "objectLink", "text": "Mods/jade-teemo/Hud" }),
        ),
        leaf("Enabled", serde_json::json!({ "type": "bool", "value": true })),
        leaf("Layer", serde_json::json!({ "type": "integer", "text": "3" })),
        { "entry": entry, "holder": "", "field": field("Position"), "edits": position },
    ]))
    .unwrap()
}

#[test]
fn a_constructed_ui_element_takes_its_scene_and_rect_as_one_step() {
    let dir = tempfile::tempdir().unwrap();
    let mut document = declared(project(dir.path()));
    let schema = crate::meta_schema::shared(None);
    let created = document
        .create_object(
            IMAGE,
            &NewObject::Class {
                class: "UiElementIconData".to_owned(),
            },
        )
        .unwrap();

    document
        .edit_properties(image_fill(&hex(created)), schema.at(None))
        .unwrap();

    let image = document.object_at(created).unwrap();
    assert_eq!(text_of(image, "name"), IMAGE);
    assert_eq!(
        image.properties.get(&h("Scene")),
        Some(&values::ObjectLink::new(h("Mods/jade-teemo/Hud")).into())
    );
    let size = format!(
        "{:08x}.{:08x}.{:08x}",
        *h("Position"),
        *h("UIRect"),
        *h("Size")
    );
    assert_matches!(
        document.property_value(created, &size),
        Ok(PropertyValueEnum::Vector2(size)) if size.value.x == 128.0 && size.value.y == 128.0
    );
    let text = manifest(dir.path(), "base");
    assert!(text.contains(": !UiElementIconData"), "{text}");
    assert!(text.contains("UiPositionRect"), "{text}");
    assert!(text.contains("AnchorSingle"), "{text}");

    assert!(document.undo().unwrap());
    assert_eq!(
        document.object_at(created),
        Some(&BinObject::new(created, h("UiElementIconData")))
    );
    assert!(document.undo().unwrap());
    assert!(document.object_at(created).is_none());
}
