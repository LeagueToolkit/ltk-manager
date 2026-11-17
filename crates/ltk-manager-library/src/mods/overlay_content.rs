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

use crate::mods::ModLibrary;
use crate::mods::StorageLayout as _;
use crate::mods::archive::metadata::load_mod_project;
use crate::mods::index::get_active_profile;
use crate::mods::index::{LibraryModEntry, ModArchiveFormat};
use crate::mods::types::{Profile, ProfileSlug};
use chrono::Utc;
use fs_err::File;
use ltk_manager_assets::mod_archive::open_modpkg;
use ltk_manager_base::advisory::{Advisories, Advisory, AdvisoryCode, AdvisorySubject};
use ltk_manager_base::config::Config;
use ltk_manager_base::error::{AppError, AppResult, Utf8PathExt, message_with_sources};
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

    /// Returns the slug of the active profile and its enabled mods as overlay inputs, in
    /// the order of their priority.
    ///
    /// Raises an advisory on `advisories` for each enabled mod that the overlay does not
    /// get in full. A mod that is not in the library, a mod whose content is missing and a
    /// mod whose content or project cannot be read are left out. A mod that has several
    /// layers and no saved choice is applied with `base` alone.
    ///
    /// # Errors
    ///
    /// Fails if the index cannot be read or holds no active profile.
    pub fn get_enabled_mods_for_overlay(
        &self,
        config: &Config,
        advisories: &mut Advisories,
    ) -> AppResult<(ProfileSlug, Vec<ltk_overlay::EnabledMod>)> {
        self.with_index(config, |storage_dir, index| {
            let active_profile_id = index.active_profile_id.clone();
            let active_profile = index
                .profiles
                .iter()
                .find(|p| p.id == active_profile_id)
                .ok_or_else(|| AppError::Other("Active profile not found".to_string()))?;

            let now = Utc::now();
            let mut enabled_mods = Vec::new();

            // Process mods in the order they appear in enabled_mods list (maintains priority)
            for mod_id in &active_profile.enabled_mods {
                let advisory =
                    |code| Advisory::new(code, now).about(AdvisorySubject::mod_id(mod_id.as_str()));

                let Some(entry) = index.mods.iter().find(|m| &m.id == mod_id) else {
                    advisories.raise(advisory(AdvisoryCode::ModMissing));
                    continue;
                };

                if !entry.is_present(storage_dir) {
                    advisories.raise(advisory(AdvisoryCode::ModContentMissing));
                    continue;
                }

                let inputs = entry.content_provider(storage_dir).and_then(|content| {
                    let layers = active_profile.overlay_layers(entry, storage_dir)?;
                    Ok((content, layers))
                });
                let (content, layers) = match inputs {
                    Ok(inputs) => inputs,
                    Err(e) => {
                        advisories.raise(
                            advisory(AdvisoryCode::EntryUnreadable)
                                .with_detail(message_with_sources(&e)),
                        );
                        continue;
                    }
                };
                if layers.unset {
                    advisories.raise(advisory(AdvisoryCode::LayersUnset));
                }

                enabled_mods.push(ltk_overlay::EnabledMod {
                    id: entry.id.clone(),
                    content,
                    enabled_layers: layers.enabled,
                });
            }

            Ok((active_profile.slug.clone(), enabled_mods))
        })
    }
}

/// The layers that the overlay applies for one mod.
struct OverlayLayers {
    /// The layers to apply, or `None` for every layer, which is the default of the
    /// overlay builder.
    enabled: Option<HashSet<String>>,
    /// Whether the mod has several layers and the profile holds no choice for it, so
    /// that `base` alone applies.
    unset: bool,
}

impl Profile {
    /// Resolves the layers that the overlay applies for `entry` under this profile.
    ///
    /// Layers are opt-in. A mod with several layers and no saved choice applies its
    /// always-on `base` layer alone. A mod with one layer applies every layer, so that a
    /// plain mod applies when it is enabled.
    fn overlay_layers(
        &self,
        entry: &LibraryModEntry,
        storage_dir: &Path,
    ) -> AppResult<OverlayLayers> {
        if let Some(states) = self.layer_states.get(&entry.id) {
            let enabled = states
                .iter()
                .filter(|&(_, &enabled)| enabled)
                .map(|(name, _)| name.clone())
                .collect();
            return Ok(OverlayLayers {
                enabled: Some(enabled),
                unset: false,
            });
        }

        let project = load_mod_project(&entry.mod_dir(storage_dir))?;
        if project.layers.len() <= 1 {
            return Ok(OverlayLayers {
                enabled: None,
                unset: false,
            });
        }

        let base = project
            .layers
            .iter()
            .filter(|l| l.name == "base")
            .map(|l| l.name.clone())
            .collect();
        Ok(OverlayLayers {
            enabled: Some(base),
            unset: true,
        })
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
