use crate::error::{AppResult, MutexResultExt};
use ltk_manager_core::config::Config;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use ts_rs::TS;

/// Get the application data directory for storing settings using Tauri's path resolver.
pub fn get_app_data_dir(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle.path().app_data_dir().ok()
}

/// Get the path to the settings file.
pub fn get_settings_file_path(app_handle: &AppHandle) -> Option<PathBuf> {
    get_app_data_dir(app_handle).map(|p| p.join("settings.json"))
}

/// Load settings from disk, returning defaults if the file doesn't exist.
pub fn load_settings(settings_path: &Path) -> Settings {
    if !settings_path.exists() {
        tracing::info!("Settings file not found, using defaults");
        return Settings::default();
    }

    match fs::read_to_string(settings_path) {
        Ok(contents) => match serde_json::from_str(&contents) {
            Ok(settings) => {
                tracing::info!("Loaded settings from {:?}", settings_path);
                settings
            }
            Err(e) => {
                tracing::error!("Failed to parse settings file: {}", e);
                Settings::default()
            }
        },
        Err(e) => {
            tracing::error!("Failed to read settings file: {}", e);
            Settings::default()
        }
    }
}

/// Save settings to disk.
pub fn save_settings_to_disk(
    settings_path: &Path,
    settings: &Settings,
) -> Result<(), std::io::Error> {
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let contents = serde_json::to_string_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    fs::write(settings_path, contents)?;
    tracing::info!("Saved settings to {:?}", settings_path);

    Ok(())
}

/// Resolve the settings path from the app handle and save.
pub fn persist_settings(app_handle: &AppHandle, settings: &Settings) -> Result<(), std::io::Error> {
    let Some(settings_path) = get_settings_file_path(app_handle) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not determine settings file path",
        ));
    };
    save_settings_to_disk(&settings_path, settings)
}

/// Application settings state.
pub struct SettingsState(pub Mutex<Settings>);

impl SettingsState {
    pub fn new(app_handle: &AppHandle) -> Self {
        let settings = match get_settings_file_path(app_handle) {
            Some(path) => load_settings(&path),
            None => {
                tracing::warn!("Could not determine settings file path, using defaults");
                Settings::default()
            }
        };
        Self(Mutex::new(settings))
    }

    /// Snapshot the patching-relevant configuration.
    ///
    /// Callers take a clone rather than holding the guard: settings can change
    /// at runtime, and every consumer downstream (`ModLibrary`, `Workshop`, the
    /// overlay builder, the patcher thread) is designed around a per-operation
    /// snapshot. Centralizing it here keeps poison handling in one place.
    pub fn config(&self) -> AppResult<Config> {
        Ok(self.0.lock().mutex_err()?.config.clone())
    }
}

impl Default for SettingsState {
    fn default() -> Self {
        Self(Mutex::new(Settings::default()))
    }
}

/// Theme selection for the application.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Dark,
    Light,
}

/// What the library's primary button is.
///
/// `Classic` is the behaviour from before the manager could launch anything:
/// the button only starts the patcher, and the game is started wherever the
/// user started it before. `Modern` makes it the whole path in one click -
/// build the overlay, start the patcher, then ask the Riot Client to start
/// League. Both actions stay reachable from the button's menu either way.
///
/// Classic is the default while the launcher is experimental: it is the
/// behaviour every existing install already has, and it depends on nothing
/// outside this app.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum LaunchMode {
    #[default]
    Classic,
    Modern,
}

/// Accent color configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AccentColor {
    /// Preset name: "ltk" (the brand accent), or one of the generated hues
    /// "blue", "purple", "green", "orange", "pink", "red", "teal". `None` is
    /// read as "ltk" by the frontend.
    pub preset: Option<String>,
    /// Custom hue value (0-360) for custom colors
    pub custom_hue: Option<f32>,
}

/// A saved author profile that can be reused across workshop projects.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AuthorProfile {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_trusted_domains() -> Vec<String> {
    vec!["runeforge.dev".to_string(), "divineskins.gg".to_string()]
}

