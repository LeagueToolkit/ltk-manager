//! From a closed game record to a stored incident.
//!
//! The reader finds the game's log and the crash marker, the classifier reaches
//! a verdict over the record and the library's footprints, the store keeps it,
//! and [`PatcherEvents::incident_recorded`] carries it to the frontend. Every
//! step that fails is logged and stepped over, so a failed store still
//! announces the incident.

use std::borrow::Cow;
use std::cell::OnceCell;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use chrono::{Duration, Local};

use crate::config::Config;
use crate::diagnostics::game_log::{GameWindow, LeagueLogs};
use crate::diagnostics::incident::{
    ClassifyContext, GameRecord, Incident, ModFootprint, ProjectFootprint, ScanMode,
};
use crate::diagnostics::store::IncidentStore;
use crate::hashtables::{HashtableCache, LayeredHashDb};
use crate::mods::ModLibrary;
use crate::workshop::ProjectDir;

use super::events::PatcherEvents;
use super::host::hook_flags;

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
    ) -> Self {
        Self {
            config,
            host_flags,
            library,
            workshop_paths,
            store,
            events,
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
                .and_then(|db| db.get(hash).map(Cow::into_owned))
        };
        let ctx = ClassifyContext {
            mods: &mods,
            projects: &projects,
            resolve_hash: &resolve_hash,
        };

        let Some(incident) = record.classify(&ctx) else {
            tracing::info!("Game ended clean, no incident recorded");
            return None;
        };
        tracing::info!(
            id = %incident.id,
            verdict = ?incident.verdict.kind,
            "Incident recorded: {}",
            incident.verdict.title
        );

        if let Err(e) = self.store.record(&incident) {
            tracing::error!("Could not store incident {}: {e}", incident.id);
        }
        self.events.incident_recorded(incident.clone());
        Some(incident)
    }

    /// The game log and the crash marker, when the reader is on and a game was
    /// seen. A record that spans no time is a session that failed before any
    /// game, and there is no window to look in.
    fn read_league_logs(&self, record: &mut GameRecord) {
        if !self.config.read_game_log || record.started_at == record.ended_at {
            return;
        }
        let Some(league_path) = self.config.league_path.as_deref() else {
            return;
        };

        let logs = LeagueLogs::new(league_path);
        let window = GameWindow {
            first_sign: record.started_at.with_timezone(&Local),
            last_sign: record.ended_at.with_timezone(&Local),
        };
        match logs.find_game_log(&window) {
            Some(path) => match logs.read_game_log(&path) {
                Ok(facts) => {
                    record.log_path = Some(path.display().to_string());
                    record.log = Some(facts);
                }
                Err(e) => tracing::warn!("Could not read game log {}: {e}", path.display()),
            },
            None => tracing::debug!("No game log in the game's window"),
        }

        if let Some(marker) = logs.last_crash() {
            record.ending.crashed =
                Some(marker >= record.started_at && marker <= record.ended_at + CRASH_MARKER_GRACE);
        }
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
        let reports = self.library.wad_reports().0.lock().ok();
        let offset = self.workshop_paths.len();
        mods.into_iter()
            .filter(|m| m.enabled)
            .enumerate()
            .map(|(position, m)| ModFootprint {
                affected_wads: reports
                    .as_ref()
                    .and_then(|store| store.get(&m.id))
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
    match HashtableCache::discover() {
        Ok(cache) => Some(cache.wad_tables()),
        Err(e) => {
            tracing::debug!("No hashtable cache for the verdict: {e}");
            None
        }
    }
}
