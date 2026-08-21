//! The incident: one record for each game that went wrong, and the verdict the
//! classifier reached over its evidence.
//!
//! [`GameRecord`] is what the patcher thread accumulates while a game runs.
//! [`GameRecord::classify`] is a pure function over it and the library's
//! footprints, with no side effect and no file read, so every verdict is a unit
//! test.

use std::fmt;
use std::sync::LazyLock;

use chrono::{DateTime, Local, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::game_log::{CodeSighting, GameLogFacts};
use super::log_codes::{self, CodeKind, CodeRow, EvidenceMark};
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

/// Which failure the classifier named.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum VerdictKind {
    PatcherDidNotRun,
    PatcherOutOfDate,
    ArchiveRejected,
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

/// How sure the manager is. The evidence mark of the code sets the ceiling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    /// The code is an inferred row, or the verdict is a heuristic over the log.
    Lead,
    /// The code is confirmed, and the mod is inferred from what the DLL redirected.
    Likely,
    /// The code is confirmed, and its reading names the failure.
    Confirmed,
}

/// What the manager concluded from one game.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub kind: VerdictKind,
    pub title: String,
    /// One or two sentences under the title.
    pub cause: String,
    /// The archive, the path's file name, or the step, where there is one.
    pub subject: Option<String>,
    /// Absent for a verdict that states facts, where a confidence reads as a hedge.
    pub confidence: Option<Confidence>,
    /// At most two, one sentence each.
    pub hints: Vec<String>,
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
    pub because: String,
    pub confidence: Confidence,
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
    pub overlay: OverlayOutcome,
    /// The archives the DLL served from the overlay, by their last path segment.
    pub redirected: Vec<String>,
    pub skipped: Vec<SkippedArchive>,
    pub launch: LaunchKind,
    pub scan: Option<ScanMode>,
    /// What the integrity scan reported, when it rejected an archive.
    pub scan_status: Option<ScanStatus>,
    pub game: Option<GameInfo>,
    pub ending: Ending,
    pub verdict: Verdict,
    pub evidence: Vec<Evidence>,
    pub suspects: Vec<Suspect>,
    /// The user has seen it and closed the line.
    pub dismissed: bool,
}

/// A session that failed before any game ran.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionFailure {
    /// The overlay build failed, with the builder's message.
    Build { message: String },
    /// The host did not start, or the DLL did not attach.
    Injection {
        stage: InjectionStage,
        message: String,
    },
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
    /// The archive and the reason for `Disabled`, the hook for `HookFailed`,
    /// the build timestamp for `EndOfLife`.
    pub overlay_detail: Option<String>,
    pub redirected: Vec<String>,
    pub skipped: Vec<SkippedArchive>,
    pub scan_failures: Vec<WadScanFailure>,
    pub launch: LaunchKind,
    pub scan: Option<ScanMode>,
    /// Whether the host ran elevated, which picks the hint for a DLL that never
    /// attached.
    pub host_elevated: bool,
    pub ending: Ending,
    pub log_path: Option<String>,
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

/// The cube-map texture code. Right after the step that builds the
/// environment's cube array, it names a map mod rather than a skin.
const CUBE_MAP_TEXTURE: &str = "ALE-D0D00022";

/// The loading step that mounts the champions' archives.
const CHAMPION_STEP: u8 = 52;

/// The loading step that builds the environment's cube-map array.
const MAP_STEP: u8 = 62;

/// A game that ended inside this many seconds under the lazy scan earns the
/// up-front scan hint.
const EARLY_CRASH_SECS: f64 = 60.0;

mod hint {
    pub const SYSTEM_CHECKS: &str = "Run the System checks on the Diagnostics page.";
    pub const UPDATE_MANAGER: &str = "Update LTK Manager.";
    pub const REBUILD_OVERLAY: &str = "Rebuild the overlay.";
    pub const REPAIR_INSTALL: &str =
        "Repair the install in the Riot Client when the rebuild does not help.";
    pub const UPDATE_DRIVER: &str =
        "Update the graphics driver, and check the display settings when the update does not help.";
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
            _ => return None,
        })
    }
}

impl Confidence {
    /// A stable number for the token. Never renumber a variant.
    pub fn code(self) -> u8 {
        match self {
            Self::Lead => 1,
            Self::Likely => 2,
            Self::Confirmed => 3,
        }
    }

    /// The confidence for a token's number, or `None` for one this build does not know.
    pub fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            1 => Self::Lead,
            2 => Self::Likely,
            3 => Self::Confirmed,
            _ => return None,
        })
    }

    /// The ceiling rule: a verdict on an inferred row is never more than a lead.
    pub fn capped_by(self, mark: EvidenceMark) -> Self {
        match mark {
            EvidenceMark::Confirmed => self,
            EvidenceMark::Inferred => Self::Lead,
        }
    }
}

impl fmt::Display for Confidence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            Self::Lead => "lead",
            Self::Likely => "likely",
            Self::Confirmed => "confirmed",
        })
    }
}

impl Verdict {
    /// A verdict with no subject, no confidence and no hints yet.
    pub fn new(kind: VerdictKind, title: impl Into<String>, cause: impl Into<String>) -> Self {
        Self {
            kind,
            title: title.into(),
            cause: cause.into(),
            subject: None,
            confidence: None,
            hints: Vec::new(),
        }
    }

    /// Names the archive, the path's file name, or the step.
    pub fn with_subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = Some(subject.into());
        self
    }

    pub fn with_confidence(mut self, confidence: Confidence) -> Self {
        self.confidence = Some(confidence);
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

/// `000012.344|  ERROR|  LOAD| ` and the shorter header without a channel.
static LOG_HEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\d+\.\d+\|\s*(?P<level>[A-Z]+)\|(?:\s*[A-Z]{2,8}\|)?\s*")
        .expect("a valid header pattern")
});

static MISSING_HASH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)missing data:\s*0x([0-9a-f]{1,16})").expect("a valid hash pattern")
});

impl Evidence {
    /// The line without a game log's time, level and channel columns.
    pub fn message(&self) -> &str {
        match LOG_HEADER.find(&self.line) {
            Some(header) => &self.line[header.end()..],
            None => &self.line,
        }
    }

