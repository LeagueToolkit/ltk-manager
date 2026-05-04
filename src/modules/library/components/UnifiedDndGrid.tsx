import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useRef } from "react";

import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import { useUnifiedDnd } from "@/modules/library/api";
import { gridClass, parseSortableFolderId } from "@/modules/library/utils";

import { DndDragOverlay } from "./DndDragOverlay";
import { FolderCard } from "./FolderCard";
import { FolderRow } from "./FolderRow";
import { ModCard } from "./ModCard";
import { RemoveFromFolderZone } from "./RemoveFromFolderZone";
import { SortableFolderCard } from "./SortableFolderCard";
import { SortableFolderRow } from "./SortableFolderRow";
import { SortableModCard } from "./SortableModCard";

export { gridClass } from "@/modules/library/utils";

interface UnifiedDndGridProps {
  folders: LibraryFolder[];
  rootMods: InstalledMod[];
  modsByFolder: Map<string, InstalledMod[]>;
  viewMode: "grid" | "list";
  dndDisabled: boolean;
  onReorder: (modIds: string[]) => void;
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

export function UnifiedDndGrid({
  folders,
  rootMods,
  modsByFolder,
  viewMode,
  dndDisabled,
  onReorder,
  onViewDetails,
  onEditMetadata,
}: UnifiedDndGridProps) {
  const hasMountedRef = useRef(false);
  const stagger = !hasMountedRef.current ? " stagger-enter" : "";
  hasMountedRef.current = true;

  if (dndDisabled) {
    return (
      <StaticGrid
        folders={folders}
        rootMods={rootMods}
        modsByFolder={modsByFolder}
        viewMode={viewMode}
        onViewDetails={onViewDetails}
        onEditMetadata={onEditMetadata}
        staggerClass={stagger}
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
      onViewDetails={onViewDetails}
      onEditMetadata={onEditMetadata}
    />
  );
}

interface StaticGridProps {
  folders: LibraryFolder[];
  rootMods: InstalledMod[];
  modsByFolder: Map<string, InstalledMod[]>;
  viewMode: "grid" | "list";
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
  staggerClass?: string;
}

function StaticGrid({
  folders,
  rootMods,
  modsByFolder,
  viewMode,
  onViewDetails,
  onEditMetadata,
  staggerClass = "",
}: StaticGridProps) {
  return (
    <div className={`${gridClass(viewMode)}${staggerClass}`}>
      {folders.map((folder) => {
        const folderMods = modsByFolder.get(folder.id) ?? [];
        if (viewMode === "list") {
          return (
            <FolderRow
              key={folder.id}
              folder={folder}
              mods={folderMods}
              dndDisabled
              onViewDetails={onViewDetails}
              onEditMetadata={onEditMetadata}
            />
          );
        }
        return <FolderCard key={folder.id} folder={folder} mods={folderMods} />;
      })}
      {rootMods.map((mod) => (
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

interface DndGridProps {
  folders: LibraryFolder[];
  rootMods: InstalledMod[];
  modsByFolder: Map<string, InstalledMod[]>;
  viewMode: "grid" | "list";
  onReorder: (modIds: string[]) => void;
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

function DndGrid({
  folders,
  rootMods,
  modsByFolder,
  viewMode,
  onReorder,
  onViewDetails,
  onEditMetadata,
}: DndGridProps) {
  const {
    folderLocalOrder,
    orderedRootMods,
    activeFolder,
    activeModForOverlay,
    isDraggingMod,
    isDraggingFolderMod,
    sortableItems,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useUnifiedDnd({ folders, rootMods, modsByFolder, onReorder });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={sortableItems}
        strategy={viewMode === "list" ? verticalListSortingStrategy : rectSortingStrategy}
      >
        <div className={gridClass(viewMode)}>
          {folderLocalOrder.map((sortableId) => {
            const folderId = parseSortableFolderId(sortableId);
            if (!folderId) return null;
            const folder = folders.find((f) => f.id === folderId);
            if (!folder) return null;
            const folderMods = modsByFolder.get(folder.id) ?? [];

            if (viewMode === "list") {
              return (
                <SortableFolderRow
                  key={sortableId}
                  sortableId={sortableId}
                  folder={folder}
                  mods={folderMods}
                  sortDisabled={isDraggingMod || isDraggingFolderMod}
                  onViewDetails={onViewDetails}
                  onEditMetadata={onEditMetadata}
                />
              );
            }
            return (
              <SortableFolderCard
                key={sortableId}
                sortableId={sortableId}
                folder={folder}
                mods={folderMods}
                sortDisabled={isDraggingMod || isDraggingFolderMod}
              />
            );
          })}

          {orderedRootMods.map((mod) => (
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

      <RemoveFromFolderZone visible={isDraggingFolderMod} />
      <DndDragOverlay activeMod={activeModForOverlay} activeFolder={activeFolder} />
    </DndContext>
  );
}
