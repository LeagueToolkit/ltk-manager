import { create } from "zustand";

import type { InjectionStage } from "@/lib/tauri";

/** Where a patcher start stopped. The two host stages, or the overlay build before them. */
export type PatcherFailureStage = InjectionStage | "BUILD";

export interface PatcherFailure {
  stage: PatcherFailureStage;
  /** The backend's own message, shown under the title. */
  message: string;
}

interface PatcherFailureStore {
  /** The start that failed last, for the session bar's failed-start line. */
  failure: PatcherFailure | null;
  set: (failure: PatcherFailure) => void;
  clear: () => void;
}

/**
 * The failed-start line's state, from `patcher-error` until the next build
 * starts or the user closes it. Kept apart from the incident line because a
 * failure arrives before its incident does, and may arrive without one.
 */
export const usePatcherFailureStore = create<PatcherFailureStore>((update) => ({
  failure: null,
  set: (failure) => update({ failure }),
  clear: () => update({ failure: null }),
}));
