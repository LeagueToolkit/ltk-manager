import { useQueryClient } from "@tanstack/react-query";

import { useTauriEvent } from "@/lib/useTauriEvent";

import { patcherKeys } from "./keys";

/** Refresh the patcher status when the backend announces a phase. Mount once. */
export function usePatcherStatusListener(): void {
  const queryClient = useQueryClient();

  useTauriEvent("patcher-status-changed", () => {
    void queryClient.invalidateQueries({ queryKey: patcherKeys.status() });
  });
}
