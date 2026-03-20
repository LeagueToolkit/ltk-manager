import { createFileRoute } from "@tanstack/react-router";
import { Layers, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components";
import type { WorkshopLayer } from "@/lib/tauri";
import {
  CreateLayerDialog,
  DeleteLayerDialog,
  EditLayerDialog,
  LockedLayerCard,
  SortableLayerList,
  useCreateLayer,
  useDeleteLayer,
  useProjectContext,
  useReorderLayers,
} from "@/modules/workshop";

export const Route = createFileRoute("/workshop/$projectName/layers")({
  component: ProjectLayers,
});

function ProjectLayers() {
  const project = useProjectContext();
  const allLayers = [...project.layers].sort((a, b) => a.priority - b.priority);
  const baseLayer = allLayers.find((l) => l.name === "base");
  const sortableLayers = allLayers.filter((l) => l.name !== "base");

  const createLayer = useCreateLayer();
  const deleteLayer = useDeleteLayer();
  const reorderLayers = useReorderLayers();

  const [createOpen, setCreateOpen] = useState(false);
  const [editLayer, setEditLayer] = useState<WorkshopLayer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkshopLayer | null>(null);

  function handleCreateSubmit(name: string, description: string) {
    createLayer.mutate(
      { projectPath: project.path, name, description: description || undefined },
      { onSuccess: () => setCreateOpen(false) },
    );
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    deleteLayer.mutate(
      { projectPath: project.path, layerName: deleteTarget.name },
      { onSuccess: () => setDeleteTarget(null) },
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-surface-100">Layers</h2>
          <p className="mt-1 text-sm text-surface-400">
            Layers are applied in priority order. Higher priority layers override lower ones. Drag
            to reorder.
          </p>
        </div>
        <Button
          variant="filled"
          size="sm"
          left={<Plus />}
          onClick={() => setCreateOpen(true)}
          className="shrink-0"
        >
          Add Layer
        </Button>
      </div>

      {allLayers.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center text-center">
          <Layers className="mb-3 h-10 w-10 text-surface-600" />
          <h3 className="text-sm font-medium text-surface-300">No layers</h3>
          <p className="mt-1 text-sm text-surface-500">This project has no layers configured.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {baseLayer && (
            <LockedLayerCard layer={baseLayer} onEdit={() => setEditLayer(baseLayer)} />
          )}

          {sortableLayers.length > 0 && (
            <SortableLayerList
              layers={sortableLayers}
              onReorder={(names) =>
                reorderLayers.mutate({ projectPath: project.path, layerNames: names })
              }
              onEdit={setEditLayer}
              onDelete={setDeleteTarget}
            />
          )}
        </div>
      )}

      <CreateLayerDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateSubmit}
        isPending={createLayer.isPending}
        existingNames={allLayers.map((l) => l.name)}
      />

      <EditLayerDialog
        open={editLayer !== null}
        layer={editLayer}
        onClose={() => setEditLayer(null)}
        projectPath={project.path}
      />

      <DeleteLayerDialog
        open={deleteTarget !== null}
        layer={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        isPending={deleteLayer.isPending}
      />
    </div>
  );
}
