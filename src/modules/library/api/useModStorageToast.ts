import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { type ToastTask, useToast } from "@/components";
import {
  type InstalledMod,
  type ModStorage,
  type ModStorageProgress,
  revealPath,
} from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";

import { libraryKeys } from "./keys";

/** What the toast calls each direction while it runs, and once it is done. */
const CONVERSION_COPY: Record<ModStorage, { running: string; done: string; result: string }> = {
  project: {
    running: "Unpacking",
    done: "Mod unpacked",
    result: "now reads from its own folder",
  },
  archive: {
    running: "Repacking",
    done: "Mod repacked",
    result: "now reads from its archive",
  },
};

/**
 * Turns the backend's conversion reports into one toast per mod.
 *
 * Mounted once rather than per card: a library of two hundred mods would
 * otherwise open two hundred listeners for an event at most one of them is
 * about. The card fires the mutation and this answers for it, which is also
 * what lets the toast outlive a card the user scrolled away from.
 */
export function useModStorageToast() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const tasks = useRef(new Map<string, ToastTask>());

  useTauriEvent<ModStorageProgress>("mod-storage-progress", (progress) => {
    const copy = CONVERSION_COPY[progress.storage];
    // The slug never moves during a conversion, so the mod as the cache still
    // holds it names the same directory the finished one does.
    const mod = queryClient
      .getQueryData<InstalledMod[]>(libraryKeys.mods())
      ?.find((m) => m.id === progress.modId);
    const name = mod?.displayName ?? "This mod";

    if (progress.stage === "complete" || progress.stage === "error") {
      tasks.current.get(progress.modId)?.close();
      tasks.current.delete(progress.modId);

      // A failure is announced by whoever asked for it, which is the only place
      // that holds the reason.
      if (progress.stage === "error") return;

      toast.toast({
        type: "success",
        title: copy.done,
        // Longer than a plain success, because this one is worth reaching for.
        timeout: 8000,
        description: `${name} ${copy.result}.`,
        action: mod && {
          label: "Open Location",
          onClick: () => {
            revealPath(mod.modDir);
          },
        },
      });
      return;
    }

    let task = tasks.current.get(progress.modId);
    if (!task) {
      task = toast.task(`${copy.running} ${name}`);
      tasks.current.set(progress.modId, task);
    }

    if (progress.stage === "extracting" && progress.total > 0) {
      task.report(
        (progress.current / progress.total) * 100,
        `${progress.current + 1} of ${progress.total} - ${progress.currentItem ?? ""}`,
      );
      return;
    }
    task.report(100, "Finishing up");
  });
}
