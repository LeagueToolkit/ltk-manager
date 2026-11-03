import { useCallback } from "react";

import { useToast } from "@/components/Toast";
import { m } from "@/i18n";
import type { ReorderOutcome } from "@/lib/tauri";

import { useSetKeptSort } from "./useSetKeptSort";

/**
 * Reports the kept sorts a reorder by hand cleared, one toast each, with an Undo that sets
 * the sort back and re-sorts the folder by it.
 */
export function useClearedKeptSortToast() {
  const toast = useToast();
  const setKeptSort = useSetKeptSort();

  return useCallback(
    (outcome: ReorderOutcome) => {
      for (const cleared of outcome.clearedKeptSorts) {
        const folder =
          cleared.folderId === "root" ? m.library_kept_sort_root_label() : cleared.folderName;

        toast.toast({
          type: "info",
          title: m.library_kept_sort_cleared_title(),
          description: m.library_kept_sort_cleared_description({ folder }),
          action: {
            label: m.library_kept_sort_restore_action(),
            onClick: () =>
              setKeptSort.mutate({ folderIds: [cleared.folderId], keptSort: cleared.keptSort }),
          },
        });
      }
    },
    [toast, setKeptSort],
  );
}
