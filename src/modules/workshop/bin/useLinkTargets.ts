import { useQueries, type UseQueryOptions } from "@tanstack/react-query";
import { createContext, use, useMemo } from "react";

import {
  api,
  type AppError,
  type AssetRef,
  type BinDocumentId,
  type BinRow,
  type ContentTree,
  type DeclaredObject,
  type DeclaredObjects,
  type GameFileEntry,
  type ObjectDeclaration,
  type ObjectIndexStatus,
} from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { useProjectContentTree } from "../api/useProjectContentTree";
import { useOptionalProjectContext, useProjectContext } from "../components/ProjectContext";
import { layerTitle } from "../documents/contentDocument";
import { BUILDING_POLL_MS, gameKeys } from "../gameBrowser";
import type { OpenIntent } from "../palette/types";
import { assetKey } from "../preview/assetRef";
import { nameHash } from "./binHash";
import { chunkPath, type LayerCopy } from "./linkDecision";

/** One group of rows checked together: a node's rows, or the tab's roots. */
export interface RowGroup {
  readonly key: string;
  readonly rows: readonly BinRow[];
}

/** What a page's checks answered for the links and hashes in it. */
export interface LinkTargets {
  /** The slot the index is in, as the latest check reports it. Absent before one answers. */
  readonly index: ObjectIndexStatus | null;
  /** By object hash, `0x` and eight hex digits: what declares it, in resolution order. */
  readonly declared: ReadonlyMap<string, DeclaredObject>;
  /** By resolved chunk path: the install's copy. A path the install lacks is absent. */
  readonly located: ReadonlyMap<string, GameFileEntry>;
  /** A check is on its way for some page. */
  readonly pending: boolean;
}

export const NO_LINK_TARGETS: LinkTargets = {
  index: null,
  declared: new Map(),
  located: new Map(),
  pending: false,
};

/** The checks the tree ran, read by every chip in it. */
export const LinkTargetsContext = createContext<LinkTargets>(NO_LINK_TARGETS);

/** The checks of the enclosing tree. A chip outside one reads nothing as resolved. */
export function useLinkTargets(): LinkTargets {
  return use(LinkTargetsContext);
}

/** The tree's way to open a link whose target the index has not answered for. */
export interface LinkOpen {
  /** Build the index, and open `hash` with `intent` on the answer. */
  readonly wantOpen: (hash: string, intent: OpenIntent) => void;
  /** The hashes a click is waiting on. */
  readonly wanting: ReadonlySet<string>;
}

export const NO_LINK_OPEN: LinkOpen = { wantOpen: () => {}, wanting: new Set() };

/** The enclosing tree's warm-and-open, shared by a chip and the row menu. */
export const LinkOpenContext = createContext<LinkOpen>(NO_LINK_OPEN);

export function useLinkOpen(): LinkOpen {
  return use(LinkOpenContext);
}

export const linkKeys = {
  declared: (document: BinDocumentId, key: string, hashes: readonly string[]) =>
    [...gameKeys.objectSearches, "links", document, key, hashes] as const,
  located: (key: string, paths: readonly string[]) =>
    [...gameKeys.dirs, "files", key, paths] as const,
};

/**
 * The object hashes a group's values name, sorted, each once.
 *
 * A `link` and a `hash` carry theirs. A `string` is hashed as an object path, so a
 * string that names one resolves in the same call rather than in one of its own.
 */
export function linkHashes(rows: readonly BinRow[]): string[] {
  const hashes = new Set<string>();
  for (const { value } of rows) {
    if (value.type === "objectLink" || value.type === "hash") hashes.add(value.hash);
    if (value.type === "string") hashes.add(nameHash(value.value));
  }
  return [...hashes].sort();
}

/** The chunk paths a group's `file` values and its path-shaped strings name, sorted, each once. */
export function linkPaths(rows: readonly BinRow[]): string[] {
  const paths = new Set<string>();
  for (const { value } of rows) {
    if (value.type === "wadChunkLink" && value.path !== null) paths.add(value.path);
    if (value.type === "string") {
      const path = chunkPath(value.value);
      if (path !== null) paths.add(path);
    }
  }
  return [...paths].sort();
}

/**
 * The project's declarations of `hashes` out of the content scan, by hash.
 *
 * The layer side of "Elsewhere in the install or a layer" in docs/ux/BIN_EDITOR.md. The
 * scan carries every object a layer's bins declare, and no call is made.
 */
export function layerDeclarations(
  tree: ContentTree | undefined,
  projectPath: string,
  hashes: ReadonlySet<string>,
): ReadonlyMap<string, DeclaredObject> {
  const declared = new Map<string, DeclaredObject>();
  if (!tree || hashes.size === 0) return declared;
  for (const layer of tree.layers) {
    for (const entry of layer.entries) {
      for (const object of entry.objects) {
        if (!hashes.has(object.objectHash)) continue;
        const declaration: ObjectDeclaration = {
          asset: {
            kind: "layer",
            project: projectPath,
            layer: layer.name,
            path: entry.relativePath,
          },
          file: entry.relativePath,
          classHash: object.classHash,
          class: object.class,
        };
        const known = declared.get(object.objectHash);
        if (known) known.declarations.push(declaration);
        else declared.set(object.objectHash, { path: object.path, declarations: [declaration] });
      }
    }
  }
  return declared;
}

