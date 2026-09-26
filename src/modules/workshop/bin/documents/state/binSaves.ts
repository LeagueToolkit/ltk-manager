import { useMemo } from "react";
import { create } from "zustand";

import { type AppError, api, type BinDocumentId } from "@/lib/tauri";
import type { TextSaveState } from "@/modules/editor";

/* The strings editor's rhythm, "Save" in docs/ux/BIN_EDITOR.md. */
const SAVE_DELAY_MS = 600;

/** What one held bin's autosave is doing, shared by every tab over the asset. */
export interface BinSave {
  readonly state: TextSaveState;
  /** Why the last save failed, null for any other state. */
  readonly error: AppError | null;
}

const CLEAN: BinSave = { state: "clean", error: null };

const BLOCKED: BinSave = { state: "blocked", error: null };

const NO_FIELDS: readonly string[] = [];

interface BinSavesStore {
  /** Every asset with an edit since it opened, by `assetKey`. */
  saves: Record<string, BinSave>;
  /** The fields of each asset whose last value was refused, one entry per drawn mark. */
  refused: Record<string, readonly string[]>;
}

const useBinSavesStore = create<BinSavesStore>()(() => ({ saves: {}, refused: {} }));

function put(asset: string, save: BinSave) {
  useBinSavesStore.setState((store) => ({ saves: { ...store.saves, [asset]: save } }));
}

function saveOf(asset: string): BinSave {
  return useBinSavesStore.getState().saves[asset] ?? CLEAN;
}

/** The save queued for each asset: the id it goes through, and the wait before it. Neither is drawn. */
const saveQueue = new Map<
  string,
  { document: BinDocumentId; timer: ReturnType<typeof setTimeout> | null }
>();

/**
 * The autosave of the asset `asset` keys, clean where nothing was edited.
 *
 * A refused field reads `blocked` until it is fixed or dropped, over every state but `failed`,
 * which is the one a reader acts on first.
 */
export function useBinSave(asset: string): BinSave {
  const save = useBinSavesStore((store) => store.saves[asset] ?? CLEAN);
  const blocked = useBinSavesStore((store) => (store.refused[asset]?.length ?? 0) > 0);

  return useMemo(() => (blocked && save.state !== "failed" ? BLOCKED : save), [blocked, save]);
}

/** Call `listener` with the key of each asset a save has written. */
export function onBinSaved(listener: (asset: string) => void): () => void {
  return useBinSavesStore.subscribe((store, previous) => {
    for (const [asset, save] of Object.entries(store.saves)) {
      if (save === CLEAN && previous.saves[asset]?.state === "saving") listener(asset);
    }
  });
}

/** Queue a save of `asset` through `document` after a patch landed, restarting the wait. */
export function queueForSave(asset: string, document: BinDocumentId) {
  const held = saveQueue.get(asset);
  if (held?.timer) clearTimeout(held.timer);

  saveQueue.set(asset, {
    document,
    timer: setTimeout(() => void flushBinSave(asset), SAVE_DELAY_MS),
  });

  put(asset, { state: "pending", error: null });
}

/**
 * Mark the field `field` of `asset` refused, or clear its mark.
 *
 * `field` names one drawn mark, so two tabs over one asset clear only their own.
 */
export function markRefused(asset: string, field: string, refused: boolean) {
  useBinSavesStore.setState((store) => {
    const held = store.refused[asset] ?? NO_FIELDS;
    if (held.includes(field) === refused) return store;

    const next = refused ? [...held, field] : held.filter((each) => each !== field);
    return { refused: { ...store.refused, [asset]: next } };
  });
}

/** Clear every mark of `asset` whose field starts with `owner`, for a tab that closed. */
export function clearRefusedBy(asset: string, owner: string) {
  useBinSavesStore.setState((store) => {
    const held = store.refused[asset];
    if (held === undefined || !held.some((field) => field.startsWith(owner))) return store;

    const next = held.filter((field) => !field.startsWith(owner));
    return { refused: { ...store.refused, [asset]: next } };
  });
}

/** Write the save queued for `asset` now, resolving once the write settles. */
export async function flushBinSave(asset: string): Promise<void> {
  const held = saveQueue.get(asset);
  if (held === undefined) return;

  if (held.timer) clearTimeout(held.timer);
  saveQueue.delete(asset);

  put(asset, { state: "saving", error: null });

  const result = await api.bin.save(held.document);
  /* A patch that landed during the write queued a save of its own, and its state stands. */
  if (saveQueue.has(asset)) return;

  put(asset, result.ok ? CLEAN : { state: "failed", error: result.error });
}

/**
 * Write what `asset` owes its file now through `document`: a queued save, or a failed one again.
 *
 * # Errors
 *
 * Rejects with the error a failed write answers, for a caller that reports it.
 */
export async function saveBinNow(asset: string, document: BinDocumentId): Promise<void> {
  const held = saveQueue.get(asset);
  if (held === undefined && saveOf(asset).state !== "failed") return;

  if (held?.timer) clearTimeout(held.timer);
  saveQueue.set(asset, { document, timer: null });
  await flushBinSave(asset);

  const save = saveOf(asset);
  if (save.state === "failed" && save.error !== null) throw save.error;
}

/** Whether the save queued for `asset` goes through `document`, which closing it would strand. */
export function isQueuedThrough(asset: string, document: BinDocumentId): boolean {
  return saveQueue.get(asset)?.document === document;
}

/** Drop everything held for `asset`, whose edits a reload threw away. */
export function forgetBinSave(asset: string) {
  const held = saveQueue.get(asset);
  if (held?.timer) clearTimeout(held.timer);

  saveQueue.delete(asset);
  useBinSavesStore.setState((store) => {
    if (!(asset in store.saves) && !(asset in store.refused)) return store;

    const saves = { ...store.saves };
    const refused = { ...store.refused };
    delete saves[asset];
    delete refused[asset];
    return { saves, refused };
  });
}
