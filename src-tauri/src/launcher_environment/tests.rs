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
}
