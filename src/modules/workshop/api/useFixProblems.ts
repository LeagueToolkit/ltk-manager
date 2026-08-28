import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components";
import { api, type AppError, type FixReport, type ProblemId } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { workshopKeys } from "./keys";

interface FixProblemsArgs {
  projectPath: string;
  problems: ProblemId[];
  /** What the toast names the scope as, such as a file. Defaults to the project. */
  label?: string;
}

/**
 * How a report's skips read to a user.
 *
 * A skip is the rule re-checking the file and finding that it no longer
 * matches, which is the design working rather than a failure.
 */
function describeSkips(report: FixReport): string | undefined {
  if (report.skipped === 0) return undefined;
  return report.skipped === 1
    ? "1 problem no longer matched its file, so nothing there changed."
    : `${report.skipped} problems no longer matched their files, so nothing there changed.`;
}

/**
 * Hook to repair the named problems, over one file or the whole project.
 */
export function useFixProblems() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation<FixReport, AppError, FixProblemsArgs>({
    mutationFn: async ({ projectPath, problems }) => {
      const result = await api.fixProblems(projectPath, problems);
      return unwrapForQuery(result);
    },
    onSuccess: (report, { projectPath, label }) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.problems(projectPath) });
      // A fix rewrote files, so the tree's sizes are stale too.
      queryClient.invalidateQueries({ queryKey: workshopKeys.contentTree(projectPath) });

      if (report.failed.length > 0) {
        const count = report.failed.length;
        toast.error(
          `Couldn't fix ${count} ${count === 1 ? "file" : "files"}`,
          report.failed.join(", "),
        );
      }

      const scope = label ?? "the project";
      const skips = describeSkips(report);
      if (report.applied > 0) {
        toast.success(
          `Fixed ${report.applied} ${report.applied === 1 ? "problem" : "problems"} in ${scope}`,
          skips,
        );
        return;
      }
      if (skips) {
        toast.info(`Nothing left to fix in ${scope}`, skips);
      }
    },
    onError: (error) => {
      toast.error("Couldn't fix problems", error.message);
    },
  });
}
