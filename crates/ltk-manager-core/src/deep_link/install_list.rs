//! The list an `ltk://install-list` link names: the manifest the app fetches, the limits it is
//! read under, and the link each item downloads from.
//!
//! The link carries a manifest URL and nothing else. The manifest lists the mods in the owner's
//! order, and names for each one the route that mints its download link. A download link is
//! minted just before that item downloads, never in advance, because the site signs each link
//! for minutes and a long list runs past that.

use std::io::Read;
use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};

use super::download::{DownloadError, user_agent};
use super::public_https_url;
use ltk_manager_base::error::{AppError, AppResult};

/// The manifest version this app reads. Any other version is refused whole.
pub const MANIFEST_VERSION: u64 = 1;

/// The most items a list carries, matching the site's `MAX_MODS_PER_COLLECTION`.
pub const MAX_ITEMS: usize = 500;

/// The most bytes a manifest body may be. 500 items fit with room.
pub const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

/// How long a manifest fetch or a link mint may take, whole.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Longest `name` or `author` kept from an item, in characters.
const LABEL_MAX_CHARS: usize = 256;

/// What the site publishes at the manifest URL, before any check.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u64,
    name: String,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    page_url: Option<String>,
    items: Vec<ManifestItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestItem {
    id: String,
    name: String,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    page_url: Option<String>,
    download: DownloadLink,
}

/// A list of mods to install, as the manifest names them, within the limits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InstallList {
    pub name: String,
    pub author: Option<String>,
    /// The site, as the manifest names it. The link's `source` stands in where this is `None`.
    pub source: Option<String>,
    /// The page the list is read on.
    pub page_url: Option<String>,
    /// In the owner's order, top first. Only mods the reader could install when the manifest
    /// was minted.
    pub items: Vec<InstallListItem>,
}

/// One mod of a list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InstallListItem {
    /// The mod's id on the site, which the origin record of an installed mod keeps.
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    /// The version the site lists, as the site writes it.
    pub version: Option<String>,
    pub page_url: Option<String>,
    pub download: DownloadLink,
}

/// Where an item's file comes from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DownloadLink {
    pub method: DownloadMethod,
    /// On the manifest's host, over `https`.
    pub url: String,
}

/// How a [`DownloadLink`] turns into a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(specta::Type))]
#[serde(rename_all = "UPPERCASE")]
pub enum DownloadMethod {
    /// A POST to the URL answers `{ path, expiresAt }`: the signed path to download, relative to
    /// the URL's origin.
    Post,
    /// The URL is the file.
    Get,
}

/// What a link mint answers. `expiresAt` is not read: the server decides at download time.
#[derive(Debug, Deserialize)]
struct MintedLink {
    path: String,
}

/// Reads `body`, fetched from `manifest_url`, into the list it carries.
///
/// # Errors
///
/// Fails with [`AppError::ValidationFailed`] for a body that is not the manifest shape, is a
/// version other than [`MANIFEST_VERSION`], lists more than [`MAX_ITEMS`] items, or carries an
/// item that [`check_item`] refuses. A refused manifest installs nothing.
pub fn parse_manifest(body: &[u8], manifest_url: &Url) -> AppResult<InstallList> {
    let manifest: Manifest = serde_json::from_slice(body)
        .map_err(|e| AppError::ValidationFailed(format!("The install list did not read: {e}")))?;

    if manifest.version != MANIFEST_VERSION {
        return Err(AppError::ValidationFailed(format!(
            "The install list is version {}, and this app reads version {MANIFEST_VERSION}",
            manifest.version
        )));
    }

    if manifest.items.len() > MAX_ITEMS {
        return Err(AppError::ValidationFailed(format!(
            "The install list has {} items, and the most this app installs is {MAX_ITEMS}",
            manifest.items.len()
        )));
    }

    let host = host_of(manifest_url)?;
    let items = manifest
        .items
        .into_iter()
        .map(|item| {
            let item = InstallListItem {
                id: item.id,
                name: truncate(item.name),
                author: item.author.map(truncate),
                version: item.version,
                page_url: item.page_url,
                download: item.download,
            };
            check_item(&item, &host).map(|()| item)
        })
        .collect::<AppResult<Vec<_>>>()?;

    Ok(InstallList {
        name: truncate(manifest.name),
        author: manifest.author.map(truncate),
        source: manifest.source.map(truncate),
        page_url: manifest.page_url,
        items,
    })
}

/// Checks that `item` names a mod and downloads from `manifest_host` over `https`.
///
/// Run on the manifest as it is read, and again on the items a confirmed install hands back,
/// so no item reaches a download that the manifest check did not pass.
///
/// # Errors
///
/// Fails with [`AppError::ValidationFailed`] naming the item and what was wrong.
pub fn check_item(item: &InstallListItem, manifest_host: &str) -> AppResult<()> {
    if item.id.trim().is_empty() {
        return Err(AppError::ValidationFailed(
            "An install list item has no id".into(),
        ));
    }
    if item.name.trim().is_empty() {
        return Err(AppError::ValidationFailed(format!(
            "Install list item '{}' has no name",
            item.id
        )));
    }

    let url = public_https_url(&item.download.url).map_err(|e| {
        AppError::ValidationFailed(format!("Install list item '{}': {e}", item.name))
    })?;
    if !same_host(&url, manifest_host) {
        return Err(AppError::ValidationFailed(format!(
            "Install list item '{}' downloads from {}, outside the list's host {manifest_host}",
            item.name,
            url.host_str().unwrap_or("nowhere")
        )));
    }

    Ok(())
}

