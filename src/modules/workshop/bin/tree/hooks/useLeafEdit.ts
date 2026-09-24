import { createContext, useCallback, useRef, useState } from "react";

import {
  api,
  type AppError,
  type AssetRef,
  type BinDocumentId,
  type BinRow,
  type ValueEdit,
} from "@/lib/tauri";
import type { Result } from "@/utils/result";

import { assetKey } from "../../../preview/utils/assetRef";
import { noteRefused, queueForSave } from "../../../state";
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

/** Reopen a document the store evicted, answering the fresh id or null where it failed. */
export type Reopen = () => Promise<BinDocumentId | null> | void;

/**
 * Validated document mutations shared by the tree and class inspectors.
 *
 * An edit the store refuses as not open reopens the document through `reopen` and is sent
 * once more on the fresh id, since the store evicts an idle clean tree (ADR-0026).
 */
export function useLeafEdit(
  document: BinDocumentId,
  asset: AssetRef,
  invalidate: () => void,
  reopen?: Reopen,
) {
  const [refused, setRefused] = useState<ReadonlyMap<string, AppError>>(new Map());
  const key = assetKey(asset);
  const current = useRef(document);
  current.current = document;

  const send = useCallback(
    async <T>(
      call: (id: BinDocumentId) => Promise<Result<T>>,
    ): Promise<{ result: Result<T>; id: BinDocumentId }> => {
      const first = await call(current.current);
      if (first.ok || first.error.code !== "BIN_NOT_OPEN" || reopen === undefined) {
        return { result: first, id: current.current };
      }

      const fresh = await reopen();
      if (fresh == null) return { result: first, id: current.current };
      current.current = fresh;
      return { result: await call(fresh), id: fresh };
    },
    [reopen],
  );

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
    (id: BinDocumentId = current.current) => {
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

      const { result, id } = await send((id) => api.bin.patch(id, row.entry, row.path, typed.leaf));
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
        api.bin.editProperty(id, holder.entry, holder.path, field, edits),
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
      const { result, id } = await send((id) => api.bin.removeItem(id, row.entry, row.path));
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
        api.bin.setPointer(id, holder.entry, path, className),
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

  return { commit, refused, mark, landed, editProperty, removeItem, setPointer };
}
