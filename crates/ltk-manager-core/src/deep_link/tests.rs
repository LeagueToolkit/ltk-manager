//! Unit tests for what a deep link parses to, and how a download names its format.

use fs_err as fs;

use super::download::{extract_extension_from_content_disposition, sniff_extension_from_file};
use super::*;

/// The install route a raw URL names, for the tests that read its fields.
fn install(raw_url: &str) -> AppResult<DeepLinkInstallRequest> {
    match parse_deep_link_url(raw_url)? {
        DeepLinkRequest::Install(request) => Ok(request),
        other => panic!("expected an install route, got {other:?}"),
    }
}

#[test]
fn parse_valid_minimal_url() {
    let req = install("ltk://install?url=https://cdn.example.com/mods/skin.modpkg").unwrap();
    assert_eq!(req.url, "https://cdn.example.com/mods/skin.modpkg");
    assert!(req.name.is_none());
    assert!(req.source.is_none());
}

#[test]
fn parse_valid_full_url() {
    let req = install(
        "ltk://install?url=https://cdn.example.com/mods/skin.modpkg&name=Cool%20Skin&author=SkinMaker&source=MySite",
    )
    .unwrap();
    assert_eq!(req.name.as_deref(), Some("Cool Skin"));
    assert_eq!(req.author.as_deref(), Some("SkinMaker"));
    assert_eq!(req.source.as_deref(), Some("MySite"));
}

#[test]
fn rejects_http_url() {
    let err = parse_deep_link_url("ltk://install?url=http://cdn.example.com/mods/skin.modpkg");
    assert!(err.is_err());
}

#[test]
fn rejects_missing_url_param() {
    let err = parse_deep_link_url("ltk://install?name=Test");
    assert!(err.is_err());
}

#[test]
fn rejects_localhost() {
    let err = parse_deep_link_url("ltk://install?url=https://localhost/mods/skin.modpkg");
    assert!(err.is_err());
}

#[test]
fn rejects_private_ip() {
    let err = parse_deep_link_url("ltk://install?url=https://192.168.1.1/mods/skin.modpkg");
    assert!(err.is_err());
}

#[test]
fn ignores_unknown_params() {
    let req = install(
        "ltk://install?url=https://cdn.example.com/mods/skin.modpkg&checksum=sha256:abc&api=https://api.example.com&unknown=value",
    )
    .unwrap();
    assert_eq!(req.url, "https://cdn.example.com/mods/skin.modpkg");
}

#[test]
fn rejects_wrong_scheme() {
    let err = parse_deep_link_url("https://install?url=https://cdn.example.com/mods/skin.modpkg");
    assert!(err.is_err());
}

#[test]
fn rejects_unknown_action() {
    let err = parse_deep_link_url("ltk://update?url=https://cdn.example.com/mods/skin.modpkg");
    assert!(err.is_err());
}

// --- The settings route ---

#[test]
fn parse_settings_route() {
    let request = parse_deep_link_url("ltk://settings?focus=appearance.theme").unwrap();
    assert_eq!(
        request,
        DeepLinkRequest::Settings(DeepLinkSettingsRequest {
            focus: "appearance.theme".into(),
        })
    );
}

#[test]
fn parse_settings_group_id() {
    let request = parse_deep_link_url("ltk://settings?focus=patching.mod-safety").unwrap();
    assert_eq!(
        request,
        DeepLinkRequest::Settings(DeepLinkSettingsRequest {
            focus: "patching.mod-safety".into(),
        })
    );
}

#[test]
fn settings_ignores_unknown_params() {
    let request =
        parse_deep_link_url("ltk://settings?focus=general.autoRun&tab=appearance").unwrap();
    assert_eq!(
        request,
        DeepLinkRequest::Settings(DeepLinkSettingsRequest {
            focus: "general.autoRun".into(),
        })
    );
}

#[test]
fn rejects_settings_without_focus() {
    assert!(parse_deep_link_url("ltk://settings").is_err());
    assert!(parse_deep_link_url("ltk://settings?tab=general").is_err());
}

#[test]
fn rejects_empty_focus() {
    assert!(parse_deep_link_url("ltk://settings?focus=").is_err());
}

#[test]
fn rejects_focus_outside_the_id_alphabet() {
    assert!(parse_deep_link_url("ltk://settings?focus=general.autoRun%20drop").is_err());
    assert!(parse_deep_link_url("ltk://settings?focus=%3Cscript%3E").is_err());
    assert!(parse_deep_link_url("ltk://settings?focus=a%2Fb").is_err());
}

