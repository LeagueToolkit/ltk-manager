//! Turning library entries into overlay inputs.
//!
//! The overlay builder wants content providers and an explicit layer set, not
//! library rows. This module is the adapter: it opens each enabled mod's
//! content, resolves which of its layers the active profile wants, and hands
//! back a list the builder can consume in priority order.
//!
//! Which provider a mod gets is decided by its **layout**, never by where it
//! came from. A modpkg stays packed because it streams well, so it is read
//! through [`ModpkgContent`]. An unpacked mod project is read through
//! [`FsModContent`]. See `docs/adr/0001-fantome-unpacks-modpkg-stays-packed.md`.
//!
//! [`FantomeContent`] reads a mod whose content is still inside its archive:
//! everything the layout migration moved, and everything it has not reached.

use crate::config::Config;
use crate::error::{AppError, AppResult, Utf8PathExt};
use crate::mods::ModLibrary;
use crate::mods::StorageLayout as _;
use crate::mods::archive::metadata::load_mod_project;
use crate::mods::archive::reader::open_modpkg;
use crate::mods::index::get_active_profile;
use crate::mods::index::{LibraryModEntry, ModArchiveFormat};
use crate::mods::types::{Profile, ProfileSlug};
use fs_err::File;
use ltk_overlay::{FantomeContent, FsModContent, ModContentProvider, ModpkgContent};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

impl ModLibrary {
    /// Build a single `ltk_overlay::EnabledMod` for a mod by id, plus the
    /// active profile directory (for sharing `game_index.bin` with the patcher).
    /// Used by the on-demand WAD analysis path so the patcher worker thread
    /// doesn't need to be involved.
    ///
    /// Returns [`AppError::ModNotFound`] if the mod isn't in the library and
    /// [`AppError::InvalidPath`] if its files are missing from disk.
    pub fn build_single_mod_provider(
        &self,
        config: &Config,
        mod_id: &str,
    ) -> AppResult<(PathBuf, ltk_overlay::EnabledMod)> {
        self.with_index(config, |storage_dir, index| {
            let entry = index
                .mods
                .iter()
                .find(|m| m.id == mod_id)
                .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;

            if !entry.is_present(storage_dir) {
                return Err(AppError::InvalidPath(format!(
                    "Mod content missing on disk: {}",
                    entry.mod_dir(storage_dir).display()
                )));
            }

            let content = entry.content_provider(storage_dir)?;
            let active_profile = get_active_profile(index)?;
            let profile_dir = storage_dir.profile_dir(active_profile.slug.as_str());

            Ok((
                profile_dir,
                ltk_overlay::EnabledMod {
                    id: entry.id.clone(),
                    content,
                    enabled_layers: None,
                },
            ))
        })
    }

    pub fn get_enabled_mods_for_overlay(
        &self,
        config: &Config,
    ) -> AppResult<(ProfileSlug, Vec<ltk_overlay::EnabledMod>)> {
        self.with_index(config, |storage_dir, index| {
            let active_profile_id = index.active_profile_id.clone();
            let active_profile = index
                .profiles
                .iter()
                .find(|p| p.id == active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;

            let mut enabled_mods = Vec::new();

            // Process mods in the order they appear in enabled_mods list (maintains priority)
            for mod_id in &active_profile.enabled_mods {
                let Some(entry) = index.mods.iter().find(|m| &m.id == mod_id) else {
                    tracing::warn!("Mod {} in profile but not found in library", mod_id);
                    continue;
                };

                if !entry.is_present(storage_dir) {
                    tracing::warn!("Skipping mod {}: content missing on disk", entry.id);
                    continue;
                }

                let content = entry.content_provider(storage_dir)?;
                let enabled_layers = active_profile.enabled_overlay_layers(entry, storage_dir)?;

                enabled_mods.push(ltk_overlay::EnabledMod {
                    id: entry.id.clone(),
                    content,
                    enabled_layers,
                });
            }

            Ok((active_profile.slug.clone(), enabled_mods))
        })
    }
}

impl Profile {
    /// Resolves which layers the overlay should apply for `entry` under this profile.
    ///
    /// Returns `None` to apply every layer (the overlay builder's default), or
    /// `Some(set)` naming the exact layers to apply. Layers are opt-in: with no
    /// saved layer config, a multi-layer mod applies only its always-on `base`
    /// layer, while a single-layer mod falls back to the default so a plain mod
    /// still applies when simply enabled.
    fn enabled_overlay_layers(
        &self,
        entry: &LibraryModEntry,
        storage_dir: &Path,
    ) -> AppResult<Option<HashSet<String>>> {
        if let Some(states) = self.layer_states.get(&entry.id) {
            return Ok(Some(
                states
                    .iter()
                    .filter(|&(_, &enabled)| enabled)
                    .map(|(name, _)| name.clone())
                    .collect(),
            ));
        }

        let project = load_mod_project(&entry.mod_dir(storage_dir))?;
        if project.layers.len() <= 1 {
            return Ok(None);
        }

        Ok(Some(
            project
                .layers
                .iter()
                .filter(|l| l.name == "base")
                .map(|l| l.name.clone())
                .collect(),
        ))
    }
}

impl LibraryModEntry {
    /// Wraps this mod's content in the provider its layout calls for.
    ///
    /// # Errors
    ///
    /// Fails when the path is not representable as UTF-8, or when the archive a
    /// packed mod's content lives in cannot be opened.
    pub(crate) fn content_provider(
        &self,
        storage_dir: &Path,
    ) -> AppResult<Box<dyn ModContentProvider>> {
        if !self.is_packed() {
            let mod_dir = self.mod_dir(storage_dir).try_into_utf8("mod directory")?;
            return Ok(Box::new(FsModContent::new(mod_dir).with_raw_overrides()));
        }

        let archive_path = self
            .archive_path(storage_dir)
            .try_into_utf8("archive path")?;

        let content: Box<dyn ModContentProvider> = match self.format {
            ModArchiveFormat::Modpkg => Box::new(
                ModpkgContent::new(open_modpkg(archive_path.as_std_path())?)
                    .with_archive_path(archive_path),
            ),
            // A fantome whose content is still inside its archive: one the
            // layout migration moved rather than converted, or one repacked
            // there since. ADR-0003 and ADR-0004.
            ModArchiveFormat::Fantome | ModArchiveFormat::Unknown => Box::new(
                FantomeContent::new(File::open(&archive_path)?)
                    .map_err(AppError::Overlay)?
                    .with_archive_path(archive_path),
            ),
        };
        Ok(content)
    }
}

#[cfg(test)]
mod tests;
