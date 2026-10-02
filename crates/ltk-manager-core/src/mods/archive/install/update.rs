//! Replacement archives under an existing library identity.

use super::*;

impl ModLibrary {
    /// Replace a mod's archive while retaining its library identity and profile choices.
    ///
    /// # Errors
    ///
    /// Fails if the mod is missing, the archive is invalid, or replacement files cannot be saved.
    pub fn update_mod_from_package(
        &self,
        config: &Config,
        mod_id: &str,
        file_path: &str,
    ) -> AppResult<InstalledMod> {
        let storage_dir = self.storage_dir(config)?;
        let resolver = self.wad_resolver();
        let staged = stage_mod_package(
            &storage_dir,
            file_path,
            &InstallContext {
                resolver: resolver.as_ref(),
            },
        )?;
        let result = self.mutate_index(config, |storage_dir, index| {
            let pos = index
                .mods
                .iter()
                .position(|entry| entry.id == mod_id)
                .ok_or_else(|| AppError::ModNotFound(mod_id.to_owned()))?;
            let mut entry = index.mods[pos].clone();
            let project = load_mod_project(&staged.staging_dir)?;
            let mut replacement = Replacement::new(storage_dir, &entry, &staged);
            replacement.install(&staged)?;
            entry.format = staged.format;
            entry.storage = staged.format.installed_storage();
            entry.harvest = staged.harvest;
            index.mods[pos] = entry.clone();
            for profile in &mut index.profiles {
                if let Some(states) = profile.layer_states.get_mut(mod_id) {
                    states.retain(|name, _| project.layers.iter().any(|layer| &layer.name == name));
                }
            }
            let (enabled, layers) = index.profile_state(mod_id);
            let mut installed = read_installed_mod(&entry, enabled, storage_dir, layers)?;
            installed.folder_id = index
                .folders
                .iter()
                .find(|folder| folder.mod_ids.iter().any(|id| id == mod_id))
                .map(|folder| folder.id.clone());
            self.invalidate_overlay_for(storage_dir, &[mod_id.to_owned()]);
            self.forget_health_check(storage_dir, mod_id);
            Ok((replacement, installed))
        });
        staged.discard();
        let (mut replacement, installed) = result?;
        replacement.commit();
        Ok(installed)
    }
}

/// File moves held reversible until the index write succeeds.
#[derive(Debug)]
struct Replacement {
    mod_dir: PathBuf,
    archive: PathBuf,
    old_archive: PathBuf,
    backup_dir: PathBuf,
    backup_archive: PathBuf,
    directory_backed_up: bool,
    archive_backed_up: bool,
    directory_installed: bool,
    archive_installed: bool,
    committed: bool,
}

impl Replacement {
    fn new(storage: &Path, entry: &LibraryModEntry, staged: &StagedMod) -> Self {
        let mut updated = entry.clone();
        updated.format = staged.format;
        let backup = storage.mods_dir().join(format!(".update-{}", staged.id));
        Self {
            mod_dir: entry.mod_dir(storage),
            archive: updated.archive_path(storage),
            old_archive: entry.archive_path(storage),
            backup_dir: backup.clone(),
            backup_archive: backup.with_extension("archive"),
            directory_backed_up: false,
            archive_backed_up: false,
            directory_installed: false,
            archive_installed: false,
            committed: false,
        }
    }

    fn install(&mut self, staged: &StagedMod) -> AppResult<()> {
        if self.archive != self.old_archive && fs::exists(&self.archive)? {
            return Err(AppError::Other(format!(
                "Replacement archive already exists: {}",
                self.archive.display()
            )));
        }
        if fs::exists(&self.mod_dir)? {
            fs::rename(&self.mod_dir, &self.backup_dir)?;
            self.directory_backed_up = true;
        }
        if fs::exists(&self.old_archive)? {
            fs::rename(&self.old_archive, &self.backup_archive)?;
            self.archive_backed_up = true;
        }
        fs::rename(&staged.staging_dir, &self.mod_dir)?;
        self.directory_installed = true;
        fs::rename(&staged.staged_archive, &self.archive)?;
        self.archive_installed = true;
        Ok(())
    }

    fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for Replacement {
    fn drop(&mut self) {
        let report = |result: std::io::Result<()>| {
            if let Err(error) = result {
                tracing::error!(%error, "Could not finish mod replacement cleanup");
            }
        };
        if self.committed {
            if self.directory_backed_up {
                report(fs::remove_dir_all(&self.backup_dir));
            }
            if self.archive_backed_up {
                report(fs::remove_file(&self.backup_archive));
            }
        } else {
            if self.archive_installed {
                report(fs::remove_file(&self.archive));
            }
            if self.directory_installed {
                report(fs::remove_dir_all(&self.mod_dir));
            }
            if self.directory_backed_up {
                report(fs::rename(&self.backup_dir, &self.mod_dir));
            }
            if self.archive_backed_up {
                report(fs::rename(&self.backup_archive, &self.old_archive));
            }
        }
    }
}
