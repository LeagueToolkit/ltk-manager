//! The redaction canary.
//!
//! The test registers a set of private values, then runs an install, a patcher session that
//! fails and a patcher start that fails. It searches every output for each private value: the
//! log as the log file writer writes it, the incident report text, the incident token, the
//! telemetry events and every file of a support report. One private value in one output fails
//! the test.
//!
//! The binary holds one test, because the tracing subscriber and the redactor are
//! process-wide.

use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, mpsc},
    time::Duration,
};

use fs_err as fs;
use parking_lot::Mutex;

use ltk_manager_assets::{
    hashtables::WadPathResolverState,
    test_util::{make_named_fantome_zip, place_game_wad, point_at_installed_build},
};
use ltk_manager_base::{
    config::Config,
    error::AppError,
    events::{NullEventSink, OverlayProgress},
};
use ltk_manager_core::{
    deep_link::parse_deep_link_url,
    log_dir::LogDir,
    patching::{PatcherThread, PrepareHost, PreparedHost, SessionParams},
    support_report::{
        AppIdentity, ReportDescription, ReportOrigin, ReportProblem, ShownError, SupportReport,
    },
};
use ltk_manager_library::mods::{ChecksumMismatchState, ModLibrary, WadReportState};
use ltk_manager_runtime::{
    diagnostics::{
        CheckCtx,
        binary_id::PatcherBinaries,
        incident::{GameInfo, Incident, OverlayOutcome},
        store::IncidentStore,
        token::IncidentToken,
    },
    patcher::{
        delivery::{Channel, StagedPatcher},
        events::PatcherEvents,
        injector::WadScanFailure,
        state::{PatcherPhase, PatcherStateInner, StoredPatcherConfig},
    },
};
use ltk_redact::{Environment, Placeholder, RedactingWriter};
use ltk_telemetry::{Config as TelemetryConfig, Scrubber, Secret, Telemetry, sink::RecordingSink};

/// The usernames of the runs: ASCII, with a space, Cyrillic and CJK.
const USERNAMES: [&str; 4] = ["privateuser", "private user", "Пользователь", "私人用户名"];

const MACHINE: &str = "PRIVATE-PC-07";
const SECRET: &str = "private-telemetry-secret-5f1c";
const LINK_TOKEN: &str = "privatelinktoken";
/// The directory names that mark the League path, the mod storage path and the workshop path.
const LEAGUE: &str = "PrivateLeague";
const STORAGE: &str = "PrivateStorage";
const WORKSHOP: &str = "PrivateWorkshop";

const MANAGER_VERSION: &str = "1.0.0";
const SESSION_TIMEOUT: Duration = Duration::from_secs(120);

#[test]
fn no_output_holds_a_private_value() {
    let log = Log::install();

    for username in USERNAMES {
        let fixture = Fixture::new(username);
        let outputs = fixture.run();
        let (raw_log, redacted_log) = log.take();
        let support_report = fixture.support_report(&raw_log);

        // The run has to write the private values, or the searches below prove nothing.
        for value in [username, LEAGUE, STORAGE, LINK_TOKEN] {
            assert!(
                !found(&raw_log, &[value]).is_empty(),
                "the unredacted log of the `{username}` run does not hold `{value}`"
            );
        }
        assert!(
            outputs.report.contains("%USERPROFILE"),
            "the incident report of the `{username}` run holds no replaced path"
        );
        assert!(
            outputs.telemetry.contains("game_session_ended"),
            "the `{username}` run sent no session event"
        );
        assert!(
            support_report.contains("%USERPROFILE"),
            "the support report of the `{username}` run holds no replaced path"
        );
        for file in [
            "log/ltk-manager.log",
            "settings.json",
            "system.json",
            "library.json",
            "incidents/",
            "game-log/r3dlog.txt",
            "patcher.json",
        ] {
            assert!(
                support_report.contains(file),
                "the support report of the `{username}` run holds no {file}"
            );
        }

        let everywhere = [username, MACHINE, SECRET, LINK_TOKEN];
        let paths = [LEAGUE, STORAGE, WORKSHOP];
        let all = [everywhere.as_slice(), paths.as_slice()].concat();
        assert_clean("log", username, &redacted_log, &all);
        assert_clean("incident report", username, &outputs.report, &all);
        assert_clean("incident token", username, &outputs.token, &all);
        // Telemetry replaces the profile directory only, so the other paths are not searched.
        assert_clean("telemetry", username, &outputs.telemetry, &everywhere);
        assert_clean("support report", username, &support_report, &all);
    }
}

