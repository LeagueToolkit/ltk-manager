//! Lifecycle of a profile's cached overlay artifacts.
//!
//! The builder's reuse key is the mod set, the mod content, the game fingerprint
//! and a state schema version. Overlay-building logic is outside that key. A
//! flush is the only reach an out-of-key change has to an overlay on disk.
//!
//! Every operation here is best-effort. An artifact that resists deletion is
//! logged and skipped.

use crate::mods::StorageLayout as _;
use fs_err as fs;
use std::path::{Path, PathBuf};

/// Name of the marker holding the app version that last built these overlays.
pub(crate) const BUILD_VERSION_MARKER: &str = ".overlay-build-version";

/// Overlay-artifact lifecycle on a library's storage directory.
pub(crate) trait OverlayStorageExt {
    /// Purge every profile's overlay artifacts when `app_version` differs from
    /// the marker. A matching marker is a no-op.
    ///
    /// `app_version` is the host application's version. `CARGO_PKG_VERSION` here
    /// is this crate's version, which is independent of the app's releases.
    ///
    /// Best-effort: the marker records `app_version`. A failure is logged.
    fn invalidate_stale_overlays(&self, app_version: &str);

    /// Drop the marker. The next build purges every profile.
    ///
    /// The marker is the reach of a change that moves what a mod's content is
    /// without moving the app version, such as the library layout migration.
    fn invalidate_overlays_on_next_build(&self);
}

impl OverlayStorageExt for Path {
    fn invalidate_stale_overlays(&self, app_version: &str) {
        let marker = self.join(BUILD_VERSION_MARKER);

        let up_to_date = fs::read_to_string(&marker)
            .ok()
            .is_some_and(|v| v.trim() == app_version);
        if up_to_date {
            return;
        }

        let profiles_dir = self.profiles_dir();
        if let Ok(entries) = fs::read_dir(&profiles_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    purge_overlay_artifacts(&path, false);
                }
            }
        }

        let _ = fs::create_dir_all(self);
        match fs::write(&marker, app_version) {
            Ok(()) => tracing::info!(
                "Flushed cached overlays for app version {} (overlay build logic may have changed)",
                app_version
            ),
            Err(e) => tracing::warn!(
                "Failed to write overlay build-version marker {}: {}",
                marker.display(),
                e
            ),
        }
    }

    fn invalidate_overlays_on_next_build(&self) {
        let marker = self.join(BUILD_VERSION_MARKER);
        match fs::remove_file(&marker) {
            Ok(()) => tracing::info!("Cleared the overlay build-version marker"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!(
                "Failed to clear overlay build-version marker {}: {}",
                marker.display(),
                e
            ),
        }
    }
}

/// Returns the paths of the cached overlay artifacts under `profile_dir`, present or not.
///
/// The patched-WAD `overlay/` tree, the `overlay.json` state file and the `override_meta.bin`
/// metadata cache are always listed. `game_index.bin` is listed only under `include_game_index`.
/// That cache is expensive to rebuild, and the game fingerprint validates it independently of
/// the app version.
pub(crate) fn overlay_artifacts(profile_dir: &Path, include_game_index: bool) -> Vec<PathBuf> {
    let mut paths = vec![
        profile_dir.join("overlay"),
        profile_dir.join("overlay.json"),
        profile_dir.join("override_meta.bin"),
    ];
    if include_game_index {
        paths.push(profile_dir.join("game_index.bin"));
    }
    paths
}

/// Remove a profile's cached overlay artifacts, as [`overlay_artifacts`] lists them.
///
/// The next build starts clean.
pub(super) fn purge_overlay_artifacts(profile_dir: &Path, include_game_index: bool) {
    for path in overlay_artifacts(profile_dir, include_game_index) {
        let removed = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else if path.exists() {
            fs::remove_file(&path)
        } else {
            continue;
        };

        if let Err(e) = removed {
            tracing::warn!(
                "Failed to remove overlay artifact {}: {}",
                path.display(),
                e
            );
        }
    }
}

/// Remove every empty or unparseable top-level JSON file under `state_dir`.
///
/// A run interrupted mid-write leaves a truncated state file. `ltk_overlay`
/// fails to parse one.
pub(super) fn clean_corrupt_overlay_state(state_dir: &camino::Utf8Path) {
    let entries = match fs::read_dir(state_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let contents = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if contents.trim().is_empty()
            || serde_json::from_str::<serde_json::Value>(&contents).is_err()
        {
            tracing::warn!(
                "Removing corrupt overlay state file before build: {}",
                path.display()
            );
            let _ = fs::remove_file(&path);
        }
    }
}

/// Returns the fingerprint of the overlay that the state file under `state_dir` describes:
/// sixteen hex characters over the fingerprint of the game directory and the fingerprint of
/// each patched archive. Two builds with one fingerprint wrote the same archives.
///
/// Returns `None` if the state file is missing or cannot be read.
pub(super) fn overlay_fingerprint(state_dir: &camino::Utf8Path) -> Option<String> {
    let path = ltk_overlay::StateDir::new(state_dir).overlay_state();
    let state = ltk_overlay::OverlayState::load(&path).ok().flatten()?;
    let facts = serde_json::to_vec(&(state.game_fingerprint, &state.wad_fingerprints)).ok()?;
    Some(ltk_manager_base::hashing::content_hash(&facts))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use camino::Utf8Path;
    use ltk_overlay::{OverlayState, StateDir};

    use super::overlay_fingerprint;

    /// Saves a state with `mods` enabled and the patched archives `wads` under `dir`.
    fn save(dir: &Utf8Path, mods: &[&str], wads: &[(&str, u64)]) {
        let state = OverlayState::new(
            mods.iter().map(|id| (*id).to_owned()).collect(),
            BTreeMap::new(),
            7,
            Vec::new(),
            Vec::new(),
            wads.iter()
                .map(|(wad, hash)| ((*wad).to_owned(), *hash))
                .collect(),
        );
        state
            .save(&StateDir::new(dir).overlay_state())
            .expect("the state saves");
    }

    #[test]
    fn overlay_fingerprint_follows_the_patched_archives() {
        let temp = tempfile::tempdir().unwrap();
        let dir = Utf8Path::from_path(temp.path()).unwrap();
        assert_eq!(overlay_fingerprint(dir), None);

        save(dir, &["a"], &[("Ahri.wad.client", 1)]);
        let first = overlay_fingerprint(dir).expect("a fingerprint");
        assert_eq!(first.len(), 16);

        save(dir, &["a", "b"], &[("Ahri.wad.client", 1)]);
        assert_eq!(overlay_fingerprint(dir), Some(first.clone()));

        save(dir, &["a", "b"], &[("Ahri.wad.client", 2)]);
        assert_ne!(overlay_fingerprint(dir), Some(first));
    }
}
