import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { hasOrderChanged, resolveFolderId } from "@/modules/library/utils";

import { useMoveModToFolder } from "./useMoveMod";

interface UseRootModDndArgs {
  rootMods: InstalledMod[];
  onReorder: (modIds: string[]) => void;
  reorderDisabled: boolean;
}

export function useRootModDnd({ rootMods, onReorder, reorderDisabled }: UseRootModDndArgs) {
  const moveModToFolder = useMoveModToFolder();

  const rootModIds = useMemo(() => rootMods.map((m) => m.id), [rootMods]);
  const rootModMap = useMemo(() => new Map(rootMods.map((m) => [m.id, m])), [rootMods]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[]>(rootModIds);
  const lastPropsOrder = useRef<string[]>(rootModIds);
  const localOrderRef = useRef<string[]>(localOrder);

  useEffect(() => {
    localOrderRef.current = localOrder;
  }, [localOrder]);

  useEffect(() => {
    if (hasOrderChanged(rootModIds, lastPropsOrder.current)) {
      lastPropsOrder.current = rootModIds;
      if (!activeId) setLocalOrder(rootModIds);
    }
  }, [rootModIds, activeId]);

  const orderedRootMods = useMemo(
    () => localOrder.map((id) => rootModMap.get(id)).filter(Boolean) as InstalledMod[],
    [localOrder, rootModMap],
  );

  const activeMod = activeId ? (rootModMap.get(activeId) ?? null) : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const overId = over.id as string;
      if (resolveFolderId(overId)) return;
      if (reorderDisabled) return;

      setLocalOrder((prev) => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(overId);
        if (oldIndex === -1 || newIndex === -1) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
    },
    [reorderDisabled],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (over) {
        const folderId = resolveFolderId(over.id as string);
        if (folderId) {
          moveModToFolder.mutate({ modId: active.id as string, folderId });
          return;
        }
      }

      const currentOrder = localOrderRef.current;
      if (!reorderDisabled && hasOrderChanged(currentOrder, rootModIds)) {
        onReorder(currentOrder);
      }
    },
    [rootModIds, onReorder, moveModToFolder, reorderDisabled],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setLocalOrder(rootModIds);
  }, [rootModIds]);

  return {
    localOrder,
    orderedRootMods,
    activeMod,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
