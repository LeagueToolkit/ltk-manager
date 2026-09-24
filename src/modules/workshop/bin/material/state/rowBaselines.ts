import { create } from "zustand";

import type { BinDocumentId } from "@/lib/tauri";

import type { RowSnapshot } from "../utils/rowSnapshot";

interface RowBaselineStore {
  /** Each material row's entry before its first edit, by `baselineKey`. */
  baselines: ReadonlyMap<string, RowSnapshot>;
  /** Keep `snapshot` as the row's baseline, and nothing where the row already has one. */
  record: (key: string, snapshot: RowSnapshot) => void;
}

/**
 * The state each material row held before the session first edited it, which the row's
 * go-back returns to.
 *
 * Kept outside the table, so a pane that remounts after an edit does not take the edited
 * value as the baseline.
 */
export const useRowBaselineStore = create<RowBaselineStore>()((set) => ({
  baselines: new Map(),
  record: (key, snapshot) =>
    set((state) => {
      if (state.baselines.has(key)) return state;
      return { baselines: new Map(state.baselines).set(key, snapshot) };
    }),
}));

/** The key a row's baseline is kept under: its document, material, list and name. */
export function baselineKey(document: BinDocumentId, material: string, list: string, name: string) {
  return `${document}|${material}|${list}|${name}`;
}

export const useRowBaseline = (key: string) =>
  useRowBaselineStore((state) => state.baselines.get(key));