/// The outputs of one run that are not the log.
struct Outputs {
    report: String,
    /// The fields that the incident token decodes to.
    token: String,
    /// The spool files and the events that the sink received.
    telemetry: String,
}

/// The private values of one run, in a directory tree of their own.
struct Fixture {
    _root: tempfile::TempDir,
    username: &'static str,
    profile: PathBuf,
    app_data: PathBuf,
    config: Config,
}

impl Fixture {
    fn new(username: &'static str) -> Self {
        let temp = tempfile::tempdir().expect("a temporary directory");
        let root = canonical(temp.path());
        let profile = root.join("Users").join(username);
        let app_data = profile
            .join("AppData")
            .join("Roaming")
            .join("dev.leaguetoolkit.manager");

        let mut config = Config {
            mod_storage_path: Some(root.join(STORAGE)),
            workshop_path: Some(root.join(WORKSHOP)),
            ..Config::default()
        };
        point_at_installed_build(&mut config, &root.join(LEAGUE));
        place_game_wad(
            &root.join(LEAGUE),
            "Ashe.wad.client",
            &[("data/characters/ashe/skins/skin0.bin", b"PROP")],
        );
        for dir in [&app_data, &root.join(STORAGE), &root.join(WORKSHOP)] {
            fs::create_dir_all(dir).expect("a fixture directory");
        }

        let fixture = Self {
            _root: temp,
            username,
            profile,
            app_data,
            config,
        };
        fixture.register();
        fixture
    }

    /// Registers the private values with the shared redactor, the way the app does.
    fn register(&self) {
        let profile = self.profile.to_string_lossy().into_owned();
        let environment = Environment::from_lookup(|name| match name {
            "USERPROFILE" => Some(profile.clone()),
            "USERNAME" => Some(self.username.to_owned()),
            "COMPUTERNAME" => Some(MACHINE.to_owned()),
            _ => None,
        });
        ltk_redact::register(Placeholder::Profile, &environment.profile_dir);
        ltk_redact::register(Placeholder::User, &environment.username);
        ltk_redact::register(Placeholder::Machine, &environment.machine);

        // The same calls as `register_private_values` in the app's `state.rs`.
        ltk_redact::register(Placeholder::League, &self.config.league_path);
        ltk_redact::register(Placeholder::Data, &self.config.mod_storage_path);
        ltk_redact::register(Placeholder::Workshop, &self.config.workshop_path);
        ltk_redact::register(Placeholder::Secret, [SECRET]);
    }

    fn run(&self) -> Outputs {
        self.receive_deep_link();

        let library = self.library();
        self.install_mod(&library);

        let sink = Arc::new(RecordingSink::new());
        let spool = self.app_data.join("telemetry");
        let telemetry = Telemetry::new(
            TelemetryConfig::new(Secret::from_stored(SECRET), &spool, sink.clone())
                .with_scrubber(Scrubber::for_profile_dir(self.profile.to_string_lossy())),
        );

        // The host of the first session does not exist, so the session fails after the
        // overlay build. The second start fails before the build.
        let host_exe = self.app_data.join("patcher").join("ltk_patcher_host.exe");
        let exe = host_exe.clone();
        let incident = self
            .run_session(
                &library,
                &telemetry,
                Box::new(move || {
                    Ok(PreparedHost {
                        exe,
                        binaries: PatcherBinaries::default(),
                    })
                }),
                true,
            )
            .expect("the failed session records an incident");
        self.run_session(
            &library,
            &telemetry,
            Box::new(move || Err(AppError::from(fs::read(&host_exe).unwrap_err()))),
            false,
        );

        let token = incident.token(MANAGER_VERSION);
        let decoded = IncidentToken::decode(&token)
            .expect("the token decodes")
            .resolve();

        let mut events = read_files(&spool);
        telemetry.flush();
        for payload in sink.payloads() {
            events.push_str(&payload.to_string());
            events.push('\n');
        }

        Outputs {
            report: incident.report_text(MANAGER_VERSION, Some(&token), &[]),
            token: serde_json::to_string(&decoded).expect("the decoded token serializes"),
            telemetry: events,
        }
    }

