//! The incident token: the incident folded into one short string.
//!
//! `DIAG1-` and then `base64url` with no padding over a MessagePack record.
//! Every field of the record is optional, so a decoder reads a token from a
//! newer manager and skips what it does not know. The digit in the prefix is
//! the format's version, and it moves only when a key changes its meaning.
//!
//! The record on the wire is `Wire`, a private mirror of [`IncidentToken`]
//! with one-letter keys and every default left out, because the budget is a
//! chat message and the keys would be most of it. [`IncidentToken`] is what
//! the encoder builds from an incident, and [`DecodedIncident`] is a token
//! read against this build's tables, which is what a reader sees.

use std::sync::LazyLock;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::binary_id::BinaryId;
use super::incident::{
    ClientReason, Consequence, Ending, EvidenceCode, GamePhase, Incident, LaunchKind, OriginKind,
    OverlayOutcome, ScanMode, ScanStatus, SkippedArchive, VerdictKind,
};

/// The format's name, which opens every token.
pub const FORMAT: &str = "DIAG";

/// The format's version. It moves when a key on the wire changes its
/// meaning, and never for a key added.
pub const VERSION: u32 = 1;

/// The format and its version, as every token this build writes opens.
pub const PREFIX: &str = "DIAG1-";

/// The longest token the encoder writes.
pub const MAX_CHARS: usize = 1000;

/// Codes past this many are dropped first when a token runs long.
pub const MAX_CODES: usize = 10;

/// Suspects past this many are dropped first when a token runs long.
pub const MAX_SUSPECTS: usize = 4;

/// A suspect's display name is cut to this many characters.
const NAME_CHARS: usize = 32;

/// A failure message, or the DLL's detail, is cut to this many characters.
const DETAIL_CHARS: usize = 120;

/// A reason the client sent is cut to this many characters.
const REASON_CHARS: usize = 32;

/// The DLL's reason for skipping an archive is cut to this many characters.
const WHY_CHARS: usize = 64;

/// A token body longer than this is refused unread, whatever it claims to be.
const MAX_BODY_CHARS: usize = 16 * 1024;

/// Why a token did not decode.
#[derive(Debug, Error)]
pub enum TokenError {
    #[error("Not an incident token.")]
    WrongPrefix,
    #[error("This token is from a newer LTK Manager, format {FORMAT}{0}. Update to read it.")]
    NewerVersion(u32),
    #[error("The token is too long to be one.")]
    TooLong,
    #[error("The token is damaged, and does not read as base64url.")]
    Base64,
    #[error("The token is damaged, and its record did not decode: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
}

/// The incident, as the token carries it: numbers for the enums, names for
/// the mods, and no path on disk.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IncidentToken {
    /// Minutes since the Unix epoch, or zero when the incident's stamp did
    /// not parse.
    pub ended_at: u32,
    pub manager: [u16; 3],
    pub game: Option<[u16; 4]>,
    pub verdict: u8,
    pub origin: u8,
    pub overlay: u8,
    pub scan: Option<u8>,
    pub launch: u8,
    pub injected: bool,
    pub host_elevated: bool,
    pub phase: u8,
    pub exit_reason: Option<String>,
    pub exit_code: Option<i64>,
    pub crashed: Option<bool>,
    pub duration_secs: Option<u32>,
    /// The codes seen, newest first, as their own strings, so a token reads
    /// against any version of the table. The load steps are left out, because
    /// `last_load_step` carries the one that matters.
    pub codes: Vec<String>,
    pub last_load_step: Option<u8>,
    /// The missing-data hash, as sixteen hex digits.
    pub missing_hash: Option<String>,
    /// The archive the verdict is about, when it is about one.
    pub subject: Option<String>,
    /// The suspects' display names, cut to 32 characters.
    pub suspects: Vec<String>,
    pub skipped: Vec<SkippedArchive>,
    pub redirected_count: u16,
    pub enabled_count: u16,
    /// The hook DLL that ran, by its checksum and build date.
    pub dll: Option<BinaryId>,
    /// The injection host that ran.
    pub host: Option<BinaryId>,
    /// Whether both binaries are the ones the sender's manager build shipped.
    pub patcher_ok: Option<bool>,
    /// The status code the scan reported, as it reported it.
    pub scan_status: Option<String>,
    /// The builder's or the host's own words, for a session that failed
    /// before any game, with every path on disk cut to its file name.
    pub failure: Option<String>,
    /// The DLL's word on an overlay that did not go live.
    pub overlay_detail: Option<String>,
}

