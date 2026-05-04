import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { usePatcherStatus } from "@/modules/patcher";

import { ModCard } from "./ModCard";

interface SortableModCardProps {
  mod: InstalledMod;
  viewMode: "grid" | "list";
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

export function SortableModCard({
  mod,
  viewMode,
  onViewDetails,
  onEditMetadata,
}: SortableModCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: mod.id,
  });
  const { data: patcherStatus } = usePatcherStatus();
  const disabled = patcherStatus?.running ?? false;

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 250ms cubic-bezier(0.25, 1, 0.5, 1)",
    willChange: transform ? "transform" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/sortable relative ${viewMode === "list" ? "rounded-xl" : "h-full rounded-xl"} ${isDragging ? "z-0" : ""}`}
      {...(disabled ? {} : { ...attributes, ...listeners })}
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
}
