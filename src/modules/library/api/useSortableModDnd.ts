import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { REMOVE_FROM_FOLDER_ID } from "@/modules/library/utils";

import { useMoveModToFolder } from "./useMoveMod";

const ROOT_FOLDER_ID = "root";

interface UseSortableModDndArgs {
  mods: InstalledMod[];
  onReorder: (modIds: string[]) => void;
  folderId?: string;
  reorderDisabled?: boolean;
}

export function useSortableModDnd({
  mods,
  onReorder,
  folderId,
  reorderDisabled,
}: UseSortableModDndArgs) {
  const moveModToFolder = useMoveModToFolder();

  const propsOrder = useMemo(() => mods.map((m) => m.id), [mods]);
  const modMap = useMemo(() => new Map(mods.map((m) => [m.id, m])), [mods]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[]>(propsOrder);
  const lastPropsOrder = useRef<string[]>(propsOrder);

  useEffect(() => {
    if (propsOrder.join() !== lastPropsOrder.current.join()) {
      lastPropsOrder.current = propsOrder;
      if (!activeId) setLocalOrder(propsOrder);
    }
  }, [propsOrder, activeId]);

  const orderedMods = useMemo(
    () => localOrder.map((id) => modMap.get(id)).filter(Boolean) as InstalledMod[],
    [localOrder, modMap],
  );

  const activeMod = activeId ? (modMap.get(activeId) ?? null) : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      if (over.id === REMOVE_FROM_FOLDER_ID) return;
      if (reorderDisabled) return;

      setLocalOrder((prev) => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(over.id as string);
        if (oldIndex === -1 || newIndex === -1) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
    },
    [reorderDisabled],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);

      if (folderId && event.over?.id === REMOVE_FROM_FOLDER_ID) {
        moveModToFolder.mutate({ modId: event.active.id as string, folderId: ROOT_FOLDER_ID });
        return;
      }

      if (!reorderDisabled && localOrder.join() !== propsOrder.join()) {
        onReorder(localOrder);
      }
    },
    [folderId, localOrder, propsOrder, onReorder, moveModToFolder, reorderDisabled],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setLocalOrder(propsOrder);
  }, [propsOrder]);

  return {
    localOrder,
    orderedMods,
    activeId,
    activeMod,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
