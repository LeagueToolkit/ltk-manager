use super::*;

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| (*item).to_owned()).collect()
}

/* The test binary's own command line, which `cargo test` fills with the test filter. */
#[cfg(windows)]
#[test]
fn command_line_of_this_process_names_the_test_binary() {
    let line = process::command_line(std::process::id()).expect("this process answers");
    let exe = std::env::current_exe().expect("the test binary has a path");
    let name = exe
        .file_stem()
        .and_then(|stem| stem.to_str())
        .expect("the binary has a name");

    assert!(line.contains(name), "{line:?} names {name:?}");
    assert_eq!(debug_switch_in(&line), None);
}

#[cfg(windows)]
#[test]
fn command_line_of_no_process_is_none() {
    // Pid 0 is the idle process, which `OpenProcess` refuses.
    assert_eq!(process::command_line(0), None);
}

fn values(line: &str) -> Vec<String> {
    arguments(line)
        .into_iter()
        .map(|argument| argument.value)
        .collect()
}

/* Spellings that `CommandLineToArgvW` reads as one switch, or as two arguments. */
const QUOTED_LINES: [&str; 12] = [
    r#"--a=1   --b="x y"  "--c=z" plain"#,
    r#"--remote"-debugging-port"=9222 --type=browser"#,
    r#"--re""mote-debugging-port=9222"#,
    r#""--re""mote-debugging-port=9222""#,
    r#"--a=\" --remote-debugging-port=9222"#,
    r#"--a=\\" --remote-debugging-port=9222"#,
    r#"--a="x\\\"y" --b"#,
    r#"--a="""x""" --b"#,
    r#""" --a "" """" --b"#,
    "--a\t--b  \t --c",
    r#"--path=C:\dir\ --b"#,
    r#"--a="unclosed --b"#,
];

