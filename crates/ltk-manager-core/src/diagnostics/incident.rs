//! The incident: one record for each game that went wrong, and the verdict the
//! classifier reached over its evidence.
//!
//! [`GameRecord`] is what the patcher thread accumulates while a game runs.
//! [`GameRecord::classify`] is a pure function over it and the library's
//! footprints, with no side effect and no file read, so every verdict is a unit
//! test.

use std::fmt;
use std::path::PathBuf;
use std::sync::LazyLock;

use chrono::{DateTime, Local, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::binary_id::PatcherBinaries;
use super::exit_status;
use super::game_log::{CodeSighting, GameLogFacts, Record};
use super::log_codes::{self, CodeKind, CodeRow, EvidenceMark};
use crate::error::ErrorKind;
use crate::patcher::injector::WadScanFailure;
use crate::patcher::{InjectionStage, SessionOrigin};

/// What the DLL said after it attached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum OverlayOutcome {
    /// `init done`.
    Live,
    /// League started before the scan, and the DLL stayed inert.
    TooLate,
    /// The DLL refused a game build newer than it knows.
    EndOfLife,
    /// The eager scan failed closed on the first bad archive.
    Disabled,
    /// A hook did not take.
    HookFailed,
    /// The DLL never attached, or said nothing.
    None,
}

/// The DLL's word on an overlay that did not go live, kept structured so a
/// consumer reads a field rather than re-parsing a sentence.
///
/// The wire and the token carry it as a display string (its [`Display`]), so
/// the type stays internal to the classifier and its inputs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OverlayDetail {
    /// The game build the DLL refused, for [`OverlayOutcome::EndOfLife`].
    Build(String),
    /// The archive that did not verify, and why, for
    /// [`OverlayOutcome::Disabled`]. The archive is its last path segment.
    Rejected { wad: String, why: String },
    /// The hook that did not install, for [`OverlayOutcome::HookFailed`].
    Hook(String),
}

impl fmt::Display for OverlayDetail {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Build(build) => f.write_str(build),
            Self::Rejected { wad, why } => write!(f, "{wad}: {why}"),
            Self::Hook(hook) => f.write_str(hook),
        }
    }
}

/// What kind of game it was, as the DLL read the command line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum LaunchKind {
    Match,
    Replay,
    Spectator,
    Pbe,
}

/// Which scan the DLL ran, as it decided from the flags and the command line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ScanMode {
    Eager,
    Lazy,
}

/// How far the game got, as its log says.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum GamePhase {
    /// No log was read.
    #[default]
    Unknown,
    /// The loading screen never finished.
    Loading,
    /// `Loading Ended` was written.
    InGame,
    /// The game ended the way it should.
    TornDown,
}

/// What the session was started for, without the paths a workshop one carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum OriginKind {
    Library,
    Workshop,
}

impl OriginKind {
    /// The kind of `origin`.
    pub fn of(origin: &SessionOrigin) -> Self {
        match origin {
            SessionOrigin::Library => Self::Library,
            SessionOrigin::Workshop { .. } => Self::Workshop,
        }
    }
}

/// An archive the lazy scan skipped, with the DLL's reason.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct SkippedArchive {
    pub wad: String,
    pub why: String,
}

/// The facts the game log gives about the game itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub version: String,
    pub content_version: String,
    pub log_path: String,
}

/// How the game ended, as far as anything said.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Ending {
    /// The Riot Client's reason: `Exit`, `Interrupt`, `Timeout`, `Unknown`, or a
    /// spelling the crate does not know. `None` on the Classic launch flow.
    pub exit_reason: Option<String>,
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub exit_code: Option<i64>,
    /// Whether `last_crash` fell inside the game's window. `None` when the
    /// marker was not read.
    pub crashed: Option<bool>,
}

/// The Riot Client's reason for a game ending, as the closed set it sends.
///
/// [`Ending::exit_reason`] keeps the client's raw word, because the client can
/// send a spelling this build does not know. This is the reading of it, for the
/// logic that switches on it rather than comparing a string literal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientReason {
    Exit,
    Interrupt,
    Timeout,
    Unknown,
}

impl ClientReason {
    /// The four spellings, numbered from one in this order. Never reorder: the
    /// token carries the number.
    const NAMES: [&str; 4] = ["Exit", "Interrupt", "Timeout", "Unknown"];

    /// The reason for `text`, or `None` for a spelling the crate does not know.
    pub fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "Exit" => Self::Exit,
            "Interrupt" => Self::Interrupt,
            "Timeout" => Self::Timeout,
            "Unknown" => Self::Unknown,
            _ => return None,
        })
    }

    /// The spelling the client sends.
    pub fn as_str(self) -> &'static str {
        Self::NAMES[usize::from(self.code()) - 1]
    }

    /// A stable number for the token, from one. Never renumber.
    pub fn code(self) -> u8 {
        match self {
            Self::Exit => 1,
            Self::Interrupt => 2,
            Self::Timeout => 3,
            Self::Unknown => 4,
        }
    }

    /// The reason for a token's number, or `None` for one this build does not know.
    pub fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            1 => Self::Exit,
            2 => Self::Interrupt,
            3 => Self::Timeout,
            4 => Self::Unknown,
            _ => return None,
        })
    }
}

