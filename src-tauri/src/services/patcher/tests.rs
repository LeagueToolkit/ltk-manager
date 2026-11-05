use super::*;
use ltk_manager_base::events::NullEventSink;
use ltk_manager_workshop::ProjectRegistry;

/// Writes a project config into `dir`, which is what makes the workshop list it.
fn project(dir: &Path) {
    fs_err::create_dir_all(dir).unwrap();
    fs_err::write(
        dir.join("mod.config.json"),
        r#"{
            "name": "project",
            "display_name": "Project",
            "version": "1.0.0",
            "description": "",
            "authors": []
        }"#,
    )
    .unwrap();
}

/// A workshop whose registry lists `opened` as the folders the user opened.
fn workshop_with_opened(registry_file: &Path, opened: &[&Path]) -> Workshop {
    let document = serde_json::json!({
        "opened": opened
            .iter()
            .map(|path| serde_json::json!({
                "path": path,
                "displayName": "opened",
                "added": "2024-01-01T00:00:00Z",
            }))
            .collect::<Vec<_>>(),
        "lastOpened": {},
    });
    fs_err::write(registry_file, serde_json::to_vec(&document).unwrap()).unwrap();

    Workshop::new(Arc::new(NullEventSink))
        .with_registry(ProjectRegistry::load(registry_file.to_path_buf()))
}

#[test]
fn patcher_config_rejects_flags() {
    let error = serde_json::from_str::<PatcherConfig>(r#"{"flags":4}"#).unwrap_err();

    assert!(error.to_string().contains("unknown field"));
}

#[test]
fn patcher_config_reads_workshop_paths() {
    let config: PatcherConfig = serde_json::from_str(
        r#"{
            "workshopProjects": ["C:\\Projects\\one"],
            "workshopLayers": {"C:\\Projects\\one": ["base"]}
        }"#,
    )
    .unwrap();

    assert_eq!(
        config.workshop_projects,
        Some(vec!["C:\\Projects\\one".to_string()])
    );
    assert_eq!(
        config
            .workshop_layers
            .unwrap()
            .get("C:\\Projects\\one")
            .cloned(),
        Some(vec!["base".to_string()])
    );
}

#[test]
fn a_workshop_folder_child_is_allowed() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("workshop");
    let project_dir = root.join("root-mod");
    project(&project_dir);
    let config = Config {
        workshop_path: Some(root),
        ..Config::default()
    };
    let workshop = Workshop::new(Arc::new(NullEventSink));

    let requested = vec![project_dir.display().to_string()];

    assert!(validate_workshop_projects(Some(&requested), &workshop, &config).is_ok());
}

#[test]
fn an_opened_folder_is_allowed() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("workshop");
    let project_dir = tmp.path().join("elsewhere");
    project(&project_dir);
    let config = Config {
        workshop_path: Some(root),
        ..Config::default()
    };
    let workshop = workshop_with_opened(
        &tmp.path().join(ProjectRegistry::FILE_NAME),
        &[&project_dir],
    );

    let requested = vec![project_dir.display().to_string()];

    assert!(validate_workshop_projects(Some(&requested), &workshop, &config).is_ok());
}

#[test]
fn a_folder_the_workshop_does_not_list_is_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("workshop");
    let project_dir = tmp.path().join("outside");
    project(&project_dir);
    let config = Config {
        workshop_path: Some(root),
        ..Config::default()
    };
    let workshop = workshop_with_opened(&tmp.path().join(ProjectRegistry::FILE_NAME), &[]);

    let requested = vec![project_dir.display().to_string()];
    let error = validate_workshop_projects(Some(&requested), &workshop, &config).unwrap_err();

    assert!(matches!(
        error,
        AppError::InvalidPath(path) if path == project_dir.display().to_string()
    ));
}

#[test]
fn a_folder_reached_through_parent_components_is_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("workshop");
    let project_dir = tmp.path().join("elsewhere");
    project(&root.join("root-mod"));
    project(&project_dir);
    let config = Config {
        workshop_path: Some(root.clone()),
        ..Config::default()
    };
    let workshop = workshop_with_opened(
        &tmp.path().join(ProjectRegistry::FILE_NAME),
        &[&project_dir],
    );

    let traversal = root.join("root-mod").join("..").join("elsewhere");
    let requested = vec![traversal.display().to_string()];
    let error = validate_workshop_projects(Some(&requested), &workshop, &config).unwrap_err();

    assert!(matches!(error, AppError::InvalidPath(_)));
}