/**
 * `install` with `layers` folded in, each hash's layer declarations after its install
 * ones and none twice.
 */
export function joinDeclarations(
  install: ReadonlyMap<string, DeclaredObject>,
  layers: ReadonlyMap<string, DeclaredObject>,
): ReadonlyMap<string, DeclaredObject> {
  const joined = new Map(install);
  for (const [hash, fromLayers] of layers) {
    const known = joined.get(hash);
    if (!known) {
      joined.set(hash, fromLayers);
      continue;
    }
    const seen = new Set(known.declarations.map((declaration) => assetKey(declaration.asset)));
    const added = fromLayers.declarations.filter(
      (declaration) => !seen.has(assetKey(declaration.asset)),
    );
    if (added.length > 0) {
      joined.set(hash, { ...known, declarations: [...known.declarations, ...added] });
    }
  }
  return joined;
}

type DeclaredQuery = UseQueryOptions<
  DeclaredObjects,
  AppError,
  DeclaredObjects,
  ReturnType<typeof linkKeys.declared>
>;

type LocatedQuery = UseQueryOptions<
  Record<string, GameFileEntry>,
  AppError,
  Record<string, GameFileEntry>,
  ReturnType<typeof linkKeys.located>
>;

/**
 * Check every group's link and hash targets against the index and the project's
 * layers, and its `file` targets against the install, one call per group and per kind.
 *
 * "Links" in docs/ux/BIN_EDITOR.md. The declared checks sit under the object searches,
 * and a warm or a drop settling asks them again. A check the build has not answered
 * asks again each second.
 */
export function useCheckLinkTargets(
  document: BinDocumentId,
  groups: readonly RowGroup[],
): LinkTargets {
  const project = useOptionalProjectContext();
  const { data: tree } = useProjectContentTree(project?.path);

  const targets = useMemo(
    () =>
      groups.map((group) => ({
        key: group.key,
        hashes: linkHashes(group.rows),
        paths: linkPaths(group.rows),
      })),
    [groups],
  );

  const declaredQueries: DeclaredQuery[] = targets
    .filter((group) => group.hashes.length > 0)
    .map((group) => ({
      queryKey: linkKeys.declared(document, group.key, group.hashes),
      queryFn: async () => unwrapForQuery(await api.declaredObjects(group.hashes, document)),
      staleTime: Infinity,
      retry: false,
      refetchInterval: (query) =>
        query.state.data?.index.status === "building" ? BUILDING_POLL_MS : false,
    }));
  const declaredResults = useQueries({ queries: declaredQueries });

  const locatedQueries: LocatedQuery[] = targets
    .filter((group) => group.paths.length > 0)
    .map((group) => ({
      queryKey: linkKeys.located(group.key, group.paths),
      queryFn: async () => unwrapForQuery(await api.locateGameFiles(group.paths)),
      staleTime: Infinity,
      retry: false,
    }));
  const locatedResults = useQueries({ queries: locatedQueries });

  return useMemo(() => {
    const install = new Map<string, DeclaredObject>();
    let index: ObjectIndexStatus | null = null;
    let pending = false;
    for (const result of declaredResults) {
      if (result.isPending) pending = true;
      if (!result.data) continue;
      index = result.data.index;
      for (const [hash, object] of Object.entries(result.data.objects)) install.set(hash, object);
    }

    const located = new Map<string, GameFileEntry>();
    for (const result of locatedResults) {
      if (result.isPending) pending = true;
      if (!result.data) continue;
      for (const [path, entry] of Object.entries(result.data)) located.set(path, entry);
    }

    const wanted = new Set(targets.flatMap((group) => group.hashes));
    const declared = project
      ? joinDeclarations(install, layerDeclarations(tree, project.path, wanted))
      : install;
    return { index, declared, located, pending };
  }, [declaredResults, locatedResults, project, targets, tree]);
}

/** The tree's asset, for the layer side of a `file` link. Null outside a tree. */
export const LinkAssetContext = createContext<AssetRef | null>(null);

/**
 * The layer's copy of `path`, where the tree's asset sits in a layer that holds one.
 *
 * Matched without regard to case: a layer spells a path as its author spells it, and
 * the tables spell it lowercase.
 */
export function useLayerCopy(path: string | null): LayerCopy | null {
  const asset = use(LinkAssetContext);
  const project = useProjectContext();
  const { data } = useProjectContentTree(asset?.kind === "layer" ? project.path : undefined);

  return useMemo(() => {
    if (path === null || asset?.kind !== "layer" || !data) return null;
    const layer = data.layers.find((candidate) => candidate.name === asset.layer);
    const wanted = path.toLowerCase();
    const entry = layer?.entries.find(
      (candidate) => candidate.relativePath.toLowerCase() === wanted,
    );
    if (!layer || !entry) return null;
    return {
      asset: { kind: "layer", project: project.path, layer: layer.name, path: entry.relativePath },
      title: layerTitle(project, layer.name),
    };
  }, [asset, data, path, project]);
}