/// Which failure the classifier named.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum VerdictKind {
    /// The DLL never attached, which is the common startup failure.
    PatcherDidNotRun,
    /// The overlay could not be built, so there was nothing to inject.
    OverlayBuildFailed,
    /// The injection host never came up.
    InjectionHostFailed,
    PatcherOutOfDate,
    ArchiveRejected,
    /// The scan rejected an archive for a Riot skin ported onto a base
    /// champion, which is the rejection a player has a word for.
    SkinhackDetected,
    OverlayDisabled,
    Unmodded,
    MissingData,
    CorruptArchive,
    TextureFailed,
    OutOfMemory,
    GraphicsFault,
    StuckLoading,
    ArchiveSkipped,
    EndedWithoutReason,
}

/// What a verdict cost the player, which is a fact whatever the manager makes
/// of the line that reported it.
///
/// The axis that replaced a confidence word. How firmly a log code can be read
/// is a claim about the manager's own table and belongs to the sentence that
/// reads the code, not stamped over what happened to the game.
///
/// Ordered by how much the game lost, worst last.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum Consequence {
    /// The overlay served the game without one archive, and the rest applied.
    ArchiveDropped,
    /// No mod reached the game.
    OverlayOff,
    /// The game stopped making progress and never reached play.
    GameHung,
    /// The game did not survive.
    GameStopped,
}

impl Consequence {
    /// A stable number for the token. Never renumber a variant.
    pub fn code(self) -> u8 {
        match self {
            Self::ArchiveDropped => 1,
            Self::OverlayOff => 2,
            Self::GameHung => 3,
            Self::GameStopped => 4,
        }
    }

    /// The consequence for a token's number, or `None` for one this build does
    /// not know.
    pub fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            1 => Self::ArchiveDropped,
            2 => Self::OverlayOff,
            3 => Self::GameHung,
            4 => Self::GameStopped,
            _ => return None,
        })
    }
}

impl fmt::Display for Consequence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            Self::ArchiveDropped => "one archive dropped",
            Self::OverlayOff => "no mod ran",
            Self::GameHung => "the game hung",
            Self::GameStopped => "the game stopped",
        })
    }
}

/// What the manager concluded from one game.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase", from = "StoredVerdict")]
pub struct Verdict {
    pub kind: VerdictKind,
    /// The title as it reads, from [`VerdictKind::title`] unless this verdict
    /// named its own.
    ///
    /// Derived on the way in, so a stored incident cannot keep a title this
    /// build has stopped using. Renaming a kind renames its history with it.
    pub title: String,
    /// A title for something the kind's own does not cover, and `None` for
    /// every verdict the predefined set already describes.
    pub title_override: Option<String>,
    /// One or two sentences under the title.
    pub cause: String,
    /// The archive, the path's file name, or the step, where there is one.
    pub subject: Option<String>,
    /// What the game lost, which [`VerdictKind`] alone decides.
    ///
    /// Written out for a reader, and never read back. [`Self::kind`] decides it,
    /// so reading it from a file would only let a stale one disagree.
    pub consequence: Consequence,
    /// At most two, one sentence each.
    pub hints: Vec<String>,
}

/// A verdict as a file holds it, which is every field the kind does not decide.
///
/// [`Verdict`] deserializes through this, so an incident stored before
/// [`Consequence`] existed reads with the consequence its kind has always
/// implied, and one stored after it cannot carry a consequence that disagrees.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredVerdict {
    kind: VerdictKind,
    #[serde(default)]
    title_override: Option<String>,
    cause: String,
    subject: Option<String>,
    #[serde(default)]
    hints: Vec<String>,
}

impl From<StoredVerdict> for Verdict {
    fn from(stored: StoredVerdict) -> Self {
        Self {
            consequence: stored.kind.consequence(),
            title: stored
                .title_override
                .clone()
                .unwrap_or_else(|| stored.kind.title().to_string()),
            title_override: stored.title_override,
            kind: stored.kind,
            cause: stored.cause,
            subject: stored.subject,
            hints: stored.hints,
        }
    }
}

/// Where a line of evidence came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum EvidenceSource {
    Patcher,
    Host,
    Dll,
    Game,
    Client,
}

/// What the table says about a code on an evidence line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct EvidenceCode {
    pub id: String,
    /// The kind column, or `None` when the table has no row.
    pub kind: Option<String>,
    pub meaning: Option<String>,
    pub mark: Option<EvidenceMark>,
}

