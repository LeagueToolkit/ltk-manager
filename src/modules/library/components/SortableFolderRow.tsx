import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { type CSSProperties, memo } from "react";

import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import { useReorderDisabled } from "@/stores";

import { FolderRow } from "./FolderRow";

interface SortableFolderRowProps {
  sortableId: string;
  folder: LibraryFolder;
  mods: InstalledMod[];
  sortDisabled?: boolean;
  dndDisabled?: boolean;
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

export const SortableFolderRow = memo(function SortableFolderRow({
  sortableId,
  folder,
  mods,
  sortDisabled,
  dndDisabled,
  onViewDetails,
  onEditMetadata,
}: SortableFolderRowProps) {
  const reorderDisabled = useReorderDisabled();
  const disabled = sortDisabled || reorderDisabled;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: sortableId, disabled: !!disabled });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 250ms cubic-bezier(0.25, 1, 0.5, 1)",
    willChange: transform ? "transform" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      data-library-sortable
      style={style}
      className={`group/sortable-folder relative rounded-lg transition-all duration-150 ${
        isOver && !isDragging ? "bg-accent-500/10 ring-2 ring-accent-500" : ""
      } ${isDragging ? "z-0" : ""}`}
    >
      {isDragging && (
        <div className="absolute inset-0 rounded-lg border-2 border-dashed border-accent-500/40 bg-accent-500/5" />
      )}
      <div className={`flex items-start ${isDragging ? "invisible" : ""}`}>
        {!disabled && !dndDisabled && (
          <div
            className={`flex shrink-0 items-center px-2 py-2.5 text-surface-500 opacity-30 transition-opacity group-hover/sortable-folder:opacity-100 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
            data-no-toggle
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <FolderRow
            folder={folder}
            mods={mods}
            dndDisabled={dndDisabled}
            onViewDetails={onViewDetails}
            onEditMetadata={onEditMetadata}
          />
        </div>
      </div>
    </div>
  );
});