impl IncidentToken {
    /// The token's record for `incident`, with the text taken out.
    pub fn from_incident(incident: &Incident, manager_version: &str) -> Self {
        let ended_at = DateTime::parse_from_rfc3339(&incident.ended_at)
            .ok()
            .and_then(|at| u32::try_from(at.timestamp() / 60).ok())
            .unwrap_or_default();

        // The evidence is newest first, so the first step seen is the last
        // one written, and the code the verdict rests on survives the cut.
        let mut codes: Vec<String> = Vec::new();
        let mut last_load_step = None;
        for code in incident.evidence.iter().filter_map(|row| row.code.as_ref()) {
            match code
                .kind
                .as_deref()
                .and_then(|kind| kind.strip_prefix("load_step:"))
            {
                Some(step) => {
                    if last_load_step.is_none() {
                        last_load_step = step.parse().ok();
                    }
                }
                None if !codes.contains(&code.id) => codes.push(code.id.clone()),
                None => {}
            }
        }

        let missing_hash = incident
            .evidence
            .iter()
            .find_map(|row| row.missing_data_hash())
            .map(|hash| format!("{hash:016x}"));
        let scan_status = incident
            .evidence
            .iter()
            .find_map(|row| ScanStatus::code_in_evidence_line(&row.line))
            .map(str::to_string);
        let overlay_detail = matches!(
            incident.overlay,
            OverlayOutcome::EndOfLife | OverlayOutcome::Disabled | OverlayOutcome::HookFailed
        )
        .then(|| incident.overlay_detail.as_deref())
        .flatten()
        .map(|detail| cut(&without_paths(detail), DETAIL_CHARS));

        Self {
            ended_at,
            manager: version_numbers(manager_version),
            game: incident
                .game
                .as_ref()
                .filter(|game| !game.version.is_empty())
                .map(|game| version_numbers(&game.version)),
            verdict: incident.verdict.kind.code(),
            origin: OriginKind::of(&incident.origin).code(),
            overlay: incident.overlay.code(),
            scan: incident.scan.map(ScanMode::code),
            launch: incident.launch.code(),
            injected: incident.injected,
            host_elevated: incident.host_elevated,
            phase: incident.phase.code(),
            exit_reason: incident
                .ending
                .exit_reason
                .as_deref()
                .map(|reason| cut(reason, REASON_CHARS)),
            exit_code: incident.ending.exit_code,
            crashed: incident.ending.crashed,
            duration_secs: incident.duration_secs(),
            codes,
            last_load_step,
            missing_hash,
            subject: incident.archives().into_iter().next(),
            suspects: incident
                .suspects
                .iter()
                .map(|suspect| cut(&suspect.display_name, NAME_CHARS))
                .collect(),
            skipped: incident
                .skipped
                .iter()
                .map(|skipped| SkippedArchive {
                    wad: skipped.wad.clone(),
                    why: cut(&without_paths(&skipped.why), WHY_CHARS),
                })
                .collect(),
            redirected_count: saturate(incident.redirected.len()),
            enabled_count: incident.enabled_count,
            dll: incident.patcher.dll.clone(),
            host: incident.patcher.host.clone(),
            patcher_ok: incident.patcher.matches_bundle,
            scan_status,
            failure: incident
                .failure
                .as_ref()
                .map(|failure| cut(&without_paths(&failure.summary()), DETAIL_CHARS)),
            overlay_detail,
        }
    }

    /// The record as a string, `DIAG1-` and the rest. Under a thousand
    /// characters: codes past the tenth and suspects past the fourth go
    /// first, then the skipped archives, the details, and last the codes and
    /// the suspects altogether.
    pub fn encode(&self) -> String {
        let mut wire = Wire::from(self);
        wire.codes.truncate(MAX_CODES);
        wire.suspects.truncate(MAX_SUSPECTS);
        let mut text = wire.pack();

        let trims: [fn(&mut Wire); 4] = [
            |wire| {
                wire.skipped.truncate(MAX_SUSPECTS);
                for (_, why) in wire.skipped.iter_mut().skip(1) {
                    why.clear();
                }
            },
            |wire| {
                wire.skipped.clear();
                wire.overlay_detail = None;
            },
            |wire| wire.failure = None,
            |wire| {
                wire.codes.clear();
                wire.suspects.clear();
                wire.exit_reason = None;
            },
        ];
        for trim in trims {
            if text.len() <= MAX_CHARS {
                break;
            }
            trim(&mut wire);
            text = wire.pack();
        }
        text
    }

    /// The record a token carries.
    ///
    /// Surrounding whitespace, a trailing full stop or comma, and backticks
    /// around the token are ignored, because a chat client adds them.
    ///
    /// # Errors
    ///
    /// The prefix is not the format's, or names a version newer than this
    /// build's, or the body is too long, not `base64url`, or not the record.
    pub fn decode(token: &str) -> Result<Self, TokenError> {
        let token = token.trim().trim_end_matches(['.', ',']).trim_matches('`');
        let body = body_of(token)?;
        if body.len() > MAX_BODY_CHARS {
            return Err(TokenError::TooLong);
        }
        let packed = URL_SAFE_NO_PAD
            .decode(body)
            .map_err(|_| TokenError::Base64)?;
        let wire: Wire = rmp_serde::from_slice(&packed)?;
        Ok(wire.into())
    }

    /// The first token in `text`, which may be a report or a URL with one
    /// inside: the prefix, of any version, and the `base64url` run after it.
    ///
    /// Any version, so a token from a newer manager is found and then refused
    /// by name, rather than reading as no token at all.
    pub fn find_in(text: &str) -> Option<&str> {
        text.match_indices(FORMAT).find_map(|(start, _)| {
            let rest = &text[start + FORMAT.len()..];
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            if digits == 0 || !rest[digits..].starts_with('-') {
                return None;
            }
            let body_start = start + FORMAT.len() + digits + 1;
            let body_len = text[body_start..]
                .bytes()
                .take_while(|b| b.is_ascii_alphanumeric() || *b == b'-' || *b == b'_')
                .count();
            Some(&text[start..body_start + body_len])
        })
    }

    /// The token read against this build's tables.
    pub fn resolve(&self) -> DecodedIncident {
        let verdict = VerdictKind::from_code(self.verdict);
        DecodedIncident {
            ended_at: (self.ended_at != 0)
                .then(|| DateTime::<Utc>::from_timestamp(i64::from(self.ended_at) * 60, 0))
                .flatten()
                .map(|at| at.to_rfc3339()),
            manager: version_text(&self.manager),
            game: self.game.as_ref().map(|game| version_text(game)),
            verdict,
            verdict_code: self.verdict,
            title: verdict.map_or_else(
                || format!("Verdict {}", self.verdict),
                |kind| kind.title().to_string(),
            ),
            consequence: verdict.map(VerdictKind::consequence),
            origin: OriginKind::from_code(self.origin),
            overlay: OverlayOutcome::from_code(self.overlay),
            scan: self.scan.and_then(ScanMode::from_code),
            launch: LaunchKind::from_code(self.launch),
            injected: self.injected,
            host_elevated: self.host_elevated,
            phase: GamePhase::from_code(self.phase),
            ending: Ending {
                exit_reason: self.exit_reason.clone(),
                exit_code: self.exit_code,
                crashed: self.crashed,
            },
            duration_secs: self.duration_secs,
            codes: self
                .codes
                .iter()
                .map(|id| EvidenceCode::from_table(id))
                .collect(),
            last_load_step: self.last_load_step,
            missing_hash: self.missing_hash.clone(),
            subject: self.subject.clone(),
            suspects: self.suspects.clone(),
            skipped: self.skipped.clone(),
            redirected_count: self.redirected_count,
            enabled_count: self.enabled_count,
            dll: self.dll.as_ref().map(DecodedBinary::from),
            host: self.host.as_ref().map(DecodedBinary::from),
            patcher_ok: self.patcher_ok,
            scan_status: self.scan_status.as_deref().map(ScanStatus::parse),
            scan_status_code: self.scan_status.clone(),
            failure: self.failure.clone(),
            overlay_detail: self.overlay_detail.clone(),
        }
    }
}

