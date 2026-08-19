import { Link } from "@tanstack/react-router";
import { FolderOpen } from "lucide-react";
import { useMemo } from "react";

import { Checkbox } from "@/components";
import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import { useFolderToggle } from "@/modules/library/api";
import { getFolderEnabledState, getFolderSummary } from "@/modules/library/utils";

import { FolderCardThumbnail } from "./FolderCardThumbnail";
import { FolderContextMenu } from "./FolderContextMenu";

interface FolderCardProps {
  folder: LibraryFolder;
  mods: InstalledMod[];
}

export function FolderCard({ folder, mods }: FolderCardProps) {
  const { handleToggle, checked, indeterminate } = useFolderToggle(folder, mods);
  const { enabledCount } = getFolderEnabledState(mods);
  const summary = useMemo(() => getFolderSummary(mods), [mods]);

  return (
    <FolderContextMenu folderId={folder.id} folderName={folder.name}>
      <Link
        to="/folder/$folderId"
        params={{ folderId: folder.id }}
        className="group relative flex h-full w-full cursor-pointer flex-col rounded-xl border border-surface-600 bg-surface-900 text-left no-underline transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-px hover:border-accent-hover hover:shadow-md"
      >
        {mods.length > 0 && (
          <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={checked}
              indeterminate={indeterminate}
              onCheckedChange={handleToggle}
              size="sm"
            />
          </div>
        )}

        <div className="grid aspect-video grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-t-xl bg-surface-700">
          {mods.slice(0, 4).map((mod) => (
            <FolderCardThumbnail key={mod.id} mod={mod} />
          ))}
          {Array.from({ length: Math.max(0, 4 - mods.length) }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-surface-800" />
          ))}
        </div>

        <div className="flex flex-1 flex-col p-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-accent-400" />
            <h3 className="flex-1 truncate text-sm font-medium text-surface-100">{folder.name}</h3>
          </div>

          <div className="mb-1 min-h-5 text-xs text-surface-400">
            {mods.length > 0 && (
              <span>
                {enabledCount}/{mods.length} enabled
              </span>
            )}
          </div>

          <div className="mt-auto flex items-center text-xs text-surface-500">
            <span>
              {mods.length} {mods.length === 1 ? "mod" : "mods"}
            </span>
            {summary && (
              <>
                <span className="mx-1">·</span>
                <span className="truncate">{summary}</span>
              </>
            )}
          </div>
        </div>
      </Link>
    </FolderContextMenu>
  );
}
