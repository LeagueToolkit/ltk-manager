import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  FileArchiveIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
} from "@phosphor-icons/react";

import { Button, EmptyState, IconButton, Menu, Tooltip } from "@/components";
import { api, type LayerContent } from "@/lib/tauri";
import { DocumentActions, type EditorDocumentProps } from "@/modules/editor";

import { useProjectContentTree } from "../api";
import { ContentTree } from "../components/ContentTree";
import { useProjectContext } from "../components/ProjectContext";
import { useLayerWadImport } from "../hooks";
import { type ContentDocumentOf, layerTitle } from "./contentDocument";

/** A layer's content directory, as the tree of what is on disk. */
export function FilesDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"files">>) {
  const project = useProjectContext();
  const { data, isFetching, refetch } = useProjectContentTree(project.path);

  const layerName = document.layerName;
  const displayName = layerTitle(project, layerName);
  const layer = data?.layers.find((candidate) => candidate.name === layerName) ?? null;

  const wadImport = useLayerWadImport({
    projectPath: project.path,
    layerName,
    layerDisplayName: displayName,
  });

  async function handleOpenFolder() {
    await api.revealInExplorer(`${project.path}/content/${layerName}`);
  }

  return (
    <div data-ui="FilesDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <DocumentActions active={active}>
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                variant="ghost"
                size="xs"
                compact
                loading={wadImport.isPending}
                left={<PlusIcon weight="bold" className="h-4 w-4" />}
                right={<CaretDownIcon weight="bold" className="h-3 w-3" />}
              >
                Add WAD
              </Button>
            }
          />
          <Menu.Portal>
            <Menu.Positioner align="end" sideOffset={4}>
              <Menu.Popup>
                <Menu.Item
                  icon={<FileArchiveIcon className="h-4 w-4" />}
                  onClick={wadImport.pickFiles}
                >
                  Add WAD file…
                </Menu.Item>
                <Menu.Item icon={<FolderIcon className="h-4 w-4" />} onClick={wadImport.pickFolder}>
                  Add WAD folder…
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        <Tooltip content="Refresh">
          <IconButton
            icon={<RefreshIcon spinning={isFetching} />}
            variant="ghost"
            size="xs"
            compact
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh content listing"
          />
        </Tooltip>

        <Tooltip content="Open folder">
          <IconButton
            icon={<FolderOpenIcon className="h-4 w-4" />}
            variant="ghost"
            size="xs"
            compact
            onClick={handleOpenFolder}
            aria-label={`Open folder for layer ${layerName}`}
          />
        </Tooltip>
      </DocumentActions>

      <FilesBody layer={layer} layerName={layerName} />
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  if (spinning) return <ArrowsClockwiseIcon className="h-4 w-4 animate-spin" />;
  return <ArrowsClockwiseIcon className="h-4 w-4" />;
}

interface FilesBodyProps {
  layer: LayerContent | null;
  layerName: string;
}

function FilesBody({ layer, layerName }: FilesBodyProps) {
  if (!layer) {
    return (
      <EmptyState
        size="sm"
        title="Layer is gone"
        description="Its folder is no longer in the project"
      />
    );
  }

  if (layer.entries.length === 0) {
    return (
      <EmptyState
        size="sm"
        title="No files yet"
        description="Extract game files from an existing mod or the game client, then drop them into this folder."
      />
    );
  }

  return <ContentTree entries={layer.entries} layerName={layerName} />;
}
