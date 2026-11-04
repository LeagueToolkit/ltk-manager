import { useQuery } from "@tanstack/react-query";

import type { MapChunk, MapGeometryMesh } from "@/lib/tauri";
import { cellCenter } from "@/modules/viewport";

import { mapQueries } from "../api/mapQueries";
import { type MapTool, useMapScene } from "../state/mapScene";
import type { MapKeyCommand } from "../utils/mapKeys";
import { meshIndexOf, selectionMiddle } from "../utils/meshSelection";
import { navCellOf } from "../utils/navCells";
import { listedIds } from "../utils/sceneOutline";
import { useMeshActions } from "./useMeshActions";
import { useNavGridBase } from "./useNavGridBase";
import type { PlaceableActions } from "./usePlaceableActions";

const NO_CHUNKS: readonly MapChunk[] = [];

/** The keyed commands of a map, which the key handler and the menu bar both run. */
export interface MapCommands {
  /** Each command's action, and null while it does not apply. */
  readonly runs: Readonly<Record<MapKeyCommand, (() => void) | null>>;
  /** `true` if the `hide` command hides the selection, and `false` if it shows it. */
  readonly hides: boolean;
}

/**
 * Returns the keyed commands over the scene's selection.
 *
 * `hide` hides the selection if any of it is shown, else shows it. `frameSelection` sends the
 * camera to the middle of every selected mesh and placeable. `selectAll` selects every mesh and
 * placeable that the outliner's filter keeps. `drop` is absent outside the viewport.
 */
export function useMapCommands(
  actions: PlaceableActions,
  meshes: readonly MapGeometryMesh[],
  selection: readonly MapGeometryMesh[],
  drop?: () => void,
): MapCommands {
  const { editable, materials, lead, selected, select, hidden, setHidden } = useMapScene();
  const { setTool, setRenaming, focusOn, space, setSpace, filter, backdrop } = useMapScene();
  const chunks = useQuery(mapQueries.outline(materials)).data ?? NO_CHUNKS;
  const meshActions = useMeshActions(meshes.length);
  const navGrid = useNavGridBase();

  const meshLead = lead !== null && meshIndexOf(lead) !== null;
  const selectedIds = [...selected];
  /* A cell guide is read-only and draws while its guide does, so hiding passes it over. */
  const ids = selectedIds.filter((id) => navCellOf(id) === null);
  const cellCenters = selectedIds.flatMap((id) => {
    const cell = navCellOf(id);
    const center = cell === null || navGrid === null ? null : cellCenter(navGrid, ...cell);
    return center === null ? [] : [center];
  });
  const indices = selection.map((mesh) => mesh.index);
  const hides = ids.some((id) => !hidden.has(id));
  const hasTarget = meshLead ? indices.length > 0 : actions.selection.length > 0;
  const framed = actions.selection.length > 0 || selection.length > 0 || cellCenters.length > 0;

  const frameSelection = () => {
    const middle = selectionMiddle(actions.selection, selection, cellCenters);
    if (middle === null) return;

    focusOn({
      id: selectedIds.length === 1 ? (selectedIds[0] ?? "") : `selection:${selectedIds.join(",")}`,
      position: middle,
    });
  };
  const selectAll = () => {
    const controllerName = (hash: string) =>
      backdrop.controllers.find((controller) => controller.hash === hash)?.name ?? hash;

    select(listedIds({ meshes, chunks, filter, controllerName }), "replace");
  };
  const tool = (name: MapTool) => (editable ? () => setTool(name) : null);

  return {
    hides,
    runs: {
      select: tool("select"),
      move: tool("move"),
      rotate: tool("rotate"),
      scale: tool("scale"),
      place: tool("place"),
      localAxes: editable ? () => setSpace(space === "world" ? "local" : "world") : null,
      frameSelection: framed ? frameSelection : null,
      hide: ids.length === 0 ? null : () => setHidden(ids, hides),
      showAll: hidden.size === 0 ? null : () => setHidden([...hidden], false),
      delete:
        editable && hasTarget
          ? () => void (meshLead ? meshActions.remove(indices) : actions.remove())
          : null,
      duplicate:
        editable && hasTarget
          ? () => void (meshLead ? meshActions.duplicate(indices) : actions.duplicate())
          : null,
      rename: editable && actions.lead !== null ? () => setRenaming(true) : null,
      drop:
        editable && !meshLead && actions.selection.length > 0 && drop !== undefined ? drop : null,
      selectAll: meshes.length > 0 || chunks.length > 0 ? selectAll : null,
      selectNone: selectedIds.length === 0 ? null : () => select([], "replace"),
    },
  };
}