    /// The mod library of the fixture.
    fn library(&self) -> ModLibrary {
        ModLibrary::new(
            Arc::new(NullEventSink),
            Some(self.app_data.clone()),
            MANAGER_VERSION,
            Arc::new(ChecksumMismatchState::default()),
            Arc::new(WadReportState::new(self.config.mod_storage_path.as_deref())),
            Arc::new(WadPathResolverState::default()),
        )
    }

    /// Writes a game log under the League path and returns the newest incident of the
    /// store as an incident of that log.
    ///
    /// The log holds the League path and the secret on its command line, and the profile
    /// directory on another line.
    fn incident_with_game_log(&self, store: &IncidentStore) -> Incident {
        let league = self.config.league_path.as_deref().expect("a League path");
        let logs = league.join("Logs").join("GameLogs");
        fs::create_dir_all(&logs).expect("the game log directory");
        let log = logs.join("2026-11-15T14-02-00_r3dlog.txt");
        let lines = format!(
            "000000.000| ALWAYS| Command Line: \"{game}\" \"-GameBaseDir={league}\" -RiotClientAuthToken={SECRET}\n\
             000001.000| ALWAYS| reading {profile}\n",
            game = league.join("Game").join("League of Legends.exe").display(),
            league = league.display(),
            profile = self.profile.join("AppData").display(),
        );
        fs::write(&log, lines).expect("the game log");

        let mut incident = store
            .list()
            .expect("the incident store")
            .into_iter()
            .next()
            .expect("the failed session recorded an incident");
        incident.game = Some(GameInfo {
            version: "16.22".to_owned(),
            content_version: "16.22.1".to_owned(),
            log_path: log.to_string_lossy().into_owned(),
            game_base_dir: Some(league.to_string_lossy().into_owned()),
        });
        incident
    }

    /// Builds a support report with every file that a builder writes, and returns the files
    /// as one text.
    ///
    /// The log file of the report holds `raw_log`, as a release that did not redact the log
    /// wrote it. The settings hold the paths, the secret and two fields that the allowlist
    /// does not name. The description holds the username and a path.
    fn support_report(&self, raw_log: &str) -> String {
        let log_dir = self.app_data.join("logs");
        fs::create_dir_all(&log_dir).expect("the log directory");
        fs::write(log_dir.join("ltk-manager.2026-11-15.log"), raw_log).expect("the log file");

        let app = AppIdentity {
            identifier: "dev.leaguetoolkit.manager".to_owned(),
            version: MANAGER_VERSION.to_owned(),
            release_build: true,
        };
        let downloads = self.profile.join("Downloads");
        let shown = ShownError {
            title: format!("Could not read {}", downloads.display()),
            code: "IO".to_owned(),
            kind: None,
            reference: Some("ab12cd34".to_owned()),
        };
        let description = ReportDescription {
            problem: Some(ReportProblem::ModNotShown),
            mod_name: Some("Test Mod".to_owned()),
            text: format!(
                "{} installed it from {}",
                self.username,
                downloads.display()
            ),
            origin: Some(ReportOrigin::Crash {
                route: "/library".to_owned(),
                message: format!("no file at {}", downloads.display()),
            }),
            errors: vec![shown],
        };
        let mut report = SupportReport::new(app, description, chrono::Utc::now());
        report.add_log(&LogDir::new(&log_dir));
        report.add_settings(&serde_json::json!({
            "leaguePath": self.config.league_path,
            "modStoragePath": self.config.mod_storage_path,
            "workshopPath": self.config.workshop_path,
            "telemetrySecret": SECRET,
            "runeforge": { "username": self.username },
        }));
        report.add_system_checks(&CheckCtx {
            league_path: self.config.league_path.clone(),
            mod_storage_path: self.config.mod_storage_path.clone(),
            mod_storage_is_default: false,
            patcher_dll_path: Some(self.app_data.join("patcher").join("ltk_patcher_dll.dll")),
            manager_exe: Some(self.profile.join("ltk-manager.exe")),
        });
        report.add_library(&self.library(), &self.config);
        let store = IncidentStore::new(self.app_data.join("incidents"));
        report.add_incidents(&store, None);
        report.add_game_log(&self.incident_with_game_log(&store), &self.config);
        let staged = StagedPatcher {
            dir: self.app_data.join("patcher"),
            version: "1.0.0".to_owned(),
            digest: "ab".repeat(32),
            eol: 1_800_000_000,
        };
        report.add_patcher(Channel::Stable, Some(&staged));

        report
            .finish()
            .files()
            .iter()
            .map(|file| format!("{}\n{}\n", file.path, file.contents))
            .collect()
    }

