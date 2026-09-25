import { useQueries, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { createContext, use, useEffect, useMemo, useState } from "react";

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
  type LayerContent,
  type ObjectDeclaration,
  type ObjectIndexStatus,
  type WorkshopProject,
} from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { useProjectContentTree } from "../../../content/api/useProjectContentTree";
import { layerTitle } from "../../../documents/utils/contentDocument";
/* The leaves rather than the browser barrel, which pulls the documents that route back here. */
import { BUILDING_POLL_MS, gameKeys } from "../../../gameBrowser/api/keys";
import { useWarmObjectIndex } from "../../../objectsBrowser/api/useObjectIndex";
import type { OpenIntent } from "../../../palette/utils/types";
import { assetKey, assetProject } from "../../../preview/utils/assetRef";
import {
  useOptionalProjectContext,
  useProjectContext,
} from "../../../projects/state/ProjectContext";
import { useOpenDocumentAs } from "../../../state";
import { stringQueries } from "../../../string-overrides/api/queries";
import { nameHash } from "../../shared/utils/binHash";
import { chunkPath, decideFileLink, decideObjectLink, type LayerCopy } from "../utils/linkDecision";

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
  /** By string as the file holds it: the in-game line of the string-table key it is. */
  readonly strings: ReadonlyMap<string, string>;
  /** A check is on its way for some page. */
  readonly pending: boolean;
}

export const NO_LINK_TARGETS: LinkTargets = {
  index: null,
  declared: new Map(),
  located: new Map(),
  strings: new Map(),
  pending: false,
};

/** The checks the tree ran, read by every chip in it. */
export const LinkTargetsContext = createContext<LinkTargets>(NO_LINK_TARGETS);

/** The checks of the enclosing tree. A chip outside one reads nothing as resolved. */
export function useLinkTargets(): LinkTargets {
  return use(LinkTargetsContext);
}

/** The name of the object an entry hash addresses. Outside a tree, the hash itself. */
export const ObjectNameContext = createContext<(entry: string) => string>((entry) => entry);

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

/**
 * What opens the object `hash` names from the enclosing tree, or null where nothing does.
 *
 * A declared object opens its tab. While the index is absent or building, the open warms
 * it and lands on the answer. A hash nothing declares, a check still on its way and a null
 * `hash` open nothing.
 */
export function useObjectOpen(hash: string | null): ((intent: OpenIntent) => void) | null {
  const targets = useLinkTargets();
  const { wantOpen } = useLinkOpen();
  const open = useOpenDocumentAs();
  if (hash === null) return null;
  const decision = decideObjectLink(hash, targets);
  if (decision.kind === "chip") return (intent) => open(decision.document, intent);
  if (decision.kind === "warm") return (intent) => wantOpen(hash, intent);
  return null;
}

/**
 * What opens the chunk `path` names from the enclosing tree, or null where nothing holds it:
 * the layer's copy, else the install's. Compared lowercased, as the tables spell a chunk path.
 */
export function useChunkOpen(path: string): ((intent: OpenIntent) => void) | null {
  const targets = useLinkTargets();
  const chunk = path.toLowerCase();
  const layer = useLayerCopy(chunk);
  const open = useOpenDocumentAs();
  const decision = decideFileLink(chunk, targets, layer);
  if (decision.kind !== "chip") return null;
  return (intent) => open(decision.document, intent);
}

/**
 * The warm-and-open a surface of link chips provides to the chips and menus under it.
 *
 * A link clicked while the index is absent: the build runs, and the click lands on the
 * answer. A target the answer lacks is forgotten.
 */
export function useWarmLinkOpen(targets: LinkTargets): LinkOpen {
  const warm = useWarmObjectIndex();
  const open = useOpenDocumentAs();
  const [wanting, setWanting] = useState<ReadonlyMap<string, OpenIntent>>(() => new Map());

  const warmMutate = warm.mutate;
  const linkOpen = useMemo<LinkOpen>(
    () => ({
      wantOpen: (hash, intent) => {
        setWanting((current) => new Map(current).set(hash, intent));
        warmMutate();
      },
      wanting: new Set(wanting.keys()),
    }),
    [wanting, warmMutate],
  );

  useEffect(() => {
    if (targets.index?.status !== "ready" && targets.index?.status !== "failed") return;
    const settled = [...wanting].filter(([hash, intent]) => {
      const decision = decideObjectLink(hash, targets);
      if (decision.kind === "chip") open(decision.document, intent);
      return decision.kind !== "pending" && decision.kind !== "warm";
    });
    if (settled.length === 0) return;
    setWanting((current) => {
      const next = new Map(current);
      for (const [hash] of settled) next.delete(hash);
      return next;
    });
  }, [targets, open, wanting]);

  return linkOpen;
}

