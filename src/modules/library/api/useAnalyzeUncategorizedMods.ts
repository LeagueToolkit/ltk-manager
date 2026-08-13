import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components";
import { api, type AppError, type InstalledMod, type ModWadReport } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

import { libraryKeys } from "./keys";

interface AnalyzeFailure {
  name: string;
  message: string;
}

interface AnalyzeBackfillResult {
  analyzed: number;
  artworkAvailable: number;
  artworkMissing: number;
  failures: AnalyzeFailure[];
}

interface AnalyzeBackfillRequest {
  uncategorized: InstalledMod[];
  artworkCandidates: InstalledMod[];
}

const ARTWORK_LOOKUP_CONCURRENCY = 3;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
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
 * Backfill missing WAD-footprint reports and search RuneForge for artwork.
 * Category analysis only touches uncategorized mods; artwork lookup covers the
 * full supplied library so the same action can repair already-categorized mods.
 *
 * Runs sequentially (the analyzer reuses the warmed game index, so concurrent
 * runs would only thrash disk), patching the shared report cache as each mod
 * completes. Each mod is isolated: a backend error OR an unexpected promise
 * rejection is recorded as a failure and never aborts the rest of the batch.
 */
export function useAnalyzeUncategorizedMods() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const analyzeMod = mutationFn(api.analyzeModWads);
  const fetchThumbnail = mutationFn(api.fetchModThumbnail);

  return useMutation<AnalyzeBackfillResult, AppError, AnalyzeBackfillRequest>({
    mutationFn: async ({ uncategorized, artworkCandidates }) => {
      let analyzed = 0;
      let artworkAvailable = 0;
      let artworkMissing = 0;
      const failures: AnalyzeFailure[] = [];

      for (const mod of uncategorized) {
        try {
          const report = await analyzeMod(mod.id);
          analyzed++;
          queryClient.setQueryData<Record<string, ModWadReport>>(
            libraryKeys.wadReports(),
            (old) => ({ ...(old ?? {}), [report.modId]: report }),
          );
        } catch (err) {
          failures.push({
            name: mod.displayName,
            message: errorMessage(err),
          });
        }
      }

      let nextArtworkIndex = 0;
      async function artworkWorker() {
        while (nextArtworkIndex < artworkCandidates.length) {
          const mod = artworkCandidates[nextArtworkIndex++];
          try {
            const thumbnail = await fetchThumbnail(mod.id);
            if (thumbnail) artworkAvailable++;
            else artworkMissing++;
            queryClient.invalidateQueries({ queryKey: libraryKeys.thumbnail(mod.id) });
          } catch (err) {
            failures.push({
              name: mod.displayName,
              message: `Artwork: ${errorMessage(err)}`,
            });
          }
        }
      }

      const workers = Array.from(
        { length: Math.min(ARTWORK_LOOKUP_CONCURRENCY, artworkCandidates.length) },
        () => artworkWorker(),
      );
      await Promise.all(workers);

      return { analyzed, artworkAvailable, artworkMissing, failures };
    },
    onSuccess: ({ analyzed, artworkAvailable, artworkMissing, failures }) => {
      const summary = [
        analyzed > 0 ? `categorized ${analyzed}` : null,
        artworkAvailable > 0 ? `artwork available for ${artworkAvailable}` : null,
        artworkMissing > 0 ? `no artwork match for ${artworkMissing}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      if (failures.length === 0) {
        toast.success("Detection complete", summary || "Nothing needed updating.");
        return;
      }
      if (analyzed === 0 && artworkAvailable === 0) {
        toast.error(
          `Detection failed for ${failures.length} mod${failures.length === 1 ? "" : "s"}`,
          describeFailures(failures),
        );
        return;
      }
      toast.warning(
        `Detection complete, ${failures.length} failed`,
        [summary, describeFailures(failures)].filter(Boolean).join(" · "),
      );
    },
    onError: (error) => {
      toast.error("Failed to analyze mods", error.message);
    },
  });
}
