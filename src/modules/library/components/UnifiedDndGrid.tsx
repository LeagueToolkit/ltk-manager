import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { useMemo } from "react";

import { useReorderTransition } from "@/hooks";
import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import { useLibraryDndSensors, useUnifiedDnd } from "@/modules/library/api";
import { dropLineFor, noSorting, parseSortableFolderId } from "@/modules/library/utils";

import { DndDragOverlay } from "./DndDragOverlay";
import { FolderCard } from "./FolderCard";
import { FolderRow } from "./FolderRow";
import { ModCard } from "./ModCard";
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

export function UnifiedDndGrid({
  folders,
  rootMods,
  modsByFolder,
  viewMode,
  dndDisabled,
  onReorder,
}: UnifiedDndGridProps) {
  if (dndDisabled) {
    return (
      <StaticGrid
        folders={folders}
        rootMods={rootMods}
        modsByFolder={modsByFolder}
        viewMode={viewMode}
      />
    );
  }

  return (
    <DndGrid
      folders={folders}
      rootMods={rootMods}
      modsByFolder={modsByFolder}
      viewMode={viewMode}
      onReorder={onReorder}
    />
  );
}

interface StaticGridProps {
  folders: LibraryFolder[];
  rootMods: InstalledMod[];
  modsByFolder: Map<string, InstalledMod[]>;
  viewMode: "grid" | "list";
}

function StaticGrid({ folders, rootMods, modsByFolder, viewMode }: StaticGridProps) {
  const cells = useMemo<Cell[]>(
    () => [
      ...folders.map((folder) => ({
        kind: "folder" as const,
        key: folder.id,
        folder,
        mods: modsByFolder.get(folder.id) ?? [],
      })),
      ...rootMods.map((mod) => ({ kind: "mod" as const, key: mod.id, mod })),
    ],
    [folders, modsByFolder, rootMods],
  );

  return (
    <VirtualCards
      items={cells}
      keyOf={(cell) => cell.key}
      viewMode={viewMode}
      renderItem={(cell) => {
        if (cell.kind === "mod") {
          return <ModCard mod={cell.mod} viewMode={viewMode} />;
        }
        if (viewMode === "list") {
          return <FolderRow folder={cell.folder} mods={cell.mods} dndDisabled />;
        }
        return <FolderCard folder={cell.folder} mods={cell.mods} />;
      }}
    />
  );
}

interface DndGridProps {
  folders: LibraryFolder[];
  rootMods: InstalledMod[];
  modsByFolder: Map<string, InstalledMod[]>;
  viewMode: "grid" | "list";
  onReorder: (modIds: string[]) => void;
}

function DndGrid({ folders, rootMods, modsByFolder, viewMode, onReorder }: DndGridProps) {
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
      sensors={sensors}
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