impl Incident {
    /// This incident as a token.
    pub fn token(&self, manager_version: &str) -> String {
        IncidentToken::from_incident(self, manager_version).encode()
    }
}

/// A token read against this build's tables, for a reader.
///
/// Each enum is `None` for a number this build does not know, with the
/// verdict's number kept beside it, so a token from a newer manager reads as
/// far as it can and never as an error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DecodedIncident {
    /// RFC 3339, UTC, to the minute, or `None` when the token carried no time.
    pub ended_at: Option<String>,
    /// `1.14.0`.
    pub manager: String,
    /// `16.16.804.9184`.
    pub game: Option<String>,
    pub verdict: Option<VerdictKind>,
    /// The verdict's number as the token carries it, for one this build does
    /// not know.
    pub verdict_code: u8,
    /// The verdict's title, or `Verdict 17` for one this build does not know.
    pub title: String,
    pub consequence: Option<Consequence>,
    pub origin: Option<OriginKind>,
    pub overlay: Option<OverlayOutcome>,
    pub scan: Option<ScanMode>,
    pub launch: Option<LaunchKind>,
    pub injected: bool,
    pub host_elevated: bool,
    pub phase: Option<GamePhase>,
    pub ending: Ending,
    pub duration_secs: Option<u32>,
    /// Each code with what this build's table says about it.
    pub codes: Vec<EvidenceCode>,
    pub last_load_step: Option<u8>,
    pub missing_hash: Option<String>,
    pub subject: Option<String>,
    pub suspects: Vec<String>,
    pub skipped: Vec<SkippedArchive>,
    pub redirected_count: u16,
    pub enabled_count: u16,
    /// The hook DLL that ran, with its build date read out.
    pub dll: Option<DecodedBinary>,
    /// The injection host that ran.
    pub host: Option<DecodedBinary>,
    /// Whether both binaries are the ones the sender's manager build shipped.
    pub patcher_ok: Option<bool>,
    pub scan_status: Option<ScanStatus>,
    /// The status code as the scan reported it, beside the reading.
    pub scan_status_code: Option<String>,
    pub failure: Option<String>,
    pub overlay_detail: Option<String>,
}

/// One patcher binary as a decoded token presents it: the checksum, and the
/// build date as a full timestamp.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DecodedBinary {
    pub hash: String,
    /// RFC 3339, UTC, when the build date was a date.
    pub built: Option<String>,
}

impl From<&BinaryId> for DecodedBinary {
    fn from(id: &BinaryId) -> Self {
        Self {
            hash: id.hash.clone(),
            built: id.built_rfc3339(),
        }
    }
}

/// The body after the prefix, once the version in the prefix is this build's.
fn body_of(token: &str) -> Result<&str, TokenError> {
    let rest = token.strip_prefix(FORMAT).ok_or(TokenError::WrongPrefix)?;
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    let version: u32 = rest[..digits]
        .parse()
        .map_err(|_| TokenError::WrongPrefix)?;
    let body = rest[digits..]
        .strip_prefix('-')
        .ok_or(TokenError::WrongPrefix)?;
    if version > VERSION {
        return Err(TokenError::NewerVersion(version));
    }
    if version < VERSION {
        return Err(TokenError::WrongPrefix);
    }
    Ok(body)
}