/// One line the verdict rests on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    /// Seconds into the game where the source has one, else the wall clock.
    pub at: String,
    pub source: EvidenceSource,
    pub line: String,
    pub code: Option<EvidenceCode>,
}

/// A mod, or a workshop project, that the evidence implicates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Suspect {
    pub mod_id: Option<String>,
    pub project_path: Option<String>,
    pub display_name: String,
    /// `writes Aatrox.wad.client, which holds the path`
    ///
    /// The reason is the whole claim. How direct the link is reads out of what
    /// it says - holding the path is not the same sentence as having been
    /// redirected - so no separate word grades it.
    pub because: String,
}

/// The record the manager keeps for one game that went wrong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Incident {
    /// The game log's stamp, or the game's start when there is no log.
    pub id: String,
    /// RFC 3339, UTC.
    pub started_at: String,
    pub ended_at: String,
    /// Library, or the workshop projects under test.
    pub origin: SessionOrigin,
    /// Whether the DLL attached to this game.
    pub injected: bool,
    #[serde(default)]
    pub host_elevated: bool,
    #[serde(default)]
    pub patcher: PatcherBinaries,
    pub overlay: OverlayOutcome,
    #[serde(default)]
    pub overlay_detail: Option<String>,
    pub redirected: Vec<String>,
    pub skipped: Vec<SkippedArchive>,
    #[serde(default)]
    pub enabled_count: u16,
    pub launch: LaunchKind,
    pub scan: Option<ScanMode>,
    pub scan_status: Option<ScanStatus>,
    #[serde(default)]
    pub phase: GamePhase,
    pub game: Option<GameInfo>,
    pub ending: Ending,
    /// Set when the session failed before any game, which is the whole story.
    #[serde(default)]
    pub failure: Option<SessionFailure>,
    pub verdict: Verdict,
    pub evidence: Vec<Evidence>,
    pub suspects: Vec<Suspect>,
    /// The user has seen it and closed the line.
    pub dismissed: bool,
}

/// A session that failed before any game ran.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum SessionFailure {
    /// The overlay build failed, with the builder's own words.
    ///
    /// `kind` is carried because `message` is [`Display`](std::fmt::Display)
    /// output and several [`AppError`](crate::error::AppError) variants render
    /// with no prefix of their own, so a thin inner error leaves nothing at all
    /// to read. The kind is always there to say what failed.
    Build { kind: ErrorKind, message: String },
    /// The host did not start, or the DLL did not attach.
    Injection {
        stage: InjectionStage,
        message: String,
    },
}

impl SessionFailure {
    /// The failure as one evidence line, naming what failed and how.
    pub fn line(&self) -> String {
        match self {
            Self::Build { kind, message } => {
                format!("overlay build failed, {kind}: {message}")
            }
            Self::Injection { stage, message } => {
                format!("patcher failed at {stage}: {message}")
            }
        }
    }

    /// The error's own words: `IO: Access is denied.` for a build, and the
    /// host's message for an injection. The stage is the verdict's to say.
    pub fn summary(&self) -> String {
        match self {
            Self::Build { kind, message } => failure_detail(*kind, message),
            Self::Injection { message, .. } => capitalized_sentence(message),
        }
    }
}

/// A line the thread saw, kept for the evidence timeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawEvidence {
    pub at: DateTime<Utc>,
    pub source: EvidenceSource,
    pub line: String,
}

/// Everything the thread learned about one game, before the classifier runs.
#[derive(Debug, Clone, PartialEq)]
pub struct GameRecord {
    /// The first sign of the game.
    pub started_at: DateTime<Utc>,
    /// The last sign of it.
    pub ended_at: DateTime<Utc>,
    pub origin: SessionOrigin,
    /// Set when the session failed before any game, which is the whole story.
    pub failure: Option<SessionFailure>,
    pub injected: bool,
    pub overlay: OverlayOutcome,
    /// The DLL's structured word on an overlay that did not go live.
    pub overlay_detail: Option<OverlayDetail>,
    pub redirected: Vec<String>,
    pub skipped: Vec<SkippedArchive>,
    pub scan_failures: Vec<WadScanFailure>,
    pub launch: LaunchKind,
    pub scan: Option<ScanMode>,
    /// Whether the host ran elevated, which picks the hint for a DLL that never
    /// attached.
    pub host_elevated: bool,
    /// The patcher binaries this session ran, set on every record from the
    /// recorder.
    pub patcher: PatcherBinaries,
    pub ending: Ending,
    pub log_path: Option<PathBuf>,
    /// `None` when no log was found, or the reader is turned off.
    pub log: Option<GameLogFacts>,
    pub timeline: Vec<RawEvidence>,
}

/// What an enabled library mod writes, for the suspect match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModFootprint {
    pub mod_id: String,
    pub display_name: String,
    /// Position in the overlay's merge order. Lower is higher priority.
    pub priority: usize,
    /// Archive paths or names, as the wad report lists them.
    pub affected_wads: Vec<String>,
}

