import { GridFourIcon, PaletteIcon, StackIcon } from "@phosphor-icons/react";

import { m } from "@/i18n";
import type { CommandMenuEntry } from "@/modules/editor";
import {
  usePreviewNavGrid,
  usePreviewNavGridColor,
  usePreviewNavGridCutoff,
  usePreviewNavGridPick,
  useSetPreviewDisplay,
} from "@/stores";

import { useMapScene } from "../state/mapScene";
import { MENU_ICON } from "../utils/mapMenuItems";
import {
  activeOverlays,
  colorGroupsOf,
  colorModeOf,
  followsState,
  NAV_CUTOFF_DEFAULT,
  withOverlay,
} from "../utils/navGuide";

/** The Color by value that colors by terrain. A group's value is its name, which is never empty. */
const TERRAIN = "";

/**
 * Returns the navgrid entries of the Guides menu, for the top bar and the menu bar, or none
 * while the map has no navgrid. Per "The shell" in docs/plans/navgrid-guides.md.
 *
 * Navgrid, Pick cells, Height cutoff and Color by persist per user. Height cutoff switches on at
 * `NAV_CUTOFF_DEFAULT`, and the top bar's cutoff control sets the height. The overlay, Follow map state and Skin grid switches
 * belong to the map document.
 */
export function useMapGuideEntries(): CommandMenuEntry[] {
  const { backdrop, navGuide, setNavGuide } = useMapScene();
  const shown = usePreviewNavGrid();
  const colorBy = usePreviewNavGridColor();
  const pick = usePreviewNavGridPick();
  const cutoff = usePreviewNavGridCutoff();
  const setDisplay = useSetPreviewDisplay();

  const model = backdrop.navGrid;
  if (model === null) return [];

  const mode = colorModeOf(model, colorBy);
  const active = activeOverlays(model, navGuide, backdrop.visibility.flags);

  return [
    {
      kind: "check",
      id: "map.guides.navGrid",
      title: m.workshop_bin_map_navgrid_label(),
      icon: <GridFourIcon className={MENU_ICON} />,
      checked: shown,
      run: () => setDisplay({ previewNavGrid: !shown }),
    },
    {
      kind: "check",
      id: "map.guides.pick",
      title: m.workshop_bin_map_navgrid_pick_label(),
      checked: pick,
      run: shown ? () => setDisplay({ previewNavGridPick: !pick }) : null,
    },
    {
      kind: "check",
      id: "map.guides.cutoff",
      title: m.workshop_bin_map_navgrid_cutoff_label(),
      checked: cutoff !== null,
      run: shown
        ? () => setDisplay({ previewNavGridCutoff: cutoff === null ? NAV_CUTOFF_DEFAULT : null })
        : null,
    },
    {
      kind: "submenu",
      id: "map.guides.colorBy",
      title: m.workshop_bin_map_navgrid_color_label(),
      icon: <PaletteIcon className={MENU_ICON} />,
      className: "max-h-96 w-56 overflow-y-auto scrollbar-md",
      items: [
        {
          kind: "radio",
          id: "map.guides.colorBy.choice",
          value: mode.kind === "region" ? mode.group.name : TERRAIN,
          options: [
            { value: TERRAIN, title: m.workshop_bin_map_navgrid_terrain_label() },
            ...colorGroupsOf(model).map((group) => ({ value: group.name, title: group.name })),
          ],
          onPick: (value) => setDisplay({ previewNavGridColor: value === TERRAIN ? null : value }),
        },
      ],
    },
    model.overlays.length > 0 && {
      kind: "submenu",
      id: "map.guides.overlays",
      title: m.workshop_bin_map_navgrid_overlays_label(),
      icon: <StackIcon className={MENU_ICON} />,
      className: "max-h-96 w-64 overflow-y-auto scrollbar-md",
      items: [
        {
          kind: "check",
          id: "map.guides.followState",
          title: m.workshop_bin_map_navgrid_follow_label(),
          checked: navGuide.followState,
          run: () => setNavGuide({ ...navGuide, followState: !navGuide.followState }),
        },
        { kind: "separator" },
        ...model.overlays.map((overlay, index): CommandMenuEntry => {
          const on = active.includes(index);
          return {
            kind: "check",
            id: `map.guides.overlay.${index}`,
            title: overlay.label,
            checked: on,
            run: followsState(model, navGuide, index)
              ? null
              : () => setNavGuide(withOverlay(navGuide, index, !on)),
          };
        }),
      ],
    },
    model.skinGrid !== null && {
      kind: "check",
      id: "map.guides.skinGrid",
      title: m.workshop_bin_map_navgrid_skin_grid_label(),
      checked: navGuide.skinGrid,
      run: () => setNavGuide({ ...navGuide, skinGrid: !navGuide.skinGrid }),
    },
  ];
}
