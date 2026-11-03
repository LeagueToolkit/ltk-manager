import { ArrowLeftIcon, FolderOpenIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { Checkbox, IconButton } from "@/components";
import { m } from "@/i18n";
import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import { useFolderToggle } from "@/modules/library/api";
import { keptSortLabel } from "@/modules/library/utils";

interface FolderHeaderProps {
  folder: LibraryFolder;
  mods: InstalledMod[];
}

export function FolderHeader({ folder, mods }: FolderHeaderProps) {
  const { handleToggle, checked, indeterminate } = useFolderToggle(folder, mods);
  const kept = keptSortLabel(folder.keptSort);

  return (
    <div className="flex items-center gap-3">
      <Link to="/mods">
        <IconButton
          icon={<ArrowLeftIcon weight="bold" />}
          size="md"
          aria-label={m.library_folder_back_action()}
        />
      </Link>
      <FolderOpenIcon className="size-5 text-accent-400" />
      <h2 className="text-lg font-semibold text-surface-100">{folder.name}</h2>
      <span className="text-sm text-surface-500">
        {mods.length} {mods.length === 1 ? "mod" : "mods"}
      </span>
      {kept && <span className="text-sm text-surface-500">· {kept}</span>}
      {mods.length > 0 && (
        <Checkbox
          checked={checked}
          indeterminate={indeterminate}
          onCheckedChange={handleToggle}
          size="sm"
        />
      )}
    </div>
  );
}
