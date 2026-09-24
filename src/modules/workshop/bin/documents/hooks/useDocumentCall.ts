import { useCallback, useRef } from "react";

import type { BinDocumentId } from "@/lib/tauri";
import type { Result } from "@/utils/result";

/** Reopen a document the store evicted, answering the fresh id or null where it failed. */
export type Reopen = () => Promise<BinDocumentId | null> | void;

/** What a call answered, and the id it was answered on, fresh where the document reopened. */
export interface Sent<T> {
  readonly result: Result<T>;
  readonly id: BinDocumentId;
}

/** One backend call on an open document, given the id to send it on. */
export type DocumentCall = <T>(call: (id: BinDocumentId) => Promise<Result<T>>) => Promise<Sent<T>>;

/** How each open id reopens, registered by the `useBinDocument` that holds it. Ids are never reused. */
const reopens = new Map<BinDocumentId, Reopen>();

/** Register how `document` reopens, answering the unregister. */
export function registerReopen(document: BinDocumentId, reopen: Reopen): () => void {
  reopens.set(document, reopen);
  return () => {
    if (reopens.get(document) === reopen) reopens.delete(document);
  };
}

/**
 * Send `call` on `document`, and once more on a fresh id where the store answers it as not
 * open. The store evicts the least recently used clean tree (ADR-0026).
 *
 * `reopen` defaults to the one registered for `document`. The answer's id is the one to
 * queue a save on.
 */
export async function sendOn<T>(
  document: BinDocumentId,
  call: (id: BinDocumentId) => Promise<Result<T>>,
  reopen: Reopen | undefined = reopens.get(document),
): Promise<Sent<T>> {
  const first = await call(document);
  if (first.ok || first.error.code !== "BIN_NOT_OPEN" || reopen === undefined) {
    return { result: first, id: document };
  }

  const fresh = (await reopen()) ?? null;
  if (fresh === null) return { result: first, id: document };

  return { result: await call(fresh), id: fresh };
}

/**
 * Calls on the open document `document` through `sendOn`, each on the latest id.
 *
 * A call made after a reopen and before the caller draws the fresh id goes on the fresh one.
 * `reopen` overrides the registered one.
 */
export function useDocumentCall(document: BinDocumentId | null, reopen?: Reopen): DocumentCall {
  const current = useRef(document);
  current.current = document;
  const override = useRef(reopen);
  override.current = reopen;

  return useCallback(async <T>(call: (id: BinDocumentId) => Promise<Result<T>>) => {
    const id = current.current;
    if (id === null) return { result: NOT_OPEN, id: NO_DOCUMENT };

    const sent = await sendOn(id, call, override.current ?? reopens.get(id));
    current.current = sent.id;
    return sent;
  }, []);
}

/** The answer a call on no document gets, which no id was sent. */
const NOT_OPEN = { ok: false, error: { code: "BIN_NOT_OPEN" } } as const;

/** The id a call on no document reports, which names no open. */
const NO_DOCUMENT = -1 as BinDocumentId;
