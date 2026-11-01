//! What one game session reports, and nothing else.
//!
//! The mapping from an incident to a property map lives here rather than at the
//! pipeline, so the schema is one file to read and one file to test. What travels
//! is flat, low cardinality and free of names: a mod is a digest and a reason, a
//! path never appears, and the incident token carries the rest for anyone holding
//! the id.

use ltk_manager_base::config::Config;
use ltk_manager_base::utils::game::GameDir;
use ltk_telemetry::Properties;

use super::elevation::ElevationFacts;
use super::incident::{Because, Incident, LaunchKind, OriginKind, OverlayOutcome, ScanMode};
use crate::patcher::error::PatcherError;

#[cfg(test)]
mod tests;

/// The one event a game session reports, clean or not.
pub const GAME_SESSION_ENDED: &str = "game_session_ended";

/// The event a patcher start that the elevation check refused reports.
pub const PATCHER_REFUSED: &str = "patcher_refused";

/// The event one app launch reports, once the states are built.
pub const APP_STARTED: &str = "app_started";

/// The event a patcher start that got no DLL reports.
pub const PATCHER_START_FAILED: &str = "patcher_start_failed";

/// The event a failed background sync of the patcher delivery reports.
pub const PATCHER_DELIVERY_SYNC_FAILED: &str = "patcher_delivery_sync_failed";

/// How a session ended, which is the property every other one is read against.
const OUTCOME_CLEAN: &str = "clean";
const OUTCOME_VERDICT: &str = "verdict";

/// The boundaries a session's length is reported in, in seconds.
///
/// A bucket rather than the duration, because the exact second a game ran is
/// close to a fingerprint across a day and answers no question a range does not.
/// The edges are the shapes a session takes: a launch that failed, a game left
/// in champion select, a remake, and a full game.
const DURATION_BUCKETS: [(u64, &str); 6] = [
    (60, "under-1m"),
    (5 * 60, "1-5m"),
    (15 * 60, "5-15m"),
    (30 * 60, "15-30m"),
    (45 * 60, "30-45m"),
    (u64::MAX, "over-45m"),
];

/// The bucket `seconds` falls in.
#[must_use]
pub fn duration_bucket(seconds: u64) -> &'static str {
    for (edge, name) in DURATION_BUCKETS {
        if seconds < edge {
            return name;
        }
    }
    "over-45m"
}

/// What the machine is, shared by every event this build sends.
///
/// Gathered once at startup rather than per event: none of it changes while the
/// app runs, and three of the five cost a file read or a syscall.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Environment {
    /// The manager's own version.
    pub app_version: String,
    /// The OS as `10.0.26100`, where the platform reports one.
    pub os_build: Option<String>,
    /// The target architecture this build runs as.
    pub arch: String,
    /// The game's configured locale, as `LeagueClientSettings.yaml` names it.
    pub locale: Option<String>,
    /// Whether the manager process runs elevated.
    pub manager_elevated: bool,
    /// Whether League is set to run as administrator.
    pub league_admin: bool,
}

impl Environment {
    /// Reads what the machine is, for the manager at `app_version` set up by `config`.
    pub fn read(app_version: &str, config: &Config) -> Self {
        Self {
            app_version: app_version.to_string(),
            os_build: super::windows::os_build(),
            arch: std::env::consts::ARCH.to_string(),
            locale: GameDir::resolve(config).ok().and_then(|dir| dir.locale()),
            manager_elevated: super::manager_is_elevated(),
            league_admin: super::league_configured_as_admin(),
        }
    }

    /// Write what the machine is into `properties`.
    fn describe(&self, properties: &mut Properties) {
        properties.insert("app_version", self.app_version.clone());
        properties.insert("arch", self.arch.clone());
        if let Some(os_build) = &self.os_build {
            properties.insert("os_build", os_build.clone());
        }
        if let Some(locale) = &self.locale {
            properties.insert("locale", locale.clone());
        }
        properties.insert("manager_elevated", self.manager_elevated);
        properties.insert("league_admin", self.league_admin);
    }
}

