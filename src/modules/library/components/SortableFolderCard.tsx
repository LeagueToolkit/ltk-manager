import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";

import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import { type CardDropLine, NO_DROP_LINE, parseSortableFolderId } from "@/modules/library/utils";

import { useReorderDisabled } from "../state";
import { DropLine } from "./DropLine";
import { FolderCard } from "./FolderCard";

interface SortableFolderCardProps {
  sortableId: string;
  folder: LibraryFolder;
  mods: InstalledMod[];
  dropLine?: CardDropLine;
  sortDisabled?: boolean;
}

export function SortableFolderCard({
  sortableId,
  folder,
  mods,
  dropLine = NO_DROP_LINE,
  sortDisabled,
}: SortableFolderCardProps) {
  const reorderDisabled = useReorderDisabled();
  const disabled = sortDisabled || reorderDisabled;
  const { active, attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: sortableId, disabled: disabled ? { draggable: true } : false });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 250ms cubic-bezier(0.25, 1, 0.5, 1)",
    willChange: transform ? "transform" : undefined,
  };

  /* A folder is reordered past this one, so it lands in a gap the line marks.
     Only a mod lands in the folder itself, which is what the ring says. */
  const receivingMod = isOver && !isDragging && !parseSortableFolderId(String(active?.id ?? ""));

  return (
    <div
      ref={setNodeRef}
      data-flip-id={sortableId}
      style={style}
      className={`group/sortable-folder relative h-full rounded-xl transition-all duration-150 ${
        receivingMod ? "scale-[1.02] ring-2 ring-accent-500" : ""
      } ${isDragging ? "z-0" : ""}`}
      {...attributes}
      {...listeners}
    >
      {isDragging && (
        <div className="absolute inset-0 rounded-xl border-2 border-dashed border-accent-500/40 bg-accent-500/5" />
      )}
      {dropLine.side && (
        <DropLine orientation="vertical" side={dropLine.side} visible={dropLine.visible} />
      )}
      <div className={`h-full ${isDragging ? "invisible" : ""}`}>
        <FolderCard folder={folder} mods={mods} />
      </div>
    </div>
  );
}
