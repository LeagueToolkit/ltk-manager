//! Backend → frontend notifications, decoupled from any particular UI.
//!
//! Domain code emits [`BackendEvent`]s through an [`EventSink`] rather than
//! calling into Tauri. The Tauri shell supplies a sink that maps each variant to
//! an `app_handle.emit(name, payload)` call; a CLI would map the same variants
//! to progress bars or log lines.
//!
//! The enum is also the single registry of event names. Before this, names were
//! scattered string literals at each emit site with no compile-time link to the
//! frontend listeners, so the two could drift silently.

use serde::{Deserialize, Serialize};

/// Launch progress is defined by the crate that produces it, and re-exported
/// here so every payload in the registry below can be named from one module.
pub use ritoclient_api::{LaunchProgress, LaunchStage};

/// Receives notifications from domain operations.
///
/// Implementations must not block: sinks are called from inside index locks and
/// from the overlay builder's progress callback, which runs per file.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: BackendEvent);
}

/// A sink that drops everything. Useful for tests and for non-interactive
/// callers that don't care about progress.
pub struct NullEventSink;

impl EventSink for NullEventSink {
    fn emit(&self, _event: BackendEvent) {}
}

/// Stage of an overlay build.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum OverlayStage {
    Indexing,
    Collecting,
    Patching,
    Strings,
    Complete,
}

/// Progress of an overlay build.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct OverlayProgress {
    pub stage: OverlayStage,
    pub current_file: Option<String>,
    pub current: u32,
    pub total: u32,
}

/// Progress of a bulk mod install, emitted per file.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

/// Which half of a cslol migration is running.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum MigrationPhase {
    Packaging,
    Installing,
}

/// Progress of a cslol migration, across both phases.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct MigrationProgress {
    pub phase: MigrationPhase,
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

/// Stage of a fantome import.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum FantomeImportStage {
    Extracting,
    Finalizing,
    Complete,
    Error,
}

/// Progress of a fantome import.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FantomeImportProgress {
    pub stage: FantomeImportStage,
    pub current_wad: Option<String>,
    pub current: u32,
    pub total: u32,
}

/// Progress of a hashtable sync, one event per release asset download.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct HashtableSyncProgress {
    /// Release asset filename being fetched, e.g. `manifest.json`.
    pub file: String,
}

/// Stage of a git repository import.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum GitImportStage {
    Downloading,
    Extracting,
    Complete,
    Error,
}

/// Progress of a git repository import.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GitImportProgress {
    pub stage: GitImportStage,
    pub message: Option<String>,
}

/// Declares [`BackendEvent`] and its wire names from a single list.
///
/// Each entry is `Variant(Payload) => "wire-name"`, or `Variant => "wire-name"`
/// for a payload-free event. Keeping the name adjacent to the variant is the
/// point: a variant cannot be added without also giving it a name, and the name
/// can't drift away from the payload it belongs to.
///
/// The `{ .. }` in the generated match works for unit and tuple variants alike,
/// which is what lets one arm shape cover both forms.
macro_rules! declare_events {
    ($(
        $(#[$meta:meta])*
        $variant:ident $(($payload:ty))? => $name:literal
    ),* $(,)?) => {
        /// Everything the backend can announce.
        ///
        /// This is also the registry of wire names: before it, names were
        /// scattered string literals at each emit site, so a rename could
        /// silently desynchronize the backend from the frontend's `listen()`
        /// calls.
        #[derive(Clone, Debug)]
        pub enum BackendEvent {
            $(
                $(#[$meta])*
                $variant $(($payload))?,
            )*
        }

        impl BackendEvent {
            /// Wire name for this event, matching the frontend's `listen()` calls.
            pub fn name(&self) -> &'static str {
                match self {
                    $( Self::$variant { .. } => $name, )*
                }
            }
        }
    };
}

declare_events! {
    /// An overlay build advanced. Emitted per file, so sinks must be cheap.
    OverlayProgress(OverlayProgress) => "overlay-progress",
    /// The set of mods with unresolved linked-bin dependencies changed.
    LinkedBinsUpdated => "linked-bins-updated",
    /// Per-mod WAD analysis results changed.
    WadReportsUpdated => "wad-reports-updated",
    /// The library index changed and any cached view of it is stale.
    LibraryChanged => "library-changed",
    /// A bulk install advanced.
    InstallProgress(InstallProgress) => "install-progress",
    /// A cslol migration advanced.
    MigrationProgress(MigrationProgress) => "migration-progress",
    /// A fantome import advanced.
    FantomeImportProgress(FantomeImportProgress) => "fantome-import-progress",
    /// A git repository import advanced.
    GitImportProgress(GitImportProgress) => "git-import-progress",
    /// A League launch request advanced.
    LaunchProgress(LaunchProgress) => "launch-progress",
    /// A hashtable sync asked for a release asset.
    HashtableSyncProgress(HashtableSyncProgress) => "hashtable-sync-progress",
}

#[cfg(test)]
mod tests {
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
                current_wad: None,
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
                file: "manifest.json".to_string(),
            })
            .name(),
            "hashtable-sync-progress"
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
            current_wad: Some("w".to_string()),
            current: 1,
            total: 2,
        })
        .unwrap();
        assert_eq!(json["currentWad"], "w");
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
}
