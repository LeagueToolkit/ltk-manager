import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type CSSProperties, memo } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { useReorderDisabled } from "@/stores";

import { ModCard } from "./ModCard";

interface SortableModCardProps {
  mod: InstalledMod;
  viewMode: "grid" | "list";
  dndDisabled?: boolean;
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

export const SortableModCard = memo(function SortableModCard({
  mod,
  viewMode,
  dndDisabled = false,
  onViewDetails,
  onEditMetadata,
}: SortableModCardProps) {
  const reorderDisabled = useReorderDisabled();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: mod.id,
    disabled: reorderDisabled,
  });

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
      className={`group/sortable relative ${viewMode === "list" ? "rounded-xl" : "h-full rounded-xl"} ${isDragging ? "z-0" : ""}`}
      {...attributes}
      {...(dndDisabled ? {} : listeners)}
    >
      {isDragging && (
        <div className="absolute inset-0 rounded-xl border-2 border-dashed border-accent-500/40 bg-accent-500/5" />
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
