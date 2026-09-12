import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { useMemo } from "react";

import { useReorderTransition } from "@/hooks";
import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import { useLibraryDndSensors, useUnifiedDnd } from "@/modules/library/api";
import { dropLineFor, noSorting, parseSortableFolderId } from "@/modules/library/utils";

import { DndDragOverlay } from "./DndDragOverlay";
import { RemoveFromFolderZone } from "./RemoveFromFolderZone";
import { SortableFolderCard } from "./SortableFolderCard";
import { SortableFolderRow } from "./SortableFolderRow";
import { SortableModCard } from "./SortableModCard";
import { VirtualCards } from "./VirtualCards";

/** One cell of the unified grid: a folder before every root mod. */
type Cell =
  | { kind: "folder"; key: string; folder: LibraryFolder; mods: InstalledMod[] }
  | { kind: "mod"; key: string; mod: InstalledMod };

interface UnifiedDndGridProps {
  folders: LibraryFolder[];
  rootMods: InstalledMod[];
  modsByFolder: Map<string, InstalledMod[]>;
  viewMode: "grid" | "list";
  dndDisabled: boolean;
  onReorder: (modIds: string[]) => void;
}

/**
 * No sensor, so no gesture reaches a card and no drag can begin.
 *
 * A disabled grid keeps the whole dnd tree mounted and takes its activators
 * away instead of rendering a second tree without them. Swapping the tree
 * remounts every card, and `VirtualCards` measures its column count on mount -
 * so a press that only picked a mod rebuilt the grid and flashed it through one
 * column on the way back.
 */
const NO_SENSORS: ReturnType<typeof useLibraryDndSensors> = [];

export function UnifiedDndGrid({
  folders,
  rootMods,
  modsByFolder,
  viewMode,
  dndDisabled,
  onReorder,
}: UnifiedDndGridProps) {
  const {
    folderOrder,
    orderedRootMods,
    activeFolder,
    activeModForOverlay,
    isDraggingMod,
    isDraggingFolderMod,
    dropLine,
    folderDropLine,
    folderModDropLine,
    sortableItems,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useUnifiedDnd({ folders, rootMods, modsByFolder, onReorder });

  const gridRef = useReorderTransition<HTMLDivElement>(!isDraggingMod && !isDraggingFolderMod);
  const sensors = useLibraryDndSensors();

  const cells = useMemo<Cell[]>(() => {
    const folderCells = folderOrder.flatMap((sortableId) => {
      const folderId = parseSortableFolderId(sortableId);
      const folder = folderId && folders.find((f) => f.id === folderId);
      if (!folder) return [];
      return [
        {
          kind: "folder" as const,
          key: sortableId,
          folder,
          mods: modsByFolder.get(folder.id) ?? [],
        },
      ];
    });

    return [
      ...folderCells,
      ...orderedRootMods.map((mod) => ({ kind: "mod" as const, key: mod.id, mod })),
    ];
  }, [folderOrder, folders, modsByFolder, orderedRootMods]);

  return (
    <DndContext
      sensors={dndDisabled ? NO_SENSORS : sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={sortableItems} strategy={noSorting}>
        <VirtualCards
          items={cells}
          keyOf={(cell) => cell.key}
          viewMode={viewMode}
          containerRef={gridRef}
          renderItem={(cell) => {
            if (cell.kind === "mod") {
              return (
                <SortableModCard
                  mod={cell.mod}
                  viewMode={viewMode}
                  dropLine={dropLineFor(dropLine, cell.mod.id)}
                />
              );
            }
            if (viewMode === "list") {
              return (
                <SortableFolderRow
                  sortableId={cell.key}
                  folder={cell.folder}
                  mods={cell.mods}
                  sortDisabled={isDraggingMod || isDraggingFolderMod}
                  dropLine={dropLineFor(folderDropLine, cell.key)}
                  modDropLine={folderModDropLine}
                />
              );
            }
            return (
              <SortableFolderCard
                sortableId={cell.key}
                folder={cell.folder}
                mods={cell.mods}
                sortDisabled={isDraggingMod || isDraggingFolderMod}
                dropLine={dropLineFor(folderDropLine, cell.key)}
              />
            );
          }}
        />
      </SortableContext>

      <RemoveFromFolderZone visible={isDraggingFolderMod} />
      <DndDragOverlay activeMod={activeModForOverlay} activeFolder={activeFolder} />
    </DndContext>
  );
}
