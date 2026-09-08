import { type CollisionDetection, DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";

import { useReorderTransition } from "@/hooks";
import type { InstalledMod } from "@/lib/tauri";
import { useLibraryDndSensors, useSortableModDnd } from "@/modules/library/api";
import {
  closestToPointer,
  dropLineFor,
  noSorting,
  pointerInRemoveZone,
  REMOVE_FROM_FOLDER_ID,
} from "@/modules/library/utils";

import { DndDragOverlay } from "./DndDragOverlay";
import { ModCard } from "./ModCard";
import { RemoveFromFolderZone } from "./RemoveFromFolderZone";
import { SortableModCard } from "./SortableModCard";
import { VirtualCards } from "./VirtualCards";

/** The remove zone wins wherever it is under the pointer, cards decide the rest. */
const removeZoneFirstCollision: CollisionDetection = (args) => {
  const removeHit = pointerInRemoveZone(args);
  if (removeHit) return [removeHit];

  const cards = args.droppableContainers.filter((c) => c.id !== REMOVE_FROM_FOLDER_ID);
  if (cards.length === 0) return [];
  return closestToPointer({ ...args, droppableContainers: cards });
};

interface SortableModListProps {
  mods: InstalledMod[];
  viewMode: "grid" | "list";
  onReorder: (modIds: string[]) => void;
  disabled?: boolean;
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
  className?: string;
  folderId?: string;
}

export function SortableModList({
  mods,
  viewMode,
  onReorder,
  disabled,
  onViewDetails,
  onEditMetadata,
  className,
  folderId,
}: SortableModListProps) {
  const {
    order,
    orderedMods,
    activeId,
    activeMod,
    dropLine,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useSortableModDnd({ mods, onReorder, folderId });

  const gridRef = useReorderTransition<HTMLDivElement>(!activeId);
  const sensors = useLibraryDndSensors();

  if (disabled) {
    return (
      <VirtualCards
        items={mods}
        keyOf={(mod) => mod.id}
        viewMode={viewMode}
        className={className}
        renderItem={(mod) => (
          <ModCard
            mod={mod}
            viewMode={viewMode}
            onViewDetails={onViewDetails}
            onEditMetadata={onEditMetadata}
          />
        )}
      />
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={folderId ? removeZoneFirstCollision : closestToPointer}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={order} strategy={noSorting}>
        {folderId && <RemoveFromFolderZone visible={!!activeId} />}
        <VirtualCards
          items={orderedMods}
          keyOf={(mod) => mod.id}
          viewMode={viewMode}
          className={className}
          containerRef={gridRef}
          renderItem={(mod) => (
            <SortableModCard
              mod={mod}
              viewMode={viewMode}
              dropLine={dropLineFor(dropLine, mod.id)}
              onViewDetails={onViewDetails}
              onEditMetadata={onEditMetadata}
            />
          )}
        />
      </SortableContext>
      <DndDragOverlay activeMod={activeMod} activeFolder={null} />
    </DndContext>
  );
}