/// Application settings: UI/shell preferences plus the flattened core
/// [`Config`]. The flatten keeps `settings.json` a single flat document, so
/// the split is invisible to both the file on disk and the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Patching-relevant configuration shared with non-GUI frontends.
    #[serde(flatten)]
    pub config: Config,
    pub first_run_complete: bool,
    /// Application theme (system, dark, or light).
    pub theme: Theme,
    /// Accent color configuration.
    pub accent_color: AccentColor,
    /// Optional backdrop image path for glassmorphism effect.
    #[ts(as = "Option<String>")]
    pub backdrop_image: Option<PathBuf>,
    /// Backdrop blur amount in pixels (default: 40).
    pub backdrop_blur: Option<u32>,
    /// Library view mode ("grid" or "list"). Defaults to "grid".
    pub library_view_mode: Option<String>,
    /// Whether to minimize to system tray instead of taskbar. Default: true.
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
    /// Whether to start the application minimized to the system tray. Default: false.
    #[serde(default)]
    pub start_in_tray: bool,
    /// Whether to register the app to launch automatically on login. Default: false.
    #[serde(default)]
    pub auto_run: bool,
    /// When starting in tray, show the window if an update is available. Default: false.
    #[serde(default)]
    pub start_in_tray_unless_update: bool,
    /// Always start the patcher automatically on launch. Default: false.
    #[serde(default)]
    pub always_start_patcher: bool,
    /// What the library's primary button does. Default: [`LaunchMode::Classic`],
    /// so an install that predates the launcher keeps the button it had.
    #[serde(default)]
    pub launch_mode: LaunchMode,
    /// Whether the user has dismissed the migration banner.
    #[serde(default)]
    pub migration_dismissed: bool,
    /// Global hotkey accelerator for reloading mods (e.g. "Ctrl+Shift+R").
    #[serde(default)]
    pub reload_mods_hotkey: Option<String>,
    /// Global hotkey accelerator for killing League (e.g. "Ctrl+Shift+K").
    #[serde(default)]
    pub kill_league_hotkey: Option<String>,
    /// Whether the kill-league hotkey should also stop the patcher. Default: true.
    #[serde(default = "default_true")]
    pub kill_league_stops_patcher: bool,
    /// Trusted domains for protocol installs. Downloads are only allowed from these domains.
    #[serde(default = "default_trusted_domains")]
    pub trusted_domains: Vec<String>,
    /// Whether the library file watcher is enabled. Default: false.
    #[serde(default)]
    pub watcher_enabled: bool,
    #[serde(default)]
    pub author_profiles: Vec<AuthorProfile>,
    #[serde(default)]
    pub default_author_profile_id: Option<String>,
    /// Whether the user has dismissed the HDD-performance warning. Once true,
    /// we suppress the warning on subsequent patcher starts. Reset by toggling
    /// the "show performance warnings" setting if/when we add one.
    #[serde(default)]
    pub has_seen_hdd_warning: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            config: Config::default(),
            first_run_complete: false,
            theme: Theme::default(),
            accent_color: AccentColor::default(),
            backdrop_image: None,
            backdrop_blur: None,
            library_view_mode: None,
            minimize_to_tray: true,
            start_in_tray: false,
            auto_run: false,
            start_in_tray_unless_update: false,
            always_start_patcher: false,
            launch_mode: LaunchMode::default(),
            migration_dismissed: false,
            reload_mods_hotkey: None,
            kill_league_hotkey: None,
            kill_league_stops_patcher: true,
            trusted_domains: default_trusted_domains(),
            watcher_enabled: false,
            author_profiles: vec![],
            default_author_profile_id: None,
            has_seen_hdd_warning: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ltk_manager_core::config::WadBlocklistEntry;

    #[test]
    fn settings_default_values() {
        let settings = Settings::default();
        assert!(settings.config.league_path.is_none());
        assert!(settings.config.mod_storage_path.is_none());
        assert!(settings.config.workshop_path.is_none());
        assert!(!settings.first_run_complete);
        assert_eq!(settings.theme, Theme::System);
        assert!(!settings.config.patch_tft);
        assert!(settings.minimize_to_tray);
        assert!(!settings.migration_dismissed);
        assert!(settings.reload_mods_hotkey.is_none());
        assert!(settings.kill_league_hotkey.is_none());
        assert!(settings.kill_league_stops_patcher);
        assert!(settings.config.block_scripts_wad);
        assert!(settings.config.linked_bin_check_enabled);
        assert!(settings.config.wad_blocklist.is_empty());
        assert!(settings.config.auto_categorization_enabled);
        assert!(settings.config.enforce_skinhack_scan);
        assert!(!settings.config.apply_string_overrides_to_all_locales);
        assert!(!settings.config.verbose_patcher_logging);
        assert!(!settings.config.lazy_wad_scan);
        assert_eq!(settings.launch_mode, LaunchMode::Classic);
    }

    #[test]
    fn launch_mode_serialization() {
        assert_eq!(
            serde_json::to_string(&LaunchMode::Classic).unwrap(),
            "\"classic\""
        );
        assert_eq!(
            serde_json::to_string(&LaunchMode::Modern).unwrap(),
            "\"modern\""
        );
    }

    /// A settings file written before the manager could launch anything keeps
    /// the patcher-only button it was written with - the launcher is opt-in
    /// while it is experimental.
    #[test]
    fn launch_mode_defaults_to_classic_when_absent() {
        let json = r#"{"firstRunComplete": false, "theme": "system", "accentColor": {}, "patchTft": false, "migrationDismissed": false}"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.launch_mode, LaunchMode::Classic);
    }

    #[test]
    fn launch_mode_round_trips() {
        let settings = Settings {
            launch_mode: LaunchMode::Modern,
            ..Settings::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.launch_mode, LaunchMode::Modern);
    }

    #[test]
    fn settings_json_round_trip() {
        let settings = Settings {
            config: Config {
                league_path: Some(PathBuf::from("/game")),
                mod_storage_path: Some(PathBuf::from("/mods")),
                patch_tft: true,
                ..Config::default()
            },
            first_run_complete: true,
            theme: Theme::Dark,
            accent_color: AccentColor {
                preset: Some("purple".to_string()),
                custom_hue: None,
            },
            backdrop_blur: Some(40),
            library_view_mode: Some("list".to_string()),
            reload_mods_hotkey: Some("Ctrl+Shift+R".to_string()),
            trusted_domains: vec!["runeforge.dev".to_string()],
            author_profiles: vec![AuthorProfile {
                id: "test-id".to_string(),
                name: "Test Author".to_string(),
                role: Some("3D Artist".to_string()),
            }],
            default_author_profile_id: Some("test-id".to_string()),
            ..Settings::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(
            deserialized.config.league_path.unwrap(),
            PathBuf::from("/game")
        );
        assert!(deserialized.first_run_complete);
        assert_eq!(deserialized.author_profiles.len(), 1);
        assert_eq!(deserialized.author_profiles[0].name, "Test Author");
        assert_eq!(deserialized.default_author_profile_id.unwrap(), "test-id");
        assert_eq!(deserialized.theme, Theme::Dark);
        assert!(deserialized.config.patch_tft);
    }

    /// The `Config` flatten must keep the on-disk format flat, with config keys
    /// at the top level and no nested `config` object.
    #[test]
    fn settings_serialize_flat() {
        let settings = Settings {
            config: Config {
                league_path: Some(PathBuf::from("/game")),
                ..Config::default()
            },
            ..Settings::default()
        };
        let json = serde_json::to_value(&settings).unwrap();
        assert_eq!(json["leaguePath"], "/game");
        assert_eq!(json["enforceSkinhackScan"], true);
        assert!(json.get("config").is_none());
    }

    #[test]
    fn theme_serialization() {
        assert_eq!(serde_json::to_string(&Theme::System).unwrap(), "\"system\"");
        assert_eq!(serde_json::to_string(&Theme::Dark).unwrap(), "\"dark\"");
        assert_eq!(serde_json::to_string(&Theme::Light).unwrap(), "\"light\"");
    }

    #[test]
    fn theme_deserialization() {
        assert_eq!(
            serde_json::from_str::<Theme>("\"system\"").unwrap(),
            Theme::System
        );
        assert_eq!(
            serde_json::from_str::<Theme>("\"dark\"").unwrap(),
            Theme::Dark
        );
        assert_eq!(
            serde_json::from_str::<Theme>("\"light\"").unwrap(),
            Theme::Light
        );
    }

    #[test]
    fn settings_deserializes_with_missing_optional_fields() {
        let json = r#"{"firstRunComplete": false, "theme": "system", "accentColor": {}, "patchTft": false, "migrationDismissed": false}"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert!(settings.config.league_path.is_none());
        assert!(settings.config.mod_storage_path.is_none());
        assert!(!settings.first_run_complete);
    }

    #[test]
    fn wad_blocklist_accepts_legacy_string_array() {
        let json = r#"{
            "firstRunComplete": false, "theme": "system", "accentColor": {},
            "patchTft": false, "migrationDismissed": false,
            "wadBlocklist": ["Map12.wad.client", "Aatrox.wad.client"]
        }"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.config.wad_blocklist.len(), 2);
        assert_eq!(
            settings.config.wad_blocklist[0],
            WadBlocklistEntry::Exact {
                value: "Map12.wad.client".to_string()
            }
        );
        assert_eq!(
            settings.config.wad_blocklist[1],
            WadBlocklistEntry::Exact {
                value: "Aatrox.wad.client".to_string()
            }
        );
    }

    #[test]
    fn wad_blocklist_serializes_as_tagged_through_settings() {
        let settings = Settings {
            config: Config {
                wad_blocklist: vec![
                    WadBlocklistEntry::Exact {
                        value: "foo.wad.client".to_string(),
                    },
                    WadBlocklistEntry::Regex {
                        value: "bar".to_string(),
                    },
                ],
                ..Config::default()
            },
            ..Settings::default()
        };
        let json = serde_json::to_value(&settings).unwrap();
        assert_eq!(json["wadBlocklist"][0]["kind"], "exact");
        assert_eq!(json["wadBlocklist"][0]["value"], "foo.wad.client");
        assert_eq!(json["wadBlocklist"][1]["kind"], "regex");
        assert_eq!(json["wadBlocklist"][1]["value"], "bar");
    }

    #[test]
    fn kill_league_stops_patcher_defaults_to_true() {
        let json = r#"{"firstRunComplete": false, "theme": "system", "accentColor": {}, "patchTft": false, "migrationDismissed": false}"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert!(settings.kill_league_stops_patcher);
        assert!(settings.reload_mods_hotkey.is_none());
        assert!(settings.kill_league_hotkey.is_none());
    }
}
