import {
  CubeFocusIcon,
  CubeTransparentIcon,
  FolderSimpleIcon,
  LightbulbIcon,
  MagnetIcon,
  MagnetStraightIcon,
  PlusCircleIcon,
  PlusIcon,
  SelectionIcon,
  ShuffleIcon,
  StackIcon,
  TargetIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { m } from "@/i18n";
import type { MapController, MapPath } from "@/lib/tauri";
import type { CommandMenu, CommandMenuEntry } from "@/modules/editor";

import { mapQueries } from "../api/mapQueries";
import { NewControllerDialog, ParentsDialog } from "../components/ControllerDialogs";
import { ControllerBarItems } from "../components/VisibilityMenus";
import { type MapTool, useMapScene } from "../state/mapScene";
import { controllerLabel } from "../utils/mapControllers";
import { MAP_KEYS } from "../utils/mapKeys";
import { editCommand, editReason, MENU_ICON } from "../utils/mapMenuItems";
import { chunkLabel, itemId } from "../utils/mapOutline";
import { LIGHTING_VOLUME, MAP_TOOLS, PLACE_GROUPS, SELECTION_CHUNK } from "../utils/mapTools";
import { variantLabel } from "../utils/mapVariants";
import { meshId, meshIndexOf } from "../utils/meshSelection";
import { useMapCommands } from "./useMapCommands";
import { useMeshActions } from "./useMeshActions";
import { usePlaceableActions } from "./usePlaceableActions";
import { useSelectedMeshes } from "./useSelectedMeshes";

/** The Insert, Tools and Map menus, which only the Map bar lists. */
export interface MapAuthoringMenus {
  readonly insert: CommandMenu;
  readonly tools: CommandMenu;
  readonly map: CommandMenu;
  /** The dialogs that the menus open, which the caller draws beside its bar. */
  readonly dialogs: ReactNode;
}

/** Returns the Insert, Tools and Map menus over the scene in view. */
export function useMapAuthoringMenus(): MapAuthoringMenus {
  const scene = useMapScene();
  const { editable, tool, setTool, space, snap, setSnap, placeClass, setPlaceClass } = scene;
  const { variants, chosen, pick, target, setTarget, selected, lead, select, backdrop } = scene;
  const { guideSnap, setGuideSnap } = scene;

  const chunks = useQuery(mapQueries.outline(scene.materials)).data ?? [];
  const actions = usePlaceableActions();
  const { meshes, selection } = useSelectedMeshes();
  const meshActions = useMeshActions(meshes.length);
  const { runs } = useMapCommands(actions, meshes, selection);

  const [creating, setCreating] = useState(false);
  const [parentsOf, setParentsOf] = useState<MapController | null>(null);

  const readOnly = editReason(scene);
  const placeableReason = m.workshop_bin_menu_map_placeable_reason();
  const meshReason = m.workshop_bin_menu_map_mesh_reason();
  const opening = m.workshop_bin_menu_map_opening_reason();
  const indices = selection.map((mesh) => mesh.index);

  /* A radio and a switch show no reason of their own, so one line says why they are disabled. */
  const readOnlyNote = (menu: string): CommandMenuEntry =>
    !editable && {
      kind: "command",
      id: `map.${menu}.readOnly`,
      title: m.workshop_bin_menu_map_read_only_label(),
      run: null,
      reason: readOnly,
    };

  const armPlace = (className: string) => {
    setPlaceClass(className);
    setTool("place");
  };

  const insert: CommandMenu = {
    id: "insert",
    title: m.workshop_bin_menu_insert_label(),
    className: "w-64",
    items: [
      readOnlyNote("insert"),
      ...PLACE_GROUPS.map((group): CommandMenuEntry => ({
        kind: "submenu",
        id: `map.place.${group.id}`,
        title: group.label(),
        icon: <PlusCircleIcon className={MENU_ICON} />,
        className: "w-56",
        items: [
          {
            kind: "radio",
            id: `map.place.${group.id}.class`,
            value: tool === "place" ? placeClass : null,
            options: group.classes.map((each) => ({
              value: each,
              title: each,
              disabled: !editable,
            })),
            onPick: armPlace,
          },
        ],
      })),
      { kind: "separator" },
      editCommand(
        {
          id: "map.placeVolume",
          title: m.workshop_bin_map_lighting_volumes_place_action(),
          icon: <LightbulbIcon className={MENU_ICON} />,
          run: editable ? () => armPlace(LIGHTING_VOLUME) : null,
        },
        readOnly,
        opening,
      ),
      editCommand(
        {
          id: "map.newController",
          title: m.workshop_bin_map_visibility_new_action(),
          icon: <PlusIcon className={MENU_ICON} />,
          run: editable ? () => setCreating(true) : null,
        },
        readOnly,
        opening,
      ),
    ],
  };

  const tools: CommandMenu = {
    id: "tools",
    title: m.workshop_bin_menu_tools_label(),
    className: "w-56",
    items: [
      readOnlyNote("tools"),
      {
        kind: "radio",
        id: "map.tool",
        value: tool,
        options: MAP_TOOLS.map(({ tool: each, icon: Glyph, title }) => ({
          value: each,
          title: title(),
          icon: <Glyph className={MENU_ICON} />,
          shortcut: MAP_KEYS[each],
          disabled: runs[each] === null,
        })),
        onPick: (value) => setTool(value as MapTool),
      },
      { kind: "separator" },
      {
        kind: "check",
        id: "map.localAxes",
        title: m.workshop_bin_menu_map_tool_local_action(),
        icon: <CubeFocusIcon className={MENU_ICON} />,
        shortcut: MAP_KEYS.localAxes,
        checked: space === "local",
        run: runs.localAxes,
      },
      {
        kind: "check",
        id: "map.snap",
        title: m.workshop_bin_menu_map_tool_snap_action(),
        icon: <MagnetIcon className={MENU_ICON} />,
        checked: snap,
        run: editable ? () => setSnap(!snap) : null,
      },
      {
        kind: "check",
        id: "map.guideSnap",
        title: m.workshop_bin_menu_map_tool_guide_snap_action(),
        icon: <MagnetStraightIcon className={MENU_ICON} />,
        checked: guideSnap && backdrop.navGrid !== null,
        run: editable && backdrop.navGrid !== null ? () => setGuideSnap(!guideSnap) : null,
      },
    ],
  };

  const leadItem = actions.lead;
  const leadIndex = lead === null ? null : meshIndexOf(lead);
  const leadController = meshes.find((mesh) => mesh.index === leadIndex)?.controller;
  const children =
    leadItem !== null
      ? leadItem.chunk.items.map((item) => itemId(leadItem.chunk.entry, item.key))
      : meshes
          .filter((mesh) => leadIndex !== null && mesh.controller === leadController)
          .map((mesh) => meshId(mesh.index));

  const map: CommandMenu = {
    id: "map",
    title: m.workshop_bin_menu_map_label(),
    className: "w-64",
    items: [
      readOnlyNote("map"),
      variants !== undefined &&
        variants.length > 1 && {
          kind: "submenu",
          id: "map.skin",
          title: m.workshop_bin_map_preview_skin_label(),
          icon: <StackIcon className={MENU_ICON} />,
          /* A map lists up to 37 skins, more than a menu shows without scrolling. */
          className: "max-h-96 w-56 overflow-y-auto scrollbar-md",
          items: [
            {
              kind: "radio",
              id: "map.skin.choice",
              value: chosen?.map ?? null,
              options: variants.map((variant) => ({
                value: variant.map,
                title: variantLabel(variant),
              })),
              onPick: (value) => pick(value as MapPath),
            },
          ],
        },
      {
        kind: "submenu",
        id: "map.target",
        title: m.workshop_bin_map_place_target_label(),
        icon: <TargetIcon className={MENU_ICON} />,
        className: "max-h-96 w-64 overflow-y-auto scrollbar-md",
        items: [
          {
            kind: "radio",
            id: "map.target.choice",
            value: target ?? SELECTION_CHUNK,
            options: [
              {
                value: SELECTION_CHUNK,
                title: m.workshop_bin_map_place_target_selection_label(),
                disabled: !editable,
              },
              ...chunks.map((chunk) => ({
                value: chunk.entry,
                title: chunkLabel(chunk),
                disabled: !editable,
              })),
            ],
            onPick: (value) => setTarget(value === SELECTION_CHUNK ? null : value),
          },
        ],
      },
      { kind: "separator" },
      {
        kind: "command",
        id: "map.selectChildren",
        title: m.workshop_bin_menu_map_select_children_action(),
        icon: <SelectionIcon className={MENU_ICON} />,
        run: selected.size > 0 && children.length > 0 ? () => select(children, "replace") : null,
        reason: m.workshop_bin_menu_map_selection_reason(),
      },
      {
        kind: "submenu",
        id: "map.moveToChunk",
        title: m.workshop_bin_map_outliner_move_to_chunk_action(),
        icon: <FolderSimpleIcon className={MENU_ICON} />,
        className: "max-h-80 w-60 overflow-y-auto scrollbar-md",
        items: chunks
          .filter((chunk) => chunk.entry !== leadItem?.chunk.entry)
          .map((chunk) =>
            editCommand(
              {
                id: `map.moveToChunk.${chunk.entry}`,
                title: chunkLabel(chunk),
                run:
                  editable && actions.selection.length > 0
                    ? () => void actions.moveTo(chunk.entry)
                    : null,
              },
              readOnly,
              placeableReason,
            ),
          ),
      },
      {
        kind: "submenu",
        id: "map.meshController",
        title: m.workshop_bin_menu_map_mesh_controller_label(),
        icon: <ShuffleIcon className={MENU_ICON} />,
        className: "max-h-80 w-60 overflow-y-auto scrollbar-md",
        items: [
          editCommand(
            {
              id: "map.meshController.none",
              title: m.workshop_bin_map_mesh_no_controller_label(),
              run:
                editable && indices.length > 0
                  ? () => void meshActions.setController(indices, null)
                  : null,
            },
            readOnly,
            meshReason,
          ),
          ...backdrop.controllers.map((controller) =>
            editCommand(
              {
                id: `map.meshController.${controller.hash}`,
                title: controllerLabel(controller),
                run:
                  editable && indices.length > 0
                    ? () => void meshActions.setController(indices, controller.hash)
                    : null,
              },
              readOnly,
              meshReason,
            ),
          ),
        ],
      },
      backdrop.controllers.length > 0 && {
        kind: "submenu",
        id: "map.controllers",
        title: m.workshop_bin_menu_map_controllers_label(),
        icon: <CubeTransparentIcon className={MENU_ICON} />,
        className: "max-h-96 w-64 overflow-y-auto scrollbar-md",
        items: [
          {
            kind: "slot",
            id: "map.controllers.items",
            node: <ControllerBarItems onEditParents={setParentsOf} />,
          },
        ],
      },
    ],
  };

  const dialogs = (
    <>
      {creating && <NewControllerDialog onClose={() => setCreating(false)} />}
      {parentsOf !== null && (
        <ParentsDialog controller={parentsOf} onClose={() => setParentsOf(null)} />
      )}
    </>
  );

  return { insert, tools, map, dialogs };
}
