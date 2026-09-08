//! Detection of the League client's configured locale.

use crate::utils::client_settings::LeagueClientSettings;
use crate::utils::game::GameDir;

/// The locale the League client is configured to use, lowercased, e.g. `"en_us"`.
///
/// The first source is `install.globals.locale` in
/// `<league root>/Config/LeagueClientSettings.yaml`. The second is the game's
/// installed localized WADs, conclusive at exactly one installed locale. `None`
/// stands for neither source being conclusive.
pub fn detect_league_locale(game_dir: &GameDir) -> Option<String> {
    if let Some(locale) = locale_from_client_settings(game_dir) {
        return Some(locale);
    }

    match game_dir.installed_locales().as_slice() {
        [single] => {
            tracing::info!(
                "Locale not found in LeagueClientSettings.yaml; using sole installed locale '{}'",
                single
            );
            Some(single.clone())
        }
        [] => {
            tracing::warn!("Could not detect League locale: no localized Global WADs found");
            None
        }
        multiple => {
            tracing::warn!(
                "Could not detect League locale: multiple locales installed ({:?})",
                multiple
            );
            None
        }
    }
}

fn locale_from_client_settings(game_dir: &GameDir) -> Option<String> {
    let settings = LeagueClientSettings::read(game_dir)
        .inspect_err(|e| tracing::debug!("Could not read the League client settings: {e}"))
        .ok()?;
    let locale = settings.locale()?;
    tracing::info!("Detected League locale '{}' from client settings", locale);

    Some(locale)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_err as fs;

    /// Mirrors the real file's structure, including unrelated keys.
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

    fn league_root_with(yaml: Option<&str>, locales: &[&str]) -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        if let Some(yaml) = yaml {
            let config_dir = tmp.path().join("Config");
            fs::create_dir_all(&config_dir).unwrap();
            fs::write(config_dir.join("LeagueClientSettings.yaml"), yaml).unwrap();
        }
        let localized = tmp.path().join("Game/DATA/FINAL/Localized");
        fs::create_dir_all(&localized).unwrap();
        for locale in locales {
            fs::write(localized.join(format!("Global.{locale}.wad.client")), b"").unwrap();
        }
        tmp
    }

    #[test]
    fn reads_locale_from_client_settings() {
        let root = league_root_with(Some(CLIENT_SETTINGS_YAML), &["en_US", "ko_KR"]);
        let locale = detect_league_locale(&GameDir::from_path(root.path().join("Game")));
        assert_eq!(locale.as_deref(), Some("en_us"));
    }

    #[test]
    fn falls_back_to_sole_installed_locale() {
        let root = league_root_with(None, &["ko_KR"]);
        let locale = detect_league_locale(&GameDir::from_path(root.path().join("Game")));
        assert_eq!(locale.as_deref(), Some("ko_kr"));
    }

    #[test]
    fn ambiguous_install_without_settings_returns_none() {
        let root = league_root_with(None, &["en_US", "ko_KR"]);
        assert_eq!(
            detect_league_locale(&GameDir::from_path(root.path().join("Game"))),
            None
        );
    }

    #[test]
    fn malformed_yaml_falls_back_to_scan() {
        let root = league_root_with(Some(":: not yaml ["), &["en_US"]);
        let locale = detect_league_locale(&GameDir::from_path(root.path().join("Game")));
        assert_eq!(locale.as_deref(), Some("en_us"));
    }

    #[test]
    fn missing_locale_key_falls_back_to_scan() {
        let root = league_root_with(
            Some("install:\n    globals:\n        region: \"EUW\"\n"),
            &["en_US"],
        );
        let locale = detect_league_locale(&GameDir::from_path(root.path().join("Game")));
        assert_eq!(locale.as_deref(), Some("en_us"));
    }
}