#[test]
fn rejects_focus_over_the_limit() {
    let long = "a".repeat(FOCUS_MAX_CHARS + 1);
    assert!(parse_deep_link_url(&format!("ltk://settings?focus={long}")).is_err());

    let longest = "a".repeat(FOCUS_MAX_CHARS);
    assert!(parse_deep_link_url(&format!("ltk://settings?focus={longest}")).is_ok());
}

// --- URL parsing: additional edge cases ---

#[test]
fn parse_url_encoded_params() {
    let req = install(
        "ltk://install?url=https://cdn.example.com/mod.modpkg&name=%E2%9C%A8%20Sparkle%20Skin&source=My%20Site",
    )
    .unwrap();
    assert_eq!(req.name.as_deref(), Some("✨ Sparkle Skin"));
    assert_eq!(req.source.as_deref(), Some("My Site"));
}

#[test]
fn parse_empty_optional_params() {
    let req =
        install("ltk://install?url=https://cdn.example.com/mod.modpkg&name=&source=").unwrap();
    assert_eq!(req.name.as_deref(), Some(""));
    assert_eq!(req.source.as_deref(), Some(""));
}

#[test]
fn parse_url_with_query_string_in_download_url() {
    let req =
        install("ltk://install?url=https://cdn.example.com/mod.modpkg%3Ftoken%3Dabc123").unwrap();
    assert!(req.url.contains("token"));
}

#[test]
fn truncates_long_name_at_256_chars() {
    let long_name: String = "あ".repeat(300);
    let url = format!(
        "ltk://install?url=https://cdn.example.com/mod.modpkg&name={}",
        long_name
    );
    let req = install(&url).unwrap();
    assert_eq!(req.name.as_ref().unwrap().chars().count(), 256);
}

#[test]
fn rejects_completely_malformed_url() {
    assert!(parse_deep_link_url("not a url at all").is_err());
}

#[test]
fn rejects_empty_string() {
    assert!(parse_deep_link_url("").is_err());
}

// --- SSRF prevention ---

#[test]
fn rejects_loopback_127() {
    assert!(parse_deep_link_url("ltk://install?url=https://127.0.0.1/mod.modpkg").is_err());
}

#[test]
fn rejects_ipv6_loopback() {
    assert!(parse_deep_link_url("ltk://install?url=https://[::1]/mod.modpkg").is_err());
}

#[test]
fn rejects_10_x_private_range() {
    assert!(parse_deep_link_url("ltk://install?url=https://10.0.0.1/mod.modpkg").is_err());
    assert!(parse_deep_link_url("ltk://install?url=https://10.255.255.255/mod.modpkg").is_err());
}

#[test]
fn rejects_172_16_to_31_private_range() {
    assert!(parse_deep_link_url("ltk://install?url=https://172.16.0.1/mod.modpkg").is_err());
    assert!(parse_deep_link_url("ltk://install?url=https://172.31.255.255/mod.modpkg").is_err());
}

#[test]
fn allows_172_outside_private_range() {
    assert!(parse_deep_link_url("ltk://install?url=https://172.15.0.1/mod.modpkg").is_ok());
    assert!(parse_deep_link_url("ltk://install?url=https://172.32.0.1/mod.modpkg").is_ok());
}

#[test]
fn rejects_0000_address() {
    assert!(parse_deep_link_url("ltk://install?url=https://0.0.0.0/mod.modpkg").is_err());
}

#[test]
fn rejects_localhost_uppercase() {
    assert!(parse_deep_link_url("ltk://install?url=https://LOCALHOST/mod.modpkg").is_err());
}

// --- Domain allowlist validation ---

#[test]
fn domain_trusted_empty_allowlist_allows_all() {
    assert!(is_domain_trusted("https://anything.com/mod.modpkg", &[]));
}

#[test]
fn domain_trusted_exact_match() {
    let domains = vec!["runeforge.dev".into()];
    assert!(is_domain_trusted(
        "https://runeforge.dev/mod.modpkg",
        &domains
    ));
}

#[test]
fn domain_trusted_subdomain_match() {
    let domains = vec!["runeforge.dev".into()];
    assert!(is_domain_trusted(
        "https://cdn.runeforge.dev/mod.modpkg",
        &domains
    ));
}

#[test]
fn domain_trusted_deep_subdomain_match() {
    let domains = vec!["runeforge.dev".into()];
    assert!(is_domain_trusted(
        "https://files.cdn.runeforge.dev/mod.modpkg",
        &domains
    ));
}

#[test]
fn download_host_is_lower_cased() {
    assert_eq!(
        download_host("https://CDN.RuneForge.Dev/mod.modpkg").as_deref(),
        Some("cdn.runeforge.dev")
    );
}

#[test]
fn download_host_of_a_hostless_url() {
    assert_eq!(download_host("not a url"), None);
}

