use super::*;

#[test]
fn recognizes_launcher_variables_in_any_case() {
    for name in [
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "webview2_additional_browser_arguments",
        "WebView2_Release_Channel_Preference",
        "LTF_CDP_PORT",
        "celestial_api_port",
    ] {
        assert!(is_launcher_variable(name), "{name} is a launcher variable");
    }
}

#[test]
fn ignores_unrelated_variables() {
    for name in ["WEBVIEW2_USER_DATA_FOLDER", "LTK_NO_HIDE", "PATH"] {
        assert!(
            !is_launcher_variable(name),
            "{name} is not a launcher variable"
        );
    }
}

#[test]
fn only_marks_variables_that_can_control_the_manager() {
    fn value(value: &str) -> &std::ffi::OsStr {
        std::ffi::OsStr::new(value)
    }

    assert!(is_control_variable("LTF_CDP_PORT", value("46321")));
    assert!(is_control_variable(
        "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
        value(r"C:\Temp\WebView2")
    ));
    assert!(is_control_variable(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        value("--disable-gpu --remote-debugging-port=9222")
    ));
    assert!(!is_control_variable(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        value("--disable-gpu")
    ));
    assert!(!is_control_variable(
        "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE",
        value("1")
    ));
}

#[test]
fn clears_a_launcher_variable() {
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--remote-debugging-port=9222",
    );

    clear();

    assert!(
        std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none(),
        "the debugging arguments are removed"
    );
    assert!(
        is_controlled(),
        "the launcher's control is remembered after clearing"
    );
}
