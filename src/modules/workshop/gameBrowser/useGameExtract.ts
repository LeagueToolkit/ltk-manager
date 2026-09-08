import { useMutation, useQuery } from "@tanstack/react-query";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import {
  api,
  type AppError,
  type ExtractOptions,
  type ExtractProgress,
  type ExtractSummary,
  type ExtractTarget,
} from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

import { gameQueries } from "./queries";

/**
 * What extracting `targets` would write, for the dialog's summary line.
 *
 * A whole archive is counted by reading its chunk table, so this is a request
 * rather than something the tree already knows. Disabled while there is nothing
 * aimed at.
 */
export function usePlanGameExtract(targets: readonly ExtractTarget[] | null) {
  return useQuery(gameQueries.extractPlan(targets));
}

interface ExtractArgs {
  targets: readonly ExtractTarget[];
  options: ExtractOptions;
}

/**
 * Write every chunk the targets name into the chosen folder.
 *
 * Resolves to `null` when an extract was already running, which is what a
 * double-clicked Extract button looks like.
 */
export function useExtractGameFiles() {
  return useMutation<ExtractSummary | null, AppError, ExtractArgs>({
    mutationFn: mutationFn(({ targets, options }: ExtractArgs) =>
      api.extractGameFiles([...targets], options),
    ),
  });
}

/** Call off the extract in flight. Resolves to `false` when there was none. */
export function useCancelExtract() {
  return useMutation<boolean, AppError, void>({
    mutationFn: mutationFn(api.cancelExtract),
  });
}

/**
 * The running extract's last reported chunk, or `null` between runs.
 *
 * The backend throttles these to about ten a second, so this drives a bar
 * without a render per chunk. `reset` clears it, because the run's end is a
 * mutation resolving rather than a terminal event.
 */
export function useExtractProgress(): {
  progress: ExtractProgress | null;
  reset: () => void;
} {
  const [progress, setProgress] = useState<ExtractProgress | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let mounted = true;

    listen<ExtractProgress>("extract-progress", (event) => {
      if (mounted) setProgress(event.payload);
    }).then((fn) => {
      if (!mounted) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      mounted = false;
      if (unlisten) unlisten();
    };
  }, []);

  return { progress, reset: () => setProgress(null) };
}
