import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";

import type { InstalledMod } from "@/lib/tauri";
import {
  applyDropSlot,
  type DropSlot,
  dropSlotFor,
  hasOrderChanged,
  isSameSlot,
  resolveFolderId,
} from "@/modules/library/utils";

import { useReorderDisabled } from "../state";
import { useLingeringSlot } from "./useLingeringSlot";
import { useMoveModToFolder } from "./useMoveMod";

interface UseRootModDndArgs {
  rootMods: InstalledMod[];
  onReorder: (modIds: string[]) => void;
}

/** Drag state for the root mods, marking the gap a drop lands in. */
export function useRootModDnd({ rootMods, onReorder }: UseRootModDndArgs) {
  const reorderDisabled = useReorderDisabled();
  const moveModToFolder = useMoveModToFolder();

  const order = useMemo(() => rootMods.map((m) => m.id), [rootMods]);
  const rootModMap = useMemo(() => new Map(rootMods.map((m) => [m.id, m])), [rootMods]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<DropSlot | null>(null);

  const activeMod = activeId ? (rootModMap.get(activeId) ?? null) : null;

  const dropLine = useLingeringSlot(dropSlot);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setDropSlot(null);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (reorderDisabled) return;

      const overId = over?.id as string | undefined;
      const next =
        !overId || resolveFolderId(overId) ? null : dropSlotFor(order, active.id as string, overId);

      setDropSlot((prev) => (isSameSlot(prev, next) ? prev : next));
    },
    [order, reorderDisabled],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const slot = dropSlot;
      setActiveId(null);
      setDropSlot(null);

      if (over) {
        const folderId = resolveFolderId(over.id as string);
        if (folderId) {
          moveModToFolder.mutate({ modId: active.id as string, folderId });
          return;
        }
      }

      if (reorderDisabled || !slot) return;

      const next = applyDropSlot(order, active.id as string, slot);
      if (hasOrderChanged(next, order)) onReorder(next);
    },
    [dropSlot, order, onReorder, moveModToFolder, reorderDisabled],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setDropSlot(null);
  }, []);

  return {
    order,
    orderedRootMods: rootMods,
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
