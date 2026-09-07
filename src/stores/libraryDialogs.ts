import { create } from "zustand";

import type { InstalledMod } from "@/lib/tauri";

interface LibraryDialogsStore {
  /** The mods a confirmed uninstall would remove, frozen at the moment it was asked for. */
  bulkUninstallMods: InstalledMod[];
  openBulkUninstallDialog: (mods: InstalledMod[]) => void;
  closeBulkUninstallDialog: () => void;
}

/**
 * The library dialogs raised from more than one place.
 *
 * A bulk uninstall is asked for from the floating bar and from a selected card's
 * right click, and the confirmation outlives whichever popup asked - a menu
 * unmounts as it closes, and would take its own dialog with it.
 */
export const useLibraryDialogsStore = create<LibraryDialogsStore>()((set) => ({
  bulkUninstallMods: [],
  openBulkUninstallDialog: (mods) => set({ bulkUninstallMods: mods }),
  closeBulkUninstallDialog: () => set({ bulkUninstallMods: [] }),
}));