/**
 * A string shaped like a string-table key: one word of letters, digits, dots and at
 * least one underscore, which a plain word such as `Idle` never has.
 */
const STRING_KEY = /^(?=.*_)[\w.]+$/;

/** The strings a group's `string` values hold that could be string-table keys, sorted, each once. */
export function linkStringKeys(rows: readonly BinRow[]): string[] {
  const keys = new Set<string>();
  for (const { value } of rows) {
    if (value.type !== "string" || chunkPath(value.value) !== null) continue;
    if (STRING_KEY.test(value.value)) keys.add(value.value);
  }
  return [...keys].sort();
}

export const linkKeys = {
  declared: (document: BinDocumentId, key: string, hashes: readonly string[]) =>
    [...gameKeys.objectSearches, "links", document, key, hashes] as const,
  located: (key: string, paths: readonly string[]) =>
    [...gameKeys.dirs, "files", key, paths] as const,
};

/**
 * The object hashes a group's rows name, sorted, each once.
 *
 * A `link` and a `hash` carry theirs, and a patch target row its entry. A `string` is
 * hashed as an object path, so a string that names one resolves in the same call rather
 * than in one of its own.
 */
export function linkHashes(rows: readonly BinRow[]): string[] {
  const hashes = new Set<string>();
  for (const { node, entry, value } of rows) {
    if (node === "target") hashes.add(entry);
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

/** What the declared checks answered across every group. */
interface DeclaredAnswer {
  readonly index: ObjectIndexStatus | null;
  readonly objects: Readonly<Record<string, DeclaredObject>>;
  readonly pending: boolean;
}

/** What the located checks answered across every group. */
interface LocatedAnswer {
  readonly entries: Readonly<Record<string, GameFileEntry>>;
  readonly pending: boolean;
}

/* Both answers are plain records rather than maps, and both combines sit at module
   scope. Structural sharing then holds one identity across a render that changed
   nothing, which is what the memo reading them depends on. */

function combineDeclared(
  results: readonly UseQueryResult<DeclaredObjects, AppError>[],
): DeclaredAnswer {
  const objects: Record<string, DeclaredObject> = {};
  let index: ObjectIndexStatus | null = null;
  let pending = false;
  for (const result of results) {
    if (result.isPending) pending = true;
    if (!result.data) continue;
    index = result.data.index;
    Object.assign(objects, result.data.objects);
  }
  return { index, objects, pending };
}

function combineLocated(
  results: readonly UseQueryResult<Record<string, GameFileEntry>, AppError>[],
): LocatedAnswer {
  const entries: Record<string, GameFileEntry> = {};
  let pending = false;
  for (const result of results) {
    if (result.isPending) pending = true;
    if (!result.data) continue;
    Object.assign(entries, result.data);
  }
  return { entries, pending };
}

function combineStrings(
  results: readonly UseQueryResult<Record<string, string>, AppError>[],
): Readonly<Record<string, string>> {
  const lines: Record<string, string> = {};
  for (const result of results) Object.assign(lines, result.data);
  return lines;
}

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
        keys: linkStringKeys(group.rows),
      })),
    [groups],
  );

  const declaredQueries: DeclaredQuery[] = targets
    .filter((group) => group.hashes.length > 0)
    .map((group) => ({
      queryKey: linkKeys.declared(document, group.key, group.hashes),
      queryFn: async () => unwrapForQuery(await api.objects.declared(group.hashes, document)),
      staleTime: Infinity,
      retry: false,
      refetchInterval: (query) =>
        query.state.data?.index.status === "building" ? BUILDING_POLL_MS : false,
    }));
  const declaredAnswer = useQueries({ queries: declaredQueries, combine: combineDeclared });

  const locatedQueries: LocatedQuery[] = targets
    .filter((group) => group.paths.length > 0)
    .map((group) => ({
      queryKey: linkKeys.located(group.key, group.paths),
      queryFn: async () => unwrapForQuery(await api.objects.locateGameFiles(group.paths)),
      staleTime: Infinity,
      retry: false,
    }));
  const locatedAnswer = useQueries({ queries: locatedQueries, combine: combineLocated });

  /* Not part of `pending`: the first lookup builds the string index, and a `file` link
     waiting on it would hold off its missing mark for no reason. */
  const lines = useQueries({
    queries: targets
      .filter((group) => group.keys.length > 0)
      .map((group) => stringQueries.values(group.keys)),
    combine: combineStrings,
  });

  return useMemo(() => {
    const install = new Map(Object.entries(declaredAnswer.objects));
    const located = new Map(Object.entries(locatedAnswer.entries));

    const wanted = new Set(targets.flatMap((group) => group.hashes));
    const declared = project
      ? joinDeclarations(install, layerDeclarations(tree, project.path, wanted))
      : install;
    return {
      index: declaredAnswer.index,
      declared,
      located,
      strings: new Map(Object.entries(lines)),
      pending: declaredAnswer.pending || locatedAnswer.pending,
    };
  }, [declaredAnswer, locatedAnswer, lines, project, targets, tree]);
}

