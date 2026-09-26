import { useEffect, useRef } from "react";

import type { Reshape } from "@/lib/tauri";

import { reshapeRemap } from "../utils/binRows";

type Remap = (key: string) => string | null;

/** The trees drawn over each asset, by `assetKey`, each taking the remap of an undo. */
const listeners = new Map<string, Set<(remap: Remap) => void>>();

/** Carry the expanded rows of every tree over `asset` through the rows `reshape` moved. */
export function announceReshape(asset: string, reshape: Reshape) {
  const remap = reshapeRemap(reshape);
  if (remap === null) return;

  for (const listener of listeners.get(asset) ?? []) listener(remap);
}

/** Take the remap of each undo and redo over `asset` while mounted. `remap` is read at call time. */
export function useReshapes(asset: string, remap: (remap: Remap) => void) {
  const current = useRef(remap);
  useEffect(() => {
    current.current = remap;
  });

  useEffect(() => {
    const listener = (each: Remap) => current.current(each);
    const held = listeners.get(asset) ?? new Set();
    held.add(listener);
    listeners.set(asset, held);

    return () => {
      held.delete(listener);
      if (held.size === 0) listeners.delete(asset);
    };
  }, [asset]);
}
