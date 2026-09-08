import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";

import type { InstalledMod } from "@/lib/tauri";
import {
  applyDropSlot,
  type DropSlot,
  dropSlotFor,
  hasOrderChanged,
  isSameSlot,
  REMOVE_FROM_FOLDER_ID,
} from "@/modules/library/utils";

import { useReorderDisabled } from "../state";
import { useLingeringSlot } from "./useLingeringSlot";
import { useMoveModToFolder } from "./useMoveMod";

const ROOT_FOLDER_ID = "root";

interface UseSortableModDndArgs {
  mods: InstalledMod[];
  onReorder: (modIds: string[]) => void;
  folderId?: string;
}

/**
 * Drag state for a list of mods, marking the gap a drop lands in.
 *
 * The list holds still for the whole drag and a line marks the gap instead.
 * Shuffling the cards under the pointer fed dnd-kit a new item order on every
 * hover, which it answered with a fresh collision result and another hover.
 */
export function useSortableModDnd({ mods, onReorder, folderId }: UseSortableModDndArgs) {
  const reorderDisabled = useReorderDisabled();
  const moveModToFolder = useMoveModToFolder();

  const order = useMemo(() => mods.map((m) => m.id), [mods]);
  const modMap = useMemo(() => new Map(mods.map((m) => [m.id, m])), [mods]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<DropSlot | null>(null);

  const activeMod = activeId ? (modMap.get(activeId) ?? null) : null;

  const dropLine = useLingeringSlot(dropSlot);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setDropSlot(null);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (reorderDisabled) return;

      const next =
        !over || over.id === REMOVE_FROM_FOLDER_ID
          ? null
          : dropSlotFor(order, active.id as string, over.id as string);

      setDropSlot((prev) => (isSameSlot(prev, next) ? prev : next));
    },
    [order, reorderDisabled],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const slot = dropSlot;
      setActiveId(null);
      setDropSlot(null);

      if (folderId && event.over?.id === REMOVE_FROM_FOLDER_ID) {
        moveModToFolder.mutate({ modId: event.active.id as string, folderId: ROOT_FOLDER_ID });
        return;
      }

      if (reorderDisabled || !slot) return;

      const next = applyDropSlot(order, event.active.id as string, slot);
      if (hasOrderChanged(next, order)) onReorder(next);
    },
    [folderId, dropSlot, order, onReorder, moveModToFolder, reorderDisabled],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setDropSlot(null);
  }, []);

  return {
    order,
    orderedMods: mods,
    activeId,
    activeMod,
    dropSlot,
    dropLine,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
