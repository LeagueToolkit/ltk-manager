import { FolderOpenIcon, FolderSimpleIcon, LinkSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Kbd } from "@/components";
import { m } from "@/i18n";

import { useOpenedFolders } from "../api/projectFolders";
import { useOpenFolder } from "../hooks/useOpenFolder";

/**
 * What the workshop shows with no workshop folder set and no project to list.
 *
 * Per "Open any folder" in `docs/ux/WORKSHOP.md`.
 */
export function WorkshopStartPage() {
  const openFolder = useOpenFolder();
  const { data: folders } = useOpenedFolders();
  const recent = [...(folders ?? [])].sort(
    (a, b) => Date.parse(b.lastOpened ?? "") - Date.parse(a.lastOpened ?? ""),
  );

  return (
    <div
      data-ui="WorkshopStartPage"
      className="mx-auto grid max-w-4xl gap-10 px-6 py-12 select-none md:grid-cols-2"
    >
      <div>
        <h2 className="mb-2 font-display text-3xl font-bold tracking-tight text-surface-100">
          {m.workshop_start_title()}
        </h2>
        <p className="mb-6 text-sm text-surface-400">{m.workshop_start_description()}</p>

        <div className="flex flex-col gap-1">
          <StartAction
            icon={<FolderOpenIcon weight="bold" className="h-4 w-4" />}
            label={m.workshop_folder_open_action()}
            shortcut="Ctrl+O"
            onClick={openFolder.pick}
          />
          <StartAction
            icon={<PlusIcon weight="bold" className="h-4 w-4" />}
            label={m.workshop_start_new_action()}
            onClick={openFolder.pick}
          />
          <Link
            to="/settings"
            search={{ focus: "workshop.workshopPath" }}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-accent-400 hover:bg-surface-veil"
          >
            <FolderSimpleIcon weight="bold" className="h-4 w-4" />
            {m.workshop_start_choose_action()}
          </Link>
        </div>
      </div>

      {recent.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-surface-400 uppercase">
            {m.workshop_start_recent_label()}
          </h3>
          <ul className="flex flex-col">
            {recent.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  disabled={folder.missing}
                  onClick={() => void openFolder.openPath(folder.path)}
                  className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-veil-soft disabled:opacity-50"
                >
                  <LinkSimpleIcon className="h-4 w-4 text-surface-400" />
                  <span className="truncate text-sm font-medium text-surface-100">
                    {folder.displayName}
                  </span>
                  <span className="col-start-2 truncate font-mono text-xs text-code text-surface-400">
                    {folder.path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StartAction({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-accent-400 hover:bg-surface-veil"
    >
      {icon}
      {label}
      {shortcut && <Kbd shortcut={shortcut} className="ml-auto" />}
    </button>
  );
}
