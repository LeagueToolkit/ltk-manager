//! Installing the mods of a list, one after another, as the reader confirmed them.
//!
//! The run is one command: it holds the thread for as long as the list takes, and reports each
//! item's stage as an event on the way. An item that fails is reported and the run goes on to
//! the next, so one refused download does not cost the reader the other 499. The reader can
//! stop the run between items, and what was installed before the stop stays installed.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use fs_err as fs;
use ltk_manager_base::config::Config;
use ltk_manager_base::events::{BackendEvent, EventSink, InstallListProgress, InstallListStage};
use ltk_manager_core::deep_link::install_list::{check_item, resolve_download, InstallListItem};
use ltk_manager_core::deep_link::{self, public_https_url, DownloadError};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::{AppError, AppErrorResponse, AppResult};
use crate::events::TauriEventSink;
use crate::mods::{InstallOutcome, InstalledMod, ModLibrary, ModOrigin, Profile};
use crate::state::SettingsState;

/// The longest `Retry-After` wait a rate-limited item sleeps through before its one retry.
const MAX_RETRY_WAIT: Duration = Duration::from_secs(60);

/// What the reader confirmed: which items of the list, and into which profile.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstallListPlan {
    /// The manifest URL the link carried. Every item's download must stay on its host.
    pub manifest_url: String,
    /// The site's name, as the origin record of each installed mod keeps it.
    pub source: String,
    /// The items to install, in the list's order.
    pub items: Vec<InstallListItem>,
    pub profile: InstallListProfile,
}

/// Which profile the list's mods are enabled in.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InstallListProfile {
    /// The profile that is active as the run starts.
    Active,
    /// A profile created and switched to before the first item, named by the reader.
    New { name: String },
}

/// What a run did, item by item.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstallListReport {
    pub installed: Vec<InstallListResult>,
    /// Items that replaced an older version of their mod.
    pub updated: Vec<InstallListResult>,
    /// Items whose file the library already held.
    pub already_installed: Vec<InstallListResult>,
    pub failed: Vec<InstallListFailure>,
    /// Whether the reader stopped the run. The items after the last one reported were not
    /// attempted.
    pub cancelled: bool,
    /// The profile the mods were enabled in.
    pub profile: Profile,
}

/// One item that reached the library, and the mod it is there as.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstallListResult {
    pub item_id: String,
    #[serde(rename = "mod")]
    pub installed: InstalledMod,
}

/// One item that did not reach the library, and why.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstallListFailure {
    pub item_id: String,
    pub error: AppErrorResponse,
}

/// Whether the reader asked the current run to stop.
///
/// One flag for the app: the deep-link rate limit admits one list at a time, and a second run
/// resets it as it starts.
#[derive(Debug, Default)]
pub struct InstallListCancel(AtomicBool);

impl InstallListCancel {
    /// Clears the flag for a run that is starting.
    pub fn start(&self) {
        self.0.store(false, Ordering::Relaxed);
    }

    /// Asks the run to stop after the item it is on.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

/// Everything a run reads from the app.
pub struct RunContext<'a> {
    pub app: &'a AppHandle,
    pub library: &'a ModLibrary,
    pub settings: &'a SettingsState,
    pub cancel: &'a InstallListCancel,
    /// The running app version, for the `User-Agent`.
    pub version: &'a str,
}

/// Installs `plan`'s items in order, reporting each as it goes.
///
/// # Errors
///
/// Fails before the first item when the manifest URL or an item fails the checks the manifest
/// passed, the manifest's host is not trusted, or the new profile cannot be made. From the
/// first item on, a failure is an entry of the report and never an error.
pub fn run(plan: InstallListPlan, context: &RunContext<'_>) -> AppResult<InstallListReport> {
    let manifest_url = public_https_url(&plan.manifest_url)?;
    let host = manifest_url
        .host_str()
        .map(str::to_lowercase)
        .ok_or_else(|| AppError::ValidationFailed("The install list URL names no host".into()))?;
    super::reject_if_untrusted(&plan.manifest_url, context.settings)?;
    for item in &plan.items {
        check_item(item, &host)?;
    }

    let config = context.settings.config();
    let profile = match plan.profile {
        InstallListProfile::Active => context.library.get_active_profile_info(&config)?,
        InstallListProfile::New { name } => {
            let profile = context.library.create_profile(&config, name)?;
            context.library.switch_profile(&config, profile.id)?
        }
    };

    context.cancel.start();
    let events = TauriEventSink::new(context.app.clone());
    let total = u32::try_from(plan.items.len()).unwrap_or(u32::MAX);

    let mut report = InstallListReport {
        installed: Vec::new(),
        updated: Vec::new(),
        already_installed: Vec::new(),
        failed: Vec::new(),
        cancelled: false,
        profile,
    };

    for (index, item) in plan.items.iter().enumerate() {
        if context.cancel.is_cancelled() {
            report.cancelled = true;
            break;
        }

        let position = Position {
            index: u32::try_from(index).unwrap_or(u32::MAX),
            total,
            item_id: &item.id,
        };
        let progress = |stage, error: Option<String>| {
            events.emit(BackendEvent::InstallListProgress(InstallListProgress {
                index: position.index,
                total: position.total,
                item_id: position.item_id.to_owned(),
                stage,
                error,
            }));
        };

        match install_item(
            item,
            &plan.source,
            &manifest_url,
            &config,
            context,
            &events,
            &progress,
        ) {
            Ok(outcome) => {
                let (stage, bucket) = match &outcome {
                    InstallOutcome::Installed(_) => {
                        (InstallListStage::Installed, &mut report.installed)
                    }
                    InstallOutcome::Updated(_) => (InstallListStage::Updated, &mut report.updated),
                    InstallOutcome::AlreadyInstalled(_) => (
                        InstallListStage::AlreadyInstalled,
                        &mut report.already_installed,
                    ),
                };
                progress(stage, None);
                bucket.push(InstallListResult {
                    item_id: item.id.clone(),
                    installed: outcome.into_mod(),
                });
            }
            Err(error) => {
                tracing::warn!(item = %item.id, name = %item.name, "Install list item failed: {error}");
                progress(InstallListStage::Failed, Some(error.to_string()));
                report.failed.push(InstallListFailure {
                    item_id: item.id.clone(),
                    error: AppErrorResponse::from(error),
                });
            }
        }
    }

    deep_link::emit_install_complete(&events);

    if let Err(error) = put_list_first(&report, &plan.items, context.library, &config) {
        tracing::warn!("Install list mods keep the order they landed in: {error}");
    }

    Ok(report)
}

