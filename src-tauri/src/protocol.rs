//! The `ltk-asset` URI scheme, which serves a preview of one asset.
//!
//! A preview is an image, and an image belongs in an `<img>` rather than on the
//! JavaScript heap. Handing the webview a URL lets it decode with its own
//! decoder and lays out, zooms and paints the result for free, where an IPC
//! result would arrive as base64 for the frontend to reassemble by hand.

use std::io;
use std::num::NonZeroU32;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ltk_manager_assets::game_wads::WadCache;
use ltk_manager_assets::map_import::{preview_buffer, read_model, UpAxis};
use ltk_manager_assets::preview::{
    AssetRef, Preview, PreviewError, PreviewFile, PreviewFont, PreviewImage, PreviewRequest,
};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use ltk_manager_audio::{Decoded, SoundError, SourceId};

use crate::error::AppError;
use crate::services::audio::{decoded_sound, SoundFailure};
use crate::services::preview::{MapGeometryDocuments, MapGeometryId};
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

/// The [`FORM_PARAMETER`] value asking a map for its every mesh in one buffer.
const MAP_FORM: &str = "map";

/// The parameter that asks for a map's buffer from the `.mapgeo` open under that id, with its
/// edits, in place of the file's.
const GEOMETRY_DOCUMENT_PARAMETER: &str = "geometry";

/// The parameter that narrows an open `.mapgeo`'s buffer to the meshes it lists.
const MESHES_PARAMETER: &str = "meshes";

/// The [`FORM_PARAMETER`] value that requests the import preview buffer of a model file. The
/// layout is documented on `map_import::preview_buffer`.
const MODEL_FORM: &str = "model";

/// The parameters of [`MODEL_FORM`]: engine units per file unit, and `y` or `z` for the up axis.
const SCALE_PARAMETER: &str = "scale";
const UP_PARAMETER: &str = "up";

/// The [`FORM_PARAMETER`] value asking a skeleton for its joint buffer.
const SKELETON_FORM: &str = "skeleton";

/// The [`FORM_PARAMETER`] value asking a clip for its baked pose buffer.
const ANIMATION_FORM: &str = "animation";

/// The [`FORM_PARAMETER`] value asking a cube map for its six faces as one image.
const CUBE_FORM: &str = "cube";

/// The [`FORM_PARAMETER`] value asking a texture for its own mip chain in one buffer.
const MIPS_FORM: &str = "mips";
/// Asks a mip chain for the texture's own BC1 or BC3 blocks, which the client uploads as they are.
const BLOCKS_PARAMETER: &str = "bc";

/// The [`FORM_PARAMETER`] value asking a light grid for its ambient buffer.
const LIGHT_GRID_FORM: &str = "lightgrid";

/// The [`FORM_PARAMETER`] value asking a navigation grid or one of its overlays for its buffer.
const NAV_GRID_FORM: &str = "navgrid";

/// The [`FORM_PARAMETER`] value asking an OpenType or TrueType file for its own bytes.
const FONT_FORM: &str = "font";

/// The [`FORM_PARAMETER`] value asking any file for its own bytes, to play or to read as text.
const FILE_FORM: &str = "file";

/// The [`FORM_PARAMETER`] value asking a package, a bank or a WEM for one media, decoded.
const SOUND_FORM: &str = "sound";

/// The parameter of [`SOUND_FORM`] that names the source ID of the media, in decimal. A WEM
/// ignores it, and a request without it asks for source 0.
const SOURCE_PARAMETER: &str = "source";

/// What every response may do as a document, which is nothing.
///
/// A response is an image, a buffer or a file's own bytes, and a game or client file is data
/// rather than code. The policy keeps an SVG or an HTML file from running anything if one is
/// ever loaded as a page, and an `<img>`, a `<video>` and a `fetch` ignore it.
const CONTENT_SECURITY_POLICY: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/// Answer one preview request, whatever [`serve`] does.
///
/// A panic here would otherwise unwind past the responder and drop it unused, and a
/// webview request nothing responds to never settles: an `<img>` fires neither its load
/// nor its error event, so a viewport waiting on one waits for the session.
pub fn answer(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    std::panic::catch_unwind(AssertUnwindSafe(|| serve(app, request))).unwrap_or_else(|_| {
        tracing::error!("Panicked serving {}", request.uri());
        message_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The preview could not be read",
        )
    })
}

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

    /* The decoder sits in the audio crate above the assets crate, so the form is answered
    here like `MODEL_FORM` rather than through `PreviewRequest`. */
    if parameter(request.uri().query(), FORM_PARAMETER) == Some(SOUND_FORM) {
        return match requested_source(request.uri().query()) {
            Ok(source) => sound_response(decoded_sound(app, &asset, source)),
            Err(message) => message_response(StatusCode::BAD_REQUEST, &message),
        };
    }

    if parameter(request.uri().query(), FORM_PARAMETER) == Some(MODEL_FORM) {
        return model_preview(&asset, request.uri().query());
    }

    let wanted = match requested(request.uri().query()) {
        Ok(wanted) => wanted,
        Err(message) => return message_response(StatusCode::BAD_REQUEST, &message),
    };

    if let (PreviewRequest::Map, Some(id)) = (
        &wanted,
        parameter(request.uri().query(), GEOMETRY_DOCUMENT_PARAMETER),
    ) {
        return edited_map(app, id, parameter(request.uri().query(), MESHES_PARAMETER));
    }

    let config = app.state::<SettingsState>().config();

    match asset.preview(wanted, &config, &app.state::<WadCache>()) {
        Ok(Preview::Image(image)) => image_response(image),
        Ok(Preview::Buffer(bytes)) => buffer_response(bytes),
        Ok(Preview::Font(font)) => font_response(font),
        Ok(Preview::File(file)) => file_response(file),
        Err(e) => {
            tracing::debug!("No preview for {asset:?}: {e}");
            message_response(status_for(&e), &e.to_string())
        }
    }
}

