use std::collections::HashMap;

use super::*;

#[test]
fn workshop_tests_take_each_projects_layers() {
    let config = StoredPatcherConfig {
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