/// Trust is the reader's setting, so parsing alone never claims a verdict.
#[test]
fn parsing_leaves_the_trust_unstamped() {
    let req = install("ltk://install?url=https://cdn.example.com/mods/skin.modpkg").unwrap();
    assert_eq!(req.untrusted_domain, None);
}

#[test]
fn domain_trusted_rejects_partial_suffix() {
    let domains = vec!["runeforge.dev".into()];
    assert!(!is_domain_trusted(
        "https://evilruneforge.dev/mod.modpkg",
        &domains
    ));
}

#[test]
fn domain_trusted_rejects_unlisted_domain() {
    let domains = vec!["runeforge.dev".into()];
    assert!(!is_domain_trusted("https://evil.com/mod.modpkg", &domains));
}

#[test]
fn domain_trusted_case_insensitive() {
    let domains = vec!["runeforge.dev".into()];
    assert!(is_domain_trusted(
        "https://RUNEFORGE.DEV/mod.modpkg",
        &domains
    ));
    assert!(is_domain_trusted(
        "https://CDN.RuneForge.Dev/mod.modpkg",
        &domains
    ));
}

#[test]
fn domain_trusted_multiple_domains() {
    let domains = vec!["runeforge.dev".into(), "divineskins.gg".into()];
    assert!(is_domain_trusted(
        "https://runeforge.dev/mod.modpkg",
        &domains
    ));
    assert!(is_domain_trusted(
        "https://divineskins.gg/mod.modpkg",
        &domains
    ));
    assert!(!is_domain_trusted("https://evil.com/mod.modpkg", &domains));
}

#[test]
fn domain_trusted_invalid_url_returns_false() {
    let domains = vec!["runeforge.dev".into()];
    assert!(!is_domain_trusted("not a url", &domains));
}

// --- Content-Disposition parsing ---

#[test]
fn content_disposition_modpkg_filename() {
    assert_eq!(
        extract_extension_from_content_disposition(r#"attachment; filename="cool-skin.modpkg""#),
        Some("modpkg")
    );
}

#[test]
fn content_disposition_fantome_filename() {
    assert_eq!(
        extract_extension_from_content_disposition(r#"attachment; filename="cool-skin.fantome""#),
        Some("fantome")
    );
}

#[test]
fn content_disposition_no_filename() {
    assert_eq!(
        extract_extension_from_content_disposition("attachment"),
        None
    );
}

#[test]
fn content_disposition_unknown_extension() {
    assert_eq!(
        extract_extension_from_content_disposition(r#"attachment; filename="archive.zip""#),
        None
    );
}

#[test]
fn content_disposition_case_insensitive() {
    assert_eq!(
        extract_extension_from_content_disposition(r#"Attachment; Filename="skin.MODPKG""#),
        Some("modpkg")
    );
}

#[test]
fn content_disposition_filename_star_utf8() {
    assert_eq!(
        extract_extension_from_content_disposition(
            "attachment; filename*=UTF-8''cool%20skin.fantome"
        ),
        Some("fantome")
    );
}

// --- File magic sniffing ---

#[test]
fn sniff_zip_magic_returns_fantome() {
    let dir = std::env::temp_dir();
    let path = dir.join("test_sniff_zip.tmp");
    fs::write(&path, [0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]).unwrap();
    assert_eq!(sniff_extension_from_file(&path), Some("fantome".into()));
    let _ = fs::remove_file(&path);
}

#[test]
fn sniff_non_zip_returns_none() {
    let dir = std::env::temp_dir();
    let path = dir.join("test_sniff_nonzip.tmp");
    fs::write(&path, b"not a zip file at all").unwrap();
    assert_eq!(sniff_extension_from_file(&path), None);
    let _ = fs::remove_file(&path);
}

#[test]
fn sniff_empty_file_returns_none() {
    let dir = std::env::temp_dir();
    let path = dir.join("test_sniff_empty.tmp");
    fs::write(&path, b"").unwrap();
    assert_eq!(sniff_extension_from_file(&path), None);
    let _ = fs::remove_file(&path);
}

#[test]
fn sniff_short_file_returns_none() {
    let dir = std::env::temp_dir();
    let path = dir.join("test_sniff_short.tmp");
    fs::write(&path, [0x50, 0x4B]).unwrap();
    assert_eq!(sniff_extension_from_file(&path), None);
    let _ = fs::remove_file(&path);
}

#[test]
fn sniff_nonexistent_file_returns_none() {
    let path = std::env::temp_dir().join("test_sniff_nonexistent_file_that_does_not_exist.tmp");
    assert_eq!(sniff_extension_from_file(&path), None);
}