/// Answers the map buffer of the `.mapgeo` open under the id `id`, with its edits.
///
/// `meshes`, a comma list of mesh indices, narrows the buffer to those meshes in that order.
fn edited_map(app: &AppHandle, id: &str, meshes: Option<&str>) -> Response<Vec<u8>> {
    let Ok(id) = id.parse::<MapGeometryId>() else {
        return message_response(StatusCode::BAD_REQUEST, "Not a map geometry id");
    };
    let documents = app.state::<MapGeometryDocuments>();

    let answer = match meshes {
        None => documents.preview(id),
        Some(list) => {
            let Ok(indices) = list
                .split(',')
                .map(str::parse::<usize>)
                .collect::<Result<Vec<_>, _>>()
            else {
                return message_response(StatusCode::BAD_REQUEST, "Not a list of mesh indices");
            };
            documents.preview_meshes(id, &indices)
        }
    };
    match answer {
        Ok(bytes) => buffer_response(bytes),
        Err(e) => message_response(StatusCode::NOT_FOUND, &e.to_string()),
    }
}

/// Returns the preview buffer of the meshes in `query` of the model file `asset`.
fn model_preview(asset: &AssetRef, query: Option<&str>) -> Response<Vec<u8>> {
    let AssetRef::File { path } = asset else {
        return message_response(StatusCode::BAD_REQUEST, "The model is not a file on disk");
    };
    let Ok(meshes) = parameter(query, MESHES_PARAMETER)
        .unwrap_or_default()
        .split(',')
        .filter(|each| !each.is_empty())
        .map(str::parse::<usize>)
        .collect::<Result<Vec<_>, _>>()
    else {
        return message_response(
            StatusCode::BAD_REQUEST,
            "`meshes` is not a list of mesh indices",
        );
    };
    let Ok(scale) = parameter(query, SCALE_PARAMETER)
        .unwrap_or("1")
        .parse::<f32>()
    else {
        return message_response(StatusCode::BAD_REQUEST, "`scale` is not a number");
    };
    let up = match parameter(query, UP_PARAMETER) {
        Some("z") => UpAxis::Z,
        _ => UpAxis::Y,
    };

    match read_model(std::path::Path::new(path)) {
        Ok(model) => buffer_response(preview_buffer(&model, &meshes, scale, up)),
        Err(e) => message_response(StatusCode::UNPROCESSABLE_ENTITY, &e.to_string()),
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
        Some(MAP_FORM) => Ok(PreviewRequest::Map),
        Some(SKELETON_FORM) => Ok(PreviewRequest::Skeleton),
        Some(ANIMATION_FORM) => Ok(PreviewRequest::Animation),
        Some(CUBE_FORM) => Ok(PreviewRequest::Cube),
        Some(MIPS_FORM) => Ok(PreviewRequest::Mips {
            min_width: requested_width(query)?,
            blocks: parameter(query, BLOCKS_PARAMETER) == Some("1"),
        }),
        Some(LIGHT_GRID_FORM) => Ok(PreviewRequest::LightGrid),
        Some(NAV_GRID_FORM) => Ok(PreviewRequest::NavGrid),
        Some(FONT_FORM) => Ok(PreviewRequest::Font),
        Some(FILE_FORM) => Ok(PreviewRequest::File),
        Some(form) => Err(format!("Not a form: {FORM_PARAMETER}={form}")),
    }
}

/// Returns the source ID that the `source` parameter of `query` names, or 0 if it has none.
fn requested_source(query: Option<&str>) -> Result<SourceId, String> {
    let Some(value) = parameter(query, SOURCE_PARAMETER) else {
        return Ok(SourceId(0));
    };

    value
        .parse::<u32>()
        .map(SourceId)
        .map_err(|_| format!("Not a source ID: {SOURCE_PARAMETER}={value}"))
}

