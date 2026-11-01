use std::collections::HashMap;

use super::*;

#[test]
fn workshop_tests_take_each_projects_layers() {
    let config = StoredPatcherConfig {
        flags: None,
        include_profile: false,
        workshop_projects: Some(vec!["a".to_owned(), "b".to_owned()]),
        workshop_layers: Some(HashMap::from([("a".to_owned(), vec!["extras".to_owned()])])),
    };

    let tests = workshop_tests(&config);

    assert_eq!(
        tests[0].enabled_layers,
        Some(["extras".to_owned()].into_iter().collect())
    );
    assert_eq!(tests[1].enabled_layers, None);
}

#[test]
fn workshop_origin_records_profile_inclusion_and_library_origin_includes_it() {
    for include_profile in [false, true] {
        let mut config = StoredPatcherConfig {
            flags: None,
            workshop_projects: Some(vec!["project".into()]),
            workshop_layers: None,
            include_profile,
        };
        assert_eq!(config.origin().includes_profile(), include_profile);
        assert_eq!(
            serde_json::to_value(config.origin()).unwrap()["includeProfile"],
            include_profile
        );
        config.workshop_projects = None;
        assert!(config.origin().includes_profile());
    }
}

#[test]
fn old_workshop_incidents_keep_the_historical_included_profile() {
    let origin: ltk_manager_runtime::patcher::SessionOrigin =
        serde_json::from_str(r#"{"kind":"workshop","projects":["project"]}"#).unwrap();
    assert!(origin.includes_profile());
}
