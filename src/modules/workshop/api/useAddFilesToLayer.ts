import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components";
import { errorSummary } from "@/i18n";
import { type AddFilesReport, api, type AppError } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { workshopKeys } from "./keys";

interface AddFilesArgs {
  projectPath: string;
  layerName: string;
  layerDisplayName: string;
  sources: string[];
}

export function useAddFilesToLayer() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation<AddFilesReport, AppError, AddFilesArgs>({
    meta: { silentError: true },
    mutationFn: async ({ projectPath, layerName, sources }) => {
      const result = await api.addFilesToLayer(projectPath, layerName, sources);
      return unwrapForQuery(result);
    },
    onSuccess: (report, { projectPath, layerDisplayName }) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.contentTree(projectPath) });
      const count = report.added.length;
      if (count > 0) {
        toast.success(
          `Added ${count} ${count === 1 ? "item" : "items"} to ${layerDisplayName}`,
          report.added.join(", "),
        );
      }
    },
    onError: (error) => {
      toast.error("Couldn't add files", errorSummary(error));
    },
  });
}
