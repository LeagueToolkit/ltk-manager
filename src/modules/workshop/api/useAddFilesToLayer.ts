import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useToast } from "@/components";
import { type AddFilesReport, api, type AppError } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { workshopKeys } from "./keys";

interface AddFilesArgs {
  projectPath: string;
  layerName: string;
  layerDisplayName: string;
  sources: string[];
}

const WorkshopErrorContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LAYER_FILE_CONFLICT"), conflicts: z.array(z.string()) }),
]);

function describeConflicts(error: AppError): string | undefined {
  if (error.code !== "WORKSHOP" || !error.context) return undefined;
  const parsed = WorkshopErrorContextSchema.safeParse(error.context);
  if (!parsed.success) return undefined;
  if (parsed.data.kind !== "LAYER_FILE_CONFLICT") return undefined;
  const items = parsed.data.conflicts;
  if (items.length === 0) return undefined;
  if (items.length === 1) return `${items[0]} already exists in this layer.`;
  if (items.length <= 3) return `${items.join(", ")} already exist in this layer.`;
  return `${items.slice(0, 2).join(", ")} and ${items.length - 2} more already exist in this layer.`;
}

export function useAddFilesToLayer() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation<AddFilesReport, AppError, AddFilesArgs>({
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
      const conflicts = describeConflicts(error);
      if (conflicts) {
        toast.error("Couldn't add files", conflicts);
        return;
      }
      toast.error("Couldn't add files", error.message);
    },
  });
}
