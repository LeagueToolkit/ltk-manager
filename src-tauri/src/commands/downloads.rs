use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult, IpcResult};

const RUNEFORGE_ORIGIN: &str = "https://runeforge.dev";
const DIVINESKINS_API_ORIGIN: &str = "https://api.divineskins.gg";
const DIVINESKINS_IMAGE_ORIGIN: &str = "https://lol-assets.divine-cdn.com";
const MOD_LAYOUT_ROUTE: &str = "routes/mods/$modId/layout";
const RELEASES_ROUTE: &str = "routes/mods/$modId/releases/index";
const MAX_DOWNLOAD_IMAGE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeChampion {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeChampionsResponse {
    pub champions: Vec<RuneforgeChampion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeMap {
    pub id: u32,
    pub name: String,
    pub map_string_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeMapsResponse {
    pub maps: Vec<RuneforgeMap>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPublisher {
    pub id: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadModTarget {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadMod {
    pub id: String,
    pub name: String,
    pub updated_at: String,
    pub publisher: DownloadPublisher,
    #[serde(rename = "description", skip_serializing)]
    pub _description: String,
    pub thumbnail_key: Option<String>,
    #[serde(default)]
    pub fallback_image_url: Option<String>,
    #[serde(default)]
    pub video_url: Option<String>,
    pub category: String,
    pub view_count: u64,
    pub download_count: u64,
    pub like_count: u64,
    pub champions: Vec<DownloadModTarget>,
    pub maps: Vec<DownloadModTarget>,
    pub themes: Vec<String>,
    pub features: Vec<String>,
    pub status: String,
    pub is_gilded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadModsResponse {
    pub mods: Vec<DownloadMod>,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRelease {
    pub id: String,
    pub tag: String,
    pub created_at: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadMedia {
    pub images: Vec<String>,
    pub video_url: Option<String>,
}

fn client() -> AppResult<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("LTK-Manager/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AppError::Other(format!("Failed to create HTTP client: {error}")))
}

fn get_text(url: url::Url, provider: &str) -> AppResult<String> {
    let response = client()?
        .get(url)
        .send()
        .map_err(|error| AppError::Other(format!("{provider} request failed: {error}")))?
        .error_for_status()
        .map_err(|error| AppError::Other(format!("{provider} returned an error: {error}")))?;

    response
        .text()
        .map_err(|error| AppError::Other(format!("Failed to read {provider} response: {error}")))
}

#[tauri::command]
pub fn get_download_image_data(url: String) -> IpcResult<String> {
    get_download_image_data_inner(&url).into()
}

fn get_download_image_data_inner(value: &str) -> AppResult<String> {
    let url = validate_download_image_url(value)?;
    let response = client()?
        .get(url)
        .send()
        .map_err(|error| AppError::Other(format!("Mod image request failed: {error}")))?
        .error_for_status()
        .map_err(|error| AppError::Other(format!("Mod image returned an error: {error}")))?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("image/"))
        .ok_or_else(|| AppError::Other("Provider returned a non-image response".into()))?
        .split(';')
        .next()
        .unwrap_or("image/jpeg")
        .to_owned();
    if response.content_length().unwrap_or(0) > MAX_DOWNLOAD_IMAGE_BYTES as u64 {
        return Err(AppError::Other("Provider image was too large".into()));
    }
    let bytes = response
        .bytes()
        .map_err(|error| AppError::Other(format!("Failed to read provider image: {error}")))?;
    if bytes.len() > MAX_DOWNLOAD_IMAGE_BYTES {
        return Err(AppError::Other("Provider image was too large".into()));
    }

    Ok(format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn validate_download_image_url(value: &str) -> AppResult<url::Url> {
    let url = url::Url::parse(value)
        .map_err(|_| AppError::ValidationFailed("Invalid provider image URL".into()))?;
    let allowed = match url.host_str() {
        Some("runeforge.dev") => url.path().starts_with("/cdn-cgi/image/"),
        Some("r2-images-prod.runeforge.dev") => true,
        Some("i.ytimg.com") => url.path().starts_with("/vi/"),
        Some("lol-assets.divine-cdn.com") => true,
        _ => false,
    };
    if url.scheme() != "https" || !allowed {
        return Err(AppError::ValidationFailed(
            "Unsupported provider image URL".into(),
        ));
    }
    Ok(url)
}

fn get_json<T: for<'de> Deserialize<'de>>(url: url::Url, provider: &str) -> AppResult<T> {
    let body = get_text(url, provider)?;
    serde_json::from_str(&body)
        .map_err(|error| AppError::Other(format!("Invalid {provider} response: {error}")))
}

#[tauri::command]
pub fn get_runeforge_champions() -> IpcResult<RuneforgeChampionsResponse> {
    get_runeforge_champions_inner().into()
}

fn get_runeforge_champions_inner() -> AppResult<RuneforgeChampionsResponse> {
    let url = url::Url::parse(&format!("{RUNEFORGE_ORIGIN}/api/champions"))
        .map_err(|error| AppError::Other(error.to_string()))?;
    get_json(url, "RuneForge")
}

#[tauri::command]
pub fn get_runeforge_media(mod_id: String) -> IpcResult<DownloadMedia> {
    get_runeforge_media_inner(&mod_id).into()
}

fn get_runeforge_media_inner(mod_id: &str) -> AppResult<DownloadMedia> {
    let parsed_id = uuid::Uuid::parse_str(mod_id)
        .map_err(|_| AppError::ValidationFailed("Invalid RuneForge mod ID".into()))?;
    let mut url = url::Url::parse(&format!("{RUNEFORGE_ORIGIN}/mods/{parsed_id}.data"))
        .map_err(|error| AppError::Other(error.to_string()))?;
    url.query_pairs_mut()
        .append_pair("_routes", MOD_LAYOUT_ROUTE);

    let body = get_text(url, "RuneForge")?;
    Ok(DownloadMedia {
        images: decode_gallery_image_urls(&body).unwrap_or_default(),
        video_url: decode_video_url(&body).ok().flatten(),
    })
}

#[tauri::command]
pub fn get_runeforge_maps() -> IpcResult<RuneforgeMapsResponse> {
    get_runeforge_maps_inner().into()
}

fn get_runeforge_maps_inner() -> AppResult<RuneforgeMapsResponse> {
    let url = url::Url::parse(&format!("{RUNEFORGE_ORIGIN}/api/maps"))
        .map_err(|error| AppError::Other(error.to_string()))?;
    get_json(url, "RuneForge")
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn get_runeforge_mods(
    page: u32,
    page_size: u32,
    search: String,
    sort_by: String,
    champion_ids: Vec<u32>,
    map_ids: Vec<u32>,
    only_gilded: bool,
) -> IpcResult<DownloadModsResponse> {
    get_runeforge_mods_inner(
        page,
        page_size,
        &search,
        &sort_by,
        &champion_ids,
        &map_ids,
        only_gilded,
    )
    .into()
}

#[allow(clippy::too_many_arguments)]
fn get_runeforge_mods_inner(
    page: u32,
    page_size: u32,
    search: &str,
    sort_by: &str,
    champion_ids: &[u32],
    map_ids: &[u32],
    only_gilded: bool,
) -> AppResult<DownloadModsResponse> {
    if page_size == 0 || page_size > 48 {
        return Err(AppError::ValidationFailed(
            "RuneForge page size must be between 1 and 48".into(),
        ));
    }
    if ![
        "recently_updated",
        "recently_published",
        "most_downloaded",
        "most_viewed",
        "most_liked",
        "trending",
    ]
    .contains(&sort_by)
    {
        return Err(AppError::ValidationFailed(
            "Unsupported RuneForge sort option".into(),
        ));
    }

    let mut url = url::Url::parse(&format!("{RUNEFORGE_ORIGIN}/api/mods"))
        .map_err(|error| AppError::Other(error.to_string()))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("categories[0]", "champion_skin")
            .append_pair("onlyGilded", &only_gilded.to_string())
            .append_pair("page", &page.to_string())
            .append_pair("pageSize", &page_size.to_string())
            .append_pair("sortBy", sort_by);
        if !search.trim().is_empty() {
            query.append_pair("search", search.trim());
        }
        for (index, champion_id) in champion_ids.iter().enumerate() {
            query.append_pair(&format!("champions[{index}]"), &champion_id.to_string());
        }
        for (index, map_id) in map_ids.iter().enumerate() {
            query.append_pair(&format!("maps[{index}]"), &map_id.to_string());
        }
    }

    let mut response: DownloadModsResponse = get_json(url, "RuneForge")?;
    for runeforge_mod in &mut response.mods {
        if runeforge_mod.thumbnail_key.is_none() {
            let media = get_runeforge_media_inner(&runeforge_mod.id).unwrap_or_default();
            runeforge_mod.fallback_image_url = media.images.first().cloned();
            runeforge_mod.video_url = media.video_url;
        }
    }

    Ok(response)
}

#[tauri::command]
pub fn get_runeforge_releases(mod_id: String) -> IpcResult<Vec<DownloadRelease>> {
    get_runeforge_releases_inner(&mod_id).into()
}

fn get_runeforge_releases_inner(mod_id: &str) -> AppResult<Vec<DownloadRelease>> {
    let parsed_id = uuid::Uuid::parse_str(mod_id)
        .map_err(|_| AppError::ValidationFailed("Invalid RuneForge mod ID".into()))?;
    let mut url = url::Url::parse(&format!(
        "{RUNEFORGE_ORIGIN}/mods/{parsed_id}/releases.data"
    ))
    .map_err(|error| AppError::Other(error.to_string()))?;
    url.query_pairs_mut().append_pair(
        "_routes",
        "routes/mods/$modId/layout,routes/mods/$modId/releases/index",
    );

    let body = get_text(url, "RuneForge")?;
    let tape = parse_release_tape(&body)?;
    decode_releases(&tape, &parsed_id.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DivineskinsCatalogResponse {
    content: Vec<DivineskinsCatalogMod>,
    total_elements: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DivineskinsCatalogMod {
    id: u64,
    name: String,
    image_path: Option<String>,
    champion: Option<String>,
    artist_username: Option<String>,
    category: String,
    #[serde(default)]
    last_updated_date: Option<String>,
    #[serde(default)]
    content_updated_date: Option<String>,
    #[serde(default)]
    download_count: u64,
    #[serde(default)]
    view_count: u64,
    #[serde(default)]
    like_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DivineskinsSkinDetail {
    #[serde(default)]
    versions: Vec<DivineskinsVersion>,
    #[serde(default)]
    gallery_images: Vec<String>,
    video_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DivineskinsVersion {
    id: u64,
    title: String,
    upload_date: String,
}

#[derive(Debug, Deserialize)]
struct DivineskinsDownloadResponse {
    url: String,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn get_divineskins_mods(
    page: u32,
    page_size: u32,
    search: String,
    sort_by: String,
    champion_names: Vec<String>,
) -> IpcResult<DownloadModsResponse> {
    get_divineskins_mods_inner(page, page_size, &search, &sort_by, &champion_names).into()
}

fn get_divineskins_mods_inner(
    page: u32,
    page_size: u32,
    search: &str,
    sort_by: &str,
    champion_names: &[String],
) -> AppResult<DownloadModsResponse> {
    if page_size == 0 || page_size > 48 {
        return Err(AppError::ValidationFailed(
            "DivineSkins page size must be between 1 and 48".into(),
        ));
    }

    let divine_sort = match sort_by {
        "recently_updated" => "contentUpdatedDate",
        "recently_published" => "approvedDate",
        "most_downloaded" | "trending" => "downloadCount",
        "most_viewed" => "viewCount",
        "most_liked" => "likeCount",
        _ => {
            return Err(AppError::ValidationFailed(
                "Unsupported DivineSkins sort option".into(),
            ))
        }
    };

    let mut url = url::Url::parse(&format!("{DIVINESKINS_API_ORIGIN}/api/catalog/skins"))
        .map_err(|error| AppError::Other(error.to_string()))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("page", &page.to_string())
            .append_pair("size", &page_size.to_string())
            .append_pair("sortBy", divine_sort)
            .append_pair("direction", "desc")
            .append_pair("categoryId", "1");
        if !search.trim().is_empty() {
            query.append_pair("search", search.trim());
        }
        if let Some(champion) = champion_names.iter().find(|name| !name.trim().is_empty()) {
            query.append_pair("championName", champion.trim());
        }
    }

    let response: DivineskinsCatalogResponse = get_json(url, "DivineSkins")?;
    let mods = response
        .content
        .into_iter()
        .map(|divine_mod| {
            let author = divine_mod
                .artist_username
                .unwrap_or_else(|| "Unknown creator".to_string());
            let champions = divine_mod
                .champion
                .map(|name| vec![DownloadModTarget { id: 0, name }])
                .unwrap_or_default();
            DownloadMod {
                id: divine_mod.id.to_string(),
                name: divine_mod.name,
                updated_at: divine_mod
                    .content_updated_date
                    .or(divine_mod.last_updated_date)
                    .unwrap_or_default(),
                publisher: DownloadPublisher {
                    id: author.clone(),
                    username: author,
                },
                _description: String::new(),
                thumbnail_key: divine_mod.image_path,
                fallback_image_url: None,
                video_url: None,
                category: divine_mod.category,
                view_count: divine_mod.view_count,
                download_count: divine_mod.download_count,
                like_count: divine_mod.like_count,
                champions,
                maps: Vec::new(),
                themes: Vec::new(),
                features: Vec::new(),
                status: "published".to_string(),
                is_gilded: false,
            }
        })
        .collect();

    Ok(DownloadModsResponse {
        mods,
        total: response.total_elements,
    })
}

#[tauri::command]
pub fn get_divineskins_media(mod_id: String) -> IpcResult<DownloadMedia> {
    get_divineskins_media_inner(&mod_id).into()
}

fn get_divineskins_media_inner(mod_id: &str) -> AppResult<DownloadMedia> {
    let detail = get_divineskins_detail(mod_id)?;
    let video_url = detail.video_id.and_then(|id| {
        if id.len() >= 6
            && id.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
        {
            Some(format!("https://www.youtube.com/watch?v={id}"))
        } else {
            None
        }
    });
    let images = detail
        .gallery_images
        .iter()
        .filter_map(|key| divineskins_image_url(key).ok())
        .collect();
    Ok(DownloadMedia { images, video_url })
}

#[tauri::command]
pub fn get_divineskins_releases(mod_id: String) -> IpcResult<Vec<DownloadRelease>> {
    get_divineskins_releases_inner(&mod_id).into()
}

fn get_divineskins_releases_inner(mod_id: &str) -> AppResult<Vec<DownloadRelease>> {
    let mut releases: Vec<_> = get_divineskins_detail(mod_id)?
        .versions
        .into_iter()
        .map(|version| DownloadRelease {
            id: version.id.to_string(),
            tag: version.title,
            created_at: version.upload_date,
            download_url: String::new(),
        })
        .collect();
    releases.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(releases)
}

#[tauri::command]
pub fn get_divineskins_download_url(mod_id: String, version_id: String) -> IpcResult<String> {
    get_divineskins_download_url_inner(&mod_id, &version_id).into()
}

fn get_divineskins_download_url_inner(mod_id: &str, version_id: &str) -> AppResult<String> {
    let mod_id = parse_divineskins_id(mod_id, "mod")?;
    let version_id = parse_divineskins_id(version_id, "version")?;
    let mut url = url::Url::parse(&format!(
        "{DIVINESKINS_API_ORIGIN}/api/celestial/manual/{mod_id}/versions/{version_id}/download-url"
    ))
    .map_err(|error| AppError::Other(error.to_string()))?;
    url.query_pairs_mut().append_pair("turnstileToken", "");

    let response: DivineskinsDownloadResponse = get_json(url, "DivineSkins")?;
    let download_url = url::Url::parse(&response.url)
        .map_err(|_| AppError::Other("DivineSkins returned an invalid download URL".into()))?;
    let trusted_host = download_url
        .host_str()
        .is_some_and(|host| host.ends_with(".r2.cloudflarestorage.com"));
    if download_url.scheme() != "https" || !trusted_host {
        return Err(AppError::Other(
            "DivineSkins returned an unsupported download URL".into(),
        ));
    }
    Ok(download_url.to_string())
}

fn get_divineskins_detail(mod_id: &str) -> AppResult<DivineskinsSkinDetail> {
    let mod_id = parse_divineskins_id(mod_id, "mod")?;
    let url = url::Url::parse(&format!("{DIVINESKINS_API_ORIGIN}/api/skins/{mod_id}"))
        .map_err(|error| AppError::Other(error.to_string()))?;
    get_json(url, "DivineSkins")
}

fn parse_divineskins_id(value: &str, kind: &str) -> AppResult<u64> {
    value
        .parse::<u64>()
        .map_err(|_| AppError::ValidationFailed(format!("Invalid DivineSkins {kind} ID")))
}

fn divineskins_image_url(key: &str) -> AppResult<String> {
    if key.is_empty() || key.starts_with('/') || key.split('/').any(|segment| segment == "..") {
        return Err(AppError::ValidationFailed(
            "Invalid DivineSkins image key".into(),
        ));
    }
    let mut url = url::Url::parse(&format!("{DIVINESKINS_IMAGE_ORIGIN}/"))
        .map_err(|error| AppError::Other(error.to_string()))?;
    url.path_segments_mut()
        .map_err(|_| AppError::Other("Invalid DivineSkins image origin".into()))?
        .extend(key.split('/').filter(|segment| !segment.is_empty()));
    Ok(url.to_string())
}

fn parse_release_tape(body: &str) -> AppResult<Vec<Value>> {
    let mut deserializer = serde_json::Deserializer::from_str(body);
    Vec::<Value>::deserialize(&mut deserializer)
        .map_err(|error| AppError::Other(format!("Invalid RuneForge response: {error}")))
}

fn decode_gallery_image_urls(body: &str) -> AppResult<Vec<String>> {
    let tape = parse_release_tape(body)?;
    let payload = decode_promise_payload(body, &tape, "galleryDataPromise")?;
    let mut images = Vec::new();

    for value in payload.iter().filter_map(Value::as_str) {
        let image = if value.starts_with("/cdn-cgi/image/") {
            Some(format!("{RUNEFORGE_ORIGIN}{value}"))
        } else if value.starts_with("https://r2-images-prod.runeforge.dev/") {
            Some(value.to_owned())
        } else {
            None
        };
        if let Some(image) = image {
            if !images.contains(&image) {
                images.push(image);
            }
        }
    }

    Ok(images)
}

fn decode_video_url(body: &str) -> AppResult<Option<String>> {
    let tape = parse_release_tape(body)?;
    let promise_tape = decode_promise_payload(body, &tape, "modLinksPromise")?;
    let link_refs = promise_tape
        .first()
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Other("RuneForge mod links list was invalid".into()))?;
    let Some(base_ref) = link_refs.iter().filter_map(Value::as_u64).min() else {
        return Ok(None);
    };
    let promise = PromiseTape {
        base: &tape,
        payload: &promise_tape,
        allocation_base: base_ref as usize,
    };

    for link_ref in link_refs.iter().filter_map(Value::as_u64) {
        let link_ref = link_ref as usize;
        let link_type = promise.object_string(link_ref, "linkType");
        let show_in_carousel = promise.object_bool(link_ref, "showInCarousel");
        if link_type == Some("youtube") && show_in_carousel == Some(true) {
            if let Some(url) = promise.object_string(link_ref, "url") {
                return Ok(Some(url.to_owned()));
            }
        }
    }

    Ok(None)
}

fn decode_promise_payload(
    body: &str,
    tape: &[Value],
    promise_field: &str,
) -> AppResult<Vec<Value>> {
    let route = object_field_ref(tape, 0, MOD_LAYOUT_ROUTE)
        .ok_or_else(|| AppError::Other("RuneForge mod layout route was missing".into()))?;
    let data = object_field_ref(tape, route, "data")
        .ok_or_else(|| AppError::Other("RuneForge mod layout data was missing".into()))?;
    let promise_ref = object_field_ref(tape, data, promise_field)
        .ok_or_else(|| AppError::Other(format!("RuneForge {promise_field} was missing")))?;
    let promise_id = tape
        .get(promise_ref)
        .and_then(Value::as_array)
        .filter(|marker| marker.first().and_then(Value::as_str) == Some("P"))
        .and_then(|marker| marker.get(1))
        .and_then(Value::as_u64)
        .ok_or_else(|| AppError::Other(format!("RuneForge {promise_field} was invalid")))?;
    let prefix = format!("P{promise_id}:");
    let payload = body
        .lines()
        .find_map(|line| line.strip_prefix(&prefix))
        .ok_or_else(|| AppError::Other(format!("RuneForge {promise_field} data was missing")))?;

    serde_json::from_str(payload)
        .map_err(|error| AppError::Other(format!("Invalid RuneForge {promise_field}: {error}")))
}

struct PromiseTape<'a> {
    base: &'a [Value],
    payload: &'a [Value],
    allocation_base: usize,
}

impl<'a> PromiseTape<'a> {
    fn value(&self, value_ref: usize) -> Option<&'a Value> {
        if value_ref < self.base.len() {
            return self.base.get(value_ref);
        }

        let payload_index = value_ref.checked_sub(self.allocation_base)? + 1;
        self.payload.get(payload_index)
    }

    fn object_field(&self, object_ref: usize, field: &str) -> Option<&'a Value> {
        let object = self.value(object_ref)?.as_object()?;
        object.iter().find_map(|(key_ref, value_ref)| {
            let key_ref = key_ref.strip_prefix('_')?.parse::<usize>().ok()?;
            if self.value(key_ref)?.as_str()? != field {
                return None;
            }
            self.value(value_ref.as_u64()? as usize)
        })
    }

    fn object_string(&self, object_ref: usize, field: &str) -> Option<&'a str> {
        self.object_field(object_ref, field)?.as_str()
    }

    fn object_bool(&self, object_ref: usize, field: &str) -> Option<bool> {
        self.object_field(object_ref, field)?.as_bool()
    }
}

fn decode_releases(tape: &[Value], mod_id: &str) -> AppResult<Vec<DownloadRelease>> {
    let route = object_field_ref(tape, 0, RELEASES_ROUTE)
        .ok_or_else(|| AppError::Other("RuneForge releases route was missing".into()))?;
    let data = object_field_ref(tape, route, "data")
        .ok_or_else(|| AppError::Other("RuneForge release data was missing".into()))?;
    let response = object_field_ref(tape, data, "releasesResponse")
        .ok_or_else(|| AppError::Other("RuneForge releases response was missing".into()))?;
    let releases = object_field_ref(tape, response, "releases")
        .ok_or_else(|| AppError::Other("RuneForge releases were missing".into()))?;

    let release_refs = tape
        .get(releases)
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Other("Invalid RuneForge releases list".into()))?;

    release_refs
        .iter()
        .filter_map(Value::as_u64)
        .map(|release_ref| {
            let release_ref = release_ref as usize;
            let id = object_string(tape, release_ref, "id")?;
            uuid::Uuid::parse_str(&id)
                .map_err(|_| AppError::Other("RuneForge returned an invalid release ID".into()))?;
            Ok(DownloadRelease {
                download_url: format!("{RUNEFORGE_ORIGIN}/mods/{mod_id}/releases/{id}/download"),
                id,
                tag: object_string(tape, release_ref, "tag")?,
                created_at: object_string(tape, release_ref, "createdAt")?,
            })
        })
        .collect()
}

fn object_field_ref(tape: &[Value], object_ref: usize, field: &str) -> Option<usize> {
    let object = tape.get(object_ref)?.as_object()?;
    object.iter().find_map(|(key_ref, value_ref)| {
        let key_ref = key_ref.strip_prefix('_')?.parse::<usize>().ok()?;
        if tape.get(key_ref)?.as_str()? != field {
            return None;
        }
        value_ref.as_u64().map(|value| value as usize)
    })
}

fn object_string(tape: &[Value], object_ref: usize, field: &str) -> AppResult<String> {
    let value_ref = object_field_ref(tape, object_ref, field)
        .ok_or_else(|| AppError::Other(format!("RuneForge release field '{field}' was missing")))?;
    tape.get(value_ref)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| AppError::Other(format!("RuneForge release field '{field}' was invalid")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decodes_release_from_remix_tape() {
        let tape = vec![
            json!({"_1": 2}),
            json!(RELEASES_ROUTE),
            json!({"_3": 4}),
            json!("data"),
            json!({"_5": 6}),
            json!("releasesResponse"),
            json!({"_7": 8}),
            json!("releases"),
            json!([9]),
            json!({"_10": 11, "_12": 13, "_14": 15}),
            json!("id"),
            json!("0cf51adf-171a-4753-b844-0a1ed67918bb"),
            json!("tag"),
            json!("1.0.0"),
            json!("createdAt"),
            json!("2026-07-27T14:49:21Z"),
        ];

        let releases = decode_releases(&tape, "e34c28a1-90e0-4f19-807d-d82e1429f878")
            .expect("release should decode");
        assert_eq!(releases.len(), 1);
        assert_eq!(releases[0].tag, "1.0.0");
        assert!(releases[0].download_url.ends_with(
            "/e34c28a1-90e0-4f19-807d-d82e1429f878/releases/0cf51adf-171a-4753-b844-0a1ed67918bb/download"
        ));
    }

    #[test]
    fn parses_tape_before_turbo_stream_promise_lines() {
        let tape = parse_release_tape("[null,\"data\"]\nP12:[{\"value\":true}]\nP13:-5")
            .expect("the first JSON value should parse");
        assert_eq!(tape, vec![Value::Null, json!("data")]);
    }

    #[test]
    fn accepts_mods_without_a_thumbnail() {
        let response: DownloadModsResponse = serde_json::from_value(json!({
            "mods": [{
                "id": "94d43bc0-16ea-4475-8b46-f9c315da7904",
                "name": "Mod without thumbnail",
                "updatedAt": "2026-07-27T00:00:00Z",
                "publisher": { "id": "publisher", "username": "author" },
                "description": "",
                "thumbnailKey": null,
                "fallbackImageUrl": null,
                "videoUrl": null,
                "category": "champion_skin",
                "viewCount": 0,
                "downloadCount": 0,
                "likeCount": 0,
                "champions": [],
                "maps": [],
                "themes": [],
                "features": [],
                "status": "working",
                "isGilded": false
            }],
            "total": 1
        }))
        .expect("nullable thumbnails should deserialize");

        assert_eq!(response.mods[0].thumbnail_key, None);
        let serialized = serde_json::to_value(response).expect("mods response should serialize");
        assert!(serialized["mods"][0].get("description").is_none());
    }

    #[test]
    fn decodes_carousel_youtube_link_from_turbo_promise() {
        let body = concat!(
            r#"[{"_1":2},"routes/mods/$modId/layout",{"_3":4},"data",{"_5":6},"modLinksPromise",["P",6]]"#,
            "\n",
            r#"P6:[[8],{"_10":11,"_12":13,"_14":15},"unused","linkType","youtube","showInCarousel",true,"url","https://youtu.be/Q0u666apRnE"]"#,
        );

        assert_eq!(
            decode_video_url(body).expect("video URL should decode"),
            Some("https://youtu.be/Q0u666apRnE".to_owned())
        );
    }

    #[test]
    fn decodes_gallery_images_from_turbo_promise() {
        let body = concat!(
            r#"[{"_1":2},"routes/mods/$modId/layout",{"_3":4},"data",{"_5":6},"galleryDataPromise",["P",6]]"#,
            "\n",
            r#"P6:[[8,9],"imageUrl","/cdn-cgi/image/width=1280/https://r2-images-prod.runeforge.dev/gallery-1.png","/cdn-cgi/image/width=1280/https://r2-images-prod.runeforge.dev/gallery-2.png"]"#,
        );

        assert_eq!(
            decode_gallery_image_urls(body).expect("gallery images should decode"),
            vec![
                "https://runeforge.dev/cdn-cgi/image/width=1280/https://r2-images-prod.runeforge.dev/gallery-1.png",
                "https://runeforge.dev/cdn-cgi/image/width=1280/https://r2-images-prod.runeforge.dev/gallery-2.png",
            ]
        );
    }

    #[test]
    fn ignores_youtube_links_hidden_from_the_carousel() {
        let body = concat!(
            r#"[{"_1":2},"routes/mods/$modId/layout",{"_3":4},"data",{"_5":6},"modLinksPromise",["P",6]]"#,
            "\n",
            r#"P6:[[8],{"_10":11,"_12":13,"_14":15},"unused","linkType","youtube","showInCarousel",false,"url","https://youtu.be/hidden"]"#,
        );

        assert_eq!(decode_video_url(body).expect("links should decode"), None);
    }

    #[test]
    fn only_accepts_known_download_image_hosts() {
        assert!(validate_download_image_url(
            "https://runeforge.dev/cdn-cgi/image/width=600/https://r2-images-prod.runeforge.dev/image.jpg"
        )
        .is_ok());
        assert!(
            validate_download_image_url("https://r2-images-prod.runeforge.dev/image.jpg").is_ok()
        );
        assert!(validate_download_image_url(
            "https://lol-assets.divine-cdn.com/gallery/2608/image.jpg"
        )
        .is_ok());
        assert!(validate_download_image_url("https://example.com/image.jpg").is_err());
        assert!(validate_download_image_url("http://runeforge.dev/cdn-cgi/image/test").is_err());
    }

    #[test]
    fn decodes_divineskins_catalog_and_detail_fields() {
        let catalog: DivineskinsCatalogResponse = serde_json::from_value(json!({
            "content": [{
                "id": 2610,
                "name": "Lucian Onyakopon",
                "imagePath": "thumbnails/2610/image.webp",
                "champion": "Lucian",
                "artistUsername": "youtzooooo",
                "category": "Champion Mod",
                "lastUpdatedDate": "2026-07-27T12:05:48Z",
                "contentUpdatedDate": "2026-07-27T12:05:48Z",
                "downloadCount": 8,
                "viewCount": 79,
                "likeCount": 0
            }],
            "totalElements": 1390
        }))
        .expect("DivineSkins catalog should deserialize");
        assert_eq!(catalog.total_elements, 1390);
        assert_eq!(catalog.content[0].champion.as_deref(), Some("Lucian"));

        let detail: DivineskinsSkinDetail = serde_json::from_value(json!({
            "videoId": "CddufEzJ6hs",
            "versions": [{
                "id": 2324,
                "title": "1.0.0",
                "uploadDate": "2026-07-27T01:36:14Z"
            }],
            "galleryImages": ["gallery/2608/image.jpg"]
        }))
        .expect("DivineSkins detail should deserialize");
        assert_eq!(detail.versions[0].id, 2324);
        assert_eq!(detail.gallery_images, vec!["gallery/2608/image.jpg"]);
    }

    #[test]
    fn builds_safe_divineskins_image_urls() {
        assert_eq!(
            divineskins_image_url("gallery/2608/image with spaces.jpg")
                .expect("valid image key should resolve"),
            "https://lol-assets.divine-cdn.com/gallery/2608/image%20with%20spaces.jpg"
        );
        assert!(divineskins_image_url("../private/image.jpg").is_err());
    }
}
