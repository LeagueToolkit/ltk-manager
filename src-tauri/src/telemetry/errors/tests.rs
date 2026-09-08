use super::*;

fn exception_entry(properties: &Properties) -> serde_json::Value {
    properties
        .get("$exception_list")
        .expect("an exception carries a list")
        .as_array()
        .expect("the list is an array")[0]
        .clone()
}

#[test]
fn a_backend_error_reports_its_code_and_its_message() {
    let properties = app_error("IO", "reading a.wad: not found");

    assert_eq!(
        properties.get("error_code").and_then(|code| code.as_str()),
        Some("IO")
    );
    assert_eq!(
        properties
            .get("message")
            .and_then(|message| message.as_str()),
        Some("reading a.wad: not found")
    );
    assert!(properties.get("$exception_list").is_none());
}

#[test]
fn a_panic_reports_the_location_the_standard_library_gives() {
    let properties = panic_exception("index out of bounds", Some("src/mods/mod.rs"), Some(42));

    assert_eq!(
        properties.get("kind").and_then(|kind| kind.as_str()),
        Some(KIND_APP_PANIC)
    );

    let entry = exception_entry(&properties);
    assert_eq!(entry["type"], "RustPanic");
    assert_eq!(entry["value"], "index out of bounds");
    assert_eq!(entry["mechanism"]["handled"], false);

    let frame = &entry["stacktrace"]["frames"][0];
    assert_eq!(frame["platform"], CUSTOM_PLATFORM);
    assert_eq!(frame["lang"], "rust");
    assert_eq!(frame["filename"], "src/mods/mod.rs");
    assert_eq!(frame["lineno"], 42);
}

#[test]
fn a_panic_with_no_location_still_reports() {
    let properties = panic_exception("something gave way", None, None);

    let frame = &exception_entry(&properties)["stacktrace"]["frames"][0];
    assert!(frame.get("filename").is_none());
    assert!(frame.get("lineno").is_none());
}

#[test]
fn a_frontend_crash_reports_its_route_and_its_component_stack() {
    let error = UiError {
        name: "TypeError".to_owned(),
        message: "x is not a function".to_owned(),
        stack: Some("at Card (index.js:1:2)".to_owned()),
        component_stack: Some("in Card\n in Grid".to_owned()),
        route: Some("/mods".to_owned()),
        handled: true,
    };

    let properties = ui_exception(&error);

    assert_eq!(
        properties.get("kind").and_then(|kind| kind.as_str()),
        Some(KIND_UI_ERROR)
    );
    assert_eq!(
        properties.get("route").and_then(|route| route.as_str()),
        Some("/mods")
    );
    assert_eq!(
        properties
            .get("component_stack")
            .and_then(|stack| stack.as_str()),
        Some("in Card\n in Grid")
    );

    let entry = exception_entry(&properties);
    assert_eq!(entry["type"], "TypeError");
    assert_eq!(entry["value"], "x is not a function");
    assert_eq!(entry["mechanism"]["handled"], true);
    assert_eq!(
        entry["stacktrace"]["frames"][0]["module"],
        "at Card (index.js:1:2)"
    );
}

#[test]
fn two_reports_of_one_failure_share_a_fingerprint_whatever_they_said() {
    let first = fingerprint(KIND_APP_PANIC, "src/mods/mod.rs:42");
    let second = fingerprint(KIND_APP_PANIC, "src/mods/mod.rs:42");
    let elsewhere = fingerprint(KIND_APP_PANIC, "src/mods/mod.rs:43");

    assert_eq!(first, second);
    assert_ne!(first, elsewhere);
    assert_ne!(first, fingerprint(KIND_UI_ERROR, "src/mods/mod.rs:42"));
}
