import {
  ArrowsClockwiseIcon,
  ArrowsInIcon,
  CopyIcon,
  CrosshairIcon,
  EyeIcon,
  EyeSlashIcon,
  ExportIcon,
  FolderSimpleIcon,
  PencilSimpleIcon,
  SelectionAllIcon,
  ShuffleIcon,
  TargetIcon,
  TrashIcon,
} from "@phosphor-icons/react";

import { ContextMenu } from "@/components";
import { m } from "@/i18n";
import type { MapChunk } from "@/lib/tauri";

import type { MeshActions } from "../hooks/useMeshActions";
import { useMeshExport, useMeshReimport } from "../hooks/useMeshFiles";
import type { PlaceableActions } from "../hooks/usePlaceableActions";
import { useMapScene } from "../state/mapScene";
import { MAP_KEYS } from "../utils/mapKeys";
import { chunkLabel, itemId } from "../utils/mapOutline";
import { meshId, meshIndexOf } from "../utils/meshSelection";
import type { SceneRow } from "../utils/sceneOutline";

export interface OutlinerMenuProps {
  /** The row the menu opened on, and null before one has. */
  readonly row: SceneRow | null;
  readonly chunks: readonly MapChunk[];
  readonly placeables: PlaceableActions;
  readonly meshes: MeshActions;
  /** Sends the camera to the row's object. */
  readonly onFrame: (row: SceneRow) => void;
}

/**
 * The outliner's menu for one row. An action on a selected row acts on the whole selection,
 * which the row's own right click made it part of. Per "The shell" in docs/ux/MAP_EDITOR.md.
 */
