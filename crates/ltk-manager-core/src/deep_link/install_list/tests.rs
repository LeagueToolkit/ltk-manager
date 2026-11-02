//! Unit tests for how a manifest is read and how a minted link is held to the list's host.

use super::*;

const MANIFEST_URL: &str = "https://runeforge.dev/api/collections/5a00/install-list?sig=abc";

fn manifest_url() -> Url {
    Url::parse(MANIFEST_URL).unwrap()
}

fn item_json(id: &str, host: &str) -> String {
    format!(
        r#"{{
          "id": "{id}",
          "name": "Necron Chronomancer Kalista",
          "author": "frostforge",
          "version": "v1.2.0",
          "pageUrl": "https://runeforge.dev/mods/{id}",
          "download": {{ "method": "POST", "url": "https://{host}/api/mods/{id}/releases/1/download-link" }}
        }}"#
    )
}

fn manifest_json(version: u64, items: &[String]) -> String {
    format!(
        r#"{{
          "version": {version},
          "name": "Clean ADC kit",
          "author": "ezreal_main",
          "source": "Runeforge",
          "pageUrl": "https://runeforge.dev/collections/5a00",
          "items": [{}]
        }}"#,
        items.join(",")
    )
}

#[test]
fn reads_a_manifest_in_the_owners_order() {
    let body = manifest_json(
        1,
        &[
            item_json("a", "runeforge.dev"),
            item_json("b", "runeforge.dev"),
        ],
    );

    let list = parse_manifest(body.as_bytes(), &manifest_url()).unwrap();

    assert_eq!(list.name, "Clean ADC kit");
    assert_eq!(list.author.as_deref(), Some("ezreal_main"));
    assert_eq!(list.source.as_deref(), Some("Runeforge"));
    let ids: Vec<&str> = list.items.iter().map(|item| item.id.as_str()).collect();
    assert_eq!(ids, ["a", "b"]);
    assert_eq!(list.items[0].version.as_deref(), Some("v1.2.0"));
    assert_eq!(list.items[0].download.method, DownloadMethod::Post);
}

#[test]
fn ignores_fields_it_does_not_know() {
    let body = r#"{ "version": 1, "name": "x", "curated": true, "items": [] }"#;

    let list = parse_manifest(body.as_bytes(), &manifest_url()).unwrap();

    assert!(list.items.is_empty());
    assert_eq!(list.author, None);
}

#[test]
fn refuses_any_other_version_whole() {
    let body = manifest_json(2, &[item_json("a", "runeforge.dev")]);

    let error = parse_manifest(body.as_bytes(), &manifest_url()).unwrap_err();

    assert!(error.to_string().contains("version 2"), "{error}");
}

#[test]
fn refuses_a_list_past_the_item_cap() {
    let items: Vec<String> = (0..=MAX_ITEMS)
        .map(|n| item_json(&n.to_string(), "runeforge.dev"))
        .collect();
    let body = manifest_json(1, &items);

    assert!(parse_manifest(body.as_bytes(), &manifest_url()).is_err());
}

#[test]
fn accepts_a_list_at_the_item_cap() {
    let items: Vec<String> = (0..MAX_ITEMS)
        .map(|n| item_json(&n.to_string(), "runeforge.dev"))
        .collect();
    let body = manifest_json(1, &items);

    let list = parse_manifest(body.as_bytes(), &manifest_url()).unwrap();

    assert_eq!(list.items.len(), MAX_ITEMS);
}

#[test]
fn refuses_an_item_that_downloads_from_another_host() {
    let body = manifest_json(1, &[item_json("a", "cdn.evil.example")]);

    let error = parse_manifest(body.as_bytes(), &manifest_url()).unwrap_err();

    assert!(
        error.to_string().contains("outside the list's host"),
        "{error}"
    );
}

#[test]
fn the_host_match_ignores_case() {
    let body = manifest_json(1, &[item_json("a", "RuneForge.dev")]);

    assert!(parse_manifest(body.as_bytes(), &manifest_url()).is_ok());
}

#[test]
fn refuses_an_item_that_downloads_over_http() {
    let body = manifest_json(
        1,
        &[item_json("a", "runeforge.dev")
            .replace("https://runeforge.dev/api", "http://runeforge.dev/api")],
    );

    assert!(parse_manifest(body.as_bytes(), &manifest_url()).is_err());
}

#[test]
fn refuses_an_item_with_no_id() {
    let body = manifest_json(1, &[item_json("", "runeforge.dev")]);

    assert!(parse_manifest(body.as_bytes(), &manifest_url()).is_err());
}

#[test]
fn a_get_link_is_the_file_itself() {
    let body = r#"{ "version": 1, "name": "x", "items": [{
        "id": "a", "name": "A",
        "download": { "method": "GET", "url": "https://runeforge.dev/files/a.modpkg" }
    }] }"#;

    let list = parse_manifest(body.as_bytes(), &manifest_url()).unwrap();

    assert_eq!(list.items[0].download.method, DownloadMethod::Get);
}

#[test]
fn refuses_a_body_that_is_not_the_manifest_shape() {
    assert!(parse_manifest(b"[]", &manifest_url()).is_err());
    assert!(parse_manifest(b"not json", &manifest_url()).is_err());
    assert!(parse_manifest(br#"{ "version": 1, "items": [] }"#, &manifest_url()).is_err());
}

#[test]
fn truncates_long_labels() {
    let long = "あ".repeat(300);
    let body = format!(r#"{{ "version": 1, "name": "{long}", "items": [] }}"#);

    let list = parse_manifest(body.as_bytes(), &manifest_url()).unwrap();

    assert_eq!(list.name.chars().count(), LABEL_MAX_CHARS);
}

// --- The minted link ---

#[test]
fn a_minted_path_resolves_against_the_links_origin() {
    let link = Url::parse("https://runeforge.dev/api/mods/a/releases/1/download-link").unwrap();

    let resolved = resolved_link(&link, "/api/download/abc?sig=xyz", "runeforge.dev").unwrap();

    assert_eq!(
        resolved.as_str(),
        "https://runeforge.dev/api/download/abc?sig=xyz"
    );
}

#[test]
fn a_minted_link_may_be_absolute_on_the_same_host() {
    let link = Url::parse("https://runeforge.dev/api/mods/a/releases/1/download-link").unwrap();

    let resolved = resolved_link(&link, "https://runeforge.dev/d/abc", "runeforge.dev").unwrap();

    assert_eq!(resolved.as_str(), "https://runeforge.dev/d/abc");
}

#[test]
fn a_minted_link_may_not_leave_the_host() {
    let link = Url::parse("https://runeforge.dev/api/mods/a/releases/1/download-link").unwrap();

    assert!(resolved_link(&link, "https://cdn.evil.example/d/abc", "runeforge.dev").is_err());
    assert!(resolved_link(&link, "http://runeforge.dev/d/abc", "runeforge.dev").is_err());
}
