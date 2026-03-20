import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EllipsisVertical, GripVertical, Pencil, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";

import { IconButton, Menu } from "@/components";
import type { WorkshopLayer } from "@/lib/tauri";

import { getStringOverrideCount } from "./LayerCard";

interface SortableLayerCardProps {
  layer: WorkshopLayer;
  onEdit: () => void;
  onDelete: () => void;
}

export function SortableLayerCard({ layer, onEdit, onDelete }: SortableLayerCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.name,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const stringOverrideCount = getStringOverrideCount(layer);

  return (
    <div ref={setNodeRef} style={style} className="group/sortable relative flex items-center gap-2">
      <div
        className="flex shrink-0 cursor-grab items-center opacity-0 transition-opacity group-hover/sortable:opacity-100"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5 text-surface-500" />
      </div>

      <div className="min-w-0 flex-1 rounded-lg border border-surface-700 bg-surface-800/50 p-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-surface-100">{layer.name}</h3>
              <span className="rounded-full bg-surface-700 px-2 py-0.5 text-xs text-surface-400">
                Priority {layer.priority}
              </span>
            </div>
            {layer.description && (
              <p className="mt-1 text-sm text-surface-400">{layer.description}</p>
            )}
          </div>

          {stringOverrideCount > 0 && (
            <span className="shrink-0 text-xs text-surface-400">
              {stringOverrideCount} string override{stringOverrideCount !== 1 ? "s" : ""}
            </span>
          )}

          <Menu.Root>
            <Menu.Trigger
              render={
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<EllipsisVertical className="h-4 w-4" />}
                />
              }
            />
            <Menu.Portal>
              <Menu.Positioner align="end" sideOffset={4}>
                <Menu.Popup>
                  <Menu.Item icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
                    Edit
                  </Menu.Item>
                  <Menu.Item
                    icon={<Trash2 className="h-4 w-4" />}
                    variant="danger"
                    onClick={onDelete}
                  >
                    Delete
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
    </div>
  );
}
