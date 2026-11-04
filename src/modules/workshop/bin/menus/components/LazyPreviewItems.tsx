import { VideoCameraIcon, CubeTransparentIcon } from "@phosphor-icons/react";
import { lazy, Suspense } from "react";

import { m } from "@/i18n";
import type { CommandMenuSubmenu } from "@/modules/editor";

/* In chunks of their own, because their tables come from the viewport barrel, which pulls three.
   A closed bar loads neither. */
const CameraItems = lazy(() =>
  import("../../shared/preview/CameraMenu").then((module) => ({ default: module.CameraItems })),
);
const ViewModeItems = lazy(() =>
  import("../../shared/preview/ViewModeMenu").then((module) => ({
    default: module.ViewModeItems,
  })),
);

/** The submenu of the preview's camera presets. */
export function cameraSubmenu(): CommandMenuSubmenu {
  return {
    kind: "submenu",
    id: "camera",
    title: m.workshop_bin_preview_camera_label(),
    icon: <VideoCameraIcon className="size-4" />,
    className: "w-36",
    items: [
      {
        kind: "slot",
        id: "camera-items",
        node: (
          <Suspense fallback={null}>
            <CameraItems />
          </Suspense>
        ),
      },
    ],
  };
}

/**
 * The submenu of the preview's view mode, overlay, smoothing and effects quality.
 *
 * `navGrid` is true for a viewport that draws a navigation grid, which offers the Conformance
 * mode.
 */
export function viewModeSubmenu(navGrid = false): CommandMenuSubmenu {
  return {
    kind: "submenu",
    id: "view-mode",
    title: m.workshop_bin_preview_view_label(),
    icon: <CubeTransparentIcon className="size-4" />,
    className: "w-48",
    items: [
      {
        kind: "slot",
        id: "view-mode-items",
        node: (
          <Suspense fallback={null}>
            <ViewModeItems navGrid={navGrid} />
          </Suspense>
        ),
      },
    ],
  };
}