    /// Whether a game log line was written at the `ERROR` level.
    pub fn is_error_level(&self) -> bool {
        LOG_HEADER
            .captures(&self.line)
            .is_some_and(|header| &header["level"] == "ERROR")
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
    /// `Interrupt, exit code -1073741819`, or `None` when the client said nothing.
    pub fn summary(&self) -> Option<String> {
        let mut parts = Vec::new();
        if let Some(reason) = &self.exit_reason {
            parts.push(reason.clone());
        }
        if let Some(code) = self.exit_code {
            parts.push(format!("exit code {code}"));
        }
        (!parts.is_empty()).then(|| parts.join(", "))
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
    fn suspects(
        &self,
        wants: impl Fn(&str) -> bool,
        because: Because,
        confidence: Confidence,
    ) -> Vec<Suspect> {
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
                confidence,
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
                confidence,
            });
        }
        suspects
    }

    /// The writers of the named archives.
    fn writers_of(
        &self,
        archives: &[String],
        because: Because,
        confidence: Confidence,
    ) -> Vec<Suspect> {
        let wanted: Vec<String> = archives.iter().map(|wad| wad_basename(wad)).collect();
        self.suspects(
            |name| wanted.iter().any(|want| want == name),
            because,
            confidence,
        )
    }
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
    fn parse(status: &str) -> Self {
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
    /// The recorder writes `scan rejected <archive>, status <code>`, which is
    /// how an incident stored before [`Incident::scan_status`] existed still
    /// knows what the scan said.
    fn from_evidence_line(line: &str) -> Option<Self> {
        let (_, status) = line
            .strip_prefix("scan rejected ")?
            .rsplit_once(", status ")?;
        Some(Self::parse(status))
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

impl GameRecord {
    /// A record that opens at the first sign of a game.
    pub fn open(started_at: DateTime<Utc>, origin: SessionOrigin) -> Self {
        Self {
            started_at,
            ended_at: started_at,
            origin,
            failure: None,
            injected: false,
            overlay: OverlayOutcome::None,
            overlay_detail: None,
            redirected: Vec::new(),
            skipped: Vec::new(),
            scan_failures: Vec::new(),
            launch: LaunchKind::Match,
            scan: None,
            host_elevated: false,
            ending: Ending::default(),
            log_path: None,
            log: None,
            timeline: Vec::new(),
        }
    }

    /// The verdict over this record, or `None` when the game was clean and
    /// there is nothing to keep.
    pub fn classify(&self, ctx: &ClassifyContext<'_>) -> Option<Incident> {
        let (verdict, suspects) = self.verdict(ctx)?;
        Some(Incident {
            id: self.id(),
            started_at: self.started_at.to_rfc3339(),
            ended_at: self.ended_at.to_rfc3339(),
            origin: self.origin.clone(),
            injected: self.injected,
            overlay: self.overlay,
            redirected: self.redirected.clone(),
            skipped: self.skipped.clone(),
            launch: self.launch,
            scan: self.scan,
            scan_status: self
                .scan_failures
                .first()
                .map(|failure| ScanStatus::parse(&failure.status)),
            game: self.log.as_ref().map(|log| GameInfo {
                version: log.build_version.clone().unwrap_or_default(),
                content_version: log.content_version.clone().unwrap_or_default(),
                log_path: self.log_path.clone().unwrap_or_default(),
            }),
            ending: self.ending.clone(),
            verdict,
            evidence: self.evidence(),
            suspects,
            dismissed: false,
        })
    }

    /// The branch's `worthReporting` rule, with the log as the fallback when
    /// the client said nothing at all.
    ///
    /// A crash marker inside the game's window is always worth reporting. A
    /// client that spoke is believed, and anything but `Exit` with code zero is
    /// reported. A client that said nothing, which is the Classic flow, leaves
    /// it to the log, and a log with no teardown is a game that did not end on
    /// its own.
    pub fn worth_reporting(&self) -> bool {
        if self.ending.crashed == Some(true) {
            return true;
        }
        let Ending {
            exit_reason,
            exit_code,
            ..
        } = &self.ending;
        if exit_reason.is_some() || exit_code.is_some() {
            return exit_reason
                .as_deref()
                .is_some_and(|reason| reason != "Exit")
                || exit_code.is_some_and(|code| code != 0);
        }
        self.log.as_ref().is_some_and(|log| !log.torn_down)
    }

    fn id(&self) -> String {
        self.log_path
            .as_deref()
            .and_then(|path| {
                last_segment(path)
                    .strip_suffix("_r3dlog.txt")
                    .map(str::to_string)
            })
            .unwrap_or_else(|| {
                self.started_at
                    .with_timezone(&Local)
                    .format("%Y-%m-%dT%H-%M-%S")
                    .to_string()
            })
    }

    fn is_workshop(&self) -> bool {
        self.origin.is_workshop()
    }

    /// Seconds from the first sign to the last, or the log's own clock when
    /// it ran longer than the signs say.
    fn duration_secs(&self) -> f64 {
        let signs = (self.ended_at - self.started_at).num_milliseconds() as f64 / 1000.0;
        let log = self.log.as_ref().map_or(0.0, |log| log.last_time);
        signs.max(log).max(0.0)
    }

    fn ran_lazy_and_ended_early(&self) -> bool {
        self.scan == Some(ScanMode::Lazy) && self.duration_secs() < EARLY_CRASH_SECS
    }

    fn first_code_of(
        &self,
        wanted: impl Fn(CodeKind) -> bool,
    ) -> Option<(&CodeSighting, &'static CodeRow)> {
        self.log.as_ref()?.codes.iter().find_map(|sighting| {
            let row = log_codes::lookup(&sighting.code)?;
            wanted(row.kind).then_some((sighting, row))
        })
    }

    /// The row with the firmest mark among the codes `wanted` accepts, so one
    /// confirmed sighting is not read down by an inferred one beside it.
    fn best_row_of(&self, wanted: impl Fn(CodeKind) -> bool) -> Option<&'static CodeRow> {
        self.log
            .as_ref()?
            .codes
            .iter()
            .filter_map(|sighting| log_codes::lookup(&sighting.code))
            .filter(|row| wanted(row.kind))
            .max_by_key(|row| row.mark == EvidenceMark::Confirmed)
    }

    /// The precedence table. The first row whose evidence is present wins.
    fn verdict(&self, ctx: &ClassifyContext<'_>) -> Option<(Verdict, Vec<Suspect>)> {
        if let Some(failure) = &self.failure {
            return Some(self.patcher_did_not_run(failure));
        }
        if self.overlay == OverlayOutcome::EndOfLife {
            return Some(self.patcher_out_of_date());
        }
        if !self.scan_failures.is_empty() {
            return Some(self.archive_rejected(ctx));
        }
        if self.overlay == OverlayOutcome::Disabled {
            return Some(self.overlay_disabled(ctx));
        }
        if self.overlay != OverlayOutcome::Live && self.worth_reporting() {
            return Some(self.unmodded());
        }
        if let Some(log) = &self.log {
            if let Some((sighting, row)) = self.first_code_of(|kind| kind == CodeKind::MissingData)
            {
                return Some(self.missing_data(ctx, sighting, row));
            }
            if let Some((_, row)) = self.first_code_of(|kind| kind == CodeKind::WadMount) {
                return Some(self.corrupt_archive(ctx, row));
            }
            if let Some((sighting, row)) = self.first_code_of(|kind| kind == CodeKind::Texture) {
                return Some(self.texture_failed(ctx, log, sighting, row));
            }
            if let Some(row) = self.best_row_of(|kind| kind == CodeKind::Memory) {
                return Some(self.out_of_memory(row));
            }
            if let Some((_, row)) = self.first_code_of(|kind| kind == CodeKind::Device) {
                return Some(self.graphics_fault(row));
            }
            if let Some(step) = &log.last_load_step
                && !log.loading_ended
                && self.worth_reporting()
            {
                return Some(self.stuck_loading(ctx, step));
            }
        }
        if !self.skipped.is_empty() {
            return Some(self.archive_skipped(ctx));
        }
        if self.worth_reporting() {
            return Some(self.ended_without_reason());
        }
        None
    }

    fn patcher_did_not_run(&self, failure: &SessionFailure) -> (Verdict, Vec<Suspect>) {
        let verdict = match failure {
            SessionFailure::Build { message } => Verdict::new(
                VerdictKind::PatcherDidNotRun,
                "The overlay build failed",
                sentence(message),
            ),
            SessionFailure::Injection {
                stage: InjectionStage::Host,
                message,
            } => Verdict::new(
                VerdictKind::PatcherDidNotRun,
                "The injection host did not start",
                sentence(message),
            )
            .with_hint(hint::SYSTEM_CHECKS),
            SessionFailure::Injection {
                stage: InjectionStage::Injection,
                message,
            } => Verdict::new(
                VerdictKind::PatcherDidNotRun,
                "The DLL did not attach to League",
                sentence(message),
            )
            .with_hint(if self.host_elevated {
                hint::SIGNATURE
            } else {
                hint::ELEVATE
            })
            .with_hint(hint::SYSTEM_CHECKS),
        };
        (verdict.with_confidence(Confidence::Confirmed), Vec::new())
    }

    fn patcher_out_of_date(&self) -> (Verdict, Vec<Suspect>) {
        let build = self
            .overlay_detail
            .as_deref()
            .map(|detail| format!(" The game's build is {}.", detail.trim()))
            .unwrap_or_default();
        let verdict = Verdict::new(
            VerdictKind::PatcherOutOfDate,
            "The patcher is out of date",
            format!(
                "The patcher does not know this version of League. The DLL refused to patch a build newer than the one it was made for, and the game ran unmodded.{build}"
            ),
        )
        .with_confidence(Confidence::Confirmed)
        .with_hint(hint::UPDATE_MANAGER);
        (verdict, Vec::new())
    }

    fn archive_rejected(&self, ctx: &ClassifyContext<'_>) -> (Verdict, Vec<Suspect>) {
        let first = &self.scan_failures[0];
        let archive = first
            .wad
            .as_deref()
            .map(last_segment)
            .unwrap_or_else(|| "An archive".to_string());
        let mut cause = ScanStatus::parse(&first.status).cause(&archive, &first.status);
        let others = self.scan_failures.len() - 1;
        if others > 0 {
            cause.push_str(&format!(
                " {others} more archive{} failed the scan.",
                plural(others)
            ));
        }
        let wads: Vec<String> = self
            .scan_failures
            .iter()
            .filter_map(|failure| failure.wad.clone())
            .collect();
        let suspects = ctx.writers_of(&wads, Because::Rejected, Confidence::Confirmed);
        let mut verdict = Verdict::new(
            VerdictKind::ArchiveRejected,
            "An archive was rejected",
            cause,
        )
        .with_confidence(Confidence::Confirmed);
        if first.wad.is_some() {
            verdict = verdict.with_subject(archive);
            if self.is_workshop() {
                verdict = verdict.with_hint(hint::OPEN_PROJECT);
            }
        }
        (verdict, suspects)
    }

    fn overlay_disabled(&self, ctx: &ClassifyContext<'_>) -> (Verdict, Vec<Suspect>) {
        let (archive, why) = self
            .overlay_detail
            .as_deref()
            .map(parse_wad_detail)
            .unwrap_or_default();
        let mut cause = String::from("The patcher turned the overlay off before the game loaded.");
        let mut verdict =
            Verdict::new(VerdictKind::OverlayDisabled, "The overlay was disabled", "")
                .with_confidence(Confidence::Confirmed)
                .with_hint(hint::REBUILD_OVERLAY);
        let mut suspects = Vec::new();
        match archive {
            Some(archive) => {
                cause.push_str(&format!(" {archive} did not verify"));
                match why {
                    Some(why) => cause.push_str(&format!(": {}", sentence(&why))),
                    None => cause.push('.'),
                }
                cause.push_str(" The eager scan fails closed, so no mod was in the game.");
                suspects = ctx.writers_of(
                    std::slice::from_ref(&archive),
                    Because::DidNotVerify,
                    Confidence::Confirmed,
                );
                verdict = verdict.with_subject(archive);
                if self.is_workshop() {
                    verdict = verdict.with_hint(hint::OPEN_PROJECT);
                }
            }
            None => cause.push_str(
                " The eager scan fails closed on the first archive that does not verify, so no mod was in the game.",
            ),
        }
        verdict.cause = cause;
        (verdict, suspects)
    }

    fn unmodded(&self) -> (Verdict, Vec<Suspect>) {
        let mut verdict = Verdict::new(VerdictKind::Unmodded, "Unmodded game", "");
        let why = match self.overlay {
            _ if !self.injected => {
                "The DLL never attached, because the patcher was not running or the host never found the game.".to_string()
            }
            OverlayOutcome::TooLate => {
                verdict = verdict.with_hint(hint::START_FIRST);
                "League started before the patcher's scan, so the DLL joined too late and stayed inert.".to_string()
            }
            OverlayOutcome::HookFailed => match &self.overlay_detail {
                Some(detail) => format!(
                    "The DLL attached, and a hook did not install: {}",
                    sentence(detail)
                ),
                None => "The DLL attached, and a hook did not install.".to_string(),
            },
            _ => "The DLL attached and said nothing about the overlay.".to_string(),
        };
        verdict.cause = format!("No mod was in this game. {why}");
        (verdict, Vec::new())
    }

    fn missing_data(
        &self,
        ctx: &ClassifyContext<'_>,
        sighting: &CodeSighting,
        row: &CodeRow,
    ) -> (Verdict, Vec<Suspect>) {
        let hash = missing_hash_in(&sighting.line);
        let path = hash.and_then(|hash| (ctx.resolve_hash)(hash));
        let mut verdict = Verdict::new(VerdictKind::MissingData, "Missing data", "");
        let mut cause = String::from("League stopped a read it could not finish.");

        let (suspects, confidence) = match &path {
            Some(path) => {
                cause.push_str(&format!(" The file is {path}."));
                verdict = verdict.with_subject(last_segment(path));
                let writers = match PathHome::of(path) {
                    PathHome::Champion(champion) => {
                        let archive = format!("{champion}.wad.client");
                        ctx.suspects(
                            |name| name == archive,
                            Because::HoldsThePath,
                            Confidence::Confirmed,
                        )
                    }
                    PathHome::Map => {
                        ctx.suspects(is_map_archive, Because::HoldsThePath, Confidence::Confirmed)
                    }
                    PathHome::Unknown => Vec::new(),
                };
                match writers.len() {
                    0 => {
                        cause.push_str(" No enabled mod writes the archive it lives in, so the mods that were in the game are listed.");
                        (self.redirected_writers(ctx), Confidence::Lead)
                    }
                    1 => (writers, Confidence::Confirmed),
                    _ => (
                        with_confidence(writers, Confidence::Likely),
                        Confidence::Likely,
                    ),
                }
            }
            None => {
                match hash {
                    Some(hash) => cause.push_str(&format!(
                        " The file's hash is 0x{hash:016x}, and no table names it, so it is a path a mod referenced and did not ship."
                    )),
                    None => cause.push_str(" The line carries no hash the manager can read."),
                }
                cause.push_str(" The mods whose archives were in the game are listed.");
                (self.redirected_writers(ctx), Confidence::Lead)
            }
        };

        verdict.cause = cause;
        verdict = verdict
            .with_confidence(confidence.capped_by(row.mark))
            .with_hint(if self.is_workshop() {
                hint::OPEN_PROJECT
            } else {
                hint::DISABLE_SUSPECT
            });
        (verdict, suspects)
    }

    fn corrupt_archive(&self, ctx: &ClassifyContext<'_>, row: &CodeRow) -> (Verdict, Vec<Suspect>) {
        // The code names no archive, so even a confirmed row cannot say which
        // mod, and the verdict stops at Likely.
        let confidence = Confidence::Likely.capped_by(row.mark);
        let verdict = Verdict::new(
            VerdictKind::CorruptArchive,
            "A corrupt archive",
            format!(
                "League could not mount an archive. {} The code names no archive, so the mods whose archives were in the game are listed.",
                reading(row)
            ),
        )
        .with_confidence(confidence)
        .with_hint(hint::REBUILD_OVERLAY)
        .with_hint(hint::REPAIR_INSTALL);
        (verdict, self.redirected_writers(ctx))
    }

    fn texture_failed(
        &self,
        ctx: &ClassifyContext<'_>,
        log: &GameLogFacts,
        sighting: &CodeSighting,
        row: &CodeRow,
    ) -> (Verdict, Vec<Suspect>) {
        let after_cube_step = sighting.code == CUBE_MAP_TEXTURE
            && log.codes.windows(2).any(|pair| {
                pair[1].code == CUBE_MAP_TEXTURE
                    && log_codes::lookup(&pair[0].code)
                        .is_some_and(|row| row.kind == CodeKind::LoadStep(MAP_STEP))
            });
        let mut cause = format!(
            "A texture could not be created, and the crash came after it. {}",
            reading(row)
        );
        let suspects = if after_cube_step {
            cause.push_str(" The texture was a cubemap of the map, which points at a map mod and away from a champion skin.");
            self.redirected_writers_where(ctx, is_map_archive)
        } else {
            self.redirected_writers(ctx)
        };
        let verdict = Verdict::new(VerdictKind::TextureFailed, "A texture failed", cause)
            .with_confidence(Confidence::Likely.capped_by(row.mark))
            .with_hint(hint::REBUILD_OVERLAY);
        (verdict, suspects)
    }

    fn out_of_memory(&self, row: &CodeRow) -> (Verdict, Vec<Suspect>) {
        let count = self.redirected.len();
        let verdict = Verdict::new(
            VerdictKind::OutOfMemory,
            "Out of memory",
            format!("League ran out of memory. {}", reading(row)),
        )
        .with_confidence(Confidence::Confirmed.capped_by(row.mark))
        .with_hint(format!(
            "A mod with very large textures raises the odds, and {count} modded archive{} {} in this game.",
            plural(count),
            if count == 1 { "was" } else { "were" }
        ));
        (verdict, Vec::new())
    }

    fn graphics_fault(&self, row: &CodeRow) -> (Verdict, Vec<Suspect>) {
        let verdict = Verdict::new(
            VerdictKind::GraphicsFault,
            "A graphics fault",
            format!(
                "The graphics driver stopped responding. {} No mod is named, because a device fault is the driver's.",
                reading(row)
            ),
        )
        .with_confidence(Confidence::Lead.capped_by(row.mark))
        .with_hint(hint::UPDATE_DRIVER);
        (verdict, Vec::new())
    }

    fn stuck_loading(
        &self,
        ctx: &ClassifyContext<'_>,
        step: &CodeSighting,
    ) -> (Verdict, Vec<Suspect>) {
        let row = log_codes::lookup(&step.code);
        let number = row.and_then(|row| match row.kind {
            CodeKind::LoadStep(n) => Some(n),
            _ => None,
        });
        let mark = row.map_or(EvidenceMark::Inferred, |row| row.mark);
        let mut verdict = Verdict::new(VerdictKind::StuckLoading, "Stuck loading", "")
            .with_confidence(Confidence::Likely.capped_by(mark));
        let suspects = match number {
            Some(n) => {
                let work = row
                    .and_then(|row| row.meaning.split_once(", "))
                    .map(|(_, work)| format!(", {work}"))
                    .unwrap_or_default();
                verdict.cause = format!(
                    "League stopped at loading step {n} of {LOAD_STEPS}{work}. The marker is written before its step runs, so this is the step that did not finish."
                );
                verdict = verdict.with_subject(format!("step {n} of {LOAD_STEPS}"));
                match n {
                    CHAMPION_STEP => self.redirected_writers_where(ctx, is_champion_archive),
                    MAP_STEP => self.redirected_writers_where(ctx, is_map_archive),
                    _ => Vec::new(),
                }
            }
            None => {
                verdict.cause = format!(
                    "League stopped on the loading screen, at a step the manager does not know ({}).",
                    step.code
                );
                Vec::new()
            }
        };
        if self.ran_lazy_and_ended_early() {
            verdict = verdict.with_hint(hint::SCAN_UP_FRONT);
        }
        (verdict, with_confidence(suspects, Confidence::Likely))
    }

    fn archive_skipped(&self, ctx: &ClassifyContext<'_>) -> (Verdict, Vec<Suspect>) {
        let count = self.skipped.len();
        let first = &self.skipped[0];
        let archive = last_segment(&first.wad);
        let mut cause = if count == 1 {
            String::from("One archive was left unmodded.")
        } else {
            format!("{count} archives were left unmodded.")
        };
        cause.push_str(&format!(
            " The lazy scan skipped {archive}: {} The game ran with every other mod and without this one.",
            sentence(&first.why)
        ));
        let wads: Vec<String> = self.skipped.iter().map(|s| s.wad.clone()).collect();
        let suspects = ctx.writers_of(&wads, Because::Skipped, Confidence::Confirmed);
        let mut verdict =
            Verdict::new(VerdictKind::ArchiveSkipped, "An archive was skipped", cause)
                .with_subject(archive)
                .with_confidence(Confidence::Confirmed)
                .with_hint(hint::REBUILD_OVERLAY);
        if self.is_workshop() {
            verdict = verdict.with_hint(hint::OPEN_PROJECT);
        }
        (verdict, suspects)
    }

    fn ended_without_reason(&self) -> (Verdict, Vec<Suspect>) {
        let mut cause = String::from("League closed, and left no reason the manager can read.");
        match self.ending.summary() {
            Some(summary) => cause.push_str(&format!(" The client reported {summary}.")),
            None => cause.push_str(" The client reported no reason and no exit code."),
        }
        match self.ending.crashed {
            Some(true) => cause.push_str(" Crashpad ran."),
            Some(false) => cause.push_str(" Crashpad did not run."),
            None => {}
        }
        match &self.log {
            Some(log) => cause.push_str(&format!(
                " The game log held {} error line{}.",
                log.error_lines,
                plural(log.error_lines as usize)
            )),
            None => cause.push_str(" No game log was read."),
        }
        let mut verdict = Verdict::new(
            VerdictKind::EndedWithoutReason,
            "Ended without a reason",
            cause,
        );
        if self.ran_lazy_and_ended_early() {
            verdict = verdict.with_hint(hint::SCAN_UP_FRONT);
        }
        (verdict.with_hint(hint::COPY_REPORT), Vec::new())
    }

    fn redirected_writers(&self, ctx: &ClassifyContext<'_>) -> Vec<Suspect> {
        ctx.writers_of(&self.redirected, Because::Redirected, Confidence::Lead)
    }

    fn redirected_writers_where(
        &self,
        ctx: &ClassifyContext<'_>,
        keep: fn(&str) -> bool,
    ) -> Vec<Suspect> {
        let archives: Vec<String> = self
            .redirected
            .iter()
            .filter(|wad| keep(&wad_basename(wad)))
            .cloned()
            .collect();
        ctx.writers_of(&archives, Because::Redirected, Confidence::Lead)
    }

    /// The timeline, the log's codes and the client's word, newest first.
    fn evidence(&self) -> Vec<Evidence> {
        let mut rows: Vec<(f64, Evidence)> = Vec::new();
        for raw in &self.timeline {
            let secs = ((raw.at - self.started_at).num_milliseconds() as f64 / 1000.0).max(0.0);
            rows.push((
                secs,
                Evidence {
                    at: clock(secs),
                    source: raw.source,
                    line: raw.line.clone(),
                    code: None,
                },
            ));
        }
        if let Some(log) = &self.log {
            for sighting in &log.codes {
                rows.push((
                    sighting.at,
                    Evidence {
                        at: clock(sighting.at),
                        source: EvidenceSource::Game,
                        line: sighting.line.clone(),
                        code: Some(EvidenceCode::from_table(&sighting.code)),
                    },
                ));
            }
        }
        if let Some(summary) = self.ending.summary() {
            let secs = self.duration_secs();
            rows.push((
                secs,
                Evidence {
                    at: clock(secs),
                    source: EvidenceSource::Client,
                    line: summary,
                    code: None,
                },
            ));
        }
        rows.sort_by(|a, b| a.0.total_cmp(&b.0));
        rows.reverse();
        rows.into_iter().map(|(_, evidence)| evidence).collect()
    }
}

fn with_confidence(suspects: Vec<Suspect>, confidence: Confidence) -> Vec<Suspect> {
    suspects
        .into_iter()
        .map(|suspect| Suspect {
            confidence,
            ..suspect
        })
        .collect()
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

/// `wad <name>: <why>`, as the DLL's verification lines put it.
fn parse_wad_detail(detail: &str) -> (Option<String>, Option<String>) {
    let detail = detail.trim();
    let rest = detail.strip_prefix("wad ").unwrap_or(detail);
    match rest.split_once(':') {
        Some((name, why)) => (
            Some(last_segment(name.trim())).filter(|name| !name.is_empty()),
            Some(why.trim().to_string()).filter(|why| !why.is_empty()),
        ),
        None => (
            Some(last_segment(rest)).filter(|name| !name.is_empty()),
            None,
        ),
    }
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

#[cfg(test)]
mod tests {
    use chrono::{TimeDelta, TimeZone};

    use super::*;

    fn at(secs: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 21, 21, 14, 0).unwrap() + TimeDelta::seconds(secs)
    }

    fn mods() -> Vec<ModFootprint> {
        let footprint = |id: &str, name: &str, priority: usize, wad: &str| ModFootprint {
            mod_id: id.to_string(),
            display_name: name.to_string(),
            priority,
            affected_wads: vec![wad.to_string()],
        };
        vec![
            footprint(
                "aatrox-justicar",
                "Aatrox Justicar",
                1,
                "DATA/FINAL/Champions/Aatrox.wad.client",
            ),
            footprint("classic-rift", "Classic Rift", 0, "Map11.wad.client"),
            footprint("ahri-star", "Ahri Star Guardian", 2, "Ahri.wad.client"),
        ]
    }

    fn no_path(_: u64) -> Option<String> {
        None
    }

    fn aatrox_path(hash: u64) -> Option<String> {
        (hash == 0x1a2b3c4d5e6f7081)
            .then(|| "assets/characters/aatrox/skins/skin12/aatrox_skin12_tx_cm.dds".to_string())
    }

    fn modded_game() -> GameRecord {
        let mut record = GameRecord::open(at(0), SessionOrigin::Library);
        record.ended_at = at(12);
        record.injected = true;
        record.overlay = OverlayOutcome::Live;
        record.scan = Some(ScanMode::Eager);
        record.redirected = [
            "Aatrox.wad.client",
            "Map11.wad.client",
            "UI.wad.client",
            "Global.wad.client",
        ]
        .map(String::from)
        .to_vec();
        record
    }

    fn crashed(mut record: GameRecord) -> GameRecord {
        record.ending = Ending {
            exit_reason: Some("Interrupt".to_string()),
            exit_code: Some(-1073741819),
            crashed: Some(true),
        };
        record
    }

    fn clean(mut record: GameRecord) -> GameRecord {
        record.ending = Ending {
            exit_reason: Some("Exit".to_string()),
            exit_code: Some(0),
            crashed: Some(false),
        };
        record
    }

    fn sighting(code: &str, at: f64, line: &str) -> CodeSighting {
        CodeSighting {
            code: code.to_string(),
            at,
            line: line.to_string(),
        }
    }

    fn channel(code: &str, at: f64) -> CodeSighting {
        sighting(code, at, &format!("{at:010.3}| ALWAYS|  LOAD| {code}"))
    }

    fn log_with(codes: Vec<CodeSighting>) -> GameLogFacts {
        GameLogFacts {
            build_version: Some("16.16.804.9184".to_string()),
            last_time: 12.4,
            codes,
            ..Default::default()
        }
    }

    fn classify(record: &GameRecord, resolve: &dyn Fn(u64) -> Option<String>) -> Option<Incident> {
        let mods = mods();
        record.classify(&ClassifyContext {
            mods: &mods,
            projects: &[],
            resolve_hash: resolve,
        })
    }

    fn names(incident: &Incident) -> Vec<&str> {
        incident
            .suspects
            .iter()
            .map(|suspect| suspect.display_name.as_str())
            .collect()
    }

    #[test]
    fn a_clean_game_is_no_incident() {
        let mut record = clean(modded_game());
        record.log = Some(GameLogFacts {
            torn_down: true,
            ..log_with(vec![channel("SEJ-9F31B5D0", 3.0)])
        });
        assert_eq!(classify(&record, &no_path), None);
    }

    #[test]
    fn a_build_failure_is_the_whole_story() {
        let mut record = GameRecord::open(at(0), SessionOrigin::Library);
        record.failure = Some(SessionFailure::Build {
            message: "Overlay build failed: bad layer".to_string(),
        });
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::PatcherDidNotRun);
        assert_eq!(incident.verdict.title, "The overlay build failed");
        assert_eq!(incident.verdict.cause, "Overlay build failed: bad layer.");
        assert_eq!(incident.verdict.confidence, Some(Confidence::Confirmed));
        assert!(incident.suspects.is_empty());
        assert!(incident.game.is_none());
        assert!(!incident.id.is_empty());
    }

    #[test]
    fn a_host_failure_points_at_the_system_checks() {
        let mut record = GameRecord::open(at(0), SessionOrigin::Library);
        record.failure = Some(SessionFailure::Injection {
            stage: InjectionStage::Host,
            message: "host stdout closed".to_string(),
        });
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.title, "The injection host did not start");
        assert_eq!(incident.verdict.hints, [hint::SYSTEM_CHECKS]);
    }

    #[test]
    fn a_dll_that_never_attached_hints_at_elevation_or_the_signature() {
        let mut record = GameRecord::open(at(0), SessionOrigin::Library);
        record.failure = Some(SessionFailure::Injection {
            stage: InjectionStage::Injection,
            message: "DLL never attached after 60s".to_string(),
        });
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.title, "The DLL did not attach to League");
        assert_eq!(incident.verdict.cause, "DLL never attached after 60s.");
        assert_eq!(incident.verdict.hints, [hint::ELEVATE, hint::SYSTEM_CHECKS]);

        record.host_elevated = true;
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(
            incident.verdict.hints,
            [hint::SIGNATURE, hint::SYSTEM_CHECKS]
        );
    }

    #[test]
    fn an_end_of_life_dll_is_an_out_of_date_patcher_even_on_a_clean_ending() {
        let mut record = clean(modded_game());
        record.overlay = OverlayOutcome::EndOfLife;
        record.overlay_detail = Some("0x68a1b2c3".to_string());
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::PatcherOutOfDate);
        assert!(
            incident
                .verdict
                .cause
                .starts_with("The patcher does not know this version of League.")
        );
        assert!(incident.verdict.cause.contains("0x68a1b2c3"));
        assert_eq!(incident.verdict.hints, [hint::UPDATE_MANAGER]);
        assert!(incident.suspects.is_empty());
    }

    #[test]
    fn a_rejected_archive_names_its_writers() {
        let mut record = clean(modded_game());
        record.scan_failures = vec![WadScanFailure {
            wad: Some("DATA/FINAL/Champions/Aatrox.wad.client".to_string()),
            status: "c0000229".to_string(),
        }];
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::ArchiveRejected);
        assert_eq!(
            incident.verdict.subject.as_deref(),
            Some("Aatrox.wad.client")
        );
        assert!(incident.verdict.cause.contains("skinhack"));
        assert_eq!(incident.scan_status, Some(ScanStatus::Skinhack));
        assert_eq!(names(&incident), ["Aatrox Justicar"]);
        assert_eq!(
            incident.suspects[0].because,
            "writes Aatrox.wad.client, which the scan rejected"
        );
        assert_eq!(incident.suspects[0].confidence, Confidence::Confirmed);

        record.scan_failures[0].status = "base_skin".to_string();
        let incident = classify(&record, &no_path).unwrap();
        assert!(incident.verdict.cause.contains("incomplete mod"));
        assert!(!incident.verdict.cause.contains("skinhack"));
        assert_eq!(incident.scan_status, Some(ScanStatus::BaseSkin));
    }

    #[test]
    fn a_disabled_overlay_records_on_a_clean_ending() {
        let mut record = clean(modded_game());
        record.overlay = OverlayOutcome::Disabled;
        record.overlay_detail =
            Some("wad DATA/FINAL/Champions/Aatrox.wad.client: file would not open".to_string());
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::OverlayDisabled);
        assert_eq!(
            incident.verdict.subject.as_deref(),
            Some("Aatrox.wad.client")
        );
        assert!(
            incident
                .verdict
                .cause
                .contains("Aatrox.wad.client did not verify: file would not open.")
        );
        assert_eq!(names(&incident), ["Aatrox Justicar"]);
        assert_eq!(incident.verdict.hints, [hint::REBUILD_OVERLAY]);
    }

    #[test]
    fn an_unmodded_crash_says_why_and_an_unmodded_clean_game_is_nothing() {
        let mut record = crashed(modded_game());
        record.injected = false;
        record.overlay = OverlayOutcome::None;
        record.redirected.clear();
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::Unmodded);
        assert!(incident.verdict.cause.contains("never attached"));
        assert_eq!(incident.verdict.confidence, None);

        record.injected = true;
        record.overlay = OverlayOutcome::TooLate;
        let incident = classify(&record, &no_path).unwrap();
        assert!(incident.verdict.cause.contains("joined too late"));
        assert_eq!(incident.verdict.hints, [hint::START_FIRST]);

        assert_eq!(classify(&clean(record), &no_path), None);
    }

    fn missing_data_line() -> CodeSighting {
        sighting(
            "ALE-9B39AA45",
            12.344,
            "000012.344|  ERROR| ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081",
        )
    }

    #[test]
    fn missing_data_with_a_path_names_the_archive_writer() {
        let mut record = crashed(modded_game());
        record.log = Some(log_with(vec![
            channel("SEJ-9F31B5D0", 12.301),
            missing_data_line(),
        ]));
        let incident = classify(&record, &aatrox_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::MissingData);
        assert_eq!(incident.verdict.title, "Missing data");
        assert_eq!(
            incident.verdict.subject.as_deref(),
            Some("aatrox_skin12_tx_cm.dds")
        );
        assert!(
            incident
                .verdict
                .cause
                .contains("The file is assets/characters/aatrox/")
        );
        assert_eq!(incident.verdict.confidence, Some(Confidence::Confirmed));
        assert_eq!(names(&incident), ["Aatrox Justicar"]);
        assert_eq!(
            incident.suspects[0].because,
            "writes Aatrox.wad.client, which holds the path"
        );
        assert_eq!(incident.suspects[0].confidence, Confidence::Confirmed);
        assert_eq!(incident.verdict.hints, [hint::DISABLE_SUSPECT]);
    }

    #[test]
    fn missing_data_with_two_writers_is_likely() {
        let mut record = crashed(modded_game());
        record.log = Some(log_with(vec![missing_data_line()]));
        let mut mods = mods();
        mods.push(ModFootprint {
            mod_id: "aatrox-other".to_string(),
            display_name: "Aatrox Other".to_string(),
            priority: 0,
            affected_wads: vec!["aatrox.WAD.client".to_string()],
        });
        let incident = record
            .classify(&ClassifyContext {
                mods: &mods,
                projects: &[],
                resolve_hash: &aatrox_path,
            })
            .unwrap();
        assert_eq!(incident.verdict.confidence, Some(Confidence::Likely));
        assert_eq!(names(&incident), ["Aatrox Other", "Aatrox Justicar"]);
        assert!(
            incident
                .suspects
                .iter()
                .all(|s| s.confidence == Confidence::Likely)
        );
    }

    #[test]
    fn missing_data_without_a_path_lists_the_redirected_writers_as_a_lead() {
        let mut record = crashed(modded_game());
        record.log = Some(log_with(vec![missing_data_line()]));
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.confidence, Some(Confidence::Lead));
        assert_eq!(incident.verdict.subject, None);
        assert!(incident.verdict.cause.contains("0x1a2b3c4d5e6f7081"));
        assert_eq!(names(&incident), ["Classic Rift", "Aatrox Justicar"]);
        assert_eq!(
            incident.suspects[0].because,
            "writes Map11.wad.client, redirected this game"
        );
        assert!(
            incident
                .suspects
                .iter()
                .all(|s| s.confidence == Confidence::Lead)
        );
    }

    #[test]
    fn a_log_verdict_applies_even_when_the_client_said_exit() {
        let mut record = clean(modded_game());
        record.log = Some(log_with(vec![missing_data_line()]));
        let incident = classify(&record, &aatrox_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::MissingData);
    }

    #[test]
    fn a_corrupt_archive_is_a_lead_on_an_inferred_row_and_likely_on_a_confirmed_one() {
        let mut record = crashed(modded_game());
        record.log = Some(log_with(vec![channel("ALE-18967993", 5.0)]));
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::CorruptArchive);
        assert_eq!(incident.verdict.confidence, Some(Confidence::Lead));
        assert!(
            incident
                .verdict
                .cause
                .contains("Probably an archive could not be mounted, because it is corrupt.")
        );
        assert_eq!(names(&incident), ["Classic Rift", "Aatrox Justicar"]);
        assert_eq!(
            incident.verdict.hints,
            [hint::REBUILD_OVERLAY, hint::REPAIR_INSTALL]
        );

        record.log = Some(log_with(vec![channel("ALE-89b0dee7", 5.0)]));
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.confidence, Some(Confidence::Likely));
        assert!(
            incident
                .verdict
                .cause
                .contains("An archive holds an invalid sub-chunk.")
        );
    }

    #[test]
    fn a_cube_map_right_after_step_62_points_at_the_map() {
        let texture = sighting(
            "ALE-D0D00022",
            9.0,
            r#"000009.000|  ERROR| Error: "ALE-D0D00022" - Result: E_INVALIDARG."#,
        );
        let mut record = crashed(modded_game());
        record.log = Some(log_with(vec![
            channel("SEJ-3E9A0C57", 8.9),
            texture.clone(),
        ]));
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::TextureFailed);
        assert_eq!(incident.verdict.confidence, Some(Confidence::Likely));
        assert!(incident.verdict.cause.contains("a cubemap of the map"));
        assert_eq!(names(&incident), ["Classic Rift"]);

        record.log = Some(log_with(vec![channel("SEJ-9F31B5D0", 8.9), texture]));
        let incident = classify(&record, &no_path).unwrap();
        assert!(!incident.verdict.cause.contains("cubemap"));
        assert_eq!(names(&incident), ["Classic Rift", "Aatrox Justicar"]);

        record.log = Some(log_with(vec![channel("ALE-D0D00023", 9.0)]));
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.confidence, Some(Confidence::Lead));
    }

    #[test]
    fn out_of_memory_is_confirmed_or_a_lead_by_its_code() {
        let mut record = crashed(modded_game());
        record.log = Some(log_with(vec![channel("ALE-546D9FE7", 9.0)]));
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::OutOfMemory);
        assert_eq!(incident.verdict.confidence, Some(Confidence::Lead));
        assert!(incident.suspects.is_empty());
        assert!(incident.verdict.hints[0].contains("4 modded archives were in this game"));

        record.log = Some(log_with(vec![
            channel("ALE-546D9FE7", 9.0),
            channel("ALE-71BBD00F", 9.1),
        ]));
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.confidence, Some(Confidence::Confirmed));
        assert!(
            incident
                .verdict
                .cause
                .contains("The graphics device ran out of memory.")
        );
    }

    #[test]
    fn a_graphics_fault_is_a_lead_with_no_suspect() {
        let mut record = crashed(modded_game());
        record.log = Some(log_with(vec![channel("ALE-3112373", 9.0)]));
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::GraphicsFault);
        assert_eq!(incident.verdict.confidence, Some(Confidence::Lead));
        assert!(incident.suspects.is_empty());
        assert_eq!(incident.verdict.hints, [hint::UPDATE_DRIVER]);
    }

    fn stuck_at(code: &str) -> GameRecord {
        let mut record = crashed(modded_game());
        record.log = Some(GameLogFacts {
            last_load_step: Some(channel(code, 12.3)),
            loading_ended: false,
            ..log_with(vec![channel("SEJ-1A4F7C20", 3.0), channel(code, 12.3)])
        });
        record
    }

    #[test]
    fn stuck_at_step_52_names_the_champion_mods_and_62_the_map_mods() {
        let incident = classify(&stuck_at("SEJ-9F31B5D0"), &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::StuckLoading);
        assert_eq!(incident.verdict.subject.as_deref(), Some("step 52 of 64"));
        assert!(incident.verdict.cause.starts_with(
            "League stopped at loading step 52 of 64, mounting the champions' archives."
        ));
        assert_eq!(incident.verdict.confidence, Some(Confidence::Likely));
        assert_eq!(names(&incident), ["Aatrox Justicar"]);
        assert_eq!(incident.suspects[0].confidence, Confidence::Likely);

        let incident = classify(&stuck_at("SEJ-3E9A0C57"), &no_path).unwrap();
        assert_eq!(names(&incident), ["Classic Rift"]);

        let incident = classify(&stuck_at("SEJ-5C2A6F38"), &no_path).unwrap();
        assert_eq!(incident.verdict.subject.as_deref(), Some("step 44 of 64"));
        assert!(incident.suspects.is_empty());
    }

    #[test]
    fn a_loading_screen_the_player_left_is_not_stuck() {
        let record = clean(stuck_at("SEJ-9F31B5D0"));
        assert_eq!(classify(&record, &no_path), None);
    }

    #[test]
    fn an_early_crash_under_the_lazy_scan_earns_the_up_front_hint() {
        let mut record = stuck_at("SEJ-9F31B5D0");
        record.scan = Some(ScanMode::Lazy);
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.hints, [hint::SCAN_UP_FRONT]);
    }

    #[test]
    fn a_skipped_archive_records_on_a_clean_ending() {
        let mut record = clean(modded_game());
        record.skipped = vec![SkippedArchive {
            wad: "DATA/FINAL/Champions/Ahri.wad.client".to_string(),
            why: "signature did not check".to_string(),
        }];
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::ArchiveSkipped);
        assert!(
            incident
                .verdict
                .cause
                .starts_with("One archive was left unmodded.")
        );
        assert_eq!(incident.verdict.subject.as_deref(), Some("Ahri.wad.client"));
        assert_eq!(names(&incident), ["Ahri Star Guardian"]);
        assert_eq!(
            incident.suspects[0].because,
            "writes Ahri.wad.client, which the lazy scan skipped"
        );
        assert_eq!(incident.verdict.confidence, Some(Confidence::Confirmed));
    }

    #[test]
    fn an_ending_with_no_reason_lists_the_facts() {
        let mut record = crashed(modded_game());
        record.log = Some(GameLogFacts {
            error_lines: 3,
            ..log_with(Vec::new())
        });
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.verdict.kind, VerdictKind::EndedWithoutReason);
        assert_eq!(incident.verdict.confidence, None);
        let cause = &incident.verdict.cause;
        assert!(cause.starts_with("League closed, and left no reason the manager can read."));
        assert!(cause.contains("Interrupt, exit code -1073741819"));
        assert!(cause.contains("Crashpad ran."));
        assert!(cause.contains("3 error lines"));
        assert_eq!(incident.verdict.hints, [hint::COPY_REPORT]);
    }

    #[test]
    fn a_crash_marker_alone_is_worth_reporting() {
        let mut record = modded_game();
        record.ending.crashed = Some(true);
        assert!(record.worth_reporting());
        assert_eq!(
            classify(&record, &no_path).unwrap().verdict.kind,
            VerdictKind::EndedWithoutReason
        );
    }

    #[test]
    fn on_the_classic_flow_the_log_decides() {
        let mut record = modded_game();
        assert!(!record.worth_reporting());
        record.log = Some(log_with(Vec::new()));
        assert!(record.worth_reporting());
        record.log.as_mut().unwrap().torn_down = true;
        assert!(!record.worth_reporting());
        assert_eq!(classify(&record, &no_path), None);
    }

    #[test]
    fn a_non_zero_code_with_an_exit_reason_is_worth_reporting() {
        let mut record = clean(modded_game());
        record.ending.exit_code = Some(1);
        assert!(record.worth_reporting());
        record.ending.exit_code = Some(0);
        record.ending.exit_reason = Some("Timeout".to_string());
        assert!(record.worth_reporting());
    }

    #[test]
    fn evidence_is_newest_first_on_the_game_clock() {
        let mut record = crashed(modded_game());
        record.timeline = vec![
            RawEvidence {
                at: at(4),
                source: EvidenceSource::Host,
                line: "injected, pid 18232".to_string(),
            },
            RawEvidence {
                at: at(0),
                source: EvidenceSource::Dll,
                line: "redirected Aatrox.wad.client".to_string(),
            },
        ];
        record.log = Some(log_with(vec![missing_data_line()]));
        let incident = classify(&record, &aatrox_path).unwrap();
        let rows: Vec<(&str, EvidenceSource)> = incident
            .evidence
            .iter()
            .map(|row| (row.at.as_str(), row.source))
            .collect();
        assert_eq!(
            rows,
            [
                ("00:12.4", EvidenceSource::Client),
                ("00:12.3", EvidenceSource::Game),
                ("00:04.0", EvidenceSource::Host),
                ("00:00.0", EvidenceSource::Dll),
            ]
        );
        assert_eq!(
            incident.evidence[0].line,
            "Interrupt, exit code -1073741819"
        );
        let code = incident.evidence[1].code.as_ref().unwrap();
        assert_eq!(code.id, "ALE-9B39AA45");
        assert_eq!(code.kind.as_deref(), Some("missing_data"));
        assert_eq!(code.mark, Some(EvidenceMark::Confirmed));
        assert!(incident.evidence[1].is_error_level());
    }

    #[test]
    fn an_unknown_code_keeps_its_id_and_nothing_else() {
        let code = EvidenceCode::from_table("SEJ-ZZZZZZZZ");
        assert_eq!(code.id, "SEJ-ZZZZZZZZ");
        assert_eq!(code.kind, None);
        assert_eq!(code.meaning, None);
        assert_eq!(code.mark, None);
    }

    #[test]
    fn the_id_is_the_log_stamp_when_there_is_a_log() {
        let mut record = crashed(modded_game());
        record.log_path = Some(
            r"C:\Riot Games\League of Legends\Logs\GameLogs\2026-08-21T21-14-02\2026-08-21T21-14-02_r3dlog.txt"
                .to_string(),
        );
        record.log = Some(log_with(Vec::new()));
        let incident = classify(&record, &no_path).unwrap();
        assert_eq!(incident.id, "2026-08-21T21-14-02");
        let game = incident.game.unwrap();
        assert_eq!(game.version, "16.16.804.9184");
        assert_eq!(game.content_version, "");
        assert!(game.log_path.ends_with("_r3dlog.txt"));
        assert_eq!(incident.started_at, "2026-08-21T21:14:00+00:00");
        assert_eq!(incident.ended_at, "2026-08-21T21:14:12+00:00");
    }

    #[test]
    fn a_workshop_test_names_the_project_and_the_open_hint() {
        let mut record = clean(modded_game());
        record.origin = SessionOrigin::Workshop {
            projects: vec![r"C:\ws\aatrox".to_string()],
        };
        record.skipped = vec![SkippedArchive {
            wad: "Aatrox.wad.client".to_string(),
            why: "hash mismatch".to_string(),
        }];
        let projects = [ProjectFootprint {
            project_path: r"C:\ws\aatrox".to_string(),
            display_name: "Aatrox (project)".to_string(),
            affected_wads: vec!["DATA/FINAL/Champions/Aatrox.wad.client".to_string()],
        }];
        let incident = record
            .classify(&ClassifyContext {
                mods: &[],
                projects: &projects,
                resolve_hash: &no_path,
            })
            .unwrap();
        assert_eq!(names(&incident), ["Aatrox (project)"]);
        assert_eq!(
            incident.suspects[0].project_path.as_deref(),
            Some(r"C:\ws\aatrox")
        );
        assert_eq!(incident.suspects[0].mod_id, None);
        assert_eq!(
            incident.verdict.hints,
            [hint::REBUILD_OVERLAY, hint::OPEN_PROJECT]
        );
    }

    #[test]
    fn a_mod_writing_two_redirected_archives_is_listed_once() {
        let mods = [ModFootprint {
            mod_id: "bundle".to_string(),
            display_name: "Bundle".to_string(),
            priority: 0,
            affected_wads: vec![
                "Aatrox.wad.client".to_string(),
                "Map11.wad.client".to_string(),
                "Ahri.wad.client".to_string(),
            ],
        }];
        let mut record = crashed(modded_game());
        record.log = Some(log_with(vec![channel("ALE-18967993", 5.0)]));
        let incident = record
            .classify(&ClassifyContext {
                mods: &mods,
                projects: &[],
                resolve_hash: &no_path,
            })
            .unwrap();
        assert_eq!(names(&incident), ["Bundle"]);
        assert_eq!(
            incident.suspects[0].because,
            "writes Aatrox.wad.client and Map11.wad.client, redirected this game"
        );
    }

    #[test]
    fn numbers_round_trip_for_every_enum() {
        let kinds = [
            VerdictKind::PatcherDidNotRun,
            VerdictKind::PatcherOutOfDate,
            VerdictKind::ArchiveRejected,
            VerdictKind::OverlayDisabled,
            VerdictKind::Unmodded,
            VerdictKind::MissingData,
            VerdictKind::CorruptArchive,
            VerdictKind::TextureFailed,
            VerdictKind::OutOfMemory,
            VerdictKind::GraphicsFault,
            VerdictKind::StuckLoading,
            VerdictKind::ArchiveSkipped,
            VerdictKind::EndedWithoutReason,
        ];
        for (index, kind) in kinds.iter().enumerate() {
            assert_eq!(kind.code(), index as u8 + 1);
            assert_eq!(VerdictKind::from_code(kind.code()), Some(*kind));
        }
        assert_eq!(VerdictKind::from_code(0), None);
        for outcome in [
            OverlayOutcome::None,
            OverlayOutcome::Live,
            OverlayOutcome::TooLate,
            OverlayOutcome::EndOfLife,
            OverlayOutcome::Disabled,
            OverlayOutcome::HookFailed,
        ] {
            assert_eq!(OverlayOutcome::from_code(outcome.code()), Some(outcome));
        }
        for launch in [
            LaunchKind::Match,
            LaunchKind::Replay,
            LaunchKind::Spectator,
            LaunchKind::Pbe,
        ] {
            assert_eq!(LaunchKind::from_code(launch.code()), Some(launch));
        }
        for scan in [ScanMode::Eager, ScanMode::Lazy] {
            assert_eq!(ScanMode::from_code(scan.code()), Some(scan));
        }
        for confidence in [Confidence::Lead, Confidence::Likely, Confidence::Confirmed] {
            assert_eq!(Confidence::from_code(confidence.code()), Some(confidence));
        }
    }

    #[test]
    fn an_inferred_row_caps_any_confidence_at_a_lead() {
        assert_eq!(
            Confidence::Confirmed.capped_by(EvidenceMark::Inferred),
            Confidence::Lead
        );
        assert_eq!(
            Confidence::Likely.capped_by(EvidenceMark::Inferred),
            Confidence::Lead
        );
        assert_eq!(
            Confidence::Confirmed.capped_by(EvidenceMark::Confirmed),
            Confidence::Confirmed
        );
    }

    #[test]
    fn a_verdict_carries_at_most_two_hints() {
        let verdict = Verdict::new(VerdictKind::Unmodded, "t", "c")
            .with_hint("one")
            .with_hint("two")
            .with_hint("three");
        assert_eq!(verdict.hints, ["one", "two"]);
    }

    #[test]
    fn the_clock_reads_minutes_and_tenths() {
        assert_eq!(clock(0.0), "00:00.0");
        assert_eq!(clock(12.34), "00:12.3");
        assert_eq!(clock(75.0), "01:15.0");
        assert_eq!(clock(600.06), "10:00.1");
    }

    #[test]
    fn a_log_line_drops_its_header_for_the_message() {
        let row = |line: &str| Evidence {
            at: String::new(),
            source: EvidenceSource::Game,
            line: line.to_string(),
            code: None,
        };
        assert_eq!(
            row("000012.344|  ERROR| ALE-9B39AA45 FATAL ERROR. Missing data: 0x1").message(),
            "ALE-9B39AA45 FATAL ERROR. Missing data: 0x1"
        );
        assert_eq!(
            row("000012.301| ALWAYS|  LOAD| SEJ-9F31B5D0").message(),
            "SEJ-9F31B5D0"
        );
        assert_eq!(
            row("000008.543| ALWAYS| r3dRenderLayer::Close() exit").message(),
            "r3dRenderLayer::Close() exit"
        );
        assert_eq!(row("injected, pid 18232").message(), "injected, pid 18232");
        assert!(row("000012.344|  ERROR| >>> boom").is_error_level());
        assert!(!row("000012.344|   WARN| >>> meh").is_error_level());
        assert_eq!(
            row("x Missing data: 0x1a2b3c4d5e6f7081").missing_data_hash(),
            Some(0x1a2b3c4d5e6f7081)
        );
    }

    #[test]
    fn a_path_is_placed_by_its_first_segments() {
        assert_eq!(
            PathHome::of("ASSETS/Characters/Aatrox/Skins/Base/x.dds"),
            PathHome::Champion("aatrox".to_string())
        );
        assert_eq!(
            PathHome::of(r"data\maps\shipping\map11\x.bin"),
            PathHome::Map
        );
        assert_eq!(PathHome::of("assets/shared/x.dds"), PathHome::Unknown);
        assert_eq!(PathHome::of("ux/x.dds"), PathHome::Unknown);
    }

    #[test]
    fn the_dll_detail_splits_into_archive_and_reason() {
        assert_eq!(
            parse_wad_detail("wad DATA/FINAL/Champions/Aatrox.wad.client: file would not open"),
            (
                Some("Aatrox.wad.client".to_string()),
                Some("file would not open".to_string())
            )
        );
        assert_eq!(
            parse_wad_detail("Aatrox.wad.client"),
            (Some("Aatrox.wad.client".to_string()), None)
        );
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
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
                title: "Missing data".to_string(),
                cause: "League stopped a read it could not finish. The file is assets/characters/aatrox/skins/skin12/aatrox_skin12_tx_cm.dds.".to_string(),
                subject: Some("aatrox_skin12_tx_cm.dds".to_string()),
                confidence: Some(Confidence::Likely),
                hints: vec![hint::DISABLE_SUSPECT.to_string()],
            },
            evidence: vec![
                plain("00:12.4", EvidenceSource::Client, "Interrupt, exit code -1073741819"),
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
                confidence: Confidence::Likely,
            }],
            dismissed: false,
        }
    }
}
