import { createContext, useCallback, useState } from "react";

import {
  api,
  type AppError,
  type AssetRef,
  type BinDocumentId,
  type BinRow,
  type ValueEdit,
} from "@/lib/tauri";

import { assetKey } from "../../../preview/utils/assetRef";
import { noteRefused, queueForSave } from "../../../state";
import { type Reopen, useDocumentCall } from "../../documents/hooks/useDocumentCall";
import { rowKey } from "../utils/binRows";
import type { TypedLeaf } from "../utils/leafText";

export interface LeafEdit {
  readonly commit: (row: BinRow, typed: TypedLeaf) => void | Promise<boolean>;
  readonly refused: ReadonlyMap<string, AppError>;
  readonly editProperty?: (holder: BinRow, field: string, edits: ValueEdit[]) => Promise<boolean>;
  readonly removeItem?: (row: BinRow) => Promise<boolean>;
  readonly setPointer?: (
    holder: BinRow,
    field: string,
    className: string | null,
  ) => Promise<boolean>;
}

/** Leaf edits for layouts without tree navigation or structural actions. */
export const LeafEditContext = createContext<LeafEdit | null>(null);

export type { Reopen };

/**
 * Validated document mutations shared by the tree and class inspectors.
 *
 * Every edit goes through `useDocumentCall`, so one the store refuses as not open is sent
 * once more on a fresh id. `reopen` overrides the enclosing tab's.
 */
export function useLeafEdit(
  document: BinDocumentId,
  asset: AssetRef,
  invalidate: () => void,
  reopen?: Reopen,
) {
  const [refused, setRefused] = useState<ReadonlyMap<string, AppError>>(new Map());
  const key = assetKey(asset);
  const send = useDocumentCall(document, reopen);

  const mark = useCallback((at: string, error: AppError | null) => {
    setRefused((previous) => {
      if (error === null && !previous.has(at)) {
        return previous;
      }

      const next = new Map(previous);
      if (error === null) {
        next.delete(at);
      } else {
        next.set(at, error);
      }

      return next;
    });
  }, []);

  const landed = useCallback(
    (id: BinDocumentId) => {
      queueForSave(key, id);
      invalidate();
    },
    [invalidate, key],
  );

  const commit = useCallback(
    async (row: BinRow, typed: TypedLeaf) => {
      const at = rowKey(row);
      if (!typed.ok) {
        mark(at, { code: "BIN_EDIT_REJECTED", address: at, rejection: typed.rejection });
        noteRefused(key);
        return false;
      }

      const { result, id } = await send((id) =>
        api.bin.edit(id, { kind: "patch", entry: row.entry, path: row.path, value: typed.leaf }),
      );
      mark(at, result.ok ? null : result.error);
      if (!result.ok) {
        noteRefused(key);
        return false;
      }

      landed(id);
      return true;
    },
    [key, landed, mark, send],
  );

  const editProperty = useCallback(
    async (holder: BinRow, field: string, edits: ValueEdit[]) => {
      const { result, id } = await send((id) =>
        api.bin.edit(id, {
          kind: "editProperty",
          entry: holder.entry,
          holder: holder.path,
          field,
          edits,
        }),
      );
      mark(rowKey(holder), result.ok ? null : result.error);
      if (!result.ok) {
        noteRefused(key);
        return false;
      }

      landed(id);
      return true;
    },
    [key, landed, mark, send],
  );

  const removeItem = useCallback(
    async (row: BinRow) => {
      const { result, id } = await send((id) =>
        api.bin.edit(id, { kind: "removeItem", entry: row.entry, path: row.path }),
      );
      mark(rowKey(row), result.ok ? null : result.error);
      if (!result.ok) {
        noteRefused(key);
        return false;
      }

      landed(id);
      return true;
    },
    [key, landed, mark, send],
  );

  const setPointer = useCallback(
    async (holder: BinRow, field: string, className: string | null) => {
      const path = [holder.path, field.slice(2)].filter(Boolean).join(".");
      const { result, id } = await send((id) =>
        api.bin.edit(id, { kind: "setPointer", entry: holder.entry, path, className }),
      );
      mark(`${holder.entry}:${path}`, result.ok ? null : result.error);
      if (!result.ok) {
        noteRefused(key);
        return false;
      }

      landed(id);
      return true;
    },
    [key, landed, mark, send],
  );

  return { commit, refused, mark, landed, send, editProperty, removeItem, setPointer };
}
