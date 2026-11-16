//! The builders of the files that state what the machine, the library, the last games and
//! the start hold: the System checks, the mod list, the incidents, the game log, the patcher
//! build and the start without a window.

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

use super::{Finding, Startup, SupportReport};

const SYSTEM_JSON: &str = "system.json";
const LIBRARY_JSON: &str = "library.json";
const PATCHER_JSON: &str = "patcher.json";
const STARTUP_JSON: &str = "startup.json";
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
    /// The subject is the incident `subject`, and the newest incident if `subject` is `None`
    /// or names no incident of the store. `report.md` states the subject as what the manager
    /// found. Adds the subject too if it is older than the newest five. Returns the subject.
    /// Adds nothing and returns `None` if the store cannot be read.
    pub fn add_incidents(
        &mut self,
        store: &IncidentStore,
        subject: Option<&str>,
    ) -> Option<Incident> {
        let incidents = match store.list() {
            Ok(incidents) => incidents,
            Err(e) => {
                tracing::warn!("Could not list the incidents for the support report: {e}");
                return None;
            }
        };
        let subject = subject
            .and_then(|id| incidents.iter().position(|incident| incident.id == id))
            .unwrap_or(0);
        let version = self.app.version.clone();
        // The store names its files by the id, so an id is one path component.
        let newest = incidents.iter().take(INCIDENTS);
        let older_subject = incidents.get(subject).filter(|_| subject >= INCIDENTS);
        for incident in newest.chain(older_subject) {
            let id = &incident.id;
            let token = incident.token(&version);
            if let Ok(json) = serde_json::to_string_pretty(incident) {
                self.add(format!("incidents/{id}.json"), &json);
            }
            let text = incident.report_text(&version, Some(&token), &[]);
            self.add(format!("incidents/{id}.md"), &text);
        }

        let subject = incidents.into_iter().nth(subject)?;
        let suspect = match subject.suspects.as_slice() {
            [only] if only.mod_id.is_some() => Some(only.display_name.clone()),
            _ => None,
        };
        self.found = Some(Finding {
            title: subject.verdict.title.clone(),
            consequence: subject.verdict.consequence.to_string(),
            cause: subject.verdict.cause.clone(),
            incident_id: subject.id.clone(),
            token: subject.token(&version),
            suspect,
            game_version: subject.game.as_ref().map(|game| game.version.clone()),
        });
        Some(subject)
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
    /// build is staged. The first line of `report.md` states the version of a staged build
    /// that is past its end of life at the time of the report.
    pub fn add_patcher(&mut self, channel: Channel, staged: Option<&StagedPatcher>) {
        let now = u64::try_from(self.created_at.timestamp()).unwrap_or(0);
        self.outdated.patcher = staged
            .filter(|staged| staged.is_expired(now))
            .map(|staged| staged.version.clone());
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

    /// Adds `startup.json`: the version of the webview runtime, and the error that stopped
    /// the start. `report.md` states both under `Startup`.
    pub fn add_startup(&mut self, startup: Startup) {
        let (version, error) = match &startup.webview {
            Ok(version) => (Some(version), None),
            Err(error) => (None, Some(error)),
        };
        let json = json!({
            "webview": { "version": version, "error": error },
            "failure": startup.failure,
        });
        self.add(STARTUP_JSON, &pretty(&json));
        self.startup = Some(startup);
    }
}

impl Startup {
    /// Returns the start as the lines of the `Startup` section of `report.md`.
    pub(super) fn lines(&self) -> String {
        let start = match &self.failure {
            Some(failure) => format!("The manager did not start: {failure}"),
            None => "The report was built by `--report`, without a window.".to_owned(),
        };
        let webview = match &self.webview {
            Ok(version) => format!("Webview runtime: {version}"),
            Err(error) => format!("Webview runtime: not found ({error})"),
        };
        format!("- {start}\n- {webview}\n")
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
