import { create } from "zustand";

import type { AssetRef, BinDocumentId } from "@/lib/tauri";

import { assetKey, assetProject } from "../../../../preview/utils/assetRef";
import type { RigChoice } from "../../engine/model/rig";

/** The in and the out a run loops between, in seconds of the run's own phase. */
export interface LoopRange {
  readonly from: number;
  readonly to: number;
}

/**
 * What a particle run keeps for the session once its tab is gone (ADR-0037).
 *
 * The mute and the solo sets travel as lists, so a memory is a plain value a devtool
 * prints. Nothing here reaches disk.
 */
export interface VfxRunMemory {
  readonly seed: number;
  readonly rig: RigChoice;
  readonly speed: number;
  readonly muted: readonly number[];
  readonly soloed: readonly number[];
  readonly loop: LoopRange | null;
  /** The chance every birth reads its tables at, null for a run left to its draws. */
  readonly pinned: number | null;
  /** Seconds into the run the tab left it at, which a tab that reopens it seeks to. */
  readonly playhead: number;
}

interface VfxRunMemoryStore {
  /** Every run kept, by the key `vfxRunKey` builds. */
  runs: Record<string, VfxRunMemory>;
  remember: (key: string, memory: VfxRunMemory) => void;
  forget: (key: string) => void;
}

/**
 * The key one system's run is kept under: the file it was read from and its entry.
 *
 * The backend issues a fresh document id per open, so a file is what a reopened tab
 * finds its run by. A bare id keys a run with no file behind it, which lasts one open.
 */
export function vfxRunKey(source: AssetRef | BinDocumentId, entry: string): string {
  if (typeof source === "number") return `open:${source}:${entry}`;

  return `${assetProject(source, null) ?? ""}:${assetKey(source)}:${entry}`;
}

export const useVfxRunMemoryStore = create<VfxRunMemoryStore>()((set) => ({
  runs: {},
  remember: (key, memory) => set((state) => ({ runs: { ...state.runs, [key]: memory } })),
  forget: (key) =>
    set((state) => {
      if (!(key in state.runs)) return state;
      const runs = { ...state.runs };
      delete runs[key];
      return { runs };
    }),
}));

/** The memory kept for `key`, read once rather than subscribed to. */
export function rememberedVfxRun(key: string): VfxRunMemory | undefined {
  return useVfxRunMemoryStore.getState().runs[key];
}
