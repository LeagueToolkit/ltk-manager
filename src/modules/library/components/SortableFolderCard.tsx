import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type CSSProperties, memo } from "react";

import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import { useReorderDisabled } from "@/stores";

import { FolderCard } from "./FolderCard";

interface SortableFolderCardProps {
  sortableId: string;
  folder: LibraryFolder;
  mods: InstalledMod[];
  sortDisabled?: boolean;
  dndDisabled?: boolean;
}

export const SortableFolderCard = memo(function SortableFolderCard({
  sortableId,
  folder,
  mods,
  sortDisabled,
  dndDisabled,
}: SortableFolderCardProps) {
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
      className={`group/sortable-folder relative h-full rounded-xl transition-all duration-150 ${
        isOver && !isDragging ? "scale-[1.02] ring-2 ring-accent-500" : ""
      } ${isDragging ? "z-0" : ""}`}
      {...attributes}
      {...(disabled || dndDisabled ? {} : listeners)}
    >
      {isDragging && (
        <div className="absolute inset-0 rounded-xl border-2 border-dashed border-accent-500/40 bg-accent-500/5" />
      )}
      <div className={`h-full ${isDragging ? "invisible" : ""}`}>
        <FolderCard folder={folder} mods={mods} />
      </div>
    </div>
  );
});