/// The record on the wire. One-letter keys, defaults left out, and the hash
/// as a number.
///
/// A key, once given, is never reused for another meaning. `a`, `c`, `e`,
/// `f` and `K` were used before the first release and stay off the table.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct Wire {
    #[serde(rename = "t", skip_serializing_if = "is_default")]
    ended_at: u32,
    #[serde(rename = "m", skip_serializing_if = "is_default")]
    manager: [u16; 3],
    #[serde(rename = "g", skip_serializing_if = "Option::is_none")]
    game: Option<[u16; 4]>,
    #[serde(rename = "v", skip_serializing_if = "is_default")]
    verdict: u8,
    #[serde(rename = "O", skip_serializing_if = "is_default")]
    origin: u8,
    #[serde(rename = "o", skip_serializing_if = "is_default")]
    overlay: u8,
    #[serde(rename = "s", skip_serializing_if = "Option::is_none")]
    scan: Option<u8>,
    #[serde(rename = "l", skip_serializing_if = "is_default")]
    launch: u8,
    #[serde(rename = "i", skip_serializing_if = "is_default")]
    injected: bool,
    #[serde(rename = "H", skip_serializing_if = "is_default")]
    host_elevated: bool,
    #[serde(rename = "P", skip_serializing_if = "is_default")]
    phase: u8,
    #[serde(rename = "r", skip_serializing_if = "Option::is_none")]
    exit_reason: Option<Reason>,
    #[serde(rename = "x", skip_serializing_if = "Option::is_none")]
    exit_code: Option<i64>,
    #[serde(rename = "k", skip_serializing_if = "Option::is_none")]
    crashed: Option<bool>,
    #[serde(rename = "d", skip_serializing_if = "Option::is_none")]
    duration_secs: Option<u32>,
    #[serde(rename = "C", skip_serializing_if = "Vec::is_empty")]
    codes: Vec<String>,
    #[serde(rename = "p", skip_serializing_if = "Option::is_none")]
    last_load_step: Option<u8>,
    #[serde(rename = "h", skip_serializing_if = "Option::is_none")]
    missing_hash: Option<u64>,
    #[serde(rename = "u", skip_serializing_if = "Option::is_none")]
    subject: Option<String>,
    #[serde(rename = "S", skip_serializing_if = "Vec::is_empty")]
    suspects: Vec<String>,
    #[serde(rename = "n", skip_serializing_if = "Vec::is_empty")]
    skipped: Vec<(String, String)>,
    #[serde(rename = "R", skip_serializing_if = "is_default")]
    redirected_count: u16,
    #[serde(rename = "E", skip_serializing_if = "is_default")]
    enabled_count: u16,
    #[serde(rename = "B", skip_serializing_if = "Option::is_none")]
    dll_hash: Option<String>,
    #[serde(rename = "b", skip_serializing_if = "Option::is_none")]
    dll_built: Option<u32>,
    #[serde(rename = "W", skip_serializing_if = "Option::is_none")]
    host_hash: Option<String>,
    #[serde(rename = "w", skip_serializing_if = "Option::is_none")]
    host_built: Option<u32>,
    #[serde(rename = "Q", skip_serializing_if = "Option::is_none")]
    patcher_ok: Option<bool>,
    #[serde(rename = "y", skip_serializing_if = "Option::is_none")]
    scan_status: Option<String>,
    #[serde(rename = "F", skip_serializing_if = "Option::is_none")]
    failure: Option<String>,
    #[serde(rename = "D", skip_serializing_if = "Option::is_none")]
    overlay_detail: Option<String>,
}

/// The client's reason: a number for the four it sends, and the string for a
/// spelling the crate does not know.
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum Reason {
    Known(u8),
    Other(String),
}

impl Reason {
    /// A known spelling rides as its [`ClientReason`] number, so the four the
    /// client sends cost one byte, and any other spelling rides whole.
    fn from_text(text: &str) -> Self {
        match ClientReason::parse(text) {
            Some(reason) => Self::Known(reason.code()),
            None => Self::Other(text.to_string()),
        }
    }

    fn into_text(self) -> String {
        match self {
            Self::Known(number) => ClientReason::from_code(number).map_or_else(
                || format!("reason {number}"),
                |reason| reason.as_str().to_string(),
            ),
            Self::Other(text) => text,
        }
    }
}

/// Nearly every archive is `<name>.wad.client`, so the wire drops the suffix
/// and the decoder puts it back on a name that carries no `.wad` of its own.
const ARCHIVE_SUFFIX: &str = ".wad.client";

fn fold_archive(name: &str) -> String {
    name.strip_suffix(ARCHIVE_SUFFIX)
        .unwrap_or(name)
        .to_string()
}

fn unfold_archive(name: String) -> String {
    if name.to_ascii_lowercase().contains(".wad") {
        name
    } else {
        format!("{name}{ARCHIVE_SUFFIX}")
    }
}

impl Wire {
    fn pack(&self) -> String {
        let packed = rmp_serde::to_vec_named(self).expect("a token record serializes");
        format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(packed))
    }
}

impl From<&IncidentToken> for Wire {
    fn from(token: &IncidentToken) -> Self {
        Self {
            ended_at: token.ended_at,
            manager: token.manager,
            game: token.game,
            verdict: token.verdict,
            origin: token.origin,
            overlay: token.overlay,
            scan: token.scan,
            launch: token.launch,
            injected: token.injected,
            host_elevated: token.host_elevated,
            phase: token.phase,
            exit_reason: token.exit_reason.as_deref().map(Reason::from_text),
            exit_code: token.exit_code,
            crashed: token.crashed,
            duration_secs: token.duration_secs,
            codes: token.codes.clone(),
            last_load_step: token.last_load_step,
            missing_hash: token
                .missing_hash
                .as_deref()
                .and_then(|hash| u64::from_str_radix(hash, 16).ok()),
            subject: token.subject.as_deref().map(fold_archive),
            suspects: token.suspects.clone(),
            skipped: token
                .skipped
                .iter()
                .map(|skipped| (fold_archive(&skipped.wad), skipped.why.clone()))
                .collect(),
            redirected_count: token.redirected_count,
            enabled_count: token.enabled_count,
            dll_hash: token.dll.as_ref().map(|id| id.hash.clone()),
            dll_built: token.dll.as_ref().and_then(|id| id.built),
            host_hash: token.host.as_ref().map(|id| id.hash.clone()),
            host_built: token.host.as_ref().and_then(|id| id.built),
            patcher_ok: token.patcher_ok,
            scan_status: token.scan_status.clone(),
            failure: token.failure.clone(),
            overlay_detail: token.overlay_detail.clone(),
        }
    }
}

impl From<Wire> for IncidentToken {
    fn from(wire: Wire) -> Self {
        Self {
            ended_at: wire.ended_at,
            manager: wire.manager,
            game: wire.game,
            verdict: wire.verdict,
            origin: wire.origin,
            overlay: wire.overlay,
            scan: wire.scan,
            launch: wire.launch,
            injected: wire.injected,
            host_elevated: wire.host_elevated,
            phase: wire.phase,
            exit_reason: wire.exit_reason.map(Reason::into_text),
            exit_code: wire.exit_code,
            crashed: wire.crashed,
            duration_secs: wire.duration_secs,
            codes: wire.codes,
            last_load_step: wire.last_load_step,
            missing_hash: wire.missing_hash.map(|hash| format!("{hash:016x}")),
            subject: wire.subject.map(unfold_archive),
            suspects: wire.suspects,
            skipped: wire
                .skipped
                .into_iter()
                .map(|(wad, why)| SkippedArchive {
                    wad: unfold_archive(wad),
                    why,
                })
                .collect(),
            redirected_count: wire.redirected_count,
            enabled_count: wire.enabled_count,
            dll: wire.dll_hash.map(|hash| BinaryId {
                hash,
                built: wire.dll_built,
            }),
            host: wire.host_hash.map(|hash| BinaryId {
                hash,
                built: wire.host_built,
            }),
            patcher_ok: wire.patcher_ok,
            scan_status: wire.scan_status,
            failure: wire.failure,
            overlay_detail: wire.overlay_detail,
        }
    }
}

