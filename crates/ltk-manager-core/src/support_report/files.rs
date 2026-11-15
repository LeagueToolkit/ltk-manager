//! The builders of the files that state what the machine, the library and the last games
//! hold: the System checks, the mod list, the incidents, the game log and the patcher build.

use std::path::Path;

use ltk_manager_base::{config::Config, utils::text};
use ltk_manager_library::mods::ModLibrary;
use ltk_manager_runtime::{
    diagnostics::{
        self, CheckCtx, binary_id::BinaryId, game_log, incident::Incident, store::IncidentStore,
    },
    patcher::{
        delivery::{Channel, StagedPatcher},
        host::HOOK_DLL_NAME,
    },
};
use serde_json::{Value, json};

use super::{Finding, SupportReport};

const SYSTEM_JSON: &str = "system.json";
const LIBRARY_JSON: &str = "library.json";
const PATCHER_JSON: &str = "patcher.json";
const GAME_LOG: &str = "game-log/r3dlog.txt";

/// The number of incidents that a report holds, newest first.
const INCIDENTS: usize = 5;

/// The largest size of the game log in a report, in bytes. A longer log keeps its first and
/// its last lines, because the first lines hold the launch and the last lines hold the end.
const MAX_GAME_LOG_BYTES: usize = 512 * 1024;

impl SupportReport {
    /// Adds `system.json`: the System checks, run now over `ctx`, and the facts that
    /// redaction removes from the League path and the storage path.
    pub fn add_system_checks(&mut self, ctx: &CheckCtx) {
        let system = json!({
            "checks": diagnostics::run_all(ctx),
            "paths": {
                "league": path_facts(ctx.league_path.as_deref()),
                "storage": path_facts(ctx.mod_storage_path.as_deref()),
            },
        });
        self.add(SYSTEM_JSON, &pretty(&system));
    }

    /// Adds `library.json`: each mod of the active profile, enabled mods first, and the
    /// number of other profiles.
    ///
    /// A mod row holds no file of the mod. Adds nothing if the library cannot be read.
    pub fn add_library(&mut self, library: &ModLibrary, config: &Config) {
        let mut mods = match library.get_installed_mods(config) {
            Ok(mods) => mods,
            Err(e) => {
                tracing::warn!("Could not list the mods for the support report: {e}");
                return;
            }
        };
        // The sort is stable, so the enabled mods keep the order of their priority.
        mods.sort_by_key(|installed| !installed.enabled);
        let verdicts = library.mod_health_verdicts(config).unwrap_or_default();
        let reports = library.wad_reports().0.lock();

        let rows: Vec<Value> = mods
            .iter()
            .enumerate()
            .map(|(position, installed)| {
                let report = reports.get(&installed.id);
                let layers: Vec<Value> = installed
                    .layers
                    .iter()
                    .map(|layer| json!({ "name": layer.name, "enabled": layer.enabled }))
                    .collect();
                json!({
                    "id": installed.id,
                    "name": installed.display_name,
                    "version": installed.version,
                    "enabled": installed.enabled,
                    "priority": installed.enabled.then_some(position),
                    "format": installed.format,
                    "storage": installed.storage,
                    "layers": layers,
                    "health": verdicts.get(&installed.id).map(|verdict| verdict.health),
                    "archives": report.as_ref().map(|report| &report.affected_wads),
                    "overrides": report.as_ref().map(|report| report.override_count),
                    "digest": report
                        .as_ref()
                        .and_then(|report| report.content_fingerprint)
                        .map(|fingerprint| format!("{fingerprint:016x}")),
                })
            })
            .collect();
        drop(reports);

        let profile = library.get_active_profile_info(config).ok();
        let profiles = library.get_profiles(config).map_or(0, |all| all.len());
        let library = json!({
            "profile": profile.map(|profile| profile.name),
            "otherProfiles": profiles.saturating_sub(1),
            "mods": rows,
        });
        self.add(LIBRARY_JSON, &pretty(&library));
    }

    /// Adds the newest incidents of `store`, five at most: `incidents/<id>.json` with the
    /// incident and `incidents/<id>.md` with its report text.
    ///
    /// The newest incident is what `report.md` states that the manager found. Adds nothing
    /// if the store cannot be read.
    pub fn add_incidents(&mut self, store: &IncidentStore) {
        let incidents = match store.list() {
            Ok(incidents) => incidents,
            Err(e) => {
                tracing::warn!("Could not list the incidents for the support report: {e}");
                return;
            }
        };
        let version = self.app.version.clone();
        // The store names its files by the id, so an id is one path component.
        for incident in incidents.iter().take(INCIDENTS) {
            let id = &incident.id;
            let token = incident.token(&version);
            if let Ok(json) = serde_json::to_string_pretty(incident) {
                self.add(format!("incidents/{id}.json"), &json);
            }
            let text = incident.report_text(&version, Some(&token), &[]);
            self.add(format!("incidents/{id}.md"), &text);
        }
        if let Some(newest) = incidents.first() {
            self.found = Some(Finding {
                title: newest.verdict.title.clone(),
                consequence: newest.verdict.consequence.to_string(),
                cause: newest.verdict.cause.clone(),
                incident_id: newest.id.clone(),
                token: newest.token(&version),
            });
        }
    }

    /// Adds `game-log/r3dlog.txt`: the game log of `incident`, with the private fields of
    /// each line removed.
    ///
    /// Adds nothing if `Read League's game log` is off in `config`, if the incident names no
    /// game log, or if the log cannot be read.
    pub fn add_game_log(&mut self, incident: &Incident, config: &Config) {
        if !config.read_game_log {
            return;
        }
        let log = incident
            .game_log_path()
            .and_then(|path| game_log::read_redacted(path).ok());
        if let Some(log) = log {
            let log = text::first_and_last_lines(&log, MAX_GAME_LOG_BYTES);
            self.add(GAME_LOG, &log);
        }
    }

    /// Adds `patcher.json`: the delivery channel, and the build that a session on it runs.
    ///
    /// `staged` is the build that the delivery cache holds for `channel`, or `None` if no
    /// build is staged.
    pub fn add_patcher(&mut self, channel: Channel, staged: Option<&StagedPatcher>) {
        let patcher = json!({
            "channel": channel.as_str(),
            "staged": staged.map(|staged| {
                let dll = BinaryId::of(&staged.dir.join(HOOK_DLL_NAME));
                json!({
                    "version": staged.version,
                    "digest": staged.digest,
                    "endOfLife": staged.eol,
                    "built": dll.and_then(|dll| dll.built),
                })
            }),
        });
        self.add(PATCHER_JSON, &pretty(&patcher));
    }
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).expect("a JSON value serializes")
}

/// Returns the facts about `path` that a maintainer needs and that a placeholder hides: the
/// number of characters, the drive and whether a character is outside ASCII.
pub(super) fn path_facts(path: Option<&Path>) -> Value {
    let Some(path) = path else {
        return Value::Null;
    };
    let text = path.to_string_lossy();
    let drive = text
        .split_once(':')
        .map(|(letter, _)| letter)
        .filter(|letter| letter.len() == 1)
        .map(|letter| format!("{}:", letter.to_ascii_uppercase()));
    json!({
        "characters": text.chars().count(),
        "drive": drive,
        "nonAscii": !text.is_ascii(),
    })
}
