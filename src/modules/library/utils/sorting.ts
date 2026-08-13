import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import type { SortConfig } from "@/stores/libraryFilter";

export function sortMods(mods: InstalledMod[], sort: SortConfig): InstalledMod[] {
  if (sort.field === "priority") return mods;

  const sorted = [...mods];
  const dir = sort.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (sort.field) {
      case "name":
        return dir * a.displayName.localeCompare(b.displayName);
      case "installedAt":
        return dir * (new Date(a.installedAt).getTime() - new Date(b.installedAt).getTime());
      case "enabled":
        if (a.enabled !== b.enabled) return dir * (a.enabled ? -1 : 1);
        return a.displayName.localeCompare(b.displayName);
      default:
        return 0;
    }
  });

  return sorted;
}

export function sortFolders(folders: LibraryFolder[], sort: SortConfig): LibraryFolder[] {
  if (sort.field !== "name") return folders;

  const dir = sort.direction === "asc" ? 1 : -1;
  return [...folders].sort((a, b) => dir * a.name.localeCompare(b.name));
}

export function sortModsByFolder(
  modsByFolder: Map<string, InstalledMod[]>,
  sort: SortConfig,
): Map<string, InstalledMod[]> {
  if (sort.field === "priority") return modsByFolder;

  const sorted = new Map<string, InstalledMod[]>();
  for (const [fid, mods] of modsByFolder) {
    sorted.set(fid, sortMods(mods, sort));
  }
  return sorted;
}
