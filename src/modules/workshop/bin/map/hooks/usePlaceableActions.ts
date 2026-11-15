import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import { api } from "@/lib/tauri";

import { nameHash } from "../../shared/utils/binHash";
import { mapQueries } from "../api/mapQueries";
import { useMapScene } from "../state/mapScene";
import {
  itemId,
  NO_FILTER,
  type PlacedItem,
  placeablePath,
  placedItems,
} from "../utils/mapOutline";
import {
  type CopiedPlaceable,
  duplicateEdits,
  freeName,
  moveEdits,
  moveToChunkEdits,
  type PlaceableMove,
  type PlaceableRef,
  placeEdits,
  removeEdits,
  renameEdits,
  takenNames,
} from "../utils/placeableEdits";

/** What the map shell does to its placeables, each change one undo step. */
export interface PlaceableActions {
  /** The selected placeables in outline order, and empty while the outline reads. */
  readonly selection: readonly PlacedItem[];
  /** The placeable the inspector shows, and null where the selection holds none. */
  readonly lead: PlacedItem | null;
  readonly editable: boolean;
  readonly remove: () => Promise<boolean>;
  readonly duplicate: () => Promise<boolean>;
  readonly move: (moves: readonly PlaceableMove[]) => Promise<boolean>;
  /** Renames `ref` and every map action field that names it. */
  readonly rename: (ref: PlacedItem, name: string) => Promise<boolean>;
  /** Whether `name` is free for a rename of `ref`: not empty and no other placeable's name. */
  readonly nameFree: (ref: PlaceableRef, name: string) => boolean;
  /**
   * Adds a placeable of `className` at `position` in the engine's space to the target chunk,
   * and selects it. Resolves false if the map has no chunk.
   */
  readonly place: (
    className: string,
    position: readonly [number, number, number],
  ) => Promise<boolean>;
  /** Moves the selected placeables into the chunk `target` under their own keys. */
  readonly moveTo: (target: string) => Promise<boolean>;
}

/** The placeable actions over the selection of the map scene in view. */
export function usePlaceableActions(): PlaceableActions {
  const { materials, selected, lead, select, editable, apply, target } = useMapScene();
  const outline = useQuery(mapQueries.outline(materials)).data;
  const toast = useToast();

  const all = useMemo(() => placedItems(outline ?? [], NO_FILTER), [outline]);
  const selection = useMemo(() => all.filter((each) => selected.has(each.id)), [all, selected]);
  const leadItem = useMemo(
    () => (lead === null ? null : (selection.find((each) => each.id === lead) ?? null)),
    [lead, selection],
  );

  const remove = useCallback(async () => {
    if (selection.length === 0) return false;

    const removed = await apply(
      removeEdits(selection.map(({ chunk, item }) => ({ chunk: chunk.entry, key: item.key }))),
    );
    if (removed) select([], "replace");
    return removed;
  }, [selection, apply, select]);

  const duplicate = useCallback(async () => {
    if (selection.length === 0 || outline === undefined) return false;

    const { edits, added } = duplicateEdits(
      selection.map(({ chunk, item }) => ({ chunk: chunk.entry, key: item.key, name: item.name })),
      takenNames(outline),
    );
    const copied = await apply(edits);
    if (copied)
      select(
        added.map((each) => each.id),
        "replace",
      );
    return copied;
  }, [selection, outline, apply, select]);

  const move = useCallback((moves: readonly PlaceableMove[]) => apply(moveEdits(moves)), [apply]);

  const nameFree = useCallback(
    (ref: PlaceableRef, name: string) => {
      const trimmed = name.trim();
      if (trimmed === "") return false;

      return !all.some(
        ({ chunk, item }) =>
          !(chunk.entry === ref.chunk && item.key === ref.key) && item.name === trimmed,
      );
    },
    [all],
  );

  const rename = useCallback(
    async ({ chunk, item }: PlacedItem, name: string) => {
      if (materials === null) return false;

      const references = await api.bin.readMapNameReferences(materials, item.name);
      if (!references.ok) {
        toast.failure(m.workshop_bin_edit_refused_title(), references.error);
        return false;
      }

      return apply(
        renameEdits({ chunk: chunk.entry, key: item.key }, name.trim(), references.value),
      );
    },
    [materials, apply, toast],
  );

  const place = useCallback(
    async (className: string, [x, y, z]: readonly [number, number, number]) => {
      const chunk = target ?? leadItem?.chunk.entry ?? outline?.[0]?.entry ?? null;
      if (chunk === null || outline === undefined) return false;

      const name = freeName(className, takenNames(outline));
      const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
      const placed = await apply(placeEdits(chunk, className, name, transform));
      if (placed) select([itemId(chunk, nameHash(name))], "replace");
      return placed;
    },
    [target, leadItem, outline, apply, select],
  );

  const moveTo = useCallback(
    async (target: string) => {
      if (materials === null) return false;

      const copied: CopiedPlaceable[] = [];
      for (const { chunk, item } of selection) {
        if (chunk.entry === target) continue;

        const text = await api.bin.copyValue(materials, chunk.entry, placeablePath(item.key));
        if (!text.ok) {
          toast.failure(m.workshop_bin_edit_refused_title(), text.error);
          return false;
        }
        copied.push({ chunk: chunk.entry, key: item.key, text: text.value });
      }
      return apply(moveToChunkEdits(copied, target));
    },
    [materials, selection, apply, toast],
  );

  return {
    selection,
    lead: leadItem,
    editable,
    remove,
    duplicate,
    move,
    rename,
    nameFree,
    place,
    moveTo,
  };
}
