import { useDroppable } from "@dnd-kit/core";

import type { InstalledMod, LibraryFolder } from "@/lib/tauri";

import { FolderRow } from "./FolderRow";

interface DroppableFolderRowProps {
  folder: LibraryFolder;
  mods: InstalledMod[];
}

export function DroppableFolderRow({ folder, mods }: DroppableFolderRowProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder:${folder.id}`,
    data: { type: "folder", folderId: folder.id },
  });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg transition-all duration-150 ${
        isOver ? "bg-accent-500/10 ring-2 ring-accent-500" : ""
      }`}
    >
      <FolderRow folder={folder} mods={mods} />
    </div>
  );
}
