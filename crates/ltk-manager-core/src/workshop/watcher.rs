//! Watches on the layers of the open workshop projects, which announce a file saved from outside.

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use fs_err as fs;
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{
    DebounceEventResult, DebouncedEvent, DebouncedEventKind, Debouncer, new_debouncer,
};
use parking_lot::Mutex;

use super::LayerFilesChanged;
use crate::error::{AppError, AppResult};
use crate::events::{BackendEvent, EventSink};
use crate::sandbox::SandboxState;

/// How long a path stays quiet before its change is announced.
///
/// An editor's save is a burst of a temporary file written, the old file removed and a
/// rename over it, and one announcement covers the burst.
const QUIET: Duration = Duration::from_millis(300);

/// The directory under a project that contains its layers, as `AssetRef::layer_file` reads it.
const CONTENT_DIR: &str = "content";

/// Rebuilds what a batch of changed Atlas source files feeds, given the project and those files.
pub type SourceRebuild = Arc<dyn Fn(&str, &[PathBuf]) + Send + Sync>;

/// The layer watches of the open workshop projects, by project directory.
///
/// A change clears the project's cached sandboxes before the event is emitted, so a read the
/// event starts sees the changed files. ADR-0056.
pub struct LayerWatches {
    events: Arc<dyn EventSink>,
    sandboxes: SandboxState,
    /// The directory under each project holding its Atlas sources, and what a change there
    /// rebuilds. Nothing where unset.
    sources: Option<(String, SourceRebuild)>,
    watches: Mutex<HashMap<String, LayerWatch>>,
}

/// One project's watch, and how many editors reference it.
struct LayerWatch {
    refs: usize,
    _debouncer: Debouncer<RecommendedWatcher>,
}

impl LayerWatches {
    /// An empty set of watches that emits through `events` and clears the changed project's
    /// snapshots from `sandboxes`.
    pub fn new(events: Arc<dyn EventSink>, sandboxes: SandboxState) -> Self {
        Self {
            events,
            sandboxes,
            sources: None,
            watches: Mutex::default(),
        }
    }

    /// The same watches, which also watch each project's Atlas sources under `dir` and run
    /// `rebuild` on the source files a batch changed. The page it writes lands in a layer, which
    /// the layer watch then announces.
    pub fn with_sources(mut self, dir: &str, rebuild: SourceRebuild) -> Self {
        self.sources = Some((dir.to_owned(), rebuild));
        self
    }

    /// Watch the layers of `project`, or count one more reference to its running watch.
    ///
    /// # Errors
    ///
    /// Fails with [`AppError::Io`] when the project has no `content` directory, and with
    /// [`AppError::Other`] when the platform refuses the watch.
    pub fn acquire(&self, project: &str) -> AppResult<()> {
        let mut watches = self.watches.lock();
        if let Some(watch) = watches.get_mut(project) {
            watch.refs += 1;
            return Ok(());
        }

        let debouncer = self.start(project)?;
        watches.insert(
            project.to_owned(),
            LayerWatch {
                refs: 1,
                _debouncer: debouncer,
            },
        );

        Ok(())
    }

    /// Release one reference to the watch on `project`. The last release stops it.
    pub fn release(&self, project: &str) {
        let mut watches = self.watches.lock();
        let Some(watch) = watches.get_mut(project) else {
            return;
        };

        watch.refs -= 1;
        if watch.refs == 0 {
            watches.remove(project);
            tracing::debug!("Stopped watching the layers of {project}");
        }
    }

    /// Stop every watch, for a page load that ran none of the old page's cleanup.
    pub fn release_all(&self) {
        self.watches.lock().clear();
    }

    fn start(&self, project: &str) -> AppResult<Debouncer<RecommendedWatcher>> {
        /* Canonical. FSEvents reports the real path, and a reported path strips only the
        prefix it was reported under. */
        let content = fs::canonicalize(Path::new(project).join(CONTENT_DIR))?;
        let sources = match &self.sources {
            Some((dir, _)) => {
                let dir = Path::new(project).join(dir);
                fs::create_dir_all(&dir)?;
                Some(fs::canonicalize(dir)?)
            }
            None => None,
        };
        let events = Arc::clone(&self.events);
        let sandboxes = self.sandboxes.clone();
        let rebuild = self
            .sources
            .as_ref()
            .map(|(_, rebuild)| Arc::clone(rebuild));
        let owner = project.to_owned();
        let root = content.clone();
        let source_root = sources.clone();

        let mut debouncer = new_debouncer(QUIET, move |result: DebounceEventResult| match result {
            Ok(batch) => {
                let (changed, layers): (Vec<_>, Vec<_>) =
                    settled_files(&batch).into_iter().partition(|path| {
                        source_root
                            .as_ref()
                            .is_some_and(|dir| path.starts_with(dir))
                    });
                if let Some(rebuild) = rebuild.as_ref().filter(|_| !changed.is_empty()) {
                    rebuild(&owner, &changed);
                }
                announce(&*events, &sandboxes, &owner, &root, &layers);
            }
            Err(error) => tracing::warn!("Layer watch on {owner} failed: {error}"),
        })
        .map_err(watch_error)?;
        debouncer
            .watcher()
            .watch(&content, RecursiveMode::Recursive)
            .map_err(watch_error)?;
        if let Some(sources) = &sources {
            debouncer
                .watcher()
                .watch(sources, RecursiveMode::Recursive)
                .map_err(watch_error)?;
        }

        tracing::debug!("Watching the layers of {project}");
        Ok(debouncer)
    }
}

impl fmt::Debug for LayerWatches {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let watches = self.watches.lock();
        let refs: HashMap<&str, usize> = watches
            .iter()
            .map(|(project, watch)| (project.as_str(), watch.refs))
            .collect();

        f.debug_struct("LayerWatches")
            .field("refs", &refs)
            .finish_non_exhaustive()
    }
}

/// Emit the layer files among `paths`, where there are any.
fn announce(
    events: &dyn EventSink,
    sandboxes: &SandboxState,
    project: &str,
    content: &Path,
    paths: &[PathBuf],
) {
    if let Some(change) =
        LayerFilesChanged::collect(project, content, paths.iter().map(PathBuf::as_path))
    {
        sandboxes.invalidate(project);
        tracing::debug!("{} layer files of {project} changed", change.files.len());
        events.emit(BackendEvent::LayerFilesChanged(change));
    }
}

/// The paths of a batch whose writes stopped, less the directories among them.
///
/// A path in the middle of a write arrives as `AnyContinuous`, and a reader of it decodes
/// a half-written file. A removed path stays in the list. A save that renames over its file
/// removes that file first.
fn settled_files(batch: &[DebouncedEvent]) -> Vec<PathBuf> {
    batch
        .iter()
        .filter(|event| event.kind == DebouncedEventKind::Any)
        .filter(|event| !fs::metadata(&event.path).is_ok_and(|meta| meta.is_dir()))
        .map(|event| event.path.clone())
        .collect()
}

fn watch_error(error: notify::Error) -> AppError {
    AppError::Other(format!("Could not watch the project's layers: {error}"))
}

#[cfg(test)]
mod tests;
