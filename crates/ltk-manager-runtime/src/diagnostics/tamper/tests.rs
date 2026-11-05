use super::*;

#[test]
fn debug_switch_reads_a_debug_port() {
    assert!(has_debug_switch(
        r#""C:\Program Files (x86)\Microsoft\EdgeWebView\Application\msedgewebview2.exe" --remote-debugging-port=9222 --type=browser"#
    ));
}

#[test]
fn debug_switch_reads_an_uppercase_debug_port() {
    assert!(has_debug_switch(
        "msedgewebview2.exe --REMOTE-DEBUGGING-PORT=9222 --type=browser"
    ));
}

#[test]
fn debug_switch_reads_a_quoted_switch() {
    assert!(has_debug_switch(
        "msedgewebview2.exe \"--remote-debugging-port=9222\" --type=browser"
    ));
}

#[test]
fn debug_switch_reads_the_debug_pipe() {
    assert!(has_debug_switch(
        "msedgewebview2.exe --remote-debugging-pipe --type=browser"
    ));
}

#[test]
fn debug_switch_ignores_other_switches() {
    assert!(!has_debug_switch(
        "msedgewebview2.exe --remote-allow-origins=http://127.0.0.1:9222 --type=browser"
    ));
}
