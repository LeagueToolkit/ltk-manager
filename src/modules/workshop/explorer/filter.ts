/**
 * The three filters an explorer narrows its rows by, and a row shows when it
 * passes all three.
 *
 * A directory passes the kind and the unnamed filters whatever they hold. The
 * grid is the only way down into the tree it draws, so a filter that took the
 * directories away would leave the location a dead end.
 */

import type { WorkshopFileKind } from "@/lib/tauri";

import { fileKindFromPath } from "../gameBrowser/fileKind";
import type { SourceTreeNode } from "../gameBrowser/sourceIndex";
import type { ExplorerItem } from "./items";

export type KindGroupId = "textures" | "meshes" | "animations" | "data" | "audio" | "other";

export interface KindGroup {
  readonly id: KindGroupId;

  readonly kinds: readonly WorkshopFileKind[];
}

/** The kinds a modder reaches for as one, in the order the menu lists them. */
export const KIND_GROUPS: readonly KindGroup[] = [
  {
    id: "textures",

    kinds: ["texture", "texture_dds", "png", "jpeg", "tga", "svg"],
  },
  {
    id: "meshes",

    kinds: [
      "simple_skin",
      "static_mesh_ascii",
      "static_mesh_binary",
      "map_geometry",
      "world_geometry",
      "skeleton",
    ],
  },
  { id: "animations", kinds: ["animation"] },
  {
    id: "data",

    kinds: [
      "property_bin",
      "property_bin_override",
      "riot_string_table",
      "preload",
      "lua_obj",
      "light_grid",
    ],
  },
  { id: "audio", kinds: ["wwise_bank", "wwise_package"] },
  { id: "other", kinds: [] },
];

const GROUP_BY_KIND: ReadonlyMap<WorkshopFileKind, KindGroupId> = new Map(
  KIND_GROUPS.flatMap((group) => group.kinds.map((kind) => [kind, group.id] as const)),
);

export interface ExplorerFilter {
  readonly text: string;
  /** The groups a row may be in. Empty passes every kind. */
  readonly kinds: ReadonlySet<KindGroupId>;
  /** Only the chunks no hash table names, which is what a game patch leaves. */
  readonly unnamedOnly: boolean;
}

export const NO_FILTER: ExplorerFilter = { text: "", kinds: new Set(), unnamedOnly: false };

/** Which group a kind belongs to, and Other for the kinds no group claims. */
export function kindGroupOf(kind: WorkshopFileKind): KindGroupId {
  return GROUP_BY_KIND.get(kind) ?? "other";
}

/** Whether anything is narrowing the rows, which is what draws the chips. */
export function filterIsActive(filter: ExplorerFilter): boolean {
  return filter.text.length > 0 || filter.kinds.size > 0 || filter.unnamedOnly;
}

/** The rows the filter leaves, in the order they came. */
export function filterItems(
  items: readonly ExplorerItem[],
  filter: ExplorerFilter,
): readonly ExplorerItem[] {
  if (!filterIsActive(filter)) return items;

  const needle = filter.text.toLowerCase();

  return items.filter((item) => {
    if (needle.length > 0 && !item.name.toLowerCase().includes(needle)) return false;
    if (item.kind === "dir") return true;
    if (filter.unnamedOnly && item.entry.path !== null) return false;
    if (filter.kinds.size === 0) return true;
    return filter.kinds.has(kindGroupOf(fileKindFromPath(item.name)));
  });
}

/**
 * The tree the text leaves: every match, under every directory on the way to it.
 *
 * A directory whose own name matches keeps everything below it, because the
 * name the user typed is the answer and its contents are what they asked to
 * see.
 */
export function filterTree(
  nodes: readonly SourceTreeNode[],
  text: string,
): readonly SourceTreeNode[] {
  if (text.length === 0) return nodes;

  const needle = text.toLowerCase();

  const keep = (list: readonly SourceTreeNode[]): SourceTreeNode[] => {
    const out: SourceTreeNode[] = [];

    for (const node of list) {
      if (node.type === "loading") continue;

      if (node.name.toLowerCase().includes(needle)) {
        out.push(node);
        continue;
      }

      if (node.type === "dir") {
        const children = keep(node.children);
        if (children.length > 0) out.push({ ...node, children });
      }
    }

    return out;
  };

  return keep(nodes);
}
