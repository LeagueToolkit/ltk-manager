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

mod launcher;
mod layer_changes;
mod library;

pub use launcher::{
    LaunchProgress, LaunchStage, SessionChanged, SessionEnded, SessionGameRunning, SessionStarted,
};
pub use layer_changes::{LayerFile, LayerFilesChanged};
pub use library::{
    FailedConversion, HealthCheckBasis, HealthSweepReport, LayoutMigrationReport, ModStorage,
};

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
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum OverlayStage {
    /// Resolving the build inputs before the builder runs. `OverlayProgress::step` names the
    /// step.
    Preparing,
    Indexing,
    Collecting,
    Patching,
    Strings,
    Complete,
}

/// A step of the work before the overlay builder runs, reported under
/// [`OverlayStage::Preparing`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PrepareStep {
    /// The patcher DLL is being delivered.
    Patcher,
    /// The last game's process is closing.
    GameExit,
    /// The library index and the enabled mods are being read.
    Library,
    /// A built-in mod's project is being generated. `name` is the mod's display name.
    BuiltinMod { name: String },
    /// The game install is being read.
    Game,
}

/// Progress of an overlay build.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OverlayProgress {
    pub stage: OverlayStage,
    pub current_file: Option<String>,
    pub current: u32,
    pub total: u32,
    /// The step under [`OverlayStage::Preparing`], `None` under every other stage.
    pub step: Option<PrepareStep>,
}

impl OverlayProgress {
    /// Progress at `step` of [`OverlayStage::Preparing`].
    #[must_use]
    pub fn preparing(step: PrepareStep) -> Self {
        Self {
            stage: OverlayStage::Preparing,
            current_file: None,
            current: 0,
            total: 0,
            step: Some(step),
        }
    }
}

/// Progress of a bulk mod install, emitted per file.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

/// Progress of a mod export, emitted per mod.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub current: usize,
    pub total: usize,
    pub current_mod: String,
}

/// Which half of a cslol migration is running.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum MigrationPhase {
    Packaging,
    Installing,
}

/// Progress of a cslol migration, across both phases.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MigrationProgress {
    pub phase: MigrationPhase,
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

/// Progress of the library layout migration, emitted per mod.
///
/// Separate from [`MigrationProgress`], which is the cslol import: the two run
/// at different moments, mean different things, and share nothing but the word.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct LayoutMigrationProgress {
    pub current: usize,
    pub total: usize,
    pub current_mod: String,
}

/// Progress of a mod health sweep, emitted per mod.
///
/// The mod is named by id rather than by title: the library view already holds
/// every mod's name, and looking one up here would mean a `mod.config.json`
/// read per mod on top of the check itself.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HealthSweepProgress {
    /// Mods the sweep has finished, however they turned out.
    pub completed: usize,
    pub total: usize,
    /// The mods being read right now, by id. Several, because the sweep reads
    /// more than one at a time.
    pub in_flight: Vec<String>,
}

/// Progress of a repair over several mods, emitted per mod.
///
/// Its own payload rather than [`HealthSweepProgress`] reused: the two run at
/// different moments and a surface drawing one must not be driven by the other.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ModRepairProgress {
    /// Mods the run has finished, however they turned out.
    pub completed: usize,
    pub total: usize,
    /// The mods being repaired right now, by id. Several, because a repair
    /// works on more than one at a time.
    pub in_flight: Vec<String>,
}

/// Stage of a fantome import.
///
/// Coarser than the stages `ltk_mod_project`'s importer reports: everything
/// past the content is `Finalizing`, because none of it carries a count a bar
/// could be drawn from. `Error` has no counterpart there at all, since a failed
/// import returns rather than reporting, so the caller emits it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum FantomeImportStage {
    Extracting,
    Finalizing,
    Complete,
    Error,
}

/// Progress of a fantome import.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FantomeImportProgress {
    pub stage: FantomeImportStage,
    /// The unit being unpacked, as the archive names it: a WAD, or `RAW` for
    /// the pass that unpacks everything the archive keeps outside one.
    pub current_item: Option<String>,
    pub current: u32,
    pub total: u32,
}

/// Progress of one mod moving between the two storage modes.
///
/// Its own event though an unpack is a fantome import, because the workshop's
/// import dialog listens on `fantome-import-progress` and a library conversion
/// must not drive it. The stage is shared, since the two report the same four
/// states.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ModStorageProgress {
    pub mod_id: String,
    /// The storage the mod is moving to, which is what names the work.
    pub storage: ModStorage,
    pub stage: FantomeImportStage,
    /// As [`FantomeImportProgress::current_item`].
    pub current_item: Option<String>,
    pub current: u32,
    pub total: u32,
}

impl ModStorageProgress {
    /// A stage with nothing named and no counters, for the steps that have none.
    pub fn new(mod_id: &str, storage: ModStorage, stage: FantomeImportStage) -> Self {
        Self {
            mod_id: mod_id.to_owned(),
            storage,
            stage,
            current_item: None,
            current: 0,
            total: 0,
        }
    }

