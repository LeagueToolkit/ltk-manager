import { convertFileSrc } from "@tauri-apps/api/core";

import type { AssetRef } from "@/lib/tauri";

/** The URI scheme the backend serves a rendered preview on. */
const SCHEME = "ltk-asset";

/** The query parameter a thumbnail or a swatch names its width on. */
const WIDTH_PARAMETER = "w";

/** The query parameter naming the buffer the scheme answers in place of an image. */
const FORM_PARAMETER = "as";

/**
 * A buffer the scheme answers, each in the layout the Rust module of its name documents
 * under `crates/ltk-manager-core/src/preview/`.
 */
export type PreviewForm = "geometry" | "skeleton" | "animation";

/**
 * The URL an `<img>` draws this asset from.
 *
 * The backend renders whatever the file is into something the webview decodes,
 * so a `.tex` and a `.png` both arrive as an image and neither one crosses the
 * JavaScript heap.
 *
 * `minWidth` is a thumbnail's or a swatch's `w`. Without one the full resolution
 * arrives.
 */
export function previewUrl(asset: AssetRef, minWidth?: number): string {
  const url = convertFileSrc(encodeToken(asset), SCHEME);
  if (minWidth === undefined) return url;
  return `${url}?${WIDTH_PARAMETER}=${minWidth}`;
}

/** The URL the scheme answers `asset`'s buffer of `form` on. */
export function previewBufferUrl(asset: AssetRef, form: PreviewForm): string {
  return `${convertFileSrc(encodeToken(asset), SCHEME)}?${FORM_PARAMETER}=${form}`;
}

/**
 * The URL a cube map's six faces arrive on, as one image stacked top to bottom.
 *
 * The faces keep the order a DDS stores them in, which is the order `CubeTexture` takes.
 */
export function previewCubeUrl(asset: AssetRef): string {
  return `${convertFileSrc(encodeToken(asset), SCHEME)}?${FORM_PARAMETER}=cube`;
}

/**
 * Pack a reference into one URL path segment.
 *
 * Unpadded base64url is `A-Za-z0-9-_` alone, which is exactly the set
 * `encodeURIComponent` leaves untouched, so the token reaches the handler
 * character for character and no escaping question comes up on the way.
 */
function encodeToken(asset: AssetRef): string {
  const utf8 = new TextEncoder().encode(JSON.stringify(asset));
  const binary = Array.from(utf8, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
