import type {
  InstalledMod,
  KeptSort,
  KeptSortField,
  LibraryFolder,
  ModHealthVerdict,
} from "@/lib/tauri";

import type { SortConfig } from "../state";

/** The sort that draws the library in its load order. */
export const LOAD_ORDER: SortConfig = { field: "priority", direction: "desc" };

/** What a sort needs beyond the mod itself, for the fields another query answers. */
export interface SortContext {
  folderName?: (folderId: string) => string | undefined;
  healthOf?: (modId: string) => ModHealthVerdict | null | undefined;
  /** The champions a mod is filed under, declared and derived. Defaults to the declared ones. */
  championsOf?: (mod: InstalledMod) => readonly string[];
}

/** Alphabetically first champion of a mod, or null when it names none. */
function championKey(mod: InstalledMod, context: SortContext): string | null {
  const champions = context.championsOf?.(mod) ?? mod.champions;
  if (champions.length === 0) return null;
  return champions.reduce((first, champion) =>
    champion.localeCompare(first) < 0 ? champion : first,
  );
}

const KEPT_SORT_FIELDS: Partial<Record<SortConfig["field"], KeptSortField>> = {
  name: "name",
  champion: "champion",
  installedAt: "installedAt",
  enabled: "enabled",
};

/** The kept sort that places mods the way `sort` draws them, or null for a sort no folder keeps. */
export function keptSortOf(sort: SortConfig): KeptSort | null {
  const field = KEPT_SORT_FIELDS[sort.field];
  if (!field) return null;
  return { field, direction: sort.direction };
}

/**
 * The folder order with the user folders arranged by `sort`, for the arrange that writes
 * the view's order back. The root folder keeps its place, and a folder the order does
 * not name is left out.
 */
export function arrangedFolderOrder(
  folderOrder: readonly string[],
  folders: readonly LibraryFolder[],
  sort: SortConfig,
): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const userFolders = folderOrder
    .filter((id) => id !== "root")
    .map((id) => byId.get(id))
    .filter((folder): folder is LibraryFolder => folder !== undefined);
  const sorted = sortFolders(userFolders, sort).map((folder) => folder.id);

  let next = 0;
  return folderOrder
    .filter((id) => id === "root" || byId.has(id))
    .map((id) => (id === "root" ? id : sorted[next++]));
}

/** Numeric parts of a version, so `1.10.0` sorts after `1.9.0`. */
function versionParts(version: string): number[] {
  return version.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * How loudly a verdict asks for attention, highest first.
 *
 * The same rungs `alarmOf` draws: broken, then repairable, then a fault, then
 * healthy, then a mod never checked.
 */
export function healthRank(verdict: ModHealthVerdict | null | undefined): number {
  if (!verdict) return 0;
  if (verdict.health === "healthy") return 1;
  if (verdict.health === "repairable") return 3;
  if (verdict.counts.fatals + verdict.counts.errors > 0) return 4;
  return 2;
}

/** Sorts `a` and `b` with an absent value last whichever way round. */
function absentLast(a: string | null, b: string | null, dir: number): number | null {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  return dir * a.localeCompare(b);
}

export function sortMods(
  mods: InstalledMod[],
  sort: SortConfig,
  context: SortContext = {},
): InstalledMod[] {
  if (sort.field === "priority") return mods;

  const sorted = [...mods];
  const dir = sort.direction === "asc" ? 1 : -1;
  const byName = (a: InstalledMod, b: InstalledMod) => a.displayName.localeCompare(b.displayName);

  sorted.sort((a, b) => {
    switch (sort.field) {
      case "name":
        return dir * byName(a, b);
      case "champion":
        return absentLast(championKey(a, context), championKey(b, context), dir) || byName(a, b);
      case "installedAt":
        return dir * (new Date(a.installedAt).getTime() - new Date(b.installedAt).getTime());
      case "enabled":
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return byName(a, b);
      case "version":
        return dir * compareVersions(a.version, b.version) || byName(a, b);
      case "author":
        return absentLast(a.authors[0] ?? null, b.authors[0] ?? null, dir) || byName(a, b);
      case "layers":
        return dir * (a.layers.length - b.layers.length) || byName(a, b);
      case "health": {
        const rank = (mod: InstalledMod) => healthRank(context.healthOf?.(mod.id));
        return dir * (rank(a) - rank(b)) || byName(a, b);
      }
      case "folder": {
        const name = (mod: InstalledMod) =>
          (mod.folderId && context.folderName?.(mod.folderId)) || null;
        return absentLast(name(a), name(b), dir) || byName(a, b);
      }
      case "format":
        return dir * a.format.localeCompare(b.format) || byName(a, b);
      case "storage":
        return dir * a.storage.localeCompare(b.storage) || byName(a, b);
      case "license":
        return absentLast(a.license?.name ?? null, b.license?.name ?? null, dir) || byName(a, b);
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
  context: SortContext = {},
): Map<string, InstalledMod[]> {
  if (sort.field === "priority") return modsByFolder;

  const sorted = new Map<string, InstalledMod[]>();
  for (const [fid, mods] of modsByFolder) {
    sorted.set(fid, sortMods(mods, sort, context));
  }
  return sorted;
}
