//! The incident token: the incident folded into one short string.
//!
//! `LTK1-` and then `base64url` with no padding over a deflated MessagePack
//! record. Every field of the record is optional, so a decoder reads a token
//! from a newer manager and skips what it does not know.
//!
//! The record on the wire is `Wire`, a private mirror of [`IncidentToken`]
//! with one-letter keys and every default left out, because the budget is a
//! chat message and the keys would be most of it. [`IncidentToken`] is what
//! the application sees, and its names do not change the wire.

use std::io::{Read, Write};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flate2::Compression;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::incident::{EvidenceSource, Incident, VerdictKind};

/// The format and its version. A decoder refuses a version it does not know.
pub const PREFIX: &str = "LTK1-";

/// The longest token the encoder writes.
pub const MAX_CHARS: usize = 1000;

/// Codes past this many are dropped first when a token runs long.
pub const MAX_CODES: usize = 10;

/// Suspects past this many are dropped first when a token runs long.
pub const MAX_SUSPECTS: usize = 4;

/// A suspect's display name is cut to this many characters.
const NAME_CHARS: usize = 32;

/// The host's message is cut to this many characters.
const FAILURE_CHARS: usize = 160;

/// A reason the client sent is cut to this many characters.
const REASON_CHARS: usize = 32;

/// A token inflates to at most this many bytes, whatever it claims.
const MAX_INFLATED: u64 = 64 * 1024;

/// Why a token did not decode.
#[derive(Debug, Error)]
pub enum TokenError {
    #[error("not an LTK incident token")]
    WrongPrefix,
    #[error("the token is not valid base64url")]
    Base64,
    #[error("the token did not inflate: {0}")]
    Inflate(std::io::Error),
    #[error("the token's record did not decode: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
}

/// The incident, as the token carries it. Names and paths on disk stay out.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase", default)]
pub struct IncidentToken {
    /// Minutes since the Unix epoch.
    pub ended_at: u32,
    pub manager: [u16; 3],
    pub game: Option<[u16; 4]>,
    pub verdict: u8,
    pub confidence: Option<u8>,
    pub overlay: u8,
    pub scan: Option<u8>,
    pub launch: u8,
    pub injected: bool,
    pub exit_reason: Option<String>,
    pub exit_code: Option<i32>,
    pub crashed: Option<bool>,
    pub duration_secs: Option<u32>,
    /// The codes seen, as their own strings, so a token reads against any
    /// version of the table.
    pub codes: Vec<String>,
    pub last_load_step: Option<u8>,
    /// The missing-data hash, as sixteen hex digits.
    pub missing_hash: Option<String>,
    /// Archive names, and the suspects' display names cut to 32 characters.
    pub archives: Vec<String>,
    pub suspects: Vec<String>,
    pub skipped: Vec<String>,
    pub redirected_count: u16,
    pub enabled_count: u16,
    pub error_lines: u16,
    pub host_failure: Option<String>,
}

