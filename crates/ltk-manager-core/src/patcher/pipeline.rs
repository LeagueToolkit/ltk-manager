//! From a closed game record to a stored incident.
//!
//! The reader finds the game's log and the crash marker, the classifier reaches
//! a verdict over the record and the library's footprints, the store keeps it,
//! and [`PatcherEvents::incident_recorded`] carries it to the frontend. Every
//! step that fails is logged and stepped over, so a failed store still
//! announces the incident.

use std::cell::OnceCell;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use chrono::{Duration, Local};
use fs_err as fs;

use ltk_telemetry::Telemetry;

use crate::config::Config;
use crate::diagnostics::game_log::{GameWindow, LeagueLogs};
use crate::diagnostics::incident::{
    ClassifyContext, GameRecord, Incident, ModFootprint, OriginKind, ProjectFootprint, ScanMode,
    Suspect,
};
use crate::diagnostics::store::IncidentStore;
use crate::diagnostics::telemetry::{
    self, Environment, GAME_SESSION_ENDED, SessionFacts, SuspectIdentity,
};
use crate::hashtables::{HashtableCache, LayeredHashDb, PathRef};
use crate::launcher::install::installed_patchlines;
use crate::launcher::same_install;
use crate::mods::ModLibrary;
use crate::workshop::ProjectDir;

use super::events::PatcherEvents;
use super::host::hook_flags;

#[cfg(test)]
mod tests;

/// How long after the game's last sign a crash marker still counts as this
/// game's. Crashpad writes it while the process is going down, which can
/// trail the host's `exited` by a few seconds.
const CRASH_MARKER_GRACE: Duration = Duration::seconds(30);

/// Reads, classifies, stores and announces one [`GameRecord`] at a time.
pub struct IncidentPipeline {
    config: Config,
    host_flags: u32,
    library: ModLibrary,
    workshop_paths: Vec<PathBuf>,
    store: Arc<IncidentStore>,
    events: Arc<dyn PatcherEvents>,
    telemetry: Telemetry,
    environment: Environment,
}

impl IncidentPipeline {
    /// A pipeline for one session. `host_flags` are the bits sent to the host,
    /// which say whether the eager scan was forced.
    pub fn new(
        config: Config,
        host_flags: u32,
        library: ModLibrary,
        workshop_paths: Vec<PathBuf>,
        store: Arc<IncidentStore>,
        events: Arc<dyn PatcherEvents>,
        telemetry: Telemetry,
    ) -> Self {
        let environment = Environment {
            app_version: library.app_version().to_string(),
            os_build: crate::diagnostics::windows::os_build(),
            arch: std::env::consts::ARCH.to_string(),
            locale: crate::utils::game::GameDir::resolve(&config)
                .ok()
                .and_then(|dir| dir.locale()),
        };
        Self {
            config,
            host_flags,
            library,
            workshop_paths,
            store,
            events,
            telemetry,
            environment,
        }
    }

    /// Runs [`Self::run`] on its own thread, so the injector loop is never held
    /// by the reader's retries.
    pub fn spawn(self: &Arc<Self>, record: GameRecord) {
        let pipeline = Arc::clone(self);
        let spawned = thread::Builder::new()
            .name("incident-pipeline".to_string())
            .spawn(move || {
                pipeline.run(record);
            });
        if let Err(e) = spawned {
            tracing::error!("Could not start the incident pipeline: {e}");
        }
    }

    /// Reads the log and the crash marker, classifies, stores, and announces.
    ///
    /// `None` when the game was clean and nothing is kept.
    pub fn run(&self, mut record: GameRecord) -> Option<Incident> {
        self.read_league_logs(&mut record);
        record.scan = self.scan_mode(&record);

        let mods = self.mod_footprints();
        let projects = self.project_footprints();
        let tables: OnceCell<Option<LayeredHashDb>> = OnceCell::new();
        let resolve_hash = |hash: u64| -> Option<String> {
            tables
                .get_or_init(open_wad_tables)
                .as_ref()
                .and_then(|db| db.get(hash).map(PathRef::into_owned))
        };
        let ctx = ClassifyContext {
            mods: &mods,
            projects: &projects,
            resolve_hash: &resolve_hash,
            league_path: self.config.league_path.as_deref(),
        };

        let outcome = record.classify(&ctx);

        if let Some(incident) = &outcome {
            tracing::info!(
                id = %incident.id,
                verdict = ?incident.verdict.kind,
                "Incident recorded: {}",
                incident.verdict.title
            );
            if let Err(e) = self.store.record(incident) {
                tracing::error!("Could not store incident {}: {e}", incident.id);
            }
        } else {
            tracing::info!("Game ended clean, no incident recorded");
        }

        // Both branches report, because a verdict rate needs the sessions that
        // reached none as its denominator.
        self.report_session(&record, outcome.as_ref(), &mods, &projects);

        let incident = outcome?;
        self.events.incident_recorded(incident.clone());
        Some(incident)
    }

