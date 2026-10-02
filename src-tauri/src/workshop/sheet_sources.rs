//! The pages a project's Atlas sources rebuild into, for the watch on those sources: a sheet's page
//! from its images, and a patched game page from the game's own texture and the images pasted
//! over it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use atlas::{read_patch, read_sheet, rebuild_patch, rebuild_sheet, PAGES_DIR, SOURCES_DIR};
use fs_err as fs;
use tauri::AppHandle;

use super::SourceRebuild;
use crate::error::AppResult;
use crate::services::game::game_file;

const CONTENT_DIR: &str = "content";
const SOURCE_EXTENSION: &str = "png";

/// What a source image rebuilds: the sheet or the patched page whose folder holds it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Target {
    Sheet(String),
    Patch(String),
}

/// The rebuild a project's source watch runs, reading a patched page's base through `app`.
pub fn source_rebuild(app: AppHandle) -> SourceRebuild {
    Arc::new(move |project, changed| rebuild(&app, project, changed))
}

fn rebuild(app: &AppHandle, project: &str, changed: &[PathBuf]) {
    let Ok(root) = fs::canonicalize(Path::new(project).join(SOURCES_DIR)) else {
        return;
    };

    let mut targets: BTreeMap<Target, Vec<&PathBuf>> = BTreeMap::new();
    for path in changed {
        let image = path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case(SOURCE_EXTENSION));
        let Some(relative) = path.strip_prefix(&root).ok().filter(|_| image) else {
            continue;
        };

        let parts: Vec<&str> = relative
            .components()
            .filter_map(|part| part.as_os_str().to_str())
            .collect();
        let target = match parts.as_slice() {
            [pages, folder, _] if *pages == PAGES_DIR => Target::Patch((*folder).to_owned()),
            [folder, _] => Target::Sheet((*folder).to_owned()),
            _ => continue,
        };
        targets.entry(target).or_default().push(path);
    }

    for (target, sources) in targets {
        match rebuild_target(app, Path::new(project), &target, &sources) {
            Ok(true) => tracing::info!("Rebuilt the Atlas page of {target:?} in {project}"),
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(
                    "Could not rebuild the Atlas page of {target:?} in {project}: {error}"
                )
            }
        }
    }
}

/// Rebuild the page of `target` unless it is already newer than every changed source.
fn rebuild_target(
    app: &AppHandle,
    project: &Path,
    target: &Target,
    sources: &[&PathBuf],
) -> AppResult<bool> {
    match target {
        Target::Sheet(folder) => {
            let Some(spec) = read_sheet(project, folder)? else {
                return Ok(false);
            };
            if fresh(project, &spec.layer, &spec.archive, &spec.path, sources) {
                return Ok(false);
            }
            rebuild_sheet(project, folder)
        }
        Target::Patch(folder) => {
            let Some(spec) = read_patch(project, folder)? else {
                return Ok(false);
            };
            if fresh(project, &spec.layer, &spec.archive, &spec.path, sources) {
                return Ok(false);
            }
            let Some((_, base)) = game_file(app, &spec.path)? else {
                return Ok(false);
            };
            Ok(rebuild_patch(project, folder, &base)?.is_some())
        }
    }
}

/// Whether the page in its layer is newer than every changed source, as it is right after an
/// import wrote both.
fn fresh(project: &Path, layer: &str, archive: &str, path: &str, sources: &[&PathBuf]) -> bool {
    let page = project
        .join(CONTENT_DIR)
        .join(layer)
        .join(archive)
        .join(path);
    let Ok(written) = fs::metadata(page).and_then(|meta| meta.modified()) else {
        return false;
    };
    sources.iter().all(|source| {
        fs::metadata(source)
            .and_then(|meta| meta.modified())
            .is_ok_and(|changed| changed <= written)
    })
}
