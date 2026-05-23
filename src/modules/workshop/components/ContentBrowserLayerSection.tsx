import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  FileArchive,
  Folder,
  FolderOpen,
  Layers,
  Plus,
  RefreshCw,
} from "lucide-react";

import { Button, IconButton, Menu, Tooltip } from "@/components";
import { api, type LayerContent } from "@/lib/tauri";
import { formatBytes } from "@/utils";

import { useAddFilesToLayer } from "../api";
import { ContentTree } from "./ContentTree";

interface ContentBrowserLayerSectionProps {
  projectPath: string;
  layer: LayerContent;
  layerDisplayName: string;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export function ContentBrowserLayerSection({
  projectPath,
  layer,
  layerDisplayName,
  isRefreshing,
  onRefresh,
}: ContentBrowserLayerSectionProps) {
  const addFilesToLayer = useAddFilesToLayer();

  async function handleOpenFolder() {
    await api.revealInExplorer(`${projectPath}/content/${layer.name}`);
  }

  function dispatchAdd(sources: string[]) {
    if (sources.length === 0) return;
    addFilesToLayer.mutate({
      projectPath,
      layerName: layer.name,
      layerDisplayName,
      sources,
    });
  }

  async function handleAddFiles() {
    const selection = await open({
      multiple: true,
      filters: [
        { name: "WAD files", extensions: ["wad", "client", "mobile"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!selection) return;
    const paths = Array.isArray(selection) ? selection : [selection];
    dispatchAdd(paths);
  }

  async function handleAddFolder() {
    const selection = await open({ directory: true, multiple: false });
    if (!selection) return;
    dispatchAdd([selection as string]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-surface-700/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Layers className="h-3.5 w-3.5 shrink-0 text-surface-400" />
          <span className="font-mono text-sm font-medium text-surface-200">{layer.name}</span>
          <span className="text-xs text-surface-400">
            {layer.fileCount} {layer.fileCount === 1 ? "file" : "files"}
            {layer.fileCount > 0 && ` · ${formatBytes(Number(layer.totalSizeBytes))}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Menu.Root>
            <Menu.Trigger
              render={
                <Button
                  variant="outline"
                  size="xs"
                  loading={addFilesToLayer.isPending}
                  left={<Plus className="h-3.5 w-3.5" />}
                  right={<ChevronDown className="h-3 w-3" />}
                >
                  Add WAD
                </Button>
              }
            />
            <Menu.Portal>
              <Menu.Positioner align="end" sideOffset={4}>
                <Menu.Popup>
                  <Menu.Item icon={<FileArchive className="h-4 w-4" />} onClick={handleAddFiles}>
                    Add WAD file…
                  </Menu.Item>
                  <Menu.Item icon={<Folder className="h-4 w-4" />} onClick={handleAddFolder}>
                    Add WAD folder…
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <Tooltip content="Refresh">
            <IconButton
              icon={
                <RefreshCw className={isRefreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              }
              variant="ghost"
              size="xs"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label="Refresh content listing"
            />
          </Tooltip>
          <Tooltip content="Open folder">
            <IconButton
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              variant="ghost"
              size="xs"
              onClick={handleOpenFolder}
              aria-label={`Open folder for layer ${layer.name}`}
            />
          </Tooltip>
        </div>
      </div>

      {layer.entries.length === 0 ? (
        <LayerEmptyState />
      ) : (
        <ContentTree entries={layer.entries} projectPath={projectPath} layerName={layer.name} />
      )}
    </div>
  );
}

function LayerEmptyState() {
  return (
    <div className="px-3 py-5 text-center">
      <p className="text-xs text-surface-400">
        No files yet. Extract game files from an existing mod or the game client, then drop them
        into this folder.
      </p>
    </div>
  );
}
