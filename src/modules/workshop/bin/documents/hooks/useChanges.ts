import { queryOptions, useQuery } from "@tanstack/react-query";
import { createContext, use, useMemo } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import {
  api,
  type AppError,
  type BinChange,
  type BinDocumentId,
  type BinRow,
  type ChangeBaseline,
  type ChangeKind,
} from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { rowKey } from "../../tree/utils/binRows";
import { useChangeBaseline, useChangeMarks, useChangedOnly } from "../state/changeView";
import { sendOn } from "./useDocumentCall";

/** The query root of a document's changes, which every edit leaves stale. */
export const CHANGES_ROOT = ["bin-changes"] as const;

const changesQuery = (document: BinDocumentId, baseline: ChangeBaseline, enabled: boolean) =>
  queryOptions<readonly BinChange[], AppError>({
    queryKey: [...CHANGES_ROOT, document, baseline],
    queryFn: async () =>
      unwrapForQuery((await sendOn(document, (id) => api.bin.changes(id, baseline))).result),
    enabled,
    staleTime: Infinity,
    retry: false,
  });

/** The rows of a document that differ from the baseline. "What changed" in docs/ux/BIN_EDITOR.md. */
export interface ChangedRows {
  readonly baseline: ChangeBaseline;
  /** How each changed property or object differs, by row key. */
  readonly rows: ReadonlyMap<string, ChangeKind>;
  /** The row keys of every row that encloses a change, its object's included. */
  readonly within: ReadonlySet<string>;
  /** Only changed rows show, and unchanged nodes fade. */
  readonly only: boolean;
}

/** The changed rows of the enclosing view, or null while marks are off. */
export const ChangedRowsContext = createContext<ChangedRows | null>(null);

/** The changes of `document` against the chosen baseline, and null while marks are off. */
export function useChangedRows(document: BinDocumentId): ChangedRows | null {
  const marks = useChangeMarks();
  const baseline = useChangeBaseline();
  const only = useChangedOnly();
  const { data } = useQuery(changesQuery(document, baseline, marks || only));

  return useMemo(() => {
    if ((!marks && !only) || data === undefined) return null;
    return { ...changedRows(data), baseline, only };
  }, [data, marks, only, baseline]);
}

/** `changes` by row key, and every row that encloses them. */
export function changedRows(changes: readonly BinChange[]): Pick<ChangedRows, "rows" | "within"> {
  const rows = new Map<string, ChangeKind>();
  const within = new Set<string>();
  for (const change of changes) {
    rows.set(rowKey(change), change.kind);
    for (const key of enclosingKeys(change)) within.add(key);
  }
  return { rows, within };
}

/** The row keys of every row that encloses `row`, its object's included. */
export function enclosingKeys(row: { entry: string; path: string }): string[] {
  return enclosingPaths(row.path).map((path) => rowKey({ entry: row.entry, path }));
}

/** Every path that encloses the wire `path`, down from the object, which is the empty path. */
export function enclosingPaths(path: string): string[] {
  if (path === "") return [];

  const out = [""];
  let depth = 0;
  for (let at = 1; at < path.length; at += 1) {
    const char = path[at];
    if (char === "}") depth -= 1;
    if (depth === 0 && (char === "." || char === "[" || char === "{")) out.push(path.slice(0, at));
    if (char === "{") depth += 1;
  }
  return out;
}

/** How the row under `key` differs from the baseline, `within` for one enclosing a change, or null. */
export function useRowChange(key: string): ChangeKind | "within" | null {
  const changed = use(ChangedRowsContext);
  if (changed === null) return null;
  return changed.rows.get(key) ?? (changed.within.has(key) ? "within" : null);
}

/** Whether the enclosing view lists changed rows alone. */
export function useChangedOnlyView(): ChangedRows | null {
  const changed = use(ChangedRowsContext);
  return changed?.only === true ? changed : null;
}

/**
 * Put a changed row back to the baseline, as one undoable edit, and null where the view
 * takes no edit.
 */
export function useRevertRow(): ((row: BinRow) => Promise<boolean>) | null {
  const edit = use(LeafEditContext);
  const changed = use(ChangedRowsContext);
  const toast = useToast();
  const send = edit?.send;
  const landed = edit?.landed;
  if (changed === null || send === undefined || landed === undefined) return null;

  return async (row) => {
    const { result, id } = await send((document) =>
      api.bin.revert(document, row.entry, row.path, changed.baseline),
    );
    if (!result.ok) {
      toast.failure(m.workshop_bin_change_revert_failed_title(), result.error);
      return false;
    }

    landed(id);
    return true;
  };
}
