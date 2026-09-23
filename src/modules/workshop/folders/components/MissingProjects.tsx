import { WarningIcon } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";

import { Button, useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import type { OpenedProjectFolder } from "@/lib/tauri";

import {
  useForgetProjectFolder,
  useOpenedFolders,
  useRelocateProjectFolder,
} from "../api/projectFolders";

/**
 * The opened folders whose project is gone, each with a way to find it or drop it.
 *
 * A separate run below the grid, so the grid's roving stop still counts only
 * cards it can open. Per "Open any folder" in `docs/ux/WORKSHOP.md`.
 */
export function MissingProjects() {
  const { data: folders } = useOpenedFolders();
  const missing = folders?.filter((folder) => folder.missing) ?? [];

  if (missing.length === 0) return null;

  return (
    <div
      data-ui="MissingProjects"
      className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4 select-none"
    >
      {missing.map((folder) => (
        <MissingProjectCard key={folder.id} folder={folder} />
      ))}
    </div>
  );
}

function MissingProjectCard({ folder }: { folder: OpenedProjectFolder }) {
  const { error } = useToast();
  const relocate = useRelocateProjectFolder();
  const forget = useForgetProjectFolder();

  async function handleLocate() {
    const picked = await open({ directory: true, multiple: false, defaultPath: folder.path });
    if (typeof picked !== "string") return;

    relocate.mutate(
      { oldPath: folder.path, newPath: picked },
      { onError: (cause) => error(m.workshop_folder_failed_title(), errorSummary(cause)) },
    );
  }

  return (
    <article className="flex flex-col gap-1.5 rounded-xl border border-dashed border-surface-600 p-3">
      <h3 className="truncate text-sm font-medium text-surface-300">{folder.displayName}</h3>
      <p
        className="truncate text-left font-mono text-code text-surface-500 select-text [direction:rtl]"
        title={folder.path}
      >
        <bdi>{folder.path}</bdi>
      </p>
      <p className="flex items-center gap-1.5 text-xs font-medium text-warning-text">
        <WarningIcon weight="bold" className="h-3.5 w-3.5" />
        {m.workshop_folder_missing_label()}
      </p>
      <div className="mt-1 flex gap-2">
        <Button variant="outline" size="xs" loading={relocate.isPending} onClick={handleLocate}>
          {m.workshop_folder_locate_action()}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          loading={forget.isPending}
          onClick={() => forget.mutate(folder.path)}
        >
          {m.workshop_folder_forget_action()}
        </Button>
      </div>
    </article>
  );
}