/// A path on disk, as the patcher's messages quote one. Greedy to a colon, a
/// quote or the end of the line, so a directory with a space in its name is
/// taken whole.
static DISK_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"[A-Za-z]:[\\/][^:"'<>|\r\n]*"#).expect("a valid path pattern"));

/// `text` with every path on disk cut to its last segment, so a message keeps
/// the file it names and drops the directories above it.
fn without_paths(text: &str) -> String {
    DISK_PATH
        .replace_all(text, |found: &regex::Captures<'_>| {
            let path = found[0].trim_end_matches(['\\', '/']);
            path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
        })
        .into_owned()
}

fn is_default<T: Default + PartialEq>(value: &T) -> bool {
    *value == T::default()
}

/// `1.14.0` as `[1, 14, 0]`. A component that is not a number is zero, and a
/// missing one too.
fn version_numbers<const N: usize>(text: &str) -> [u16; N] {
    let mut numbers = [0u16; N];
    let components = text.trim().trim_start_matches(['v', 'V']).split('.');
    for (slot, component) in numbers.iter_mut().zip(components) {
        let digits: String = component.chars().take_while(char::is_ascii_digit).collect();
        *slot = digits.parse::<u32>().map_or(0, saturate_u32);
    }
    numbers
}

/// `[1, 14, 0]` as `1.14.0`.
fn version_text(numbers: &[u16]) -> String {
    numbers
        .iter()
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join(".")
}

fn saturate(count: usize) -> u16 {
    u16::try_from(count).unwrap_or(u16::MAX)
}

fn saturate_u32(value: u32) -> u16 {
    u16::try_from(value).unwrap_or(u16::MAX)
}

