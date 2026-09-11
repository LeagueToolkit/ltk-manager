import { create } from "zustand";

import type { BinDocumentId } from "@/lib/tauri";

import type { RigChoice } from "../bin/vfx/rig";

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
  /** Seconds into the run the tab left it at, which a tab that reopens it seeks to. */
  readonly playhead: number;
}

interface VfxRunMemoryStore {
  /** Every run kept, by the key `vfxRunKey` builds. */
  runs: Record<string, VfxRunMemory>;
  remember: (key: string, memory: VfxRunMemory) => void;
  forget: (key: string) => void;
}

/** The key one system's run is kept under: its document and its entry. */
export function vfxRunKey(document: BinDocumentId, entry: string): string {
  return `${document}:${entry}`;
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
