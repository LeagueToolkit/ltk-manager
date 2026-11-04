import {
  ArrowClockwiseIcon,
  ArrowsOutCardinalIcon,
  ArrowsOutIcon,
  CursorIcon,
  type Icon,
  PlusCircleIcon,
} from "@phosphor-icons/react";

import { m } from "@/i18n";

import type { GizmoTool, MapTool } from "../state/mapScene";
import { MAP_KEYS } from "./mapKeys";
import type { TransformParts } from "./placeableSpace";

/** One tool as the rail and the Tools menu show it. */
export interface MapToolEntry {
  readonly tool: MapTool;
  readonly icon: Icon;
  /** The tool's name, for a menu that shows the key apart. */
  readonly title: () => string;
  /** The tool's name and key, for an icon button. */
  readonly label: () => string;
}

export const MAP_TOOLS: readonly MapToolEntry[] = [
  {
    tool: "select",
    icon: CursorIcon,
    title: m.workshop_bin_menu_map_tool_select_action,
    label: () => m.workshop_bin_map_tool_select_label({ key: MAP_KEYS.select }),
  },
  {
    tool: "move",
    icon: ArrowsOutCardinalIcon,
    title: m.workshop_bin_menu_map_tool_move_action,
    label: () => m.workshop_bin_map_tool_move_label({ key: MAP_KEYS.move }),
  },
  {
    tool: "rotate",
    icon: ArrowClockwiseIcon,
    title: m.workshop_bin_menu_map_tool_rotate_action,
    label: () => m.workshop_bin_map_tool_rotate_label({ key: MAP_KEYS.rotate }),
  },
  {
    tool: "scale",
    icon: ArrowsOutIcon,
    title: m.workshop_bin_menu_map_tool_scale_action,
    label: () => m.workshop_bin_map_tool_scale_label({ key: MAP_KEYS.scale }),
  },
  {
    tool: "place",
    icon: PlusCircleIcon,
    title: m.workshop_bin_menu_map_tool_place_action,
    label: () => m.workshop_bin_map_tool_place_label({ key: MAP_KEYS.place }),
  },
];

/** The gizmo tool that edits each part of a transform, which a button beside its inspector row picks. */
export const TRANSFORM_TOOLS: Readonly<Record<keyof TransformParts, GizmoTool>> = {
  position: "move",
  rotation: "rotate",
  scale: "scale",
};

/** Returns the entry of `tool` in `MAP_TOOLS`. Throws if the list has no entry for it. */
export function toolEntry(tool: MapTool): MapToolEntry {
  const entry = MAP_TOOLS.find((each) => each.tool === tool);
  if (entry === undefined) throw new Error(`MAP_TOOLS has no entry for the "${tool}" tool`);

  return entry;
}

/** The classes the Place tool adds, grouped as the palette groups them. */
export const PLACE_GROUPS: readonly {
  readonly id: string;
  readonly label: () => string;
  readonly classes: readonly string[];
}[] = [
  { id: "effects", label: m.workshop_bin_map_place_effects_label, classes: ["MapParticle"] },
  { id: "audio", label: m.workshop_bin_map_place_audio_label, classes: ["MapAudio"] },
  {
    id: "lighting",
    label: m.workshop_bin_map_place_lighting_label,
    classes: [
      "MapDynamicPointLight",
      "MapDynamicSpotlight",
      "MapPointLight",
      "MapSpotlight",
      "MapUniquePointLight",
      "MapCubemapProbe",
      "MapLightingVolume",
    ],
  },
  {
    id: "markers",
    label: m.workshop_bin_map_place_markers_label,
    classes: ["MapLocator", "MapMotionPath"],
  },
];

/** The class that the lighting volumes section lists and places. */
export const LIGHTING_VOLUME = "MapLightingVolume";

/** The value of a target chunk radio that stands for the chunk of the selection. */
export const SELECTION_CHUNK = "";
