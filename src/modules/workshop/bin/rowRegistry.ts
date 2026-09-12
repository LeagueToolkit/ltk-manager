import { createContext, use, useEffect } from "react";

import type { BinRow } from "@/lib/tauri";

import { rowKey } from "./binRows";

/** Where a surface leaves the rows it drew outside the view's own read, for the view's menu. */
export interface RowRegistry {
  /** Hold `rows` until the returned release is called. */
  readonly hold: (rows: readonly BinRow[]) => () => void;
}

export const RowRegistryContext = createContext<RowRegistry | null>(null);

/** Hold `rows` in the enclosing registry for as long as the caller is mounted. */
export function useHeldRows(rows: readonly BinRow[]): void {
  const registry = use(RowRegistryContext);
  useEffect(() => registry?.hold(rows), [registry, rows]);
}

/**
 * A registry, and the lookup the menu reads it through.
 *
 * Holders are counted per key, so two surfaces drawing one row and letting go apart leave
 * it findable until the last has.
 */
export function createRowRegistry(): {
  registry: RowRegistry;
  find: (key: string) => BinRow | undefined;
} {
  const held = new Map<string, { row: BinRow; holders: number }>();
  return {
    registry: {
      hold(rows) {
        const keys = rows.map((row) => {
          const key = rowKey(row);
          const entry = held.get(key);
          if (entry === undefined) held.set(key, { row, holders: 1 });
          else entry.holders += 1;
          return key;
        });
        return () => {
          for (const key of keys) {
            const entry = held.get(key);
            if (entry === undefined) continue;
            entry.holders -= 1;
            if (entry.holders === 0) held.delete(key);
          }
        };
      },
    },
    find: (key) => held.get(key)?.row,
  };
}
