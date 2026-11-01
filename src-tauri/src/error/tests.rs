//! Unit tests for the response payload's wire shape and the IPC envelope.

use super::*;
use ltk_manager_assets::hashtables::{HashtableError, SyncHolder};
use ltk_manager_runtime::patcher::injector::InjectorError;
use ltk_manager_runtime::patcher::session::SessionError;
use ltk_manager_runtime::patcher::InjectionStage;
use serde_json::Value;

fn wire(error: AppError) -> Value {
    serde_json::to_value(AppErrorResponse::from(error)).unwrap()
}

#[test]
fn the_code_is_the_variant_in_screaming_snake_case() {
    assert_eq!(wire(AppError::LeagueNotFound)["code"], "LEAGUE_NOT_FOUND");
    assert_eq!(
        wire(AppError::WorkshopNotConfigured)["code"],
        "WORKSHOP_NOT_CONFIGURED"
    );
    assert_eq!(
        wire(AppError::ProjectAlreadyExists("x".into()))["code"],
        "PROJECT_ALREADY_EXISTS"
    );
    assert_eq!(wire(AppError::Other("x".into()))["code"], "UNKNOWN");
    assert_eq!(wire(AppError::from(PatcherError::Busy))["code"], "PATCHER");
}

/// A variant with nothing to translate over is only its code, so the
/// frontend never sees a `detail` it would have to explain away.
#[test]
fn a_unit_variant_carries_only_its_code() {
    for error in [AppError::LeagueNotFound, AppError::WorkshopNotConfigured] {
        let json = wire(error);
        assert_eq!(json.as_object().unwrap().len(), 1, "{json}");
    }
}

/// Prose from outside the app travels as `detail`, never as the message.
#[test]
fn an_outside_error_rides_as_detail() {
    let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "disk full");
    let json = wire(AppError::Io(io));
    assert_eq!(json["code"], "IO");
    assert_eq!(json["detail"], "disk full");
    assert!(json.get("message").is_none());
}

#[test]
fn a_free_text_variant_rides_as_detail() {
    assert_eq!(
        wire(AppError::ValidationFailed("Name is empty".into()))["detail"],
        "Name is empty"
    );
    assert_eq!(wire(AppError::Other("oops".into()))["detail"], "oops");
    assert_eq!(
        wire(AppError::PackFailed("no layers".into()))["detail"],
        "no layers"
    );
}

#[test]
fn invalid_path_carries_the_path() {
    let json = wire(AppError::InvalidPath("/bad/path".into()));
    assert_eq!(json["code"], "INVALID_PATH");
    assert_eq!(json["path"], "/bad/path");
}

#[test]
fn mod_not_found_carries_the_mod_id() {
    let json = wire(AppError::ModNotFound("mod123".into()));
    assert_eq!(json["code"], "MOD_NOT_FOUND");
    assert_eq!(json["modId"], "mod123");
}

#[test]
fn project_not_found_carries_the_project_name() {
    let json = wire(AppError::ProjectNotFound("my-project".into()));
    assert_eq!(json["code"], "PROJECT_NOT_FOUND");
    assert_eq!(json["projectName"], "my-project");
}

#[test]
fn schema_version_too_new_carries_both_versions() {
    let json = wire(AppError::SchemaVersionTooNew {
        file_version: 4,
        max_supported: 3,
    });
    assert_eq!(json["code"], "SCHEMA_VERSION_TOO_NEW");
    assert_eq!(json["fileVersion"], 4);
    assert_eq!(json["maxSupported"], 3);
}

/// Every hashtable failure shares one code. `HashtableError` is not
/// `Serialize`, so the detail is the only place its own words can ride.
#[test]
fn every_hashtable_failure_shares_one_code() {
    let json = wire(AppError::from(HashtableError::SyncLocked(
        SyncHolder::unknown(),
    )));
    assert_eq!(json["code"], "HASHTABLE");
    assert!(json["detail"].as_str().unwrap().contains("already syncing"));
}

