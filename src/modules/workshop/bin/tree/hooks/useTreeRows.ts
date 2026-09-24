import { useCallback, useEffect, useMemo, useState } from "react";

import type { BinDocumentId, BinRow, Dependency } from "@/lib/tauri";

import { type ChildrenRequest, useBinChildren } from "../../documents/hooks/useBinDocument";
import type { RowGroup } from "../../links/hooks/useLinkTargets";
import type { ObjectDraft } from "../state/newObject";
import {
  DEPENDENCIES_KEY,
  type DependencyLines,
  flattenRows,
  type InsertAt,
  isUnder,
  type LoadedChildren,
  PAGE_SIZE,
  pagesWanted,
  toggled,
  type VisibleRow,
} from "../utils/binRows";

/** The lines of a tree, and the ways a reader and the window change them. */
export interface TreeRows {
  /** The lines to draw, in order. */
  readonly visible: VisibleRow[];
  /** What answered under each expanded key, which is where a row's error is. */
  readonly loaded: ReadonlyMap<string, LoadedChildren>;
  /** The roots and each expanded node's rows, as the link check takes them. */
  readonly groups: RowGroup[];
  /** Open a closed row, or close an open one and forget what was open under it. */
  readonly toggle: (key: string) => void;
  /** Open every key, which is how a reveal reaches a row nested under others. */
  readonly expand: (keys: Iterable<string>) => void;
  /** Ask a node with `loadedCount` rows answered for its next page. */
  readonly requestMore: (parent: string, loadedCount: number) => void;
  /** Ask a node for every page up to its row `count`, which an add at the end of a long list reaches. */
  readonly reach: (parent: string, count: number) => void;
  /** Carry the expansion state through an edit that moved rows: each key where it went, or out. */
  readonly remap: (remap: (key: string) => string | null) => void;
}

export interface TreeRowsOptions {
  /** The open's id, which every children call carries. */
  document: BinDocumentId;
  /** The rows at depth zero. */
  roots: readonly BinRow[];
  /** The class the roots are properties of. Null where the roots are objects. */
  rootOwner: string | null;
  /** The keys open at mount. */
  initialExpanded: readonly string[];
  /** The backend holds no document with this id. */
  onNotOpen: () => void;
  /** The holders draw add lines, and open while empty. */
  editable: boolean;
  /** The object an object tab's roots are properties of. Null for a file's roots. */
  rootEntry: string | null;
  /** The one insert line open, if any. */
  insertAt?: InsertAt | null;
  /** The new object being named after a file's roots, if any. */
  newObject?: ObjectDraft | null;
  /** The header's dependencies, pinned over a file's roots. Null where the tree pins none. */
  dependencies?: readonly Dependency[] | null;
}

/**
 * The lines of one bin document, over the expansion state this holds.
 *
 * The tree stays in the backend (ADR-0026), so an expanded key is a fetch of the rows
 * under it and the flattening into lines happens here.
 */
export function useTreeRows({
  document,
  roots,
  rootOwner,
  initialExpanded,
  onNotOpen,
  editable,
  rootEntry,
  insertAt = null,
  newObject = null,
  dependencies = null,
}: TreeRowsOptions): TreeRows {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initialExpanded));
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(() => new Map());

  const requests = useMemo<ChildrenRequest[]>(
    () =>
      [...expanded]
        .filter((key) => key !== DEPENDENCIES_KEY)
        .map((key) => ({ key, pages: pages.get(key) ?? 1 })),
    [expanded, pages],
  );
  const { loaded, notOpen } = useBinChildren(document, requests);

  useEffect(() => {
    if (notOpen) onNotOpen();
  }, [notOpen, onNotOpen]);

  const pinned = useMemo<DependencyLines | null>(
    () => (dependencies === null ? null : { list: dependencies, document }),
    [dependencies, document],
  );
  const visible = useMemo(
    () =>
      flattenRows(
        roots,
        expanded,
        (key) => loaded.get(key),
        rootOwner,
        editable ? { document, rootEntry, insertAt, newObject } : null,
        pinned,
      ),
    [
      roots,
      expanded,
      loaded,
      rootOwner,
      editable,
      document,
      rootEntry,
      insertAt,
      newObject,
      pinned,
    ],
  );

  const groups = useMemo<RowGroup[]>(
    () => [
      { key: "", rows: roots },
      ...(dependencies === null
        ? []
        : [{ key: DEPENDENCIES_KEY, rows: dependencies.map(dependencyLinkRow) }]),
      ...[...loaded].map(([key, children]) => ({ key, rows: children.rows })),
    ],
    [roots, loaded, dependencies],
  );

  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      if (!current.has(key)) return toggled(current, key);
      /* Collapsing forgets what was open underneath. Nothing hidden is fetched. */
      return new Set([...current].filter((open) => !isUnder(key, open)));
    });
  }, []);

  const expand = useCallback((keys: Iterable<string>) => {
    setExpanded((current) => new Set([...current, ...keys]));
  }, []);

  const requestMore = useCallback((parent: string, loadedCount: number) => {
    setPages((current) => {
      const wanted = pagesWanted(loadedCount);
      if ((current.get(parent) ?? 1) >= wanted) return current;
      return new Map(current).set(parent, wanted);
    });
  }, []);

  const reach = useCallback((parent: string, count: number) => {
    setPages((current) => {
      const wanted = Math.max(1, Math.ceil(count / PAGE_SIZE));
      if ((current.get(parent) ?? 1) >= wanted) return current;
      return new Map(current).set(parent, wanted);
    });
  }, []);

  const remap = useCallback((move: (key: string) => string | null) => {
    setExpanded((current) => {
      const next = new Set<string>();
      for (const key of current) {
        const moved = move(key);
        if (moved !== null) next.add(moved);
      }
      return next;
    });
    setPages((current) => {
      const next = new Map<string, number>();
      for (const [key, count] of current) {
        const moved = move(key);
        if (moved !== null) next.set(moved, count);
      }
      return next;
    });
  }, []);

  return { visible, loaded, groups, toggle, expand, requestMore, reach, remap };
}

/**
 * A dependency as the `file` row a link check reads, lowercased as the tables spell a chunk
 * path, which is the spelling the install's lookup answers under.
 */
export function dependencyLinkRow({ path }: Dependency): BinRow {
  return {
    entry: "",
    path: "",
    label: "",
    node: "element",
    name: path,
    unnamed: false,
    kind: null,
    value: { type: "wadChunkLink", hash: "", path: path.toLowerCase() },
    declared: null,
  };
}

/** Ask for a node's next page while the line under its rows is on screen. */
export function useNextPages(
  lines: readonly VisibleRow[],
  requestMore: (parent: string, loadedCount: number) => void,
): void {
  useEffect(() => {
    for (const line of lines) {
      if (line.kind === "more" && !line.pending) requestMore(line.parent, line.loaded);
    }
  }, [lines, requestMore]);
}
