use std::borrow::Cow;

use super::*;

fn redactor() -> Redactor {
    let mut redactor = Redactor::new();
    redactor.register_path(Placeholder::Profile, r"C:\Users\someone");
    redactor.register_value(Placeholder::User, "someone");
    redactor.register_path(
        Placeholder::Workshop,
        r"C:\Users\someone\Documents\workshop",
    );
    redactor.register_path(Placeholder::League, r"D:\Riot Games\League of Legends\");
    redactor.register_value(Placeholder::Secret, "s3cr3t-value");
    redactor
}

#[test]
fn redact_returns_borrowed_text_if_nothing_is_private() {
    let text = "Overlay built in 412 ms at 19:02:11 for ltk_manager::patcher";
    assert!(matches!(redactor().redact(text), Cow::Borrowed(_)));
}

#[test]
fn redact_known_replaces_a_path_in_each_spelling() {
    let redactor = redactor();
    for (text, expected) in [
        (r"C:\Users\someone\AppData\x", r"%USERPROFILE%\AppData\x"),
        ("C:/Users/someone/AppData/x", "%USERPROFILE%/AppData/x"),
        (r"c:\users\SOMEONE\AppData", r"%USERPROFILE%\AppData"),
        (
            r#""C:\\Users\\someone\\AppData""#,
            r#""%USERPROFILE%\\AppData""#,
        ),
        (r"\\?\C:\Users\someone\x", r"\\?\%USERPROFILE%\x"),
    ] {
        assert_eq!(redactor.redact_known(text), expected, "{text}");
    }
}

#[test]
fn redact_known_keeps_a_path_that_continues_the_name() {
    let text = r"C:\Users\someoneelse\AppData";
    assert_eq!(redactor().redact_known(text), text);
}

#[test]
fn redact_known_prefers_the_longest_value() {
    assert_eq!(
        redactor().redact_known(r"C:\Users\someone\Documents\workshop\ahri"),
        r"<workshop>\ahri"
    );
}

#[test]
fn redact_known_replaces_a_bare_value_between_boundaries_only() {
    let redactor = redactor();
    assert_eq!(
        redactor.redact_known("owner someone, key s3cr3t-value."),
        "owner <user>, key <secret>."
    );
    assert_eq!(redactor.redact_known("handsomeones"), "handsomeones");
}

#[test]
fn register_value_skips_a_value_shorter_than_four_characters() {
    let mut redactor = Redactor::new();
    redactor.register_value(Placeholder::User, "bob");
    assert!(redactor.has_no_known_value());
}

#[test]
fn register_path_skips_a_drive_root() {
    let mut redactor = Redactor::new();
    redactor.register_path(Placeholder::Data, r"D:\");
    assert!(redactor.has_no_known_value());
}

#[test]
fn register_path_marks_a_path_with_a_character_outside_ascii() {
    for name in ["Иван", "田中", "José Luis"] {
        let mut redactor = Redactor::new();
        redactor.register_path(Placeholder::Profile, &format!(r"C:\Users\{name}"));
        assert_eq!(
            redactor.redact_known(&format!(r"C:\Users\{name}\AppData")),
            r"%USERPROFILE:non-ascii%\AppData"
        );
    }
}

#[test]
fn redact_replaces_the_name_of_another_user() {
    let redactor = redactor();
    assert_eq!(
        redactor.redact(r"copied from C:\Users\Other Person\Desktop\skin.fantome"),
        r"copied from C:\Users\<other>\Desktop\skin.fantome"
    );
    assert_eq!(
        redactor.redact(r"missing C:\Users\other"),
        r"missing C:\Users\<other>"
    );
    assert_eq!(
        redactor.redact(r"C:\Users\Public\Documents"),
        r"C:\Users\Public\Documents"
    );
}

#[test]
fn redact_keeps_the_action_of_a_deep_link() {
    assert_eq!(
        redactor().redact("opened ltk://install?url=https://cdn.example.com/a.modpkg&name=A"),
        "opened ltk://install"
    );
}

#[test]
fn redact_drops_the_query_and_the_user_info_of_a_url() {
    let redactor = redactor();
    assert_eq!(
        redactor.redact("GET https://user:pw@cdn.example.com/mods/a.zip?sig=abc#top failed"),
        "GET https://cdn.example.com/mods/a.zip failed"
    );
    let plain = "GET https://cdn.example.com/mods/a.zip failed";
    assert_eq!(redactor.redact(plain), plain);
}

#[test]
fn redact_replaces_secrets_in_headers_and_pairs() {
    let redactor = redactor();
    assert_eq!(
        redactor.redact("Authorization: Bearer abcDEF123456.xyz"),
        "Authorization: Bearer <secret>"
    );
    assert_eq!(
        redactor.redact("retry with token=abc123 hotkey=F5"),
        "retry with token=<secret> hotkey=F5"
    );
}

#[test]
fn redact_replaces_addresses_and_keeps_loopback_and_versions() {
    let redactor = redactor();
    assert_eq!(
        redactor.redact("connect 203.0.113.7:5000 failed"),
        "connect <ip>:5000 failed"
    );
    assert_eq!(
        redactor.redact("peer 2001:db8::ff00:42:8329 closed"),
        "peer <ip> closed"
    );
    for kept in [
        "listening on 127.0.0.1:8394",
        "bound ::1",
        "file version 1.2.3.4.5",
        "patcher v1.2.3.4",
        "at 19:02:11 in db::cafe",
    ] {
        assert_eq!(redactor.redact(kept), kept);
    }
}

#[test]
fn redact_replaces_an_email_and_a_quoted_riot_id() {
    let redactor = redactor();
    assert_eq!(
        redactor.redact("author a.b@example.com, player 'Some Name#EUW'"),
        "author <email>, player '<riot-id>'"
    );
}

#[test]
fn redact_keeps_a_uuid() {
    let text = "mod 0b5e3a52-6c5b-4d0e-9d4e-3f6f1f0a9c11 enabled";
    assert_eq!(redactor().redact(text), text);
}

#[test]
fn redact_is_idempotent() {
    let redactor = redactor();
    let text = r"C:\Users\someone\x from ltk://install?url=https://a.example/b?c=d by someone";
    let once = redactor.redact(text).into_owned();
    assert_eq!(redactor.redact(&once), once);
}
