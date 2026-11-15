import { useCallback, useRef } from "react";

import { useToast } from "@/components/Toast";
import { m } from "@/i18n";
import { usePendingRebuildStore } from "@/stores";

import { usePatcherStatus } from "./usePatcherStatus";
import { useRebuildOverlay } from "./useRebuildOverlay";

/**
 * The rebuild a verdict's hint asks for, as one action for the incident toast
 * and the verdict line.
 *
 * Per "The verdict line" in docs/ux/LEAGUE_DIAGNOSTICS.md: at once with the
 * patcher stopped, queued for the next start with it running, never on its own.
 */
export function useRebuildOverlayAction() {
  const { data: status } = usePatcherStatus();
  const rebuild = useRebuildOverlay();
  const queue = usePendingRebuildStore((s) => s.queue);
  const toast = useToast();

  const running = status?.running ?? false;
  /* A toast outlives the render that raised it, so the click reads the state
     of its own moment. */
  const runningRef = useRef(running);
  runningRef.current = running;

  const { mutate } = rebuild;
  const run = useCallback(() => {
    if (runningRef.current) {
      queue();
      toast.info(m.patcher_rebuild_queued_title(), m.patcher_rebuild_queued_description());
      return;
    }
    mutate(undefined, {
      onSuccess: () =>
        toast.success(m.patcher_rebuild_done_title(), m.patcher_rebuild_done_description()),
      onError: (error) => toast.failure(m.patcher_rebuild_failed_title(), error),
    });
  }, [queue, mutate, toast]);

  return {
    label: running ? m.patcher_rebuild_queue_action() : m.patcher_rebuild_action(),
    run,
    pending: rebuild.isPending,
  };
}
