import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState } from "react";

import type { InstalledMod } from "@/lib/tauri";

import { ModCard } from "./ModCard";

interface SortableModListProps {
  mods: InstalledMod[];
  viewMode: "grid" | "list";
  onReorder: (modIds: string[]) => void;
  disabled?: boolean;
  onToggle: (modId: string, enabled: boolean) => void;
  onUninstall: (modId: string) => void;
  onViewDetails?: (mod: InstalledMod) => void;
  children: React.ReactNode;
}

export function SortableModList({
  mods,
  viewMode,
  onReorder,
  disabled,
  onToggle,
  onUninstall,
  onViewDetails,
  children,
}: SortableModListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = mods.map((m) => m.id);
  const activeMod = activeId ? mods.find((m) => m.id === activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.indexOf(active.id as string);
    const newIndex = items.indexOf(over.id as string);
    const newOrder = arrayMove(items, oldIndex, newIndex);
    onReorder(newOrder);
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  if (disabled) {
    return <>{children}</>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={items}
        strategy={viewMode === "list" ? verticalListSortingStrategy : rectSortingStrategy}
      >
        {children}
      </SortableContext>
      <DragOverlay>
        {activeMod ? (
          <div className="scale-[1.02] cursor-grabbing shadow-lg">
            <ModCard
              mod={activeMod}
              viewMode={viewMode}
              onToggle={onToggle}
              onUninstall={onUninstall}
              onViewDetails={onViewDetails}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
