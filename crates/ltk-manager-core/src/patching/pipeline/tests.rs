use std::sync::Arc;

use chrono::{TimeZone, Utc};
use ltk_telemetry::sink::RecordingSink;
use ltk_telemetry::{Config as TelemetryConfig, Secret, Telemetry};
use serde_json::{Value, json};
use tempfile::TempDir;

use super::*;
use ltk_manager_assets::hashtables::WadPathResolverState;
use ltk_manager_base::config::Config;
use ltk_manager_base::error::{AppError, ErrorKind};
use ltk_manager_library::mods::{ChecksumMismatchState, WadReportState};
use ltk_manager_runtime::diagnostics::incident::{
    Ending, GameRecord, LaunchKind, OverlayOutcome, SessionFailure,
};
use ltk_manager_runtime::patcher::SessionOrigin;
use ltk_manager_runtime::patcher::injector::WadScanFailure;
use ltk_manager_runtime::patcher::state::PatcherPhase;

/// A listener that answers nothing, since these tests read the sink instead.
#[derive(Debug)]
struct SilentEvents;

impl PatcherEvents for SilentEvents {
    fn phase_changed(&self, _phase: PatcherPhase) {}
    fn error(&self, _error: AppError) {}
    fn overlay_progress(&self, _progress: ltk_manager_base::events::OverlayProgress) {}
    fn wad_scan_failed(&self, _failures: Vec<WadScanFailure>) {}
    fn game_attached(&self, _pid: Option<u64>) {}
    fn game_overlay(&self, _outcome: OverlayOutcome) {}
    fn game_exited(&self) {}
    fn overlay_deferred(&self) {}
    fn incident_recorded(&self, _incident: Incident) {}
    fn game_recorded(&self) {}
}

struct Harness {
    pipeline: IncidentPipeline,
    sink: Arc<RecordingSink>,
    _dirs: (TempDir, TempDir, TempDir),
}

impl Harness {
    fn new() -> Self {
        Self::with(true, Config::default())
    }

    fn off() -> Self {
        Self::with(false, Config::default())
    }

    fn with(reports: bool, config: Config) -> Self {
        let sink = Arc::new(RecordingSink::new());
        let storage = TempDir::new().expect("a temporary directory");
        let records = TempDir::new().expect("a temporary directory");
        let spool = TempDir::new().expect("a temporary directory");

        let telemetry = if reports {
            Telemetry::new(TelemetryConfig::new(
                Secret::from_stored("a-secret"),
                spool.path(),
                sink.clone(),
            ))
        } else {
            Telemetry::disabled()
        };

        let library = ModLibrary::new(
            Arc::new(ltk_manager_base::events::NullEventSink),
            Some(storage.path().to_path_buf()),
            "1.17.0",
            Arc::new(ChecksumMismatchState::default()),
            Arc::new(WadReportState::new(Some(storage.path()))),
            Arc::new(WadPathResolverState::default()),
        );

        let pipeline = IncidentPipeline::new(
            config,
            0,
            library,
            Vec::new(),
            SessionStores {
                incidents: Arc::new(IncidentStore::new(records.path().join("incidents"))),
                games: Arc::new(GameStore::new(records.path().join("games"))),
            },
            Arc::new(SilentEvents),
            telemetry,
        );

        Self {
            pipeline,
            sink,
            _dirs: (storage, records, spool),
        }
    }

    /// The one event the session reported, as the vendor would read it.
    fn payload(&self) -> Value {
        self.pipeline.telemetry.flush();
        let mut payloads = self.sink.payloads();
        assert_eq!(payloads.len(), 1, "expected exactly one session event");
        payloads.remove(0)
    }

    fn reported_nothing(&self) -> bool {
        self.pipeline.telemetry.flush();
        self.sink.events().is_empty()
    }
}

fn at(minute: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 8, 12, minute, 0)
        .single()
        .expect("2026-09-08 is a real date")
}

/// A session that ran twenty minutes and ended the way it should.
fn clean_record() -> GameRecord {
    let mut record = GameRecord::open(at(0), SessionOrigin::Library);
    record.ended_at = at(20);
    record.injected = true;
    record.overlay = OverlayOutcome::Live;
    record.launch = LaunchKind::Match;
    record.ending = Ending {
        exit_reason: Some("Exit".to_string()),
        exit_code: Some(0),
        crashed: Some(false),
    };
    record
}

/// The same session, ended by a crash nothing explains.
fn crashed_record() -> GameRecord {
    let mut record = clean_record();
    record.ending = Ending {
        exit_reason: Some("Unknown".to_string()),
        exit_code: Some(-1_073_741_819),
        crashed: Some(true),
    };
    record
}

