//! Writes one incident per [`VerdictKind`] into the incident store, so every
//! verdict can be looked at without waiting for the game to produce it.
//!
//! Each seed is a [`GameRecord`] put through the real classifier rather than a
//! hand-written [`Incident`]. A literal would drift the moment a cause sentence
//! or a hint changed, and would show a screen the app cannot actually reach.
//! What lands on disk here is what the manager would have written.
//!
//! ```text
//! cargo run -p ltk-manager-core --example seed_incidents            # write them
//! cargo run -p ltk-manager-core --example seed_incidents -- --clear # take them away
//! cargo run -p ltk-manager-core --example seed_incidents -- --dir <path>
//! ```
//!
//! Ids are prefixed `mock-`, which is what `--clear` looks for and what keeps a
//! seed from ever colliding with a real incident's log stamp.

use std::io::Cursor;
use std::path::PathBuf;

use chrono::{DateTime, Duration, Utc};
use ltk_manager_core::diagnostics::game_log::GameLogFacts;
use ltk_manager_core::diagnostics::incident::{
    ClassifyContext, Ending, EvidenceSource, GameRecord, LaunchKind, ModFootprint, OverlayDetail,
    OverlayOutcome, ProjectFootprint, RawEvidence, ScanMode, SessionFailure, SkippedArchive,
    VerdictKind,
};
use ltk_manager_core::diagnostics::store::IncidentStore;
use ltk_manager_core::error::ErrorKind;
use ltk_manager_core::patcher::injector::WadScanFailure;
use ltk_manager_core::patcher::{InjectionStage, SessionOrigin};

/// The prefix every seeded id carries.
const PREFIX: &str = "mock-";

fn main() {
    let mut args = std::env::args().skip(1);
    let mut dir: Option<PathBuf> = None;
    let mut clear = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--clear" => clear = true,
            "--dir" => dir = args.next().map(PathBuf::from),
            other => {
                eprintln!("unknown argument {other:?}");
                std::process::exit(2);
            }
        }
    }

    let dir = dir.unwrap_or_else(default_dir);
    // Past the store's own cap, so seeding never evicts a real incident.
    let store = IncidentStore::new(dir.clone()).with_keep(200);

    let removed = clear_seeds(&store);
    if clear {
        println!("removed {removed} seeded incidents from {}", dir.display());
        return;
    }

    let mods = library();
    let projects = [ProjectFootprint {
        project_path: r"C:\mods\aatrox-justicar".to_string(),
        display_name: "aatrox-justicar".to_string(),
        affected_wads: vec!["Aatrox.wad.client".to_string()],
    }];
    let resolve_hash = |hash: u64| {
        (hash == 0x1a2b_3c4d_5e6f_7081)
            .then(|| "assets/characters/aatrox/skins/skin12/aatrox_skin12_tx_cm.dds".to_string())
    };
    let ctx = ClassifyContext {
        mods: &mods,
        projects: &projects,
        resolve_hash: &resolve_hash,
    };

    let mut written = 0;
    let mut missing: Vec<VerdictKind> = Vec::new();
    for (index, (kind, build)) in seeds().into_iter().enumerate() {
        // Newest first in the rail, one every eleven minutes back from now.
        let ended_at = Utc::now() - Duration::minutes(11 * index as i64);
        let record = build(base(ended_at));
        let Some(mut incident) = record.classify(&ctx) else {
            missing.push(kind);
            continue;
        };
        if incident.verdict.kind != kind {
            eprintln!(
                "seed {index} was built for {kind:?} but classified as {:?}",
                incident.verdict.kind
            );
            std::process::exit(1);
        }
        incident.id = format!("{PREFIX}{index:02}-{}", slug(kind));
        // Every third one dismissed, so the dimmed row is on screen too.
        incident.dismissed = index % 3 == 2;
        match store.record(&incident) {
            Ok(()) => {
                written += 1;
                println!(
                    "{:<29} {:<19} {}",
                    incident.id, incident.verdict.consequence, incident.verdict.title
                );
            }
            Err(error) => eprintln!("could not write {}: {error}", incident.id),
        }
    }

    if !missing.is_empty() {
        eprintln!("no incident classified for {missing:?}");
        std::process::exit(1);
    }
    println!("\n{written} seeded into {}", dir.display());
    println!("`--clear` takes them away again");
}

