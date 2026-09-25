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

interface BinSavesStore {
  /** Every asset with an edit since it opened, by `assetKey`. */
  saves: Record<string, BinSave>;
}

const useBinSavesStore = create<BinSavesStore>()(() => ({ saves: {} }));

function put(asset: string, save: BinSave) {
  useBinSavesStore.setState((store) => ({ saves: { ...store.saves, [asset]: save } }));
}

/** The save queued for each asset: the id it goes through, and the wait before it. Neither is drawn. */
const saveQueue = new Map<
  string,
  { document: BinDocumentId; timer: ReturnType<typeof setTimeout> }
>();

/** The id each asset last saved through, which a retry takes. */
const through = new Map<string, BinDocumentId>();

/** The autosave of the asset `asset` keys, clean where nothing was edited. */
export function useBinSave(asset: string): BinSave {
  return useBinSavesStore((store) => store.saves[asset] ?? CLEAN);
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
  if (held !== undefined) clearTimeout(held.timer);

  through.set(asset, document);
  saveQueue.set(asset, {
    document,
    timer: setTimeout(() => void flushBinSave(asset), SAVE_DELAY_MS),
  });

  put(asset, { state: "pending", error: null });
}

/** Record a patch the backend refused. The save reads `blocked` until a patch lands. */
export function noteRefused(asset: string) {
  if (saveQueue.has(asset)) return;

  put(asset, { state: "blocked", error: null });
}

/** Write the save queued for `asset` now, resolving once the write settles. */
export async function flushBinSave(asset: string): Promise<void> {
  const held = saveQueue.get(asset);
  if (held === undefined) return;

  clearTimeout(held.timer);
  saveQueue.delete(asset);

  put(asset, { state: "saving", error: null });

  const result = await api.bin.save(held.document);
  /* A patch that landed during the write queued a save of its own, and its state stands. */
  if (saveQueue.has(asset)) return;

  put(asset, result.ok ? CLEAN : { state: "failed", error: result.error });
}

/** Save `asset` again through the id it last saved through. */
export function retryBinSave(asset: string) {
  const document = through.get(asset);
  if (document !== undefined) queueForSave(asset, document);
}

/** Whether the save queued for `asset` goes through `document`, which closing it would strand. */
export function isQueuedThrough(asset: string, document: BinDocumentId): boolean {
  return saveQueue.get(asset)?.document === document;
}

/** Drop everything held for `asset`, whose edits a reload threw away. */
export function forgetBinSave(asset: string) {
  const held = saveQueue.get(asset);
  if (held !== undefined) clearTimeout(held.timer);

  saveQueue.delete(asset);
  through.delete(asset);
  useBinSavesStore.setState((store) => {
    if (!(asset in store.saves)) return store;
    const saves = { ...store.saves };
    delete saves[asset];
    return { saves };
  });
}