    /// Writes the two log lines of the app's deep link handler for a link with a signed URL.
    ///
    /// The handler needs an `AppHandle`, so the test repeats its lines over the real parser.
    fn receive_deep_link(&self) {
        let link = format!(
            "ltk://install?url=https://cdn.example.com/mods/skin.modpkg%3Fsig%3D{LINK_TOKEN}&name=Skin"
        );
        tracing::info!("Received deep-link: {}", link);
        let request = parse_deep_link_url(&link).expect("the link parses");
        tracing::info!("Parsed deep-link request: {:?}", request);
    }

    fn install_mod(&self, library: &ModLibrary) {
        let downloads = self.profile.join("Downloads");
        fs::create_dir_all(&downloads).expect("the downloads directory");
        let archive = downloads.join("test mod.fantome");
        make_named_fantome_zip(&archive, "Test Mod");
        library
            .install_mod_from_package(&self.config, &archive.to_string_lossy())
            .expect("the mod installs");
    }

    /// Runs one patcher session to its end. Returns the incident that the session recorded,
    /// if `expect_incident` is set.
    fn run_session(
        &self,
        library: &ModLibrary,
        telemetry: &Telemetry,
        prepare_host: PrepareHost,
        expect_incident: bool,
    ) -> Option<Incident> {
        let (phases, phase_changes) = mpsc::channel();
        let (incidents, recorded) = mpsc::channel();
        let state = Arc::new(Mutex::new(PatcherStateInner::new()));
        let stored_config = StoredPatcherConfig {
            workshop_projects: None,
            workshop_layers: None,
        };
        let params = SessionParams {
            prepare_host,
            config: self.config.clone(),
            library: library.clone(),
            workshop_projects: Vec::new(),
            host_flags: 0,
            incident_store: Arc::new(IncidentStore::new(self.app_data.join("incidents"))),
            force_rebuild: false,
            telemetry: telemetry.clone(),
        };
        PatcherThread::start(
            Arc::new(Events { phases, incidents }),
            &state,
            &Arc::new(Mutex::new(None)),
            stored_config,
            params,
        )
        .expect("the session starts");

        loop {
            match phase_changes.recv_timeout(SESSION_TIMEOUT) {
                Ok(PatcherPhase::Idle) => break,
                Ok(_) => {}
                Err(_) => panic!("the session did not end"),
            }
        }
        let thread = state.lock().thread_handle.take();
        if let Some(thread) = thread {
            thread.join().expect("the session thread ends");
        }
        expect_incident
            .then(|| recorded.recv_timeout(SESSION_TIMEOUT).ok())
            .flatten()
    }
}

/// A listener that forwards the phases and the incidents of a session.
struct Events {
    phases: mpsc::Sender<PatcherPhase>,
    incidents: mpsc::Sender<Incident>,
}

