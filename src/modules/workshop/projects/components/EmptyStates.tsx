import { open } from "@tauri-apps/plugin-dialog";
import { Download, Hammer, Plus } from "lucide-react";

import { Button, EmptyState } from "@/components";
import { errorSummary, m } from "@/i18n";
import type { AppError } from "@/lib/tauri";

import { useImportFromModpkg } from "../../imports/api/useImportFromModpkg";
import { useNewProjectDialog } from "../../state";

export function LoadingState() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
    </div>
  );
}

export function ErrorState({ error }: { error: AppError }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <div className="mb-4 rounded-full bg-danger/10 p-4">
        <span className="text-2xl">⚠️</span>
      </div>
      <h3 className="mb-1 text-lg font-medium text-surface-300">
        {m.workshop_projects_error_title()}
      </h3>
      <p className="mb-2 text-surface-500">{errorSummary(error)}</p>
      <p className="text-sm text-surface-600">
        {m.workshop_projects_error_code_label({ code: error.code })}
      </p>
    </div>
  );
}

export function NoProjectsState() {
  const openNewProjectDialog = useNewProjectDialog((s) => s.open);
  const importFromModpkg = useImportFromModpkg();

  async function handleImport() {
    const file = await open({
      multiple: false,
      filters: [{ name: m.workshop_projects_modpkg_filter_label(), extensions: ["modpkg"] }],
    });
    if (file) {
      importFromModpkg.mutate(file, {
        onError: (err) => console.error("Failed to import modpkg:", err),
      });
    }
  }

  return (
    <EmptyState
      icon={<Hammer className="h-16 w-16" />}
      title={m.workshop_projects_empty_title()}
      description={m.workshop_projects_empty_description()}
      action={
        <>
          <Button variant="outline" onClick={handleImport} left={<Download className="h-4 w-4" />}>
            {m.workshop_projects_import_action()}
          </Button>
          <Button
            variant="filled"
            onClick={openNewProjectDialog}
            left={<Plus className="h-4 w-4" />}
          >
            {m.workshop_projects_new_action()}
          </Button>
        </>
      }
    />
  );
}

export function NoSearchResultsState() {
  return (
    <EmptyState
      title={m.workshop_projects_no_results_title()}
      description={m.workshop_projects_no_results_description()}
    />
  );
}
