import {
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  pointerWithin,
} from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";

import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import {
  applyDropSlot,
  closestToPointer,
  type DropSlot,
  dropSlotFor,
  hasOrderChanged,
  isSameSlot,
  nearestToPointer,
  parseSortableFolderId,
  pointerInRemoveZone,
  REMOVE_FROM_FOLDER_ID,
  resolveFolderId,
} from "@/modules/library/utils";

import { useReorderDisabled } from "../state";
import { useFolderDnd } from "./useFolderDnd";
import { useLingeringSlot } from "./useLingeringSlot";
import { useMoveModToFolder, useReorderFolderMods } from "./useMoveMod";
import { useRootModDnd } from "./useRootModDnd";

interface UseUnifiedDndArgs {
  folders: LibraryFolder[];
  rootMods: InstalledMod[];
  modsByFolder: Map<string, InstalledMod[]>;
  onReorder: (modIds: string[]) => void;
}

export function useUnifiedDnd({ folders, rootMods, modsByFolder, onReorder }: UseUnifiedDndArgs) {
  const reorderDisabled = useReorderDisabled();
  const {
    order: rootOrder,
    orderedRootMods,
    activeMod,
    dropLine,
    handleDragStart: handleModDragStart,
    handleDragOver: handleModDragOver,
    handleDragEnd: handleModDragEnd,
    handleDragCancel: handleModDragCancel,
  } = useRootModDnd({ rootMods, onReorder });

  const {
    folderOrder,
    activeFolder,
    dropLine: folderDropLine,
    handleFolderDragStart,
    handleFolderDragOver,
    handleFolderDragEnd,
    handleFolderDragCancel,
  } = useFolderDnd({ folders });

  const moveModToFolder = useMoveModToFolder();
  const reorderFolderMods = useReorderFolderMods();

  const [activeFolderMod, setActiveFolderMod] = useState<InstalledMod | null>(null);
  const [activeFolderModSource, setActiveFolderModSource] = useState<string | null>(null);
  const [folderModDropSlot, setFolderModDropSlot] = useState<DropSlot | null>(null);
  const folderModDropLine = useLingeringSlot(folderModDropSlot);

  const folderModLookup = useMemo(() => {
    const map = new Map<string, { mod: InstalledMod; folderId: string }>();
    for (const [folderId, mods] of modsByFolder) {
      if (folderId === "root") continue;
      for (const mod of mods) {
        map.set(mod.id, { mod, folderId });
      }
    }
    return map;
  }, [modsByFolder]);

  const isDraggingMod = !!activeMod;
  const isDraggingFolder = !!activeFolder;
  const isDraggingFolderMod = !!activeFolderMod;
  const activeModForOverlay = activeMod ?? activeFolderMod;

  const sortableItems = useMemo(() => [...folderOrder, ...rootOrder], [folderOrder, rootOrder]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = event.active.id as string;
      if (parseSortableFolderId(id)) {
        handleFolderDragStart(event);
        return;
      }
      const folderMod = folderModLookup.get(id);
      if (folderMod) {
        setActiveFolderMod(folderMod.mod);
        setActiveFolderModSource(folderMod.folderId);
        return;
      }
      handleModDragStart(event);
    },
    [handleFolderDragStart, handleModDragStart, folderModLookup],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const id = event.active.id as string;
      if (parseSortableFolderId(id)) {
        handleFolderDragOver(event);
        return;
      }
      if (folderModLookup.has(id)) {
        const source = folderModLookup.get(id)?.folderId;
        const overId = event.over?.id as string | undefined;
        const siblings = (modsByFolder.get(source ?? "") ?? []).map((m) => m.id);
        const next = !overId || reorderDisabled ? null : dropSlotFor(siblings, id, overId);
        setFolderModDropSlot((prev) => (isSameSlot(prev, next) ? prev : next));
        return;
      }
      handleModDragOver(event);
    },
    [handleFolderDragOver, handleModDragOver, folderModLookup, modsByFolder, reorderDisabled],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const id = event.active.id as string;

      if (parseSortableFolderId(id)) {
        handleFolderDragEnd(event);
        return;
      }

      if (activeFolderMod && activeFolderModSource) {
        const overId = event.over?.id as string | undefined;
        const slot = folderModDropSlot;
        setActiveFolderMod(null);
        setActiveFolderModSource(null);
        setFolderModDropSlot(null);

        if (overId) {
          if (overId === REMOVE_FROM_FOLDER_ID) {
            moveModToFolder.mutate({ modId: id, folderId: "root" });
            return;
          }
          const targetFolderId = resolveFolderId(overId);
          if (targetFolderId && targetFolderId !== activeFolderModSource) {
            moveModToFolder.mutate({ modId: id, folderId: targetFolderId });
            return;
          }

          const overFolderMod = folderModLookup.get(overId);
          if (overFolderMod && overFolderMod.folderId === activeFolderModSource) {
            if (reorderDisabled || !slot) return;
            const currentOrder = (modsByFolder.get(activeFolderModSource) ?? []).map((m) => m.id);
            const newOrder = applyDropSlot(currentOrder, id, slot);
            if (hasOrderChanged(newOrder, currentOrder)) {
              reorderFolderMods.mutate({ folderId: activeFolderModSource, modIds: newOrder });
            }
          }
        }
        return;
      }

      handleModDragEnd(event);
    },
    [
      handleFolderDragEnd,
      handleModDragEnd,
      activeFolderMod,
      activeFolderModSource,
      folderModDropSlot,
      folderModLookup,
      modsByFolder,
      moveModToFolder,
      reorderFolderMods,
      reorderDisabled,
    ],
  );

  const handleDragCancel = useCallback(() => {
    handleFolderDragCancel();
    handleModDragCancel();
    setActiveFolderMod(null);
    setActiveFolderModSource(null);
    setFolderModDropSlot(null);
  }, [handleFolderDragCancel, handleModDragCancel]);

  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const activeId = args.active.id as string;

      /* A folder lands between folders, never inside a mod, so the mods are not
         candidates for it at all. */
      if (parseSortableFolderId(activeId)) {
        const folderCards = args.droppableContainers.filter((c) =>
          parseSortableFolderId(c.id as string),
        );
        if (folderCards.length === 0) return [];
        return closestToPointer({ ...args, droppableContainers: folderCards });
      }

      const removeHit = pointerInRemoveZone(args);
      if (removeHit) return [removeHit];

      const activeSourceFolderId = folderModLookup.get(activeId)?.folderId;

      if (activeSourceFolderId) {
        const withoutSource = args.droppableContainers.filter(
          (c) => c.id !== `sortable-folder:${activeSourceFolderId}`,
        );
        if (reorderDisabled) {
          const hits = pointerWithin({ ...args, droppableContainers: withoutSource });
          return hits
            .map((hit) => {
              const folderMod = folderModLookup.get(hit.id as string);
              if (folderMod && folderMod.folderId !== activeSourceFolderId) {
                return { ...hit, id: `sortable-folder:${folderMod.folderId}` };
              }
              if (folderMod && folderMod.folderId === activeSourceFolderId) {
                return null;
              }
              return hit;
            })
            .filter(Boolean) as ReturnType<CollisionDetection>;
        }
        const hits = pointerWithin({ ...args, droppableContainers: withoutSource });
        const folderHit = hits.find((c) => parseSortableFolderId(c.id as string));
        if (folderHit) return [folderHit];

        const isSibling = (id: string) =>
          folderModLookup.get(id)?.folderId === activeSourceFolderId;
        const siblingHit = hits.find((c) => isSibling(c.id as string));
        if (siblingHit) return [siblingHit];

        const siblingsOnly = withoutSource.filter((c) => isSibling(c.id as string));
        if (siblingsOnly.length === 0) return [];
        return nearestToPointer({ ...args, droppableContainers: siblingsOnly });
      }

      if (reorderDisabled) {
        const hits = pointerWithin(args);
        return hits.map((hit) => {
          const folderMod = folderModLookup.get(hit.id as string);
          if (folderMod) {
            return { ...hit, id: `sortable-folder:${folderMod.folderId}` };
          }
          return hit;
        });
      }

      // One pass: this runs on every pointer move, over every card in the library.
      const withoutFolderMods: typeof args.droppableContainers = [];
      const rootModsOnly: typeof args.droppableContainers = [];
      for (const container of args.droppableContainers) {
        const id = container.id as string;
        if (folderModLookup.has(id)) continue;
        withoutFolderMods.push(container);
        if (!parseSortableFolderId(id) && id !== REMOVE_FROM_FOLDER_ID) {
          rootModsOnly.push(container);
        }
      }

      /* A folder takes the drop only with the pointer inside it, so both answers
         come out of the one pointer pass and only a pointer in a gutter pays for
         a second sweep. */
      const hits = pointerWithin({ ...args, droppableContainers: withoutFolderMods });
      const folderHit = hits.find((c) => parseSortableFolderId(c.id as string));
      if (folderHit) return [folderHit];
      if (hits.length > 0) return [hits[0]];

      if (rootModsOnly.length === 0) return [];
      return nearestToPointer({ ...args, droppableContainers: rootModsOnly });
    },
    [folderModLookup, reorderDisabled],
  );

  return {
    folderOrder,
    orderedRootMods,
    dropLine,
    folderDropLine,
    folderModDropLine,
    activeFolder,
    activeModForOverlay,
    isDraggingMod,
    isDraggingFolder,
    isDraggingFolderMod,
    sortableItems,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
