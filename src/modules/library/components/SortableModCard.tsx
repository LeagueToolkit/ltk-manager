import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type CSSProperties, memo } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { type CardDropLine, NO_DROP_LINE } from "@/modules/library/utils";

import { useReorderDisabled } from "../state";
import { DropLine } from "./DropLine";
import { ModCard } from "./ModCard";

interface SortableModCardProps {
  mod: InstalledMod;
  viewMode: "grid" | "list";
  dropLine?: CardDropLine;
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

/* Memoised: a drag re-renders the sortable context on every pointer move, and
   a library is hundreds of these. Every prop is stable per card - the mod comes
   from the query cache and both callbacks are setState. */
export const SortableModCard = memo(function SortableModCard({
  mod,
  viewMode,
  dropLine = NO_DROP_LINE,
  onViewDetails,
  onEditMetadata,
}: SortableModCardProps) {
  const reorderDisabled = useReorderDisabled();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: mod.id,
    disabled: reorderDisabled ? { droppable: true } : false,
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 250ms cubic-bezier(0.25, 1, 0.5, 1)",
    willChange: transform ? "transform" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      data-flip-id={mod.id}
      style={style}
      className={`group/sortable relative ${viewMode === "list" ? "rounded-xl" : "h-full rounded-xl"} ${isDragging ? "z-0" : ""}`}
      {...attributes}
      {...listeners}
    >
      {isDragging && (
        <div className="absolute inset-0 rounded-xl border-2 border-dashed border-accent-500/40 bg-accent-500/5" />
      )}
      {dropLine.side && (
        <DropLine
          orientation={viewMode === "list" ? "horizontal" : "vertical"}
          side={dropLine.side}
          visible={dropLine.visible}
        />
      )}
      <div className={`${viewMode === "list" ? "" : "h-full"} ${isDragging ? "invisible" : ""}`}>
        <ModCard
          mod={mod}
          viewMode={viewMode}
          onViewDetails={onViewDetails}
          onEditMetadata={onEditMetadata}
        />
      </div>
    </div>
  );
});
