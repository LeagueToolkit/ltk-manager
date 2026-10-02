//! Read and edit the League client's `LeagueClientSettings.yaml`.

use std::path::PathBuf;

use fs_err as fs;
use serde_yaml_ng::{Mapping, Value};

use crate::error::{AppError, AppResult};
use crate::utils::fs::atomic_write;
use crate::utils::game::GameDir;

/// The League client's `LeagueClientSettings.yaml`, held as a parsed document.
///
/// A generic YAML document rather than a typed projection, because an edit has
/// to hand back every key the client wrote, including the many this app knows
/// nothing about. Layout is not preserved - the file comes back in serde's
/// formatting, which the client reads fine and rewrites in its own style the
/// next time it exits.
#[derive(Debug, Clone)]
pub struct LeagueClientSettings {
    path: PathBuf,
    document: Value,
}

impl LeagueClientSettings {
    /// Read the settings file belonging to `game_dir`'s install.
    ///
    /// # Errors
    ///
    /// When the file is missing, unreadable, or not valid YAML. Missing is the
    /// normal state of an install whose client has never run.
    pub fn read(game_dir: &GameDir) -> AppResult<Self> {
        let path = Self::path_for(game_dir)?;
        let contents = fs::read_to_string(&path)
            .map_err(|e| AppError::Other(format!("Could not read the client settings: {e}")))?;
        let document = serde_yaml_ng::from_str(&contents)
            .map_err(|e| AppError::Other(format!("Failed to parse {}: {e}", path.display())))?;

        Ok(Self { path, document })
    }

    /// The locale the client is configured to use, lowercased (e.g. `"en_us"`).
    ///
    /// Reads `install.globals.locale`. `None` when the key is absent or blank.
    pub fn locale(&self) -> Option<String> {
        let locale = self
            .document
            .get("install")?
            .get("globals")?
            .get("locale")?
            .as_str()?
            .trim()
            .to_lowercase();

        (!locale.is_empty()).then_some(locale)
    }

    /// Whether the client sends crash reports, from `install.crash_reporting.enabled`.
    ///
    /// `None` when the key is absent or not a boolean. The injected DLL only
    /// verifies archives as the game loads them while this is off, so with it on
    /// every WAD is scanned up front regardless of
    /// [`FULL_WAD_SCAN`](crate::patcher::host::hook_flags::FULL_WAD_SCAN).
    pub fn crash_reporting(&self) -> Option<bool> {
        self.document
            .get("install")?
            .get("crash_reporting")?
            .get("enabled")?
            .as_bool()
    }

    /// Turn the client's crash reporting on or off, in memory.
    ///
    /// Writes `install.crash_reporting.enabled`, creating the section when the
    /// client has not written one, and leaves every other key alone. Call
    /// [`save`](Self::save) to put it on disk.
    pub fn set_crash_reporting(&mut self, enabled: bool) {
        let root = Self::as_mapping_mut(&mut self.document);
        let install = Self::child_mapping_mut(root, "install");
        let crash_reporting = Self::child_mapping_mut(install, "crash_reporting");
        crash_reporting.insert(Value::String("enabled".to_owned()), Value::Bool(enabled));
    }

    /// Turn crash reporting off in the client's file, unless it is off already.
    ///
    /// Reports whether the file had to be rewritten. The client rewrites its
    /// settings when it exits, so callers re-apply this rather than treating it
    /// as a one-time change.
    ///
    /// # Errors
    ///
    /// When the file cannot be read, or the write fails.
    pub fn disable_crash_reporting(game_dir: &GameDir) -> AppResult<bool> {
        let mut settings = Self::read(game_dir)?;
        if settings.crash_reporting() == Some(false) {
            return Ok(false);
        }

        settings.set_crash_reporting(false);
        settings.save()?;

        Ok(true)
    }

    /// Write the document back over the file it was read from.
    ///
    /// The client rewrites this file when it exits, so an edit made while it is
    /// running is lost. Callers are expected to have it closed.
    ///
    /// # Errors
    ///
    /// When the document cannot be serialized, or the write fails.
    pub fn save(&self) -> AppResult<()> {
        let yaml = serde_yaml_ng::to_string(&self.document).map_err(|e| {
            AppError::Other(format!("Failed to serialize {}: {e}", self.path.display()))
        })?;

        atomic_write(&self.path, yaml.as_bytes())?;

        Ok(())
    }

    /// `<install root>/Config/LeagueClientSettings.yaml`, the client's own copy.
    fn path_for(game_dir: &GameDir) -> AppResult<PathBuf> {
        let root = game_dir.path().parent().ok_or_else(|| {
            AppError::InvalidPath(format!(
                "Game directory has no install root: {}",
                game_dir.path().display()
            ))
        })?;

        Ok(root.join("Config").join("LeagueClientSettings.yaml"))
    }

