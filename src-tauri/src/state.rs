use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
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

/// Load settings from disk, returning defaults if file doesn't exist.
pub fn load_settings(app_handle: &AppHandle) -> Settings {
    let Some(settings_path) = get_settings_file_path(app_handle) else {
        tracing::warn!("Could not determine settings file path, using defaults");
        return Settings::default();
    };

    if !settings_path.exists() {
        tracing::info!("Settings file not found, using defaults");
        return Settings::default();
    }

    match fs::read_to_string(&settings_path) {
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
    app_handle: &AppHandle,
    settings: &Settings,
) -> Result<(), std::io::Error> {
    let Some(settings_path) = get_settings_file_path(app_handle) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not determine settings file path",
        ));
    };

    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let contents = serde_json::to_string_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    fs::write(&settings_path, contents)?;
    tracing::info!("Saved settings to {:?}", settings_path);

    Ok(())
}

/// Application settings state.
pub struct SettingsState(pub Mutex<Settings>);

impl SettingsState {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self(Mutex::new(load_settings(app_handle)))
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

/// Accent color configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AccentColor {
    /// Preset color name: "blue", "purple", "green", "orange", "pink", "red", "teal"
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

fn default_wad_blocklist() -> Vec<WadBlocklistEntry> {
    vec![]
}

/// A single entry in the WAD blocklist.
///
/// `Exact` matches a literal filename (case-insensitively). `Regex` matches
/// against every WAD filename in the game install; the pattern is always
/// applied case-insensitively.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WadBlocklistEntry {
    Exact { value: String },
    Regex { value: String },
}

