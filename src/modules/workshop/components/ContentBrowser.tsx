import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, Spinner } from "@/components";
import type { LayerContent, WorkshopProject } from "@/lib/tauri";

import { useAddFilesToLayer, useLayerFileDrop, useProjectContentTree } from "../api";
import { ContentBrowserLayerRail } from "./ContentBrowserLayerRail";
import { ContentBrowserLayerSection } from "./ContentBrowserLayerSection";
import { LayerFileDropOverlay } from "./LayerFileDropOverlay";

interface ContentBrowserProps {
  project: WorkshopProject;
}

export function ContentBrowser({ project }: ContentBrowserProps) {
  const projectPath = project.path;
  const { data, error, isLoading, isFetching, refetch } = useProjectContentTree(projectPath);

  const [selectedLayerName, setSelectedLayerName] = useState<string>(
    () => project.layers[0]?.name ?? "base",
  );

  const contentLayers = useMemo<readonly LayerContent[]>(() => data?.layers ?? [], [data]);

  const selectedLayer = useMemo<LayerContent | null>(() => {
    const match = contentLayers.find((l) => l.name === selectedLayerName);
    if (match) return match;
    return contentLayers[0] ?? null;
  }, [contentLayers, selectedLayerName]);

  useEffect(() => {
    // Keep selection in sync with what the content scan actually returned,
    // so renames/deletes elsewhere don't leave a dangling highlight.
    if (selectedLayer && selectedLayer.name !== selectedLayerName) {
      setSelectedLayerName(selectedLayer.name);
    }
  }, [selectedLayer, selectedLayerName]);

  const selectedLayerDisplayName = useMemo(() => {
    if (!selectedLayer) return "";
    const layerMeta = project.layers.find((l) => l.name === selectedLayer.name);
    return layerMeta?.displayName ?? selectedLayer.name;
  }, [project.layers, selectedLayer]);

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

  return (
    <div className="relative flex h-full min-h-0">
      <ContentBrowserLayerRail
        project={project}
        contentLayers={contentLayers}
        selectedLayerName={selectedLayerName}
        onSelect={setSelectedLayerName}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-900/95">
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

        {selectedLayer && (
          <ContentBrowserLayerSection
            key={selectedLayer.name}
            projectPath={projectPath}
            layer={selectedLayer}
            layerDisplayName={selectedLayerDisplayName}
            isRefreshing={isFetching}
            onRefresh={() => refetch()}
          />
        )}

        {data && contentLayers.length === 0 && (
          <EmptyState
            size="sm"
            title="No layer folders on disk"
            description="Add a layer from the list on the left."
          />
        )}
      </div>

      <LayerFileDropOverlay visible={showDropOverlay} layerDisplayName={selectedLayerDisplayName} />
    </div>
  );
}
