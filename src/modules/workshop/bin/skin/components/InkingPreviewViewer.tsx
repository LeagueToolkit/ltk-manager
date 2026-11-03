import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { m } from "@/i18n";
import type { InkingOutline, InkingPreview, PassParam } from "@/lib/tauri";
import { GAME_ZOOM, type SubmeshOutline } from "@/modules/viewport";

import { Notice } from "../../shared/preview/Notice";
import { skinQueries } from "../api/skinQueries";
import { ShippedSkinViewer } from "./ShippedSkinViewer";

export interface InkingPreviewViewerProps {
  /** The preview project the backend wrote for one champion. */
  readonly preview: InkingPreview;
  /** The outline values to draw in place of the ones the project was written with. */
  readonly outline?: InkingOutline;
}

/**
 * The base skin of a character inking preview project, drawn by the shipped skin viewer.
 *
 * The project holds the declarations the overlay build writes, so the outline comes from the
 * skin's own `OutlineCategorySubmeshes` through the same reads and translated shaders the skin
 * editor uses. `outline` is written into every drawn outline, its stock material and its
 * translated pass alike, so a new value lands without reading the project again. The outline
 * is drawn as seen from the in-match camera at its farthest zoom, so it keeps its in-game width
 * beside the champion while the preview camera stands closer.
 */
export function InkingPreviewViewer({ preview, outline }: InkingPreviewViewerProps) {
  const located = useQuery(
    skinQueries.projectSkinBin(preview.project, preview.skinBin, preview.revision),
  );
  const adjustOutline = useCallback(
    (drawn: SubmeshOutline) => (outline === undefined ? drawn : withValues(drawn, outline)),
    [outline],
  );

  if (located.error !== null || located.data === null) {
    return <Notice text={m.workshop_bin_mesh_preview_failed_empty()} />;
  }
  if (located.data === undefined) {
    return <Notice text={m.workshop_bin_mesh_preview_loading_label()} />;
  }

  return (
    <ShippedSkinViewer
      key={preview.revision}
      skin={{ project: preview.project, asset: located.data, entry: preview.entry }}
      adjustOutline={adjustOutline}
      outlineRange={GAME_ZOOM.farthest}
    />
  );
}

/** `drawn` with `values` in its material and in the `Outline_*` parameters of its pass. */
function withValues(drawn: SubmeshOutline, values: InkingOutline): SubmeshOutline {
  const params: Record<string, PassParam["value"]> = {
    Outline_Color: values.color,
    Outline_Width: [values.width, 0, 0, 0],
    Outline_CameraDistanceMod: [values.cameraDistance, 0, 0, 0],
    Outline_CameraDepthOffset: [values.depthOffset, 0, 0, 0],
    Outline_FinalAlphaMult: [values.alpha, 0, 0, 0],
  };

  return {
    ...drawn,
    material: {
      ...drawn.material,
      color: values.color,
      width: values.width,
      cameraDistance: values.cameraDistance,
      depthOffset: values.depthOffset,
      alpha: values.alpha,
    },
    program: drawn.program && {
      ...drawn.program,
      pass: {
        ...drawn.program.pass,
        params: drawn.program.pass.params.map((param) =>
          param.name in params ? { ...param, value: params[param.name] } : param,
        ),
      },
    },
  };
}
