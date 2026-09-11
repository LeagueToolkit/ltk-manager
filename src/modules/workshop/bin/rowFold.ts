import { createContext, use, useState } from "react";

import type { BinDocumentId, BinRow } from "@/lib/tauri";

/** Which struct and list rows a surface holds open, where it holds them by more than the row. */
export interface RowFold {
  readonly isOpen: (row: BinRow) => boolean;
  readonly toggle: (row: BinRow) => void;
}

export const RowFoldContext = createContext<RowFold | null>(null);

/** The document a field row reads a struct's own fields from. None leaves every row shut. */
export const RowDocumentContext = createContext<BinDocumentId | null>(null);

/** Whether `row` is open and how to fold it: the surface's own hold, else the row's. */
export function useRowFold(row: BinRow): [open: boolean, toggle: () => void] {
  const fold = use(RowFoldContext);
  const [own, setOwn] = useState(false);
  if (fold === null) return [own, () => setOwn((held) => !held)];
  return [fold.isOpen(row), () => fold.toggle(row)];
}