/// What a workshop project under test writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectFootprint {
    pub project_path: String,
    pub display_name: String,
    pub affected_wads: Vec<String>,
}

/// The library's side of a classification.
pub struct ClassifyContext<'a> {
    pub mods: &'a [ModFootprint],
    pub projects: &'a [ProjectFootprint],
    /// A path for a 64-bit game path hash, when a hash table names one.
    pub resolve_hash: &'a dyn Fn(u64) -> Option<String>,
}

/// The loading screen's last step, which the `load_step` rows count to.
pub const LOAD_STEPS: u8 = 64;

impl OverlayOutcome {
    /// A stable number for the token. Never renumber a variant.
    pub fn code(self) -> u8 {
        match self {
            Self::None => 0,
            Self::Live => 1,
            Self::TooLate => 2,
            Self::EndOfLife => 3,
            Self::Disabled => 4,
            Self::HookFailed => 5,
        }
    }

    /// The outcome for a token's number, or `None` for one this build does not know.
    pub fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            0 => Self::None,
            1 => Self::Live,
            2 => Self::TooLate,
            3 => Self::EndOfLife,
            4 => Self::Disabled,
            5 => Self::HookFailed,
            _ => return None,
        })
    }
}

impl LaunchKind {
    /// A stable number for the token. Never renumber a variant.
    pub fn code(self) -> u8 {
        match self {
            Self::Match => 1,
            Self::Replay => 2,
            Self::Spectator => 3,
            Self::Pbe => 4,
        }
    }

    /// The kind for a token's number, or `None` for one this build does not know.
    pub fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            1 => Self::Match,
            2 => Self::Replay,
            3 => Self::Spectator,
            4 => Self::Pbe,
            _ => return None,
        })
    }
}

impl ScanMode {
    /// A stable number for the token. Never renumber a variant.
    pub fn code(self) -> u8 {
        match self {
            Self::Eager => 1,
            Self::Lazy => 2,
        }
    }

    /// The mode for a token's number, or `None` for one this build does not know.
    pub fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            1 => Self::Eager,
            2 => Self::Lazy,
            _ => return None,
        })
    }
}

impl GamePhase {
    /// A stable number for the token. Never renumber a variant, and keep
    /// zero for `Unknown`, so a token that says nothing reads as not said.
    pub fn code(self) -> u8 {
        match self {
            Self::Unknown => 0,
            Self::Loading => 1,
            Self::InGame => 2,
            Self::TornDown => 3,
        }
    }

    /// The phase for a token's number, or `None` for one this build does not know.
    pub fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            0 => Self::Unknown,
            1 => Self::Loading,
            2 => Self::InGame,
            3 => Self::TornDown,
            _ => return None,
        })
    }
}

impl OriginKind {
    /// A stable number for the token. Never renumber a variant.
    pub fn code(self) -> u8 {
        match self {
            Self::Library => 1,
            Self::Workshop => 2,
        }
    }

    /// The kind for a token's number, or `None` for one this build does not know.
    pub fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            1 => Self::Library,
            2 => Self::Workshop,
            _ => return None,
        })
    }
}

impl VerdictKind {
    /// A stable number for the token, in the precedence table's order. Never
    /// renumber a variant.
    pub fn code(self) -> u8 {
        match self {
            Self::PatcherDidNotRun => 1,
            Self::PatcherOutOfDate => 2,
            Self::ArchiveRejected => 3,
            Self::OverlayDisabled => 4,
            Self::Unmodded => 5,
            Self::MissingData => 6,
            Self::CorruptArchive => 7,
            Self::TextureFailed => 8,
            Self::OutOfMemory => 9,
            Self::GraphicsFault => 10,
            Self::StuckLoading => 11,
            Self::ArchiveSkipped => 12,
            Self::EndedWithoutReason => 13,
            Self::SkinhackDetected => 14,
            Self::OverlayBuildFailed => 15,
            Self::InjectionHostFailed => 16,
        }
    }

