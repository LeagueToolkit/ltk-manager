import { useCallback, useEffect, useMemo } from "react";

import type { ExtractTarget } from "@/lib/tauri";

import { useProjectContext } from "../components/ProjectContext";
import { entryTarget } from "../gameBrowser/extractTargets";
import type { SourceEntry, SourceTreeNode } from "../gameBrowser/sourceIndex";
import {
  useExplorerLocation,
  useExplorerSelection,
  useGoToLocation,
  useOpenLocationStops,
  useRecordLocationVisit,
  useSetExplorerSelection,
} from "../state";
import type { ExplorerItem } from "./items";
import { ancestorLocations, parentLocation } from "./location";
import {
  isCovered,
  NO_SELECTION,
  type SelectedItem,
  selectEvery,
  type SelectGesture,
  type Selection,
  type SelectionSummary,
  selectionSummary,
  selectItem,
} from "./selection";

export interface ExplorerNav {
  /** The directory the explorer is in, `""` at the root. */
  location: string;
  goTo: (path: string) => void;
  goUp: () => void;
  atRoot: boolean;
}

/**
 * Where the explorer is, and the two ways it moves that are not a click on a row.
 *
 * `documentId` is the tab the explorer draws in, which is what a history stop
 * routes back to before it restores the directory.
 */
export function useExplorerNav(explorerId: string, documentId: string): ExplorerNav {
  const location = useExplorerLocation(explorerId);
  const go = useGoToLocation();
  const write = useSetExplorerSelection();
  const project = useProjectContext();
  const record = useRecordLocationVisit();
  const openStops = useOpenLocationStops();

  /* The route out of wherever this explorer opens, which the store lays down
     once per open: a mount is not a navigation. */
  useEffect(() => {
    const stops = ancestorLocations(location).map((path) => ({ explorerId, path }));
    openStops(project.path, documentId, stops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A move drops the selection, the way a file manager does, and is a stop.
   *
   * Descending into a directory that is itself selected would otherwise draw
   * every item inside it covered, which reads as though the move selected them.
   */
  const goTo = useCallback(
    (path: string) => {
      if (path === location) return;
      /* Both ends of the move. The stop on top may still be the tab's own and
         name no directory, and such a stop takes the next location rather than
         standing behind it, so naming only the destination would drop the
         directory being left. Naming it first costs nothing where it is already
         there, since a stop the arrows stand on records nothing. */
      record(project.path, documentId, { explorerId, path: location });
      go(explorerId, path);
      write(explorerId, NO_SELECTION);
      record(project.path, documentId, { explorerId, path });
    },
    [go, write, record, project.path, documentId, explorerId, location],
  );

  const goUp = useCallback(() => goTo(parentLocation(location)), [goTo, location]);

  return { location, goTo, goUp, atRoot: location.length === 0 };
}

export interface ExplorerSelectionApi {
  selection: Selection;
  summary: SelectionSummary;
  isSelected: (id: string) => boolean;
  /** Whether a selected directory holds this path, which draws the half fill. */
  isCoveredPath: (path: string | null) => boolean;
  select: (id: string, gesture: SelectGesture) => void;
  /**
   * Take the item alone unless the selection already holds it, which is the
   * rule a right click and a drag both obey.
   */
  aimAt: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
}

/**
 * The one selection under every view of one explorer.
 *
 * `order` is what the view has on screen, in the order it walks them, which is
 * what an extend runs over and what `Ctrl+A` takes.
 */
export function useExplorerSelectionApi(
  explorerId: string,
  order: readonly SelectedItem[],
): ExplorerSelectionApi {
  const selection = useExplorerSelection(explorerId);
  const write = useSetExplorerSelection();

  const select = useCallback(
    (id: string, gesture: SelectGesture) =>
      write(explorerId, selectItem(selection, order, id, gesture)),
    [write, explorerId, selection, order],
  );

  const aimAt = useCallback(
    (id: string) => {
      if (selection.items.has(id)) return;
      write(explorerId, selectItem(selection, order, id, { toggle: false, extend: false }));
    },
    [write, explorerId, selection, order],
  );

  const selectAll = useCallback(
    () => write(explorerId, selectEvery(order)),
    [write, explorerId, order],
  );

  const clear = useCallback(() => write(explorerId, NO_SELECTION), [write, explorerId]);

  const isSelected = useCallback((id: string) => selection.items.has(id), [selection]);
  const isCoveredPath = useCallback(
    (path: string | null) => isCovered(selection, path),
    [selection],
  );
  const summary = useMemo(() => selectionSummary(selection), [selection]);

  return { selection, summary, isSelected, isCoveredPath, select, aimAt, selectAll, clear };
}

/** How an explorer turns one of its directories into targets, by its path. */
export type DirTargetsAt = (path: string) => ExtractTarget[];

/**
 * What a copy or an extract of the selection takes.
 *
 * A directory contributes whatever its source says it holds, which the backend
 * expands for the index and the frontend walks for an archive. The extractor
 * writes each file once whatever selected items cover it, so nothing here has
 * to fold a covered file away.
 */
export function selectionTargets(selection: Selection, dirTargets: DirTargetsAt): ExtractTarget[] {
  const out: ExtractTarget[] = [];

  for (const item of selection.items.values()) {
    if (item.kind === "dir" && item.path !== null) out.push(...dirTargets(item.path));
    if (item.entry) out.push(entryTarget(item.entry));
  }

  return out;
}

/**
 * What a run against the selection is called, in the dialog and the report.
 *
 * One item names itself, and a set names its count, because a list of four
 * hundred file names is not a subject a report can carry.
 */
export function selectionSubject(selection: ExplorerSelectionApi): string {
  const only = [...selection.selection.items.values()][0];
  if (selection.selection.items.size === 1 && only) return only.name;
  return `${selection.summary.files.toLocaleString()} files`;
}

/** One row of a grid, as the selection remembers it. */
export function selectedOfItem(item: ExplorerItem): SelectedItem {
  if (item.kind === "dir") {
    return {
      id: item.id,
      kind: "dir",
      path: item.id,
      name: item.name,
      sizeBytes: 0,
      fileCount: item.fileCount,
    };
  }

  return selectedOfEntry(item.entry, item.name);
}

/** One row of a tree, as the selection remembers it. A loading row is none. */
export function selectedOfNode(node: SourceTreeNode): SelectedItem | null {
  if (node.type === "loading") return null;

  if (node.type === "dir") {
    return {
      id: node.path,
      kind: "dir",
      path: node.path,
      name: node.name,
      sizeBytes: 0,
      fileCount: node.fileCount,
    };
  }

  return selectedOfEntry(node.entry, node.name);
}

function selectedOfEntry(entry: SourceEntry, name: string): SelectedItem {
  return {
    id: entry.pathHash,
    kind: "file",
    path: entry.path,
    name,
    sizeBytes: entry.sizeBytes,
    fileCount: 1,
    entry,
  };
}
