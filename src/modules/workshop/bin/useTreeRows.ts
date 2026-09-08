import { useCallback, useEffect, useMemo, useState } from "react";

import type { BinDocumentId, BinRow } from "@/lib/tauri";

import {
  flattenRows,
  isUnder,
  type LoadedChildren,
  pagesWanted,
  toggled,
  type VisibleRow,
} from "./binRows";
import { type ChildrenRequest, useBinChildren } from "./useBinDocument";
import type { RowGroup } from "./useLinkTargets";

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
}: TreeRowsOptions): TreeRows {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initialExpanded));
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(() => new Map());

  const requests = useMemo<ChildrenRequest[]>(
    () => [...expanded].map((key) => ({ key, pages: pages.get(key) ?? 1 })),
    [expanded, pages],
  );
  const { loaded, notOpen } = useBinChildren(document, requests);

  useEffect(() => {
    if (notOpen) onNotOpen();
  }, [notOpen, onNotOpen]);

  const visible = useMemo(
    () => flattenRows(roots, expanded, (key) => loaded.get(key), rootOwner),
    [roots, expanded, loaded, rootOwner],
  );

  const groups = useMemo<RowGroup[]>(
    () => [
      { key: "", rows: roots },
      ...[...loaded].map(([key, children]) => ({ key, rows: children.rows })),
    ],
    [roots, loaded],
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

  return { visible, loaded, groups, toggle, expand, requestMore };
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
