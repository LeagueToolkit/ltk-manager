use super::*;
use assert_matches::assert_matches;
use fs_err as fs;
use ltk_declarations::{Edit, ModuleChoice, Operation, ValueText};

fn project(dir: &std::path::Path) -> ProjectDir {
    fs::create_dir_all(dir.join("content").join("base")).unwrap();
    ProjectDir::open(dir.display().to_string()).unwrap()
}

#[test]
fn a_layer_name_that_is_not_one_component_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let project = project(tmp.path());

    assert_matches!(
        project.declarations_manifest("../base"),
        Err(AppError::ValidationFailed(_))
    );
    assert_matches!(
        project.declarations_manifest(".."),
        Err(AppError::ValidationFailed(_))
    );
}

#[test]
fn a_manifest_changed_on_disk_surfaces_as_its_workshop_error() {
    let tmp = tempfile::tempdir().unwrap();
    let project = project(tmp.path());
    let mut manifest = project.declarations_manifest("base").unwrap();
    manifest
        .edit(&Edit {
            chunk_hash: ltk_game_data::path_hash("data/characters/teemo/skins/skin0.bin"),
            entry: "Characters/Teemo/Skins/Skin0".try_into().unwrap(),
            path: "iconCircle".parse().unwrap(),
            operation: Operation::Set(ValueText::new("a.tex").unwrap()),
            module: ModuleChoice::Auto,
        })
        .unwrap();
    fs::write(manifest.path(), "version: 1\nmodules: []\n").unwrap();

    let result = manifest.write().map_err(AppError::from);

    assert_matches!(
        result,
        Err(AppError::Workshop(WorkshopError::DeclarationsChangedOnDisk { path }))
            if path.ends_with("game_data.yaml")
    );
}

#[test]
fn a_created_module_is_written_and_loads_with_no_entry() {
    let tmp = tempfile::tempdir().unwrap();
    let project = project(tmp.path());

    let change = project
        .apply_module_action(
            "base",
            &ModuleAction::Create {
                name: Some("Particles".to_owned()),
            },
        )
        .unwrap();

    assert_eq!(
        change.map(|change| change.after),
        Some("version: 1\nmodules:\n  - name: Particles\n    entries: {}\n".to_owned())
    );
    let manifest = project.declarations_manifest("base").unwrap();
    let declarations = manifest.declarations().unwrap().unwrap();
    assert_eq!(declarations.modules.len(), 1);
}
