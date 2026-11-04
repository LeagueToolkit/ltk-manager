import { convertFileSrc } from "@tauri-apps/api/core";

import { useAssetVersion, versionedUrl } from "@/lib/assetVersions";
import type { AssetRef } from "@/lib/tauri";

/** The URI scheme the backend serves a rendered preview on. */
const SCHEME = "ltk-asset";

/** The query parameter a thumbnail or a swatch names its width on. */
const WIDTH_PARAMETER = "w";

/** The query parameter naming the buffer the scheme answers in place of an image. */
const FORM_PARAMETER = "as";

/** The query parameter naming the media of the `sound` form, as `SOURCE_PARAMETER` in `protocol.rs`. */
const SOURCE_PARAMETER = "source";

/** Asks a mip chain for the texture's own BC1 or BC3 blocks, as `BLOCKS_PARAMETER` in `protocol.rs`. */
const BLOCKS_PARAMETER = "bc";

/**
 * A buffer the scheme answers, each in the layout the Rust module of its name documents
 * under `crates/ltk-manager-assets/src/preview/`.
 */
export type PreviewForm = "geometry" | "map" | "skeleton" | "animation" | "lightgrid" | "navgrid";

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

/**
 * `previewUrl` for a component, a new URL each time the file changes on disk.
 *
 * The URL names the file's version, per "A layer file saved from outside" in
 * docs/ux/PROJECT_EDITOR.md.
 */
export function usePreviewUrl(asset: AssetRef, minWidth?: number): string {
  const version = useAssetVersion(asset);
  return versionedUrl(previewUrl(asset, minWidth), version);
}

/**
 * Returns the URL of the import preview buffer of `meshes` of the model file at `path`. The
 * buffer layout is the one that `preview_buffer` in `crates/ltk-manager-assets/src/map_import.rs`
 * writes.
 */
export function modelPreviewUrl(
  path: string,
  meshes: readonly number[],
  scale: number,
  up: "y" | "z",
): string {
  const url = convertFileSrc(encodeToken({ kind: "file", path }), SCHEME);
  return `${url}?${FORM_PARAMETER}=model&meshes=${meshes.join(",")}&scale=${scale}&up=${up}`;
}

/** The URL the scheme answers `asset`'s buffer of `form` on. */
export function previewBufferUrl(asset: AssetRef, form: PreviewForm): string {
  return `${convertFileSrc(encodeToken(asset), SCHEME)}?${FORM_PARAMETER}=${form}`;
}

/**
 * The URL a texture's own mip chain arrives on, from the smallest mipmap at least
 * `minWidth` wide down, in the layout `crates/ltk-manager-assets/src/preview/mips.rs` documents.
 */
export function previewMipsUrl(asset: AssetRef, minWidth?: number, blocks = false): string {
  const url = `${convertFileSrc(encodeToken(asset), SCHEME)}?${FORM_PARAMETER}=mips`;
  const sized = minWidth === undefined ? url : `${url}&${WIDTH_PARAMETER}=${minWidth}`;
  return blocks ? `${sized}&${BLOCKS_PARAMETER}=1` : sized;
}

/**
 * The URL a cube map's six faces arrive on, as one image stacked top to bottom.
 *
 * The faces keep the order a DDS stores them in, which is the order `CubeTexture` takes.
 */
export function previewCubeUrl(asset: AssetRef): string {
  return `${convertFileSrc(encodeToken(asset), SCHEME)}?${FORM_PARAMETER}=cube`;
}

/** The URL an OpenType or TrueType file's own bytes arrive on, for a `FontFace` to load. */
export function previewFontUrl(asset: AssetRef): string {
  return `${convertFileSrc(encodeToken(asset), SCHEME)}?${FORM_PARAMETER}=font`;
}

/**
 * The URL a file's own bytes arrive on, for a `<video>`, an `<audio>` or a text read.
 *
 * Under a video or an audio type where the bytes carry one's signature, and as bytes
 * otherwise.
 */
export function previewFileUrl(asset: AssetRef): string {
  return `${convertFileSrc(encodeToken(asset), SCHEME)}?${FORM_PARAMETER}=file`;
}

/**
 * Returns the URL that the media `source` of a package, a bank or a WEM arrives on, decoded to
 * Ogg Vorbis or WAV. A WEM ignores `source`.
 */
export function previewSoundUrl(asset: AssetRef, source: number): string {
  return `${convertFileSrc(encodeToken(asset), SCHEME)}?${FORM_PARAMETER}=sound&${SOURCE_PARAMETER}=${source}`;
}

/** `previewFileUrl` for a component, a new URL each time the file changes on disk. */
export function usePreviewFileUrl(asset: AssetRef): string {
  const version = useAssetVersion(asset);
  return versionedUrl(previewFileUrl(asset), version);
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
