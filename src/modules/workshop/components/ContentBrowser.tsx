import { useCallback, useEffect, useMemo, useRef } from "react";
import { Group, Panel } from "react-resizable-panels";

import { Spinner } from "@/components";
import type { LayerContent, WorkshopProject } from "@/lib/tauri";
import {
  type DropOutcome,
  type EditorDocumentDefinition,
  type LeafNode,
  Seam,
  SplitLayout,
  TabDndProvider,
} from "@/modules/editor";
import {
  useBrowserSplit,
  useLayerPanelOpen,
  useLayerPanelSide,
  useSetBrowserSplit,
} from "@/stores";

import { useAddFilesToLayer, useLayerFileDrop, useProjectContentTree } from "../api";
import {
  type ContentDocument,
  detailsDocument,
  filesDocument,
  layerTitle,
  useContentEditors,
} from "../documents";
import {
  useLayoutTree,
  useMoveDocument,
  useOpenDocument,
  useOpenDocuments,
  useReorderDocuments,
  useSelectedLayerName,
  useSetSplitLayout,
  useSplitWithDocument,
} from "../state";
import { isProjectUnconfigured } from "../utils/project";
import { ContentLeaf } from "./ContentLeaf";
import { ContentSidebar } from "./ContentSidebar";
import { LayerFileDropOverlay } from "./LayerFileDropOverlay";

interface ContentBrowserProps {
  project: WorkshopProject;
}

export function ContentBrowser({ project }: ContentBrowserProps) {
  const projectPath = project.path;
  const { data, error, isLoading } = useProjectContentTree(projectPath);

  const layerPanelSide = useLayerPanelSide();
  const layerPanelOpen = useLayerPanelOpen();
  const browserSplit = useBrowserSplit();
  const setBrowserSplit = useSetBrowserSplit();

  const documents = useOpenDocuments();
  const openDocument = useOpenDocument();
  const layout = useLayoutTree();
  const setSplitLayout = useSetSplitLayout();
  const reorderDocuments = useReorderDocuments();
  const moveDocument = useMoveDocument();
  const splitWithDocument = useSplitWithDocument();
  const selectedLayerName = useSelectedLayerName();

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

  const handleFileDrop = useCallback(
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

  const isDragOver = useLayerFileDrop(handleFileDrop);
  const showDropOverlay = isDragOver && selectedLayer !== null;

  const handleTabDrop = useCallback(
    (outcome: DropOutcome) => {
      switch (outcome.kind) {
        case "reorder":
          reorderDocuments(outcome.leafId, outcome.ids);
          return;
        case "move":
          moveDocument(outcome.documentId, outcome.toLeafId, outcome.index);
          return;
        case "split":
          splitWithDocument(outcome.documentId, outcome.targetLeafId, outcome.edge);
          return;
      }
    },
    [reorderDocuments, moveDocument, splitWithDocument],
  );

  const renderLeaf = useCallback((leaf: LeafNode) => <ContentLeaf leaf={leaf} />, []);
  const renderGhost = useCallback(
    (documentId: string) => <TabDragGhost documentId={documentId} />,
    [],
  );

  const sidebarPanel = (
    <Panel
      key="sidebar"
      id="sidebar"
      /* 224 is the w-56 the sidebar was fixed at before it had a sash. */
      defaultSize={224}
      minSize={180}
      maxSize="40%"
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      <ContentSidebar
        project={project}
        contentLayers={contentLayers}
        selectedLayer={selectedLayer}
        selectedLayerName={selectedLayerName}
        selectedLayerDisplayName={selectedLayerDisplayName}
        onSelect={(layerName) => openDocument(filesDocument(layerName))}
      />
    </Panel>
  );

  const surface = (
    <div
      data-ui="ContentBrowser:surface"
      /* DS-GROUND: the grid is one island, so the frame is the surface's and not
         each leaf's. A split then shows one divider where two leaves meet. */
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip rounded-xl border border-surface-700"
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

      <TabDndProvider tree={layout} onDrop={handleTabDrop} overlay={renderGhost}>
        <SplitLayout node={layout} onLayoutChanged={setSplitLayout} renderLeaf={renderLeaf} />
      </TabDndProvider>
    </div>
  );

  const surfacePanel = (
    <Panel
      key="surface"
      id="surface"
      minSize={360}
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      {surface}
    </Panel>
  );

  const seam = <Seam key="seam" orientation="horizontal" />;
  const panels =
    layerPanelSide === "right"
      ? [surfacePanel, seam, sidebarPanel]
      : [sidebarPanel, seam, surfacePanel];

  return (
    <div data-ui="ContentBrowser" className="relative flex h-full min-h-0 rounded-xl p-1.5">
      {/* Keyed by side because defaultLayout is read at mount alone. A flip
          remounts the Group, and the id-keyed sizes reapply in the new order. */}
      {layerPanelOpen && (
        <Group
          key={layerPanelSide}
          orientation="horizontal"
          defaultLayout={browserSplit ?? undefined}
          onLayoutChanged={(split, meta) => {
            if (meta.isUserInteraction) setBrowserSplit(split);
          }}
          className="min-h-0 min-w-0 flex-1"
        >
          {panels}
        </Group>
      )}
      {!layerPanelOpen && surface}
      <LayerFileDropOverlay visible={showDropOverlay} layerDisplayName={selectedLayerDisplayName} />
    </div>
  );
}

/* Styled as the strip's own dragging tab, so the ghost reads as the tab itself
   travelling rather than a second object. */
function TabDragGhost({ documentId }: { documentId: string }) {
  const documents = useOpenDocuments();
  const editors = useContentEditors();

  const document = documents.find((candidate) => candidate.id === documentId);
  if (!document) return null;

  /* The registry narrows to one kind per key, which a lookup by a union's own
     kind cannot express. The key comes off the document, so the two agree. */
  const definition = editors[document.kind as ContentDocument["kind"]] as unknown as
    | EditorDocumentDefinition<ContentDocument>
    | undefined;
  if (!definition) return null;

  const { title, context } = definition.label(document);
  return (
    <div className="flex h-6 items-center gap-1.5 rounded-md bg-surface-800 px-2 text-xs text-surface-100 shadow-lg select-none">
      {definition.icon(document)}
      <span className="truncate">{title}</span>
      {context && <span className="truncate text-[11px] text-surface-400">{context}</span>}
    </div>
  );
}