impl IncidentToken {
    /// The token's record for `incident`, with the text taken out.
    ///
    /// `enabled_count` is not on the incident, so the caller passes it.
    pub fn from_incident(incident: &Incident, manager_version: &str, enabled_count: u16) -> Self {
        let verdict = &incident.verdict;
        let ended_at = chrono::DateTime::parse_from_rfc3339(&incident.ended_at)
            .ok()
            .and_then(|at| u32::try_from(at.timestamp() / 60).ok())
            .unwrap_or_default();

        // Newest first, so the code the verdict rests on survives the cut. The
        // load steps are left out, because `last_load_step` carries the one
        // that matters.
        let mut codes: Vec<String> = Vec::new();
        for code in incident.evidence.iter().filter_map(|row| row.code.as_ref()) {
            let is_step = code
                .kind
                .as_deref()
                .is_some_and(|kind| kind.starts_with("load_step:"));
            if !is_step && !codes.contains(&code.id) {
                codes.push(code.id.clone());
            }
        }

        let last_load_step = verdict
            .subject
            .as_deref()
            .filter(|_| verdict.kind == VerdictKind::StuckLoading)
            .and_then(|subject| {
                subject
                    .strip_prefix("step ")?
                    .split(' ')
                    .next()?
                    .parse()
                    .ok()
            })
            .or_else(|| {
                incident.evidence.iter().find_map(|row| {
                    row.code
                        .as_ref()?
                        .kind
                        .as_deref()?
                        .strip_prefix("load_step:")?
                        .parse()
                        .ok()
                })
            });

        let missing_hash = incident
            .evidence
            .iter()
            .find_map(|row| row.missing_data_hash())
            .map(|hash| format!("{hash:016x}"));

        let error_lines = incident
            .evidence
            .iter()
            .filter(|row| row.source == EvidenceSource::Game && row.is_error_level())
            .count();

        Self {
            ended_at,
            manager: version_numbers(manager_version),
            game: incident
                .game
                .as_ref()
                .filter(|game| !game.version.is_empty())
                .map(|game| version_numbers(&game.version)),
            verdict: verdict.kind.code(),
            confidence: verdict.confidence.map(|confidence| confidence.code()),
            overlay: incident.overlay.code(),
            scan: incident.scan.map(|scan| scan.code()),
            launch: incident.launch.code(),
            injected: incident.injected,
            exit_reason: incident
                .ending
                .exit_reason
                .as_deref()
                .map(|reason| cut(reason, REASON_CHARS)),
            exit_code: incident
                .ending
                .exit_code
                .and_then(|code| i32::try_from(code).ok()),
            crashed: incident.ending.crashed,
            duration_secs: incident.duration_secs(),
            codes,
            last_load_step,
            missing_hash,
            archives: incident.archives(),
            suspects: incident
                .suspects
                .iter()
                .map(|suspect| cut(&suspect.display_name, NAME_CHARS))
                .collect(),
            skipped: incident
                .skipped
                .iter()
                .map(|skipped| skipped.wad.clone())
                .collect(),
            redirected_count: saturate(incident.redirected.len()),
            enabled_count,
            error_lines: saturate(error_lines),
            host_failure: (verdict.kind == VerdictKind::PatcherDidNotRun)
                .then(|| cut(&verdict.cause, FAILURE_CHARS)),
        }
    }

