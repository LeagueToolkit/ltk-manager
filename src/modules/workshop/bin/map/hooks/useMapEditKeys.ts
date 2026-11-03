import type { KeyboardEvent } from "react";

import { isChord } from "@/modules/keys";

import { useMapScene } from "../state/mapScene";
import { mapKeyCommand } from "../utils/mapKeys";
import type { GeometryMeshes } from "./useGeometryMeshes";
import { useMapCommands } from "./useMapCommands";
import type { PlaceableActions } from "./usePlaceableActions";

/** Whether `target` takes typed text, where a plain key is a character. */
export function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select") !== null;
}

/**
 * Returns the key handler of the viewport and the outliner: the undo keys of the shell, and each
 * key of `MAP_KEYS` whose command applies.
 *
 * `Ctrl+S` is not here, since the editor answers it and `useMapTabSave` adds the map's writes.
 */
export function useMapEditKeys(
  actions: PlaceableActions,
  geometry: GeometryMeshes,
  drop?: () => void,
) {
  const { editable, stepHistory, stepsHistory } = useMapScene();
  const { runs } = useMapCommands(actions, geometry.meshes, geometry.selection, drop);

  return (event: KeyboardEvent) => {
    if (typing(event.target)) return;

    /* The shell steps the edits it recorded in the order they were made, across both
       files. The tab's own history takes an undo past them. */
    const undo = isChord(event, "editor.undo");
    const redo = isChord(event, "editor.redo");
    if (editable && (undo || redo) && stepsHistory(undo)) {
      event.preventDefault();
      event.stopPropagation();
      void stepHistory(undo);
      return;
    }

    const command = mapKeyCommand(event);
    const run = command === null ? null : runs[command];
    if (run === null) return;

    event.preventDefault();
    run();
  };
}
