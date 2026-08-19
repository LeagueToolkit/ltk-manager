import type { InstalledMod, LibraryFolder } from "@/lib/tauri";
import type { SortConfig } from "@/stores/libraryFilter";

/** Alphabetically first champion of a mod, or null when it names none. */
function championKey(mod: InstalledMod): string | null {
  if (mod.champions.length === 0) return null;
  return mod.champions.reduce((first, champion) =>
    champion.localeCompare(first) < 0 ? champion : first,
  );
}

export function sortMods(mods: InstalledMod[], sort: SortConfig): InstalledMod[] {
  if (sort.field === "priority") return mods;

  const sorted = [...mods];
  const dir = sort.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (sort.field) {
      case "name":
        return dir * a.displayName.localeCompare(b.displayName);
      case "champion": {
        const championA = championKey(a);
        const championB = championKey(b);
        // Champion-less mods sink to the bottom either way round.
        if (championA === null || championB === null) {
          if (championA !== championB) return championA === null ? 1 : -1;
          return a.displayName.localeCompare(b.displayName);
        }
        const byChampion = championA.localeCompare(championB);
        if (byChampion !== 0) return dir * byChampion;
        return a.displayName.localeCompare(b.displayName);
      }
      case "installedAt":
        return dir * (new Date(a.installedAt).getTime() - new Date(b.installedAt).getTime());
      case "enabled":
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
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