    /// The record as a string, `LTK1-` and the rest. Under a thousand
    /// characters: codes past the tenth and suspects past the fourth go first.
    pub fn encode(&self) -> String {
        let mut wire = Wire::from(self);
        wire.codes.truncate(MAX_CODES);
        wire.suspects.truncate(MAX_SUSPECTS);
        let mut text = wire.pack();

        let trims: [fn(&mut Wire); 4] = [
            |wire| {
                wire.archives.truncate(MAX_SUSPECTS);
                wire.skipped.truncate(MAX_SUSPECTS);
            },
            |wire| {
                wire.archives.clear();
                wire.skipped.clear();
            },
            |wire| wire.host_failure = None,
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
    /// The prefix, the encoding, or the record did not read.
    pub fn decode(token: &str) -> Result<Self, TokenError> {
        let token = token.trim().trim_end_matches(['.', ',']).trim_matches('`');
        let body = token.strip_prefix(PREFIX).ok_or(TokenError::WrongPrefix)?;
        let deflated = URL_SAFE_NO_PAD
            .decode(body)
            .map_err(|_| TokenError::Base64)?;
        let mut packed = Vec::new();
        DeflateDecoder::new(deflated.as_slice())
            .take(MAX_INFLATED)
            .read_to_end(&mut packed)
            .map_err(TokenError::Inflate)?;
        let wire: Wire = rmp_serde::from_slice(&packed)?;
        Ok(wire.into())
    }
}

impl Incident {
    /// This incident as a token.
    pub fn token(&self, manager_version: &str, enabled_count: u16) -> String {
        IncidentToken::from_incident(self, manager_version, enabled_count).encode()
    }
}

/// The record on the wire. One-letter keys, defaults left out, and the hash as
/// a number. A key, once given, is never reused for another meaning.
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
    #[serde(rename = "c", skip_serializing_if = "Option::is_none")]
    confidence: Option<u8>,
    #[serde(rename = "o", skip_serializing_if = "is_default")]
    overlay: u8,
    #[serde(rename = "s", skip_serializing_if = "Option::is_none")]
    scan: Option<u8>,
    #[serde(rename = "l", skip_serializing_if = "is_default")]
    launch: u8,
    #[serde(rename = "i", skip_serializing_if = "is_default")]
    injected: bool,
    #[serde(rename = "r", skip_serializing_if = "Option::is_none")]
    exit_reason: Option<Reason>,
    #[serde(rename = "x", skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
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
    #[serde(rename = "a", skip_serializing_if = "Vec::is_empty")]
    archives: Vec<String>,
    #[serde(rename = "S", skip_serializing_if = "Vec::is_empty")]
    suspects: Vec<String>,
    #[serde(rename = "K", skip_serializing_if = "Vec::is_empty")]
    skipped: Vec<String>,
    #[serde(rename = "R", skip_serializing_if = "is_default")]
    redirected_count: u16,
    #[serde(rename = "E", skip_serializing_if = "is_default")]
    enabled_count: u16,
    #[serde(rename = "e", skip_serializing_if = "is_default")]
    error_lines: u16,
    #[serde(rename = "f", skip_serializing_if = "Option::is_none")]
    host_failure: Option<String>,
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
    /// Numbered from one, in this order. Never reorder.
    const KNOWN: [&str; 4] = ["Exit", "Interrupt", "Timeout", "Unknown"];

    fn from_text(text: &str) -> Self {
        match Self::KNOWN.iter().position(|known| *known == text) {
            Some(index) => Self::Known(index as u8 + 1),
            None => Self::Other(text.to_string()),
        }
    }

    fn into_text(self) -> String {
        match self {
            Self::Known(number) => Self::KNOWN
                .get(usize::from(number).wrapping_sub(1))
                .map_or_else(|| format!("reason {number}"), |known| known.to_string()),
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
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
        encoder
            .write_all(&packed)
            .and_then(|()| encoder.finish())
            .map(|deflated| format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(deflated)))
            .expect("deflating into memory does not fail")
    }
}

impl From<&IncidentToken> for Wire {
    fn from(token: &IncidentToken) -> Self {
        Self {
            ended_at: token.ended_at,
            manager: token.manager,
            game: token.game,
            verdict: token.verdict,
            confidence: token.confidence,
            overlay: token.overlay,
            scan: token.scan,
            launch: token.launch,
            injected: token.injected,
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
            archives: token
                .archives
                .iter()
                .map(|name| fold_archive(name))
                .collect(),
            suspects: token.suspects.clone(),
            skipped: token
                .skipped
                .iter()
                .map(|name| fold_archive(name))
                .collect(),
            redirected_count: token.redirected_count,
            enabled_count: token.enabled_count,
            error_lines: token.error_lines,
            host_failure: token.host_failure.clone(),
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
            confidence: wire.confidence,
            overlay: wire.overlay,
            scan: wire.scan,
            launch: wire.launch,
            injected: wire.injected,
            exit_reason: wire.exit_reason.map(Reason::into_text),
            exit_code: wire.exit_code,
            crashed: wire.crashed,
            duration_secs: wire.duration_secs,
            codes: wire.codes,
            last_load_step: wire.last_load_step,
            missing_hash: wire.missing_hash.map(|hash| format!("{hash:016x}")),
            archives: wire.archives.into_iter().map(unfold_archive).collect(),
            suspects: wire.suspects,
            skipped: wire.skipped.into_iter().map(unfold_archive).collect(),
            redirected_count: wire.redirected_count,
            enabled_count: wire.enabled_count,
            error_lines: wire.error_lines,
            host_failure: wire.host_failure,
        }
    }
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
    use super::*;
    use crate::diagnostics::incident::fixtures;

    fn sample() -> IncidentToken {
        IncidentToken::from_incident(
            &fixtures::incident("2026-08-21T21-14-02", "2026-08-21T21:14:02+00:00"),
            "1.14.0",
            4,
        )
    }

