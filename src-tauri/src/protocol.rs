//! The `ltk-asset` URI scheme, which serves a preview of one asset.
//!
//! A preview is an image, and an image belongs in an `<img>` rather than on the
//! JavaScript heap. Handing the webview a URL lets it decode with its own
//! decoder and lays out, zooms and paints the result for free, where an IPC
//! result would arrive as base64 for the frontend to reassemble by hand.

use std::io;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ltk_manager_core::game_wads::WadCache;
use ltk_manager_core::preview::{AssetRef, Preview, PreviewError, PreviewImage};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::state::SettingsState;

/// The scheme a preview URL carries.
///
/// Windows serves it as `http://ltk-asset.localhost/<token>` and every other
/// platform as `ltk-asset://localhost/<token>`, which is what
/// `convertFileSrc(token, "ltk-asset")` writes for the caller.
pub const SCHEME: &str = "ltk-asset";

/// Answer one preview request.
///
/// The path is a base64url [`AssetRef`], unpadded. That alphabet survives
/// `encodeURIComponent` untouched, so the token arrives verbatim and no
/// percent-decoding step comes between the URL and the reference.
pub fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let token = request.uri().path().trim_start_matches('/');

    let asset = match decode(token) {
        Ok(asset) => asset,
        Err(message) => return message_response(StatusCode::BAD_REQUEST, &message),
    };

    let config = match app.state::<SettingsState>().config() {
        Ok(config) => config,
        Err(e) => return message_response(status_for(&e), &e.to_string()),
    };

    match asset.preview(&config, &app.state::<WadCache>()) {
        Ok(Preview::Image(image)) => image_response(image),
        Err(e) => {
            tracing::debug!("No preview for {asset:?}: {e}");
            message_response(status_for(&e), &e.to_string())
        }
    }
}

/// Read an asset reference out of a URL token.
fn decode(token: &str) -> Result<AssetRef, String> {
    let json = URL_SAFE_NO_PAD
        .decode(token)
        .map_err(|e| format!("Not a base64url asset token: {e}"))?;
    serde_json::from_slice(&json).map_err(|e| format!("Not an asset reference: {e}"))
}

/// The status that tells a caller what went wrong.
fn status_for(error: &AppError) -> StatusCode {
    match error {
        AppError::Preview(PreviewError::Unsupported(_)) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        AppError::InvalidPath(_) | AppError::LeagueNotFound => StatusCode::NOT_FOUND,
        AppError::Io(e) if e.kind() == io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn image_response(image: PreviewImage) -> Response<Vec<u8>> {
    build(StatusCode::OK, image.mime, image.bytes)
}

fn message_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    build(status, "text/plain; charset=utf-8", message.into())
}

/// # Panics
///
/// Panics when a header this module writes is not a valid header, which is a
/// bug here rather than anything a request can cause.
fn build(status: StatusCode, mime: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        /* No store, because a layer file changes under the viewer whenever a
        modder replaces it and a stale image is worse than a second decode. */
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .expect("the headers this module writes are static and valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token_for(asset: &AssetRef) -> String {
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(asset).unwrap())
    }

    #[test]
    fn a_token_round_trips_through_the_url_alphabet() {
        let asset = AssetRef::Layer {
            project: r"C:\Users\someone\Projects\Charizard Smolder X".to_owned(),
            layer: "base".to_owned(),
            path: "assets/characters/smolder/hud/icon.tex".to_owned(),
        };

        let token = token_for(&asset);

        assert!(
            token
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "a token has to survive encodeURIComponent unchanged: {token}"
        );
        assert_eq!(decode(&token).unwrap(), asset);
    }

    /// The token the frontend's `encodeToken` writes, decoded by this module.
    ///
    /// A round trip through this module alone would agree with itself whatever
    /// either side spelled, so the literal here is what the browser produced
    /// for the reference the assertions name. It is the one seam neither side's
    /// own tests cover.
    #[test]
    fn a_token_the_frontend_wrote_decodes_here() {
        const FROM_THE_WEBVIEW: &str = "eyJraW5kIjoibGF5ZXIiLCJwcm9qZWN0IjoiQzpcXG1vZHNcXENoYXJpemFyZCBTbW9sZGVyIFgiLCJsYXllciI6ImJhc2UiLCJwYXRoIjoiYXNzZXRzL2NoYXJhY3RlcnMvc21vbGRlci9odWQvaWNvbi50ZXgifQ";

        let asset = decode(FROM_THE_WEBVIEW).unwrap();

        assert_eq!(
            asset,
            AssetRef::Layer {
                project: r"C:\mods\Charizard Smolder X".to_owned(),
                layer: "base".to_owned(),
                path: "assets/characters/smolder/hud/icon.tex".to_owned(),
            }
        );
    }

    #[test]
    fn a_token_that_is_not_a_reference_is_rejected() {
        assert!(decode("not base64!!").is_err());
        assert!(decode(&URL_SAFE_NO_PAD.encode(b"[1, 2, 3]")).is_err());
    }

    #[test]
    fn an_unsupported_kind_is_an_unsupported_media_type() {
        let error = AppError::Preview(PreviewError::Unsupported(
            ltk_manager_core::preview::LeagueFileKind::PropertyBin,
        ));
        assert_eq!(status_for(&error), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[test]
    fn a_missing_asset_is_a_not_found() {
        let missing = AppError::Io(io::Error::from(io::ErrorKind::NotFound));
        assert_eq!(status_for(&missing), StatusCode::NOT_FOUND);

        let escaped = AppError::InvalidPath("nope".to_owned());
        assert_eq!(status_for(&escaped), StatusCode::NOT_FOUND);
    }

    #[test]
    fn anything_else_is_an_internal_error() {
        let error = AppError::Other("the disk gave up".to_owned());
        assert_eq!(status_for(&error), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