#[test]
fn arguments_split_at_blanks_outside_quotes() {
    assert_eq!(
        arguments(r#"--a=1   --b="x y"  "--c=z" plain"#),
        [
            ("--a=1", "--a=1"),
            (r#"--b="x y""#, "--b=x y"),
            (r#""--c=z""#, "--c=z"),
            ("plain", "plain"),
        ]
        .map(|(raw, value)| Argument {
            raw: raw.to_owned(),
            value: value.to_owned(),
        })
    );
    assert!(arguments("   ").is_empty());
}

#[test]
fn arguments_remove_quotes_inside_a_switch_name() {
    assert_eq!(
        values(r#"--remote"-debugging-port"=9222 --type=browser"#),
        strings(&["--remote-debugging-port=9222", "--type=browser"])
    );
    assert_eq!(
        values(r#"--re""mote-debugging-port=9222"#),
        strings(&["--remote-debugging-port=9222"])
    );
}

#[test]
fn arguments_split_after_an_escaped_quote() {
    assert_eq!(
        values(r#"--a=\" --remote-debugging-port=9222"#),
        strings(&[r#"--a=""#, "--remote-debugging-port=9222"])
    );
}

/* The parser's reference is the Windows function itself. */
#[cfg(windows)]
#[test]
fn arguments_match_command_line_to_argv() {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::UI::Shell::CommandLineToArgvW;

    for line in QUOTED_LINES {
        let wide: Vec<u16> = format!("program.exe {line}")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut count = 0;
        // SAFETY: `wide` is null-terminated, and the returned block holds `count` strings.
        let expected: Vec<String> = unsafe {
            let argv = CommandLineToArgvW(wide.as_ptr(), &mut count);
            assert!(!argv.is_null());
            let parsed = (1..count as usize)
                .map(|index| {
                    let argument = *argv.add(index);
                    let len = (0..).take_while(|&at| *argument.add(at) != 0).count();
                    String::from_utf16_lossy(std::slice::from_raw_parts(argument, len))
                })
                .collect();
            LocalFree(argv.cast());
            parsed
        };

        assert_eq!(values(line), expected, "{line:?}");
    }
}

#[test]
fn switch_name_takes_any_prefix_and_drops_the_value() {
    assert_eq!(
        switch_name("--remote-debugging-port=9222"),
        Some("remote-debugging-port")
    );
    assert_eq!(
        switch_name("-remote-debugging-pipe"),
        Some("remote-debugging-pipe")
    );
    assert_eq!(
        switch_name("/proxy-server=1.2.3.4:80"),
        Some("proxy-server")
    );
    assert_eq!(switch_name("plain"), None);
    assert_eq!(switch_name("--"), None);
}

#[test]
fn filter_drops_a_debugging_switch_with_quotes_in_its_name() {
    let filtered = filter(r#"--disable-gpu --remote"-debugging-port"=9222 "--user-agent=a b""#);

    assert_eq!(
        filtered,
        Filtered {
            kept: strings(&["--disable-gpu", r#""--user-agent=a b""#]),
            dropped: strings(&[r#"--remote"-debugging-port"=9222"#]),
        }
    );
}

#[test]
fn filter_keeps_benign_switches_and_drops_debugging_ones() {
    let filtered = filter(
        "--disable-gpu --REMOTE-DEBUGGING-PORT=9222 --remote-allow-origins=http://127.0.0.1:9222 \
         --disable-features=msWebOOUI",
    );

    assert_eq!(
        filtered,
        Filtered {
            kept: strings(&["--disable-gpu", "--disable-features=msWebOOUI"]),
            dropped: strings(&[
                "--REMOTE-DEBUGGING-PORT=9222",
                "--remote-allow-origins=http://127.0.0.1:9222",
            ]),
        }
    );
}

#[test]
fn filter_of_nothing_is_empty() {
    assert_eq!(filter(""), Filtered::default());
}

#[test]
fn debug_switch_in_reads_a_browser_command_line() {
    let line = r#""C:\Program Files (x86)\Microsoft\EdgeWebView\Application\142.0.3595.65\msedgewebview2.exe" --embedded-browser-webview=1 --webview-exe-name=ltk-manager.exe --webview-exe-version=1.34.0 --user-data-dir="C:\Users\u\AppData\Local\dev.leaguetoolkit.manager\EBWebView" --noerrdialogs --embedded-browser-webview-dpi-awareness=2 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disk-cache-size=104857600 --remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222 --mojo-named-platform-channel-pipe=1.2.3"#;

    assert_eq!(
        debug_switch_in(line).as_deref(),
        Some("--remote-debugging-port=9222")
    );
    assert_eq!(
        debug_switch_in(&line.replace(
            " --remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222",
            ""
        )),
        None
    );
}

#[test]
fn browser_args_follow_the_configured_ones_and_default_to_none() {
    assert_eq!(
        browser_args(Some("--a --b=1"), &strings(&["--disable-gpu"])).as_deref(),
        Some("--a --b=1 --disable-gpu")
    );
    assert_eq!(
        browser_args(None, &strings(&["--x"])).as_deref(),
        Some("--x")
    );
    assert_eq!(browser_args(Some("--a"), &[]).as_deref(), Some("--a"));
    assert_eq!(browser_args(None, &[]), None);
}

#[test]
fn inherited_is_debugging_on_a_dropped_switch_or_a_launcher_port() {
    assert!(!Inherited::default().is_debugging());
    assert!(Inherited::default().is_empty());
    assert!(!Inherited {
        kept: strings(&["--disable-gpu"]),
        ..Inherited::default()
    }
    .is_debugging());
    assert!(Inherited {
        dropped: strings(&["--remote-debugging-pipe"]),
        ..Inherited::default()
    }
    .is_debugging());
    assert!(Inherited {
        launcher_port: true,
        ..Inherited::default()
    }
    .is_debugging());
}

/* The one test that touches the process environment, so it cannot race another. */
#[test]
fn take_inherited_removes_both_variables_and_splits_the_switches() {
    std::env::set_var(
        BROWSER_ARGS_VAR,
        "--disable-gpu --remote-debugging-port=9222",
    );
    std::env::set_var(LAUNCHER_PORT_VAR, "9222");

    let inherited = take_inherited();

    assert_eq!(
        inherited,
        Inherited {
            kept: strings(&["--disable-gpu"]),
            dropped: strings(&["--remote-debugging-port=9222"]),
            launcher_port: true,
        }
    );
    assert!(inherited.is_debugging());
    assert_eq!(std::env::var_os(BROWSER_ARGS_VAR), None);
    assert_eq!(std::env::var_os(LAUNCHER_PORT_VAR), None);
    assert!(take_inherited().is_empty());
}