    /// Pinned so a script can be checked against it. The deflate bytes come
    /// from the `flate2` backend in the lock file, so a backend change moves
    /// this string while every older token still decodes.
    const VECTOR: &str = "LTK1-AYEAfv_eABWhdM4Bxou6oW2TAQ4AoWeUEBDNAyTNI-ChdgahYwKhbwGhcwGhbAGhacOhcgKheNLAAAAFoWvDoWQMoUORrEFMRS05QjM5QUE0NaFwNKFozxorPE1eb3CBoWGRpkFhdHJveKFTka9BYXRyb3ggSnVzdGljYXKhUgShRQShZQE";

    #[test]
    fn the_sample_reads_the_incident() {
        let token = sample();
        assert_eq!(token.ended_at, 29_789_114);
        assert_eq!(token.manager, [1, 14, 0]);
        assert_eq!(token.game, Some([16, 16, 804, 9184]));
        assert_eq!(token.verdict, VerdictKind::MissingData.code());
        assert_eq!(token.confidence, Some(2));
        assert_eq!(token.overlay, 1);
        assert_eq!(token.scan, Some(1));
        assert_eq!(token.launch, 1);
        assert!(token.injected);
        assert_eq!(token.exit_reason.as_deref(), Some("Interrupt"));
        assert_eq!(token.exit_code, Some(-1073741819));
        assert_eq!(token.crashed, Some(true));
        assert_eq!(token.duration_secs, Some(12));
        assert_eq!(token.codes, ["ALE-9B39AA45"]);
        assert_eq!(token.last_load_step, Some(52));
        assert_eq!(token.missing_hash.as_deref(), Some("1a2b3c4d5e6f7081"));
        assert_eq!(token.archives, ["Aatrox.wad.client"]);
        assert_eq!(token.suspects, ["Aatrox Justicar"]);
        assert!(token.skipped.is_empty());
        assert_eq!(token.redirected_count, 4);
        assert_eq!(token.enabled_count, 4);
        assert_eq!(token.error_lines, 1);
        assert_eq!(token.host_failure, None);
    }

    #[test]
    fn a_token_round_trips() {
        let token = sample();
        let decoded = IncidentToken::decode(&token.encode()).unwrap();
        assert_eq!(decoded, token);
    }

    #[test]
    fn every_field_round_trips() {
        let token = IncidentToken {
            ended_at: 1,
            manager: [1, 2, 3],
            game: Some([4, 5, 6, 7]),
            verdict: 11,
            confidence: Some(1),
            overlay: 5,
            scan: Some(2),
            launch: 4,
            injected: true,
            exit_reason: Some("Timeout".to_string()),
            exit_code: Some(-1),
            crashed: Some(false),
            duration_secs: Some(90),
            codes: vec!["SEJ-9Z6Y34B0".to_string(), "ALE-89b0dee7".to_string()],
            last_load_step: Some(62),
            missing_hash: Some("00000000deadbeef".to_string()),
            archives: vec!["Map11.wad.client".to_string()],
            suspects: vec!["Classic Rift".to_string()],
            skipped: vec!["Ahri.wad.client".to_string()],
            redirected_count: 9,
            enabled_count: 12,
            error_lines: 3,
            host_failure: Some("DLL never attached after 60s.".to_string()),
        };
        assert_eq!(IncidentToken::decode(&token.encode()).unwrap(), token);
    }

    #[test]
    fn the_test_vector_holds() {
        let encoded = sample().encode();
        assert_eq!(encoded, VECTOR);
        assert_eq!(IncidentToken::decode(VECTOR).unwrap(), sample());
    }

    #[test]
    fn a_typical_token_is_short() {
        let encoded = sample().encode();
        assert!(encoded.len() < 200, "{} chars: {encoded}", encoded.len());
    }

