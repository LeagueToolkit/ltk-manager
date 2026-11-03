import { useKeys } from "@/modules/keys";
import { useSetZoomLevel, useZoomLevel, ZOOM_STEP } from "@/stores";

const DEFAULT_ZOOM = 100;

/**
 * Binds `app.zoomIn`, `app.zoomOut` and `app.zoomReset` to the zoom setting.
 *
 * A press moves by `ZOOM_STEP`, the same grid the Appearance slider runs on, so the two can never
 * disagree about what a step is. The store clamps, so the ends stop rather than wrap. The commands
 * carry no guard, so a focused field still zooms.
 */
export function useZoomHotkeys(): void {
  const zoomLevel = useZoomLevel();
  const setZoomLevel = useSetZoomLevel();

  useKeys("app", {
    "app.zoomIn": () => setZoomLevel(zoomLevel + ZOOM_STEP),
    "app.zoomOut": () => setZoomLevel(zoomLevel - ZOOM_STEP),
    "app.zoomReset": () => setZoomLevel(DEFAULT_ZOOM),
  });
}
