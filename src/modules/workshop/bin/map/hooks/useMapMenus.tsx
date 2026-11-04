import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  ArrowsDownUpIcon,
  CloudFogIcon,
  CopyIcon,
  CrosshairIcon,
  EyeIcon,
  EyeSlashIcon,
  ExportIcon,
  FilePlusIcon,
  FloppyDiskIcon,
  FrameCornersIcon,
  PencilSimpleIcon,
  RulerIcon,
  SelectionAllIcon,
  SelectionPlusIcon,
  SunIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { m } from "@/i18n";
import type { CommandMenuEntry } from "@/modules/editor";
import { shortcutOf } from "@/modules/keys";

import { cameraSubmenu, viewModeSubmenu } from "../../menus/components/LazyPreviewItems";
import { usePaneCommandLookup } from "../../menus/state/paneCommands";
import { useMapScene } from "../state/mapScene";
import { MAP_PANE_COMMANDS } from "../utils/mapCommands";
import { MAP_KEYS } from "../utils/mapKeys";
import { editCommand, editReason, MENU_ICON } from "../utils/mapMenuItems";
import { type MapAuthoringMenus, useMapAuthoringMenus } from "./useMapAuthoringMenus";
import { useMapCommands } from "./useMapCommands";
import { useMapGuideEntries } from "./useMapGuideEntries";
import { useMapShowEntries } from "./useMapShowEntries";
import { useMeshExport, useMeshReimport } from "./useMeshFiles";
import { usePlaceableActions } from "./usePlaceableActions";
import { useSelectedMeshes } from "./useSelectedMeshes";

/** The map's items of a menu bar: the extras of its shared menus and its own menus. */
export interface MapMenus extends MapAuthoringMenus {
  readonly file: readonly CommandMenuEntry[];
  readonly edit: readonly CommandMenuEntry[];
  readonly view: readonly CommandMenuEntry[];
}

/**
 * Returns the Map bar's menus over the scene in view, for the object tab and the file tab.
 * "Menu bar" in docs/ux/MAP_EDITOR.md.
 *
 * `viewportHidden` is true while the tab draws Properties, where a control that needs the drawn
 * viewport does not apply.
 */
