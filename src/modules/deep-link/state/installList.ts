import { create } from "zustand";

import type {
  AppError,
  DeepLinkInstallListRequest,
  InstallListReport,
  InstallListStage,
} from "@/lib/tauri";

/** Where the install of a list has got to, as a whole. */
export type InstallListPhase = "idle" | "running" | "done";

interface InstallListStore {
  /** The link that arrived, or `null` while no list is asked for. */
  request: DeepLinkInstallListRequest | null;
  phase: InstallListPhase;
  /** Each item's latest stage, by its id on the site, as the run reports them. */
  stages: Record<string, InstallListStage>;
  /** What the last run did, which the dialog draws once the run ends. */
  report: InstallListReport | null;
  /** The failure of the last run as a whole, before its first item. */
  error: AppError | null;
  setRequest: (request: DeepLinkInstallListRequest) => void;
  startRun: () => void;
  setStage: (itemId: string, stage: InstallListStage) => void;
  finishRun: (report: InstallListReport) => void;
  failRun: (error: AppError) => void;
  reset: () => void;
}

const EMPTY = {
  request: null,
  phase: "idle" as const,
  stages: {},
  report: null,
  error: null,
};

export const useInstallListStore = create<InstallListStore>()((set) => ({
  ...EMPTY,
  setRequest: (request) => set({ ...EMPTY, request }),
  /* The stages of an earlier run are cleared, so a retry draws only what it runs. */
  startRun: () => set({ phase: "running", stages: {}, report: null, error: null }),
  setStage: (itemId, stage) => set((state) => ({ stages: { ...state.stages, [itemId]: stage } })),
  finishRun: (report) => set({ phase: "done", report }),
  failRun: (error) => set({ phase: "done", error }),
  reset: () => set(EMPTY),
}));