export function OutlinerMenu({ row, chunks, placeables, meshes, onFrame }: OutlinerMenuProps) {
  const { editable, selected, select, hidden, setHidden, setRenaming, target, setTarget } =
    useMapScene();
  const { backdrop, geometryDocument } = useMapScene();
  const exportMeshes = useMeshExport();
  const reimport = useMeshReimport();
  if (row === null || row.type === "section" || row.type === "guide") return null;

  const ids = selected.has(row.id) ? [...selected] : [row.id];
  const meshIndices = ids.flatMap((id) => {
    const index = meshIndexOf(id);
    return index === null ? [] : [index];
  });
  const shown = !hidden.has(row.id);
  const HideGlyph = shown ? EyeSlashIcon : EyeIcon;
  const hideLabel = shown
    ? m.workshop_bin_map_outliner_hide_action()
    : m.workshop_bin_map_outliner_show_action();
  const hideAction = (
    <ContextMenu.Item
      icon={<HideGlyph />}
      shortcut={MAP_KEYS.hide}
      onClick={() => setHidden(ids, shown)}
    >
      {hideLabel}
    </ContextMenu.Item>
  );

  if (row.type === "chunk") {
    const chunkIds = row.chunk.items.map((item) => itemId(row.chunk.entry, item.key));
    return (
      <ContextMenu.Content className="w-60">
        <ContextMenu.Item
          icon={<TargetIcon />}
          disabled={!editable || target === row.chunk.entry}
          onClick={() => setTarget(row.chunk.entry)}
        >
          {m.workshop_bin_map_outliner_target_action()}
        </ContextMenu.Item>
        <ContextMenu.Item icon={<SelectionAllIcon />} onClick={() => select(chunkIds, "replace")}>
          {m.workshop_bin_map_outliner_select_children_action()}
        </ContextMenu.Item>
        {hideAction}
      </ContextMenu.Content>
    );
  }

  if (row.type === "group") {
    const groupIds = row.meshes.map((mesh) => meshId(mesh.index));
    return (
      <ContextMenu.Content className="w-60">
        <ContextMenu.Item icon={<SelectionAllIcon />} onClick={() => select(groupIds, "replace")}>
          {m.workshop_bin_map_outliner_select_children_action()}
        </ContextMenu.Item>
        <ContextMenu.Item
          icon={<EyeSlashIcon />}
          onClick={() =>
            setHidden(
              groupIds,
              groupIds.some((id) => !hidden.has(id)),
            )
          }
        >
          {m.workshop_bin_map_outliner_toggle_children_action()}
        </ContextMenu.Item>
      </ContextMenu.Content>
    );
  }

  const isMesh = row.type === "mesh";
  return (
    <ContextMenu.Content className="w-60">
      {!isMesh && (
        <ContextMenu.Item
          icon={<PencilSimpleIcon />}
          shortcut={MAP_KEYS.rename}
          disabled={!editable}
          onClick={() => {
            select([row.id], "replace");
            setRenaming(true);
          }}
        >
          {m.workshop_bin_map_rename_action()}
        </ContextMenu.Item>
      )}
      <ContextMenu.Item
        icon={<CopyIcon />}
        shortcut={MAP_KEYS.duplicate}
        disabled={!editable}
        onClick={() => void (isMesh ? meshes.duplicate(meshIndices) : placeables.duplicate())}
      >
        {m.workshop_bin_map_duplicate_action()}
      </ContextMenu.Item>
      <ContextMenu.Item
        icon={<TrashIcon />}
        shortcut={MAP_KEYS.delete}
        disabled={!editable}
        onClick={() => void (isMesh ? meshes.remove(meshIndices) : placeables.remove())}
      >
        {m.workshop_bin_map_delete_action()}
      </ContextMenu.Item>
      {isMesh && (
        <>
          <ContextMenu.Separator />
          <ContextMenu.Item
            icon={<ExportIcon />}
            disabled={geometryDocument === null}
            onClick={() => void exportMeshes(meshIndices)}
          >
            {m.workshop_bin_map_export_action()}
          </ContextMenu.Item>
          <ContextMenu.Item
            icon={<ArrowsClockwiseIcon />}
            disabled={!editable || geometryDocument === null || meshIndices.length !== 1}
            onClick={() => void reimport(meshIndices[0] ?? 0)}
          >
            {m.workshop_bin_map_reimport_action()}
          </ContextMenu.Item>
        </>
      )}
      <ContextMenu.Separator />
      <ContextMenu.Item
        icon={<CrosshairIcon />}
        shortcut={MAP_KEYS.frameSelection}
        onClick={() => onFrame(row)}
      >
        {m.workshop_bin_map_selection_frame_action()}
      </ContextMenu.Item>
      {hideAction}
      {editable && isMesh && (
        <ContextMenu.SubmenuRoot>
          <ContextMenu.SubmenuTrigger icon={<ShuffleIcon />}>
            {m.workshop_bin_map_mesh_controller_label()}
          </ContextMenu.SubmenuTrigger>
          <ContextMenu.SubmenuContent className="max-h-80 w-60 overflow-y-auto">
            <ContextMenu.Item onClick={() => void meshes.setController(meshIndices, null)}>
              {m.workshop_bin_map_mesh_no_controller_label()}
            </ContextMenu.Item>
            {backdrop.controllers.map((controller) => (
              <ContextMenu.Item
                key={controller.hash}
                onClick={() => void meshes.setController(meshIndices, controller.hash)}
              >
                {controller.name ?? controller.hash}
              </ContextMenu.Item>
            ))}
          </ContextMenu.SubmenuContent>
        </ContextMenu.SubmenuRoot>
      )}
      {editable && row.type === "item" && (
        <>
          <ContextMenu.SubmenuRoot>
            <ContextMenu.SubmenuTrigger icon={<FolderSimpleIcon />}>
              {m.workshop_bin_map_outliner_move_to_chunk_action()}
            </ContextMenu.SubmenuTrigger>
            <ContextMenu.SubmenuContent className="max-h-80 w-60 overflow-y-auto">
              {chunks
                .filter((chunk) => chunk.entry !== row.chunk.entry)
                .map((chunk) => (
                  <ContextMenu.Item
                    key={chunk.entry}
                    onClick={() => void placeables.moveTo(chunk.entry)}
                  >
                    {chunkLabel(chunk)}
                  </ContextMenu.Item>
                ))}
            </ContextMenu.SubmenuContent>
          </ContextMenu.SubmenuRoot>
          <ContextMenu.Item icon={<ArrowsInIcon />} onClick={() => setTarget(row.chunk.entry)}>
            {m.workshop_bin_map_outliner_target_own_chunk_action()}
          </ContextMenu.Item>
        </>
      )}
    </ContextMenu.Content>
  );
}