/** What a layer directory holding an archive's chunks is named. */
const WAD_DIR_SUFFIX = ".wad.client";

/** The layer every project has. At equal priority, any other layer overrides it. */
const BASE_LAYER = "base";

/** The priority `LayerChunks` stacks a layer the manifest does not declare at. */
const UNDECLARED_PRIORITY = 0;

/** The tree's asset, for the layer side of a `file` link. Null outside a tree. */
export const LinkAssetContext = createContext<AssetRef | null>(null);

/**
 * The project's copy of `path`, when the tree's asset resolves in a project that has one.
 *
 * A layer file resolves in its project, and a game bin open in a project resolves in
 * that project (ADR-0042). Matched without regard to case: a layer spells a path as its
 * author spells it, and the tables spell it lowercase.
 */
export function useLayerCopy(path: string | null): LayerCopy | null {
  const asset = use(LinkAssetContext);
  const project = useProjectContext();
  const owned = asset !== null && assetProject(asset, project.path) !== null;
  const { data } = useProjectContentTree(owned ? project.path : undefined);

  return useMemo(() => {
    if (path === null || asset === null || !owned || !data) return null;
    const wanted = path.toLowerCase();

    const documentLayer = asset.kind === "layer" ? asset.layer : null;
    for (const layer of lookupOrder(data.layers, documentLayer, project)) {
      const entry = layer.entries.find(
        (candidate) => entryChunkPath(candidate.relativePath)?.toLowerCase() === wanted,
      );
      if (entry === undefined) continue;
      return {
        asset: {
          kind: "layer",
          project: project.path,
          layer: layer.name,
          path: entry.relativePath,
        },
        title: layerTitle(project, layer.name),
      };
    }
    return null;
  }, [asset, owned, data, path, project]);
}

/**
 * The order layers are searched for a path: the document's layer, then highest priority first.
 *
 * `LayerChunks` uses the same order: the higher priority wins, and at equal priority any
 * other layer wins over `base`. The chip and the preview then show the same file.
 */
function lookupOrder(
  layers: readonly LayerContent[],
  documentLayer: string | null,
  project: WorkshopProject,
): LayerContent[] {
  const priority = (name: string) =>
    project.layers.find((layer) => layer.name === name)?.priority ?? UNDECLARED_PRIORITY;

  const stacked = [...layers].sort(
    (a, b) =>
      priority(b.name) - priority(a.name) ||
      Number(a.name === BASE_LAYER) - Number(b.name === BASE_LAYER) ||
      b.name.localeCompare(a.name, undefined, { numeric: true }),
  );

  return [
    ...stacked.filter((layer) => layer.name === documentLayer),
    ...stacked.filter((layer) => layer.name !== documentLayer),
  ];
}

/**
 * The chunk path a layer's file holds, or null for a file outside an archive directory.
 *
 * A layer entry is addressed from the layer root, so its first segment is the archive
 * directory. What a `file` value addresses is everything after that.
 */
export function entryChunkPath(relativePath: string): string | null {
  const cut = relativePath.indexOf("/");
  if (cut < 0) return null;
  if (!relativePath.slice(0, cut).toLowerCase().endsWith(WAD_DIR_SUFFIX)) return null;
  return relativePath.slice(cut + 1);
}