    /// The kind for a token's number, or `None` for one this build does not know.
    pub fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            1 => Self::PatcherDidNotRun,
            2 => Self::PatcherOutOfDate,
            3 => Self::ArchiveRejected,
            4 => Self::OverlayDisabled,
            5 => Self::Unmodded,
            6 => Self::MissingData,
            7 => Self::CorruptArchive,
            8 => Self::TextureFailed,
            9 => Self::OutOfMemory,
            10 => Self::GraphicsFault,
            11 => Self::StuckLoading,
            12 => Self::ArchiveSkipped,
            13 => Self::EndedWithoutReason,
            14 => Self::SkinhackDetected,
            15 => Self::OverlayBuildFailed,
            16 => Self::InjectionHostFailed,
            _ => return None,
        })
    }

    /// The title this kind reads under.
    ///
    /// The predefined set. A verdict whose kind does not describe it closely
    /// enough carries a [`Verdict::title_override`] instead, which is for the
    /// niche and the new rather than for restating one of these.
    pub fn title(self) -> &'static str {
        match self {
            Self::PatcherDidNotRun => "DLL Injection Failure",
            Self::OverlayBuildFailed => "Overlay Build Failure",
            Self::InjectionHostFailed => "Injection Host Failure",
            Self::PatcherOutOfDate => "Unsupported Game Build",
            Self::ArchiveRejected => "Archive Scan Rejection",
            Self::SkinhackDetected => "Skinhack Detection",
            Self::OverlayDisabled => "Overlay Verification Failure",
            Self::Unmodded => "No Mods Applied",
            Self::MissingData => "Missing Game Data",
            Self::CorruptArchive => "WAD Mount Failure",
            Self::TextureFailed => "Texture Creation Failure",
            Self::OutOfMemory => "Memory Allocation Failure",
            Self::GraphicsFault => "Graphics Device Failure",
            Self::StuckLoading => "Loading Screen Stall",
            Self::ArchiveSkipped => "Archive Verification Skipped",
            Self::EndedWithoutReason => "Unexplained Game Exit",
        }
    }

    /// What a game with this verdict lost.
    ///
    /// Total over the kinds, and the only place the mapping lives, so a new
    /// kind cannot ship without saying what it costs.
    pub fn consequence(self) -> Consequence {
        match self {
            Self::PatcherDidNotRun
            | Self::OverlayBuildFailed
            | Self::InjectionHostFailed
            | Self::PatcherOutOfDate
            | Self::ArchiveRejected
            | Self::SkinhackDetected
            | Self::OverlayDisabled
            | Self::Unmodded => Consequence::OverlayOff,
            Self::MissingData
            | Self::CorruptArchive
            | Self::TextureFailed
            | Self::OutOfMemory
            | Self::GraphicsFault
            | Self::EndedWithoutReason => Consequence::GameStopped,
            Self::StuckLoading => Consequence::GameHung,
            Self::ArchiveSkipped => Consequence::ArchiveDropped,
        }
    }
}

impl Verdict {
    /// A verdict with no subject and no hints yet.
    ///
    /// The title and the consequence both come from `kind`, so no caller
    /// chooses either. [`Self::with_title`] is the way to say something the
    /// kind's own title does not.
    pub fn new(kind: VerdictKind, cause: impl Into<String>) -> Self {
        Self {
            kind,
            title: kind.title().to_string(),
            title_override: None,
            cause: cause.into(),
            subject: None,
            consequence: kind.consequence(),
            hints: Vec::new(),
        }
    }

    /// Names this verdict something the kind's own title does not cover.
    ///
    /// For the niche and the new. Reach for a [`VerdictKind`] instead when the
    /// same title would fit a second incident.
    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        let title = title.into();
        self.title = title.clone();
        self.title_override = Some(title);
        self
    }

    /// Names the archive, the path's file name, or the step.
    pub fn with_subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = Some(subject.into());
        self
    }

    /// Adds a hint. A verdict carries at most two, and a third is dropped.
    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        if self.hints.len() < 2 {
            self.hints.push(hint.into());
        }
        self
    }
}

impl EvidenceCode {
    /// What the table says about `id`, or the bare id when it has no row.
    pub fn from_table(id: &str) -> Self {
        let row = log_codes::lookup(id);
        Self {
            id: id.to_string(),
            kind: row.map(|row| row.kind.to_string()),
            meaning: row.map(|row| row.meaning.to_string()),
            mark: row.map(|row| row.mark),
        }
    }
}

static MISSING_HASH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)missing data:\s*0x([0-9a-f]{1,16})").expect("a valid hash pattern")
});

impl Evidence {
    /// The line without a game log's time, level and channel columns.
    ///
    /// A line no game wrote has no columns to drop, and is returned whole.
    pub fn message(&self) -> &str {
        Record::parse(&self.line).map_or(self.line.as_str(), |record| record.message)
    }

    /// Whether a game log line was written at the `ERROR` level.
    pub fn is_error_level(&self) -> bool {
        Record::parse(&self.line).is_some_and(|record| record.level == "ERROR")
    }

    /// The path hash a `missing_data` line carries.
    pub fn missing_data_hash(&self) -> Option<u64> {
        missing_hash_in(&self.line)
    }
}

fn missing_hash_in(text: &str) -> Option<u64> {
    let digits = MISSING_HASH.captures(text)?.get(1)?.as_str();
    u64::from_str_radix(digits, 16).ok()
}

impl Ending {
    /// `Interrupt, exit code 0xC0000005 STATUS_ACCESS_VIOLATION`, or `None` when
    /// the client said nothing.
    ///
    /// The bare number is the reader's only clue to what killed the game, so it
    /// carries the name Windows gives it. See [`exit_status`](super::exit_status).
    pub fn summary(&self) -> Option<String> {
        let mut parts = Vec::new();
        if let Some(reason) = &self.exit_reason {
            parts.push(reason.clone());
        }
        if let Some(code) = self.exit_code {
            parts.push(format!("exit code {}", exit_status::describe(code)));
        }
        (!parts.is_empty()).then(|| parts.join(", "))
    }

