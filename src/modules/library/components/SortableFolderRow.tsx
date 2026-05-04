import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { CSSProperties } from "react";

import type { InstalledMod, LibraryFolder } from "@/lib/tauri";

import { FolderRow } from "./FolderRow";

interface SortableFolderRowProps {
  sortableId: string;
  folder: LibraryFolder;
  mods: InstalledMod[];
  sortDisabled?: boolean;
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

export function SortableFolderRow({
  sortableId,
  folder,
  mods,
  sortDisabled,
  onViewDetails,
  onEditMetadata,
}: SortableFolderRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: sortableId, disabled: sortDisabled ? { draggable: true } : false });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 250ms cubic-bezier(0.25, 1, 0.5, 1)",
    willChange: transform ? "transform" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/sortable-folder relative rounded-lg transition-all duration-150 ${
        isOver && !isDragging ? "bg-accent-500/10 ring-2 ring-accent-500" : ""
      } ${isDragging ? "z-0" : ""}`}
    >
      {isDragging && (
        <div className="absolute inset-0 rounded-lg border-2 border-dashed border-accent-500/40 bg-accent-500/5" />
      )}
      <div className={`flex items-start ${isDragging ? "invisible" : ""}`}>
        <div
          className={`flex shrink-0 items-center px-2 py-2.5 text-surface-500 opacity-30 transition-opacity group-hover/sortable-folder:opacity-100 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
          data-no-toggle
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <FolderRow
            folder={folder}
            mods={mods}
            dndDisabled={false}
            onViewDetails={onViewDetails}
            onEditMetadata={onEditMetadata}
          />
        </div>
      </div>
    </div>
  );
}
