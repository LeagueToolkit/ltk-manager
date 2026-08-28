//! The mod library: what is installed, how it is organized, and how it reaches
//! the overlay.
//!
//! [`ModLibrary`] is the entry point. It owns no mod data itself — everything
//! lives in `library.json` on disk — so its job is to hold the shared handles
//! (event sink, WAD report cache, linked-bin state) and to serialize access to
//! that file. The work is split by concern:
//!
//! | Module             | Concern                                           |
//! | ------------------ | ------------------------------------------------- |
//! | `index`            | `library.json`: shape, versioning, reconciliation  |
//! | `archive`          | Mod archives in, out, and read                     |
//! | `analysis`         | What a mod touches and what that makes it          |
//! | `health`           | The Problems rules over an installed mod           |
//! | `organize`         | Folders and profiles                               |
//! | `types`            | The shapes the frontend sees                       |
//! | `library`          | Library reads and per-profile mod state            |
//! | `overlay_content`  | Turning library entries into overlay inputs        |
//! | `slug`             | What a mod's directory is called                   |
//! | `long_paths`       | The 260-character limit, as unpacking meets it     |
//!
//! Every installed mod is a directory under `<storage>/mods/`, named by its
//! slug. What is inside it, and why a modpkg's is shaped differently from a
//! fantome's, is `docs/adr/0001-fantome-unpacks-modpkg-stays-packed.md`.

mod analysis;
mod archive;
mod health;
mod index;
mod library;
pub(crate) mod long_paths;
mod organize;
mod overlay_content;
mod slug;
mod types;

#[cfg(test)]
pub(crate) mod test_support;

pub use analysis::categorize::{ChampionRoster, DerivedCategorization};
pub use analysis::linked_bins::{LinkedBinOffenderInfo, LinkedBinState};
pub use analysis::wad_reports::{ModWadReport, WadReportState};
pub use archive::inspect::{ModpkgInfo, inspect_modpkg_file};
pub use archive::migration::*;
pub use archive::repair::{LibraryRepairReport, ModRepairFailure};
pub use health::sweep::{HealthSweepReport, HealthSweepState};
pub use health::{HealthCheckBasis, ModHealth, ModHealthVerdict};
pub use index::document::{ModArchiveFormat, ModFault, ModStorage};
pub use index::layout_migration::{FailedConversion, LayoutMigrationReport, LayoutMigrationState};
pub use types::{BulkInstallResult, EditModMetadataArgs, InstalledMod, LibraryFolder, Profile};

use crate::events::EventSink;
use crate::hashtables::WadPathResolverState;
use std::path::PathBuf;
use std::sync::atomic::AtomicI64;
use std::sync::{Arc, Mutex};

/// Cooldown period after a mutation during which the watcher ignores events.
/// Must be longer than the debouncer window (2 s) plus margin for delayed
/// Windows filesystem notifications.
pub const WATCHER_SUPPRESS_SECS: i64 = 10;

/// Managed struct that encapsulates mod library operations.
///
/// All index operations are serialized through `index_lock` to prevent
/// concurrent reads/writes from clobbering each other.
/// The [`Config`](crate::config::Config) is passed per-call since it
/// can change at runtime.
pub struct ModLibrary {
    /// Notification channel, in place of emitting through a Tauri handle.
    events: Arc<dyn EventSink>,
    /// Fallback storage root when the user hasn't set a custom path. Supplied by
    /// the caller (the shell resolves it from `app_data_dir`, a CLI from `dirs`)
    /// rather than looked up, so nothing here depends on Tauri.
    default_storage_dir: Option<PathBuf>,
    /// Version of the host application, supplied for the same reason as
    /// `default_storage_dir`: a `CARGO_PKG_VERSION` read here would report this
    /// crate's version, which does not move when the app ships a release.
    /// [`overlay`](crate::overlay) keys its once-per-release cache flush on it.
    app_version: String,
    /// Offenders from the latest overlay build. Owned directly rather than
    /// fetched via `try_state`, which removes both the startup ordering
    /// constraint and the silent no-op when the state wasn't registered.
    linked_bins: Arc<LinkedBinState>,
    /// Per-mod WAD analysis cache. Owned for the same reason as `linked_bins`.
    wad_reports: Arc<WadReportState>,
    /// Names for the chunks of a packed WAD, so an imported fantome lands under
    /// real paths instead of hex. Best-effort: with no tables it names nothing.
    wad_resolver: Arc<WadPathResolverState>,
    /// What the layout migration has to say, for as long as this process lives.
    ///
    /// The run starts with the app and can be over before a webview exists to
    /// hear it announced, so the outcome is kept for whoever asks next rather
    /// than only emitted.
    layout_migration: Arc<Mutex<LayoutMigrationState>>,
    /// What the mod health sweep has to say, kept for the same reason
    /// `layout_migration` is.
    health_sweep: Arc<Mutex<HealthSweepState>>,
    index_lock: Arc<Mutex<()>>,
    /// Serializes the read-modify-write of `mod-health-verdicts.json`.
    ///
    /// A startup sweep and an install's background check both record verdicts,
    /// and each records by rewriting the whole file, so two at once would lose
    /// whichever landed first.
    verdict_lock: Arc<Mutex<()>>,
    /// Epoch-millis timestamp of the last `mutate_index` completion.
    /// The file watcher skips events that arrive within [`WATCHER_SUPPRESS_SECS`]
    /// of this timestamp.
    last_mutation_epoch_ms: Arc<AtomicI64>,
}