/// Where one item sits in the run, for its progress events.
#[derive(Debug, Clone, Copy)]
struct Position<'a> {
    index: u32,
    total: u32,
    item_id: &'a str,
}

/// Mints `item`'s link, downloads its file, installs it and records where it came from.
fn install_item(
    item: &InstallListItem,
    source: &str,
    manifest_url: &reqwest::Url,
    config: &Config,
    context: &RunContext<'_>,
    events: &dyn EventSink,
    progress: &dyn Fn(InstallListStage, Option<String>),
) -> AppResult<InstallOutcome> {
    progress(InstallListStage::Resolving, None);
    let url = with_one_retry(|| resolve_download(&item.download, manifest_url, context.version))?;

    progress(InstallListStage::Downloading, None);
    let temp_path = with_one_retry(|| deep_link::download_mod_file(&url, context.version, events))?;

    progress(InstallListStage::Installing, None);
    let outcome = context
        .library
        .install_mod_from_package(config, &temp_path.to_string_lossy());
    if let Err(error) = fs::remove_file(&temp_path) {
        tracing::warn!("Failed to clean up temp file: {error}");
    }
    let outcome = outcome?;

    let origin = ModOrigin {
        source: source.to_owned(),
        id: item.id.clone(),
        version: item.version.clone(),
    };
    let mod_id = match &outcome {
        InstallOutcome::Installed(installed)
        | InstallOutcome::Updated(installed)
        | InstallOutcome::AlreadyInstalled(installed) => installed.id.clone(),
    };
    context.library.set_mod_origin(config, &mod_id, origin)?;

    Ok(outcome)
}

/// Runs `request`, and once more after the wait a rate limit names, when it names one the run
/// can sit through. Any other failure, and a second rate limit, come back as they are.
fn with_one_retry<T>(request: impl Fn() -> AppResult<T>) -> AppResult<T> {
    let result = request();
    let Err(error) = &result else {
        return result;
    };
    let Some(wait) = retry_wait(error) else {
        return result;
    };

    tracing::info!("Rate limited, retrying the item in {}s", wait.as_secs());
    thread::sleep(wait);
    request()
}

/// The wait a rate-limited `error` names, where it is within [`MAX_RETRY_WAIT`].
fn retry_wait(error: &AppError) -> Option<Duration> {
    let AppError::Domain(domain) = error else {
        return None;
    };
    let DownloadError::RateLimited {
        retry_after: Some(seconds),
    } = domain.downcast_ref::<DownloadError>()?
    else {
        return None;
    };
    let wait = Duration::from_secs(*seconds);
    (wait <= MAX_RETRY_WAIT).then_some(wait)
}

/// Puts the list's mods at the front of the active profile's order, in the list's order.
///
/// A fresh install lands at the front, so a list installed top first would leave its bottom
/// item in front. The owner's order is the one the reader saw, and the top of it wins.
fn put_list_first(
    report: &InstallListReport,
    items: &[InstallListItem],
    library: &ModLibrary,
    config: &Config,
) -> AppResult<()> {
    let mut list_ids: Vec<String> = Vec::new();
    for item in items {
        let landed = report
            .installed
            .iter()
            .chain(&report.updated)
            .chain(&report.already_installed)
            .find(|result| result.item_id == item.id);
        if let Some(result) = landed {
            if !list_ids.contains(&result.installed.id) {
                list_ids.push(result.installed.id.clone());
            }
        }
    }
    if list_ids.is_empty() {
        return Ok(());
    }

    let profile = library.get_active_profile_info(config)?;
    let mut order = list_ids.clone();
    order.extend(
        profile
            .mod_order
            .iter()
            .filter(|id| !list_ids.contains(id))
            .cloned(),
    );
    library.reorder_mods(config, order)
}
