import { useCallback, useEffect, useMemo, useRef } from "react";

import { Button, EmptyState, Spinner } from "@/components";
import type { LayerContent, WorkshopProject } from "@/lib/tauri";
import { EditorSurface } from "@/modules/editor";
import { useLayerPanelOpen, useLayerPanelSide, useSetLayerPanelOpen } from "@/stores";

import { useAddFilesToLayer, useLayerFileDrop, useProjectContentTree } from "../api";
import { detailsDocument, filesDocument, layerTitle, useContentEditors } from "../documents";
import {
  useActivateDocument,
  useActiveDocumentId,
  useCloseDocument,
  useDirtyDocumentIds,
  useOpenDocument,
  useOpenDocuments,
  useReorderDocuments,
  useSelectedLayerName,
} from "../state";
import { isProjectUnconfigured } from "../utils/project";
import { ContentLayoutPopover } from "./ContentLayoutPopover";
import { ContentSidebar } from "./ContentSidebar";
import { LayerFileDropOverlay } from "./LayerFileDropOverlay";

/* Built once. The strip memoizes its tabs, and a fresh element here on every
   render would hand it a changed prop and undo that. */
const LAYOUT_ACTIONS = <ContentLayoutPopover />;

interface ContentBrowserProps {
  project: WorkshopProject;
}

export function ContentBrowser({ project }: ContentBrowserProps) {
  const projectPath = project.path;
  const { data, error, isLoading } = useProjectContentTree(projectPath);

  const layerPanelSide = useLayerPanelSide();
  const layerPanelOpen = useLayerPanelOpen();
  const setLayerPanelOpen = useSetLayerPanelOpen();

  const documents = useOpenDocuments();
  const activeId = useActiveDocumentId();
  const openDocument = useOpenDocument();
  const activateDocument = useActivateDocument();
  const closeDocument = useCloseDocument();
  const reorderDocuments = useReorderDocuments();
  const dirtyIds = useDirtyDocumentIds();
  const selectedLayerName = useSelectedLayerName();
  const editors = useContentEditors();

  const contentLayers = useMemo<readonly LayerContent[]>(() => data?.layers ?? [], [data]);

  const selectedLayer = contentLayers.find((layer) => layer.name === selectedLayerName) ?? null;
  const selectedLayerDisplayName = selectedLayerName ? layerTitle(project, selectedLayerName) : "";

  /* Something opens on the first visit, so the pane is never blank for someone
     who has not opened anything yet. A project nobody has filled in gets its
     details, which is the work a fresh one needs. Closing every tab is left alone. */
  /* Marked on the first pass whether or not it opened anything. Marking it only
     when it opened let a user who closed every tab trip it again, which reopens
     one. The project is named rather than flagged, so this holds even without
     the key the route mounts this under. */
  const bootstrappedFor = useRef<string | null>(null);
  useEffect(() => {
    if (bootstrappedFor.current === projectPath) return;
    bootstrappedFor.current = projectPath;
    if (documents.length > 0) return;

    if (isProjectUnconfigured(project)) {
      openDocument(detailsDocument());
      return;
    }

    const first = project.layers[0];
    if (first) openDocument(filesDocument(first.name));
  }, [documents.length, project, projectPath, openDocument]);

  const addFilesToLayer = useAddFilesToLayer();

  const handleDrop = useCallback(
    (paths: string[]) => {
      if (!selectedLayer) return;
      addFilesToLayer.mutate({
        projectPath,
        layerName: selectedLayer.name,
        layerDisplayName: selectedLayerDisplayName,
        sources: paths,
      });
    },
    [addFilesToLayer, projectPath, selectedLayer, selectedLayerDisplayName],
  );

  const isDragOver = useLayerFileDrop(handleDrop);
  const showDropOverlay = isDragOver && selectedLayer !== null;

  /* Keyed panes rather than flex-row-reverse, so the reading order follows the
     layout and a side switch reorders the two instead of remounting them. */
  const sidebar = layerPanelOpen && (
    <ContentSidebar
      key="sidebar"
      project={project}
      contentLayers={contentLayers}
      selectedLayer={selectedLayer}
      selectedLayerName={selectedLayerName}
      selectedLayerDisplayName={selectedLayerDisplayName}
      onSelect={(layerName) => openDocument(filesDocument(layerName))}
    />
  );

  const surface = (
    <div
      key="surface"
      data-ui="ContentBrowser:surface"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip rounded-xl"
    >
      {isLoading && (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-surface-400">
          <Spinner size="sm" />
          Scanning project…
        </div>
      )}

      {error && (
        <div className="m-3 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger-text">
          Couldn&rsquo;t read the content directory: {error.message}
        </div>
      )}

      <EditorSurface
        documents={documents}
        activeId={activeId}
        registry={editors}
        dirtyIds={dirtyIds}
        onActivate={activateDocument}
        onClose={closeDocument}
        onReorder={reorderDocuments}
        actions={LAYOUT_ACTIONS}
        empty={
          <NothingOpenState
            hasLayers={project.layers.length > 0}
            sidebarOpen={layerPanelOpen}
            onShowSidebar={() => setLayerPanelOpen(true)}
          />
        }
      />
    </div>
  );

  const panes = layerPanelSide === "right" ? [surface, sidebar] : [sidebar, surface];

  return (
    <div data-ui="ContentBrowser" className="relative flex h-full min-h-0 gap-1.5 rounded-xl p-1.5">
      {panes}
      <LayerFileDropOverlay visible={showDropOverlay} layerDisplayName={selectedLayerDisplayName} />
    </div>
  );
}

interface NothingOpenStateProps {
  hasLayers: boolean;
  sidebarOpen: boolean;
  onShowSidebar: () => void;
}

function NothingOpenState({ hasLayers, sidebarOpen, onShowSidebar }: NothingOpenStateProps) {
  const action = !sidebarOpen && (
    <Button variant="outline" size="sm" onClick={onShowSidebar}>
      Show sidebar
    </Button>
  );

  if (!hasLayers) {
    return (
      <EmptyState
        size="sm"
        className="h-full"
        title="No layers yet"
        description="Add a layer from the sidebar"
        action={action}
      />
    );
  }

  return (
    <EmptyState
      size="sm"
      className="h-full"
      title="Nothing open"
      description="Pick a layer or a locale from the sidebar"
      action={action}
    />
  );
}
