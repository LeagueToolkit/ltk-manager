import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronDown, ChevronRight, FolderOpen } from "lucide-react";
import { useMemo } from "react";

import { Button, Checkbox } from "@/components";
import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import { useFolderToggle } from "@/modules/library/api";
import { useLibraryViewStore } from "@/stores/libraryView";

import { FolderContextMenu } from "./FolderContextMenu";
import { ModCard } from "./ModCard";
import { SortableModCard } from "./SortableModCard";

interface FolderRowProps {
  folder: LibraryFolder;
  mods: InstalledMod[];
  dndDisabled?: boolean;
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

export function FolderRow({
  folder,
  mods,
  dndDisabled = true,
  onViewDetails,
  onEditMetadata,
}: FolderRowProps) {
  const expandedFolders = useLibraryViewStore((s) => s.expandedFolders);
  const toggleFolderExpanded = useLibraryViewStore((s) => s.toggleFolderExpanded);
  const isExpanded = expandedFolders.has(folder.id);
  const { handleToggle, checked, indeterminate } = useFolderToggle(folder, mods);
  const modIds = useMemo(() => mods.map((m) => m.id), [mods]);

  return (
    <div>
      <FolderContextMenu folderId={folder.id} folderName={folder.name}>
        <Button
          variant="default"
          onClick={() => toggleFolderExpanded(folder.id)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left"
        >
          <span className="h-4 w-4 shrink-0 text-surface-400">
            {isExpanded && <ChevronDown className="h-4 w-4" />}
            {!isExpanded && <ChevronRight className="h-4 w-4" />}
          </span>
          <FolderOpen className="h-4 w-4 shrink-0 text-accent-400" />
          <span className="flex-1 truncate text-sm font-medium text-surface-100">
            {folder.name}
          </span>
          <span className="mr-2 text-xs text-surface-500">{mods.length}</span>
          {mods.length > 0 && (
            <Checkbox
              checked={checked}
              indeterminate={indeterminate}
              onCheckedChange={handleToggle}
              size="sm"
              tabIndex={-1}
            />
          )}
        </Button>
      </FolderContextMenu>

      {isExpanded && (
        <div className="ml-[22px] flex rounded-lg bg-surface-800/50 py-1">
          <div className="mr-2.5 w-px shrink-0 bg-surface-600" />
          <div className="min-w-0 flex-1 py-1 pr-1">
            {mods.length === 0 ? (
              <p className="py-3 text-center text-sm text-surface-500">
                No mods in this folder. Drag mods here to organize them.
              </p>
            ) : dndDisabled ? (
              <div className="flex flex-col gap-2">
                {mods.map((mod) => (
                  <ModCard
                    key={mod.id}
                    mod={mod}
                    viewMode="list"
                    onViewDetails={onViewDetails}
                    onEditMetadata={onEditMetadata}
                  />
                ))}
              </div>
            ) : (
              <SortableContext items={modIds} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {mods.map((mod) => (
                    <SortableModCard
                      key={mod.id}
                      mod={mod}
                      viewMode="list"
                      onViewDetails={onViewDetails}
                      onEditMetadata={onEditMetadata}
                    />
                  ))}
                </div>
              </SortableContext>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
