use super::*;

#[test]
fn workshop_tests_default_to_alone_and_library_runs_keep_the_profile() {
    for (json, expected) in [
        (r#"{}"#, true),
        (r#"{"workshopProjects":[]}"#, true),
        (r#"{"includeProfile":false}"#, true),
        (r#"{"workshopProjects":["project"]}"#, false),
        (
            r#"{"workshopProjects":["project"],"includeProfile":true}"#,
            true,
        ),
    ] {
        let config: PatcherConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.includes_profile(), expected, "{json}");
    }
}

#[test]
fn reloading_preserves_whether_the_profile_was_included() {
    for include_profile in [false, true] {
        let config = PatcherConfig::from_stored(
            StoredPatcherConfig {
                flags: None,
                workshop_projects: Some(vec!["project".into()]),
                workshop_layers: None,
                include_profile,
            },
            true,
        );
        assert_eq!(config.includes_profile(), include_profile);
        assert_eq!(config.force_rebuild, Some(true));
    }
}