    /// Report that a session ended, whether or not it reached a verdict.
    ///
    /// Every failure inside is the telemetry handle's to swallow, so nothing here
    /// can fail a session that has already ended.
    fn report_session(
        &self,
        record: &GameRecord,
        incident: Option<&Incident>,
        mods: &[ModFootprint],
        projects: &[ProjectFootprint],
    ) {
        if !self.telemetry.is_enabled() {
            return;
        }

        let facts = SessionFacts {
            duration_secs: session_seconds(record),
            enabled_count: saturating_count(mods.len() + projects.len()),
            injected: record.injected,
            launch: record.launch,
            origin: OriginKind::of(&record.origin),
            scan: record.scan,
            overlay: record.overlay,
            game_patch: record
                .log
                .as_ref()
                .and_then(|log| log.build_version.clone()),
        };

        let properties = match incident {
            None => telemetry::clean_session(&self.environment, &facts),
            Some(incident) => {
                let suspects = self.suspect_identities(&incident.suspects, mods, projects);
                let token = incident.token(self.library.app_version());
                telemetry::verdict_session(&self.environment, &facts, incident, token, &suspects)
            }
        };
        self.telemetry.track(GAME_SESSION_ENDED, properties);
    }

    /// Each suspect as a digest and a reason, with nothing that names it.
    ///
    /// A library mod kept as an archive hashes the archive's bytes, so every
    /// machine holding that file agrees. Anything unpacked hashes the archives it
    /// writes instead, sorted, because there is no one file to read. A repacked
    /// mod is a different mod under this scheme, which is accepted.
    fn suspect_identities(
        &self,
        suspects: &[Suspect],
        mods: &[ModFootprint],
        projects: &[ProjectFootprint],
    ) -> Vec<SuspectIdentity> {
        suspects
            .iter()
            .map(|suspect| {
                let digest = self
                    .archive_digest(suspect)
                    .unwrap_or_else(|| self.footprint_digest(suspect, mods, projects));
                SuspectIdentity {
                    digest,
                    reason: suspect.reason,
                }
            })
            .collect()
    }

    /// The digest of a library mod's archive, for one kept as an archive.
    ///
    /// `None` for a mod stored unpacked, for a workshop project, and for an
    /// archive that cannot be read, each of which falls back to the footprint.
    fn archive_digest(&self, suspect: &Suspect) -> Option<String> {
        let mod_id = suspect.mod_id.as_deref()?;
        let path = self.library.archive_path_of(&self.config, mod_id)?;
        match fs::read(&path) {
            Ok(bytes) => Some(crate::diagnostics::binary_id::content_hash(&bytes)),
            Err(e) => {
                tracing::debug!("Could not read a suspect archive for the session event: {e}");
                None
            }
        }
    }

    /// The digest of what a suspect writes, which is what an unpacked mod has.
    fn footprint_digest(
        &self,
        suspect: &Suspect,
        mods: &[ModFootprint],
        projects: &[ProjectFootprint],
    ) -> String {
        let wads = match (&suspect.mod_id, &suspect.project_path) {
            (Some(id), _) => mods
                .iter()
                .find(|footprint| &footprint.mod_id == id)
                .map(|footprint| footprint.affected_wads.as_slice()),
            (_, Some(path)) => projects
                .iter()
                .find(|footprint| &footprint.project_path == path)
                .map(|footprint| footprint.affected_wads.as_slice()),
            _ => None,
        };
        telemetry::wad_paths_digest(wads.unwrap_or_default())
    }

    /// The game log and the crash marker, when the reader is on and a game was
    /// seen. A record that spans no time is a session that failed before any
    /// game, and there is no window to look in.
    ///
    /// The log is looked for under the configured install first and under
    /// [`Self::other_roots`] on a miss, and the crash marker is read from the
    /// install the log came from.
    fn read_league_logs(&self, record: &mut GameRecord) {
        if !self.config.read_game_log || record.started_at == record.ended_at {
            return;
        }
        let Some(league_path) = self.config.league_path.as_deref() else {
            return;
        };
        record.log_searched = true;

        let window = GameWindow {
            first_sign: record.started_at.with_timezone(&Local),
            last_sign: record.ended_at.with_timezone(&Local),
        };
        let find = |root: PathBuf| {
            let logs = LeagueLogs::new(&root);
            logs.find_game_log(&window).map(|path| (root, logs, path))
        };
        let found = find(league_path.to_path_buf())
            .or_else(|| self.other_roots(league_path).into_iter().find_map(find));
        let logs = match found {
            Some((root, logs, path)) => {
                match logs.read_game_log(&path) {
                    Ok(facts) => {
                        record.log_path = Some(path);
                        record.log_root = Some(root);
                        record.log = Some(facts);
                    }
                    Err(e) => tracing::warn!("Could not read game log {}: {e}", path.display()),
                }
                logs
            }
            None => {
                tracing::debug!("No game log in the game's window under any install root");
                LeagueLogs::new(league_path)
            }
        };

        if let Some(marker) = logs.last_crash() {
            record.ending.crashed =
                Some(marker >= record.started_at && marker <= record.ended_at + CRASH_MARKER_GRACE);
        }
    }