#[test]
fn a_session_with_no_verdict_reports_one_clean_event() {
    let harness = Harness::new();

    let incident = harness.pipeline.run(clean_record());

    assert!(incident.is_none(), "the record classifies to no verdict");
    let payload = harness.payload();
    assert_eq!(payload["event"], json!("game_session_ended"));
    assert_eq!(payload["properties"]["outcome"], json!("clean"));
    assert_eq!(payload["properties"]["duration_bucket"], json!("15-30m"));
    assert_eq!(payload["properties"]["injected"], json!(true));
    assert_eq!(payload["properties"]["origin"], json!("library"));
}

#[test]
fn a_session_that_reaches_a_verdict_reports_it_with_a_token() {
    let harness = Harness::new();

    let incident = harness.pipeline.run(crashed_record());

    assert!(incident.is_some(), "a crash with no reason is a verdict");
    let payload = harness.payload();
    assert_eq!(payload["properties"]["outcome"], json!("verdict"));
    assert!(
        payload["properties"]["verdict_kind"].is_string(),
        "a verdict names its kind"
    );
    let token = payload["properties"]["incident_token"]
        .as_str()
        .expect("the token travels as one property");
    assert!(token.starts_with("DIAG1-"), "got {token}");
}

#[test]
fn every_session_carries_the_identity_and_the_suppression_flag() {
    let harness = Harness::new();

    harness.pipeline.run(clean_record());

    let payload = harness.payload();
    assert_eq!(
        payload["properties"]["$process_person_profile"],
        json!(false)
    );
    assert!(payload["properties"]["distinct_id"].is_string());
}

#[test]
fn a_handle_that_collects_nothing_reports_nothing() {
    let harness = Harness::off();

    harness.pipeline.run(clean_record());
    harness.pipeline.run(crashed_record());

    assert!(harness.reported_nothing());
}

#[test]
fn no_mod_name_or_path_reaches_a_reported_session() {
    let harness = Harness::new();

    harness.pipeline.run(crashed_record());

    let payload = harness.payload();
    let mut properties = payload["properties"]
        .as_object()
        .expect("the properties are an object")
        .clone();
    properties.remove("incident_token");
    let rendered = serde_json::to_string(&properties).expect("the payload encodes");

    for forbidden in ["C:\\", "/Users/", ".wad.client", ".fantome"] {
        assert!(
            !rendered.contains(forbidden),
            "{forbidden} reached the payload: {rendered}"
        );
    }
}

#[test]
fn a_clean_game_leaves_a_record_that_names_the_served_archives() {
    // The record is built from patcher events, so the game log reader does not gate it.
    let config = Config {
        read_game_log: false,
        ..Config::default()
    };
    let harness = Harness::with(true, config);
    let mut record = clean_record();
    record.redirected = vec![
        "Ahri.wad.client".to_string(),
        "Map11.wad.client".to_string(),
    ];

    let incident = harness.pipeline.run(record.clone());

    assert!(incident.is_none(), "the record classifies to no verdict");
    let games = harness.pipeline.stores.games.list().unwrap();
    assert_eq!(games, [record.stored(None)]);
    assert_eq!(games[0].redirected, record.redirected);
    assert_eq!(games[0].overlay, OverlayOutcome::Live);
}

#[test]
fn a_game_with_a_verdict_names_its_incident_in_the_record() {
    let harness = Harness::new();

    let incident = harness
        .pipeline
        .run(crashed_record())
        .expect("the record classifies to a verdict");

    let games = harness.pipeline.stores.games.list().unwrap();
    assert_eq!(games.len(), 1);
    assert_eq!(games[0].incident.as_deref(), Some(incident.id.as_str()));
}

#[test]
fn a_game_that_was_still_running_is_stored_and_reaches_no_verdict() {
    let harness = Harness::new();
    let mut record = crashed_record();
    record.still_running = true;

    let incident = harness.pipeline.run(record);

    assert!(incident.is_none());
    let games = harness.pipeline.stores.games.list().unwrap();
    assert_eq!(games.len(), 1);
    assert!(games[0].still_running);
    assert_eq!(harness.pipeline.stores.incidents.list().unwrap(), []);
    assert!(harness.reported_nothing());
}

#[test]
fn a_session_that_failed_before_any_game_leaves_no_game_record() {
    let harness = Harness::new();
    let mut record = GameRecord::open(at(0), SessionOrigin::Library);
    record.failure = Some(SessionFailure::Build {
        kind: ErrorKind::Other,
        category: None,
        message: "Overlay build failed".to_string(),
    });

    let incident = harness.pipeline.run(record);

    assert!(incident.is_some(), "a failed session is an incident");
    assert_eq!(harness.pipeline.stores.games.list().unwrap(), []);
}
