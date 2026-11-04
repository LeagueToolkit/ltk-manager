import { useCallback, useMemo } from "react";

import { usePreviewNavGrid, useSetPreviewDisplay } from "@/stores";

import { useMapScene } from "../state/mapScene";
import { guideOutlineOf, withOverlay } from "../utils/navGuide";
import type { GuideOutline, SceneRow } from "../utils/sceneOutline";

/** The guides that the outliner lists, and what each row's eye does. */
export interface OutlinerGuides {
  /** Null while the map has no navgrid. */
  readonly guides: GuideOutline | null;
  /** Hides or shows the object of `row`, which shows as `hidden`. */
  readonly toggleEye: (row: SceneRow, hidden: boolean) => void;
}

/**
 * Returns the guides of the outliner's Guides section and what each row's eye does.
 *
 * A guide row's eye is the Navgrid switch of the Guides menu or the switch of one overlay.
 * Every other eye hides or shows its object in the scene.
 */
export function useOutlinerGuides(): OutlinerGuides {
  const { backdrop, navGuide, setNavGuide, setHidden } = useMapScene();
  const navShown = usePreviewNavGrid();
  const setDisplay = useSetPreviewDisplay();
  const model = backdrop.navGrid;
  const flags = backdrop.visibility.flags;

  const guides = useMemo(
    () => (model === null ? null : guideOutlineOf(model, navGuide, flags, navShown)),
    [model, navGuide, flags, navShown],
  );

  const toggleEye = useCallback(
    (row: SceneRow, hidden: boolean) => {
      if (row.type !== "guide") setHidden(row.id, !hidden);
      else if (row.guide.kind === "navGrid") setDisplay({ previewNavGrid: hidden });
      else setNavGuide(withOverlay(navGuide, row.guide.index, hidden));
    },
    [setHidden, setDisplay, setNavGuide, navGuide],
  );

  return { guides, toggleEye };
}
