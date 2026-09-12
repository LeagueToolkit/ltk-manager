import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { CSSProperties } from "react";

import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import type { LingeringSlot } from "@/modules/library/api";
import { type CardDropLine, NO_DROP_LINE, parseSortableFolderId } from "@/modules/library/utils";

import { useReorderDisabled } from "../state";
import { DropLine } from "./DropLine";
import { FolderRow } from "./FolderRow";

interface SortableFolderRowProps {
  sortableId: string;
  folder: LibraryFolder;
  mods: InstalledMod[];
  /** The gap this folder would land beside. */
  dropLine?: CardDropLine;
  /** The gap a mod would land in among the folder's own mods. */
  modDropLine?: LingeringSlot;
  sortDisabled?: boolean;
}

export function SortableFolderRow({
  sortableId,
  folder,
  mods,
  dropLine = NO_DROP_LINE,
  modDropLine,
  sortDisabled,
}: SortableFolderRowProps) {
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
      className={`group/sortable-folder relative rounded-lg transition-all duration-150 ${
        receivingMod ? "bg-accent-500/10 ring-2 ring-accent-500" : ""
      } ${isDragging ? "z-0" : ""}`}
    >
      {isDragging && (
        <div className="absolute inset-0 rounded-lg border-2 border-dashed border-accent-500/40 bg-accent-500/5" />
      )}
      {dropLine.side && (
        <DropLine orientation="horizontal" side={dropLine.side} visible={dropLine.visible} />
      )}
      <div className={`flex items-start ${isDragging ? "invisible" : ""}`}>
        {!disabled && (
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
          <FolderRow folder={folder} mods={mods} modDropLine={modDropLine} dndDisabled={false} />
        </div>
      </div>
    </div>
  );
}