/// Fetches and reads the manifest at `url`, within [`MAX_MANIFEST_BYTES`] and the request
/// timeout. `version` names the running app in the `User-Agent`.
///
/// # Errors
///
/// Fails with a [`DownloadError`] if the server refuses the URL or is not reached, and with
/// [`AppError::ValidationFailed`] if the body is too large or [`parse_manifest`] refuses it.
pub fn fetch_install_list(url: &str, version: &str) -> AppResult<InstallList> {
    let manifest_url = public_https_url(url)?;

    let response = client(version)
        .and_then(|client| {
            client
                .get(manifest_url.clone())
                .header(reqwest::header::ACCEPT, "application/json")
                .send()
                .map_err(|error| DownloadError::transport(&error))
        })
        .map_err(AppError::from)?;

    let status = response.status();
    if !status.is_success() {
        return Err(AppError::from(DownloadError::from_status(
            status,
            response.headers(),
        )));
    }

    if response
        .content_length()
        .is_some_and(|len| len > MAX_MANIFEST_BYTES)
    {
        return Err(too_large());
    }

    let mut body = Vec::new();
    response
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|error| {
            AppError::from(DownloadError::Offline {
                detail: format!("the install list did not arrive whole: {error}"),
            })
        })?;
    if body.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(too_large());
    }

    parse_manifest(&body, &manifest_url)
}

/// The URL `link` downloads from, minted now where the link is a [`DownloadMethod::Post`].
///
/// The minted path resolves against the link's origin and must stay on the manifest's host.
///
/// # Errors
///
/// Fails with a [`DownloadError`] if the mint is refused or the server is not reached, and with
/// [`AppError::ValidationFailed`] if the answer is not a path on the manifest's host.
pub fn resolve_download(
    link: &DownloadLink,
    manifest_url: &Url,
    version: &str,
) -> AppResult<String> {
    let link_url = public_https_url(&link.url)?;

    match link.method {
        DownloadMethod::Get => Ok(link.url.clone()),
        DownloadMethod::Post => {
            let response = client(version)
                .and_then(|client| {
                    client
                        .post(link_url.clone())
                        .header(reqwest::header::ACCEPT, "application/json")
                        .send()
                        .map_err(|error| DownloadError::transport(&error))
                })
                .map_err(AppError::from)?;

            let status = response.status();
            if !status.is_success() {
                return Err(AppError::from(DownloadError::from_status(
                    status,
                    response.headers(),
                )));
            }

            let body = response.bytes().map_err(|error| {
                AppError::from(DownloadError::Offline {
                    detail: format!("the download link did not arrive whole: {error}"),
                })
            })?;
            let minted: MintedLink = serde_json::from_slice(&body).map_err(|e| {
                AppError::ValidationFailed(format!("The download link did not read: {e}"))
            })?;

            resolved_link(&link_url, &minted.path, &host_of(manifest_url)?)
                .map(|url| url.to_string())
        }
    }
}

/// `path`, as a link mint answered it, resolved against `link_url` and held to `manifest_host`.
///
/// # Errors
///
/// Fails with [`AppError::ValidationFailed`] for a path that does not resolve, or resolves to
/// another scheme or host.
pub fn resolved_link(link_url: &Url, path: &str, manifest_host: &str) -> AppResult<Url> {
    let resolved = link_url.join(path).map_err(|e| {
        AppError::ValidationFailed(format!("The download link did not resolve: {e}"))
    })?;

    if resolved.scheme() != "https" || !same_host(&resolved, manifest_host) {
        return Err(AppError::ValidationFailed(format!(
            "The download link leads off the list's host {manifest_host}"
        )));
    }

    Ok(resolved)
}

/// Whether `url` is on `host`, ignoring case.
fn same_host(url: &Url, host: &str) -> bool {
    url.host_str()
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case(host))
}

/// The lower-cased host of `url`.
fn host_of(url: &Url) -> AppResult<String> {
    url.host_str()
        .map(str::to_lowercase)
        .ok_or_else(|| AppError::ValidationFailed("The install list URL names no host".into()))
}

fn too_large() -> AppError {
    AppError::ValidationFailed(format!(
        "The install list is larger than {} KiB",
        MAX_MANIFEST_BYTES / 1024
    ))
}

fn truncate(label: String) -> String {
    match label.char_indices().nth(LABEL_MAX_CHARS) {
        Some((idx, _)) => label[..idx].to_string(),
        None => label,
    }
}

/// A client with the request timeout, naming the running `version` in the `User-Agent`.
fn client(version: &str) -> Result<reqwest::blocking::Client, DownloadError> {
    reqwest::blocking::Client::builder()
        .user_agent(user_agent(version))
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| DownloadError::transport(&error))
}

#[cfg(test)]
mod tests;
