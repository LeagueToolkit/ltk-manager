use serde_json::json;

use super::*;

const PROFILE_DIR: &str = r"C:\Users\someone";

fn scrubber() -> Scrubber {
    Scrubber::for_profile_dir(PROFILE_DIR)
}

#[test]
fn a_string_without_the_profile_path_is_left_alone() {
    let scrubbed = scrubber().scrub("the game would not start");

    assert!(matches!(
        scrubbed,
        Cow::Borrowed("the game would not start")
    ));
}

#[test]
fn the_profile_path_is_replaced() {
    let scrubbed = scrubber().scrub(r"C:\Users\someone\AppData\Roaming\mod.wad");

    assert_eq!(scrubbed, r"%USERPROFILE%\AppData\Roaming\mod.wad");
}

#[test]
fn the_profile_path_is_replaced_whatever_the_separator() {
    let scrubbed = scrubber().scrub("C:/Users/someone/AppData/mod.wad");

    assert_eq!(scrubbed, "%USERPROFILE%/AppData/mod.wad");
}

#[test]
fn the_profile_path_is_replaced_whatever_the_case() {
    let scrubbed = scrubber().scrub(r"c:\users\SOMEONE\AppData\mod.wad");

    assert_eq!(scrubbed, r"%USERPROFILE%\AppData\mod.wad");
}

#[test]
fn every_occurrence_in_one_string_is_replaced() {
    let scrubbed = scrubber().scrub(r"moved C:\Users\someone\a.wad to C:\Users\someone\b.wad");

    assert_eq!(
        scrubbed,
        r"moved %USERPROFILE%\a.wad to %USERPROFILE%\b.wad"
    );
}

#[test]
fn a_trailing_separator_on_the_profile_dir_does_not_double_it() {
    let scrubbed = Scrubber::for_profile_dir(r"C:\Users\someone\").scrub(r"C:\Users\someone\a.wad");

    assert_eq!(scrubbed, r"%USERPROFILE%\a.wad");
}

#[test]
fn a_scrubber_with_no_profile_dir_replaces_nothing() {
    let scrubbed = Scrubber::none().scrub(r"C:\Users\someone\a.wad");

    assert_eq!(scrubbed, r"C:\Users\someone\a.wad");
}

#[test]
fn a_nested_property_value_is_scrubbed() {
    let mut properties = Properties::new()
        .with("message", format!(r"failed to open {PROFILE_DIR}\a.wad"))
        .with(
            "suspects",
            json!([
                { "path": format!(r"{PROFILE_DIR}\mods\one.fantome") },
                { "path": r"D:\games\two.fantome" },
            ]),
        )
        .with("count", 2);

    scrubber().scrub_properties(&mut properties);

    assert_eq!(
        properties
            .get("message")
            .and_then(serde_json::Value::as_str),
        Some(r"failed to open %USERPROFILE%\a.wad")
    );
    assert_eq!(
        properties.get("suspects"),
        Some(&json!([
            { "path": r"%USERPROFILE%\mods\one.fantome" },
            { "path": r"D:\games\two.fantome" },
        ]))
    );
    assert_eq!(properties.get("count"), Some(&json!(2)));
}

#[test]
fn a_non_ascii_string_survives_the_scrub() {
    let scrubbed = scrubber().scrub(r"le mod «héroïne» est dans C:\Users\someone\mods");

    assert_eq!(scrubbed, r"le mod «héroïne» est dans %USERPROFILE%\mods");
}
