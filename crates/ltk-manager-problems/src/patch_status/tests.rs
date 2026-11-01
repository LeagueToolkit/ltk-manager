use super::*;

fn schema(build: u32, patch: Option<&str>) -> MetaSchema {
    let versions: Vec<_> = patch
        .map(|patch| serde_json::json!({ "patch": patch, "build": build }))
        .into_iter()
        .collect();
    MetaSchema::parse(
        &serde_json::to_vec(&serde_json::json!({
            "formatVersion": 1,
            "hashSource": { "fetchedAt": "2026-08-24T03:56:00Z" },
            "latest": build,
            "versions": versions,
            "classes": {}
        }))
        .unwrap(),
    )
    .unwrap()
}

#[test]
fn newest_table_overrides_an_older_schema() {
    let newest = table::tables()
        .iter()
        .map(|table| table.build())
        .max_by_key(|build| build.content())
        .unwrap();
    let status = PatchStatus::new(&schema(1, Some("1.1")), None, false);
    assert_eq!(status.known_build, newest.content());
    assert_eq!(status.known_patch, Some(newest.patch()));
}

#[test]
fn newer_schema_overrides_tables_without_borrowing_an_older_patch_name() {
    for patch in [Some("99.1"), None] {
        let status = PatchStatus::new(&schema(u32::MAX, patch), None, false);
        assert_eq!(status.known_build, u32::MAX);
        assert_eq!(status.known_patch.as_deref(), patch);
    }
}

#[test]
fn equal_build_uses_the_table_patch_when_the_schema_has_no_patch() {
    let newest = table::tables()
        .iter()
        .map(|table| table.build())
        .max_by_key(|build| build.content())
        .unwrap();
    let status = PatchStatus::new(&schema(newest.content(), None), None, false);
    assert_eq!(status.known_patch, Some(newest.patch()));
}

#[test]
fn waiting_status_matches_the_rule_not_the_newest_known_build() {
    let schema = schema(u32::MAX, Some("99.1"));
    let first = table::tables().first().unwrap().build();
    let older = GameBuild::new(1, 1, 1);
    let status = PatchStatus::new(&schema, Some(older), true);
    assert_eq!(status.waiting_patch, Some(first.patch()));
    for installed in [first, GameBuild::new(99, 1, u32::MAX)] {
        let status = PatchStatus::new(&schema, Some(installed), true);
        assert_eq!(status.waiting_patch, None);
        assert_eq!(status.installed_patch, Some(installed.patch()));
    }
}

#[test]
fn missing_install_and_unreadable_metadata_remain_distinguishable() {
    let schema = MetaSchema::shipped();
    for configured in [false, true] {
        let status = PatchStatus::new(&schema, None, configured);
        assert_eq!(status.install_configured, configured);
        assert_eq!(status.installed_patch, None);
        assert_eq!(status.waiting_patch, None);
    }
}