/// Accepts both the legacy `["Name.wad.client", ...]` format and the new
/// tagged `[{ "kind": "exact", "value": "..." }, ...]` format. Legacy strings
/// are migrated to `Exact` entries.
fn deserialize_wad_blocklist<'de, D>(deserializer: D) -> Result<Vec<WadBlocklistEntry>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum RawEntry {
        Legacy(String),
        Tagged(WadBlocklistEntry),
    }

    let raw: Vec<RawEntry> = Vec::deserialize(deserializer)?;
    Ok(raw
        .into_iter()
        .map(|entry| match entry {
            RawEntry::Legacy(value) => WadBlocklistEntry::Exact { value },
            RawEntry::Tagged(entry) => entry,
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[ts(as = "Option<String>")]
    pub league_path: Option<PathBuf>,
    #[ts(as = "Option<String>")]
    pub mod_storage_path: Option<PathBuf>,
    /// Directory where mod projects are stored (for Creator Workshop).
    #[ts(as = "Option<String>")]
    pub workshop_path: Option<PathBuf>,
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
    /// Whether to patch TFT game files (Map22.wad.client). Default: false.
    #[serde(default)]
    pub patch_tft: bool,
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
    /// Whether the user has dismissed the cslol-manager migration banner.
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
    /// Whether to block mods from patching Scripts.wad.client. Default: true.
    #[serde(default = "default_true")]
    pub block_scripts_wad: bool,
    /// Additional WAD files to exclude from overlay building.
    #[serde(
        default = "default_wad_blocklist",
        deserialize_with = "deserialize_wad_blocklist"
    )]
    pub wad_blocklist: Vec<WadBlocklistEntry>,
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
            league_path: None,
            mod_storage_path: None,
            workshop_path: None,
            first_run_complete: false,
            theme: Theme::default(),
            accent_color: AccentColor::default(),
            backdrop_image: None,
            backdrop_blur: None,
            library_view_mode: None,
            patch_tft: false,
            minimize_to_tray: true,
            start_in_tray: false,
            auto_run: false,
            start_in_tray_unless_update: false,
            always_start_patcher: false,
            migration_dismissed: false,
            reload_mods_hotkey: None,
            kill_league_hotkey: None,
            kill_league_stops_patcher: true,
            trusted_domains: default_trusted_domains(),
            watcher_enabled: false,
            block_scripts_wad: true,
            wad_blocklist: default_wad_blocklist(),
            author_profiles: vec![],
            default_author_profile_id: None,
            has_seen_hdd_warning: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_values() {
        let settings = Settings::default();
        assert!(settings.league_path.is_none());
        assert!(settings.mod_storage_path.is_none());
        assert!(settings.workshop_path.is_none());
        assert!(!settings.first_run_complete);
        assert_eq!(settings.theme, Theme::System);
        assert!(!settings.patch_tft);
        assert!(settings.minimize_to_tray);
        assert!(!settings.migration_dismissed);
        assert!(settings.reload_mods_hotkey.is_none());
        assert!(settings.kill_league_hotkey.is_none());
        assert!(settings.kill_league_stops_patcher);
        assert!(settings.block_scripts_wad);
        assert!(settings.wad_blocklist.is_empty());
    }

    #[test]
    fn settings_json_round_trip() {
        let settings = Settings {
            league_path: Some(PathBuf::from("/game")),
            mod_storage_path: Some(PathBuf::from("/mods")),
            workshop_path: None,
            first_run_complete: true,
            theme: Theme::Dark,
            accent_color: AccentColor {
                preset: Some("purple".to_string()),
                custom_hue: None,
            },
            backdrop_image: None,
            backdrop_blur: Some(40),
            library_view_mode: Some("list".to_string()),
            patch_tft: true,
            minimize_to_tray: true,
            start_in_tray: false,
            auto_run: false,
            start_in_tray_unless_update: false,
            always_start_patcher: false,
            migration_dismissed: false,
            reload_mods_hotkey: Some("Ctrl+Shift+R".to_string()),
            kill_league_hotkey: None,
            kill_league_stops_patcher: true,
            trusted_domains: vec!["runeforge.dev".to_string()],
            watcher_enabled: false,
            block_scripts_wad: true,
            wad_blocklist: vec![],
            author_profiles: vec![AuthorProfile {
                id: "test-id".to_string(),
                name: "Test Author".to_string(),
                role: Some("3D Artist".to_string()),
            }],
            default_author_profile_id: Some("test-id".to_string()),
            has_seen_hdd_warning: false,
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.league_path.unwrap(), PathBuf::from("/game"));
        assert!(deserialized.first_run_complete);
        assert_eq!(deserialized.author_profiles.len(), 1);
        assert_eq!(deserialized.author_profiles[0].name, "Test Author");
        assert_eq!(deserialized.default_author_profile_id.unwrap(), "test-id");
        assert_eq!(deserialized.theme, Theme::Dark);
        assert!(deserialized.patch_tft);
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
        assert!(settings.league_path.is_none());
        assert!(settings.mod_storage_path.is_none());
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
        assert_eq!(settings.wad_blocklist.len(), 2);
        assert_eq!(
            settings.wad_blocklist[0],
            WadBlocklistEntry::Exact {
                value: "Map12.wad.client".to_string()
            }
        );
        assert_eq!(
            settings.wad_blocklist[1],
            WadBlocklistEntry::Exact {
                value: "Aatrox.wad.client".to_string()
            }
        );
    }

    #[test]
    fn wad_blocklist_accepts_tagged_entries() {
        let json = r#"{
            "firstRunComplete": false, "theme": "system", "accentColor": {},
            "patchTft": false, "migrationDismissed": false,
            "wadBlocklist": [
                { "kind": "exact", "value": "Map12.wad.client" },
                { "kind": "regex", "value": "^map\\d+\\.en_us\\.wad\\.client$" }
            ]
        }"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.wad_blocklist.len(), 2);
        assert!(matches!(
            settings.wad_blocklist[0],
            WadBlocklistEntry::Exact { .. }
        ));
        assert!(matches!(
            settings.wad_blocklist[1],
            WadBlocklistEntry::Regex { .. }
        ));
    }

    #[test]
    fn wad_blocklist_mixed_legacy_and_tagged() {
        let json = r#"{
            "firstRunComplete": false, "theme": "system", "accentColor": {},
            "patchTft": false, "migrationDismissed": false,
            "wadBlocklist": [
                "Legacy.wad.client",
                { "kind": "regex", "value": "^tft" }
            ]
        }"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.wad_blocklist.len(), 2);
        assert_eq!(
            settings.wad_blocklist[0],
            WadBlocklistEntry::Exact {
                value: "Legacy.wad.client".to_string()
            }
        );
        assert_eq!(
            settings.wad_blocklist[1],
            WadBlocklistEntry::Regex {
                value: "^tft".to_string()
            }
        );
    }

    #[test]
    fn wad_blocklist_serializes_as_tagged() {
        let entries = vec![
            WadBlocklistEntry::Exact {
                value: "foo.wad.client".to_string(),
            },
            WadBlocklistEntry::Regex {
                value: "bar".to_string(),
            },
        ];
        let json = serde_json::to_value(&entries).unwrap();
        assert_eq!(json[0]["kind"], "exact");
        assert_eq!(json[0]["value"], "foo.wad.client");
        assert_eq!(json[1]["kind"], "regex");
        assert_eq!(json[1]["value"], "bar");
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
