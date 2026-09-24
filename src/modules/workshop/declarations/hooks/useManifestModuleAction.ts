import { useCallback } from "react";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type BinDocumentId, type ModuleAction } from "@/lib/tauri";

import { useInvalidateBinReads } from "../../bin/tree/hooks/useBinEdit";
import { useOpenBinsStore } from "../../state";

/**
 * Apply a module action to `layer` of the project's manifest with no document to undo it.
 *
 * Every open declared document applies the manifest again after it, since each holds the tree
 * the old text built. ADR-0048.
 */
export function useManifestModuleAction(
  projectPath: string,
): (layer: string, action: ModuleAction) => Promise<boolean> {
  const invalidate = useInvalidateBinReads();
  const toast = useToast();

  return useCallback(
    async (layer, action) => {
      const result = await api.declarations.moduleAction(projectPath, layer, action);
      if (!result.ok) {
        toast.error(m.workshop_bin_module_action_failed_title(), errorSummary(result.error));
        return false;
      }

      await reapplyDeclaredDocuments();
      invalidate();
      return true;
    },
    [invalidate, projectPath, toast],
  );
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
