import { FileArchiveIcon, FileIcon, PlusIcon } from "@phosphor-icons/react";

import { Button, EmptyState } from "@/components";
import { formatBytes } from "@/utils";

import { filesDocument } from "../documents";
import { useLayerWadImport } from "../hooks";
import { useOpenDocument, useRevealInTree } from "../state";
import type { LayerWad } from "../utils/contentTree";
import { useProjectContext } from "./ProjectContext";

interface ContentWadListProps {
  wads: readonly LayerWad[];
  /** Null while the project has no layer to put a WAD in. */
  layerName: string | null;
  layerDisplayName: string;
}

/** One row per WAD in the selected layer, jumping the file tree to it. */
export function ContentWadList({ wads, layerName, layerDisplayName }: ContentWadListProps) {
  const reveal = useRevealInTree();
  const openDocument = useOpenDocument();

  /* The tree it scrolls has to be the open document, so a WAD click opens the
     layer's files first. */
  function show(path: string) {
    if (!layerName) return;
    openDocument(filesDocument(layerName));
    reveal(layerName, path);
  }

  if (wads.length === 0) {
    return <WadsEmptyState layerName={layerName} layerDisplayName={layerDisplayName} />;
  }

  return (
    <ul data-ui="ContentWadList" className="flex flex-col gap-0.5 p-1.5">
      {wads.map((wad) => (
        <li key={wad.path}>
          <button
            type="button"
            onClick={() => show(wad.path)}
            title={wad.name}
            className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left text-surface-200 transition-colors outline-none hover:bg-surface-800/60 hover:text-surface-100 focus-visible:ring-1 focus-visible:ring-accent-500/60"
          >
            <WadIcon kind={wad.kind} />
            <span className="min-w-0 flex-1 truncate text-sm">{wad.name}</span>
            <span className="shrink-0 text-[11px] text-surface-400 tabular-nums">
              {formatBytes(wad.sizeBytes)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function WadIcon({ kind }: { kind: LayerWad["kind"] }) {
  if (kind === "wad") return <FileArchiveIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />;
  return <FileIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />;
}

type WadsEmptyStateProps = Omit<ContentWadListProps, "wads">;

function WadsEmptyState({ layerName, layerDisplayName }: WadsEmptyStateProps) {
  const project = useProjectContext();
  const wadImport = useLayerWadImport({
    projectPath: project.path,
    layerName: layerName ?? "",
    layerDisplayName,
  });

  if (!layerName) {
    return <EmptyState size="xs" title="No layer" description="Add a layer to put WADs in" />;
  }

  return (
    <EmptyState
      size="xs"
      title="No WADs yet"
      description="Import a WAD or drop one in"
      action={
        <Button
          variant="outline"
          size="xs"
          loading={wadImport.isPending}
          left={<PlusIcon weight="bold" className="h-4 w-4" />}
          onClick={wadImport.pickFiles}
        >
          Import WAD…
        </Button>
      }
    />
  );
}