    /// The same, carrying the counters an unpack reached before it stopped.
    pub fn at(mut self, current: u32, total: u32) -> Self {
        self.current = current;
        self.total = total;
        self
    }
}

impl From<ltk_mod_project::ImportProgress<'_>> for FantomeImportProgress {
    fn from(progress: ltk_mod_project::ImportProgress<'_>) -> Self {
        use ltk_mod_project::ImportStage as Upstream;

        let (stage, current_item) = match progress.stage {
            Upstream::Extracting { item } => {
                (FantomeImportStage::Extracting, Some(item.to_owned()))
            }
            Upstream::WritingMetadata => (FantomeImportStage::Finalizing, None),
            Upstream::Complete => (FantomeImportStage::Complete, None),
        };

        Self {
            stage,
            current_item,
            current: progress.current,
            total: progress.total,
        }
    }
}

/// Stage of a move of the data directory to another folder.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum DataMoveStage {
    /// The entries are being renamed or copied into the new folder.
    Moving,
    /// The entries are in the new folder and the app restarts on the new location.
    Restarting,
}

/// Progress of a move of the data directory to another folder.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DataMoveProgress {
    pub stage: DataMoveStage,
    /// Name of the entry being moved, under the data directory.
    pub current_entry: Option<String>,
    /// Bytes moved so far.
    pub moved: u64,
    /// Bytes that the whole move carries.
    pub total: u64,
}

/// Progress of a hashtable sync, as its tables stream in.
///
/// Every figure describes the whole run rather than the table in flight, so a
/// reader draws one bar for the sync instead of one that restarts per file.
/// The tables are tens of megabytes each, so the emitter throttles rather than
/// sending one of these per chunk.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HashtableSyncProgress {
    /// Id of the table being fetched, e.g. `game`.
    pub table: String,
    /// Which table of the run this is, counting from 1.
    pub current: u32,
    /// How many tables the run fetches.
    pub total: u32,
    /// Bytes of the whole run written so far.
    pub downloaded: u64,
    /// Bytes the whole run will write, absent against a release that recorded
    /// no sizes.
    pub total_bytes: Option<u64>,
}

/// Progress of an extract of game chunks to disk.
///
/// One extract runs over any number of archives, so `current` and `total`
/// count the whole run rather than the archive being read. The extractor
/// reports every chunk it finishes, which is tens of thousands for a large
/// archive, so the emitter throttles rather than sending one of these each
/// time.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExtractProgress {
    pub current: u32,
    pub total: u32,
    /// The chunk just written, or its hex hash when nothing names it.
    pub current_path: Option<String>,
    /// Bytes written so far across the whole run.
    pub bytes: u64,
    /// The `DATA/FINAL`-relative archive being read.
    pub archive: String,
}

/// Stage of a git repository import.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum GitImportStage {
    Downloading,
    Extracting,
    Complete,
    Error,
}

/// Progress of a git repository import.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GitImportProgress {
    pub stage: GitImportStage,
    pub message: Option<String>,
}

/// How far one walk has read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReferenceWalkProgress {
    /// Bins read, or passed over because they would not read.
    pub walked: u32,
    /// Bins the walk reads in all: the project's layers and the install's.
    pub total: u32,
    /// References found so far, past any cap.
    pub hits: u32,
}

/// Where a protocol install has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ProtocolInstallStage {
    Downloading,
    Validating,
    Complete,
    Error,
}

/// Progress payload emitted during protocol install download.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProtocolInstallProgress {
    pub stage: ProtocolInstallStage,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub error: Option<String>,
}

/// Where one item of an install list has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum InstallListStage {
    /// The item's download link is being minted.
    Resolving,
    /// The item's file is arriving. Its bytes go out as [`ProtocolInstallProgress`].
    Downloading,
    /// The file is being read into the library.
    Installing,
    /// The item is in the library as a new mod.
    Installed,
    /// The item replaced an older version of its mod.
    Updated,
    /// The library already held the item's file.
    AlreadyInstalled,
    /// The item did not install. The report the run returns carries why.
    Failed,
}

/// One item of an install list moved to the next stage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InstallListProgress {
    /// The item's position among the items the run was handed, from 0.
    pub index: u32,
    /// How many items the run was handed.
    pub total: u32,
    /// The item's id on the site.
    pub item_id: String,
    pub stage: InstallListStage,
    /// For [`InstallListStage::Failed`], the failure in a sentence.
    pub error: Option<String>,
}

/// Where a publish to RuneForge has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum RuneforgePublishStage {
    Validating,
    Packing,
    Uploading,
    Inspecting,
    Complete,
    Error,
}

