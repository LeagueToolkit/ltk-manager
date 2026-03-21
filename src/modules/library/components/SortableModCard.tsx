import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { CSSProperties } from "react";

import type { InstalledMod } from "@/lib/tauri";

import { ModCard } from "./ModCard";

interface SortableModCardProps {
  mod: InstalledMod;
  viewMode: "grid" | "list";
  onToggle: (modId: string, enabled: boolean) => void;
  onUninstall: (modId: string) => void;
  onViewDetails?: (mod: InstalledMod) => void;
  disabled?: boolean;
}

export function SortableModCard({
  mod,
  viewMode,
  onToggle,
  onUninstall,
  onViewDetails,
  disabled,
}: SortableModCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: mod.id,
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 250ms cubic-bezier(0.25, 1, 0.5, 1)",
    willChange: transform ? "transform" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/sortable relative rounded-xl ${isDragging ? "z-0" : ""}`}
    >
      {isDragging && (
        <div className="absolute inset-0 rounded-xl border-2 border-dashed border-accent-500/40 bg-accent-500/5" />
      )}
      {/* Drag handle */}
      {!disabled && viewMode === "list" && (
        <div
          className={`absolute top-1/2 -left-7 z-10 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/sortable:opacity-100 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
          data-no-toggle
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5 text-surface-500" />
        </div>
      )}
      {!disabled && viewMode !== "list" && (
        <div
          className={`absolute top-2 left-2 z-10 flex items-center rounded-md bg-surface-900/80 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover/sortable:opacity-100 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
          data-no-toggle
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-surface-400" />
        </div>
      )}

      <div className={isDragging ? "invisible" : undefined}>
        <ModCard
          mod={mod}
          viewMode={viewMode}
          onToggle={onToggle}
          onUninstall={onUninstall}
          onViewDetails={onViewDetails}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
