use crate::error::{AppError, AppResult};
use regex::Regex;
use reqwest::blocking::{Client, Response};
use reqwest::header::CONTENT_TYPE;
use serde::Deserialize;
use std::io::Read;
use std::sync::LazyLock;
use std::time::Duration;
use url::Url;

const MAX_PAGE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 12 * 1024 * 1024;

static RELEASE_MOD_ID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)mod_releases(?:%2f|/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:%2f|/)",
    )
    .expect("valid RuneForge release regex")
});
static MOD_PAGE_ID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)/mods/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:/|$)")
        .expect("valid RuneForge mod page regex")
});
static META_TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<meta\b[^>]*>").expect("valid meta tag regex"));
static HTML_ATTRIBUTE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)([a-z_:][-a-z0-9_:]*)\s*=\s*(?:"([^"]*)"|'([^']*)')"#)
        .expect("valid HTML attribute regex")
});

/// Fetch the public card thumbnail associated with a RuneForge release URL.
///
/// RuneForge download URLs contain the parent mod UUID even though the
/// downloaded `.fantome` often contains only `META/info.json`. The public mod
/// page exposes its primary artwork through `og:image`.
pub fn fetch_runeforge_thumbnail(download_url: &str) -> AppResult<Option<Vec<u8>>> {
    let Some(mod_id) = runeforge_mod_id(download_url) else {
        return Ok(None);
    };

    let page_url = Url::parse(&format!("https://www.runeforge.dev/mods/{mod_id}"))
        .map_err(|error| AppError::Other(format!("Failed to build RuneForge URL: {error}")))?;
    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(concat!("LTK-Manager/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AppError::Other(format!("Failed to create HTTP client: {error}")))?;

    let page = client
        .get(page_url.clone())
        .send()
        .and_then(Response::error_for_status)
        .map_err(|error| AppError::Other(format!("Failed to load RuneForge page: {error}")))?;
    let html = read_limited(page, MAX_PAGE_BYTES, "RuneForge page")?;
    let html = String::from_utf8(html)
        .map_err(|error| AppError::Other(format!("RuneForge page was not UTF-8: {error}")))?;
    let Some(image_reference) = extract_og_image(&html) else {
        return Ok(None);
    };

    let image_url = page_url
        .join(&decode_html_attribute(&image_reference))
        .map_err(|error| AppError::Other(format!("Invalid RuneForge image URL: {error}")))?;
    if image_url.scheme() != "https" || !is_runeforge_host(&image_url) {
        return Err(AppError::ValidationFailed(
            "RuneForge thumbnail points to an untrusted host".to_string(),
        ));
    }

    fetch_image(&client, image_url).map(Some)
}

/// Find artwork for a legacy or manually imported mod in RuneForge's public catalog.
/// Ambiguous and weak matches deliberately return `None`.
pub fn find_runeforge_thumbnail(name: &str, authors: &[String]) -> AppResult<Option<Vec<u8>>> {
    let Some(search_term) = search_term(name) else {
        return Ok(None);
    };
    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(concat!("LTK-Manager/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AppError::Other(format!("Failed to create HTTP client: {error}")))?;
    let response = client
        .get("https://www.runeforge.dev/api/mods")
        .query(&[("search", search_term.as_str()), ("pageSize", "20")])
        .send()
        .and_then(Response::error_for_status)
        .map_err(|error| AppError::Other(format!("Failed to search RuneForge: {error}")))?;
    let body = read_limited(response, MAX_PAGE_BYTES, "RuneForge search response")?;
    let search: ModSearchResponse = serde_json::from_slice(&body)
        .map_err(|error| AppError::Other(format!("Invalid RuneForge search response: {error}")))?;

    let Some(found) = best_match(name, authors, search.mods) else {
        return Ok(None);
    };
    let thumbnail_key = found
        .thumbnail_key
        .expect("best_match excludes missing thumbnail keys");
    let image_url = Url::parse("https://r2-images-prod.runeforge.dev/")
        .and_then(|base| base.join(&thumbnail_key))
        .map_err(|error| AppError::Other(format!("Invalid RuneForge image URL: {error}")))?;
    fetch_image(&client, image_url).map(Some)
}

fn fetch_image(client: &Client, image_url: Url) -> AppResult<Vec<u8>> {
    if image_url.scheme() != "https" || !is_runeforge_host(&image_url) {
        return Err(AppError::ValidationFailed(
            "RuneForge thumbnail points to an untrusted host".to_string(),
        ));
    }
    let image_response = client
        .get(image_url)
        .send()
        .and_then(Response::error_for_status)
        .map_err(|error| AppError::Other(format!("Failed to load RuneForge image: {error}")))?;
    if !image_response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("image/"))
    {
        return Err(AppError::ValidationFailed(
            "RuneForge thumbnail response was not an image".to_string(),
        ));
    }

    read_limited(image_response, MAX_IMAGE_BYTES, "RuneForge image")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModSearchResponse {
    mods: Vec<RuneforgeMod>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuneforgeMod {
    name: String,
    thumbnail_key: Option<String>,
    publisher: Option<RuneforgePublisher>,
}

#[derive(Debug, Deserialize)]
struct RuneforgePublisher {
    username: String,
}

fn best_match(
    name: &str,
    authors: &[String],
    candidates: Vec<RuneforgeMod>,
) -> Option<RuneforgeMod> {
    let expected_name = normalize(name);
    let mut ranked: Vec<(u16, RuneforgeMod)> = candidates
        .into_iter()
        .filter(|candidate| {
            candidate
                .thumbnail_key
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty())
        })
        .filter_map(|candidate| {
            let candidate_name = normalize(&candidate.name);
            let name_score = if candidate_name == expected_name {
                100
            } else if candidate_name.contains(&expected_name)
                || expected_name.contains(&candidate_name)
            {
                70
            } else {
                0
            };
            let author_matches = authors.iter().any(|author| {
                candidate
                    .publisher
                    .as_ref()
                    .is_some_and(|publisher| author.eq_ignore_ascii_case(&publisher.username))
            });
            let author_score = if author_matches { 40 } else { 0 };
            let score = name_score + author_score;
            (score >= 70).then_some((score, candidate))
        })
        .collect();
    ranked.sort_by_key(|candidate| std::cmp::Reverse(candidate.0));

    let best_score = ranked.first()?.0;
    if ranked.get(1).is_some_and(|second| second.0 == best_score) {
        return None;
    }
    Some(ranked.remove(0).1)
}

fn search_term(name: &str) -> Option<String> {
    split_words(name)
        .into_iter()
        .filter(|word| word.len() >= 4)
        .filter(|word| {
            !matches!(
                word.to_ascii_lowercase().as_str(),
                "skin" | "custom" | "league" | "default" | "mod"
            )
        })
        .max_by_key(String::len)
}

fn split_words(value: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut previous_lowercase = false;
    for character in value.chars() {
        if !character.is_alphanumeric() {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            previous_lowercase = false;
            continue;
        }
        if character.is_uppercase() && previous_lowercase && !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
        previous_lowercase = character.is_lowercase();
        current.push(character);
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn runeforge_mod_id(download_url: &str) -> Option<&str> {
    let parsed = Url::parse(download_url).ok()?;
    if parsed.scheme() != "https" || !is_runeforge_host(&parsed) {
        return None;
    }
    RELEASE_MOD_ID
        .captures(download_url)
        .or_else(|| MOD_PAGE_ID.captures(download_url))
        .and_then(|captures| captures.get(1))
        .map(|capture| capture.as_str())
}

fn is_runeforge_host(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        let host = host.to_ascii_lowercase();
        host == "runeforge.dev" || host.ends_with(".runeforge.dev")
    })
}

fn extract_og_image(html: &str) -> Option<String> {
    for meta in META_TAG.find_iter(html) {
        let mut property = None;
        let mut content = None;
        for attribute in HTML_ATTRIBUTE.captures_iter(meta.as_str()) {
            let name = attribute.get(1)?.as_str();
            let value = attribute.get(2).or_else(|| attribute.get(3))?.as_str();
            if name.eq_ignore_ascii_case("property") {
                property = Some(value);
            } else if name.eq_ignore_ascii_case("content") {
                content = Some(value);
            }
        }
        if property.is_some_and(|value| value.eq_ignore_ascii_case("og:image")) {
            return content
                .filter(|value| !value.is_empty())
                .map(str::to_string);
        }
    }
    None
}

fn decode_html_attribute(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&#x26;", "&")
}

fn read_limited(mut response: Response, limit: u64, label: &str) -> AppResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err(AppError::ValidationFailed(format!(
            "{label} exceeds the {} MiB limit",
            limit / 1024 / 1024
        )));
    }

    let mut bytes = Vec::new();
    response.by_ref().take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(AppError::ValidationFailed(format!(
            "{label} exceeds the {} MiB limit",
            limit / 1024 / 1024
        )));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOD_ID: &str = "c73a20c1-4ef2-42c7-b688-ef60721d33f8";

    #[test]
    fn extracts_mod_id_from_encoded_release_url() {
        let url = format!(
            "https://r2-prod.runeforge.dev/mod_releases%2F{MOD_ID}%2Fskin.fantome?filename=skin.fantome"
        );
        assert_eq!(runeforge_mod_id(&url), Some(MOD_ID));
    }

    #[test]
    fn extracts_mod_id_from_current_download_route() {
        let url = format!(
            "https://runeforge.dev/mods/{MOD_ID}/releases/8604dd1a-7995-4f3b-88ec-de1d8a2b4260/download"
        );
        assert_eq!(runeforge_mod_id(&url), Some(MOD_ID));
    }

    #[test]
    fn rejects_lookalike_and_unrelated_urls() {
        let lookalike =
            format!("https://runeforge.dev.evil.example/mod_releases%2F{MOD_ID}%2Fskin.fantome");
        assert_eq!(runeforge_mod_id(&lookalike), None);
        assert_eq!(
            runeforge_mod_id("https://runeforge.dev/unrelated/skin.fantome"),
            None
        );
    }

    #[test]
    fn extracts_og_image_regardless_of_attribute_order_and_quotes() {
        let first = r#"<meta property="og:image" content="/images/card.webp">"#;
        let second = r#"<meta content='https://cdn.runeforge.dev/card.png' property='OG:IMAGE'>"#;
        assert_eq!(
            extract_og_image(first).as_deref(),
            Some("/images/card.webp")
        );
        assert_eq!(
            extract_og_image(second).as_deref(),
            Some("https://cdn.runeforge.dev/card.png")
        );
    }

    #[test]
    fn decodes_url_separators_in_html_attributes() {
        assert_eq!(
            decode_html_attribute("https://runeforge.dev/image?a=1&amp;b=2"),
            "https://runeforge.dev/image?a=1&b=2"
        );
    }

    fn candidate(name: &str, author: &str, thumbnail_key: &str) -> RuneforgeMod {
        RuneforgeMod {
            name: name.to_string(),
            thumbnail_key: Some(thumbnail_key.to_string()),
            publisher: Some(RuneforgePublisher {
                username: author.to_string(),
            }),
        }
    }

    #[test]
    fn derives_search_term_from_compact_fantome_name() {
        assert_eq!(
            search_term("DoomslayerDarius").as_deref(),
            Some("Doomslayer")
        );
        assert_eq!(search_term("My Custom Skin").as_deref(), None);
    }

    #[test]
    fn matches_contained_name_and_author() {
        let result = best_match(
            "DoomslayerDarius",
            &["Sauronkaiser".to_string()],
            vec![candidate(
                "The Doomslayer (Darius)",
                "Sauronkaiser",
                "card.webp",
            )],
        )
        .unwrap();
        assert_eq!(result.thumbnail_key.as_deref(), Some("card.webp"));
    }

    #[test]
    fn refuses_equally_ranked_matches() {
        let result = best_match(
            "Example Skin",
            &[],
            vec![
                candidate("Example Skin", "one", "one.webp"),
                candidate("Example Skin", "two", "two.webp"),
            ],
        );
        assert!(result.is_none());
    }
}