/// The app data directory the manager itself uses.
fn default_dir() -> PathBuf {
    let root = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })
    };
    root.expect("a home directory")
        .join("dev.leaguetoolkit.manager")
        .join("incidents")
}

fn clear_seeds(store: &IncidentStore) -> usize {
    let Ok(incidents) = store.list() else {
        return 0;
    };
    let mut removed = 0;
    for incident in incidents.iter().filter(|i| i.id.starts_with(PREFIX)) {
        if std::fs::remove_file(store.dir().join(format!("{}.json", incident.id))).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn slug(kind: VerdictKind) -> &'static str {
    match kind {
        VerdictKind::PatcherDidNotRun => "dll-injection-failed",
        VerdictKind::OverlayBuildFailed => "overlay-build-failed",
        VerdictKind::InjectionHostFailed => "injection-host-failed",
        VerdictKind::PatcherOutOfDate => "patcher-out-of-date",
        VerdictKind::ArchiveRejected => "archive-rejected",
        VerdictKind::SkinhackDetected => "skinhack-detected",
        VerdictKind::OverlayDisabled => "overlay-disabled",
        VerdictKind::Unmodded => "unmodded",
        VerdictKind::MissingData => "missing-data",
        VerdictKind::CorruptArchive => "corrupt-archive",
        VerdictKind::TextureFailed => "texture-failed",
        VerdictKind::OutOfMemory => "out-of-memory",
        VerdictKind::GraphicsFault => "graphics-fault",
        VerdictKind::StuckLoading => "stuck-loading",
        VerdictKind::ArchiveSkipped => "archive-skipped",
        VerdictKind::EndedWithoutReason => "ended-without-reason",
    }
}

fn library() -> Vec<ModFootprint> {
    [
        ("aatrox-justicar", "Aatrox Justicar", 0, "Aatrox.wad.client"),
        ("classic-rift", "Classic Rift", 1, "Map11.wad.client"),
        ("graves-pengu", "Pengu Graves", 2, "Graves.wad.client"),
        ("ahri-spirit", "Spirit Blossom Ahri", 3, "Ahri.wad.client"),
    ]
    .into_iter()
    .map(|(mod_id, display_name, priority, wad)| ModFootprint {
        mod_id: mod_id.to_string(),
        display_name: display_name.to_string(),
        priority,
        affected_wads: vec![wad.to_string()],
    })
    .collect()
}

/// A modded game that ran and crashed, which every seed starts from.
fn base(ended_at: DateTime<Utc>) -> GameRecord {
    let started_at = ended_at - Duration::seconds(12);
    GameRecord {
        started_at,
        ended_at,
        origin: SessionOrigin::Library,
        failure: None,
        injected: true,
        overlay: OverlayOutcome::Live,
        overlay_detail: None,
        redirected: ["Aatrox.wad.client", "Map11.wad.client", "UI.wad.client"]
            .map(String::from)
            .to_vec(),
        skipped: Vec::new(),
        scan_failures: Vec::new(),
        launch: LaunchKind::Match,
        scan: Some(ScanMode::Eager),
        host_elevated: false,
        patcher: ltk_manager_core::diagnostics::binary_id::PatcherBinaries {
            dll: Some(ltk_manager_core::diagnostics::binary_id::BinaryId {
                hash: "a150130f1a90dcc2".to_string(),
                built: Some(0x6A83_01AB),
            }),
            host: Some(ltk_manager_core::diagnostics::binary_id::BinaryId {
                hash: "cc714b6990a29678".to_string(),
                built: Some(0x6A83_01D1),
            }),
            matches_bundle: Some(true),
        },
        ending: Ending {
            exit_reason: Some("Interrupt".to_string()),
            exit_code: Some(-1073741819),
            crashed: Some(true),
        },
        log_path: Some(PathBuf::from(
            r"C:\Riot Games\League of Legends\Logs\GameLogs\mock\mock_r3dlog.txt",
        )),
        log: None,
        timeline: vec![
            line(started_at, EvidenceSource::Host, "game found"),
            line(started_at, EvidenceSource::Dll, "init done"),
            line(
                started_at,
                EvidenceSource::Dll,
                "redirected Aatrox.wad.client, Map11.wad.client, UI.wad.client",
            ),
        ],
    }
}

/// A session that ended before any game.
///
/// The base record is a game that ran, so a failure seed has to take that back:
/// nothing was injected, nothing was redirected, no client ever reported an
/// ending, and the timeline holds only what the host got to say.
fn failed(mut record: GameRecord, failure: SessionFailure, host_lines: &[&str]) -> GameRecord {
    let at = record.started_at;
    record.failure = Some(failure);
    record.injected = false;
    record.overlay = OverlayOutcome::None;
    record.redirected.clear();
    record.log = None;
    record.log_path = None;
    record.ending = Ending::default();
    record.timeline = host_lines
        .iter()
        .map(|text| line(at, EvidenceSource::Host, text))
        .collect();
    record
}

fn line(at: DateTime<Utc>, source: EvidenceSource, text: &str) -> RawEvidence {
    RawEvidence {
        at,
        source,
        line: text.to_string(),
    }
}

/// A game log built from `body`, read by the real reader so the evidence lines
/// and the excerpt look exactly as they would from a game.
fn log(body: &[&str]) -> GameLogFacts {
    let mut text = String::from(
        "000000.000| ALWAYS| Logging started at 2026-08-21T21:26:15.487\n\
         000000.001| ALWAYS| Build Version: Version 16.16.804.9184\n\
         000000.002| ALWAYS| Content Version: 16.16.8049184+branch.releases-16-16.content.release\n\
         000000.003| ALWAYS| Command Line: \"-GameBaseDir=C:\\Riot Games\\League of Legends\" \"-EnableCrashpad\"\n\
         000001.204| ALWAYS|  STRT| Client Clock Synchronization Started\n",
    );
    for row in body {
        text.push_str(row);
        text.push('\n');
    }
    GameLogFacts::read(Cursor::new(text)).expect("the seeded log reads")
}

/// The loading run every log that gets past the loading screen carries.
const LOADED: &[&str] = &[
    "000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20",
    "000008.112| ALWAYS|  LOAD| SEJ-9F31B5D0",
    "000009.004| ALWAYS|  LOAD| SEJ-3E9A0C57",
    "000009.550| ALWAYS| Loading Ended",
    "000010.100| ALWAYS| GAMESTATE_GAMELOOP EndRender & EndFrame",
];

type Seed = (VerdictKind, fn(GameRecord) -> GameRecord);

/// One seed per kind, in the classifier's own precedence order.
fn seeds() -> Vec<Seed> {
    vec![
        (VerdictKind::PatcherDidNotRun, |r| {
            failed(
                r,
                SessionFailure::Injection {
                    stage: InjectionStage::Injection,
                    message: "the DLL never attached after 60s".to_string(),
                },
                &["game found"],
            )
        }),
        (VerdictKind::OverlayBuildFailed, |r| {
            failed(
                r,
                SessionFailure::Build {
                    kind: ErrorKind::Io,
                    message: "Access is denied. (os error 5)".to_string(),
                },
                &[],
            )
        }),
        (VerdictKind::InjectionHostFailed, |r| {
            failed(
                r,
                SessionFailure::Injection {
                    stage: InjectionStage::Host,
                    message: "the host exited before it was configured".to_string(),
                },
                &[],
            )
        }),
        (VerdictKind::PatcherOutOfDate, |mut r| {
            r.overlay = OverlayOutcome::EndOfLife;
            r.overlay_detail = Some(OverlayDetail::Build("0x68a1b2c3".to_string()));
            r.redirected.clear();
            r
        }),
        (VerdictKind::SkinhackDetected, |mut r| {
            r.scan_failures = vec![WadScanFailure {
                wad: Some("Graves.wad.client".to_string()),
                status: "c0000229".to_string(),
            }];
            r.overlay = OverlayOutcome::Disabled;
            r.redirected.clear();
            r.timeline.push(line(
                r.started_at,
                EvidenceSource::Dll,
                "scan rejected Graves.wad.client, status c0000229",
            ));
            r
        }),
        (VerdictKind::ArchiveRejected, |mut r| {
            // A rejection the scan did not call a skinhack, so the two kinds
            // can be told apart on screen.
            r.scan_failures = vec![WadScanFailure {
                wad: Some("Ahri.wad.client".to_string()),
                status: "c000003e".to_string(),
            }];
            r.overlay = OverlayOutcome::Disabled;
            r.redirected.clear();
            r.timeline.push(line(
                r.started_at,
                EvidenceSource::Dll,
                "scan rejected Ahri.wad.client, status c000003e",
            ));
            r
        }),
        (VerdictKind::OverlayDisabled, |mut r| {
            r.overlay = OverlayOutcome::Disabled;
            r.overlay_detail = Some(OverlayDetail::Rejected {
                wad: "Ahri.wad.client".to_string(),
                why: "a chunk did not decompress".to_string(),
            });
            r.redirected.clear();
            r
        }),
        (VerdictKind::Unmodded, |mut r| {
            r.overlay = OverlayOutcome::TooLate;
            r.redirected.clear();
            r
        }),
        (VerdictKind::MissingData, |mut r| {
            r.log = Some(log(&[
                "000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20",
                "000008.112| ALWAYS|  LOAD| SEJ-9F31B5D0",
                "000012.344|  ERROR| ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081",
            ]));
            r
        }),
        (VerdictKind::CorruptArchive, |mut r| {
            r.log = Some(log(&[
                "000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20",
                "000007.880|  ERROR| ALE-18967991 could not mount an archive",
            ]));
            r
        }),
        (VerdictKind::TextureFailed, |mut r| {
            r.log = Some(log(&[
                "000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20",
                "000009.004| ALWAYS|  LOAD| SEJ-3E9A0C57",
                "000009.210|  ERROR| Error: \"ALE-D0D00020\" - Result: E_INVALIDARG.",
            ]));
            r
        }),
        (VerdictKind::OutOfMemory, |mut r| {
            r.log = Some(log(&[
                "000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20",
                "000011.020|  ERROR| ALE-546D9FE7 allocation failed",
            ]));
            r
        }),
        (VerdictKind::GraphicsFault, |mut r| {
            r.log = Some(log(&[
                "000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20",
                "000010.700|  ERROR| ALE-1234567890 device reset failed",
            ]));
            r
        }),
        (VerdictKind::StuckLoading, |mut r| {
            // No `Loading Ended`, so the last LOAD marker is the step that hung.
            r.log = Some(log(&[
                "000003.691| ALWAYS|  LOAD| SEJ-1A4F7C20",
                "000008.112| ALWAYS|  LOAD| SEJ-9F31B5D0",
            ]));
            r
        }),
        (VerdictKind::ArchiveSkipped, |mut r| {
            r.scan = Some(ScanMode::Lazy);
            r.skipped = vec![SkippedArchive {
                wad: "Ahri.wad.client".to_string(),
                why: "anti-hack scan blocked (c0000229)".to_string(),
            }];
            r.log = Some(log(LOADED));
            r.ending = Ending {
                exit_reason: Some("Exit".to_string()),
                exit_code: Some(0),
                crashed: Some(false),
            };
            r
        }),
        (VerdictKind::EndedWithoutReason, |mut r| {
            r.log = Some(log(LOADED));
            r.ending = Ending {
                exit_reason: None,
                exit_code: None,
                crashed: Some(true),
            };
            r
        }),
    ]
}
