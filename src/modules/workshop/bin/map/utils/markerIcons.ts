import {
  CircleIcon,
  CubeTransparentIcon,
  GlobeSimpleIcon,
  type Icon,
  LightbulbIcon,
  MapPinIcon,
  PathIcon,
  PersonSimpleIcon,
  PolygonIcon,
  SelectionIcon,
  SparkleIcon,
  SpeakerHighIcon,
} from "@phosphor-icons/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasTexture } from "three";

import type { MapItemKind } from "@/lib/tauri";

/** The glyph each placeable kind is marked with in the viewport. */
export const KIND_ICON: Readonly<Record<MapItemKind, Icon>> = {
  particle: SparkleIcon,
  character: PersonSimpleIcon,
  locator: MapPinIcon,
  group: SelectionIcon,
  audio: SpeakerHighIcon,
  light: LightbulbIcon,
  probe: GlobeSimpleIcon,
  volume: CubeTransparentIcon,
  path: PathIcon,
  region: PolygonIcon,
  other: CircleIcon,
};

/** The texture size of one icon, in pixels, above any size a marker draws at. */
const ICON_PIXELS = 64;

/**
 * Returns a white `icon` on a clear square with a dark halo, so vertex colors tint it and it
 * reads over light and dark ground. Calls `onLoad` once the glyph is drawn into the texture.
 */
export function iconTexture(icon: Icon, onLoad: () => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_PIXELS;
  canvas.height = ICON_PIXELS;
  const texture = new CanvasTexture(canvas);

  const markup = renderToStaticMarkup(
    createElement(icon, {
      size: ICON_PIXELS - 8,
      color: "white",
      weight: "bold",
    }),
  );
  const image = new Image();
  image.onload = () => {
    const context = canvas.getContext("2d");
    if (context === null) return;

    context.shadowColor = "black";
    context.shadowBlur = 6;
    context.drawImage(image, 4, 4);
    texture.needsUpdate = true;
    onLoad();
  };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  return texture;
}
