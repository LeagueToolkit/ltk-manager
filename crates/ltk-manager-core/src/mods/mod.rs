//! The mod library: what is installed, how it is organized, and how it reaches
//! the overlay.
//!
//! [`ModLibrary`] is the entry point. It owns no mod data itself — everything
//! lives in `library.json` on disk — so its job is to hold the shared handles
//! (event sink, WAD report cache, linked-bin state) and to serialize access to
//! that file. The work is split by concern:
//!
//! | Module             | Concern                                          |
//! | ------------------ | ------------------------------------------------ |
//! | [`index`]          | `library.json`: shape, versioning, reconciliation |
//! | [`archive`]        | Mod archives in, out, and read                    |
//! | [`analysis`]       | What a mod touches and what that makes it         |
//! | [`organize`]       | Folders and profiles                              |
//! | [`types`]          | The shapes the frontend sees                      |
//! | [`library`]        | Library reads and per-profile mod state           |
//! | [`overlay_content`]| Turning library entries into overlay inputs       |

mod analysis;
mod archive;
mod index;
mod library;
mod organize;
mod overlay_content;
mod types;

#[cfg(test)]
mod test_support;

pub use analysis::categorize::{ChampionRoster, DerivedCategorization};
pub use analysis::linked_bins::{LinkedBinOffenderInfo, LinkedBinState};
pub use analysis::wad_reports::{ModWadReport, WadReportState};
pub use archive::inspect::{ModpkgInfo, inspect_modpkg_file};
pub(crate) use archive::metadata::parse_fantome_info;
pub use archive::migration::*;
pub use types::{BulkInstallResult, EditModMetadataArgs, InstalledMod, LibraryFolder, Profile};

use crate::events::EventSink;
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
    index_lock: Arc<Mutex<()>>,
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
            index_lock: Arc::clone(&self.index_lock),
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
    ) -> Self {
        Self {
            events,
            default_storage_dir,
            app_version: app_version.into(),
            linked_bins,
            wad_reports,
            index_lock: Arc::new(Mutex::new(())),
            last_mutation_epoch_ms: Arc::new(AtomicI64::new(0)),
        }
    }

    /// Notification sink for this library's operations.
    pub(crate) fn events(&self) -> &Arc<dyn EventSink> {
        &self.events
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

    /// Epoch-millis timestamp of the last index mutation, for watchers that
    /// need to ignore the filesystem events their own writes produce.
    pub fn last_mutation_epoch_ms(&self) -> &Arc<AtomicI64> {
        &self.last_mutation_epoch_ms
    }
}
