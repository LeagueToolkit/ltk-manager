import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Group, Panel } from "react-resizable-panels";

import { Spinner } from "@/components";
import { useZoomedPx } from "@/hooks";
import { errorSummary, m } from "@/i18n";
import type { LayerContent, WorkshopProject } from "@/lib/tauri";
import {
  type DocumentPlacement,
  DocumentStage,
  type DropOutcome,
  EDITOR_TABS_HEIGHT,
  type LayoutNode,
  type LeafNode,
  leaves,
  PortalSlot,
  Seam,
  SplitLayout,
  TabDndProvider,
  TabGlyph,
  usePortalHosts,
} from "@/modules/editor";
import {
  useBrowserSplit,
  useLayerPanelOpen,
  useLayerPanelSide,
  useSetBrowserSplit,
  useSetLayerPanelOpen,
} from "@/stores";

import { useAddFilesToLayer, useLayerFileDrop, useProjectContentTree } from "../../api";
import {
  type ContentDocument,
  detailsDocument,
  documentDefinition,
  filesDocument,
  layerTitle,
  useContentEditors,
} from "../../documents";
import { LayerFileDropOverlay } from "../../layers/components/LayerFileDropOverlay";
import { isProjectUnconfigured } from "../../projects/utils/project";
import { SidebarPanel, SidebarRail } from "../../sidebar";
import {
  useLayoutTree,
  useMaximizedLeafId,
  useMoveDocument,
  useOpenDocument,
  useOpenDocuments,
  useRecordProjectVisit,
  useReorderDocuments,
  useRestoreMaximizedLeaf,
  useSelectedLayerName,
  useSetSplitLayout,
  useSplitWithDocument,
} from "../../state";
import { LeafProvider } from "../state/LeafContext";
import { ContentLeaf, ContentLeafRail } from "./ContentLeaf";
import { UnsavedQuitGuard } from "./UnsavedQuitGuard";

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
  const setLayerPanelOpen = useSetLayerPanelOpen();

  const documents = useOpenDocuments();
  const openDocument = useOpenDocument();
  const layout = useLayoutTree();
  const editors = useContentEditors();
  const placements = useMemo(() => documentPlacements(layout, documents), [layout, documents]);
  const setSplitLayout = useSetSplitLayout();
  const reorderDocuments = useReorderDocuments();
  const moveDocument = useMoveDocument();
  const splitWithDocument = useSplitWithDocument();
  const selectedLayerName = useSelectedLayerName();
  const maximizedLeafId = useMaximizedLeafId();
  const restoreMaximized = useRestoreMaximizedLeaf();
  const hostOf = usePortalHosts();
  const zoomed = useZoomedPx();

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

  const recordProjectVisit = useRecordProjectVisit();
  useEffect(() => {
    recordProjectVisit(projectPath);
  }, [projectPath, recordProjectVisit]);

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
  const renderCollapsedLeaf = useCallback((leaf: LeafNode) => <ContentLeafRail leaf={leaf} />, []);
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
      collapsible
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      <SidebarPanel
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
      /* DS-GROUND: each editor group is an island that frames itself, so a split
         parts two frames with a gap. */
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip"
    >
      {isLoading && (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-surface-400">
          <Spinner size={16} />
          {m.workshop_content_scanning_label()}
        </div>
      )}

      {error && (
        <div className="m-3 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger-text">
          {m.workshop_content_read_failed_description({ reason: errorSummary(error) })}
        </div>
      )}

      <TabDndProvider tree={layout} onDrop={handleTabDrop} overlay={renderGhost}>
        <DocumentStage placements={placements} registry={editors} leafScope={LeafProvider}>
          <SplitLayout
            node={layout}
            seamVariant="gap"
            onLayoutChanged={setSplitLayout}
            renderLeaf={renderLeaf}
            maximizedLeafId={maximizedLeafId}
            onRestore={restoreMaximized}
            /* The 2 is the top and bottom edge of the frame `ContentLeaf` draws around the strip. */
            collapsedSize={zoomed(EDITOR_TABS_HEIGHT) + 2}
            renderCollapsedLeaf={renderCollapsedLeaf}
          />
        </DocumentStage>
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
      <PortalSlot host={hostOf("surface")} />
    </Panel>
  );

  const seam = <Seam key="seam" orientation="horizontal" />;
  const panels =
    layerPanelSide === "right"
      ? [surfacePanel, seam, sidebarPanel]
      : [sidebarPanel, seam, surfacePanel];

  return (
    <div
      data-ui="ContentBrowser"
      /* DS-GROUND: the gaps between islands are the ground, as the gaps between panes are. */
      className="relative flex h-full min-h-0 bg-surface-950 px-1.5 pb-1.5"
    >
      {/* Outside the Group the panel is a share of, because the rail answers for
          the project rather than for the panel and stays while that panel is hidden. */}
      {layerPanelSide === "left" && <SidebarRail />}

      {/* Keyed by side because defaultLayout is read at mount alone. A flip
          remounts the Group, and the id-keyed sizes reapply in the new order. */}
      {layerPanelOpen && (
        <Group
          key={layerPanelSide}
          orientation="horizontal"
          defaultLayout={browserSplit ?? undefined}
          onLayoutChanged={(split, meta) => {
            if (!meta.isUserInteraction) return;

            /* A collapsed sidebar hides, and the stored split keeps the width it reopens at. */
            if (split.sidebar === 0) {
              setLayerPanelOpen(false);
              return;
            }

            setBrowserSplit(split);
          }}
          className="min-h-0 min-w-0 flex-1"
        >
          {panels}
        </Group>
      )}
      {!layerPanelOpen && <PortalSlot host={hostOf("surface")} />}
      {/* Rendered once and adopted by whichever slot stands, so the rail's toggle and a
          side flip leave every open document mounted. */}
      {createPortal(surface, hostOf("surface").node)}

      {layerPanelSide === "right" && <SidebarRail />}
      <LayerFileDropOverlay visible={showDropOverlay} layerDisplayName={selectedLayerDisplayName} />
      <UnsavedQuitGuard />
    </div>
  );
}

/** Returns each open document with the group that shows it. */
function documentPlacements(
  layout: LayoutNode,
  documents: readonly ContentDocument[],
): readonly DocumentPlacement<ContentDocument>[] {
  const byId = new Map(documents.map((document) => [document.id, document]));

  return leaves(layout).flatMap((leaf) =>
    leaf.tabs.flatMap((id) => {
      const document = byId.get(id);
      if (document === undefined) return [];

      return [{ document, leafId: leaf.id, active: id === leaf.activeTab }];
    }),
  );
}

/* Styled as the strip's own dragging tab, so the ghost reads as the tab itself
   travelling rather than a second object. */
function TabDragGhost({ documentId }: { documentId: string }) {
  const documents = useOpenDocuments();
  const editors = useContentEditors();

  const document = documents.find((candidate) => candidate.id === documentId);
  if (!document) return null;

  const definition = documentDefinition(editors, document);
  if (!definition) return null;

  const { title, context, layer } = definition.label(document);
  return (
    <div className="flex h-6 items-center gap-1.5 rounded-md bg-surface-800 px-2 text-xs text-surface-100 shadow-lg select-none">
      <TabGlyph>{definition.icon(document)}</TabGlyph>
      <span className="truncate">{title}</span>
      {(context ?? layer) && (
        <span className="truncate text-meta text-surface-400">{context ?? layer}</span>
      )}
    </div>
  );
}