/// Every patcher failure shares one code, so the nested `kind` is the only
/// thing separating them. It must survive the mapping for each variant.
#[test]
fn every_patcher_variant_reaches_the_frontend_distinguishable() {
    let kinds = [
        (PatcherError::Busy, "BUSY"),
        (PatcherError::AlreadyRunning, "ALREADY_RUNNING"),
        (PatcherError::NotRunning, "NOT_RUNNING"),
        (PatcherError::UnsupportedPlatform, "UNSUPPORTED_PLATFORM"),
        (PatcherError::LeagueElevated, "LEAGUE_ELEVATED"),
        (PatcherError::ManagerElevated, "MANAGER_ELEVATED"),
        (
            PatcherError::DllUnavailable {
                message: "no connection".to_string(),
                reason: "network".to_string(),
            },
            "DLL_UNAVAILABLE",
        ),
        (
            PatcherError::InjectionFailed {
                stage: InjectionStage::Host,
                message: "host died".to_string(),
            },
            "INJECTION_FAILED",
        ),
    ];
    for (error, expected) in kinds {
        let json = wire(AppError::from(error));
        assert_eq!(json["code"], "PATCHER");
        assert_eq!(json["error"]["kind"], expected);
    }
}

#[test]
fn an_injection_failure_keeps_the_stage_and_the_reason() {
    let error = PatcherError::from(SessionError::Injector(InjectorError::Failed(
        "DLL never attached after 60s".to_string(),
    )));
    let json = wire(AppError::from(error));

    assert_eq!(json["error"]["kind"], "INJECTION_FAILED");
    assert_eq!(json["error"]["stage"], "INJECTION");
    assert!(json["error"]["message"]
        .as_str()
        .unwrap()
        .contains("DLL never attached"));
}

/// Each launcher failure has its own remedy in the UI, and the nested `kind`
/// is what tells them apart.
#[test]
fn every_launcher_variant_shares_one_code_and_keeps_its_kind() {
    let cases = [
        (
            LauncherError::RiotClientNotFound {
                installs_path: "C:/ProgramData/…/RiotClientInstalls.json".to_string(),
            },
            "RIOT_CLIENT_NOT_FOUND",
        ),
        (
            LauncherError::RiotClientUnreachable {
                reason: "HTTP 404".to_string(),
            },
            "RIOT_CLIENT_UNREACHABLE",
        ),
        (
            LauncherError::Refused {
                riot_error_code: "eula_not_accepted".to_string(),
                message: "Accept the Terms of Service".to_string(),
            },
            "REFUSED",
        ),
        (LauncherError::Stopped, "STOPPED"),
        (
            LauncherError::Misconfigured {
                reason: "the game process name is empty".to_string(),
            },
            "MISCONFIGURED",
        ),
        (
            LauncherError::SpawnFailed {
                reason: "access denied".to_string(),
            },
            "SPAWN_FAILED",
        ),
        (LauncherError::UnsupportedPlatform, "UNSUPPORTED_PLATFORM"),
        (
            LauncherError::Other {
                message: "something new upstream".to_string(),
            },
            "OTHER",
        ),
    ];

    for (error, expected_kind) in cases {
        let json = wire(AppError::from(error));
        assert_eq!(json["code"], "LAUNCHER");
        assert_eq!(json["error"]["kind"], expected_kind);
    }
}

#[test]
fn riot_client_not_found_carries_the_path_it_tried() {
    let json = wire(AppError::from(LauncherError::RiotClientNotFound {
        installs_path: "C:/ProgramData/Riot Games/RiotClientInstalls.json".to_string(),
    }));

    assert_eq!(json["error"]["kind"], "RIOT_CLIENT_NOT_FOUND");
    assert_eq!(
        json["error"]["installsPath"],
        "C:/ProgramData/Riot Games/RiotClientInstalls.json"
    );
}

#[test]
fn a_workshop_error_travels_whole() {
    let json = wire(AppError::from(WorkshopError::LayerFileConflict {
        conflicts: vec!["a.bin".into(), "b.bin".into()],
    }));
    assert_eq!(json["code"], "WORKSHOP");
    assert_eq!(json["error"]["kind"], "LAYER_FILE_CONFLICT");
    assert_eq!(json["error"]["conflicts"][1], "b.bin");
}

