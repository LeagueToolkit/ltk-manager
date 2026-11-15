import { useQueryClient } from "@tanstack/react-query";
import { use, useCallback } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import type { BinDocumentId } from "@/lib/tauri";

import { sendEach } from "../../skin/hooks/useDynamicsEdit";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { vfxQueries } from "../hooks/useVfxSystem";
import { adjustEdits, type SystemAdjust } from "./adjustModel";

/**
 * Returns the write of an adjustment to the system `entry`, which answers whether it landed, and
 * null if the view does not edit.
 *
 * The write resolves after the system is read again, so the preview drops its own adjustment
 * when the written values are drawn. A refusal is shown in a toast.
 */
export function useAdjustApply(
  document: BinDocumentId | null,
  entry: string,
): ((adjust: SystemAdjust) => Promise<boolean>) | null {
  const edit = use(LeafEditContext);
  const send = edit?.send;
  const landed = edit?.landed;
  const queryClient = useQueryClient();
  const toast = useToast();

  const apply = useCallback(
    async (adjust: SystemAdjust) => {
      if (document === null || send === undefined || landed === undefined) return false;

      const query = vfxQueries.system(document, entry);
      const system = queryClient.getQueryData(query.queryKey);
      if (system === undefined) return false;

      const refused = await sendEach({ send, landed }, adjustEdits(system, adjust));
      if (refused !== null) {
        toast.failure(m.workshop_bin_edit_refused_title(), refused);
        return false;
      }

      await queryClient.refetchQueries(
        { queryKey: query.queryKey, exact: true },
        { cancelRefetch: false },
      );
      return true;
    },
    [document, entry, send, landed, queryClient, toast],
  );

  if (document === null || send === undefined || landed === undefined) return null;
  return apply;
}