    /// The client's reason as [`ClientReason`], or `None` when it said nothing
    /// or sent a spelling the crate does not know.
    pub fn client_reason(&self) -> Option<ClientReason> {
        self.exit_reason.as_deref().and_then(ClientReason::parse)
    }
}

impl fmt::Display for EvidenceSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            Self::Patcher => "patcher",
            Self::Host => "host",
            Self::Dll => "dll",
            Self::Game => "game",
            Self::Client => "client",
        })
    }
}

impl Incident {
    /// Brings a stored incident up to what this build would have written.
    ///
    /// Titles and consequences already derive from the kind, so the only thing
    /// left to move is the kind itself when a later build split one in two.
    pub(super) fn migrate(&mut self) {
        self.backfill_scan_status();
        self.promote_skinhack();
    }

    /// A rejection the scan called a skinhack is its own kind now.
    ///
    /// Without this a stored incident keeps reading as a plain rejection, and
    /// the list shows the same event under two names.
    fn promote_skinhack(&mut self) {
        if self.verdict.kind == VerdictKind::ArchiveRejected
            && self.scan_status == Some(ScanStatus::Skinhack)
        {
            self.verdict.kind = VerdictKind::SkinhackDetected;
            if self.verdict.title_override.is_none() {
                self.verdict.title = self.verdict.kind.title().to_string();
            }
        }
    }

    /// Recover [`Self::scan_status`] from the evidence of a stored incident
    /// that predates the field, so a history survives the upgrade.
    ///
    /// Only when every recorded rejection names the same status. A game whose
    /// archives failed for different reasons stays `None` rather than reporting
    /// a status the verdict may not be about.
    pub(super) fn backfill_scan_status(&mut self) {
        if self.scan_status.is_some() {
            return;
        }

        let mut recorded = self
            .evidence
            .iter()
            .filter_map(|row| ScanStatus::from_evidence_line(&row.line));
        let first = recorded.next();
        self.scan_status = first.filter(|status| recorded.all(|other| other == *status));
    }

    /// Every archive the verdict's subject or a suspect's reason names.
    pub fn archives(&self) -> Vec<String> {
        let mut archives: Vec<String> = Vec::new();
        let mut push = |name: &str| {
            if !archives
                .iter()
                .any(|known| known.eq_ignore_ascii_case(name))
            {
                archives.push(name.to_string());
            }
        };
        if let Some(subject) = self
            .verdict
            .subject
            .as_deref()
            .filter(|subject| is_archive_name(subject))
        {
            push(subject);
        }
        for suspect in &self.suspects {
            for word in suspect.because.split([' ', ',']) {
                if is_archive_name(word) {
                    push(word);
                }
            }
        }
        archives
    }

    /// Whether the verdict's subject is an archive name.
    pub fn subject_is_archive(&self) -> bool {
        self.verdict.subject.as_deref().is_some_and(is_archive_name)
    }

    /// Seconds from the first sign of the game to the last, when both parse.
    pub fn duration_secs(&self) -> Option<u32> {
        let started = DateTime::parse_from_rfc3339(&self.started_at).ok()?;
        let ended = DateTime::parse_from_rfc3339(&self.ended_at).ok()?;
        u32::try_from((ended - started).num_seconds()).ok()
    }
}

/// Why a suspect is one, as the line under its name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Because {
    HoldsThePath,
    Redirected,
    Rejected,
    DidNotVerify,
    Skipped,
}

impl Because {
    fn text(self, archives: &[String]) -> String {
        let names = match archives {
            [one] => one.clone(),
            [init @ .., last] => format!("{} and {last}", init.join(", ")),
            [] => String::new(),
        };
        match self {
            Self::HoldsThePath => format!("writes {names}, which holds the path"),
            Self::Redirected => format!("writes {names}, redirected this game"),
            Self::Rejected => format!("writes {names}, which the scan rejected"),
            Self::DidNotVerify => format!("writes {names}, which did not verify"),
            Self::Skipped => format!("writes {names}, which the lazy scan skipped"),
        }
    }
}