/// The overlay's failure categories exist so the frontend can branch on the
/// remedy: fix the game dir, blame a mod, split a mod, report a bug.
#[test]
fn every_overlay_category_reaches_the_frontend_distinguishable() {
    use ltk_overlay::{CorruptionError, GameDirError, Invariant, ModContentError, WadLimitError};

    let cases: [(ltk_overlay::Error, &str); 6] = [
        (
            GameDirError::MissingDataFinal {
                path: "D:/Games/League".into(),
            }
            .into(),
            "GAME_DIR",
        ),
        (ModContentError::FantomeInfoMissing.into(), "MOD_CONTENT"),
        (
            WadLimitError::TooManyChunks {
                wad: "Map11.wad.client".into(),
                count: u32::MAX as usize + 1,
            }
            .into(),
            "WAD_LIMIT",
        ),
        (
            CorruptionError::TruncatedWad {
                wad: "Aatrox.wad.client".into(),
                reach: 100,
                len: 50,
            }
            .into(),
            "CORRUPT",
        ),
        (
            ltk_overlay::Error::Bug(Invariant::OverrideNeverPrepared),
            "BUG",
        ),
        (
            std::io::Error::from(std::io::ErrorKind::PermissionDenied).into(),
            "OTHER",
        ),
    ];

    for (error, expected_category) in cases {
        let json = wire(AppError::Overlay(error));
        assert_eq!(json["code"], "OVERLAY");
        assert_eq!(json["category"], expected_category);
    }
}

/// The category names the remedy, but the user still reads the detail, so
/// its own words must survive the mapping.
#[test]
fn an_overlay_detail_carries_the_words() {
    use ltk_overlay::GameDirError;

    let json = wire(AppError::Overlay(
        GameDirError::MissingDataFinal {
            path: "D:/Games/League".into(),
        }
        .into(),
    ));
    let detail = json["detail"].as_str().unwrap();

    assert!(detail.contains("D:/Games/League"), "{detail}");
    assert!(detail.contains("DATA/FINAL"), "{detail}");
}

#[test]
fn a_response_round_trips_through_json() {
    let response = AppErrorResponse::from(AppError::SchemaVersionTooNew {
        file_version: 4,
        max_supported: 3,
    });
    let json = serde_json::to_string(&response).unwrap();
    let back: AppErrorResponse = serde_json::from_str(&json).unwrap();
    assert!(matches!(
        back,
        AppErrorResponse::SchemaVersionTooNew {
            file_version: 4,
            max_supported: 3
        }
    ));
}

#[test]
fn ipc_result_ok_serialization() {
    let result: IpcResult<String> = IpcResult::ok("hello".to_string());
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["value"], "hello");
}

#[test]
fn ipc_result_err_serialization() {
    let result: IpcResult<String> = IpcResult::err(AppErrorResponse::Io {
        detail: "disk full".into(),
    });
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["ok"], false);
    assert_eq!(json["error"]["code"], "IO");
    assert_eq!(json["error"]["detail"], "disk full");
}

/// The wire, in one line: a code and the fields, and nothing else.
#[test]
fn the_envelope_carries_the_code_and_the_fields_only() {
    let result: IpcResult<()> = Err::<(), AppError>(AppError::SchemaVersionTooNew {
        file_version: 4,
        max_supported: 3,
    })
    .into();
    assert_eq!(
        serde_json::to_value(&result).unwrap(),
        serde_json::json!({
            "ok": false,
            "error": { "code": "SCHEMA_VERSION_TOO_NEW", "fileVersion": 4, "maxSupported": 3 }
        })
    );
}

#[test]
fn ipc_result_from_ok() {
    let result: IpcResult<i32> = Ok::<i32, AppErrorResponse>(42).into();
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["value"], 42);
}

#[test]
fn ipc_result_from_err() {
    let result: IpcResult<i32> = Err::<i32, AppError>(AppError::Other("oops".into())).into();
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["ok"], false);
    assert_eq!(json["error"]["code"], "UNKNOWN");
}

/// A domain failure reaches the shell without its type, so each is read back by it.
#[test]
fn a_domain_failure_keeps_its_own_code() {
    use ltk_manager_assets::preview::PreviewError;

    assert_eq!(
        wire(AppError::from(PreviewError::NotCube))["code"],
        "PREVIEW"
    );
    assert_eq!(
        wire(AppError::from(BinDocumentError::ReadTooLarge))["code"],
        "BIN_READ_TOO_LARGE"
    );
}
