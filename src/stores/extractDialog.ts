import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ExistingFiles, ExtractLayout, ExtractTarget } from "@/lib/tauri";

interface ExtractDialogStore {
  /**
   * What the open dialog will extract. `null` while it is shut.
   *
   * The targets rather than the rows: the tree that opened the dialog can
   * unmount under it - a preview splits a group beside it - and the dialog
   * still knows what it was aimed at.
   */
  targets: readonly ExtractTarget[] | null;
  /** What the summary line calls the targets, e.g. `Aatrox.wad.client`. */
  subject: string;

  /* Remembered field by field, so the second extract is two clicks. */
  destination: string;
  layout: ExtractLayout;
  perArchiveFolder: boolean;
  existing: ExistingFiles;
  recoverNames: boolean;
  openWhenDone: boolean;

  open: (targets: readonly ExtractTarget[], subject: string) => void;
  close: () => void;
  setDestination: (destination: string) => void;
  setLayout: (layout: ExtractLayout) => void;
  setPerArchiveFolder: (perArchiveFolder: boolean) => void;
  setExisting: (existing: ExistingFiles) => void;
  setRecoverNames: (recoverNames: boolean) => void;
  setOpenWhenDone: (openWhenDone: boolean) => void;
}

export const useExtractDialogStore = create<ExtractDialogStore>()(
  persist(
    (set) => ({
      targets: null,
      subject: "",
      destination: "",
      layout: "paths",
      perArchiveFolder: false,
      existing: "skip",
      recoverNames: false,
      openWhenDone: true,

      open: (targets, subject) => set({ targets, subject }),
      close: () => set({ targets: null, subject: "" }),
      setDestination: (destination) => set({ destination }),
      setLayout: (layout) => set({ layout }),
      setPerArchiveFolder: (perArchiveFolder) => set({ perArchiveFolder }),
      setExisting: (existing) => set({ existing }),
      setRecoverNames: (recoverNames) => set({ recoverNames }),
      setOpenWhenDone: (openWhenDone) => set({ openWhenDone }),
    }),
    {
      name: "extract-dialog",
      /* The fields, not what is aimed at: a dialog that reopened itself on
         launch would be aimed at rows from another session. */
      partialize: (state) => ({
        destination: state.destination,
        layout: state.layout,
        perArchiveFolder: state.perArchiveFolder,
        existing: state.existing,
        recoverNames: state.recoverNames,
        openWhenDone: state.openWhenDone,
      }),
    },
  ),
);

export const useExtractTargets = () => useExtractDialogStore((s) => s.targets);
export const useOpenExtractDialog = () => useExtractDialogStore((s) => s.open);
export const useCloseExtractDialog = () => useExtractDialogStore((s) => s.close);