fn cut(text: &str, chars: usize) -> String {
    text.chars().take(chars).collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde::de::IgnoredAny;

    use super::*;
    use crate::diagnostics::incident::{Evidence, EvidenceSource, SessionFailure, fixtures};
    use crate::error::ErrorKind;
    use crate::patcher::{InjectionStage, SessionOrigin};

    fn sample() -> IncidentToken {
        IncidentToken::from_incident(
            &fixtures::incident("2026-08-21T21-14-02", "2026-08-21T21:14:02+00:00"),
            "1.14.0",
        )
    }

    fn full() -> IncidentToken {
        IncidentToken {
            ended_at: 1,
            manager: [1, 2, 3],
            game: Some([4, 5, 6, 7]),
            verdict: 11,
            origin: 2,
            overlay: 5,
            scan: Some(2),
            launch: 4,
            injected: true,
            host_elevated: true,
            phase: 3,
            exit_reason: Some("Timeout".to_string()),
            exit_code: Some(-1),
            crashed: Some(false),
            duration_secs: Some(90),
            codes: vec!["SEJ-9Z6Y34B0".to_string(), "ALE-89b0dee7".to_string()],
            last_load_step: Some(62),
            missing_hash: Some("00000000deadbeef".to_string()),
            subject: Some("Map11.wad.client".to_string()),
            suspects: vec!["Classic Rift".to_string()],
            skipped: vec![SkippedArchive {
                wad: "Ahri.wad.client".to_string(),
                why: "mount modded wad: invalid signature".to_string(),
            }],
            redirected_count: 9,
            enabled_count: 12,
            dll: Some(BinaryId {
                hash: "a150130f1a90dcc2".to_string(),
                built: Some(0x6A83_01AB),
            }),
            host: Some(BinaryId {
                hash: "cc714b6990a29678".to_string(),
                built: Some(0x6A83_01D1),
            }),
            patcher_ok: Some(false),
            scan_status: Some("c000003e".to_string()),
            failure: Some("DLL never attached after 60s.".to_string()),
            overlay_detail: Some("hook CreateFileW".to_string()),
        }
    }

    fn packed(token: &str) -> Vec<u8> {
        URL_SAFE_NO_PAD
            .decode(token.strip_prefix(PREFIX).unwrap())
            .unwrap()
    }

    /// Pinned so a script can be checked against it, and so a change to a
    /// key, a type or the order of the record moves a test and not a reader.
    const VECTOR: &str = "DIAG1-3gAaoXTOAcaLuqFtkwEOAKFnlBAQzQMkzSPgoXYGoU8BoW8BoXMBoWwBoWnDoVABoXICoXjSwAAABaFrw6FkDKFDkaxBTEUtOUIzOUFBNDWhcDShaM8aKzxNXm9wgaF1pkFhdHJveKFTka9BYXRyb3ggSnVzdGljYXKhUgShRQShQrBhMTUwMTMwZjFhOTBkY2MyoWLOaoMBq6FXsGNjNzE0YjY5OTBhMjk2Nzihd85qgwHRoVHD";

    /// Every key the record has, in the order the struct gives them.
    const KEYS: &str = "t m g v O o s l i H P r x k d C p h u S n R E B b W w Q y F D";

    #[test]
    fn the_prefix_is_the_format_and_its_version() {
        assert_eq!(PREFIX, format!("{FORMAT}{VERSION}-"));
    }

    #[test]
    fn the_sample_reads_the_incident() {
        let token = sample();
        assert_eq!(token.ended_at, 29_789_114);
        assert_eq!(token.manager, [1, 14, 0]);
        assert_eq!(token.game, Some([16, 16, 804, 9184]));
        assert_eq!(token.verdict, VerdictKind::MissingData.code());
        assert_eq!(token.origin, OriginKind::Library.code());
        assert_eq!(token.overlay, OverlayOutcome::Live.code());
        assert_eq!(token.scan, Some(ScanMode::Eager.code()));
        assert_eq!(token.launch, LaunchKind::Match.code());
        assert!(token.injected);
        assert!(!token.host_elevated);
        assert_eq!(token.phase, GamePhase::Loading.code());
        assert_eq!(token.exit_reason.as_deref(), Some("Interrupt"));
        assert_eq!(token.exit_code, Some(-1073741819));
        assert_eq!(token.crashed, Some(true));
        assert_eq!(token.duration_secs, Some(12));
        assert_eq!(token.codes, ["ALE-9B39AA45"]);
        assert_eq!(token.last_load_step, Some(52));
        assert_eq!(token.missing_hash.as_deref(), Some("1a2b3c4d5e6f7081"));
        assert_eq!(token.subject.as_deref(), Some("Aatrox.wad.client"));
        assert_eq!(token.suspects, ["Aatrox Justicar"]);
        assert!(token.skipped.is_empty());
        assert_eq!(token.redirected_count, 4);
        assert_eq!(token.enabled_count, 4);
        assert_eq!(
            token.dll.as_ref().map(|id| id.hash.as_str()),
            Some("a150130f1a90dcc2")
        );
        assert_eq!(
            token.dll.as_ref().and_then(|id| id.built),
            Some(0x6A83_01AB)
        );
        assert_eq!(
            token.host.as_ref().map(|id| id.hash.as_str()),
            Some("cc714b6990a29678")
        );
        assert_eq!(token.patcher_ok, Some(true));
        assert_eq!(token.scan_status, None);
        assert_eq!(token.failure, None);
        assert_eq!(token.overlay_detail, None);
    }

    #[test]
    fn a_token_round_trips() {
        let token = sample();
        let decoded = IncidentToken::decode(&token.encode()).unwrap();
        assert_eq!(decoded, token);
    }

    #[test]
    fn every_field_round_trips() {
        let token = full();
        assert_eq!(IncidentToken::decode(&token.encode()).unwrap(), token);
    }

    #[test]
    fn the_test_vector_holds() {
        let encoded = sample().encode();
        assert_eq!(encoded, VECTOR);
        assert_eq!(IncidentToken::decode(VECTOR).unwrap(), sample());
    }

    #[test]
    fn the_wire_keys_are_pinned() {
        let keys: BTreeMap<String, IgnoredAny> =
            rmp_serde::from_slice(&packed(&full().encode())).unwrap();
        let mut expected: Vec<&str> = KEYS.split(' ').collect();
        expected.sort_unstable();
        let found: Vec<&str> = keys.keys().map(String::as_str).collect();
        assert_eq!(found, expected);
    }

    #[test]
    fn a_typical_token_is_short() {
        let encoded = sample().encode();
        assert!(encoded.len() < 300, "{} chars: {encoded}", encoded.len());
    }

    /// Ten codes and four suspects, as a game that went badly wrong writes
    /// them, without a compressor to lean on.
    #[test]
    fn a_bad_token_stays_under_six_hundred() {
        let mut token = sample();
        token.codes = [
            "ALE-9B39AA45",
            "ALE-18967993",
            "SEJ-5F4B27D8",
            "ALE-D0D00009",
            "ALE-1892F739",
            "SEJ-1A4F7C20",
            "ALE-89B0DEE7",
            "ALE-8SDFH23F",
            "SEJ-9F31B5D0",
            "ALE-4C21E0A7",
        ]
        .map(String::from)
        .to_vec();
        token.suspects = [
            "Aatrox Justicar",
            "Project Ashe Chromas",
            "Summoner's Rift Reworked",
            "Dark Cosmic Jhin Voice",
        ]
        .map(String::from)
        .to_vec();
        token.exit_reason = Some("SomethingTheCrateDoesNotKnow".to_string());
        let encoded = token.encode();
        assert!(encoded.len() < 600, "{} chars: {encoded}", encoded.len());
    }

    /// The session-failure verdicts carry a message and nothing from a game.
    #[test]
    fn a_failure_token_stays_under_four_hundred() {
        let mut token = sample();
        token.codes.clear();
        token.suspects.clear();
        token.game = None;
        token.missing_hash = None;
        token.subject = None;
        token.failure = Some("x".repeat(DETAIL_CHARS));
        let encoded = token.encode();
        assert!(encoded.len() < 400, "{} chars: {encoded}", encoded.len());
    }

    #[test]
    fn the_cap_holds_under_absurd_input() {
        let mut token = sample();
        token.codes = (0..500).map(|n| format!("ALE-{n:08}")).collect();
        token.suspects = (0..200).map(|n| "x".repeat(32 + n % 3)).collect();
        token.skipped = (0..300)
            .map(|n| SkippedArchive {
                wad: format!("Skipped{n}.wad.client"),
                why: "y".repeat(WHY_CHARS),
            })
            .collect();
        token.failure = Some("z".repeat(DETAIL_CHARS));
        token.overlay_detail = Some("w".repeat(DETAIL_CHARS));
        let encoded = token.encode();
        assert!(encoded.len() <= MAX_CHARS, "{} chars", encoded.len());
        let decoded = IncidentToken::decode(&encoded).unwrap();
        assert_eq!(decoded.verdict, token.verdict);
        assert!(decoded.codes.len() <= MAX_CODES);
        assert!(decoded.suspects.len() <= MAX_SUSPECTS);
    }

    #[test]
    fn chat_punctuation_around_a_token_is_ignored() {
        let encoded = sample().encode();
        let pasted = format!("  `{encoded}`. ");
        assert_eq!(IncidentToken::decode(&pasted).unwrap(), sample());
    }

    #[test]
    fn a_wrong_prefix_is_refused() {
        for text in [
            "hello",
            "DIAG-abc",
            "DIAG0-abc",
            "DIAGx1-abc",
            "LTK1-abc",
            "",
        ] {
            assert!(
                matches!(IncidentToken::decode(text), Err(TokenError::WrongPrefix)),
                "{text:?}"
            );
        }
    }

    #[test]
    fn a_newer_version_is_refused_by_name() {
        let error = IncidentToken::decode("DIAG2-abc").unwrap_err();
        assert!(matches!(error, TokenError::NewerVersion(2)));
        assert!(error.to_string().contains("DIAG2"), "{error}");
        assert!(matches!(
            IncidentToken::decode("DIAG12-abc"),
            Err(TokenError::NewerVersion(12))
        ));
    }

    #[test]
    fn bad_base64_is_refused() {
        assert!(matches!(
            IncidentToken::decode(&format!("{PREFIX}not*base64!")),
            Err(TokenError::Base64)
        ));
    }

    #[test]
    fn an_absurd_length_is_refused_unread() {
        let long = format!("{PREFIX}{}", "A".repeat(MAX_BODY_CHARS + 1));
        assert!(matches!(
            IncidentToken::decode(&long),
            Err(TokenError::TooLong)
        ));
    }

    #[test]
    fn garbage_inside_is_refused() {
        let not_msgpack = format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(b"\xc1"));
        assert!(matches!(
            IncidentToken::decode(&not_msgpack),
            Err(TokenError::Decode(_))
        ));
    }

    #[test]
    fn a_token_from_a_newer_manager_decodes_as_far_as_it_can() {
        #[derive(Serialize)]
        struct Newer {
            v: u8,
            #[serde(rename = "S")]
            suspects: Vec<String>,
            zz: String,
            zy: Vec<u32>,
        }
        let newer = Newer {
            v: 99,
            suspects: vec!["Aatrox Justicar".to_string()],
            zz: "a field this build does not know".to_string(),
            zy: vec![1, 2, 3],
        };
        let token = format!(
            "{PREFIX}{}",
            URL_SAFE_NO_PAD.encode(rmp_serde::to_vec_named(&newer).unwrap())
        );
        let decoded = IncidentToken::decode(&token).unwrap();
        assert_eq!(decoded.verdict, 99);
        assert_eq!(decoded.suspects, ["Aatrox Justicar"]);
        assert_eq!(decoded.manager, [0, 0, 0]);

        let resolved = decoded.resolve();
        assert_eq!(resolved.verdict, None);
        assert_eq!(resolved.verdict_code, 99);
        assert_eq!(resolved.title, "Verdict 99");
        assert_eq!(resolved.consequence, None);
        assert_eq!(resolved.ended_at, None);
        assert_eq!(resolved.origin, None);
    }

    #[test]
    fn an_unknown_reason_and_an_odd_archive_name_survive_the_wire() {
        let mut token = sample();
        token.exit_reason = Some("Bespoke".to_string());
        token.subject = Some("Aatrox.en_US.wad.client".to_string());
        token.skipped = vec![SkippedArchive {
            wad: "odd.wad".to_string(),
            why: String::new(),
        }];
        assert_eq!(IncidentToken::decode(&token.encode()).unwrap(), token);
    }

    #[test]
    fn versions_parse_leniently() {
        assert_eq!(version_numbers::<3>("1.14.0"), [1, 14, 0]);
        assert_eq!(version_numbers::<3>("v2.0.1-beta.3"), [2, 0, 1]);
        assert_eq!(version_numbers::<3>("garbage"), [0, 0, 0]);
        assert_eq!(version_numbers::<4>("16.16.804.9184"), [16, 16, 804, 9184]);
        assert_eq!(version_numbers::<4>("16.16"), [16, 16, 0, 0]);
        assert_eq!(version_text(&[16, 16, 804, 9184]), "16.16.804.9184");
    }

    #[test]
    fn the_incident_has_a_token_shortcut() {
        let incident = fixtures::incident("2026-08-21T21-14-02", "2026-08-21T21:14:02+00:00");
        assert_eq!(incident.token("1.14.0"), sample().encode());
    }

    #[test]
    fn a_token_is_found_in_a_report_and_in_a_url() {
        let report = "# LTK Manager\nIncident: x\nToken: DIAG1-eNpVjsEK_gz-AQ\n\nVerdict: y";
        assert_eq!(IncidentToken::find_in(report), Some("DIAG1-eNpVjsEK_gz-AQ"));
        let url = "https://example.test/issues/new?diagnostic=DIAG1-eNpVjsEK&labels=bug";
        assert_eq!(IncidentToken::find_in(url), Some("DIAG1-eNpVjsEK"));
        assert_eq!(IncidentToken::find_in("DIAG1-abc"), Some("DIAG1-abc"));
        assert_eq!(IncidentToken::find_in("nothing here"), None);
        assert_eq!(IncidentToken::find_in("DIAGNOSTICS: DIAG-x"), None);
        assert_eq!(
            IncidentToken::find_in("DIAGNOSTICS first, then DIAG1-abc"),
            Some("DIAG1-abc")
        );
    }

    #[test]
    fn a_newer_token_in_a_report_is_found_and_named() {
        let found = IncidentToken::find_in("Token: DIAG3-abc.").unwrap();
        assert_eq!(found, "DIAG3-abc");
        assert!(matches!(
            IncidentToken::decode(found),
            Err(TokenError::NewerVersion(3))
        ));
    }

    #[test]
    fn paths_on_disk_are_cut_to_their_file_name() {
        assert_eq!(
            without_paths(r"could not read C:\Users\someone\mods\x.wad: access denied"),
            "could not read x.wad: access denied"
        );
        assert_eq!(
            without_paths(
                r#"open "C:\Riot Games\League of Legends\Game\League of Legends.exe" failed"#
            ),
            r#"open "League of Legends.exe" failed"#
        );
        assert_eq!(
            without_paths(r"D:/mods/out/x.wad (os error 5)"),
            "x.wad (os error 5)"
        );
        assert_eq!(without_paths(r"wrote D:\mods\out\"), "wrote out");
        assert_eq!(without_paths("no path here: fine"), "no path here: fine");
    }

    #[test]
    fn a_session_failure_rides_in_its_own_words() {
        let mut incident = fixtures::incident("a", "2026-08-21T21:14:02+00:00");
        incident.failure = Some(SessionFailure::Build {
            kind: ErrorKind::Io,
            message: r"could not read C:\Users\someone\mods\x.wad".to_string(),
        });
        let token = IncidentToken::from_incident(&incident, "1.14.0");
        let failure = token.failure.as_deref().unwrap();
        assert!(failure.ends_with("Could not read x.wad."), "{failure}");
        assert!(!failure.contains("someone"), "{failure}");

        incident.failure = Some(SessionFailure::Injection {
            stage: InjectionStage::Injection,
            message: "DLL never attached after 60s".to_string(),
        });
        let token = IncidentToken::from_incident(&incident, "1.14.0");
        assert_eq!(
            token.failure.as_deref(),
            Some("DLL never attached after 60s.")
        );
    }

    #[test]
    fn the_scan_status_and_the_dll_detail_ride_when_they_are_the_story() {
        let mut incident = fixtures::incident("a", "2026-08-21T21:14:02+00:00");
        incident.evidence.push(Evidence {
            at: "00:01.0".to_string(),
            source: EvidenceSource::Dll,
            line: "scan rejected Graves.wad.client, status c0000999".to_string(),
            code: None,
        });
        incident.overlay = OverlayOutcome::HookFailed;
        incident.overlay_detail = Some("hook CreateFileW".to_string());
        incident.origin = SessionOrigin::Workshop {
            projects: vec![r"C:\work\aatrox".to_string()],
        };
        incident.host_elevated = true;
        let token = IncidentToken::from_incident(&incident, "1.14.0");
        assert_eq!(token.scan_status.as_deref(), Some("c0000999"));
        assert_eq!(token.overlay_detail.as_deref(), Some("hook CreateFileW"));
        assert_eq!(token.origin, OriginKind::Workshop.code());
        assert!(token.host_elevated);

        let resolved = token.resolve();
        assert_eq!(resolved.scan_status, Some(ScanStatus::Unknown));
        assert_eq!(resolved.scan_status_code.as_deref(), Some("c0000999"));
        assert_eq!(resolved.origin, Some(OriginKind::Workshop));
        assert_eq!(resolved.overlay, Some(OverlayOutcome::HookFailed));

        // A live overlay has no detail worth a reader's time.
        incident.overlay = OverlayOutcome::Live;
        let token = IncidentToken::from_incident(&incident, "1.14.0");
        assert_eq!(token.overlay_detail, None);
    }

    #[test]
    fn the_sample_resolves_against_the_tables() {
        let resolved = sample().resolve();
        assert_eq!(
            resolved.ended_at.as_deref(),
            Some("2026-08-21T21:14:00+00:00")
        );
        assert_eq!(resolved.manager, "1.14.0");
        assert_eq!(resolved.game.as_deref(), Some("16.16.804.9184"));
        assert_eq!(resolved.verdict, Some(VerdictKind::MissingData));
        assert_eq!(resolved.title, "Missing Game Data");
        assert_eq!(resolved.consequence, Some(Consequence::GameStopped));
        assert_eq!(resolved.origin, Some(OriginKind::Library));
        assert_eq!(resolved.overlay, Some(OverlayOutcome::Live));
        assert_eq!(resolved.scan, Some(ScanMode::Eager));
        assert_eq!(resolved.launch, Some(LaunchKind::Match));
        assert_eq!(resolved.phase, Some(GamePhase::Loading));
        assert_eq!(resolved.ending.exit_code, Some(-1073741819));
        assert_eq!(resolved.codes.len(), 1);
        assert_eq!(resolved.codes[0].id, "ALE-9B39AA45");
        assert_eq!(
            resolved.codes[0].meaning.as_deref(),
            Some("A file the game needed is in no mounted archive")
        );
        assert_eq!(resolved.subject.as_deref(), Some("Aatrox.wad.client"));
        assert_eq!(resolved.scan_status, None);
        let dll = resolved.dll.as_ref().unwrap();
        assert_eq!(dll.hash, "a150130f1a90dcc2");
        assert_eq!(dll.built.as_deref(), Some("2026-08-17T12:42:19+00:00"));
        assert_eq!(resolved.patcher_ok, Some(true));
    }

    #[test]
    fn the_patcher_binaries_ride_and_resolve() {
        let token = full();
        let decoded = IncidentToken::decode(&token.encode()).unwrap();
        assert_eq!(decoded.dll, token.dll);
        assert_eq!(decoded.host, token.host);
        assert_eq!(decoded.patcher_ok, Some(false));

        let resolved = decoded.resolve();
        assert_eq!(resolved.dll.as_ref().unwrap().hash, "a150130f1a90dcc2");
        assert_eq!(
            resolved.host.as_ref().unwrap().built.as_deref(),
            Some("2026-08-17T12:42:57+00:00")
        );
        assert_eq!(resolved.patcher_ok, Some(false));
    }

    #[test]
    fn a_token_without_patcher_binaries_omits_them() {
        let mut token = sample();
        token.dll = None;
        token.host = None;
        token.patcher_ok = None;
        let decoded = IncidentToken::decode(&token.encode()).unwrap();
        assert_eq!(decoded.dll, None);
        assert_eq!(decoded.host, None);
        assert_eq!(decoded.patcher_ok, None);
    }
}
