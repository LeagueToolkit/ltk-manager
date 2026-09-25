import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type BinDocumentId, type ModuleAction } from "@/lib/tauri";

import { followModuleAction } from "../../bin/documents/utils/declaredModule";
import { useInvalidateBinReads } from "../../bin/tree/hooks/useBinEdit";
import { useOpenBinsStore, useSelectedModule, useSelectModule } from "../../state";
import { declarationQueries } from "../api/queries";

/**
 * Apply a module action to `layer` of the project's manifest with no document to undo it.
 *
 * Every open declared document applies the manifest again after it, since each holds the tree
 * the old text built, and the chosen module follows the module it named. The outline is read
 * again before the answer, so the caller finds the modules the action left. ADR-0048.
 */
export function useManifestModuleAction(
  projectPath: string,
): (layer: string, action: ModuleAction) => Promise<boolean> {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateBinReads();
  const selected = useSelectedModule();
  const selectModule = useSelectModule();
  const toast = useToast();

  return useCallback(
    async (layer, action) => {
      const outline = declarationQueries.outline(projectPath);
      const before = modulesIn(queryClient.getQueryData(outline.queryKey), layer);
      const result = await api.declarations.moduleAction(projectPath, layer, action);
      if (!result.ok) {
        toast.error(m.workshop_bin_module_action_failed_title(), errorSummary(result.error));
        return false;
      }

      await reapplyDeclaredDocuments();
      invalidate();
      const after = modulesIn(await queryClient.fetchQuery(outline), layer);

      if (selected?.layer === layer) {
        const removedSource = before !== null && after !== null && after < before;
        selectModule(followModuleAction(selected, action, removedSource));
      }
      return true;
    },
    [invalidate, projectPath, queryClient, selectModule, selected, toast],
  );
}

/** How many modules `layer` of an outline holds, null for an outline not read yet. */
function modulesIn(
  layers: readonly { layer: string; modules: readonly unknown[] }[] | undefined,
  layer: string,
): number | null {
  return layers?.find((held) => held.layer === layer)?.modules.length ?? null;
}

/** Reload each open document that declares, which applies its manifests again. */
async function reapplyDeclaredDocuments(): Promise<void> {
  const documents = new Set<BinDocumentId>(
    Object.values(useOpenBinsStore.getState().byTab).map((bin) => bin.document),
  );

  await Promise.all(
    [...documents].map(async (document) => {
      const declared = await api.bin.declared(document);
      if (!declared.ok || declared.value === null) return;

      await api.bin.reload(document);
    }),
  );
}