export function useMapMenus(viewportHidden: boolean): MapMenus {
  const scene = useMapScene();
  const { editable, markers, backdrop, geometryDocument, saveGeometry } = scene;

  const actions = usePlaceableActions();
  const { meshes, selection } = useSelectedMeshes();
  const exportMeshes = useMeshExport();
  const reimportMesh = useMeshReimport();
  const lookup = usePaneCommandLookup();
  const authoring = useMapAuthoringMenus();

  const box = lookup(MAP_PANE_COMMANDS.boxSelect);
  const boxing = box?.checked === true;
  const { runs, hides } = useMapCommands(
    actions,
    meshes,
    selection,
    lookup(MAP_PANE_COMMANDS.drop)?.run ?? undefined,
  );
  const showEntries = useMapShowEntries(markers || boxing, () => {
    if (boxing) box?.run?.();
  });
  const guideEntries = useMapGuideEntries();

  const readOnly = editReason(scene);
  const selectionReason = m.workshop_bin_menu_map_selection_reason();
  const placeableReason = m.workshop_bin_menu_map_placeable_reason();
  const previewReason = m.workshop_bin_menu_map_preview_reason();
  const geometryReason = readOnly ?? m.workshop_bin_menu_map_geometry_reason();
  const opened = geometryDocument !== null;
  const oneMesh = selection.length === 1 ? selection[0] : undefined;

  const popoverReason = viewportHidden ? m.workshop_bin_menu_map_layout_reason() : previewReason;

  /* A popover of the top bar, which a read-only map draws while the viewport shows. */
  const popover = (id: string, title: string, icon: ReactNode): CommandMenuEntry => ({
    kind: "command",
    id,
    title,
    icon,
    run: viewportHidden ? null : (lookup(id)?.run ?? null),
    reason: editable ? m.workshop_bin_menu_map_lighting_reason() : popoverReason,
  });

  const file: CommandMenuEntry[] = [
    editCommand(
      {
        id: MAP_PANE_COMMANDS.importMesh,
        title: m.workshop_bin_map_import_short_label(),
        icon: <FilePlusIcon className={MENU_ICON} />,
        run: lookup(MAP_PANE_COMMANDS.importMesh)?.run ?? null,
      },
      readOnly,
      opened ? previewReason : geometryReason,
    ),
    {
      kind: "command",
      id: "map.exportAll",
      title: m.workshop_bin_map_export_map_action(),
      icon: <ExportIcon className={MENU_ICON} />,
      run: opened ? () => void exportMeshes(null) : null,
      reason: geometryReason,
    },
    {
      kind: "command",
      id: "map.saveGeometry",
      title: m.workshop_bin_menu_map_save_geometry_action(),
      icon: <FloppyDiskIcon className={MENU_ICON} />,
      shortcut: shortcutOf("editor.save"),
      run: geometryDocument?.dirty === true ? () => void saveGeometry() : null,
      reason: opened ? m.workshop_bin_menu_map_clean_reason() : geometryReason,
    },
    { kind: "separator" },
    {
      kind: "command",
      id: "map.exportSelected",
      title: m.workshop_bin_map_export_action(),
      icon: <ExportIcon className={MENU_ICON} />,
      run:
        opened && selection.length > 0
          ? () => void exportMeshes(selection.map((mesh) => mesh.index))
          : null,
      reason: opened ? m.workshop_bin_menu_map_mesh_reason() : geometryReason,
    },
    editCommand(
      {
        id: "map.reimport",
        title: m.workshop_bin_map_reimport_action(),
        icon: <ArrowsClockwiseIcon className={MENU_ICON} />,
        run:
          editable && opened && oneMesh !== undefined
            ? () => void reimportMesh(oneMesh.index)
            : null,
      },
      readOnly,
      opened ? m.workshop_bin_menu_map_one_mesh_reason() : geometryReason,
    ),
  ];

  const edit: CommandMenuEntry[] = [
    editCommand(
      {
        id: "map.delete",
        title: m.workshop_bin_map_delete_action(),
        icon: <TrashIcon className={MENU_ICON} />,
        shortcut: MAP_KEYS.delete,
        run: runs.delete,
      },
      readOnly,
      selectionReason,
    ),
    editCommand(
      {
        id: "map.duplicate",
        title: m.workshop_bin_map_duplicate_action(),
        icon: <CopyIcon className={MENU_ICON} />,
        shortcut: MAP_KEYS.duplicate,
        run: runs.duplicate,
      },
      readOnly,
      selectionReason,
    ),
    editCommand(
      {
        id: "map.rename",
        title: m.workshop_bin_map_rename_action(),
        icon: <PencilSimpleIcon className={MENU_ICON} />,
        shortcut: MAP_KEYS.rename,
        run: runs.rename,
      },
      readOnly,
      placeableReason,
    ),
    editCommand(
      {
        id: MAP_PANE_COMMANDS.drop,
        title: m.workshop_bin_menu_map_drop_action(),
        icon: <ArrowsDownUpIcon className={MENU_ICON} />,
        shortcut: MAP_KEYS.drop,
        run: runs.drop,
      },
      readOnly,
      actions.selection.length === 0 ? placeableReason : previewReason,
    ),
    { kind: "separator" },
    {
      kind: "command",
      id: "map.selectAll",
      title: m.workshop_bin_menu_map_select_all_action(),
      icon: <SelectionAllIcon className={MENU_ICON} />,
      shortcut: MAP_KEYS.selectAll,
      run: runs.selectAll,
      reason: m.workshop_bin_map_outliner_empty(),
    },
    {
      kind: "command",
      id: "map.selectNone",
      title: m.workshop_bin_map_selection_clear_action(),
      icon: <XIcon className={MENU_ICON} />,
      shortcut: MAP_KEYS.selectNone,
      run: runs.selectNone,
      reason: selectionReason,
    },
    {
      kind: "check",
      id: MAP_PANE_COMMANDS.boxSelect,
      title: m.workshop_bin_map_box_select_label(),
      icon: <SelectionPlusIcon className={MENU_ICON} />,
      checked: boxing,
      run: viewportHidden ? null : (box?.run ?? null),
    },
  ];

  const view: CommandMenuEntry[] = [
    {
      kind: "submenu",
      id: "map.show",
      title: m.workshop_bin_map_show_label(),
      icon: <EyeIcon className={MENU_ICON} />,
      className: "w-52",
      items: showEntries,
    },
    {
      kind: "submenu",
      id: "map.guides",
      title: m.workshop_bin_map_guides_label(),
      icon: <RulerIcon className={MENU_ICON} />,
      className: "w-52",
      items: guideEntries,
    },
    cameraSubmenu(),
    viewModeSubmenu(backdrop.navGrid !== null),
    { kind: "separator" },
    {
      kind: "command",
      id: MAP_PANE_COMMANDS.frameMap,
      title: m.workshop_bin_menu_map_frame_map_action(),
      icon: <FrameCornersIcon className={MENU_ICON} />,
      run: lookup(MAP_PANE_COMMANDS.frameMap)?.run ?? null,
      reason: previewReason,
    },
    {
      kind: "command",
      id: "map.frameSelection",
      title: m.workshop_bin_map_selection_frame_action(),
      icon: <CrosshairIcon className={MENU_ICON} />,
      shortcut: MAP_KEYS.frameSelection,
      run: runs.frameSelection,
      reason: selectionReason,
    },
    { kind: "separator" },
    {
      kind: "command",
      id: "map.hide",
      title: hides
        ? m.workshop_bin_map_selection_hide_action()
        : m.workshop_bin_map_selection_show_action(),
      icon: hides ? <EyeSlashIcon className={MENU_ICON} /> : <EyeIcon className={MENU_ICON} />,
      shortcut: MAP_KEYS.hide,
      run: runs.hide,
      reason: selectionReason,
    },
    {
      kind: "command",
      id: "map.showAll",
      title: m.workshop_bin_map_outliner_show_all_action(),
      icon: <EyeIcon className={MENU_ICON} />,
      shortcut: MAP_KEYS.showAll,
      run: runs.showAll,
      reason: m.workshop_bin_menu_map_hidden_reason(),
    },
    {
      kind: "command",
      id: "map.resetVisibility",
      title: m.workshop_bin_preview_backdrop_visibility_reset_action(),
      icon: <ArrowCounterClockwiseIcon className={MENU_ICON} />,
      run: backdrop.customized ? backdrop.reset : null,
      reason: m.workshop_bin_menu_map_reset_reason(),
    },
    { kind: "separator" },
    popover(
      MAP_PANE_COMMANDS.sun,
      m.workshop_bin_preview_sun_label(),
      <SunIcon className={MENU_ICON} />,
    ),
    popover(
      MAP_PANE_COMMANDS.postEffects,
      m.workshop_bin_preview_post_effects_label(),
      <CloudFogIcon className={MENU_ICON} />,
    ),
  ];

  return { file, edit, view, ...authoring };
}
