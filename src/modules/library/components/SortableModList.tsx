import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import type { InstalledMod } from "@/lib/tauri";
import { useSortableModDnd } from "@/modules/library/api";
import { REMOVE_FROM_FOLDER_ID } from "@/modules/library/utils";

import { DndDragOverlay } from "./DndDragOverlay";
import { ModCard } from "./ModCard";
import { RemoveFromFolderZone } from "./RemoveFromFolderZone";
import { SortableModCard } from "./SortableModCard";

/**
 * Checks pointer-within for the remove zone first; if the pointer is
 * inside it, that wins. Otherwise falls back to closestCenter for
 * normal sortable reordering.
 */
const removeZoneFirstCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  const removeHit = pointerCollisions.find((c) => c.id === REMOVE_FROM_FOLDER_ID);
  if (removeHit) return [removeHit];
  return closestCenter(args);
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
    localOrder,
    orderedMods,
    activeId,
    activeMod,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useSortableModDnd({ mods, onReorder, folderId });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (disabled) {
    return (
      <div className={className}>
        {mods.map((mod) => (
          <ModCard
            key={mod.id}
            mod={mod}
            viewMode={viewMode}
            onViewDetails={onViewDetails}
            onEditMetadata={onEditMetadata}
          />
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={folderId ? removeZoneFirstCollision : closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={localOrder}
        strategy={viewMode === "list" ? verticalListSortingStrategy : rectSortingStrategy}
      >
        {folderId && <RemoveFromFolderZone visible={!!activeId} />}
        <div className={className}>
          {orderedMods.map((mod) => (
            <SortableModCard
              key={mod.id}
              mod={mod}
              viewMode={viewMode}
              onViewDetails={onViewDetails}
              onEditMetadata={onEditMetadata}
            />
          ))}
        </div>
      </SortableContext>
      <DndDragOverlay activeMod={activeMod} activeFolder={null} />
    </DndContext>
  );
}