/// Answers a decoded media, or the status of the reason it has none.
fn sound_response(answer: Result<Arc<Decoded>, SoundFailure>) -> Response<Vec<u8>> {
    match answer {
        Ok(decoded) => build(StatusCode::OK, decoded.format.mime(), decoded.bytes.clone()),
        Err(SoundFailure::Read(e)) => message_response(status_for(&e), &e.to_string()),
        Err(SoundFailure::Sound(e)) => {
            tracing::debug!("No sound: {e}");
            let status = match e {
                SoundError::NoMedia { .. } => StatusCode::NOT_FOUND,
                _ => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            };
            message_response(status, &e.to_string())
        }
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
    if let Some(
        PreviewError::Unsupported(_)
        | PreviewError::NotCube
        | PreviewError::NotFont
        | PreviewError::NotNavGrid,
    ) = error.domain::<PreviewError>()
    {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE;
    }

    match error {
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

fn font_response(font: PreviewFont) -> Response<Vec<u8>> {
    build(StatusCode::OK, font.mime, font.bytes)
}

fn file_response(file: PreviewFile) -> Response<Vec<u8>> {
    build(StatusCode::OK, file.mime, file.bytes)
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
        /* The type this module names is the type, so a file served as bytes is never
        sniffed into a page. */
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY)
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

    #[test]
    fn a_light_grid_form_asks_for_the_ambient_buffer() {
        assert_eq!(
            requested(Some("as=lightgrid")),
            Ok(PreviewRequest::LightGrid)
        );
    }

    #[test]
    fn a_nav_grid_form_asks_for_the_grid_or_overlay_buffer() {
        assert_eq!(requested(Some("as=navgrid")), Ok(PreviewRequest::NavGrid));
    }

    #[test]
    fn a_font_form_asks_for_the_font_file() {
        assert_eq!(requested(Some("as=font")), Ok(PreviewRequest::Font));
    }

    #[test]
    fn a_file_form_asks_for_the_files_own_bytes() {
        assert_eq!(requested(Some("as=file")), Ok(PreviewRequest::File));
    }

    #[test]
    fn a_response_is_never_sniffed_into_a_page() {
        let response = file_response(PreviewFile {
            bytes: b"<html><script></script></html>".to_vec(),
            mime: "application/octet-stream",
        });

        assert_eq!(
            response.headers()[header::X_CONTENT_TYPE_OPTIONS],
            "nosniff"
        );
        assert!(response.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .contains("sandbox"));
    }

    #[test]
    fn a_mips_form_carries_the_width_its_chain_starts_at() {
        assert_eq!(
            requested(Some("as=mips&w=64")),
            Ok(PreviewRequest::Mips {
                min_width: NonZeroU32::new(64),
                blocks: false,
            })
        );
        assert_eq!(
            requested(Some("as=mips&bc=1")),
            Ok(PreviewRequest::Mips {
                min_width: None,
                blocks: true,
            })
        );
        assert!(requested(Some("as=mips&w=0")).is_err());
    }

    /// A form nothing answers is a mistake in the caller's URL, and answering the image
    /// it did not ask for would hide it.
    #[test]
    fn a_form_that_names_nothing_is_rejected() {
        assert!(requested(Some("as=")).is_err());
        assert!(requested(Some("as=mesh")).is_err());
        assert!(requested(Some("as=image")).is_err());
    }

    const PACKAGE: &[u8] =
        include_bytes!("../../crates/ltk-manager-audio/tests/fixtures/package.wpk");

    /// The source ID of the first entry of the package fixture, `380333190.wem`.
    const PACKAGED: SourceId = SourceId(380_333_190);

    fn package_sound(source: SourceId) -> Response<Vec<u8>> {
        let asset = AssetRef::File {
            path: "package.wpk".to_owned(),
        };
        let cache = ltk_manager_audio::SoundCache::default();

        sound_response(crate::services::audio::cached_sound(
            &cache,
            &asset,
            source,
            || Ok(PACKAGE.to_vec()),
        ))
    }

    #[test]
    fn sound_form_answers_package_media_as_ogg() {
        let response = package_sound(PACKAGED);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "audio/ogg");
        assert_eq!(&response.body()[..4], b"OggS");
    }

    #[test]
    fn sound_form_answers_unknown_source_as_not_found() {
        let response = package_sound(SourceId(12_345));

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn sound_form_answers_file_that_is_not_audio_as_unsupported() {
        let asset = AssetRef::File {
            path: "skin.bin".to_owned(),
        };
        let cache = ltk_manager_audio::SoundCache::default();

        let response = sound_response(crate::services::audio::cached_sound(
            &cache,
            &asset,
            PACKAGED,
            || Ok(b"PROP".to_vec()),
        ));

        assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[test]
    fn source_is_read_off_the_query_in_decimal() {
        assert_eq!(
            requested_source(Some("as=sound&source=380333190")),
            Ok(PACKAGED)
        );
        assert_eq!(requested_source(Some("as=sound")), Ok(SourceId(0)));
        assert!(requested_source(Some("as=sound&source=0x10")).is_err());
        assert!(requested_source(Some("as=sound&source=-1")).is_err());
    }

    #[test]
    fn a_token_that_is_not_a_reference_is_rejected() {
        assert!(decode("not base64!!").is_err());
        assert!(decode(&URL_SAFE_NO_PAD.encode(b"[1, 2, 3]")).is_err());
    }

    #[test]
    fn an_unsupported_kind_is_an_unsupported_media_type() {
        let error = AppError::from(PreviewError::Unsupported(
            ltk_manager_assets::preview::LeagueFileKind::PropertyBin,
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
