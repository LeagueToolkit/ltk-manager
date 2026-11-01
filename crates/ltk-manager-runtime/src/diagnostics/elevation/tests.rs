use super::*;

fn elevated_facts() -> ElevationFacts {
    ElevationFacts {
        elevated: true,
        elevation_type: ElevationType::Full,
        integrity: Some(HIGH_INTEGRITY),
        shell_elevated: Some(false),
        parent: Some("explorer.exe".to_string()),
        uac_enabled: true,
        builtin_administrator: false,
        compat_layer: None,
    }
}

#[test]
fn cause_is_none_if_process_is_not_elevated() {
    let facts = ElevationFacts {
        elevated: false,
        uac_enabled: false,
        ..elevated_facts()
    };

    assert_eq!(facts.cause(), None);
}

#[test]
fn cause_names_run_as_administrator_for_a_full_token_from_the_shell() {
    assert_eq!(
        elevated_facts().cause(),
        Some(ElevationCause::RunAsAdministrator)
    );
}

#[test]
fn cause_names_uac_before_every_other_fact() {
    let facts = ElevationFacts {
        uac_enabled: false,
        builtin_administrator: true,
        compat_layer: Some("HKCU".to_string()),
        ..elevated_facts()
    };

    assert_eq!(facts.cause(), Some(ElevationCause::UacDisabled));
}

#[test]
fn cause_names_the_builtin_administrator_account() {
    let facts = ElevationFacts {
        elevation_type: ElevationType::Default,
        builtin_administrator: true,
        ..elevated_facts()
    };

    assert_eq!(facts.cause(), Some(ElevationCause::BuiltinAdministrator));
}

#[test]
fn cause_names_a_compat_layer_before_the_shell() {
    let facts = ElevationFacts {
        compat_layer: Some("HKLM".to_string()),
        shell_elevated: Some(true),
        ..elevated_facts()
    };

    assert_eq!(facts.cause(), Some(ElevationCause::CompatLayer));
}

#[test]
fn cause_names_an_elevated_shell() {
    let facts = ElevationFacts {
        shell_elevated: Some(true),
        ..elevated_facts()
    };

    assert_eq!(facts.cause(), Some(ElevationCause::ElevatedShell));
}

#[test]
fn cause_names_an_elevated_parent_that_is_not_the_shell() {
    let facts = ElevationFacts {
        parent: Some("WindowsTerminal.exe".to_string()),
        ..elevated_facts()
    };

    assert_eq!(facts.cause(), Some(ElevationCause::ElevatedParent));
}

#[test]
fn cause_is_unknown_if_the_token_is_not_full_and_nothing_else_matches() {
    let facts = ElevationFacts {
        elevation_type: ElevationType::Unknown,
        parent: None,
        ..elevated_facts()
    };

    assert_eq!(facts.cause(), Some(ElevationCause::Unknown));
}

#[test]
fn integrity_name_names_the_known_levels_and_spells_the_rest_in_hex() {
    let high = ElevationFacts {
        integrity: Some(HIGH_INTEGRITY),
        ..ElevationFacts::default()
    };
    let medium = ElevationFacts {
        integrity: Some(MEDIUM_INTEGRITY),
        ..ElevationFacts::default()
    };
    let other = ElevationFacts {
        integrity: Some(0x4000),
        ..ElevationFacts::default()
    };

    assert_eq!(high.integrity_name().as_deref(), Some("high"));
    assert_eq!(medium.integrity_name().as_deref(), Some("medium"));
    assert_eq!(other.integrity_name().as_deref(), Some("0x4000"));
    assert_eq!(ElevationFacts::default().integrity_name(), None);
}

#[test]
fn cause_and_type_serialize_in_kebab_case() {
    assert_eq!(
        serde_json::to_value(ElevationCause::RunAsAdministrator).unwrap(),
        serde_json::json!("run-as-administrator")
    );
    assert_eq!(ElevationCause::UacDisabled.to_string(), "uac-disabled");
    assert_eq!(ElevationType::Full.to_string(), "full");
}
