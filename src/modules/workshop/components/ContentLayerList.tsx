import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DotsSixVerticalIcon,
  DotsThreeVerticalIcon,
  FolderOpenIcon,
  LockIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { IconButton, Menu, useToast } from "@/components";
import { api, type LayerContent, type WorkshopLayer, type WorkshopProject } from "@/lib/tauri";
import { useShowLayerStats } from "@/stores";
import { formatBytes, restrictToVerticalAxis } from "@/utils";

import { workshopKeys } from "../api/keys";
import {
  DeleteLayerDialog,
  EditLayerDialog,
  useDeleteLayer,
  useRenameLayer,
  useReorderLayers,
} from "../layers";
import { LayerGlyph } from "./LayerGlyph";

interface ContentLayerListProps {
  project: WorkshopProject;
  contentLayers: readonly LayerContent[];
  selectedLayerName: string | null;
  onSelect: (layerName: string) => void;
}

/** The layers explorer's rows: reorderable, renameable, one of them selected. */
export function ContentLayerList({
  project,
  contentLayers,
  selectedLayerName,
  onSelect,
}: ContentLayerListProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const allLayers = [...project.layers].sort((a, b) => a.priority - b.priority);
  const baseLayer = allLayers.find((l) => l.name === "base");
  const sortableLayers = allLayers.filter((l) => l.name !== "base");

  const statsByName = new Map(contentLayers.map((l) => [l.name, l] as const));

  const [editTarget, setEditTarget] = useState<WorkshopLayer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkshopLayer | null>(null);

  const deleteLayer = useDeleteLayer();
  const reorderLayers = useReorderLayers();

  function invalidateContent() {
    queryClient.invalidateQueries({ queryKey: workshopKeys.contentTree(project.path) });
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    const deletingSelected = deleteTarget.name === selectedLayerName;
    deleteLayer.mutate(
      { projectPath: project.path, layerName: deleteTarget.name },
      {
        onSuccess: () => {
          setDeleteTarget(null);
          invalidateContent();
          if (deletingSelected) onSelect("base");
        },
        onError: (err) => toast.error(`Failed to delete layer: ${err.message}`),
      },
    );
  }

  function handleReorder(newOrder: string[]) {
    reorderLayers.mutate(
      { projectPath: project.path, layerNames: newOrder },
      {
        onSuccess: () => invalidateContent(),
        onError: (err) => toast.error(`Failed to reorder: ${err.message}`),
      },
    );
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortableNames = sortableLayers.map((l) => l.name);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortableNames.indexOf(active.id as string);
    const newIndex = sortableNames.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    handleReorder(arrayMove(sortableNames, oldIndex, newIndex));
  }

  return (
    <>
      <ul
        data-ui="ContentLayerList"
        role="listbox"
        aria-label="Project layers"
        className="flex flex-col gap-0.5 p-1.5"
      >
        {baseLayer && (
          <BaseLayerRow
            layer={baseLayer}
            stats={statsByName.get(baseLayer.name)}
            selected={selectedLayerName === baseLayer.name}
            onSelect={() => onSelect(baseLayer.name)}
            onEdit={() => setEditTarget(baseLayer)}
            projectPath={project.path}
            onRenamed={invalidateContent}
          />
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortableNames} strategy={verticalListSortingStrategy}>
            {sortableLayers.map((layer) => (
              <SortableLayerRow
                key={layer.name}
                layer={layer}
                stats={statsByName.get(layer.name)}
                selected={selectedLayerName === layer.name}
                onSelect={() => onSelect(layer.name)}
                onEdit={() => setEditTarget(layer)}
                onDelete={() => setDeleteTarget(layer)}
                projectPath={project.path}
                onRenamed={invalidateContent}
              />
            ))}
          </SortableContext>
        </DndContext>

        {allLayers.length === 0 && (
          <li className="px-1.5 py-1 text-xs text-surface-400">No layers.</li>
        )}
      </ul>

      <EditLayerDialog
        open={editTarget !== null}
        layer={editTarget}
        onClose={() => setEditTarget(null)}
        projectPath={project.path}
      />

      <DeleteLayerDialog
        open={deleteTarget !== null}
        layer={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        isPending={deleteLayer.isPending}
      />
    </>
  );
}

interface BaseLayerRowProps {
  layer: WorkshopLayer;
  stats?: LayerContent;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  projectPath: string;
  onRenamed: () => void;
}

function BaseLayerRow({
  layer,
  stats,
  selected,
  onSelect,
  onEdit,
  projectPath,
  onRenamed,
}: BaseLayerRowProps) {
  return (
    <li>
      <RowShell
        layer={layer}
        stats={stats}
        selected={selected}
        onSelect={onSelect}
        projectPath={projectPath}
        onRenamed={onRenamed}
        canRename={false}
        leading={<LockIcon className="h-3 w-3 shrink-0 text-surface-400" />}
        trailing={
          <RowMenu
            canDelete={false}
            onEdit={onEdit}
            onDelete={() => {
              /* base cannot be deleted */
            }}
            onOpenFolder={() => openFolder(projectPath, layer.name)}
          />
        }
      />
    </li>
  );
}

interface SortableLayerRowProps {
  layer: WorkshopLayer;
  stats?: LayerContent;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  projectPath: string;
  onRenamed: () => void;
}

function SortableLayerRow({
  layer,
  stats,
  selected,
  onSelect,
  onEdit,
  onDelete,
  projectPath,
  onRenamed,
}: SortableLayerRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.name,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <RowShell
        layer={layer}
        stats={stats}
        selected={selected}
        onSelect={onSelect}
        projectPath={projectPath}
        onRenamed={onRenamed}
        canRename
        leading={
          <button
            type="button"
            aria-label={`Drag ${layer.displayName}`}
            className="flex shrink-0 cursor-grab touch-none items-center text-surface-400 hover:text-surface-200 active:cursor-grabbing"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <DotsSixVerticalIcon weight="bold" className="h-4 w-4" />
          </button>
        }
        trailing={
          <RowMenu
            canDelete
            onEdit={onEdit}
            onDelete={onDelete}
            onOpenFolder={() => openFolder(projectPath, layer.name)}
          />
        }
      />
    </li>
  );
}

interface RowShellProps {
  layer: WorkshopLayer;
  stats?: LayerContent;
  selected: boolean;
  onSelect: () => void;
  projectPath: string;
  onRenamed: () => void;
  canRename: boolean;
  leading: React.ReactNode;
  trailing: React.ReactNode;
}

function RowShell({
  layer,
  stats,
  selected,
  onSelect,
  projectPath,
  onRenamed,
  canRename,
  leading,
  trailing,
}: RowShellProps) {
  const renameLayer = useRenameLayer();
  const toast = useToast();
  const showStats = useShowLayerStats();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(layer.displayName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isRenaming) setRenameValue(layer.displayName);
  }, [layer.displayName, isRenaming]);

  function commitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === layer.displayName) {
      setIsRenaming(false);
      return;
    }
    renameLayer.mutate(
      { projectPath, layerName: layer.name, newDisplayName: trimmed },
      {
        onSuccess: () => onRenamed(),
        onError: (err) => toast.error(`Failed to rename: ${err.message}`),
        onSettled: () => setIsRenaming(false),
      },
    );
  }

  return (
    <div
      className={twMerge(
        "group/row relative flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition-colors",
        selected
          ? "bg-accent-500/15 text-accent-100"
          : "text-surface-200 hover:bg-surface-800/60 hover:text-surface-100",
      )}
    >
      {selected && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent-400"
        />
      )}
      {leading}
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm text-left outline-none select-none focus-visible:ring-1 focus-visible:ring-accent-500/60 focus-visible:ring-offset-0"
      >
        <LayerGlyph
          layerName={layer.name}
          className={selected ? "text-accent-400" : "text-surface-400"}
        />
        {isRenaming ? (
          <input
            ref={inputRef}
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setIsRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded-sm border border-surface-600 bg-surface-900 px-1 py-0 text-sm text-surface-100 outline-none select-text focus:border-accent-500"
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-sm"
            onDoubleClick={
              canRename
                ? (e) => {
                    e.stopPropagation();
                    setIsRenaming(true);
                    requestAnimationFrame(() => inputRef.current?.select());
                  }
                : undefined
            }
          >
            {layer.displayName}
          </span>
        )}
        {stats && showStats && (
          <span
            className={twMerge(
              "shrink-0 text-[11px] tabular-nums transition-opacity group-hover/row:opacity-0 group-has-[[aria-expanded=true]]/row:opacity-0",
              selected ? "text-accent-300" : "text-surface-400",
            )}
          >
            {stats.fileCount}
            {stats.fileCount > 0 && ` · ${formatBytes(Number(stats.totalSizeBytes))}`}
          </span>
        )}
      </button>
      <div className="absolute inset-y-0 right-1 flex items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
        {trailing}
      </div>
    </div>
  );
}

interface RowMenuProps {
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onOpenFolder: () => void;
}

function RowMenu({ canDelete, onEdit, onDelete, onOpenFolder }: RowMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            variant="ghost"
            size="xs"
            compact
            icon={<DotsThreeVerticalIcon weight="bold" className="h-4 w-4" />}
            aria-label="Layer actions"
            className="h-5 w-5"
          />
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4}>
          <Menu.Popup>
            <Menu.Item icon={<FolderOpenIcon className="h-4 w-4" />} onClick={onOpenFolder}>
              Open Folder
            </Menu.Item>
            <Menu.Item icon={<PencilSimpleIcon className="h-4 w-4" />} onClick={onEdit}>
              Edit
            </Menu.Item>
            {canDelete && (
              <>
                <Menu.Separator />
                <Menu.Item
                  icon={<TrashIcon className="h-4 w-4" />}
                  variant="danger"
                  onClick={onDelete}
                >
                  Delete
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

async function openFolder(projectPath: string, layerName: string) {
  const result = await api.getLayerContentPath(projectPath, layerName);
  if (result.ok) await api.revealInExplorer(result.value);
}