/// The properties a refused patcher start reports: the refusal and the elevation facts.
#[must_use]
pub fn patcher_refused(
    app_version: &str,
    refusal: &PatcherError,
    facts: &ElevationFacts,
) -> Properties {
    let mut properties = Properties::new()
        .with("app_version", app_version)
        .with("reason", refusal_kind(refusal));
    describe_elevation(&mut properties, facts);
    properties
}

/// The properties one app launch reports: the machine, the elevation facts and the staged DLL.
#[must_use]
pub fn app_started(
    environment: &Environment,
    facts: &ElevationFacts,
    patcher_version: Option<&str>,
    channel: &str,
) -> Properties {
    let mut properties = Properties::new();
    environment.describe(&mut properties);
    describe_elevation(&mut properties, facts);
    properties.insert("delivery_channel", channel);
    properties.insert("patcher_staged", patcher_version.is_some());
    if let Some(version) = patcher_version {
        properties.insert("patcher_version", version);
    }
    properties
}

/// The properties a patcher start that got no DLL reports. `reason` is the delivery
/// failure's kind.
#[must_use]
pub fn patcher_start_failed(app_version: &str, reason: &str) -> Properties {
    Properties::new()
        .with("app_version", app_version)
        .with("stage", "prepare")
        .with("reason", reason)
}

/// The properties a failed background sync reports. `reason` is the delivery failure's kind.
#[must_use]
pub fn delivery_sync_failed(app_version: &str, channel: &str, reason: &str) -> Properties {
    Properties::new()
        .with("app_version", app_version)
        .with("delivery_channel", channel)
        .with("reason", reason)
}

/// Writes the elevation facts into `properties`.
///
/// The parent process travels as its executable name alone, and the compatibility layer as
/// whether one exists, so no path reaches the payload.
fn describe_elevation(properties: &mut Properties, facts: &ElevationFacts) {
    properties.insert("manager_elevated", facts.elevated);
    properties.insert("elevation_type", facts.elevation_type.to_string());
    properties.insert("uac_enabled", facts.uac_enabled);
    properties.insert("builtin_administrator", facts.builtin_administrator);
    properties.insert("compat_layer", facts.compat_layer.is_some());

    if let Some(cause) = facts.cause() {
        properties.insert("cause", cause.to_string());
    }
    if let Some(integrity) = facts.integrity_name() {
        properties.insert("integrity", integrity);
    }
    if let Some(shell_elevated) = facts.shell_elevated {
        properties.insert("shell_elevated", shell_elevated);
    }
    if let Some(parent) = &facts.parent {
        properties.insert("parent", parent.clone());
    }
}

/// The `kind` tag of `refusal`, which is the same string the frontend matches on.
fn refusal_kind(refusal: &PatcherError) -> String {
    serde_json::to_value(refusal)
        .ok()
        .and_then(|value| value.get("kind")?.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string())
}

/// What a session reports whatever its outcome.
///
/// The game patch is the one field that can be missing on a session that ended
/// well, because it is read out of the game's own log and the log reader is a
/// setting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFacts {
    pub duration_secs: Option<u64>,
    pub enabled_count: u16,
    pub injected: bool,
    pub launch: LaunchKind,
    pub origin: OriginKind,
    pub scan: Option<ScanMode>,
    pub overlay: OverlayOutcome,
    pub game_patch: Option<String>,
    /// Identity of the DLL that ran, the first 16 hex of its SHA-256.
    pub patcher_dll: Option<String>,
}

/// The properties a clean session reports.
#[must_use]
pub fn clean_session(environment: &Environment, facts: &SessionFacts) -> Properties {
    let mut properties = Properties::new();
    environment.describe(&mut properties);
    describe_session(&mut properties, facts);
    properties.insert("outcome", OUTCOME_CLEAN);
    properties
}