impl Clone for ModLibrary {
    fn clone(&self) -> Self {
        Self {
            events: Arc::clone(&self.events),
            default_storage_dir: self.default_storage_dir.clone(),
            app_version: self.app_version.clone(),
            linked_bins: Arc::clone(&self.linked_bins),
            wad_reports: Arc::clone(&self.wad_reports),
            wad_resolver: Arc::clone(&self.wad_resolver),
            layout_migration: Arc::clone(&self.layout_migration),
            health_sweep: Arc::clone(&self.health_sweep),
            index_lock: Arc::clone(&self.index_lock),
            verdict_lock: Arc::clone(&self.verdict_lock),
            last_mutation_epoch_ms: Arc::clone(&self.last_mutation_epoch_ms),
        }
    }
}

impl ModLibrary {
    pub fn new(
        events: Arc<dyn EventSink>,
        default_storage_dir: Option<PathBuf>,
        app_version: impl Into<String>,
        linked_bins: Arc<LinkedBinState>,
        wad_reports: Arc<WadReportState>,
        wad_resolver: Arc<WadPathResolverState>,
    ) -> Self {
        Self {
            events,
            default_storage_dir,
            app_version: app_version.into(),
            linked_bins,
            wad_reports,
            wad_resolver,
            layout_migration: Arc::new(Mutex::new(LayoutMigrationState::default())),
            health_sweep: Arc::new(Mutex::new(HealthSweepState::default())),
            index_lock: Arc::new(Mutex::new(())),
            verdict_lock: Arc::new(Mutex::new(())),
            last_mutation_epoch_ms: Arc::new(AtomicI64::new(0)),
        }
    }

    /// What the layout migration has to say for itself this launch.
    pub fn layout_migration_state(&self) -> LayoutMigrationState {
        self.layout_migration
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    pub(crate) fn record_layout_migration(&self, outcome: LayoutMigrationState) {
        if let Ok(mut state) = self.layout_migration.lock() {
            *state = outcome;
        }
    }

    pub(in crate::mods) fn verdict_lock(&self) -> &Mutex<()> {
        &self.verdict_lock
    }

    /// Drop what the overlay builder cached about these mods.
    ///
    /// For an operation that changed where a mod's content is read from without
    /// moving anything in the builder's reuse key: the next build has to start
    /// from the files rather than from what it remembers of them.
    pub(crate) fn invalidate_overlay_for(&self, storage_dir: &std::path::Path, mod_ids: &[String]) {
        crate::overlay::force_flush_on_next_build(storage_dir);
        if let Ok(mut store) = self.wad_reports.0.lock() {
            let _ = store.invalidate_by_content(mod_ids);
        }
    }

    /// Notification sink for this library's operations.
    pub(crate) fn events(&self) -> &Arc<dyn EventSink> {
        &self.events
    }

    /// Announce that the library changed, so every cached view of it refetches.
    ///
    /// For a caller that made several changes through separate calls and wants
    /// one refresh at the end of them rather than one each.
    pub fn announce_change(&self) {
        self.events
            .emit(crate::events::BackendEvent::LibraryChanged);
    }

    /// Version of the host application, as supplied to [`ModLibrary::new`].
    pub(crate) fn app_version(&self) -> &str {
        &self.app_version
    }

    /// Offenders recorded by the most recent overlay build.
    pub(crate) fn linked_bins(&self) -> &Arc<LinkedBinState> {
        &self.linked_bins
    }

    /// Per-mod WAD analysis cache.
    pub(crate) fn wad_reports(&self) -> &Arc<WadReportState> {
        &self.wad_reports
    }

    /// Chunk-path names for unpacking a fantome's packed WADs.
    ///
    /// Absent tables are not an error — the resolver names nothing and the
    /// chunks keep their hex file names, which the overlay reads either way.
    pub(crate) fn wad_resolver(&self) -> Arc<crate::hashtables::WadPathResolver> {
        match self.wad_resolver.get() {
            Ok(resolver) => resolver,
            Err(e) => {
                tracing::warn!("Hashtable handle unavailable ({e}), chunks keep their hex names");
                Arc::new(crate::hashtables::WadPathResolver::new(
                    crate::hashtables::LayeredHashDb::new(),
                ))
            }
        }
    }

    /// Epoch-millis timestamp of the last index mutation, for watchers that
    /// need to ignore the filesystem events their own writes produce.
    pub fn last_mutation_epoch_ms(&self) -> &Arc<AtomicI64> {
        &self.last_mutation_epoch_ms
    }
}
