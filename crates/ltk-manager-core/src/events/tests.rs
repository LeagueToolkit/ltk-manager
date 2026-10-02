//! Unit tests for the event registry's wire names and payload shapes.

use super::*;

#[test]
fn event_names_are_stable() {
    assert_eq!(
        BackendEvent::LinkedBinsUpdated.name(),
        "linked-bins-updated"
    );
    assert_eq!(
        BackendEvent::WadReportsUpdated.name(),
        "wad-reports-updated"
    );
    assert_eq!(
        BackendEvent::OverlayProgress(OverlayProgress {
            stage: OverlayStage::Indexing,
            current_file: None,
            current: 0,
            total: 0,
        })
        .name(),
        "overlay-progress"
    );
}

#[test]
fn payload_carrying_event_names_are_stable() {
    assert_eq!(BackendEvent::LibraryChanged.name(), "library-changed");
    assert_eq!(
        BackendEvent::InstallProgress(InstallProgress {
            current: 1,
            total: 2,
            current_file: "a.modpkg".to_string(),
        })
        .name(),
        "install-progress"
    );
    assert_eq!(
        BackendEvent::MigrationProgress(MigrationProgress {
            phase: MigrationPhase::Packaging,
            current: 0,
            total: 1,
            current_file: String::new(),
        })
        .name(),
        "migration-progress"
    );
    assert_eq!(
        BackendEvent::FantomeImportProgress(FantomeImportProgress {
            stage: FantomeImportStage::Extracting,
            current_item: None,
            current: 0,
            total: 0,
        })
        .name(),
        "fantome-import-progress"
    );
    assert_eq!(
        BackendEvent::GitImportProgress(GitImportProgress {
            stage: GitImportStage::Downloading,
            message: None,
        })
        .name(),
        "git-import-progress"
    );
    assert_eq!(
        BackendEvent::LaunchProgress(LaunchProgress::at(LaunchStage::Resolving)).name(),
        "launch-progress"
    );
    assert_eq!(
        BackendEvent::HashtableSyncProgress(HashtableSyncProgress {
            table: "game".to_string(),
            current: 1,
            total: 6,
            downloaded: 0,
            total_bytes: None,
        })
        .name(),
        "hashtable-sync-progress"
    );
}

/// The three session events are one story told in order, so their names are
/// worth pinning together rather than one at a time.
#[test]
fn session_event_names_are_stable() {
    assert_eq!(
        BackendEvent::SessionStarted(SessionStarted {
            phase: "Pending".to_string(),
            running: false,
            version: "24C2E5A086AFFB82".to_string(),
        })
        .name(),
        "session-started"
    );
    assert_eq!(
        BackendEvent::SessionChanged(SessionChanged {
            phase: "Gameplay".to_string(),
        })
        .name(),
        "session-changed"
    );
    assert_eq!(
        BackendEvent::SessionGameRunning(SessionGameRunning { running: true }).name(),
        "session-game-running"
    );
    assert_eq!(
        BackendEvent::SessionEnded(SessionEnded {
            exit_code: Some(0),
            exit_reason: Some("Exit".to_string()),
        })
        .name(),
        "session-ended"
    );
}

/// Payload field names cross the IPC boundary, so the camelCase rename must
/// survive the move into core.
#[test]
fn payloads_serialize_as_camel_case() {
    let json = serde_json::to_value(InstallProgress {
        current: 1,
        total: 3,
        current_file: "x".to_string(),
    })
    .unwrap();
    assert_eq!(json["currentFile"], "x");

    let json = serde_json::to_value(OverlayProgress {
        stage: OverlayStage::Patching,
        current_file: Some("test.wad.client".to_string()),
        current: 5,
        total: 10,
    })
    .unwrap();
    assert_eq!(json["stage"], "patching");
    assert_eq!(json["currentFile"], "test.wad.client");
    assert_eq!(json["current"], 5);
    assert_eq!(json["total"], 10);

    let json = serde_json::to_value(FantomeImportProgress {
        stage: FantomeImportStage::Finalizing,
        current_item: Some("w".to_string()),
        current: 1,
        total: 2,
    })
    .unwrap();
    assert_eq!(json["currentItem"], "w");
    assert_eq!(json["stage"], "finalizing");
}

/// Every overlay stage is a distinct string the frontend switches on, so a
/// renamed variant must not silently change what it serializes to.
#[test]
fn overlay_stages_serialize_to_their_wire_names() {
    for (stage, expected) in [
        (OverlayStage::Indexing, "\"indexing\""),
        (OverlayStage::Collecting, "\"collecting\""),
        (OverlayStage::Patching, "\"patching\""),
        (OverlayStage::Strings, "\"strings\""),
        (OverlayStage::Complete, "\"complete\""),
    ] {
        assert_eq!(serde_json::to_string(&stage).unwrap(), expected);
    }
}

#[test]
fn null_sink_accepts_events() {
    let sink = NullEventSink;
    sink.emit(BackendEvent::LinkedBinsUpdated);
}

#[test]
fn a_layer_file_change_names_its_event() {
    let change = LayerFilesChanged {
        project: "C:/projects/smolder".to_owned(),
        files: Vec::new(),
    };

    assert_eq!(
        BackendEvent::LayerFilesChanged(change).name(),
        "layer-files-changed"
    );
}

#[test]
fn an_event_serializes_as_its_payload_alone() {
    assert_eq!(
        serde_json::to_value(BackendEvent::LibraryChanged).unwrap(),
        serde_json::Value::Null
    );

    let progress = GitImportProgress {
        stage: GitImportStage::Complete,
        message: Some("done".into()),
    };
    assert_eq!(
        serde_json::to_value(BackendEvent::GitImportProgress(progress.clone())).unwrap(),
        serde_json::to_value(progress).unwrap()
    );
}
