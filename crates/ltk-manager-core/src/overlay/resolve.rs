//! Turning user settings into concrete builder inputs.
//!
//! Both of these are pure: settings plus a look at the game directory, in and a
//! resolved value out. They are the two decisions a CLI would need to make
//! identically to the GUI.

use crate::config::{Config, WadBlocklistEntry};
use crate::utils::game::GameDir;

const SCRIPTS_WAD: &str = "scripts.wad.client";
const TFT_WAD: &str = "map22.wad.client";

/// Resolve which locales mods' string overrides should be applied to.
///
/// With the "all locales" setting on, every installed locale is patched.
/// Otherwise only the locale the League client is configured to use — read
/// from `LeagueClientSettings.yaml`, falling back to the sole installed locale
/// and finally to `en_us` so string overrides still apply on unusual installs.
pub(crate) fn resolve_string_override_mode(
    config: &Config,
    game_dir: &GameDir,
) -> ltk_overlay::StringOverrideMode {
    if config.apply_string_overrides_to_all_locales {
        return ltk_overlay::StringOverrideMode::AllInstalled;
    }

    let locale = game_dir.locale().unwrap_or_else(|| {
        tracing::warn!("Falling back to 'en_us' for string overrides");
        "en_us".to_string()
    });
    ltk_overlay::StringOverrideMode::Locales(vec![locale])
}

/// Resolve the user's blocklist settings into a concrete, deduped list of WAD
/// filenames to hand to `ltk_overlay::OverlayBuilder::with_blocked_wads`.
///
/// - `Exact` entries are lowercased and passed through as-is.
/// - `Regex` entries are compiled case-insensitively and expanded against
///   `available_wads`; invalid patterns are logged and skipped so one bad entry
///   can't break the whole patch.
/// - `block_scripts_wad` and `!patch_tft` add their respective WADs.
///
/// `available_wads` should come from [`GameDir::wads`](crate::utils::game::GameDir::wads); pass an empty slice if
/// enumeration failed (regex entries then match nothing).
pub(crate) fn resolve_blocked_wads(config: &Config, available_wads: &[String]) -> Vec<String> {
    let mut blocked: Vec<String> = Vec::new();

    for entry in &config.wad_blocklist {
        match entry {
            WadBlocklistEntry::Exact { value } => {
                blocked.push(value.to_lowercase());
            }
            WadBlocklistEntry::Regex { value } => {
                match regex::Regex::new(&format!("(?i){}", value)) {
                    Ok(re) => {
                        for wad in available_wads {
                            if re.is_match(wad) {
                                blocked.push(wad.clone());
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Invalid regex in wad_blocklist {:?}: {}", value, e);
                    }
                }
            }
        }
    }

    if config.block_scripts_wad {
        blocked.push(SCRIPTS_WAD.to_string());
    }
    if !config.patch_tft {
        blocked.push(TFT_WAD.to_string());
    }

    blocked.sort();
    blocked.dedup();
    blocked
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_blocked_wads_exact_lowercased_and_scripts_added_by_default() {
        let config = Config {
            wad_blocklist: vec![WadBlocklistEntry::Exact {
                value: "Aatrox.wad.client".to_string(),
            }],
            ..Config::default()
        };
        let result = resolve_blocked_wads(&config, &[]);
        assert!(result.contains(&"aatrox.wad.client".to_string()));
        assert!(result.contains(&"scripts.wad.client".to_string()));
        assert!(result.contains(&"map22.wad.client".to_string()));
    }

    #[test]
    fn resolve_blocked_wads_regex_expanded_against_available() {
        let config = Config {
            block_scripts_wad: false,
            patch_tft: true,
            wad_blocklist: vec![WadBlocklistEntry::Regex {
                value: r"^map\d+\.en_us\.wad\.client$".to_string(),
            }],
            ..Config::default()
        };
        let available = vec![
            "map11.en_us.wad.client".to_string(),
            "map12.wad.client".to_string(),
            "map22.en_us.wad.client".to_string(),
            "aatrox.wad.client".to_string(),
        ];
        let result = resolve_blocked_wads(&config, &available);
        assert_eq!(
            result,
            vec![
                "map11.en_us.wad.client".to_string(),
                "map22.en_us.wad.client".to_string(),
            ]
        );
    }

    #[test]
    fn resolve_blocked_wads_invalid_regex_skipped_and_others_kept() {
        let config = Config {
            block_scripts_wad: false,
            patch_tft: true,
            wad_blocklist: vec![
                WadBlocklistEntry::Regex {
                    value: "[bad(".to_string(),
                },
                WadBlocklistEntry::Exact {
                    value: "keeper.wad.client".to_string(),
                },
            ],
            ..Config::default()
        };
        let result = resolve_blocked_wads(&config, &[]);
        assert_eq!(result, vec!["keeper.wad.client".to_string()]);
    }

    #[test]
    fn resolve_blocked_wads_dedupes_overlapping_entries() {
        let config = Config {
            block_scripts_wad: true,
            patch_tft: true,
            wad_blocklist: vec![
                WadBlocklistEntry::Exact {
                    value: "Scripts.wad.client".to_string(),
                },
                WadBlocklistEntry::Regex {
                    value: "^scripts".to_string(),
                },
            ],
            ..Config::default()
        };
        let available = vec!["scripts.wad.client".to_string()];
        let result = resolve_blocked_wads(&config, &available);
        assert_eq!(result, vec!["scripts.wad.client".to_string()]);
    }
}
