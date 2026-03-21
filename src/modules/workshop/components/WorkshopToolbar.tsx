import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  Download,
  FileArchive,
  GitBranch,
  Grid3X3,
  List,
  Package,
  Plus,
  Search,
  SquareCheckBig,
} from "lucide-react";

import { Button, IconButton, Kbd, Menu, Tooltip } from "@/components";
import { usePatcherStatus } from "@/modules/patcher";
import { useWorkshopDialogsStore, useWorkshopSelectionStore, useWorkshopViewStore } from "@/stores";

import { useFilteredProjects } from "../api/useFilteredProjects";
import { useImportFromModpkg } from "../api/useImportFromModpkg";
import { usePeekFantome } from "../api/usePeekFantome";
import { ActionsMenu } from "./ActionsMenu";
import { WorkshopSortDropdown } from "./WorkshopSortDropdown";

export type ViewMode = "grid" | "list";

export function WorkshopToolbar() {
  const searchQuery = useWorkshopViewStore((s) => s.searchQuery);
  const setSearchQuery = useWorkshopViewStore((s) => s.setSearchQuery);
  const viewMode = useWorkshopViewStore((s) => s.viewMode);
  const setViewMode = useWorkshopViewStore((s) => s.setViewMode);

  const selectAll = useWorkshopSelectionStore((s) => s.selectAll);
  const filteredProjects = useFilteredProjects();

  const { data: patcherStatus } = usePatcherStatus();
  const isPatcherActive = patcherStatus?.running ?? false;

  const openNewProjectDialog = useWorkshopDialogsStore((s) => s.openNewProjectDialog);
  const openFantomeImportDialog = useWorkshopDialogsStore((s) => s.openFantomeImportDialog);
  const openGitImportDialog = useWorkshopDialogsStore((s) => s.openGitImportDialog);

  const importFromModpkg = useImportFromModpkg();
  const peekFantome = usePeekFantome();

  const isImporting = importFromModpkg.isPending || peekFantome.isPending;

  async function handleImportModpkg() {
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

  async function handleImportFantome() {
    const file = await open({
      multiple: false,
      filters: [{ name: "Fantome Archive", extensions: ["fantome", "zip"] }],
    });
    if (!file) return;

    peekFantome.mutate(file, {
      onSuccess: (result) => openFantomeImportDialog(result, file),
      onError: (err) => console.error("Failed to peek fantome:", err.message),
    });
  }

  return (
    <div
      className="flex items-center gap-4 border-b border-surface-600 bg-surface-800/50 px-4 py-3"
      data-tauri-drag-region
    >
      <div className="relative flex-1">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-surface-500" />
        <input
          type="text"
          placeholder="Search projects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-surface-600 bg-surface-800 py-2 pr-4 pl-10 text-surface-100 placeholder:text-surface-500 focus:border-transparent focus:ring-2 focus:ring-accent-500 focus:outline-none"
        />
      </div>

      <WorkshopSortDropdown />

      <div className="flex items-center gap-1">
        <Tooltip content="Grid view">
          <IconButton
            icon={<Grid3X3 className="h-4 w-4" />}
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("grid")}
          />
        </Tooltip>
        <Tooltip content="List view">
          <IconButton
            icon={<List className="h-4 w-4" />}
            variant={viewMode === "list" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("list")}
          />
        </Tooltip>
      </div>

      {!isPatcherActive && (
        <>
          <Tooltip
            content={
              <>
                Select all <Kbd shortcut="Ctrl+A" />
              </>
            }
          >
            <IconButton
              icon={<SquareCheckBig className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              onClick={() => selectAll(filteredProjects.map((p) => p.path))}
              aria-label="Select all projects"
            />
          </Tooltip>
          <ActionsMenu />
        </>
      )}

      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              variant="outline"
              size="sm"
              loading={isImporting}
              left={<Download className="h-4 w-4" />}
              right={<ChevronDown className="h-3.5 w-3.5" />}
            >
              Import
            </Button>
          }
        />
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup>
              <Menu.Item icon={<FileArchive className="h-4 w-4" />} onClick={handleImportFantome}>
                From Fantome
              </Menu.Item>
              <Menu.Item icon={<Package className="h-4 w-4" />} onClick={handleImportModpkg}>
                From Modpkg
              </Menu.Item>
              <Menu.Item icon={<GitBranch className="h-4 w-4" />} onClick={openGitImportDialog}>
                From Git Repository
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Tooltip
        content={
          <>
            New project <Kbd shortcut="Ctrl+N" />
          </>
        }
      >
        <Button
          variant="filled"
          size="sm"
          onClick={openNewProjectDialog}
          left={<Plus className="h-4 w-4" />}
        >
          New Project
        </Button>
      </Tooltip>
    </div>
  );
}