    /// The document as a mapping, replacing anything else with an empty one.
    /// An empty file parses as null.
    fn as_mapping_mut(document: &mut Value) -> &mut Mapping {
        if !document.is_mapping() {
            *document = Value::Mapping(Mapping::new());
        }

        document
            .as_mapping_mut()
            .expect("document was just replaced with a mapping")
    }

    /// A nested mapping under `key`, created when absent and overwritten when
    /// the client left something else there.
    fn child_mapping_mut<'a>(parent: &'a mut Mapping, key: &str) -> &'a mut Mapping {
        if !parent.get(key).is_some_and(Value::is_mapping) {
            parent.insert(
                Value::String(key.to_owned()),
                Value::Mapping(Mapping::new()),
            );
        }

        parent
            .get_mut(key)
            .and_then(Value::as_mapping_mut)
            .expect("child was just replaced with a mapping")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirrors the real file's structure, including keys this app never reads.
    const CLIENT_SETTINGS_YAML: &str = r#"
install:
    crash_reporting:
        enabled: true
        type: "crashpad"
    gameflow-patcher-lock: null
    globals:
        locale: "en_US"
        region: "EUW"
    patcher:
        locales:
        - "en_US"
"#;

    const WITHOUT_CRASH_REPORTING_YAML: &str = r#"
install:
    globals:
        locale: "en_US"
"#;

    fn install_with(yaml: &str) -> (tempfile::TempDir, GameDir) {
        let tmp = tempfile::tempdir().unwrap();
        let config_dir = tmp.path().join("Config");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(config_dir.join("LeagueClientSettings.yaml"), yaml).unwrap();
        let game_dir = GameDir::from_path(tmp.path().join("Game"));

        (tmp, game_dir)
    }

    #[test]
    fn reads_crash_reporting_and_locale() {
        let (_tmp, game_dir) = install_with(CLIENT_SETTINGS_YAML);
        let settings = LeagueClientSettings::read(&game_dir).unwrap();

        assert_eq!(settings.crash_reporting(), Some(true));
        assert_eq!(settings.locale().as_deref(), Some("en_us"));
    }

    #[test]
    fn crash_reporting_is_unknown_when_the_client_never_wrote_it() {
        let (_tmp, game_dir) = install_with(WITHOUT_CRASH_REPORTING_YAML);
        let settings = LeagueClientSettings::read(&game_dir).unwrap();

        assert_eq!(settings.crash_reporting(), None);
    }

    #[test]
    fn reading_a_missing_file_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = GameDir::from_path(tmp.path().join("Game"));

        assert!(LeagueClientSettings::read(&game_dir).is_err());
    }

    /// The client owns this file - an edit that dropped a key it wrote would
    /// reset whatever that key configures.
    #[test]
    fn turning_crash_reporting_off_keeps_every_other_key() {
        let (_tmp, game_dir) = install_with(CLIENT_SETTINGS_YAML);
        let mut settings = LeagueClientSettings::read(&game_dir).unwrap();

        settings.set_crash_reporting(false);
        settings.save().unwrap();

        let reread = LeagueClientSettings::read(&game_dir).unwrap();
        assert_eq!(reread.crash_reporting(), Some(false));
        assert_eq!(reread.locale().as_deref(), Some("en_us"));

        let install = reread.document.get("install").unwrap();
        assert_eq!(
            install.get("crash_reporting").unwrap().get("type").unwrap(),
            &Value::String("crashpad".to_owned())
        );
        assert!(install.get("gameflow-patcher-lock").is_some());
        assert!(install.get("patcher").unwrap().get("locales").is_some());
    }

    #[test]
    fn crash_reporting_can_be_set_without_an_existing_section() {
        let (_tmp, game_dir) = install_with(WITHOUT_CRASH_REPORTING_YAML);
        let mut settings = LeagueClientSettings::read(&game_dir).unwrap();

        settings.set_crash_reporting(false);
        settings.save().unwrap();

        let reread = LeagueClientSettings::read(&game_dir).unwrap();
        assert_eq!(reread.crash_reporting(), Some(false));
        assert_eq!(reread.locale().as_deref(), Some("en_us"));
    }

    #[test]
    fn disabling_crash_reporting_reports_whether_the_file_changed() {
        let (_tmp, game_dir) = install_with(CLIENT_SETTINGS_YAML);

        assert!(LeagueClientSettings::disable_crash_reporting(&game_dir).unwrap());
        assert!(!LeagueClientSettings::disable_crash_reporting(&game_dir).unwrap());

        let settings = LeagueClientSettings::read(&game_dir).unwrap();
        assert_eq!(settings.crash_reporting(), Some(false));
    }

    #[test]
    fn saving_leaves_no_temporary_file_behind() {
        let (tmp, game_dir) = install_with(CLIENT_SETTINGS_YAML);
        let mut settings = LeagueClientSettings::read(&game_dir).unwrap();

        settings.set_crash_reporting(false);
        settings.save().unwrap();

        let tmp_file = tmp
            .path()
            .join("Config")
            .join(".LeagueClientSettings.yaml.tmp");
        assert!(!tmp_file.exists());
    }
}
