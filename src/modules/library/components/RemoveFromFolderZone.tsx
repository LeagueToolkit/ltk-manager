import { useDroppable } from "@dnd-kit/core";
import { FolderOutput } from "lucide-react";

import { REMOVE_FROM_FOLDER_ID } from "@/modules/library/utils";

interface RemoveFromFolderZoneProps {
  visible: boolean;
}

export function RemoveFromFolderZone({ visible }: RemoveFromFolderZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: REMOVE_FROM_FOLDER_ID });

  return (
    <div
      ref={setNodeRef}
      className={`fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 transition-all duration-200 ease-out ${
        visible
          ? "translate-y-0 p-4 opacity-100"
          : "pointer-events-none translate-y-full p-0 opacity-0"
      } ${
        isOver
          ? "bg-danger/15 text-danger-text ring-2 ring-danger/50 ring-inset"
          : "border-t border-surface-700 bg-surface-900 text-surface-400"
      }`}
    >
      <FolderOutput className="h-5 w-5 shrink-0" />
      <span className="text-sm font-medium whitespace-nowrap">Drop here to remove from folder</span>
    </div>
  );
}
