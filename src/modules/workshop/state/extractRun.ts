import { create } from "zustand";

import type { ExtractOptions, ExtractTarget } from "@/lib/tauri";

/** One extract, as everything needed to run it and to report it afterwards. */
export interface ExtractRequest {
  targets: readonly ExtractTarget[];
  /** What the toast calls what is being written, e.g. `Aatrox.wad.client`. */
  subject: string;
  options: ExtractOptions;
  /** Open the destination once it is written. */
  reveal: boolean;
  /**
   * The layer this lands in, which the report names. Absent is an extract to a
   * folder the user picked rather than a copy into the open project.
   */
  intoLayer?: string;
  /** The project whose content tree the write changed, and so must be refetched. */
  projectPath?: string;
}

interface ExtractRunStore {
  /**
   * The run asked for and not yet started, which `ExtractRunner` picks up.
   *
   * A slot rather than a call, because every gesture that starts an extract -
   * a menu item, a key, the dialog's button - is in a tree that unmounts the
   * moment it fires, and the run outlives all of them.
   */
  pending: ExtractRequest | null;
  /** An extract is in flight, so nothing may start a second one. */
  running: boolean;

  start: (request: ExtractRequest) => void;
  clearPending: () => void;
  setRunning: (running: boolean) => void;
}

export const useExtractRunStore = create<ExtractRunStore>()((set) => ({
  pending: null,
  running: false,

  start: (request) => set({ pending: request }),
  clearPending: () => set({ pending: null }),
  setRunning: (running) => set({ running }),
}));

export const useStartExtract = () => useExtractRunStore((s) => s.start);
export const useExtractRunning = () => useExtractRunStore((s) => s.running);
