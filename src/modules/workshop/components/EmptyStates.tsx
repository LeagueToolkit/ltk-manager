import { Link } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Hammer, Plus, Search, Settings } from "lucide-react";

import { Button } from "@/components";
import type { AppError } from "@/lib/tauri";
import { useWorkshopDialogsStore } from "@/stores";

import { useImportFromModpkg } from "../api/useImportFromModpkg";

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
      <div className="mb-4 rounded-full bg-red-500/10 p-4">
        <span className="text-2xl">⚠️</span>
      </div>
      <h3 className="mb-1 text-lg font-medium text-surface-300">Failed to load projects</h3>
      <p className="mb-2 text-surface-500">{error.message}</p>
      <p className="text-sm text-surface-600">Error code: {error.code}</p>
    </div>
  );
}

export function NotConfiguredState() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 items-center border-b border-surface-600 px-6">
        <h2 className="text-xl font-semibold text-surface-100">Workshop</h2>
      </header>
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-800">
            <FolderOpen className="h-10 w-10 text-surface-600" />
          </div>
          <h3 className="mb-1 text-lg font-medium text-surface-300">Workshop Not Configured</h3>
          <p className="mb-4 max-w-sm text-surface-500">
            Set up a workshop directory in Settings to start creating mod projects.
          </p>
          <Link to="/settings">
            <Button variant="filled" left={<Settings className="h-4 w-4" />}>
              Open Settings
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function NoProjectsState() {
  const openNewProjectDialog = useWorkshopDialogsStore((s) => s.openNewProjectDialog);
  const importFromModpkg = useImportFromModpkg();

  async function handleImport() {
    const file = await open({
      multiple: false,
      filters: [{ name: "Mod Package", extensions: ["modpkg"] }],
    });
    if (file) {
      importFromModpkg.mutate(file, {
        onError: (err) => console.error("Failed to import modpkg:", err.message),
      });
    }
  }

  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl">
        <Hammer className="h-10 w-10 text-surface-600" />
      </div>
      <h3 className="mb-1 text-lg font-medium text-surface-300">No projects yet</h3>
      <p className="mb-4 text-surface-500">
        Create a new project or import an existing mod package
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={handleImport} left={<Download className="h-4 w-4" />}>
          Import
        </Button>
        <Button variant="filled" onClick={openNewProjectDialog} left={<Plus className="h-4 w-4" />}>
          New Project
        </Button>
      </div>
    </div>
  );
}

export function NoSearchResultsState() {
  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <Search className="mb-4 h-12 w-12 text-surface-600" />
      <h3 className="mb-1 text-lg font-medium text-surface-300">No projects found</h3>
      <p className="text-surface-500">Try adjusting your search query</p>
    </div>
  );
}
