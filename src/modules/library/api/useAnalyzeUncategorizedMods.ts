import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components";
import { errorSummary } from "@/i18n";
import { api, type AppError, type InstalledMod, type ModWadReport } from "@/lib/tauri";
import { isOk } from "@/utils/result";

import { libraryKeys } from "./keys";

interface AnalyzeFailure {
  name: string;
  message: string;
}

interface AnalyzeBackfillResult {
  analyzed: number;
  failures: AnalyzeFailure[];
}

/**
 * Build a compact toast description, grouping failed mods by their shared
 * reason so a uniform failure (e.g. an unconfigured League path) reads as one
 * line listing the affected mods rather than repeating the message per mod.
 */
function describeFailures(failures: AnalyzeFailure[]): string {
  const byMessage = new Map<string, string[]>();
  for (const { name, message } of failures) {
    const names = byMessage.get(message) ?? [];
    names.push(name);
    byMessage.set(message, names);
  }

  return Array.from(byMessage, ([message, names]) => {
    const shown = names.slice(0, 3).join(", ");
    const extra = names.length > 3 ? ` +${names.length - 3} more` : "";
    return `${shown}${extra}: ${message}`;
  }).join(" · ");
}

/**
 * Backfill WAD-footprint reports for mods that don't have one yet — e.g.
 * installed before auto-categorization existed, or while no League path was
 * configured. New installs already analyze themselves in the background, so
 * this is a one-shot catch-up for an existing library.
 *
 * Runs sequentially (the analyzer reuses the warmed game index, so concurrent
 * runs would only thrash disk), patching the shared report cache as each mod
 * completes. Each mod is isolated: a backend error OR an unexpected promise
 * rejection is recorded as a failure and never aborts the rest of the batch.
 */
export function useAnalyzeUncategorizedMods() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation<AnalyzeBackfillResult, AppError, InstalledMod[]>({
    meta: { silentError: true },
    mutationFn: async (mods) => {
      let analyzed = 0;
      const failures: AnalyzeFailure[] = [];

      for (const mod of mods) {
        try {
          const result = await api.analyzeModWads(mod.id);
          if (isOk(result)) {
            analyzed++;
            const report = result.value;
            queryClient.setQueryData<Record<string, ModWadReport>>(
              libraryKeys.wadReports(),
              (old) => ({ ...(old ?? {}), [report.modId]: report }),
            );
          } else {
            failures.push({ name: mod.displayName, message: errorSummary(result.error) });
          }
        } catch (err) {
          failures.push({
            name: mod.displayName,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { analyzed, failures };
    },
    onSuccess: ({ analyzed, failures }) => {
      if (failures.length === 0) {
        toast.success(`Categorized ${analyzed} mod${analyzed === 1 ? "" : "s"}`);
        return;
      }
      if (analyzed === 0) {
        toast.error(
          `Couldn't categorize ${failures.length} mod${failures.length === 1 ? "" : "s"}`,
          describeFailures(failures),
        );
        return;
      }
      toast.warning(
        `Categorized ${analyzed}, ${failures.length} failed`,
        describeFailures(failures),
      );
    },
    onError: (error) => {
      toast.error("Failed to analyze mods", errorSummary(error));
    },
  });
}