/// How far the publish of one project to RuneForge has got. Throttled by its emitter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RuneforgePublishProgress {
    /// The project directory that the publish packs.
    pub project_path: String,
    pub stage: RuneforgePublishStage,
    /// The package bytes sent to storage so far.
    pub bytes_sent: u64,
    /// The size of the package, or 0 before the pack ends.
    pub total_bytes: u64,
}

/// Declares [`BackendEvent`] and its event names from a single list.
///
/// Each entry is `Variant(Payload) => "event-name"`, or `Variant => "event-name"`
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
        /// This is also the registry of event names: before it, names were
        /// scattered string literals at each emit site, so a rename could
        /// silently desynchronize the backend from the frontend's `listen()`
        /// calls.
        ///
        /// Serializes as its payload alone, and an event with no payload as `null`, which is
        /// what a listener receives.
        #[derive(Clone, Debug, Serialize)]
        #[serde(untagged)]
        pub enum BackendEvent {
            $(
                $(#[$meta])*
                $variant $(($payload))?,
            )*
        }

        impl BackendEvent {
            /// The name this event is emitted under, matching the frontend's `listen()` calls.
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
    /// The set of chunks whose containers claimed wrong checksums changed.
    ChecksumMismatchesUpdated => "checksum-mismatches-updated",
    /// Per-mod WAD analysis results changed.
    WadReportsUpdated => "wad-reports-updated",
    /// Per-mod health verdicts changed.
    ModHealthVerdictsUpdated => "mod-health-verdicts-updated",
    /// A mod health sweep advanced to the next mod.
    HealthSweepProgress(HealthSweepProgress) => "health-sweep-progress",
    /// A mod health sweep ended, with what the library now looks like. Emitted
    /// only for a run that had mods to check, so a library already current
    /// announces nothing.
    HealthSweepFinished(HealthSweepReport) => "health-sweep-finished",
    /// A repair over several mods advanced to the next mod.
    ModRepairProgress(ModRepairProgress) => "mod-repair-progress",
    /// The library index changed and any cached view of it is stale.
    LibraryChanged => "library-changed",
    /// A bulk install advanced.
    InstallProgress(InstallProgress) => "install-progress",
    /// An export of installed mods advanced to the next mod.
    ExportProgress(ExportProgress) => "export-progress",
    /// A cslol migration advanced.
    MigrationProgress(MigrationProgress) => "migration-progress",
    /// The library layout migration advanced to the next mod.
    LayoutMigrationProgress(LayoutMigrationProgress) => "layout-migration-progress",
    /// The library layout migration ended. Emitted only for a run that had
    /// mods to move, so a library already on the slug layout announces nothing.
    LayoutMigrationFinished(LayoutMigrationReport) => "layout-migration-finished",
    /// A fantome import advanced.
    FantomeImportProgress(FantomeImportProgress) => "fantome-import-progress",
    /// One mod's storage conversion advanced.
    ModStorageProgress(ModStorageProgress) => "mod-storage-progress",
    /// A git repository import advanced.
    GitImportProgress(GitImportProgress) => "git-import-progress",
    /// The download an install link started advanced.
    ProtocolInstallProgress(ProtocolInstallProgress) => "protocol-install-progress",
    /// An install of a list moved one of its items to the next stage.
    InstallListProgress(InstallListProgress) => "install-list-progress",
    /// A publish of a project to RuneForge advanced. Throttled by its emitter.
    RuneforgePublishProgress(RuneforgePublishProgress) => "runeforge-publish-progress",
    /// A League launch request advanced.
    LaunchProgress(LaunchProgress) => "launch-progress",
    /// The Riot Client opened a session for League. Emitted once per session,
    /// including for one the manager adopted or recovered rather than started.
    SessionStarted(SessionStarted) => "session-started",
    /// A live session moved to another phase - what the match is doing, which
    /// is not whether League is up.
    SessionChanged(SessionChanged) => "session-changed",
    /// League appeared or went away during a live session. The one the status
    /// bar and the patcher act on.
    SessionGameRunning(SessionGameRunning) => "session-game-running",
    /// A live session ended, with the client's own reason when it gave one.
    SessionEnded(SessionEnded) => "session-ended",
    /// A hashtable sync advanced. Throttled by its emitter.
    HashtableSyncProgress(HashtableSyncProgress) => "hashtable-sync-progress",
    /// A move of the data directory advanced. Throttled by its emitter.
    DataMoveProgress(DataMoveProgress) => "data-move-progress",
    /// An extract of game chunks to disk advanced. Throttled by its emitter.
    ExtractProgress(ExtractProgress) => "extract-progress",
    /// A walk of the bins for references advanced. Throttled by its emitter.
    ReferenceWalkProgress(ReferenceWalkProgress) => "reference-walk-progress",
    /// Files of an open workshop project's layers changed on disk.
    LayerFilesChanged(LayerFilesChanged) => "layer-files-changed",
}

#[cfg(test)]
mod tests;