impl PatcherEvents for Events {
    fn phase_changed(&self, phase: PatcherPhase) {
        let _ = self.phases.send(phase);
    }
    fn error(&self, _error: AppError) {}
    fn overlay_progress(&self, _progress: OverlayProgress) {}
    fn wad_scan_failed(&self, _failures: Vec<WadScanFailure>) {}
    fn game_attached(&self, _pid: Option<u64>) {}
    fn game_overlay(&self, _outcome: OverlayOutcome) {}
    fn game_exited(&self) {}
    fn overlay_deferred(&self) {}
    fn incident_recorded(&self, incident: Incident) {
        let _ = self.incidents.send(incident);
    }
}

/// The log of the process, unredacted and as the log file writer writes it.
#[derive(Clone, Default)]
struct Log {
    raw: Buffer,
    redacted: Buffer,
}

impl Log {
    /// Installs the process-wide subscriber, which writes every event to both buffers.
    fn install() -> Self {
        let log = Self::default();
        let writer = log.clone();
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_ansi(false)
            .with_writer(move || Tee {
                raw: writer.raw.clone(),
                redacted: RedactingWriter::new(writer.redacted.clone()),
            })
            .init();
        log
    }

    /// Returns the unredacted log and the redacted log, and empties both.
    fn take(&self) -> (String, String) {
        (self.raw.take(), self.redacted.take())
    }
}

#[derive(Clone, Default)]
struct Buffer(Arc<Mutex<Vec<u8>>>);

impl Buffer {
    fn take(&self) -> String {
        String::from_utf8_lossy(&std::mem::take(&mut *self.0.lock())).into_owned()
    }
}

impl Write for Buffer {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Writes each event to the unredacted buffer and, through the log file writer, to the
/// redacted buffer.
struct Tee {
    raw: Buffer,
    redacted: RedactingWriter<Buffer>,
}

impl Write for Tee {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.raw.write_all(buf)?;
        self.redacted.write_all(buf)?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Returns `path` in its canonical form without the `\\?\` prefix, so that a path that the
/// code canonicalizes has the spelling that the test registers.
fn canonical(path: &Path) -> PathBuf {
    let path = fs::canonicalize(path).expect("the directory exists");
    match path.to_str().and_then(|text| text.strip_prefix(r"\\?\")) {
        Some(stripped) => PathBuf::from(stripped),
        None => path,
    }
}

/// Returns the contents of every file under `dir`, read lossily. Returns an empty string if
/// `dir` does not exist.
fn read_files(dir: &Path) -> String {
    let mut out = String::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for path in entries.flatten().map(|entry| entry.path()) {
        if path.is_dir() {
            out.push_str(&read_files(&path));
        } else if let Ok(bytes) = fs::read(&path) {
            out.push_str(&String::from_utf8_lossy(&bytes));
            out.push('\n');
        }
    }
    out
}

/// Fails if `output` holds one of `values`.
fn assert_clean(output_name: &str, username: &str, output: &str, values: &[&str]) {
    let hits = found(output, values);
    assert!(
        hits.is_empty(),
        "the {output_name} of the `{username}` run holds a private value:\n{}",
        hits.join("\n")
    );
}

/// Returns the lines of `output` that hold one of `values`, each after the value it holds.
///
/// A value matches in any letter case, with either separator, with doubled separators and
/// in its percent-encoded form.
fn found(output: &str, values: &[&str]) -> Vec<String> {
    let needles: Vec<String> = values
        .iter()
        .flat_map(|value| [fold(value), fold(&percent_encoded(value))])
        .collect();
    output
        .lines()
        .filter_map(|line| {
            let folded = fold(line);
            let needle = needles.iter().find(|needle| folded.contains(*needle))?;
            Some(format!("`{needle}` in: {line}"))
        })
        .collect()
}

/// Returns `text` in lowercase, with `\` for each separator and one `\` for each run of them.
fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.to_lowercase().chars() {
        let c = if c == '/' { '\\' } else { c };
        if c != '\\' || !out.ends_with('\\') {
            out.push(c);
        }
    }
    out
}

/// Returns `text` with every byte that is not an ASCII letter or digit as `%XX`.
fn percent_encoded(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b if b.is_ascii_alphanumeric() => char::from(b).to_string(),
            b => format!("%{b:02X}"),
        })
        .collect()
}
