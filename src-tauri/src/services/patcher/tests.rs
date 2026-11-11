use super::*;

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
