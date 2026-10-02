use super::*;
use crate::mods::index::ModArchiveFormat;
use crate::mods::test_support::{make_test_entry, make_test_library, seed_library};

#[test]
fn enabling_mods_preserves_priority_unless_promotion_is_selected() {
    for promote_enabled_mods in [false, true] {
        for with_layers in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let (library, mut config) = make_test_library(dir.path());
            config.promote_enabled_mods = promote_enabled_mods;
            seed_library(
                &library,
                &config,
                ["first", "middle", "last"]
                    .into_iter()
                    .map(|id| make_test_entry(id, ModArchiveFormat::Fantome))
                    .collect(),
            );
            library
                .toggle_mod_enabled(&config, "middle", false)
                .unwrap();
            let layers = HashMap::from([("base".to_string(), true)]);

            if with_layers {
                library
                    .enable_mod_with_layers(&config, "middle", layers.clone())
                    .unwrap();
            } else {
                library.toggle_mod_enabled(&config, "middle", true).unwrap();
            }

            let expected = if promote_enabled_mods {
                ["middle", "first", "last"]
            } else {
                ["first", "middle", "last"]
            };
            library
                .with_index(&config, |_, index| {
                    let profile = get_active_profile(index)?;
                    assert_eq!(profile.mod_order, expected);
                    assert_eq!(profile.enabled_mods, expected);
                    assert_eq!(index.folders[0].mod_ids, expected);
                    if with_layers {
                        assert_eq!(profile.layer_states.get("middle"), Some(&layers));
                    }
                    Ok(())
                })
                .unwrap();

            library
                .toggle_mod_enabled(&config, "middle", false)
                .unwrap();
            library
                .with_index(&config, |_, index| {
                    let profile = get_active_profile(index)?;
                    assert_eq!(profile.mod_order, expected);
                    assert_eq!(profile.enabled_mods, ["first", "last"]);
                    Ok(())
                })
                .unwrap();
        }
    }
}

#[test]
fn older_settings_leave_promotion_off_and_preserve_other_preferences() {
    let config: Config =
        serde_json::from_str(r#"{"patchTft":true,"autoCategorizationEnabled":false}"#).unwrap();
    assert!(!config.promote_enabled_mods);
    assert!(config.patch_tft);
    assert!(!config.auto_categorization_enabled);
}

#[test]
fn promotion_opt_in_survives_a_settings_round_trip() {
    let config: Config = serde_json::from_str(r#"{"promoteEnabledMods":true}"#).unwrap();
    assert!(config.promote_enabled_mods);
    let saved = serde_json::to_string(&config).unwrap();
    let restored: Config = serde_json::from_str(&saved).unwrap();
    assert!(restored.promote_enabled_mods);
}