/// The properties a session that reached a verdict reports.
///
/// The token is one property, verbatim. It is already capped, already trimmed to
/// ten codes and four suspects, and already omits every path on disk, so it is
/// what makes one session readable without asking the reporter for anything.
#[must_use]
pub fn verdict_session(
    environment: &Environment,
    facts: &SessionFacts,
    incident: &Incident,
    token: String,
    suspects: &[SuspectIdentity],
) -> Properties {
    let mut properties = Properties::new();
    environment.describe(&mut properties);
    describe_session(&mut properties, facts);
    properties.insert("outcome", OUTCOME_VERDICT);

    properties.insert("verdict_kind", value_of(&incident.verdict.kind));
    properties.insert("consequence", value_of(&incident.verdict.consequence));
    properties.insert("game_phase", value_of(&incident.phase));
    properties.insert("scan_status", value_of(&incident.scan_status));
    properties.insert("incident_token", token);

    if let Some(reason) = &incident.ending.exit_reason {
        properties.insert("exit_reason", reason.clone());
    }
    if let Some(code) = incident.ending.exit_code {
        properties.insert("exit_status", super::exit_status::describe(code));
    }
    if let Some(crashed) = incident.ending.crashed {
        properties.insert("crashed", crashed);
    }

    let codes: Vec<String> = incident
        .evidence
        .iter()
        .filter_map(|evidence| evidence.code.as_ref().map(|code| code.id.clone()))
        .collect();
    properties.insert("evidence_codes", codes);

    properties.insert(
        "suspect_count",
        u64::from(u32::try_from(suspects.len()).unwrap_or(u32::MAX)),
    );
    let described: Vec<serde_json::Value> = suspects
        .iter()
        .map(|suspect| {
            serde_json::json!({ "digest": suspect.digest, "reason": value_of(&suspect.reason) })
        })
        .collect();
    properties.insert("suspects", described);

    properties
}

/// The digest a mod in project storage travels as.
///
/// Over the wad paths it writes, lowercased and sorted, so two installs of the
/// same unpacked mod agree without either holding one archive. What it gives up
/// is telling apart two mods that touch the same archives, which is a collision
/// this accepts rather than a name it would have to send.
#[must_use]
pub fn wad_paths_digest(wads: &[String]) -> String {
    let mut sorted: Vec<String> = wads.iter().map(|wad| wad.to_ascii_lowercase()).collect();
    sorted.sort();
    sorted.dedup();
    ltk_manager_base::hashing::content_hash(sorted.join("\n").as_bytes())
}

/// A suspect as it travels: a digest of what it is, and why it was named.
///
/// No display name, no project path and no mod id. A mod name is free text a
/// person wrote, and a rare one is close to an identifier on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SuspectIdentity {
    pub digest: String,
    pub reason: Because,
}

fn describe_session(properties: &mut Properties, facts: &SessionFacts) {
    if let Some(seconds) = facts.duration_secs {
        properties.insert("duration_bucket", duration_bucket(seconds));
    }
    properties.insert("enabled_mods", u64::from(facts.enabled_count));
    properties.insert("injected", facts.injected);
    properties.insert("origin", value_of(&facts.origin));
    properties.insert("overlay_outcome", value_of(&facts.overlay));
    properties.insert("launch_kind", value_of(&facts.launch));
    if let Some(scan) = &facts.scan {
        properties.insert("scan_mode", value_of(scan));
    }
    if let Some(patch) = &facts.game_patch {
        properties.insert("game_patch", patch.clone());
    }
    if let Some(dll) = &facts.patcher_dll {
        properties.insert("patcher_dll", dll.clone());
    }
}

/// The serialized name of a unit enum, which is what the vendor groups on.
///
/// Every one of these carries an explicit serde rename, so the string here is the
/// string the schema promises. A value that stops serializing as a plain string
/// is a bug rather than a shape to handle, and reports as `unknown`.
fn value_of<T: serde::Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(name)) => name,
        _ => "unknown".to_string(),
    }
}
