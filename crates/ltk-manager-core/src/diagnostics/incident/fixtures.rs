//! Shared test fixtures: the spec's incidents, for the store, token and report tests.

use super::*;

/// The spec's missing-data example, which the store, token and report
/// tests share.
pub(crate) fn incident(id: &str, ended_at: &str) -> Incident {
    let game_line = |at: &str, line: &str, code: &str| Evidence {
        at: at.to_string(),
        source: EvidenceSource::Game,
        line: line.to_string(),
        code: Some(EvidenceCode::from_table(code)),
    };
    let plain = |at: &str, source: EvidenceSource, line: &str| Evidence {
        at: at.to_string(),
        source,
        line: line.to_string(),
        code: None,
    };
    Incident {
            id: id.to_string(),
            started_at: "2026-08-21T21:13:50+00:00".to_string(),
            ended_at: ended_at.to_string(),
            origin: SessionOrigin::Library,
            injected: true,
            overlay: OverlayOutcome::Live,
            redirected: ["Aatrox.wad.client", "Map11.wad.client", "UI.wad.client", "Global.wad.client"]
                .map(String::from)
                .to_vec(),
            skipped: Vec::new(),
            launch: LaunchKind::Match,
            scan: Some(ScanMode::Eager),
            scan_status: None,
            host_elevated: false,
            patcher: PatcherBinaries {
                dll: Some(crate::diagnostics::binary_id::BinaryId {
                    hash: "a150130f1a90dcc2".to_string(),
                    built: Some(0x6A83_01AB),
                }),
                host: Some(crate::diagnostics::binary_id::BinaryId {
                    hash: "cc714b6990a29678".to_string(),
                    built: Some(0x6A83_01D1),
                }),
                matches_bundle: Some(true),
            },
            overlay_detail: None,
            enabled_count: 4,
            phase: GamePhase::Loading,
            failure: None,
            game: Some(GameInfo {
                version: "16.16.804.9184".to_string(),
                content_version: "16.16.1".to_string(),
                log_path: r"C:\Riot Games\League of Legends\Logs\GameLogs\2026-08-21T21-14-02\2026-08-21T21-14-02_r3dlog.txt".to_string(),
            }),
            ending: Ending {
                exit_reason: Some("Interrupt".to_string()),
                exit_code: Some(-1073741819),
                crashed: Some(true),
            },
            verdict: Verdict {
                kind: VerdictKind::MissingData,
                title: VerdictKind::MissingData.title().to_string(),
                title_override: None,
                cause: "League failed to read a file.".to_string(),
                subject: Some(
                    "assets/characters/aatrox/skins/skin12/aatrox_skin12_tx_cm.dds".to_string(),
                ),
                consequence: Consequence::GameStopped,
                hints: vec![hint::DISABLE_SUSPECT.to_string()],
            },
            evidence: vec![
                plain(
                    "00:12.4",
                    EvidenceSource::Client,
                    "Interrupt, exit code 0xC0000005 STATUS_ACCESS_VIOLATION",
                ),
                game_line(
                    "00:12.3",
                    "000012.344|  ERROR| ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081",
                    "ALE-9B39AA45",
                ),
                game_line("00:12.3", "000012.301| ALWAYS|  LOAD| SEJ-9F31B5D0", "SEJ-9F31B5D0"),
                plain("00:04.1", EvidenceSource::Host, "injected, pid 18232"),
                plain(
                    "00:00.0",
                    EvidenceSource::Dll,
                    "redirected Aatrox.wad.client, Map11.wad.client, UI.wad.client, Global.wad.client",
                ),
            ],
            suspects: vec![Suspect {
                mod_id: Some("aatrox-justicar".to_string()),
                project_path: None,
                display_name: "Aatrox Justicar".to_string(),
                because: "writes Aatrox.wad.client, which holds the path".to_string(),
            }],
            dismissed: false,
        }
}