impl ClassifyContext<'_> {
    /// Every mod, highest priority first, then every project, that writes an
    /// archive `wants` accepts. The match is on the archive's last path
    /// segment, lowercased, the way `useWadScanOffenders` matches.
    fn suspects(&self, wants: impl Fn(&str) -> bool, because: Because) -> Vec<Suspect> {
        let hits = |affected: &[String]| -> Vec<String> {
            let mut names: Vec<String> = Vec::new();
            for wad in affected {
                let name = last_segment(wad);
                if wants(&name.to_ascii_lowercase())
                    && !names.iter().any(|known| known.eq_ignore_ascii_case(&name))
                {
                    names.push(name);
                }
            }
            names
        };

        let mut mods: Vec<&ModFootprint> = self.mods.iter().collect();
        mods.sort_by_key(|footprint| footprint.priority);

        let mut suspects = Vec::new();
        for footprint in mods {
            let names = hits(&footprint.affected_wads);
            if names.is_empty() {
                continue;
            }
            suspects.push(Suspect {
                mod_id: Some(footprint.mod_id.clone()),
                project_path: None,
                display_name: footprint.display_name.clone(),
                because: because.text(&names),
            });
        }
        for footprint in self.projects {
            let names = hits(&footprint.affected_wads);
            if names.is_empty() {
                continue;
            }
            suspects.push(Suspect {
                mod_id: None,
                project_path: Some(footprint.project_path.clone()),
                display_name: footprint.display_name.clone(),
                because: because.text(&names),
            });
        }
        suspects
    }

    /// The writers of the named archives.
    fn writers_of(&self, archives: &[String], because: Because) -> Vec<Suspect> {
        let wanted: Vec<String> = archives.iter().map(|wad| wad_basename(wad)).collect();
        self.suspects(|name| wanted.iter().any(|want| want == name), because)
    }
}

/// The status the scan reported, as `WadScanFailedDialog` classifies it.
///
/// Carried on the [`Incident`] so a consumer can tell one rejection from
/// another without reading [`Verdict::cause`] as prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum ScanStatus {
    /// An official Riot skin ported onto a base champion.
    Skinhack,
    /// A linked `.bin` the archive needs is absent.
    MissingBin,
    /// Unreadable, or built for an unsupported version.
    Corrupt,
    /// The game ran out of memory mid-scan.
    OutOfMemory,
    /// A skin with a mesh missing, which reads as an incomplete mod.
    BaseSkin,
    /// A status this build does not know.
    Unknown,
}

impl ScanStatus {
    /// The status for the code the scan reported, `c0000229` or `0xC0000229`
    /// alike, and [`Self::Unknown`] for one this build has no name for.
    pub fn parse(status: &str) -> Self {
        let code = status.trim().to_ascii_lowercase();
        match code.strip_prefix("0x").unwrap_or(&code) {
            "c0000229" => Self::Skinhack,
            "c0000225" => Self::MissingBin,
            "c000003e" => Self::Corrupt,
            "c0000017" | "c000009a" => Self::OutOfMemory,
            "base_skin" => Self::BaseSkin,
            _ => Self::Unknown,
        }
    }

    /// The status a recorded rejection line names, for a line that is one.
    ///
    /// The reading half of the phrase [`WadScanFailure::evidence_line`] writes,
    /// which is how an incident stored before [`Incident::scan_status`] existed
    /// still knows what the scan said.
    fn from_evidence_line(line: &str) -> Option<Self> {
        Self::code_in_evidence_line(line).map(Self::parse)
    }

    /// The status code as the scan reported it, from a rejection line.
    pub(super) fn code_in_evidence_line(line: &str) -> Option<&str> {
        let (_, status) = line
            .strip_prefix("scan rejected ")?
            .rsplit_once(", status ")?;
        Some(status.trim())
    }

    /// The verdict kind this status reaches.
    ///
    /// A skinhack is its own kind rather than a shade of a rejection, so the
    /// title, the hue and the token all follow from one field.
    fn kind(self) -> VerdictKind {
        match self {
            Self::Skinhack => VerdictKind::SkinhackDetected,
            _ => VerdictKind::ArchiveRejected,
        }
    }

    fn cause(self, archive: &str, status: &str) -> String {
        match self {
            Self::Skinhack => format!(
                "The scan found a skinhack, an official Riot skin ported onto a base champion, in {archive}. No mod was applied this game."
            ),
            Self::MissingBin => format!(
                "The scan could not find a linked .bin file that {archive} needs, so no mod was applied this game."
            ),
            Self::Corrupt => format!(
                "{archive} could not be read. It is corrupt, or built for an unsupported version, so no mod was applied this game."
            ),
            Self::OutOfMemory => format!(
                "The game ran out of memory while scanning {archive}, so no mod was applied this game."
            ),
            Self::BaseSkin => format!(
                "The base-skin check found a skin in {archive} with a mesh missing, which reads as an incomplete mod. No mod was applied this game."
            ),
            Self::Unknown => format!(
                "{archive} failed the game's integrity scan with status {status}, so no mod was applied this game."
            ),
        }
    }
}

/// A count as the record keeps it. Nothing in a game comes in tens of thousands.
fn saturating_count(count: usize) -> u16 {
    u16::try_from(count).unwrap_or(u16::MAX)
}

/// `mm:ss.s` for seconds into the game.
fn clock(secs: f64) -> String {
    let minutes = (secs / 60.0).floor();
    let rest = secs - minutes * 60.0;
    format!("{:02}:{:04.1}", minutes as u64, rest)
}