    #[test]
    fn a_bad_token_stays_under_four_hundred() {
        let mut token = sample();
        token.codes = (0..10).map(|n| format!("ALE-D0D000{n:02}")).collect();
        token.suspects = (0..4)
            .map(|n| format!("A very long mod name number {n} xx"))
            .collect();
        token.archives = vec![
            "Aatrox.wad.client".to_string(),
            "Map11.wad.client".to_string(),
            "UI.wad.client".to_string(),
        ];
        token.exit_reason = Some("SomethingTheCrateDoesNotKnow".to_string());
        let encoded = token.encode();
        assert!(encoded.len() < 400, "{} chars: {encoded}", encoded.len());
    }

    #[test]
    fn the_cap_holds_under_absurd_input() {
        let mut token = sample();
        token.codes = (0..500).map(|n| format!("ALE-{n:08}")).collect();
        token.suspects = (0..200).map(|n| "x".repeat(32 + n % 3)).collect();
        token.archives = (0..300)
            .map(|n| format!("Champion{n}.wad.client"))
            .collect();
        token.skipped = (0..300).map(|n| format!("Skipped{n}.wad.client")).collect();
        token.host_failure = Some("y".repeat(160));
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
        assert!(matches!(
            IncidentToken::decode("LTK2-abc"),
            Err(TokenError::WrongPrefix)
        ));
        assert!(matches!(
            IncidentToken::decode("hello"),
            Err(TokenError::WrongPrefix)
        ));
    }

    #[test]
    fn bad_base64_is_refused() {
        assert!(matches!(
            IncidentToken::decode("LTK1-not*base64!"),
            Err(TokenError::Base64)
        ));
    }

    #[test]
    fn garbage_inside_is_refused() {
        let garbage = format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(b"not deflate at all"));
        assert!(matches!(
            IncidentToken::decode(&garbage),
            Err(TokenError::Inflate(_))
        ));
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(b"\xc1").unwrap();
        let not_msgpack = format!(
            "{PREFIX}{}",
            URL_SAFE_NO_PAD.encode(encoder.finish().unwrap())
        );
        assert!(matches!(
            IncidentToken::decode(&not_msgpack),
            Err(TokenError::Decode(_))
        ));
    }

    #[test]
    fn a_token_from_a_newer_manager_decodes() {
        #[derive(Serialize)]
        struct Newer {
            v: u8,
            #[serde(rename = "S")]
            suspects: Vec<String>,
            zz: String,
            zy: Vec<u32>,
        }
        let newer = Newer {
            v: 6,
            suspects: vec!["Aatrox Justicar".to_string()],
            zz: "a field this build does not know".to_string(),
            zy: vec![1, 2, 3],
        };
        let packed = rmp_serde::to_vec_named(&newer).unwrap();
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(&packed).unwrap();
        let token = format!(
            "{PREFIX}{}",
            URL_SAFE_NO_PAD.encode(encoder.finish().unwrap())
        );
        let decoded = IncidentToken::decode(&token).unwrap();
        assert_eq!(decoded.verdict, 6);
        assert_eq!(decoded.suspects, ["Aatrox Justicar"]);
        assert_eq!(decoded.manager, [0, 0, 0]);
    }

    #[test]
    fn an_unknown_reason_and_an_odd_archive_name_survive_the_wire() {
        let mut token = sample();
        token.exit_reason = Some("Bespoke".to_string());
        token.archives = vec!["Aatrox.en_US.wad.client".to_string(), "odd.wad".to_string()];
        assert_eq!(IncidentToken::decode(&token.encode()).unwrap(), token);
    }

    #[test]
    fn versions_parse_leniently() {
        assert_eq!(version_numbers::<3>("1.14.0"), [1, 14, 0]);
        assert_eq!(version_numbers::<3>("v2.0.1-beta.3"), [2, 0, 1]);
        assert_eq!(version_numbers::<3>("garbage"), [0, 0, 0]);
        assert_eq!(version_numbers::<4>("16.16.804.9184"), [16, 16, 804, 9184]);
        assert_eq!(version_numbers::<4>("16.16"), [16, 16, 0, 0]);
    }

    #[test]
    fn the_incident_has_a_token_shortcut() {
        let incident = fixtures::incident("2026-08-21T21-14-02", "2026-08-21T21:14:02+00:00");
        assert_eq!(incident.token("1.14.0", 4), sample().encode());
    }
}