    /// The install roots beside the configured one: the other installs the
    /// product registry lists when a client answers, and the configured
    /// install's sibling folders when none does.
    fn other_roots(&self, league_path: &Path) -> Vec<PathBuf> {
        let registry = installed_patchlines();
        let candidates: Vec<PathBuf> = if registry.is_empty() {
            league_path
                .parent()
                .and_then(|parent| fs::read_dir(parent).ok())
                .into_iter()
                .flatten()
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .map(|entry| entry.path())
                .collect()
        } else {
            registry
                .into_iter()
                .map(|patchline| patchline.root)
                .collect()
        };
        candidates
            .into_iter()
            .filter(|root| !same_install(root, league_path))
            .collect()
    }

    /// Which scan the DLL ran, the way the DLL decides it: eager when the flag
    /// forces it or the game reports crashes, lazy otherwise. Unknown without
    /// the DLL in the game or the game's command line.
    fn scan_mode(&self, record: &GameRecord) -> Option<ScanMode> {
        if !record.injected {
            return None;
        }
        if self.host_flags & hook_flags::FULL_WAD_SCAN != 0 {
            return Some(ScanMode::Eager);
        }
        let log = record.log.as_ref()?;
        Some(if log.crash_reporting == Some(true) {
            ScanMode::Eager
        } else {
            ScanMode::Lazy
        })
    }

    /// The enabled mods in the overlay's merge order, after the workshop
    /// projects it prepends. The first mod in the list wins a conflict, so its
    /// position is its priority.
    fn mod_footprints(&self) -> Vec<ModFootprint> {
        let mods = match self.library.get_installed_mods(&self.config) {
            Ok(mods) => mods,
            Err(e) => {
                tracing::warn!("Could not list the library's mods for the verdict: {e}");
                return Vec::new();
            }
        };
        let reports = self.library.wad_reports().0.lock();
        let offset = self.workshop_paths.len();
        mods.into_iter()
            .filter(|m| m.enabled)
            .enumerate()
            .map(|(position, m)| ModFootprint {
                affected_wads: reports
                    .get(&m.id)
                    .map(|report| report.affected_wads)
                    .unwrap_or_default(),
                mod_id: m.id,
                display_name: m.display_name,
                priority: offset + position,
            })
            .collect()
    }

    fn project_footprints(&self) -> Vec<ProjectFootprint> {
        self.workshop_paths
            .iter()
            .map(|path| project_footprint(path))
            .collect()
    }
}

/// What one workshop project writes: its display name from its config, and the
/// archives its layers hold. A project that does not load did not build into
/// the overlay either, so it keeps its directory name and no archives.
fn project_footprint(path: &Path) -> ProjectFootprint {
    let dir_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    let project_path = path.display().to_string();

    let loaded = ProjectDir::open(path).and_then(|dir| Ok((dir.load()?, dir)));
    let (project, dir) = match loaded {
        Ok(loaded) => loaded,
        Err(e) => {
            tracing::debug!("Workshop project {} did not load: {e}", path.display());
            return ProjectFootprint {
                project_path,
                display_name: dir_name,
                affected_wads: Vec::new(),
            };
        }
    };

    let layer_names: Vec<String> = project.layers.iter().map(|l| l.name.clone()).collect();
    let mut affected_wads: Vec<String> = dir
        .layer_info(&layer_names)
        .map(|info| info.into_values().flat_map(|l| l.wad_files).collect())
        .unwrap_or_default();
    affected_wads.sort_by_key(|wad| wad.to_ascii_lowercase());
    affected_wads.dedup_by(|a, b| a.eq_ignore_ascii_case(b));

    ProjectFootprint {
        project_path,
        display_name: if project.display_name.trim().is_empty() {
            dir_name
        } else {
            project.display_name
        },
        affected_wads,
    }
}

/// The `game` and `lcu` hash tables, opened on the first hash the classifier
/// asks about. Absent tables are a miss and never an error.
fn open_wad_tables() -> Option<LayeredHashDb> {
    match HashtableCache::shared() {
        Ok(cache) => Some(cache.wad_tables()),
        Err(e) => {
            tracing::debug!("No hashtable cache for the verdict: {e}");
            None
        }
    }
}

/// How long the session ran, in whole seconds.
///
/// `None` when the record spans no time, which is a session that failed before
/// any game and has no length worth reporting.
fn session_seconds(record: &GameRecord) -> Option<u64> {
    let seconds = (record.ended_at - record.started_at).num_seconds();
    u64::try_from(seconds).ok().filter(|secs| *secs > 0)
}

/// `count` as the width the wire carries, saturating rather than wrapping.
fn saturating_count(count: usize) -> u16 {
    u16::try_from(count).unwrap_or(u16::MAX)
}