/// The row's meaning as a sentence, hedged when the row is inferred.
fn reading(row: &CodeRow) -> String {
    match row.mark {
        EvidenceMark::Confirmed => format!("{}.", row.meaning),
        EvidenceMark::Inferred => {
            let mut chars = row.meaning.chars();
            let first = chars
                .next()
                .map(|c| c.to_ascii_lowercase())
                .unwrap_or_default();
            format!("Probably {first}{}.", chars.as_str())
        }
    }
}

/// `text` with a full stop, unless it has its own ending.
/// [`sentence`], capitalized, for a message that opens one of its own.
///
/// Only a lowercase ASCII first letter moves, so `DLL` and a path keep the
/// spelling their writer chose. The colon-joined call sites want the original.
/// The error's own words, with the kind it was, for the end of a cause.
///
/// `IO: Access is denied.`, or the bare kind when the message is empty, which
/// several [`AppError`](crate::error::AppError) variants leave it.
fn failure_detail(kind: ErrorKind, message: &str) -> String {
    let message = capitalized_sentence(message);
    if message.is_empty() {
        return format!("{kind}, with no message.");
    }
    format!("{kind}: {message}")
}

fn capitalized_sentence(text: &str) -> String {
    let text = sentence(text);
    let mut chars = text.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() => {
            format!("{}{}", first.to_ascii_uppercase(), chars.as_str())
        }
        _ => text,
    }
}

fn sentence(text: &str) -> String {
    let text = text.trim();
    if text.is_empty() || text.ends_with(['.', '!', '?']) {
        text.to_string()
    } else {
        format!("{text}.")
    }
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}

/// The last path segment, in its own case.
fn last_segment(path: &str) -> String {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_string()
}

/// The last path segment, lowercased, which is what archives are matched on.
fn wad_basename(path: &str) -> String {
    last_segment(path).to_ascii_lowercase()
}

fn is_archive_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".wad.client") && lower.len() > ".wad.client".len()
}

/// `Map11.wad.client` and its localized siblings.
fn is_map_archive(basename: &str) -> bool {
    basename.starts_with("map")
}

/// Any archive that is not a map's and not one of the shared ones. A basename
/// is all the record keeps, so this is a rule over names and not over paths.
fn is_champion_archive(basename: &str) -> bool {
    if is_map_archive(basename) {
        return false;
    }
    let stem = basename.split('.').next().unwrap_or(basename);
    !matches!(stem, "global" | "ui")
}

mod hint {
    pub const SYSTEM_CHECKS: &str = "Run the System checks on the Diagnostics page.";
    pub const UPDATE_MANAGER: &str = "Update LTK Manager.";
    pub const REBUILD_OVERLAY: &str = "Rebuild the overlay.";
    pub const TEXTURE_DIMENSIONS: &str = "A modded texture whose width or height is not a multiple of 4 is the common cause, so check the dimensions of any texture you changed.";
    pub const REPAIR_INSTALL: &str =
        "Repair the install in the Riot Client when the rebuild does not help.";
    pub const UPDATE_DRIVER: &str =
        "Update the graphics driver, and check the display settings when the update does not help.";
    pub const FREE_MEMORY: &str =
        "Close what else is running, and leave free space on the drive League is installed on.";
    pub const OPEN_PROJECT: &str = "Open the project in the editor.";
    pub const START_FIRST: &str = "Start the patcher before League.";
    pub const SCAN_UP_FRONT: &str = "Turn on Scan every WAD up front, because the DLL scanned archives on demand and the game ended inside its first minute.";
    pub const COPY_REPORT: &str = "Copy the report when you ask for help.";
    pub const DISABLE_SUSPECT: &str = "A mod that references a file it does not ship stops the read. Disable the suspect and play again.";
    pub const ELEVATE: &str =
        "League may run elevated, so let the host elevate or run LTK Manager as administrator.";
    pub const SIGNATURE: &str =
        "The host ran elevated, so check the DLL's signature and whether an antivirus blocked it.";
}

/// Where a game path lives, as far as its first segments say.
#[derive(Debug, Clone, PartialEq, Eq)]
enum PathHome {
    Champion(String),
    Map,
    Unknown,
}

impl PathHome {
    fn of(path: &str) -> Self {
        let lower = path.replace('\\', "/").to_ascii_lowercase();
        let mut segments = lower.split('/');
        let root = segments.next().unwrap_or_default();
        let kind = segments.next().unwrap_or_default();
        if root != "assets" && root != "data" {
            return Self::Unknown;
        }
        match (kind, segments.next()) {
            ("characters", Some(champion)) if !champion.is_empty() => {
                Self::Champion(champion.to_string())
            }
            ("maps", _) => Self::Map,
            _ => Self::Unknown,
        }
    }
}

mod classify;

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) mod fixtures;
