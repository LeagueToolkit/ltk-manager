//! The `ltk-asset` URI scheme, which serves a preview of one asset.
//!
//! A preview is an image, and an image belongs in an `<img>` rather than on the
//! JavaScript heap. Handing the webview a URL lets it decode with its own
//! decoder and lays out, zooms and paints the result for free, where an IPC
//! result would arrive as base64 for the frontend to reassemble by hand.

use std::io;
use std::num::NonZeroU32;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ltk_manager_core::game_wads::WadCache;
use ltk_manager_core::preview::{AssetRef, Preview, PreviewError, PreviewImage, PreviewRequest};
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

/// The query parameter naming the width a thumbnail or a swatch draws at, per
/// "Thumbnails" in docs/ux/PROJECT_EDITOR.md.
const WIDTH_PARAMETER: &str = "w";

/// The query parameter naming what the response carries, where an image is not it.
const FORM_PARAMETER: &str = "as";

/// The [`FORM_PARAMETER`] value asking a mesh for its vertex buffer.
const GEOMETRY_FORM: &str = "geometry";

/// The [`FORM_PARAMETER`] value asking a skeleton for its joint buffer.
const SKELETON_FORM: &str = "skeleton";

/// The [`FORM_PARAMETER`] value asking a clip for its baked pose buffer.
const ANIMATION_FORM: &str = "animation";

/// The [`FORM_PARAMETER`] value asking a cube map for its six faces as one image.
const CUBE_FORM: &str = "cube";

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

    let wanted = match requested(request.uri().query()) {
        Ok(wanted) => wanted,
        Err(message) => return message_response(StatusCode::BAD_REQUEST, &message),
    };

    let config = app.state::<SettingsState>().config();

    match asset.preview(wanted, &config, &app.state::<WadCache>()) {
        Ok(Preview::Image(image)) => image_response(image),
        Ok(Preview::Buffer(bytes)) => buffer_response(bytes),
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

/// What a query asks the asset for.
///
/// A query naming no form is an image, which is every request written before geometry
/// was a second answer, and a width only an image has a use for.
fn requested(query: Option<&str>) -> Result<PreviewRequest, String> {
    match parameter(query, FORM_PARAMETER) {
        None => Ok(PreviewRequest::Image {
            min_width: requested_width(query)?,
        }),
        Some(GEOMETRY_FORM) => Ok(PreviewRequest::Geometry),
        Some(SKELETON_FORM) => Ok(PreviewRequest::Skeleton),
        Some(ANIMATION_FORM) => Ok(PreviewRequest::Animation),
        Some(CUBE_FORM) => Ok(PreviewRequest::Cube),
        Some(form) => Err(format!("Not a form: {FORM_PARAMETER}={form}")),
    }
}

/// The `w` a query carries, and none for a query without one.
fn requested_width(query: Option<&str>) -> Result<Option<NonZeroU32>, String> {
    let Some(value) = parameter(query, WIDTH_PARAMETER) else {
        return Ok(None);
    };

    value
        .parse::<NonZeroU32>()
        .map(Some)
        .map_err(|_| format!("Not a width: {WIDTH_PARAMETER}={value}"))
}

/// The value `key` carries in `query`, and none for a query without it.
///
/// Any other parameter passes unread.
fn parameter<'a>(query: Option<&'a str>, key: &str) -> Option<&'a str> {
    query?
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find_map(|(name, value)| (name == key).then_some(value))
}

/// The status that tells a caller what went wrong.
fn status_for(error: &AppError) -> StatusCode {
    match error {
        AppError::Preview(
            PreviewError::Unsupported(_) | PreviewError::UnsupportedMesh(_) | PreviewError::NotCube,
        ) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        AppError::InvalidPath(_) | AppError::LeagueNotFound => StatusCode::NOT_FOUND,
        AppError::Io(e) if e.kind() == io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn image_response(image: PreviewImage) -> Response<Vec<u8>> {
    build(StatusCode::OK, image.mime, image.bytes)
}

/// A buffer, which the webview decodes rather than renders.
fn buffer_response(bytes: Vec<u8>) -> Response<Vec<u8>> {
    build(StatusCode::OK, "application/octet-stream", bytes)
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
    fn a_width_is_read_off_the_query_and_nothing_else_is() {
        assert_eq!(requested_width(None), Ok(None));
        assert_eq!(requested_width(Some("")), Ok(None));
        assert_eq!(requested_width(Some("w=128")), Ok(NonZeroU32::new(128)));
        assert_eq!(
            requested_width(Some("a=1&w=64&b=2")),
            Ok(NonZeroU32::new(64))
        );
        assert_eq!(requested_width(Some("width=64")), Ok(None));
    }

    #[test]
    fn a_width_that_is_not_a_positive_number_is_rejected() {
        assert!(requested_width(Some("w=0")).is_err());
        assert!(requested_width(Some("w=-1")).is_err());
        assert!(requested_width(Some("w=wide")).is_err());
        assert!(requested_width(Some("w=")).is_err());
    }

    /// Every URL written before geometry was a second answer asks for an image, and
    /// carries no form to say so.
    #[test]
    fn a_query_with_no_form_asks_for_an_image() {
        assert_eq!(
            requested(None),
            Ok(PreviewRequest::Image { min_width: None })
        );
        assert_eq!(
            requested(Some("w=128")),
            Ok(PreviewRequest::Image {
                min_width: NonZeroU32::new(128)
            })
        );
    }

    #[test]
    fn a_geometry_form_asks_for_geometry_whatever_width_rides_along() {
        assert_eq!(requested(Some("as=geometry")), Ok(PreviewRequest::Geometry));
        assert_eq!(
            requested(Some("w=64&as=geometry")),
            Ok(PreviewRequest::Geometry),
            "a mesh has no mipmap to pick, so the width passes unread"
        );
    }

    #[test]
    fn a_skeleton_form_and_an_animation_form_ask_for_their_buffers() {
        assert_eq!(requested(Some("as=skeleton")), Ok(PreviewRequest::Skeleton));
        assert_eq!(
            requested(Some("as=animation")),
            Ok(PreviewRequest::Animation)
        );
    }

    #[test]
    fn a_cube_form_asks_for_the_six_faces() {
        assert_eq!(requested(Some("as=cube")), Ok(PreviewRequest::Cube));
    }

    /// A form nothing answers is a mistake in the caller's URL, and answering the image
    /// it did not ask for would hide it.
    #[test]
    fn a_form_that_names_nothing_is_rejected() {
        assert!(requested(Some("as=")).is_err());
        assert!(requested(Some("as=mesh")).is_err());
        assert!(requested(Some("as=image")).is_err());
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

        let mesh = AppError::Preview(PreviewError::UnsupportedMesh(".tmesh"));
        assert_eq!(status_for(&mesh), StatusCode::UNSUPPORTED_MEDIA_TYPE);
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
